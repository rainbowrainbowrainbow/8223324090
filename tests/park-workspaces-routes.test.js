'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const ACTOR_ID = 9701;
const CERTIFICATE_INPUT = {
    displayMode: 'fio', displayValue: '  Synthetic Park Recipient  ',
    typeText: 'Synthetic admission', validUntil: '2099-10-29', notes: 'Synthetic fixture', season: 'autumn'
};
const READ_PATHS = ['/api/certificates', '/api/art-director/overview', '/api/art-director/templates'];

function createDatabaseFixture() {
    const calls = [];
    const events = [];
    const rows = [];
    let connections = 0;
    let released = 0;
    let transaction = false;
    const pool = {
        async connect() { connections++; return client; },
        async query(sql, params = []) {
            const query = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ sql: query, params });
            let result = [];
            if (query === 'BEGIN') {
                assert.equal(transaction, false);
                transaction = true;
            } else if (query === 'COMMIT' || query === 'ROLLBACK') {
                assert.equal(transaction, true);
                transaction = false;
            } else if (query.startsWith('SELECT id FROM certificates WHERE')) {
                result = rows.filter(row => row.display_value.toLowerCase() === params[0].toLowerCase());
            } else if (query.includes("FROM settings WHERE key = 'cert_default_days'")) {
                result = [{ value: '45' }];
            } else if (query.startsWith('INSERT INTO certificates ')) {
                assert.equal(transaction, true, 'certificate persistence belongs to its transaction');
                const [cert_code, display_mode, display_value, type_text, valid_until,
                    issued_by_user_id, issued_by_name, notes, season] = params;
                const row = { id: 9800 + rows.length, cert_code, display_mode, display_value, type_text,
                    valid_until, issued_by_user_id, issued_by_name, notes, season, status: 'active',
                    issue_source: 'single', batch_group_id: null, issued_at: '2099-09-14T10:00:00.000Z' };
                rows.push(row);
                result = [row];
            } else if (query.startsWith('INSERT INTO history ')) {
                assert.equal(transaction, true, 'history is atomic with certificate persistence');
                assert.equal(params[0], 'event_genix');
                assert.equal(params[1], 'certificate_create');
                assert.equal(JSON.parse(params[3]).business_context, 'event_genix');
            } else if (query === 'SELECT COUNT(*) FROM certificates') {
                result = [{ count: String(rows.length) }];
            } else if (query.startsWith('SELECT status, COUNT(*)::int AS count FROM certificates')) {
                result = rows.length ? [{ status: 'active', count: rows.length }] : [];
            } else if (query.startsWith('SELECT issue_source, COUNT(*)::int AS count FROM certificates')) {
                result = rows.length ? [{ issue_source: 'single', count: rows.length }] : [];
            } else if (query.startsWith('SELECT * FROM certificates ORDER BY')) {
                result = rows;
            } else if (query === 'SELECT status, COUNT(*) AS count FROM content_items GROUP BY status') {
                result = [{ status: 'draft', count: '2' }, { status: 'approved', count: '1' }];
            } else if (query === 'SELECT COUNT(*) FROM content_templates WHERE is_active = true') {
                result = [{ count: '1' }];
            } else if (query === 'SELECT COUNT(*) FROM brand_guidelines WHERE is_active = true') {
                result = [{ count: '3' }];
            } else if (query.startsWith('SELECT c.*, ct.name AS template_name FROM content_items c')) {
                result = [{ id: 9901, title: 'Synthetic Art Material', template_name: 'Synthetic Template' }];
            } else if (query.startsWith('SELECT COUNT(*) FROM content_items WHERE')) {
                assert.match(params[0], /^\d{4}-\d{2}-\d{2}$/);
                result = [{ count: '1' }];
            } else if (query.startsWith('SELECT * FROM content_templates WHERE is_active = true')) {
                result = [{ id: 9902, code: 'SYNTHETIC_TEMPLATE', name: 'Synthetic Template' }];
            } else {
                throw new Error(`Unexpected Park workspace query: ${query}`);
            }
            return { rows: structuredClone(result), rowCount: result.length };
        }
    };
    const client = { query: pool.query.bind(pool), release() { released++; } };
    return { pool, calls, events, rows, get connections() { return connections; },
        get released() { return released; }, get transaction() { return transaction; } };
}

