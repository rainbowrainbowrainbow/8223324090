const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const {
    BOOKING_PACKAGE_SCHEMA_VERSION,
    normalizeMenuPositions,
    normalizeServiceEvents,
    menuPositionsSubtotal,
    buildLegacyBanquetMenu,
    applyBookingPackage,
    bookingPackageAudit
} = require('../services/bookingPackage');
const {
    normalizePriceDate,
    mapProductPriceFields,
    applyEffectiveBookingPrice
} = require('../services/productPricing');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const escapedAssetVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function createBookingMenuCatalogHarness() {
    const dom = new JSDOM(`
        <!doctype html>
        <html>
            <body>
                <button id="bookingMenuCatalogOpenBtn"></button>
                <section id="bookingMenuCatalogPanel">
                    <input id="bookingMenuCatalogSearch">
                    <div id="bookingMenuCatalogTabs"></div>
                    <div id="bookingMenuCatalogList"></div>
                    <aside id="bookingMenuCatalogCart">
                        <span id="bookingMenuCatalogCartSummary"></span>
                        <button id="bookingMenuCatalogCartCloseBtn"></button>
                    <div id="bookingMenuCatalogCartList"></div>
                </aside>
                <div id="bookingMenuInsightPanel" class="booking-menu-insight-panel hidden" hidden aria-hidden="true">
                    <strong id="bookingMenuInsightTitle"></strong>
                    <div id="bookingMenuInsightBody"></div>
                </div>
                <span id="bookingMenuCatalogEntrySummary"></span>
                <span id="bookingMenuCatalogSummary"></span>
                <span id="bookingMenuCatalogFooterCount"></span>
                    <span id="bookingMenuCatalogFooterTotal"></span>
                    <button id="bookingMenuCatalogMobileCartBtn"></button>
                </section>
                <select id="bookingMenuProductSelect"></select>
                <input id="bookingMenuNote">
                <input id="bookingMenuUnitPrice">
                <input id="bookingMenuQuantity" value="1">
                <input id="bookingMenuPositionsJson">
                <input id="bookingTime">
                <div id="bookingMenuPositionsList"></div>
                <textarea id="banquetMenu"></textarea>
                <input id="banquetGuests">
                <input id="banquetAdults">
                <input id="banquetTables">
                <button id="bookingMenuAddBtn"></button>
                <select id="selectedProgram"></select>
            </body>
        </html>
    `, { url: 'http://localhost/' });
    const bookingJs = read('js', 'booking.js');
    const start = bookingJs.indexOf('function bookingKitchenType(');
    const end = bookingJs.indexOf('const debouncedBookingDuplicateCheck');
    assert.ok(start >= 0 && end > start, 'booking menu catalog function slice exists');

    const context = {
        console,
        document: dom.window.document,
        window: dom.window,
        CSS: dom.window.CSS,
        setTimeout: (fn) => {
            if (typeof fn === 'function') fn();
            return 0;
        },
        BookingPackageState: {
            menuPositions: [],
            editIndex: null,
            catalogFilter: 'all',
            catalogEditing: null,
            catalogInsight: null,
            catalogProductsLoading: false
        },
        AppState: {
            products: [
                {
                    id: 'menu_pizza',
                    domain: 'kitchen',
                    category: 'menu',
                    name: 'Піца',
                    price: 250,
                    menuSection: 'Їжа',
                    servingUnit: 'шт',
                    sortOrder: 2,
                    isActive: true
                },
                {
                    id: 'menu_juice',
                    code: 'MENU-077',
                    domain: 'kitchen',
                    category: 'menu',
                    name: 'Сік яблучний',
                    price: 80,
                    menuSection: 'Напої',
                    servingUnit: 'л',
                    sortOrder: 1,
                    isActive: true
                },
                {
                    id: 'cake_custom',
                    domain: 'kitchen',
                    category: 'cake',
                    name: 'Cake',
                    price: 120,
                    menuSection: 'Торти',
                    servingUnit: 'шт',
                    sortOrder: 3,
                    isActive: true
                }
            ],
            selectedDate: '2026-06-12',
            productsBusinessContext: 'event_genix',
            productsPriceDate: '2026-06-12',
            productsLoadedAt: Date.now()
        },
        BookingForm: { _dirty: false },
        timelineKitchenEnabled: () => true,
        timelineDisplayUsesApiProducts: () => false,
        getTimelineProductsBusinessContext: () => 'event_genix',
        getTimelineProductsPriceDate: () => '2026-06-12',
        getProductsSync: () => context.AppState.products,
        getProducts: async () => context.AppState.products,
        formatPrice: value => `${Number(value || 0)} грн`,
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;'),
        updateBookingContextHeaderSummary: () => {},
        snapshotBookingRoomOptions: () => {},
        syncBookingWorkspaceMode: () => {},
        setBookingKitchenEnabled: () => {},
        getPinataModeValue: () => 'none',
        getClientPinataDefaultPrice: () => 0,
        isPinataProgram: () => false,
        getSelectedActivityPrograms: () => [],
        bookingActivitiesTotalPrice: () => 0,
        isRoomFirstTimelineView: () => true,
        getBookingWorkspaceHasEvent: () => false,
        isBookingKitchenEnabled: () => true,
        getSmartBookingValidationState: () => ({ canSubmit: true, warnings: [] }),
        updateBookingSubmitState: () => {},
        updateBookingContextHeaderSummaryCalls: 0,
        __menuAiDraftCalls: [],
        __menuAiSaveCalls: [],
        apiGenerateProductMenuAiDraft: async payload => {
            context.__menuAiDraftCalls.push(payload);
            return {
                success: true,
                aiAvailable: true,
                source: 'test',
                draft: {
                    status: 'draft',
                    blocks: {
                        allergens: {
                            key: 'allergens',
                            status: 'draft',
                            proposal: {
                                allergens: [
                                    { key: 'gluten', label: 'Gluten', reason: 'Test bakery ingredients' }
                                ]
                            }
                        }
                    }
                }
            };
        },
        apiSaveProductMenuAiDraft: async (id, payload) => {
            context.__menuAiSaveCalls.push({ id, payload });
            return {
                success: true,
                approvedBlocks: payload.approvedBlocks || {}
            };
        },
        showNotification: () => {}
    };
    context.window.KITCHEN_MENU_IMAGES = Object.freeze({
        basePath: '/images/kitchen-menu/',
        byId: Object.freeze({}),
        byCode: Object.freeze({ 'MENU-077': 'juice.webp' }),
        byName: Object.freeze({})
    });
    context.__bookingMenuCatalogMobile = false;
    context.window.matchMedia = (query) => ({
        matches: String(query || '').includes('900px') ? context.__bookingMenuCatalogMobile : false,
        media: String(query || ''),
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
    });
    context.window.BookingForm = context.BookingForm;

    vm.createContext(context);
    vm.runInContext(bookingJs.slice(start, end), context, { filename: 'js/booking.js' });
    return context;
}

function dispatchPointerElement(window, element, type = 'click') {
    element.dispatchEvent(new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true
    }));
}

function clickElement(window, element) {
    dispatchPointerElement(window, element, 'click');
}

