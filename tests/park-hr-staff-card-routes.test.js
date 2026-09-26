'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const STAFF_ID = 9701;
const PRIVATE = 'SYNTHETIC_PRIVATE_STAFF_FIELD';
const PERSON = {
    id: STAFF_ID, name: 'Synthetic Park Worker', department: 'animators', position: 'Animator',
    phone: '+380000000001', emergency_contact: 'Synthetic Contact', emergency_phone: '+380000000002',
    role_type: 'animator', secondary_professions: ['host'], hire_date: '2024-01-01',
    birth_date: '1990-01-01', address: 'Synthetic address', is_active: true, hourly_rate: 12345,
    rate_unit: 'hour', company_structure_node_id: 1, photo_url: null, notes: 'Synthetic note',
    telegram_id: 'synthetic-id', telegram_username: 'synthetic-user', color: '#22aaaa',
    contract_type: 'parttime', skills: ['hosting'], is_freelance: false, unique_person_key: PRIVATE,
    hr_pool_status: 'core', blacklist_reason: null, blacklisted_at: null,
    termination_date: null, termination_reason: null, termination_recorded_at: null,
    termination_recorded_by: null, has_account: true, has_face_descriptor: true,
    account_user_id: 9001, account_username: PRIVATE, unrelated_secret: PRIVATE
};

async function withActualHrRouter(run) {
    const savedCache = new Map(Object.entries(require.cache));
    const state = { actor: {} };
    const calls = [];
    const sideEffects = [];
    const pool = {
        async connect() { sideEffects.push('connect'); throw new Error('Unexpected write connection'); },
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: normalized, params });
            assert.match(normalized, /^(SELECT|WITH)\b/i, 'staff card recovery may only read');
            let rows = [];
            if (normalized.startsWith('SELECT id, name, department, position, phone, emergency_contact')) {
                if (normalized.includes('FROM staff WHERE id = $1')) {
                    rows = Number(params[0]) === STAFF_ID ? [PERSON] : [];
                } else if (normalized.includes('FROM staff')) {
                    rows = [PERSON];
                }
            } else if (normalized.includes('FROM staff_profession_rates')) {
                rows = [{ staff_id: STAFF_ID, profession_key: 'animator', hourly_rate: 12345,
                    payroll_scheme_id: PRIVATE }];
            } else if (normalized.includes("FROM settings WHERE key = 'hr_company_structure'")) {
                rows = [{ value: { nodes: [] } }];
            } else if (normalized.startsWith('SELECT key, structure_node_id FROM hr_professions')) {
                rows = [];
            }
            return { rows: structuredClone(rows), rowCount: rows.length };
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
        installMock('../utils/logger', { createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) });
        for (const name of [
            'websocket', 'accountSecurity', 'accountOnboarding', 'costumeInventory', 'taskExecution',
            'taskPerformancePolicy', 'staffLifecycle', 'hrVacancyPlatformFormatter',
            'hrPayrollPeriod', 'payroll', 'payrollSettlement', 'hrPayrollSchemes', 'hrPayrollProfiles',
            'liveMultiSegmentQa', 'hrStaffDocuments', 'hrStaffMedicalBook', 'hrStaffResources',
            'hrAttendanceDocuments', 'hrAttendanceDocumentsPdf', 'hrAttendanceDocumentAutomation', 'booking'
        ]) {
            installMock(`../services/${name}`, new Proxy({}, {
                get(_target, key) {
                    return () => {
                        sideEffects.push(`${name}.${String(key)}`);
                        throw new Error(`Unexpected service call: ${name}.${String(key)}`);
                    };
                }
            }));
        }
        installMock('../services/hrOnboarding', {
            attachOnboardingAssignments: async rows => rows
        });
        installMock('../services/professionChecklists', {
            loadProfessionChecklistProgressBatch: async () => ({ byAssignment: {} })
        });
        const { applyMembershipAccess, buildMembershipAccess } = require('../services/businessMembership');
        const actualAuth = require('../middleware/auth');
        const authenticateFixture = (req, res, next) => {
            if (state.actor.unauthenticated) return res.status(401).json({ success: false, code: 'auth_required' });
            const context = req.headers['x-business-context'] || 'event_genix';
            const principal = { id: 9101, username: 'synthetic_staff_reader', role: state.actor.role || 'director',
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
            const response = await fetch(origin + path, {
                method: options.method || 'GET',
                headers: { 'X-Business-Context': options.context || 'event_genix', 'Content-Type': 'application/json' }
            });
            const text = await response.text();
            return { status: response.status, body: text ? JSON.parse(text) : null, text };
        }
        await run({ state, calls, request });
        assert.deepEqual(sideEffects, [], 'no write, payroll, account or document service was called');
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        for (const id of Object.keys(require.cache)) if (!savedCache.has(id)) delete require.cache[id];
        for (const [id, cached] of savedCache) require.cache[id] = cached;
    }
}

