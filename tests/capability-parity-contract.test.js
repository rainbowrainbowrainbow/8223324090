'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const registry = require('../config/permissionRegistry');
const policy = require('../services/accountAccessPolicy');

const ROOT = path.resolve(__dirname, '..');

function loadFrontendResolver() {
    const filename = path.join(ROOT, 'js', 'auth.js');
    const source = fs.readFileSync(filename, 'utf8');
    const start = source.indexOf('function _normalizePagePath(page)');
    const end = source.indexOf("if (typeof window !== 'undefined')", start);
    assert.ok(start >= 0 && end > start, 'unable to locate frontend capability resolver');

    const catalog = policy.buildCapabilityCatalog();
    const sandbox = {
        PAGE_ACCESS: catalog.pageRoles,
        ACTION_PERMISSIONS: catalog.actionRoles,
        PAGE_CAPABILITY_ALIASES: catalog.pageAliases,
        ACTION_CAPABILITY_ALIASES: catalog.actionAliases,
        ACTION_LEGACY_KEYS: catalog.actionLegacyKeys,
        EXPLICIT_ALLOW_DISABLED_PAGES: new Set(catalog.explicitAllowDisabledPages),
        NON_DELEGABLE_ACTIONS: new Set(catalog.nonDelegableActions),
        AppState: { currentUser: null, authPermissions: null },
        frontendResolver: null
    };
    vm.runInNewContext(`${source.slice(start, end)}\nfrontendResolver = resolveCapability;`, sandbox, { filename });
    return sandbox.frontendResolver;
}

const frontendResolveCapability = loadFrontendResolver();

function comparable(decision) {
    return {
        allowed: decision.allowed,
        source: decision.source,
        sourceRole: decision.sourceRole,
        reason: decision.reason,
        capability: decision.capability,
        type: decision.type,
        key: decision.key,
        requestedKey: decision.requestedKey
    };
}

function assertParity(user, capability, context = {}) {
    const backend = policy.resolveCapability(user, capability, context);
    const frontend = frontendResolveCapability(user, capability, {
        ...context,
        ignoreServer: true
    });
    assert.deepEqual(
        comparable(frontend),
        comparable(backend),
        `${backend.capability} diverged for ${JSON.stringify(user)}`
    );
    return backend;
}

test('truth table preserves deny, allow, primary role, extra role, and default-deny precedence', () => {
    const rows = [
        {
            label: 'explicit deny wins over explicit allow and primary role',
            user: { role: 'director', action_allowlist: ['delete_booking'], action_denylist: ['delete_booking'] },
            capability: 'delete_booking',
            expected: [false, 'explicit_deny', null, 'listed_in_explicit_deny']
        },
        {
            label: 'explicit allow wins over default deny',
            user: { role: 'animator', action_allowlist: ['delete_booking'] },
            capability: 'delete_booking',
            expected: [true, 'explicit_allow', null, 'listed_in_explicit_allow']
        },
        {
            label: 'primary role preset grants access',
            user: { role: 'director' },
            capability: 'delete_booking',
            expected: [true, 'role_preset', 'director', 'granted_by_role_preset']
        },
        {
            label: 'extra role preset grants delegable access',
            user: { role: 'animator', extra_roles: ['director'] },
            capability: 'delete_booking',
            expected: [true, 'role_preset', 'director', 'granted_by_role_preset']
        },
        {
            label: 'missing grant fails closed',
            user: { role: 'animator' },
            capability: 'delete_booking',
            expected: [false, 'default_deny', null, 'no_matching_grant']
        }
    ];

    for (const row of rows) {
        const decision = assertParity(row.user, row.capability);
        assert.deepEqual(
            [decision.allowed, decision.source, decision.sourceRole, decision.reason],
            row.expected,
            row.label
        );
    }
});

