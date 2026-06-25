const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const {
    BOOKING_PACKAGE_SCHEMA_VERSION,
    BANQUET_ENTRY_PRICE_RULE_CODES,
    BANQUET_ENTRY_SOURCE,
    normalizeMenuPositions,
    normalizeServiceEvents,
    menuPositionsSubtotal,
    banquetEntryDateType,
    buildBanquetEntryCharge,
    applyBookingPackageEntryCharge,
    normalizeMenuServingUnitDisplay,
    formatMenuQuantityWithServingUnit,
    formatMenuPositionQuantity,
    buildLegacyBanquetMenu,
    applyBookingPackage,
    bookingPackageAudit
} = require('../services/bookingPackage');
const {
    normalizePriceDate,
    mapProductPriceFields,
    applyEffectiveBookingPrice
} = require('../services/productPricing');
const {
    normalizeBanquetSummaryMode,
    banquetSummaryPdfFilename,
    buildBanquetSummaryPdfView,
    buildBanquetSummaryPdfBuffer,
    validateBanquetSummaryPdf,
    resolvePdfFonts
} = require('../services/banquetSummaryPdf');
const {
    banquetSummaryModeContract
} = require('../services/banquetSummary');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const loadJsonFixture = (...parts) => JSON.parse(read(...parts));
function readPngInfo(...parts) {
    const buffer = fs.readFileSync(path.join(repoRoot, ...parts));
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(buffer.toString('ascii', 12, 16), 'IHDR');
    return {
        bytes: buffer.length,
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
        bitDepth: buffer[24],
        colorType: buffer[25]
    };
}
function countPdfPages(buffer) {
    return (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}
function buildBanquetSummaryPrintEdgeFixture() {
    const base = loadJsonFixture('tests', 'fixtures', 'banquet-summary-official.fixture.json');
    const longSentence = 'Long edge-case text with wrapping pressure for A4 print, table cells, page breaks, and PDF export verification.';
    const menuRows = Array.from({ length: 26 }, (_, index) => {
        const item = index + 1;
        return {
            id: `menu:edge:${item}`,
            type: 'menu',
            source: 'product',
            bookingId: null,
            title: `Edge Menu Position ${String(item).padStart(2, '0')} - family style platter with a long service title`,
            quantity: (item % 5) + 1,
            unitPrice: 185 + item * 7,
            subtotal: ((item % 5) + 1) * (185 + item * 7),
            comment: `${longSentence} Kitchen note ${item}: keep sauces separate, mark allergens, and confirm warm serving sequence with host before release.`,
            meta: {
                productId: `menu_edge_${item}`,
                code: `EDGE-MENU-${String(item).padStart(2, '0')}`,
                menuSection: item % 3 === 0 ? 'Dessert' : 'Main',
                servingUnit: 'portion',
                servingTime: `${15 + Math.floor(item / 6)}:${String((item * 7) % 60).padStart(2, '0')}`,
                servingNote: `Long serving note ${item}: ${longSentence}`,
                kitchenType: item % 3 === 0 ? 'cake' : 'menu'
            }
        };
    });
    const orderRows = [
        {
            id: 'program:edge',
            type: 'program',
            source: 'main_booking',
            bookingId: 'BK-PRINT-EDGE-QA',
            title: 'Premium Celebration Program with an intentionally long public title',
            durationMinutes: 120,
            quantity: null,
            unitPrice: 3600,
            subtotal: 3600,
            comment: `${longSentence} Main program comment should wrap without pushing neighboring cells outside the A4 page.`,
            meta: { time: '14:00', duration: 120, room: 'Grand Crystal Hall With Long Name' }
        },
        {
            id: 'activity:edge',
            type: 'activity',
            source: 'banquet_group',
            bookingId: 'BK-PRINT-EDGE-QA-A1',
            title: 'Science Show and Bubble Finale with long operational note',
            durationMinutes: 45,
            quantity: null,
            unitPrice: 2800,
            subtotal: 2800,
            comment: `${longSentence} Activity comment should remain readable across PDF and browser print.`,
            meta: { time: '16:20', duration: 45, room: 'Grand Crystal Hall With Long Name' }
        },
        {
            id: 'entry:edge',
            type: 'entry',
            source: 'banquet_entry_price_rules',
            bookingId: null,
            title: 'Children entry with long tariff explanation',
            quantity: 34,
            unitPrice: 300,
            subtotal: 10200,
            comment: 'Entry row keeps quantity and amount visible.',
            meta: { ruleCode: 'banquet_entry_weekend_child', dateType: 'weekend' }
        },
        ...menuRows
    ];
    const orderTotal = orderRows.reduce((sum, row) => sum + Number(row.subtotal || 0), 0);
    const serviceEvents = Array.from({ length: 5 }, (_, index) => ({
        id: `service:edge:${index + 1}`,
        type: 'service_event',
        title: `Service checkpoint ${index + 1} with long coordination title`,
        comment: `${longSentence} Service team checkpoint ${index + 1}.`,
        meta: { time: `${17 + index}:10`, servingTime: `${17 + index}:10` }
    }));
    const schedule = [
        {
            id: 'schedule:arrival',
            type: 'arrival',
            source: 'event',
            time: '14:00',
            title: 'Guest arrival with very long room and host coordination note',
            note: `${longSentence} Confirm signage, stroller parking, and table layout before guests enter.`,
            modes: ['client', 'staff'],
            noteModes: ['client', 'staff'],
            sortOrder: 0
        },
        ...orderRows.filter(row => row.type !== 'entry').map((row, index) => ({
            id: `schedule:order:${index + 1}`,
            type: row.type,
            source: row.source,
            time: row.meta?.servingTime || row.meta?.time || '15:00',
            title: `Schedule ${index + 1}: ${row.title}`,
            note: `${longSentence} Schedule note ${index + 1}.`,
            modes: row.type === 'menu' ? ['client', 'kitchen', 'staff'] : ['client', 'staff'],
            noteModes: row.type === 'menu' ? ['kitchen', 'staff'] : ['staff'],
            sortOrder: 10 + index
        })),
        ...serviceEvents.map((row, index) => ({
            id: `schedule:service:${index + 1}`,
            type: 'service_event',
            source: 'service_event',
            time: row.meta.time,
            title: row.title,
            note: row.comment,
            modes: ['client', 'kitchen', 'staff'],
            noteModes: ['kitchen', 'staff'],
            sortOrder: 100 + index
        }))
    ];

    return {
        ...base,
        bookingId: 'BK-PRINT-EDGE-QA',
        mode: 'client',
        group: { ...base.group, id: 'BQ-PRINT-EDGE-QA', primaryBookingId: 'BK-PRINT-EDGE-QA', groupName: 'Print Edge QA Banquet' },
        document: { ...base.document, title: 'BANQUET SHEET PRINT EDGE CASE', generatedBy: 'qa-print-manager' },
        venue: {
            name: 'Event Genix Official Venue With Extended Legal Banquet Location Name',
            addressLine1: 'Kyiv, Very Long Address Line For Print Edge Case Validation, Building 10, Entrance B, Floor 3',
            addressLine2: 'Grand Crystal Hall, service entrance near reception, extra long address continuation for wrapping',
            phone: '0 800 753 553'
        },
        event: {
            ...base.event,
            date: '2026-08-30',
            time: '14:00',
            room: 'Grand Crystal Hall With Long Name',
            programName: 'Premium Celebration Program with an intentionally long public title',
            programDisplayName: 'Premium Celebration Program with an intentionally long public title',
            groupName: 'Print Edge QA Banquet',
            manager: 'qa-print-manager'
        },
        customer: {
            ...base.customer,
            name: 'Oleksandra-Kateryna Verylongsurname-Hyphenated Family Representative For Print Wrapping QA',
            phone: '+380001112244',
            notes: `${longSentence} Customer note should not clip in brief or PDF export.`
        },
        celebrant: {
            name: 'Maxymilian-Oleksandr Very Long Celebrant Name',
            birthday: '2018-08-30'
        },
        counts: { children: 34, adults: 18, guests: 52, tables: 7 },
        orderRows,
        serviceEvents,
        schedule,
        responsible: {
            rows: [
                { role: 'manager', label: 'Manager', name: 'qa-print-manager with extended display name', modes: ['client', 'kitchen', 'staff'], showWhenEmpty: true },
                { role: 'animator', label: 'Lead animator', name: 'qa-animator-long-name', modes: ['staff'], showWhenEmpty: true },
                { role: 'kitchen', label: 'Kitchen coordinator', name: 'qa-kitchen-long-name', modes: ['kitchen', 'staff'], showWhenEmpty: true },
                { role: 'waiter', label: 'Service coordinator', name: 'qa-service-long-name', modes: ['staff'], showWhenEmpty: true }
            ],
            source: 'print_edge_fixture',
            hasKnownPeople: true
        },
        comments: [
            { type: 'kitchen', label: 'Kitchen note', text: `${longSentence} Repeat across many menu rows and keep readable for kitchen PDF.` },
            { type: 'activity', label: 'Activity note', text: `${longSentence} Staff should see activity setup details without overlap.` },
            { type: 'internal', label: 'Internal note', text: `${longSentence} Internal note validates staff-only wrapping and page break behavior.` }
        ],
        totals: {
            programBasePrice: 3600,
            menuSubtotal: menuRows.reduce((sum, row) => sum + row.subtotal, 0),
            entrySubtotal: 10200,
            activitySubtotal: 2800,
            orderTotal,
            bookingPrice: 3600,
            currency: 'UAH'
        },
        deposit: { ...base.deposit, amount: 5000, paymentMethod: 'card', status: 'accountant_verified' },
        finance: {
            currency: 'UAH',
            amountDue: orderTotal - 5000,
            rows: [
                { key: 'total', label: 'Total', amount: orderTotal, currency: 'UAH', role: 'total' },
                { key: 'deposit', label: 'Deposit', amount: 5000, currency: 'UAH', role: 'line' }
            ]
        },
        terms: {
            title: 'Banquet Terms With Long Wrapping Text',
            items: Array.from({ length: 10 }, (_, index) => `Long term ${index + 1}: ${longSentence} This term is intentionally verbose to verify A4 page breaks, no clipped lines, and stable terms placement.`),
            source: 'print_edge_fixture',
            snapshotSource: null,
            missingCodes: []
        },
        warnings: [
            { code: 'print_edge_warning', message: `${longSentence} Staff mode warning should wrap safely.` }
        ]
    };
}
const readBookingSurface = () => [
    read('js', 'booking-drawer-state.js'),
    read('js', 'booking-banquet-selector.js'),
    read('js', 'booking-save-path.js'),
    read('js', 'booking.js')
].join('\n');
const packageJson = JSON.parse(read('package.json'));
const escapedAssetVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function renderBookingSummaryFixture(summary, { mode = summary?.mode || 'client' } = {}) {
    const businessContext = summary?.businessContext || 'event_genix';
    const groupId = summary?.group?.id || '';
    const params = new URLSearchParams({
        id: summary.bookingId,
        businessContext,
        mode
    });
    if (groupId) params.set('groupId', groupId);

    const dom = new JSDOM(read('booking-summary.html'), {
        url: `https://fixture.local/booking-summary.html?${params.toString()}`,
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const fetchCalls = [];

    window.localStorage.setItem('pzp_token', 'fixture-token');
    window.fetch = async input => {
        const url = String(input?.url || input || '');
        fetchCalls.push(url);
        return {
            ok: true,
            status: 200,
            json: async () => ({ ...summary, mode })
        };
    };
    window.URL.createObjectURL = () => 'blob:fixture';
    window.URL.revokeObjectURL = () => {};
    window.print = () => {};
    window.eval(read('js', 'booking-summary-page.js'));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

    const documentNode = window.document;
    for (let i = 0; i < 20; i += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 0));
        if (documentNode.getElementById('bookingSummaryDocument')?.hidden === false) break;
    }

    return { window, document: documentNode, fetchCalls };
}

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
                    servingUnit: '100г',
                    sortOrder: 3,
                    isActive: true
                }
            ],
            selectedDate: '2026-06-12',
            productsBusinessContext: 'event_genix',
            productsPriceDate: '2026-06-12',
            productsLoadedAt: Date.now(),
            priceRules: []
        },
        BOOKING_ENTRY_PRICE_RULE_CODES: Object.freeze({
            weekday: 'banquet_entry_weekday_child',
            weekend: 'banquet_entry_weekend_child'
        }),
        BOOKING_ENTRY_PRICE_RULE_SOURCE: 'banquet_entry_price_rules',
        BookingDrawerState: {
            entryPriceRules: [],
            entryPriceRulesLoaded: false,
            entryPriceRulesLoading: false,
            entryPriceRulesPromise: null,
            entryPriceRulesError: null
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
        apiGetCenterPriceRule: async () => ({ success: false, error: 'not configured' }),
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

function createBanquetModalDetailHarness() {
    const bookingJs = read('js', 'booking.js');
    const quantityHelperStart = bookingJs.indexOf('const BOOKING_MENU_PORTION_UNITS');
    const quantityHelperEnd = bookingJs.indexOf('function isBookingMenuCatalogProduct');
    const packageStart = bookingJs.indexOf('function bookingServingTimeLabel(');
    const packageEnd = bookingJs.indexOf('function renderBookingWorkspaceDetail(');
    const banquetStart = bookingJs.indexOf('function bookingDetailId(');
    const banquetEnd = bookingJs.indexOf('function renderEducationLessonDetail(');
    assert.ok(quantityHelperStart >= 0 && quantityHelperEnd > quantityHelperStart, 'booking menu quantity helper slice exists');
    assert.ok(packageStart >= 0 && packageEnd > packageStart, 'booking package detail render slice exists');
    assert.ok(banquetStart >= 0 && banquetEnd > banquetStart, 'banquet modal detail render slice exists');

    const context = {
        console,
        window: {
            TimelineBusinessContext: {
                current: () => ({ apiValue: 'event_genix' })
            }
        },
        BOOKING_SERVICE_EVENT_TYPES: {
            cake: 'Винос торта',
            custom: 'Інше',
            food_service: 'Видача страв',
            drinks: 'Напої',
            room_setup: 'Підготувати кімнату'
        },
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;'),
        formatPrice: value => `${Number(value || 0).toLocaleString('uk-UA')} ₴`,
        getBookingPackageFromBooking: booking => booking?.bookingPackage
            || booking?.booking_package
            || booking?.extraData?.bookingPackage
            || booking?.extra_data?.bookingPackage
            || null,
        bookingMenuMissingServingTimeCount: positions => (positions || []).filter(item => !item?.servingTime).length,
        bookingKitchenTypeLabel: type => (type === 'cake' ? 'ТОРТ' : 'МЕНЮ'),
        isViewer: () => true
    };
    vm.createContext(context);
    vm.runInContext(`${bookingJs.slice(quantityHelperStart, quantityHelperEnd)}\n${bookingJs.slice(packageStart, packageEnd)}\n${bookingJs.slice(banquetStart, banquetEnd)}`, context, { filename: 'js/booking.js' });
    return context;
}

function addMinutesForBookingDetailHeaderTest(time, duration) {
    const [rawHours, rawMinutes] = String(time || '00:00').split(':');
    const hours = Number(rawHours);
    const minutes = Number(rawMinutes);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
    const totalMinutes = hours * 60 + minutes + (Number(duration) || 0);
    const dayMinutes = ((totalMinutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(dayMinutes / 60)).padStart(2, '0')}:${String(dayMinutes % 60).padStart(2, '0')}`;
}

function renderBookingDetailHeaderForTest(context, booking, banquetSnapshot = null, bookings = []) {
    const fullBanquetDetailHtml = context.renderFullBanquetDetail(booking, bookings, banquetSnapshot);
    const headerPackageBooking = context.bookingDetailHeaderPackageBooking(booking, banquetSnapshot);
    const headerScheduleHtml = context.bookingDetailHeaderScheduleSummary(headerPackageBooking);
    const useBanquetHeaderSchedule = Boolean(headerScheduleHtml.trim())
        && context.bookingDetailHeaderIsBanquetScheduleMode(booking, banquetSnapshot, fullBanquetDetailHtml);
    const isBanquetArrivalMode = context.bookingDetailIsBanquetArrivalMode(booking, banquetSnapshot, fullBanquetDetailHtml);
    const endTime = addMinutesForBookingDetailHeaderTest(booking.time, booking.duration);
    const bookingDetailTimeRange = `${booking.time} - ${endTime}`;
    const headerTimeMetaHtml = useBanquetHeaderSchedule || isBanquetArrivalMode
        ? ''
        : `<span class="booking-detail-meta-item">${context.escapeHtml(bookingDetailTimeRange)}</span>`;

    return `
        <div class="booking-detail-header booking-detail-header--compact">
            <div class="booking-detail-heading">
                <div class="booking-detail-title-group">
                    <h3 class="booking-detail-title">${context.escapeHtml(booking.label || 'Бронювання')}</h3>
                    <div class="booking-detail-meta" aria-label="Деталі бронювання">
                        <span class="booking-detail-meta-item">${context.escapeHtml(booking.room || '-')}</span>
                        <span class="booking-detail-meta-item">${context.escapeHtml(booking.date || '-')}</span>
                        ${headerTimeMetaHtml}
                        <span class="booking-detail-meta-item">#${context.escapeHtml(booking.id || '----')}</span>
                    </div>
                    ${useBanquetHeaderSchedule ? headerScheduleHtml : ''}
                </div>
            </div>
        </div>
    `;
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
    assert.match(buildLegacyBanquetMenu(positions), /Піца - 3 порції × 250 грн/);
    assert.match(buildLegacyBanquetMenu(positions), /Сік - 2 порції × 80 грн \(яблуко\)/);
    assert.match(buildLegacyBanquetMenu(positions), /Cake - 2,5 порції × 120 .* \(no nuts\)/);
});

test('booking package quantity display separates portion count from packed serving unit', () => {
    const cake = { productId: 'cake_custom', title: 'Нутелла', quantity: 5, servingUnit: '100г', unitPrice: 90, subtotal: 450 };
    const normalized = normalizeMenuPositions([cake])[0];

    assert.equal(normalizeMenuServingUnitDisplay('100г'), '100 г');
    assert.equal(normalizeMenuServingUnitDisplay('0.5кг'), '0.5 кг');
    assert.equal(formatMenuPositionQuantity(cake), '5 порцій по 100 г');
    assert.equal(formatMenuQuantityWithServingUnit(5, '100 г'), '5 порцій по 100 г');
    assert.equal(formatMenuQuantityWithServingUnit(5, '0.5кг'), '5 порцій по 0.5 кг');
    assert.equal(formatMenuQuantityWithServingUnit(3, 'порція'), '3 порції');
    assert.equal(formatMenuQuantityWithServingUnit(1, ''), '1 порція');
    assert.equal(formatMenuQuantityWithServingUnit(2.5, ''), '2,5 порції');
    assert.equal(formatMenuQuantityWithServingUnit(5, 'шт'), '5 шт');
    assert.equal(normalized.quantity, 5);
    assert.equal(normalized.servingUnit, '100г');
    assert.equal(normalized.unitPrice, 90);
    assert.equal(normalized.subtotal, 450);
    assert.doesNotMatch(formatMenuPositionQuantity(cake), /5 100г|5 100 г/);
    assert.match(buildLegacyBanquetMenu([cake]), /Нутелла - 5 порцій по 100 г × 90 грн/);
    assert.doesNotMatch(buildLegacyBanquetMenu([cake]), /5 100г|5 100 г|5 100г x 90/);
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

test('booking frontend quantity display helper matches menu package wording contract', () => {
    const ctx = createBookingMenuCatalogHarness();
    const cake = { quantity: 5, servingUnit: '100г', unitPrice: 90, subtotal: 450 };

    assert.equal(ctx.normalizeBookingMenuServingUnitDisplay('100г'), '100 г');
    assert.equal(ctx.normalizeBookingMenuServingUnitDisplay('0.5кг'), '0.5 кг');
    assert.equal(ctx.formatBookingMenuPositionQuantity(cake), '5 порцій по 100 г');
    assert.equal(ctx.formatBookingMenuQuantityWithServingUnit(5, '100 г'), '5 порцій по 100 г');
    assert.equal(ctx.formatBookingMenuQuantityWithServingUnit(3, 'порція'), '3 порції');
    assert.equal(ctx.formatBookingMenuQuantityWithServingUnit(1, ''), '1 порція');
    assert.equal(ctx.formatBookingMenuQuantityWithServingUnit(2.5, ''), '2,5 порції');
    assert.equal(ctx.formatBookingMenuQuantityWithServingUnit(5, 'шт'), '5 шт');
    assert.doesNotMatch(ctx.formatBookingMenuPositionQuantity(cake), /5 100г|5 100 г/);
});

test('booking form menu position rows use clear quantity wording', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;

    ctx.setBookingMenuPositions([{
        title: 'Нутелла',
        quantity: 5,
        servingUnit: '100г',
        unitPrice: 90,
        subtotal: 450,
        kitchenType: 'cake',
        note: 'без горіхів'
    }]);
    const cakeText = doc.getElementById('bookingMenuPositionsList').textContent;
    assert.match(cakeText, /5 порцій по 100 г × 90 грн = 450 грн/);
    assert.match(doc.getElementById('banquetMenu').value, /Нутелла - 5 порцій по 100 г × 90 грн \(без горіхів\)/);
    assert.doesNotMatch(cakeText, /5 100г|5 100 г|5 100г x 90/);

    ctx.setBookingMenuPositions([{
        title: 'Бургер дитячий',
        quantity: 3,
        servingUnit: 'порція',
        unitPrice: 260,
        subtotal: 780,
        kitchenType: 'menu'
    }]);
    const menuText = doc.getElementById('bookingMenuPositionsList').textContent;
    assert.match(menuText, /3 порції × 260 грн = 780 грн/);
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
    assert.match(doc.getElementById('bookingMenuCatalogList').textContent, /120 грн\s*\/\s*100 г/);
    assert.match(doc.getElementById('bookingMenuCatalogCartList').textContent, /1 порція по 100 г/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogList').textContent, /100г/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogCartList').textContent, /100г|1 100 г/);
    assert.match(doc.getElementById('bookingMenuCatalogCartSummary').textContent, /1/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogSummary').textContent, /120|140|РіСЂРЅ|грн|₴/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogCartSummary').textContent, /120|140|РіСЂРЅ|грн|₴/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogMobileCartBtn').textContent, /120|140|РіСЂРЅ|грн|₴/);
    assert.match(doc.getElementById('bookingMenuCatalogEntrySummary').textContent, /120|140|РіСЂРЅ|грн|₴/);
    assert.match(doc.getElementById('bookingMenuCatalogFooterTotal').textContent, /120|140|РіСЂРЅ|грн|₴/);
    assert.match(doc.getElementById('bookingMenuPositionsJson').value, /cake_custom/);

    ctx.setBookingMenuCatalogEditing('cake_custom', 'quantity');
    const quantityInput = doc.querySelector('[data-menu-catalog-quantity-input="cake_custom"]');
    assert.ok(quantityInput, 'quantity inline input rendered');
    quantityInput.value = '2.5';
    ctx.commitBookingMenuCatalogInlineInput(quantityInput);
    assert.equal(ctx.getBookingMenuPositions()[0].quantity, 2.5);
    assert.equal(ctx.getBookingMenuPositions()[0].subtotal, 300);
    assert.match(doc.getElementById('bookingMenuCatalogCartList').textContent, /2,5 порції по 100 г/);

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
    assert.match(doc.getElementById('banquetMenu').value, /Cake - 2,5 порції по 100 г × 140 грн \(без горіхів\)/);
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
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogCartSummary').textContent, /250|РіСЂРЅ|грн|₴/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogMobileCartBtn').textContent, /250|РіСЂРЅ|грн|₴/);
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
    assert.match(doc.getElementById('banquetMenu').value, /Сік яблучний - 2,5 л × 95 грн \(подати о 16:30\)/);
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

test('booking entry preview loads center price rules before save', async () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    doc.getElementById('banquetGuests').value = '12';

    assert.equal(ctx.getBookingEntryChargeEstimate().entrySubtotal, 0);

    const requestedCodes = [];
    ctx.apiGetCenterPriceRule = async code => {
        requestedCodes.push(code);
        return {
            success: true,
            price: {
                code,
                value: code === 'banquet_entry_weekend_child' ? 400 : 300,
                unit: 'грн/дитина',
                category: 'banquet'
            }
        };
    };

    const loaded = await ctx.preloadBookingEntryPriceRules({ force: true, render: false });
    const estimate = ctx.getBookingEntryChargeEstimate();

    assert.equal(loaded, true);
    assert.deepEqual(requestedCodes, ['banquet_entry_weekday_child', 'banquet_entry_weekend_child']);
    assert.equal(ctx.BookingDrawerState.entryPriceRulesLoaded, true);
    assert.equal(estimate.entryCharge.ruleCode, 'banquet_entry_weekday_child');
    assert.equal(estimate.entryCharge.unitPrice, 300);
    assert.equal(estimate.entrySubtotal, 3600);
});

test('booking entry preview fetch failure does not block booking package fallback', async () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    doc.getElementById('banquetGuests').value = '12';
    ctx.apiGetCenterPriceRule = async code => ({
        success: false,
        code: 'preview_fetch_failed',
        error: `missing ${code}`
    });

    const loaded = await ctx.preloadBookingEntryPriceRules({ force: true, render: false });
    const estimate = ctx.getBookingEntryChargeEstimate();
    const totals = ctx.getBookingPackageTotals(null);

    assert.equal(loaded, false);
    assert.equal(ctx.BookingDrawerState.entryPriceRulesLoaded, false);
    assert.match(ctx.BookingDrawerState.entryPriceRulesError, /missing banquet_entry_weekday_child/);
    assert.equal(estimate.entryCharge, null);
    assert.equal(estimate.entrySubtotal, 0);
    assert.equal(totals.finalTotal, 0);
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
    assert.match(booking.banquetMenu, /Піца - 2 порції × 300 грн/);
});

test('booking package calculates banquet entry from center price rules by weekday and weekend', async () => {
    assert.equal(banquetEntryDateType('2026-06-23'), 'weekday');
    assert.equal(banquetEntryDateType('2026-06-27'), 'weekend');

    const priceRules = [
        { code: BANQUET_ENTRY_PRICE_RULE_CODES.weekday, value: 300 },
        { code: BANQUET_ENTRY_PRICE_RULE_CODES.weekend, value: 400 }
    ];
    const queries = [];
    const weekdayBooking = await applyBookingPackageEntryCharge({
        async query(sql, params) {
            queries.push({ sql: String(sql), params });
            return { rows: priceRules.filter(rule => params[0].includes(rule.code)) };
        }
    }, applyBookingPackage({
        date: '2026-06-23',
        category: 'kitchen',
        price: 1200,
        programBasePrice: 0,
        banquetGuests: 12,
        menuPositions: [
            { productId: 'menu_pizza', title: 'Піца', quantity: 2, unitPrice: 600, subtotal: 1200 }
        ]
    }));

    assert.match(queries[0].sql, /FROM price_rules/);
    assert.deepEqual([...queries[0].params[0]].sort(), [
        BANQUET_ENTRY_PRICE_RULE_CODES.weekday,
        BANQUET_ENTRY_PRICE_RULE_CODES.weekend
    ].sort());
    assert.deepEqual(weekdayBooking.extraData.bookingPackage.entryCharge, {
        title: 'Вхід',
        quantity: 12,
        unitPrice: 300,
        subtotal: 3600,
        ruleCode: BANQUET_ENTRY_PRICE_RULE_CODES.weekday,
        dateType: 'weekday',
        source: BANQUET_ENTRY_SOURCE
    });
    assert.equal(weekdayBooking.extraData.bookingPackage.entrySubtotal, 3600);
    assert.equal(weekdayBooking.extraData.bookingPackage.finalTotal, 4800);
    assert.equal(weekdayBooking.price, 4800);

    const weekendBooking = await applyBookingPackageEntryCharge({
        async query(_sql, params) {
            return { rows: priceRules.filter(rule => params[0].includes(rule.code)) };
        }
    }, applyBookingPackage({
        date: '2026-06-27',
        category: 'kitchen',
        price: 1200,
        programBasePrice: 0,
        banquetGuests: 12,
        menuPositions: [
            { productId: 'menu_pizza', title: 'Піца', quantity: 2, unitPrice: 600, subtotal: 1200 }
        ]
    }));

    assert.equal(weekendBooking.extraData.bookingPackage.entryCharge.ruleCode, BANQUET_ENTRY_PRICE_RULE_CODES.weekend);
    assert.equal(weekendBooking.extraData.bookingPackage.entryCharge.unitPrice, 400);
    assert.equal(weekendBooking.extraData.bookingPackage.entrySubtotal, 4800);
    assert.equal(weekendBooking.extraData.bookingPackage.finalTotal, 6000);
});

test('booking package entry charge uses source kids count and protects manual entry rows', () => {
    const priceRules = [
        { code: BANQUET_ENTRY_PRICE_RULE_CODES.weekday, value: 300 },
        { code: BANQUET_ENTRY_PRICE_RULE_CODES.weekend, value: 400 }
    ];
    const fromSource = buildBanquetEntryCharge({
        date: '2026-06-23',
        category: 'kitchen',
        menuPositions: []
    }, {
        priceRules,
        sourceBooking: { kids_count: 7 }
    });

    assert.equal(fromSource.entryCharge.quantity, 7);
    assert.equal(fromSource.entrySubtotal, 2100);

    const manualExact = buildBanquetEntryCharge({
        date: '2026-06-23',
        category: 'kitchen',
        banquetGuests: 7,
        menuPositions: [{ title: 'Вхід', quantity: 7, unitPrice: 300 }]
    }, { priceRules });
    assert.equal(manualExact.entryCharge, null);
    assert.equal(manualExact.warnings[0].code, 'manual_entry_position_present');

    const conservativeTitle = buildBanquetEntryCharge({
        date: '2026-06-23',
        category: 'kitchen',
        banquetGuests: 7,
        menuPositions: [{ title: 'Вхідний браслет', quantity: 1, unitPrice: 50 }]
    }, { priceRules });
    assert.equal(conservativeTitle.entryCharge.quantity, 7);
});

test('booking package entry charge warns instead of silently using zero when data is missing', () => {
    const missingQuantity = buildBanquetEntryCharge({
        date: '2026-06-23',
        category: 'kitchen',
        menuPositions: []
    }, {
        priceRules: [{ code: BANQUET_ENTRY_PRICE_RULE_CODES.weekday, value: 300 }]
    });
    assert.equal(missingQuantity.entryCharge, null);
    assert.equal(missingQuantity.entrySubtotal, 0);
    assert.equal(missingQuantity.warnings[0].code, 'entry_quantity_missing');

    const missingRule = buildBanquetEntryCharge({
        date: '2026-06-27',
        category: 'kitchen',
        banquetGuests: 3,
        menuPositions: []
    }, {
        priceRules: [{ code: BANQUET_ENTRY_PRICE_RULE_CODES.weekday, value: 300 }]
    });
    assert.equal(missingRule.entryCharge, null);
    assert.equal(missingRule.entrySubtotal, 0);
    assert.equal(missingRule.warnings[0].code, 'entry_price_rule_missing');
    assert.deepEqual(missingRule.warnings[0].missingCodes, [BANQUET_ENTRY_PRICE_RULE_CODES.weekend]);
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

test('banquet terms numeric defaults are seeded through price rules without overwriting operator edits', () => {
    const migration = read('db', 'migrations', '267_banquet_terms_price_rules.sql');
    const centerRoute = read('routes', 'center.js');
    const expectedRules = [
        ['banquet_own_cake_fee', 500, 'грн'],
        ['banquet_cork_fee', 100, 'грн'],
        ['banquet_menu_correction_deadline_days', 3, 'доби'],
        ['banquet_date_change_deadline_days', 5, 'діб']
    ];

    assert.match(migration, /-- MIGRATION_KIND: seed/);
    assert.match(migration, /INSERT INTO price_rules/);
    assert.match(migration, /ON CONFLICT \(code\) DO NOTHING/);
    assert.doesNotMatch(migration, /ON CONFLICT \(code\) DO UPDATE/i);

    for (const [code, value, unit] of expectedRules) {
        assert.match(migration, new RegExp(`'${code}'`));
        assert.match(migration, new RegExp(`\\b${value}\\b`));
        assert.match(migration, new RegExp(`'${unit}'`));
    }

    assert.match(centerRoute, /router\.get\('\/prices'/);
    assert.match(centerRoute, /SELECT \* FROM price_rules ORDER BY category, code/);
    assert.match(centerRoute, /router\.put\('\/prices\/:code'/);
    assert.match(centerRoute, /UPDATE price_rules SET/);
});

test('booking routes snapshot banquet terms on create, full create, and update without frontend ownership', () => {
    const route = read('routes', 'bookings.js');
    const termsService = read('services', 'banquetTerms.js');
    const summaryService = read('services', 'banquetSummary.js');

    assert.match(route, /snapshotBanquetTermsForBooking/);
    assert.match(route, /await snapshotBanquetTermsForBooking\(client, b\)/);
    assert.match(route, /await snapshotBanquetTermsForBooking\(client, main\)/);
    assert.match(route, /for \(const activity of banquetActivities\)[\s\S]*await snapshotBanquetTermsForBooking\(client, activity\)/);
    assert.ok(
        route.lastIndexOf('await snapshotBanquetTermsForBooking(client, b);') > route.indexOf('mergeExistingExtraDataForBookingUpdate(b, oldBooking);'),
        'update route snapshots after existing extra_data is merged so old/manual terms survive'
    );
    assert.match(termsService, /function bookingNeedsBanquetTermsSnapshot/);
    assert.match(termsService, /function snapshotBanquetTermsForBooking/);
    assert.match(termsService, /hasSnapshotTerms\(extra\)/);
    assert.match(termsService, /extra\.banquetTerms = defaults\.items/);
    assert.match(termsService, /Заборонено приносити їжу та напої\. Свій торт дозволено за \$\{values\.ownCakeFee\} грн\. Cork Fee - \$\{values\.corkFee\} грн\./);
    assert.doesNotMatch(termsService, /Заборонено приносити їжу\/напої\/торт/);
    assert.doesNotMatch(termsService, /Свій торт - \$\{values\.ownCakeFee\}грн/);
    assert.match(summaryService, /function termsSnapshotSourceOf/);
    assert.match(summaryService, /function isPriceRuleTermsSnapshot/);
    assert.match(summaryService, /priceRuleSnapshot[\s\S]*defaults\.items/);
    assert.match(summaryService, /source:\s*'snapshot_fallback'/);
    assert.match(summaryService, /source:\s*'manual'/);
    assert.doesNotMatch(read('js', 'booking.js'), /banquetTermsSnapshot/);
});

test('banquet summary PDF export has clean server endpoint and distinct modes', () => {
    const route = read('routes', 'bookings.js');
    const html = read('booking-summary.html');
    const pageCode = read('js', 'booking-summary-page.js');
    const summaryCss = read('css', 'booking-summary.css');
    const summaryService = read('services', 'banquetSummary.js');
    const pdfService = read('services', 'banquetSummaryPdf.js');

    assert.match(route, /router\.get\('\/:id\/banquet-summary\.pdf'/);
    assert.match(route, /buildBanquetSummaryPdfBuffer\(summary, \{ mode \}\)/);
    assert.match(route, /'Content-Type': 'application\/pdf'/);
    assert.match(route, /'Content-Disposition': `attachment; filename="\$\{filename\}"`/);
    assert.match(route, /'Cache-Control': 'no-store'/);
    assert.match(route, /err\.code === 'banquet_summary_pdf_validation_failed'/);
    assert.match(route, /details: Array\.isArray\(err\.details\) \? err\.details : undefined/);

    // Product decision: the visible toolbar is client-only, while direct kitchen/staff URLs stay supported for legacy internal links.
    assert.match(html, /data-booking-summary-pdf-mode="client"/);
    assert.doesNotMatch(html, /data-booking-summary-pdf-mode="kitchen"/);
    assert.doesNotMatch(html, /data-booking-summary-pdf-mode="staff"/);
    assert.match(html, /id="bookingSummaryClientPdf"/);
    assert.match(html, /id="bookingSummaryClose"/);
    assert.doesNotMatch(html, /id="bookingSummaryBack"/);
    assert.doesNotMatch(html, /booking-summary-export/);
    assert.match(pageCode, /function closeSummaryDocument\(\)/);
    assert.match(pageCode, /const SUMMARY_MODES = new Set\(\['client', 'kitchen', 'staff'\]\)/);
    assert.match(pageCode, /return normalizeSummaryMode\(summary\?\.mode \|\| qs\(\)\.get\('mode'\) \|\| 'client'\)/);
    assert.match(pageCode, /const mode = normalizeSummaryMode\(params\.get\('mode'\) \|\| 'client'\)/);
    assert.match(pageCode, /const requestParams = new URLSearchParams\(\{ businessContext, mode \}\)/);
    assert.match(pageCode, /el\('bookingSummaryClientPdf'\)\?\.addEventListener\('click', \(\) => exportSummaryPdf\('client'\)\)/);
    assert.doesNotMatch(pageCode, /document\.querySelectorAll\('\[data-booking-summary-pdf-mode\]'\)/);
    assert.match(pageCode, /function exportSummaryPdf\(mode\)/);
    assert.match(pageCode, /Accept: 'application\/pdf'/);
    assert.match(pageCode, /response\.blob\(\)/);
    assert.match(pageCode, /URL\.createObjectURL\(blob\)/);
    assert.match(pageCode, /Authorization: `Bearer \$\{token\}`/);
    assert.match(pageCode, /Array\.isArray\(data\.details\)/);
    assert.match(pageCode, /details\.join\('\\n- '\)/);
    assert.doesNotMatch(pageCode, /summary\.document\?\.generatedAt/);
    assert.match(pageCode, /formatGeneratedAtShort\(renderedAt\)/);
    assert.match(pageCode, /<span>Сформовано:<\/span>/);
    assert.doesNotMatch(pageCode, /Оформлено/);
    assert.match(pageCode, /Бронь створено/);
    assert.match(pageCode, /class="banquet-hero"/);
    assert.match(pageCode, /class="brand-logo-frame"/);
    assert.match(pageCode, /class="brand-logo"/);
    assert.match(pageCode, /images\/banquet-logo\.png/);
    assert.match(pageCode, /class="booking-card"/);
    assert.match(pageCode, /class="booking-id"/);
    assert.doesNotMatch(pageCode, /BANQUET_TOP_PLATE_SRC/);
    assert.doesNotMatch(pageCode, /BANQUET_CORNER_SRC/);
    assert.doesNotMatch(pageCode, /BANQUET_FINAL_LOGO_SRC/);
    assert.doesNotMatch(pageCode, /class="banquet-top-plate"/);
    assert.doesNotMatch(pageCode, /class="banquet-corner-art"/);
    assert.doesNotMatch(pageCode, /aria-hidden="true">EG/);
    assert.doesNotMatch(pageCode, /class="banquet-final-brand"/);
    assert.match(summaryCss, /--summary-official-ink/);
    assert.match(summaryCss, /\.brand-logo-frame/);
    assert.match(summaryCss, /\.brand-logo/);
    assert.match(summaryCss, /\.banquet-top-plate,\s*\.banquet-corner-art[\s\S]*display: none !important/);
    assert.doesNotMatch(summaryCss, /\.banquet-final-brand/);
    assert.doesNotMatch(summaryCss, /@media print[\s\S]*\.banquet-final-brand/);
    assert.match(pdfService, /BANQUET_LOGO_PATH/);
    assert.match(pdfService, /doc\.image\(BANQUET_LOGO_PATH/);
    assert.doesNotMatch(pdfService, /\.text\('EG'/);
    assert.doesNotMatch(pdfService, /BANQUET_TOP_PLATE/);
    assert.doesNotMatch(pdfService, /BANQUET_CORNER_IMAGE/);
    assert.doesNotMatch(pdfService, /BANQUET_FINAL_LOGO/);
    assert.doesNotMatch(pdfService, /function drawFinalBrand/);
    assert.doesNotMatch(pageCode, /<span>Booking ID:/);
    assert.match(pageCode, /function summaryModeContract\(summary = currentSummary, mode = summaryMode\(summary\)\)/);
    assert.match(pageCode, /function summaryScheduleRows\(summary, mode = summaryMode\(summary\)\)/);
    assert.match(pageCode, /function renderSchedule\(summary, mode = summaryMode\(summary\)\)/);
    assert.match(pageCode, /summary-section--schedule/);
    assert.match(pageCode, /Розклад/);
    assert.match(pageCode, /function summaryResponsibleRows\(summary, mode = summaryMode\(summary\)\)/);
    assert.match(pageCode, /function renderResponsible\(summary, mode = summaryMode\(summary\)\)/);
    assert.match(pageCode, /summary-section--responsible/);
    assert.match(pageCode, /const requestParams = new URLSearchParams\(\{ businessContext, mode \}\)/);
    assert.match(pageCode, /renderWarnings\(summaryModeSection\(data, 'warnings', mode\) \? data\.warnings : \[\]\)/);
    assert.match(pageCode, /Відповідальні/);

    assert.match(pdfService, /const PDFDocument = require\('pdfkit'\)/);
    assert.match(pdfService, /banquetSummaryModeContract/);
    assert.doesNotMatch(pdfService, /const MODE_CONFIG/);
    assert.match(pdfService, /function validateBanquetSummaryPdf\(summary = \{\}, mode = 'client'\)/);
    assert.match(pdfService, /const ENTRY_BLOCKING_WARNING_CODES = new Set/);
    assert.match(pdfService, /if \(!validation\.valid\) throw pdfValidationError\(validation\)/);
    assert.match(pdfService, /function rowDurationLabel\(row = {}\)/);
    assert.match(pdfService, /row\.type === 'program' \|\| row\.type === 'activity'/);
    assert.match(pdfService, /rowDurationLabel\(row\)/);
    assert.match(pdfService, /label: 'Тривалість'/);
    assert.match(pdfService, /config\.scheduleSourceRowTypes\.has\(row\.type\)/);
    assert.match(pdfService, /config\.rowTypes\.has\(row\.type\)/);
    assert.match(pdfService, /function canonicalScheduleItems\(summary = \{\}, mode = 'client'\)/);
    assert.match(pdfService, /drawSectionTitle\(doc, 'Розклад'\)/);
    assert.doesNotMatch(pdfService, /Таймінг/);
    assert.match(pdfService, /function responsibleRowsForMode\(summary = \{\}, mode = 'client'\)/);
    assert.match(pdfService, /drawSectionTitle\(doc, 'Відповідальні'\)/);
    assert.doesNotMatch(pdfService, /BANQUET_TOP_PLATE/);
    assert.doesNotMatch(pdfService, /BANQUET_CORNER_IMAGE/);
    assert.doesNotMatch(pdfService, /BANQUET_FINAL_LOGO/);
    assert.doesNotMatch(pdfService, /BANQUET_HERO_LOGO/);
    assert.match(pdfService, /function drawPageDecor/);
    assert.doesNotMatch(pdfService, /function drawFinalBrand/);
    assert.match(pdfService, /function drawHeroBookingCard/);
    assert.match(pdfService, /formatDateTime\(renderedAt\)/);
    assert.doesNotMatch(pdfService, /Booking ID: \$\{pdfText\(summary\.bookingId\)\}/);
    assert.match(summaryService, /function buildBanquetSchedule/);
    assert.match(summaryService, /function buildResponsiblePeople/);
    assert.match(summaryService, /BANQUET_SUMMARY_MODES\s*=\s*Object\.freeze\(\['client', 'kitchen', 'staff'\]\)/);
    assert.match(summaryService, /function banquetSummaryModeContract/);
    assert.match(summaryService, /modeContract,/);
    assert.match(summaryService, /responsible,/);
    assert.match(summaryService, /schedule,/);
    assert.match(summaryService, /function buildFinanceRows/);
    assert.match(summaryService, /add\('total', 'Загальна сума'/);
    assert.doesNotMatch(summaryService, /add\('amount_due', 'До сплати'/);
    assert.doesNotMatch(summaryService, /add\('program', 'Програма'/);
    assert.doesNotMatch(summaryService, /Math\.abs\(normalizedBookingPrice - normalizedOrderTotal\) >= 0\.01/);
    assert.match(pdfService, /function financeRowsForSummary\(summary = {}\)/);
    assert.match(pdfService, /financeRowsForSummary\(summary\)\.map\(row =>/);
    assert.match(pdfService, /addFinanceRow\(rows, 'total', 'Загальна сума'/);
    assert.doesNotMatch(pdfService, /addFinanceRow\(rows, 'amount_due', 'До сплати'/);
    assert.doesNotMatch(pdfService, /paymentMethod/);
    assert.doesNotMatch(pdfService, /paymentStatus/);
    assert.doesNotMatch(pdfService, /displayHeaderFooter/);
    assert.doesNotMatch(pdfService, /puppeteer/i);
    assert.doesNotMatch(pdfService, /playwright/i);
    assert.match(pdfService, /pdfText\(manager\)/);
    assert.match(pdfService, /Бронь створено/);
    assert.doesNotMatch(pdfService, /generatedAt/);
    assert.doesNotMatch(summaryService, /generatedAt: new Date\(\)\.toISOString\(\)/);

    const sampleSummary = {
        bookingId: 'BK-2026/0499',
        venue: { name: 'Парк', phone: '0 800 753 553' },
        event: { date: '2026-06-23', time: '13:45', room: 'Рок', hasRealProgram: true, programName: 'Паперове шоу' },
        document: { generatedBy: 'Manager' },
        customer: { name: 'ШуткаМинутка', phone: '+380535232' },
        celebrant: { name: 'Жартик', birthday: '2020-06-23' },
        counts: { children: 12, adults: 2, tables: 1 },
        orderRows: [
            { id: 'program:1', type: 'program', title: 'Паперове шоу', durationMinutes: 60, quantity: null, subtotal: 2900, comment: 'Коментар до активності' },
            { id: 'entry:1', type: 'entry', title: 'Вхід', quantity: 12, unitPrice: 300, subtotal: 3600 },
            { id: 'menu:1', type: 'menu', title: 'Піца', quantity: 3, unitPrice: 250, subtotal: 750, comment: 'Без цибулі', meta: { servingTime: '15:00' } },
            { id: 'service-event:1', type: 'service_event', title: 'Торт', quantity: 1, comment: 'Свічки', meta: { time: '15:30' } }
        ],
        serviceEvents: [],
        responsible: {
            rows: [
                { role: 'manager', label: 'Менеджер', name: 'Сергій', modes: ['client', 'kitchen', 'staff'], showWhenEmpty: true },
                { role: 'animator', label: 'Аніматор', name: 'Олена', modes: ['staff'], showWhenEmpty: true },
                { role: 'kitchen', label: 'Кухня', name: null, modes: ['kitchen', 'staff'], showWhenEmpty: true },
                { role: 'waiter', label: 'Офіціант', name: null, modes: ['staff'], showWhenEmpty: true }
            ]
        },
        schedule: [
            { time: '13:45', title: 'Прихід гостей', note: 'Кімната: Рок', modes: ['client', 'staff'], noteModes: ['client', 'staff'], sortOrder: 0 },
            { time: '13:45', title: 'Паперове шоу', note: 'Коментар до активності', modes: ['client', 'staff'], noteModes: ['staff'], sortOrder: 20 },
            { time: '15:00', title: 'Видача меню', modes: ['client'], sortOrder: 40 },
            { time: '15:00', title: 'Видача: Піца', note: 'Без цибулі', modes: ['kitchen', 'staff'], noteModes: ['kitchen', 'staff'], sortOrder: 45 },
            { time: '15:30', title: 'Торт', note: 'Свічки', modes: ['client', 'kitchen', 'staff'], noteModes: ['kitchen', 'staff'], sortOrder: 60 }
        ],
        comments: [
            { type: 'kitchen', label: 'Кухня', text: 'Порізати торт' },
            { type: 'internal', label: 'Внутрішній коментар', text: 'Передзвонити' }
        ],
        warnings: [{ code: 'test_warning', message: 'Тестове попередження' }],
        totals: { programBasePrice: 2900, entrySubtotal: 3600, menuSubtotal: 750, activitySubtotal: 0, orderTotal: 7250, currency: 'UAH' },
        deposit: { amount: 1000, paymentMethod: 'cash', paymentStatus: 'paid' },
        terms: { title: 'Умови банкету', items: ['Заборонено приносити їжу та напої.'] }
    };

    assert.equal(normalizeBanquetSummaryMode('unknown'), 'client');
    assert.deepEqual(banquetSummaryModeContract('kitchen').orderRowTypes, ['menu']);
    assert.deepEqual(banquetSummaryModeContract('kitchen').commentTypes, ['kitchen']);
    assert.equal(banquetSummaryModeContract('staff').sections.warnings, true);
    assert.equal(banquetSummaryPdfFilename(sampleSummary, 'client'), 'banquet-sheet-BK-2026-0499-client.pdf');

    const client = buildBanquetSummaryPdfView(sampleSummary, 'client');
    assert.deepEqual(client.rows.map(row => row.type), ['program', 'entry', 'menu']);
    assert.deepEqual(client.schedule.map(item => item.title), ['Прихід гостей', 'Паперове шоу', 'Видача меню', 'Торт']);
    assert.equal(client.schedule.find(item => item.title === 'Паперове шоу')?.note, '');
    assert.equal(client.schedule.find(item => item.title === 'Прихід гостей')?.note, 'Кімната: Рок');
    assert.deepEqual(client.responsible.map(row => `${row.label}:${row.name || '—'}`), ['Менеджер:Сергій']);
    assert.equal(client.comments.length, 0);
    assert.equal(client.warnings.length, 0);
    assert.equal(client.config.showFinance, true);
    assert.equal(client.config.showTerms, true);
    assert.deepEqual(client.modeContract.orderRowTypes, ['program', 'activity', 'entry', 'menu']);
    assert.deepEqual(client.orderTableColumns.map(column => column.label), ['Позиція', 'К-сть', 'Ціна', 'Сума']);
    const clientProgramPdfRow = client.orderTableRows.find(row => String(row[0]).includes('Паперове шоу'));
    const clientEntryPdfRow = client.orderTableRows.find(row => row[0] === 'Вхід');
    const clientMenuPdfRow = client.orderTableRows.find(row => String(row[0]).includes('Піца'));
    assert.equal(clientProgramPdfRow[2], '—');
    assert.match(clientProgramPdfRow[3], /^2\s*900 грн$/);
    assert.equal(clientEntryPdfRow[0], 'Вхід');
    assert.equal(clientEntryPdfRow[1], '12 дітей');
    assert.equal(clientEntryPdfRow[2], '300 грн');
    assert.match(clientEntryPdfRow[3], /^3\s*600 грн$/);
    assert.match(clientMenuPdfRow[0], /Видача: 15:00/);
    assert.match(clientMenuPdfRow[0], /Примітка: Без цибулі/);
    assert.equal(clientMenuPdfRow[2], '250 грн');
    assert.equal(clientMenuPdfRow[3], '750 грн');

    const kitchen = buildBanquetSummaryPdfView(sampleSummary, 'kitchen');
    assert.deepEqual(kitchen.rows.map(row => row.type), ['menu']);
    assert.deepEqual(kitchen.orderTableColumns.map(column => column.label), ['№', 'Назва', 'Тривалість', 'Порції', 'Видача', 'Примітка']);
    assert.deepEqual(kitchen.schedule.map(item => item.title), ['Видача: Піца', 'Торт']);
    assert.equal(kitchen.schedule.find(item => item.title === 'Видача: Піца')?.note, 'Без цибулі');
    assert.deepEqual(kitchen.responsible.map(row => `${row.label}:${row.name || '—'}`), ['Менеджер:Сергій', 'Кухня:—']);
    assert.deepEqual(kitchen.comments.map(comment => comment.type), ['kitchen']);
    assert.equal(kitchen.config.showFinance, false);
    assert.equal(kitchen.config.showTerms, false);
    assert.equal(kitchen.config.showPrices, false);

    const staff = buildBanquetSummaryPdfView(sampleSummary, 'staff');
    assert.deepEqual(staff.rows.map(row => row.type), ['program', 'entry', 'menu']);
    assert.deepEqual(staff.schedule.map(item => item.title), ['Прихід гостей', 'Паперове шоу', 'Видача: Піца', 'Торт']);
    assert.equal(staff.schedule.find(item => item.title === 'Паперове шоу')?.note, 'Коментар до активності');
    assert.deepEqual(staff.responsible.map(row => `${row.label}:${row.name || '—'}`), ['Менеджер:Сергій', 'Аніматор:Олена', 'Кухня:—', 'Офіціант:—']);
    assert.deepEqual(staff.comments.map(comment => comment.type), ['kitchen', 'internal']);
    assert.equal(staff.warnings.length, 1);
    assert.equal(staff.config.showFinance, true);

    const fonts = resolvePdfFonts();
    assert.ok(fs.existsSync(fonts.regular), 'regular PDF font exists');
    assert.ok(fs.existsSync(fonts.bold), 'bold PDF font exists');
});

test('banquet summary official fixture renders logo masthead, core sections, and PDFs', async () => {
    const summary = loadJsonFixture('tests', 'fixtures', 'banquet-summary-official.fixture.json');
    const logoPath = path.join(repoRoot, 'images', 'banquet-logo.png');

    assert.ok(fs.existsSync(logoPath), 'real banquet logo asset exists');
    const logoInfo = readPngInfo('images', 'banquet-logo.png');
    assert.ok(logoInfo.bytes <= 200 * 1024, 'banquet logo stays lightweight for HTML and PDF rendering');
    assert.equal(logoInfo.width, logoInfo.height, 'banquet logo stays square');
    assert.ok(logoInfo.width >= 512 && logoInfo.width <= 1200, 'banquet logo keeps print-safe but bounded resolution');
    assert.equal(logoInfo.bitDepth, 8);
    assert.equal(logoInfo.colorType, 6, 'banquet logo keeps RGBA transparency');

    const pageCode = read('js', 'booking-summary-page.js');
    assert.doesNotMatch(pageCode, /aria-hidden="true">EG/);
    assert.doesNotMatch(pageCode, />EG<\/(?:span|div)>/);

    const { document, fetchCalls } = await renderBookingSummaryFixture(summary);
    const expectedFetchPath = `/api/bookings/${encodeURIComponent(summary.bookingId)}/banquet-summary`;
    assert.ok(fetchCalls.some(url => url.includes(expectedFetchPath)), 'fixture loads through the real summary API URL');

    const sheet = document.getElementById('bookingSummaryDocument');
    assert.equal(sheet.hidden, false);
    assert.ok(sheet.classList.contains('booking-summary-a4-page'));
    assert.ok(sheet.querySelector('.banquet-hero'), 'official masthead exists');
    assert.ok(sheet.querySelector('.brand-copy'), 'brand copy block exists');
    assert.ok(sheet.querySelector('.booking-card'), 'right booking card exists');
    assert.ok(sheet.querySelector('.booking-id'), 'booking id chip exists');

    const logoFrame = sheet.querySelector('.brand-logo-frame');
    const logo = sheet.querySelector('.brand-logo');
    assert.ok(logoFrame, 'logo frame exists');
    assert.ok(logo, 'logo image exists');
    assert.equal(logo.getAttribute('src'), 'images/banquet-logo.png');
    assert.equal(logoFrame.querySelector('.brand-mark')?.textContent.trim(), '');
    assert.equal(logoFrame.textContent.trim(), '');
    logo.dispatchEvent(new document.defaultView.Event('error'));
    assert.equal(logo.hidden, true);
    assert.ok(logoFrame.classList.contains('is-logo-missing'));
    assert.equal(logoFrame.querySelector('.brand-mark')?.textContent.trim(), '');
    assert.doesNotMatch(logoFrame.textContent, /EG/);
    assert.equal(sheet.querySelectorAll('.banquet-top-plate, .banquet-corner-art').length, 0);

    assert.ok(sheet.querySelector('.summary-brief-grid'), 'two-column brief grid exists');
    assert.equal(sheet.querySelectorAll('.summary-brief-column').length, 2);

    const sectionSequence = Array.from(sheet.querySelectorAll('.summary-section'))
        .map(section => Array.from(section.classList).find(className => className.startsWith('summary-section--')));
    assert.deepEqual(sectionSequence, [
        'summary-section--responsible',
        'summary-section--schedule',
        'summary-section--orders',
        'summary-section--finance',
        'summary-section--terms'
    ]);

    const orderTable = sheet.querySelector('.summary-order-table');
    assert.ok(orderTable, 'order table exists');
    assert.ok(orderTable.classList.contains('summary-order-table--client'), 'client order table uses price layout');
    assert.deepEqual(
        Array.from(orderTable.querySelectorAll('thead th')).map(th => th.textContent.trim()),
        ['Позиція', 'К-сть', 'Ціна', 'Сума']
    );
    assert.ok(orderTable.querySelector('td.money[data-label="Ціна"]'), 'client order table shows unit price column');
    assert.ok(orderTable.querySelector('td.money[data-label="Сума"]'), 'client order table shows subtotal column');
    assert.equal(orderTable.querySelectorAll('tbody tr').length, summary.orderRows.length);
    assert.ok(sheet.querySelector('.summary-finance-table [data-finance-row="total"]'), 'finance table keeps total row');
    assert.ok(sheet.querySelector('.summary-terms'), 'terms block exists');
    assert.equal(sheet.querySelector('.banquet-final-brand'), null, 'final brand footer is removed');

    const clientView = buildBanquetSummaryPdfView(summary, 'client');
    assert.equal(clientView.rows.length, summary.orderRows.length);
    assert.equal(clientView.comments.length, 0);

    const kitchenView = buildBanquetSummaryPdfView(summary, 'kitchen');
    assert.deepEqual(kitchenView.rows.map(row => row.type), ['menu', 'menu']);
    assert.ok(kitchenView.comments.some(comment => comment.type === 'kitchen'));

    const staffView = buildBanquetSummaryPdfView(summary, 'staff');
    assert.ok(staffView.comments.some(comment => comment.type === 'internal'));
    assert.ok(staffView.warnings.some(warning => warning.code === 'fixture_warning'));

    for (const mode of ['client', 'kitchen', 'staff']) {
        const buffer = await buildBanquetSummaryPdfBuffer(summary, { mode });
        assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
        assert.ok(buffer.length > 10000, `${mode} PDF contains rendered content`);
    }
});

test('banquet summary print edge fixture keeps long A4 output printable', async () => {
    const summary = buildBanquetSummaryPrintEdgeFixture();
    const pageCode = read('js', 'booking-summary-page.js');
    const pageCss = read('css', 'booking-summary.css');
    const pdfService = read('services', 'banquetSummaryPdf.js');

    assert.equal(validateBanquetSummaryPdf(summary, 'client').valid, true);
    assert.equal(validateBanquetSummaryPdf(summary, 'kitchen').valid, true);
    assert.equal(validateBanquetSummaryPdf(summary, 'staff').valid, true);
    assert.ok(summary.customer.name.length > 70, 'fixture has long client name');
    assert.ok(summary.venue.addressLine1.length > 80, 'fixture has long address');
    assert.ok(summary.orderRows.length >= 25, 'fixture has many order rows');
    assert.ok(summary.schedule.length >= 30, 'fixture has many timing rows');
    assert.ok(summary.terms.items.length >= 10, 'fixture has long terms');

    assert.match(pageCode, /class="summary-order-table"/);
    assert.match(pageCss, /\.summary-order-table thead[\s\S]*display: table-header-group/);
    assert.match(pageCss, /\.summary-order-table tr[\s\S]*break-inside: avoid/);
    assert.match(pageCss, /\.summary-section--terms[\s\S]*break-inside: avoid/);

    assert.match(pdfService, /const pageAdded = ensureSpace\(doc, height \+ 2\)/);
    assert.match(pdfService, /pageAdded && !options\.header/);
    assert.match(pdfService, /drawRow\(headerCells, headerOptions\)/);
    assert.match(pdfService, /heightOfString\(pdfText\(text\)/);

    const { document } = await renderBookingSummaryFixture(summary);
    const sheet = document.getElementById('bookingSummaryDocument');
    assert.equal(sheet.hidden, false);
    assert.equal(sheet.querySelectorAll('.summary-order-table tbody tr').length, summary.orderRows.length);
    assert.equal(sheet.querySelectorAll('.summary-schedule-item').length, summary.schedule.length);
    assert.equal(sheet.querySelectorAll('.summary-terms li').length, summary.terms.items.length);
    assert.ok(sheet.querySelector('.summary-finance-table [data-finance-row="total"]'), 'finance total remains visible');
    assert.equal(sheet.querySelector('.banquet-final-brand'), null, 'final brand stays removed after long terms');

    const clientView = buildBanquetSummaryPdfView(summary, 'client');
    assert.equal(clientView.rows.length, summary.orderRows.length);
    assert.equal(clientView.schedule.length, summary.schedule.length);
    assert.equal(clientView.comments.length, 0);

    const kitchenView = buildBanquetSummaryPdfView(summary, 'kitchen');
    assert.ok(kitchenView.rows.length >= 20);
    assert.ok(kitchenView.schedule.length >= 20);
    assert.ok(kitchenView.comments.some(comment => comment.type === 'kitchen'));

    const staffView = buildBanquetSummaryPdfView(summary, 'staff');
    assert.ok(staffView.comments.some(comment => comment.type === 'internal'));
    assert.ok(staffView.warnings.some(warning => warning.code === 'print_edge_warning'));

    for (const mode of ['client', 'kitchen', 'staff']) {
        const buffer = await buildBanquetSummaryPdfBuffer(summary, { mode });
        assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
        assert.ok(buffer.includes(Buffer.from('%%EOF')), `${mode} PDF has EOF marker`);
        assert.ok(countPdfPages(buffer) >= 2, `${mode} PDF spans multiple A4 pages`);
        assert.ok(buffer.length > 50000, `${mode} PDF contains long rendered content`);
    }
});

test('banquet summary PDF validation blocks client-critical gaps and keeps staff export available', async () => {
    const invalidClientSummary = {
        bookingId: 'BK-PDF-GUARD',
        venue: { name: 'Парк' },
        event: { date: '2026-06-23', time: '13:45', room: '', createdAt: '2026-06-20T10:00:00.000Z' },
        document: { generatedBy: 'Manager' },
        customer: { name: 'ШуткаМинутка', phone: '' },
        celebrant: { name: 'Жартик' },
        counts: { children: null },
        orderRows: [
            { type: 'program', title: 'Анімація 60хв', durationMinutes: 60, quantity: null, subtotal: 1500 }
        ],
        serviceEvents: [],
        comments: [],
        warnings: [
            { code: 'entry_quantity_missing', message: 'Кількість дітей для автоматичного входу не вказана, вхід не додано до суми.' }
        ],
        totals: { currency: 'UAH', programBasePrice: 1500, entrySubtotal: 0, menuSubtotal: 0, activitySubtotal: 0, orderTotal: 1500 },
        deposit: { amount: null },
        finance: {
            currency: 'UAH',
            amountDue: 1500,
            rows: [
                { key: 'total', label: 'Загальна сума', amount: 1500, currency: 'UAH', role: 'total' }
            ]
        },
        terms: { items: ['Умова'] }
    };

    const clientValidation = validateBanquetSummaryPdf(invalidClientSummary, 'client');
    assert.equal(clientValidation.valid, false);
    assert.deepEqual(clientValidation.errors.map(item => item.code), [
        'customer_phone_missing',
        'event_room_missing',
        'children_count_missing',
        'entry_quantity_missing'
    ]);

    await assert.rejects(
        buildBanquetSummaryPdfBuffer(invalidClientSummary, { mode: 'client' }),
        err => err.code === 'banquet_summary_pdf_validation_failed'
            && err.statusCode === 422
            && err.details.some(item => item.message === 'Не вказано кількість дітей.')
            && err.details.some(item => item.message === 'Не розраховано вхід: не вказано кількість дітей.')
    );

    const staffValidation = validateBanquetSummaryPdf(invalidClientSummary, 'staff');
    assert.equal(staffValidation.valid, true);
    assert.ok(staffValidation.warnings.some(item => item.code === 'children_count_missing'));
    assert.ok(staffValidation.warnings.some(item => item.code === 'entry_quantity_missing'));
    const staffView = buildBanquetSummaryPdfView(invalidClientSummary, 'staff');
    assert.ok(staffView.warnings.some(item => item.code === 'children_count_missing'));
    const staffBuffer = await buildBanquetSummaryPdfBuffer(invalidClientSummary, { mode: 'staff' });
    assert.equal(staffBuffer.subarray(0, 4).toString(), '%PDF');

    const emptyKitchenValidation = validateBanquetSummaryPdf(invalidClientSummary, 'kitchen');
    assert.equal(emptyKitchenValidation.valid, false);
    assert.deepEqual(emptyKitchenValidation.errors.map(item => item.code), ['kitchen_rows_missing']);

    const kitchenSummary = {
        ...invalidClientSummary,
        orderRows: [
            { type: 'menu', title: 'Піца', quantity: 2, unitPrice: 300, subtotal: 600, meta: { servingTime: '15:00' } }
        ]
    };
    assert.equal(validateBanquetSummaryPdf(kitchenSummary, 'kitchen').valid, true);
});

test('banquet summary comments are deduplicated against order row notes', () => {
    const summaryService = read('services', 'banquetSummary.js');
    const summaryPage = read('js', 'booking-summary-page.js');

    assert.match(summaryService, /function inlineCommentKeysFromRows\(rows = \[\]\)/);
    assert.match(summaryService, /inlineCommentKeys: inlineCommentKeysFromRows\(orderRows\)/);
    assert.match(summaryService, /inlineKeys\.has\(key\)/);
    assert.match(summaryService, /add\('activity', 'Коментар до активності', text, booking\)/);
    assert.doesNotMatch(summaryService, /Активність — \$\{bookingTitle/);

    assert.match(summaryPage, /comment\?\.type === 'activity' \? 'Коментар до активності'/);
    assert.match(summaryPage, /summaryModeAllowsComment\(summary, comment\.type, mode\)/);
    assert.doesNotMatch(summaryPage, /Активність —/);
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
    assert.match(html, /booking-menu-catalog-footer-count/);
    assert.match(html, /booking-menu-catalog-footer-total" aria-live="polite"/);
    assert.match(html, /<span>Разом<\/span>/);
    assert.doesNotMatch(html, /id="bookingMenuCatalogSummary">[^<]*₴/);
    assert.doesNotMatch(html, /id="bookingMenuCatalogCartSummary">[^<]*₴/);
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
    assert.match(bookingJs, /if \(inline\) inline\.textContent = summary\.combined;/);
    assert.match(bookingJs, /if \(header\) header\.textContent = summary\.countText;/);
    assert.match(bookingJs, /if \(cartSummary\) cartSummary\.textContent = summary\.countText;/);
    assert.match(bookingJs, /if \(footerTotal\) footerTotal\.textContent = summary\.subtotalText;/);
    assert.match(bookingJs, /if \(mobileCart\) mobileCart\.textContent = `Вибрано · \$\{summary\.countText\}`;/);
    assert.doesNotMatch(bookingJs, /if \(header\) header\.textContent = summary\.combined;/);
    assert.doesNotMatch(bookingJs, /if \(cartSummary\) cartSummary\.textContent = summary\.combined;/);
    assert.doesNotMatch(bookingJs, /if \(mobileCart\) mobileCart\.textContent = `Вибрано · \$\{summary\.subtotalText\}`;/);
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
    assert.match(bookingJs, /BOOKING_CREATE_PAST_VALIDATION_TIME_ZONE = 'Europe\/Kyiv'/);
    assert.match(bookingJs, /function bookingCreateTimeCandidates/);
    assert.match(bookingJs, /function bookingCreatePastValidationError/);
    assert.match(bookingJs, /bookingCreateOperationalTimeCandidates/);
    assert.match(bookingJs, /shouldUseKitchenOperationalCreateTime/);
    assert.match(bookingJs, /showNotification\(pastValidationError, 'error'\)/);
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
    assert.match(route, /function hasExplicitBanquetAddToExistingIntent/);
    assert.match(route, /function rejectExplicitBanquetAddToExistingGenericCreate/);
    assert.match(route, /BANQUET_GROUP_ACTIVITY_REQUIRES_ATOMIC_ENDPOINT/);
    assert.match(route, /BANQUET_ADD_TO_EXISTING_REQUIRES_ATOMIC_ENDPOINT/);
    assert.match(route, /rejectExplicitBanquetAddToExistingGenericCreate\(res, b\)/);
    assert.match(route, /\/api\/banquets\/:groupId\/activity-booking/);
    assert.match(route, /\/api\/banquets\/:groupId\/member-booking/);
    assert.match(read('routes/banquets.js'), /router\.get\('\/candidates'/);
    assert.match(read('routes/banquets.js'), /loadBanquetGroupCandidates\(\{ date, customerId, businessContext \}\)/);
    assert.match(read('routes/banquets.js'), /router\.post\('\/:groupId\/member-booking'/);
    assert.match(read('routes/banquets.js'), /createMemberBookingInBanquetGroup\(\{/);
    assert.match(read('services/banquetGroups.js'), /async function loadBanquetGroupCandidates/);
    assert.match(read('services/banquetGroups.js'), /fallbackCandidates: mapped\.filter\(candidate => candidate\.candidateKind !== 'customer'\)/);
    assert.match(read('services/banquetGroups.js'), /const ATOMIC_MEMBER_BOOKING_ROLES = new Set\(\['kitchen', 'service', 'manual'\]\)/);
    assert.match(read('services/banquetGroups.js'), /async function createMemberBookingInBanquetGroup/);
    assert.match(read('services/banquetGroups.js'), /groupName: null/);
    assert.match(read('services/banquetGroups.js'), /function normalizeRootActivityBooking[\s\S]*notes: normalizeActivityText\(input\.notes, 2000\)[\s\S]*groupName: null/);
    assert.match(read('services/banquetGroups.js'), /function normalizeLinkedActivityBooking[\s\S]*notes: normalizeActivityText\(input\.notes, 2000\)[\s\S]*groupName: null/);
    assert.match(route, /activity\.groupName \|\| main\.groupName \|\| null/);
    assert.doesNotMatch(read('services/banquetGroups.js'), /groupName: normalizeActivityText\(input\.groupName \|\| input\.group_name \|\| group\?\.group_name/);
    assert.doesNotMatch(read('services/banquetGroups.js'), /groupName: normalizeActivityText\(input\.groupName \|\| input\.group_name \|\| rootBooking\.groupName/);
    assert.match(read('services/banquetGroups.js'), /async function assertMemberRoomSlotAvailable/);
    assert.match(read('services/banquetGroups.js'), /MEMBER_BOOKING_ROOM_CONFLICT/);
    assert.match(read('services/banquetGroups.js'), /allowSameBanquetOperationalOverlap:\s*true/);
    assert.match(read('services/banquetGroups.js'), /candidateBooking:\s*booking/);
    assert.match(read('services/banquetGroups.js'), /groupId:\s*cleanGroupId/);
    assert.match(route, /const activityRows = \[\]/);
    assert.match(route, /function bookingRoomConflictPolicyOptions/);
    assert.match(route, /allowSameBanquetOperationalOverlap:\s*true/);
    assert.match(route, /checkRoomConflict\(\s*client,\s*activity\.date,\s*activity\.room,\s*activity\.time,\s*activity\.duration \|\| 0,\s*bookingRoomConflictPolicyOptions\(activity, \{ excludeIds: \[main\.id\] \}\),\s*businessContext\s*\)/);
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
    assert.match(panelCss, /\.booking-menu-catalog-footer\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto auto auto;[\s\S]*gap:\s*12px;/);
    assert.match(panelCss, /\.booking-menu-catalog-footer-total\s*\{[\s\S]*justify-content:\s*flex-end;[\s\S]*min-width:\s*max-content;/);
    assert.match(panelCss, /\.booking-menu-catalog-footer-total strong\s*\{[\s\S]*font-size:\s*22px;[\s\S]*font-weight:\s*1000;/);
    assert.match(panelCss, /@media \(max-width:\s*900px\)[\s\S]*grid-template-areas:\s*"count done"[\s\S]*"total done"[\s\S]*"cart cart";/);
    assert.match(panelCss, /@media \(max-width:\s*900px\)[\s\S]*\.booking-menu-catalog-footer-total\s*\{[\s\S]*grid-area:\s*total;[\s\S]*justify-content:\s*flex-start;/);
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

test('booking create flow bridges room-source kitchen without an existing banquet group', () => {
    const bookingJs = readBookingSurface();
    const apiJs = read('js', 'api.js');
    const bridgeStart = bookingJs.indexOf('const activityFirstKitchenBridge = validateActivityFirstKitchenBridge');
    const bridgeCall = bookingJs.indexOf('apiCreateBanquetMemberBookingFromSource', bridgeStart);
    const normalCreate = bookingJs.indexOf('createResult = await apiCreateBooking(booking)', bridgeStart);
    const roomAvailabilityRefresh = bookingJs.indexOf('await refreshBookingRoomAvailabilityForSelectedDate();');
    const roomSourceContextInit = bookingJs.indexOf('await initializeRoomFirstBookingSourceContext();', roomAvailabilityRefresh);
    const validateBridgeBlock = bookingJs.slice(
        bookingJs.indexOf('function validateActivityFirstKitchenBridge'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );

    assert.match(apiJs, /async function apiCreateBanquetMemberBookingFromSource\(payload = \{\}\)/);
    assert.match(apiJs, /\/banquets\/from-source\/member-booking/);
    assert.match(bookingJs, /function validateActivityFirstKitchenBridge\(/);
    assert.match(bookingJs, /function resolveBookingCreatePath\(formState = \{\}, drawerState = BookingDrawerState\)/);
    assert.match(bookingJs, /window\.resolveBookingCreatePath = resolveBookingCreatePath/);
    assert.match(bookingJs, /function hasUsableSelectedBanquetGroup\(/);
    assert.match(bookingJs, /function activityFirstKitchenSourceContext\(/);
    assert.match(bookingJs, /autoFilledBanquetGuestsFromRoom: null/);
    assert.match(bookingJs, /async function initializeRoomFirstBookingSourceContext\(\)[\s\S]*handleBookingRoomSelectionContextChange\(\)/);
    assert.match(bookingJs, /async function initializeRoomFirstBookingSourceContext\(\)[\s\S]*BookingDrawerState\.roomSelectionBanquetContext\?\.sourceBookingId/);
    assert.match(bookingJs, /function activityFirstKitchenSelectorState\(\)[\s\S]*!roomContext\?\.sourceBookingId \|\| roomContext\.groupId/);
    assert.match(bookingJs, /function activityFirstKitchenSelectorState\(\)[\s\S]*!isParkTimelineBookingMode\(\) \|\| !isBookingKitchenEnabled\(\)/);
    assert.match(bookingJs, /function activityFirstKitchenSelectorState\(\)[\s\S]*String\(sourceCustomerId\) !== String\(selectedCustomerId\)/);
    assert.match(bookingJs, /function bookingBanquetSelectorRealState\(\)/);
    assert.match(bookingJs, /function bookingBanquetSelectorVirtualState\(\)/);
    assert.match(bookingJs, /function bookingBanquetSelectorCanShowVirtual\(virtualState, realState, selectedGroupId = ''\)/);
    assert.match(bookingJs, /function activityFirstKitchenSelectorOptionLabel\(context = \{\}\)[\s\S]*Створити банкет з активності/);
    assert.match(bookingJs, /const showVirtualBanquetCreateOption = bookingBanquetSelectorCanShowVirtual\(virtualState, realState, selectedGroupId\)/);
    assert.match(bookingJs, /const unlinkedOptionLabel = showVirtualBanquetCreateOption \? virtualState\.label : 'Без прив’язки'/);
    assert.match(bookingJs, /<option value="">\$\{escapeHtml\(unlinkedOptionLabel\)\}<\/option>/);
    assert.match(bookingJs, /hint\.textContent = virtualState\.hint/);
    assert.match(bookingJs, /Банкет буде створено з активності/);
    assert.match(bookingJs, /source: groupId \? 'room_selection' : 'activity_first_kitchen_bridge'/);
    assert.match(bookingJs, /BookingDrawerState\.roomSelectionBanquetContext = banquetContext;[\s\S]*else \{\s*renderBookingBanquetGroupSelector\(\);/);
    assert.doesNotMatch(bookingJs, /__activity_first/);
    assert.match(bookingJs, /function roomBookingKidsCount\(/);
    assert.match(bookingJs, /function syncAutoFilledBanquetGuestsFromRoom\(/);
    assert.match(bookingJs, /function markBanquetGuestsManualOverride\(/);
    assert.match(bookingJs, /const BOOKING_ENTRY_PRICE_RULE_CODES = Object\.freeze/);
    assert.match(bookingJs, /function getBookingEntryChargeEstimate\(/);
    assert.match(bookingJs, /entryPriceRules: \[\]/);
    assert.match(bookingJs, /function preloadBookingEntryPriceRules\(/);
    assert.match(bookingJs, /function requestBookingEntryPriceRulesPreview\(/);
    assert.match(bookingJs, /apiGetCenterPriceRule\(code\)/);
    assert.match(bookingJs, /if \(loadedRules\.length && options\.render !== false && shouldRenderBookingEntryPreviewAfterLoad\(\)\)/);
    assert.match(bookingJs, /function bookingMenuPositionIsEntry\(/);
    assert.match(bookingJs, /function bookingPackageEntryChargeFromPackage\(/);
    assert.match(bookingJs, /function formatBookingPackageEntryAmount\(/);
    assert.match(bookingJs, /function renderBookingPackageEntryRow\(/);
    assert.match(bookingJs, /booking-summary-row--subtotal/);
    assert.match(bookingJs, /booking-detail-package-entry-row/);
    assert.match(bookingJs, /entrySubtotal: kitchenEnabled \? \(packageTotals\.entrySubtotal \|\| 0\) : 0/);
    assert.match(bookingJs, /entryCharge: formData\.entryCharge \|\| null/);
    assert.match(bookingJs, /finalTotal: toBookingMoney\(programBasePrice \+ positionsSubtotal \+ entryEstimate\.entrySubtotal\)/);
    assert.match(bookingJs, /Вхід/);
    assert.match(bookingJs, /guests\.value = String\(sourceKidsCount\)/);
    assert.match(bookingJs, /BookingDrawerState\.autoFilledBanquetGuestsFromRoom = \{[\s\S]*sourceBookingId,[\s\S]*value: String\(sourceKidsCount\)/);
    assert.match(bookingJs, /if \(id === 'banquetGuests' && typeof markBanquetGuestsManualOverride === 'function'\) markBanquetGuestsManualOverride\(\)/);
    assert.match(bookingJs, /function clearAutoFilledBanquetFromRoomSelection\(\)[\s\S]*BookingDrawerState\.roomSelectionBanquetContext = null;[\s\S]*clearAutoFilledBanquetGuestsFromRoom\(\);/);
    assert.match(bookingJs, /syncAutoFilledBanquetGuestsFromRoom\(sourceBooking\)/);
    assert.match(bookingJs, /BookingDrawerState\.roomSelectionBanquetContext = banquetContext;\s*if \(banquetContext\.groupId\)/);
    assert.match(bookingJs, /if \(!booking \|\| \(!context\.groupId && !context\.sourceBookingId\)\) return booking;/);
    assert.match(bookingJs, /groupId: context\.groupId \|\| null/);
    assert.match(bookingJs, /attachBanquetGroupContextToBooking\(booking, sourceContext, 'kitchen', 'activity_first_kitchen_bridge'\)/);
    assert.match(bookingJs, /sourceBookingId: createPath\.sourceBookingId/);
    assert.match(bookingJs, /const createPath = resolveBookingCreatePath\(\{[\s\S]*activityFirstKitchenBridge,[\s\S]*kitchenFirstActivityBridge[\s\S]*\}, BookingDrawerState\)/);
    assert.match(bookingJs, /if \(createPath\.blocked\)[\s\S]*showNotification\(createPath\.error/);
    assert.match(bookingJs, /if \(createResult && createResult\.success === false\) \{\s*if \(createResult\.conflictBookingId\) revealHiddenBooking\(createResult\.conflictBookingId\);/);
    assert.match(validateBridgeBlock, /const sourceContext = activityFirstKitchenSourceContext\(context\);\s*if \(!sourceContext\?\.sourceBookingId\) return \{ shouldUse: false \};/);
    assert.doesNotMatch(validateBridgeBlock, /pickRoomBanquetSourceBooking/);
    assert.doesNotMatch(validateBridgeBlock, /sourceBookingToBanquetContext/);
    assert.ok(roomAvailabilityRefresh >= 0, 'room availability is refreshed before room-first source context init');
    assert.ok(roomSourceContextInit > roomAvailabilityRefresh, 'programmatic room-first open initializes source context after room availability refresh');
    assert.ok(bridgeStart >= 0, 'activity-first kitchen bridge is evaluated in create flow');
    assert.ok(bridgeCall > bridgeStart, 'source-member API is called from create flow');
    assert.ok(normalCreate > bridgeCall, 'source-member API branch runs before normal booking fallback');
    assert.match(apiJs, /async function apiGetCenterPriceRule\(code\)/);
    assert.match(apiJs, /\/center\/prices\/\$\{encodeURIComponent\(safeCode\)\}/);
});

test('activity-first kitchen room open initializes source context after programmatic room selection', () => {
    const bookingJs = readBookingSurface();
    const openPanelBlock = bookingJs.slice(
        bookingJs.indexOf('async function openBookingPanel'),
        bookingJs.indexOf('function clearCustomerFields')
    );
    const initBlock = bookingJs.slice(
        bookingJs.indexOf('async function initializeRoomFirstBookingSourceContext'),
        bookingJs.indexOf('async function openBookingPanel')
    );

    assert.match(openPanelBlock, /ensureTimelineRoomOption\(line\.name\);\s*document\.getElementById\('roomSelect'\)\.value = line\.name;/);
    assert.match(openPanelBlock, /await refreshBookingRoomAvailabilityForSelectedDate\(\);\s*if \(!appliedExplicitBanquetContext\) \{\s*await initializeRoomFirstBookingSourceContext\(\);\s*\}/);
    assert.match(initBlock, /handleBookingRoomSelectionContextChange\(\)/);
    assert.match(initBlock, /BookingDrawerState\.roomSelectionBanquetContext\?\.sourceBookingId/);
    assert.doesNotMatch(initBlock, /apiCreateBanquetGroup|apiCreateBanquetMemberBooking|apiCreateBooking/);
});

test('booking details do not render the room timeline visibility notice block', () => {
    const bookingJs = readBookingSurface();
    const timelineCss = read('css', 'timeline.css');

    assert.doesNotMatch(bookingJs, /function renderBookingTimelineVisibilityNotice\(/);
    assert.doesNotMatch(bookingJs, /const timelineVisibilityHtml = renderBookingTimelineVisibilityNotice\(booking, banquetSnapshot\)/);
    assert.doesNotMatch(bookingJs, /\$\{timelineVisibilityHtml\}/);
    assert.doesNotMatch(bookingJs, /booking-detail-visibility/);
    assert.doesNotMatch(bookingJs, /Може відображатися у «Свята» і «Кімнати»/);
    assert.doesNotMatch(bookingJs, /Показати в кімнатах/);
    assert.match(bookingJs, /async function showBookingInRoomTimeline\(bookingId, dateKey = ''\)/);
    assert.match(bookingJs, /window\.TimelineView\.set\('rooms', \{ render: typeof renderTimeline === 'function' \? false : true \}\)/);
    assert.match(bookingJs, /findRoomServiceMarkerForBooking\(bookingIdText, groupId\)/);
    assert.match(timelineCss, /\.timeline-room-service-marker\.booking-block--just-created/);
});

test('banquet drawer preparation never creates banquet groups before save', () => {
    const bookingJs = readBookingSurface();
    const openPanelBlock = bookingJs.slice(
        bookingJs.indexOf('async function openBookingPanel'),
        bookingJs.indexOf('function clearCustomerFields')
    );
    const initBlock = bookingJs.slice(
        bookingJs.indexOf('async function initializeRoomFirstBookingSourceContext'),
        bookingJs.indexOf('async function openBookingPanel')
    );
    const roomSelectionBlock = bookingJs.slice(
        bookingJs.indexOf('async function handleBookingRoomSelectionContextChange'),
        bookingJs.indexOf('function clearRoomSelectionBanquetContextAfterCustomerChange')
    );
    const selectorBlock = bookingJs.slice(
        bookingJs.indexOf('function renderBookingBanquetGroupSelector'),
        bookingJs.indexOf('async function refreshBookingBanquetGroupCandidates')
    );
    const roomAnimationBridgeBlock = bookingJs.slice(
        bookingJs.indexOf('async function openRoomBookingAnimationBridge'),
        bookingJs.indexOf('// v43.5.0: Reveal a booking')
    );
    const saveFlowBlock = bookingJs.slice(
        bookingJs.indexOf('const createPath = resolveBookingCreatePath'),
        bookingJs.indexOf('if (createResult && createResult.success === false)')
    );

    assert.doesNotMatch(bookingJs, /function findOrCreateBanquetGroupForSourceBooking/);
    assert.doesNotMatch(openPanelBlock, /apiCreateBanquetGroup|apiCreateBanquetMemberBooking|apiCreateBanquetActivityBooking|apiCreateBooking/);
    assert.doesNotMatch(initBlock, /apiCreateBanquetGroup|apiCreateBanquetMemberBooking|apiCreateBanquetActivityBooking|apiCreateBooking/);
    assert.doesNotMatch(roomSelectionBlock, /apiCreateBanquetGroup|apiCreateBanquetMemberBooking|apiCreateBanquetActivityBooking|apiCreateBooking/);
    assert.doesNotMatch(selectorBlock, /apiCreateBanquetGroup|apiCreateBanquetMemberBooking|apiCreateBanquetActivityBooking|apiCreateBooking/);
    assert.doesNotMatch(roomAnimationBridgeBlock, /apiCreateBanquetGroup|apiCreateBanquetMemberBooking|apiCreateBanquetActivityBooking(?:FromSource)?|apiCreateBooking/);
    assert.match(roomAnimationBridgeBlock, /apiGetBanquetByBooking\(sourceBooking\.id\)/);
    assert.match(saveFlowBlock, /apiCreateBanquetMemberBookingFromSource/);
    assert.match(saveFlowBlock, /apiCreateBanquetActivityBookingFromSource/);
    assert.match(bookingJs, /function createBanquetGroupFromBookingDetails\(bookingId\)[\s\S]*apiCreateBanquetGroup\(sourceId/);
});

test('activity-first kitchen selector renders virtual create state without fake group id', () => {
    const bookingJs = readBookingSurface();
    const selectorBlock = bookingJs.slice(
        bookingJs.indexOf('function renderBookingBanquetGroupSelector'),
        bookingJs.indexOf('async function refreshBookingBanquetGroupCandidates')
    );
    const sourceOnlyBlock = bookingJs.slice(
        bookingJs.indexOf('function activityFirstKitchenSelectorState'),
        bookingJs.indexOf('function clearSelectedBanquetGroupIfCustomerMismatch')
    );

    assert.match(sourceOnlyBlock, /if \(!roomContext\?\.sourceBookingId \|\| roomContext\.groupId\) return null;/);
    assert.match(sourceOnlyBlock, /if \(!isParkTimelineBookingMode\(\) \|\| !isBookingKitchenEnabled\(\)\) return null;/);
    assert.match(sourceOnlyBlock, /String\(sourceCustomerId\) !== String\(selectedCustomerId\)/);
    assert.match(selectorBlock, /const showVirtualBanquetCreateOption = bookingBanquetSelectorCanShowVirtual\(virtualState, realState, selectedGroupId\);/);
    assert.match(selectorBlock, /const unlinkedOptionLabel = showVirtualBanquetCreateOption \? virtualState\.label : 'Без прив’язки'/);
    assert.match(selectorBlock, /<option value="">\$\{escapeHtml\(unlinkedOptionLabel\)\}<\/option>/);
    assert.match(selectorBlock, /hint\.textContent = virtualState\.hint/);
    assert.match(sourceOnlyBlock, /Банкет буде створено з активності/);
    assert.doesNotMatch(selectorBlock, /__activity_first|virtualGroupId|fakeGroupId/);
});

test('banquet selector separates real candidates from virtual source bridge state', () => {
    const bookingJs = readBookingSurface();
    const apiJs = read('js', 'api.js');
    const selectorBlock = bookingJs.slice(
        bookingJs.indexOf('function renderBookingBanquetGroupSelector'),
        bookingJs.indexOf('async function refreshBookingBanquetGroupCandidates')
    );
    const refreshBlock = bookingJs.slice(
        bookingJs.indexOf('async function refreshBookingBanquetGroupCandidates'),
        bookingJs.indexOf('function scheduleBookingBanquetGroupCandidatesRefresh')
    );
    const keyBlock = bookingJs.slice(
        bookingJs.indexOf('function bookingBanquetSelectorSourceMeta'),
        bookingJs.indexOf('function clearSelectedBanquetGroupIfCustomerMismatch')
    );

    assert.match(bookingJs, /function bookingBanquetSelectorRealState\(\)[\s\S]*visibleCandidates[\s\S]*hasRealCandidates/);
    assert.match(bookingJs, /function bookingBanquetSelectorVirtualState\(\)[\s\S]*activityFirstKitchenSelectorState\(\)[\s\S]*kitchenFirstActivitySelectorState\(\)/);
    assert.match(bookingJs, /function bookingBanquetSelectorCanShowVirtual\(virtualState, realState, selectedGroupId = ''\)[\s\S]*!realState\?\.hasRealCandidates/);
    assert.match(selectorBlock, /const realState = bookingBanquetSelectorRealState\(\);/);
    assert.match(selectorBlock, /const virtualState = bookingBanquetSelectorVirtualState\(\);/);
    assert.match(selectorBlock, /const virtualInvalidMessage = bookingBanquetSelectorVirtualInvalidMessage\(virtualState, realState, selectedGroupId\);/);
    assert.match(selectorBlock, /else if \(virtualInvalidMessage\) \{\s*hint\.textContent = virtualInvalidMessage;/);
    assert.doesNotMatch(selectorBlock, /__activity_first|virtualGroupId|fakeGroupId/);
    assert.match(keyBlock, /room: String\(document\.getElementById\('roomSelect'\)\?\.value \|\| sourceContext\?\.room \|\| ''\)\.trim\(\)/);
    assert.match(keyBlock, /sourceBookingId: String\(sourceBookingId \|\| ''\)\.trim\(\)/);
    assert.match(keyBlock, /drawerMode: normalizeBookingDrawerMode\(BookingDrawerState\.drawerMode \|\| inferBookingDrawerModeForOpen\(\)\)/);
    assert.match(keyBlock, /contextGeneration: String\(sourceContext\?\.generationId \|\| BookingDrawerState\.roomSelectionContextRequestToken \|\| 0\)/);
    assert.match(keyBlock, /function bookingBanquetGroupCandidatesRefreshKey\(\{ date = '', customerId = '' \} = \{\}\)[\s\S]*date:[\s\S]*customerId:[\s\S]*\.\.\.bookingBanquetSelectorSourceMeta\(\)/);
    assert.match(refreshBlock, /const sourceMeta = bookingBanquetSelectorSourceMeta\(\);[\s\S]*const key = bookingBanquetGroupCandidatesRefreshKey\(\{ date, customerId \}\)/);
    assert.match(refreshBlock, /apiGetBanquetCandidates\(\{[\s\S]*room: sourceMeta\.room,[\s\S]*sourceBookingId: sourceMeta\.sourceBookingId,[\s\S]*drawerMode: sourceMeta\.drawerMode,[\s\S]*contextGeneration: sourceMeta\.contextGeneration/);
    assert.match(apiJs, /if \(options\.room\) params\.set\('room', options\.room\)/);
    assert.match(apiJs, /if \(options\.sourceBookingId\) params\.set\('sourceBookingId', options\.sourceBookingId\)/);
    assert.match(apiJs, /if \(options\.drawerMode\) params\.set\('drawerMode', options\.drawerMode\)/);
    assert.match(apiJs, /if \(options\.contextGeneration\) params\.set\('contextGeneration', options\.contextGeneration\)/);
});

test('activity-first kitchen source-only save uses source bridge before normal create', () => {
    const bookingJs = readBookingSurface();
    const createFlowBlock = bookingJs.slice(
        bookingJs.indexOf('const activityFirstKitchenBridge = validateActivityFirstKitchenBridge'),
        bookingJs.indexOf('if (createResult && createResult.success === false)')
    );
    const validateBridgeBlock = bookingJs.slice(
        bookingJs.indexOf('function validateActivityFirstKitchenBridge'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );
    const resolverBlock = bookingJs.slice(
        bookingJs.indexOf('function resolveBookingCreatePath'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );
    const sourceBridgeCall = createFlowBlock.indexOf('apiCreateBanquetMemberBookingFromSource');
    const realGroupCall = createFlowBlock.indexOf('apiCreateBanquetMemberBooking(createPath.groupId');
    const normalCreateCall = createFlowBlock.indexOf('createResult = await apiCreateBooking(booking)');

    assert.match(bookingJs, /case 'source_activity_to_kitchen':[\s\S]*\/api\/banquets\/from-source\/member-booking/);
    assert.match(resolverBlock, /if \(activityFirstKitchenBridge\?\.shouldUse\)[\s\S]*return buildBookingCreatePath\('source_activity_to_kitchen'/);
    assert.match(validateBridgeBlock, /const sourceContext = activityFirstKitchenSourceContext\(context\);\s*if \(!sourceContext\?\.sourceBookingId\) return \{ shouldUse: false \};/);
    assert.doesNotMatch(validateBridgeBlock, /pickRoomBanquetSourceBooking/);
    assert.doesNotMatch(validateBridgeBlock, /sourceBookingToBanquetContext/);
    assert.match(createFlowBlock, /else if \(createPath\.kind === 'source_activity_to_kitchen'\)[\s\S]*apiCreateBanquetMemberBookingFromSource\(\{[\s\S]*sourceBookingId: createPath\.sourceBookingId,[\s\S]*role: 'kitchen'/);
    assert.ok(sourceBridgeCall >= 0, 'source-only kitchen save calls from-source member endpoint');
    assert.ok(realGroupCall > sourceBridgeCall, 'real group member endpoint remains after source-only bridge');
    assert.ok(normalCreateCall > sourceBridgeCall, 'normal booking create remains fallback after source-only bridge');
});

test('kitchen-first activity source-only save uses source bridge before normal create', () => {
    const bookingJs = readBookingSurface();
    const apiJs = read('js', 'api.js');
    const createFlowBlock = bookingJs.slice(
        bookingJs.indexOf('const activityFirstKitchenBridge = validateActivityFirstKitchenBridge'),
        bookingJs.indexOf('if (createResult && createResult.success === false)')
    );
    const validateBridgeBlock = bookingJs.slice(
        bookingJs.indexOf('function validateKitchenFirstActivityBridge'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );
    const resolverBlock = bookingJs.slice(
        bookingJs.indexOf('function resolveBookingCreatePath'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );
    const sourceBridgeCall = createFlowBlock.indexOf('apiCreateBanquetActivityBookingFromSource');
    const realGroupCall = createFlowBlock.indexOf('apiCreateBanquetActivityBooking(bridgeGroupId');
    const normalCreateCall = createFlowBlock.indexOf('createResult = await apiCreateBooking(booking)');

    assert.match(apiJs, /async function apiCreateBanquetActivityBookingFromSource\(payload = \{\}\)/);
    assert.match(apiJs, /\/banquets\/from-source\/activity-booking/);
    assert.match(bookingJs, /function roomBookingLooksLikeKitchen\(/);
    assert.match(bookingJs, /function kitchenFirstActivitySelectorState\(/);
    assert.match(bookingJs, /function kitchenFirstActivitySelectorContext\(/);
    assert.match(bookingJs, /function kitchenFirstActivitySelectorOptionLabel/);
    assert.match(bookingJs, /function bookingBanquetSelectorVirtualState\(\)[\s\S]*kitchenFirstActivitySelectorState\(\)/);
    assert.match(bookingJs, /Створити банкет з кухні/);
    assert.match(bookingJs, /Банкет буде створено з кухні/);
    assert.match(validateBridgeBlock, /const bridgeContext = BookingDrawerState\.roomBookingAnimationBridge;/);
    assert.match(validateBridgeBlock, /!bridgeContext\?\.sourceBookingId \|\| bridgeContext\.groupId/);
    assert.match(validateBridgeBlock, /roomBookingLooksLikeKitchen\(sourceBooking\)/);
    assert.match(validateBridgeBlock, /String\(sourceCustomerId\) === String\(selectedCustomerId\)/);
    assert.match(bookingJs, /case 'source_kitchen_to_activity':[\s\S]*\/api\/banquets\/from-source\/activity-booking/);
    assert.match(resolverBlock, /if \(kitchenFirstActivityBridge\?\.shouldUse\)[\s\S]*return buildBookingCreatePath\('source_kitchen_to_activity'/);
    assert.match(createFlowBlock, /const kitchenFirstActivityBridge = validateKitchenFirstActivityBridge\(formData, selectedBanquetContext\);/);
    assert.match(createFlowBlock, /else if \(createPath\.kind === 'source_kitchen_to_activity'\)[\s\S]*apiCreateBanquetActivityBookingFromSource\(\{[\s\S]*sourceBookingId: createPath\.sourceBookingId,[\s\S]*linkedBookings: linked/);
    assert.ok(sourceBridgeCall >= 0, 'source-only activity save calls from-source activity endpoint');
    assert.ok(realGroupCall >= 0 && realGroupCall < sourceBridgeCall, 'existing bridge group endpoint remains before source-only activity bridge');
    assert.ok(normalCreateCall > sourceBridgeCall, 'normal booking create remains fallback after source-only activity bridge');
});

test('activity-first kitchen existing banquet group still uses group member endpoint', () => {
    const bookingJs = readBookingSurface();
    const createFlowBlock = bookingJs.slice(
        bookingJs.indexOf('const activityFirstKitchenBridge = validateActivityFirstKitchenBridge'),
        bookingJs.indexOf('if (createResult && createResult.success === false)')
    );

    assert.match(createFlowBlock, /else if \(createPath\.kind === 'existing_group_member'\)[\s\S]*attachBanquetGroupContextToBooking\(booking, selectedBanquetContext, 'kitchen', selectedBanquetContextSource\);[\s\S]*apiCreateBanquetMemberBooking\(createPath\.groupId/);
    assert.match(createFlowBlock, /sourceBookingId: createPath\.sourceBookingId \|\| null/);
    assert.match(createFlowBlock, /role: 'kitchen'/);
});

test('activity-first kitchen customer mismatch is blocked before source bridge API call', () => {
    const bookingJs = readBookingSurface();
    const validateBridgeBlock = bookingJs.slice(
        bookingJs.indexOf('function validateActivityFirstKitchenBridge'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );
    const createFlowBlock = bookingJs.slice(
        bookingJs.indexOf('const activityFirstKitchenBridge = validateActivityFirstKitchenBridge'),
        bookingJs.indexOf('if (createResult && createResult.success === false)')
    );
    const resolverBlock = bookingJs.slice(
        bookingJs.indexOf('function resolveBookingCreatePath'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );
    const mismatchCheck = validateBridgeBlock.indexOf('if (!selectedMatchesSource && !autoFilledMatchesSource)');
    const blockedCheck = createFlowBlock.indexOf('if (createPath.blocked)');
    const apiCall = createFlowBlock.indexOf('apiCreateBanquetMemberBookingFromSource');

    assert.ok(mismatchCheck >= 0, 'source/customer mismatch guard exists');
    assert.match(validateBridgeBlock, /error: 'Клієнт кухні не збігається з клієнтом бронювання в кімнаті/);
    assert.match(resolverBlock, /selectedBookingBanquetGroupCustomerMismatch\(selectedBanquetContext\)[\s\S]*reason: 'customer_mismatch'/);
    assert.match(resolverBlock, /activityFirstKitchenBridge\.error[\s\S]*blocked: true/);
    assert.match(createFlowBlock, /if \(createPath\.blocked\)[\s\S]*showNotification\(createPath\.error[\s\S]*unlockSubmitBtn\(\);\s*return;/);
    assert.ok(blockedCheck >= 0 && apiCall > blockedCheck, 'source API call is after createPath blocked guard');
});

test('booking drawer accepts explicit timeline banquet context and exposes standalone override', () => {
    const bookingJs = readBookingSurface();
    const stateStart = bookingJs.search(/(?:const|var) BookingDrawerState =/);
    const stateBlock = bookingJs.slice(
        stateStart,
        bookingJs.indexOf('const BOOKING_ENTRY_PRICE_RULE_CODES')
    );
    const openPanelBlock = bookingJs.slice(
        bookingJs.indexOf('async function openBookingPanel'),
        bookingJs.indexOf('// ==========================================\n// CRM: CUSTOMER DATA')
    );
    const resetBlock = bookingJs.slice(
        bookingJs.indexOf('function normalizeBookingDrawerMode'),
        bookingJs.indexOf('function renderBookingBanquetGroupSelector')
    );
    const resolverBlock = bookingJs.slice(
        bookingJs.indexOf('function resolveBookingCreatePath'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );
    const createFlowBlock = bookingJs.slice(
        bookingJs.indexOf('const activityFirstKitchenBridge = validateActivityFirstKitchenBridge'),
        bookingJs.indexOf('if (createResult && createResult.success === false)')
    );

    assert.ok(stateStart >= 0, 'BookingDrawerState module state exists');
    assert.match(stateBlock, /activeBanquetIntent:\s*null/, 'drawer state should store active banquet intent');
    assert.match(stateBlock, /activeBanquetRoleIntent:\s*null/, 'drawer state should expose active banquet role intent');
    assert.match(stateBlock, /standaloneBookingOverride:\s*false/, 'drawer state should require an explicit standalone override');
    assert.match(bookingJs, /function normalizeExplicitBookingBanquetContext/, 'booking drawer should normalize explicit timeline banquet context');
    assert.match(bookingJs, /function normalizeExplicitBanquetPackageSnapshot/, 'booking drawer should normalize package snapshot from active banquet context');
    assert.match(bookingJs, /function applyExplicitBanquetPrefill/, 'booking drawer should prefill add-to-existing data from active banquet context');
    assert.match(bookingJs, /function applyExplicitBanquetPackagePrefill/, 'booking drawer should prefill package data only through a dedicated helper');
    assert.match(bookingJs, /function resolveBookingActiveBanquetRoleIntent/, 'booking drawer should expose deterministic role intent for active banquet context');
    assert.match(bookingJs, /function attachActiveBanquetIntentMarker/, 'booking drawer should stamp explicit add-to-existing intent into payloads');
    assert.match(bookingJs, /intent: 'add_to_existing'/, 'active banquet payloads should carry explicit add-to-existing intent');
    assert.match(bookingJs, /requiresMembership: true/, 'active banquet payloads should require atomic group membership');
    assert.match(bookingJs, /attachActiveBanquetIntentMarker\(obj\);/, 'booking object build should add the active banquet marker before API dispatch');
    assert.match(bookingJs, /function bookingCreatePathActiveBanquetRole/, 'create path should resolve active banquet role before generic create fallback');
    assert.match(bookingJs, /function applyExplicitBookingBanquetContext/, 'booking drawer should apply explicit timeline banquet context');
    assert.match(bookingJs, /function clearExplicitBookingBanquetContext/, 'booking drawer should clear explicit timeline banquet context');
    assert.match(openPanelBlock, /const explicitBanquetContext = normalizeExplicitBookingBanquetContext\(options\.banquetContext/, 'openBookingPanel should accept options.banquetContext');
    assert.match(openPanelBlock, /resetBookingDrawerStateForOpen\(options\.drawerMode \|\| inferBookingDrawerModeForOpen\(\)\);[\s\S]*applyExplicitBookingBanquetContext\(explicitBanquetContext/, 'explicit context should be applied after reset');
    assert.match(bookingJs, /if \(!isBookingKitchenEnabled\(\)\) return false;[\s\S]*BookingPackageState\.menuPositions/, 'package/menu prefill must be guarded by kitchen-enabled mode');
    assert.match(bookingJs, /packageSnapshot[\s\S]*banquetGuests[\s\S]*banquetAdults[\s\S]*banquetTables/, 'explicit context should preserve package and guest prefill data');
    assert.match(bookingJs, /function renderActiveBanquetContextBanner/, 'drawer should render an add-to-existing context banner');
    assert.match(bookingJs, /booking-active-banquet-context__role/, 'drawer banner should show the resolved role intent');
    assert.match(bookingJs, /booking-active-banquet-context/, 'drawer should have a visible active banquet context chip/banner class');
    assert.match(bookingJs, /data-booking-standalone-override/, 'drawer should expose an explicit standalone override control');
    assert.match(resetBlock, /activeBanquetIntent[\s\S]*standaloneBookingOverride/, 'drawer reset should clear active context and standalone override');
    assert.match(resolverBlock, /drawerState\?\.activeBanquetIntent === 'add_to_existing'/, 'create path should understand active add-to-existing intent');
    assert.match(resolverBlock, /drawerState\?\.standaloneBookingOverride/, 'create path should check standalone override');
    assert.match(resolverBlock, /active_banquet_context_requires_group/, 'missing group for active context should block instead of falling through');
    assert.match(resolverBlock, /active_banquet_context_requires_source_booking/, 'active context without source booking should block save');
    assert.match(resolverBlock, /active_banquet_context_requires_role/, 'active context without deterministic role should block save');
    assert.match(resolverBlock, /active_banquet_context_unresolved_path/, 'active context should have a final fail-closed guard before normal create fallback');
    assert.match(resolverBlock, /active_banquet_context_member/, 'active kitchen/member context should use existing group member path');
    assert.match(resolverBlock, /active_banquet_context_activity/, 'active activity context should use existing group activity path');
    assert.match(createFlowBlock, /createPath\.kind === 'existing_group_activity'[\s\S]*apiCreateBanquetActivityBooking\(/, 'activity add-to-existing should call banquet activity endpoint');
    assert.match(createFlowBlock, /createPath\.kind === 'existing_group_member'[\s\S]*apiCreateBanquetMemberBooking\(/, 'kitchen/member add-to-existing should call banquet member endpoint');
    assert.match(createFlowBlock, /const finalCreatePath = resolveBookingCreatePath[\s\S]*if \(finalCreatePath\.blocked\)[\s\S]*return;/, 'second create path resolve should also respect blocked active context');
    assert.match(createFlowBlock, /if \(createPath\.blocked\)[\s\S]*return;/, 'blocked active context should stop before API create');
    assert.equal((bookingJs.match(/standaloneBookingOverride\s*=\s*true/g) || []).length, 1, 'standalone override should only be set by the explicit standalone action');
});

test('active banquet context cannot silently fall back to normal booking create', () => {
    const bookingJs = readBookingSurface();
    const resolverBlock = bookingJs.slice(
        bookingJs.indexOf('function resolveBookingCreatePath'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );
    const activeIntentIndex = resolverBlock.indexOf('activeBanquetIntent');
    const standaloneOverrideIndex = resolverBlock.indexOf('standaloneBookingOverride');
    const normalBookingIndex = resolverBlock.indexOf("return buildBookingCreatePath(normalKind || 'normal_booking'");
    const unresolvedGuardIndex = resolverBlock.indexOf('active_banquet_context_unresolved_path');

    assert.ok(activeIntentIndex >= 0, 'resolver should inspect active banquet intent');
    assert.ok(standaloneOverrideIndex >= 0, 'resolver should inspect standalone override');
    assert.ok(normalBookingIndex >= 0, 'resolver should still have normal booking fallback');
    assert.ok(activeIntentIndex < normalBookingIndex, 'active banquet intent should be handled before normal booking fallback');
    assert.ok(unresolvedGuardIndex >= 0 && unresolvedGuardIndex < normalBookingIndex, 'active unresolved path should fail closed before normal booking fallback');
    assert.match(
        resolverBlock,
        /if \(activeBanquetIntent && !standaloneBookingOverride[\s\S]*return buildBookingCreatePath\('[^']+', \{[\s\S]*blocked: true/,
        'active banquet context without a usable group must block, not create standalone'
    );
    assert.match(
        resolverBlock,
        /return buildBookingCreatePath\('existing_group_member', \{[\s\S]*reason: 'active_banquet_context_member'/,
        'active kitchen/member role should route to existing group member path'
    );
    assert.match(
        resolverBlock,
        /return buildBookingCreatePath\('existing_group_activity', \{[\s\S]*reason: 'active_banquet_context_activity'/,
        'active activity role should route to existing group activity path'
    );
    assert.match(
        resolverBlock.slice(unresolvedGuardIndex, normalBookingIndex),
        /active_banquet_context_unresolved_path[\s\S]*blocked: true/,
        'unresolved active banquet intent should return a blocked path before the normal fallback'
    );
});

test('booking drawer state lifecycle has centralized mode reset and source generation guards', () => {
    const bookingJs = readBookingSurface();
    const stateStart = bookingJs.search(/(?:const|var) BookingDrawerState =/);
    const stateBlock = bookingJs.slice(
        stateStart,
        bookingJs.indexOf('const BOOKING_ENTRY_PRICE_RULE_CODES')
    );
    const openPanelBlock = bookingJs.slice(
        bookingJs.indexOf('async function openBookingPanel'),
        bookingJs.indexOf('// ==========================================\n// CRM: CUSTOMER DATA')
    );
    const resetBlock = bookingJs.slice(
        bookingJs.indexOf('function normalizeBookingDrawerMode'),
        bookingJs.indexOf('function renderBookingBanquetGroupSelector')
    );
    const roomSourceBlock = bookingJs.slice(
        bookingJs.indexOf('function buildBookingRoomSourceContext'),
        bookingJs.indexOf('function clearAutoFilledBanquetFromRoomSelection')
    );
    const roomChangeBlock = bookingJs.slice(
        bookingJs.indexOf('function clearRoomSelectionBanquetContextAfterCustomerChange'),
        bookingJs.indexOf('function markBookingCustomerSelectionManual')
    );

    assert.ok(stateStart >= 0, 'BookingDrawerState module state exists');
    assert.match(stateBlock, /drawerMode: 'create_activity'/);
    assert.match(stateBlock, /drawerGenerationId: 0/);
    assert.match(stateBlock, /roomSourceContext: null/);
    assert.match(stateBlock, /ACTIVITY_FIRST_KITCHEN_BRIDGE: 'activity_first_kitchen_bridge'/);
    assert.match(stateBlock, /KITCHEN_FIRST_ACTIVITY_BRIDGE: 'kitchen_first_activity_bridge'/);
    assert.match(stateBlock, /EXISTING_GROUP_MEMBER: 'existing_group_member'/);
    assert.match(stateBlock, /EXISTING_GROUP_ACTIVITY: 'existing_group_activity'/);
    assert.match(resetBlock, /function resetBookingDrawerStateForOpen\(mode = inferBookingDrawerModeForOpen\(\)\)/);
    assert.match(resetBlock, /BookingDrawerState\.drawerGenerationId = \(Number\(BookingDrawerState\.drawerGenerationId\) \|\| 0\) \+ 1/);
    assert.match(resetBlock, /resetBookingRoomSourceContext\(\{ render: false \}\)/);
    assert.match(resetBlock, /resetBanquetSelectorContext\(\{ render: false \}\)/);
    assert.match(openPanelBlock, /resetBookingDrawerStateForOpen\(options\.drawerMode \|\| inferBookingDrawerModeForOpen\(\)\)/);
    assert.match(roomSourceBlock, /generationId: Number\(options\.generationId \?\? BookingDrawerState\.roomSelectionContextRequestToken/);
    assert.match(roomSourceBlock, /drawerGenerationId: Number\(BookingDrawerState\.drawerGenerationId \|\| 0\)/);
    assert.match(roomSourceBlock, /sourceBookingId,\s*sourceRole,[\s\S]*customerId:[\s\S]*date:[\s\S]*room:[\s\S]*time:[\s\S]*groupId:[\s\S]*source:/);
    assert.match(roomSourceBlock, /function bookingRoomSourceContextStaleReason\(context = \{\}\)[\s\S]*stale_drawer_generation[\s\S]*stale_source_date[\s\S]*stale_source_room[\s\S]*stale_source_customer/);
    assert.match(roomChangeBlock, /preserveSourceOnlyMismatchGuard/);
    assert.match(roomChangeBlock, /staleReason: 'customer_changed'/);
});

test('booking drawer bridge validators reject stale generated source context before API save', () => {
    const bookingJs = readBookingSurface();
    const activityValidateBlock = bookingJs.slice(
        bookingJs.indexOf('function validateActivityFirstKitchenBridge'),
        bookingJs.indexOf('function validateKitchenFirstActivityBridge')
    );
    const kitchenValidateBlock = bookingJs.slice(
        bookingJs.indexOf('function validateKitchenFirstActivityBridge'),
        bookingJs.indexOf("if (typeof window !== 'undefined')")
    );
    const createFlowBlock = bookingJs.slice(
        bookingJs.indexOf('const activityFirstKitchenBridge = validateActivityFirstKitchenBridge'),
        bookingJs.indexOf('if (createResult && createResult.success === false)')
    );

    assert.match(activityValidateBlock, /const staleReason = bookingRoomSourceContextStaleReason\(sourceContext\);[\s\S]*bookingRoomSourceContextStaleMessage\(staleReason\)/);
    assert.match(kitchenValidateBlock, /const staleReason = bookingRoomSourceContextStaleReason\(bridgeContext\);[\s\S]*bookingRoomSourceContextStaleMessage\(staleReason\)/);
    assert.match(createFlowBlock, /if \(createPath\.blocked\)[\s\S]*return;/);
    assert.match(createFlowBlock, /createPath\.kind === 'source_activity_to_kitchen'[\s\S]*setBookingDrawerMode\(BOOKING_DRAWER_MODES\.ACTIVITY_FIRST_KITCHEN_BRIDGE\)[\s\S]*apiCreateBanquetMemberBookingFromSource/);
    assert.match(createFlowBlock, /createPath\.kind === 'source_kitchen_to_activity'[\s\S]*setBookingDrawerMode\(BOOKING_DRAWER_MODES\.KITCHEN_FIRST_ACTIVITY_BRIDGE\)[\s\S]*apiCreateBanquetActivityBookingFromSource/);
    assert.match(createFlowBlock, /createPath\.kind === 'existing_group_member'[\s\S]*setBookingDrawerMode\(BOOKING_DRAWER_MODES\.EXISTING_GROUP_MEMBER\)[\s\S]*apiCreateBanquetMemberBooking\(createPath\.groupId/);
    assert.match(createFlowBlock, /setBookingDrawerMode\(BOOKING_DRAWER_MODES\.EXISTING_GROUP_ACTIVITY\)[\s\S]*apiCreateBanquetActivityBooking/);
});

test('banquet group repair script is dry-run by default and reuses backend reconciliation', () => {
    const script = read('scripts', 'reconcile-banquet-groups.js');

    assert.match(script, /const \{ pool \} = require\('\.\.\/db'\)/);
    assert.match(script, /reconcileBanquetGroupForBooking/);
    assert.match(script, /flags\.has\('--apply'\)/);
    assert.match(script, /dry-run only: add --apply/);
    assert.match(script, /b\.date >= \$1/);
    assert.match(script, /b\.date <= \$2/);
    assert.match(script, /b\.customer_id IS NOT NULL/);
    assert.match(script, /NULLIF\(BTRIM\(COALESCE\(b\.room, ''\)\), ''\) IS NOT NULL/);
    assert.match(script, /LOWER\(COALESCE\(NULLIF\(BTRIM\(b\.status\), ''\), 'confirmed'\)\) != 'cancelled'/);
    assert.match(script, /bookingPackageHasBanquetData/);
    assert.match(script, /isBanquetAnchor/);
    assert.match(script, /hashCustomerId/);
    assert.match(script, /customer=hash:/);
    assert.match(script, /multiple_existing_groups/);
    assert.match(script, /already_grouped/);
    assert.match(script, /production_repair_script/);
    assert.doesNotMatch(script, /JOIN customers/i);
    assert.doesNotMatch(script, /phone|instagram|child_name/i);
});

test('banquet group repair plan detects and applies activity role drift without duplicating groups', async () => {
    const script = read('scripts', 'reconcile-banquet-groups.js');
    const module = { exports: {} };
    const context = {
        console,
        module,
        exports: module.exports,
        require: id => {
            if (id === 'fs') {
                return {
                    existsSync: () => false,
                    readFileSync: () => ''
                };
            }
            if (id === '../db') {
                return {
                    pool: {
                        query: async () => ({ rows: [], rowCount: 0 }),
                        end: async () => {}
                    }
                };
            }
            if (id === '../services/banquetGroups') {
                return { reconcileBanquetGroupForBooking: async () => ({}) };
            }
            if (id === '../services/booking') {
                return { BANQUET_SERVICE_LINE_ID: 'banquet-service' };
            }
            if (id === '../services/timelineContext') {
                return { DEFAULT_TIMELINE_CONTEXT: 'event_genix' };
            }
            return require(id);
        },
        process: { argv: ['node', 'script'], env: {}, exitCode: 0 },
        Buffer,
        setTimeout,
        clearTimeout,
        __dirname: path.join(repoRoot, 'scripts'),
        __filename: path.join(repoRoot, 'scripts', 'reconcile-banquet-groups.js')
    };
    context.require.main = {};
    vm.createContext(context);
    vm.runInContext(script, context, { filename: 'scripts/reconcile-banquet-groups.js' });

    const { applyRoleUpdates, buildPlan } = module.exports;
    const bookings = [
        {
            id: 'BK-ROLE-ROOT',
            business_context: 'event_genix',
            date: '2099-06-23',
            time: '12:45',
            line_id: 'banquet-service',
            room: 'Marvel',
            customer_id: 801,
            status: 'confirmed',
            category: 'custom',
            label: 'Kitchen',
            extra_data: {
                bookingPackage: {
                    menuPositions: [{ productId: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 300, subtotal: 600 }],
                    serviceEvents: [{ type: 'food_service', time: '12:45' }]
                }
            }
        },
        {
            id: 'BK-ROLE-ANIMATION',
            business_context: 'event_genix',
            date: '2099-06-23',
            time: '13:45',
            line_id: 'animator-1',
            room: 'Marvel',
            customer_id: 801,
            status: 'confirmed',
            category: 'animation',
            program_id: 'anim60',
            program_name: 'Animation 60',
            price: 1500,
            extra_data: {
                bookingPackage: {
                    programBasePrice: 1500,
                    positionsSubtotal: 1500,
                    finalTotal: 1500,
                    menuPositions: [],
                    serviceEvents: []
                }
            }
        },
        {
            id: 'BK-ROLE-SHOW',
            business_context: 'event_genix',
            date: '2099-06-23',
            time: '14:30',
            line_id: 'animator-2',
            room: 'Marvel',
            customer_id: 801,
            status: 'confirmed',
            category: 'show',
            program_id: 'bubble',
            program_name: 'Bubble show',
            price: 2400,
            extra_data: {
                bookingPackage: {
                    programBasePrice: 2400,
                    positionsSubtotal: 2400,
                    finalTotal: 2400,
                    menuPositions: [],
                    serviceEvents: []
                }
            }
        }
    ];
    const memberships = [
        { booking_id: 'BK-ROLE-ROOT', group_id: 'BQ-ROLE', role: 'primary', primary_booking_id: 'BK-ROLE-ROOT', group_status: 'active' },
        { booking_id: 'BK-ROLE-ANIMATION', group_id: 'BQ-ROLE', role: 'kitchen', primary_booking_id: 'BK-ROLE-ROOT', group_status: 'active' },
        { booking_id: 'BK-ROLE-SHOW', group_id: 'BQ-ROLE', role: 'kitchen', primary_booking_id: 'BK-ROLE-ROOT', group_status: 'active' }
    ];

    const plan = buildPlan(bookings, memberships);
    assert.equal(plan.proposed.length, 1);
    assert.equal(plan.skipped.length, 0);
    assert.equal(plan.proposed[0].existingGroupId, 'BQ-ROLE');
    assert.deepEqual(Array.from(plan.proposed[0].membershipsToAdd), []);
    assert.deepEqual(
        Array.from(plan.proposed[0].roleUpdates, update => `${update.bookingId}:${update.currentRole}->${update.expectedRole}`),
        ['BK-ROLE-ANIMATION:kitchen->activity', 'BK-ROLE-SHOW:kitchen->activity']
    );
    assert.deepEqual(
        Array.from(plan.proposed[0].roles, role => `${role.bookingId}:${role.role}:${role.alreadyMember}`),
        [
            'BK-ROLE-ROOT:primary:true',
            'BK-ROLE-ANIMATION:activity:true',
            'BK-ROLE-SHOW:activity:true'
        ]
    );

    const roleByBookingId = new Map(memberships.map(row => [row.booking_id, row.role]));
    const updates = [];
    const db = {
        query: async (sql, params) => {
            if (/UPDATE banquet_group_bookings/i.test(sql)) {
                const [groupId, bookingId, businessContext, role] = params;
                assert.equal(groupId, 'BQ-ROLE');
                assert.equal(businessContext, 'event_genix');
                if (roleByBookingId.get(bookingId) !== role) {
                    roleByBookingId.set(bookingId, role);
                    updates.push({ bookingId, role });
                    return { rows: [{ booking_id: bookingId, role }], rowCount: 1 };
                }
                return { rows: [], rowCount: 0 };
            }
            if (/UPDATE banquet_groups/i.test(sql)) {
                assert.equal(params[0], 'BQ-ROLE');
                assert.equal(params[1], 'event_genix');
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };

    const applied = await applyRoleUpdates(db, plan.proposed[0]);
    assert.deepEqual(
        Array.from(applied, update => `${update.bookingId}:${update.previousRole}->${update.role}`),
        ['BK-ROLE-ANIMATION:kitchen->activity', 'BK-ROLE-SHOW:kitchen->activity']
    );
    assert.deepEqual(updates, [
        { bookingId: 'BK-ROLE-ANIMATION', role: 'activity' },
        { bookingId: 'BK-ROLE-SHOW', role: 'activity' }
    ]);

    const repairedMemberships = memberships.map(row => ({
        ...row,
        role: roleByBookingId.get(row.booking_id)
    }));
    const repairedPlan = buildPlan(bookings, repairedMemberships);
    assert.equal(repairedPlan.proposed.length, 0);
    assert.equal(repairedPlan.skipped.length, 1);
    assert.equal(repairedPlan.skipped[0].reason, 'already_grouped');
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

test('booking modal banquet UX renders root menu, service checklist, and activities without legacy clutter', () => {
    const context = createBanquetModalDetailHarness();
    const rootBooking = {
        id: 'BK-UX-ROOT',
        businessContext: 'event_genix',
        date: '2026-06-19',
        time: '12:45',
        room: 'Марвел',
        label: 'Кухня',
        status: 'confirmed',
        price: 4780,
        extraData: {
            bookingPackage: {
                finalTotal: 4780,
                menuPositions: [
                    {
                        id: 'menu-1',
                        title: 'Ковбаски гриль',
                        kitchenType: 'menu',
                        quantity: 1,
                        servingUnit: 'порція',
                        unitPrice: 350,
                        subtotal: 350,
                        servingTime: '12:45'
                    }
                ],
                serviceEvents: [
                    { id: 'setup-1', type: 'room_setup', title: 'Підготувати кімнату', time: '12:00' },
                    { id: 'drinks-1', type: 'drinks', title: 'Напої', time: '15:45' }
                ]
            },
            bookingWorkspace: {
                comments: {
                    kitchen: 'Підготувати дитячий стіл',
                    internal: 'Перевірити оплату перед листом'
                }
            }
        }
    };
    const snapshot = {
        source: 'group',
        groupId: 'BQ-UX',
        group: {
            id: 'BQ-UX',
            groupName: 'UX test banquet',
            date: '2026-06-19',
            room: 'Марвел',
            status: 'active'
        },
        members: [
            { bookingId: 'BK-UX-ROOT', role: 'primary', isPrimary: true, booking: rootBooking },
            {
                bookingId: 'BK-UX-AN',
                role: 'activity',
                booking: {
                    id: 'BK-UX-AN',
                    date: '2026-06-19',
                    time: '13:45',
                    room: 'Марвел',
                    label: 'АН(60)',
                    status: 'confirmed',
                    price: 1500,
                    notes: 'Попросити аніматора прийти раніше'
                }
            },
            {
                bookingId: 'BK-UX-BUBBLES',
                role: 'activity',
                booking: {
                    id: 'BK-UX-BUBBLES',
                    date: '2026-06-19',
                    time: '12:00',
                    room: 'Марвел',
                    label: 'Бульбашкове шоу',
                    status: 'confirmed',
                    price: 2400
                }
            }
        ],
        warnings: []
    };

    const html = context.renderFullBanquetDetail(rootBooking, [], snapshot);
    const dom = new JSDOM(`<main>${html}</main>`);
    const document = dom.window.document;
    const text = document.body.textContent;

    assert.equal(document.querySelectorAll('.booking-banquet-section--summary .booking-banquet-member--primary').length, 1);
    const menuSection = document.querySelector('.booking-banquet-section--menu');
    const menuText = menuSection?.textContent || '';
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-row').length, 3);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-row--entertainment').length, 2);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-head').length, 1);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-serving-title').length, 0);
    assert.match(menuText, /Загальна сума/);
    assert.doesNotMatch(menuText, /Разом пакет/);
    assert.doesNotMatch(menuText, /Меню:\s*1/);
    assert.doesNotMatch(menuText, /Розваги:\s*2/);
    assert.doesNotMatch(menuText, /Позиції меню/);
    assert.doesNotMatch(menuText, /Розважальні позиції/);
    assert.doesNotMatch(menuText, /РОЗВАГИ/);
    assert.doesNotMatch(menuText, /1\s*позиці/);
    assert.match(menuText, /Ковбаски гриль/);
    assert.match(menuText, /АН\(60\)/);
    assert.match(menuText, /Бульбашкове шоу/);
    assert.match(menuText, /8\s*680/);
    assert.equal(document.querySelectorAll('.booking-banquet-section--service .booking-banquet-service-row--checklist').length, 2);
    assert.match(document.querySelector('.booking-banquet-section--service')?.textContent || '', /12:00\s*·\s*Підготувати кімнату/);
    assert.match(document.querySelector('.booking-banquet-section--service')?.textContent || '', /15:45\s*·\s*Напої/);
    const commentsSection = document.querySelector('.booking-banquet-section--comments');
    assert.ok(commentsSection, 'full banquet detail renders comments section');
    assert.ok((commentsSection.compareDocumentPosition(menuSection) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0, 'comments are placed before menu');
    assert.ok(commentsSection.querySelector('.booking-banquet-comments--compact'), 'comments render in compact layout');
    assert.match(commentsSection?.textContent || '', /Кухня/);
    assert.match(commentsSection?.textContent || '', /Підготувати дитячий стіл/);
    assert.match(commentsSection?.textContent || '', /Активність\s*—\s*АН\(60\)/);
    assert.match(commentsSection?.textContent || '', /Попросити аніматора прийти раніше/);
    assert.match(commentsSection?.textContent || '', /Внутрішній коментар/);
    assert.match(commentsSection?.textContent || '', /Перевірити оплату перед листом/);
    assert.equal(document.querySelectorAll('.booking-banquet-section--activities .booking-banquet-member--activity').length, 0);
    assert.equal(document.querySelector('.booking-banquet-section--activities'), null);
    assert.equal(document.querySelector('.booking-banquet-section--service')?.textContent.includes('Бульбашкове шоу'), false);
    assert.equal(text.includes('Кухня / меню не прив'), false);
    assert.equal(text.includes('Service / manual'), false);
    assert.equal(text.includes('group-first'), false);
    assert.ok(document.querySelector('details.booking-banquet-technical'), 'technical details stay available but collapsed by default');
    assert.equal(document.querySelector('details.booking-banquet-technical')?.hasAttribute('open'), false);
});

test('booking modal puts primary banquet activity into unified menu without duplicate banquet card', () => {
    const context = createBanquetModalDetailHarness();
    const activity = {
        id: 'BK-ACTIVITY-PRIMARY',
        businessContext: 'event_genix',
        date: '2026-06-24',
        time: '15:00',
        duration: 90,
        room: 'Диван 3',
        label: 'Мафія(90)',
        programName: 'Мафія',
        programId: 'mafia',
        status: 'confirmed',
        price: 2700
    };
    const kitchen = {
        id: 'BK-KITCHEN-MEMBER',
        businessContext: 'event_genix',
        date: '2026-06-24',
        time: '16:30',
        room: 'Диван 3',
        label: 'Кухня',
        status: 'confirmed',
        price: 6600,
        extraData: {
            bookingPackage: {
                finalTotal: 6600,
                menuPositions: [{
                    id: 'menu-veg',
                    title: 'Овочева тарілка',
                    kitchenType: 'menu',
                    quantity: 10,
                    servingUnit: 'порцій',
                    unitPrice: 360,
                    subtotal: 3600,
                    servingTime: '16:30'
                }],
                entryCharge: {
                    title: 'Вхід',
                    quantity: 10,
                    unitPrice: 300,
                    subtotal: 3000
                },
                entrySubtotal: 3000
            },
            bookingWorkspace: {
                comments: {
                    kitchen: 'тест примітка'
                }
            }
        }
    };
    const snapshot = {
        source: 'group',
        groupId: 'BQ-ACTIVITY-FIRST',
        group: {
            id: 'BQ-ACTIVITY-FIRST',
            groupName: 'Мафія(90)',
            date: '2026-06-24',
            room: 'Диван 3',
            status: 'active'
        },
        members: [
            { bookingId: activity.id, role: 'primary', isPrimary: true, booking: activity },
            { bookingId: kitchen.id, role: 'kitchen', booking: kitchen, isKitchenCandidate: true }
        ],
        warnings: []
    };

    const html = context.renderFullBanquetDetail(activity, [], snapshot);
    const dom = new JSDOM(`<main>${html}</main>`);
    const document = dom.window.document;
    const menuSection = document.querySelector('.booking-banquet-section--menu');
    const commentsSection = document.querySelector('.booking-banquet-section--comments');
    const menuText = menuSection?.textContent || '';

    assert.equal(document.querySelector('.booking-banquet-section--summary'), null);
    assert.ok(commentsSection, 'kitchen note renders above activity-first menu');
    assert.ok((commentsSection.compareDocumentPosition(menuSection) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0, 'activity-first kitchen note is placed before menu');
    assert.ok(commentsSection.querySelector('.booking-banquet-comments--compact'), 'activity-first kitchen note uses compact layout');
    assert.match(commentsSection.textContent || '', /Кухня/);
    assert.match(commentsSection.textContent || '', /тест примітка/);
    assert.equal(document.querySelector('.booking-banquet-section--activities'), null);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-row').length, 2);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-row--entertainment').length, 1);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-head').length, 1);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-serving-title').length, 0);
    assert.match(menuText, /Овочева тарілка/);
    assert.match(menuText, /Мафія\(90\)/);
    assert.match(menuText, /Вхід/);
    assert.doesNotMatch(menuText, /РОЗВАГИ/);
    assert.doesNotMatch(menuText, /Меню:\s*1/);
    assert.doesNotMatch(menuText, /Розваги:\s*1/);
    assert.doesNotMatch(menuText, /Позиції меню/);
    assert.doesNotMatch(menuText, /Розважальні позиції/);
    assert.doesNotMatch(menuText, /1\s*позиці/);
    assert.match(menuText, /9\s*300/);
});

test('booking modal banquet root header shows planned schedule instead of technical time range', () => {
    const context = createBanquetModalDetailHarness();
    const rootBooking = {
        id: 'BK-2026-0489',
        businessContext: 'event_genix',
        date: '2026-06-19',
        time: '12:45',
        duration: 30,
        room: 'Марвел',
        label: 'Кухня',
        status: 'confirmed',
        price: 4780,
        extraData: {
            bookingPackage: {
                finalTotal: 4780,
                menuPositions: [
                    {
                        id: 'menu-1',
                        title: 'Ковбаски гриль',
                        kitchenType: 'menu',
                        quantity: 1,
                        servingUnit: 'порція',
                        unitPrice: 350,
                        subtotal: 350,
                        servingTime: '12:45'
                    },
                    {
                        id: 'menu-2',
                        title: 'Мʼясне плато',
                        kitchenType: 'menu',
                        quantity: 1,
                        servingUnit: 'порція',
                        unitPrice: 440,
                        subtotal: 440,
                        servingTime: '18:45'
                    }
                ],
                serviceEvents: [
                    { id: 'setup-1', type: 'room_setup', title: 'Підготувати кімнату', time: '12:00' },
                    { id: 'drinks-1', type: 'drinks', title: 'Напої', time: '15:45' }
                ]
            }
        }
    };
    const activityBooking = {
        id: 'BK-2026-0490',
        businessContext: 'event_genix',
        date: '2026-06-19',
        time: '13:45',
        duration: 60,
        room: 'Марвел',
        label: 'АН(60)',
        programName: 'Анімація 60хв',
        status: 'confirmed',
        price: 1500
    };
    const snapshot = {
        source: 'group',
        groupId: 'BQ-MQKO10RC-536C67A4',
        group: {
            id: 'BQ-MQKO10RC-536C67A4',
            groupName: 'тест група',
            date: '2026-06-19',
            room: 'Марвел',
            status: 'active'
        },
        members: [
            { bookingId: 'BK-2026-0489', role: 'primary', isPrimary: true, isKitchenCandidate: true, booking: rootBooking },
            { bookingId: 'BK-2026-0490', role: 'activity', booking: activityBooking }
        ],
        warnings: []
    };

    const rootHeader = renderBookingDetailHeaderForTest(context, rootBooking, snapshot, [rootBooking, activityBooking]);
    const rootDocument = new JSDOM(`<main>${rootHeader}</main>`).window.document;
    const rootMetaText = rootDocument.querySelector('.booking-detail-meta')?.textContent || '';
    const rootScheduleText = rootDocument.querySelector('.booking-detail-header-schedule')?.textContent || '';
    const rootText = rootDocument.body.textContent || '';

    assert.match(rootText, /Марвел/);
    assert.match(rootText, /2026-06-19/);
    assert.match(rootText, /#BK-2026-0489/);
    assert.equal(rootMetaText.includes('12:45 - 13:15'), false);
    assert.match(rootScheduleText, /Видачі/);
    assert.match(rootScheduleText, /12:45/);
    assert.match(rootScheduleText, /18:45/);
    assert.match(rootScheduleText, /Сервіс/);
    assert.match(rootScheduleText, /12:00/);
    assert.match(rootScheduleText, /Підготувати кімнату/);
    assert.match(rootScheduleText, /15:45/);
    assert.match(rootScheduleText, /Напої/);

    const activityHeader = renderBookingDetailHeaderForTest(context, activityBooking, snapshot, [rootBooking, activityBooking]);
    const activityDocument = new JSDOM(`<main>${activityHeader}</main>`).window.document;
    const activityMetaText = activityDocument.querySelector('.booking-detail-meta')?.textContent || '';
    assert.match(activityMetaText, /13:45 - 14:45/);
    assert.equal(activityDocument.querySelector('.booking-detail-header-schedule'), null);

    const detailHtml = context.renderFullBanquetDetail(rootBooking, [rootBooking, activityBooking], snapshot);
    const detailDocument = new JSDOM(`<main>${detailHtml}</main>`).window.document;
    assert.equal(detailDocument.querySelector('.booking-banquet-section--comments'), null, 'empty notes do not render an empty comments section');

    const emptyPackageRoot = {
        id: 'BK-EMPTY-SCHEDULE',
        date: '2026-06-19',
        time: '10:00',
        duration: 30,
        room: 'Марвел',
        label: 'Кухня',
        banquetGuests: 11,
        extraData: {
            bookingPackage: {
                menuPositions: [],
                serviceEvents: []
            }
        }
    };
    const emptyHeader = renderBookingDetailHeaderForTest(context, emptyPackageRoot, {
        source: 'group',
        groupId: 'BQ-EMPTY',
        members: [{ bookingId: 'BK-EMPTY-SCHEDULE', role: 'primary', isPrimary: true, booking: emptyPackageRoot }]
    });
    const emptyDocument = new JSDOM(`<main>${emptyHeader}</main>`).window.document;
    assert.equal(emptyDocument.querySelector('.booking-detail-header-schedule'), null);
    assert.equal((emptyDocument.querySelector('.booking-detail-meta')?.textContent || '').includes('10:00 - 10:30'), false);
});

test('booking modal banquet overview separates work summary from technical metadata', () => {
    const bookingJs = read('js', 'booking.js');
    assert.match(bookingJs, /function renderFullBanquetDetail\(/);
    assert.match(bookingJs, /function bookingDetailHasMenuOverview\(/);
    assert.match(bookingJs, /function bookingDetailHasServiceOverview\(/);
    assert.match(bookingJs, /function bookingDetailCanOwnBanquetPackage\(/);
    assert.match(bookingJs, /function bookingDetailIsBanquetArrivalMode\(/);
    assert.match(bookingJs, /const bookingDetailDateLabel = isBanquetArrivalMode \? 'Дата банкету' : 'Дата';/);
    assert.match(bookingJs, /const isActivityDetailMode = isActivityDetailBooking;/);
    assert.match(bookingJs, /const bookingDetailTimeLabel = isActivityDetailMode \? 'Час активності' : \(isBanquetArrivalMode \? 'Прихід гостей' : 'Час'\);/);
    assert.match(bookingJs, /const bookingDetailTimeValue = isBanquetArrivalMode \? \(booking\.time \|\| '-'\) : bookingDetailTimeRange;/);
    assert.match(bookingJs, /<span class="label">\$\{escapeHtml\(bookingDetailDateLabel\)\}:<\/span>/);
    assert.match(bookingJs, /<span class="label">\$\{escapeHtml\(bookingDetailTimeLabel\)\}:<\/span>/);
    assert.doesNotMatch(bookingJs, /const bookingDetailDateLabel = isBanquetArrivalMode \? 'Дата\/час'/);
    assert.doesNotMatch(bookingJs, /const bookingDetailTimeLabel = isBanquetArrivalMode \? 'Час'/);
    assert.match(bookingJs, /bookingDetailIsRoot\(booking\)[\s\S]*bookingDetailHasMenuOverview\(booking\)[\s\S]*bookingDetailHasServiceOverview\(booking\)/);
    assert.match(bookingJs, /candidates\.find\(booking => booking && bookingDetailCanOwnBanquetPackage\(booking\)\)/);
    assert.match(bookingJs, /function bookingDetailEntertainmentRowsFromMembers\(/);
    assert.match(bookingJs, /bookingDetailEntertainmentMembers\(primaryMembers, activityMembers\)/);
    assert.match(bookingJs, /if \(\(!packageBooking \|\| !bookingDetailHasMenuOverview\(packageBooking\)\) && !entertainmentRows\.length\) return '';/);
    assert.match(bookingJs, /renderBanquetWorkSection\('Банкет'/);
    assert.match(bookingJs, /renderBanquetMenuSection\(packageBooking, entertainmentMembers\)/);
    assert.match(bookingJs, /renderBanquetServiceSection\(packageBooking, serviceManualMembers\)/);
    assert.match(bookingJs, /renderBanquetActivitiesSection\(visibleActivityMembers\)/);
    assert.match(bookingJs, /renderBanquetWarningsSection\(warnings\)/);
    assert.match(bookingJs, /renderBanquetTechnicalSection\(\{/);
    assert.match(bookingJs, /includeServiceEvents: false/);
    assert.match(bookingJs, /booking-detail-package-table/);
    assert.match(bookingJs, /booking-detail-package-table-row/);
    assert.match(bookingJs, /booking-detail-package-service-row/);
    assert.match(bookingJs, /booking-banquet-service-row--checklist/);
    assert.match(bookingJs, /\$\{event\.time \? `\$\{escapeHtml\(event\.time\)\} · ` : ''\}/);
    assert.match(bookingJs, /booking-customer-block--priority/);
    assert.doesNotMatch(bookingJs, /group-first/);
    assert.doesNotMatch(bookingJs, /Service \/ manual/);
    assert.doesNotMatch(bookingJs, /Кухня \/ меню не прив/);
    assert.doesNotMatch(bookingJs, /Технічні linked_to children/);
    assert.doesNotMatch(bookingJs, /<strong>\$\{escapeHtml\(BOOKING_SERVICE_EVENT_TYPES\[event\.type\] \|\| 'Подія'\)\}<\/strong>/);
});
