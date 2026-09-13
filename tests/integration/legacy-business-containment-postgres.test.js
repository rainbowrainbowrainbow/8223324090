'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { test } = require('node:test');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');

const localSocket = process.env.BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST === '1';
const fixtureUrl = process.env.BUSINESS_MEMBERSHIP_TEST_DATABASE_URL;
function localConnection() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    if (localSocket) {
        assert.equal(process.platform, 'linux');
        return { host: '/var/run/postgresql', user: 'postgres', database: 'postgres' };
    }
    const url = new URL(fixtureUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.match(url.pathname, /(?:^|[_-])(test|testing|ci|disposable)(?:[_-]|$)/i);
    assert.doesNotMatch(url.pathname, /(?:^|[_-])(prod|production|live)(?:[_-]|$)/i);
    assert.notEqual(fixtureUrl, process.env.DATABASE_URL);
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)), ssl: false };
}

const CATALOG_CASES = [
    ['GET', '/definitions'], ['HEAD', '/definitions'], ['POST', '/definitions'],
    ['POST', '/definitions/fixture/subcategories'], ['GET', '/items'], ['HEAD', '/items'], ['GET', '/items/999999'],
    ['POST', '/items'], ['PATCH', '/items/999999'], ['DELETE', '/items/999999'], ['POST', '/items/999999/restore'],
    ['POST', '/generate-image'], ['GET', '/generate-image/fixture-job'], ['POST', '/generate-image-from-ref'],
    ['POST', '/batch-generate'], ['POST', '/apply-image'], ['GET', '/kie-balance'],
    ['POST', '/fixture/generate-cover'], ['POST', '/fixture/apply-cover'], ['POST', '/items/999999/telegram'],
    ['POST', '/suggest-price'], ['POST', '/publish'], ['GET', '/demand-stats'], ['GET', '/trends-history'], ['GET', '/settings/fixture'],
    ['HEAD', '/settings/fixture'], ['PUT', '/settings/fixture'], ['POST', '/analyze-trends'], ['PATCH', '/trend/999999'],
    ['PUT', '/fixture'], ['DELETE', '/fixture'], ['GET', '/fixture/pages'], ['POST', '/fixture/pages'],
    ['PUT', '/fixture/pages/999999'], ['DELETE', '/fixture/pages/999999'], ['POST', '/fixture/reorder'],
    ['POST', '/fixture/public-link'], ['POST', '/fixture/pages/999999/duplicate'], ['GET', '/fixture/automations'],
    ['POST', '/fixture/automations'], ['POST', '/fixture/automations/999999/run'], ['DELETE', '/fixture/automations/999999'],
    ['POST', '/fixture/bulk-generate-images'], ['GET', '/fixture/pages/999999/history']
];
const TEMPLATE_CASES = [['GET', ''], ['HEAD', ''], ['POST', ''], ['PUT', '/999999'], ['POST', '/999999/use'], ['DELETE', '/999999']];
const RECURRING_CASES = [['GET', ''], ['HEAD', ''], ['POST', ''], ['PUT', '/999999'], ['DELETE', '/999999'],
    ['POST', '/999999/pause'], ['POST', '/999999/generate'], ['POST', '/generate-all'],
    ['GET', '/999999/series'], ['DELETE', '/999999/series/future'], ['GET', '/999999/skips'],
    ['POST', '/999999/skips'], ['DELETE', '/skips/999999']];
const SURFACES = [
    { prefix: '/api/catalogs', code: 'catalogs_not_migrated', cases: CATALOG_CASES },
    { prefix: '/api/booking-templates', code: 'booking_templates_not_migrated', cases: TEMPLATE_CASES },
    { prefix: '/api/recurring', code: 'recurring_not_migrated', cases: RECURRING_CASES },
    { prefix: '/api/finance', code: 'finance_salary_not_migrated', cases: [
        ['GET', '/report/salary?month=2026-09'], ['HEAD', '/report/salary?month=2026-09'], ['GET', '/report/salary?month=invalid']
    ] }
];

