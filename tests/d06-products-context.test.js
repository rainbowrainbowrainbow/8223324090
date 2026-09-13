'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');

// Focused page-level regressions complement the real HTTP/PG/browser acceptance.
function setup(context = 'event_genix') {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'programs.html'), 'utf8'), {
        url: `http://localhost/programs?businessContext=${context}`, runScripts: 'outside-only'
    });
    const w = dom.window;
    const profiles = {
        event_genix: { key: 'event_genix', label: 'Fixture Park' },
        dar: { key: 'dar', label: 'Fixture Dar' },
        custom_studio: { key: 'custom_studio', label: 'Fixture Studio <safe>' },
        maysternya_doli: { key: 'maysternya_doli', label: 'Майстерня долі' }
    };
    w.CrmBusinessContext = {
        normalize: value => value === 'park_zakrevsky' ? 'event_genix' : String(value || '').trim().toLowerCase() || null,
        current: () => context,
        profileFor: key => profiles[key] || null,
        scope: () => ({ mode: 'single', activeContext: context })
    };
    w.AppState = { currentUser: { role: 'manager' } };
    w.formatPrice = value => `${Number(value)} ₴`;
    w.showNotification = () => {};
    w.EventCards = { renderEventCardImage: () => '' };
    vm.runInContext(fs.readFileSync(path.join(root, 'js/programs-page.js'), 'utf8')
        .replace("document.addEventListener('DOMContentLoaded', initPage);", ''), dom.getInternalVMContext());
    return { w, profiles, close: () => dom.window.close() };
}

test('products API context preserves each actual business and the legacy Park alias', () => {
    const h = setup();
    try {
        for (const [input, expected] of [['event_genix', 'event_genix'], ['dar', 'dar'],
            ['custom_studio', 'custom_studio'], ['maysternya_doli', 'maysternya_doli'], ['park_zakrevsky', 'event_genix']]) {
            assert.equal(h.w.getProductApiBusinessContext(input), expected, input);
        }
    } finally { h.close(); }
});

for (const context of ['dar', 'custom_studio']) {
    test(`${context} reads its own products and renders its registry branding without another business alias`, async () => {
        const h = setup(context);
        try {
            const requested = [];
            h.w.apiGetProducts = async (_, options) => {
                requested.push(options.businessContext);
                return [{ id: 'fixture-own', businessContext: context, name: 'Own fixture product', domain: 'program', price: 10 }];
            };
            h.w.renderProductIaTabs();
            h.w.updateProductTabPanels();
            await h.w.loadProducts();
            assert.deepEqual(requested, [context]);
            assert.equal(h.w.ProductBusinessContext.getApiContext(), context);
            assert.equal(h.w.document.querySelector('#productsPageTitle').textContent, `Products · ${h.profiles[context].label}`);
            const panel = h.w.document.querySelector('#maysternyaPanel');
            assert.ok(panel.textContent.includes(h.profiles[context].label));
            assert.doesNotMatch(panel.querySelector('.business-variant-head').textContent, /Майстерн|консультаці|парку/i);
            assert.equal(panel.querySelector('.business-variant-actions').hidden, true);
            assert.equal(h.w.document.querySelector('#productIaTabs').textContent.trim(), 'Продукти');
            assert.equal(h.w.document.querySelector('#addProductBtn').textContent, '+ Додати продукт');
            assert.equal(h.w.getBusinessHash(), '');
            assert.equal(panel.querySelector('safe'), null, 'Registry label is text, not HTML');
            h.w.apiGetProducts = async () => [];
            await h.w.loadProducts();
            assert.doesNotMatch(panel.querySelector('#maysternyaProductsGrid').textContent, /Майстерн|Парку/);
        } finally { h.close(); }
    });
}

test('legacy consultation context retains its own hash, vocabulary and timeline action', () => {
    const h = setup('maysternya_doli');
    try {
        h.w.renderProductIaTabs();
        h.w.updateProductTabPanels();
        assert.equal(h.w.getBusinessHash(), '#maysternya');
        assert.equal(h.w.document.querySelector('#addProductBtn').textContent, '+ Додати консультацію');
        assert.equal(h.w.document.querySelector('#maysternyaPanel .business-variant-actions').hidden, false);
        assert.equal(h.w.document.querySelector('#maysternyaPanel .business-variant-actions a').getAttribute('href'), '/maysternya-doli');
    } finally { h.close(); }
});

test('Park title follows fresh registry branding while preserving existing kitchen route behavior', async () => {
    const h = setup();
    try {
        h.w.updateProductTabPanels();
        assert.equal(h.w.document.querySelector('#productsPageTitle').textContent, 'Products · Fixture Park');
        h.profiles.event_genix.label = 'Updated Park';
        await h.w.setProductTab('kitchen');
        h.w.setKitchenTab('menu');
        assert.equal(h.w.document.querySelector('#productsPageTitle').textContent, 'Products · Updated Park · Кухня · Меню');
        assert.equal(h.w.getBusinessHash(), '#kitchen-menu');
    } finally { h.close(); }
});

test('an older Park response cannot replace the actual custom-context product response', async () => {
    const h = setup();
    try {
        let resolvePark;
        const requested = [];
        h.w.apiGetProducts = (_, options) => {
            requested.push(options.businessContext);
            if (requested.length === 1) return new Promise(resolve => { resolvePark = resolve; });
            return Promise.resolve([{ id: 'studio-own', businessContext: 'custom_studio', name: 'Studio product' }]);
        };
        const oldRequest = h.w.loadProducts();
        await h.w.applyProductBusinessContext('custom_studio');
        resolvePark([{ id: 'park-old', businessContext: 'event_genix', name: 'Old Park product' }]);
        await oldRequest;
        assert.deepEqual(requested, ['event_genix', 'custom_studio']);
        assert.equal(h.w.eval('allProducts[0].id'), 'studio-own');
        assert.equal(h.w.document.querySelector('[data-id="park-old"]'), null);
    } finally { h.close(); }
});
