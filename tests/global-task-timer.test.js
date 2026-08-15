'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

function loadGlobalTimer(overrides = {}) {
    const listeners = [];
    const dispatched = [];
    const context = {
        console: { warn: () => {} },
        Date,
        Math,
        setTimeout: () => 0,
        clearTimeout: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        fetch: overrides.fetch || (async () => ({ ok: true, status: 200, json: async () => ({ success: true, timer: null }) })),
        AbortController: class {
            constructor() { this.signal = {}; }
            abort() { this.aborted = true; }
        },
        BroadcastChannel: overrides.BroadcastChannel,
        localStorage: {
            values: new Map(),
            getItem(key) { return this.values.get(key) || ''; },
            setItem(key, value) { this.values.set(key, String(value)); },
            removeItem(key) { this.values.delete(key); }
        },
        document: {
            documentElement: { dataset: {} },
            body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } },
            querySelector: () => null,
            querySelectorAll: () => [],
            getElementById: () => null,
            createElement: () => ({
                id: '',
                className: '',
                dataset: {},
                style: {},
                setAttribute: () => {},
                appendChild: () => {},
                insertBefore: () => {},
                remove: () => {},
                querySelectorAll: () => []
            }),
            addEventListener: (...args) => listeners.push(['document', ...args])
        },
        window: {
            addEventListener: (...args) => listeners.push(['window', ...args]),
            dispatchEvent: event => { dispatched.push(event); },
            setInterval: () => 1,
            clearInterval: () => {},
            isAuthenticatedRuntimeReady: () => overrides.runtimeReady === true,
            getAuthHeaders: () => ({ Authorization: 'Bearer test' })
        },
        CustomEvent: class {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail || {};
            }
        }
    };
    context.window.window = context.window;
    context.window.document = context.document;
    context.window.localStorage = context.localStorage;
    context.window.fetch = context.fetch;
    context.window.AbortController = context.AbortController;
    context.window.BroadcastChannel = context.BroadcastChannel;
    context.setTimeout = overrides.setTimeout || context.setTimeout;
    context.clearTimeout = overrides.clearTimeout || context.clearTimeout;
    context.window.setTimeout = context.setTimeout;
    context.window.clearTimeout = context.clearTimeout;
    vm.createContext(context);
    vm.runInContext(read('js/global-task-timer.js'), context);
    return { api: context.window.GlobalTaskTimer, context, listeners, dispatched };
}

test('global task timer assets are lazy-loaded after authenticated runtime is ready', () => {
    const auth = read('js/auth.js');
    assert.match(auth, /ensureGlobalTaskTimerAssets/);
    assert.match(auth, /\/css\/global-task-timer\.css/);
    assert.match(auth, /\/js\/global-task-timer\.js/);
    assert.match(auth, /scheduleGlobalTaskTimerAssets\(\)/);
    assert.match(auth, /crm:auth-cleared/);
});

test('global task timer broadcast contract carries only a refetch signal', () => {
    const { api } = loadGlobalTimer();
    const payload = api._test.buildSignalPayload('start');

    assert.equal(payload.contract, api._test.CONTRACT_VERSION);
    assert.equal(typeof payload.eventId, 'string');
    assert.equal(payload.action, 'start');
    assert.equal(api._test.isValidSignal(payload), true);
    assert.deepEqual(Object.keys(payload).sort(), ['action', 'contract', 'emittedAt', 'eventId']);
    assert.equal(api._test.isValidSignal({ ...payload, taskId: 41 }), false);
    assert.equal(api._test.isValidSignal({ ...payload, title: 'Secret title' }), false);
    assert.equal(api._test.isValidSignal({ ...payload, userId: 7 }), false);
    assert.equal(api._test.isValidSignal({ ...payload, businessContext: 'event_genix' }), false);
});