test('booking package normalizes menu positions with price and subtotal', () => {
    const positions = normalizeMenuPositions([
        { productId: 'menu_pizza', title: 'Піца', quantity: 3, unitPrice: 250, servingTime: '16:30', servingNote: 'first wave', servingBatchId: 'wave-1' },
        { product_id: 'menu_juice', label: 'Сік', qty: 2, price: 80, note: 'яблуко', serving_time: '99:99' },
        { productId: 'cake_custom', title: 'Cake', quantity: 2.5, unitPrice: 120, note: 'no nuts' },
        { title: '' }
    ]);

    assert.equal(positions.length, 3);
    assert.equal(positions[0].subtotal, 750);
    assert.equal(positions[1].subtotal, 160);
    assert.equal(positions[2].quantity, 2.5);
    assert.equal(positions[2].subtotal, 300);
    assert.equal(positions[2].note, 'no nuts');
    assert.equal(positions[1].kitchenType, 'menu');
    assert.equal(positions[0].servingTime, '16:30');
    assert.equal(positions[0].servingNote, 'first wave');
    assert.equal(positions[0].servingGroupId, 'wave-1');
    assert.equal(positions[0].servingBatchId, 'wave-1');
    assert.equal(positions[1].servingTime, null);
    assert.equal(menuPositionsSubtotal(positions), 1210);
    assert.match(buildLegacyBanquetMenu(positions), /Піца - 3 x 250 грн/);
    assert.match(buildLegacyBanquetMenu(positions), /Сік - 2 x 80 грн \(яблуко\)/);
    assert.match(buildLegacyBanquetMenu(positions), /Cake - 2,5 x 120 .* \(no nuts\)/);
});

test('booking package normalizes banquet service events without schema changes', () => {
    const events = normalizeServiceEvents([
        { type: 'cake', title: 'Cake service', time: '17:45', note: 'with candles', relatedMenuPositionIds: ['cake_custom'] },
        { type: 'room_setup', title: 'Підготувати кімнату', time: '12:00' },
        { event_type: 'unknown', label: 'Custom reminder', serving_time: '18:10', durationMinutes: 15 },
        null
    ]);

    assert.equal(BOOKING_PACKAGE_SCHEMA_VERSION, 2);
    assert.equal(events.length, 3);
    assert.equal(events[0].type, 'cake');
    assert.equal(events[0].time, '17:45');
    assert.deepEqual(events[0].relatedMenuPositionIds, ['cake_custom']);
    assert.equal(events[1].type, 'room_setup');
    assert.equal(events[1].title, 'Підготувати кімнату');
    assert.equal(events[1].time, '12:00');
    assert.equal(events[2].type, 'custom');
    assert.equal(events[2].title, 'Custom reminder');
    assert.equal(events[2].durationMinutes, 15);
});

test('booking menu catalog inline edits keep menuPositions, legacy text, and reset state in sync', async () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    doc.getElementById('bookingMenuCatalogPanel').hidden = false;

    ctx.renderBookingMenuCatalog();
    assert.match(doc.getElementById('bookingMenuCatalogTabs').textContent, /Усе/);
    assert.match(doc.getElementById('bookingMenuCatalogTabs').textContent, /Піца/);
    assert.match(doc.getElementById('bookingMenuCatalogTabs').textContent, /Холодні напої/);
    assert.match(doc.getElementById('bookingMenuCatalogTabs').textContent, /Торти/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogTabs').textContent, /Популярне/);
    assert.equal(doc.getElementById('bookingMenuCatalogList').classList.contains('booking-menu-catalog-list--all'), true);
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-group-heading/);
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-thumb/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogList').innerHTML, /data-menu-catalog-insight="promo"/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogList').innerHTML, /data-menu-catalog-insight="allergens"/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogList').innerHTML, /data-menu-catalog-insight="pairings"/);
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /\/images\/kitchen-menu\/juice\.webp/);
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /\/images\/kitchen-menu\/fallback-burger-wide\.jpg/);
    ctx.setBookingMenuCatalogOpen(true);
    assert.equal(doc.body.classList.contains('booking-menu-catalog-active'), true);

    const fallbackImg = doc.querySelector('.booking-menu-catalog-thumb.uses-fallback-image img[data-menu-catalog-fallback="1"]');
    assert.ok(fallbackImg, 'fallback image is rendered when product has no configured photo');

    const manifestImg = doc.querySelector('.booking-menu-catalog-thumb.has-image img[src="/images/kitchen-menu/juice.webp"]');
    assert.ok(manifestImg, 'manifest image is rendered when configured');
    ctx.bookingMenuCatalogHandleImageError(manifestImg);
    assert.equal(manifestImg.closest('.booking-menu-catalog-thumb').classList.contains('uses-fallback-image'), true);
    assert.equal(manifestImg.getAttribute('src'), '/images/kitchen-menu/fallback-burger-wide.jpg');
    assert.equal(manifestImg.dataset.menuCatalogFallback, '1');
    ctx.bookingMenuCatalogHandleImageError(manifestImg);
    assert.equal(manifestImg.closest('.booking-menu-catalog-thumb').classList.contains('is-image-missing'), true);

    ctx.upsertBookingMenuCatalogProduct('cake_custom', 1);
    assert.equal(ctx.getBookingMenuPositions().length, 1);
    assert.equal(ctx.getBookingMenuPositions()[0].quantity, 1);
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-item selected/);
    assert.match(doc.getElementById('bookingMenuCatalogCartList').innerHTML, /booking-menu-catalog-cart-item/);
    assert.match(doc.getElementById('bookingMenuCatalogCartList').innerHTML, /booking-menu-catalog-thumb--cart/);
    assert.match(doc.getElementById('bookingMenuCatalogCartSummary').textContent, /1/);
    assert.match(doc.getElementById('bookingMenuCatalogMobileCartBtn').textContent, /140|120|грн/);
    assert.match(doc.getElementById('bookingMenuPositionsJson').value, /cake_custom/);

    ctx.setBookingMenuCatalogEditing('cake_custom', 'quantity');
    const quantityInput = doc.querySelector('[data-menu-catalog-quantity-input="cake_custom"]');
    assert.ok(quantityInput, 'quantity inline input rendered');
    quantityInput.value = '2.5';
    ctx.commitBookingMenuCatalogInlineInput(quantityInput);
    assert.equal(ctx.getBookingMenuPositions()[0].quantity, 2.5);
    assert.equal(ctx.getBookingMenuPositions()[0].subtotal, 300);

    ctx.setBookingMenuCatalogEditing('cake_custom', 'price');
    const priceInput = doc.querySelector('[data-menu-catalog-price-input="cake_custom"]');
    assert.ok(priceInput, 'price inline input rendered');
    priceInput.value = '140';
    ctx.commitBookingMenuCatalogInlineInput(priceInput);
    assert.equal(ctx.getBookingMenuPositions()[0].unitPrice, 140);
    assert.equal(ctx.getBookingMenuPositions()[0].subtotal, 350);

    ctx.setBookingMenuCatalogEditing('cake_custom', 'note');
    const noteInput = doc.querySelector('[data-menu-catalog-note-input="cake_custom"]');
    assert.ok(noteInput, 'note inline input rendered');
    noteInput.value = 'без горіхів';
    ctx.commitBookingMenuCatalogInlineInput(noteInput);
    assert.equal(ctx.getBookingMenuPositions()[0].note, 'без горіхів');
    assert.match(doc.getElementById('banquetMenu').value, /Cake - 2,5 шт x 140 грн \(без горіхів\)/);
    assert.equal(ctx.BookingForm._dirty, true);

    ctx.setBookingMenuCatalogInsight('cake_custom', 'allergens');
    assert.match(doc.getElementById('bookingMenuInsightBody').innerHTML, /data-menu-insight-generate/);
    await ctx.generateBookingMenuCatalogInsightDraft();
    assert.equal(ctx.__menuAiDraftCalls.length, 1);
    assert.equal(ctx.__menuAiDraftCalls[0].blockKey, 'allergens');
    assert.equal(ctx.__menuAiDraftCalls[0].businessContext, 'event_genix');
    assert.match(ctx.__menuAiDraftCalls[0].feedback, /Cake/);
    assert.match(doc.getElementById('bookingMenuInsightBody').textContent, /Gluten/);
    assert.equal(ctx.BookingPackageState.catalogInsight.mode, 'allergens');
    assert.equal(doc.getElementById('bookingMenuInsightPanel').hidden, false);
    assert.match(doc.getElementById('bookingMenuInsightTitle').textContent, /Cake/);
    assert.match(doc.getElementById('bookingMenuInsightBody').textContent, /Потенційні алергени/);
    assert.match(doc.getElementById('bookingMenuInsightBody').textContent, /не медична порада/);
    assert.match(doc.getElementById('bookingMenuInsightBody').textContent, /Cake/);
    ctx.approveBookingMenuCatalogInsightPrompt();
    assert.equal(ctx.BookingPackageState.catalogInsight.approved, true);
    assert.ok(ctx.BookingPackageState.catalogInsight.approvedBlocks.allergens);
    await ctx.saveBookingMenuCatalogInsightDraft();
    assert.equal(ctx.__menuAiSaveCalls.length, 1);
    assert.equal(ctx.__menuAiSaveCalls[0].id, 'cake_custom');
    assert.equal(ctx.__menuAiSaveCalls[0].payload.businessContext, 'event_genix');
    assert.ok(ctx.__menuAiSaveCalls[0].payload.approvedBlocks.allergens);
    assert.equal(ctx.BookingPackageState.catalogInsight.saved, true);
    assert.equal(ctx.getBookingMenuPositions().length, 1);
    assert.match(doc.getElementById('bookingMenuInsightBody').innerHTML, /booking-menu-insight-status success/);

    doc.getElementById('bookingMenuCatalogSearch').value = 'juice';
    ctx.BookingPackageState.catalogFilter = 'section:cold-drinks';
    ctx.renderBookingMenuCatalog();
    assert.equal(doc.getElementById('bookingMenuCatalogList').classList.contains('booking-menu-catalog-list--all'), false);
    ctx.setBookingMenuCatalogEditing('cake_custom', 'quantity', { preferCart: true });
    assert.equal(doc.querySelector('#bookingMenuCatalogList [data-menu-catalog-quantity-input="cake_custom"]'), null);
    const cartQuantityInput = doc.querySelector('#bookingMenuCatalogCart [data-menu-catalog-quantity-input="cake_custom"]');
    assert.ok(cartQuantityInput, 'cart quantity input rendered even when catalog row is filtered out');
    cartQuantityInput.value = '3';
    ctx.commitBookingMenuCatalogInlineInput(cartQuantityInput);
    assert.equal(ctx.getBookingMenuPositions()[0].quantity, 3);
    assert.equal(ctx.getBookingMenuPositions()[0].subtotal, 420);

    ctx.__bookingMenuCatalogMobile = true;
    ctx.setBookingMenuCatalogCartOpen(false);
    assert.equal(doc.getElementById('bookingMenuCatalogCart').getAttribute('aria-hidden'), 'true');
    assert.equal(doc.getElementById('bookingMenuCatalogCart').hasAttribute('inert'), true);
    assert.equal(doc.getElementById('bookingMenuCatalogMobileCartBtn').getAttribute('aria-expanded'), 'false');
    ctx.setBookingMenuCatalogCartOpen(true);
    assert.equal(doc.getElementById('bookingMenuCatalogCart').getAttribute('aria-hidden'), 'false');
    assert.equal(doc.getElementById('bookingMenuCatalogCart').hasAttribute('inert'), false);
    assert.equal(doc.getElementById('bookingMenuCatalogMobileCartBtn').getAttribute('aria-expanded'), 'true');

    doc.getElementById('bookingMenuCatalogSearch').value = 'cake';
    ctx.BookingPackageState.catalogFilter = 'cake';
    ctx.BookingPackageState.catalogEditing = { productId: 'cake_custom', field: 'note' };
    ctx.setBookingMenuCatalogCartOpen(true);
    assert.equal(doc.getElementById('bookingMenuCatalogPanel').classList.contains('booking-menu-catalog-cart-open'), true);
    ctx.resetBookingPackageWorkspace();
    assert.equal(ctx.getBookingMenuPositions().length, 0);
    assert.equal(doc.getElementById('bookingMenuPositionsJson').value, '[]');
    assert.equal(doc.getElementById('banquetMenu').value, '');
    assert.equal(doc.getElementById('bookingMenuCatalogSearch').value, '');
    assert.equal(ctx.BookingPackageState.catalogFilter, 'all');
    assert.equal(ctx.BookingPackageState.catalogEditing, null);
    assert.equal(ctx.BookingPackageState.catalogInsight, null);
    assert.equal(doc.getElementById('bookingMenuInsightPanel').hidden, true);
    assert.equal(doc.body.classList.contains('booking-menu-catalog-active'), false);
    assert.equal(doc.getElementById('bookingMenuCatalogPanel').classList.contains('booking-menu-catalog-cart-open'), false);
});

