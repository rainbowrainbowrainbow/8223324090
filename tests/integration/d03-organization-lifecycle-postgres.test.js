'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');

const socket = process.env.BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST === '1';
const fixtureUrl = process.env.BUSINESS_MEMBERSHIP_TEST_DATABASE_URL;

function localConnection() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    if (socket) {
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

test('D03 organization management, configuration and resource initialization use fresh authority and owned transactions', {
    skip: !socket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_d03_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_d03_test_[a-f0-9]{32}$/);
    const adminPool = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const dbId = require.resolve('../../db');
    const originalDb = require.cache[dbId];
    let pool, server, auth, created = false;
    try {
        await adminPool.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 10, connectionTimeoutMillis: 5000 });
        await pool.query(`CREATE TABLE users (
            id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'animator', extra_roles TEXT[] NOT NULL DEFAULT '{}',
            page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
            action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
            business_contexts TEXT[] NOT NULL DEFAULT '{event_genix,dar}', default_business_context TEXT DEFAULT 'event_genix',
            telegram_chat_id TEXT, is_active BOOLEAN NOT NULL DEFAULT true, last_seen_at TIMESTAMPTZ);
            CREATE TABLE employee_profiles (user_id INT REFERENCES users(id), staff_id INT, is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);
            CREATE TABLE refresh_tokens (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), revoked_at TIMESTAMPTZ);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE timeline_resources (
                id SERIAL PRIMARY KEY, business_context TEXT NOT NULL, resource_id TEXT NOT NULL, type TEXT NOT NULL,
                name TEXT NOT NULL, short_name TEXT, color TEXT, capacity INT, equipment JSONB NOT NULL DEFAULT '[]',
                is_active BOOLEAN NOT NULL DEFAULT true, sort_order INT NOT NULL DEFAULT 0, metadata JSONB NOT NULL DEFAULT '{}',
                UNIQUE (business_context, resource_id));`);
        for (const migration of ['204_account_security_personal_cabinet.sql', '357_organizations_business_memberships.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', migration), 'utf8'));
        }
        require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
        auth = require('../../middleware/auth');
        const { businessScopeWriteGuard } = require('../../middleware/businessScopeGuard');
        const app = express();
        app.use(express.json());
        app.use('/api', auth.authenticateToken, businessScopeWriteGuard);
        app.use('/api/organizations', require('../../routes/organizations'));
        app.use('/api', require('../../routes/settings'));
        app.use((error, req, res, next) => res.status(500).json({ code: 'fixture_unhandled_error' }));
        server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        async function request(actor, method, route, body) {
            const response = await fetch(base + (route.startsWith('/api/') ? route : '/api/organizations' + route), { method,
                headers: { Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json', Connection: 'close' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: response.status, body: await response.json() };
        }
        async function account(organizationId, organizationRole, businessId, role = 'manager') {
            const user = (await pool.query(`INSERT INTO users (username, name, role) VALUES ($1, 'D03 fixture', $2) RETURNING *`,
                ['d03_' + crypto.randomUUID().replaceAll('-', ''), role])).rows[0];
            await pool.query('INSERT INTO organization_memberships (organization_id,user_id,role) VALUES ($1,$2,$3)', [organizationId, user.id, organizationRole]);
            await pool.query('INSERT INTO business_memberships (business_id,organization_id,user_id,role,is_default) VALUES ($1,$2,$3,$4,true)',
                [businessId, organizationId, user.id, role]);
            return { ...user, token: jwt.sign({ ...auth.buildAuthUserPayload(user), sessionIssuedAt: Date.now() }, auth.JWT_SECRET, { expiresIn: '5m' }) };
        }
        async function reset() {
            await pool.query(`DROP TRIGGER IF EXISTS fixture_d03_audit_failure ON account_security_events;
                TRUNCATE account_security_events, settings, timeline_resources, business_memberships, organization_memberships, businesses,
                organizations, employee_profiles, refresh_tokens, users RESTART IDENTITY CASCADE;
                INSERT INTO organizations(id,slug,name) VALUES (1,'fixture-a','Fixture A'),(2,'fixture-b','Fixture B');
                INSERT INTO businesses(id,organization_id,context_key,label,short_label,access_mode,modules) VALUES
                (1,1,'event_genix','Fixture Park','Park','membership','["timeline"]'),
                (2,1,'dar','Fixture Dar','Dar','membership','["timeline"]'),
                (3,2,'fixture_other','Fixture Other','Other','membership','[]');
                SELECT setval(pg_get_serial_sequence('organizations','id'),2);
                SELECT setval(pg_get_serial_sequence('businesses','id'),3);`);
            auth.authenticateToken._activityCache?.clear();
            return { owner: await account(1, 'owner', 1), admin: await account(1, 'admin', 1),
                worker: await account(1, 'member', 1, 'animator'), foreign: await account(2, 'owner', 3) };
        }
        async function snapshot() {
            const result = {};
            for (const table of ['businesses', 'business_memberships', 'timeline_resources', 'account_security_events']) {
                result[table] = (await pool.query(`SELECT to_jsonb(s) AS row FROM ${table} s ORDER BY to_jsonb(s)::text`)).rows;
            }
            return result;
        }
        async function failAudit() {
            await pool.query(`CREATE OR REPLACE FUNCTION fixture_d03_audit_failure() RETURNS trigger AS $$
                BEGIN RAISE EXCEPTION 'Disposable D03 audit failure'; END; $$ LANGUAGE plpgsql;
                CREATE TRIGGER fixture_d03_audit_failure BEFORE INSERT ON account_security_events
                FOR EACH ROW EXECUTE FUNCTION fixture_d03_audit_failure();`);
        }

        await t.test('management GET has no writes, isolates organizations, includes inactive businesses and denies ordinary members', async () => {
            const { owner, admin, worker, foreign } = await reset();
            await pool.query("UPDATE businesses SET status='inactive' WHERE id=2");
            const before = await snapshot();
            for (const [actor, orgId, canEdit] of [[owner, 1, true], [admin, 1, false], [foreign, 2, true]]) {
                const res = await request(actor, 'GET', '/management');
                assert.equal(res.status, 200, JSON.stringify(res.body));
                assert.deepEqual(res.body.organizations.map(org => org.id), [orgId]);
                assert.equal(res.body.organizations[0].canEditBusinesses, canEdit);
                assert.ok(res.body.organizations[0].businesses.every(business => business.organizationId === orgId));
                if (orgId === 1) assert.equal(res.body.organizations[0].businesses.find(business => business.id === 2).status, 'inactive');
            }
            assert.equal((await request(worker, 'GET', '/management')).status, 403);
            assert.deepEqual(await snapshot(), before);
        });

        await t.test('owner creates an empty cabinet without operational membership, then changes branding and supported modules explicitly', async () => {
            const { owner } = await reset();
            const res = await request(owner, 'POST', '/1/businesses', { contextKey: 'fixture_second', label: 'Second', shortLabel: 'Two' });
            assert.equal(res.status, 201, JSON.stringify(res.body));
            const businessId = Number(res.body.business.id);
            assert.deepEqual(res.body.business.modules, []);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM business_memberships WHERE business_id=$1', [businessId])).rows[0].n, 0);
            const update = await request(owner, 'PATCH', `/businesses/${businessId}/configuration`, { label: 'Renamed', shortLabel: 'Name', modules: ['timeline', 'tasks'] });
            assert.equal(update.status, 200, JSON.stringify(update.body));
            assert.equal(update.body.business.label, 'Renamed');
            assert.deepEqual(update.body.business.modules, ['timeline', 'tasks']);
            assert.equal(update.body.business.contextKey, 'fixture_second');
            const empty = await request(owner, 'PATCH', `/businesses/${businessId}/configuration`, { modules: [] });
            assert.equal(empty.status, 200);
            assert.deepEqual(empty.body.business.modules, []);
            assert.equal(empty.body.business.label, 'Renamed');
            assert.deepEqual((await pool.query('SELECT event_type FROM account_security_events ORDER BY id')).rows.map(row => row.event_type),
                ['business_created', 'business_configuration_updated', 'business_configuration_updated']);
        });

        await t.test('admin, worker, foreign owner and stale owner cannot mutate configuration or initialize resources', async () => {
            const { owner, admin, worker, foreign } = await reset();
            for (const actor of [admin, worker, foreign]) {
                for (const [method, route, body] of [['PATCH', '/businesses/1/configuration', { label: 'Denied' }], ['POST', '/businesses/1/initialize-resources', {}]]) {
                    const before = await snapshot();
                    const res = await request(actor, method, route, body);
                    assert.equal(res.status, 403, JSON.stringify(res.body));
                    assert.deepEqual(await snapshot(), before);
                }
            }
            await pool.query("UPDATE organization_memberships SET role='member' WHERE user_id=$1", [owner.id]);
            assert.equal((await request(owner, 'PATCH', '/businesses/1/configuration', { label: 'Stale owner' })).status, 403);
            assert.equal((await request(owner, 'GET', '/management')).status, 403);
        });

        await t.test('unsupported new modules and immutable business identity are rejected without partial updates', async () => {
            const { owner } = await reset();
            for (const body of [{ label: 'Partial', modules: ['payroll'] }, { modules: ['unknown_module'] },
                { contextKey: 'dar' }, { organizationId: 2 }, { accessMode: 'compatibility' }]) {
                const before = await snapshot();
                const res = await request(owner, 'PATCH', '/businesses/1/configuration', body);
                assert.ok([400, 403].includes(res.status), JSON.stringify(res.body));
                assert.deepEqual(await snapshot(), before);
            }
            await pool.query(`UPDATE businesses SET modules='["timeline","payroll"]' WHERE id=1`);
            const preserved = await request(owner, 'PATCH', '/businesses/1/configuration', { modules: ['timeline', 'payroll'], label: 'Preserved' });
            assert.equal(preserved.status, 200, JSON.stringify(preserved.body));
            const model = await request(owner, 'GET', '/management');
            const payroll = model.body.organizations[0].businesses[0].moduleCatalog.find(module => module.key === 'payroll');
            assert.ok(!payroll || payroll.enabled === false);
        });

        await t.test('resource initialization is explicit, idempotent and serialized; unrelated custom businesses receive no guessed defaults', async () => {
            const { owner } = await reset();
            const initial = await request(owner, 'GET', '/management');
            assert.equal(initial.status, 200);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM timeline_resources')).rows[0].n, 0);
            const responses = await Promise.all([1, 2].map(() => request(owner, 'POST', '/businesses/2/initialize-resources', {})));
            assert.ok(responses.every(res => res.status === 200), JSON.stringify(responses));
            const createdCount = responses.reduce((sum, res) => sum + res.body.initialization.created, 0);
            assert.ok(createdCount > 0);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM timeline_resources')).rows[0].n, createdCount);
            assert.deepEqual((await pool.query('SELECT DISTINCT business_context FROM timeline_resources')).rows.map(row => row.business_context), ['dar']);
            const repeated = await request(owner, 'POST', '/businesses/2/initialize-resources', {});
            assert.equal(repeated.body.initialization.created, 0);
            const custom = await request(owner, 'POST', '/1/businesses', { contextKey: 'fixture_custom', label: 'Custom', modules: ['timeline'] });
            assert.equal(custom.status, 201);
            const empty = await request(owner, 'POST', `/businesses/${custom.body.business.id}/initialize-resources`, {});
            assert.equal(empty.status, 200, JSON.stringify(empty.body));
            assert.equal(empty.body.initialization.created, 0);
            assert.ok(empty.body.initialization.resourceTypes.every(type => type.status === 'no_defaults'));
        });

        await t.test('disabled module and inactive business cannot initialize resources; audit failure rolls back configuration and resources', async () => {
            const { owner } = await reset();
            await pool.query(`UPDATE businesses SET modules='[]' WHERE id=1`);
            const disabled = await request(owner, 'POST', '/businesses/1/initialize-resources', {});
            assert.equal(disabled.status, 403);
            assert.equal(disabled.body.code, 'business_module_disabled');
            await pool.query("UPDATE businesses SET status='inactive' WHERE id=2");
            assert.equal((await request(owner, 'POST', '/businesses/2/initialize-resources', {})).status, 409);
            await pool.query("UPDATE businesses SET status='active' WHERE id=2");
            await failAudit();
            const before = await snapshot();
            assert.equal((await request(owner, 'PATCH', '/businesses/2/configuration', { label: 'Rollback' })).status, 500);
            assert.deepEqual(await snapshot(), before);
            assert.equal((await request(owner, 'POST', '/businesses/2/initialize-resources', {})).status, 500);
            assert.deepEqual(await snapshot(), before);
        });

        await t.test('legacy cabinet HTTP reads registry modules and rejects module changes before writing settings', async () => {
            const { owner } = await reset();
            await pool.query("UPDATE business_memberships SET role='director' WHERE user_id=$1", [owner.id]);
            await pool.query(`UPDATE businesses SET modules='["timeline","settings"]' WHERE id=1`);
            const read = await request(owner, 'GET', '/api/business/cabinet?businessContext=event_genix');
            assert.equal(read.status, 200, JSON.stringify(read.body));
            assert.equal(read.body.cabinet.modules.source, 'business_registry');
            assert.equal(read.body.cabinet.modules.enabled.dashboard, false);
            assert.equal(read.body.cabinet.modules.enabled.settings, true);
            assert.equal(read.body.cabinet.modules.enabled.payroll, false);
            const before = await snapshot();
            const changed = await request(owner, 'PUT', '/api/business/cabinet?businessContext=event_genix', {
                modules: { enabled: { ...read.body.cabinet.modules.enabled, payroll: true } }
            });
            assert.equal(changed.status, 400, JSON.stringify(changed.body));
            assert.equal(changed.body.code, 'business_modules_managed_by_organization');
            assert.deepEqual(await snapshot(), before);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM settings')).rows[0].n, 0);
        });
    } finally {
        if (server) { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
        if (auth?.authenticateToken._activityCleanup) clearInterval(auth.authenticateToken._activityCleanup);
        if (originalDb) require.cache[dbId] = originalDb;
        else delete require.cache[dbId];
        if (pool) await pool.end();
        try {
            if (created) {
                await adminPool.query(`DROP DATABASE "${database}"`);
                assert.equal((await adminPool.query('SELECT datname FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
            }
        } finally { await adminPool.end(); }
    }
});
