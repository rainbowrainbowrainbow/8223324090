#!/usr/bin/env node
/**
 * Static access drift guard.
 *
 * Compares the server PAGE_ACCESS matrix, frontend PAGE_ACCESS matrix, and
 * sidebar navigation access keys without starting the app or requiring a DB.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function fail(message) {
    failures.push(message);
}

function makeLogger() {
    return {
        debug() {},
        info() {},
        warn() {},
        error() {}
    };
}

function loadCommonJs(file, requireOverride) {
    const filename = path.join(ROOT, file);
    const code = fs.readFileSync(filename, 'utf8');
    const module = { exports: {} };
    const sandbox = {
        module,
        exports: module.exports,
        require: requireOverride,
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

function makeBrowserSandbox() {
    const storage = {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    };
    const classList = {
        add() {},
        remove() {},
        toggle() {},
        contains() { return false; }
    };
    const document = {
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() {
            return {
                classList,
                style: {},
                appendChild() {},
                remove() {},
                querySelector() { return null; },
                addEventListener() {}
            };
        },
        body: { classList }
    };
    const window = {
        addEventListener() {},
        dispatchEvent() {},
        location: { pathname: '/dashboard', href: '', hash: '', reload() {} },
        innerWidth: 1024
    };

    const sandbox = {
        console,
        document,
        window,
        localStorage: storage,
        sessionStorage: storage,
        navigator: { serviceWorker: {} },
        caches: { keys: async () => [], delete: async () => true },
        AppState: { currentUser: { role: 'creator' }, darkMode: false, compactMode: false },
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        OfflineQueue: { clearQueue: async () => {} },
        CustomEvent: function CustomEvent(type, options) { return { type, ...options }; },
        fetch: async () => ({ ok: false, json: async () => ({}) }),
        setTimeout() {},
        clearTimeout() {}
    };
    sandbox.window.document = document;
    sandbox.window.localStorage = storage;
    sandbox.window.sessionStorage = storage;
    sandbox.window.navigator = sandbox.navigator;
    sandbox.window.caches = sandbox.caches;
    sandbox.window.CustomEvent = sandbox.CustomEvent;
    sandbox.window.fetch = sandbox.fetch;
    sandbox.globalThis = sandbox;
    return sandbox;
}

function loadBackendAuth() {
    return loadCommonJs('middleware/auth.js', (request) => {
        if (request === '../db') {
            return { pool: { query: async () => ({ rows: [] }) } };
        }
        if (request === '../utils/logger') {
            return { createLogger: makeLogger };
        }
        return require(request);
    });
}

function loadFrontendAuth() {
    const filename = path.join(ROOT, 'js/auth.js');
    const code = fs.readFileSync(filename, 'utf8');
    const sandbox = makeBrowserSandbox();
    const api = vm.runInNewContext(
        `${code}\n;({ ROLE_HIERARCHY, ROLE_NAMES, PAGE_ACCESS, canAccessPage });`,
        sandbox,
        { filename }
    );
    return { ...api, sandbox };
}

function loadSidebar() {
    const filename = path.join(ROOT, 'js/components/sidebar.js');
    const code = fs.readFileSync(filename, 'utf8');
    const sandbox = makeBrowserSandbox();
    return vm.runInNewContext(`${code}\n;Sidebar;`, sandbox, { filename });
}

function sortedUnique(values) {
    return [...new Set(values)].sort();
}

function normalizeRoles(value, allRoles, label) {
    if (value === true || value === null) return sortedUnique(allRoles);
    if (!Array.isArray(value)) {
        fail(`${label}: expected role array/null/true, got ${typeof value}`);
        return [];
    }
    return sortedUnique(value);
}

function compareRoleSets(label, left, right) {
    const a = [...left].sort();
    const b = [...right].sort();
    if (a.length !== b.length || a.some((role, idx) => role !== b[idx])) {
        const onlyLeft = a.filter(role => !b.includes(role));
        const onlyRight = b.filter(role => !a.includes(role));
        fail(`${label}: mismatch${onlyLeft.length ? `; only left: ${onlyLeft.join(',')}` : ''}${onlyRight.length ? `; only right: ${onlyRight.join(',')}` : ''}`);
    }
}

function normalizeHref(href) {
    if (!href || href.startsWith('#')) return null;
    return href.split('#')[0].replace(/\.html$/, '').replace(/\/$/, '') || '/';
}

function checkKnownRoles(label, matrix, allRoles) {
    const known = new Set(allRoles);
    for (const [key, roles] of Object.entries(matrix)) {
        if (roles === true || roles === null) continue;
        if (!Array.isArray(roles)) {
            fail(`${label}.${key}: invalid role value`);
            continue;
        }
        roles.forEach(role => {
            if (!known.has(role)) fail(`${label}.${key}: unknown role "${role}"`);
        });
    }
}

const backend = loadBackendAuth();
const frontend = loadFrontendAuth();
const sidebar = loadSidebar();
const rolesConfig = require(path.join(ROOT, 'config/roles'));
const {
    ROOT_HTML_SURFACE,
    LEGACY_STATIC_REDIRECTS
} = require(path.join(ROOT, 'config/staticSurface'));
const {
    PUBLIC_STATIC_PAGE_EXCEPTIONS,
    EMBEDDED_STATIC_PAGE_EXCEPTIONS,
    MODAL_PAGE_ACCESS_SURFACES,
    SIDEBAR_PAGE_ROLE_EXCEPTIONS,
    ACCESS_SURFACE_DOC
} = require(path.join(ROOT, 'config/accessSurface'));

const allRoles = backend.ROLE_HIERARCHY;
const accessDocPath = path.join(ROOT, ACCESS_SURFACE_DOC);
const accessDoc = fs.existsSync(accessDocPath) ? fs.readFileSync(accessDocPath, 'utf8') : '';

if (!accessDoc) {
    fail(`${ACCESS_SURFACE_DOC} is required`);
}

compareRoleSets('ROLE_HIERARCHY backend/frontend', backend.ROLE_HIERARCHY, frontend.ROLE_HIERARCHY);

for (const role of allRoles) {
    if (!Object.prototype.hasOwnProperty.call(frontend.ROLE_NAMES, role)) {
        fail(`js/auth.js ROLE_NAMES missing role "${role}"`);
    }
    if (!Object.prototype.hasOwnProperty.call(rolesConfig.ROLE_PERMISSIONS, role)) {
        fail(`config/roles.js ROLE_PERMISSIONS missing role "${role}"`);
    }
    if (!Object.prototype.hasOwnProperty.call(rolesConfig.ROLE_DEPARTMENTS, role)) {
        fail(`config/roles.js ROLE_DEPARTMENTS missing role "${role}"`);
    }
    if (!Object.prototype.hasOwnProperty.call(rolesConfig.DEFAULT_WIDGETS, role)) {
        fail(`config/roles.js DEFAULT_WIDGETS missing role "${role}"`);
    }
}

checkKnownRoles('backend.PAGE_ACCESS', backend.PAGE_ACCESS, allRoles);
checkKnownRoles('frontend.PAGE_ACCESS', frontend.PAGE_ACCESS, allRoles);
checkKnownRoles('sidebar.SIDEBAR_ACCESS', sidebar.SIDEBAR_ACCESS, allRoles);

const backendPages = Object.keys(backend.PAGE_ACCESS);
const frontendPages = Object.keys(frontend.PAGE_ACCESS);
const allPages = sortedUnique([...backendPages, ...frontendPages]);
for (const page of allPages) {
    if (!Object.prototype.hasOwnProperty.call(backend.PAGE_ACCESS, page)) {
        fail(`middleware/auth.js PAGE_ACCESS missing "${page}"`);
        continue;
    }
    if (!Object.prototype.hasOwnProperty.call(frontend.PAGE_ACCESS, page)) {
        fail(`js/auth.js PAGE_ACCESS missing "${page}"`);
        continue;
    }
    compareRoleSets(
        `PAGE_ACCESS ${page}`,
        normalizeRoles(backend.PAGE_ACCESS[page], allRoles, `backend ${page}`),
        normalizeRoles(frontend.PAGE_ACCESS[page], allRoles, `frontend ${page}`)
    );
}

function assertDocumentedSurface(entry, label) {
    if (!entry.path || !entry.owner || !entry.reason) {
        fail(`${label}: incomplete access surface entry`);
        return;
    }
    if (!accessDoc.includes(`\`${entry.path}\``)) {
        fail(`${label} ${entry.path}: missing from ${ACCESS_SURFACE_DOC}`);
    }
}

function normalizeSurfacePath(value) {
    if (!value || value === '*') return null;
    return String(value).split('#')[0].replace(/\.html$/, '').replace(/\/$/, '') || '/';
}

const rootStaticPaths = new Set();
for (const entry of ROOT_HTML_SURFACE) {
    const canonical = normalizeSurfacePath(entry.canonicalPath);
    if (canonical) rootStaticPaths.add(canonical);
    for (const alias of entry.aliases || []) {
        const normalizedAlias = normalizeSurfacePath(alias);
        if (normalizedAlias) rootStaticPaths.add(normalizedAlias);
    }
}

function hasPageAccess(page) {
    return Object.prototype.hasOwnProperty.call(frontend.PAGE_ACCESS, page)
        && Object.prototype.hasOwnProperty.call(backend.PAGE_ACCESS, page);
}

function findNavItemByHref(href) {
    return sidebar.NAV_ITEMS.find(item => item.href === href);
}

function ensureAccessDocMentionsCurrentSources() {
    [
        'middleware/auth.js',
        'js/auth.js',
        'js/components/sidebar.js',
        'config/staticSurface.js',
        'config/accessSurface.js',
        'scripts/check-access-matrix.js'
    ].forEach(source => {
        if (!accessDoc.includes(`\`${source}\``)) {
            fail(`${ACCESS_SURFACE_DOC}: missing source reference ${source}`);
        }
    });
}

ensureAccessDocMentionsCurrentSources();

const publicStaticExceptions = new Set(PUBLIC_STATIC_PAGE_EXCEPTIONS.map(entry => entry.path));
const embeddedStaticExceptions = new Set(EMBEDDED_STATIC_PAGE_EXCEPTIONS.map(entry => entry.path));
const modalPageAccessPaths = new Set(MODAL_PAGE_ACCESS_SURFACES.map(entry => entry.path));
const sidebarPageExceptions = new Set(SIDEBAR_PAGE_ROLE_EXCEPTIONS.map(entry => entry.path));

for (const entry of PUBLIC_STATIC_PAGE_EXCEPTIONS) {
    assertDocumentedSurface(entry, 'public static page exception');
    if (!rootStaticPaths.has(entry.path)) {
        fail(`public static page exception ${entry.path}: not found in config/staticSurface.js`);
    }
    if (hasPageAccess(entry.path)) {
        fail(`public static page exception ${entry.path}: should not also be in PAGE_ACCESS`);
    }
}

for (const entry of EMBEDDED_STATIC_PAGE_EXCEPTIONS) {
    assertDocumentedSurface(entry, 'embedded static page exception');
    if (!rootStaticPaths.has(entry.path)) {
        fail(`embedded static page exception ${entry.path}: not found in config/staticSurface.js`);
    }
    if (!entry.parentPath || !hasPageAccess(entry.parentPath)) {
        fail(`embedded static page exception ${entry.path}: parentPath ${entry.parentPath || '(missing)'} must exist in PAGE_ACCESS`);
    }
    if (hasPageAccess(entry.path)) {
        fail(`embedded static page exception ${entry.path}: should not also be in PAGE_ACCESS`);
    }
}

for (const entry of MODAL_PAGE_ACCESS_SURFACES) {
    assertDocumentedSurface(entry, 'modal page access surface');
    if (!hasPageAccess(entry.path)) {
        fail(`modal page access surface ${entry.path}: missing PAGE_ACCESS entry`);
        continue;
    }

    if (entry.redirectTarget) {
        const redirect = LEGACY_STATIC_REDIRECTS.find(item => item.path === entry.path);
        if (!redirect || redirect.target !== entry.redirectTarget) {
            fail(`modal page access surface ${entry.path}: expected legacy redirect to ${entry.redirectTarget}`);
        }
    }

    if (entry.sidebarHref) {
        const item = findNavItemByHref(entry.sidebarHref);
        if (!item) {
            fail(`modal page access surface ${entry.path}: sidebar href ${entry.sidebarHref} missing`);
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(sidebar.SIDEBAR_ACCESS, item.access)) {
            fail(`modal page access surface ${entry.path}: sidebar access key ${item.access} missing`);
            continue;
        }
        compareRoleSets(
            `sidebar ${entry.sidebarHref} (${item.access}) vs PAGE_ACCESS ${entry.path}`,
            normalizeRoles(sidebar.SIDEBAR_ACCESS[item.access], allRoles, `sidebar ${item.access}`),
            normalizeRoles(frontend.PAGE_ACCESS[entry.path], allRoles, `frontend ${entry.path}`)
        );
    }
}

for (const entry of SIDEBAR_PAGE_ROLE_EXCEPTIONS) {
    assertDocumentedSurface(entry, 'sidebar page role exception');
    if (!hasPageAccess(entry.path)) {
        fail(`sidebar page role exception ${entry.path}: missing PAGE_ACCESS entry`);
    }
    if (!sidebar.NAV_ITEMS.some(item => normalizeHref(item.href) === entry.path)) {
        fail(`sidebar page role exception ${entry.path}: matching sidebar item missing`);
    }
}

const staticAccessPaths = new Set();
for (const entry of ROOT_HTML_SURFACE) {
    if (!['canonical-page', 'root-shell'].includes(entry.status)) continue;

    const canonical = normalizeSurfacePath(entry.canonicalPath);
    if (canonical && !publicStaticExceptions.has(canonical) && !hasPageAccess(canonical)) {
        fail(`static surface ${entry.file}: canonical path ${canonical} missing PAGE_ACCESS entry`);
    }
    if (canonical && !publicStaticExceptions.has(canonical)) {
        staticAccessPaths.add(canonical);
    }

    for (const alias of entry.aliases || []) {
        const normalizedAlias = normalizeSurfacePath(alias);
        if (!normalizedAlias) continue;
        if (embeddedStaticExceptions.has(normalizedAlias)) continue;
        if (publicStaticExceptions.has(normalizedAlias)) continue;
        if (!hasPageAccess(normalizedAlias)) {
            fail(`static surface ${entry.file}: alias ${normalizedAlias} missing PAGE_ACCESS entry or documented exception`);
            continue;
        }
        staticAccessPaths.add(normalizedAlias);
    }
}

for (const page of allPages) {
    if (staticAccessPaths.has(page) || modalPageAccessPaths.has(page)) continue;
    fail(`PAGE_ACCESS ${page}: no static surface, alias, or modal ownership entry`);
}

for (const item of sidebar.NAV_ITEMS.filter(i => i.href)) {
    if (!Object.prototype.hasOwnProperty.call(sidebar.SIDEBAR_ACCESS, item.access)) {
        fail(`sidebar NAV item "${item.href}" uses unknown access key "${item.access}"`);
        continue;
    }

    const page = normalizeHref(item.href);
    if (!page || sidebarPageExceptions.has(page)) continue;

    if (modalPageAccessPaths.has(page)) continue;

    if (!Object.prototype.hasOwnProperty.call(frontend.PAGE_ACCESS, page)) {
        fail(`sidebar NAV item "${item.href}" has no js/auth.js PAGE_ACCESS entry for "${page}"`);
        continue;
    }

    compareRoleSets(
        `sidebar ${item.href} (${item.access}) vs PAGE_ACCESS ${page}`,
        normalizeRoles(sidebar.SIDEBAR_ACCESS[item.access], allRoles, `sidebar ${item.access}`),
        normalizeRoles(frontend.PAGE_ACCESS[page], allRoles, `frontend ${page}`)
    );
}

frontend.sandbox.AppState.currentUser = { role: 'creator' };
if (frontend.canAccessPage('/definitely-missing') !== false) {
    fail('canAccessPage must reject unknown pages');
}
frontend.sandbox.AppState.currentUser = { role: 'waiter' };
if (frontend.canAccessPage('/tasks') !== false) {
    fail('waiter must not pass /tasks page access');
}
if (frontend.canAccessPage('/chat') !== false) {
    fail('waiter must not pass /chat page access');
}
frontend.sandbox.AppState.currentUser = { role: 'marketer' };
if (frontend.canAccessPage('/sales-funnel') !== true || frontend.canAccessPage('/leads') !== true) {
    fail('marketer should pass both /sales-funnel and /leads lead aliases');
}

if (failures.length) {
    console.error('Access matrix check failed:');
    failures.forEach(message => console.error(` - ${message}`));
    process.exit(1);
}

console.log(`Access matrix check passed: ${allRoles.length} roles, ${allPages.length} page entries, ${sidebar.NAV_ITEMS.filter(i => i.href).length} sidebar links.`);
