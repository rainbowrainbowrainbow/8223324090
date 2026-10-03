'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/programs-page.js'), 'utf8');
const menu = (id = 'burger-1', section = 'Бургери') => ({
    id, code: id, timelineCode: id.endsWith('1') ? 'B1' : 'B2', businessContext: 'event_genix', domain: 'kitchen', kitchenType: 'menu', category: 'menu', sortOrder: 0, isActive: true,
    name: 'Тестовий бургер ' + id, menuSection: section, price: 420, servingUnit: 'порція',
    weightValue: '320 г', ingredients: 'Синтетичний склад', allergens: ['milk'],
    description: 'Повний синтетичний опис', techCard: 'Технологічна карта',
    iconUrl: '/uploads/catalog-images/items/current.jpg'
});
function harness(products = [menu(), menu('burger-2', 'Салати')], role = 'creator') {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'programs.html'), 'utf8'), {
        url: 'http://localhost/programs#kitchen-menu', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const w = dom.window, notifications = [], calls = { products: 0, product: 0 };
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.scrollTo = () => {};
    w.AppState = { currentUser: { role } };
    w.getUserRole = () => role;
    w.canAccess = () => true;
    w.resolveCapability = () => ({ allowed: true });
    w.CrmBusinessContext = { normalize: value => value || 'event_genix', current: () => 'event_genix',
        scope: () => ({ mode: 'single', activeContext: 'event_genix' }), isReadOnly: () => false };
    w.formatPrice = value => `${value} ₴`;
    w.showNotification = (message, type) => notifications.push({ message, type });
    w.EventCards = { renderEventCardImage: () => '' };
    w.apiGetProducts = async () => { calls.products++; return products; };
    w.apiGetProduct = async id => { calls.product++; return products.find(p => p.id === id); };
    w.apiGetBurgerMenuImageBlueprint = async () => ({ success: true, blueprint: null });
    w.apiGetProductMenuImageStatus = async () => { throw new Error('No real status reads'); };
    vm.runInContext(source.replace("document.addEventListener('DOMContentLoaded', initPage);", ''), dom.getInternalVMContext());
    w.fixture = products;
    w.eval("allProducts = fixture; activeProductTab='kitchen'; activeKitchenTab='menu'; activeMenuSection='all'; productsLoadState='ready'; renderProducts();");
    const card = id => [...w.document.querySelectorAll('.kitchen-product-card')].find(c => c.dataset.id === id);
    const open = (id, kind = 'photo') => {
        const panel = card(id).querySelector(kind === 'photo' ? '.kitchen-menu-image-disclosure' : '.product-details:not(.kitchen-menu-image-disclosure)');
        if (kind === 'photo') {
            w.openKitchenMenuImageStudio(id, panel.querySelector('[data-menu-image-open]'));
            return panel.querySelector('.kitchen-menu-image-dialog');
        }
        panel.open = true; w.hydrateProductPanel(panel); return panel;
    };
    return { w, dom, calls, notifications, card, open, close: () => {
        w.dispatchEvent(new w.PageTransitionEvent('pagehide')); dom.window.close();
    } };
}

test('initial menu keeps visible business facts and actions but creates no hidden editors or photo studios', () => {
    const h = harness([...Array.from({ length: 20 }, (_, i) => menu('burger-' + i)),
        { id: 'program', domain: 'program', category: 'animation', name: 'Program', price: 1 }]);
    try {
        assert.equal(h.w.document.querySelectorAll('.kitchen-product-card').length, 20);
        assert.equal(h.w.document.querySelectorAll('.kitchen-menu-image-studio, .product-details-content').length, 0);
        assert.equal(h.w.document.querySelector('#productsGrid').children.length, 0);
        assert.equal(h.w.document.querySelectorAll('#kitchenGrid input, #kitchenGrid textarea, #kitchenGrid select').length, 0);
        assert.match(h.card('burger-0').textContent, /320 г/);
        assert.match(h.card('burger-0').textContent, /Синтетичний склад/);
        assert.match(h.card('burger-0').textContent, /Алергени/);
        assert.match(h.card('burger-0').textContent, /Редагувати/);
        assert.match(h.card('burger-0').textContent, /Фото меню/);
    } finally { h.close(); }
});

