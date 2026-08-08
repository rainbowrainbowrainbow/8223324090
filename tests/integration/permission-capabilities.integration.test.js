/**
 * Token-backed permission matrix against an isolated, disposable PostgreSQL database.
 * This file must only be run through scripts/run-isolated-postgres-tests.js permissions.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, it, before, after } = require('node:test');
const { Pool } = require('pg');
const { getToken, request, testDate } = require('../helpers');
const {
    PAGE_PERMISSIONS,
    ACTION_PERMISSIONS,
    getPublicPagePermissionMetadata
} = require('../../config/permissionRegistry');
const {
    PAGE_PERMISSION_TEST_CONTRACTS,
    ACTION_PERMISSION_TEST_CONTRACTS
} = require('../../config/permissionTestContracts');

const enabled = process.env.RUN_PERMISSION_CAPABILITIES_INTEGRATION === 'true';
const accounts = Object.create(null);
let schemaPool = null;

function createSchemaPool() {
    const databaseUrl = String(process.env.DATABASE_URL || '');
    return new Pool(databaseUrl
        ? {
            connectionString: databaseUrl,
            ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
        }
        : {});
}

function requireDisposableTarget() {
    assert.equal(enabled, true, 'set RUN_PERMISSION_CAPABILITIES_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true', 'permission mutations require isolated test runner');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true', 'permission mutations require verified disposable database');
}

async function login(username, password) {
    const response = await request('POST', '/api/auth/login', { username, password });
    assert.equal(response.status, 200, `login failed for ${username}: ${JSON.stringify(response.data)}`);
    assert.ok(response.data?.token, `token missing for ${username}`);
    return response.data.token;
}

async function permissions(token) {
    const response = await request('GET', '/api/auth/permissions', null, token);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
}

async function updateAccess(account, patch, creatorToken) {
    const response = await request('PATCH', `/api/users/${account.id}/access`, {
        role: account.role,
        extraRoles: account.extraRoles || [],
        pageAllowlist: patch.pageAllowlist || [],
        pageDenylist: patch.pageDenylist || [],
        actionAllowlist: patch.actionAllowlist || [],
        actionDenylist: patch.actionDenylist || [],
        businessContexts: ['event_genix'],
        defaultBusinessContext: 'event_genix'
    }, creatorToken);
    return response;
}

function activePageEntries() {
    return PAGE_PERMISSIONS.filter(entry => entry.deprecated !== true);
}

function activeActionEntries() {
    return ACTION_PERMISSIONS.filter(entry => entry.deprecated !== true);
}

describe('disposable token-backed permission capability contract', { skip: !enabled }, () => {
    before(async () => {
        requireDisposableTarget();
        schemaPool = createSchemaPool();
        const creatorToken = await getToken();
        const suffix = `${process.pid}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
        const definitions = [
            {
                key: 'admin',
                role: 'admin',
                extraRoles: ['accountant'],
                actionAllowlist: ['hr.today.view', 'hr.schedule.view'],
                actionDenylist: ['hr.schedule.manage', 'hr.reports.view', 'hr.reports.export']
            },
            { key: 'manager', role: 'manager', actionAllowlist: [], actionDenylist: [] },
            { key: 'hr', role: 'hr', actionAllowlist: [], actionDenylist: [] },
            { key: 'matrix', role: 'waiter', actionAllowlist: [], actionDenylist: [] }
        ];

        for (const definition of definitions) {
            const username = `permission_${definition.key}_${suffix}`;
            const password = `Safe-${crypto.randomBytes(14).toString('base64url')}`;
            const response = await request('POST', '/api/users', {
                username,
                password,
                name: `Disposable Permission QA ${definition.key} ${suffix}`,
                role: definition.role,
                extraRoles: definition.extraRoles || [],
                pageAllowlist: ['/hr'],
                pageDenylist: [],
                actionAllowlist: definition.actionAllowlist,
                actionDenylist: definition.actionDenylist,
                businessContexts: ['event_genix'],
                defaultBusinessContext: 'event_genix'
            }, creatorToken);
            assert.equal(response.status, 200, `create ${definition.key}: ${JSON.stringify(response.data)}`);
            assert.equal(response.data?.loginReady, true, `created ${definition.key} account must be login-ready`);
            accounts[definition.key] = {
                id: Number(response.data?.user?.id),
                username,
                password,
                role: definition.role,
                extraRoles: definition.extraRoles || [],
                actionAllowlist: definition.actionAllowlist,
                actionDenylist: definition.actionDenylist,
                token: await login(username, password)
            };
        }
    });

    after(async () => {
        if (schemaPool) await schemaPool.end();
    });

    it('applies the additive page_denylist migration with the expected PostgreSQL contract', async () => {
        const result = await schemaPool.query(
            `SELECT data_type, udt_name, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'users'
               AND column_name = 'page_denylist'`
        );
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0].data_type, 'ARRAY');
        assert.equal(result.rows[0].udt_name, '_text');
        assert.equal(result.rows[0].is_nullable, 'NO');
        assert.match(String(result.rows[0].column_default), /'\{\}'::text\[\]/);
        const migration = await schemaPool.query(
            `SELECT COUNT(*)::int AS count
             FROM schema_migrations
             WHERE version = '311_user_page_permission_denies'`
        );
        assert.equal(migration.rows[0].count, 1);
    });

    it('keeps representative role tokens aligned with the effective permission preview', async () => {
        const manager = await permissions(accounts.manager.token);
        assert.equal(manager.capabilities['action:hr.schedule.view'].allowed, true);
        assert.equal(manager.capabilities['action:hr.schedule.view'].sourceRole, 'manager');
        assert.equal(manager.capabilities['action:hr.payroll.view'].allowed, false);

        const hr = await permissions(accounts.hr.token);
        assert.equal(hr.capabilities['action:hr.schedule.manage'].allowed, true);
        assert.equal(hr.capabilities['action:hr.payroll.view'].allowed, true);
        assert.equal(hr.pages['/hr'], true);
    });

    it('exposes only active configurable definitions in /api/users/roles', async () => {
        const creatorToken = await getToken();
        const response = await request('GET', '/api/users/roles', null, creatorToken);
        assert.equal(response.status, 200, JSON.stringify(response.data));

        const publicPages = getPublicPagePermissionMetadata();
        assert.deepEqual(
            [...response.data.pages.map(entry => entry.key)].sort(),
            [...publicPages.map(entry => entry.key)].sort(),
            'page definitions must come from public registry projection'
        );
        const apiActionKeys = response.data.actions.map(entry => entry.key);
        assert.deepEqual(
            [...apiActionKeys].sort(),
            [...activeActionEntries().map(entry => entry.key)].sort(),
            'action definitions must include exactly active actions'
        );

        for (const key of ['cancel_booking', 'view_own', 'manage_users', 'manage_staff']) {
            assert.equal(apiActionKeys.includes(key), false, `${key}: deprecated/tombstone action leaked to public API`);
        }
        for (const key of ['/dashboard', '/profile', '/game', '/quiz', '/room', '/shop']) {
            assert.equal(response.data.pages.some(entry => entry.key === key), false, `${key}: non-configurable page leaked to public API`);
        }
    });

    it('checks every active page contract through access PATCH, relogin, and /api/auth/permissions', async () => {
        const creatorToken = await getToken();
        const account = accounts.matrix;

        for (const entry of activePageEntries()) {
            const contract = PAGE_PERMISSION_TEST_CONTRACTS[entry.key];
            assert.ok(contract, `${entry.key}: missing executable page contract`);

            if (entry.configurable === false) {
                const rejected = await updateAccess(account, { pageAllowlist: [entry.key] }, creatorToken);
                assert.equal(rejected.status, 400, `${entry.key}: non-configurable page allow must be rejected`);
                assert.equal(rejected.data?.code, 'NON_CONFIGURABLE_CAPABILITY_KEYS');
                continue;
            }

            if (entry.explicitAllow === false) {
                const rejected = await updateAccess(account, { pageAllowlist: [entry.key] }, creatorToken);
                assert.equal(rejected.status, 400, `${entry.key}: explicit allow disabled page must be rejected`);
                assert.equal(rejected.data?.code, 'EXPLICIT_ALLOW_DISABLED_CAPABILITY');
            } else {
                const allow = await updateAccess(account, { pageAllowlist: [entry.aliases[0] || entry.key] }, creatorToken);
                assert.equal(allow.status, 200, `${entry.key} allow: ${JSON.stringify(allow.data)}`);
                assert.deepEqual(allow.data?.pageAllowlist, [entry.key], `${entry.key}: allowlist must canonicalize`);
                account.token = await login(account.username, account.password);
                const allowed = await permissions(account.token);
                assert.equal(allowed.pages[entry.key], true, `${entry.key}: explicit page allow must allow`);
                assert.equal(allowed.capabilities[`page:${entry.key}`]?.source, 'explicit_allow', `${entry.key}: page allow source`);
            }

            const deny = await updateAccess(account, { pageDenylist: [entry.aliases[0] || entry.key] }, creatorToken);
            assert.equal(deny.status, 200, `${entry.key} deny: ${JSON.stringify(deny.data)}`);
            assert.deepEqual(deny.data?.pageDenylist, [entry.key], `${entry.key}: denylist must canonicalize`);
            account.token = await login(account.username, account.password);
            const denied = await permissions(account.token);
            assert.equal(denied.pages[entry.key], false, `${entry.key}: explicit page deny must deny`);
            assert.equal(denied.capabilities[`page:${entry.key}`]?.source, 'explicit_deny', `${entry.key}: page deny source`);
        }
    });

    it('checks every active action contract through access PATCH, relogin, and /api/auth/permissions', async () => {
        const creatorToken = await getToken();
        const account = accounts.matrix;

        for (const entry of activeActionEntries()) {
            const contract = ACTION_PERMISSION_TEST_CONTRACTS[entry.key];
            assert.ok(contract, `${entry.key}: missing executable action contract`);

            if (entry.delegable === false || entry.explicitAllow === false) {
                const rejected = await updateAccess(account, { actionAllowlist: [entry.key] }, creatorToken);
                assert.ok([200, 400].includes(rejected.status), `${entry.key}: explicit allow must be ignored or rejected safely`);
                if (rejected.status === 400) {
                    assert.ok(
                        ['NON_DELEGABLE_CAPABILITY_KEYS', 'EXPLICIT_ALLOW_DISABLED_CAPABILITY'].includes(rejected.data?.code),
                        `${entry.key}: unexpected rejection code ${JSON.stringify(rejected.data)}`
                    );
                }
                account.token = await login(account.username, account.password);
                const ignored = await permissions(account.token);
                assert.equal(ignored.capabilities[`action:${entry.key}`]?.allowed, false, `${entry.key}: explicit allow must not grant non-delegable/disabled action`);
            } else {
                const allow = await updateAccess(account, { actionAllowlist: [entry.aliases[0] || entry.key] }, creatorToken);
                assert.equal(allow.status, 200, `${entry.key} allow: ${JSON.stringify(allow.data)}`);
                assert.deepEqual(allow.data?.actionAllowlist, [entry.key], `${entry.key}: action allowlist must canonicalize`);
                account.token = await login(account.username, account.password);
                const allowed = await permissions(account.token);
                assert.equal(allowed.capabilities[`action:${entry.key}`]?.allowed, true, `${entry.key}: explicit action allow must allow`);
                assert.equal(allowed.capabilities[`action:${entry.key}`]?.source, 'explicit_allow', `${entry.key}: action allow source`);
            }

            const deny = await updateAccess(account, { actionDenylist: [entry.key] }, creatorToken);
            assert.equal(deny.status, 200, `${entry.key} deny: ${JSON.stringify(deny.data)}`);
            assert.deepEqual(deny.data?.actionDenylist, [entry.key], `${entry.key}: denylist must store canonical key`);
            account.token = await login(account.username, account.password);
            const denied = await permissions(account.token);
            assert.equal(denied.capabilities[`action:${entry.key}`]?.allowed, false, `${entry.key}: explicit action deny must deny`);
            assert.equal(denied.capabilities[`action:${entry.key}`]?.source, 'explicit_deny', `${entry.key}: action deny source`);
        }
    });

    it('allows Admin Today and Schedule while denying Reports, export, and schedule mutation', async () => {
        const token = accounts.admin.token;
        const snapshot = await permissions(token);
        assert.equal(snapshot.pages['/hr'], true, 'sidebar page must be visible');
        assert.equal(snapshot.capabilities['action:hr.today.view'].allowed, true);
        assert.equal(snapshot.capabilities['action:hr.today.view'].source, 'explicit_allow');
        assert.equal(snapshot.capabilities['action:hr.schedule.view'].allowed, true);
        assert.equal(snapshot.capabilities['action:hr.reports.view'].allowed, false);
        assert.equal(snapshot.capabilities['action:hr.reports.view'].source, 'explicit_deny');

        const date = testDate();
        const today = await request('GET', `/api/hr/today?date=${date}`, null, token);
        assert.equal(today.status, 200, `Today GET: ${JSON.stringify(today.data)}`);
        const schedule = await request('GET', `/api/hr/shifts?from=${date}&to=${date}`, null, token);
        assert.equal(schedule.status, 200, `Schedule GET: ${JSON.stringify(schedule.data)}`);

        const report = await request('GET', `/api/hr/report/daily?date=${date}`, null, token);
        assert.equal(report.status, 403, 'direct #reports data GET must be denied');
        assert.equal(report.data?.code, 'HR_CAPABILITY_REQUIRED');
        const exportResponse = await request('GET', `/api/hr/report/export?from=${date}&to=${date}`, null, token);
        assert.equal(exportResponse.status, 403, 'report export must be denied');
        const mutation = await request('POST', '/api/hr/shifts', { deliberatelyInvalid: true }, token);
        assert.equal(mutation.status, 403, 'mutation must be rejected before parsing or writing payload');
    });

    it('persists canonical page deny, preserves it for legacy PATCH, and resets to inherited access', async () => {
        const creatorToken = await getToken();
        const account = accounts.admin;
        const inherited = await permissions(account.token);
        assert.equal(inherited.pages['/reports'], true);
        assert.equal(inherited.capabilities['page:/reports'].source, 'role_preset');
        assert.equal(inherited.capabilities['page:/reports'].sourceRole, 'accountant');
        assert.deepEqual(inherited.pageDenylist, []);

        const conflict = await request('PATCH', `/api/users/${account.id}/access`, {
            role: account.role,
            pageAllowlist: ['/chat'],
            pageDenylist: ['/kleshnya']
        }, creatorToken);
        assert.equal(conflict.status, 400);
        assert.equal(conflict.data?.code, 'CAPABILITY_ALLOW_DENY_CONFLICT');
        assert.deepEqual(conflict.data?.details?.conflicts, ['/chat']);

        const unknown = await request('PATCH', `/api/users/${account.id}/access`, {
            role: account.role,
            pageDenylist: ['/unknown-page-deny']
        }, creatorToken);
        assert.equal(unknown.status, 400);
        assert.equal(unknown.data?.code, 'UNKNOWN_CAPABILITY_KEYS');

        const deny = await request('PATCH', `/api/users/${account.id}/access`, {
            role: account.role,
            pageDenylist: ['/reports.html']
        }, creatorToken);
        assert.equal(deny.status, 200, JSON.stringify(deny.data));
        assert.deepEqual(deny.data?.pageDenylist, ['/reports']);
        account.token = await login(account.username, account.password);
        const denied = await permissions(account.token);
        assert.equal(denied.pages['/reports'], false);
        assert.equal(denied.capabilities['page:/reports'].source, 'explicit_deny');
        assert.deepEqual(denied.pageDenylist, ['/reports']);

        const compatibility = await request('PATCH', `/api/users/${account.id}/access`, {
            role: account.role,
            actionAllowlist: account.actionAllowlist,
            actionDenylist: account.actionDenylist
        }, creatorToken);
        assert.equal(compatibility.status, 200, JSON.stringify(compatibility.data));
        assert.deepEqual(compatibility.data?.pageDenylist, ['/reports']);
        account.token = await login(account.username, account.password);
        assert.equal((await permissions(account.token)).pages['/reports'], false);

        const reset = await request('PATCH', `/api/users/${account.id}/access`, {
            role: account.role,
            pageDenylist: []
        }, creatorToken);
        assert.equal(reset.status, 200, JSON.stringify(reset.data));
        assert.deepEqual(reset.data?.pageDenylist, []);
        account.token = await login(account.username, account.password);
        const resetPermissions = await permissions(account.token);
        assert.equal(resetPermissions.pages['/reports'], true);
        assert.equal(resetPermissions.capabilities['page:/reports'].source, 'role_preset');
    });

    it('rejects unknown/conflicting PATCH keys and preserves effective access after relogin', async () => {
        const creatorToken = await getToken();
        const account = accounts.admin;
        const conflict = await request('PATCH', `/api/users/${account.id}/access`, {
            role: account.role,
            actionAllowlist: ['hr.reports.view'],
            actionDenylist: ['hr.reports.view']
        }, creatorToken);
        assert.equal(conflict.status, 400);

        const unknown = await request('PATCH', `/api/users/${account.id}/access`, {
            role: account.role,
            actionAllowlist: ['not_a_real_capability']
        }, creatorToken);
        assert.equal(unknown.status, 400);

        await new Promise(resolve => setTimeout(resolve, 1100));
        const update = await request('PATCH', `/api/users/${account.id}/access`, {
            role: account.role,
            extraRoles: [],
            pageAllowlist: ['/hr'],
            actionAllowlist: account.actionAllowlist,
            actionDenylist: account.actionDenylist,
            businessContexts: ['event_genix'],
            defaultBusinessContext: 'event_genix'
        }, creatorToken);
        assert.equal(update.status, 200, JSON.stringify(update.data));

        const currentToken = await request('GET', '/api/auth/permissions', null, account.token);
        assert.ok([200, 403].includes(currentToken.status), 'existing token must be revoked or rehydrated from fresh access state');
        if (currentToken.status === 200) {
            assert.equal(currentToken.data?.capabilities?.['action:hr.reports.view']?.allowed, false);
            assert.equal(currentToken.data?.capabilities?.['action:hr.reports.export']?.allowed, false);
        }
        account.token = await login(account.username, account.password);
        const afterRelogin = await permissions(account.token);
        assert.equal(afterRelogin.capabilities['action:hr.schedule.view'].allowed, true);
        assert.equal(afterRelogin.capabilities['action:hr.reports.view'].allowed, false);
        assert.equal(afterRelogin.capabilities['action:hr.reports.export'].allowed, false);
    });
});
