'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { normalizeBusinessCabinetSettings } = require('../services/businessCabinet');
const { resourceTypeForDisplayMode } = require('../services/timelineResources');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'js/timeline-settings-page.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'js/components/sidebar.js'), 'utf8');
const settingsRoutes = fs.readFileSync(path.join(root, 'routes/settings.js'), 'utf8');
const timelineSource = fs.readFileSync(path.join(root, 'js/timeline-context.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'js/settings.js'), 'utf8');

function sourceHelpers(window, storage = new Map()) {
    const context = {
        window,
        currentContext: () => ({ key: 'event_genix' }),
        resourceTypeForMode: resourceTypeForDisplayMode,
        safeJson: raw => raw ? JSON.parse(raw) : null,
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
    };
    vm.runInNewContext(timelineSource.slice(timelineSource.indexOf('    function rowSource('), timelineSource.indexOf('    function appendApiContext(')), context);
    return Object.fromEntries(['rowSource', 'confirmRowSourceChange', 'rememberParkView', 'restoreParkView'].map(key => [key, context[key]]));
}

function cabinetFixture() {
    return normalizeBusinessCabinetSettings({
        businessType: 'simple',
        timelineMode: 'simple',
        timelineEnabled: true,
        startPage: 'timeline',
        modules: { enabled: { leads: true, customers: true, kitchen: false } },
        timeline: {
            mode: 'simple',
            resourceModel: 'specialist',
            enabledModules: {
                timeline: true,
                bookings: true,
                resources: false,
                teachers: false,
                lessonSeries: false,
                leads: false,
                kitchen: true
            },
            timelineFeatures: {
                series: false,
                seriesBadge: false,
                teacherConflict: false,
                resourceCapacity: false,
                kitchen: true
            },
            bookingPolicy: {
                allowLessonsWithoutTeacher: false,
                allowLessonsWithoutGroup: false,
                enforceTeacherConflict: false,
                enforceResourceCapacity: false,
                notifyFirstOccurrenceOnly: false
            }
        }
    }, 'dar');
}

function createPage({ canManage, cabinet, businessContext = 'dar', confirmations = [true], saveResults = [], loadResults = [], storage = new Map() }) {
    const calls = [];
    const elements = new Map();
    let sessionReady = false;
    const getElement = id => {
        if (!elements.has(id)) {
            const listeners = {};
            elements.set(id, {
                id,
                listeners,
                dataset: {},
                className: '',
                classList: { toggle() {} },
                addEventListener(name, handler) { listeners[name] = handler; },
                setAttribute() {},
                innerHTML: '',
                textContent: '',
                hidden: false,
                disabled: false,
                href: ''
            });
        }
        return elements.get(id);
    };
    const documentListeners = {};
    const document = {
        readyState: 'complete',
        getElementById: getElement,
        querySelectorAll() { return []; },
        addEventListener(name, handler) { documentListeners[name] = handler; }
    };
    const profile = {
        activeBusinessId: 'dar',
        businesses: [{ key: 'dar', timeline: { mode: cabinet.timelineMode, timelineEnabled: cabinet.timelineEnabled } }]
    };
    const user = { id: 17, role: 'creator' };
    const window = {
        document,
        API_BASE: '/api',
        AppState: { currentUser: user },
        location: {
            pathname: '/timeline-settings',
            search: `?context=${businessContext}`,
            href: `https://crm.test/timeline-settings?context=${businessContext}`
        },
        history: { replaceState() {} },
        addEventListener() {},
        setTimeout() { return 0; },
        resolveCapability(currentUser, capability) {
            return { allowed: sessionReady && canManage && currentUser?.role === 'creator' && capability === 'manage_settings' };
        },
        async checkSession() {
            calls.push({ kind: 'checkSession' });
            sessionReady = true;
            return true;
        },
        CrmBusinessContext: {
            current: () => businessContext,
            state: () => ({ availableBusinesses: [{ key: businessContext, label: 'Synthetic business' }] }),
            async hydrateProfile() { calls.push({ kind: 'hydrateProfile' }); },
            applyProfile(nextProfile) { calls.push({ kind: 'applyProfile', profile: nextProfile }); }
        },
        TimelineBusinessContext: {
            current: () => ({ key: businessContext }),
            state: () => ({ availableBusinesses: [] })
        },
        async confirmModal(message, options) {
            calls.push({ kind: 'confirm', message, options });
            return confirmations.length ? confirmations.shift() : true;
        },
        showNotification(message, type) { calls.push({ kind: 'notice', message, type }); }
    };
    Object.assign(window.TimelineBusinessContext, sourceHelpers(window, storage));

    async function apiGetBusinessCabinet(options) {
        calls.push({ kind: 'getCabinet', options });
        if (loadResults.length && loadResults.shift() === false) return { success: false, error: 'Synthetic load failure' };
        return { success: true, businessContext, cabinet };
    }
    async function apiSaveBusinessCabinet(payload, options) {
        calls.push({ kind: 'saveCabinet', payload: structuredClone(payload), options });
        if (saveResults.length && saveResults.shift() === false) return { success: false, error: 'Synthetic save failure' };
        cabinet = normalizeBusinessCabinetSettings({
            ...cabinet,
            ...payload
        }, businessContext, { fallbackTimeline: cabinet.timeline, source: 'business_cabinet' });
        const businessProfile = {
            activeBusinessId: 'dar',
            businesses: [{ key: 'dar', timeline: { mode: cabinet.timelineMode, timelineEnabled: cabinet.timelineEnabled } }]
        };
        calls.push({ kind: 'savedBusinessProfile', profile: businessProfile });
        return { success: true, cabinet, businessProfile };
    }

    const context = {
        window,
        document,
        URL,
        URLSearchParams,
        clearTimeout() {},
        console: { error() {}, warn() {} },
        getAuthHeaders: () => ({ Authorization: 'synthetic-session' }),
        apiGetBusinessCabinet,
        apiSaveBusinessCabinet,
        async fetch(url, options) {
            calls.push({ kind: 'fetch', url, options });
            return { ok: true, status: 200, json: async () => ({ success: true, registry: [{ id: 'toolbar', label: 'Toolbar' }], blocks: {}, overrides: {} }) };
        }
    };
    vm.runInNewContext(pageSource, context);

    return { calls, elements, window, documentListeners, get cabinet() { return cabinet; } };
}

async function waitFor(predicate) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail('Timeline settings page did not finish initialization in time.');
}

function changeDisplay(page, key, value) {
    const field = {
        type: typeof value === 'boolean' ? 'checkbox' : 'select-one',
        value,
        checked: value,
        dataset: { timelineSettingsDisplay: key },
        closest(selector) { return selector === '[data-timeline-settings-display]' ? this : null; }
    };
    page.elements.get('timelineSettingsSystemEditor').listeners.change({ target: field });
}

function selectEducationMode(page) { changeDisplay(page, 'mode', 'education'); }

test('Creator can save the education preset to Dar business cabinet and reload the same profile', async () => {
    const page = createPage({ canManage: true, cabinet: cabinetFixture() });
    await waitFor(() => page.elements.get('timelineSettingsSystemEditor')?.innerHTML.includes('value="simple"'));
    assert.equal(page.calls[0].kind, 'checkSession', 'session permission bootstrap must precede page API reads');
    assert.equal(page.elements.get('timelineSettingsSaveBtn').disabled, true);

    selectEducationMode(page);
    assert.equal(page.elements.get('timelineSettingsSaveBtn').disabled, false);
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();

    const save = page.calls.find(call => call.kind === 'saveCabinet');
    assert.ok(save);
    assert.equal(save.options.context, 'dar');
    assert.equal(save.payload.businessType, 'education');
    assert.equal(save.payload.timelineMode, 'education');
    assert.equal(save.payload.resourceModel, 'cabinet');
    assert.equal(save.payload.enabledModules.resources, true);
    assert.equal(save.payload.enabledModules.teachers, true);
    assert.equal(save.payload.enabledModules.lessonSeries, true);
    assert.equal(save.payload.timelineFeatures.series, true);
    assert.equal(save.payload.timelineFeatures.seriesBadge, true);
    assert.equal(save.payload.timelineFeatures.teacherConflict, true);
    assert.equal(save.payload.timelineFeatures.resourceCapacity, true);
    assert.equal(save.payload.bookingPolicy.enforceTeacherConflict, true);
    assert.equal(save.payload.bookingPolicy.enforceResourceCapacity, true);
    assert.equal(save.payload.modules, undefined, 'cabinet shell modules stay server-merged and untouched');
    assert.equal(save.payload.enabledModules.leads, false, 'unrelated timeline modules retain their prior value');
    assert.equal(save.payload.enabledModules.kitchen, true, 'unrelated timeline modules retain their prior value');
    assert.equal(save.payload.timelineFeatures.quickCloseSlot, true);
    assert.equal(save.payload.timelineFeatures.freeResources, true);
    assert.equal(save.payload.timelineFeatures.compactBlocks, true);
    assert.equal(page.cabinet.businessType, 'education');
    assert.equal(page.cabinet.timeline.mode, 'education');
    assert.equal(page.cabinet.modules.enabled.leads, true, 'unrelated business modules remain unchanged');
    assert.equal(page.calls.find(call => call.kind === 'applyProfile').profile.businesses[0].timeline.mode, 'education');
    assert.equal(page.calls.some(call => call.url?.includes('/settings/timeline-display')), false);
    assert.match(page.elements.get('timelineSettingsSystemEditor').innerHTML, /value="education" selected/);

    const reload = createPage({ canManage: true, cabinet: page.cabinet });
    await waitFor(() => reload.elements.get('timelineSettingsSystemEditor')?.innerHTML.includes('value="education" selected'));
    assert.equal(reload.cabinet.businessType, 'education');
    assert.equal(reload.cabinet.timeline.mode, 'education');
});

test('user without manage_settings cannot save even after changing the education mode', async () => {
    const page = createPage({ canManage: false, cabinet: cabinetFixture() });
    await waitFor(() => page.elements.get('timelineSettingsSystemEditor')?.innerHTML.includes('value="simple"'));
    selectEducationMode(page);
    assert.equal(page.elements.get('timelineSettingsSaveBtn').disabled, true);
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    assert.equal(page.calls.some(call => call.kind === 'saveCabinet'), false);

    assert.match(settingsRoutes, /router\.put\('\/business\/cabinet', requireRole\('creator', 'director'\), requireSettingsManagement/);
    assert.match(settingsRoutes, /const requireSettingsManagement = requireAction\('manage_settings'\)/);
});

test('education lessons menu stays gated by an enabled education timeline profile', () => {
    assert.match(sidebarSource, /profile\?\.timeline\?\.mode === 'education'\s*&& profile\?\.timeline\?\.timelineEnabled !== false/);
});

function parkCabinet() {
    return normalizeBusinessCabinetSettings({
        mode: 'park', timelineMode: 'park', businessType: 'children_entertainment_park',
        startPage: 'tasks', resourceModel: 'auto', roomTimelineEnabled: true, defaultTimelineView: 'rooms',
        enabledModules: { leads: false, kitchen: false, teachers: false },
        timelineFeatures: { quickCloseSlot: false, kitchen: false },
        modules: { enabled: { leads: false, kitchen: false } }
    }, 'event_genix');
}

async function ready(page) {
    await waitFor(() => page.elements.get('timelineSettingsSystemEditor')?.innerHTML.includes('data-timeline-settings-display'));
}

function editVisualLabel(page) {
    const field = {
        value: 'Custom label', dataset: { timelineSettingsField: 'customLabel' },
        closest: () => field
    };
    page.elements.get('timelineSettingsVisualEditor').listeners.input({ target: field });
}

test('source help distinguishes catalog animators, shift rows and park room view', () => {
    const helpers = sourceHelpers({});
    for (const mode of ['simple', 'specialist']) {
        const source = helpers.rowSource({ mode, resourceModel: 'animator' }, 'event_genix');
        assert.equal(source.key, 'catalog:animator');
        assert.match(source.text, /не повертає графік змін/);
        assert.match(source.text, /окремо налаштовані ресурси/);
    }
    assert.match(helpers.rowSource({ mode: 'park', roomTimelineEnabled: false }, 'event_genix').text, /графік змін/);
    const rooms = helpers.rowSource({ mode: 'park', roomTimelineEnabled: true, defaultTimelineView: 'rooms' }, 'event_genix');
    assert.match(rooms.text, /Кімнатний вигляд:.*без графіка аніматорів/);
    assert.match(rooms.text, /Стартовий вигляд: кімнати/);
    assert.equal(helpers.rowSource({ mode: 'disabled' }, 'event_genix').key, 'disabled');
});

test('source confirmation precedes all writes and cancellation retains both drafts', async () => {
    const page = createPage({ canManage: true, cabinet: parkCabinet(), businessContext: 'event_genix', confirmations: [false, true] });
    await ready(page);
    changeDisplay(page, 'mode', 'simple');
    changeDisplay(page, 'resourceModel', 'animator');
    editVisualLabel(page);
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    assert.equal(page.calls.some(call => call.kind === 'saveCabinet' || call.options?.method === 'PUT'), false);
    assert.equal(page.elements.get('timelineSettingsSaveBtn').disabled, false);
    assert.match(page.elements.get('timelineSettingsSystemEditor').innerHTML, /value="simple" selected/);
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    const firstWrite = page.calls.findIndex(call => call.kind === 'saveCabinet' || call.options?.method === 'PUT');
    const lastConfirm = page.calls.map(call => call.kind).lastIndexOf('confirm');
    assert.ok(lastConfirm >= 0 && lastConfirm < firstWrite);
    const visibility = page.calls.find(call => call.options?.method === 'PUT');
    assert.equal(JSON.parse(visibility.options.body).blocks.toolbar.customLabel, 'Custom label');
    assert.equal(page.cabinet.resourceModel, 'animator');
});

for (const mode of ['simple', 'specialist']) {
    test(`park -> ${mode} -> park preserves independent settings and reloads the saved profile`, async () => {
        const original = parkCabinet();
        const storage = new Map();
        const page = createPage({ canManage: true, cabinet: original, businessContext: 'event_genix', storage });
        await ready(page);
        changeDisplay(page, 'mode', mode);
        await page.elements.get('timelineSettingsSaveBtn').listeners.click();
        // Reopening while outside park must retain the dormant room choice in this browser.
        const reopened = createPage({ canManage: true, cabinet: page.cabinet, businessContext: 'event_genix', storage });
        await ready(reopened);
        changeDisplay(reopened, 'mode', 'park');
        await reopened.elements.get('timelineSettingsSaveBtn').listeners.click();
        assert.deepEqual(reopened.cabinet.timeline.enabledModules, original.timeline.enabledModules);
        assert.deepEqual(reopened.cabinet.timeline.timelineFeatures, original.timeline.timelineFeatures);
        assert.deepEqual(reopened.cabinet.modules.enabled, original.modules.enabled);
        assert.equal(reopened.cabinet.startPage, 'tasks');
        assert.equal(reopened.cabinet.timeline.roomTimelineEnabled, true);
        assert.equal(reopened.cabinet.timeline.defaultTimelineView, 'rooms');
        const reload = createPage({ canManage: true, cabinet: reopened.cabinet, businessContext: 'event_genix' });
        await ready(reload);
        assert.match(reload.elements.get('timelineSettingsSystemEditor').innerHTML, /value="park" selected/);
        assert.match(reload.elements.get('timelineSettingsSystemEditor').innerHTML, /Кімнатний вигляд:/);
    });
}

test('failed save retains the saved source baseline and confirms again on retry', async () => {
    const page = createPage({ canManage: true, cabinet: parkCabinet(), businessContext: 'event_genix', saveResults: [false, true] });
    await ready(page);
    changeDisplay(page, 'mode', 'simple');
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    assert.equal(page.cabinet.timelineMode, 'park');
    assert.equal(page.elements.get('timelineSettingsSaveBtn').disabled, false);
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    assert.equal(page.calls.filter(call => call.kind === 'confirm').length, 2);
    assert.equal(page.cabinet.timelineMode, 'simple');
    changeDisplay(page, 'startPage', 'leads');
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    assert.equal(page.calls.filter(call => call.kind === 'confirm').length, 2, 'successful source is the new baseline');
});

test('visual labels and same-source mode changes save without source confirmation', async () => {
    const page = createPage({ canManage: true, cabinet: cabinetFixture() });
    await ready(page);
    editVisualLabel(page);
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    changeDisplay(page, 'mode', 'specialist');
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    assert.equal(page.calls.some(call => call.kind === 'confirm'), false);
});

test('missing confirmation UI fails closed before any write', async () => {
    const page = createPage({ canManage: true, cabinet: parkCabinet(), businessContext: 'event_genix' });
    await ready(page);
    delete page.window.confirmModal;
    changeDisplay(page, 'mode', 'simple');
    editVisualLabel(page);
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    assert.equal(page.calls.some(call => call.kind === 'saveCabinet' || call.options?.method === 'PUT'), false);
    assert.equal(page.elements.get('timelineSettingsSaveBtn').disabled, false);
});

test('failed context load cannot reuse the previous business saved baseline', async () => {
    const page = createPage({ canManage: true, cabinet: parkCabinet(), businessContext: 'event_genix', loadResults: [true, false] });
    await ready(page);
    const button = {
        dataset: { timelineSettingsContext: 'dar' },
        closest: selector => selector === '[data-timeline-settings-context]' ? button : null
    };
    page.documentListeners.click({ target: button, preventDefault() {} });
    await waitFor(() => page.calls.some(call => call.kind === 'notice' && call.message === 'Synthetic load failure'));
    changeDisplay(page, 'mode', 'simple');
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    assert.equal(page.calls.some(call => call.kind === 'saveCabinet' || call.options?.method === 'PUT'), false);
    assert.ok(page.calls.some(call => call.kind === 'notice' && /Спочатку завантажте/.test(call.message)));
});

test('pending confirmation prevents duplicate saves and changes to the reviewed draft', async () => {
    let confirm;
    const answer = new Promise(resolve => { confirm = resolve; });
    const page = createPage({ canManage: true, cabinet: parkCabinet(), businessContext: 'event_genix', confirmations: [answer] });
    await ready(page);
    changeDisplay(page, 'mode', 'simple');
    const pending = page.elements.get('timelineSettingsSaveBtn').listeners.click();
    changeDisplay(page, 'mode', 'park');
    await page.elements.get('timelineSettingsSaveBtn').listeners.click();
    confirm(true);
    await pending;
    assert.equal(page.calls.filter(call => call.kind === 'saveCabinet').length, 1);
    assert.equal(page.cabinet.timelineMode, 'simple');
});

test('dormant park view preferences remain isolated by business context', () => {
    const storage = new Map();
    const helpers = sourceHelpers({}, storage);
    helpers.rememberParkView({ mode: 'park', roomTimelineEnabled: true, defaultTimelineView: 'rooms' }, 'event_genix');
    helpers.rememberParkView({ mode: 'park', roomTimelineEnabled: false, defaultTimelineView: 'animators' }, 'dar');
    const reopened = sourceHelpers({}, storage);
    assert.equal(reopened.restoreParkView('event_genix').roomTimelineEnabled, true);
    assert.equal(reopened.restoreParkView('dar').roomTimelineEnabled, false);
});

async function createModal({ confirmations = [true], saveResults = [], saved = parkCabinet(), storage = new Map() } = {}) {
    const moduleKeys = ['timeline', 'bookings', 'leads', 'customers', 'omni', 'tasks', 'products', 'afisha', 'kitchen', 'resources', 'teachers', 'lessonSeries'];
    const featureKeys = ['quickCloseSlot', 'freeResources', 'series', 'afisha', 'kitchen', 'compactBlocks', 'seriesBadge', 'teacherConflict', 'resourceCapacity'];
    const policyKeys = ['allowLessonsWithoutTeacher', 'allowLessonsWithoutGroup', 'enforceTeacherConflict', 'enforceResourceCapacity', 'notifyFirstOccurrenceOnly'];
    const buttons = (attr, keys) => keys.map(key => `<button data-${attr}="${key}"></button>`).join('');
    const dom = new JSDOM(`<body>
        <select id="settingsTimelineDisplayMode">${['park', 'simple', 'specialist', 'education'].map(mode => `<option>${mode}</option>`).join('')}</select>
        <select id="settingsTimelineKitchenMode"><option>with_kitchen</option><option>without_kitchen</option></select>
        <input id="settingsTimelineRoomFirstEnabled" type="checkbox">
        <select id="settingsTimelineDefaultView"><option>rooms</option><option>animators</option></select>
        <div id="settingsTimelineDisplayPreview"></div>
        <button data-timeline-preset="catalog_animator" data-mode="simple" data-resource-model="animator"></button>
        <button data-timeline-preset="park" data-mode="park" data-resource-model="auto"></button>
        ${buttons('timeline-start-page', ['timeline', 'tasks', 'leads'])}
        ${buttons('timeline-resource-model', ['auto', 'animator', 'specialist', 'cabinet'])}
        ${buttons('timeline-module', moduleKeys)}${buttons('timeline-feature', featureKeys)}${buttons('timeline-policy', policyKeys)}
    </body>`, { url: 'https://crm.test/', runScripts: 'outside-only' });
    const { window } = dom;
    const calls = [];
    let cabinet = saved;
    window.TimelineBusinessContext = {
        current: () => ({ key: 'event_genix' }), displaySettings: () => cabinet.timeline,
        saveDisplaySettings: settings => settings, ...sourceHelpers(window, storage)
    };
    window.CrmBusinessContext = {
        activeProfile: () => ({ key: 'event_genix', modules: cabinet.modules }),
        async hydrateProfile() {}, applyProfile() {}
    };
    window.resolveCapability = () => ({ allowed: true });
    window.AppState = { currentUser: { role: 'creator' } };
    window.escapeHtml = value => String(value);
    window.showNotification = (message, type) => calls.push({ kind: 'notice', message, type });
    window.setTimeout = () => 0;
    window.confirmModal = async message => {
        calls.push({ kind: 'confirm', message });
        return confirmations.length ? confirmations.shift() : true;
    };
    window.apiGetBusinessCabinet = async () => ({ success: true, cabinet });
    window.apiSaveBusinessCabinet = async payload => {
        calls.push({ kind: 'save', payload: structuredClone(payload) });
        if (saveResults.length && saveResults.shift() === false) return { success: false };
        cabinet = normalizeBusinessCabinetSettings(payload, 'event_genix', { fallbackTimeline: cabinet.timeline });
        return { success: true, cabinet, businessProfile: {} };
    };
    window.fetch = async () => { throw new Error('Unexpected network request'); };
    window.console.warn = () => {};
    vm.runInContext(settingsSource, dom.getInternalVMContext());
    await window.loadTimelineDisplaySettingsIntoModal();
    return { window, calls, close: () => window.close(), get cabinet() { return cabinet; } };
}

test('legacy modal mode changes preserve independent controls including disabled room view', async t => {
    const saved = normalizeBusinessCabinetSettings({ ...parkCabinet(), roomTimelineEnabled: false, defaultTimelineView: 'animators' }, 'event_genix');
    const modal = await createModal({ saved });
    t.after(modal.close);
    const before = modal.window.collectTimelineDisplaySettingsFromControls();
    const mode = modal.window.document.getElementById('settingsTimelineDisplayMode');
    for (const value of ['simple', 'specialist', 'park']) {
        mode.value = value;
        modal.window.handleTimelineDisplayModeChange();
    }
    const after = modal.window.collectTimelineDisplaySettingsFromControls();
    assert.equal(after.startPage, before.startPage);
    assert.equal(after.roomTimelineEnabled, false);
    assert.deepEqual(after.enabledModules, before.enabledModules);
    assert.deepEqual(after.timelineFeatures, before.timelineFeatures);
    assert.deepEqual(after.modules, before.modules);
});

test('legacy modal cancellation and failed save preserve draft and saved baseline', async t => {
    const modal = await createModal({ confirmations: [false, true, true], saveResults: [false, true] });
    t.after(modal.close);
    const mode = modal.window.document.getElementById('settingsTimelineDisplayMode');
    mode.value = 'simple';
    modal.window.handleTimelineDisplayModeChange();
    await modal.window.saveTimelineDisplaySettingsFromSettings();
    assert.equal(modal.calls.some(call => call.kind === 'save'), false);
    assert.equal(mode.value, 'simple');
    await modal.window.saveTimelineDisplaySettingsFromSettings();
    assert.equal(modal.cabinet.timelineMode, 'park');
    await modal.window.saveTimelineDisplaySettingsFromSettings();
    assert.equal(modal.cabinet.timelineMode, 'simple');
    assert.equal(modal.calls.filter(call => call.kind === 'confirm').length, 3);
    assert.match(modal.window.document.getElementById('settingsTimelineDisplayPreview').textContent, /окремо налаштовані ресурси/);
    modal.window.handleTimelineControlClick({ target: modal.window.document.querySelector('[data-timeline-start-page="leads"]'), preventDefault() {} });
    await modal.window.saveTimelineDisplaySettingsFromSettings();
    assert.equal(modal.calls.filter(call => call.kind === 'confirm').length, 3);
});

test('legacy presets preserve independent settings through save and reopen', async t => {
    const storage = new Map();
    const original = await createModal({ storage });
    t.after(original.close);
    original.window.handleTimelineControlClick({
        target: original.window.document.querySelector('[data-timeline-preset="catalog_animator"]'), preventDefault() {}
    });
    assert.match(original.window.document.getElementById('settingsTimelineDisplayPreview').textContent, /не повертає графік змін/);
    await original.window.saveTimelineDisplaySettingsFromSettings();
    const reopened = await createModal({ saved: original.cabinet, storage });
    t.after(reopened.close);
    reopened.window.handleTimelineControlClick({
        target: reopened.window.document.querySelector('[data-timeline-preset="park"]'), preventDefault() {}
    });
    await reopened.window.saveTimelineDisplaySettingsFromSettings();
    assert.equal(reopened.cabinet.timeline.roomTimelineEnabled, true);
    assert.equal(reopened.cabinet.timeline.defaultTimelineView, 'rooms');
    assert.equal(reopened.cabinet.startPage, 'tasks');
    assert.equal(reopened.cabinet.timeline.enabledModules.leads, false);
    assert.equal(reopened.cabinet.timeline.timelineFeatures.quickCloseSlot, false);
});