test('booking menu catalog falls back from legacy invalid filter keys to all', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    doc.getElementById('bookingMenuCatalogPanel').hidden = false;

    // Legacy invalid key kept only to verify stale saved UI state falls back safely.
    ctx.BookingPackageState.catalogFilter = 'food';
    ctx.renderBookingMenuCatalog();

    assert.equal(ctx.BookingPackageState.catalogFilter, 'all');
    assert.equal(doc.getElementById('bookingMenuCatalogList').classList.contains('booking-menu-catalog-list--all'), true);
    assert.equal(
        doc.querySelector('#bookingMenuCatalogTabs [data-menu-catalog-filter="all"]')?.getAttribute('aria-pressed'),
        'true'
    );
});

test('booking menu catalog open button opens and renders the catalog panel', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    const panel = doc.getElementById('bookingMenuCatalogPanel');
    const openButton = doc.getElementById('bookingMenuCatalogOpenBtn');
    panel.hidden = true;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');

    ctx.initBookingPackageWorkspace();
    clickElement(ctx.window, openButton);

    assert.equal(panel.hidden, false);
    assert.equal(panel.classList.contains('hidden'), false);
    assert.equal(panel.getAttribute('aria-hidden'), 'false');
    assert.equal(openButton.getAttribute('aria-expanded'), 'true');
    assert.ok(doc.querySelector('#bookingMenuCatalogTabs [data-menu-catalog-filter="all"]'));
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-item/);
});

test('booking menu catalog delegated open control survives a remounted button', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    const panel = doc.getElementById('bookingMenuCatalogPanel');
    const originalButton = doc.getElementById('bookingMenuCatalogOpenBtn');
    const remountedButton = doc.createElement('button');
    remountedButton.type = 'button';
    remountedButton.id = 'bookingMenuCatalogOpenBtn';
    remountedButton.className = 'booking-menu-catalog-open';
    remountedButton.textContent = '+ Додати з меню';

    ctx.initBookingPackageWorkspace();
    originalButton.replaceWith(remountedButton);
    panel.hidden = true;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');

    dispatchPointerElement(ctx.window, remountedButton, 'pointerdown');

    assert.equal(panel.hidden, false);
    assert.equal(panel.classList.contains('hidden'), false);
    assert.equal(panel.getAttribute('aria-hidden'), 'false');
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-item/);
});

