'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');

function setup(hash = '', stored = 'kitchen') {
    const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'programs.html'), 'utf8'), {
        url: `http://localhost/programs?fixture=1${hash}`, runScripts: 'outside-only'
    });
    const w = dom.window;
    w.localStorage.setItem('pzp_products_active_tab_park_zakrevsky', stored);
    w.AppState = { currentUser: { role: 'viewer' } };
    w.formatPrice = value => `${Number(value)} ₴`;
    w.showNotification = () => {};
    w.EventCards = { renderEventCardImage: () => '' };
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/programs-page.js'), 'utf8')
        .replace("document.addEventListener('DOMContentLoaded', initPage);", ''), dom.getInternalVMContext());
    return { w, close: () => dom.window.close() };
}

test('constructor link is unique, graduation-only and requires ready allowed single-business access', () => {
    const h = setup('#catalogs');
    try {
        h.w.eval("productCatalogs = [{id:'graduation',title:'Graduation'}, {id:'other',title:'Other'}]");
        for (const [status, allowed, mode, count] of [
            ['pending', true, 'single', 0], ['ready', false, 'single', 0],
            ['ready', true, 'aggregate', 0], ['ready', true, 'single', 1]
        ]) {
            h.w.getPermissionLifecycle = () => ({ status });
            h.w.canAccessPage = page => page === '/graduation' && allowed;
            h.w.CrmBusinessContext = { scope: () => ({ mode, activeContext: 'event_genix' }) };
            h.w.renderCatalogEntries();
            h.w.renderCatalogEntries();
            assert.equal(h.w.document.querySelectorAll('#catalogsGrid a[href="/graduation"]').length, count);
        }
    } finally { h.close(); }
});

test('reopening cached catalogs rechecks constructor visibility without another catalog request', async () => {
    const h = setup('#catalogs');
    try {
        h.w.eval("productCatalogs = [{id:'graduation',title:'Graduation'}]; catalogEntriesLoaded = true");
        h.w.getPermissionLifecycle = () => ({ status: 'ready' });
        h.w.canAccessPage = () => true;
        h.w.renderCatalogEntries();
        assert.ok(h.w.document.querySelector('#catalogsGrid a[href="/graduation"]'));
        await h.w.setProductTab('programs');
        h.w.canAccessPage = () => false;
        h.w.apiGetProductCatalogs = () => { throw new Error('Cached navigation must not fetch'); };
        await h.w.setProductTab('catalogs');
        assert.equal(h.w.document.querySelector('#catalogsGrid a[href="/graduation"]'), null);
        h.w.bindProductRouteNavigation();
        h.w.canAccessPage = () => true;
        h.w.dispatchEvent(new h.w.Event('permissions:lifecycle'));
        assert.ok(h.w.document.querySelector('#catalogsGrid a[href="/graduation"]'));
        h.w.canAccessPage = () => false;
        h.w.dispatchEvent(new h.w.Event('roleSwitched'));
        assert.equal(h.w.document.querySelector('#catalogsGrid a[href="/graduation"]'), null);
    } finally { h.close(); }
});

test('bare Products starts with programs despite saved kitchen; explicit old hashes still win', () => {
    for (const [hash, tab, category, kitchen] of [
        ['', 'programs', 'all', 'cake'], ['#animation', 'programs', 'animation', 'cake'],
        ['#animations', 'programs', 'animation', 'cake'], ['#kitchen', 'kitchen', 'all', 'cake'],
        ['#kitchen-cakes', 'kitchen', 'all', 'cake'], ['#kitchen-menu', 'kitchen', 'all', 'menu'],
        ['#catalogs', 'catalogs', 'all', 'cake'], ['#quest', 'programs', 'quest', 'cake']
    ]) {
        const h = setup(hash);
        try {
            assert.equal(h.w.readInitialProductTab(), tab, hash || 'bare');
            assert.equal(h.w.readInitialCategory(), category);
            assert.equal(h.w.readInitialKitchenTab(), kitchen);
        } finally { h.close(); }
    }
});

test('local overview exposes category links and navigation keeps query and history', async () => {
    const h = setup();
    try {
        h.w.renderProductIaTabs();
        h.w.bindProductRouteNavigation();
        for (const hash of ['#animation', '#kitchen-cakes', '#kitchen-menu', '#catalogs']) {
            assert.ok(h.w.document.querySelector(`[data-product-route="${hash}"]`));
        }
        await h.w.setProductTab('kitchen');
        h.w.setKitchenTab('menu');
        assert.equal(h.w.location.hash, '#kitchen-menu');
        assert.equal(h.w.location.search, '?fixture=1');
        assert.equal(h.w.history.length, 3);
        const restored = new Promise(resolve => h.w.addEventListener('popstate', resolve, { once: true }));
        h.w.history.back();
        await restored;
        assert.equal(h.w.location.hash, '#kitchen-cakes');
        assert.equal(h.w.eval('activeKitchenTab'), 'cake');
        assert.equal(h.w.history.length, 3);
    } finally { h.close(); }
});

