'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

async function withHrRouter(run) {
    const savedCache = new Map(Object.entries(require.cache));
    const state = { actor: {}, failQuery: false };
    const calls = [];
    const sideEffects = [];
    const pool = {
        async connect() { sideEffects.push('connect'); throw new Error('Unexpected write connection'); },
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: normalized, params });
            assert.match(normalized, /^SELECT\b/i);
            assert.doesNotMatch(normalized, /hourly_rate|rate_unit|estimated_salary|payroll|profession_rate|salary/i);
            if (state.failQuery) throw new Error('Synthetic database failure');
            let rows = [];
            if (normalized.startsWith('SELECT s.id, s.name FROM staff s')) {
                rows = [{ id: 9701, name: 'Synthetic Park Worker', hourly_rate: 12345, account_secret: 'PRIVATE' }];
            } else if (normalized.includes('FROM hr_shifts WHERE')) {
                rows = [{ staff_id: 9701, days_scheduled: 2 }];
            } else if (normalized.includes('FROM hr_time_records tr')) {
                rows = [{ staff_id: 9701, clock_in: '2026-09-24T08:00:00Z', status: 'present',
                    late_minutes: 7, early_leave_minutes: 0, overtime_minutes: 20,
                    total_worked_minutes: 480, plan_source: 'hr_shift' }];
            } else if (normalized.includes('FROM tasks t')) {
                assert.match(normalized, /t\.business_context = 'event_genix'/);
                assert.match(normalized, /JOIN employee_profiles ep/);
                rows = [{ staff_id: 9701, tasks_assigned: 2, tasks_done: 1, tasks_overdue: 0,
                    compensation: { estimated_salary: 12345 } }];
            }
            return { rows: structuredClone(rows), rowCount: rows.length };
        }
    };
    let server;
    const installMock = (modulePath, exports) => {
        const id = require.resolve(modulePath);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    };
    try {
        for (const modulePath of ['../middleware/auth', '../routes/hr']) delete require.cache[require.resolve(modulePath)];
        installMock('../db', { pool });
        installMock('../utils/logger', { createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) });
        for (const name of [
            'websocket', 'accountSecurity', 'accountOnboarding', 'costumeInventory', 'taskExecution',
            'staffLifecycle', 'hrVacancyPlatformFormatter', 'hrPayrollPeriod', 'payroll',
            'payrollSettlement', 'hrPayrollSchemes', 'hrPayrollProfiles', 'liveMultiSegmentQa',
            'hrStaffDocuments', 'hrStaffMedicalBook', 'hrStaffResources', 'hrAttendanceDocuments',
            'hrAttendanceDocumentsPdf', 'hrAttendanceDocumentAutomation'
        ]) {
            installMock(`../services/${name}`, new Proxy({}, { get(_target, key) {
                return () => { sideEffects.push(`${name}.${String(key)}`); throw new Error(`Unexpected ${name} service`); };
            } }));
        }
        installMock('../services/booking', { getKyivDate: () => new Date('2026-09-27T12:00:00Z') });
        installMock('../services/hrOnboarding', { attachOnboardingAssignments: async rows => rows });
        installMock('../services/professionChecklists', { loadProfessionChecklistProgressBatch: async () => ({ byAssignment: {} }) });
        const { applyMembershipAccess, buildMembershipAccess } = require('../services/businessMembership');
        const actualAuth = require('../middleware/auth');
        const authenticateFixture = (req, res, next) => {
            if (state.actor.unauthenticated) return res.status(401).json({ success: false });
            const context = req.headers['x-business-context'] || 'event_genix';
            const principal = { id: 9101, username: 'synthetic_report_reader', role: state.actor.role || 'director',
                business_contexts: ['event_genix', 'dar', 'crm'], default_business_context: 'event_genix' };
            const registry = ['event_genix', 'dar', 'crm'].map((key, index) => ({
                business_id: index + 1,
                organization_id: key === 'dar' || state.actor.otherOrganization && key === 'event_genix' ? 2 : 1,
                context_key: key, access_mode: state.actor.compatibility && key === 'event_genix'
                    ? 'compatibility' : 'membership',
                business_status: state.actor.inactive && key === 'event_genix' ? 'inactive' : 'active',
                organization_status: state.actor.inactiveOrganization && key === 'event_genix' ? 'inactive' : 'active'
            }));
            const memberships = registry.filter(row => !(state.actor.revoked && row.context_key === 'event_genix')
                && !(state.actor.compatibility && row.context_key === 'event_genix'))
                .map(row => ({ ...row, organization_id: state.actor.otherOrganization && row.context_key === 'event_genix'
                    ? 1 : row.organization_id, role: principal.role, organization_role: 'member', business_modules: [],
                    is_default: row.context_key === 'event_genix', action_allowlist: state.actor.allow || [],
                    action_denylist: state.actor.deny || [] }));
            req.user = applyMembershipAccess(principal, buildMembershipAccess(principal, memberships, context, registry));
            if (state.actor.staleActiveBusinessId && req.user.activeBusinessMembership) {
                req.user.activeBusinessMembership = { ...req.user.activeBusinessMembership, businessId: 999 };
            }
            next();
        };
        installMock('../middleware/auth', { ...actualAuth, authenticateToken: authenticateFixture });
        const app = express();
        app.use(express.json());
        app.use('/api/hr', authenticateFixture, require('../routes/hr'));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const request = async (path, options = {}) => {
            const response = await fetch(origin + path, { method: options.method || 'GET',
                headers: { 'X-Business-Context': options.context || 'event_genix' } });
            const text = await response.text();
            return { status: response.status, body: text ? JSON.parse(text) : null, text };
        };
        await run({ state, calls, request });
        assert.deepEqual(sideEffects, []);
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        for (const id of Object.keys(require.cache)) if (!savedCache.has(id)) delete require.cache[id];
        for (const [id, cached] of savedCache) require.cache[id] = cached;
    }
}