async function withActualRouters(run) {
    const savedCache = new Map(Object.entries(require.cache));
    const fixture = createDatabaseFixture();
    const state = { actor: {} };
    const forbiddenCalls = [];
    let server;
    function installMock(modulePath, exports) {
        const id = require.resolve(modulePath);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    try {
        for (const modulePath of ['../middleware/auth', '../routes/certificates', '../routes/art-director', '../services/legacyBusinessSurface']) {
            delete require.cache[require.resolve(modulePath)];
        }
        installMock('../db', { pool: fixture.pool, async generateCertCode(db) {
            assert.ok(db.query);
            assert.equal(fixture.transaction, true);
            return `CERT-2099-${String(fixture.rows.length + 1).padStart(5, '0')}`;
        } });
        installMock('../utils/logger', { createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) });
        for (const name of ['telegram', 'templates', 'costumeInventory']) {
            installMock(`../services/${name}`, new Proxy({}, { get(_target, key) {
                return () => { forbiddenCalls.push(`${name}.${String(key)}`); throw new Error('Unexpected external service'); };
            } }));
        }
        installMock('../services/eventBus', { publish(name, payload, key) {
            assert.equal(fixture.transaction, false, 'the created event is published only after commit');
            fixture.events.push({ name, payload, key });
            return Promise.resolve();
        } });
        const { applyMembershipAccess, buildMembershipAccess } = require('../services/businessMembership');
        const actualAuth = require('../middleware/auth');
        const authenticateFixture = (req, res, next) => {
            if (state.actor.unauthenticated) return res.status(401).json({ success: false, code: 'auth_required' });
            const context = req.headers['x-business-context'] || 'event_genix';
            const principal = { id: ACTOR_ID, username: 'synthetic_workspace_operator', role: state.actor.role || 'senior_manager',
                business_contexts: ['event_genix', 'dar', 'crm', 'maysternya_doli'], default_business_context: 'event_genix' };
            const registry = principal.business_contexts.map((key, index) => ({
                business_id: index + 1, organization_id: 1, context_key: key, access_mode: 'membership',
                business_status: state.actor.inactive && key === 'event_genix' ? 'inactive' : 'active',
                organization_status: 'active'
            }));
            const memberships = registry.filter(row => !(state.actor.revoked && row.context_key === 'event_genix'))
                .map(row => ({ ...row, role: principal.role, organization_role: 'member', business_modules: [],
                    is_default: row.context_key === 'event_genix',
                    page_allowlist: state.actor.allowPages || [], page_denylist: state.actor.denyPages || [] }));
            req.user = applyMembershipAccess(principal, buildMembershipAccess(principal, memberships, context, registry));
            next();
        };
        installMock('../middleware/auth', { ...actualAuth, authenticateToken: authenticateFixture });
        const app = express();
        app.use(express.json());
        app.use('/api/certificates', require('../routes/certificates'));
        app.use('/api/art-director', authenticateFixture, require('../routes/art-director'));
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
        await run({ fixture, state, request });
        assert.deepEqual(forbiddenCalls, [], 'no notification, provider or costume service is called');
        assert.equal(fixture.connections, fixture.released, 'all database connections were released');
        assert.equal(fixture.transaction, false);
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        for (const id of Object.keys(require.cache)) if (!savedCache.has(id)) delete require.cache[id];
        for (const [id, cached] of savedCache) require.cache[id] = cached;
    }
}

