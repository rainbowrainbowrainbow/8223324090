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
    return vm.runInNewContext(
        `${code}\n;({ ACTION_PERMISSIONS, NON_DELEGABLE_ACTIONS });`,
        sandbox,
        { filename }
    );
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

if (failures.length) {
    console.error('Action permission drift check failed:');
    failures.forEach(item => console.error(`- ${item}`));
    process.exit(1);
}

console.log(`Action permission drift check passed: ${backendKeys.length} actions.`);
