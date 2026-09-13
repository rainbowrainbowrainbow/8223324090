'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { after, test } = require('node:test');
const { JSDOM } = require('jsdom');
const dbId = require.resolve('../db');
const originalDb = require.cache[dbId];
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool: {
    query() { throw new Error('Parity test requires explicit database'); }
} } };
const { businessCabinetForUser, normalizeBusinessCabinetSettings, saveBusinessCabinetSettings } = require('../services/businessCabinet');
const { buildModuleMap } = require('../services/businessProfile');
after(() => { if (originalDb) require.cache[dbId] = originalDb; else delete require.cache[dbId]; });

function user(context, modules) {
    return { id: 1, businessMembershipAccess: { membershipEnabled: true, memberships: [{
        businessContext: context, accessMode: 'membership', businessModules: modules
    }], registry: [{ businessContext: context, accessMode: 'membership', active: true }] } };
}

test('membership cabinet and canonical profile agree on explicit empty, unsupported and custom module configurations', () => {
    for (const context of ['event_genix', 'dar', 'fixture_studio']) {
        for (const modules of [[], ['tasks'], ['timeline', 'payroll']]) {
            const original = normalizeBusinessCabinetSettings({}, context);
            const before = structuredClone(original);
            const cabinet = businessCabinetForUser(original, user(context, modules));
            const profile = buildModuleMap(context, original.timeline, original, modules, true);
            assert.deepEqual(cabinet.modules.enabled, profile.enabled);
            assert.equal(cabinet.modules.readOnly, true);
            assert.equal(cabinet.modules.enabled.payroll, false);
            assert.equal(cabinet.timeline.enabledModules.timeline, modules.includes('timeline'));
            if (!modules.includes('timeline')) assert.equal(cabinet.timelineEnabled, false);
            assert.deepEqual(original, before);
        }
    }
});

test('compatibility cabinet preserves its previous module semantics', () => {
    const cabinet = normalizeBusinessCabinetSettings({}, 'event_genix');
    assert.equal(businessCabinetForUser(cabinet, { id: 1 }), cabinet);
});

test('old cabinet save rejects changed module aliases before any write but accepts unchanged registry echoes', async () => {
    let connects = 0;
    const writes = [];
    const db = { async query(sql) {
        assert.match(sql, /^SELECT value FROM settings/);
        return { rows: [] };
    }, async connect() {
        connects++;
        return { async query(sql, params) {
            if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
            assert.match(sql.trim(), /^INSERT INTO settings/);
            writes.push({ sql, params });
            return { rows: [] };
        }, release() {} };
    } };
    const actor = user('fixture_studio', ['tasks']);
    for (const field of ['modules', 'businessModules', 'moduleMap']) {
        await assert.rejects(saveBusinessCabinetSettings(db, 'fixture_studio', { [field]: { enabled: { payroll: true } } }, actor),
            { status: 400, code: 'business_modules_managed_by_organization' });
    }
    assert.equal(connects, 0);
    assert.equal(writes.length, 0);
    const echo = businessCabinetForUser(normalizeBusinessCabinetSettings({}, 'fixture_studio'), actor).modules;
    const result = await saveBusinessCabinetSettings(db, 'fixture_studio', { modules: echo, businessType: 'simple' }, actor);
    assert.deepEqual(result.modules.enabledIds, ['tasks']);
    assert.equal(connects, 1);
    assert.ok(writes.every(write => write.params[0].endsWith(':fixture_studio')));
});

test('settings renders registry module controls readonly and cannot force dashboard/settings or accept synthetic toggle clicks', t => {
    const dom = new JSDOM('<!doctype html><div id="settingsBusinessModuleGrid"></div>', { url: 'http://localhost/', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const state = { source: 'business_registry', catalog: ['dashboard', 'settings', 'timeline'],
        enabled: { dashboard: false, settings: false, timeline: false } };
    dom.window.CrmBusinessContext = { activeProfile: () => ({ key: 'fixture_studio', modules: state }), current: () => 'fixture_studio' };
    dom.window.escapeHtml = value => String(value);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/settings.js'), 'utf8'), dom.getInternalVMContext());
    dom.window.renderBusinessCabinetModuleButtons();
    const buttons = [...dom.window.document.querySelectorAll('[data-business-module]')];
    assert.equal(buttons.length, 3);
    assert.ok(buttons.every(button => button.disabled && button.getAttribute('aria-pressed') === 'false'));
    assert.equal(dom.window.document.querySelector('a').getAttribute('href'), '/profile');
    buttons[0].disabled = false;
    dom.window.handleTimelineControlClick({ target: buttons[0], preventDefault() {} });
    assert.equal(buttons[0].getAttribute('aria-pressed'), 'false');
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.collectBusinessCabinetModules().enabled)), state.enabled);
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.deriveBusinessModuleStateFromTimeline({ enabledModules: { timeline: true } }).enabled)), state.enabled);
});