test('opening details and photo panel hydrates only that panel once and exposes all existing controls', () => {
    const h = harness();
    try {
        const details = h.open('burger-1', 'details'), content = details.firstElementChild.nextElementSibling.firstElementChild;
        assert.match(details.textContent, /Повний синтетичний опис/);
        const photo = h.open('burger-1');
        assert.equal(h.w.document.querySelectorAll('.kitchen-menu-image-studio').length, 1);
        assert.ok(photo.querySelector('[data-menu-image-generator]'));
        for (const action of ['generate', 'apply', 'reject', 'external-draft']) assert.ok(photo.querySelector(`[data-menu-image-action="${action}"]`));
        const input = photo.querySelector('[data-menu-image-url]');
        photo.open = false; photo.open = true; h.w.hydrateProductPanel(photo);
        assert.equal(photo.querySelector('[data-menu-image-url]'), input);
        assert.equal(details.querySelector('[data-product-panel-content]').firstElementChild, content);
        assert.equal(h.calls.products, 0);
    } finally { h.close(); }
});

test('one item update preserves every card, lazy panel, focus, user fields and expanded details', () => {
    const h = harness();
    try {
        const card = h.card('burger-1'), other = h.card('burger-2'), photo = h.open('burger-1'), details = h.open('burger-1', 'details');
        const input = photo.querySelector('[data-menu-image-url]'), rules = photo.querySelector('[data-burger-blueprint-instructions]');
        input.value = 'https://fixture.invalid/unsaved.jpg'; rules.value = 'Local rules'; rules.dataset.edited = 'true'; input.focus();
        const style = photo.querySelector('[data-menu-image-style]'); style.value = 'realistic';
        h.w.updateProductInState({ ...menu(), name: 'Updated burger', price: 421, iconUrl: '/uploads/catalog-images/items/new.jpg' });
        h.w.refreshProductCard('burger-1', 'event_genix');
        assert.equal(h.card('burger-1'), card); assert.equal(h.card('burger-2'), other);
        assert.equal(h.w.document.activeElement, input); assert.equal(photo.querySelector('[data-menu-image-url]'), input);
        assert.equal(input.value, 'https://fixture.invalid/unsaved.jpg'); assert.equal(rules.value, 'Local rules');
        assert.equal(style.value, 'realistic'); assert.ok(photo.open && details.open);
        assert.match(card.textContent, /Updated burger/);
        assert.match(details.textContent, /Updated burger/);
        assert.match(photo.querySelector('.kitchen-menu-image-previews img').getAttribute('src'), /new.jpg/);
        assert.equal(h.calls.products, 0);
    } finally { h.close(); }
});

test('filtering, cake/menu and product tabs preserve photo draft nodes and hydrate hidden tabs only on opening', async () => {
    const h = harness([menu(), menu('burger-2', 'Салати'),
        { ...menu('cake'), kitchenType: 'cake', name: 'Cake' },
        { id: 'program', domain: 'program', category: 'animation', name: 'Program', price: 1 }]);
    try {
        const card = h.card('burger-1'), photo = h.open('burger-1'), input = photo.querySelector('[data-menu-image-url]');
        input.value = 'Draft retained';
        h.w.eval("activeMenuSection='Салати'; renderProducts();");
        assert.equal(h.w.document.querySelectorAll('.kitchen-product-card').length, 1);
        h.w.eval("activeMenuSection='all'; renderProducts();");
        assert.equal(h.card('burger-1'), card);
        h.w.setKitchenTab('cake'); assert.match(h.w.document.querySelector('#kitchenGrid').textContent, /Cake/);
        h.w.setKitchenTab('menu'); assert.equal(h.card('burger-1'), card);
        await h.w.setProductTab('programs'); assert.ok(h.w.document.querySelector('#productsGrid .program-card'));
        h.w.updateProductInState({ ...menu(), name: 'Fresh while hidden' }); h.w.refreshProductCard('burger-1');
        await h.w.setProductTab('kitchen');
        assert.equal(h.card('burger-1'), card); assert.equal(photo.querySelector('[data-menu-image-url]'), input);
        assert.equal(input.value, 'Draft retained'); assert.equal(photo.open,false);
        h.open('burger-1'); assert.equal(photo.open,true);
        assert.match(card.textContent, /Fresh while hidden/);
    } finally { h.close(); }
});

