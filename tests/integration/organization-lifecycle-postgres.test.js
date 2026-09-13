'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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

test('organization lifecycle HTTP transactions on an owned local PostgreSQL database', {
    skip: !localSocket && !fixtureUrl,
    timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const adminPool = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const dbId = require.resolve('../../db');
    const originalDb = require.cache[dbId];
    let pool;
    let server;
    let auth;
    let created = false;
    try {
        await adminPool.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 10, connectionTimeoutMillis: 5000 });
        await pool.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'animator', extra_roles TEXT[] NOT NULL DEFAULT '{}',
                page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
                action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
                business_contexts TEXT[] NOT NULL DEFAULT '{event_genix,dar}',
                default_business_context TEXT DEFAULT 'event_genix', telegram_chat_id TEXT,
                is_active BOOLEAN NOT NULL DEFAULT true, last_seen_at TIMESTAMPTZ
            );
            CREATE TABLE employee_profiles (user_id INT REFERENCES users(id), staff_id INT,
                is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);
            CREATE TABLE refresh_tokens (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), revoked_at TIMESTAMPTZ);
        `);
        for (const migration of ['204_account_security_personal_cabinet.sql', '357_organizations_business_memberships.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', migration), 'utf8'));
        }
        require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
        auth = require('../../middleware/auth');
        const business = require('../../services/businessContext');
        const { businessScopeWriteGuard } = require('../../middleware/businessScopeGuard');
        const app = express();
        app.use(express.json());
        app.use('/api', auth.authenticateToken, businessScopeWriteGuard);
        app.use('/api/organizations', require('../../routes/organizations'));
        app.use('/api/auth', require('../../routes/auth'));
        app.get('/api/lifecycle-probe', (req, res) => {
            const scope = business.resolveBusinessScope(req);
            if (!business.requireBusinessScope(req, res, scope)) return;
            res.json({ role: req.user.role, roles: req.user.roles, context: scope.activeContext });
        });
        app.use((error, req, res, next) => res.status(500).json({ code: 'fixture_unhandled_error' }));
        server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        async function request(actor, method, route, body) {
            const response = await fetch(base + route, { method,
                headers: { Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json', Connection: 'close' },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json() };
        }
        async function account(role = 'manager') {
            const user = (await pool.query(`INSERT INTO users (username, name, role)
                VALUES ($1, 'Lifecycle fixture', $2) RETURNING *`, ['lifecycle_' + crypto.randomUUID().replaceAll('-', ''), role])).rows[0];
            const token = jwt.sign({ ...auth.buildAuthUserPayload(user), sessionIssuedAt: Date.now() }, auth.JWT_SECRET, { expiresIn: '5m' });
            return { ...user, token };
        }
        async function member(user, { organizationId = 1, businessId = 1, organizationRole = 'member', role = 'manager', isDefault = true } = {}) {
            await pool.query(`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)
                ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [organizationId, user.id, organizationRole]);
            await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
                VALUES ($1, $2, $3, $4, $5)`, [businessId, organizationId, user.id, role, isDefault]);
        }
        async function clear() {
            await pool.query(`DROP TRIGGER IF EXISTS fixture_audit_failure ON account_security_events;
                DROP TRIGGER IF EXISTS fixture_owner_delay ON organization_memberships;
                TRUNCATE account_security_events, business_memberships, organization_memberships, businesses,
                organizations, employee_profiles, refresh_tokens, users RESTART IDENTITY CASCADE`);
            auth.authenticateToken._activityCache?.clear();
        }
        async function reset() {
            await clear();
            await pool.query(`INSERT INTO organizations (id, slug, name) VALUES (1, 'fixture-a', 'Fixture A'), (2, 'fixture-b', 'Fixture B');
                INSERT INTO businesses (id, organization_id, context_key, label, short_label, access_mode) VALUES
                (1, 1, 'event_genix', 'Fixture Park', 'Park', 'membership'),
                (2, 1, 'dar', 'Fixture Dar', 'Dar', 'membership'),
                (3, 2, 'fixture_other', 'Fixture Other', 'Other', 'membership');
                SELECT setval(pg_get_serial_sequence('organizations', 'id'), 2);
                SELECT setval(pg_get_serial_sequence('businesses', 'id'), 3)`);
            const owner = await account();
            const admin = await account();
            const worker = await account('animator');
            const foreign = await account();
            await member(owner, { organizationRole: 'owner' });
            await member(admin, { organizationRole: 'admin' });
            await member(worker, { role: 'animator' });
            await member(foreign, { organizationId: 2, businessId: 3, organizationRole: 'owner' });
            return { owner, admin, worker, foreign };
        }
        async function membership(userId, businessId = 1) {
            return (await pool.query(`SELECT bm.*, om.role AS organization_role FROM business_memberships bm
                JOIN organization_memberships om ON om.user_id = bm.user_id AND om.organization_id = bm.organization_id
                WHERE bm.user_id = $1 AND bm.business_id = $2`, [userId, businessId])).rows[0];
        }
        async function accessSnapshot() {
            const result = {};
            for (const table of ['organizations', 'businesses', 'organization_memberships', 'business_memberships']) {
                result[table] = (await pool.query(`SELECT to_jsonb(snapshot) AS value FROM ${table} snapshot ORDER BY to_jsonb(snapshot)::text`)).rows.map(row => row.value);
            }
            return result;
        }
        async function auditFailure() {
            await pool.query(`CREATE OR REPLACE FUNCTION fixture_reject_security_audit() RETURNS trigger AS $$
                BEGIN RAISE EXCEPTION 'Intentional disposable audit failure'; END; $$ LANGUAGE plpgsql;
                CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON account_security_events
                FOR EACH ROW EXECUTE FUNCTION fixture_reject_security_audit()`);
        }
        async function eventCount() {
            return (await pool.query('SELECT count(*)::int AS n FROM account_security_events')).rows[0].n;
        }

        await t.test('partial membership updates preserve omitted arrays, default and organization ownership', async () => {
            const { owner, worker } = await reset();
            await pool.query(`UPDATE business_memberships SET extra_roles = '{instructor}', page_allowlist = '{/programs}',
                page_denylist = '{/finance}', action_allowlist = '{create_booking}', action_denylist = '{view_revenue}'
                WHERE user_id = $1`, [worker.id]);
            const before = await membership(worker.id);
            const updated = await request(owner, 'PUT', `/api/organizations/1/members/${worker.id}`, { businessId: 1, role: 'reception' });
            assert.equal(updated.status, 200, JSON.stringify(updated.body));
            const after = await membership(worker.id);
            assert.equal(after.role, 'reception');
            for (const key of ['extra_roles', 'page_allowlist', 'page_denylist', 'action_allowlist', 'action_denylist', 'is_default', 'organization_role']) {
                assert.deepEqual(after[key], before[key], key);
            }
            assert.equal((await request(owner, 'PUT', `/api/organizations/1/members/${owner.id}`, { businessId: 1, role: 'director' })).status, 200);
            assert.equal((await membership(owner.id)).organization_role, 'owner');
            assert.equal(await eventCount(), 2);
        });

        await t.test('explicit empty arrays and false default clear fields while omitted role stays unchanged', async () => {
            const { owner, worker } = await reset();
            await pool.query("UPDATE business_memberships SET extra_roles = '{instructor}', page_allowlist = '{/programs}' WHERE user_id = $1", [worker.id]);
            const changed = await request(owner, 'PUT', `/api/organizations/1/members/${worker.id}`, {
                businessId: 1, extraRoles: [], pageAllowlist: [], pageDenylist: [], actionAllowlist: [], actionDenylist: [], isDefault: false
            });
            assert.equal(changed.status, 200, JSON.stringify(changed.body));
            const row = await membership(worker.id);
            assert.equal(row.role, 'animator');
            assert.equal(row.is_default, false);
            for (const key of ['extra_roles', 'page_allowlist', 'page_denylist', 'action_allowlist', 'action_denylist']) assert.deepEqual(row[key], []);
        });

        await t.test('invalid membership field types fail before durable changes', async () => {
            const { owner, worker } = await reset();
            const before = await accessSnapshot();
            for (const invalid of [{ extraRoles: 'instructor' }, { pageAllowlist: null }, { actionAllowlist: {} }, { isDefault: 'false' }]) {
                const response = await request(owner, 'PUT', `/api/organizations/1/members/${worker.id}`, { businessId: 1, ...invalid });
                assert.equal(response.status, 400, JSON.stringify(invalid));
                assert.equal(response.body.code, 'business_membership_invalid');
            }
            assert.deepEqual(await accessSnapshot(), before);
            assert.equal(await eventCount(), 0);
        });

        await t.test('organization admin can edit ordinary members but cannot self-escalate or manage owner/admin targets', async () => {
            const { owner, admin, worker } = await reset();
            const peerAdmin = await account();
            await member(peerAdmin, { organizationRole: 'admin' });
            const platformCreator = await account('creator');
            await member(platformCreator);
            const allowed = await request(admin, 'PUT', `/api/organizations/1/members/${worker.id}`, { businessId: 1, role: 'director' });
            assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
            const snapshot = await accessSnapshot();
            for (const [target, body] of [
                [admin, { businessId: 1, role: 'director' }],
                [owner, { businessId: 1, role: 'animator' }],
                [peerAdmin, { businessId: 1, role: 'animator' }],
                [platformCreator, { businessId: 1, role: 'animator' }],
                [worker, { businessId: 1, role: 'animator', organizationRole: 'owner' }],
                [worker, { businessId: 1, role: 'animator', organizationRole: 'admin' }]
            ]) {
                const denied = await request(admin, 'PUT', `/api/organizations/1/members/${target.id}`, body);
                assert.equal(denied.status, 403, JSON.stringify(body));
                assert.equal(denied.body.code, 'organization_management_denied');
            }
            for (const target of [admin, owner, peerAdmin, platformCreator]) {
                assert.equal((await request(admin, 'DELETE', `/api/organizations/1/members/${target.id}/1`)).status, 403);
            }
            assert.deepEqual(await accessSnapshot(), snapshot);
            assert.equal(await eventCount(), 1);
        });

        await t.test('business creation/status require an owner and foreign organization access is denied', async () => {
            const { owner, admin } = await reset();
            const payload = { contextKey: 'fixture_created', label: 'Fixture Created', shortLabel: 'Fixture', modules: [] };
            for (const [actor, method, route, body] of [
                [admin, 'POST', '/api/organizations/1/businesses', payload],
                [admin, 'PATCH', '/api/organizations/businesses/2', { status: 'inactive' }],
                [owner, 'POST', '/api/organizations/2/businesses', payload]
            ]) {
                const denied = await request(actor, method, route, body);
                assert.equal(denied.status, 403);
                assert.equal(denied.body.code, 'organization_management_denied');
            }
            const createdBusiness = await request(owner, 'POST', '/api/organizations/1/businesses', payload);
            assert.equal(createdBusiness.status, 201, JSON.stringify(createdBusiness.body));
            assert.equal((await request(owner, 'PATCH', '/api/organizations/businesses/' + createdBusiness.body.business.id, { status: 'inactive' })).status, 200);
            assert.deepEqual((await pool.query('SELECT event_type FROM account_security_events ORDER BY id')).rows.map(row => row.event_type), ['business_created', 'business_status_changed']);
        });

        await t.test('reserved compatibility and aggregate keys cannot be created as membership businesses', async () => {
            const { owner } = await reset();
            const before = await accessSnapshot();
            for (const contextKey of ['event_genix', 'dar', 'maysternya_doli', 'crm', 'all', 'all_business', 'multi', 'overview', 'many', 'selected', 'several']) {
                const response = await request(owner, 'POST', '/api/organizations/1/businesses', {
                    contextKey, label: 'Reserved fixture', shortLabel: 'Fixture', modules: []
                });
                assert.equal(response.status, 400, contextKey + ': ' + JSON.stringify(response.body));
            }
            assert.deepEqual(await accessSnapshot(), before);
            assert.equal(await eventCount(), 0);
        });

        await t.test('an owner can transfer ownership before stepping down and the successor remains protected', async () => {
            const { owner, worker } = await reset();
            const promote = await request(owner, 'PUT', `/api/organizations/1/members/${worker.id}`, {
                businessId: 1, organizationRole: 'owner'
            });
            assert.equal(promote.status, 200, JSON.stringify(promote.body));
            assert.equal((await membership(worker.id)).organization_role, 'owner');
            assert.equal((await membership(worker.id)).role, 'animator', 'Ownership transfer must preserve the operational role');
            const stepDown = await request(owner, 'PUT', `/api/organizations/1/members/${owner.id}`, {
                businessId: 1, organizationRole: 'member'
            });
            assert.equal(stepDown.status, 200, JSON.stringify(stepDown.body));
            const owners = (await pool.query("SELECT user_id FROM organization_memberships WHERE organization_id = 1 AND role = 'owner' AND is_active")).rows;
            assert.deepEqual(owners.map(row => row.user_id), [worker.id]);
            assert.equal((await membership(owner.id)).organization_role, 'member');
            const snapshot = await accessSnapshot();
            const denied = await request(worker, 'PUT', `/api/organizations/1/members/${worker.id}`, {
                businessId: 1, organizationRole: 'member'
            });
            assert.equal(denied.status, 409);
            assert.equal(denied.body.code, 'organization_last_owner');
            assert.deepEqual(await accessSnapshot(), snapshot);
            assert.equal(await eventCount(), 2);
        });

        await t.test('last-owner protection serializes competing self-demotions', async () => {
            const { owner } = await reset();
            const second = await account();
            await member(second, { organizationRole: 'owner' });
            await pool.query(`CREATE OR REPLACE FUNCTION fixture_delay_owner_update() RETURNS trigger AS $$
                BEGIN IF OLD.role = 'owner' AND NEW.role <> 'owner' THEN PERFORM pg_sleep(0.15); END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
                CREATE TRIGGER fixture_owner_delay BEFORE UPDATE ON organization_memberships
                FOR EACH ROW EXECUTE FUNCTION fixture_delay_owner_update()`);
            const results = await Promise.all([owner, second].map(actor => request(actor, 'PUT', `/api/organizations/1/members/${actor.id}`, {
                businessId: 1, organizationRole: 'member'
            })));
            assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
            assert.equal(results.find(row => row.status === 409).body.code, 'organization_last_owner');
            assert.equal((await pool.query("SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id = 1 AND role = 'owner' AND is_active")).rows[0].n, 1);
            assert.equal(await eventCount(), 1);
        });

        await t.test('membership role/default/deactivation take effect with the same JWT without revoking unrelated business access', async () => {
            const { owner, worker } = await reset();
            await member(worker, { businessId: 2, role: 'manager', isDefault: false });
            const probe = context => request(worker, 'GET', '/api/lifecycle-probe' + (context ? '?businessContext=' + context : ''));
            assert.equal((await probe('dar')).body.role, 'manager');
            assert.equal((await request(owner, 'PUT', `/api/organizations/1/members/${worker.id}`, { businessId: 2, role: 'animator', isDefault: true })).status, 200);
            const changed = await probe();
            assert.equal(changed.status, 200);
            assert.equal(changed.body.role, 'animator');
            assert.equal(changed.body.context, 'dar');
            assert.equal((await request(owner, 'DELETE', `/api/organizations/1/members/${worker.id}/1`)).status, 200);
            assert.equal((await probe('event_genix')).status, 403);
            assert.equal((await probe('dar')).status, 200);
            assert.equal((await pool.query('SELECT session_revoked_at FROM users WHERE id = $1', [worker.id])).rows[0].session_revoked_at, null);
            assert.equal((await membership(worker.id)).organization_role, 'member');
            await pool.query('INSERT INTO refresh_tokens (user_id) VALUES ($1)', [worker.id]);
            const revoke = await request(worker, 'POST', '/api/auth/security/revoke-sessions', {});
            assert.equal(revoke.status, 200, JSON.stringify(revoke.body));
            assert.equal(revoke.body.reloginRequired, true);
            const expired = await probe('dar');
            assert.equal(expired.status, 401);
            assert.equal(expired.body.code, 'auth_session_revoked');
            assert.notEqual((await pool.query('SELECT revoked_at FROM refresh_tokens WHERE user_id = $1', [worker.id])).rows[0].revoked_at, null);
        });

        await t.test('audit insert failure rolls back membership create/update/deactivation and business create/status', async () => {
            for (const operation of ['member-update', 'member-create', 'member-delete', 'business-create', 'business-status']) {
                const { owner, worker } = await reset();
                const before = await accessSnapshot();
                await auditFailure();
                const operations = {
                    'member-update': ['PUT', `/api/organizations/1/members/${worker.id}`, { businessId: 1, role: 'reception' }],
                    'member-create': ['PUT', `/api/organizations/1/members/${worker.id}`, { businessId: 2, role: 'animator' }],
                    'member-delete': ['DELETE', `/api/organizations/1/members/${worker.id}/1`],
                    'business-create': ['POST', '/api/organizations/1/businesses', { contextKey: 'fixture_rollback', label: 'Fixture rollback', shortLabel: 'Fixture' }],
                    'business-status': ['PATCH', '/api/organizations/businesses/2', { status: 'inactive' }]
                };
                const response = await request(owner, ...operations[operation]);
                assert.equal(response.status, 500, operation + ': ' + JSON.stringify(response.body));
                assert.deepEqual(await accessSnapshot(), before, operation);
                assert.equal(await eventCount(), 0, operation);
            }
        });

        await t.test('inactive target accounts cannot gain membership through lifecycle API', async () => {
            const { owner, worker } = await reset();
            await pool.query('UPDATE users SET is_active = false WHERE id = $1', [worker.id]);
            const before = await accessSnapshot();
            const denied = await request(owner, 'PUT', `/api/organizations/1/members/${worker.id}`, { businessId: 2, role: 'animator' });
            assert.ok(denied.status >= 400 && denied.status < 500, JSON.stringify(denied));
            assert.deepEqual(await accessSnapshot(), before);
            assert.equal(await eventCount(), 0);
        });

        await t.test('bootstrap audit failure leaves no partially created organization or memberships', async () => {
            await clear();
            const creator = await account('creator');
            await auditFailure();
            const response = await request(creator, 'POST', '/api/organizations/bootstrap', { name: 'Fixture bootstrap', slug: 'fixture-bootstrap' });
            assert.equal(response.status, 500, JSON.stringify(response.body));
            for (const rows of Object.values(await accessSnapshot())) assert.deepEqual(rows, []);
            assert.equal(await eventCount(), 0);
        });

        await t.test('concurrent bootstrap with different slugs creates exactly one organization', async () => {
            await clear();
            const creator = await account('creator');
            const results = await Promise.all(['fixture-first', 'fixture-second'].map(slug => request(creator, 'POST', '/api/organizations/bootstrap', { name: slug, slug })));
            assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
            assert.equal(results.find(row => row.status === 409).body.code, 'organization_bootstrap_complete');
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n, 1);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM businesses')).rows[0].n, 2);
            assert.equal((await pool.query("SELECT count(*)::int AS n FROM organization_memberships WHERE role = 'owner' AND is_active")).rows[0].n, 1);
            assert.equal(await eventCount(), 1);
        });
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        if (auth?.authenticateToken._activityCleanup) clearInterval(auth.authenticateToken._activityCleanup);
        if (originalDb) require.cache[dbId] = originalDb;
        else delete require.cache[dbId];
        if (pool) await pool.end();
        try {
            if (created) {
                await adminPool.query(`DROP DATABASE "${database}"`);
                assert.equal((await adminPool.query('SELECT datname FROM pg_database WHERE datname = $1', [database])).rowCount, 0);
            }
        } finally { await adminPool.end(); }
    }
});
