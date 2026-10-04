'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const hrSource = fs.readFileSync(path.join(root, 'routes/hr.js'), 'utf8');
const staffSource = fs.readFileSync(path.join(root, 'routes/staff.js'), 'utf8');
const lifecycleSource = fs.readFileSync(path.join(root, 'services/staffLifecycle.js'), 'utf8');
const ownerGuard = require('../services/organizationOwnership');

function namedFunction(source, name) {
    const match = source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n}'));
    assert.ok(match, `Missing function ${name}`);
    return match[0];
}

function loadLifecycle(events) {
    const securityContext = vm.createContext({
        module: { exports: {} },
        require(name) {
            if (name === '../db') return { pool: {} };
            if (name === '../utils/logger') return { createLogger: () => ({ warn() {} }) };
            throw new Error(`Unexpected security dependency: ${name}`);
        }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'services/accountSecurity.js'), 'utf8'), securityContext);
    const security = securityContext.module.exports;
    const context = vm.createContext({
        module: { exports: {} },
        require(name) {
            if (name === './organizationOwnership') return ownerGuard;
            if (name === './accountSecurity') return { recordAccountSecurityEvent: async event => {
                await security.recordAccountSecurityEvent(event);
                events.push(event);
            } };
            if (name === './booking') return { reconcileScheduledAnimatorLines: async () => ({}) };
            throw new Error(`Unexpected dependency: ${name}`);
        }
    });
    vm.runInContext(lifecycleSource, context);
    return context.module.exports.syncLinkedStaffAccountDeactivation;
}

function fixture({ accounts = [{ id: 77, username: 'qa.staff', role: 'animator', profile_id: 770 }], failAt = '', ownerRows = [] } = {}) {
    const calls = [];
    const events = [];
    const failure = new Error('Synthetic deactivation database failure');
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ text, params });
            if (failAt && text.startsWith(failAt)) throw failure;
            if (text.startsWith('SELECT u.id')) return { rows: accounts };
            if (text.startsWith('SELECT om.organization_id')) return { rows: ownerRows };
            if (text.startsWith('UPDATE employee_profiles')) return { rows: [], rowCount: accounts.length };
            if (text.startsWith('UPDATE users')) return { rows: accounts, rowCount: accounts.length };
            if (text.startsWith('INSERT INTO staff_offboarding_events')) return { rows: [{ id: 91, account_action: params[4] }] };
            if (text.startsWith('UPDATE staff')) return { rows: [{ id: 42, is_active: false }] };
            return { rows: [] };
        },
        release() { calls.push({ text: 'RELEASE', params: [] }); }
    };
    return { calls, events, failure, client, deactivate: loadLifecycle(events) };
}

const options = {
    actor: { id: 1, role: 'creator' },
    requireAllAccountsDisabled: true,
    canDisableAccount: account => account.role !== 'creator',
    blockReason: () => 'protected_role'
};

test('strict dismissal disables linked users and profiles, revokes sessions and records security audit', async () => {
    const f = fixture();
    const result = await f.deactivate(f.client, 42, options);
    assert.equal(result.disabled_accounts, 1);
    assert.equal(result.account_deactivation_blocked, false);
    assert.ok(f.calls.some(call => /session_revoked_at = clock_timestamp\(\)/.test(call.text)));
    assert.ok(f.calls.some(call => call.text.startsWith('UPDATE refresh_tokens')));
    assert.equal(f.events[0].eventType, 'account_deactivated');
    assert.equal(f.events[0].details.sessionsRevoked, true);
    assert.ok(f.calls.findIndex(call => call.text.startsWith('SELECT om.organization_id')) < f.calls.findIndex(call => call.text.startsWith('UPDATE users')));
    assert.match(f.calls.find(call => call.text.startsWith('SELECT u.id')).text, /FOR UPDATE OF ep, u/);
    assert.doesNotMatch(f.calls.find(call => call.text.startsWith('SELECT u.id')).text, /ep\.is_active/);
});

test('strict dismissal rejects the whole batch before writes when even one account is protected', async () => {
    const f = fixture({ accounts: [{ id: 77, role: 'animator' }, { id: 78, role: 'creator' }] });
    await assert.rejects(f.deactivate(f.client, 42, options), error => error.code === 'account_deactivation_blocked' && error.statusCode === 409 && error.blockers.length === 1);
    assert.equal(f.calls.some(call => /^(UPDATE|INSERT|DELETE)/.test(call.text)), false);
    assert.equal(f.events.length, 0);
});

