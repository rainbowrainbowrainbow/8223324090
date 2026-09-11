'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
function setup() {
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'designs.html'), 'utf8'), {
        url: 'http://localhost/designs#catalog-graduation', runScripts: 'outside-only'
    });
    const w = dom.window;
    w.buildCatalogPageHtml = p => { assert.ok(p.services, 'graduation requires package shape'); return `<p>${p.name}</p>`; };
    w.buildAutoPageHtml = p => { assert.ok('page_number' in p); return `<p>${p.title}</p>`; };
    const source = fs.readFileSync(path.join(ROOT, 'js/designs-page.js'), 'utf8');
    vm.runInContext(source.slice(source.indexOf('let catalogPackages ='), source.indexOf('function buildCatalogPageHtml(')), dom.getInternalVMContext());
    return { w, close: () => w.close(), content: () => w.document.getElementById('catalogPages').textContent };
}
const packages = [{ name: 'Fixture graduation A', services: [] }, { name: 'Fixture graduation B', services: [] }];
const response = body => ({ ok: true, json: async () => body });

test('graduation package count uses loaded packages, preserves zero and never labels failure as empty', async () => {
    const h = setup();
    try {
        const count = () => h.w.document.getElementById('catalogPackageCount')?.textContent;
        h.w.apiFetch = async () => response(packages);
        await h.w.loadCatalogs();
        assert.equal(count(), 'Пакетів: 2');
        h.w.apiFetch = async () => response([]);
        await h.w.loadCatalogs();
        assert.equal(count(), 'Пакетів: 0');
        h.w.apiFetch = async () => ({ ok: false });
        await h.w.loadCatalogs();
        assert.equal(count(), 'Пакетів: —');
        let finishOld;
        h.w.apiFetch = () => new Promise(resolve => { finishOld = resolve; });
        const old = h.w.loadCatalogs();
        h.w.apiFetch = async () => response([]);
        await h.w.loadCatalogs();
        finishOld(response(packages));
        await old;
        assert.equal(count(), 'Пакетів: 0');
    } finally { h.close(); }
});

test('background graduation refresh cannot overwrite an active generic viewer or its local print payload', async () => {
    const h = setup();
    try {
        h.w.apiFetch = async url => response(url === '/api/graduation/packages'
            ? packages : { pages: [{ page_number: 0, title: 'Menu page' }] });
        await h.w.openCatalog('menu');
        const loaded = await h.w.loadCatalogs();
        assert.equal(loaded.length, 2);
        assert.equal(h.content(), 'Menu page');
        const scheduled = [];
        let prints = 0;
        h.w.setTimeout = callback => scheduled.push(callback);
        h.w.print = () => { prints++; assert.equal(h.content(), 'Menu page'); };
        h.w.doPrintCatalog();
        scheduled.shift()();
        assert.equal(prints, 1);
        assert.equal(h.w.document.body.classList.contains('printing-catalog'), false);
    } finally { h.close(); }
});

test('read-only price bridge load followed by graduation open selects the proper package source', async () => {
    const h = setup();
    try {
        h.w.apiFetch = async () => response(packages);
        await h.w.loadCatalogs();
        await h.w.openCatalog('graduation');
        assert.equal(h.content(), 'Fixture graduation A');
        let exportUrl;
        h.w.open = url => { exportUrl = url; return {}; };
        h.w.printCatalog('graduation');
        assert.match(exportUrl, /^\/api\/graduation\/catalog\/export\?/);
    } finally { h.close(); }
});

test('generic -> graduation loads correct source, arrows navigate and close removes listener', async () => {
    const h = setup();
    try {
        const requests = [];
        h.w.apiFetch = async url => {
            requests.push(url);
            return response(url === '/api/graduation/packages' ? packages : { pages: [{ page_number: 0, title: 'Other' }] });
        };
        await h.w.openCatalog('menu');
        assert.equal(h.content(), 'Other');
        await h.w.openCatalog('graduation');
        assert.equal(h.content(), 'Fixture graduation A');
        assert.ok(requests.includes('/api/graduation/packages'));
        h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'ArrowRight' }));
        assert.equal(h.content(), 'Fixture graduation B');
        assert.equal(h.w.document.getElementById('catalogNextBtn').disabled, true);
        h.w.closeCatalog();
        assert.equal(h.w.document.getElementById('catalogViewer')._keyHandler, null);
        assert.equal(h.w.document.body.style.overflow, '');
    } finally { h.close(); }
});

test('late generic response cannot overwrite graduation; close cancels an in-flight open', async () => {
    const h = setup();
    try {
        let resolveOld;
        h.w.apiFetch = url => url === '/api/graduation/packages' ? Promise.resolve(response(packages))
            : new Promise(resolve => { resolveOld = resolve; });
        const old = h.w.openCatalog('menu');
        await h.w.openCatalog('graduation');
        resolveOld(response({ pages: [{ page_number: 0, title: 'Old other' }] }));
        await old;
        assert.equal(h.content(), 'Fixture graduation A');
        const pending = h.w.openCatalog('menu');
        h.w.closeCatalog();
        resolveOld(response({ pages: [{ page_number: 0, title: 'Closed' }] }));
        await pending;
        assert.equal(h.w.document.getElementById('catalogViewer').style.display, 'none');
    } finally { h.close(); }
});

test('empty and failed graduation requests clear previous pages and expose distinct states', async () => {
    const h = setup();
    try {
        h.w.apiFetch = async () => response(packages);
        await h.w.openCatalog('graduation');
        h.w.apiFetch = async () => response([]);
        await h.w.openCatalog('graduation');
        assert.match(h.content(), /Каталог порожній/);
        h.w.apiFetch = async () => ({ ok: false });
        await h.w.openCatalog('graduation');
        assert.match(h.content(), /Не вдалося/);
        assert.doesNotMatch(h.content(), /Fixture graduation/);
        assert.equal(h.w.document.getElementById('catalogPrevBtn').disabled, true);
    } finally { h.close(); }
});