test('successful photo apply and failed generation refresh one card without losing manual or blueprint fields', async () => {
    const h = harness();
    try {
        const other = h.card('burger-2'), card = h.card('burger-1'), photo = h.open('burger-1');
        const input = photo.querySelector('[data-menu-image-url]'); input.value = 'Keep this input';
        h.w.apiApplyProductMenuImage = async () => ({ success: true, product: { ...menu(), iconUrl: '/uploads/catalog-images/items/applied.jpg', aiCardDraft: { imageStudio: { status: 'applied', imageUrl: '/uploads/catalog-images/items/applied.jpg' } } } });
        await h.w.applyKitchenMenuImageDraft('burger-1', photo.querySelector('[data-menu-image-action="apply"]'));
        assert.equal(h.card('burger-1'), card); assert.equal(h.card('burger-2'), other);
        assert.equal(input.value, 'Keep this input');
        assert.equal(photo.querySelector('[data-menu-image-action="apply"]').disabled, true);
        h.w.apiGenerateProductMenuImage = async () => ({ success: false, code: 'menu_image_generation_quota_exceeded' });
        await h.w.generateKitchenMenuImage('burger-1', photo.querySelector('[data-menu-image-action="generate"]'));
        assert.equal(h.card('burger-2'), other); assert.equal(input.value, 'Keep this input');
        assert.equal(input.disabled, false);
        assert.match(photo.querySelector('[data-menu-image-generation-status]').textContent, /Квота/);
    } finally { h.close(); }
});

test('deactivation removes only one menu card and keeps another open studio intact', async () => {
    const h = harness();
    try {
        const other = h.card('burger-2'), photo = h.open('burger-2'), input = photo.querySelector('[data-menu-image-url]'); input.value = 'Unsaved';
        h.w.confirmModal = async () => true; h.w.apiDeleteProduct = async () => ({ success: true });
        await h.w.deleteProduct('burger-1');
        assert.equal(h.card('burger-1'), undefined); assert.equal(h.card('burger-2'), other);
        assert.equal(photo.querySelector('[data-menu-image-url]'), input); assert.equal(input.value, 'Unsaved');
        assert.equal(h.calls.products, 0);
    } finally { h.close(); }
});

test('context switch discards cached nodes and stale updates cannot hydrate or alter the next business', () => {
    const h = harness();
    try {
        const old = h.card('burger-1'), panel = h.open('burger-1');
        panel.querySelector('[data-menu-image-url]').value = 'Old business draft';
        h.w.eval("activeBusinessContext='dar'; allProducts=[{id:'burger-1',domain:'program',businessContext:'dar',name:'Dar product',price:1}]; renderProducts();");
        h.w.refreshProductCard('burger-1', 'event_genix');
        assert.equal(old.isConnected, false);
        assert.equal(h.w.document.querySelectorAll('.kitchen-menu-image-studio').length, 0);
        assert.match(h.w.document.querySelector('#maysternyaProductsGrid').textContent, /Dar product/);
        h.w.hydrateProductPanel(panel);
        assert.equal(panel.querySelector('[data-menu-image-url]').value, 'Old business draft');
    } finally { h.close(); }
});

test('read-only role keeps menu information and details without creating write controls', () => {
    const h = harness(undefined, 'animator');
    try {
        assert.equal(h.w.document.querySelectorAll('.kitchen-menu-image-disclosure').length, 0);
        assert.equal(h.w.document.querySelectorAll('#kitchenGrid .card-actions').length, 0);
        assert.match(h.open('burger-1', 'details').textContent, /Синтетичний склад/);
    } finally { h.close(); }
});

test('shared product editor input and focus survive an update of another menu card', async () => {
    const h = harness();
    try {
        h.w.apiGetProductTechCard = async () => ({ success: true, techCard: { techCardMode: 'simple', ingredients: [] } });
        await h.w.openProductForm('burger-1');
        const input = h.w.document.getElementById('pf-name'); input.value = 'Unsaved editor name'; input.focus();
        h.w.updateProductInState({ ...menu('burger-2', 'Салати'), price: 500 }); h.w.refreshProductCard('burger-2');
        assert.equal(input.value, 'Unsaved editor name'); assert.equal(h.w.document.activeElement, input);
        assert.notEqual(h.w.document.getElementById('productForm').style.display, 'none');
    } finally { h.close(); }
});

