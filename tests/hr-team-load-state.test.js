'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const HR_CODE = fs.readFileSync(path.join(__dirname, '..', 'js', 'hr-page.js'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function createHarness() {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="tab-team" class="active"></div>
        <nav id="hrNav"><span data-nav-count="workers"></span><span data-nav-count="interns"></span></nav>
        <input id="teamSearch"><div id="teamFilterInfo"></div><div id="teamGrid"></div>
    </body></html>`, { url: 'http://localhost/hr#team', runScripts: 'outside-only' });
    const { window } = dom;
    window.console = console;
    window.AppState = { currentUser: { id: 1, role: 'director', activeBusinessContext: 'event_genix' } };
    window.__teamContext = { business: 'event_genix', scope: 'single', access: 1 };
    window.__teamBuckets = [
        { id: 'workers', title: 'Робітники' }, { id: 'interns', title: 'Стажери' }
    ];
    window.getLegacyBusinessSurfaceContextKey = () => JSON.stringify([
        window.AppState.currentUser?.id, window.__teamContext.business,
        window.__teamContext.scope, window.__teamContext.access
    ]);
    const originalAddEventListener = window.document.addEventListener.bind(window.document);
    window.document.addEventListener = (type, listener, options) => type === 'DOMContentLoaded'
        ? undefined : originalAddEventListener(type, listener, options);
    vm.runInContext(`${HR_CODE}
        canViewHrTab = () => window.__canViewTeam !== false;
        ensureProfessionsLoaded = async () => [];
        ensureCompanyStructureNodesLoaded = async () => [];
        visiblePeopleBuckets = () => window.__teamBuckets;
        bucketForStaff = staff => staff.bucket || 'workers';
        teamSearchHaystack = staff => String(staff.name || '').toLowerCase();
        renderTeamCards = staff => staff.map(person => '<span data-person="' + person.id + '">' + person.name + '</span>').join('');
        initTeamDragAndDrop = () => {};
        syncHrNavActive = () => {};
        hrFetch = (...args) => window.__teamFetch(...args);
        window.__teamTest = {
            load: loadTeam,
            state: () => ({ ...teamLoadState }),
            staff: () => teamStaff.map(person => ({ ...person })),
            setTimeoutMs: value => { teamLoadTimeoutMs = value; },
            bucket: id => window.setPeopleBucket(id),
            search: value => {
                const input = document.getElementById('teamSearch');
                input.value = value;
                input.dispatchEvent(new window.Event('input', { bubbles: true }));
            }
        };
    `, dom.getInternalVMContext());
    const api = window.__teamTest;
    return {
        window,
        api,
        setFetch(handler) { window.__teamFetch = handler; },
        grid() { return window.document.getElementById('teamGrid'); },
        info() { return window.document.getElementById('teamFilterInfo').textContent; },
        count(bucket = 'workers') { return window.document.querySelector(`[data-nav-count="${bucket}"]`).textContent; },
        close() { window.close(); }
    };
}

test('team states distinguish success, empty, restricted and recoverable failures', async () => {
    const h = createHarness();
    try {
        h.setFetch(async () => ({ success: true, data: [{ id: 1, name: 'Worker A', bucket: 'workers' }] }));
        await h.api.load();
        assert.equal(h.api.state().status, 'success');
        assert.equal(h.count(), '1');
        assert.equal(h.count('interns'), '0');
        assert.match(h.grid().textContent, /Worker A/);

        h.setFetch(async () => ({ success: false, status: 403, code: 'staff_not_migrated', error: 'Access restricted' }));
        await h.api.load();
        assert.equal(h.api.state().status, 'restricted');
        assert.equal(h.api.staff().length, 0);
        assert.equal(h.count(), '—');
        assert.equal(h.count('interns'), '—');
        assert.equal(h.info(), 'Доступ обмежено');
        assert.equal(h.grid().querySelector('[role="alert"]')?.textContent, 'Access restricted');
        assert.equal(h.grid().querySelector('.hr-people-retry'), null);
        h.api.bucket('interns');
        h.api.search('Worker A');
        assert.equal(h.grid().dataset.peopleMode, 'restricted');
        assert.doesNotMatch(h.grid().textContent, /Worker A/);

        h.setFetch(async () => ({ success: false, status: 500, error: 'Server unavailable' }));
        await h.api.load();
        assert.equal(h.api.state().status, 'error');
        assert.equal(h.count(), '—');
        assert.ok(h.grid().querySelector('.hr-people-retry'));
        h.setFetch(async () => ({ success: true, data: [] }));
        await h.api.load();
        assert.equal(h.api.state().status, 'empty');
        assert.equal(h.count(), '0');
        assert.equal(h.count('interns'), '0');

        h.setFetch(async () => { throw new Error('offline'); });
        await h.api.load();
        assert.equal(h.api.state().status, 'error');
        assert.equal(h.grid().getAttribute('aria-busy'), 'false');
        assert.equal(h.count(), '—');
        h.api.setTimeoutMs(10);
        h.setFetch(() => new Promise(() => {}));
        await h.api.load();
        assert.equal(h.api.state().status, 'error', 'a hung request must leave loading');
        assert.equal(h.grid().getAttribute('aria-busy'), 'false');
        h.api.bucket('workers');
        h.setFetch(async () => ({ success: true, data: [{ id: 2, name: 'Worker B' }] }));
        h.grid().querySelector('.hr-people-retry').focus();
        h.grid().querySelector('.hr-people-retry').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(h.api.state().status, 'success');
        assert.match(h.grid().textContent, /Worker B/);
        assert.equal(h.count(), '1');
        assert.equal(h.window.document.activeElement.id, 'teamSearch');
    } finally { h.close(); }
});

test('team rejects late responses across business, scope, account and capability changes', async () => {
    const h = createHarness();
    try {
        const first = deferred();
        const second = deferred();
        const requests = [first, second];
        h.setFetch(() => requests.shift()?.promise || Promise.resolve({ success: false, status: 403 }));
        const parkLoad = h.api.load();
        assert.equal(h.grid().dataset.peopleMode, 'loading');
        assert.equal(h.count(), '—');
        h.window.__teamContext.business = 'dar';
        h.window.AppState.currentUser.activeBusinessContext = 'dar';
        h.window.dispatchEvent(new h.window.Event('crmBusinessContextChanged'));
        first.resolve({ success: true, data: [{ id: 1, name: 'Park only' }] });
        await parkLoad;
        assert.equal(h.api.staff().length, 0);
        assert.doesNotMatch(h.grid().textContent, /Park only/);
        second.resolve({ success: false, status: 403, error: 'Dar restricted' });
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(h.api.state().status, 'restricted');

        h.window.__teamContext.business = 'event_genix';
        h.window.__teamContext.scope = 'multi';
        h.window.dispatchEvent(new h.window.Event('crmBusinessScopeChanged'));
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(h.count(), '—');
        h.window.__teamContext.scope = 'single';
        h.window.AppState.currentUser = { id: 2, role: 'director', activeBusinessContext: 'event_genix' };
        h.window.__teamContext.access = 2;
        h.setFetch(async () => ({ success: true, data: [{ id: 2, name: 'New account' }] }));
        h.window.dispatchEvent(new h.window.Event('permissions:lifecycle'));
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(h.api.state().status, 'success');
        assert.deepEqual(h.api.staff().map(person => person.name), ['New account']);
        assert.doesNotMatch(h.grid().textContent, /Park only/);

        h.window.__canViewTeam = false;
        h.window.__teamBuckets = [];
        h.window.dispatchEvent(new h.window.Event('roleSwitched'));
        assert.equal(h.api.state().status, 'restricted');
        assert.equal(h.api.staff().length, 0);
        assert.equal(h.grid().querySelector('[role="alert"]')?.textContent, 'Команда недоступна для поточного доступу.');
    } finally { h.close(); }
});