test('booking menu catalog mobile list add does not auto-open cart sheet', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    const panel = doc.getElementById('bookingMenuCatalogPanel');
    ctx.__bookingMenuCatalogMobile = true;
    panel.hidden = false;
    doc.getElementById('bookingTime').value = '15:30';

    const bookingJs = read('js', 'booking.js');
    assert.match(bookingJs, /if \(add\) \{\s*upsertBookingMenuCatalogProduct\(add\.dataset\.menuCatalogAdd, 1\);\s*if \(!isBookingMenuCatalogMobileCartLayout\(\) \|\| add\.closest\('#bookingMenuCatalogCart'\)\) \{\s*setBookingMenuCatalogCartOpen\(true\);\s*\}\s*return;\s*\}/);

    ctx.renderBookingMenuCatalog();
    ctx.setBookingMenuCatalogCartOpen(false);

    const addButton = doc.querySelector('#bookingMenuCatalogList [data-menu-catalog-add="menu_pizza"]');
    assert.ok(addButton, 'catalog list add button is rendered');
    ctx.upsertBookingMenuCatalogProduct(addButton.dataset.menuCatalogAdd, 1);

    assert.equal(ctx.getBookingMenuPositions().length, 1);
    assert.equal(ctx.getBookingMenuPositions()[0].productId, 'menu_pizza');
    assert.equal(ctx.getBookingMenuPositions()[0].servingTime, '15:30');
    assert.equal(ctx.getBookingMenuPositions()[0].servingGroupId, 'serve-1530');
    assert.equal(doc.querySelector('#bookingMenuPositionsList [data-menu-serving-time="0"]').value, '15:30');
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-item selected/);
    assert.match(doc.getElementById('bookingMenuCatalogCartSummary').textContent, /1/);
    assert.equal(panel.classList.contains('booking-menu-catalog-cart-open'), false);
    assert.equal(doc.getElementById('bookingMenuCatalogMobileCartBtn').getAttribute('aria-expanded'), 'false');

    ctx.setBookingMenuCatalogCartOpen(true);
    assert.equal(panel.classList.contains('booking-menu-catalog-cart-open'), true);
    assert.equal(doc.getElementById('bookingMenuCatalogMobileCartBtn').getAttribute('aria-expanded'), 'true');
});

test('booking menu catalog add keeps list scroll stable for all and narrow filters', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    const panel = doc.getElementById('bookingMenuCatalogPanel');
    const list = doc.getElementById('bookingMenuCatalogList');
    panel.hidden = false;
    ctx.__bookingMenuCatalogMobile = true;
    ctx.initBookingPackageWorkspace();
    const originalRenderBookingMenuCatalog = ctx.renderBookingMenuCatalog;
    let fullCatalogRenderCount = 0;
    ctx.renderBookingMenuCatalog = (...args) => {
        fullCatalogRenderCount += 1;
        return originalRenderBookingMenuCatalog(...args);
    };

    const cases = [
        {
            filter: 'all',
            productId: 'menu_pizza',
            allClass: true,
            scrollTop: 360
        },
        {
            filter: 'section:cold-drinks',
            productId: 'menu_juice',
            allClass: false,
            scrollTop: 180
        }
    ];

    cases.forEach(({ filter, productId, allClass, scrollTop }) => {
        ctx.BookingPackageState.menuPositions = [];
        ctx.BookingPackageState.catalogFilter = filter;
        ctx.BookingPackageState.catalogEditing = null;
        doc.getElementById('bookingMenuCatalogSearch').value = '';
        ctx.renderBookingMenuCatalog();
        fullCatalogRenderCount = 0;

        assert.equal(
            list.classList.contains('booking-menu-catalog-list--all'),
            allClass,
            `${filter} catalog list all-view class`
        );
        assert.ok(
            doc.querySelector(`#bookingMenuCatalogList [data-menu-catalog-add="${productId}"]`),
            `${filter} add button is rendered`
        );

        list.scrollTop = scrollTop;
        const before = list.scrollTop;
        clickElement(
            ctx.window,
            doc.querySelector(`#bookingMenuCatalogList [data-menu-catalog-add="${productId}"]`)
        );
        const after = list.scrollTop;

        assert.equal(ctx.getBookingMenuPositions().length, 1, `${filter} add commits one menu position`);
        assert.equal(ctx.getBookingMenuPositions()[0].productId, productId, `${filter} add keeps selected product`);
        assert.equal(fullCatalogRenderCount, 0, `${filter} add does not run full catalog rerender`);
        assert.ok(
            Math.abs(after - before) <= 1,
            `${filter} add changed bookingMenuCatalogList.scrollTop from ${before} to ${after}`
        );
    });
});

test('booking menu catalog restores saved quantity, manual price, and note when editing existing booking', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    doc.getElementById('bookingMenuCatalogPanel').hidden = false;
    doc.getElementById('bookingTime').value = '16:30';

    ctx.hydrateBookingPackageWorkspace({
        bookingPackage: {
            menuPositions: [{
                productId: 'menu_juice',
                title: 'Сік яблучний',
                quantity: 2.5,
                unitPrice: 95,
                subtotal: 237.5,
                note: 'подати о 16:30',
                kitchenType: 'menu',
                servingUnit: 'л',
                source: 'product'
            }]
        },
        banquetMenu: ''
    });
    ctx.renderBookingMenuCatalog();

    const restored = ctx.getBookingMenuPositions()[0];
    assert.equal(restored.productId, 'menu_juice');
    assert.equal(restored.quantity, 2.5);
    assert.equal(restored.unitPrice, 95);
    assert.equal(restored.servingTime, null);
    assert.equal(doc.getElementById('bookingMenuBulkServingTime').value, '16:30');
    assert.equal(restored.note, 'подати о 16:30');
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-item selected/);
    assert.match(doc.getElementById('bookingMenuCatalogCartList').textContent, /95/);
    assert.match(doc.getElementById('bookingMenuCatalogList').textContent, /подати о 16:30/);
    assert.match(doc.getElementById('banquetMenu').value, /Сік яблучний - 2,5 л x 95 грн \(подати о 16:30\)/);
});

test('booking menu catalog reloads products when the timeline cache cannot provide kitchen positions', async () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    doc.getElementById('bookingMenuCatalogPanel').hidden = false;
    ctx.timelineDisplayUsesApiProducts = () => true;
    ctx.AppState.products = [{
        id: 'quest_program',
        domain: 'program',
        category: 'quest',
        name: 'Quest',
        price: 1200,
        isActive: true
    }];
    ctx.AppState.productsBusinessContext = 'dar';
    ctx.AppState.productsPriceDate = '2026-06-12';
    let loadCount = 0;
    ctx.getProducts = async () => {
        loadCount += 1;
        ctx.AppState.products = [{
            id: 'menu_fresh',
            domain: 'kitchen',
            category: 'menu',
            kitchenType: 'menu',
            name: 'Fresh menu position',
            price: 100,
            menuSection: 'Food',
            servingUnit: 'portion',
            isActive: true
        }];
        ctx.AppState.productsBusinessContext = 'event_genix';
        ctx.AppState.productsPriceDate = '2026-06-12';
        return ctx.AppState.products;
    };

    ctx.setBookingMenuCatalogOpen(true);
    assert.match(doc.getElementById('bookingMenuCatalogList').textContent, /Завантажую меню/);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(loadCount, 1);
    assert.match(doc.getElementById('bookingMenuCatalogList').textContent, /Fresh menu position/);
    assert.equal(ctx.BookingPackageState.catalogProductsLastLoadKey, 'event_genix|2026-06-12');
});

test('booking package detail accepts top-level menuPositions as a compatibility source', () => {
    const ctx = createBookingMenuCatalogHarness();
    const packageData = ctx.getBookingPackageFromBooking({
        price: 420,
        menuPositions: [{
            productId: 'menu_pizza',
            title: 'РџС–С†Р°',
            quantity: 2,
            unitPrice: 210,
            subtotal: 420,
            kitchenType: 'menu',
            servingUnit: 'С€С‚'
        }]
    });

    assert.ok(packageData, 'compat booking package is projected');
    assert.equal(packageData.menuPositions.length, 1);
    assert.equal(packageData.menuPositions[0].productId, 'menu_pizza');
    assert.equal(packageData.positionsSubtotal, 420);
    assert.equal(packageData.source, 'booking_workspace_compat');
});

