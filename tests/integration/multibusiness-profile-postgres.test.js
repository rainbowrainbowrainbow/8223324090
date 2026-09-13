'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const express = require('express');
const bcrypt = require('bcryptjs');

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

test('membership-aware login, rotating sessions and editor discovery with actual PostgreSQL and HTTP', {
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
                password_hash TEXT NOT NULL, login_aliases TEXT[] NOT NULL DEFAULT '{}',
                role TEXT NOT NULL DEFAULT 'animator', extra_roles TEXT[] NOT NULL DEFAULT '{}',
                page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
                action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
                business_contexts TEXT[] NOT NULL DEFAULT '{event_genix,dar}',
                default_business_context TEXT DEFAULT 'event_genix', telegram_chat_id TEXT,
                is_active BOOLEAN NOT NULL DEFAULT true, last_seen_at TIMESTAMPTZ,
                avatar_emoji TEXT, avatar_color TEXT, qa_creator_lease_id UUID,
                qa_creator_lease_expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE user_profiles_ext (username TEXT PRIMARY KEY, avatar_url TEXT);
            CREATE TABLE employee_profiles (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), staff_id INT,
                is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);
            CREATE TABLE refresh_tokens (id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id),
                token_hash VARCHAR(128) NOT NULL UNIQUE, device_info VARCHAR(200), ip_address VARCHAR(45),
                expires_at TIMESTAMP NOT NULL, revoked_at TIMESTAMP, replaced_by INT REFERENCES refresh_tokens(id),
                created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE game_streaks (user_id INT REFERENCES users(id), streak_type TEXT,
                current_count INT, best_count INT, last_date DATE, updated_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (user_id, streak_type));
            CREATE TABLE omni_provider_connections (business_context TEXT, channel TEXT,
                provider TEXT, purpose TEXT, provider_kind TEXT, status TEXT, credentials JSONB DEFAULT '{}',
                account_display_name TEXT, masked_identifier TEXT, send_enabled BOOLEAN DEFAULT false,
                receive_enabled BOOLEAN DEFAULT false, warning TEXT, last_checked_at TIMESTAMPTZ,
                last_changed_at TIMESTAMPTZ, changed_by_user_id INT, changed_by TEXT,
                last_test_at TIMESTAMPTZ, last_test_status TEXT, last_test_message TEXT,
                disconnected_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (business_context, channel));
            CREATE TABLE omni_channel_health (business_context TEXT, channel TEXT);
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
        app.use('/api/auth', require('../../routes/auth'));
        app.use('/api/organizations', auth.authenticateToken, businessScopeWriteGuard, require('../../routes/organizations'));
        app.use('/api/users', auth.authenticateToken, businessScopeWriteGuard, require('../../routes/users'));
        app.get('/api/profile-access-probe', auth.authenticateToken, (req, res) => {
            const scope = business.resolveBusinessScope(req);
            if (!business.requireBusinessScope(req, res, scope)) return;
            res.json({ role: req.user.role, roles: req.user.roles, context: scope.activeContext });
        });
        app.use((error, req, res, next) => res.status(500).json({ code: 'fixture_unhandled_error' }));
        server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        const base = `http://127.0.0.1:${server.address().port}`;

        async function request(session, method, route, body) {
            const token = session?.accessToken;
            const response = await fetch(base + route, { method,
                headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
                    'Content-Type': 'application/json', 'User-Agent': 'EventGenix disposable profile integration', Connection: 'close' },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json() };
        }
        async function account(role = 'animator') {
            const password = crypto.randomBytes(32).toString('base64url');
            const username = 'profile_' + crypto.randomUUID().replaceAll('-', '');
            const user = (await pool.query(`INSERT INTO users (username, name, password_hash, role)
                VALUES ($1, $1, $2, $3) RETURNING id, username, name, role`, [username, await bcrypt.hash(password, 4), role])).rows[0];
            return { ...user, password };
        }
        async function member(user, { organizationId = 1, businessId = 1, organizationRole = 'member', role = 'manager', isDefault = true } = {}) {
            await pool.query(`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)
                ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [organizationId, user.id, organizationRole]);
            await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
                VALUES ($1, $2, $3, $4, $5)`, [businessId, organizationId, user.id, role, isDefault]);
        }
        async function reset() {
            await pool.query(`TRUNCATE account_security_events, business_memberships, organization_memberships,
                businesses, organizations, employee_profiles, refresh_tokens, user_profiles_ext, game_streaks,
                settings, omni_provider_connections, omni_channel_health, users RESTART IDENTITY CASCADE;
                INSERT INTO organizations (id, slug, name) VALUES
                (1, 'fixture-a', 'Fixture A'), (2, 'fixture-b', 'Fixture B'), (3, 'fixture-foreign', 'Fixture Foreign');
                INSERT INTO businesses (id, organization_id, context_key, label, short_label, modules, access_mode) VALUES
                (1, 1, 'event_genix', 'Fixture Park', 'Park', '["dashboard","tasks","programs"]', 'membership'),
                (2, 1, 'dar', 'Fixture Dar', 'Dar', '["dashboard","tasks"]', 'membership'),
                (3, 2, 'fixture_other', 'Fixture Other', 'Other', '["dashboard","tasks"]', 'membership'),
                (4, 3, 'fixture_foreign', 'Fixture Foreign', 'Foreign', '["dashboard"]', 'membership');
                SELECT setval(pg_get_serial_sequence('organizations', 'id'), 3);
                SELECT setval(pg_get_serial_sequence('businesses', 'id'), 4)`);
            auth.authenticateToken._activityCache?.clear();
        }
        async function login(actor, businessContext) {
            const response = await request(null, 'POST', '/api/auth/login', {
                username: actor.username, password: actor.password,
                ...(businessContext ? { businessContext } : {})
            });
            // Never include credential or token response values in assertion output.
            assert.equal(response.status, 200, 'Actual fixture login must succeed');
            assert.ok(typeof response.body.accessToken === 'string' && response.body.accessToken.length > 20);
            assert.ok(typeof response.body.refreshToken === 'string' && response.body.refreshToken.length > 20);
            assert.equal(response.body.user.id, actor.id);
            return response.body;
        }
        async function refresh(session, businessContext) {
            const response = await request(session, 'POST', '/api/auth/refresh', {
                refreshToken: session.refreshToken,
                ...(businessContext ? { businessContext } : {})
            });
            assert.equal(response.status, 200, 'Actual fixture refresh must succeed');
            assert.ok(typeof response.body.accessToken === 'string' && response.body.accessToken.length > 20);
            assert.ok(response.body.refreshToken !== session.refreshToken, 'Refresh token must rotate');
            const hash = value => crypto.createHash('sha256').update(value).digest('hex');
            const oldRow = (await pool.query('SELECT id, user_id, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1', [hash(session.refreshToken)])).rows[0];
            const newRow = (await pool.query('SELECT id, user_id, revoked_at FROM refresh_tokens WHERE token_hash = $1', [hash(response.body.refreshToken)])).rows[0];
            assert.ok(oldRow.revoked_at);
            assert.equal(oldRow.replaced_by, newRow.id);
            assert.equal(oldRow.user_id, newRow.user_id);
            assert.equal(newRow.revoked_at, null);
            return response.body;
        }
        function ready(user, role, context) {
            assert.equal(user.accessContext.status, 'ready');
            assert.equal(user.role, role);
            assert.equal(user.activeBusinessContext, context);
            assert.equal(user.activeBusinessMembership.businessContext, context);
            assert.equal(user.activeBusinessMembership.role, role);
        }
        function identityOnly(user, actor, status, allowed = []) {
            assert.equal(user.id, actor.id);
            assert.equal(user.username, actor.username);
            assert.equal(user.accessContext.status, status);
            assert.equal(user.role, null);
            for (const key of ['roles', 'extraRoles', 'pageAllowlist', 'pageDenylist', 'actionAllowlist', 'actionDenylist']) assert.deepEqual(user[key], [], key);
            assert.equal(user.activeBusinessContext, null);
            assert.equal(user.activeBusinessMembership, null);
            assert.deepEqual([...user.businessContextPolicy.allowed].sort(), [...allowed].sort());
        }
        async function accessSnapshot() {
            const snapshot = {};
            for (const table of ['organizations', 'businesses', 'organization_memberships', 'business_memberships']) {
                snapshot[table] = (await pool.query(`SELECT to_jsonb(record) AS value FROM ${table} record ORDER BY to_jsonb(record)::text`)).rows.map(row => row.value);
            }
            return snapshot;
        }

        await t.test('actual login, verify and rotating refresh expose the selected business role and registry profile', async () => {
            await reset();
            const actor = await account('director');
            await member(actor, { role: 'manager' });
            await member(actor, { businessId: 2, role: 'animator', isDefault: false });
            await pool.query(`UPDATE business_memberships SET extra_roles = '{instructor}', page_allowlist = '{/programs}',
                action_denylist = '{view_revenue}' WHERE business_id = 2 AND user_id = $1`, [actor.id]);
            const session = await login(actor);
            ready(session.user, 'manager', 'event_genix');
            const verify = await request(session, 'GET', '/api/auth/verify?businessContext=dar');
            assert.equal(verify.status, 200);
            ready(verify.body.user, 'animator', 'dar');
            assert.deepEqual(verify.body.user.extraRoles, ['instructor']);
            const rotated = await refresh(session, 'dar');
            ready(rotated.user, 'animator', 'dar');
            assert.deepEqual(rotated.user.actionDenylist, ['view_revenue']);
            const profile = await request(rotated, 'GET', '/api/auth/business-profile?businessContext=dar');
            assert.equal(profile.status, 200);
            ready(profile.body.user, 'animator', 'dar');
            const businesses = profile.body.businessProfile.businesses;
            assert.deepEqual(businesses.map(row => row.businessContext).sort(), ['dar', 'event_genix']);
            assert.equal(businesses.find(row => row.businessContext === 'dar').label, 'Fixture Dar');
            assert.ok(profile.body.businessProfile.organizations.some(row => row.id === 1 && row.name === 'Fixture A'));
            assert.equal(profile.body.businessProfile.organizations.some(row => row.id === 3), false);
        });

        await t.test('canonical business profile does not attempt provider repairs on legacy report-bot data', async () => {
            await reset();
            const actor = await account();
            await member(actor);
            const session = await login(actor);
            await pool.query(`INSERT INTO omni_provider_connections
                (business_context, channel, provider, purpose, provider_kind, status, account_display_name)
                VALUES ('event_genix', 'telegram', 'telegram', 'inbox', 'bot', 'disconnected', 'Disposable report bot');
                CREATE SEQUENCE fixture_provider_write_attempts;
                CREATE FUNCTION fixture_trap_provider_write() RETURNS trigger AS $$
                BEGIN
                    PERFORM nextval('fixture_provider_write_attempts');
                    RAISE EXCEPTION 'Disposable provider mutation trap';
                END; $$ LANGUAGE plpgsql;
                CREATE TRIGGER fixture_provider_write_trap BEFORE INSERT OR UPDATE OR DELETE
                ON omni_provider_connections FOR EACH ROW EXECUTE FUNCTION fixture_trap_provider_write()`);
            try {
                // The actual legacy status helper attempts a repair. A sequence
                // records attempted writes even though the trap rolls them back.
                await require('../../services/omni-accounts').getOmniAccountStatusesAsync({ businessContext: 'event_genix' });
                assert.equal((await pool.query('SELECT is_called FROM fixture_provider_write_attempts')).rows[0].is_called, true);
                await pool.query('ALTER SEQUENCE fixture_provider_write_attempts RESTART WITH 1');
                const before = (await pool.query('SELECT to_jsonb(c) AS value FROM omni_provider_connections c ORDER BY channel')).rows;
                const profile = await request(session, 'GET', '/api/auth/business-profile');
                assert.equal(profile.status, 200);
                ready(profile.body.user, 'manager', 'event_genix');
                assert.equal((await pool.query('SELECT is_called FROM fixture_provider_write_attempts')).rows[0].is_called, false);
                assert.deepEqual((await pool.query('SELECT to_jsonb(c) AS value FROM omni_provider_connections c ORDER BY channel')).rows, before);
            } finally {
                await pool.query(`DROP TRIGGER fixture_provider_write_trap ON omni_provider_connections;
                    DROP FUNCTION fixture_trap_provider_write(); DROP SEQUENCE fixture_provider_write_attempts`);
            }
        });

        await t.test('lifecycle role and default changes reach the existing client on its next refresh', async () => {
            await reset();
            const owner = await account();
            const actor = await account('director');
            await member(owner, { organizationRole: 'owner', role: 'manager' });
            await member(actor, { role: 'manager' });
            await member(actor, { businessId: 2, role: 'animator', isDefault: false });
            const ownerSession = await login(owner);
            const session = await login(actor);
            ready(session.user, 'manager', 'event_genix');
            const changed = await request(ownerSession, 'PUT', `/api/organizations/1/members/${actor.id}`, {
                businessId: 2, role: 'reception', isDefault: true, pageAllowlist: ['/programs'], actionDenylist: ['view_revenue']
            });
            assert.equal(changed.status, 200);
            const rotated = await refresh(session);
            ready(rotated.user, 'reception', 'dar');
            assert.equal(rotated.user.defaultBusinessContext, 'dar');
            assert.deepEqual(rotated.user.pageAllowlist, ['/programs']);
            const oldSessionVerify = await request(session, 'GET', '/api/auth/verify');
            assert.equal(oldSessionVerify.status, 200);
            ready(oldSessionVerify.body.user, 'reception', 'dar');
        });

        await t.test('membership revocation preserves identity and unrelated business access through token rotation', async () => {
            await reset();
            const owner = await account();
            const actor = await account('director');
            await member(owner, { organizationRole: 'owner' });
            await member(actor);
            await member(actor, { businessId: 2, role: 'animator', isDefault: false });
            const ownerSession = await login(owner);
            const session = await login(actor);
            assert.equal((await request(ownerSession, 'DELETE', `/api/organizations/1/members/${actor.id}/1`)).status, 200);
            assert.equal((await request(session, 'GET', '/api/profile-access-probe?businessContext=event_genix')).status, 403);
            assert.equal((await request(session, 'GET', '/api/profile-access-probe?businessContext=dar')).status, 200);
            const rotated = await refresh(session, 'dar');
            ready(rotated.user, 'animator', 'dar');
            assert.equal((await request(ownerSession, 'DELETE', `/api/organizations/1/members/${actor.id}/2`)).status, 200);
            const noAccess = await refresh(rotated);
            identityOnly(noAccess.user, actor, 'unavailable');
            const discovery = await request(noAccess, 'GET', '/api/auth/business-profile');
            assert.equal(discovery.status, 200);
            identityOnly(discovery.body.user, actor, 'unavailable');
            assert.deepEqual(discovery.body.businessProfile.businesses, []);
            assert.equal((await pool.query('SELECT session_revoked_at FROM users WHERE id = $1', [actor.id])).rows[0].session_revoked_at, null);
        });

        await t.test('multiple organizations require explicit selection while profile discovery stays available', async () => {
            await reset();
            const actor = await account('director');
            await member(actor, { role: 'manager' });
            await member(actor, { organizationId: 2, businessId: 3, role: 'animator' });
            const session = await login(actor);
            identityOnly(session.user, actor, 'selection_required', ['event_genix', 'fixture_other']);
            const profile = await request(session, 'GET', '/api/auth/business-profile');
            assert.equal(profile.status, 200);
            identityOnly(profile.body.user, actor, 'selection_required', ['event_genix', 'fixture_other']);
            assert.deepEqual(profile.body.businessProfile.organizations.map(row => row.id).sort(), [1, 2]);
            assert.equal(profile.body.businessProfile.activeMembership, null);
            const selected = await request(session, 'GET', '/api/auth/business-profile?businessContext=fixture_other');
            assert.equal(selected.status, 200);
            ready(selected.body.user, 'animator', 'fixture_other');
            const foreign = await request(session, 'GET', '/api/auth/business-profile?businessContext=fixture_foreign');
            assert.equal(foreign.status, 403);
            identityOnly(foreign.body.user, actor, 'unavailable', ['event_genix', 'fixture_other']);
            assert.equal(foreign.body.businessProfile.organizations.some(row => row.id === 3), false);
            assert.equal(foreign.body.businessProfile.businesses.some(row => row.businessContext === 'fixture_foreign'), false);
            const aggregate = await request(session, 'GET', '/api/profile-access-probe?businessContext=event_genix&businessScope=all');
            assert.equal(aggregate.status, 403);
            assert.equal(aggregate.body.code, 'business_scope_organization_mismatch');
        });

        await t.test('an account with no memberships can log in and refresh without manufactured legacy Park grants', async () => {
            await reset();
            const actor = await account('director');
            const session = await login(actor);
            identityOnly(session.user, actor, 'unavailable');
            const rotated = await refresh(session);
            identityOnly(rotated.user, actor, 'unavailable');
            const verify = await request(rotated, 'GET', '/api/auth/verify');
            assert.equal(verify.status, 200);
            identityOnly(verify.body.user, actor, 'unavailable');
            const profile = await request(rotated, 'GET', '/api/auth/business-profile');
            assert.equal(profile.status, 200);
            assert.deepEqual(profile.body.businessProfile.businesses, []);
            assert.equal(profile.body.businessProfile.activeBusinessContext, null);
            assert.equal((await request(rotated, 'GET', '/api/profile-access-probe')).status, 403);
        });

        await t.test('membership editor reads expose only manageable organizations and preserve persisted access', async () => {
            await reset();
            const owner = await account();
            const admin = await account();
            const worker = await account();
            const foreign = await account();
            const creator = await account('creator');
            await member(owner, { organizationRole: 'owner' });
            await member(admin, { organizationRole: 'admin' });
            await member(worker, { role: 'animator' });
            await member(worker, { businessId: 2, role: 'instructor', isDefault: false });
            await member(foreign, { organizationId: 2, businessId: 3 });
            await member(creator, { role: 'creator' });
            const ownerSession = await login(owner);
            const adminSession = await login(admin);
            const workerSession = await login(worker);
            const creatorSession = await login(creator);
            const before = await accessSnapshot();
            const route = `/api/organizations/members/${worker.id}/access-profile`;
            for (const [session, managesRoles] of [[ownerSession, true], [adminSession, false]]) {
                const response = await request(session, 'GET', route);
                assert.equal(response.status, 200);
                const profile = response.body.accessProfile;
                assert.equal(profile.userId, worker.id);
                assert.equal(profile.canEditAccount, false);
                assert.deepEqual(profile.organizations.map(row => row.id), [1]);
                const businesses = profile.organizations[0].businesses;
                assert.deepEqual(businesses.map(row => row.id), [1, 2]);
                assert.equal(businesses[0].membership.role, 'animator');
                assert.equal(businesses[1].membership.role, 'instructor');
                for (const item of businesses) {
                    assert.equal(item.canEdit, true);
                    assert.equal(item.canDeactivate, true);
                    assert.equal(item.canManageOrganizationRole, managesRoles);
                }
                assert.deepEqual([...profile.membershipContextKeys].sort(), ['dar', 'event_genix']);
            }
            for (const [session, userId] of [[ownerSession, foreign.id], [adminSession, owner.id],
                [adminSession, admin.id], [workerSession, owner.id]]) {
                const denied = await request(session, 'GET', `/api/organizations/members/${userId}/access-profile`);
                assert.equal(denied.status, 403);
                assert.equal(denied.body.code, 'organization_management_denied');
            }
            const platform = await request(creatorSession, 'GET', `/api/organizations/members/${foreign.id}/access-profile`);
            assert.equal(platform.status, 200);
            assert.equal(platform.body.accessProfile.canEditAccount, true);
            assert.ok(platform.body.accessProfile.organizations.some(row => row.id === 2));
            assert.deepEqual([...platform.body.accessProfile.membershipContextKeys].sort(),
                ['dar', 'event_genix', 'fixture_foreign', 'fixture_other']);
            assert.deepEqual(await accessSnapshot(), before);
        });

        await t.test('an owner without an active business keeps organization discovery and membership recovery reads', async () => {
            await reset();
            const owner = await account();
            await member(owner, { organizationRole: 'owner', role: 'manager' });
            const session = await login(owner);
            assert.equal((await request(session, 'DELETE', `/api/organizations/1/members/${owner.id}/1`)).status, 200);
            const profile = await request(session, 'GET', '/api/auth/business-profile');
            assert.equal(profile.status, 200);
            identityOnly(profile.body.user, owner, 'unavailable');
            assert.deepEqual(profile.body.businessProfile.businesses, []);
            assert.ok(profile.body.businessProfile.organizations.some(row => row.id === 1 && row.role === 'owner'));
            const editor = await request(session, 'GET', `/api/organizations/members/${owner.id}/access-profile`);
            assert.equal(editor.status, 200);
            const park = editor.body.accessProfile.organizations[0].businesses.find(row => row.id === 1);
            assert.equal(park.membership.isActive, false);
            assert.equal(park.canEdit, true);
            assert.equal(park.canDeactivate, false);
            const directory = await request(session, 'GET', '/api/organizations/members');
            assert.equal(directory.status, 200);
            assert.ok(directory.body.members.some(row => row.id === owner.id));
        });

        await t.test('the editor directory lists current manageable members without a global account search', async () => {
            await reset();
            const owner = await account();
            const admin = await account();
            const worker = await account();
            const foreign = await account();
            const inactive = await account();
            await member(owner, { organizationRole: 'owner' });
            await member(admin, { organizationRole: 'admin' });
            await member(worker);
            await member(foreign, { organizationId: 2, businessId: 3 });
            await member(inactive);
            await pool.query('UPDATE users SET is_active = false WHERE id = $1', [inactive.id]);
            const ownerSession = await login(owner);
            const adminSession = await login(admin);
            const ownerList = await request(ownerSession, 'GET', '/api/organizations/members');
            assert.equal(ownerList.status, 200);
            assert.deepEqual(ownerList.body.members.map(row => row.id).sort(), [owner.id, admin.id, worker.id].sort());
            const adminList = await request(adminSession, 'GET', '/api/organizations/members');
            assert.equal(adminList.status, 200);
            assert.deepEqual(adminList.body.members.map(row => row.id), [worker.id]);
        });

        for (const globalRole of ['manager', 'director']) await t.test(`legacy ${globalRole} account writes cannot add migrated business grants or change their default`, async () => {
            await reset();
            const creator = await account('creator');
            const actor = await account(globalRole);
            await member(creator, { role: 'creator' });
            await member(actor, { role: 'animator' });
            await pool.query("UPDATE users SET business_contexts = '{event_genix}' WHERE id = $1", [actor.id]);
            const creatorSession = await login(creator);
            const actorSession = await login(actor);
            const membershipBefore = await accessSnapshot();
            const userState = async () => (await pool.query(`SELECT role, extra_roles, business_contexts,
                default_business_context, session_revoked_at FROM users WHERE id = $1`, [actor.id])).rows[0];
            const before = await userState();
            const added = await request(creatorSession, 'PATCH', `/api/users/${actor.id}/access`, {
                role: globalRole, businessContexts: ['event_genix', 'dar'], defaultBusinessContext: 'event_genix'
            });
            assert.equal(added.status, 409);
            assert.equal(added.body.code, 'business_membership_required');
            assert.deepEqual(await userState(), before);
            assert.deepEqual(await accessSnapshot(), membershipBefore);
            assert.equal((await request(actorSession, 'GET', '/api/profile-access-probe?businessContext=dar')).status, 403);
            await pool.query("UPDATE users SET business_contexts = '{event_genix,dar}' WHERE id = $1", [actor.id]);
            const beforeDefault = await userState();
            const defaultChanged = await request(creatorSession, 'PATCH', `/api/users/${actor.id}/access`, {
                role: globalRole, businessContexts: ['event_genix', 'dar'], defaultBusinessContext: 'dar'
            });
            assert.equal(defaultChanged.status, 409);
            assert.equal(defaultChanged.body.code, 'business_membership_required');
            assert.deepEqual(await userState(), beforeDefault);
            assert.deepEqual(await accessSnapshot(), membershipBefore);
            await pool.query("UPDATE users SET default_business_context = 'dar' WHERE id = $1", [actor.id]);
            const compatible = await request(creatorSession, 'PATCH', `/api/users/${actor.id}/access`, {
                role: globalRole, businessContexts: ['event_genix', 'dar'], defaultBusinessContext: 'dar'
            });
            assert.equal(compatible.status, 200, 'Unchanged compatibility mirror remains accepted');
            const preserved = await userState();
            assert.deepEqual([...preserved.business_contexts].sort(), ['dar', 'event_genix']);
            assert.equal(preserved.default_business_context, 'dar');
            assert.equal(preserved.role, globalRole);
            assert.deepEqual(await accessSnapshot(), membershipBefore);
            const newSession = await login(actor);
            ready(newSession.user, 'animator', 'event_genix');
            assert.equal((await request(newSession, 'GET', '/api/profile-access-probe?businessContext=dar')).status, 403);
        });

        await t.test('explicit account session revocation still rejects the old access and refresh tokens', async () => {
            await reset();
            const actor = await account();
            await member(actor);
            const session = await login(actor);
            const revoked = await request(session, 'POST', '/api/auth/security/revoke-sessions', {});
            assert.equal(revoked.status, 200);
            assert.equal((await request(session, 'GET', '/api/auth/verify')).status, 401);
            const rotated = await request(session, 'POST', '/api/auth/refresh', { refreshToken: session.refreshToken });
            assert.equal(rotated.status, 401);
            assert.equal(rotated.body.code, 'refresh_session_revoked');
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
