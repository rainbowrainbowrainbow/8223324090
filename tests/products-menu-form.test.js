'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const menu = (id = 'menu-1', extra = {}) => ({ id, code: id, timelineCode: id === 'menu-1' ? 'M1' : 'M2', businessContext: 'event_genix',
    domain: 'kitchen', kitchenType: 'menu', category: 'menu', name: 'Fixture ' + id, label: 'Label', icon: '🍽️', price: 100,
    menuSection: 'Бургери', weightValue: '150/30 г', servingUnit: 'порція', availabilityStatus: 'active', isActive: true,
    duration: 0, hosts: 0, ageRange: '', kidsCapacity: '', isPerChild: false, hasFiller: false, isCustom: true, sortOrder: 0,
    shortDescription: 'Short description', description: 'Full description', promoDescription: 'Promo description', ingredients: 'Ingredients', allergens: ['milk'],
    techCard: 'Plain tech card', techCardMode: 'simple', iconUrl: '/uploads/catalog-images/items/current.jpg',
    aiCardDraft: { imageStudio: { status: 'ready', imageUrl: '/uploads/catalog-images/items/draft.jpg' } }, ...extra });
function harness(products = [menu(), menu('menu-2')]) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'programs.html'), 'utf8'), { url: 'http://localhost/programs#kitchen-menu', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window, calls = { create: 0, update: 0, tech: 0, confirm: 0, payloads: [] }, notifications = [];
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.scrollTo = () => {};
    w.eval(fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'));
    w.AppState = { currentUser: { role: 'creator' } };
    w.getUserRole = () => 'creator'; w.canAccess = () => true; w.resolveCapability = () => ({ allowed: true });
    w.CrmBusinessContext = { normalize: value => value || 'event_genix', current: () => 'event_genix', scope: () => ({ mode: 'single', activeContext: 'event_genix' }), isReadOnly: () => false };
    w.formatPrice = value => `${value} ₴`;
    w.showNotification = (message, type) => notifications.push({ message, type });
    w.EventCards = { renderEventCardImage: () => '' };
    w.confirmAnswer = false;
    w.confirmModal = async () => { calls.confirm++; return w.confirmAnswer; };
    w.apiGetProducts = async () => products.filter(product => product.isActive !== false);
    w.apiGetProduct = async id => products.find(product => product.id === id);
    w.apiGetWarehouse = async () => ({ items: [] });
    w.apiGetProductTechCard = async () => ({ success: true, techCard: { mode: 'simple', ingredients: [] } });
    w.apiUpdateProductTechCard = async (id, payload) => { calls.tech++; calls.techPayload = payload; return { success: true }; };
    w.apiUpdateProduct = async (id, payload) => {
        calls.update++; calls.payloads.push(payload);
        const index = products.findIndex(product => product.id === id);
        products[index] = { ...products[index], ...payload };
        return { success: true, product: products[index] };
    };
    w.apiCreateProduct = async payload => { calls.create++; calls.payloads.push(payload); products.push({ ...payload }); return { success: true, product: products.at(-1) }; };
    w.apiGetBurgerMenuImageBlueprint = async () => ({ success: true, blueprint: null });
    vm.runInContext(fs.readFileSync(path.join(root, 'js/programs-page.js'), 'utf8').replace("document.addEventListener('DOMContentLoaded', initPage);", ''), dom.getInternalVMContext());
    w.fixture = products;
    w.eval("allProducts=fixture; activeProductTab='kitchen'; activeKitchenTab='menu'; productsLoadState='ready'; renderProducts();");
    const field = id => w.document.getElementById(id);
    const card = id => w.document.querySelector(`[data-id="${id}"]`);
    const edit = (id = 'menu-1', options = {}) => w.openProductForm(id, { trigger: card(id)?.querySelector('.card-actions button'), ...options });
    const set = (id, value) => { const input = field(id); input.value = value; input.dispatchEvent(new w.Event('input', { bubbles: true })); };
    return { w, dom, calls, notifications, field, card, edit, set, products, close: () => { w.dispatchEvent(new w.PageTransitionEvent('pagehide')); dom.window.close(); } };
}

test('the unique shared form is grouped in the menu dialog; program/cake/workshop placement and attributes are restored', async () => {
    const h = harness([menu(), menu('cake', { kitchenType: 'cake', category: 'cake' }), { ...menu('program'), domain: 'program', kitchenType: null, category: 'quest' }]);
    try {
        const form = h.field('productForm'), name = h.field('pf-name'), placeholder = name.placeholder;
        await h.edit();
        assert.equal(form.closest('[role="dialog"]').id, 'menuProductEditorModal');
        assert.equal(form.querySelectorAll('[data-menu-form-group]').length, 3);
        for (const id of ['pf-duration', 'pf-hosts', 'pf-age', 'pf-kids', 'pf-category']) assert.ok(h.field(id).closest('.menu-program-only'));
        for (const id of ['pf-perchild', 'pf-filler']) assert.ok(h.field(id).closest('label').classList.contains('menu-program-only'));
        for (const input of form.querySelectorAll('[id^="pf-"]')) assert.equal(h.w.document.querySelectorAll(`[id="${input.id}"]`).length, 1);
        await h.w.closeProductForm();
        await h.w.openProductForm('cake');
        assert.equal(form.parentElement.id, 'kitchenPanel'); assert.equal(h.field('pf-name'), name); assert.equal(name.placeholder, placeholder);
        assert.equal(form.querySelectorAll('.menu-program-only, [data-menu-form-group]').length, 0);
        h.w.closeProductForm(); h.w.eval("activeProductTab='programs'"); await h.w.openProductForm('program');
        assert.equal(form.parentElement.id, 'programsPanel');
        h.w.closeProductForm(); h.w.eval("activeBusinessContext='maysternya_doli'"); await h.w.openProductForm();
        assert.equal(form.closest('#maysternyaPanel').id, 'maysternyaPanel');
    } finally { h.close(); }
});

for (const hidden of [{ duration: 0, hosts: 0, ageRange: '', kidsCapacity: '', isPerChild: false, hasFiller: false },
    { duration: 45, hosts: 2, ageRange: 'Legacy age', kidsCapacity: 'Legacy capacity', isPerChild: true, hasFiller: true }])
test(`save preserves hidden values ${JSON.stringify(hidden)} and distinct descriptions/current image/draft`, async () => {
    const product = menu('menu-1', { ...hidden, cakeDecoration: 'Legacy hidden decoration' }), h = harness([product]);
    try {
        await h.edit(); h.set('pf-name', 'Edited dish'); h.set('pf-short-description', 'Edited short');
        // Hidden controls cannot change the source values even if a programmatic writer touches them.
        h.field('pf-hosts').value = 99; h.field('pf-duration').value = 999;
        const result = await h.w.saveProduct(); assert.equal(result.success, true);
        const payload = h.calls.payloads[0];
        for (const [key, value] of Object.entries(hidden)) assert.equal(payload[key], value, key);
        assert.equal(payload.isCustom, true); assert.equal(payload.cakeDecoration, 'Legacy hidden decoration');
        assert.equal(payload.businessContext, 'event_genix'); assert.equal(payload.timelineCode, 'M1');
        assert.equal(payload.description, 'Full description'); assert.equal(payload.promoDescription, 'Promo description'); assert.equal(payload.shortDescription, 'Edited short');
        assert.equal('iconUrl' in payload, false); assert.equal('aiCardDraft' in payload, false);
        assert.equal(h.products[0].iconUrl, product.iconUrl); assert.deepEqual(h.products[0].aiCardDraft, product.aiCardDraft);
        assert.equal(h.field('menuProductEditorModal').classList.contains('hidden'), true);
    } finally { h.close(); }
});

test('Cancel and Escape reject dirty discard, accepted Cancel writes nothing and returns focus/scroll', async () => {
    const h = harness();
    try {
        const trigger = h.card('menu-1').querySelector('.card-actions button'); trigger.focus();
        const scrolls = []; h.w.scrollTo = options => scrolls.push(options);
        await h.edit(); h.set('pf-name', 'Unsaved');
        assert.equal(await h.w.closeProductForm(), false); assert.equal(h.field('pf-name').value, 'Unsaved');
        h.field('pf-name').dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(h.calls.confirm, 2); assert.equal(h.w.isProductFormOpen(), true);
        h.w.confirmAnswer = true; assert.equal(await h.w.closeProductForm(), true);
        assert.equal(h.w.document.activeElement, trigger); assert.equal(scrolls.at(-1).top, 0); assert.equal(h.w.document.body.style.overflow, '');
        assert.equal(h.calls.update + h.calls.create + h.calls.tech, 0);
    } finally { h.close(); }
});

test('selection, tabs, business switch and unload guard retain the dirty menu until discard is accepted', async () => {
    const h = harness();
    try {
        await h.edit(); h.set('pf-name', 'Keep this draft');
        assert.equal(await h.edit('menu-2'), false); assert.equal(h.field('pf-id').value, 'menu-1');
        assert.equal(await h.w.setKitchenTab('cake'), false);
        assert.equal(await h.w.setProductTab('programs'), false);
        assert.equal(await h.w.guardProductBusinessSwitch(), false);
        assert.equal(await h.w.applyProductBusinessContext('maysternya_doli'), 'event_genix');
        const event = new h.w.Event('beforeunload', { cancelable: true }); h.w.dispatchEvent(event); assert.equal(event.defaultPrevented, true);
        h.w.confirmAnswer = true; await h.edit('menu-2'); assert.equal(h.field('pf-id').value, 'menu-2');
        assert.equal(h.calls.update + h.calls.create, 0);
    } finally { h.close(); }
});

test('save in-flight deduplicates clicks and blocks discard/selection; failure keeps values and re-enables Save', async () => {
    const h = harness();
    try {
        await h.edit(); h.set('pf-name', 'Retry this name');
        let reject;
        h.w.apiUpdateProduct = () => { h.calls.update++; return new Promise((_, fail) => { reject = fail; }); };
        const saving = h.w.saveProduct();
        assert.equal(h.field('pf-name').disabled, true); assert.equal(h.field('saveProductBtn').disabled, true);
        assert.equal((await h.w.saveProduct()).error, 'save_in_flight');
        assert.equal(await h.w.closeProductForm(), false); assert.equal(await h.edit('menu-2'), false);
        reject(Error('Synthetic save failure'));
        assert.equal((await saving).success, false); assert.equal(h.calls.update, 1);
        assert.equal(h.field('pf-name').value, 'Retry this name'); assert.equal(h.field('pf-name').disabled, false); assert.equal(h.field('saveProductBtn').disabled, false);
        assert.equal(h.w.menuProductEditorDirty(), true);
    } finally { h.close(); }
});

test('creation still requires timelineCode; Save and add another opens an empty form with the same unique IDs', async () => {
    const h = harness([]);
    try {
        await h.w.openProductForm(); h.set('pf-name', 'New fixture'); h.set('pf-code', 'NEW-1');
        assert.equal((await h.w.saveProduct()).error, 'timeline_code_invalid');
        assert.equal(h.w.document.querySelector('[data-menu-form-group="additional"]').open, true);
        assert.equal(h.w.document.activeElement, h.field('pf-timeline-code'));
        h.set('pf-timeline-code', 'NEW1');
        assert.equal((await h.w.saveProduct({ addNext: true })).success, true);
        assert.equal(h.calls.create, 1); assert.equal(h.field('pf-id').value, ''); assert.equal(h.field('pf-name').value, '');
        assert.equal(h.field('saveProductBtn').disabled, false); assert.equal(h.w.document.querySelectorAll('#pf-name').length, 1);
        assert.equal(h.field('menuProductEditorModal').classList.contains('hidden'), false);
    } finally { h.close(); }
});

test('partial create/tech-card failure retains the created ID and retries UPDATE without another CREATE', async () => {
    const h = harness([]);
    try {
        await h.w.openProductForm(); h.set('pf-name', 'Partial fixture'); h.set('pf-code', 'PARTIAL'); h.set('pf-timeline-code', 'P1');
        let fail = true;
        h.w.apiUpdateProductTechCard = async () => ({ success: !fail, error: 'Synthetic tech failure' });
        assert.equal((await h.w.saveProduct()).success, false);
        const id = h.field('pf-id').value; assert.ok(id); assert.equal(h.calls.create, 1); assert.equal(h.calls.update, 0);
        fail = false; assert.equal((await h.w.saveProduct()).success, true);
        assert.equal(h.calls.create, 1); assert.equal(h.calls.update, 1); assert.equal(h.products[0].id, id);
    } finally { h.close(); }
});

test('failed hydration blocks writes; retry preserves entered fields; late cancelled hydration cannot replace another dish', async () => {
    const h = harness();
    try {
        h.w.apiGetProductTechCard = async () => { throw Error('Unavailable'); };
        assert.equal(await h.edit(), false); h.set('pf-name', 'Entered after load failure');
        assert.equal((await h.w.saveProduct()).error, 'form_not_ready'); assert.equal(h.calls.update, 0);
        h.w.apiGetProductTechCard = async () => ({ success: true, techCard: { mode: 'simple', ingredients: [] } });
        await h.w.retryMenuProductTechCard(); assert.equal(h.field('pf-name').value, 'Entered after load failure');
        assert.equal(h.w.menuProductEditorDirty(), true);
        h.w.confirmAnswer = true; await h.w.closeProductForm();
        let finish;
        h.w.apiGetProductTechCard = () => new Promise(resolve => { finish = resolve; });
        const opening = h.edit(); await new Promise(resolve => setTimeout(resolve, 0));
        await h.w.closeProductForm();
        h.w.apiGetProductTechCard = async () => ({ success: true, techCard: { mode: 'simple', ingredients: [] } });
        await h.edit('menu-2');
        finish({ success: true, techCard: { mode: 'detailed', ingredients: [{ label: 'Late row', quantity: 1 }] } });
        await opening;
        assert.equal(h.field('pf-id').value, 'menu-2'); assert.equal(h.field('pf-tech-card-detailed').checked, false);
        assert.doesNotMatch(h.field('productForm').textContent, /Late row/);
    } finally { h.close(); }
});

test('photo completion and card rerender preserve the editor nodes, focus and unsaved descriptions', async () => {
    const h = harness();
    try {
        await h.edit(); const input = h.field('pf-short-description'); h.set(input.id, 'Unsaved short'); input.focus();
        h.w.updateProductInState(menu('menu-1', { iconUrl: '/uploads/catalog-images/items/new.jpg', aiCardDraft: { imageStudio: { status: 'ready', imageUrl: '/uploads/catalog-images/items/new-draft.jpg' } } }));
        h.w.refreshProductCard('menu-1'); h.w.renderProducts();
        assert.equal(h.field('pf-short-description'), input); assert.equal(input.value, 'Unsaved short'); assert.equal(h.w.document.activeElement, input);
        assert.equal(h.field('menuProductEditorModal').classList.contains('hidden'), false);
        h.w.confirmAnswer = true; await h.w.closeProductForm();
        assert.equal(h.w.document.activeElement, h.card('menu-1').querySelector('.card-actions button'));
    } finally { h.close(); }
});

test('detailed tech-card and existing write-off entry keep their canonical controls and ingredient payload', async () => {
    const h = harness([menu('menu-1', { techCardMode: 'detailed' })]);
    try {
        h.w.apiGetWarehouse = async () => ({ items: [{ id: '1', name: 'Fixture potato', unit: 'г' }] });
        h.w.apiGetProductTechCard = async () => ({ success: true, techCard: { mode: 'detailed', ingredients: [{ stockId: '1', label: 'Fixture potato', quantity: 150, unit: 'г', wastePercent: 10 }] } });
        await h.edit('menu-1', { focusWriteOff: true });
        assert.equal(h.w.document.querySelector('[data-menu-form-group="additional"]').open, true);
        assert.equal(h.w.document.activeElement, h.field('pf-tech-writeoff-units'));
        assert.equal((await h.w.saveProduct({ keepOpen: true })).success, true);
        assert.equal(h.calls.techPayload.techCardMode, 'detailed'); assert.equal(h.calls.techPayload.ingredients[0].quantity, 150);
        assert.equal(h.calls.techPayload.ingredients[0].stockId, 1); assert.equal(h.calls.techPayload.ingredients[0].wastePercent, 10);
        assert.equal(h.w.menuProductEditorDirty(), false); assert.equal(h.field('saveProductBtn').disabled, false);
    } finally { h.close(); }
});


test('AI review requires explicit block approval and Apply retains the menu identity and hidden fields', async () => {
    const h = harness();
    try {
        await h.edit();
        let aiWrites = 0;
        h.w.apiSaveProductMenuAiDraft = async (id, data) => { aiWrites++; assert.equal(id, 'menu-1'); assert.equal(data.status, 'applied'); return { success: true }; };
        h.w.eval("menuAiReviewState={currentStep:'nameDescription',draft:{blocks:{}},approvedBlocks:{}}");
        await h.w.applyMenuAiReviewFinal();
        assert.equal(h.calls.update + aiWrites, 0);
        h.w.eval("menuAiReviewState.approvedBlocks={nameDescription:{data:{name:'Approved dish',shortDescription:'Approved short'}},allergens:{data:{allergens:['milk']}},ingredients:{data:{ingredients:[]}},priceCost:{data:{suggestedPrice:110}}}");
        await h.w.applyMenuAiReviewFinal();
        assert.equal(h.calls.update, 1); assert.equal(aiWrites, 1);
        assert.equal(h.products[0].name, 'Approved dish'); assert.equal(h.products[0].shortDescription, 'Approved short');
        assert.equal(h.products[0].hosts, 0); assert.equal(h.products[0].hasFiller, false);
        assert.equal(h.products[0].timelineCode, 'M1'); assert.equal(h.products[0].iconUrl, '/uploads/catalog-images/items/current.jpg');
        assert.equal(h.field('menuProductEditorModal').classList.contains('hidden'), true);
    } finally { h.close(); }
});

test('a stale menu business context cannot write the full payload into another business', async () => {
    const h = harness();
    try {
        await h.edit(); h.set('pf-name', 'Unsaved name');
        h.w.eval("activeBusinessContext='maysternya_doli'");
        assert.equal((await h.w.saveProduct()).error, 'form_context_changed');
        assert.equal(h.calls.create + h.calls.update + h.calls.tech, 0);
        assert.equal(h.field('pf-name').value, 'Unsaved name');
    } finally { h.close(); }
});