test('same-document sidebar hash change updates products without another history entry', () => {
    const h = setup();
    try {
        h.w.bindProductRouteNavigation();
        h.w.history.pushState(null, '', '?fixture=1#animation');
        h.w.dispatchEvent(new h.w.HashChangeEvent('hashchange'));
        assert.equal(h.w.eval('currentCategory'), 'animation');
        assert.equal(h.w.eval('activeProductTab'), 'programs');
        assert.equal(h.w.history.length, 2);
    } finally { h.close(); }
});

test('a slow earlier products request cannot replace the newer records', async () => {
    const h = setup();
    try {
        let resolveOld;
        h.w.apiGetProducts = () => new Promise(resolve => { resolveOld = resolve; });
        const old = h.w.loadProducts();
        h.w.apiGetProducts = async () => [{ id: 'new', name: 'New', domain: 'program', category: 'animation', price: 0 }];
        await h.w.loadProducts();
        resolveOld([{ id: 'old', name: 'Old', price: 20 }]);
        await old;
        assert.equal(h.w.eval('allProducts[0].id'), 'new');
        assert.ok(h.w.document.querySelector('[data-id="new"]'));
        assert.equal(h.w.document.querySelector('[data-id="old"]'), null);
    } finally { h.close(); }
});

test('context switch clears old details even when both contexts contain the same product ID', async () => {
    const h = setup();
    try {
        const requests = [];
        let resolveNew;
        h.w.apiGetProducts = async (_, options) => {
            requests.push(options.businessContext);
            return [{ id: 'same', name: 'Park record', businessContext: 'event_genix', category: 'animation' }];
        };
        await h.w.loadProducts();
        h.w.apiGetProducts = (_, options) => {
            requests.push(options.businessContext);
            return new Promise(resolve => { resolveNew = resolve; });
        };
        const pending = h.w.applyProductBusinessContext('maysternya_doli');
        assert.doesNotMatch(h.w.document.getElementById('productsGrid').textContent, /Park record/);
        resolveNew([{ id: 'same', name: 'Other record', businessContext: 'maysternya_doli' }]);
        await pending;
        assert.deepEqual(requests, ['event_genix', 'maysternya_doli']);
        const host = h.w.document.createElement('div');
        host.innerHTML = h.w.renderProductDetails(h.w.eval('allProducts[0]'));
        assert.equal(host.querySelector('details').dataset.businessContext, 'maysternya_doli');
        assert.doesNotMatch(host.textContent, /Park record/);
    } finally { h.close(); }
});

test('product failure stays an error across tab changes, while [] is a genuine empty state', async () => {
    const h = setup();
    try {
        h.w.apiGetProducts = async () => null;
        await h.w.loadProducts();
        await h.w.setProductTab('kitchen');
        assert.match(h.w.document.getElementById('kitchenGrid').textContent, /Не вдалося/);
        h.w.apiGetProducts = async () => [];
        await h.w.loadProducts();
        assert.doesNotMatch(h.w.document.getElementById('kitchenGrid').textContent, /Не вдалося/);
    } finally { h.close(); }
});

test('details preserve full escaped text, identity, zero price and neutral absent image', () => {
    const h = setup();
    try {
        const description = '<script>alert(1)</script> ' + 'Довгий опис & '.repeat(40);
        for (const type of ['animation', 'cake', 'menu']) {
            const product = { id: `fixture-${type}`, businessContext: 'event_genix', name: type,
                domain: type === 'animation' ? 'program' : 'kitchen', kitchenType: type,
                category: type, description, price: 0, servingUnit: 'порція' };
            const host = h.w.document.createElement('div');
            host.innerHTML = h.w.renderProductDetails(product);
            assert.ok(host.querySelector('details summary'));
            assert.equal(host.querySelector('script'), null);
            assert.ok(host.textContent.includes(description));
            assert.match(host.textContent, /0 ₴/);
            assert.match(host.textContent, /Зображення відсутнє/);
            assert.equal(host.querySelector('details').dataset.productId, product.id);
        }
    } finally { h.close(); }
});

test('missing price is not zero; zero retains kitchen unit and missing image fails locally', () => {
    const h = setup();
    try {
        assert.match(h.w.renderKitchenPrice({ price: null }), /Ціну не вказано/);
        assert.match(h.w.renderKitchenPrice({ price: 0, servingUnit: '100 г' }), /0 ₴\/100 г/);
        assert.equal(h.w.renderKitchenPrice({ price: null, priceVariantNote: 'За розміром' }), 'Варіанти');
        const host = h.w.document.createElement('div');
        host.innerHTML = h.w.renderProductDetails({ id: 'image', price: 50, iconUrl: '/missing.png' });
        const img = host.querySelector('img');
        h.w.productDetailImageError(img);
        assert.equal(host.querySelector('img'), null);
        assert.match(host.textContent, /Зображення недоступне/);
    } finally { h.close(); }
});