test('booking package persists final total into booking price and extraData', () => {
    const booking = applyBookingPackage({
        price: 2200,
        programBasePrice: 2200,
        menuPositions: [
            { productId: 'menu_pizza', title: 'Піца', quantity: 2, unitPrice: 300, servingTime: '15:30' }
        ],
        serviceEvents: [{ type: 'cake', title: 'Винос торта', time: '16:40' }],
        extraData: { tags: ['birthday'] }
    });

    assert.equal(booking.price, 2800);
    assert.equal(booking.extraData.tags[0], 'birthday');
    assert.equal(booking.extraData.bookingPackage.programBasePrice, 2200);
    assert.equal(booking.extraData.bookingPackage.positionsSubtotal, 600);
    assert.equal(booking.extraData.bookingPackage.finalTotal, 2800);
    assert.equal(booking.extraData.bookingPackage.menuPositions[0].productId, 'menu_pizza');
    assert.equal(booking.extraData.bookingPackage.menuPositions[0].servingTime, '15:30');
    assert.equal(booking.extraData.bookingPackage.serviceEvents[0].type, 'cake');
    assert.equal(booking.extraData.bookingPackage.serviceEvents[0].time, '16:40');
    assert.match(booking.banquetMenu, /Піца - 2 x 300 грн/);
});

test('booking package audit records client and commercial package changes', () => {
    const audit = bookingPackageAudit(
        {
            customer_id: 10,
            price: 2200,
            banquet_menu: null,
            extra_data: {
                bookingPackage: {
                    finalTotal: 2200,
                    menuPositions: []
                }
            }
        },
        {
            customerId: 12,
            price: 2800,
            banquetMenu: 'Піца - 2 x 300 грн',
            extraData: {
                bookingPackage: {
                    finalTotal: 2800,
                    menuPositions: [{ title: 'Піца', quantity: 2, unitPrice: 300, subtotal: 600 }]
                }
            }
        }
    );

    assert.equal(audit.customerChanged, true);
    assert.equal(audit.packageChanged, true);
    assert.equal(audit.from.customerId, 10);
    assert.equal(audit.to.customerId, 12);
});

test('product effective pricing resolves current and next rule by booking date', async () => {
    assert.equal(normalizePriceDate('2026-06-10'), '2026-06-10');
    assert.equal(normalizePriceDate('2026-02-31'), null);

    const mapped = mapProductPriceFields({
        price: 1500,
        price_query_date: '2026-06-10',
        price_rule_code: 'anim60_current',
        price_rule_value: 1500,
        price_rule_effective_from: '2026-06-01',
        next_price_rule_code: 'anim60_future',
        next_price_rule_value: 1800,
        next_price_rule_effective_from: '2026-06-11'
    });
    assert.equal(mapped.price, 1500);
    assert.equal(mapped.effectivePriceDate, '2026-06-10');
    assert.equal(mapped.nextPrice, 1800);
    assert.equal(mapped.nextPriceFrom, '2026-06-11');

    const queries = [];
    const booking = {
        date: '2026-06-11',
        programId: 'anim60',
        price: 1500,
        kidsCount: 0,
        extraData: {
            bookingPackage: {
                programBasePrice: 1500,
                positionsSubtotal: 200,
                finalTotal: 1700,
                menuPositions: []
            }
        }
    };
    await applyEffectiveBookingPrice({
        query: async (sql, params) => {
            queries.push({ sql: String(sql), params });
            return {
                rows: [{
                    id: 'anim60',
                    business_context: 'event_genix',
                    price: 1500,
                    is_per_child: false,
                    price_query_date: '2026-06-11',
                    price_rule_code: 'anim60_future',
                    price_rule_value: 1800,
                    price_rule_effective_from: '2026-06-11'
                }]
            };
        }
    }, booking, { businessContext: 'event_genix' });

    assert.match(queries[0].sql, /pr\.effective_from <= \$2::date/);
    assert.equal(queries[0].params[1], '2026-06-11');
    assert.equal(booking.price, 2000);
    assert.equal(booking.extraData.bookingPackage.programBasePrice, 1800);
    assert.equal(booking.extraData.bookingPackage.finalTotal, 2000);
    assert.deepEqual(booking.extraData.priceSnapshot, {
        productId: 'anim60',
        priceCode: 'anim60_future',
        price: 1800,
        finalPrice: 2000,
        priceDate: '2026-06-11',
        source: 'price_rules',
        effectiveFrom: '2026-06-11',
        nextPrice: null,
        nextPriceFrom: null
    });
});

