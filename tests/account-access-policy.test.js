'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    CapabilityValidationError,
    normalizeCapability,
    normalizeCapabilityList,
    normalizePageAllowlist,
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

    const aliasGrant = resolveCapability({ role: 'animator', page_allowlist: ['/analytics'] }, '/finance');
    assert.equal(aliasGrant.allowed, true);
    assert.equal(aliasGrant.source, 'explicit_allow');

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
        action_denylist: ['export_data']
    });

    assert.equal(Object.keys(snapshot.pages).length, 42);
    assert.equal(Object.keys(snapshot.actions).length, 28);
    assert.equal(snapshot.pages['/analytics'], undefined);
    assert.equal(snapshot.pages['/finance'], true);
    assert.equal(snapshot.actions.export_data, false);
    assert.equal(snapshot.decisions['page:/finance'].source, 'explicit_allow');
    assert.equal(snapshot.decisions['action:export_data'].source, 'explicit_deny');
    assert.equal(snapshot.catalog.pageAliases['/analytics'], '/finance');
    assert.ok(snapshot.catalog.nonDelegableActions.includes('manage_accounts'));
});
