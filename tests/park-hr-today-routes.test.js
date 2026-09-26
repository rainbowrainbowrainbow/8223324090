'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const TODAY = '2026-09-14';
const PRIVATE = 'SYNTHETIC_PRIVATE_TODAY_FIELD';
const EXPECTED_SUMMARY = { total_staff: 5, present: 1, late: 1, absent: 1, on_vacation: 1, sick: 1 };
const EMPTY_SUMMARY = { total_staff: 0, present: 0, late: 0, absent: 0, on_vacation: 0, sick: 0 };

function createPoolFixture(state) {
    const calls = [];
    const sideEffects = [];
    const staff = Array.from({ length: 5 }, (_, index) => ({
        id: 9701 + index, name: `Synthetic Park Today ${index + 1}`, department: 'animators',
        position: 'Animator', color: '#22aaaa', role_type: 'animator', company_structure_node_id: null,
        photo_url: null, birth_date: '1990-09-14', is_birthday_today: index === 0
    }));
    const shifts = staff.slice(0, 3).map((person, index) => ({
        id: 9801 + index, staff_id: person.id, shift_date: TODAY, profession_key: 'animator',
        planned_start: '10:00', planned_end: '18:00', break_minutes: 30, shift_type: 'regular'
    }));
    const records = [
        { id: 9401, staff_id: 9701, clock_in: `${TODAY}T07:00:00.000Z`, clock_out: `${TODAY}T15:00:00.000Z`,
            status: 'present', total_worked_minutes: 450, late_minutes: 0 },
        { id: 9402, staff_id: 9702, clock_in: `${TODAY}T07:07:00.000Z`, clock_out: null,
            status: 'late', total_worked_minutes: 0, late_minutes: 7 },
        { id: 9404, staff_id: 9704, clock_in: null, clock_out: null, status: 'vacation', total_worked_minutes: 0 },
        { id: 9405, staff_id: 9705, clock_in: null, clock_out: null, status: 'sick', total_worked_minutes: 0 }
    ].map(record => ({
        record_date: TODAY, planned_start: '10:00', planned_end: '18:00', early_leave_minutes: 0,
        overtime_minutes: 0, late_minutes: 0, auto_closed: false, ...record,
        notes: PRIVATE, corrected_by: PRIVATE, phone: PRIVATE, account_username: PRIVATE,
        compensation_snapshot: { hourlyRate: 98765, compensationAllocations: [{ hourlyRate: 98765, privateField: PRIVATE }] }
    }));
    const pool = {
        async connect() { sideEffects.push('connect'); throw new Error('Unexpected write connection'); },
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: normalized, params });
            assert.match(normalized, /^SELECT\b/i, 'Today recovery only reads');
            if (state.failDatabase) throw new Error(PRIVATE);
            let rows;
            if (normalized.startsWith('SELECT id, name, department, position, color, role_type,')) {
                assert.deepEqual(params, [TODAY]);
                rows = staff;
            } else if (normalized === 'SELECT * FROM hr_shifts WHERE shift_date = $1') {
                assert.deepEqual(params, [TODAY]);
                rows = shifts;
            } else if (normalized.startsWith('SELECT to_jsonb(hs) AS shift_row,')) {
                assert.deepEqual(params, [[9801, 9802, 9803]]);
                rows = shifts.map((shift, index) => ({
                    shift_row: shift, segment_id: 9901 + index, profession_key: 'animator',
                    planned_start: '10:00', planned_end: '18:00', break_minutes: 30, sort_order: 0,
                    additional_profession_keys: ['host'], additional_roles: [{ professionKey: 'host',
                        compensationMode: 'paid_hourly', payMultiplier: 0.5, policyVersion: 'fixture-v1' }]
                }));
            } else if (normalized === 'SELECT * FROM hr_time_records WHERE record_date = $1') {
                assert.deepEqual(params, [TODAY]);
                rows = records;
            } else if (normalized === "SELECT value FROM settings WHERE key = 'hr_company_structure'") {
                rows = [{ value: { nodes: [] } }];
            } else if (normalized.startsWith('SELECT key, structure_node_id FROM hr_professions')) {
                rows = [];
            } else {
                throw new Error(`Unexpected Park Today fixture query: ${normalized}`);
            }
            rows = state.empty ? [] : rows;
            return { rows: structuredClone(rows), rowCount: rows.length };
        }
    };
    return { pool, calls, sideEffects };
}

