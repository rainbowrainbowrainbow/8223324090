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

test('completion alerts refresh on visible polling and return, preserve read state, and stop on unload', async () => {
    const dom = new JSDOM('<body><span id="alertBadge"></span></body>', {
        url: 'https://fixture.local/profile?tab=control', runScripts: 'outside-only'
    });
    const win = dom.window;
    let hidden = false;
    let reads = 0;
    let cleared = false;
    let poll;
    Object.defineProperty(win.document, 'hidden', { get: () => hidden });
    win.setInterval = (callback, ms) => {
        assert.equal(ms, 60000);
        poll = callback;
        return 1;
    };
    win.clearInterval = () => { cleared = true; };
    win.isAuthenticatedRuntimeReady = () => true;
    const completion = {
        id: 'control_completed_123_456_789', type: 'control_completion', level: 'info',
        title: '<img src=x onerror=alert(1)>', message: 'Для ознайомлення', link: '/tasks?open=456'
    };
    let serverRead = false;
    completion.eventKey = '456:789';
    win.fetch = async (url, options) => {
        reads++;
        if (options.method === 'POST') {
            assert.equal(url, '/api/tasks/control-completions/read');
            assert.deepEqual(JSON.parse(options.body), { eventKey: completion.eventKey });
            serverRead = true;
        }
        return { ok: true, json: async () => ({ alerts: [{ ...completion, read: serverRead }],
            controlCompletions: { unread: serverRead ? 0 : 1 } }) };
    };
    win.escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const flush = () => new Promise(resolve => setImmediate(resolve));
    try {
        win.eval(fs.readFileSync(path.join(__dirname, '../js/alerts.js'), 'utf8'));
        win.startAlertRuntime();
        await flush();
        const initialReads = reads;
        assert.equal(win.getUnreadControlCompletionCount(), 1);
        hidden = true;
        poll();
        await flush();
        assert.equal(reads, initialReads);
        hidden = false;
        win.document.dispatchEvent(new win.Event('visibilitychange'));
        await flush();
        assert.equal(reads, initialReads + 1);
        poll();
        await flush();
        assert.equal(reads, initialReads + 2);
        win.localStorage.setItem('crm_alerts_read_v2', JSON.stringify([completion.id]));
        assert.equal(win.getUnreadControlCompletionCount(), 1);
        assert.equal(await win._saveControlRead({ eventKey: completion.eventKey }), true);
        win.dispatchEvent(new win.Event('online'));
        await flush();
        assert.equal(win.getUnreadControlCompletionCount(), 0);

        win.document.body.insertAdjacentHTML('beforeend', win._renderAlertItem(completion, false));
        assert.equal(win.document.querySelector('.ap-item img'), null);
        assert.equal(win.document.querySelector('.ap-item a').textContent, completion.title);
        assert.equal(win.document.querySelectorAll('.ap-item .ap-actions').length, 0);

        win.dispatchEvent(new win.Event('beforeunload'));
        assert.equal(cleared, true);
        const readsBeforeUnload = reads;
        win.document.dispatchEvent(new win.Event('visibilitychange'));
        await flush();
        assert.equal(reads, readsBeforeUnload);
    } finally {
        win.close();
    }
});
