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
        ACTION_LEGACY_DENY_KEYS: catalog.actionLegacyDenyKeys,
        EXPLICIT_ALLOW_DISABLED_PAGES: new Set(catalog.explicitAllowDisabledPages),
        EXPLICIT_ALLOW_DISABLED_ACTIONS: new Set(catalog.explicitAllowDisabledActions),
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

test('page deny canonicalizes aliases and wins over allow and role in both runtimes', () => {
    const decision = assertParity({
        role: 'creator',
        page_allowlist: ['/chat'],
        page_denylist: ['/kleshnya']
    }, '/chat', { type: 'page' });
    assert.deepEqual(
        [decision.allowed, decision.source, decision.sourceRole, decision.reason],
        [false, 'explicit_deny', null, 'listed_in_explicit_deny']
    );
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

        if (entry.type === 'page') {
            assertParity({
                role: allowedRole || deniedRole,
                page_allowlist: [entry.key],
                page_denylist: [entry.key]
            }, entry.key, context);
        } else {
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

test('Staff schedule, staff management, Hermes, and Training honor granular capability overrides', () => {
    const capabilities = ['hr.schedule.view', 'hr.schedule.manage', 'hr.staff.view', 'hr.staff.manage', 'hermes.staff.manage', 'hermes.attendance.manage', 'hermes.schedule.manage', 'training.manage'];

    for (const role of ['manager', 'hr', 'admin']) {
        for (const capability of capabilities) {
            assert.equal(assertParity({ role }, capability, { type: 'action' }).allowed, true, `${role} must receive ${capability} by default`);
        }
    }

    assert.equal(assertParity({ role: 'instructor' }, 'hr.schedule.view', { type: 'action' }).allowed, true, 'instructor can view the schedule');
    for (const capability of ['hr.schedule.manage', 'hr.staff.view', 'hr.staff.manage', 'hermes.staff.manage', 'hermes.attendance.manage', 'hermes.schedule.manage', 'training.manage']) {
        assert.equal(assertParity({ role: 'instructor' }, capability, { type: 'action' }).allowed, false, `instructor must not receive ${capability} by default`);
    }

    const allowed = { role: 'instructor', action_allowlist: ['hr.schedule.manage', 'hr.staff.manage', 'hermes.staff.manage', 'hermes.attendance.manage', 'hermes.schedule.manage', 'training.manage'] };
    for (const capability of allowed.action_allowlist) {
        assert.equal(assertParity(allowed, capability, { type: 'action' }).allowed, true, `explicit allow must grant ${capability}`);
    }

    const denied = { role: 'manager', action_denylist: capabilities };
    for (const capability of capabilities) {
        assert.equal(assertParity(denied, capability, { type: 'action' }).allowed, false, `explicit deny must block ${capability}`);
    }
});

test('legacy manage_staff compatibility maps only to former granular consumers', () => {
    const legacyAllowed = {
        role: 'instructor',
        action_allowlist: ['manage_staff']
    };
    for (const capability of ['hr.schedule.manage', 'hr.staff.manage', 'hermes.staff.manage', 'hermes.attendance.manage', 'hermes.schedule.manage', 'training.manage']) {
        assert.equal(assertParity(legacyAllowed, capability, { type: 'action' }).allowed, true, `legacy manage_staff allow must preserve ${capability}`);
    }
    assert.equal(assertParity(legacyAllowed, 'manage_staff', { type: 'action' }).allowed, false, 'legacy manage_staff must remain a tombstone');

    const legacyDenied = {
        role: 'manager',
        action_denylist: ['manage_staff']
    };
    for (const capability of ['hr.schedule.manage', 'hr.staff.manage', 'hermes.staff.manage', 'hermes.attendance.manage', 'hermes.schedule.manage', 'training.manage']) {
        assert.equal(assertParity(legacyDenied, capability, { type: 'action' }).allowed, false, `legacy manage_staff deny must block ${capability}`);
    }
});

test('legacy dead actions fail closed while manage_users deny revokes manage_accounts only as a deny alias', () => {
    for (const key of ['cancel_booking', 'view_own']) {
        const allowDecision = assertParity({ role: 'animator', action_allowlist: [key] }, key, { type: 'action' });
        assert.deepEqual([allowDecision.allowed, allowDecision.reason], [false, 'unknown_capability']);
        const denyDecision = assertParity({ role: 'creator', action_denylist: [key] }, key, { type: 'action' });
        assert.deepEqual([denyDecision.allowed, denyDecision.reason], [false, 'unknown_capability']);
    }

    const legacyAllow = assertParity({ role: 'animator', action_allowlist: ['manage_users'] }, 'manage_accounts', { type: 'action' });
    assert.deepEqual([legacyAllow.allowed, legacyAllow.reason], [false, 'no_matching_grant']);

    const legacyDeny = assertParity({ role: 'director', action_denylist: ['manage_users'] }, 'manage_accounts', { type: 'action' });
    assert.deepEqual([legacyDeny.allowed, legacyDeny.source, legacyDeny.reason], [false, 'explicit_deny', 'listed_in_explicit_deny']);
});
test('Finance management keeps creator, director and accountant parity with explicit overrides', () => {
    const capability = 'finance.manage';
    for (const role of ['creator', 'director', 'accountant']) {
        assert.equal(assertParity({ role }, capability, { type: 'action' }).allowed, true, `${role} must manage Finance by default`);
    }
    assert.equal(assertParity({ role: 'vice_director' }, capability, { type: 'action' }).allowed, false, 'vice director must not receive Finance management by default');
    const explicitAllow = assertParity({ role: 'animator', action_allowlist: [capability] }, capability, { type: 'action' });
    assert.deepEqual([explicitAllow.allowed, explicitAllow.reason], [false, 'explicit_allow_disabled']);
    assert.equal(assertParity({ role: 'animator', extra_roles: ['accountant'] }, capability, { type: 'action' }).allowed, true, 'approved extra role preserves Finance access');
    const denied = assertParity({ role: 'accountant', action_allowlist: [capability], action_denylist: [capability] }, capability, { type: 'action' });
    assert.deepEqual([denied.allowed, denied.source, denied.reason], [false, 'explicit_deny', 'listed_in_explicit_deny']);
});

test('Task 4-8 critical capabilities keep their independent grants and explicit deny precedence', () => {
    const creator = { role: 'creator' };
    const manager = { role: 'manager' };
    const deniedCreator = {
        role: 'creator',
        action_denylist: ['view_revenue', 'manage_settings', 'export_data']
    };

    for (const capability of ['view_revenue', 'manage_settings', 'export_data']) {
        assert.equal(assertParity(creator, capability, { type: 'action' }).allowed, true, `creator must receive ${capability}`);
        assert.equal(assertParity(deniedCreator, capability, { type: 'action' }).allowed, false, `explicit deny must block ${capability}`);
    }

    assert.equal(assertParity(manager, 'view_revenue', { type: 'action' }).allowed, true);
    assert.equal(assertParity(manager, 'export_data', { type: 'action' }).allowed, true);
    assert.equal(assertParity(manager, 'manage_settings', { type: 'action' }).allowed, false);
});