async function withActualHrRouter(run) {
    const savedCache = new Map(Object.entries(require.cache));
    const state = { actor: {} };
    const fixture = createPoolFixture(state);
    let server;
    function installMock(modulePath, exports) {
        const id = require.resolve(modulePath);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    try {
        for (const modulePath of ['../middleware/auth', '../routes/hr']) delete require.cache[require.resolve(modulePath)];
        installMock('../db', { pool: fixture.pool });
        installMock('../utils/logger', { createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) });
        // Keep the actual router, capability checks, attendance calculations and
        // display grouping. Prevent every service outside this GET from running.
        for (const name of [
            'websocket', 'accountSecurity', 'accountOnboarding', 'costumeInventory', 'taskExecution',
            'taskPerformancePolicy', 'hrOnboarding', 'professionChecklists', 'staffLifecycle',
            'hrVacancyPlatformFormatter', 'hrPayrollPeriod', 'payroll', 'payrollSettlement',
            'hrPayrollSchemes', 'hrPayrollProfiles', 'liveMultiSegmentQa', 'hrStaffDocuments',
            'hrStaffMedicalBook', 'hrStaffResources', 'hrAttendanceDocuments',
            'hrAttendanceDocumentsPdf', 'hrAttendanceDocumentAutomation', 'booking'
        ]) {
            installMock(`../services/${name}`, new Proxy({}, {
                get(_target, key) {
                    if (name === 'booking' && key === 'getKyivDateStr') return () => TODAY;
                    return () => {
                        fixture.sideEffects.push(`${name}.${String(key)}`);
                        throw new Error(`Unexpected service call: ${name}.${String(key)}`);
                    };
                }
            }));
        }
        const { applyMembershipAccess, buildMembershipAccess } = require('../services/businessMembership');
        const actualAuth = require('../middleware/auth');
        const authenticateFixture = (req, res, next) => {
            if (state.actor.unauthenticated) return res.status(401).json({ success: false, code: 'auth_required' });
            const context = req.headers['x-business-context'] || 'event_genix';
            const principal = { id: 9101, username: 'synthetic_today_reader', role: state.actor.role || 'director',
                business_contexts: ['event_genix', 'dar', 'crm', 'maysternya_doli'], default_business_context: 'event_genix' };
            const registry = ['event_genix', 'dar', 'crm', 'maysternya_doli'].map((key, index) => ({
                business_id: index + 1, organization_id: 1, context_key: key, access_mode: 'membership',
                business_status: state.actor.inactive && key === 'event_genix' ? 'inactive' : 'active',
                organization_status: state.actor.inactiveOrganization ? 'inactive' : 'active'
            }));
            const memberships = registry.filter(row => !(state.actor.revoked && row.context_key === 'event_genix'))
                .map(row => ({ ...row, role: principal.role, organization_role: 'member', business_modules: [],
                    is_default: row.context_key === 'event_genix', action_allowlist: state.actor.allow || [],
                    action_denylist: state.actor.deny || [] }));
            req.user = applyMembershipAccess(principal, buildMembershipAccess(principal, memberships, context, registry));
            if (state.actor.missingSnapshot) delete req.user.businessMembershipAccess;
            return next();
        };
        installMock('../middleware/auth', { ...actualAuth, authenticateToken: authenticateFixture });
        const app = express();
        app.use(express.json());
        app.use('/api/hr', authenticateFixture, require('../routes/hr'));
        server = await new Promise(resolve => {
            const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        async function request(path = '/api/hr/today', options = {}) {
            const response = await fetch(origin + path, {
                method: options.method || 'GET',
                headers: { 'X-Business-Context': options.context || 'event_genix', 'Content-Type': 'application/json' },
                ...(options.body ? { body: JSON.stringify(options.body) } : {})
            });
            const text = await response.text();
            return { status: response.status, body: text ? JSON.parse(text) : null, text };
        }
        await run({ ...fixture, state, request });
        assert.deepEqual(fixture.sideEffects, [], 'no provider, account, payroll or write service was called');
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        for (const id of Object.keys(require.cache)) if (!savedCache.has(id)) delete require.cache[id];
        for (const [id, cached] of savedCache) require.cache[id] = cached;
    }
}

test('Park Today recovery through the actual Express HR router', async t => {
    await withActualHrRouter(async ({ state, request, calls }) => {
        await t.test('Today capability alone loads real cards, attendance facts and summary without payroll or contacts', async () => {
            state.actor = { allow: ['hr.today.view'], deny: ['hr.schedule.view', 'hr.staff.view', 'hr.payroll.view'] };
            const result = await request();
            assert.equal(result.status, 200, result.text);
            assert.equal(result.body.date, TODAY);
            assert.equal(result.body.success, true);
            assert.deepEqual(result.body.todayAccess, { readOnly: true, businessContext: 'event_genix' });
            assert.deepEqual(result.body.summary, EXPECTED_SUMMARY);
            assert.equal(result.body.data.length, 5);
            const completed = result.body.data.find(row => row.staff_id === 9701);
            assert.equal(completed.staff_name, 'Synthetic Park Today 1');
            assert.equal(completed.display_group, 'animators');
            assert.equal(completed.is_birthday_today, true);
            assert.equal(completed.shift.planned_start, '10:00');
            assert.equal(completed.shift.planned_end, '18:00');
            assert.equal(completed.shift.planned_minutes, 450);
            assert.equal(completed.shift.segments[0].professionKey, 'animator');
            assert.equal(completed.record.id, 9401);
            assert.equal(completed.record.actualMinutes, 450);
            assert.equal(completed.record.total_worked_minutes, 450);
            assert.equal(completed.record.segment_allocations[0].actualMinutes, 450);
            const present = result.body.data.find(row => row.staff_id === 9702);
            assert.equal(present.record.clock_out, null);
            assert.equal(present.record.is_late, true);
            assert.equal(present.record.attendance_facts.lateMinutes, 7);
            assert.equal(result.body.data.find(row => row.staff_id === 9703).record, null);
            assert.equal(result.body.data.find(row => row.staff_id === 9704).shift, null);
            assert.equal(result.text.includes(PRIVATE), false);
            assert.equal(result.text.includes('98765'), false);
            assert.doesNotMatch(result.text, /"(?:birth_date|hourlyRate|hourly_rate|payMultiplier|compensation_snapshot|compensation_allocations|compensation_issues|account_username|phone|email|ip_address)"/);
        });

        await t.test('membership and capability revocations take effect on the next request before data reads', async () => {
            state.actor = { allow: ['hr.today.view'] };
            assert.equal((await request()).status, 200);
            for (const actor of [
                { revoked: true }, { inactive: true }, { inactiveOrganization: true }, { missingSnapshot: true },
                { deny: ['hr.today.view'], allow: ['hr.schedule.view'] }
            ]) {
                state.actor = actor;
                const count = calls.length;
                const result = await request();
                assert.equal(result.status, 403, JSON.stringify(actor));
                assert.equal(calls.length, count, 'denied principal must not reach the Today handler');
            }
        });

        await t.test('non-Park and aggregate business contexts cannot read legacy Today data', async () => {
            state.actor = {};
            for (const context of ['dar', 'crm', 'maysternya_doli']) {
                const count = calls.length;
                const result = await request('/api/hr/today', { context });
                assert.equal(result.status, 403, context);
                assert.equal(calls.length, count, context);
            }
            for (const query of ['businessScope=all', 'businessScope=multi&businessContexts=event_genix,dar', 'business_context=dar']) {
                const count = calls.length;
                const result = await request(`/api/hr/today?${query}`);
                assert.equal(result.status, 403, query);
                assert.equal(calls.length, count, query);
            }
        });

        await t.test('read-only Today permission does not activate attendance writes or unrelated HR data', async () => {
            state.actor = {};
            for (const [method, path] of [
                ['HEAD', '/api/hr/today'], ['POST', '/api/hr/today'], ['POST', '/api/hr/clock-in'],
                ['POST', '/api/hr/clock-out'], ['POST', '/api/hr/mark-absent'],
                ['PUT', '/api/hr/records/9401'], ['DELETE', '/api/hr/records/9401'],
                ['GET', '/api/hr/shifts'], ['GET', '/api/hr/salary'],
                ['GET', '/api/hr/report/daily']
            ]) {
                const count = calls.length;
                const result = await request(path, { method });
                assert.equal(result.status, 403, `${method} ${path}`);
                assert.equal(calls.length, count, `${method} ${path}`);
            }
        });

        await t.test('adding staff card view to Today recovery still cannot submit attendance', async () => {
            state.actor = { allow: ['hr.today.view', 'hr.staff.view'], deny: ['hr.payroll.view'] };
            const today = await request();
            assert.equal(today.status, 200, today.text);
            assert.deepEqual(today.body.todayAccess, { readOnly: true, businessContext: 'event_genix' });
            const count = calls.length;
            for (const path of ['/api/hr/clock-in', '/api/hr/clock-out', '/api/hr/mark-absent']) {
                assert.equal((await request(path, { method: 'POST' })).status, 403, path);
                assert.equal(calls.length, count, `${path} cannot reach attendance SQL`);
            }
        });

        await t.test('empty Today data keeps a successful zero summary', async () => {
            state.actor = {};
            state.empty = true;
            try {
                const result = await request();
                assert.equal(result.status, 200);
                assert.deepEqual(result.body.data, []);
                assert.deepEqual(result.body.summary, EMPTY_SUMMARY);
                assert.equal(result.body.todayAccess.readOnly, true);
            } finally { state.empty = false; }
        });

        await t.test('unauthenticated and database-error responses remain failures without private details', async () => {
            state.actor = { unauthenticated: true };
            const count = calls.length;
            assert.equal((await request()).status, 401);
            assert.equal(calls.length, count);
            state.actor = {};
            state.failDatabase = true;
            try {
                const result = await request();
                assert.equal(result.status, 500);
                assert.equal(result.body.success, false);
                assert.equal(result.body.todayAccess, undefined);
                assert.equal(result.body.data, undefined);
                assert.equal(result.text.includes(PRIVATE), false);
            } finally { state.failDatabase = false; }
        });
    });
});
