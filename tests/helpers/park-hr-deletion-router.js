'use strict';

const assert = require('node:assert/strict');
const express = require('express');

async function withDeletionRouter(run, database = null, { realServices = [] } = {}) {
    const saved = new Map(Object.entries(require.cache));
    const state = { actor: {}, missing: false, counts: {}, outstanding: { count: 0, amount: 0 } };
    const calls = [];
    const unexpected = [];
    const person = { id: 9701, name: 'Synthetic Duplicate', department: 'admin', position: 'QA',
        role_type: 'manager', is_active: true, hr_pool_status: 'core', created_at: '2026-01-01' };
    async function query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        calls.push(normalized);
        if (state.beforeSql) await state.beforeSql(normalized);
        if (state.failSql && normalized.includes(state.failSql)) throw new Error('Synthetic database failure');
        if (database) return this.query(sql, params);
        if (normalized.startsWith('SELECT id, name, department, position, role_type')) return { rows: state.missing ? [] : [person] };
        if (normalized.startsWith('SELECT to_regclass')) return { rows: [{ rel: params[0] }] };
        if (normalized.includes('FROM pg_constraint')) return { rows: state.references || [] };
        if (normalized.startsWith('SELECT COUNT')) {
            const table = /FROM (\S+)/.exec(normalized)[1];
            return { rows: [{ count: state.counts[table] || 0 }] };
        }
        if (normalized.startsWith('DELETE FROM staff')) return { rows: [{ id: person.id, name: person.name }] };
        if (/^(BEGIN|COMMIT|ROLLBACK|UPDATE hr_audit_log|INSERT INTO hr_audit_log)/.test(normalized)) return { rows: [] };
        unexpected.push(normalized);
        throw new Error('Unexpected SQL');
    }
    const pool = {
        query: query.bind(database),
        async connect() {
            calls.push('CONNECT');
            if (state.failConnect) throw new Error('Synthetic connection failure');
            const client = database ? await database.connect() : null;
            return { query: query.bind(client), release() { client?.release(); } };
        }
    };
    function mock(modulePath, exports) {
        const id = require.resolve(modulePath);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    let server;
    try {
        for (const name of ['../../routes/hr', '../../middleware/auth']) delete require.cache[require.resolve(name)];
        mock('../../db', { pool });
        mock('../../utils/logger', { createLogger: () => ({ info() {}, warn() {}, error(message, error) { state.lastError = error?.message || message; }, debug() {} }) });
        for (const name of ['websocket', 'accountSecurity', 'accountOnboarding', 'costumeInventory', 'taskExecution',
            'taskPerformancePolicy', 'staffLifecycle', 'hrVacancyPlatformFormatter', 'hrPayrollPeriod', 'payroll',
            'hrPayrollSchemes', 'hrPayrollProfiles', 'liveMultiSegmentQa', 'hrStaffDocuments', 'hrStaffMedicalBook',
            'hrStaffResources', 'hrAttendanceDocuments', 'hrAttendanceDocumentsPdf', 'hrAttendanceDocumentAutomation']) {
            if (realServices.includes(name)) { delete require.cache[require.resolve(`../../services/${name}`)]; continue; }
            mock(`../../services/${name}`, new Proxy({}, { get: (_target, key) => () => {
                unexpected.push(`${name}.${String(key)}`);
                throw new Error('Unexpected service call');
            } }));
        }
        mock('../../services/booking', { getKyivDateStr: () => '2026-11-13' });
        mock('../../services/payrollSettlement', {
            loadStaffOutstandingPayrollInstallments: async () => state.outstanding
        });
        const { applyMembershipAccess, buildMembershipAccess } = require('../../services/businessMembership');
        const actualAuth = require('../../middleware/auth');
        const authenticate = (req, res, next) => {
            if (state.actor.unauthenticated) return res.status(401).json({ success: false });
            const context = req.headers['x-business-context'] || 'event_genix';
            const principal = { id: 9101, username: 'synthetic_deletion_manager', role: state.actor.role || 'director',
                business_contexts: ['event_genix', 'dar'], default_business_context: 'event_genix' };
            const registry = ['event_genix', 'dar'].map((key, index) => ({ business_id: index + 1,
                organization_id: index + 1, context_key: key, access_mode: 'membership',
                business_status: state.actor.inactive ? 'inactive' : 'active',
                organization_status: state.actor.inactiveOrganization ? 'inactive' : 'active' }));
            const memberships = registry.filter(row => !state.actor.revoked || row.context_key !== 'event_genix')
                .map(row => ({ ...row, role: principal.role, organization_role: 'member', business_modules: [],
                    is_default: row.context_key === 'event_genix', action_allowlist: state.actor.allow || [],
                    action_denylist: state.actor.deny || [] }));
            req.user = applyMembershipAccess(principal, buildMembershipAccess(principal, memberships, context, registry));
            if (state.actor.stale && req.user.activeBusinessMembership) req.user.activeBusinessMembership.businessId = 999;
            next();
        };
        mock('../../middleware/auth', { ...actualAuth, authenticateToken: authenticate });
        const app = express();
        app.use(express.json());
        app.use('/api/hr', authenticate, require('../../routes/hr'));
        server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
        const origin = `http://127.0.0.1:${server.address().port}`;
        async function request(path, { method = 'GET', body, context = 'event_genix', headers = {} } = {}) {
            const res = await fetch(origin + '/api/hr' + path, { method,
                headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
                    'X-Business-Context': context, ...headers },
                ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
            const text = await res.text();
            return { status: res.status, headers: res.headers, body: text && res.headers.get('content-type')?.includes('application/json')
                ? JSON.parse(text) : text || null };
        }
        await run({ state, calls, request, origin });
        assert.deepEqual(unexpected, []);
    } finally {
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        for (const id of Object.keys(require.cache)) if (!saved.has(id)) delete require.cache[id];
        for (const [id, value] of saved) require.cache[id] = value;
    }
}

module.exports = { withDeletionRouter };
