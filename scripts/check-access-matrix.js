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
const { canonicalizePageKey } = require('../config/permissionRegistry');

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
    sandbox.__capabilityCatalog = require(path.join(ROOT, 'services/accountAccessPolicy')).buildCapabilityCatalog();
    const api = vm.runInNewContext(
        `${code}\n;PAGE_ACCESS = __capabilityCatalog.pageRoles; ACTION_PERMISSIONS = __capabilityCatalog.actionRoles; PAGE_CAPABILITY_ALIASES = __capabilityCatalog.pageAliases; ACTION_CAPABILITY_ALIASES = __capabilityCatalog.actionAliases; EXPLICIT_ALLOW_DISABLED_PAGES = new Set(__capabilityCatalog.explicitAllowDisabledPages); NON_DELEGABLE_ACTIONS = new Set(__capabilityCatalog.nonDelegableActions); ({ ROLE_HIERARCHY, ROLE_NAMES, PAGE_ACCESS, resolveCapability, canAccessPage, getCurrentPageAccessPath, enforceCurrentPageAccess });`,
        sandbox,
        { filename }
    );
    return { ...api, sandbox, source: code };
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
    return String(value).split('#')[0].split('?')[0].replace(/\.html$/, '').replace(/\/$/, '') || '/';
}

function readRootHtml(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function htmlLoadsSharedAuth(source) {
    return /<script\b[^>]*\bsrc=["'][^"']*\/?js\/auth\.js(?:\?[^"']*)?["']/i.test(source);
}

function getStaticRedirectTarget(source) {
    const scriptRedirect = source.match(/window\.location\.replace\(["']([^"']+)["']\)/i);
    if (scriptRedirect) return normalizeSurfacePath(scriptRedirect[1]);
    const metaRefresh = source.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>\s]+)/i);
    return metaRefresh ? normalizeSurfacePath(metaRefresh[1]) : null;
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

function hasDirectPageAccess(page) {
    return Object.prototype.hasOwnProperty.call(frontend.PAGE_ACCESS, page)
        && Object.prototype.hasOwnProperty.call(backend.PAGE_ACCESS, page);
}

function hasPageAccess(page) {
    return hasDirectPageAccess(canonicalizePageKey(page));
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
    if (hasDirectPageAccess(entry.path)) {
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
    if (hasDirectPageAccess(entry.path)) {
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
    if (canonical && hasPageAccess(canonical)) {
        const html = readRootHtml(entry.file);
        const redirectTarget = getStaticRedirectTarget(html);
        const redirectIsProtected = redirectTarget && hasPageAccess(redirectTarget);
        if (!htmlLoadsSharedAuth(html) && !redirectIsProtected) {
            fail(`static surface ${entry.file}: protected page ${canonical} must load js/auth.js or redirect to a PAGE_ACCESS route`);
        }
    }
    if (canonical && !publicStaticExceptions.has(canonical)) {
        staticAccessPaths.add(canonicalizePageKey(canonical));
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
        staticAccessPaths.add(canonicalizePageKey(normalizedAlias));
    }
}

for (const page of allPages) {
    if (staticAccessPaths.has(page) || modalPageAccessPaths.has(page)) continue;
    fail(`PAGE_ACCESS ${page}: no static surface, alias, or modal ownership entry`);
}

for (const item of sidebar.NAV_ITEMS.filter(i => i.href)) {
    if (item.href === '#settings') continue;
    const page = normalizeHref(item.pageAccess || item.href);
    if (!page || sidebarPageExceptions.has(page) || modalPageAccessPaths.has(page)) continue;
    if (!Object.prototype.hasOwnProperty.call(frontend.PAGE_ACCESS, page)) {
        fail(`sidebar NAV item "${item.href}" has no capability registry entry for "${page}"`);
    }
}

const pageParityCases = [
    [{ role: 'manager' }, '/hr'],
    [{ role: 'animator', page_allowlist: ['/analytics'] }, '/finance'],
    [{ role: 'waiter' }, '/tasks'],
    [{ role: 'art_director' }, '/art-director'],
    [{ role: 'animator', page_allowlist: ['/maysternya-doli'] }, '/maysternya-doli']
];
for (const [user, capability] of pageParityCases) {
    frontend.sandbox.AppState.currentUser = user;
    const backendDecision = backend.resolveCapability(user, capability, { type: 'page' });
    const frontendDecision = frontend.resolveCapability(user, capability, { type: 'page', ignoreServer: true });
    for (const field of ['allowed', 'source', 'sourceRole', 'reason', 'key']) {
        if (backendDecision[field] !== frontendDecision[field]) {
            fail(`page resolver parity ${capability}.${field}: backend=${backendDecision[field]} frontend=${frontendDecision[field]}`);
        }
    }
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

let redirectTarget = null;
frontend.sandbox.window.location = {
    pathname: '/hr',
    href: '',
    hash: '',
    replace(target) { redirectTarget = target; },
    reload() {}
};
frontend.sandbox.AppState.currentUser = { role: 'accountant' };
if (frontend.enforceCurrentPageAccess() !== false || redirectTarget !== '/') {
    fail('frontend page guard must redirect disallowed manual URLs to the role start page');
}

redirectTarget = null;
frontend.sandbox.window.location = {
    pathname: '/embed/designs',
    href: '',
    hash: '',
    replace(target) { redirectTarget = target; },
    reload() {}
};
frontend.sandbox.AppState.currentUser = { role: 'art_director' };
if (frontend.getCurrentPageAccessPath() !== '/designs' || frontend.enforceCurrentPageAccess() !== true || redirectTarget) {
    fail('frontend page guard must evaluate embedded static routes against their parent page access');
}
if (!/hasVerifiedUser && !enforceCurrentPageAccess\(user\)/.test(frontend.source)) {
    fail('frontend sub-page bootstrap must run page access guard after verified AppState user is available');
}

if (failures.length) {
    console.error('Access matrix check failed:');
    failures.forEach(message => console.error(` - ${message}`));
    process.exit(1);
}

console.log(`Access matrix check passed: ${allRoles.length} roles, ${allPages.length} page entries, ${sidebar.NAV_ITEMS.filter(i => i.href).length} sidebar links.`);
