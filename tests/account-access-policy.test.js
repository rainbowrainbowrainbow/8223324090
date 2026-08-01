'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    CapabilityValidationError,
    normalizeCapability,
    normalizeCapabilityList,
    normalizePageAllowlist,
    normalizePageDenylist,
    assertNoCapabilityConflicts,
    resolveCapability,
    buildCapabilitySnapshot
} = require('../services/accountAccessPolicy');

test('resolveCapability applies deny, allow, role preset, then default deny', () => {
    const denied = resolveCapability({
        role: 'director',
        action_allowlist: ['delete_booking'],
        action_denylist: ['delete_booking']
    }, 'delete_booking');
    assert.equal(denied.allowed, false);
    assert.equal(denied.source, 'explicit_deny');
    assert.equal(denied.sourceRole, null);
    assert.equal(denied.reason, 'listed_in_explicit_deny');

    const explicitlyAllowed = resolveCapability({
        role: 'animator',
        action_allowlist: ['delete_booking']
    }, 'delete_booking');
    assert.equal(explicitlyAllowed.allowed, true);
    assert.equal(explicitlyAllowed.source, 'explicit_allow');

    const roleAllowed = resolveCapability({ role: 'hr' }, 'view_payroll');
    assert.equal(roleAllowed.allowed, true);
    assert.equal(roleAllowed.source, 'role_preset');
    assert.equal(roleAllowed.sourceRole, 'hr');

    const defaultDenied = resolveCapability({ role: 'animator' }, 'view_payroll');
    assert.equal(defaultDenied.allowed, false);
    assert.equal(defaultDenied.source, 'default_deny');
    assert.equal(defaultDenied.reason, 'no_matching_grant');
});

test('page permissions support inherited, explicit allow, and explicit deny', () => {
    const inherited = resolveCapability({ role: 'director' }, '/reports', { type: 'page' });
    assert.deepEqual(
        [inherited.allowed, inherited.source, inherited.sourceRole, inherited.reason],
        [true, 'role_preset', 'director', 'granted_by_role_preset']
    );

    const explicitlyAllowed = resolveCapability({
        role: 'animator',
        page_allowlist: ['/reports']
    }, '/reports', { type: 'page' });
    assert.deepEqual(
        [explicitlyAllowed.allowed, explicitlyAllowed.source, explicitlyAllowed.sourceRole, explicitlyAllowed.reason],
        [true, 'explicit_allow', null, 'listed_in_explicit_allow']
    );

    const explicitlyDenied = resolveCapability({
        role: 'director',
        page_allowlist: ['/reports'],
        page_denylist: ['/reports']
    }, '/reports', { type: 'page' });
    assert.deepEqual(
        [explicitlyDenied.allowed, explicitlyDenied.source, explicitlyDenied.sourceRole, explicitlyDenied.reason],
        [false, 'explicit_deny', null, 'listed_in_explicit_deny']
    );

    const legacyUser = resolveCapability({ role: 'director' }, '/reports', { type: 'page' });
    assert.equal(legacyUser.allowed, true);
    assert.deepEqual(normalizePageDenylist({ role: 'director' }), []);
});

test('unknown capability keys fail closed and strict writes reject them', () => {
    const decision = resolveCapability({ role: 'creator' }, 'unknown_permission');
    assert.equal(decision.allowed, false);
    assert.equal(decision.source, 'default_deny');
    assert.equal(decision.reason, 'unknown_capability');

    assert.throws(
        () => normalizeCapabilityList(['delete_booking', 'unknown_permission'], 'action', {
            strict: true,
            fieldName: 'actionAllowlist'
        }),
        error => error instanceof CapabilityValidationError
            && error.statusCode === 400
            && error.code === 'UNKNOWN_CAPABILITY_KEYS'
            && error.details.unknownKeys.includes('unknown_permission')
    );
});

test('legacy page aliases canonicalize for reads and writes', () => {
    assert.equal(normalizeCapability('/kleshnya', { type: 'page' }).key, '/chat');
    assert.equal(normalizeCapability('/art-director', { type: 'page' }).key, '/art');
    assert.equal(normalizeCapability('/analytics', { type: 'page' }).key, '/finance');
    assert.equal(normalizeCapability('/leads', { type: 'page' }).key, '/sales-funnel');
    assert.equal(normalizeCapability('/booking-summary.html', { type: 'page' }).key, '/booking-summary.html');
    assert.equal(normalizeCapability('/booking-summary', { type: 'page' }).key, '/booking-summary.html');
    assert.deepEqual(
        normalizePageAllowlist({ page_allowlist: ['/kleshnya', '/chat', '/hr.html'] }),
        ['/chat', '/hr']
    );
    assert.deepEqual(
        normalizePageDenylist({ page_denylist: ['/kleshnya', '/chat', '/hr.html'] }),
        ['/chat', '/hr']
    );
    const aliasDeny = resolveCapability({ role: 'creator', page_denylist: ['/kleshnya'] }, '/chat');
    assert.deepEqual([aliasDeny.allowed, aliasDeny.source], [false, 'explicit_deny']);

    const aliasGrant = resolveCapability({ role: 'animator', page_allowlist: ['/analytics'] }, '/finance');
    assert.equal(aliasGrant.allowed, false);
    assert.equal(aliasGrant.reason, 'explicit_allow_disabled');

    const specialPageGrant = resolveCapability({ role: 'animator', page_allowlist: ['/maysternya-doli'] }, '/maysternya-doli');
    assert.equal(specialPageGrant.allowed, false);
    assert.equal(specialPageGrant.reason, 'explicit_allow_disabled');
    assert.equal(resolveCapability({ role: 'creator' }, '/maysternya-doli').allowed, true);
});

