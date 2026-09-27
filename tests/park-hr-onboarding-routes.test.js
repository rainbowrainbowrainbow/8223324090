'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const PRIVATE = 'SYNTHETIC_SECRET_VALUE';
const STAFF_ID = 9701;

async function withActualHrRouter(run) {
    const savedCache = new Map(Object.entries(require.cache));
    const state = { actor: {}, failQuery: false };
    const calls = [];
    const sideEffects = [];
    const progress = {
        id: 41, staff_id: STAFF_ID, staff_name: 'Synthetic Park Worker', department: 'operations',
        template_id: 7, template_name: 'Park setup', status: 'in_progress', training_status: 'in_progress',
        responsible_user_id: 91, responsible_name: 'Synthetic Mentor', responsible_restricted: false,
        items: [{ id: 1, key: 'safe', title: 'Safe step', done: true, notes: PRIVATE, hourly_rate: 999 }],
        total_items: 1, completed_items: 1, generated_task_count: 1,
        active_task_count: 0, completed_task_count: 1, responsible_username: PRIVATE,
        assigned_by_username: PRIVATE, hourly_rate: 999
    };
    const pool = {
        async connect() { sideEffects.push('connect'); throw new Error('Unexpected write connection'); },
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: normalized, params });
            assert.match(normalized, /^SELECT\b/i);
            if (state.failQuery) throw new Error('Synthetic transient database failure');
            if (normalized.includes('FROM onboarding_templates ot')) {
                assert.match(normalized, /EXISTS \(SELECT 1 FROM onboarding_progress op/);
                return { rows: [{ id: 7, name: 'Park setup', department: 'operations', items: PRIVATE }] };
            }
            if (normalized.includes('FROM onboarding_progress op')) {
                assert.match(normalized, /op.profession_key IS NULL/);
                assert.match(normalized, /t.business_context = 'event_genix'/);
                assert.match(normalized, /bm.business_id = \$2/);
                assert.match(normalized, /bm.organization_id = \$3/);
                assert.equal(params[0], 'onboarding');
                assert.equal(params[1], 1);
                assert.equal(params[2], 1);
                return { rows: [structuredClone(progress)] };
            }
            throw new Error(`Unexpected query: ${normalized.slice(0, 80)}`);
        }
    };
    let server;
    function installMock(modulePath, exports) {
        const id = require.resolve(modulePath);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    try {
        for (const modulePath of ['../middleware/auth', '../routes/hr']) delete require.cache[require.resolve(modulePath)];
        installMock('../db', { pool });
        installMock('../utils/logger', { createLogger: () => ({ info() {}, warn() {},
            error(_message, error) { state.lastError = error?.message || String(_message); }, debug() {} }) });
        for (const name of [
            'websocket', 'accountSecurity', 'accountOnboarding', 'costumeInventory',
            'taskPerformancePolicy', 'staffLifecycle', 'hrVacancyPlatformFormatter',
            'hrPayrollPeriod', 'payroll', 'payrollSettlement', 'hrPayrollSchemes', 'hrPayrollProfiles',
            'liveMultiSegmentQa', 'hrStaffDocuments', 'hrStaffMedicalBook', 'hrStaffResources',
            'hrAttendanceDocuments', 'hrAttendanceDocumentsPdf', 'hrAttendanceDocumentAutomation', 'booking'
        ]) {
            installMock(`../services/${name}`, new Proxy({}, { get(_target, key) {
                return () => { sideEffects.push(`${name}.${String(key)}`); throw new Error('Unexpected service call'); };
            } }));
        }
        installMock('../services/taskExecution', {
            listTaskOwnerCandidates: async options => {
                assert.equal(options.businessContext, 'event_genix');
                return [{ id: 91, name: 'Synthetic Mentor', label: PRIVATE, username: PRIVATE,
                    role: PRIVATE, hourly_rate: 999 }];
            }
        });
        installMock('../services/hrOnboarding', {
            ONBOARDING_TASK_SOURCE_TYPE: 'onboarding',
            onboardingProgressMeta: row => ({ ...row, scope: 'general', percent: 100,
                task_summary: { total: 1, active: 0, completed: 1, private: PRIVATE } }),
            attachOnboardingAssignments: async rows => rows
        });
        installMock('../services/professionChecklists', {
            loadProfessionChecklistProgressBatch: async () => ({ byAssignment: {} })
        });
        const { applyMembershipAccess, buildMembershipAccess } = require('../services/businessMembership');
        const actualAuth = require('../middleware/auth');
        const authenticateFixture = (req, res, next) => {
            if (state.actor.unauthenticated) return res.status(401).json({ success: false });
            const context = req.headers['x-business-context'] || 'event_genix';
            const principal = { id: 9101, username: 'synthetic_hr_reader',
                role: state.actor.role || 'director', business_contexts: ['event_genix', 'dar'],
                default_business_context: 'event_genix' };
            const registry = ['event_genix', 'dar'].map((key, index) => ({
                business_id: index + 1,
                organization_id: state.actor.otherOrganization && key === 'event_genix' ? 2 : 1,
                context_key: key, access_mode: state.actor.compatibility && key === 'event_genix'
                    ? 'compatibility' : 'membership', business_status: 'active',
                organization_status: 'active'
            }));
            const memberships = registry.filter(row => !(state.actor.revoked && row.context_key === 'event_genix')
                && !(state.actor.compatibility && row.context_key === 'event_genix'))
                .map(row => ({ ...row,
                    organization_id: state.actor.otherOrganization && row.context_key === 'event_genix'
                        ? 1 : row.organization_id,
                    role: principal.role, organization_role: 'member', business_modules: [],
                    is_default: row.context_key === 'event_genix',
                    action_allowlist: state.actor.allow || [], action_denylist: state.actor.deny || [] }));
            req.user = applyMembershipAccess(principal, buildMembershipAccess(principal, memberships, context, registry));
            if (state.actor.staleBusinessId && req.user.activeBusinessMembership) {
                req.user.activeBusinessMembership = { ...req.user.activeBusinessMembership, businessId: 999 };
            }
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
        async function request(path, options = {}) {
            const response = await fetch(origin + path, { method: options.method || 'GET',
                headers: { 'X-Business-Context': options.context || 'event_genix',
                    'Content-Type': 'application/json' } });
            const body = response.status === 204 ? null : await response.text();
            return { status: response.status, body: body ? JSON.parse(body) : null, text: body };
        }
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

test('Park onboarding uses three exact GET reads and leaves adjacent HR/account writes contained', async t => {
    await withActualHrRouter(async ({ state, calls, request }) => {
        const paths = ['/api/hr/onboarding', '/api/hr/onboarding/templates',
            '/api/hr/onboarding/responsible-candidates'];
        await t.test('current Park viewer gets general progress and minimal templates/owner labels', async () => {
            state.actor = { deny: ['hr.schedule.view', 'hr.payroll.view', 'hr.staff.manage'] };
            const list = await request(paths[0]);
            assert.equal(list.status, 200, state.lastError || list.text);
            assert.equal(list.body.onboardingAccess.partial, true);
            assert.equal(list.body.data[0].staff_id, STAFF_ID);
            assert.equal(list.body.data[0].items[0].title, 'Safe step');
            assert.equal(list.body.data[0].items[0].notes, undefined);
            assert.equal(list.body.data[0].responsible_username, undefined);
            assert.equal(list.text.includes(PRIVATE), false);
            const templates = await request(paths[1]);
            assert.equal(templates.status, 200, templates.text);
            assert.deepEqual(templates.body.data[0], { id: 7, name: 'Park setup', department: 'operations' });
            const candidates = await request(paths[2]);
            assert.equal(candidates.status, 200, candidates.text);
            assert.deepEqual(candidates.body.data[0], { id: 91, name: 'Synthetic Mentor', label: 'Synthetic Mentor' });
            assert.equal(candidates.text.includes(PRIVATE), false);
        });
        await t.test('capability, business, organization, membership and aggregate scope deny before SQL', async () => {
            for (const [actor, context, suffix] of [
                [{ deny: ['hr.staff.view'] }, 'event_genix', ''],
                [{ role: 'security', allow: ['hr.schedule.view'], deny: ['hr.staff.view'] }, 'event_genix', ''],
                [{ role: 'security', allow: ['hr.payroll.view'], deny: ['hr.staff.view'] }, 'event_genix', ''],
                [{}, 'dar', ''], [{ otherOrganization: true }, 'event_genix', ''],
                [{ revoked: true }, 'event_genix', ''],
                [{ compatibility: true }, 'event_genix', ''],
                [{ staleBusinessId: true }, 'event_genix', ''],
                [{}, 'event_genix', '?businessScope=all'],
                [{}, 'event_genix', '?businessScope=multi&businessContexts=event_genix,dar']
            ]) {
                state.actor = actor;
                for (const path of paths) {
                    const before = calls.length;
                    const result = await request(path + suffix, { context });
                    assert.equal(result.status, 403, `${context} ${path}${suffix}`);
                    assert.equal(calls.length, before);
                }
            }
        });
        await t.test('profession and staff-specific joins stay held; no other method inherits the exception', async () => {
            state.actor = {};
            for (const [method, path] of [
                ['GET', '/api/hr/onboarding?scope=profession'],
                ['GET', `/api/hr/staff/${STAFF_ID}/onboarding-assignment`],
                ['GET', `/api/hr/staff/${STAFF_ID}/onboarding-processes`],
                ['GET', '/api/hr/staff/999999/onboarding-processes'],
                ['PUT', `/api/hr/staff/${STAFF_ID}/onboarding-assignment`],
                ['POST', '/api/hr/onboarding/start'], ['POST', '/api/hr/onboarding/templates'],
                ['PUT', '/api/hr/onboarding/41/check'], ['HEAD', '/api/hr/onboarding']
            ]) {
                const before = calls.length;
                assert.equal((await request(path, { method })).status, 403, `${method} ${path}`);
                assert.equal(calls.length, before);
            }
            assert.equal((await request('/api/hr/onboarding?scope=unexpected')).status, 400);
            assert.equal((await request('/api/hr/onboarding?staff_id=bad')).status, 400);
        });
        await t.test('500 is an error response rather than an empty onboarding list', async () => {
            state.actor = {};
            state.failQuery = true;
            const result = await request('/api/hr/onboarding');
            assert.equal(result.status, 500);
            assert.equal(result.body.success, false);
            assert.equal(result.body.data, undefined);
            state.failQuery = false;
        });
        await t.test('unauthenticated request does not query', async () => {
            state.actor = { unauthenticated: true };
            const before = calls.length;
            assert.equal((await request('/api/hr/onboarding')).status, 401);
            assert.equal(calls.length, before);
        });
    });
});
