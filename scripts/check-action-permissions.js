#!/usr/bin/env node
'use strict';

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

function loadBackendAuth() {
    const filename = path.join(ROOT, 'middleware', 'auth.js');
    const code = fs.readFileSync(filename, 'utf8');
    const module = { exports: {} };
    const sandbox = {
        module,
        exports: module.exports,
        require(request) {
            if (request === '../db') return { pool: { query: async () => ({ rows: [] }) } };
            if (request === '../utils/logger') return { createLogger: makeLogger };
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

function loadFrontendAuth() {
    const filename = path.join(ROOT, 'js', 'auth.js');
    const code = fs.readFileSync(filename, 'utf8');
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
    const sandbox = {
        console,
        document,
        window: {},
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
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.__capabilityCatalog = require(path.join(ROOT, 'services/accountAccessPolicy')).buildCapabilityCatalog();
    const api = vm.runInNewContext(
        `${code}\n;ACTION_PERMISSIONS = __capabilityCatalog.actionRoles; NON_DELEGABLE_ACTIONS = new Set(__capabilityCatalog.nonDelegableActions); ({ ACTION_PERMISSIONS, NON_DELEGABLE_ACTIONS, resolveCapability });`,
        sandbox,
        { filename }
    );
    return { ...api, sandbox };
}

function sortedUnique(values = []) {
    return [...new Set(values)].sort();
}

function compareRoleSets(label, left, right) {
    const a = sortedUnique(left);
    const b = sortedUnique(right);
    if (a.length === b.length && a.every((role, index) => role === b[index])) return;
    const onlyBackend = a.filter(role => !b.includes(role));
    const onlyFrontend = b.filter(role => !a.includes(role));
    fail(`${label}: mismatch${onlyBackend.length ? `; backend only: ${onlyBackend.join(',')}` : ''}${onlyFrontend.length ? `; frontend only: ${onlyFrontend.join(',')}` : ''}`);
}

const backend = loadBackendAuth();
const frontend = loadFrontendAuth();

const backendActions = backend.ACTION_PERMISSIONS || {};
const frontendActions = frontend.ACTION_PERMISSIONS || {};
const backendKeys = Object.keys(backendActions).sort();
const frontendKeys = Object.keys(frontendActions).sort();

for (const key of backendKeys) {
    if (!Object.prototype.hasOwnProperty.call(frontendActions, key)) fail(`js/auth.js ACTION_PERMISSIONS missing "${key}"`);
}
for (const key of frontendKeys) {
    if (!Object.prototype.hasOwnProperty.call(backendActions, key)) fail(`middleware/auth.js ACTION_PERMISSIONS missing "${key}"`);
}
for (const key of backendKeys.filter(key => Object.prototype.hasOwnProperty.call(frontendActions, key))) {
    compareRoleSets(`ACTION_PERMISSIONS.${key}`, backendActions[key], frontendActions[key]);
}

compareRoleSets(
    'NON_DELEGABLE_ACTIONS',
    Array.from(backend.NON_DELEGABLE_ACTIONS || []),
    Array.from(frontend.NON_DELEGABLE_ACTIONS || [])
);

const actionParityCases = [
    [{ role: 'animator', action_allowlist: ['delete_booking'] }, 'delete_booking'],
    [{ role: 'manager', action_denylist: ['export_data'] }, 'export_data'],
    [{ role: 'director' }, 'manage_accounts'],
    [{ role: 'animator', action_allowlist: ['manage_accounts'] }, 'manage_accounts'],
    [{ role: 'animator', extra_roles: ['hr'] }, 'view_payroll']
];
for (const [user, capability] of actionParityCases) {
    frontend.sandbox.AppState.currentUser = user;
    const backendDecision = backend.resolveCapability(user, capability, { type: 'action' });
    const frontendDecision = frontend.resolveCapability(user, capability, { type: 'action', ignoreServer: true });
    for (const field of ['allowed', 'source', 'sourceRole', 'reason', 'key']) {
        if (backendDecision[field] !== frontendDecision[field]) {
            fail(`action resolver parity ${capability}.${field}: backend=${backendDecision[field]} frontend=${frontendDecision[field]}`);
        }
    }
}

const TASK_4_TO_8_CRITICAL_GUARDS = [
    { file: 'routes/staff.js', label: 'staff schedule XLSX export', needles: ["router.post('/schedule/export-xlsx', requireAction('hr.schedule.view'), requireAction('export_data')", 'buildStaffScheduleWorkbookBuffer'] },
    { file: 'routes/catalogs.js', label: 'catalog settings mutation', needles: ["router.put('/settings/:catalogId', requireAction('manage_settings')"] },
    { file: 'routes/omnichannel.js', label: 'lead-assistant settings mutation', needles: ["const manageLeadAssistantSettings = requireAction('manage_settings')", "router.put('/lead-assistant/settings', auth, manageLeadAssistantSettings"] },
    { file: 'routes/products.js', label: 'program-icon settings', needles: ["router.get('/program-icon-settings', requireAction('manage_settings')", "router.put('/program-icon-settings', requireAction('manage_settings')"] },
    { file: 'js/staff-page.js', label: 'staff schedule export UI', needles: ["StaffState.canExportSchedule = StaffState.canViewSchedule && canUseStaffCapability('export_data')", 'if (!StaffState.canExportSchedule)'] },
    { file: 'js/programs-page.js', label: 'program-icon settings UI', needles: ["canAccess('manage_settings')", 'syncProgramIconSettingsAccess()'] }
];

for (const contract of TASK_4_TO_8_CRITICAL_GUARDS) {
    const filename = path.join(ROOT, contract.file);
    const source = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
    for (const needle of contract.needles) {
        if (!source.includes(needle)) fail(`${contract.label}: missing ${needle} in ${contract.file}`);
    }
}

const exportRouteFiles = fs.readdirSync(path.join(ROOT, 'routes'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => `routes/${entry.name}`);

for (const routeFile of exportRouteFiles) {
    const source = fs.readFileSync(path.join(ROOT, routeFile), 'utf8');
    const exportRouteLines = source.split(/\r?\n/).filter(line => (
        /router\.(?:get|post|put|patch|delete)\(\s*['"][^'"]*\/export[^'"]*['"]/.test(line)
    ));
    for (const line of exportRouteLines) {
        if (!line.includes("requireAction('export_data')") && !line.includes('requireFinanceExport')) {
            fail(`${routeFile}: export route lacks export_data or a documented domain export guard: ${line.trim()}`);
        }
    }
}

if (failures.length) {
    console.error('Action permission drift check failed:');
    failures.forEach(item => console.error(`- ${item}`));
    process.exit(1);
}

console.log(`Action permission drift check passed: ${backendKeys.length} actions.`);
