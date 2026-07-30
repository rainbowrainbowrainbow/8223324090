/**
 * Token-backed permission matrix against an isolated, disposable PostgreSQL database.
 * This file must only be run through scripts/run-isolated-postgres-tests.js permissions.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, it, before } = require('node:test');
const { getToken, request, testDate } = require('../helpers');

const enabled = process.env.RUN_PERMISSION_CAPABILITIES_INTEGRATION === 'true';
const accounts = Object.create(null);

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

describe('disposable token-backed permission capability contract', { skip: !enabled }, () => {
    before(async () => {
        requireDisposableTarget();
        const creatorToken = await getToken();
        const suffix = `${process.pid}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
        const definitions = [
            {
                key: 'admin',
                role: 'admin',
                actionAllowlist: ['hr.today.view', 'hr.schedule.view'],
                actionDenylist: ['hr.schedule.manage', 'hr.reports.view', 'hr.reports.export']
            },
            { key: 'manager', role: 'manager', actionAllowlist: [], actionDenylist: [] },
            { key: 'hr', role: 'hr', actionAllowlist: [], actionDenylist: [] }
        ];

        for (const definition of definitions) {
            const username = `permission_${definition.key}_${suffix}`;
            const password = `Safe-${crypto.randomBytes(14).toString('base64url')}`;
            const response = await request('POST', '/api/users', {
                username,
                password,
                name: `Disposable Permission QA ${definition.key} ${suffix}`,
                role: definition.role,
                extraRoles: [],
                pageAllowlist: ['/hr'],
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
                actionAllowlist: definition.actionAllowlist,
                actionDenylist: definition.actionDenylist,
                token: await login(username, password)
            };
        }
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

        const revoked = await request('GET', '/api/auth/permissions', null, account.token);
        assert.equal(revoked.status, 403, 'access PATCH must apply the new deny to the existing token');
        account.token = await login(account.username, account.password);
        const afterRelogin = await permissions(account.token);
        assert.equal(afterRelogin.capabilities['action:hr.schedule.view'].allowed, true);
        assert.equal(afterRelogin.capabilities['action:hr.reports.view'].allowed, false);
        assert.equal(afterRelogin.capabilities['action:hr.reports.export'].allowed, false);
    });
});
