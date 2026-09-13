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

test('task assignee SQL and fresh HTTP membership with disposable PostgreSQL', {
    skip: !localSocket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const dbId = require.resolve('../../db');
    const originalDb = require.cache[dbId];
    let pool, server, auth, created = false;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 4, connectionTimeoutMillis: 5000 });
        await pool.query(`CREATE TABLE users (
            id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
            role TEXT NOT NULL, extra_roles TEXT[] DEFAULT '{}', page_allowlist TEXT[] DEFAULT '{}',
            page_denylist TEXT[] DEFAULT '{}', action_allowlist TEXT[] DEFAULT '{}', action_denylist TEXT[] DEFAULT '{}',
            business_contexts TEXT[] DEFAULT '{event_genix,dar}', default_business_context TEXT DEFAULT 'event_genix',
            telegram_chat_id TEXT, is_active BOOLEAN DEFAULT true, session_revoked_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ
        );
        CREATE TABLE employee_profiles (user_id INT REFERENCES users(id), staff_id INT, department TEXT,
            is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);`);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/357_organizations_business_memberships.sql'), 'utf8'));
        require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
        auth = require('../../middleware/auth');
        const business = require('../../services/businessContext');
        const { loadMembershipAccess, applyMembershipAccess } = require('../../services/businessMembership');
        const { getAssignableTaskOwner, listTaskOwnerCandidates } = require('../../services/taskExecution');
        const { businessScopeWriteGuard } = require('../../middleware/businessScopeGuard');
        const app = express();
        app.use(express.json());
        app.use(auth.authenticateToken, businessScopeWriteGuard);
        app.use('/api/tasks', require('../../routes/tasks'));
        // The POST probe executes the canonical assignment lookup without writing
        // a task or invoking its notification/integration side effects.
        app.post('/candidate/:id', async (req, res, next) => {
            try {
                const scope = business.resolveBusinessScope(req);
                const owner = await getAssignableTaskOwner(req.params.id, { actor: req.user, pool, businessScope: scope });
                res.json(owner);
            } catch (error) { next(error); }
        });
        app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ code: error.code || 'fixture_error' }));
        server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const token = jwt.sign({ id: 1, username: 'actor', role: 'creator' }, auth.JWT_SECRET, { expiresIn: '1h' });
        async function request(route, method = 'GET') {
            const response = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + token, Connection: 'close' } });
            return { status: response.status, body: await response.json() };
        }
        async function reset() {
            await pool.query(`TRUNCATE employee_profiles, business_memberships, organization_memberships, businesses, organizations, users RESTART IDENTITY CASCADE;
                INSERT INTO users (id, username, name, role) VALUES
                  (1, 'actor', 'Actor', 'creator'), (2, 'dual', 'Dual', 'creator'), (3, 'park', 'Park only', 'manager'),
                  (4, 'dar', 'Dar only', 'manager'), (5, 'foreign', 'Foreign', 'manager'), (6, 'inactive', 'Inactive', 'manager');
                INSERT INTO organizations (id, slug, name) VALUES (1, 'fixture-a', 'Fixture A'), (2, 'fixture-b', 'Fixture B');
                INSERT INTO businesses (id, organization_id, context_key, label, short_label, access_mode) VALUES
                  (1, 1, 'event_genix', 'Park', 'Park', 'membership'), (2, 1, 'dar', 'Dar', 'Dar', 'membership'),
                  (3, 2, 'foreign_fixture', 'Foreign', 'Foreign', 'membership');
                INSERT INTO organization_memberships (organization_id, user_id, role) VALUES
                  (1, 1, 'owner'), (1, 2, 'member'), (1, 3, 'member'), (1, 4, 'member'), (2, 5, 'member'), (1, 6, 'member');
                INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default) VALUES
                  (1, 1, 1, 'manager', true), (2, 1, 1, 'manager', false),
                  (1, 1, 2, 'accountant', true), (2, 1, 2, 'animator', false),
                  (1, 1, 3, 'manager', true), (2, 1, 4, 'instructor', true),
                  (3, 2, 5, 'manager', true), (2, 1, 6, 'manager', true);
                INSERT INTO employee_profiles (user_id, department) SELECT id, 'operations' FROM users;
                UPDATE business_memberships SET is_active = false WHERE user_id = 6;
                UPDATE users SET business_contexts = '{event_genix}' WHERE id = 4;`);
        }
        async function actorIn(context) {
            const user = (await pool.query('SELECT * FROM users WHERE id = 1')).rows[0];
            return applyMembershipAccess(user, await loadMembershipAccess(pool, user, context));
        }
        await t.test('real owners route lists only active business employees and their business roles', async () => {
            await reset();
            const dar = await request('/api/tasks/owners?businessContext=dar');
            assert.equal(dar.status, 200, JSON.stringify(dar.body));
            assert.deepEqual(dar.body.users.map(row => row.id).sort(), [1, 2, 4]);
            assert.equal(dar.body.users.find(row => row.id === 2).role, 'animator');
            const park = await request('/api/tasks/owners?businessContext=event_genix');
            assert.deepEqual(park.body.users.map(row => row.id).sort(), [1, 2, 3]);
            assert.equal(park.body.users.find(row => row.id === 2).role, 'accountant');
        });
        await t.test('assignment rejects foreign business, organization and inactive members despite global roles', async () => {
            await reset();
            for (const id of [3, 5, 6]) {
                const result = await request(`/candidate/${id}?businessContext=dar`, 'POST');
                assert.equal(result.status, 400);
                assert.equal(result.body.code, 'TASK_OWNER_NOT_ASSIGNABLE');
            }
            assert.equal((await request('/candidate/4?businessContext=dar', 'POST')).status, 200);
        });
        await t.test('membership revocation changes directory and assignment using the same JWT', async () => {
            await reset();
            assert.equal((await request('/candidate/4?businessContext=dar', 'POST')).status, 200);
            await pool.query('UPDATE business_memberships SET is_active = false WHERE business_id = 2 AND user_id = 4');
            assert.equal((await request('/candidate/4?businessContext=dar', 'POST')).status, 400);
            assert.ok(!(await request('/api/tasks/owners?businessContext=dar')).body.users.some(row => row.id === 4));
            assert.equal((await request('/candidate/3?businessContext=event_genix', 'POST')).status, 200);
        });
        await t.test('organization and account deactivation remove otherwise active candidates', async () => {
            await reset();
            await pool.query('UPDATE organization_memberships SET is_active = false WHERE user_id = 4');
            await pool.query('UPDATE users SET is_active = false WHERE id = 2');
            assert.deepEqual((await request('/api/tasks/owners?businessContext=dar')).body.users.map(row => row.id), [1]);
        });
        await t.test('primary role changes take effect without reading the global creator role', async () => {
            await reset();
            await pool.query("UPDATE business_memberships SET role = 'instructor' WHERE user_id = 2 AND business_id = 2");
            assert.equal((await request('/candidate/2?businessContext=dar', 'POST')).body.role, 'instructor');
        });
        await t.test('revoking the actor immediately blocks both directory and assignment', async () => {
            await reset();
            await pool.query('UPDATE business_memberships SET is_active = false WHERE user_id = 1 AND business_id = 2');
            assert.equal((await request('/api/tasks/owners?businessContext=dar')).status, 403);
            assert.equal((await request('/candidate/4?businessContext=dar', 'POST')).status, 403);
            assert.equal((await request('/api/tasks/owners?businessContext=event_genix')).status, 200);
        });
        await t.test('all/multi writes are denied by the production business guard', async () => {
            await reset();
            for (const suffix of ['businessContext=all', 'businessContext=multi&businessContexts=event_genix,dar']) {
                const result = await request('/candidate/2?' + suffix, 'POST');
                assert.equal(result.status, 403);
                assert.equal(result.body.code, 'business_scope_read_only');
            }
        });
        await t.test('direct lookup cannot borrow active Dar role for an explicit Park assignment', async () => {
            await reset();
            const actor = await actorIn('dar');
            await assert.rejects(getAssignableTaskOwner(3, { actor, pool, businessContext: 'event_genix' }), { code: 'TASK_OWNER_NOT_ASSIGNABLE' });
        });
        await t.test('self-only task policy still applies within the active membership', async () => {
            await reset();
            const actor = await actorIn('dar');
            actor.role = 'animator';
            assert.deepEqual((await listTaskOwnerCandidates({ actor, pool })).map(row => row.id), [1]);
        });
        await t.test('department restriction still applies after matching business membership', async () => {
            await reset();
            await pool.query("UPDATE employee_profiles SET department = 'other' WHERE user_id = 4");
            assert.equal((await request('/candidate/4?businessContext=dar', 'POST')).status, 400);
            assert.deepEqual((await request('/api/tasks/owners?businessContext=dar')).body.users.map(row => row.id), [1, 2]);
        });
        await t.test('active business/organization status is rechecked by candidate SQL', async () => {
            await reset();
            const actor = await actorIn('dar');
            await pool.query("UPDATE businesses SET status = 'inactive' WHERE id = 2");
            assert.deepEqual(await listTaskOwnerCandidates({ actor, pool }), []);
            await pool.query("UPDATE businesses SET status = 'active' WHERE id = 2; UPDATE organizations SET status = 'inactive' WHERE id = 1");
            assert.deepEqual(await listTaskOwnerCandidates({ actor, pool }), []);
        });
    } finally {
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        if (auth?.authenticateToken._activityCleanup) clearInterval(auth.authenticateToken._activityCleanup);
        if (originalDb) require.cache[dbId] = originalDb; else delete require.cache[dbId];
        if (pool) await pool.end();
        try {
            if (created) {
                await admin.query(`DROP DATABASE "${database}"`);
                assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname = $1', [database])).rowCount, 0);
            }
        } finally { await admin.end(); }
    }
});
