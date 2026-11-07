'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/hr-page.js'), 'utf8');
const loader = source.split('// HR_STRUCTURE_LOADER_START')[1].split('// HR_STRUCTURE_LOADER_END')[0];
function harness() {
    const dom = new JSDOM('<head><script src="/js/hr-page.js?v=test123"></script></head><body><div id="companyStructureRecovery" class="hidden"><span id="companyStructureRecoveryMessage"></span><button id="btnRetryCompanyStructure" class="hidden">Retry</button></div></body>', {
        url: 'https://crm.example/hr', runScripts: 'outside-only'
    });
    const w = dom.window;
    let context = 'park:session1';
    w.teamAccessContext = () => context;
    w.console.warn = () => {};
    vm.runInContext(loader, dom.getInternalVMContext());
    const scripts = () => [...w.document.querySelectorAll('script[src*="hr-structure-page.js"]')];
    const calls = [];
    let initialized = false;
    const chunk = {
        initialize() { if (!initialized) { initialized = true; calls.push('initialize'); } },
        loadCompanyStructure: async options => { calls.push(['load', options]); return ['loaded']; },
        ensureCompanyStructureNodesLoaded: async options => { calls.push(['ensure', options]); return ['nodes']; },
        selectCompanyOrgNodeById: async id => { calls.push(['select', id]); }
    };
    return { dom, w, calls, scripts, context: v => { context = v; },
        deliver() { w.HrStructureModule = chunk; scripts().at(-1).dispatchEvent(new w.Event('load')); } };
}
test('structure reads load one versioned chunk on demand and initialize once', async () => {
    const h = harness();
    try {
        assert.equal(h.scripts().length, 0);
        const first = h.w.loadCompanyStructure({ force: true });
        const second = h.w.ensureCompanyStructureNodesLoaded({ silent: true });
        assert.equal(h.scripts().length, 1);
        assert.equal(h.scripts()[0].src, 'https://crm.example/js/hr-structure-page.js?v=test123');
        h.deliver();
        assert.deepEqual(Array.from(await first), ['loaded']);
        assert.deepEqual(Array.from(await second), ['nodes']);
        await h.w.selectCompanyOrgNodeById('director');
        assert.deepEqual(h.calls, ['initialize', ['load', { force: true }], ['ensure', { silent: true }], ['select', 'director']]);
        assert.equal(h.scripts().length, 1);
    } finally { h.dom.window.close(); }
});
test('failed chunk presents retry, clears failed single flight, then recovers', async () => {
    const h = harness();
    try {
        const failed = h.w.loadCompanyStructure();
        h.scripts()[0].dispatchEvent(new h.w.Event('error'));
        assert.deepEqual(Array.from(await failed), []);
        assert.equal(h.scripts().length, 0);
        const retry = h.w.document.getElementById('btnRetryCompanyStructure');
        assert.equal(retry.classList.contains('hidden'), false);
        retry.click();
        assert.equal(h.scripts().length, 1);
        const joined = h.w.loadCompanyStructure();
        h.deliver();
        await joined;
        assert.equal(retry.onclick, null);
        assert.equal(h.calls.filter(x => x === 'initialize').length, 1);
    } finally { h.dom.window.close(); }
});
test('business/session changes during download suppress the old action', async () => {
    const h = harness();
    try {
        const stale = h.w.loadCompanyStructure();
        h.context('restaurant:session2');
        h.deliver();
        assert.deepEqual(Array.from(await stale), []);
        assert.deepEqual(h.calls, []);
        await h.w.loadCompanyStructure();
        assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), ['initialize', ['load', {}]]);
    } finally { h.dom.window.close(); }
});
test('module stays absent from initial HTML and private implementation stays in its chunk', () => {
    const html = fs.readFileSync(path.join(root, 'hr.html'), 'utf8');
    assert.doesNotMatch(html, /<script[^>]*hr-structure-page/);
    assert.doesNotMatch(source, /function initCompanyOrgChart\(/);
    assert.doesNotMatch(source, /addEventListener\('click', saveCompanyStructure\)/);
    assert.match(fs.readFileSync(path.join(root, 'js/hr-structure-page.js'), 'utf8'), /addEventListener\('click', saveCompanyStructure\)/);
});

test('active structure recovers a fresh read if business changes before its listeners exist', async () => {
    const h = harness();
    try {
        h.w.document.body.insertAdjacentHTML('beforeend', '<button class="hr-tab active" data-tab="structure"></button>');
        h.w.getHrCurrentUser = () => ({ id: 1 });
        h.w.canViewHrTab = tab => tab === 'structure';
        const stale = h.w.loadCompanyStructure({ force: true });
        h.context('restaurant:session2');
        h.deliver();
        assert.deepEqual(Array.from(await stale), ['loaded']);
        assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), ['initialize', ['load', {}]]);
    } finally { h.dom.window.close(); }
});

test('cold-load recovery does not read after authentication is cleared or access is revoked', async () => {
    for (const loggedIn of [false, true]) {
        const h = harness();
        try {
            h.w.document.body.insertAdjacentHTML('beforeend', '<button class="hr-tab active" data-tab="structure"></button>');
            h.w.getHrCurrentUser = () => loggedIn ? { id: 1 } : null;
            h.w.canViewHrTab = () => false;
            const stale = h.w.loadCompanyStructure();
            h.context('cleared:session2'); h.deliver();
            assert.deepEqual(Array.from(await stale), []);
            assert.deepEqual(h.calls, []);
        } finally { h.dom.window.close(); }
    }
});
