'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../js/programs-page.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, '../js/api.js'), 'utf8');
function section(text, start, end) {
    const first = text.indexOf(start), last = text.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `Missing ${start}`);
    return text.slice(first, last);
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
const product = (context = 'event_genix') => ({
    id: `burger-${context}`, businessContext: context, name: 'Тестовий бургер',
    iconUrl: '/uploads/catalog-images/items/test.jpg'
});
function harness() {
    const dom = new JSDOM('<!doctype html><div id="productsGrid"></div><div id="kitchenGrid"></div>');
    const timers = new Map(), productRequests = [], blueprintRequests = [], renders = [], notifications = [];
    let timerId = 0;
    const context = vm.createContext({
        window: dom.window, document: dom.window.document, AbortController,
        activeBusinessContext: 'event_genix', productsLoadGeneration: 0,
        productsLoadState: 'ready', allProducts: [],
        burgerMenuImageBlueprints: new Map(), burgerMenuImageBlueprintLoads: new Map(),
        burgerMenuImageBlueprintRequest: null, productBlueprintLifecycleBound: false,
        productsPageActive: true, BURGER_BLUEPRINT_TIMEOUT_MS: 8000,
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        getProductApiBusinessContext(value) { return value || context.activeBusinessContext; },
        escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); },
        escapeJsString(value) { return String(value ?? '').replace(/'/g, "\\'"); },
        productMenuTitle: p => p.name,
        productMenuSafeImageUrl: value => value || '',
        renderMenuPhotoImage: url => url ? `<img src="${url}" alt="">` : '',
        stopKitchenMenuImageTracking() {}, resumePendingKitchenMenuImageJobs() {}, syncKitchenMenuImageGenerationUi() {},
        renderMenuSectionFilter() {},
        guardProductWrite: () => true,
        setKitchenMenuImageStudioBusy(panel, busy) { panel.setAttribute('aria-busy', String(busy)); },
        showNotification(message) { notifications.push(message); },
        console: { error() {} },
        apiGetProducts(_, options) {
            const request = deferred(); productRequests.push({ ...request, options }); return request.promise;
        },
        apiGetBurgerMenuImageBlueprint(options) {
            const request = deferred(); blueprintRequests.push({ ...request, options }); return request.promise;
        }
    });
    vm.runInContext(section(source, 'function cancelBurgerMenuImageBlueprintLoad(', 'function renderProducts('), context);
    vm.runInContext(section(source, 'function renderKitchenMenuImagePreview(', 'function buildKitchenMenuImagePrompt('), context);
    vm.runInContext(section(source, 'const BURGER_IMAGE_BLUEPRINT_DEFAULT =', 'function renderKitchenMenuAiActions('), context);
    vm.runInContext(section(source, 'async function saveBurgerMenuImageBlueprint(', 'function readMenuImageFileAsDataUrl('), context);
    context.renderProducts = () => {
        renders.push(context.productsLoadState);
        const grid = dom.window.document.getElementById('kitchenGrid');
        if (context.productsLoadState !== 'ready') { grid.textContent = context.productsLoadState; return; }
        grid.innerHTML = context.allProducts.map(p => `<article data-id="${p.id}"><div class="kitchen-menu-image-studio" aria-busy="false">${context.renderBurgerMenuImageBlueprint(p, p.businessContext, {})}<textarea data-unrelated>Original</textarea></div></article>`).join('');
    };
    return {
        context, dom, productRequests, blueprintRequests, renders, notifications, timers,
        panel: () => dom.window.document.querySelector('.kitchen-menu-image-blueprint'),
        timeout() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
        close() { context.cancelBurgerMenuImageBlueprintLoad(); dom.window.close(); }
    };
}

test('products become ready while blueprint is unresolved; timeout is independent and retry only fetches blueprint', async () => {
    const h = harness();
    try {
        const loading = h.context.loadProducts(); await flush();
        h.productRequests[0].resolve([product()]); await loading;
        assert.equal(h.context.productsLoadState, 'ready');
        assert.equal(h.panel().getAttribute('aria-busy'), 'true');
        assert.match(h.panel().textContent, /Завантажуємо еталон/);
        assert.deepEqual(h.renders, ['loading', 'ready']);
        const article = h.dom.window.document.querySelector('article');
        h.timeout(); await flush();
        assert.equal(h.blueprintRequests[0].options.signal.aborted, true);
        assert.match(h.panel().textContent, /не відповів вчасно/);
        assert.equal(h.panel().querySelector('[data-burger-blueprint-retry]').hidden, false);
        h.context.retryBurgerMenuImageBlueprint('event_genix'); await flush();
        h.context.retryBurgerMenuImageBlueprint('event_genix'); await flush();
        assert.equal(h.blueprintRequests.length, 2);
        assert.equal(h.productRequests.length, 1);
        h.blueprintRequests[1].resolve({ success: true, blueprint: null }); await flush();
        assert.equal(h.context.productsLoadState, 'ready');
        assert.match(h.panel().textContent, /Спільний еталон ще не задано/);
        assert.equal(h.dom.window.document.querySelector('article'), article);
        h.blueprintRequests[0].resolve({ success: true, blueprint: { instructions: 'late timeout result' } });
        await flush();
        assert.equal(h.context.burgerMenuImageBlueprints.get('event_genix'), null);
        assert.equal(h.timers.size, 0);
    } finally { h.close(); }
});

