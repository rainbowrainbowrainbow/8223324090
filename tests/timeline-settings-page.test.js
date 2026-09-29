'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { normalizeBusinessCabinetSettings } = require('../services/businessCabinet');

const root = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'js/timeline-settings-page.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'js/components/sidebar.js'), 'utf8');
const settingsRoutes = fs.readFileSync(path.join(root, 'routes/settings.js'), 'utf8');

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

function createPage({ canManage, cabinet }) {
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
    const document = {
        readyState: 'complete',
        getElementById: getElement,
        querySelectorAll() { return []; },
        addEventListener() {}
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
            search: '?context=dar',
            href: 'https://crm.test/timeline-settings?context=dar'
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
            current: () => 'dar',
            state: () => ({ availableBusinesses: [{ key: 'dar', label: 'Dar' }] }),
            async hydrateProfile() { calls.push({ kind: 'hydrateProfile' }); },
            applyProfile(nextProfile) { calls.push({ kind: 'applyProfile', profile: nextProfile }); }
        },
        TimelineBusinessContext: {
            current: () => ({ key: 'dar' }),
            state: () => ({ availableBusinesses: [] })
        },
        showNotification() {}
    };

    async function apiGetBusinessCabinet(options) {
        calls.push({ kind: 'getCabinet', options });
        return { success: true, businessContext: 'dar', cabinet };
    }
    async function apiSaveBusinessCabinet(payload, options) {
        calls.push({ kind: 'saveCabinet', payload: structuredClone(payload), options });
        cabinet = normalizeBusinessCabinetSettings({
            ...cabinet,
            ...payload
        }, 'dar', { fallbackTimeline: cabinet.timeline, source: 'business_cabinet' });
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
            return { ok: true, status: 200, json: async () => ({ success: true, registry: [], blocks: {}, overrides: {} }) };
        }
    };
    vm.runInNewContext(pageSource, context);

    return { calls, elements, get cabinet() { return cabinet; } };
}

async function waitFor(predicate) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail('Timeline settings page did not finish initialization in time.');
}

function selectEducationMode(page) {
    const field = {
        type: 'select-one',
        value: 'education',
        dataset: { timelineSettingsDisplay: 'mode' },
        closest(selector) { return selector === '[data-timeline-settings-display]' ? this : null; }
    };
    page.elements.get('timelineSettingsSystemEditor').listeners.change({ target: field });
}

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