test('legacy global-surface containment with actual HTTP, fresh membership auth and disposable PostgreSQL', {
    skip: !localSocket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const originalFetch = global.fetch;
    const originalHttpsRequest = https.request;
    const previous = new Map();
    const deniedCalls = [];
    const helperCalls = [];
    let denyDomain = false;
    let pool;
    let server;
    let created = false;
    let requestCount = 0;
    function replace(name, exports) {
        const id = require.resolve(name);
        if (!previous.has(id)) previous.set(id, require.cache[id]);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    function forbidden(name) {
        return () => { deniedCalls.push(name); throw new Error('Fixture blocked a domain side effect: ' + name); };
    }
    function trappedModule(name) {
        return new Proxy({}, { get: (_target, key) => forbidden(name + '.' + String(key)) });
    }
    function isAuthQuery(sql) {
        const text = String(typeof sql === 'string' ? sql : sql?.text).replace(/\s+/g, ' ').trim();
        return /^SELECT is_active, session_revoked_at FROM users WHERE id = \$1$/.test(text)
            || /^SELECT id, username, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context, name, telegram_chat_id, is_active FROM users WHERE id = \$1$/.test(text)
            || /^SELECT staff_id FROM employee_profiles WHERE user_id = \$1 AND COALESCE\(is_active, true\) IS TRUE AND staff_id IS NOT NULL$/.test(text)
            || text.startsWith('SELECT om.organization_id, o.slug AS organization_slug,')
            || text.startsWith('SELECT b.id AS business_id, b.organization_id, b.context_key, b.access_mode,')
            || /^UPDATE employee_profiles SET last_activity_at = NOW\(\) WHERE user_id = \$1$/.test(text)
            || /^UPDATE users SET last_seen_at = NOW\(\) WHERE id = \$1$/.test(text);
    }
    global.fetch = async (url, options) => {
        assert.equal(new URL(url).hostname, '127.0.0.1', 'Fixture allows loopback HTTP only');
        return originalFetch(url, options);
    };
    https.request = forbidden('https.request');
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 8, connectionTimeoutMillis: 5000 });
        await pool.query(`
            CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'animator', extra_roles TEXT[] NOT NULL DEFAULT '{}',
                page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
                action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
                business_contexts TEXT[] NOT NULL DEFAULT '{event_genix}', default_business_context TEXT,
                telegram_chat_id TEXT, is_active BOOLEAN NOT NULL DEFAULT true, session_revoked_at TIMESTAMPTZ,
                last_seen_at TIMESTAMPTZ);
            CREATE TABLE employee_profiles (user_id INT REFERENCES users(id), staff_id INT,
                is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE recurring_templates (id INT PRIMARY KEY, is_active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE finance_categories (id INT PRIMARY KEY, business_context TEXT NOT NULL,
                name TEXT, type TEXT, is_active BOOLEAN DEFAULT true, sort_order INT);
        `);
        for (const name of ['357_organizations_business_memberships.sql', '075_booking_templates.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', name), 'utf8'));
        }
        const catalogSchema = fs.readFileSync(path.join(__dirname, '../../db/migrations/093_catalogs.sql'), 'utf8').split('-- Seed:')[0];
        await pool.query(catalogSchema);
        await pool.query(`
            ALTER TABLE booking_templates ADD COLUMN room_resource_id TEXT;
            INSERT INTO organizations(id,slug,name) VALUES (1,'fixture-containment-own','Own'),(2,'fixture-containment-foreign','Other');
            INSERT INTO businesses(id,organization_id,context_key,label,short_label,access_mode,modules) VALUES
                (1,1,'event_genix','Park','Park','compatibility','[]'),(2,1,'dar','Dar','Dar','membership','["finance"]'),
                (3,1,'fixture_custom','Custom','Custom','membership','[]'),(4,2,'fixture_foreign','Other','Other','membership','[]');
            INSERT INTO users(id,username,name,role,business_contexts,default_business_context) VALUES
                (1,'containment_member','Member','director','{event_genix,dar,fixture_custom,crm,maysternya_doli}','dar'),
                (2,'containment_legacy','Legacy','director','{event_genix}','event_genix'),
                (3,'containment_crm','CRM','director','{crm}','crm'),
                (4,'containment_md','MD','director','{maysternya_doli}','maysternya_doli'),
                (5,'containment_animator','Animator','animator','{event_genix}','event_genix'),
                (6,'containment_legacy_dar','Legacy Dar','director','{dar}','dar');
            INSERT INTO organization_memberships(organization_id,user_id,role) VALUES (1,1,'member');
            INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default) VALUES
                (1,1,1,'director',false),(2,1,1,'director',true),(3,1,1,'director',false);
            INSERT INTO catalog_definitions(id,name) VALUES ('fixture','Synthetic catalog');
            INSERT INTO catalog_items(id,catalog_id,name) VALUES (1,'fixture','Synthetic item');
            INSERT INTO booking_templates(name,notes) VALUES ('Synthetic preset','Fixture-only');
        `);
        replace('../../db', { pool: {
            query(sql, params) {
                if (denyDomain && !isAuthQuery(sql)) return Promise.reject(forbidden('domain SQL')());
                return pool.query(sql, params);
            },
            connect() {
                if (denyDomain) return Promise.reject(forbidden('domain connection')());
                return pool.connect();
            }
        } });
        for (const name of ['imageStorage', 'ai-config', 'recurring', 'booking', 'historyLog', 'timelineResources',
            'bookingCancellationGuard', 'admissionTickets', 'kleshnya', 'eventBus', 'telegram']) {
            replace('../../services/' + name, trappedModule(name));
        }
        replace('../../services/payroll', { async getSalaryReport(month) {
            if (denyDomain) return forbidden('getSalaryReport')();
            helperCalls.push('getSalaryReport');
            return { fixture: true, month, staff: [] };
        } });
        const auth = require('../../middleware/auth');
        const { businessScopeWriteGuard } = require('../../middleware/businessScopeGuard');
        const app = express();
        app.use(express.json());
        app.use('/api', auth.authenticateToken, businessScopeWriteGuard);
        app.use('/api/catalogs', require('../../routes/catalogs'));
        app.use('/api/booking-templates', require('../../routes/booking-templates'));
        app.use('/api/recurring', require('../../routes/recurring'));
        app.use('/api/finance', require('../../routes/finance'));
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const actors = { member: [1, 'containment_member'], legacy: [2, 'containment_legacy'], crm: [3, 'containment_crm'],
            md: [4, 'containment_md'], animator: [5, 'containment_animator'], legacyDar: [6, 'containment_legacy_dar'] };
        const tokens = Object.fromEntries(Object.entries(actors).map(([key, [id, username]]) =>
            [key, jwt.sign({ id, username, role: 'creator' }, auth.JWT_SECRET, { expiresIn: '1h' })]));
        async function request(actor, method, route, context = 'dar', body, placement = 'header', extraHeaders = {}) {
            requestCount++;
            let target = route;
            const headers = { 'Content-Type': 'application/json', Connection: 'close', ...extraHeaders };
            if (actor) headers.Authorization = 'Bearer ' + (tokens[actor] || 'invalid-fixture-token');
            if (context != null) {
                if (placement === 'header') headers['X-Business-Context'] = context;
                if (placement === 'query') target += (target.includes('?') ? '&' : '?') + 'businessContext=' + encodeURIComponent(context);
                if (placement === 'body') body = { ...(body || {}), businessContext: context };
            }
            const response = await fetch(base + target, { method, headers, signal: AbortSignal.timeout(10000),
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
            const text = await response.text();
            return { status: response.status, body: text ? JSON.parse(text) : null };
        }
        async function denied(run) {
            const before = deniedCalls.length;
            const beforeHelpers = helperCalls.length;
            denyDomain = true;
            try { await run(); }
            finally { denyDomain = false; }
            assert.equal(deniedCalls.length, before, 'Denied request crossed a domain/provider/generation boundary');
            assert.equal(helperCalls.length, beforeHelpers, 'Denied request invoked a helper');
        }
        async function matrix(actor, context, cases = SURFACES) {
            await denied(async () => {
                for (const surface of cases) {
                    for (const [method, suffix] of surface.cases) {
                        const body = ['POST', 'PUT', 'PATCH'].includes(method) ? { name: 'Must never persist', room: 'Must never resolve' } : undefined;
                        const result = await request(actor, method, surface.prefix + suffix, context, body);
                        assert.equal(result.status, 403, `${actor} ${context} ${method} ${surface.prefix + suffix}: ${JSON.stringify(result.body)}`);
                        if (method !== 'HEAD') assert.equal(result.body.code, surface.code);
                    }
                }
            });
        }

        await t.test('pre-cutover Park preserves legacy payloads and original role checks', async () => {
            const items = await request('legacy', 'GET', '/api/catalogs/items', 'park');
            assert.equal(items.status, 200, JSON.stringify(items.body));
            assert.equal(items.body.items[0].name, 'Synthetic item');
            assert.equal((await request('legacy', 'GET', '/api/catalogs/definitions', 'event_genix')).status, 200);
            assert.equal((await request('animator', 'GET', '/api/catalogs/items', 'event_genix')).status, 200);
            assert.equal((await request('animator', 'GET', '/api/catalogs/definitions', 'event_genix')).status, 403);
            const presets = await request('legacy', 'GET', '/api/booking-templates', null);
            assert.equal(presets.status, 200, JSON.stringify(presets.body));
            assert.equal(presets.body[0].name, 'Synthetic preset');
            const createdPreset = await request('animator', 'POST', '/api/booking-templates', 'event_genix', { name: 'Legacy fixture preset' });
            assert.equal(createdPreset.status, 201, JSON.stringify(createdPreset.body));
            assert.deepEqual((await request('legacy', 'GET', '/api/recurring', 'event_genix')).body, []);
            const salary = await request('legacy', 'GET', '/api/finance/report/salary?month=2026-09', 'event_genix');
            assert.equal(salary.status, 200, JSON.stringify(salary.body));
            assert.deepEqual(salary.body, { fixture: true, month: '2026-09', staff: [] });
            await denied(async () => assert.equal((await request('animator', 'GET', '/api/finance/report/salary?month=2026-09', 'event_genix')).status, 403));
        });
        await t.test('legacy role downgrade takes effect for the same JWT before the salary helper', async () => {
            await pool.query("UPDATE users SET role='animator' WHERE id=2");
            await denied(async () => assert.equal((await request('legacy', 'GET', '/api/finance/report/salary?month=2026-09', 'event_genix')).status, 403));
            await pool.query("UPDATE users SET role='director' WHERE id=2");
        });
        await t.test('Dar and custom membership deny every private core method before domain access', async () => {
            await matrix('member', 'dar');
            await matrix('member', 'fixture_custom');
        });
        await t.test('CRM and MD compatibility cannot bypass containment with global director rights', async () => {
            await matrix('crm', 'crm');
            await matrix('md', 'maysternya_doli');
            for (const context of ['crm', 'maysternya_doli']) await matrix('member', context);
        });
        await t.test('a compatible Dar registry cannot restore the legacy Park namespace', async () => {
            await pool.query("UPDATE businesses SET access_mode='compatibility' WHERE id=2");
            try { await matrix('legacyDar', 'dar'); }
            finally { await pool.query("UPDATE businesses SET access_mode='membership' WHERE id=2"); }
        });
        await t.test('query/body context and aliases preserve the same containment decision', async () => {
            await denied(async () => {
                for (const surface of SURFACES) {
                    const get = surface.cases.find(([method]) => method === 'GET');
                    const query = await request('member', 'GET', surface.prefix + get[1], 'md', undefined, 'query');
                    assert.equal(query.status, 403);
                    assert.equal(query.body.code, surface.code);
                    const post = surface.cases.find(([method]) => method === 'POST');
                    if (post) {
                        const result = await request('member', 'POST', surface.prefix + post[1], 'dar', {}, 'body');
                        assert.equal(result.status, 403);
                        assert.equal(result.body.code, surface.code);
                    }
                }
            });
        });
        await t.test('same JWT immediately loses the legacy Park path after registry cutover', async () => {
            await pool.query("UPDATE businesses SET access_mode='membership' WHERE id=1");
            await matrix('member', 'event_genix');
            await denied(async () => {
                for (const surface of SURFACES) {
                    const get = surface.cases.find(([method]) => method === 'GET');
                    const result = await request('legacy', 'GET', surface.prefix + get[1], 'event_genix');
                    assert.equal(result.status, 403);
                    assert.equal(result.body.code, 'business_context_unavailable');
                }
            });
        });
        await t.test('aggregate reads are contained while aggregate mutations retain upstream read-only denial', async () => {
            await denied(async () => {
                for (const context of ['all', 'overview']) {
                    for (const surface of SURFACES) {
                        const get = surface.cases.find(([method]) => method === 'GET');
                        const result = await request('member', 'GET', surface.prefix + get[1], context);
                        assert.equal(result.status, 403, JSON.stringify(result.body));
                        assert.equal(result.body.code, surface.code);
                    }
                }
                const multi = { 'X-Business-Scope': 'multi', 'X-Business-Contexts': 'event_genix,dar' };
                const selected = await request('member', 'GET', '/api/catalogs/items', 'dar', undefined, 'header', multi);
                assert.equal(selected.status, 403);
                assert.equal(selected.body.code, 'catalogs_not_migrated');
                for (const route of ['/api/catalogs/items', '/api/booking-templates', '/api/recurring']) {
                    const result = await request('member', 'POST', route, 'all', {});
                    assert.equal(result.status, 403);
                    assert.equal(result.body.code, 'business_scope_read_only');
                }
            });
        });
        await t.test('invalid identity and inaccessible contexts retain existing auth errors', async () => {
            await denied(async () => {
                for (const actor of [null, 'invalid']) {
                    assert.equal((await request(actor, 'GET', '/api/catalogs/items')).status, 401);
                }
                for (const context of ['fixture_foreign', 'not/valid']) {
                    const result = await request('member', 'GET', '/api/catalogs/items', context);
                    assert.equal(result.status, 403);
                    assert.equal(result.body.code, 'business_context_unavailable');
                }
            });
        });
        await t.test('scoped finance stays reachable and the same JWT observes role and membership revocation', async () => {
            const available = await request('member', 'GET', '/api/finance/categories', 'dar');
            assert.equal(available.status, 200, JSON.stringify(available.body));
            assert.deepEqual(available.body, []);
            await pool.query("UPDATE business_memberships SET role='animator' WHERE business_id=2 AND user_id=1");
            await denied(async () => assert.equal((await request('member', 'GET', '/api/finance/categories', 'dar')).status, 403));
            await pool.query("UPDATE business_memberships SET role='director',is_active=false WHERE business_id=2 AND user_id=1");
            await denied(async () => {
                for (const surface of SURFACES) {
                    const get = surface.cases.find(([method]) => method === 'GET');
                    const result = await request('member', 'GET', surface.prefix + get[1], 'dar');
                    assert.equal(result.status, 403);
                    assert.equal(result.body.code, 'business_context_unavailable');
                }
            });
        });
        assert.equal(deniedCalls.length, 0);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM catalog_items')).rows[0].count, 1);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM booking_templates')).rows[0].count, 2);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM recurring_templates')).rows[0].count, 0);
        t.diagnostic(JSON.stringify({ requestCount, deniedDomainCalls: deniedCalls.length, salaryFixtureCalls: helperCalls.length }));
    } finally {
        global.fetch = originalFetch;
        https.request = originalHttpsRequest;
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        for (const [id, entry] of previous) {
            if (entry) require.cache[id] = entry;
            else delete require.cache[id];
        }
        if (pool) await pool.end();
        try {
            if (created) {
                assert.equal((await admin.query('SELECT pid FROM pg_stat_activity WHERE datname=$1', [database])).rowCount, 0);
                await admin.query(`DROP DATABASE "${database}"`);
                assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
            }
        } finally { await admin.end(); }
    }
});
