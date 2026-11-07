'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const kind of ['status', 'agents']) {
    test(`${kind} optional polling pauses hidden reads, refreshes on return and cleans up`, async () => {
        const markup = kind === 'status'
            ? '<div id="overallBanner"></div><div id="overallText"></div><div id="componentsSections"></div><div id="incidentsList"></div><div id="incidentsEmpty"></div><div id="checkedAt"></div>'
            : '<div id="agentStatusBar"><div id="agentStatusItems"></div></div>';
        const dom = new JSDOM(`<body>${markup}</body>`, { url: 'https://fixture.local/', runScripts: 'outside-only' });
        const w = dom.window;
        let visibility = 'hidden', calls = 0, cleared = 0;
        Object.defineProperty(w.document, 'visibilityState', { get: () => visibility });
        w.localStorage.setItem('pzp_role', 'admin');
        const intervals = [], ready = [];
        w.setInterval = callback => { intervals.push(callback); return intervals.length; };
        w.clearInterval = () => { cleared++; };
        const listen = w.document.addEventListener.bind(w.document);
        w.document.addEventListener = (name, callback, options) => {
            if (name === 'DOMContentLoaded') ready.push(callback); else listen(name, callback, options);
        };
        w.showAuthenticatedPageShell = () => {};
        w.console = { log() {}, warn() {}, error() {} };
        w.fetch = async () => {
            calls++;
            return { ok: true, json: async () => kind === 'status'
                ? { overall_status: 'operational', components: [], incidents: [], checked_at: '2026-11-07T00:00:00Z' } : [] };
        };
        try {
            w.eval(fs.readFileSync(path.join(__dirname, kind === 'status' ? '../js/status-page.js' : '../js/agents-panel.js'), 'utf8'));
            ready.forEach(fn => fn()); await flush();
            intervals.forEach(fn => fn()); await flush(); assert.equal(calls, 0);
            visibility = 'visible'; w.document.dispatchEvent(new w.Event('visibilitychange')); await flush();
            assert.equal(calls, 1);
            intervals.forEach(fn => fn()); await flush(); assert.equal(calls, 2);
            visibility = 'hidden'; w.document.dispatchEvent(new w.Event('visibilitychange'));
            intervals.forEach(fn => fn()); await flush(); assert.equal(calls, 2);
            w.dispatchEvent(new w.Event('beforeunload')); assert.equal(cleared, 1);
            visibility = 'visible'; w.document.dispatchEvent(new w.Event('visibilitychange')); await flush();
            assert.equal(calls, 2);
        } finally { w.close(); }
    });
}