test('saving one menu item fetches only that fresh item and keeps another card draft', async () => {
    const products = [menu(), menu('burger-2', 'Салати')], h = harness(products);
    try {
        const first = h.card('burger-1'), other = h.card('burger-2'), photo = h.open('burger-2');
        const input = photo.querySelector('[data-menu-image-url]'); input.value = 'Still editing this photo';
        h.w.apiGetProductTechCard = async () => ({ success: true, techCard: { techCardMode: 'simple', ingredients: [] } });
        h.w.apiUpdateProductTechCard = async () => ({ success: true });
        h.w.apiUpdateProduct = async (id, payload) => {
            products[0] = { ...products[0], ...payload, techCardIngredientCount: 3 };
            return { success: true, product: products[0] };
        };
        await h.w.openProductForm('burger-1');
        h.w.document.getElementById('pf-name').value = 'Saved menu name';
        const result = await h.w.saveProduct({ keepOpen: true });
        assert.equal(result.success, true, JSON.stringify(result));
        assert.equal(h.calls.products, 0); assert.equal(h.calls.product, 1);
        assert.equal(h.card('burger-1'), first); assert.equal(h.card('burger-2'), other);
        assert.match(first.textContent, /Saved menu name/);
        assert.equal(photo.querySelector('[data-menu-image-url]'), input);
        assert.equal(input.value, 'Still editing this photo');
    } finally { h.close(); }
});

test('completed synthetic image poll updates its card while preserving other inputs and nodes', async () => {
    const h = harness([{ ...menu(), aiCardDraft: { imageStudio: { status: 'generating', provider: 'kie' } } }, menu('burger-2')]);
    try {
        h.open('burger-1');
        const first = h.card('burger-1'), other = h.card('burger-2'), photo = h.open('burger-2');
        const input = photo.querySelector('[data-menu-image-url]'); input.value = 'Retained during polling';
        h.w.apiGetProductMenuImageStatus = async () => ({ success: true, status: 'ready', product: {
            ...menu(), name: 'Poll completed', aiCardDraft: { imageStudio: { status: 'ready', imageUrl: '/uploads/catalog-images/items/draft.jpg' } }
        } });
        await h.w.resumeKitchenMenuImageTracking('burger-1');
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(h.card('burger-1'), first); assert.equal(h.card('burger-2'), other);
        assert.match(first.textContent, /Poll completed/);
        assert.equal(input.value, 'Retained during polling');
    } finally { h.close(); }
});

for (const mode of ['deactivate', 'reorder']) test(`menu save preserves canonical active list and ${mode} behavior without replacing other cards`, async () => {
    const products = [menu(), menu('burger-2', 'Салати')], h = harness(products);
    try {
        const other = h.card('burger-2'), photo = h.open('burger-2'), input = photo.querySelector('[data-menu-image-url]'); input.value = 'Retained';
        h.w.apiGetProductTechCard = async () => ({ success: true, techCard: { mode: 'simple', ingredients: [] } });
        h.w.apiUpdateProductTechCard = async () => ({ success: true });
        h.w.apiUpdateProduct = async (id, payload) => { products[0] = { ...products[0], ...payload }; return { success: true, product: products[0] }; };
        h.w.apiGetProducts = async () => { h.calls.products++; return [products[1], products[0]].filter(p => p.isActive !== false); };
        await h.w.openProductForm('burger-1');
        if (mode === 'deactivate') h.w.document.getElementById('pf-active').checked = false;
        else h.w.document.getElementById('pf-sort').value = '20';
        const result = await h.w.saveProduct({ keepOpen: true });
        assert.equal(result.success, true, JSON.stringify(result));
        assert.equal(h.card('burger-2'), other); assert.equal(input.value, 'Retained');
        if (mode === 'deactivate') { assert.equal(h.card('burger-1'), undefined); assert.equal(h.calls.products, 0); }
        else { assert.equal(h.w.document.querySelector('.kitchen-product-card'), other); assert.equal(h.calls.products, 1); }
    } finally { h.close(); }
});