test('late blueprint updates only its preview/status and untouched instructions; card, focus, open state and input survive', async () => {
    const h = harness();
    try {
        const loading = h.context.loadProducts(); await flush();
        h.productRequests[0].resolve([product(), { ...product(), id: 'burger-2' }]); await loading;
        const article = h.dom.window.document.querySelector('article'), panel = h.panel();
        panel.open = true;
        const instructions = panel.querySelector('textarea');
        instructions.value = 'Unsaved rules'; instructions.dataset.edited = 'true'; instructions.focus();
        const other = article.querySelector('[data-unrelated]'); other.value = 'Unsaved unrelated field';
        panel.querySelector('select').value = 'current';
        h.blueprintRequests[0].resolve({ success: true, blueprint: {
            imageUrl: '/uploads/catalog-images/items/shared.jpg', instructions: 'Server rules'
        } }); await flush();
        assert.equal(h.dom.window.document.querySelector('article'), article);
        assert.equal(h.panel(), panel);
        assert.equal(panel.open, true);
        assert.equal(h.dom.window.document.activeElement, instructions);
        assert.equal(instructions.value, 'Unsaved rules');
        assert.equal(other.value, 'Unsaved unrelated field');
        assert.equal(panel.querySelector('select').value, 'current');
        assert.match(panel.querySelector('summary').textContent, /задано/);
        assert.equal(panel.querySelector('[data-burger-blueprint-preview] img').getAttribute('src'), '/uploads/catalog-images/items/shared.jpg');
        assert.equal(h.dom.window.document.querySelectorAll('[data-burger-blueprint-instructions]')[1].value, 'Server rules');
        assert.deepEqual(h.renders, ['loading', 'ready']);
        assert.equal(h.productRequests.length, 1);
    } finally { h.close(); }
});

for (const outcome of ['http-error', 'reject', 'success']) {
    test(`products errors are shown before unresolved blueprint (${outcome})`, async () => {
        const h = harness();
        try {
            const loading = h.context.loadProducts(); await flush();
            h.productRequests[0].resolve(null); await loading;
            assert.equal(h.context.productsLoadState, 'error');
            assert.equal(h.dom.window.document.getElementById('kitchenGrid').textContent, 'error');
            if (outcome === 'reject') h.blueprintRequests[0].reject(Error('Unavailable'));
            else h.blueprintRequests[0].resolve({ success: outcome === 'success', blueprint: null });
            await flush();
            assert.equal(h.context.productsLoadState, 'error');
            assert.deepEqual(h.renders, ['loading', 'error']);
        } finally { h.close(); }
    });
}

for (const outcome of ['http-error', 'reject']) {
    test(`blueprint ${outcome} leaves catalog ready and offers retry`, async () => {
        const h = harness();
        try {
            const loading = h.context.loadProducts(); await flush();
            h.productRequests[0].resolve([product()]); await loading;
            if (outcome === 'reject') h.blueprintRequests[0].reject(Error('Unavailable'));
            else h.blueprintRequests[0].resolve({ success: false });
            await flush();
            assert.equal(h.context.productsLoadState, 'ready');
            assert.equal(h.panel().querySelector('[data-burger-blueprint-retry]').hidden, false);
            assert.deepEqual(h.renders, ['loading', 'ready']);
        } finally { h.close(); }
    });
}

for (const nextContext of ['event_genix', 'dar']) {
    test(`new products load rejects old products and blueprint (${nextContext})`, async () => {
        const h = harness();
        try {
            const first = h.context.loadProducts(); await flush();
            h.context.activeBusinessContext = nextContext;
            const second = h.context.loadProducts(); await flush();
            assert.equal(h.blueprintRequests[0].options.signal.aborted, true);
            h.productRequests[1].resolve([product(nextContext)]); await second;
            h.blueprintRequests[1].resolve({ success: true, blueprint: { instructions: 'Fresh rules' } }); await flush();
            const panel = h.panel();
            h.productRequests[0].resolve([product('old')]); await first;
            h.blueprintRequests[0].resolve({ success: true, blueprint: { instructions: 'Stale rules' } }); await flush();
            assert.equal(h.context.allProducts[0].businessContext, nextContext);
            assert.equal(h.context.burgerMenuImageBlueprints.get(nextContext).instructions, 'Fresh rules');
            if (nextContext === 'dar') assert.equal(h.context.burgerMenuImageBlueprints.has('event_genix'), false);
            assert.equal(h.panel(), panel);
            assert.equal(h.blueprintRequests[1].options.businessContext, nextContext);
        } finally { h.close(); }
    });
}

