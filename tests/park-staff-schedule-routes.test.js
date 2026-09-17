'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const RANGE = 'from=2026-09-13&to=2026-09-21';
const STAFF_ID = 9701;
const SHIFT_ID = 9801;
const PRIVATE = 'SYNTHETIC_PRIVATE_FIELD';
const READ_PATHS = [
    '/api/staff?active=true',
    `/api/staff/schedule?${RANGE}`,
    `/api/staff/schedule/hours?${RANGE}`,
    `/api/staff/attendance?${RANGE}`,
    '/api/staff/departments',
    '/api/staff/display-groups',
    `/api/staff/schedule/history/${STAFF_ID}/2026-09-14`,
    '/api/hr/professions'
];

const shift = {
    id: SHIFT_ID, staff_id: STAFF_ID, shift_date: '2026-09-14', profession_key: 'animator',
    planned_start: '10:00', planned_end: '18:00', break_minutes: 30, shift_type: 'regular'
};
const segment = {
    id: 9901, professionKey: 'animator', shiftStart: '10:00', shiftEnd: '18:00', breakMinutes: 30,
    additionalProfessionKeys: ['host'],
    additionalRoles: [{ professionKey: 'host', compensationMode: 'paid_hourly', payMultiplier: 0.5, policyVersion: 'fixture-v1' }]
};

function createPoolFixture() {
    const calls = [];
    const sideEffects = [];
    const pool = {
        async connect() { sideEffects.push('connect'); throw new Error('Unexpected write connection'); },
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: normalized, params });
            assert.match(normalized, /^(SELECT|WITH)\b/i, 'schedule recovery may only read');
            let rows;
            if (normalized.includes('FROM staff_schedule ss')) {
                assert.deepEqual(params, ['2026-09-13', '2026-09-21']);
                const row = {
                    id: 9601, staff_id: STAFF_ID, date: '2026-09-14', status: 'working',
                    name: 'Synthetic Park Worker', department: 'animators', position: 'Animator',
                    role_type: 'animator', profession_key: 'animator', secondary_professions: ['host'],
                    is_active: true, color: '#22aaaa', shift_start: '10:00', shift_end: '18:00',
                    hr_shift_id: SHIFT_ID, hr_profession_key: 'animator', hr_break_minutes: 30
                };
                if (normalized.startsWith('SELECT ss.*')) row.hr_segments = [segment];
                rows = [row];
            } else if (normalized.startsWith('SELECT staff.id,')) {
                rows = [{
                    id: STAFF_ID, name: 'Synthetic Park Worker', display_name: 'Synthetic Park Worker',
                    department: 'animators', position: 'Animator', role_type: 'animator',
                    secondary_professions: ['host'], professions: ['animator', 'host'],
                    is_active: true, is_freelance: false, hr_pool_status: 'core', color: '#22aaaa',
                    has_account: true, account_user_id: 9501, account_username: PRIVATE,
                    has_face_descriptor: true, card_source: 'hr_staff_card_light'
                }];
            } else if (normalized.startsWith('SELECT to_jsonb(hs) AS shift_row,')) {
                rows = [{
                    shift_row: shift, segment_id: segment.id, profession_key: 'animator',
                    planned_start: '10:00', planned_end: '18:00', break_minutes: 30,
                    additional_profession_keys: ['host'], additional_roles: segment.additionalRoles, sort_order: 0
                }];
            } else if (normalized.startsWith('SELECT * FROM hr_shifts')) {
                rows = [shift];
            } else if (normalized.includes('FROM hr_time_records tr FULL OUTER JOIN staff_checkins')) {
                rows = [{
                    staff_id: STAFF_ID, date: '2026-09-14', time_record_id: 9401,
                    clock_in: '2026-09-14T07:00:00.000Z', clock_out: '2026-09-14T15:00:00.000Z',
                    planned_start: '10:00', planned_end: '18:00', total_worked_minutes: 450,
                    late_minutes: 0, early_leave_minutes: 0, overtime_minutes: 0,
                    time_status: 'present', attendance_source: 'hr_time_records',
                    corrected_by: PRIVATE, correction_reason: PRIVATE, notes: PRIVATE,
                    compensation_snapshot: { privateField: PRIVATE, hourlyRate: 99999 }
                }];
            } else if (normalized.includes('FROM hr_audit_log')) {
                assert.deepEqual(params, [STAFF_ID, '2026-09-14', 50]);
                rows = [{
                    id: 9301, action: 'staff_schedule_update', staff_id: STAFF_ID,
                    performed_by: 'Synthetic Operator', created_at: '2026-09-14T06:00:00.000Z', ip_address: PRIVATE,
                    details: { date: '2026-09-14', before: { shift_start: '09:00', hourly_rate: PRIVATE },
                        after: { shift_start: '10:00', hourly_rate: PRIVATE }, salary: PRIVATE }
                }];
            } else if (normalized.includes("FROM settings WHERE key = 'hr_company_structure'")) {
                rows = [{ value: { nodes: [] } }];
            } else if (normalized.startsWith('SELECT key, structure_node_id FROM hr_professions')) {
                rows = [];
            } else if (normalized.includes('FROM hr_professions ORDER BY')) {
                rows = [{ id: 9201, key: 'animator', title: 'Animator', department: 'animators',
                    color: '#22aaaa', is_active: true, checklist: [] }];
            } else if (normalized.startsWith('WITH profession_assignments')) {
                rows = [{ profession_key: 'animator', staff_id: STAFF_ID, staff_name: 'Synthetic Park Worker',
                    department: 'animators', is_active: true, is_primary: true,
                    explicit_hourly_rate: 98765, fallback_hourly_rate: 99999, rate_unit: 'hour' }];
            } else if (/FROM (staff_shift_preferences|hr_staff_profession_checklist_progress|hr_profession_checklist_items|training_courses)\b/.test(normalized)) {
                rows = [];
            } else {
                throw new Error(`Unexpected Park schedule fixture query: ${normalized}`);
            }
            return { rows: structuredClone(rows), rowCount: rows.length };
        }
    };
    return { pool, calls, sideEffects };
}