test('strict dismissal rejects missing account permission with 403 and cannot silently skip a blocker without a reason', async () => {
    for (const reason of ['requires_manage_accounts', null]) {
        const f = fixture();
        await assert.rejects(f.deactivate(f.client, 42, { ...options, canDisableAccount: () => false, blockReason: () => reason }), error => error.code === 'account_deactivation_blocked' && error.statusCode === (reason ? 403 : 409));
        assert.equal(f.calls.some(call => /^(UPDATE|INSERT|DELETE)/.test(call.text)), false);
    }
});

test('strict dismissal propagates account lookup, profile update, token revoke and audit errors', async () => {
    for (const failAt of ['SELECT u.id', 'UPDATE employee_profiles', 'UPDATE refresh_tokens', 'INSERT INTO account_security_events']) {
        const f = fixture({ failAt });
        await assert.rejects(f.deactivate(f.client, 42, options), error => error === f.failure);
        assert.equal(f.events.length, 0, `${failAt} must not report successful security audit`);
    }
});

test('strict dismissal preserves last organization owner protection', async () => {
    const f = fixture({ ownerRows: [{ organization_id: 9 }] });
    await assert.rejects(f.deactivate(f.client, 42, options), { code: 'organization_last_owner' });
    assert.equal(f.calls.some(call => /UPDATE users|UPDATE refresh_tokens/.test(call.text)), false);
});

function routeHarness(f, readiness = { active_account_count: 1, disable_available: true }) {
    const marker = "router.post('/staff/:id/offboarding', requireHrManage, ";
    const start = hrSource.indexOf(marker) + marker.length;
    assert.ok(start >= marker.length);
    const end = hrSource.indexOf('\n});', start);
    const context = vm.createContext({
        pool: { connect: async () => f.client },
        cleanStaffText: value => value || null,
        cleanStaffDate: value => value || null,
        todayKyiv: () => '2026-10-04',
        normalizeStaffOffboardingPoolStatus: () => 'reserve',
        lockOrganizationOwnership: ownerGuard.lockOrganizationOwnership,
        loadStaffRowOrNull: async () => ({ id: 42 }),
        loadStaffOffboardingReadiness: async () => readiness,
        loadStaffOutstandingPayrollInstallments: async () => ({ count: 0 }),
        cleanupFutureStaffOperationalSchedule: async () => ({ dates: [] }),
        actorCanDisableOffboardingAccount: (actor, account) => account.role !== 'creator',
        accountOffboardingBlockReason: () => 'protected_role',
        staffOffboardingAccountMeta: account => account,
        syncLinkedStaffAccountDeactivation: f.deactivate,
        staffOffboardingDisableError: () => 'Protected CRM account',
        broadcastRosterDates: () => {},
        auditLog: async () => {},
        log: { error() {}, warn() {} }
    });
    vm.runInContext('handler = ' + hrSource.slice(start, end + 2), context);
    return async body => {
        const result = { status: 200 };
        const res = { status(code) { result.status = code; return this; }, json(value) { result.body = value; return this; } };
        await context.handler({ body: { reason: 'QA dismissal', ...body }, params: { id: '42' }, user: options.actor }, res);
        return result;
    };
}

test('dismissal always disables accounts for omitted, legacy review, legacy none and malformed actions', async () => {
    for (const action of [undefined, 'review', 'none', 'disable', 'invalid']) {
        const f = fixture();
        const result = await routeHarness(f)({ account_action: action });
        assert.equal(result.status, 200, String(action));
        assert.equal(result.body.data.account_action, 'disable');
        assert.equal(result.body.disabled_accounts, 1);
        assert.ok(f.calls.some(call => call.text === 'COMMIT'));
    }
});

test('dismissal without accounts records the same automatic disable policy', async () => {
    const f = fixture({ accounts: [] });
    const result = await routeHarness(f, { active_account_count: 0, disable_available: true })({ account_action: 'none' });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.account_action, 'disable');
    assert.equal(result.body.disabled_accounts, 0);
});

test('dismissal rolls back if a protected linked account appears after readiness', async () => {
    const f = fixture({ accounts: [{ id: 78, role: 'creator' }] });
    const result = await routeHarness(f, { active_account_count: 0, disable_available: true })({ account_action: 'none' });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'account_deactivation_blocked');
    assert.equal(f.calls.some(call => call.text === 'COMMIT'), false);
    assert.ok(f.calls.some(call => call.text === 'ROLLBACK'));
});

test('dismissal rolls back instead of returning success when account lookup, token revoke or security audit fails', async () => {
    for (const failAt of ['SELECT u.id', 'UPDATE refresh_tokens', 'INSERT INTO account_security_events']) {
        const f = fixture({ failAt });
        const result = await routeHarness(f)({});
        assert.equal(result.status, 500);
        assert.equal(f.calls.some(call => call.text === 'COMMIT'), false);
        assert.ok(f.calls.some(call => call.text === 'ROLLBACK'));
    }
});