test('Park certificate and Art recovery through actual Express routers', async t => {
    await withActualRouters(async ({ fixture, state, request }) => {
        await t.test('senior manager and art director can issue a certificate, with committed history and readable result', async () => {
            for (const role of ['senior_manager', 'art_director']) {
                state.actor = { role };
                const result = await request('/api/certificates', { method: 'POST',
                    body: { ...CERTIFICATE_INPUT, displayValue: `  Synthetic ${role} Recipient  ` } });
                assert.equal(result.status, 201, result.text);
                assert.equal(result.body.displayValue, `Synthetic ${role} Recipient`);
                assert.equal(result.body.issuedByUserId, ACTOR_ID);
                assert.equal(result.body.issueSource, 'single');
                assert.equal(result.body.validUntil, '2099-10-29');
                assert.equal(result.body.status, 'active');
                assert.equal(fixture.transaction, false);
                const event = fixture.events.at(-1);
                assert.equal(event.name, 'certificate.created');
                assert.equal(event.payload.cert_id, result.body.id);
                assert.equal(event.payload.cert_code, result.body.certCode);
                const list = await request('/api/certificates');
                assert.equal(list.status, 200, list.text);
                assert.ok(list.body.items.some(item => item.id === result.body.id));
            }
            assert.equal(fixture.calls.filter(call => call.sql.startsWith('INSERT INTO history ')).length, 2);
            assert.equal(fixture.calls.filter(call => call.sql === 'COMMIT').length, 2);
        });

        await t.test('Art overview and templates return the real handler payload for both affected roles', async () => {
            for (const role of ['senior_manager', 'art_director']) {
                state.actor = { role };
                const overview = await request('/api/art-director/overview');
                assert.equal(overview.status, 200, overview.text);
                assert.equal(overview.body.success, true);
                assert.equal(overview.body.pipeline.draft, 2);
                assert.equal(overview.body.pipeline.approved, 1);
                assert.equal(overview.body.templateCount, 1);
                assert.equal(overview.body.brandCount, 3);
                assert.equal(overview.body.urgentCount, 1);
                assert.equal(overview.body.recentItems[0].id, 9901);
                const templates = await request('/api/art-director/templates');
                assert.equal(templates.status, 200, templates.text);
                assert.equal(templates.body.templates[0].code, 'SYNTHETIC_TEMPLATE');
            }
        });

        await t.test('another business, revoked or inactive Park cannot read or issue before any database access', async () => {
            const cases = [{ context: 'dar' }, { context: 'crm' }, { context: 'maysternya_doli' },
                { actor: { revoked: true } }, { actor: { inactive: true } }];
            for (const item of cases) {
                state.actor = item.actor || {};
                const calls = fixture.calls.length;
                const connections = fixture.connections;
                for (const path of READ_PATHS) {
                    const result = await request(path, item);
                    assert.equal(result.status, 403, `${path}: ${result.text}`);
                }
                for (const path of ['/api/certificates', '/api/certificates/batch']) {
                    const result = await request(path, { ...item, method: 'POST', body: CERTIFICATE_INPUT });
                    assert.equal(result.status, 403, `${path}: ${result.text}`);
                }
                assert.equal(fixture.calls.length, calls);
                assert.equal(fixture.connections, connections);
            }
        });

        await t.test('explicit page denies close issuance and Art reads before any database access', async () => {
            for (const item of [
                { deny: '/certificates/new', path: '/api/certificates', method: 'POST' },
                { deny: '/certificates/batch', path: '/api/certificates/batch', method: 'POST' },
                { deny: '/certificates', path: '/api/certificates', method: 'GET' },
                { deny: '/art', path: '/api/art-director/overview', method: 'GET' }
            ]) {
                state.actor = { denyPages: [item.deny] };
                const calls = fixture.calls.length;
                const connections = fixture.connections;
                const result = await request(item.path, { method: item.method, body: item.method === 'POST' ? CERTIFICATE_INPUT : null });
                assert.equal(result.status, 403, `${item.deny}: ${result.text}`);
                assert.equal(fixture.calls.length, calls);
                assert.equal(fixture.connections, connections);
            }
        });

        await t.test('page permission alone does not grant the existing certificate issuer role', async () => {
            state.actor = { role: 'cleaning', allowPages: ['/certificates', '/certificates/new', '/certificates/batch'] };
            const calls = fixture.calls.length;
            const connections = fixture.connections;
            for (const path of ['/api/certificates', '/api/certificates/batch']) {
                const result = await request(path, { method: 'POST', body: CERTIFICATE_INPUT });
                assert.equal(result.status, 403, result.text);
                assert.equal(result.body.error, 'Insufficient permissions');
            }
            assert.equal(fixture.calls.length, calls);
            assert.equal(fixture.connections, connections);
        });

        await t.test('aggregate and conflicting selectors cannot widen the recovered workspace', async () => {
            state.actor = {};
            const calls = fixture.calls.length;
            const connections = fixture.connections;
            for (const query of ['businessScope=all', 'businessScope=multi&businessContexts=event_genix,dar', 'business_context=dar']) {
                for (const path of READ_PATHS) {
                    const result = await request(`${path}?${query}`);
                    assert.equal(result.status, 403, `${path}?${query}: ${result.text}`);
                }
            }
            assert.equal(fixture.calls.length, calls);
            assert.equal(fixture.connections, connections);
        });
    });
});
