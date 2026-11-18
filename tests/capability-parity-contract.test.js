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

test('legacy booking viewer controls follow effective capability for every role, extra role and override', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js/auth.js'), 'utf8');
    const start = source.indexOf('function isViewer()');
    const end = source.indexOf('function canManageProducts()', start);
    let effectiveUser;
    const sandbox = { canAccess: action => frontendResolveCapability(effectiveUser, action, { type: 'action', ignoreServer: true }).allowed,
        viewerResult: null };
    vm.runInNewContext(source.slice(start, end) + '\nviewerResult = isViewer;', sandbox);
    for (const user of [
        ...registry.ROLE_HIERARCHY.map(role => ({ role })),
        { role: 'instructor', extra_roles: ['reception'] },
        { role: 'instructor', action_allowlist: ['edit_booking'] },
        { role: 'director', action_denylist: ['edit_booking'] },
        { role: 'senior_instructor', businessMembershipAccess: { invalid: true } }
    ]) {
        effectiveUser = user;
        assert.equal(sandbox.viewerResult(), !policy.resolveCapability(user, 'edit_booking').allowed, JSON.stringify(user));
    }
});

test('legacy revenue dashboard remains independent from booking edit/viewer status', async () => {
    const source = fs.readFileSync(path.join(ROOT, 'js/settings.js'), 'utf8');
    const start = source.indexOf('async function showDashboard()');
    const end = source.indexOf('async function loadDashboardData(', start);
    for (const user of [{ role: 'accountant' }, { role: 'director', action_denylist: ['view_revenue'] }]) {
        const events = [];
        const sandbox = {
            canAccess: action => frontendResolveCapability(user, action, { type: 'action', ignoreServer: true }).allowed,
            isViewer: () => !policy.resolveCapability(user, 'edit_booking').allowed,
            document: { getElementById(id) { events.push(id); return { innerHTML: '', classList: { remove() {} } }; } },
            loadDashboardData: async period => events.push(period), dashboardPeriod: '', dashboardOpen: null
        };
        vm.runInNewContext(source.slice(start, end) + '\ndashboardOpen = showDashboard;', sandbox);
        await sandbox.dashboardOpen();
        assert.equal(events.includes('month'), user.role === 'accountant', 'finance read capability controls the dashboard');
        if (user.role === 'director') assert.deepEqual(events, [], 'explicit finance deny blocks before DOM/data work');
    }
});

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

test('accountant opens related operational and finance pages without unrelated specialist pages', () => {
    const user = { role: 'accountant' };
    const allowed = new Set(['/dashboard', '/', '/tasks', '/chat', '/customers', '/staff', '/training',
        '/booking-summary.html', '/hr', '/finance', '/cashier-payments', '/accounting-deposits',
        '/afisha', '/reports', '/certificates', '/game', '/profile', '/quiz', '/room', '/shop']);
    for (const page of registry.PAGE_PERMISSIONS.filter(entry => !entry.deprecated)) {
        assert.equal(assertParity(user, page.key, { type: 'page' }).allowed, allowed.has(page.key), page.key);
    }
    for (const action of ['hr.today.view', 'hr.staff.view', 'hr.reports.view', 'tasks.create']) {
        assert.equal(assertParity(user, action, { type: 'action' }).allowed, true, action);
    }
    for (const action of ['manage_accounts', 'manage_settings', 'fiscal.configure', 'fiscal.incident.manage', 'hr.reports.export']) {
        assert.equal(assertParity(user, action, { type: 'action' }).allowed, false, action);
    }
    assert.equal(assertParity({ ...user, page_denylist: ['/hr'] }, '/hr', { type: 'page' }).allowed, false);
});

test('accountant operational reads respect effective page access and retain existing write guards', () => {
    const { requireRole } = require('../middleware/auth');
    const { allowAccountantPageRead } = require('../middleware/accountant-page-read');
    const guard = allowAccountantPageRead('/hr', requireRole('manager'));
    function run(user, method) {
        let result = 200;
        const res = { status(code) { result = code; return this; }, json() {} };
        guard({ user, method }, res, () => {});
        return result;
    }
    const accountant = { role: 'accountant' };
    assert.equal(run(accountant, 'GET'), 200);
    assert.equal(run(accountant, 'HEAD'), 200);
    assert.equal(run(accountant, 'POST'), 403);
    assert.equal(run({ ...accountant, page_denylist: ['/hr'] }, 'GET'), 403);
    assert.equal(run({ role: 'animator' }, 'GET'), 403);
    assert.equal(run({ role: 'manager' }, 'POST'), 200);
});