test('readiness checks extra roles on raw accounts and includes active users with inactive staff profiles', async () => {
    const calls = [];
    const context = vm.createContext({
        pool: {},
        staffOffboardingAccountMeta: row => ({ id: row.id, role: row.role }),
        staffOffboardingResourceMeta: row => row,
        staffOffboardingDocumentAlertMeta: row => row,
        accountOffboardingBlockReason: (actor, row) => row.extra_roles?.includes('creator') ? 'protected_role' : null,
        loadStaffOutstandingPayrollInstallments: async () => ({ count: 0 })
    });
    vm.runInContext(namedFunction(hrSource, 'loadStaffOffboardingReadiness'), context);
    const db = { async query(sql) {
        calls.push(sql);
        if (sql.includes('JOIN users u')) return { rows: [{ id: 78, role: 'animator', extra_roles: ['creator'] }] };
        return { rows: [] };
    } };
    const readiness = await context.loadStaffOffboardingReadiness(42, db, { actor: options.actor });
    assert.equal(readiness.active_account_count, 1);
    assert.equal(readiness.disable_available, false);
    assert.equal(readiness.disable_blockers[0].block_reason, 'protected_role');
    assert.doesNotMatch(calls.find(sql => sql.includes('JOIN users u')), /ep\.is_active/);
});

test('every staff dismissal entrypoint requires complete account deactivation and handles rollback errors', () => {
    for (const [source, marker] of [
        [hrSource, "router.put('/staff/:id/status'"],
        [staffSource, "router.put('/:id',"],
        [staffSource, "router.delete('/:id',"]
    ]) {
        const start = source.indexOf(marker);
        assert.ok(start >= 0, marker);
        const route = source.slice(start, source.indexOf('\n});', start));
        assert.match(route, /requireAllAccountsDisabled: true/);
        assert.match(route, /err\.code === 'account_deactivation_blocked'/);
        assert.match(route, /client\.query\('ROLLBACK'\)/);
    }
});

test('legacy staff dismissal preserves creator, system and self guards independently of account-management privileges', () => {
    const context = vm.createContext({
        isProtectedSystemAccount: account => account.username === 'qa.system',
        normalizeAccountRoleSet: (...roles) => roles.flat(),
        canActorManageAccount: () => true
    });
    vm.runInContext(namedFunction(staffSource, 'canDisableLinkedStaffAccount'), context);
    for (const target of [
        { id: 1, role: 'animator' },
        { id: 77, role: 'creator' },
        { id: 77, role: 'animator', extra_roles: ['creator'] },
        { id: 77, role: 'animator', username: 'qa.system' }
    ]) assert.equal(context.canDisableLinkedStaffAccount(options.actor, target), false);
    assert.equal(context.canDisableLinkedStaffAccount(options.actor, { id: 77, role: 'animator' }), true);
});


test('HR dismissal checks primary and extra roles without weakening director, creator, self or system protection', () => {
    const context = vm.createContext({
        ROLE_LEVEL: { creator: 100, director: 90, animator: 10 },
        canUseAction: actor => actor?.manageAccounts === true,
        isProtectedSystemAccount: account => account.username === 'qa.system'
    });
    for (const name of ['accountHasCreatorRole', 'accountRoleLevel', 'accountRoleSet', 'accountMaxRoleLevel', 'actorCanDisableOffboardingAccount', 'accountOffboardingBlockReason']) {
        vm.runInContext(namedFunction(hrSource, name), context);
    }
    const director = { id: 2, role: 'director', manageAccounts: true };
    const creator = { id: 1, role: 'creator', manageAccounts: true };
    for (const target of [
        { id: 77, role: 'creator' },
        { id: 77, role: 'animator', extra_roles: ['creator'] },
        { id: 77, role: 'animator', username: 'qa.system' }
    ]) {
        assert.equal(context.actorCanDisableOffboardingAccount(director, target), false);
        assert.equal(context.actorCanDisableOffboardingAccount(creator, target), false);
    }
    assert.equal(context.actorCanDisableOffboardingAccount(director, { id: 2, role: 'animator' }), false);
    assert.equal(context.actorCanDisableOffboardingAccount(director, { id: 77, role: 'director' }), false);
    assert.equal(context.actorCanDisableOffboardingAccount(director, { id: 77, role: 'animator', extra_roles: ['director'] }), false);
    assert.equal(context.actorCanDisableOffboardingAccount(creator, { id: 77, role: 'director' }), true);
    assert.equal(context.actorCanDisableOffboardingAccount(director, { id: 77, role: 'animator' }), true);
    assert.equal(context.accountOffboardingBlockReason({ id: 3, role: 'hr' }, { id: 77, role: 'animator' }), 'requires_manage_accounts');
});
