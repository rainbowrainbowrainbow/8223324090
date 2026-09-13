'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');

// This suite never reads DATABASE_URL or boots the operational application.
// Local Linux: BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test <this file>
// TCP: BUSINESS_MEMBERSHIP_TEST_DATABASE_URL must identify a loopback test DB.
const localSocket = process.env.BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST === '1';
const fixtureUrl = process.env.BUSINESS_MEMBERSHIP_TEST_DATABASE_URL;

function localConnection() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) {
        assert.ok(!process.env[key], 'PostgreSQL membership tests cannot run inside Railway');
    }
    if (localSocket) {
        assert.equal(process.platform, 'linux', 'Local peer authentication requires Linux');
        return { host: '/var/run/postgresql', user: 'postgres', database: 'postgres' };
    }
    const url = new URL(fixtureUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only a local PostgreSQL server is allowed');
    assert.match(url.pathname, /(?:^|[_-])(test|testing|ci|disposable)(?:[_-]|$)/i, 'A test database is required');
    assert.doesNotMatch(url.pathname, /(?:^|[_-])(prod|production|live)(?:[_-]|$)/i);
    assert.notEqual(fixtureUrl, process.env.DATABASE_URL);
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)), ssl: false };
}

test('real PostgreSQL membership resolution and existing JWT access boundaries', {
    skip: !localSocket && !fixtureUrl,
    timeout: 90000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    let pool;
    let server;
    let created = false;
    const dbModule = require.resolve('../../db');
    const previousDb = require.cache[dbModule];
    let authenticateToken;

    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 4, connectionTimeoutMillis: 5000 });
        await pool.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'animator', extra_roles TEXT[] NOT NULL DEFAULT '{}',
                page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
                action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
                business_contexts TEXT[] NOT NULL DEFAULT '{event_genix}', default_business_context TEXT,
                telegram_chat_id TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
                session_revoked_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ
            );
            CREATE TABLE employee_profiles (
                user_id INT REFERENCES users(id), staff_id INT, is_active BOOLEAN DEFAULT true,
                last_activity_at TIMESTAMPTZ
            );
            CREATE TABLE membership_probe_records (
                id SERIAL PRIMARY KEY, business_context TEXT NOT NULL, label TEXT NOT NULL
            );
        `);
        const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/357_organizations_business_memberships.sql'), 'utf8');
        await pool.query(migration);
        await pool.query(migration);
        require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: { pool } };

        const auth = require('../../middleware/auth');
        authenticateToken = auth.authenticateToken;
        const business = require('../../services/businessContext');
        const { applyMembershipAccess, loadMembershipAccess } = require('../../services/businessMembership');
        const app = express();
        app.use(express.json());
        app.use(authenticateToken);
        app.get('/probe', async (req, res, next) => {
            try {
                const scope = business.resolveBusinessScope(req);
                if (!business.requireBusinessScope(req, res, scope)) return;
                const params = [];
                const rows = await pool.query(`SELECT label FROM membership_probe_records WHERE ${business.pushBusinessScopeCondition(params, scope)} ORDER BY label`, params);
                res.json({ role: req.user.role, roles: req.user.roles,
                    extraRoles: req.user.extraRoles, pageAllowlist: req.user.pageAllowlist,
                    actionAllowlist: req.user.actionAllowlist,
                    financeAllowed: auth.resolveCapability(req.user, '/finance', { type: 'page' }).allowed,
                    activeMembership: req.user.activeBusinessMembership?.businessContext,
                    scope, labels: rows.rows.map(row => row.label) });
            } catch (error) { next(error); }
        });
        app.post('/probe', async (req, res, next) => {
            try {
                const scope = business.resolveBusinessScope(req);
                if (!business.requireWritableBusinessScope(req, res, scope)) return;
                await pool.query('INSERT INTO membership_probe_records (business_context, label) VALUES ($1, $2)', [scope.activeContext, 'write-fixture']);
                res.json({ success: true });
            } catch (error) { next(error); }
        });
        server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        async function request(token, query = '', method = 'GET') {
            const response = await fetch(base + '/probe' + query, { method,
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                ...(method === 'POST' ? { body: '{}' } : {}) });
            return { status: response.status, body: await response.json() };
        }

        async function reset() {
            await pool.query('TRUNCATE membership_probe_records, employee_profiles, business_memberships, organization_memberships, businesses, organizations, users RESTART IDENTITY CASCADE');
            await pool.query(`INSERT INTO organizations (id, slug, name) VALUES (1, 'fixture-a', 'Fixture A'), (2, 'fixture-b', 'Fixture B');
                INSERT INTO businesses (id, organization_id, context_key, label, short_label, access_mode) VALUES
                (1, 1, 'event_genix', 'Fixture Park', 'Park', 'membership'),
                (2, 1, 'dar', 'Fixture Dar', 'Dar', 'membership'),
                (3, 2, 'fixture_other', 'Fixture Other', 'Other', 'membership'),
                (4, 1, 'fixture_custom', 'Fixture Custom', 'Custom', 'membership');
                INSERT INTO membership_probe_records (business_context, label) VALUES
                ('event_genix', 'park-record'), ('dar', 'dar-record'),
                ('fixture_other', 'other-org-record'), ('fixture_custom', 'custom-record'),
                ('maysternya_doli', 'md-record'), ('crm', 'crm-record')`);
            authenticateToken._activityCache?.clear();
        }

        async function account(overrides = {}) {
            const result = await pool.query(`INSERT INTO users (username, name, role, extra_roles, page_allowlist, action_allowlist, business_contexts, default_business_context)
                VALUES ($1, 'Membership fixture', $2, $3, $4, $5, $6, $7) RETURNING *`, [
                'fixture_' + crypto.randomUUID().replaceAll('-', ''), overrides.role || 'director',
                overrides.extraRoles || ['accountant'], overrides.pages || ['/finance'],
                overrides.actions || ['booking.edit'], overrides.contexts || ['event_genix', 'dar'],
                overrides.defaultContext || 'event_genix'
            ]);
            const user = result.rows[0];
            // Deliberately retain pre-cutover role claims so later DB changes must win.
            const token = jwt.sign({ ...auth.buildAuthUserPayload(user), sessionIssuedAt: Date.now() }, auth.JWT_SECRET, { expiresIn: '5m' });
            return { user, token };
        }

        async function member(user, businessId, role = 'animator', options = {}) {
            const organizationId = businessId === 3 ? 2 : 1;
            await pool.query(`INSERT INTO organization_memberships (organization_id, user_id, role)
                VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [organizationId, user.id]);
            await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default, extra_roles)
                VALUES ($1, $2, $3, $4, $5, $6)`, [businessId, organizationId, user.id, role, options.isDefault === true, options.extraRoles || []]);
        }

        await t.test('migration is repeatable and rejects cross-organization membership records', async () => {
            await reset();
            const { user } = await account();
            await assert.rejects(pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role)
                VALUES (1, 2, $1, 'animator')`, [user.id]), /organization does not match business/);
        });

        await t.test('no membership cannot resurrect legacy Park or Dar access', async () => {
            await reset();
            const { token, user } = await account();
            const access = await loadMembershipAccess(pool, user, 'event_genix');
            assert.equal(access.invalid, true);
            assert.equal(business.canAccessBusinessContext(applyMembershipAccess(user, access), 'event_genix'), false);
            for (const query of ['', '?businessContext=event_genix', '?businessContext=dar']) {
                assert.equal((await request(token, query)).status, 403, query || 'omitted context');
            }
        });

        await t.test('a Park membership does not grant a missing Dar membership through legacy context fields', async () => {
            await reset();
            const { token, user } = await account();
            await member(user, 1, 'director', { isDefault: true });
            assert.equal((await request(token, '?businessContext=event_genix')).status, 200);
            for (const method of ['GET', 'POST']) {
                assert.equal((await request(token, '?businessContext=dar', method)).status, 403);
            }
            assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM membership_probe_records WHERE label = 'write-fixture'")).rows[0].n, 0);
        });

        await t.test('Dar-only and custom-only membership align default context, data and role', async () => {
            await reset();
            for (const [id, key, label] of [[2, 'dar', 'dar-record'], [4, 'fixture_custom', 'custom-record']]) {
                const { token, user } = await account({ role: 'animator', extraRoles: [], pages: [] });
                await member(user, id, 'manager', { isDefault: true });
                const result = await request(token);
                assert.equal(result.status, 200);
                assert.equal(result.body.activeMembership, key);
                assert.equal(result.body.scope.activeContext, key);
                assert.deepEqual(result.body.labels, [label]);
                assert.equal((await request(token, '?businessContext=' + key)).status, 200);
                assert.equal((await request(token, '?businessContext=event_genix')).status, 403);
            }
        });

        await t.test('roles and allowlists come from each active business, including the same old JWT', async () => {
            await reset();
            const { token, user } = await account();
            await member(user, 1, 'animator', { isDefault: true });
            await member(user, 2, 'director');
            const park = await request(token, '?businessContext=event_genix');
            assert.equal(park.status, 200);
            assert.equal(park.body.role, 'animator');
            assert.deepEqual(park.body.roles, ['animator']);
            assert.deepEqual(park.body.extraRoles, []);
            assert.deepEqual(park.body.pageAllowlist, []);
            assert.deepEqual(park.body.actionAllowlist, []);
            assert.equal(park.body.financeAllowed, false);
            const dar = await request(token, '?businessContext=dar');
            assert.equal(dar.status, 200);
            assert.equal(dar.body.role, 'director');
            assert.equal(dar.body.financeAllowed, true);
            await pool.query("UPDATE business_memberships SET role = 'animator', extra_roles = '{}' WHERE user_id = $1 AND business_id = 2", [user.id]);
            const changed = await request(token, '?businessContext=dar');
            assert.equal(changed.status, 200);
            assert.deepEqual(changed.body.roles, ['animator']);
            assert.equal(changed.body.financeAllowed, false);
        });

        await t.test('default membership changes update omitted-context requests without a new JWT', async () => {
            await reset();
            const { token, user } = await account();
            await member(user, 1, 'animator', { isDefault: true });
            await member(user, 2, 'manager');
            assert.equal((await request(token)).body.scope.activeContext, 'event_genix');
            await pool.query('UPDATE business_memberships SET is_default = false WHERE user_id = $1', [user.id]);
            await pool.query('UPDATE business_memberships SET is_default = true WHERE user_id = $1 AND business_id = 2', [user.id]);
            const changed = await request(token);
            assert.equal(changed.status, 200);
            assert.equal(changed.body.activeMembership, 'dar');
            assert.equal(changed.body.scope.activeContext, 'dar');
            assert.equal(changed.body.role, 'manager');
            assert.deepEqual(changed.body.labels, ['dar-record']);
        });

        await t.test('revoking the last membership denies the very next request with the existing JWT', async () => {
            await reset();
            const { token, user } = await account();
            await member(user, 1, 'manager', { isDefault: true });
            assert.equal((await request(token, '?businessContext=event_genix')).status, 200);
            await pool.query('UPDATE business_memberships SET is_active = false WHERE user_id = $1', [user.id]);
            assert.equal((await request(token, '?businessContext=event_genix')).status, 403);
            assert.equal((await request(token)).status, 403);
            await pool.query('DELETE FROM business_memberships WHERE user_id = $1', [user.id]);
            assert.equal((await request(token, '?businessContext=event_genix')).status, 403);
        });

        await t.test('organization membership, business and organization deactivation never restore legacy access', async () => {
            for (const statement of [
                'UPDATE organization_memberships SET is_active = false',
                "UPDATE businesses SET status = 'inactive' WHERE id = 1",
                "UPDATE organizations SET status = 'inactive' WHERE id = 1"
            ]) {
                await reset();
                const { token, user } = await account();
                await member(user, 1, 'manager', { isDefault: true });
                assert.equal((await request(token, '?businessContext=event_genix')).status, 200);
                await pool.query(statement);
                assert.equal((await request(token, '?businessContext=event_genix')).status, 403, statement);
            }
        });

        await t.test('same-organization aggregate reads are scoped and aggregate writes are denied', async () => {
            await reset();
            const { token, user } = await account();
            await member(user, 1, 'director', { isDefault: true });
            await member(user, 2, 'director');
            const result = await request(token, '?businessContext=event_genix&businessScope=all');
            assert.equal(result.status, 200);
            assert.equal(result.body.scope.readOnly, true);
            assert.deepEqual(result.body.labels, ['dar-record', 'park-record']);
            const denied = await request(token, '?businessContext=event_genix&businessScope=all', 'POST');
            assert.equal(denied.status, 403);
            assert.equal(denied.body.code, 'business_scope_read_only');
            assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM membership_probe_records WHERE label = 'write-fixture'")).rows[0].n, 0);
        });

        await t.test('cross-organization aggregate access is denied while explicit single businesses remain accessible', async () => {
            await reset();
            const { token, user } = await account();
            await member(user, 1, 'director', { isDefault: true });
            await member(user, 3, 'director', { isDefault: true });
            assert.equal((await request(token)).status, 403, 'multiple organizations require an explicit context');
            for (const key of ['event_genix', 'fixture_other']) {
                assert.equal((await request(token, '?businessContext=' + key)).status, 200);
            }
            for (const suffix of ['&businessScope=all', '&businessScope=multi&businessContexts=event_genix,fixture_other']) {
                const denied = await request(token, '?businessContext=event_genix' + suffix);
                assert.equal(denied.status, 403);
                assert.equal(denied.body.code, 'business_scope_organization_mismatch');
            }
        });

        await t.test('MD/CRM compatibility preserves authorized legacy access and rejects an unassigned context', async () => {
            await reset();
            const { token, user } = await account({ contexts: ['event_genix', 'maysternya_doli', 'crm'] });
            await member(user, 1, 'animator', { isDefault: true });
            for (const [key, label] of [['maysternya_doli', 'md-record'], ['crm', 'crm-record']]) {
                const result = await request(token, '?businessContext=' + key);
                assert.equal(result.status, 200);
                assert.equal(result.body.role, 'director');
                assert.deepEqual(result.body.labels, [label]);
            }
            const restricted = await account({ role: 'animator', extraRoles: [], contexts: ['event_genix'] });
            await member(restricted.user, 1, 'animator', { isDefault: true });
            assert.equal((await request(restricted.token, '?businessContext=crm')).status, 403);
            assert.equal((await request(restricted.token, '?businessContext=maysternya_doli')).status, 403);
        });

        await t.test('an empty additive membership schema retains access before explicit business cutover', async () => {
            await reset();
            await pool.query('TRUNCATE business_memberships, organization_memberships, businesses, organizations CASCADE');
            const { token } = await account({ contexts: ['event_genix', 'dar'] });
            for (const [context, label] of [['event_genix', 'park-record'], ['dar', 'dar-record']]) {
                const result = await request(token, '?businessContext=' + context);
                assert.equal(result.status, 200);
                assert.equal(result.body.role, 'director');
                assert.deepEqual(result.body.labels, [label]);
            }
        });

        await t.test('missing membership schema produces an unavailable auth response, never a legacy grant', async () => {
            await reset();
            const { token } = await account();
            await pool.query('ALTER TABLE businesses RENAME TO unavailable_businesses');
            try {
                const result = await request(token, '?businessContext=event_genix');
                assert.equal(result.status, 503);
                assert.equal(result.body.code, 'auth_verification_unavailable');
            } finally {
                await pool.query('ALTER TABLE unavailable_businesses RENAME TO businesses');
            }
        });
    } finally {
        if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        if (authenticateToken?._activityCleanup) clearInterval(authenticateToken._activityCleanup);
        if (previousDb) require.cache[dbModule] = previousDb;
        else delete require.cache[dbModule];
        if (pool) await pool.end();
        try {
            if (created) {
                await admin.query(`DROP DATABASE "${database}"`);
                const remaining = await admin.query('SELECT datname FROM pg_database WHERE datname = $1', [database]);
                assert.equal(remaining.rowCount, 0, 'The owned disposable database must be removed');
            }
        } finally { await admin.end(); }
    }
});
