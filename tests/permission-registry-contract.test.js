'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const registry = require('../config/permissionRegistry');

function sorted(values = []) {
    return [...values].sort();
}

function loadBackendAuth() {
    const filename = path.join(ROOT, 'middleware', 'auth.js');
    const code = fs.readFileSync(filename, 'utf8');
    const module = { exports: {} };
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    const sandbox = {
        module,
        exports: module.exports,
        require(request) {
            if (request === 'jsonwebtoken') return { sign() {}, verify() {} };
            if (request === '../db') return { pool: { query: async () => ({ rows: [] }) } };
            if (request === '../utils/logger') return { createLogger: () => logger };
            if (request === '../services/businessContext') {
                return {
                    allowedBusinessContextsForUser: () => ['event_genix'],
                    resolveDefaultBusinessContext: () => 'event_genix',
                    resolveBusinessContextPolicy: () => ({ defaultContext: 'event_genix' })
                };
            }
            return require(request);
        },
        process,
        console,
        Buffer,
        setInterval,
        clearInterval,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(code, sandbox, { filename });
    return module.exports;
}

function assertUnique(values, label) {
    assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function assertConsumerExists(consumer, label) {
    assert.equal(typeof consumer, 'object', `${label} must be an object`);
    assert.equal(typeof consumer.file, 'string', `${label}.file must be a string`);
    const filename = path.join(ROOT, consumer.file);
    assert.ok(fs.existsSync(filename), `${label}: missing ${consumer.file}`);
    const marker = consumer.symbol || consumer.marker;
    if (!marker) return;
    const source = fs.readFileSync(filename, 'utf8');
    assert.ok(source.includes(marker), `${label}: ${consumer.file} is missing marker ${JSON.stringify(marker)}`);
}

function assertEntryShape(entry, type) {
    assert.equal(entry.type, type);
    for (const field of ['key', 'label', 'group', 'risk', 'status']) {
        assert.equal(typeof entry[field], 'string', `${type} ${entry.key || '(unknown)'}: ${field} must be a string`);
        assert.ok(entry[field], `${type} ${entry.key || '(unknown)'}: ${field} must not be empty`);
    }
    assert.ok(Array.isArray(entry.defaultRoles), `${type} ${entry.key}: defaultRoles must be an array`);
    assert.ok(Array.isArray(entry.aliases), `${type} ${entry.key}: aliases must be an array`);
    assert.ok(Array.isArray(entry.frontendConsumers), `${type} ${entry.key}: frontendConsumers must be an array`);
    assert.ok(Array.isArray(entry.backendConsumers), `${type} ${entry.key}: backendConsumers must be an array`);
    assert.ok(Array.isArray(entry.apiConsumers), `${type} ${entry.key}: apiConsumers must be an array`);
    assert.equal(typeof entry.deprecated, 'boolean', `${type} ${entry.key}: deprecated must be boolean`);

    entry.frontendConsumers.forEach((consumer, index) => assertConsumerExists(consumer, `${type} ${entry.key}.frontendConsumers[${index}]`));
    entry.backendConsumers.forEach((consumer, index) => assertConsumerExists(consumer, `${type} ${entry.key}.backendConsumers[${index}]`));
    entry.apiConsumers.forEach((consumer, index) => {
        assertConsumerExists(consumer, `${type} ${entry.key}.apiConsumers[${index}]`);
        assert.equal(typeof consumer.routeScope, 'string', `${type} ${entry.key}.apiConsumers[${index}].routeScope must be a string`);
        assert.ok(consumer.routeScope, `${type} ${entry.key}.apiConsumers[${index}].routeScope must not be empty`);
    });
}

test('registry describes exactly the current 42 canonical page and 29 action keys', () => {
    const backend = loadBackendAuth();
    const pageKeys = registry.PAGE_PERMISSIONS.map(entry => entry.key);
    const actionKeys = registry.ACTION_PERMISSIONS.map(entry => entry.key);

    assert.equal(pageKeys.length, 42);
    assert.equal(actionKeys.length, 29);
    assertUnique(pageKeys, 'page permission keys');
    assertUnique(actionKeys, 'action permission keys');
    assert.deepEqual(sorted(pageKeys), sorted(Object.keys(backend.PAGE_ACCESS)), 'unknown or missing page permission key');
    assert.deepEqual(sorted(actionKeys), sorted(Object.keys(backend.ACTION_PERMISSIONS)), 'unknown or missing action permission key');

    for (const entry of registry.PAGE_PERMISSIONS) {
        assertEntryShape(entry, 'page');
        assert.equal(typeof entry.canonicalPath, 'string', `page ${entry.key}: canonicalPath must be a string`);
        assert.deepEqual(sorted(entry.defaultRoles), sorted(backend.PAGE_ACCESS[entry.key]), `page ${entry.key}: defaultRoles drift`);
    }
    for (const entry of registry.ACTION_PERMISSIONS) {
        assertEntryShape(entry, 'action');
        assert.deepEqual(sorted(entry.defaultRoles), sorted(backend.ACTION_PERMISSIONS[entry.key]), `action ${entry.key}: defaultRoles drift`);
    }

    const nonDelegable = registry.ACTION_PERMISSIONS.filter(entry => entry.delegable === false).map(entry => entry.key);
    assert.deepEqual(sorted(nonDelegable), sorted(Array.from(backend.NON_DELEGABLE_ACTIONS)), 'non-delegable action drift');
});

test('public page metadata is a complete safe projection of the registry', () => {
    const publicPages = registry.getPublicPagePermissionMetadata();
    assert.equal(publicPages.length, registry.PAGE_PERMISSIONS.length);
    assert.deepEqual(sorted(publicPages.map(entry => entry.key)), sorted(registry.PAGE_PERMISSIONS.map(entry => entry.key)));
    assertUnique(publicPages.map(entry => entry.key), 'public page metadata keys');

    for (const entry of publicPages) {
        assert.ok(entry.label, `${entry.key}: public label must not be empty`);
        assert.ok(entry.group, `${entry.key}: public group must not be empty`);
        assert.ok(entry.groupLabel, `${entry.key}: public groupLabel must not be empty`);
        assert.ok(entry.canonicalPath, `${entry.key}: public canonicalPath must not be empty`);
        assert.ok(Array.isArray(entry.aliases), `${entry.key}: public aliases must be an array`);
        assert.ok(Array.isArray(entry.roles), `${entry.key}: public roles must be an array`);
        assert.equal(typeof entry.explicitAllow, 'boolean', `${entry.key}: public explicitAllow must be boolean`);
        assert.equal(Object.hasOwn(entry, 'frontendConsumers'), false, `${entry.key}: frontend consumers must stay private`);
        assert.equal(Object.hasOwn(entry, 'backendConsumers'), false, `${entry.key}: backend consumers must stay private`);
        assert.equal(Object.hasOwn(entry, 'apiConsumers'), false, `${entry.key}: API consumers must stay private`);
    }

    const aliases = new Set(publicPages.flatMap(entry => entry.aliases));
    publicPages.forEach(entry => assert.equal(aliases.has(entry.key), false, `${entry.key}: alias must not become a toggle`));

    const userRoutes = fs.readFileSync(path.join(ROOT, 'routes', 'users.js'), 'utf8');
    assert.match(userRoutes, /getPublicPagePermissionMetadata/);
    assert.match(userRoutes, /pages,/);
});
test('sidebar links are fully represented by page permission entries', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');
    const start = source.indexOf('const NAV_ITEMS = [');
    const end = source.indexOf('const HR_TEAM_BUCKET_IDS =', start);
    assert.ok(start >= 0 && end > start, 'unable to locate NAV_ITEMS block');
    const navBlock = source.slice(start, end);
    const navHrefs = Array.from(navBlock.matchAll(/href:\s*'([^']+)'/g), match => match[1]);
    assert.equal(navHrefs.length, 49, 'sidebar link count drift');

    for (const href of navHrefs) {
        if (href === '#settings') continue;
        const pageKey = href.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
        const entry = registry.PAGE_PERMISSION_BY_KEY[pageKey];
        assert.ok(entry, `sidebar href ${href}: no page permission entry for ${pageKey}`);
        assert.ok(entry.sidebarLinks.includes(href), `sidebar href ${href}: missing from ${pageKey}.sidebarLinks`);
    }

    for (const entry of registry.PAGE_PERMISSIONS) {
        entry.sidebarLinks.forEach(href => {
            assert.ok(navHrefs.includes(href), `${entry.key}: declared sidebar link ${href} is not in NAV_ITEMS`);
        });
    }
});
test('aliases canonicalize to known permission keys', () => {
    const canonicalKeys = new Set(registry.PAGE_PERMISSIONS.filter(entry => !entry.aliasOf).map(entry => entry.key));
    const seenAliases = new Map();

    for (const entry of registry.PAGE_PERMISSIONS) {
        if (entry.aliasOf) {
            assert.ok(canonicalKeys.has(entry.aliasOf), `${entry.key}: aliasOf ${entry.aliasOf} is unknown`);
            assert.equal(registry.canonicalizePageKey(entry.key), entry.canonicalPath, `${entry.key}: alias key does not canonicalize`);
            assert.equal(entry.deprecated, true, `${entry.key}: legacy permission alias must be explicitly deprecated`);
        }
        for (const alias of entry.aliases) {
            const canonical = registry.canonicalizePageKey(alias);
            assert.equal(canonical, entry.canonicalPath, `${entry.key}: alias ${alias} canonicalizes to ${canonical}`);
            if (seenAliases.has(alias)) {
                assert.equal(seenAliases.get(alias), canonical, `${alias}: conflicting canonical targets`);
            }
            seenAliases.set(alias, canonical);
        }
    }

    assert.equal(registry.canonicalizePageKey('/kleshnya'), '/chat');
    assert.equal(registry.canonicalizePageKey('/art-director.html'), '/art');
    assert.equal(registry.canonicalizePageKey('/leads?owner=me'), '/sales-funnel');
    assert.equal(registry.canonicalizePageKey('/analytics'), '/finance');
    assert.equal(registry.canonicalizePageKey('/booking-summary'), '/booking-summary.html');
    assert.equal(registry.canonicalizePageKey('/booking-summary.html'), '/booking-summary.html');
    assert.equal(registry.PAGE_PERMISSION_BY_KEY['/settings'], undefined);
});

test('every active action has a server-side enforcement consumer or an explicit deprecated marker', () => {
    for (const entry of registry.ACTION_PERMISSIONS) {
        const hasSpecificBackendEnforcement = entry.backendConsumers.some(consumer => consumer.enforces === true);
        const hasActionApiConsumer = entry.apiConsumers.some(consumer => consumer.enforcement === 'action');
        const hasServerEnforcement = hasSpecificBackendEnforcement || hasActionApiConsumer;
        assert.ok(hasServerEnforcement || entry.deprecated, `${entry.key}: no server-side enforcement consumer and not deprecated`);
        if (['dead', 'frontend_only'].includes(entry.status)) {
            assert.equal(entry.deprecated, true, `${entry.key}: ${entry.status} action must be deprecated explicitly`);
        }
    }
});

test('every active capability is linked to both a frontend and backend consumer', () => {
    for (const entry of [...registry.PAGE_PERMISSIONS, ...registry.ACTION_PERMISSIONS]) {
        if (entry.deprecated) continue;
        assert.ok(entry.frontendConsumers.length > 0, `${entry.type} ${entry.key}: missing frontend consumer`);
        assert.ok(entry.backendConsumers.length > 0, `${entry.type} ${entry.key}: missing backend consumer`);
    }
});

test('deprecated toggles are hidden and canonical pages have one key', () => {
    const deprecatedKeys = ['cancel_booking', 'view_own', 'manage_users', 'view_revenue', 'manage_settings', 'export_data'];
    deprecatedKeys.forEach(key => assert.equal(registry.ACTION_PERMISSION_BY_KEY[key]?.deprecated, true, `${key} must remain compatibility-only`));

    const userRoutes = fs.readFileSync(path.join(ROOT, 'routes', 'users.js'), 'utf8');
    const accountUi = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    assert.match(userRoutes, /filter\(action => action\.deprecated !== true\)/);
    assert.match(accountUi, /filter\(item => item && item\.deprecated !== true\)/);

    ['/kleshnya', '/leads', '/art-director', '/analytics', '/settings'].forEach(key => {
        assert.equal(registry.PAGE_PERMISSION_BY_KEY[key], undefined, `${key} must not be a standalone page toggle`);
    });
    assert.equal(registry.canonicalizePageKey('/kleshnya'), '/chat');
    assert.equal(registry.canonicalizePageKey('/leads'), '/sales-funnel');
    assert.equal(registry.canonicalizePageKey('/art-director'), '/art');
    assert.equal(registry.canonicalizePageKey('/analytics'), '/finance');
});

test('account editor consumes API page metadata instead of a duplicated page catalog', () => {
    const accountUi = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    assert.match(accountUi, /let accountPageDefinitions = \[\]/);
    assert.match(accountUi, /Array\.isArray\(data\?\.pages\)/);
    assert.match(accountUi, /function getAccountPageDefinitions/);
    assert.doesNotMatch(accountUi, /const ACCOUNT_PAGE_LABELS\s*=/);
    assert.doesNotMatch(accountUi, /function accountAccessPageGroup\s*\(/);
    assert.match(accountUi, /group: page\.groupLabel \|\| page\.group/);
});
test('booking scope uses capabilities and payroll actions expose human labels', () => {
    const visibility = fs.readFileSync(path.join(ROOT, 'services', 'bookingVisibility.js'), 'utf8');
    assert.match(visibility, /canUseAction\(user, 'view_all'\)/);
    assert.match(visibility, /canUseAction\(user, 'edit_booking'\)/);
    assert.match(visibility, /canUseAction\(user, 'delete_booking'\)/);
    assert.doesNotMatch(visibility, /FULL_BOOKING_ROLES|BOOKING_VIEW_ROLES|BOOKING_EDIT_ROLES/);

    registry.ACTION_PERMISSIONS.filter(action => action.group === 'payroll').forEach(action => {
        assert.ok(action.label && action.label !== action.key, `${action.key}: missing human label`);
    });
});
test('HR tabs, aliases, sidebar links, and extra action gates are machine-readable', () => {
    const tabIds = registry.HR_TABS.map(tab => tab.id);
    assertUnique(tabIds, 'HR tab ids');
    assert.equal(tabIds.length, 13);
    const aliasOwners = new Map();

    for (const tab of registry.HR_TABS) {
        assert.equal(tab.pageKey, '/hr', `${tab.id}: HR tab must inherit /hr page access`);
        assert.equal(typeof tab.frontendConsumer?.file, 'string', `${tab.id}: missing frontend consumer`);
        assertConsumerExists(tab.frontendConsumer, `HR tab ${tab.id}.frontendConsumer`);
        tab.apiConsumers.forEach((consumer, index) => assertConsumerExists(consumer, `HR tab ${tab.id}.apiConsumers[${index}]`));
        tab.additionalActions.forEach(actionKey => {
            assert.ok(registry.ACTION_PERMISSION_BY_KEY[actionKey], `${tab.id}: unknown action ${actionKey}`);
        });
        for (const [layer, actionKeys] of [['frontend', tab.frontendActions], ['backend', tab.backendActions]]) {
            actionKeys.forEach(actionKey => {
                assert.ok(registry.ACTION_PERMISSION_BY_KEY[actionKey], `${tab.id}: unknown ${layer} action ${actionKey}`);
                assert.ok(tab.additionalActions.includes(actionKey), `${tab.id}: ${layer} action ${actionKey} must be included in additionalActions`);
            });
        }
        tab.aliases.forEach(alias => {
            assert.ok(!aliasOwners.has(alias), `HR alias ${alias} is owned by both ${aliasOwners.get(alias)} and ${tab.id}`);
            aliasOwners.set(alias, tab.id);
        });
    }

    registry.HR_EXTERNAL_REDIRECTS.forEach((redirect, index) => {
        assert.ok(!aliasOwners.has(redirect.alias), `HR redirect alias ${redirect.alias} conflicts with a tab alias`);
        assertConsumerExists(redirect.source, `HR_EXTERNAL_REDIRECTS[${index}].source`);
    });

    const hrSource = fs.readFileSync(path.join(ROOT, 'js', 'hr-page.js'), 'utf8');
    const aliasBlockMatch = hrSource.match(/const HR_TAB_ALIASES = \{([\s\S]*?)\n\};/);
    assert.ok(aliasBlockMatch, 'unable to locate HR_TAB_ALIASES');
    const sourceAliases = Array.from(
        aliasBlockMatch[1].matchAll(/^\s*(?:'([^']+)'|([a-z][a-z-]*)):\s*\{/gm),
        match => match[1] || match[2]
    );
    assert.deepEqual(sorted(Array.from(aliasOwners.keys())), sorted(sourceAliases), 'HR tab alias drift');
    assert.equal(aliasOwners.get('payroll'), 'salary');
    assert.equal(aliasOwners.get('rating'), 'kpi');
    assert.equal(aliasOwners.get('dismissed'), 'team');
    assert.equal(registry.HR_TAB_BY_ID.profiles.status, 'active');
    assert.deepEqual(registry.HR_TAB_BY_ID.profiles.frontendActions, ['hr.payroll.view']);
    assert.deepEqual(registry.HR_TAB_BY_ID.profiles.backendActions, ['hr.payroll.view', 'manage_payroll_rules']);
    assert.equal(registry.HR_TAB_BY_ID.kpi.status, 'active');
    assert.deepEqual(registry.HR_TAB_BY_ID.kpi.frontendActions, ['hr.payroll.view']);
    assert.deepEqual(registry.HR_TAB_BY_ID.kpi.backendActions, ['hr.payroll.view']);
});
