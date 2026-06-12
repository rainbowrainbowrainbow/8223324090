const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const {
    normalizeMenuPositions,
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
                    <span id="bookingMenuCatalogEntrySummary"></span>
                    <span id="bookingMenuCatalogSummary"></span>
                    <span id="bookingMenuCatalogFooterCount"></span>
                    <span id="bookingMenuCatalogFooterTotal"></span>
                </section>
                <select id="bookingMenuProductSelect"></select>
                <input id="bookingMenuNote">
                <input id="bookingMenuUnitPrice">
                <input id="bookingMenuQuantity" value="1">
                <input id="bookingMenuPositionsJson">
                <textarea id="banquetMenu"></textarea>
                <input id="banquetGuests">
                <input id="banquetTables">
                <button id="bookingMenuAddBtn"></button>
                <select id="selectedProgram"></select>
            </body>
        </html>
    `, { url: 'http://localhost/' });
    const bookingJs = read('js', 'booking.js');
    const start = bookingJs.indexOf('function bookingKitchenType(');
    const end = bookingJs.indexOf('function renderBookingPackageDetail(');
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
            selectedDate: '2026-06-12'
        },
        BookingForm: { _dirty: false },
        timelineKitchenEnabled: () => true,
        timelineDisplayUsesApiProducts: () => false,
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
        updateBookingContextHeaderSummaryCalls: 0
    };
    context.window.BookingForm = context.BookingForm;

    vm.createContext(context);
    vm.runInContext(bookingJs.slice(start, end), context, { filename: 'js/booking.js' });
    return context;
}

test('booking package normalizes menu positions with price and subtotal', () => {
    const positions = normalizeMenuPositions([
        { productId: 'menu_pizza', title: 'Піца', quantity: 3, unitPrice: 250 },
        { product_id: 'menu_juice', label: 'Сік', qty: 2, price: 80, note: 'яблуко' },
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
    assert.equal(menuPositionsSubtotal(positions), 1210);
    assert.match(buildLegacyBanquetMenu(positions), /Піца - 3 x 250 грн/);
    assert.match(buildLegacyBanquetMenu(positions), /Сік - 2 x 80 грн \(яблуко\)/);
    assert.match(buildLegacyBanquetMenu(positions), /Cake - 2,5 x 120 .* \(no nuts\)/);
});

test('booking menu catalog inline edits keep menuPositions, legacy text, and reset state in sync', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    doc.getElementById('bookingMenuCatalogPanel').hidden = false;

    ctx.renderBookingMenuCatalog();
    assert.match(doc.getElementById('bookingMenuCatalogTabs').textContent, /Усе/);
    assert.match(doc.getElementById('bookingMenuCatalogTabs').textContent, /Популярне/);
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-group-heading/);

    ctx.upsertBookingMenuCatalogProduct('cake_custom', 1);
    assert.equal(ctx.getBookingMenuPositions().length, 1);
    assert.equal(ctx.getBookingMenuPositions()[0].quantity, 1);
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-item selected/);
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

    doc.getElementById('bookingMenuCatalogSearch').value = 'cake';
    ctx.BookingPackageState.catalogFilter = 'cake';
    ctx.BookingPackageState.catalogEditing = { productId: 'cake_custom', field: 'note' };
    ctx.resetBookingPackageWorkspace();
    assert.equal(ctx.getBookingMenuPositions().length, 0);
    assert.equal(doc.getElementById('bookingMenuPositionsJson').value, '[]');
    assert.equal(doc.getElementById('banquetMenu').value, '');
    assert.equal(doc.getElementById('bookingMenuCatalogSearch').value, '');
    assert.equal(ctx.BookingPackageState.catalogFilter, 'all');
    assert.equal(ctx.BookingPackageState.catalogEditing, null);
});

test('booking menu catalog restores saved quantity, manual price, and note when editing existing booking', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    doc.getElementById('bookingMenuCatalogPanel').hidden = false;

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
    assert.equal(restored.note, 'подати о 16:30');
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /booking-menu-catalog-item selected/);
    assert.match(doc.getElementById('bookingMenuCatalogList').textContent, /подати о 16:30/);
    assert.match(doc.getElementById('banquetMenu').value, /Сік яблучний - 2,5 л x 95 грн \(подати о 16:30\)/);
});

test('booking package persists final total into booking price and extraData', () => {
    const booking = applyBookingPackage({
        price: 2200,
        programBasePrice: 2200,
        menuPositions: [
            { productId: 'menu_pizza', title: 'Піца', quantity: 2, unitPrice: 300 }
        ],
        extraData: { tags: ['birthday'] }
    });

    assert.equal(booking.price, 2800);
    assert.equal(booking.extraData.tags[0], 'birthday');
    assert.equal(booking.extraData.bookingPackage.programBasePrice, 2200);
    assert.equal(booking.extraData.bookingPackage.positionsSubtotal, 600);
    assert.equal(booking.extraData.bookingPackage.finalTotal, 2800);
    assert.equal(booking.extraData.bookingPackage.menuPositions[0].productId, 'menu_pizza');
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
    assert.match(html, /bookingMenuCatalogPanel/);
    assert.match(html, /bookingMenuCatalogSearch/);
    assert.match(html, /bookingMenuCatalogTabs/);
    assert.match(html, /bookingMenuCatalogList/);
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
    assert.match(bookingJs, /getBookingWorkspaceHasEvent/);
    assert.match(bookingJs, /if \(isRoomFirstTimelineView\(\)\) return false;/);
    assert.match(bookingJs, /return true;/);
    assert.match(bookingJs, /return isRoomFirstTimelineView\(\) && timelineKitchenEnabled\(\);/);
    assert.match(bookingJs, /function isBookingLeadDetailsEnabled\(\) \{\s*return false;/);
    assert.match(bookingJs, /getSelectedProgramIdFromUi/);
    assert.match(bookingJs, /findBookingProductById/);
    assert.match(bookingJs, /function renderBookingMenuCatalog/);
    assert.match(bookingJs, /function upsertBookingMenuCatalogProduct/);
    assert.match(bookingJs, /function setBookingMenuCatalogOpen/);
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_FILTERS/);
    assert.match(bookingJs, /data-menu-catalog-quantity-input/);
    assert.match(bookingJs, /data-menu-catalog-price-input/);
    assert.match(bookingJs, /data-menu-catalog-note-input/);
    assert.match(bookingJs, /function commitBookingMenuCatalogInlineInput/);
    assert.match(bookingJs, /function commitActiveBookingMenuCatalogInput/);
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
    assert.match(route, /banquet_tables/);
    assert.match(route, /banquet_menu/);
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
    assert.match(panelCss, /\.booking-menu-catalog-group-heading/);
    assert.match(panelCss, /\.booking-menu-catalog-item\.selected/);
    assert.match(panelCss, /\.booking-menu-catalog-inline-input/);
    assert.match(panelCss, /\.booking-menu-catalog-note-editor/);
    assert.match(panelCss, /@media \(max-width:\s*640px\)/);
});