test('Park HR staff list and base detail use exact GET and membership boundaries on the real Express router', async t => {
    await withActualHrRouter(async ({ state, calls, request }) => {
        await t.test('current Park staff viewer receives a minimal list and permitted detail', async () => {
            state.actor = { deny: ['hr.schedule.view', 'hr.payroll.view'] };
            const list = await request('/api/hr/staff');
            assert.equal(list.status, 200, list.text);
            assert.equal(list.body.data.length, 1);
            assert.equal(list.body.data[0].id, STAFF_ID);
            assert.equal(list.body.data[0].phone, PERSON.phone);
            assert.equal(list.body.data[0].hourly_rate, undefined);
            assert.equal(list.body.data[0].address, undefined);
            assert.equal(list.body.data[0].emergency_contact, undefined);
            assert.equal(list.body.data[0].account_user_id, undefined);
            assert.equal(list.text.includes(PRIVATE), false);
            assert.equal((await request('/api/hr/company-structure')).status, 403);
            const detail = await request(`/api/hr/staff/${STAFF_ID}`);
            assert.equal(detail.status, 200, detail.text);
            assert.equal(detail.body.data.name, PERSON.name);
            assert.equal(detail.body.data.address, PERSON.address);
            assert.equal(detail.body.data.emergency_contact, PERSON.emergency_contact);
            assert.equal(detail.body.data.hourly_rate, undefined);
            assert.equal(detail.body.data.profession_rates, undefined);
            assert.equal(detail.text.includes(PRIVATE), false);
        });

        await t.test('payroll data still requires its separate capability and nested rates are projected', async () => {
            state.actor = {};
            const detail = await request(`/api/hr/staff/${STAFF_ID}`);
            assert.equal(detail.status, 200, detail.text);
            assert.equal(detail.body.data.hourly_rate, 12345);
            assert.deepEqual(detail.body.data.profession_rates,
                [{ profession_key: 'animator', hourly_rate: 12345 }]);
            assert.equal(detail.text.includes(PRIVATE), false);
            const list = await request('/api/hr/staff');
            assert.equal(list.body.data[0].hourly_rate, undefined);
        });

        await t.test('missing staff ID is 404 after authorization', async () => {
            state.actor = {};
            const response = await request('/api/hr/staff/999999');
            assert.equal(response.status, 404);
            assert.equal(response.body.success, false);
        });

        await t.test('missing staff capability, including schedule-only and payroll-only, cannot query staff', async () => {
            for (const actor of [
                { deny: ['hr.staff.view'] },
                { role: 'security', allow: ['hr.schedule.view'], deny: ['hr.staff.view'] },
                { role: 'security', allow: ['hr.payroll.view'], deny: ['hr.staff.view'] }
            ]) {
                state.actor = actor;
                for (const path of ['/api/hr/staff', `/api/hr/staff/${STAFF_ID}`]) {
                    const count = calls.length;
                    assert.equal((await request(path)).status, 403, path);
                    assert.equal(calls.length, count, path);
                }
            }
        });

        await t.test('foreign business, different organization, revoked, compatibility or inactive membership are denied before SQL', async () => {
            for (const [actor, context] of [
                [{}, 'dar'], [{}, 'crm'], [{ otherOrganization: true }, 'event_genix'],
                [{ revoked: true }, 'event_genix'], [{ compatibility: true }, 'event_genix'],
                [{ staleActiveBusinessId: true }, 'event_genix'],
                [{ inactive: true }, 'event_genix'],
                [{ inactiveOrganization: true }, 'event_genix']
            ]) {
                state.actor = actor;
                for (const path of ['/api/hr/staff', `/api/hr/staff/${STAFF_ID}`]) {
                    const count = calls.length;
                    assert.equal((await request(path, { context })).status, 403, `${context} ${path}`);
                    assert.equal(calls.length, count, `${context} ${path}`);
                }
            }
        });

        await t.test('all, multi and conflicting selectors cannot widen Park reads', async () => {
            state.actor = {};
            for (const suffix of ['businessScope=all', 'businessScope=multi&businessContexts=event_genix,dar',
                'business_context=dar']) {
                for (const path of ['/api/hr/staff', `/api/hr/staff/${STAFF_ID}`]) {
                    const count = calls.length;
                    assert.equal((await request(`${path}?${suffix}`)).status, 403, `${path}?${suffix}`);
                    assert.equal(calls.length, count);
                }
            }
        });

        await t.test('no child route, write method, company structure or HEAD inherits the card exception', async () => {
            state.actor = {};
            for (const [method, path] of [
                ['GET', `/api/hr/staff/${STAFF_ID}/documents`],
                ['GET', `/api/hr/staff/${STAFF_ID}/medical-book`],
                ['GET', `/api/hr/staff/${STAFF_ID}/resources`],
                ['GET', `/api/hr/staff/${STAFF_ID}/role-assignments`],
                ['GET', `/api/hr/staff/${STAFF_ID}/lifecycle-checklist`],
                ['GET', `/api/hr/staff/${STAFF_ID}/offboarding`],
                ['GET', `/api/hr/staff/${STAFF_ID}/history`],
                ['GET', '/api/hr/company-structure'], ['POST', '/api/hr/staff'],
                ['PUT', `/api/hr/staff/${STAFF_ID}`], ['HEAD', '/api/hr/staff'],
                ['HEAD', `/api/hr/staff/${STAFF_ID}`]
            ]) {
                const count = calls.length;
                const response = await request(path, { method });
                assert.equal(response.status, 403, `${method} ${path}`);
                assert.equal(calls.length, count, `${method} ${path}`);
            }
        });

        await t.test('unauthenticated requests stop before any query', async () => {
            state.actor = { unauthenticated: true };
            const count = calls.length;
            assert.equal((await request('/api/hr/staff')).status, 401);
            assert.equal((await request(`/api/hr/staff/${STAFF_ID}`)).status, 401);
            assert.equal(calls.length, count);
        });
    });
});