test('every registered capability has identical frontend and backend decisions', () => {
    for (const entry of [...registry.PAGE_PERMISSIONS, ...registry.ACTION_PERMISSIONS]) {
        const context = { type: entry.type };
        const deniedRole = registry.ROLE_HIERARCHY.find(role => !entry.defaultRoles.includes(role)) || 'animator';
        const allowedRole = entry.defaultRoles[0];

        assertParity({ role: deniedRole }, entry.key, context);
        if (allowedRole) {
            assertParity({ role: allowedRole }, entry.key, context);
            if (entry.type === 'action' && entry.delegable !== false) {
                assertParity({ role: deniedRole, extra_roles: [allowedRole] }, entry.key, context);
            }
        }

        if (entry.explicitAllow !== false && !(entry.type === 'action' && entry.delegable === false)) {
            const user = entry.type === 'page'
                ? { role: deniedRole, page_allowlist: [entry.key] }
                : { role: deniedRole, action_allowlist: [entry.key] };
            assertParity(user, entry.key, context);
        }

        if (entry.type === 'action') {
            assertParity({
                role: allowedRole || deniedRole,
                action_allowlist: [entry.key],
                action_denylist: [entry.key]
            }, entry.key, context);
        }
    }
});

test('frontend and backend canonicalize all declared aliases identically', () => {
    for (const entry of registry.PAGE_PERMISSIONS) {
        for (const alias of entry.aliases) {
            const decision = assertParity({ role: 'creator' }, alias, { type: 'page' });
            assert.equal(decision.key, entry.canonicalPath, `${alias} canonical path drift`);
        }
    }
    for (const entry of registry.ACTION_PERMISSIONS) {
        for (const alias of entry.aliases) {
            const decision = assertParity({ role: 'creator' }, alias, { type: 'action' });
            assert.equal(decision.key, entry.key, `${alias} canonical action drift`);
        }
    }
});

test('unknown keys fail closed in both runtimes', () => {
    assertParity({ role: 'creator' }, '/not-a-real-page', { type: 'page' });
    assertParity({ role: 'creator' }, 'not_a_real_action', { type: 'action' });
});

test('Staff schedule, staff management, and Training onboarding honor canonical capability overrides', () => {
    const capabilities = ['hr.schedule.view', 'hr.schedule.manage', 'hr.staff.view', 'hr.staff.manage', 'manage_staff'];

    for (const role of ['manager', 'hr', 'admin']) {
        for (const capability of capabilities) {
            assert.equal(assertParity({ role }, capability, { type: 'action' }).allowed, true, `${role} must receive ${capability} by default`);
        }
    }

    assert.equal(assertParity({ role: 'instructor' }, 'hr.schedule.view', { type: 'action' }).allowed, true, 'instructor can view the schedule');
    for (const capability of ['hr.schedule.manage', 'hr.staff.view', 'hr.staff.manage', 'manage_staff']) {
        assert.equal(assertParity({ role: 'instructor' }, capability, { type: 'action' }).allowed, false, `instructor must not receive ${capability} by default`);
    }

    const allowed = { role: 'instructor', action_allowlist: ['hr.schedule.manage', 'hr.staff.manage', 'manage_staff'] };
    for (const capability of allowed.action_allowlist) {
        assert.equal(assertParity(allowed, capability, { type: 'action' }).allowed, true, `explicit allow must grant ${capability}`);
    }

    const denied = { role: 'manager', action_denylist: capabilities };
    for (const capability of capabilities) {
        assert.equal(assertParity(denied, capability, { type: 'action' }).allowed, false, `explicit deny must block ${capability}`);
    }
});
test('Finance management keeps creator, director and accountant parity with explicit overrides', () => {
    const capability = 'finance.manage';
    for (const role of ['creator', 'director', 'accountant']) {
        assert.equal(assertParity({ role }, capability, { type: 'action' }).allowed, true, `${role} must manage Finance by default`);
    }
    assert.equal(assertParity({ role: 'vice_director' }, capability, { type: 'action' }).allowed, false, 'vice director must not receive Finance management by default');
    assert.equal(assertParity({ role: 'animator', action_allowlist: [capability] }, capability, { type: 'action' }).allowed, true, 'explicit allow must grant Finance management');
    const denied = assertParity({ role: 'accountant', action_allowlist: [capability], action_denylist: [capability] }, capability, { type: 'action' });
    assert.deepEqual([denied.allowed, denied.source, denied.reason], [false, 'explicit_deny', 'listed_in_explicit_deny']);
});