test('global task timer cross-tab signal hydrates and notifies My Day surfaces', async () => {
    const fetchCalls = [];
    const { api, context, dispatched } = loadGlobalTimer({
        fetch: async (url) => {
            fetchCalls.push(String(url));
            return { ok: true, status: 200, json: async () => ({ success: true, timer: { taskId: 19, durationSeconds: 4, isActive: true } }) };
        }
    });
    context.window.isAuthenticatedRuntimeReady = () => true;
    const payload = api._test.buildSignalPayload('start');

    await api._test.handleSignal(payload);

    assert.deepEqual(fetchCalls, ['/api/my-day/timer']);
    assert.equal(api.state.timer.taskId, 19);
    const event = dispatched.find(item => item.type === 'crm:timer-updated');
    assert.equal(event?.detail?.source, 'global');
    assert.equal(event?.detail?.action, 'start');
    assert.equal(event?.detail?.reason, 'signal');
});

test('global task timer queues a refresh when hydrate is already in flight', async () => {
    const pendingFetches = [];
    const fetchCalls = [];
    const { api, context } = loadGlobalTimer({
        setTimeout: callback => {
            callback();
            return 1;
        },
        fetch: async (url) => {
            fetchCalls.push(String(url));
            return new Promise(resolve => {
                pendingFetches.push(resolve);
            });
        }
    });
    context.window.isAuthenticatedRuntimeReady = () => true;

    const first = api.hydrate({ reason: 'manual' });
    const second = api.hydrate({ reason: 'event:start' });

    assert.equal(fetchCalls.length, 1);
    assert.equal(api.state.pendingHydrate, true);
    pendingFetches.shift()({ ok: true, status: 200, json: async () => ({ success: true, timer: { taskId: 19, durationSeconds: 4, isActive: true } }) });
    await first;
    await second;
    assert.equal(fetchCalls.length, 2);
    assert.equal(api.state.pendingHydrate, false);
    pendingFetches.shift()({ ok: true, status: 200, json: async () => ({ success: true, timer: { taskId: 20, durationSeconds: 8, isActive: true } }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(api.state.timer.taskId, 20);
});

test('global task timer normalizes sanitized and full timer payloads', () => {
    const { api } = loadGlobalTimer();
    const full = api._test.normalizeTimer({
        taskId: 9,
        durationSeconds: 61,
        businessContext: 'event_genix',
        task: { id: 9, title: 'Check report', status: 'in_progress' }
    });
    assert.equal(full.taskId, 9);
    assert.equal(full.task.title, 'Check report');
    assert.equal(full.businessContext, 'event_genix');

    const sanitized = api._test.normalizeTimer({
        taskId: 9,
        durationSeconds: 61,
        taskUnavailable: true,
        task: { id: 9, title: 'Should not leak' }
    });
    assert.equal(sanitized.taskUnavailable, true);
    assert.equal(sanitized.task, null);
});

test('time tracking service exposes businessContext for the global timer without changing ownership', () => {
    const service = read('services/myDayTimeTracking.js');
    assert.match(service, /t\.business_context AS task_business_context/);
    assert.match(service, /businessContext: row\.task_business_context/);
    assert.match(service, /WHERE e\.user_id = \$1 AND e\.ended_at IS NULL/);
    assert.doesNotMatch(service, /business_context = \$2/);
});

test('My Day timer actions notify global timer after start and stop', () => {
    const ui = read('js/my-day-time-tracking.js');
    assert.match(ui, /function notifyTimerChanged\(action\)/);
    assert.match(ui, /crm:timer-updated/);
    assert.match(ui, /GlobalTaskTimer\?\.notifyLocalChange\?\.\(action\)/);
    assert.match(ui, /notifyTimerChanged\('start'\)/);
    assert.match(ui, /notifyTimerChanged\('stop'\)/);
});

test('sidebar shell exposes a stable remount signal for the global timer', () => {
    const sidebar = read('js/components/sidebar.js');
    assert.match(sidebar, /function _notifyGlobalTaskTimerShellChanged\(\)/);
    assert.match(sidebar, /GlobalTaskTimer\.mount/);
    assert.match(sidebar, /crm:sidebar-shell-changed/);
    assert.match(sidebar, /_setSidebarCollapsed[\s\S]*_notifyGlobalTaskTimerShellChanged\(\)/);
});