test('Park monthly report uses exact GET, current membership and non-payroll projection', async t => {
    await withHrRouter(async ({ state, calls, request }) => {
        await t.test('authorized Park viewer reads only attendance and Park task KPI', async () => {
            state.actor = { deny: ['hr.payroll.view', 'hr.staff.view', 'hr.schedule.view'] };
            const response = await request('/api/hr/report/monthly?month=2026-09');
            assert.equal(response.status, 200, response.text);
            assert.deepEqual([response.body.dateFrom, response.body.dateTo], ['2026-09-01', '2026-09-30']);
            assert.deepEqual(response.body.reportAccess, { readOnly: true, exportAllowed: false, businessContext: 'event_genix' });
            assert.equal(response.body.data.length, 1);
            assert.equal(response.body.data[0].staff_name, 'Synthetic Park Worker');
            assert.equal(response.body.data[0].total_worked_hours, 8);
            assert.deepEqual(response.body.data[0].task_kpi, { tasks_assigned: 2, tasks_done: 1, tasks_overdue: 0 });
            assert.doesNotMatch(response.text, /hourly_rate|rate_unit|estimated_salary|profession_rate|PRIVATE|compensation/i);
            assert.equal(calls.length, 4);
            state.actor = {};
            const payrollCapable = await request('/api/hr/report/monthly?month=2026-09');
            assert.equal(payrollCapable.status, 200, payrollCapable.text);
            assert.doesNotMatch(payrollCapable.text, /hourly_rate|rate_unit|estimated_salary|profession_rate|PRIVATE|compensation/i);
        });
        await t.test('missing reports capability, foreign scope, revoked and mismatched membership deny before SQL', async () => {
            for (const [actor, context, suffix = ''] of [
                [{ deny: ['hr.reports.view'] }, 'event_genix'],
                [{ role: 'security', allow: ['hr.staff.view', 'hr.schedule.view', 'hr.payroll.view'],
                    deny: ['hr.reports.view'] }, 'event_genix'],
                [{}, 'dar'], [{}, 'crm'], [{ otherOrganization: true }, 'event_genix'],
                [{ revoked: true }, 'event_genix'], [{ compatibility: true }, 'event_genix'],
                [{ staleActiveBusinessId: true }, 'event_genix'], [{ inactive: true }, 'event_genix'],
                [{ inactiveOrganization: true }, 'event_genix'],
                [{}, 'event_genix', '&businessScope=all'],
                [{}, 'event_genix', '&businessScope=multi&businessContexts=event_genix,dar'],
                [{}, 'event_genix', '&business_context=dar']
            ]) {
                state.actor = actor;
                const before = calls.length;
                const response = await request(`/api/hr/report/monthly?month=2026-09${suffix}`, { context });
                assert.equal(response.status, 403, `${JSON.stringify(actor)} ${context}${suffix}: ${response.text}`);
                assert.equal(calls.length, before);
            }
        });
        await t.test('invalid period, database failure and unavailable routes cannot become empty success', async () => {
            state.actor = { deny: ['hr.payroll.view'] };
            for (const suffix of ['month=2026-13', 'month=bad', 'from=2026-09-01&to=2026-09-30']) {
                const before = calls.length;
                assert.equal((await request(`/api/hr/report/monthly?${suffix}`)).status, 400);
                assert.equal(calls.length, before);
            }
            state.failQuery = true;
            const failure = await request('/api/hr/report/monthly?month=2026-09');
            assert.equal(failure.status, 500);
            assert.equal(failure.body.success, false);
            state.failQuery = false;
            for (const [method, path] of [
                ['HEAD', '/api/hr/report/monthly'], ['POST', '/api/hr/report/monthly'],
                ['GET', '/api/hr/report/export'], ['GET', '/api/hr/salary'], ['GET', '/api/hr/payroll-profiles']
            ]) {
                const before = calls.length;
                assert.equal((await request(path, { method })).status, 403, `${method} ${path}`);
                assert.equal(calls.length, before);
            }
        });
    });
});