test('canonical allow and deny conflicts are rejected', () => {
    assert.throws(
        () => assertNoCapabilityConflicts(['/analytics'], ['/finance'], 'page'),
        error => error instanceof CapabilityValidationError
            && error.code === 'CAPABILITY_ALLOW_DENY_CONFLICT'
            && error.details.conflicts.includes('/finance')
    );
});

test('non-delegable account permissions require the primary role preset', () => {
    const explicitAllow = resolveCapability({
        role: 'animator',
        action_allowlist: ['manage_accounts']
    }, 'manage_accounts');
    assert.equal(explicitAllow.allowed, false);
    assert.equal(explicitAllow.reason, 'non_delegable_explicit_allow_ignored');

    const extraRole = resolveCapability({
        role: 'animator',
        extra_roles: ['director']
    }, 'manage_accounts');
    assert.equal(extraRole.allowed, false);

    const primaryRole = resolveCapability({ role: 'director' }, 'manage_accounts');
    assert.equal(primaryRole.allowed, true);
    assert.equal(primaryRole.source, 'role_preset');
    assert.equal(primaryRole.sourceRole, 'director');

    const explicitDeny = resolveCapability({
        role: 'director',
        action_denylist: ['manage_accounts']
    }, 'manage_accounts');
    assert.equal(explicitDeny.allowed, false);
    assert.equal(explicitDeny.source, 'explicit_deny');
});

test('capability snapshot preserves compatibility maps and structured decisions', () => {
    const snapshot = buildCapabilitySnapshot({
        role: 'manager',
        page_allowlist: ['/analytics'],
        page_denylist: ['/reports'],
        action_denylist: ['export_data']
    });

    assert.equal(Object.keys(snapshot.pages).length, 42);
    assert.equal(Object.keys(snapshot.actions).length, 29);
    assert.equal(snapshot.pages['/analytics'], undefined);
    assert.equal(snapshot.pages['/finance'], false);
    assert.equal(snapshot.actions.export_data, false);
    assert.equal(snapshot.decisions['page:/finance'].reason, 'explicit_allow_disabled');
    assert.equal(snapshot.decisions['page:/reports'].source, 'explicit_deny');
    assert.equal(snapshot.decisions['action:export_data'].source, 'explicit_deny');
    assert.equal(snapshot.catalog.pageAliases['/analytics'], '/finance');
    assert.ok(snapshot.catalog.nonDelegableActions.includes('manage_accounts'));
    assert.ok(snapshot.catalog.explicitAllowDisabledPages.includes('/finance'));
    assert.ok(snapshot.catalog.explicitAllowDisabledActions.includes('finance.manage'));
});

test('Finance explicit grants are rejected by strict account-access writes', () => {
    assert.throws(
        () => normalizeCapabilityList(['/finance'], 'page', {
            strict: true,
            excludeExplicitAllowDisabled: true,
            fieldName: 'pageAllowlist'
        }),
        error => error instanceof CapabilityValidationError
            && error.code === 'EXPLICIT_ALLOW_DISABLED_CAPABILITY'
            && error.details.explicitAllowDisabledKeys.includes('/finance')
    );
    assert.throws(
        () => normalizeCapabilityList(['finance.manage'], 'action', {
            strict: true,
            excludeExplicitAllowDisabled: true,
            fieldName: 'actionAllowlist'
        }),
        error => error instanceof CapabilityValidationError
            && error.code === 'EXPLICIT_ALLOW_DISABLED_CAPABILITY'
            && error.details.explicitAllowDisabledKeys.includes('finance.manage')
    );
});
test('page deny migration is additive, idempotent, and does not rewrite users', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '..', 'db', 'migrations', '311_user_page_permission_denies.sql'),
        'utf8'
    );
    assert.match(migration, /-- MIGRATION_KIND: schema/);
    assert.match(migration, /-- SAFETY:/);
    assert.match(migration, /-- ROLLBACK:/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS page_denylist TEXT\[\] NOT NULL DEFAULT '\{\}'::text\[\]/);
    assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_users_page_denylist_gin/);
    assert.doesNotMatch(migration, /^\s*(UPDATE|INSERT|DELETE)\b/im);
});