test('pagehide cancels blueprint and discards products; bfcache restores only blueprint when catalog is ready', async () => {
    const h = harness();
    try {
        const loading = h.context.loadProducts(); await flush();
        h.productRequests[0].resolve([product()]); await loading;
        const panel = h.panel();
        h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pagehide'));
        assert.equal(h.blueprintRequests[0].options.signal.aborted, true);
        h.blueprintRequests[0].resolve({ success: true, blueprint: { instructions: 'Hidden rules' } }); await flush();
        assert.equal(h.context.burgerMenuImageBlueprints.size, 0);
        assert.equal(h.timers.size, 0);
        h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pageshow', { persisted: true })); await flush();
        assert.equal(h.blueprintRequests.length, 2);
        assert.equal(h.productRequests.length, 1);
        assert.equal(h.panel(), panel);
    } finally { h.close(); }
});

test('pagehide also prevents late products success/error and reentry restarts an interrupted product load', async () => {
    const h = harness();
    try {
        const loading = h.context.loadProducts(); await flush();
        h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pagehide'));
        h.productRequests[0].resolve(null); await loading;
        assert.equal(h.context.productsLoadState, 'loading');
        assert.equal(h.notifications.length, 0);
        h.dom.window.dispatchEvent(new h.dom.window.PageTransitionEvent('pageshow', { persisted: true })); await flush();
        assert.equal(h.productRequests.length, 2);
        assert.equal(h.blueprintRequests.length, 2);
    } finally { h.close(); }
});

test('successful local blueprint save is not overwritten by an older GET and does not rebuild cards', async () => {
    const h = harness();
    try {
        const loading = h.context.loadProducts(); await flush();
        h.productRequests[0].resolve([product()]); await loading;
        const panel = h.panel(), article = h.dom.window.document.querySelector('article');
        panel.querySelector('textarea').value = 'Newly saved rules';
        h.context.apiSaveBurgerMenuImageBlueprint = async () => ({ success: true, blueprint: { instructions: 'Newly saved rules' } });
        const save = panel.querySelector('button:not([data-burger-blueprint-retry])');
        await h.context.saveBurgerMenuImageBlueprint(product().id, save);
        h.blueprintRequests[0].resolve({ success: true, blueprint: { instructions: 'Older GET rules' } }); await flush();
        assert.equal(h.context.burgerMenuImageBlueprints.get('event_genix').instructions, 'Newly saved rules');
        assert.equal(h.dom.window.document.querySelector('article'), article);
        assert.deepEqual(h.renders, ['loading', 'ready']);
    } finally { h.close(); }
});

test('blueprint API forwards cancellation signal and preserves structured failure/empty success', async () => {
    const controller = new AbortController();
    const calls = [];
    const context = vm.createContext({
        API_BASE: '/api', URLSearchParams,
        addProductBusinessContextParam(params, value) { params.set('businessContext', value); },
        getProductBusinessContextValue: value => value.businessContext,
        getAuthHeaders: () => ({}), handleAuthError: () => false,
        apiNetworkFetch: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ success: true, blueprint: null })); }
    });
    vm.runInContext(section(apiSource, 'async function apiGetBurgerMenuImageBlueprint(', 'async function apiSaveBurgerMenuImageBlueprint('), context);
    const result = await context.apiGetBurgerMenuImageBlueprint({ businessContext: 'dar', signal: controller.signal });
    assert.equal(result.success, true);
    assert.equal(result.blueprint, null);
    assert.equal(calls[0].options.signal, controller.signal);
    assert.match(calls[0].url, /businessContext=dar/);
    context.apiNetworkFetch = async () => new Response(JSON.stringify({ error: 'Fixture unavailable' }), { status: 503 });
    const failed = await context.apiGetBurgerMenuImageBlueprint({ businessContext: 'dar' });
    assert.equal(failed.success, false);
    assert.equal(failed.error, 'Fixture unavailable');
    context.apiNetworkFetch = async () => { throw new Error('Fixture network failure'); };
    const rejected = await context.apiGetBurgerMenuImageBlueprint({ businessContext: 'dar' });
    assert.equal(rejected.success, false);
    assert.equal(rejected.error, 'Fixture network failure');
});