async function withActualRouters(run) {
    const savedCache = new Map(Object.entries(require.cache));
    const fixture = createPoolFixture();
    const state = { actor: {} };
    let server;
    function installMock(modulePath, exports) {
        const id = require.resolve(modulePath);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    try {
        for (const modulePath of ['../middleware/auth', '../routes/staff', '../routes/hr']) {
            delete require.cache[require.resolve(modulePath)];
        }
        installMock('../db', { pool: fixture.pool });
        installMock('../utils/logger', { createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) });
        // These modules are outside the read path. Loading or calling providers,
        // account writes, payroll writes or upload handlers is not part of this fixture.
        const unusedServices = [
            'telegram', 'websocket', 'booking', 'accountSecurity', 'payroll', 'payrollSettlement',
            'staffLifecycle', 'accountLinking', 'accountOnboarding', 'staffScheduleWorkbook',
            'costumeInventory', 'taskExecution', 'taskPerformancePolicy', 'hrOnboarding',
            'professionChecklists', 'hrVacancyPlatformFormatter', 'hrPayrollPeriod',
            'hrPayrollSchemes', 'hrPayrollProfiles', 'liveMultiSegmentQa', 'hrStaffDocuments',
            'hrStaffMedicalBook', 'hrStaffResources', 'hrAttendanceDocuments',
            'hrAttendanceDocumentsPdf', 'hrAttendanceDocumentAutomation'
        ];
        for (const name of unusedServices) {
            installMock(`../services/${name}`, new Proxy({}, {
                get(_target, key) {
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
            const principal = { id: 9101, username: 'synthetic_schedule_reader', role: state.actor.role || 'director',
                business_contexts: ['event_genix', 'dar', 'crm', 'maysternya_doli'], default_business_context: 'event_genix' };
            const registry = ['event_genix', 'dar', 'crm', 'maysternya_doli'].map((key, index) => ({
                business_id: index + 1, organization_id: 1, context_key: key, access_mode: 'membership',
                business_status: state.actor.inactive && key === 'event_genix' ? 'inactive' : 'active',
                organization_status: 'active'
            }));
            const memberships = registry.filter(row => !(state.actor.revoked && row.context_key === 'event_genix'))
                .map(row => ({ ...row, role: principal.role, organization_role: 'member',
                    business_modules: [], is_default: row.context_key === 'event_genix',
                    action_allowlist: state.actor.allow || [], action_denylist: state.actor.deny || [] }));
            req.user = applyMembershipAccess(principal, buildMembershipAccess(principal, memberships, context, registry));
            return next();
        };
        installMock('../middleware/auth', { ...actualAuth, authenticateToken: authenticateFixture });
        const app = express();
        app.use(express.json());
        app.use('/api/staff', require('../routes/staff'));
        app.use('/api/hr', authenticateFixture, require('../routes/hr'));
        server = await new Promise(resolve => {
            const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        async function request(path, options = {}) {
            const response = await fetch(origin + path, {
                method: options.method || 'GET',
                headers: { 'X-Business-Context': options.context || 'event_genix', 'Content-Type': 'application/json' },
                ...(options.body ? { body: JSON.stringify(options.body) } : {})
            });
            const text = await response.text();
            return { status: response.status, body: text ? JSON.parse(text) : null, text };
        }
        await run({ ...fixture, state, request });
        assert.deepEqual(fixture.sideEffects, [], 'no provider, write or upload service was called');
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        for (const id of Object.keys(require.cache)) if (!savedCache.has(id)) delete require.cache[id];
        for (const [id, cached] of savedCache) require.cache[id] = cached;
    }
}

test('Park schedule ownership through the actual Express staff and HR routers', async t => {
    await withActualRouters(async ({ state, request, calls }) => {
        await t.test('all schedule GET dependencies load using real handlers and preserve operational values', async () => {
            state.actor = { deny: ['hr.payroll.view'] };
            const responses = new Map();
            for (const path of READ_PATHS) {
                const result = await request(path);
                assert.equal(result.status, 200, `${path}: ${result.text}`);
                assert.equal(result.body.success, true, path);
                responses.set(path, result.body);
            }
            const roster = responses.get(READ_PATHS[0]);
            assert.equal(roster.data[0].id, STAFF_ID);
            assert.equal(roster.data[0].display_group, 'animators');
            assert.deepEqual(roster.scheduleAccess, {
                readOnly: false,
                editable: true,
                businessContext: 'event_genix',
                owner: 'park',
                source: 'park_staff_schedule_ownership'
            });
            const schedule = responses.get(READ_PATHS[1]);
            assert.equal(schedule.data[0].date, '2026-09-14');
            assert.equal(schedule.data[0].shift_start, '10:00');
            assert.equal(schedule.data[0].shift_end, '18:00');
            assert.equal(schedule.data[0].plannedMinutes, 450);
            assert.equal(schedule.data[0].segments[0].professionKey, 'animator');
            assert.deepEqual(schedule.scheduleAccess, {
                readOnly: false,
                editable: true,
                businessContext: 'event_genix',
                owner: 'park',
                source: 'park_staff_schedule_ownership'
            });
            assert.equal(responses.get(READ_PATHS[2]).data[STAFF_ID].totalHours, 7.5);
            assert.equal(responses.get(READ_PATHS[3]).data[0].staff_id, STAFF_ID);
            assert.equal(responses.get(READ_PATHS[6]).data[0].action, 'staff_schedule_update');
            assert.ok(responses.get(READ_PATHS[7]).data.some(item => item.key === 'animator'));
            for (const [path, body] of responses) {
                const text = JSON.stringify(body);
                assert.equal(text.includes(PRIVATE), false, `${path} excludes private fields`);
                assert.doesNotMatch(text, /"(?:hourlyRate|hourly_rate|explicitRate|fallbackRate|compensation_snapshot|account_username|ip_address)"/, path);
            }
        });

        await t.test('other businesses, revoked and inactive Park memberships never reach domain queries', async () => {
            for (const actor of [{}, { revoked: true }, { inactive: true }]) {
                state.actor = actor;
                const contexts = Object.keys(actor).length ? ['event_genix'] : ['dar', 'crm', 'maysternya_doli'];
                for (const context of contexts) {
                    for (const path of READ_PATHS) {
                        const count = calls.length;
                        const result = await request(path, { context });
                        assert.equal(result.status, 403, `${context} ${path}`);
                        assert.equal(calls.length, count, `${context} ${path} must not query`);
                    }
                }
            }
        });

        await t.test('aggregate and conflicting business selectors cannot widen Park reads', async () => {
            state.actor = {};
            for (const suffix of ['businessScope=all', 'businessScope=multi&businessContexts=event_genix,dar', 'business_context=dar']) {
                const count = calls.length;
                const result = await request(`/api/staff/schedule?${RANGE}&${suffix}`);
                assert.equal(result.status, 403, suffix);
                assert.equal(calls.length, count, suffix);
            }
        });

        await t.test('explicit schedule capability deny keeps all Park recovery reads closed', async () => {
            state.actor = { deny: ['hr.schedule.view'] };
            for (const path of READ_PATHS) {
                const count = calls.length;
                const result = await request(path);
                assert.equal(result.status, 403, path);
                assert.equal(calls.length, count, path);
            }
        });

        await t.test('existing attendance role and HR profession capability checks remain effective', async () => {
            state.actor = { role: 'security', allow: ['hr.schedule.view'], deny: ['hr.staff.view'] };
            assert.equal((await request(`/api/staff/schedule?${RANGE}`)).status, 200);
            for (const path of [`/api/staff/attendance?${RANGE}`, '/api/hr/professions']) {
                const count = calls.length;
                const result = await request(path);
                assert.equal(result.status, 403, path);
                assert.equal(calls.length, count, path);
                if (path === '/api/hr/professions') assert.equal(result.body.code, 'HR_CAPABILITY_REQUIRED');
            }
        });

        await t.test('unrelated staff or HR endpoints remain closed before DB access', async () => {
            state.actor = {};
            const denied = [
                ['POST', '/api/staff'], ['DELETE', '/api/staff/9701'],
                ['GET', '/api/staff/face-descriptors'], ['GET', '/api/staff/payroll'],
                ['GET', '/api/staff/schedule/check/2026-09-14'],
                ['GET', '/api/hr/staff'], ['GET', '/api/hr/salary'], ['GET', '/api/hr/shifts'],
                ['POST', '/api/hr/professions'], ['POST', '/api/hr/shifts'],
                ['HEAD', `/api/staff/schedule?${RANGE}`]
            ];
            for (const [method, path] of denied) {
                const count = calls.length;
                const result = await request(path, { method });
                assert.equal(result.status, 403, `${method} ${path}`);
                assert.equal(calls.length, count, `${method} ${path}`);
            }
        });

        await t.test('unauthenticated reads and malformed period keep the existing errors', async () => {
            state.actor = { unauthenticated: true };
            let count = calls.length;
            assert.equal((await request('/api/staff')).status, 401);
            assert.equal(calls.length, count);
            state.actor = {};
            for (const path of ['/api/staff/schedule', '/api/staff/schedule/hours', '/api/staff/attendance?from=invalid']) {
                count = calls.length;
                const result = await request(path);
                assert.equal(result.status, 400, path);
                assert.equal(result.body.success, false, path);
                assert.equal(result.body.scheduleAccess, undefined, 'errors must not become successful read-only payloads');
                assert.equal(calls.length, count, path);
            }
        });
    });
});