test('booking workspace exposes adaptive event toggle, client, lead, kitchen, summary, and backend persistence', () => {
    const html = read('index.html');
    const bookingJs = read('js', 'booking.js');
    const bookingFormJs = read('js', 'booking-form.js');
    const configJs = read('js', 'config.js');
    const apiJs = read('js', 'api.js');
    const panelCss = read('css', 'panel.css');
    const route = read('routes', 'bookings.js');
    const customerRoute = read('routes', 'customers.js');
    const panelStart = html.indexOf('<aside id="bookingPanel"');
    const panelEnd = html.indexOf('</aside>', panelStart);
    const bookingPanelHtml = panelStart >= 0 && panelEnd > panelStart
        ? html.slice(panelStart, panelEnd + '</aside>'.length)
        : html;

    assert.match(html, /id="bookingHasEventToggle" checked hidden aria-hidden="true"/);
    assert.match(html, /id="bookingKitchenToggle" hidden aria-hidden="true"/);
    assert.match(html, /id="bookingLeadDetailsToggle" hidden aria-hidden="true"/);
    assert.doesNotMatch(bookingPanelHtml, /bookingScenarioBar/);
    assert.doesNotMatch(bookingPanelHtml, /bookingModeSelector/);
    assert.doesNotMatch(bookingPanelHtml, /Що входить у бронювання/);
    assert.match(html, /booking-section-heading/);
    assert.match(html, /id="roomSelect" required aria-required="true"/);
    assert.match(html, /bookingLeadDetailsSection/);
    assert.match(html, /bookingMenuProductSelect/);
    assert.match(html, /bookingMenuCatalogOpenBtn/);
    assert.match(html, /id="bookingMenuCatalogPanel" class="booking-menu-catalog-panel booking-menu-catalog-overlay hidden" hidden aria-hidden="true" role="dialog" aria-modal="true"/);
    assert.doesNotMatch(bookingPanelHtml, /bookingMenuCatalogPanel/);
    assert.match(html, new RegExp(`js/kitchen-menu-images\\.js\\?v=${escapedAssetVersion}`));
    assert.ok(html.indexOf('js/kitchen-menu-images.js') < html.indexOf('js/config.js'), 'kitchen menu image manifest loads before config');
    assert.match(html, /bookingMenuCatalogSearch/);
    assert.match(html, /bookingMenuCatalogTabs/);
    assert.match(html, /bookingMenuCatalogList/);
    assert.match(html, /bookingMenuCatalogCart/);
    assert.match(html, /bookingMenuCatalogCartList/);
    assert.match(html, /bookingMenuInsightPanel/);
    assert.match(html, /Кількість дітей/);
    assert.doesNotMatch(bookingPanelHtml, /<label>Гостей<\/label>/);
    assert.match(html, /bookingMenuInsightTitle/);
    assert.match(html, /bookingMenuInsightBody/);
    assert.match(html, /bookingMenuCatalogMobileCartBtn/);
    assert.match(html, /bookingPackageSummary/);
    assert.match(html, /bookingStickyFooter/);
    assert.match(html, /id="bookingForm" class="booking-form" novalidate/);
    assert.doesNotMatch(html, /bookingCreateCustomerBtn/);
    assert.match(html, /Знайдіть і виберіть існуючу картку клієнта перед збереженням бронювання/);
    assert.match(html, /bookingNewCustomerForm" class="booking-new-customer-form hidden" hidden aria-hidden="true"/);
    assert.match(html, /bookingChangeCustomerBtn/);
    assert.match(html, /programCategoryChips/);
    assert.match(html, /selectedActivitiesList/);
    assert.match(html, /id="bookingPrimaryAnimatorSelect"/);
    assert.match(html, /id="customerDataToggle" checked hidden/);
    assert.ok(html.indexOf('id="roomSelect"') < html.indexOf('id="customerSearch"'));

    assert.match(bookingJs, /const BOOKING_PROGRAM_ONLY_WORKSPACE = true/);
    assert.match(bookingJs, /function bookingKitchenChildrenCountFromBooking/);
    assert.match(bookingJs, /const kitchenChildrenCount = formData\.kitchenEnabled/);
    assert.match(bookingJs, /kidsCount:\s*kidsCount \|\| kitchenChildrenCount \|\| null/);
    assert.match(bookingJs, /obj\.banquetGuests = formData\.kitchenEnabled \? kitchenChildrenCount : null/);
    assert.match(bookingJs, /getBookingWorkspaceHasEvent/);
    assert.match(bookingJs, /if \(isRoomFirstTimelineView\(\)\) return false;/);
    assert.match(bookingJs, /return true;/);
    assert.match(bookingJs, /return isRoomFirstTimelineView\(\) && timelineKitchenEnabled\(\);/);
    assert.match(bookingJs, /function isBookingLeadDetailsEnabled\(\) \{\s*return false;/);
    assert.match(bookingJs, /getSelectedProgramIdFromUi/);
    assert.match(bookingJs, /findBookingProductById/);
    assert.match(bookingJs, /function renderBookingMenuCatalog/);
    assert.match(bookingJs, /function renderBookingMenuCatalogCart/);
    assert.match(bookingJs, /function bookingMenuImageManifestUrl/);
    assert.match(bookingJs, /window\.KITCHEN_MENU_IMAGES/);
    assert.match(bookingJs, /bookingMenuCatalogHandleImageError/);
    assert.match(bookingJs, /function setBookingMenuCatalogCartOpen/);
    assert.match(bookingJs, /function isBookingMenuCatalogMobileCartLayout/);
    assert.match(bookingJs, /preferCart/);
    assert.match(bookingJs, /function upsertBookingMenuCatalogProduct/);
    assert.match(bookingJs, /function setBookingMenuCatalogOpen/);
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_FOOD_SECTION_FILTERS/);
    assert.match(bookingJs, /section:pizza/);
    assert.match(bookingJs, /До піци/);
    assert.match(bookingJs, /Мангал/);
    assert.doesNotMatch(bookingJs, /key:\s*'food'/);
    assert.doesNotMatch(bookingJs, /key:\s*'drink'/);
    assert.match(bookingJs, /data-menu-catalog-quantity-input/);
    assert.match(bookingJs, /data-menu-catalog-price-input/);
    assert.match(bookingJs, /data-menu-catalog-note-input/);
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_INSIGHT_MODES/);
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_ADMIN_REVIEW_ACTIONS_ENABLED = false/);
    assert.match(bookingJs, /data-menu-catalog-insight/);
    assert.match(bookingJs, /function bookingMenuCatalogPromptFor/);
    assert.match(bookingJs, /function renderBookingMenuCatalogInsight/);
    assert.match(bookingJs, /function generateBookingMenuCatalogInsightDraft/);
    assert.match(bookingJs, /function saveBookingMenuCatalogInsightDraft/);
    assert.match(bookingJs, /function approveBookingMenuCatalogInsightPrompt/);
    assert.match(bookingJs, /apiGenerateProductMenuAiDraft/);
    assert.match(bookingJs, /apiSaveProductMenuAiDraft/);
    assert.match(bookingJs, /data-menu-insight-generate/);
    assert.match(bookingJs, /data-menu-insight-save/);
    assert.match(bookingJs, /function commitBookingMenuCatalogInlineInput/);
    assert.match(bookingJs, /function commitActiveBookingMenuCatalogInput/);
    assert.match(bookingJs, /document\.body\?\.classList\.toggle\('booking-menu-catalog-active', nextOpen\)/);
    assert.match(bookingJs, /bookingMenuCatalogMobileCartBtn'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /bookingMenuCatalogCartCloseBtn'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /bookingMenuCatalogPanel'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /cart\.setAttribute\('inert'/);
    assert.match(bookingJs, /window\.addEventListener\('resize'/);
    assert.match(bookingJs, /event\.key !== 'Escape'/);
    assert.match(bookingJs, /Завантажую меню/);
    assert.match(bookingJs, /Меню ще не налаштоване/);
    assert.match(bookingJs, /Очистити пошук/);
    assert.match(bookingJs, /const hasEvent = roomFirst \? false : true;/);
    assert.match(bookingJs, /ROOM_FIRST_BANQUET_SERVICE_LINE_ID = 'banquet-service'/);
    assert.match(bookingJs, /resourceType: 'service'/);
    assert.match(bookingJs, /prefillRoomFirstCustomerFromRoomLine/);
    assert.match(bookingJs, /shouldEditBookingInAnimatorView/);
    assert.match(bookingJs, /openAnimationBookingInAnimatorView/);
    assert.match(bookingJs, /bookingPrimaryAnimatorSelect/);
    assert.match(bookingJs, /booking_workspace_v2/);
    assert.match(bookingJs, /mode: formData\.kitchenEnabled \|\| !formData\.hasEvent \? 'room_first_workspace' : \(BOOKING_PROGRAM_ONLY_WORKSPACE \? 'event_program_only' : 'workspace'\)/);
    assert.match(bookingJs, /scenario: formData\.scenario \|\| getBookingWorkspaceScenario\(formData\)/);
    assert.match(bookingJs, /roomFirst: isRoomFirstTimelineView\(\)/);
    assert.match(bookingJs, /room\.required = true/);
    assert.match(bookingJs, /const room = document\.getElementById\('roomSelect'\)\?\.value \|\| '';/);
    assert.match(bookingJs, /room: formData\.room/);
    assert.match(bookingJs, /function addBookingMenuPositionFromForm/);
    assert.match(bookingJs, /programBasePrice/);
    assert.match(bookingJs, /positionsSubtotal/);
    assert.match(bookingJs, /finalTotal/);
    assert.match(bookingJs, /servingTime/);
    assert.match(bookingJs, /data-menu-serving-time/);
    assert.match(bookingJs, /data-menu-serving-apply-selected/);
    assert.match(bookingJs, /data-menu-serving-copy-all/);
    assert.match(bookingJs, /data-menu-service-event-add/);
    assert.match(bookingJs, /serviceEvents: formData\.serviceEvents \|\| \[\]/);
    assert.match(bookingJs, /Не вказано час видачі/);
    assert.match(bookingJs, /getSmartBookingValidationState/);
    assert.match(bookingJs, /formatBookingValidationList/);
    assert.match(bookingJs, /showBookingValidationErrors/);
    assert.match(bookingJs, /submitBtn\.disabled = false/);
    assert.match(bookingJs, /setAttribute\('aria-disabled', validation\.canSubmit \? 'false' : 'true'\)/);
    assert.match(bookingJs, /collectCreatedBookingRecords/);
    assert.match(bookingJs, /NO_EVENT_TIMELINE_DURATION/);
    assert.doesNotMatch(bookingJs, /function getBookingScenarioContentState/);
    assert.match(bookingJs, /revealCreatedBookingBlocks/);
    assert.match(bookingJs, /refreshCreatedBookingTimelineSnapshot/);
    assert.match(bookingJs, /bookings: changedDateKey !== selectedDateKey/);
    assert.match(bookingJs, /createdBookingVisibilityMessage/);
    assert.match(bookingJs, /booking-block--just-created/);
    assert.match(bookingJs, /Оберіть програму події/);
    assert.match(bookingJs, /Сервер не підтвердив створення бронювання/);
    assert.match(bookingJs, /updateBookingSubmitState/);
    assert.match(bookingJs, /renderProgramCategoryChips/);
    assert.match(bookingJs, /renderSelectedProgramSummary/);
    assert.match(bookingJs, /selectedActivityProgramIds/);
    assert.match(bookingJs, /function bookingMultiActivityEnabled/);
    assert.match(bookingJs, /function setSelectedActivityPrograms/);
    assert.match(bookingJs, /function buildMultiActivityBookings/);
    assert.match(bookingJs, /apiCreateBookingFull\(booking, linked, \{ banquetActivities \}\)/);
    assert.match(bookingJs, /multiActivity/);
    assert.match(bookingJs, /additionalMultiHostActivity/);
    assert.match(bookingJs, /function canAddAnimationFromRoomBooking/);
    assert.match(bookingJs, /String\(booking\.lineId \|\| ''\) === ROOM_FIRST_BANQUET_SERVICE_LINE_ID/);
    assert.match(bookingJs, /!String\(booking\.linkedTo \|\| ''\)\.trim\(\)/);
    assert.doesNotMatch(bookingJs, /function canAddAnimationFromRoomBooking[\s\S]*!booking\.programId[\s\S]*function banquetGroupIdFromSnapshot/);
    assert.match(bookingJs, /bookingActivityNextPriceLabel/);
    assert.match(bookingJs, /bookingCustomerDuplicateHint/);
    assert.match(bookingJs, /rememberSelectedCustomerSnapshot/);
    assert.match(bookingJs, /clearSelectedCustomerLinkIfEdited/);
    assert.match(bookingJs, /customer-search-state/);
    assert.match(bookingJs, /const nextMode = mode === 'new' \? 'search' : mode;/);
    assert.match(bookingJs, /const hasClient = hasSelectedCustomer;/);
    assert.match(bookingJs, /Оберіть існуючого клієнта з пошуку/);
    assert.match(bookingJs, /obj\.customerId = parseInt\(existingId\)/);
    assert.doesNotMatch(bookingJs, /obj\.customer =/);
    assert.doesNotMatch(bookingJs, /bookingCreateCustomerBtn/);
    assert.doesNotMatch(bookingJs, /setBookingClientMode\('new'/);
    assert.match(bookingJs, /role="button" tabindex="0"/);

    assert.ok(bookingFormJs.indexOf('if (!room)') < bookingFormJs.indexOf('if (hasEvent && !programId)'));
    assert.match(bookingFormJs, /setSelectedActivityPrograms\(\[\], \{ renderSummary: false, renderPackage: false, markDirty: false \}\)/);
    assert.match(apiJs, /apiFetchWithAuthRetry/);
    assert.match(apiJs, /async function apiGetBookings\(date, options = \{\}\)/);
    assert.match(apiJs, /options\.banquetActivities/);
    assert.match(apiJs, /payload\.banquetActivities/);
    assert.match(apiJs, /priceDate/);
    assert.match(apiJs, /options\.fresh/);
    assert.match(apiJs, /Array\.isArray\(payload\?\.customers\)/);
    assert.match(customerRoute, /child_birthday/);
    assert.match(customerRoute, /regexp_replace\(COALESCE\(c\.phone/);

    assert.match(route, /applyBookingPackage/);
    assert.match(route, /applyEffectiveBookingPrice/);
    assert.match(route, /refreshMultiActivityPriceTotals/);
    assert.match(route, /await applyEffectiveBookingPrice\(client, b, \{ businessContext \}\)/);
    assert.match(route, /await applyEffectiveBookingPrice\(client, main, \{ businessContext \}\)/);
    assert.match(route, /function requireBookingRoom/);
    assert.match(route, /const roomError = requireBookingRoom\(b\)/);
    assert.match(route, /const mainRoomError = requireBookingRoom\(main\)/);
    assert.match(route, /banquet_guests/);
    assert.match(route, /banquet_adults/);
    assert.match(route, /banquet_tables/);
    assert.match(route, /banquet_menu/);
    assert.match(route, /banquet_guests,\s*banquet_adults,\s*banquet_tables,\s*banquet_menu/);
    assert.match(route, /bookingPackageAudit/);
    assert.match(route, /function attachLinkedBookingTimelineIdentity/);
    assert.match(route, /attachLinkedBookingTimelineIdentity\(lb, businessContext/);
    assert.match(route, /bookingExtraDataSqlValue\(lb\)/);
    assert.match(route, /function insertSecondAnimatorLinkedBooking/);
    assert.match(route, /booking\.duration,\s*0,\s*booking\.hosts/);
    assert.match(route, /bookingExtraDataSqlValue\(linkedBooking\)/);
    assert.doesNotMatch(route, /b\.createdBy,\s*id,\s*newStatus,\s*b\.kidsCount \|\| null,\s*b\.groupName \|\| null,\s*null\]/);
    assert.match(route, /function runOptionalBookingTransactionStep/);
    assert.match(route, /SAVEPOINT booking_optional_step/);
    assert.match(route, /ROLLBACK TO SAVEPOINT booking_optional_step/);
    assert.match(route, /function commitBookingTransaction/);
    assert.match(route, /booking_commit_not_verified/);
    assert.match(route, /function assertDurableCreatedBookings/);
    assert.match(route, /const banquetActivities = Array\.isArray\(req\.body\?\.banquetActivities\)/);
    assert.match(route, /function hasBanquetGroupPayload/);
    assert.match(route, /BANQUET_GROUP_ACTIVITY_REQUIRES_ATOMIC_ENDPOINT/);
    assert.match(route, /\/api\/banquets\/:groupId\/activity-booking/);
    assert.match(route, /const activityRows = \[\]/);
    assert.match(route, /upsertBanquetLink\(client, businessContext, main\.id, activity\.id/);
    assert.match(route, /activityRows\.map\(row => row\.id\)/);
    assert.match(route, /const activityBookings = activityRows\.map/);
    assert.match(route, /activityBookings: responseActivityBookings/);
    assert.match(route, /banquetLinks: mapBookingVisualLinkRowsForResponse\(banquetLinkRows, main\.id\)/);
    assert.match(route, /sharedRoomLinks: mapBookingVisualLinkRowsForResponse\(/);
    assert.match(route, /activity_count: activityRows\.length/);
    assert.match(route, /Finance auto-record \(create\/full activity\)/);
    assert.match(route, /booking_durable_read_missing/);
    assert.match(route, /serverVerified = true/);
    assert.match(route, /runOptionalBookingTransactionStep\(client, 'Finance auto-record'/);
    assert.match(route, /runOptionalBookingTransactionStep\(client, 'Finance auto-record \(create\/full\)'/);
    assert.match(route, /runOptionalBookingTransactionStep\(client, 'Finance auto-record sync \(update\)'/);
    assert.match(route, /commitBookingTransaction\(client, 'booking update'\)/);
    assert.match(bookingJs, /createResult\.serverVerified === false/);
    assert.match(bookingJs, /record\?\.serverVerified !== false/);
    assert.match(configJs, /productsPriceDate/);
    assert.match(configJs, /function getTimelineProductsPriceDate/);
    assert.match(configJs, /apiGetProducts\(true, \{ businessContext, priceDate \}\)/);
    assert.match(panelCss, /\.program-price-badge/);
    assert.match(panelCss, /\.program-price-badge[\s\S]*min-width:\s*46px/);
    assert.match(panelCss, /\.program-price-badge[\s\S]*color:\s*#ECFDF5/);
    assert.match(panelCss, /body\.dark-mode \.program-price-badge[\s\S]*color:\s*#F8FAFC/);
    assert.match(panelCss, /\.program-next-price-badge/);
    assert.match(panelCss, /\.selected-activity-item/);
    assert.match(panelCss, /body\.booking-menu-catalog-active/);
    assert.match(panelCss, /\.booking-menu-catalog-overlay/);
    assert.match(panelCss, /\.booking-menu-catalog-panel\s*\{[\s\S]*position:\s*fixed;/);
    assert.match(panelCss, /\.booking-menu-catalog-panel\s*\{[\s\S]*inset:\s*0;/);
    assert.match(panelCss, /\.booking-menu-catalog-panel\s*\{[\s\S]*z-index:\s*var\(--z-modal,\s*30000\)/);
    assert.match(panelCss, /\.booking-menu-catalog-panel\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;/);
    assert.match(panelCss, /\.booking-menu-catalog-panel > \.booking-menu-catalog-header,\s*\.booking-menu-catalog-panel > \.booking-menu-catalog-body,\s*\.booking-menu-catalog-panel > \.booking-menu-catalog-footer\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*1;/);
    assert.match(panelCss, /\.booking-menu-catalog-body\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(280px,\s*330px\)[\s\S]*overflow:\s*hidden;/);
    assert.match(panelCss, /\.booking-menu-catalog-browser,\s*\.booking-menu-catalog-cart\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*1;/);
    assert.match(panelCss, /\.booking-menu-catalog-browser\s*\{[\s\S]*isolation:\s*isolate;[\s\S]*contain:\s*paint;[\s\S]*transform:\s*translateZ\(0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-search,\s*\.booking-menu-catalog-tabs,\s*\.booking-menu-catalog-list\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*2;[\s\S]*isolation:\s*isolate;[\s\S]*transform:\s*translateZ\(0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(224px,\s*1fr\)\);[\s\S]*justify-content:\s*start;/);
    assert.match(panelCss, /\.booking-menu-catalog-list\s*\{[\s\S]*padding:\s*0 10px calc\(96px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
    assert.match(panelCss, /\.booking-menu-catalog-list\s*\{[\s\S]*scroll-padding-top:\s*48px;/);
    assert.match(panelCss, /\.booking-menu-catalog-list > \*\s*\{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*3;[\s\S]*transform:\s*translateZ\(0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-item\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*min-height:\s*252px;/);
    assert.match(panelCss, /\.booking-menu-catalog-item\s*\{[\s\S]*overflow:\s*hidden;/);
    assert.match(panelCss, /\.booking-menu-catalog-item\s*\{[\s\S]*transform:\s*translate3d\(0,\s*0,\s*0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-item:hover,\s*\.booking-menu-catalog-item:focus-within\s*\{[\s\S]*transform:\s*translate3d\(0,\s*-2px,\s*0\);/);
    assert.match(panelCss, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.booking-menu-catalog-item:hover,[\s\S]*transform:\s*translate3d\(0,\s*0,\s*0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*auto;[\s\S]*aspect-ratio:\s*3\.35 \/ 1;[\s\S]*min-height:\s*0;/);
    assert.match(panelCss, /\.booking-menu-catalog-stepper\s*\{[\s\S]*grid-template-columns:\s*32px minmax\(44px,\s*1fr\) 32px 32px 32px;[\s\S]*flex:\s*0 0 auto;[\s\S]*width:\s*100%;[\s\S]*min-height:\s*32px;[\s\S]*max-width:\s*none;[\s\S]*margin-top:\s*0;/);
    assert.match(panelCss, /@media \(max-height:\s*820px\), \(max-width:\s*1440px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(260px,\s*300px\)[\s\S]*min-height:\s*236px;/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb img/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\.uses-fallback-image img/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\.has-image span/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\.is-image-missing img/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb--cart/);
    assert.match(panelCss, /\.booking-menu-catalog-cart/);
    assert.match(panelCss, /\.booking-menu-catalog-mobile-cart/);
    assert.match(panelCss, /\.booking-menu-catalog-cart-open \.booking-menu-catalog-cart/);
    assert.match(panelCss, /\.booking-menu-catalog-actions/);
    assert.match(panelCss, /\.booking-menu-catalog-action--pairings/);
    assert.match(panelCss, /\.booking-menu-insight-panel/);
    assert.match(panelCss, /\.booking-menu-insight-prompt/);
    assert.match(panelCss, /\.booking-menu-insight-result/);
    assert.match(panelCss, /\.booking-menu-insight-status\.success/);
    assert.match(panelCss, /\.booking-menu-insight-card\.is-nudged/);
    assert.match(bookingJs, /function nudgeBookingMenuCatalogInsightCard/);
    assert.match(panelCss, /\.booking-menu-catalog-group-heading\s*\{[\s\S]*isolation:\s*isolate;[\s\S]*margin:\s*0 -10px 2px;[\s\S]*box-shadow:\s*0 14px 28px/);
    assert.match(panelCss, /\.booking-menu-catalog-list--all \.booking-menu-catalog-group-heading\s*\{[\s\S]*position:\s*static;[\s\S]*top:\s*auto;/);
    assert.match(panelCss, /\.booking-menu-catalog-group-heading::before\s*\{[\s\S]*inset:\s*0 -100vw 0 0;[\s\S]*background:\s*inherit;[\s\S]*box-shadow:\s*inherit;/);
    assert.match(panelCss, /\.booking-menu-catalog-item\.selected/);
    assert.match(panelCss, /\.booking-menu-catalog-inline-input/);
    assert.match(panelCss, /\.booking-menu-catalog-note-editor/);
    assert.match(panelCss, /\.booking-menu-serving-toolbar/);
    assert.match(panelCss, /\.booking-menu-serving-block/);
    assert.match(panelCss, /\.booking-menu-serving-block--bulk/);
    assert.match(panelCss, /\.booking-menu-serving-block--event/);
    assert.match(panelCss, /\.booking-menu-serving-action--primary/);
    assert.match(panelCss, /\.booking-menu-service-event-field/);
    assert.match(panelCss, /\.booking-menu-serving-picker/);
    assert.match(panelCss, /\.booking-menu-service-event/);
    assert.match(panelCss, /\.booking-menu-serving-warning/);
    assert.match(bookingJs, /BOOKING_SERVICE_EVENT_CREATE_TYPES/);
    assert.match(bookingJs, /'food_service', 'drinks', 'room_setup', 'custom'/);
    assert.match(bookingJs, /Час видачі позицій/);
    assert.match(bookingJs, /Базовий час/);
    assert.match(bookingJs, /Видати о/);
    assert.match(bookingJs, /Додати подію/);
    assert.doesNotMatch(bookingJs, /<option value="cake">Винос торта<\/option>/);
    assert.match(panelCss, /@media \(max-width:\s*900px\)/);
    assert.match(panelCss, /\.booking-menu-catalog-panel::after/);
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_FALLBACK_IMAGE = '\/images\/kitchen-menu\/fallback-burger-wide\.jpg'/);
    assert.match(bookingJs, /data-menu-catalog-fallback/);
    assert.equal(
        fs.existsSync(path.join(repoRoot, 'images', 'kitchen-menu', 'fallback-burger-wide.jpg')),
        true,
        'missing kitchen fallback image asset'
    );
});

test('kitchen menu image manifest uses deploy-stable ASCII paths that exist', () => {
    const manifestCode = read('js', 'kitchen-menu-images.js');
    const context = { window: {}, Object };
    vm.createContext(context);
    vm.runInContext(manifestCode, context);
    const manifest = context.window.KITCHEN_MENU_IMAGES;
    assert.equal(manifest.basePath, '/images/kitchen-menu/');
    assert.equal(manifest.byId['menu_2026_021_item'], 'products/menu-998.png');
    assert.equal(manifest.byId['menu_2026_026_item'], 'products/menu-999.png');
    assert.equal(manifest.byId['menu_2026_064_item'], 'products/menu-997.png');
    assert.equal(manifest.byId['menu_2026_073_item'], 'products/menu-999.png');
    assert.equal(manifest.byCode['MENU-026'], 'products/menu-026.jpg');
    assert.equal(manifest.byCode['CAKE-06'], 'products/cake-06.jpg');

    const values = [
        ...Object.values(manifest.byCode || {}),
        ...Object.values(manifest.byId || {})
    ];
    assert.ok(values.length >= 93);
    values.forEach(value => {
        assert.match(value, /^products\/(?:menu|cake)-\d{2,3}\.(?:jpg|jpeg|png|webp|avif)$/);
        assert.equal(/[^\x20-\x7E]/.test(value), false, `non-ASCII manifest path: ${value}`);
        assert.equal(
            fs.existsSync(path.join(repoRoot, 'images', 'kitchen-menu', ...value.split('/'))),
            true,
            `missing kitchen image asset: ${value}`
        );
    });
});
