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
    buildBookingPackage,
    applyBookingPackage,
    bookingPackageAudit
} = require('../services/bookingPackage');
const {
    buildBanquetPreorderRuleContract,
    buildBanquetPreorderStatus
} = require('../services/banquetPreorderRules');
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
    banquetSummaryModeContract,
    buildBanquetSummary
} = require('../services/banquetSummary');
const BookingActivitySchedule = require('../js/booking-activity-schedule');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
function extractNamedFunction(source, name) {
    const start = source.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `${name} should exist`);
    const bodyStart = source.indexOf('{', start);
    assert.notEqual(bodyStart, -1, `${name} should have a body`);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    assert.fail(`${name} body should close`);
}
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
        arrival: {
            date: '2026-08-30',
            time: '14:00',
            room: 'Grand Crystal Hall With Long Name',
            source: 'banquet_group'
        },
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
                    iconUrl: '/uploads/catalog-images/items/menu-juice-generated.png',
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
                    icon_url: '/uploads/catalog-images/items/cake-generated.png',
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
    context.refreshAnimatorSelectsForCurrentSlot = async () => {
        dependencyCalls.animatorRefreshes += 1;
    };
    context.getBookingFormData = () => ({
        hasEvent: true,
        activityPrograms: programs,
        time: fields.get('bookingTime')?.value || options.baseTime || '12:00',
        duration: options.duration || programs[0]?.duration || 30,
        lineId: options.lineId || 'line-main',
        room: options.room || 'Room A',
        secondAnimator: options.secondAnimator || null,
        secondAnimatorLineId: options.secondAnimatorLineId || null,
        secondAnimatorLineName: options.secondAnimatorLineName || null
    });
    return context;
}

function createBanquetModalDetailHarness() {
    const bookingJs = read('js', 'booking.js');
    const packageRendererJs = read('js', 'booking-package-renderer.js');
    const banquetDetailJs = read('js', 'booking-banquet-detail.js');
    const quantityHelperStart = bookingJs.indexOf('const BOOKING_MENU_PORTION_UNITS');
    const quantityHelperEnd = bookingJs.indexOf('function isBookingMenuCatalogProduct');
    const packageStart = bookingJs.indexOf('function bookingPackageRendererCall(');
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
        renderBookingBanquetLinksDetail: () => '',
        isViewer: () => true
    };
    vm.createContext(context);
    vm.runInContext(packageRendererJs, context, { filename: 'js/booking-package-renderer.js' });
    vm.runInContext(banquetDetailJs, context, { filename: 'js/booking-banquet-detail.js' });
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

function multiActivitySchedulePrograms() {
    return [
        { id: 'anim-30', code: 'AN', label: 'Anim(30)', name: 'Animation', category: 'animation', duration: 30, price: 1500, hosts: 1 },
        { id: 'show-40', code: 'WOW', label: 'Wow(40)', name: 'Wow show', category: 'show', duration: 40, price: 2400, hosts: 1 },
        { id: 'photo-20', code: 'PH', label: 'Photo(20)', name: 'Photo', category: 'photo', duration: 20, price: 900, hosts: 1 }
    ];
}

function createHarnessElement(overrides = {}) {
    const element = {
        tagName: overrides.tagName || 'INPUT',
        value: overrides.value || '',
        textContent: overrides.textContent || '',
        dataset: overrides.dataset || {},
        disabled: false,
        hidden: false,
        children: [],
        classList: {
            contains: () => false,
            toggle: () => {},
            add: () => {},
            remove: () => {}
        },
        appendChild(child) {
            this.children.push(child);
            this.options = this.children;
            return child;
        },
        setAttribute(name, value) {
            this[name] = String(value);
        },
        removeAttribute(name) {
            delete this[name];
        },
        focus: () => {},
        ...overrides
    };
    if (!element.dataset) element.dataset = {};
    if (!element.children) element.children = [];
    if (!element.classList) {
        element.classList = {
            contains: () => false,
            toggle: () => {},
            add: () => {},
            remove: () => {}
        };
    }
    return element;
}

function createHarnessSelect(value = '', dataset = {}) {
    const element = createHarnessElement({
        tagName: 'SELECT',
        value,
        dataset: { ...dataset },
        children: [],
        options: []
    });
    Object.defineProperty(element, 'innerHTML', {
        get() {
            return this._innerHTML || '';
        },
        set(value) {
            this._innerHTML = String(value || '');
            this.children = [];
            this.options = this.children;
        }
    });
    Object.defineProperty(element, 'selectedOptions', {
        get() {
            return this.options.filter(option => option.selected || option.value === this.value).slice(0, 1);
        }
    });
    return element;
}

function createMultiActivityScheduleHarness(options = {}) {
    const bookingJs = read('js', 'booking.js');
    const start = bookingJs.indexOf('function bookingMultiActivityEnabled');
    const end = bookingJs.indexOf('function buildMaysternyaClosedSlotBooking', start);
    const banquetEditStart = bookingJs.indexOf('function banquetEditBookingValue');
    const banquetEditEnd = bookingJs.indexOf('function bookingEditConflictExcludeIds', banquetEditStart);
    assert.ok(start >= 0 && end > start, 'multi-activity schedule helper slice exists');
    assert.ok(banquetEditStart >= 0 && banquetEditEnd > banquetEditStart, 'banquet edit activity hydration helper slice exists');

    const programs = options.programs || multiActivitySchedulePrograms();
    const fieldValues = options.fieldValues || {};
    const timers = [];
    const dependencyCalls = {
        animatorRefreshes: 0,
        roomAvailability: [],
        banquetSelectorRenders: 0,
        groupCandidateRefreshes: []
    };
    const fields = new Map(Object.entries({
        bookingTime: createHarnessSelect(options.baseTime || '12:00', { currentTime: options.baseTime || '12:00' }),
        bookingTimeStepBack: createHarnessElement({ tagName: 'BUTTON' }),
        bookingTimeStepForward: createHarnessElement({ tagName: 'BUTTON' }),
        bookingTimeHint: createHarnessElement({ tagName: 'SMALL', value: '', textContent: '', dataset: {} }),
        selectedProgram: createHarnessElement({ tagName: 'SELECT', value: programs[0]?.id || '' }),
        customDuration: createHarnessElement({ value: String(options.customDuration || '') }),
        bookingLine: createHarnessElement({ tagName: 'SELECT', value: options.lineId || 'line-main' }),
        roomSelect: createHarnessElement({ tagName: 'SELECT', value: options.room || 'Room A' }),
        bookingPrimaryAnimatorSection: createHarnessElement({
            classList: {
                contains: className => className === 'hidden' && options.primaryAnimatorVisible === false,
                toggle: () => {},
                add: () => {},
                remove: () => {}
            }
        }),
        bookingPrimaryAnimatorSelect: createHarnessSelect(options.primaryAnimator || ''),
        secondAnimatorSection: createHarnessElement({
            classList: {
                contains: className => className === 'hidden' && options.secondAnimatorSectionVisible !== true,
                toggle: () => {},
                add: () => {},
                remove: () => {}
            }
        }),
        secondAnimatorSelect: createHarnessSelect(options.secondAnimator || ''),
        extraHostToggle: createHarnessElement({ checked: Boolean(options.extraHostVisible) }),
        extraHostAnimatorSelect: createHarnessSelect(options.extraHostAnimator || ''),
        customerName: createHarnessElement({ value: fieldValues.customerName || '' }),
        bookingGroupName: createHarnessElement({ value: fieldValues.bookingGroupName || '' }),
        bookingGuestArrivalTime: createHarnessElement({ type: 'time', value: fieldValues.bookingGuestArrivalTime || '' }),
        bookingNotes: createHarnessElement({ tagName: 'TEXTAREA', value: fieldValues.bookingNotes || '' })
    }));
    const notifications = [];
    const revealed = [];
    const context = {
        console,
        setTimeout: callback => {
            timers.push(callback);
            return timers.length;
        },
        clearTimeout: () => {},
        window: {
            BookingActivitySchedule
        },
        BookingActivitySchedule,
        CONFIG: {
            TIMELINE: {
                WEEKDAY_START: 12,
                WEEKDAY_END: 20,
                WEEKEND_START: 10,
                WEEKEND_END: 20
            }
        },
        document: {
            getElementById: id => fields.get(id) || createHarnessElement({ value: '' }),
            createElement: tagName => createHarnessElement({ tagName: String(tagName || '').toUpperCase(), dataset: {} }),
            querySelector: () => null,
            querySelectorAll: () => []
        },
        AppState: { selectedDate: new Date('2099-02-13T00:00:00'), editingBookingId: null },
        BookingDrawerState: {
            selectedActivityProgramIds: programs.map(program => String(program.id)),
            selectedActivityScheduleTimes: { ...(options.scheduleTimes || {}) },
            selectedActivityScheduleIssues: {},
            selectedActivityPinataFields: {},
            selectedActivitySecondAnimatorFields: { ...(options.secondAnimatorFields || {}) },
            selectedBanquetGroupId: options.selectedBanquetGroupId || '',
            explicitBanquetContext: options.explicitBanquetContext || null,
            roomSelectionBanquetContext: options.roomSelectionBanquetContext || null,
            activeBanquetIntent: options.activeBanquetIntent || null,
            activeBanquetRoleIntent: options.activeBanquetRoleIntent || null,
            selectedActivityPreflight: {
                status: 'idle',
                message: '',
                lastError: '',
                failedAt: null,
                overrideUsed: false
            }
        },
        getProductsSync: () => programs,
        isParkTimelineBookingMode: () => true,
        isMaysternyaBookingContext: () => false,
        isEducationTimelineBookingMode: () => false,
        isPinataProgram: program => String(program?.category || '').toLowerCase() === 'pinata',
        useSelectedActivityPinataSubflow: () => true,
        resetPinataModeFields: () => {},
        syncPinataModeFields: () => {},
        _loadPinataStockBadge: () => {},
        isClientPinataFillerChoice: value => String(value || '') === 'client_filler',
        isClientPinataFillerNumber: value => String(value || '') === 'client_filler',
        getClientPinataDefaultPrice: () => 300,
        resolveBookingChildrenCountSource: () => ({ value: null }),
        bookingProgramUsesStandaloneChildrenInput: () => false,
        bookingChildrenCountFromBooking: booking => booking?.kidsCount || null,
        buildExtraData: programId => ({ productId: programId }),
        buildBookingWorkspaceExtraData: () => ({ source: 'test_schedule_harness' }),
        formatDate: value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)),
        normalizeBookingDateKey: value => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)),
        timeToMinutes: value => {
            const [hours, minutes] = String(value || '00:00').split(':').map(Number);
            return (hours * 60) + minutes;
        },
        minutesToTime: value => {
            const minutes = ((Number(value) % 1440) + 1440) % 1440;
            return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        },
        toBookingMoney: value => Math.round(Number(value || 0) * 100) / 100,
        isOperationalBookingRoomValue: value => Boolean(String(value || '').trim()),
        getBookingsForDate: options.getBookingsForDate || (async () => []),
        getLinesForDate: options.getLinesForDate || (async () => []),
        apiGetLines: options.apiGetLines || (async () => []),
        apiGetBookings: options.apiGetBookings || (async () => []),
        isRoomFirstTimelineView: options.isRoomFirstTimelineView || (() => false),
        checkConflicts: options.checkConflicts || (async () => ({ overlap: false })),
        getBookingFormData: () => ({
            hasEvent: true,
            activityPrograms: programs,
            time: fields.get('bookingTime')?.value || options.baseTime || '12:00',
            duration: options.duration || programs[0]?.duration || 30,
            lineId: options.lineId || 'line-main',
            room: options.room || 'Room A',
            secondAnimator: options.secondAnimator || null,
            secondAnimatorLineId: options.secondAnimatorLineId || null,
            secondAnimatorLineName: options.secondAnimatorLineName || null
        }),
        renderSelectedProgramSummary: () => {},
        renderBookingPackageSummary: () => {},
        refreshBookingActiveBanquetRoleIntent: () => {},
        updateBookingSubmitState: () => {},
        updateSelectedProgramCards: () => {},
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;'),
        refreshAnimatorSelectsForCurrentSlot: async () => {
            dependencyCalls.animatorRefreshes += 1;
        },
        refreshBookingRoomAvailabilityForSelectedDate: async refreshOptions => {
            dependencyCalls.roomAvailability.push(refreshOptions || {});
            return [];
        },
        scheduleSelectedActivityConflictRefresh: () => {},
        bookingEditConflictExcludeIds: () => null,
        pickRoomBanquetSourceBooking: options.pickRoomBanquetSourceBooking || (() => null),
        fetchFreshRoomBanquetSourceBooking: options.fetchFreshRoomBanquetSourceBooking || (async () => null),
        renderBookingBanquetGroupSelector: () => {
            dependencyCalls.banquetSelectorRenders += 1;
        },
        refreshBookingBanquetGroupCandidates: async refreshOptions => {
            dependencyCalls.groupCandidateRefreshes.push(refreshOptions || {});
        },
        buildBookingRoomSourceContext: (booking, sourceContext = {}) => ({
            ...sourceContext,
            sourceBookingId: booking?.id || null,
            groupId: booking?.groupId || booking?.group_id || null
        }),
        sourceBookingToBanquetContext: booking => ({
            groupId: booking?.groupId || booking?.group_id || null,
            sourceBookingId: booking?.id || null,
            customerId: booking?.customerId || booking?.customer_id || null
        }),
        attachBookingRoomSourceContext: (contextValue = {}, sourceContext = {}) => ({
            ...(contextValue || {}),
            roomSourceContext: sourceContext || null
        }),
        bookingBanquetGroupSelectedCustomerId: () => options.selectedCustomerId || null,
        roomBookingCustomerId: booking => booking?.customerId || booking?.customer_id || null,
        roomBookingLooksLikeKitchen: booking => String(booking?.category || '').toLowerCase() === 'kitchen',
        roomSelectionBanquetContextFromSnapshot: (snapshot, sourceBooking) => ({
            groupId: snapshot?.group?.id || sourceBooking?.groupId || sourceBooking?.group_id || null,
            sourceBookingId: sourceBooking?.id || null
        }),
        apiGetBanquetByBooking: options.apiGetBanquetByBooking || (async sourceBookingId => ({
            success: true,
            group: { id: `BQ-${sourceBookingId}` }
        })),
        showNotification: (message, type) => notifications.push({ message, type }),
        revealHiddenBooking: id => revealed.push(id),
        CLIENT_PINATA_FILLER_VALUE: 'client_filler',
        ROOM_FIRST_BANQUET_SERVICE_LINE_ID: 'banquet-service'
    };
    context.window.BookingForm = { _dirty: false };
    context.BookingForm = context.window.BookingForm;
    context.window.TimelineBusinessContext = {
        presentation: () => ({ mode: 'park' }),
        current: () => ({ apiValue: 'event_genix' })
    };
    vm.createContext(context);
    vm.runInContext(`${bookingJs.slice(start, end)}\n${bookingJs.slice(banquetEditStart, banquetEditEnd)}`, context, { filename: 'js/booking.js' });
    if (!options.useRealAnimatorRefresh) {
        context.refreshAnimatorSelectsForCurrentSlot = async () => {
            dependencyCalls.animatorRefreshes += 1;
        };
    }
    context.getBookingFormData = () => ({
        hasEvent: true,
        activityPrograms: programs,
        time: fields.get('bookingTime')?.value || options.baseTime || '12:00',
        duration: options.duration || programs[0]?.duration || 30,
        lineId: options.lineId || 'line-main',
        room: options.room || 'Room A',
        secondAnimator: options.secondAnimator || null,
        secondAnimatorLineId: options.secondAnimatorLineId || null,
        secondAnimatorLineName: options.secondAnimatorLineName || null
    });
    context.renderSelectedProgramSummary = () => {};
    context.renderBookingPackageSummary = () => {};
    context.buildBookingWorkspaceExtraData = () => ({ source: 'test_schedule_harness' });
    context.__programs = programs;
    context.__fields = fields;
    context.__timers = timers;
    context.__calls = dependencyCalls;
    context.__notifications = notifications;
    context.__revealed = revealed;
    return context;
}

function createBookingPinataLabelHarness() {
    const bookingJs = read('js', 'booking.js');
    const start = bookingJs.indexOf('function _escB');
    const end = bookingJs.indexOf('async function loadPinataPickerStatus', start);
    assert.ok(start >= 0 && end > start, 'booking pinata label helper slice exists');
    const context = {
        window: {},
        console
    };
    vm.createContext(context);
    vm.runInContext(`
        ${bookingJs.slice(start, end)}
        this.__pinataLabelHooks = { pinataChoiceDisplayLabel, renderPinataChoiceCard };
    `, context, { filename: 'js/booking.js' });
    return context.__pinataLabelHooks;
}

function createBookingActivityPromoHarness(products = []) {
    const bookingJs = read('js', 'booking.js');
    const start = bookingJs.indexOf('const BOOKING_ACTIVITY_KNOWN_CATALOG_URLS');
    const end = bookingJs.indexOf('function bookingActivitiesTotalPrice', start);
    assert.ok(start >= 0 && end > start, 'booking activity promo helper slice exists');
    const dom = new JSDOM(`
        <!doctype html>
        <html><body><div id="bookingPanel"></div></body></html>
    `, { url: 'http://localhost/booking.html' });
    const openedPromoUrls = [];
    const context = {
        console,
        document: dom.window.document,
        window: dom.window,
        __products: products,
        __openedPromoUrls: openedPromoUrls,
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;'),
        isPinataProgram: program => String(program?.category || '').toLowerCase() === 'pinata',
        getProductsSync: () => context.__products,
        openSafeNewTab: url => {
            openedPromoUrls.push(url);
        }
    };
    context.window.open = url => {
        openedPromoUrls.push(url);
        return null;
    };
    vm.createContext(context);
    vm.runInContext(`
        ${bookingJs.slice(start, end)}
        this.__activityPromoHooks = {
            resolveBookingActivityPromoSource,
            renderBookingActivityPromoAction,
            openBookingActivityPromo,
            openBookingActivityPromoById,
            bindBookingActivityPromoActions,
            closeBookingActivityPromoPanel
        };
    `, context, { filename: 'js/booking.js' });
    const hooks = context.__activityPromoHooks;
    hooks.document = dom.window.document;
    hooks.window = dom.window;
    hooks.openedPromoUrls = openedPromoUrls;
    hooks.context = context;
    return hooks;
}

function createBookingDrawerSummaryHarness(options = {}) {
    const bookingJs = read('js', 'booking.js');
    const start = bookingJs.indexOf('function bookingMenuRuleForPlaceType');
    const end = bookingJs.indexOf("if (typeof window !== 'undefined' && window.BookingPackageRenderer)", start);
    assert.ok(start >= 0 && end > start, 'booking drawer summary helper slice exists');
    const selectedProgramValue = options.selectedProgramValue ?? 'pinata';
    const customerName = options.customerName ?? 'Test Customer';
    const selectedCustomerId = options.selectedCustomerId ?? '';
    const roomValue = options.roomValue ?? 'Room A';
    const roomText = options.roomText ?? roomValue;
    const selectedCustomerCardName = options.selectedCustomerCardName ?? customerName;
    const dom = new JSDOM(`
        <!doctype html>
        <html>
            <body>
                <div id="bookingPackageSummary"></div>
                <input id="selectedProgram" value="${selectedProgramValue}">
                <input id="customerName" value="${customerName}">
                <input id="selectedCustomerId" value="${selectedCustomerId}">
                <input id="customDuration" value="${options.customDuration ?? 30}">
                <select id="roomSelect"><option value="${roomValue}" selected>${roomText}</option></select>
                <div id="bookingSelectedCustomerCard"><strong>${selectedCustomerCardName}</strong></div>
            </body>
        </html>
    `);
    const programs = options.programs || [
        {
            id: 'pinata',
            code: 'PIN',
            label: 'PIN(15)',
            name: 'Pinata',
            category: 'pinata',
            duration: 15,
            price: 700,
            hosts: 1,
            age: '2-99р',
            kids: 'до 15',
            promoDescription: 'Catalog promo'
        },
        {
            id: 'bubble',
            code: 'BUB',
            label: 'BUB(30)',
            name: 'Bubble Show',
            category: 'show',
            duration: 30,
            price: 2400,
            hosts: 2,
            age: '2-8р',
            kids: '2-16',
            description: 'Bubble promo'
        }
    ];
    const menuPositions = options.menuPositions || [{
        title: 'Pizza',
        quantity: 2,
        servingUnit: 'portion',
        unitPrice: 250,
        subtotal: 500,
        servingTime: '14:30',
        note: 'warm'
    }];
    const hasEvent = options.hasEvent ?? true;
    const roomFirst = options.roomFirst ?? false;
    const kitchenEnabled = options.kitchenEnabled ?? true;
    const packageTotals = options.packageTotals || {
        programBasePrice: 3100,
        positionsSubtotal: 500,
        entrySubtotal: 0,
        finalTotal: 3600,
        menuPositions,
        activityPrograms: programs,
        warnings: []
    };
    const context = {
        console,
        document: dom.window.document,
        window: dom.window,
        BookingDrawerState: { validationAttempted: false },
        BookingPackageState: {
            menuWorkflow: null,
            menuRuleContract: buildBanquetPreorderRuleContract([]),
            menuRuleLoadStatus: 'loaded'
        },
        normalizeBookingMenuWorkflow: value => value && typeof value === 'object' ? value : null,
        collectBookingMenuWorkflowForSubmit: () => null,
        normalizeBookingMenuWorkflowStatus: (value, mode) => value || (mode === 'actual' ? 'awaiting_actual' : null),
        normalizeBookingMenuWorkflowSnapshot: value => value && typeof value === 'object' ? value : null,
        bookingPreorderMoney: (value, fallback = 0) => {
            const number = Number(value);
            return Number.isFinite(number) ? Math.round(number * 100) / 100 : fallback;
        },
        bookingPreorderFormatMoney: value => String(Number(value || 0)) + ' грн',
        CLIENT_PINATA_FILLER_VALUE: 'client_filler',
        ROOM_FIRST_BANQUET_SERVICE_LINE_ID: 'banquet-service',
        CLIENT_PINATA_FILLER_LABEL: 'Client filler',
        updateBookingContextHeaderSummary: () => {},
        getBookingWorkspaceHasEvent: () => hasEvent,
        getProductsSync: () => programs,
        isRoomFirstTimelineView: () => roomFirst,
        isBookingKitchenEnabled: () => kitchenEnabled,
        getSmartBookingValidationState: () => ({ canSubmit: true, warnings: [] }),
        getBookingDepositFormData: () => null,
        getBookingPackageTotals: () => packageTotals,
        toBookingMoney: value => Math.round(Number(value || 0) * 100) / 100,
        formatPrice: value => `${Number(value || 0)} грн`,
        bookingActivityPriceValue: program => Math.round(Number(program?.price || 0) * 100) / 100,
        formatBookingPackageEntryAmount: entry => `${Number(entry?.subtotal || 0)} грн`,
        formatBookingMenuPositionQuantity: item => `${item.quantity} portions`,
        getSelectedActivityScheduleRows: () => options.scheduleRows || [
            { programId: 'pinata', program: programs[0], time: '13:00', endTime: '13:15' },
            { programId: 'bubble', program: programs[1], time: '13:20', endTime: '13:50' }
        ],
        selectedActivityScheduleLabel: row => `${row.time}-${row.endTime}`,
        isPinataProgram: program => String(program?.category || '').toLowerCase() === 'pinata',
        useSelectedActivityPinataSubflow: () => true,
        selectedActivityPinataDraft: () => ({
            pinataMode: 'park',
            pinataNumber: '529',
            pinataFillerNumber: 'M',
            pinataFiller: 'M',
            clientPinataServicePrice: null,
            clientPinataServiceNote: null
        }),
        currentPinataChoice: () => ({
            number: '529',
            value: '529',
            title: '\u041f\u0456\u043d\u044c\u044f\u0442\u0430 \u2116529'
        }),
        pinataChoiceDisplayLabel: choice => choice.title,
        bookingPinataNumberDisplay: value => String(value || ''),
        pinataFillerNumberLabel: value => value,
        isClientPinataFillerChoice: value => String(value || '') === 'client_filler',
        renderBookingActivityPromoAction: program => program.description || program.promoDescription
            ? `<button type="button" data-booking-activity-promo="${program.id}">Promo</button>`
            : '',
        renderSelectedActivityPreflightWarning: () => '',
        renderBookingValidationIssues: () => '',
        bindSelectedActivityPreflightWarningActions: () => {},
        bindBookingActivityPromoActions: root => {
            context.__boundPromoButtons = root.querySelectorAll('[data-booking-activity-promo]').length;
        },
        updateBookingSubmitState: () => {},
        escapeHtml: value => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    };
    vm.createContext(context);
    vm.runInContext(`
        ${bookingJs.slice(start, end)}
        this.__summaryHooks = { renderBookingPackageSummary };
    `, context, { filename: 'js/booking.js' });
    return context;
}

function bookingSummaryRows(ctx) {
    return Array.from(ctx.document.querySelectorAll('#bookingPackageSummary .booking-summary-row'));
}

function bookingSummaryRowByLabel(ctx, label) {
    return bookingSummaryRows(ctx).find(row => row.querySelector('span')?.textContent?.trim() === label) || null;
}

function bookingSummaryRowValue(ctx, label) {
    return bookingSummaryRowByLabel(ctx, label)?.querySelector('strong')?.textContent?.trim() || '';
}

function multiActivityBaseBooking() {
    return {
        date: '2099-02-13',
        time: '12:00',
        lineId: 'line-main',
        lineName: 'Anna',
        resourceId: 'line-main',
        resourceType: 'animator',
        programId: 'anim-30',
        programCode: 'AN',
        label: 'Anim(30)',
        programName: 'Animation',
        category: 'animation',
        duration: 30,
        price: 1500,
        hosts: 1,
        secondAnimator: null,
        costume: null,
        room: 'Room A',
        createdBy: 'tester',
        status: 'confirmed',
        kidsCount: null,
        extraData: {
            timelineIdentity: {
                resourceId: 'line-main',
                lineId: 'line-main',
                resourceType: 'animator',
                source: 'booking_form'
            }
        },
        paymentMethod: null
    };
}

test('booking pinata choice labels avoid duplicated operational numbers', () => {
    const hooks = createBookingPinataLabelHarness();
    const pinataTitle = '\u041f\u0456\u043d\u044c\u044f\u0442\u0430 \u2116529';

    assert.equal(
        hooks.pinataChoiceDisplayLabel({ number: '529', value: '529', title: pinataTitle }),
        pinataTitle
    );
    assert.equal(
        hooks.pinataChoiceDisplayLabel({ number: '529', value: '529', title: '\u0404\u0434\u0438\u043d\u043e\u0440\u0456\u0433' }),
        '529 · \u0404\u0434\u0438\u043d\u043e\u0440\u0456\u0433'
    );
    assert.equal(
        hooks.pinataChoiceDisplayLabel({ number: '529', value: '529', title: 'XL #529' }),
        'XL #529'
    );
    const duplicatedCard = hooks.renderPinataChoiceCard({ number: '529', value: '529', title: pinataTitle }, '');
    assert.match(duplicatedCard, /\u041f\u0456\u043d\u044c\u044f\u0442\u0430 \u2116529/);
    assert.doesNotMatch(duplicatedCard, /pinata-choice-number[^>]*>\s*529\s*<\/span>/);

    const customCard = hooks.renderPinataChoiceCard({
        number: '529',
        value: '529',
        title: '\u0404\u0434\u0438\u043d\u043e\u0440\u0456\u0433'
    }, '');
    assert.match(customCard, /pinata-choice-number[^>]*>\s*529\s*<\/span>/);
});

test('booking activity promo resolver prefers catalogs and hides empty promo actions', () => {
    const hooks = createBookingActivityPromoHarness();

    const pinata = hooks.resolveBookingActivityPromoSource({
        id: 'pinata',
        category: 'pinata',
        name: 'Pinata'
    });
    assert.equal(pinata.kind, 'catalog');
    assert.equal(pinata.url, '/designs#catalog-pinyata');

    const card = hooks.resolveBookingActivityPromoSource({
        id: 'bubble',
        name: 'Bubble Show',
        promoDescription: 'Short operator promo',
        imageUrl: '/uploads/bubble.png'
    });
    assert.equal(card.kind, 'card');
    assert.equal(card.text, 'Short operator promo');
    assert.equal(card.imageUrl, '/uploads/bubble.png');

    assert.equal(hooks.resolveBookingActivityPromoSource({ id: 'custom', name: 'Custom' }), null);
    assert.equal(hooks.renderBookingActivityPromoAction({ id: 'custom', name: 'Custom' }), '');
    assert.match(
        hooks.renderBookingActivityPromoAction({ id: 'bubble', name: 'Bubble Show', description: 'Promo' }, 'summary'),
        /data-booking-activity-promo="bubble"/
    );
    assert.match(
        hooks.renderBookingActivityPromoAction({ id: 'bubble', name: 'Bubble Show', description: 'Promo' }, 'selected-activity'),
        /booking-activity-promo-action--selected-activity/
    );
    assert.match(
        hooks.renderBookingActivityPromoAction({ id: 'bubble', name: 'Bubble Show', description: 'Promo' }, 'summary'),
        /booking-activity-promo-action--summary/
    );
    assert.doesNotMatch(
        hooks.renderBookingActivityPromoAction({ id: 'bubble', name: 'Bubble Show', description: 'Promo' }, 'summary'),
        /data-menu-catalog-insight/
    );
});

test('booking activity promo catalog clicks do not bubble into activity selection', () => {
    const hooks = createBookingActivityPromoHarness([{
        id: 'pinata',
        category: 'pinata',
        name: 'Pinata'
    }]);
    const parent = hooks.document.createElement('div');
    let selectedCount = 0;
    let packageTotal = 700;
    parent.addEventListener('click', () => {
        selectedCount += 1;
        packageTotal = 0;
    });
    parent.innerHTML = '<button type="button" data-booking-activity-promo="pinata">Promo</button>';
    hooks.document.getElementById('bookingPanel').appendChild(parent);

    hooks.bindBookingActivityPromoActions(parent);
    const button = parent.querySelector('[data-booking-activity-promo]');
    const event = new hooks.window.MouseEvent('click', { bubbles: true, cancelable: true });
    const result = button.dispatchEvent(event);

    assert.equal(result, false);
    assert.equal(event.defaultPrevented, true);
    assert.equal(selectedCount, 0);
    assert.equal(packageTotal, 700);
    assert.deepEqual(hooks.openedPromoUrls, ['/designs#catalog-pinyata']);
    assert.equal(hooks.document.getElementById('bookingActivityPromoPanel'), null);
});

test('booking activity promo fallback clicks open drawer card without changing selection state', () => {
    const hooks = createBookingActivityPromoHarness([{
        id: 'bubble',
        name: 'Bubble Show',
        description: 'Bright bubble promo',
        imageUrl: '/uploads/bubble.png'
    }]);
    const parent = hooks.document.createElement('div');
    let selectedCount = 0;
    let packageTotal = 2400;
    parent.addEventListener('click', () => {
        selectedCount += 1;
        packageTotal = 0;
    });
    parent.innerHTML = '<button type="button" data-booking-activity-promo="bubble">Promo</button>';
    hooks.document.getElementById('bookingPanel').appendChild(parent);

    hooks.bindBookingActivityPromoActions(parent);
    const button = parent.querySelector('[data-booking-activity-promo]');
    const event = new hooks.window.MouseEvent('click', { bubbles: true, cancelable: true });
    const result = button.dispatchEvent(event);

    assert.equal(result, false);
    assert.equal(event.defaultPrevented, true);
    assert.equal(selectedCount, 0);
    assert.equal(packageTotal, 2400);
    assert.deepEqual(hooks.openedPromoUrls, []);
    const panel = hooks.document.getElementById('bookingActivityPromoPanel');
    assert.ok(panel);
    assert.equal(panel.hidden, false);
    assert.equal(panel.getAttribute('aria-hidden'), 'false');
    assert.match(panel.textContent, /Bubble Show/);
    assert.match(panel.textContent, /Bright bubble promo/);
    assert.equal(panel.querySelector('img')?.getAttribute('src'), '/uploads/bubble.png');

    const close = panel.querySelector('[data-booking-activity-promo-close]');
    close.dispatchEvent(new hooks.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(panel.hidden, true);
    assert.equal(panel.getAttribute('aria-hidden'), 'true');
});

test('booking drawer package summary renders all selected activities, pinata details, menu rows, and promo actions', () => {
    const ctx = createBookingDrawerSummaryHarness();

    ctx.__summaryHooks.renderBookingPackageSummary();

    const summary = ctx.document.getElementById('bookingPackageSummary');
    const text = summary.textContent;
    assert.match(text, /PIN/);
    assert.match(text, /BUB/);
    assert.match(text, /Pizza/);
    assert.match(text, /2 portions/);
    assert.match(text, /3600 грн/);
    assert.match(text, /\u041f\u0456\u043d\u044c\u044f\u0442\u0430 \u2116529/);
    assert.doesNotMatch(text, /529\s*·\s*\u041f\u0456\u043d\u044c\u044f\u0442\u0430 \u2116529/);
    assert.equal(summary.querySelectorAll('.booking-summary-row--activity').length, 2);
    assert.equal(summary.querySelectorAll('.booking-summary-row--menu').length, 1);
    assert.equal(summary.querySelectorAll('[data-booking-activity-promo]').length, 2);
    assert.equal(ctx.__boundPromoButtons, 2);
    assert.match(text, /ведучих: 1/);
    assert.match(text, /ведучих: 2/);
    assert.match(text, /рекомендований вік: 2-99р/);
    assert.match(text, /рекомендована група: до 15 дітей/);
    assert.equal(bookingSummaryRowValue(ctx, 'Сума тривалостей активностей'), '45 хв');
    assert.doesNotMatch(text, /за активностями|макс\./);
});

test('booking drawer package summary uses the edited custom activity duration', () => {
    const customProgram = {
        id: 'custom',
        code: 'Інше',
        label: 'Інше',
        name: 'Інше (вкажіть)',
        category: 'custom',
        duration: 30,
        price: 0,
        hosts: 1,
        isCustom: true
    };
    const ctx = createBookingDrawerSummaryHarness({
        selectedProgramValue: 'custom',
        customDuration: 75,
        programs: [customProgram],
        scheduleRows: [{ programId: 'custom', program: customProgram, time: '13:00', endTime: '14:15' }],
        kitchenEnabled: false,
        packageTotals: {
            programBasePrice: 0,
            positionsSubtotal: 0,
            entrySubtotal: 0,
            finalTotal: 0,
            menuPositions: [],
            activityPrograms: [customProgram],
            warnings: []
        }
    });

    ctx.__summaryHooks.renderBookingPackageSummary();

    const summaryText = ctx.document.getElementById('bookingPackageSummary').textContent;
    assert.match(summaryText, /75 хв/);
    assert.doesNotMatch(summaryText, /30 хв/);
});

test('booking drawer package summary keeps day-booking room option hints out of the room row', () => {
    const ctx = createBookingDrawerSummaryHarness();
    const option = ctx.document.querySelector('#roomSelect option');
    option.textContent = 'Room A - 15:00 Test Customer +1';

    ctx.__summaryHooks.renderBookingPackageSummary();

    const roomRow = bookingSummaryRowByLabel(ctx, 'Кімната');
    assert.equal(bookingSummaryRowValue(ctx, 'Кімната'), 'Room A');
    assert.equal(bookingSummaryRowValue(ctx, 'Клієнт'), 'Test Customer');
    assert.doesNotMatch(roomRow?.textContent || '', /15:00|Test Customer|\+1/);
});

test('booking drawer package summary prefers clean room dataset label over select display hints in event mode', () => {
    const ctx = createBookingDrawerSummaryHarness();
    const option = ctx.document.querySelector('#roomSelect option');
    option.value = 'room-a-resource-id';
    option.dataset.roomLabel = 'Room A';
    option.textContent = 'Room A - 15:00 Test Customer +1';
    ctx.document.getElementById('roomSelect').value = 'room-a-resource-id';

    ctx.__summaryHooks.renderBookingPackageSummary();

    const summary = ctx.document.getElementById('bookingPackageSummary');
    const roomRow = bookingSummaryRowByLabel(ctx, 'Кімната');
    assert.equal(bookingSummaryRowValue(ctx, 'Кімната'), 'Room A');
    assert.doesNotMatch(roomRow?.textContent || '', /15:00|Test Customer|\+1|room-a-resource-id/);
    assert.equal(summary.querySelectorAll('.booking-summary-row--activity').length, 2);
    assert.equal(summary.querySelectorAll('.booking-summary-row--menu').length, 1);
});

test('booking drawer package summary keeps clean room label in room-first kitchen mode', () => {
    const ctx = createBookingDrawerSummaryHarness({
        hasEvent: false,
        roomFirst: true,
        selectedProgramValue: ''
    });
    const option = ctx.document.querySelector('#roomSelect option');
    option.dataset.roomLabel = 'Room A';
    option.textContent = 'Room A - 15:00 Test Customer +1';

    ctx.__summaryHooks.renderBookingPackageSummary();

    const summary = ctx.document.getElementById('bookingPackageSummary');
    const roomRow = bookingSummaryRowByLabel(ctx, 'Кімната');
    assert.equal(bookingSummaryRowValue(ctx, 'Кімната'), 'Room A');
    assert.equal(bookingSummaryRowValue(ctx, 'Клієнт'), 'Test Customer');
    assert.doesNotMatch(roomRow?.textContent || '', /15:00|Test Customer|\+1/);
    assert.equal(summary.querySelectorAll('.booking-summary-row--activity').length, 0);
    assert.equal(summary.querySelectorAll('.booking-summary-row--menu').length, 1);
    assert.match(summary.textContent, /Pizza/);
});

test('booking drawer package summary shows non-blocking warning for zero-price custom cake decoration', () => {
    const menuPositions = [{
        productId: 'cake_decor_custom',
        title: 'Індивідуальне оформлення',
        quantity: 1,
        servingUnit: 'додаток',
        unitPrice: 0,
        subtotal: 0,
        kitchenType: 'menu'
    }];
    const ctx = createBookingDrawerSummaryHarness({
        hasEvent: false,
        roomFirst: true,
        selectedProgramValue: '',
        menuPositions,
        packageTotals: {
            programBasePrice: 0,
            positionsSubtotal: 0,
            entrySubtotal: 0,
            finalTotal: 0,
            menuPositions,
            activityPrograms: [],
            warnings: []
        }
    });

    ctx.__summaryHooks.renderBookingPackageSummary();

    const warning = ctx.document.querySelector('#bookingPackageSummary .booking-summary-note--warning');
    assert.ok(warning, 'custom decoration zero-price warning is visible in the summary');
    assert.match(warning.textContent, /Індивідуальне оформлення має ціну 0 грн/);
    assert.match(warning.textContent, /Збереження не блокується/);
});

test('booking activity schedule helper defaults sequentially from base time', () => {
    const rows = BookingActivitySchedule.buildSelectedActivityScheduleRows(multiActivitySchedulePrograms(), {
        baseTime: '12:00'
    });

    assert.deepEqual(rows.map(row => row.time), ['12:00', '12:30', '13:15']);
    assert.deepEqual(rows.map(row => row.endTime), ['12:30', '13:10', '13:35']);
    assert.deepEqual(
        BookingActivitySchedule.selectedActivityScheduleExtra(rows).map(item => item.startTime),
        ['12:00', '12:30', '13:15']
    );
    assert.equal(BookingActivitySchedule.selectedActivityScheduleOverlaps(rows[0], rows[1]), false);
    assert.equal(BookingActivitySchedule.selectedActivityScheduleOverlaps(rows[0], { time: '12:20', duration: 15 }), true);
});

test('booking activity schedule helper accepts a form-specific duration resolver', () => {
    const programs = [{ id: 'custom', duration: 30 }, { id: 'show', duration: 45 }];
    const rows = BookingActivitySchedule.buildSelectedActivityScheduleRows(programs, {
        baseTime: '12:00',
        durationForProgram: program => program.id === 'custom' ? 75 : program.duration
    });

    assert.deepEqual(rows.map(row => row.duration), [75, 45]);
    assert.deepEqual(rows.map(row => row.time), ['12:00', '13:15']);
    assert.deepEqual(rows.map(row => row.endTime), ['13:15', '14:00']);
});

test('booking activity schedule helper limits selectable starts to 15-minute workday slots', () => {
    const weekdayOptions = {
        date: new Date('2099-02-13T00:00:00'),
        timelineConfig: { WEEKDAY_START: 12, WEEKDAY_END: 20, WEEKEND_START: 10, WEEKEND_END: 20 },
        latestStartMinutes: BookingActivitySchedule.scheduleTimeToMinutes('19:30')
    };
    const slots = BookingActivitySchedule.buildSelectedActivityScheduleTimeOptions(weekdayOptions);

    assert.equal(slots[0], '12:00');
    assert.equal(slots[1], '12:15');
    assert.equal(slots.at(-1), '19:30');
    assert.equal(BookingActivitySchedule.isSelectedActivityScheduleSlotTime('16:45', weekdayOptions), true);
    assert.equal(BookingActivitySchedule.isSelectedActivityScheduleSlotTime('16:47', weekdayOptions), false);
    assert.equal(BookingActivitySchedule.isSelectedActivityScheduleSlotTime('09:45', weekdayOptions), false);
    assert.equal(BookingActivitySchedule.isSelectedActivityScheduleSlotTime('10:00', {
        ...weekdayOptions,
        date: new Date('2099-02-14T00:00:00')
    }), true);

    const exactEndBoundary = {
        ...weekdayOptions,
        latestStartMinutes: BookingActivitySchedule.scheduleTimeToMinutes('19:45')
    };
    const endBoundarySlots = BookingActivitySchedule.buildSelectedActivityScheduleTimeOptions(exactEndBoundary);
    assert.equal(endBoundarySlots.at(-1), '19:45');
    assert.equal(BookingActivitySchedule.isSelectedActivityScheduleSlotTime('19:45', exactEndBoundary), true);
    assert.equal(BookingActivitySchedule.isSelectedActivityScheduleSlotTime('20:00', exactEndBoundary), false);
});

test('booking time select is duration-aware and does not offer closing time for nonzero activity', () => {
    const context = createMultiActivityScheduleHarness({
        programs: [{ id: 'solo-30', code: 'SOLO', label: 'Solo(30)', name: 'Solo', category: 'animation', duration: 30, price: 1000, hosts: 1 }],
        baseTime: '19:30'
    });

    const model = context.bookingTimeSlotModel('19:30');
    const slots = model.options.filter(option => !option.offGrid).map(option => option.value);

    assert.equal(slots.includes('19:30'), true);
    assert.equal(slots.includes('19:45'), false);
    assert.equal(slots.includes('20:00'), false);
});

test('booking time select updates latest slot when custom duration changes', () => {
    const context = createMultiActivityScheduleHarness({
        programs: [{ id: 'custom', code: 'Інше', label: 'Інше', name: 'Custom', category: 'custom', duration: 30, price: 0, hosts: 1, isCustom: true }],
        baseTime: '18:00',
        customDuration: 30
    });
    const duration = context.__fields.get('customDuration');

    let slots = context.bookingTimeSlotModel('18:00').options.filter(option => !option.offGrid).map(option => option.value);
    assert.equal(slots.at(-1), '19:30');

    duration.value = '60';
    context.renderBookingTimeOptions('18:00');
    slots = Array.from(context.__fields.get('bookingTime').children).map(option => option.value);

    assert.equal(slots.at(-1), '19:00');
    assert.equal(slots.includes('19:30'), false);
});

test('booking multi-activity default schedule is persisted into banquetActivities payload', () => {
    const context = createMultiActivityScheduleHarness();

    const base = multiActivityBaseBooking();
    const activities = context.buildMultiActivityBookings(base, { activityPrograms: context.__programs });

    assert.equal(base.time, '12:00');
    assert.deepEqual(activities.map(item => item.time), ['12:30', '13:15']);
    assert.deepEqual(base.extraData.multiActivity.schedule.map(item => item.startTime), ['12:00', '12:30', '13:15']);
});

test('booking activity schedule helper applies manual second time', () => {
    const rows = BookingActivitySchedule.buildSelectedActivityScheduleRows(multiActivitySchedulePrograms(), {
        baseTime: '12:00',
        scheduleTimes: { 'show-40': '12:45' }
    });

    assert.deepEqual(rows.map(row => row.time), ['12:00', '12:45', '13:30']);
    assert.equal(rows[1].manual, true);
    assert.equal(BookingActivitySchedule.selectedActivityScheduleExtra(rows)[1].manual, true);
});

test('booking multi-activity manual second time is persisted into banquetActivities payload', () => {
    const context = createMultiActivityScheduleHarness({ scheduleTimes: { 'show-40': '12:45' } });

    const base = multiActivityBaseBooking();
    const activities = context.buildMultiActivityBookings(base, { activityPrograms: context.__programs });

    assert.deepEqual(activities.map(item => item.time), ['12:45', '13:30']);
    assert.equal(base.extraData.multiActivity.schedule[1].manual, true);
    assert.equal(base.extraData.multiActivity.schedule[1].startTime, '12:45');
});

test('booking time change keeps bookingTime as the edited start source and preserves draft fields', async () => {
    const [program] = multiActivitySchedulePrograms();
    const context = createMultiActivityScheduleHarness({
        programs: [program],
        baseTime: '12:15',
        room: 'Room A',
        lineId: 'line-main',
        fieldValues: {
            customerName: 'Olena Test',
            bookingGroupName: 'Birthday draft',
            bookingGuestArrivalTime: '11:45',
            bookingNotes: 'Keep this operator note'
        }
    });
    const fields = context.__fields;

    const result = context.handleBookingTimeControlChange('12:30');
    await Promise.resolve();

    assert.equal(result, '12:30');
    assert.equal(fields.get('bookingTime').value, '12:30');
    assert.equal(context.getBookingFormData().time, '12:30');
    assert.equal(fields.get('customerName').value, 'Olena Test');
    assert.equal(fields.get('bookingGroupName').value, 'Birthday draft');
    assert.equal(fields.get('bookingNotes').value, 'Keep this operator note');
    assert.equal(fields.get('bookingGuestArrivalTime').value, '11:45');
    assert.equal(context.window.BookingForm._dirty, true);
    assert.equal(context.__calls.animatorRefreshes, 1);
    assert.equal(context.__calls.roomAvailability.length, 1);
    assert.equal(context.__calls.roomAvailability[0].selectedRoom, 'Room A');
    assert.equal(context.BookingDrawerState.bookingTimePreflight.status, 'checking');
    assert.equal(context.__timers.length, 1);
});

test('booking banquet edit hydrates bookingTime from first real activity without shifting kitchen primary', () => {
    const programs = multiActivitySchedulePrograms().slice(0, 2);
    const context = createMultiActivityScheduleHarness({
        programs,
        baseTime: '15:00',
        lineId: 'banquet-service',
        room: 'Kitchen room'
    });
    const primaryBooking = {
        id: 'BK-KITCHEN',
        time: '15:00',
        duration: 60,
        lineId: 'banquet-service',
        room: 'Kitchen room',
        category: 'kitchen',
        banquetGroupId: 'BG-KITCHEN-FIRST'
    };
    const banquetContext = {
        groupId: 'BG-KITCHEN-FIRST',
        primaryIsActivity: false,
        primaryBooking,
        activities: [
            {
                id: 'BK-SHOW',
                programId: 'show-40',
                time: '16:45',
                duration: 40,
                lineId: 'line-show',
                room: 'Kitchen room',
                banquetGroupId: 'BG-KITCHEN-FIRST',
                banquetGroupRole: 'activity'
            },
            {
                id: 'BK-ANIM',
                programId: 'anim-30',
                time: '16:00',
                duration: 30,
                lineId: 'line-anim',
                room: 'Kitchen room',
                banquetGroupId: 'BG-KITCHEN-FIRST',
                banquetGroupRole: 'activity'
            }
        ]
    };

    context.hydrateBanquetEditActivityState(banquetContext);

    assert.equal(context.__fields.get('bookingTime').value, '16:00');
    assert.equal(context.__fields.get('bookingTime').dataset.currentTime, '16:00');
    assert.equal(context.window.BookingForm._dirty, false);
    assert.equal(primaryBooking.time, '15:00');
    assert.deepEqual({ ...context.BookingDrawerState.selectedActivityScheduleTimes }, {
        'show-40': '16:45',
        'anim-30': '16:00'
    });

    context.handleBookingTimeControlChange('16:15');

    assert.equal(primaryBooking.time, '15:00');
    assert.deepEqual({ ...context.BookingDrawerState.selectedActivityScheduleTimes }, {
        'show-40': '17:00',
        'anim-30': '16:15'
    });
});

test('booking time duplicate input and change events are idempotent', async () => {
    const context = createMultiActivityScheduleHarness({ scheduleTimes: { 'show-40': '12:45' } });

    const first = context.handleBookingTimeControlChange('12:30');
    const second = context.handleBookingTimeControlChange('12:30');
    await Promise.resolve();

    assert.equal(first, '12:30');
    assert.equal(second, '12:30');
    assert.deepEqual({ ...context.BookingDrawerState.selectedActivityScheduleTimes }, {
        'anim-30': '12:30',
        'show-40': '13:15',
        'photo-20': '14:00'
    });
    assert.equal(context.__calls.animatorRefreshes, 1);
    assert.equal(context.__calls.roomAvailability.length, 1);
    assert.equal(context.__timers.length, 1);
});

test('booking selected activity validation ignores stale reversed API responses', async () => {
    const pending = [];
    const context = createMultiActivityScheduleHarness({
        getBookingsForDate: async () => new Promise(resolve => pending.push(resolve))
    });
    const formData = {
        hasEvent: true,
        activityPrograms: context.__programs,
        lineId: 'line-main',
        room: 'Room A'
    };

    const stalePromise = context.validateSelectedActivitySchedule(formData, { render: true, force: true });
    const latestPromise = context.validateSelectedActivitySchedule(formData, { render: true, force: true });

    pending[1]([{
        id: 'BK-LATEST-CONFLICT',
        date: '2099-02-13',
        time: '12:35',
        duration: 15,
        lineId: 'line-main',
        room: 'Room A',
        programId: 'busy-latest',
        label: 'Latest busy slot',
        status: 'confirmed'
    }]);
    const latest = await latestPromise;

    assert.equal(latest.valid, false);
    assert.equal(context.BookingDrawerState.selectedActivityScheduleIssues['show-40'].conflictBookingId, 'BK-LATEST-CONFLICT');

    pending[0]([]);
    const stale = await stalePromise;

    assert.equal(stale.stale, true);
    assert.equal(context.BookingDrawerState.selectedActivityScheduleIssues['show-40'].conflictBookingId, 'BK-LATEST-CONFLICT');
});

test('booking animator options ignore stale reversed availability responses', async () => {
    const pending = [];
    const context = createMultiActivityScheduleHarness({
        programs: [multiActivitySchedulePrograms()[0]],
        useRealAnimatorRefresh: true,
        apiGetLines: async () => new Promise(resolve => pending.push(resolve))
    });
    const select = context.__fields.get('bookingPrimaryAnimatorSelect');

    const stalePromise = context.refreshAnimatorSelectsForCurrentSlot();
    const latestPromise = context.refreshAnimatorSelectsForCurrentSlot();

    pending[1]([{ id: 'line-new', name: 'New Host' }]);
    await latestPromise;

    assert.equal(select.children.some(option => option.value === 'New Host'), true);

    pending[0]([{ id: 'line-old', name: 'Old Host' }]);
    const stale = await stalePromise;

    assert.equal(stale, null);
    assert.equal(select.children.some(option => option.value === 'New Host'), true);
    assert.equal(select.children.some(option => option.value === 'Old Host'), false);
});

test('booking time preflight reports a concrete second animator conflict', async () => {
    const [program] = multiActivitySchedulePrograms();
    const context = createMultiActivityScheduleHarness({
        programs: [program],
        secondAnimatorLineId: 'line-second',
        getBookingsForDate: async () => [{
            id: 'BK-SECOND-BUSY',
            date: '2099-02-13',
            time: '12:15',
            duration: 60,
            lineId: 'line-second',
            room: 'Other room',
            programId: 'busy-second',
            label: 'Busy second host',
            status: 'confirmed'
        }]
    });
    context.__fields.get('bookingTime').value = '12:30';
    context.BookingDrawerState.bookingTimeChangeToken = 11;

    const result = await context.validateBookingTimeChangePreflight(11);

    assert.equal(result.valid, false);
    assert.equal(context.BookingDrawerState.bookingTimePreflight.status, 'conflict');
    assert.equal(context.bookingTimeValidationIssues()[0].key, 'booking_time_second_animator_conflict');
    assert.match(context.BookingDrawerState.bookingTimePreflight.message, /Busy second host/);
});

test('booking time shift keeps out-of-workday multi-activity draft visible and blocking', () => {
    const programs = multiActivitySchedulePrograms().slice(0, 2);
    const context = createMultiActivityScheduleHarness({ programs, baseTime: '19:00' });

    context.shiftSelectedActivityScheduleDraftsByBookingTimeDelta('19:00', '19:15');
    const rows = context.getSelectedActivityScheduleRows(context.__programs);
    const issues = context.BookingDrawerState.selectedActivityScheduleIssues;

    assert.deepEqual(rows.map(row => row.time), ['19:15', '19:45']);
    assert.equal(context.BookingDrawerState.selectedActivityScheduleTimes['show-40'], '19:45');
    assert.ok(issues['show-40']?.messages?.length, 'out-of-workday shifted activity should stay visible but block save');
});
test('booking time change shifts every multi-activity draft by the same delta', () => {
    const context = createMultiActivityScheduleHarness({ scheduleTimes: { 'show-40': '12:45' } });

    context.shiftSelectedActivityScheduleDraftsByBookingTimeDelta('12:00', '12:30');
    const rows = context.getSelectedActivityScheduleRows(context.__programs);

    assert.deepEqual(rows.map(row => row.time), ['12:30', '13:15', '14:00']);
    assert.deepEqual({ ...context.BookingDrawerState.selectedActivityScheduleTimes }, {
        'anim-30': '12:30',
        'show-40': '13:15',
        'photo-20': '14:00'
    });
});

test('timeline browser smoke protects edited start payload, conflict durability, and responsive drawer overflow', () => {
    const smoke = read('tests', 'browser', 'timeline-browser-smoke.js');

    assert.match(smoke, /async function assertBookingTimeCreateDurability/);
    assert.match(smoke, /openBookingPanel\('12:15'/);
    assert.match(smoke, /selectOption\('12:30'\)/);
    assert.match(smoke, /capturedPayload\.time,\s*'12:30'/);
    assert.match(smoke, /capturedPayload\.banquetContext\?\.guestArrivalTime,\s*'11:45'/);
    assert.match(smoke, /server conflict keeps booking drawer open/);
    assert.match(smoke, /booking form has no horizontal overflow/);
    assert.match(smoke, /created booking persisted edited 12:30 start/);
});

test('booking time preflight reports a concrete room conflict', async () => {
    const context = createMultiActivityScheduleHarness({
        programs: [multiActivitySchedulePrograms()[0]],
        getBookingsForDate: async () => [{
            id: 'BK-ROOM-BUSY',
            date: '2099-02-13',
            time: '12:15',
            duration: 30,
            lineId: 'line-other',
            room: 'Room A',
            programId: 'busy-room',
            label: 'Busy room',
            status: 'confirmed'
        }]
    });
    context.__fields.get('bookingTime').value = '12:30';
    context.BookingDrawerState.bookingTimeChangeToken = 7;

    const result = await context.validateBookingTimeChangePreflight(7);

    assert.equal(result.valid, false);
    assert.equal(context.BookingDrawerState.bookingTimePreflight.status, 'conflict');
    assert.match(context.BookingDrawerState.bookingTimePreflight.message, /Кімната зайнята: Busy room о 12:15/);
    assert.equal(context.bookingTimeValidationIssues()[0].key, 'booking_time_room_conflict');
});

test('booking time preflight allows same-banquet activity over kitchen room slot', async () => {
    const context = createMultiActivityScheduleHarness({
        programs: [multiActivitySchedulePrograms()[0]],
        selectedBanquetGroupId: 'BG-ROOM-1',
        activeBanquetIntent: 'add_to_existing',
        activeBanquetRoleIntent: 'activity',
        getBookingsForDate: async () => [{
            id: 'BK-KITCHEN-SAME-GROUP',
            date: '2099-02-13',
            time: '12:15',
            duration: 30,
            lineId: 'banquet-service',
            room: 'Room A',
            programCode: 'KITCHEN',
            programName: 'Kitchen',
            category: 'kitchen',
            label: 'Kitchen slot',
            status: 'confirmed',
            banquetGroupId: 'BG-ROOM-1',
            banquetGroupRole: 'kitchen'
        }]
    });
    context.__fields.get('bookingTime').value = '12:30';
    context.BookingDrawerState.bookingTimeChangeToken = 17;

    const result = await context.validateBookingTimeChangePreflight(17);

    assert.equal(result.valid, true);
    assert.equal(context.BookingDrawerState.bookingTimePreflight.status, 'free');
    assert.equal(context.bookingTimeValidationIssues().length, 0);
});

test('booking time preflight still blocks same-room overlap from another banquet group', async () => {
    const context = createMultiActivityScheduleHarness({
        programs: [multiActivitySchedulePrograms()[0]],
        selectedBanquetGroupId: 'BG-ROOM-1',
        activeBanquetIntent: 'add_to_existing',
        activeBanquetRoleIntent: 'activity',
        getBookingsForDate: async () => [{
            id: 'BK-KITCHEN-OTHER-GROUP',
            date: '2099-02-13',
            time: '12:15',
            duration: 30,
            lineId: 'banquet-service',
            room: 'Room A',
            programCode: 'KITCHEN',
            programName: 'Kitchen',
            category: 'kitchen',
            label: 'Other banquet kitchen',
            status: 'confirmed',
            banquetGroupId: 'BG-ROOM-2',
            banquetGroupRole: 'kitchen'
        }]
    });
    context.__fields.get('bookingTime').value = '12:30';
    context.BookingDrawerState.bookingTimeChangeToken = 18;

    const result = await context.validateBookingTimeChangePreflight(18);

    assert.equal(result.valid, false);
    assert.equal(context.bookingTimeValidationIssues()[0].key, 'booking_time_room_conflict');
    assert.match(context.BookingDrawerState.bookingTimePreflight.message, /Other banquet kitchen/);
});

test('booking multi-activity second host payload belongs to its activity row', () => {
    const programs = [
        { id: 'anim-30', code: 'AN', label: 'Anim(30)', name: 'Animation', category: 'animation', duration: 30, price: 1500, hosts: 1 },
        { id: 'show-40', code: 'WOW', label: 'Wow(40)', name: 'Wow show', category: 'show', duration: 40, price: 2400, hosts: 2 },
        { id: 'photo-20', code: 'PH', label: 'Photo(20)', name: 'Photo', category: 'photo', duration: 20, price: 900, hosts: 1 }
    ];
    const context = createMultiActivityScheduleHarness({
        programs,
        secondAnimatorFields: {
            'show-40': {
                secondAnimator: 'Second Animator',
                secondAnimatorLineId: 'line-second',
                secondAnimatorLineName: 'Second Animator'
            }
        }
    });

    const base = multiActivityBaseBooking();
    const activities = context.buildMultiActivityBookings(base, { activityPrograms: context.__programs });
    const multiHostActivity = activities.find(item => item.programId === 'show-40');

    assert.ok(multiHostActivity, 'second selected activity is present in banquetActivities');
    assert.equal(multiHostActivity.hosts, 2);
    assert.equal(multiHostActivity.secondAnimator, 'Second Animator');
    assert.equal(multiHostActivity.secondAnimatorLineId, 'line-second');
    assert.equal(multiHostActivity.secondAnimatorLineName, 'Second Animator');
    assert.equal(multiHostActivity.extraData.bookingWorkspace.secondAnimatorLineId, 'line-second');
});

test('standalone activity edit restores the same second animator line in global and activity fields', async () => {
    const program = {
        id: 'show-40',
        code: 'WOW',
        label: 'Wow(40)',
        name: 'Wow show',
        category: 'show',
        duration: 40,
        price: 2400,
        hosts: 2
    };
    const lines = [
        { id: 'line-main', name: 'Primary Animator' },
        { id: 'line-second', name: 'Second Animator' }
    ];
    const context = createMultiActivityScheduleHarness({
        programs: [program],
        lineId: 'line-main',
        apiGetLines: async () => lines,
        apiGetBookings: async () => []
    });
    const activitySelectId = context.selectedActivitySecondAnimatorSelectId(program.id);
    const activitySelect = createHarnessSelect();
    let staleErrorRemoved = false;
    const staleError = {
        textContent: 'Оберіть другого ведучого',
        remove: () => {
            staleErrorRemoved = true;
        }
    };
    const validationContainer = createHarnessElement({
        querySelector: selector => selector === '.selected-activity-second-host-error' ? staleError : null
    });
    activitySelect.closest = selector => selector === '.selected-activity-second-host' ? validationContainer : null;
    context.__fields.set(activitySelectId, activitySelect);
    context.AppState.editingBookingId = 'BK-ACTIVITY';
    const candidate = { id: 'line-second', name: 'Second Animator', source: 'timeline_line' };

    const hydrated = context.hydrateStandaloneEditSecondAnimatorActivityState({
        id: 'BK-ACTIVITY',
        programId: program.id,
        lineId: 'line-main',
        secondAnimator: 'Second Animator',
        secondAnimatorLineId: 'line-second'
    }, candidate);
    await context.populateSecondAnimatorSelect({
        selectedName: candidate.name,
        selectedLineId: candidate.id,
        selectedCandidate: candidate,
        primaryLineId: 'line-main',
        fresh: false
    });
    await context.populateSelectedActivitySecondAnimatorSelects({ fresh: false });

    const globalSelect = context.__fields.get('secondAnimatorSelect');
    const globalOption = globalSelect.options.find(option => option.value === candidate.name);
    const activityOption = activitySelect.options.find(option => option.value === candidate.name);
    assert.equal(hydrated.secondAnimatorLineId, candidate.id);
    assert.equal(context.BookingDrawerState.selectedActivitySecondAnimatorFields[program.id].secondAnimatorLineId, candidate.id);
    assert.equal(globalSelect.value, candidate.name);
    assert.equal(activitySelect.value, candidate.name);
    assert.equal(globalOption?.dataset?.lineId, candidate.id);
    assert.equal(activityOption?.dataset?.lineId, candidate.id);
    assert.equal(staleErrorRemoved, true);
    assert.equal(validationContainer['aria-invalid'], 'false');
    assert.equal(context.window.BookingForm._dirty, false);
});

test('standalone activity edit keeps an unresolved legacy second animator visible and blocking', () => {
    const program = {
        id: 'legacy-show',
        code: 'LEGACY',
        name: 'Legacy show',
        category: 'show',
        duration: 30,
        hosts: 2
    };
    const context = createMultiActivityScheduleHarness({ programs: [program] });
    const selectId = context.selectedActivitySecondAnimatorSelectId(program.id);
    const activitySelect = createHarnessSelect();
    context.__fields.set(selectId, activitySelect);
    const unresolvedCandidate = {
        id: 'deleted-line',
        name: 'Former Animator',
        source: 'legacy_second_animator',
        unresolved: true
    };

    const hydrated = context.hydrateStandaloneEditSecondAnimatorActivityState({
        id: 'BK-LEGACY',
        programId: program.id,
        secondAnimator: 'Former Animator',
        secondAnimatorLineId: 'deleted-line'
    }, unresolvedCandidate);
    context.ensureAnimatorSelectCandidateOption(activitySelect, unresolvedCandidate, { selected: true });

    const [issue] = context.selectedActivitySecondAnimatorValidationIssues(program);
    assert.equal(hydrated.secondAnimator, 'Former Animator');
    assert.equal(hydrated.secondAnimatorLineId, 'deleted-line');
    assert.equal(activitySelect.value, 'Former Animator');
    assert.equal(issue.key, `activity_second_animator_unresolved_${program.id}`);
    assert.equal(issue.fields[0], `activitySecondAnimator:${program.id}`);
    assert.ok(issue.message.length > 0);
    assert.equal(context.window.BookingForm._dirty, false);
});

test('booking selected activity second host keeps line id after summary rerender', () => {
    const bookingJs = readBookingSurface();
    const draftBlock = bookingJs.slice(
        bookingJs.indexOf('function selectedActivitySecondAnimatorDraft'),
        bookingJs.indexOf('function selectedActivitySecondAnimatorValidationIssues')
    );
    const subflowBlock = bookingJs.slice(
        bookingJs.indexOf('function renderSelectedActivitySecondAnimatorSubflow'),
        bookingJs.indexOf('function setSelectedActivitySecondAnimator')
    );

    assert.match(draftBlock, /const candidateLineId = candidate\?\.id && candidate\.id !== selectedName \? candidate\.id : null;/);
    assert.match(draftBlock, /secondAnimatorLineId:\s*state\.secondAnimatorLineId \|\| candidateLineId \|\| null/);
    assert.match(draftBlock, /secondAnimatorLineName:\s*state\.secondAnimatorLineName \|\| candidate\?\.name \|\| selectedName \|\| null/);
    assert.match(subflowBlock, /data-line-id="\$\{escapeHtml\(draft\.secondAnimatorLineId\)\}"/);
    assert.match(subflowBlock, /data-line-name="\$\{escapeHtml\(draft\.secondAnimatorLineName\)\}"/);
});

test('booking selected activity schedule conflict blocks submit preflight', async () => {
    const context = createMultiActivityScheduleHarness({
        getBookingsForDate: async () => [{
            id: 'BK-CONFLICT',
            date: '2099-02-13',
            time: '12:35',
            duration: 15,
            lineId: 'line-main',
            room: 'Room A',
            programId: 'busy-other',
            label: 'Busy slot',
            status: 'confirmed'
        }]
    });

    const result = await context.validateSelectedActivityScheduleBeforeSubmit({
        hasEvent: true,
        activityPrograms: context.__programs,
        lineId: 'line-main',
        room: 'Room A'
    }, null);

    assert.equal(result, false);
    assert.equal(context.BookingDrawerState.selectedActivityScheduleIssues['show-40'].conflictBookingId, 'BK-CONFLICT');
    assert.deepEqual(context.__revealed, ['BK-CONFLICT']);
    assert.equal(context.__notifications.length, 1);
    assert.equal(context.__notifications[0].type, 'error');
});

test('booking selected activity preflight allows same-banquet activity over kitchen room slot', async () => {
    const context = createMultiActivityScheduleHarness({
        selectedBanquetGroupId: 'BG-MULTI-1',
        activeBanquetIntent: 'add_to_existing',
        activeBanquetRoleIntent: 'activity',
        getBookingsForDate: async () => [{
            id: 'BK-MULTI-KITCHEN',
            date: '2099-02-13',
            time: '12:35',
            duration: 15,
            lineId: 'banquet-service',
            room: 'Room A',
            programCode: 'KITCHEN',
            programName: 'Kitchen',
            category: 'kitchen',
            label: 'Kitchen slot',
            status: 'confirmed',
            banquetGroupId: 'BG-MULTI-1',
            banquetGroupRole: 'kitchen'
        }]
    });

    const result = await context.validateSelectedActivityScheduleBeforeSubmit({
        hasEvent: true,
        activityPrograms: context.__programs,
        lineId: 'line-main',
        room: 'Room A'
    }, null);

    assert.equal(result, true);
    assert.deepEqual(Object.keys(context.BookingDrawerState.selectedActivityScheduleIssues), []);
    assert.deepEqual(context.__notifications, []);
    assert.deepEqual(context.__revealed, []);
});

test('booking selected activity preflight still blocks same-banquet activity over activity room slot', async () => {
    const context = createMultiActivityScheduleHarness({
        selectedBanquetGroupId: 'BG-MULTI-1',
        activeBanquetIntent: 'add_to_existing',
        activeBanquetRoleIntent: 'activity',
        getBookingsForDate: async () => [{
            id: 'BK-MULTI-ACTIVITY',
            date: '2099-02-13',
            time: '12:35',
            duration: 15,
            lineId: 'line-other',
            room: 'Room A',
            programId: 'busy-quest',
            programCode: 'QUEST',
            programName: 'Quest',
            category: 'quest',
            label: 'Quest activity',
            status: 'confirmed',
            banquetGroupId: 'BG-MULTI-1',
            banquetGroupRole: 'activity'
        }]
    });

    const result = await context.validateSelectedActivityScheduleBeforeSubmit({
        hasEvent: true,
        activityPrograms: context.__programs,
        lineId: 'line-main',
        room: 'Room A'
    }, null);

    assert.equal(result, false);
    assert.equal(context.BookingDrawerState.selectedActivityScheduleIssues['show-40'].conflictBookingId, 'BK-MULTI-ACTIVITY');
    assert.deepEqual(context.__revealed, ['BK-MULTI-ACTIVITY']);
    assert.equal(context.__notifications.at(-1).type, 'error');
});

test('booking selected activity preflight failure requires explicit repeat before backend submit', async () => {
    let shouldFail = true;
    let calls = 0;
    const context = createMultiActivityScheduleHarness({
        getBookingsForDate: async () => {
            calls += 1;
            if (shouldFail) throw new Error('network down');
            return [];
        }
    });
    const formData = {
        hasEvent: true,
        activityPrograms: context.__programs,
        lineId: 'line-main',
        room: 'Room A'
    };

    const first = await context.validateSelectedActivityScheduleBeforeSubmit(formData, null);

    assert.equal(first, false, 'first unavailable preflight should block submit');
    assert.equal(context.BookingDrawerState.selectedActivityPreflight.status, 'failed');
    assert.match(context.renderSelectedActivityPreflightWarning(), /data-booking-preflight-retry/);
    assert.equal(context.__notifications.at(-1).type, 'warning');

    const second = await context.validateSelectedActivityScheduleBeforeSubmit(formData, null);

    assert.equal(second, true, 'second submit should allow backend validation to run');
    assert.equal(calls, 1, 'explicit repeat should not silently retry and hide backend validation');
    assert.equal(context.BookingDrawerState.selectedActivityPreflight.overrideUsed, true);

    shouldFail = false;
    const retry = await context.validateSelectedActivityScheduleBeforeSubmit(formData, null, { forceRetry: true });

    assert.equal(retry, true);
    assert.equal(context.BookingDrawerState.selectedActivityPreflight.status, 'idle');
    assert.equal(calls, 2);
});

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
    assert.equal(formatMenuQuantityWithServingUnit(1, 'додаток'), '1 додаток');
    assert.equal(formatMenuQuantityWithServingUnit(4, 'додаток'), '4 додатки');
    assert.equal(formatMenuQuantityWithServingUnit(6, 'додаток'), '6 додатків');
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

    assert.equal(BOOKING_PACKAGE_SCHEMA_VERSION, 3);
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
    assert.equal(ctx.formatBookingMenuQuantityWithServingUnit(1, 'додаток'), '1 додаток');
    assert.equal(ctx.formatBookingMenuQuantityWithServingUnit(4, 'додаток'), '4 додатки');
    assert.equal(ctx.formatBookingMenuQuantityWithServingUnit(6, 'додаток'), '6 додатків');
    assert.equal(ctx.formatBookingMenuQuantityWithServingUnit(5, 'шт'), '5 шт');
    assert.doesNotMatch(ctx.formatBookingMenuPositionQuantity(cake), /5 100г|5 100 г/);
});

test('booking summary page quantity display declines menu addon units', async () => {
    const summary = {
        bookingId: 'BK-ADDON-UNITS',
        mode: 'client',
        venue: { name: 'Event Genix' },
        event: { date: '2026-06-27', time: '12:30', room: 'Марвел', hasRealProgram: false },
        customer: { name: 'Тестовий клієнт' },
        counts: { children: 6, adults: 0, tables: 1 },
        orderRows: [
            { id: 'addon:1', type: 'menu', title: 'Соус', quantity: 1, unitPrice: 40, subtotal: 40, meta: { servingUnit: 'додаток' } },
            { id: 'addon:4', type: 'menu', title: 'Куряче філе запечене', quantity: 4, unitPrice: 40, subtotal: 160, meta: { servingUnit: 'додаток' } },
            { id: 'addon:6', type: 'menu', title: 'Ананас консервований', quantity: 6, unitPrice: 40, subtotal: 240, meta: { servingUnit: 'додаток' } }
        ],
        serviceEvents: [],
        schedule: [],
        responsible: { rows: [] },
        comments: [],
        warnings: [],
        totals: { orderTotal: 440, bookingPrice: 440, currency: 'UAH' },
        finance: { rows: [{ key: 'total', label: 'Загальна сума', amount: 440, currency: 'UAH', role: 'total' }] },
        terms: { items: [] }
    };

    const { document } = await renderBookingSummaryFixture(summary);
    const tableText = document.querySelector('.summary-order-table')?.textContent || '';

    assert.match(tableText, /1\s*додаток/);
    assert.match(tableText, /4\s*додатки/);
    assert.match(tableText, /6\s*додатків/);
    assert.doesNotMatch(tableText, /4\s*додаток|6\s*додаток/);
});

test('booking summary page normalizes explicit client order money labels', async () => {
    const summary = {
        bookingId: 'BK-MONEY-LABELS',
        mode: 'client',
        venue: { name: 'Event Genix' },
        event: { date: '2026-06-27', time: '12:30', room: 'Марвел', hasRealProgram: false },
        customer: { name: 'Тестовий клієнт' },
        counts: { children: 11, adults: 0, tables: 1 },
        orderRows: [
            { id: 'activity:candy', type: 'activity', title: 'Цукерки(90)', unitPrice: 370, subtotal: 4070 },
            { id: 'total:probe', type: 'total_probe', title: 'Загальна сума', unitPrice: 11230, subtotal: 11230 }
        ],
        orderRowViews: {
            client: [
                {
                    type: 'activity',
                    title: 'Цукерки(90)',
                    quantityLabel: '11 дітей',
                    unitPriceLabel: '370 UAH/дит',
                    subtotalLabel: '4070'
                },
                {
                    type: 'total_probe',
                    title: 'Загальна сума',
                    quantityLabel: '1',
                    unitPriceLabel: '11230 UAH',
                    subtotalLabel: '11230 ₴'
                }
            ]
        },
        serviceEvents: [],
        schedule: [],
        responsible: { rows: [] },
        comments: [],
        warnings: [],
        totals: { orderTotal: 11230, bookingPrice: 11230, currency: 'UAH' },
        finance: { rows: [{ key: 'total', label: 'Загальна сума', amount: 11230, currency: 'UAH', role: 'total' }] },
        terms: { items: [] }
    };

    const { document } = await renderBookingSummaryFixture(summary);
    const tableText = document.querySelector('.summary-order-table')?.textContent || '';

    assert.match(tableText, /370\s*₴\/дит/);
    assert.match(tableText, /4\s*070\s*₴/);
    assert.match(tableText, /11\s*230\s*₴/);
    assert.doesNotMatch(tableText, /UAH|11230|4070/);
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
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /\/uploads\/catalog-images\/items\/menu-juice-generated\.png/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogList').innerHTML, /data-menu-catalog-next-src="\/images\/kitchen-menu\/juice\.webp"/);
    assert.match(doc.getElementById('bookingMenuCatalogList').innerHTML, /\/uploads\/catalog-images\/items\/cake-generated\.png/);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogList').innerHTML, /\/images\/kitchen-menu\/fallback-burger-wide\.jpg/);
    ctx.setBookingMenuCatalogOpen(true);
    assert.equal(doc.body.classList.contains('booking-menu-catalog-active'), true);

    const fallbackImg = doc.querySelector('.booking-menu-catalog-thumb.uses-fallback-image img[data-menu-catalog-fallback="1"]');
    assert.equal(fallbackImg, null, 'legacy/static fallback image is not rendered when product has no configured photo');

    const generatedImg = doc.querySelector('.booking-menu-catalog-thumb.has-image img[src="/uploads/catalog-images/items/menu-juice-generated.png"]');
    assert.ok(generatedImg, 'product iconUrl is rendered without legacy manifest fallback');
    ctx.bookingMenuCatalogHandleImageError(generatedImg);
    assert.equal(generatedImg.closest('.booking-menu-catalog-thumb').classList.contains('uses-manifest-fallback-image'), false);
    assert.equal(generatedImg.closest('.booking-menu-catalog-thumb').classList.contains('uses-fallback-image'), false);
    assert.equal(generatedImg.closest('.booking-menu-catalog-thumb').classList.contains('is-image-missing'), true);
    assert.equal(generatedImg.hasAttribute('src'), false);
    assert.equal(generatedImg.dataset.menuCatalogFallback, '0');

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

test('booking menu catalog warns when custom cake decoration price remains zero', () => {
    const ctx = createBookingMenuCatalogHarness();
    const doc = ctx.document;
    doc.getElementById('bookingMenuCatalogPanel').hidden = false;
    ctx.AppState.products.push({
        id: 'cake_decor_custom',
        domain: 'kitchen',
        category: 'menu',
        kitchenType: 'menu',
        name: 'Індивідуальне оформлення',
        price: 0,
        menuSection: 'Оформлення торта',
        servingUnit: 'додаток',
        sortOrder: 99,
        isActive: true
    });

    ctx.BookingPackageState.catalogFilter = 'section:cake-decorations';
    ctx.renderBookingMenuCatalog();

    assert.match(doc.getElementById('bookingMenuCatalogTabs').textContent, /Оформлення торта/);
    assert.match(doc.getElementById('bookingMenuCatalogList').textContent, /Індивідуальне оформлення/);
    assert.match(doc.getElementById('bookingMenuCatalogList').textContent, /ціну потрібно вказати вручну/);

    ctx.upsertBookingMenuCatalogProduct('cake_decor_custom', 1);

    assert.equal(ctx.getBookingMenuPositions()[0].unitPrice, 0);
    assert.match(doc.getElementById('bookingMenuCatalogCartList').textContent, /Індивідуальне оформлення має ціну 0 грн/);
    assert.match(doc.getElementById('bookingMenuCatalogCartList').textContent, /Збереження не блокується/);

    ctx.setBookingMenuCatalogEditing('cake_decor_custom', 'price');
    const priceInput = doc.querySelector('[data-menu-catalog-price-input="cake_decor_custom"]');
    assert.ok(priceInput, 'custom decoration price input rendered');
    priceInput.value = '250';
    ctx.commitBookingMenuCatalogInlineInput(priceInput);

    assert.equal(ctx.getBookingMenuPositions()[0].unitPrice, 250);
    assert.doesNotMatch(doc.getElementById('bookingMenuCatalogCartList').textContent, /Індивідуальне оформлення має ціну 0 грн/);
});

test('booking menu catalog uses active generated images and ignores legacy static fallbacks', () => {
    const ctx = createBookingMenuCatalogHarness();
    ctx.window.KITCHEN_MENU_IMAGES = Object.freeze({
        basePath: '/images/kitchen-menu/',
        byId: Object.freeze({
            explicit_icon_url: 'manifest-icon-url.webp',
            explicit_icon_snake: 'manifest-icon-snake.webp',
            manifest_only: 'manifest-only.webp',
            uploads_active: 'manifest-uploads.webp'
        }),
        byCode: Object.freeze({
            MENU_UPLOADED: 'manifest-by-code.webp'
        }),
        byName: Object.freeze({
            'manifest by name': 'manifest-by-name.webp'
        })
    });

    assert.equal(ctx.bookingMenuProductImageUrl({
        id: 'explicit_icon_url',
        code: 'MENU-ICON-URL',
        name: 'Explicit iconUrl',
        iconUrl: '/uploads/catalog-images/items/icon-url-applied.png'
    }), '/uploads/catalog-images/items/icon-url-applied.png');

    assert.equal(ctx.bookingMenuProductImageUrl({
        id: 'explicit_icon_snake',
        code: 'MENU-ICON-SNAKE',
        name: 'Explicit icon_url',
        icon_url: '/uploads/catalog-images/items/icon-snake-applied.png'
    }), '/uploads/catalog-images/items/icon-snake-applied.png');

    const uploadedProduct = {
        id: 'uploads_active',
        code: 'MENU_UPLOADED',
        name: 'Uploaded active image',
        iconUrl: '/uploads/catalog-images/items/uploaded-active.png'
    };
    assert.equal(ctx.bookingMenuProductImageUrl(uploadedProduct), '/uploads/catalog-images/items/uploaded-active.png');
    assert.equal(ctx.bookingMenuProductImageFallbackUrl(uploadedProduct, '/uploads/catalog-images/items/uploaded-active.png'), '');

    const margaritaProduct = {
        id: 'menu_2026_031_item',
        code: 'MENU-031',
        name: 'Піца Маргарита',
        iconUrl: '/uploads/catalog-images/items/missing-margarita.png'
    };
    assert.equal(ctx.bookingMenuProductImageUrl(margaritaProduct), '/uploads/catalog-images/items/missing-margarita.png');
    assert.equal(ctx.bookingMenuProductImageFallbackUrl(margaritaProduct, '/uploads/catalog-images/items/missing-margarita.png'), '');

    assert.equal(ctx.bookingMenuProductImageUrl({
        id: 'manifest_only',
        code: 'MENU-MANIFEST',
        name: 'Manifest only'
    }), '');

    assert.equal(ctx.bookingMenuProductImageUrl({
        id: 'manifest_name_only',
        code: 'MENU-NAME',
        name: 'Manifest By Name'
    }), '');

    assert.equal(ctx.bookingMenuProductImageUrl({
        id: 'no_image',
        code: 'MENU-NO-IMAGE',
        name: 'No image'
    }), '');

    const fallbackHtml = ctx.bookingMenuCatalogVisualHtml({
        id: 'no_image',
        code: 'MENU-NO-IMAGE',
        name: 'No image'
    }, 'No image');
    assert.doesNotMatch(fallbackHtml, /\/images\/kitchen-menu\/fallback-burger-wide\.jpg/);
    assert.doesNotMatch(fallbackHtml, /uses-fallback-image/);
    assert.doesNotMatch(fallbackHtml, /<img/);

    const margaritaHtml = ctx.bookingMenuCatalogVisualHtml(margaritaProduct, 'Піца Маргарита');
    assert.match(margaritaHtml, /src="\/uploads\/catalog-images\/items\/missing-margarita\.png"/);
    assert.match(margaritaHtml, /data-menu-catalog-next-src=""/);
    assert.doesNotMatch(margaritaHtml, /products\/menu-031\.jpg/);

    const uploadedHtml = ctx.bookingMenuCatalogVisualHtml(uploadedProduct, 'Uploaded active image');
    assert.match(uploadedHtml, /src="\/uploads\/catalog-images\/items\/uploaded-active\.png"/);
    assert.match(uploadedHtml, /data-menu-catalog-next-src=""/);
    assert.doesNotMatch(uploadedHtml, /manifest-uploads\.webp/);
    assert.match(uploadedHtml, /data-menu-catalog-fallback="0"/);
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

test('booking package detail tolerates malformed persisted package arrays', () => {
    const ctx = createBookingMenuCatalogHarness();
    const packageData = ctx.getBookingPackageFromBooking({
        price: 1500,
        extraData: {
            bookingPackage: {
                finalTotal: 1500,
                menuPositions: { unexpected: true },
                serviceEvents: { unexpected: true },
                source: 'legacy_corrupt_record'
            }
        }
    });

    assert.ok(packageData, 'legacy package object is still returned');
    assert.equal(Array.isArray(packageData.menuPositions), true);
    assert.equal(Array.isArray(packageData.serviceEvents), true);
    assert.equal(packageData.menuPositions.length, 0);
    assert.equal(packageData.serviceEvents.length, 0);
    assert.equal(packageData.finalTotal, 1500);
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

test('booking package persists top-level bookingPackage menu positions from create payload', () => {
    const booking = applyBookingPackage({
        price: 1700,
        programBasePrice: 1000,
        bookingPackage: {
            menuPositions: [
                { productId: 'menu_pizza', title: 'Піца', quantity: 2, unitPrice: 250, servingTime: '15:30' },
                { productId: 'cake_decor_custom', title: 'Індивідуальне оформлення', quantity: 1, unitPrice: 200, servingUnit: 'додаток', note: 'manual price' }
            ],
            serviceEvents: [
                { type: 'food_service', title: 'Видача меню', time: '15:30' }
            ]
        },
        extraData: { source: 'api_create_test' }
    });

    assert.equal(booking.price, 1700);
    assert.equal(booking.extraData.source, 'api_create_test');
    assert.equal(booking.extraData.bookingPackage.programBasePrice, 1000);
    assert.equal(booking.extraData.bookingPackage.positionsSubtotal, 700);
    assert.equal(booking.extraData.bookingPackage.finalTotal, 1700);
    assert.equal(booking.extraData.bookingPackage.menuPositions.length, 2);
    assert.equal(booking.extraData.bookingPackage.menuPositions[0].productId, 'menu_pizza');
    assert.equal(booking.extraData.bookingPackage.menuPositions[0].servingTime, '15:30');
    assert.equal(booking.extraData.bookingPackage.menuPositions[1].productId, 'cake_decor_custom');
    assert.equal(booking.extraData.bookingPackage.menuPositions[1].unitPrice, 200);
    assert.equal(booking.extraData.bookingPackage.serviceEvents[0].type, 'food_service');
    assert.equal(booking.extraData.bookingPackage.serviceEvents[0].time, '15:30');
    assert.match(booking.banquetMenu, /Піца - 2 порції × 250 грн/);
    assert.match(booking.banquetMenu, /Індивідуальне оформлення - 1 додаток × 200 грн/);
});

test('banquet preorder rules use room minimum, menu subtotal, and deposit independently from tickets', () => {
    const booking = applyBookingPackage({
        date: '2026-07-25',
        category: 'kitchen',
        room: 'Жовта кімната',
        roomResourceId: 'room-yellow',
        programBasePrice: 0,
        banquetGuests: 10,
        deposit: { expectedAmount: 1000 },
        extraData: {
            bookingPackage: {
                schemaVersion: 3,
                menuPositions: [
                    { productId: 'menu_pizza', title: 'Піца', quantity: 3, unitPrice: 1000, subtotal: 3000 }
                ],
                ticketLines: [{
                    ticketTypeId: 1,
                    ticketTypeCode: 'regular_child',
                    ticketTypeName: 'Regular child',
                    audience: 'child',
                    quantity: 10,
                    unitPriceUah: 350,
                    subtotalUah: 3500,
                    tariffVersionId: 10,
                    admissionContext: 'reserved_table_room',
                    dayType: 'weekend'
                }],
                ticketSubtotal: 3500
            }
        }
    });

    const status = booking.extraData.bookingPackage.banquetPreorderStatus;
    assert.equal(status.placeType, 'room');
    assert.equal(status.requiredMenuMinimum, 4000);
    assert.equal(status.currentMenuSubtotal, 3000);
    assert.equal(status.missingMenuAmount, 1000);
    assert.equal(status.menuStatus, 'below_minimum');
    assert.equal(status.currentDepositAmount, 1000);
    assert.equal(status.depositStatus, 'below_recommended');
    assert.equal(booking.extraData.bookingPackage.entrySubtotal, 3500);
    assert.equal(booking.extraData.bookingPackage.finalTotal, 6500);
    assert.ok(status.warnings.some(warning => warning.code === 'banquet_menu_minimum_below'));
    assert.ok(status.warnings.some(warning => warning.code === 'banquet_deposit_below_recommended'));
});

test('banquet preorder rules use table minimum and mark sufficient menu/deposit cleanly', () => {
    const status = buildBanquetPreorderStatus({
        booking: {
            category: 'kitchen',
            room: 'Диван 3',
            banquetGuests: 6,
            deposit: { expectedAmount: 2000 }
        },
        bookingPackage: {
            positionsSubtotal: 2500,
            entrySubtotal: 9999,
            finalTotal: 12499,
            menuPositions: [
                { title: 'Меню', quantity: 1, unitPrice: 2500, subtotal: 2500 }
            ]
        }
    });

    assert.equal(status.placeType, 'table');
    assert.equal(status.requiredMenuMinimum, 2500);
    assert.equal(status.menuStatus, 'sufficient');
    assert.equal(status.depositStatus, 'sufficient');
    assert.deepEqual(status.warnings, []);
});

test('banquet summary exposes preorder warnings without mixing ticket totals into menu minimum', () => {
    const summary = buildBanquetSummary({
        mainBooking: {
            id: 'BK-PREORDER-1',
            business_context: 'event_genix',
            date: '2026-07-25',
            time: '12:00',
            category: 'kitchen',
            room: 'Жовта кімната',
            banquet_guests: 10,
            banquet_tables: 1,
            price: 6500,
            extra_data: {
                bookingPackage: {
                    schemaVersion: 3,
                    programBasePrice: 0,
                    positionsSubtotal: 3000,
                    entrySubtotal: 3500,
                    ticketSubtotal: 3500,
                    finalTotal: 6500,
                    menuPositions: [
                        { title: 'Піца', quantity: 3, unitPrice: 1000, subtotal: 3000 }
                    ],
                    ticketLines: [{
                        ticketTypeId: 1,
                        ticketTypeCode: 'regular_child',
                        ticketTypeName: 'Regular child',
                        audience: 'child',
                        quantity: 10,
                        unitPriceUah: 350,
                        subtotalUah: 3500,
                        tariffVersionId: 10
                    }]
                }
            }
        },
        canonicalDepositProjection: {
            deposit: { expectedAmount: 0 },
            display: { amount: 0 }
        },
        businessContext: 'event_genix',
        mode: 'staff'
    });

    assert.equal(summary.banquetPreorderStatus.requiredMenuMinimum, 4000);
    assert.equal(summary.banquetPreorderStatus.currentMenuSubtotal, 3000);
    assert.equal(summary.banquetPreorderStatus.missingMenuAmount, 1000);
    assert.ok(summary.warnings.some(warning => warning.code === 'banquet_menu_minimum_below'));
    assert.ok(summary.warnings.some(warning => warning.code === 'banquet_deposit_below_recommended'));
    assert.equal(summary.totals.entrySubtotal, 3500);
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
            return { rows: priceRules.filter(rule => (params[0] || []).includes(rule.code)) };
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

    const entryRuleQuery = queries.find(query => query.params?.[0]?.includes(BANQUET_ENTRY_PRICE_RULE_CODES.weekday));
    assert.ok(entryRuleQuery, 'entry price rule query exists');
    assert.match(entryRuleQuery.sql, /FROM price_rules/);
    assert.deepEqual([...entryRuleQuery.params[0]].sort(), [
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
            return { rows: priceRules.filter(rule => (params[0] || []).includes(rule.code)) };
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
    assert.match(summaryService, /function buildBanquetOrderRowViewModels\(orderRows = \[\], mode = 'client', currency = CURRENCY\)/);
    assert.match(summaryService, /orderRowViews:\s*\{\s*client: buildBanquetOrderRowViewModels\(orderRows, 'client', CURRENCY\)/);
    assert.match(pdfService, /view\.orderRowViews = normalizedMode === 'client'/);
    assert.match(pdfService, /buildBanquetOrderRowViewModels\(rows, mode, currency\)/);
    assert.match(pageCode, /function summaryClientOrderRowViews\(summary = \{\}, mode = summaryMode\(summary\)\)/);
    assert.match(pageCode, /summary\?\.orderRowViews\?\.\[normalizedMode\]/);
    assert.match(pageCode, /function summaryScheduleRows\(summary, mode = summaryMode\(summary\)\)/);
    assert.match(pageCode, /function summaryArrival\(summary = \{\}\)/);
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
    assert.match(pdfService, /function summaryArrival\(summary = \{\}\)/);
    assert.match(pdfService, /const arrival = summaryArrival\(summary\);/);
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
    assert.match(summaryService, /function normalizeBanquetArrivalProjection/);
    assert.match(summaryService, /banquetArrival: arrival/);
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
        arrival: { date: '2026-06-23', time: '13:45', room: 'Rock', source: 'banquet_group' },
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
    assert.deepEqual(client.modeContract.orderRowTypes, ['program', 'activity', 'ticket', 'entry', 'menu']);
    assert.deepEqual(client.orderRowViews.map(row => row.type), ['program', 'entry', 'menu']);
    assert.deepEqual(client.orderTableColumns.map(column => column.label), ['Позиція', 'К-сть', 'Ціна', 'Сума']);
    const clientProgramPdfRow = client.orderTableRows.find(row => String(row[0]).includes('Паперове шоу'));
    const clientEntryPdfRow = client.orderTableRows.find(row => row[0] === 'Вхід');
    const clientMenuPdfRow = client.orderTableRows.find(row => String(row[0]).includes('Піца'));
    assert.equal(clientProgramPdfRow[2], '—');
    assert.match(clientProgramPdfRow[3], /^2\s*900 ₴$/);
    assert.equal(clientEntryPdfRow[0], 'Вхід');
    assert.equal(clientEntryPdfRow[1], '12 дітей');
    assert.equal(clientEntryPdfRow[2], '300 ₴');
    assert.match(clientEntryPdfRow[3], /^3\s*600 ₴$/);
    assert.match(clientMenuPdfRow[0], /Видача: 15:00/);
    assert.match(clientMenuPdfRow[0], /Примітка: Без цибулі/);
    assert.equal(clientMenuPdfRow[2], '250 ₴');
    assert.equal(clientMenuPdfRow[3], '750 ₴');

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

    assert.match(pdfService, /const rowHeightBudget = Math\.min\(height \+ 2, pageContentHeight\(doc\)\)/);
    assert.match(pdfService, /const pageAdded = ensureSpace\(doc, rowHeightBudget\)/);
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
        arrival: { date: '2026-06-23', time: '13:45', room: '', source: 'banquet_group' },
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

test('booking activity image fallback swaps broken image for emoji media slot', () => {
    const bookingJs = read('js', 'booking.js');
    const dom = new JSDOM(`
        <div id="programsIcons">
            <span class="program-media program-media--image" data-fallback-icon="🎪">
                <img src="/broken/activity.png" alt="">
            </span>
        </div>
    `);
    const sandbox = {
        document: dom.window.document
    };
    const source = [
        extractNamedFunction(bookingJs, '_escB'),
        extractNamedFunction(bookingJs, 'programMediaFallbackHtml'),
        extractNamedFunction(bookingJs, 'fallbackProgramMediaImage'),
        extractNamedFunction(bookingJs, 'handleProgramMediaImageError'),
        'this.__handleProgramMediaImageError = handleProgramMediaImageError;'
    ].join('\n');

    vm.runInNewContext(source, sandbox);
    const img = dom.window.document.querySelector('.program-media img');
    sandbox.__handleProgramMediaImageError({ target: img });

    const media = dom.window.document.querySelector('.program-media');
    assert.equal(media.classList.contains('program-media--image'), false);
    assert.equal(media.classList.contains('program-media--fallback'), true);
    assert.equal(media.classList.contains('program-media--image-failed'), true);
    assert.equal(media.dataset.imageState, 'failed');
    assert.equal(media.querySelector('img'), null);
    assert.equal(media.querySelector('.icon')?.textContent, '🎪');
});

test('booking client mode keeps customer creation in the canonical CRM workflow', () => {
    const bookingJs = read('js', 'booking.js');
    const dom = new JSDOM(`
        <div id="bookingSelectedCustomerCard" class="hidden"></div>
        <div id="bookingCustomerSearchState"></div>
        <div id="customerSearchResults"></div>
        <button id="bookingCreateCustomerBtn">Новий клієнт</button>
        <button id="bookingChangeCustomerBtn" class="hidden">Змінити</button>
        <span id="bookingCustomerModeLabel"></span>
        <input id="customerSearch" value="Олена">
        <input id="selectedCustomerId" value="">
    `);
    const sandbox = {
        document: dom.window.document,
        BookingDrawerState: { clientMode: 'search' }
    };
    const functionStart = bookingJs.indexOf('function bookingInlineCustomerCreationEnabled');
    const functionEnd = bookingJs.indexOf('function bookingCustomerCleanText', functionStart);
    assert.notEqual(functionStart, -1);
    assert.notEqual(functionEnd, -1);
    const source = `${bookingJs.slice(functionStart, functionEnd)}
this.__setBookingClientMode = setBookingClientMode;`;

    vm.runInNewContext(source, sandbox);
    sandbox.__setBookingClientMode('new', { focusSearch: true });

    const createButton = dom.window.document.getElementById('bookingCreateCustomerBtn');
    assert.equal(sandbox.BookingDrawerState.clientMode, 'search');
    assert.equal(createButton.classList.contains('hidden'), false);
    assert.equal(createButton.textContent, 'Новий клієнт');
    assert.equal(createButton.hasAttribute('aria-expanded'), false);
    assert.equal(dom.window.document.activeElement.id, 'customerSearch');

    dom.window.document.getElementById('selectedCustomerId').value = '42';
    sandbox.__setBookingClientMode('existing');

    assert.equal(sandbox.BookingDrawerState.clientMode, 'existing');
    assert.equal(createButton.classList.contains('hidden'), true);
    assert.equal(dom.window.document.getElementById('bookingChangeCustomerBtn').classList.contains('hidden'), false);
});
test('booking workspace exposes adaptive event toggle, client, lead, kitchen, summary, and backend persistence', () => {
    const html = read('index.html');
    const bookingJs = read('js', 'booking.js');
    const bookingActivityScheduleJs = read('js', 'booking-activity-schedule.js');
    const bookingFormJs = read('js', 'booking-form.js');
    const bookingDrawerStateJs = read('js', 'booking-drawer-state.js');
    const bookingBanquetSelectorJs = read('js', 'booking-banquet-selector.js');
    const configJs = read('js', 'config.js');
    const apiJs = read('js', 'api.js');
    const panelCss = read('css', 'panel.css');
    const darkModeCss = read('css', 'dark-mode.css');
    const responsiveCss = read('css', 'responsive.css');
    const route = read('routes', 'bookings.js');
    const customerRoute = read('routes', 'customers.js');
    const customerSearchQuery = read('services', 'customerSearchQuery.js');
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
    assert.match(html, /bookingCreateCustomerBtn/);
    assert.match(html, /bookingCreateLeadBtn/);
    assert.match(html, /CRM/);
    assert.match(html, /bookingNewCustomerForm/);
    assert.match(html, /bookingChangeCustomerBtn/);
    assert.match(html, /programCategoryChips/);
    assert.match(html, /selectedActivitiesList/);
    assert.doesNotMatch(html, /id="detail(?:Duration|Hosts|Price|Age|Kids)"/);
    assert.doesNotMatch(bookingJs, /detailDuration|detailHosts|detailPrice|detailAge|detailKids/);
    assert.match(html, /id="bookingPrimaryAnimatorSelect"/);
    assert.match(html, /id="customerDataToggle" checked hidden/);
    assert.ok(html.indexOf('id="roomSelect"') < html.indexOf('id="customerSearch"'));
    assert.ok(html.indexOf('id="programDetails"') < html.indexOf('id="kidsCountSection"'), 'children count field should sit with selected activity details');
    assert.ok(html.indexOf('id="kidsCountSection"') < html.indexOf('id="customProgramSection"'), 'children count field should stay above custom program details');
    assert.ok(html.indexOf('id="kidsCountSection"') < html.indexOf('id="banquetFields"'), 'children count field should stay above banquet/kitchen fields');
    assert.ok(html.indexOf('id="kidsCountSection"') < html.indexOf('class="form-section status-section"'), 'children count field should stay above status controls');

    assert.match(bookingJs, /const BOOKING_PROGRAM_ONLY_WORKSPACE = true/);
    assert.match(bookingJs, /function resolveBookingChildrenCountSource/);
    assert.match(bookingJs, /function getBookingChildrenCountInputValue/);
    assert.match(bookingJs, /function getKitchenChildrenCountInputValue/);
    assert.match(bookingJs, /function shouldShowStandaloneKidsCountInput/);
    assert.match(bookingJs, /function bookingKitchenChildrenCountFromBooking/);
    assert.match(bookingJs, /source:\s*'kitchen'/);
    assert.match(bookingJs, /editableElementId:\s*'banquetGuests'/);
    assert.match(bookingJs, /editableElementId:\s*'kidsCountInput'/);
    assert.match(bookingJs, /kidsCount:\s*childrenCountSource\.value \|\| null/);
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
    assert.match(bookingJs, /\|\| product\.iconUrl/);
    assert.match(bookingJs, /\|\| product\.icon_url/);
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
    assert.match(bookingJs, /const roomIdentity = selectedBookingRoomResourceIdentity\(\);/);
    assert.match(bookingJs, /const room = roomIdentity\.room;/);
    assert.match(bookingJs, /roomResourceId:\s*roomIdentity\.roomResourceId/);
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
    assert.match(bookingJs, /function getSelectedActivityScheduleRows/);
    assert.match(bookingJs, /bookingActivityScheduleApi\(\)\.buildSelectedActivityScheduleRows/);
    assert.match(bookingJs, /bookingActivityScheduleApi\(\)\.selectedActivityScheduleOverlaps/);
    assert.match(bookingActivityScheduleJs, /BookingActivitySchedule/);
    assert.match(bookingActivityScheduleJs, /module\.exports = api/);
    assert.match(bookingActivityScheduleJs, /function buildSelectedActivityScheduleRows/);
    assert.match(html, new RegExp(`js/booking-activity-schedule\\.js\\?v=${packageJson.version.replace(/\./g, '\\.')}`));
    assert.match(bookingJs, /function setSelectedActivityScheduleTime/);
    assert.match(bookingJs, /function alignSelectedActivityScheduleSequentially/);
    assert.match(bookingJs, /selectedActivityPinataFields/);
    assert.match(bookingJs, /selectedActivitySecondAnimatorFields/);
    assert.match(bookingJs, /function selectedActivitySecondAnimatorDraft/);
    assert.match(bookingJs, /function renderSelectedActivitySecondAnimatorSubflow/);
    assert.match(bookingJs, /data-activity-second-animator-id/);
    assert.match(bookingJs, /activitySecondAnimator:/);
    assert.match(bookingJs, /function selectedActivityPinataDraft/);
    assert.match(bookingJs, /function renderSelectedActivityPinataSubflow/);
    assert.match(bookingJs, /data-activity-pinata-field/);
    assert.match(bookingJs, /activityPinata:/);
    assert.match(bookingJs, /pinataMode:\s*pinataFields\.pinataMode/);
    assert.match(bookingJs, /pinataNumber:\s*pinataFields\.pinataNumber/);
    assert.match(bookingJs, /pinataFillerNumber:\s*pinataFields\.pinataFillerNumber/);
    assert.match(bookingJs, /async function validateSelectedActivitySchedule/);
    assert.match(bookingJs, /async function validateSelectedActivityScheduleBeforeSubmit/);
    assert.match(bookingJs, /selectedActivityPreflightUnavailable/);
    assert.match(bookingJs, /setSelectedActivityPreflightUnavailable\(err\)/);
    assert.match(bookingJs, /data-booking-preflight-retry/);
    assert.match(bookingJs, /BOOKING_SUBMIT_PREFLIGHT_OVERRIDE_TEXT/);
    assert.match(bookingDrawerStateJs, /selectedActivityPreflight:\s*\{/);
    assert.match(bookingBanquetSelectorJs, /BookingDrawerState\.selectedActivityPreflight = \{/);
    assert.match(bookingJs, /data-activity-time-id/);
    assert.match(bookingJs, /<select class="selected-activity-time-input"/);
    assert.match(bookingJs, /function selectedActivityScheduleTimeOptionsHtml/);
    assert.match(bookingActivityScheduleJs, /function buildSelectedActivityScheduleTimeOptions/);
    assert.match(bookingActivityScheduleJs, /function isSelectedActivityScheduleSlotTime/);
    assert.doesNotMatch(bookingJs, /type="time" class="selected-activity-time-input"/);
    assert.match(bookingJs, /data-align-activity-schedule/);
    assert.match(bookingJs, /selected-activity-conflict/);
    assert.match(bookingJs, /baseBooking\.time = primaryRow\.time/);
    assert.match(bookingJs, /time:\s*row\.time/);
    assert.match(bookingJs, /schedule:\s*selectedActivityScheduleExtra\(scheduleRows\)/);
    assert.match(bookingJs, /validateSelectedActivityScheduleBeforeSubmit\(formData, excludeId\)/);
    assert.match(bookingJs, /validateSelectedActivityScheduleBeforeSubmit\(formData, excludeId, \{ forceRetry: true \}\)/);
    assert.match(bookingJs, /apiCreateBookingFull\(booking, linked, \{ banquetActivities, banquetContext \}\)/);
    assert.match(bookingJs, /multiActivity/);
    assert.doesNotMatch(bookingJs, /additionalMultiHostActivity/);
    assert.match(bookingJs, /secondAnimator:\s*secondAnimatorFields\.secondAnimator/);
    assert.match(bookingJs, /secondAnimatorLineId:\s*secondAnimatorFields\.secondAnimatorLineId/);
    assert.match(bookingJs, /function canAddAnimationFromRoomBooking/);
    assert.match(bookingJs, /String\(booking\.lineId \|\| ''\) === ROOM_FIRST_BANQUET_SERVICE_LINE_ID/);
    assert.match(bookingJs, /!String\(booking\.linkedTo \|\| ''\)\.trim\(\)/);
    assert.doesNotMatch(bookingJs, /function canAddAnimationFromRoomBooking[\s\S]*!booking\.programId[\s\S]*function banquetGroupIdFromSnapshot/);
    assert.match(bookingJs, /bookingActivityNextPriceLabel/);
    assert.match(bookingJs, /bookingCustomerDuplicateHint/);
    assert.match(bookingJs, /rememberSelectedCustomerSnapshot/);
    assert.match(bookingJs, /clearSelectedCustomerLinkIfEdited/);
    assert.match(bookingJs, /customer-search-state/);
    assert.ok(bookingJs.includes("const nextMode = mode === 'existing' ? 'existing' : (mode === 'new' && inlineCustomerCreation ? 'new' : 'search');"));
    assert.match(bookingJs, /function bookingCustomerDraftFromForm\(\)/);
    assert.match(bookingJs, /function bookingInlineCustomerCreationEnabled/);
    assert.match(bookingJs, /function bookingNewCustomerDraftIsValid/);
    assert.match(bookingJs, /function bookingCustomerPayloadFromDraft/);
    assert.ok(bookingJs.includes("bookingInlineCustomerCreationEnabled() && BookingDrawerState.clientMode === 'new'"));
    assert.ok(bookingJs.includes('const hasClient = hasSelectedCustomer || hasNewCustomer;'));
    assert.match(bookingJs, /customerDraft\.search && !customerDraft\.name/);
    assert.match(bookingJs, /function addBookingValidationIssue/);
    assert.match(bookingJs, /function selectedActivityScheduleValidationBlockers/);
    assert.match(bookingJs, /issues:\s*state\.issues/);
    assert.match(bookingJs, /BOOKING_SUBMIT_INCOMPLETE_TEXT = 'Показати що заповнити'/);
    assert.match(bookingJs, /\? \(preflightUnavailable \? BOOKING_SUBMIT_PREFLIGHT_OVERRIDE_TEXT : readyText\)/);
    assert.match(bookingJs, /btn-submit--preflight-warning/);
    assert.match(bookingJs, /booking-validation-checklist/);
    assert.match(bookingJs, /bookingValidationFieldTarget/);
    assert.match(bookingJs, /activityTime:/);
    assert.match(bookingJs, /pinata_number/);
    assert.match(bookingJs, /second_animator/);
    assert.match(bookingJs, /extra_host/);
    assert.match(bookingJs, /focusFirstBookingInvalidField\(validation\)/);
    assert.match(bookingJs, /Оберіть існуючого клієнта з пошуку/);
    assert.match(bookingJs, /obj\.customerId = parseInt\(existingId, 10\)/);
    assert.match(bookingJs, /if \(customer\) obj\.customer = customer;/);
    assert.match(bookingJs, /bookingCreateCustomerBtn/);
    assert.match(bookingJs, /function openBookingCustomerCreateWorkflow/);
    assert.match(bookingJs, /function bookingCustomerCreateWorkflowUrl/);
    assert.match(bookingJs, /baseUrl\.searchParams\.set\('action', 'create'\)/);
    assert.match(bookingJs, /baseUrl\.searchParams\.set\('origin', 'booking'\)/);
    assert.match(bookingJs, /baseUrl\.searchParams\.set\('handoff', receiver\.token\)/);
    assert.match(bookingJs, /function handleBookingCustomerHandoffCreated/);
    assert.match(bookingJs, /apiGetCustomer\(normalizedCustomerId\)/);
    assert.match(bookingJs, /applySelectedCustomerToBookingForm/);
    assert.match(bookingJs, /bookingCreateLeadBtn/);
    assert.match(bookingJs, /const BOOKING_LEAD_ACCESS_ROLES/);
    assert.match(bookingJs, /function canOpenBookingLeadCreateWorkflow/);
    assert.match(bookingJs, /canAccessPage\('\/sales-funnel'\)/);
    assert.match(bookingJs, /function bookingLeadCreateWorkflowUrl/);
    assert.match(bookingJs, /baseUrl\.searchParams\.set\('createStage', 'deal'\)/);
    assert.match(bookingJs, /baseUrl\.searchParams\.set\('customerId', String\(selectedCustomerId\)\)/);
    assert.match(bookingJs, /entity:\s*'lead'/);
    assert.match(bookingJs, /function handleBookingLeadHandoffCreated/);
    assert.match(bookingJs, /AppState\.leadConversionContext =/);
    assert.match(bookingJs, /BookingDrawerState\.leadHandoffContext =/);
    assert.match(bookingJs, /obj\.leadId = AppState\.leadConversionContext\.leadId/);
    assert.match(bookingDrawerStateJs, /leadHandoffContext: null/);
    assert.match(bookingJs, /role="button" tabindex="0"/);

    assert.ok(bookingFormJs.indexOf('if (!room)') < bookingFormJs.indexOf('if (hasEvent && !programId)'));
    assert.match(bookingFormJs, /issues:\s*validation\.issues \|\| \[\]/);
    assert.match(bookingFormJs, /setSelectedActivityPrograms\(\[\], \{ renderSummary: false, renderPackage: false, markDirty: false \}\)/);
    assert.match(bookingFormJs, /resetSelectedActivityScheduleState\(\)/);
    assert.match(apiJs, /apiFetchWithAuthRetry/);
    assert.match(apiJs, /async function apiGetBookings\(date, options = \{\}\)/);
    assert.match(apiJs, /options\.banquetActivities/);
    assert.match(apiJs, /payload\.banquetActivities/);
    assert.match(apiJs, /priceDate/);
    assert.match(apiJs, /options\.fresh/);
    assert.match(apiJs, /Array\.isArray\(payload\?\.customers\)/);
    assert.match(customerRoute, /child_birthday/);
    assert.match(customerRoute, /buildCustomerSearchQuery/);
    assert.match(customerSearchQuery, /regexp_replace\(COALESCE\(c\.phone/);

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
    assert.match(route, /activitySecondAnimatorLines/);
    assert.match(route, /bookingRequiresSecondAnimatorLink\(activity\)/);
    assert.match(route, /mainBookingId:\s*activity\.id/);
    assert.match(route, /linkedRows\.push\(secondActivityRow\)/);
    assert.doesNotMatch(route, /b\.createdBy,\s*id,\s*newStatus,\s*b\.kidsCount \|\| null,\s*b\.groupName \|\| null,\s*null\]/);
    assert.match(route, /function runOptionalBookingTransactionStep/);
    assert.match(route, /SAVEPOINT booking_optional_step/);
    assert.match(route, /ROLLBACK TO SAVEPOINT booking_optional_step/);
    assert.match(route, /function commitBookingTransaction/);
    assert.match(route, /booking_commit_not_verified/);
    assert.match(route, /function assertDurableCreatedBookings/);
    assert.match(route, /const banquetActivities = Array\.isArray\(req\.body\?\.banquetActivities\)/);
    assert.match(route, /const activityPinataFields = applyPinataNormalization\(activity\)/);
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
    assert.match(bookingJs, /const programImageUrl = p\.iconUrl \|\| p\.icon_url \|\| p\.imageUrl \|\| p\.image_url/);
    assert.match(bookingJs, /function programMediaFallbackHtml/);
    assert.match(bookingJs, /function handleProgramMediaImageError/);
    assert.match(bookingJs, /container\.addEventListener\('error', handleProgramMediaImageError, true\)/);
    assert.match(bookingJs, /data-fallback-icon/);
    assert.match(bookingJs, /program-media--image-failed/);
    assert.match(bookingJs, /program-media program-media--image/);
    assert.match(bookingJs, /program-media program-media--fallback/);
    assert.match(bookingJs, /loading="lazy" decoding="async"/);
    assert.match(panelCss, /\.program-card-badges/);
    assert.match(panelCss, /\.program-media\s*\{[\s\S]*aspect-ratio:\s*1 \/ 1;/);
    assert.match(panelCss, /\.program-media--image-failed/);
    assert.match(panelCss, /\.program-media img\s*\{[\s\S]*object-fit:\s*cover;/);
    assert.match(panelCss, /\.program-icon\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(76px,\s*1fr\) auto;/);
    assert.match(panelCss, /\.program-price-badge\s*\{[\s\S]*position:\s*static;/);
    assert.match(panelCss, /\.program-duration\s*\{[\s\S]*position:\s*static;/);
    assert.match(darkModeCss, /body\.dark-mode \.program-media/);
    assert.match(darkModeCss, /body\.dark-mode \.program-media--image-failed/);
    assert.match(responsiveCss, /repeat\(2,\s*minmax\(0,\s*1fr\)\); gap:\s*8px;/);
    assert.match(panelCss, /\.program-price-badge/);
    assert.match(panelCss, /\.program-price-badge[\s\S]*min-width:\s*46px/);
    assert.match(panelCss, /\.program-price-badge[\s\S]*color:\s*#ECFDF5/);
    assert.match(panelCss, /body\.dark-mode \.program-price-badge[\s\S]*color:\s*#F8FAFC/);
    assert.match(panelCss, /\.program-next-price-badge/);
    assert.match(panelCss, /\.selected-activity-item/);
    assert.match(panelCss, /\.selected-activities-align/);
    assert.match(panelCss, /\.selected-activity-time-input/);
    assert.match(panelCss, /\.selected-activity-item\.has-conflict/);
    assert.match(panelCss, /\.selected-activity-conflict/);
    assert.match(panelCss, /\.selected-activity-pinata/);
    assert.match(panelCss, /\.selected-activity-pinata-grid/);
    assert.match(panelCss, /\.selected-activity-pinata-error/);
    assert.match(panelCss, /\.btn-submit\.btn-submit--needs-input\s*\{[\s\S]*#F59E0B/);
    assert.match(panelCss, /\.btn-submit\.btn-submit--preflight-warning/);
    assert.match(panelCss, /\.booking-preflight-warning/);
    assert.match(panelCss, /\.booking-preflight-retry/);
    assert.match(panelCss, /\.booking-validation-checklist/);
    assert.match(panelCss, /#programsIcons\[aria-invalid="true"\]/);
    assert.match(panelCss, /#pinataDesignPicker\[aria-invalid="true"\]/);
    assert.match(darkModeCss, /body\.dark-mode \.selected-activity-time-input/);
    assert.match(darkModeCss, /body\.dark-mode \.selected-activity-conflict/);
    assert.match(darkModeCss, /body\.dark-mode \.selected-activity-pinata/);
    assert.match(responsiveCss, /\.selected-activity-pinata-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
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
    assert.match(panelCss, /\.booking-menu-catalog-item\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*min-height:\s*328px;/);
    assert.match(panelCss, /\.booking-menu-catalog-item\s*\{[\s\S]*overflow:\s*hidden;/);
    assert.match(panelCss, /\.booking-menu-catalog-item\s*\{[\s\S]*transform:\s*translate3d\(0,\s*0,\s*0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-item:hover,\s*\.booking-menu-catalog-item:focus-within\s*\{[\s\S]*transform:\s*translate3d\(0,\s*-2px,\s*0\);/);
    assert.match(panelCss, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.booking-menu-catalog-item:hover,[\s\S]*transform:\s*translate3d\(0,\s*0,\s*0\);/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*auto;[\s\S]*aspect-ratio:\s*3 \/ 2;[\s\S]*min-height:\s*0;/);
    assert.match(panelCss, /\.booking-menu-catalog-stepper\s*\{[\s\S]*grid-template-columns:\s*32px minmax\(44px,\s*1fr\) 32px 32px 32px;[\s\S]*flex:\s*0 0 auto;[\s\S]*width:\s*100%;[\s\S]*min-height:\s*32px;[\s\S]*max-width:\s*none;[\s\S]*margin-top:\s*0;/);
    assert.match(panelCss, /@media \(max-height:\s*820px\), \(max-width:\s*1440px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(260px,\s*300px\)[\s\S]*min-height:\s*312px;[\s\S]*aspect-ratio:\s*3 \/ 2;/);
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
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_FALLBACK_IMAGE = ''/);
    assert.match(bookingJs, /data-menu-catalog-fallback/);
    assert.doesNotMatch(bookingJs, /img\.src = BOOKING_MENU_CATALOG_FALLBACK_IMAGE/);
});

test('booking create flow bridges room-source kitchen without an existing banquet group', () => {
    const bookingJs = readBookingSurface();
    const bookingPackageRendererJs = read('js', 'booking-package-renderer.js');
    const apiJs = read('js', 'api.js');
    const bridgeStart = bookingJs.indexOf('const activityFirstKitchenBridge = validateActivityFirstKitchenBridge');
    const bridgeCall = bookingJs.indexOf('apiCreateBanquetMemberBookingFromSource', bridgeStart);
    const normalCreate = bookingJs.indexOf('createResult = await apiCreateBooking(booking,', bridgeStart);
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
    assert.match(bookingJs, /function normalizeBookingNonNegativeCountValue\(value\)/);
    assert.match(bookingJs, /obj\.banquetAdults = formData\.kitchenEnabled \? normalizeBookingNonNegativeCountValue\(document\.getElementById\('banquetAdults'\)\?\.value\) : null;/);
    assert.match(bookingJs, /apiGetCenterPriceRule\(code\)/);
    assert.match(bookingJs, /if \(loadedRules\.length && options\.render !== false && shouldRenderBookingEntryPreviewAfterLoad\(\)\)/);
    assert.match(bookingJs, /function bookingMenuPositionIsEntry\(/);
    assert.match(bookingPackageRendererJs, /function bookingPackageEntryChargeFromPackage\(/);
    assert.match(bookingPackageRendererJs, /function formatBookingPackageEntryAmount\(/);
    assert.match(bookingPackageRendererJs, /function renderBookingPackageEntryRow\(/);
    assert.match(bookingJs, /function bookingPackageRendererCall\(/);
    assert.match(bookingJs, /function renderBookingPackageEntryRow\(bookingPackage = \{\}\) \{\s*return bookingPackageRendererCall\('renderBookingPackageEntryRow', arguments\);/);
    assert.match(bookingJs, /booking-summary-row--subtotal/);
    assert.match(bookingPackageRendererJs, /booking-detail-package-entry-row/);
    assert.match(bookingJs, /entrySubtotal: kitchenEnabled \? \(packageTotals\.entrySubtotal \|\| 0\) : 0/);
    assert.match(bookingJs, /entryCharge: formData\.entryCharge \|\| null/);
    assert.match(bookingJs, /finalTotal: toBookingMoney\(programBasePrice \+ positionsSubtotal \+ entryEstimate\.entrySubtotal\)/);
    assert.match(bookingJs, /Вхід/);
    assert.match(bookingJs, /guests\.value = String\(sourceKidsCount\)/);
    assert.match(bookingJs, /BookingDrawerState\.autoFilledBanquetGuestsFromRoom = \{[\s\S]*sourceBookingId,[\s\S]*value: String\(sourceKidsCount\)/);
    assert.match(bookingJs, /if \(id === 'banquetGuests' && typeof markBanquetGuestsManualOverride === 'function'\) markBanquetGuestsManualOverride\(\)/);
    assert.match(bookingJs, /function clearAutoFilledBanquetFromRoomSelection\(\)[\s\S]*BookingDrawerState\.roomSelectionBanquetContext = null;[\s\S]*clearAutoFilledBanquetGuestsFromRoom\(\);/);
    assert.match(bookingJs, /option\.dataset\.roomLabel = optionData\.text \|\| optionData\.value/);
    assert.match(bookingJs, /function bookingSummaryRoomLabel\(roomSelect, fallbackValue = ''\)[\s\S]*selectedOption\?\.dataset\?\.roomLabel[\s\S]*fallbackValue \|\| roomSelect\?\.value \|\| selectedOption\?\.value/);
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

    assert.match(openPanelBlock, /await loadBookingRoomResourcesForSelect\(\{ selectedRoom: line\.name \}\);[\s\S]*ensureTimelineRoomOption\(line\.name,\s*\{[\s\S]*resourceId:[\s\S]*resourceType:[\s\S]*document\.getElementById\('roomSelect'\)\.value = line\.name;/);
    assert.match(openPanelBlock, /await refreshBookingRoomAvailabilityForSelectedDate\(\);\s*if \(!appliedExplicitBanquetContext && !BookingDrawerState\.legacyReplacementMode\) \{\s*await initializeRoomFirstBookingSourceContext\(\);\s*\}/);
    assert.match(initBlock, /handleBookingRoomSelectionContextChange\(\)/);
    assert.match(initBlock, /BookingDrawerState\.roomSelectionBanquetContext\?\.sourceBookingId/);
    assert.doesNotMatch(initBlock, /apiCreateBanquetGroup|apiCreateBanquetMemberBooking|apiCreateBooking/);
});

test('activity-first kitchen source context refreshes bookings when room cache is stale', () => {
    const bookingJs = readBookingSurface();
    const sourcePickerBlock = bookingJs.slice(
        bookingJs.indexOf('function pickBestRoomBanquetSourceBooking'),
        bookingJs.indexOf('function sourceBookingToBanquetContext')
    );
    const roomSelectionBlock = bookingJs.slice(
        bookingJs.indexOf('async function handleBookingRoomSelectionContextChange'),
        bookingJs.indexOf('function clearSelectedCustomerLink')
    );

    assert.match(sourcePickerBlock, /function pickRoomBanquetSourceBookingFromBookings\(bookings = \[\], roomName, targetTime = ''\)/);
    assert.match(sourcePickerBlock, /sameBookingRoom\(booking\.room, room\)/);
    assert.match(sourcePickerBlock, /!roomBookingIsCancelled\(booking\)[\s\S]*!roomBookingIsLinkedChild\(booking\)/);
    assert.match(sourcePickerBlock, /function fetchFreshRoomBanquetSourceBooking\(roomName, targetTime = document\.getElementById\('bookingTime'\)\?\.value \|\| ''\)/);
    assert.match(sourcePickerBlock, /getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(sourcePickerBlock, /pickRoomBanquetSourceBookingFromBookings\(bookings, roomName, targetTime\)/);
    assert.match(roomSelectionBlock, /let sourceBooking = pickRoomBanquetSourceBooking\(roomName, targetTime\);/);
    assert.match(roomSelectionBlock, /if \(!sourceBooking\) \{\s*sourceBooking = await fetchFreshRoomBanquetSourceBooking\(roomName, targetTime\);\s*if \(!isLatestBookingRoomSelectionContextRequest\(token\)\) return;\s*\}/);
    assert.match(roomSelectionBlock, /if \(!sourceBooking\) \{\s*clearAutoFilledBanquetFromRoomSelection\(\);\s*return;\s*\}/);
    assert.doesNotMatch(sourcePickerBlock, /apiCreateBanquetGroup|apiCreateBanquetMemberBooking|apiCreateBooking/);
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

test('room-first kitchen selector explains missing source activity before generic empty hint', () => {
    const bookingJs = readBookingSurface();
    const selectorBlock = bookingJs.slice(
        bookingJs.indexOf('function renderBookingBanquetGroupSelector'),
        bookingJs.indexOf('async function refreshBookingBanquetGroupCandidates')
    );
    const sourceMissingBlock = bookingJs.slice(
        bookingJs.indexOf('function bookingBanquetSelectorMissingRoomSourceMessage'),
        bookingJs.indexOf('function bookingBanquetSelectorSourceMeta')
    );
    const missingHint = selectorBlock.indexOf('hint.textContent = missingRoomSourceMessage');
    const genericEmptyHint = selectorBlock.indexOf("hint.textContent = 'Банкетів цього клієнта на дату не знайдено.'");

    assert.match(sourceMissingBlock, /if \(String\(selectedGroupId \|\| ''\)\.trim\(\)\) return '';/);
    assert.match(sourceMissingBlock, /realState\?\.hasRealCandidates \|\| realState\?\.fallbackCandidates\?\.length/);
    assert.match(sourceMissingBlock, /if \(!isParkTimelineBookingMode\(\) \|\| !isBookingKitchenEnabled\(\)\) return '';/);
    assert.match(sourceMissingBlock, /if \(AppState\.editingBookingId\) return '';/);
    assert.match(sourceMissingBlock, /if \(drawerMode !== BOOKING_DRAWER_MODES\.CREATE_KITCHEN\) return '';/);
    assert.match(sourceMissingBlock, /BookingDrawerState\.roomSourceContext\?\.sourceBookingId/);
    assert.match(sourceMissingBlock, /BookingDrawerState\.roomSelectionBanquetContext\?\.sourceBookingId/);
    assert.match(sourceMissingBlock, /BookingDrawerState\.roomBookingAnimationBridge\?\.sourceBookingId/);
    assert.match(sourceMissingBlock, /document\.getElementById\('roomSelect'\)\?\.value/);
    assert.match(sourceMissingBlock, /Активність у вибраній кімнаті ще не підтягнулась/);
    assert.match(selectorBlock, /const missingRoomSourceMessage = bookingBanquetSelectorMissingRoomSourceMessage\(realState, selectedGroupId\);/);
    assert.match(selectorBlock, /else if \(missingRoomSourceMessage\) \{\s*hint\.textContent = missingRoomSourceMessage;\s*\} else if \(selected\)/);
    assert.ok(missingHint >= 0, 'missing source activity hint is rendered');
    assert.ok(genericEmptyHint > missingHint, 'missing source activity hint wins over generic empty hint');
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
    const normalCreateCall = createFlowBlock.indexOf('createResult = await apiCreateBooking(booking,');

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
    const normalCreateCall = createFlowBlock.indexOf('createResult = await apiCreateBooking(booking,');

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
    assert.match(bookingJs, /function stripEmptyBookingPackageForExistingGroupMember\(booking = \{\}\)/);
    assert.match(createFlowBlock, /existing_group_member'[\s\S]*stripEmptyBookingPackageForExistingGroupMember\(booking\);[\s\S]*apiCreateBanquetMemberBooking\(createPath\.groupId/);
    assert.match(createFlowBlock, /sourceBookingId: createPath\.sourceBookingId \|\| null/);
    assert.match(createFlowBlock, /role: 'kitchen'/);
});

test('package-less existing banquet members omit package input without touching material packages', () => {
    const bookingJs = readBookingSurface();
    const start = bookingJs.indexOf('function stripEmptyBookingPackageForExistingGroupMember');
    const end = bookingJs.indexOf('function buildBookingObject', start);
    const context = {};
    vm.createContext(context);
    vm.runInContext(bookingJs.slice(start, end), context, { filename: 'js/booking.js' });

    const empty = {
        programBasePrice: 0,
        menuPositions: [],
        serviceEvents: [],
        extraData: {
            disposableQa: { runId: 'smoke-run' },
            bookingPackage: {
                entryCharge: null,
                menuPositions: [],
                serviceEvents: []
            }
        }
    };
    context.stripEmptyBookingPackageForExistingGroupMember(empty);
    assert.equal(Object.hasOwn(empty, 'programBasePrice'), false);
    assert.equal(Object.hasOwn(empty, 'menuPositions'), false);
    assert.equal(Object.hasOwn(empty, 'serviceEvents'), false);
    assert.equal(Object.hasOwn(empty.extraData, 'bookingPackage'), false);
    assert.equal(empty.extraData.disposableQa.runId, 'smoke-run');

    const material = {
        programBasePrice: 0,
        menuPositions: [{ productId: 'menu-1' }],
        serviceEvents: [],
        extraData: { bookingPackage: { menuPositions: [{ productId: 'menu-1' }] } }
    };
    context.stripEmptyBookingPackageForExistingGroupMember(material);
    assert.equal(material.menuPositions.length, 1);
    assert.equal(material.extraData.bookingPackage.menuPositions.length, 1);
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
    const standaloneAssignments = bookingJs.match(/standaloneBookingOverride\s*=\s*true/g) || [];
    assert.equal(standaloneAssignments.length, 4, 'standalone override should be limited to the explicit action and guarded legacy replacement flow');
    assert.match(openPanelBlock, /if \(BookingDrawerState\.legacyReplacementMode\) \{\s*BookingDrawerState\.standaloneBookingOverride = true;/);
    assert.match(bookingJs, /data-booking-standalone-override[\s\S]*BookingDrawerState\.standaloneBookingOverride = true/);
    assert.match(bookingJs, /async function createLegacyBanquetReplacement[\s\S]*BookingDrawerState\.standaloneBookingOverride = true/);
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
    assert.equal(manifest.byId['menu_2026_031_item'], undefined);
    assert.equal(manifest.byCode['MENU-031'], undefined);

    const values = [
        ...Object.values(manifest.byCode || {}),
        ...Object.values(manifest.byId || {})
    ];
    assert.equal(values.includes('products/menu-031.jpg'), false);
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
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-row').length, 1);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-row--entertainment').length, 0);
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
    assert.doesNotMatch(menuText, /АН\(60\)|Бульбашкове шоу/);
    assert.match(menuText, /4\s*780/);
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
    const activitiesSection = document.querySelector('.booking-banquet-section--activities');
    assert.ok(activitiesSection, 'canonical banquet activities section renders');
    assert.equal(activitiesSection.querySelectorAll('.booking-banquet-member--activity').length, 2);
    assert.equal(activitiesSection.querySelectorAll('[data-booking-id="BK-UX-AN"]').length, 1);
    assert.equal(activitiesSection.querySelectorAll('[data-booking-id="BK-UX-BUBBLES"]').length, 1);
    assert.match(activitiesSection.textContent || '', /Активності банкету/);
    assert.match(activitiesSection.textContent || '', /13:45\s*·\s*АН\(60\)/);
    assert.match(activitiesSection.textContent || '', /Бульбашкове шоу/);
    assert.match(activitiesSection.textContent || '', /#BK-UX-AN\s*·\s*Марвел/);
    assert.equal(document.querySelectorAll('[data-booking-id="BK-UX-AN"]').length, 1);
    assert.equal(document.querySelector('.booking-banquet-section--service')?.textContent.includes('Бульбашкове шоу'), false);
    assert.equal(text.includes('Кухня / меню не прив'), false);
    assert.equal(text.includes('Service / manual'), false);
    assert.equal(text.includes('group-first'), false);
    assert.ok(document.querySelector('details.booking-banquet-technical'), 'technical details stay available but collapsed by default');
    assert.equal(document.querySelector('details.booking-banquet-technical')?.hasAttribute('open'), false);
});

test('booking modal skips full banquet detail for standalone activities without banquet signals', () => {
    const context = createBanquetModalDetailHarness();
    const activity = {
        id: 'BK-STANDALONE-ACTIVITY',
        businessContext: 'event_genix',
        date: '2026-06-29',
        time: '16:30',
        duration: 90,
        room: 'Room 3',
        label: 'KV6(90)',
        programName: 'Forest Academy',
        programId: 'forest-academy',
        status: 'confirmed',
        price: 2700
    };

    assert.equal(context.renderFullBanquetDetail(activity, [], null), '');

    const kitchen = {
        id: 'BK-STANDALONE-KITCHEN',
        businessContext: 'event_genix',
        date: '2026-06-29',
        time: '17:00',
        room: 'Room 3',
        label: 'Kitchen',
        status: 'confirmed',
        extraData: {
            bookingPackage: {
                finalTotal: 1200,
                menuPositions: [{
                    id: 'menu-standalone',
                    title: 'Test menu',
                    kitchenType: 'menu',
                    quantity: 1,
                    servingUnit: 'portion',
                    unitPrice: 1200,
                    subtotal: 1200,
                    servingTime: '17:00'
                }]
            }
        }
    };
    assert.match(context.renderFullBanquetDetail(kitchen, [], null), /booking-banquet-full-detail/);
});

function renderScreenshotBanquetMenuRegressionFixture() {
    const context = createBanquetModalDetailHarness();
    const kitchen = {
        id: 'BK-SCREENSHOT-KITCHEN',
        businessContext: 'event_genix',
        date: '2026-06-27',
        time: '12:30',
        room: 'Марвел',
        label: 'Кухня',
        status: 'confirmed',
        price: 7160,
        extraData: {
            bookingPackage: {
                finalTotal: 7160,
                menuPositions: [
                    {
                        id: 'menu-pickles',
                        title: 'Асорті домашніх різносолів',
                        kitchenType: 'menu',
                        quantity: 4,
                        servingUnit: 'порції',
                        unitPrice: 400,
                        subtotal: 1600,
                        servingTime: '12:30'
                    },
                    {
                        id: 'menu-chicken',
                        title: 'Куряче філе запечене',
                        kitchenType: 'menu',
                        quantity: 4,
                        servingUnit: 'додаток',
                        unitPrice: 40,
                        subtotal: 160,
                        servingTime: '12:30'
                    },
                    {
                        id: 'menu-pineapple',
                        title: 'Ананас консервований',
                        kitchenType: 'menu',
                        quantity: 6,
                        servingUnit: 'додаток',
                        unitPrice: 40,
                        subtotal: 240,
                        servingTime: '12:30'
                    },
                    {
                        id: 'menu-potatoes',
                        title: 'Картопляне пюре',
                        kitchenType: 'menu',
                        quantity: 3,
                        servingUnit: 'порції',
                        unitPrice: 90,
                        subtotal: 270,
                        servingTime: '14:30'
                    },
                    {
                        id: 'menu-spaghetti',
                        title: 'Спагеті',
                        kitchenType: 'menu',
                        quantity: 6,
                        servingUnit: 'порцій',
                        unitPrice: 65,
                        subtotal: 390,
                        servingTime: '14:30'
                    }
                ],
                entryCharge: {
                    title: 'Вхід',
                    quantity: 15,
                    unitPrice: 300,
                    subtotal: 4500
                },
                entrySubtotal: 4500
            }
        }
    };
    const candyActivity = {
        id: 'BK-SCREENSHOT-CANDY',
        businessContext: 'event_genix',
        date: '2026-06-27',
        time: '12:30',
        duration: 90,
        room: 'Марвел',
        label: 'Цукерки(90)',
        programName: 'МК Цукерки',
        programId: 'mk_candy',
        category: 'masterclass',
        kidsCount: 11,
        unitPrice: 370,
        isPerChild: true,
        status: 'confirmed',
        price: 4070
    };
    const snapshot = {
        source: 'group',
        groupId: 'BQ-SCREENSHOT-MENU',
        group: {
            id: 'BQ-SCREENSHOT-MENU',
            groupName: 'Скріншот меню',
            date: '2026-06-27',
            room: 'Марвел',
            status: 'active'
        },
        members: [
            { bookingId: kitchen.id, role: 'primary', isPrimary: true, isKitchenCandidate: true, booking: kitchen },
            { bookingId: candyActivity.id, role: 'activity', booking: candyActivity }
        ],
        warnings: []
    };

    const html = context.renderFullBanquetDetail(kitchen, [], snapshot);
    const dom = new JSDOM(`<main>${html}</main>`);
    const document = dom.window.document;
    const menuSection = document.querySelector('.booking-banquet-section--menu');
    const menuText = menuSection?.textContent || '';

    return { document, menuSection, menuText };
}

test('banquet menu regression keeps one table header and separates activities', () => {
    const { document, menuSection, menuText } = renderScreenshotBanquetMenuRegressionFixture();

    assert.ok(menuSection, 'banquet menu section renders');
    assert.match(menuText, /Асорті домашніх різносолів/);
    assert.match(menuText, /Куряче філе запечене/);
    assert.match(menuText, /Ананас консервований/);
    assert.match(menuText, /Картопляне пюре/);
    assert.match(menuText, /Спагеті/);
    assert.doesNotMatch(menuText, /Цукерки\(90\)/);
    assert.match(menuText, /Вхід/);
    assert.match(menuText, /1\s*600\s*₴/);
    assert.match(menuText, /4\s*500\s*₴/);
    assert.match(menuText, /7\s*160\s*₴/);
    assert.doesNotMatch(menuText, /UAH|11230|4070|4500|1600/);
    assert.equal(menuSection.querySelectorAll('.booking-detail-package-table-head').length, 1);
    const packageRows = Array.from(menuSection.querySelectorAll('.booking-detail-package-table-row'));
    assert.ok(
        packageRows.every(row => row.querySelectorAll('.booking-detail-package-money').length === 2),
        'menu rows share the same money styling hook'
    );
    assert.ok(
        menuSection.querySelector('.booking-detail-package-entry-row .booking-detail-package-money--subtotal'),
        'entry subtotal shares the banquet money styling hook'
    );
    assert.ok(
        menuSection.querySelector('.booking-detail-package-total .booking-detail-package-money--total'),
        'banquet total shares the banquet money styling hook'
    );
    const activitySection = document.querySelector('.booking-banquet-section--activities');
    assert.equal(activitySection?.querySelectorAll('[data-booking-id="BK-SCREENSHOT-CANDY"]').length, 1);
    assert.match(activitySection?.textContent || '', /12:30\s*·\s*МК Цукерки/);
    assert.match(activitySection?.textContent || '', /#BK-SCREENSHOT-CANDY\s*·\s*Марвел/);
    assert.match(activitySection?.textContent || '', /Активність/);
    assert.match(activitySection?.textContent || '', /4\s*070\s*₴/);
});

test('booking package v3 persists canonical ticket snapshot and derives entry compatibility subtotal', () => {
    const quote = {
        quoteContractVersion: 1,
        quoteFingerprint: `v1:${'a'.repeat(64)}`,
        businessContext: 'event_genix',
        admissionContext: 'reserved_table_room',
        dayType: 'weekday',
        pricingDate: '2026-07-18',
        pricedAt: '2026-07-18T10:00:00.000Z',
        ticketSubtotal: 320,
        ticketLines: [{
            ticketTypeId: 1,
            ticketTypeCode: 'regular_child',
            ticketTypeName: 'Звичайний дитячий',
            audience: 'child',
            quantity: 1,
            unitPriceUah: 310,
            subtotalUah: 310,
            tariffVersionId: 101,
            effectiveFrom: '2026-07-14',
            admissionContext: 'reserved_table_room',
            dayType: 'weekday',
            currency: 'UAH'
        }, {
            ticketTypeId: 5,
            ticketTypeCode: 'adult_companion',
            ticketTypeName: 'Дорослий супроводжуючий',
            audience: 'adult',
            quantity: 1,
            unitPriceUah: 10,
            subtotalUah: 10,
            tariffVersionId: 105,
            effectiveFrom: '2026-07-14',
            admissionContext: 'reserved_table_room',
            dayType: 'weekday',
            currency: 'UAH'
        }]
    };
    const pkg = buildBookingPackage({
        date: '2026-07-18',
        programBasePrice: 1000,
        menuPositions: [{ title: 'Піца', quantity: 1, unitPrice: 500 }],
        ticketQuote: quote
    });
    assert.equal(pkg.schemaVersion, 3);
    assert.equal(pkg.entryCharge, null);
    assert.equal(pkg.ticketSubtotal, 320);
    assert.equal(pkg.entrySubtotal, 320);
    assert.equal(pkg.finalTotal, 1820);
    assert.equal(pkg.ticketLines.length, 2);
    assert.equal(pkg.ticketQuoteContractVersion, 1);
    assert.equal(pkg.ticketQuoteFingerprint, `v1:${'a'.repeat(64)}`);
    assert.equal(pkg.ticketBusinessContext, 'event_genix');
    assert.equal(pkg.ticketPricingContext, 'reserved_table_room');
});

test('applyBookingPackage persists a canonical ticket-only quote as a v3 package', () => {
    const booking = {
        date: '2026-07-17',
        price: 0,
        ticketQuote: {
            legacy: false,
            admissionContext: 'standard',
            dayType: 'weekday',
            pricingDate: '2026-07-17',
            pricedAt: '2026-07-17T10:00:00.000Z',
            ticketSubtotal: 350,
            ticketLines: [{
                ticketTypeId: 1,
                ticketTypeCode: 'regular_child',
                ticketTypeName: 'Regular child',
                audience: 'child',
                quantity: 1,
                unitPriceUah: 350,
                subtotalUah: 350,
                tariffVersionId: 101,
                effectiveFrom: '2026-07-14',
                admissionContext: 'standard',
                dayType: 'weekday',
                currency: 'UAH'
            }]
        }
    };

    const result = applyBookingPackage(booking);

    assert.equal(result, booking);
    assert.equal(booking.extraData.bookingPackage.schemaVersion, 3);
    assert.equal(booking.extraData.bookingPackage.programBasePrice, 0);
    assert.equal(booking.extraData.bookingPackage.positionsSubtotal, 0);
    assert.equal(booking.extraData.bookingPackage.entryCharge, null);
    assert.equal(booking.extraData.bookingPackage.entrySubtotal, 350);
    assert.equal(booking.extraData.bookingPackage.ticketSubtotal, 350);
    assert.equal(booking.extraData.bookingPackage.finalTotal, 350);
    assert.equal(booking.extraData.bookingPackage.ticketLines.length, 1);
    assert.equal(booking.extraData.bookingPackage.ticketLines[0].ticketTypeCode, 'regular_child');
    assert.equal(booking.price, 350);
});

test('legacy entry conversion replaces the old admission subtotal without double counting it', () => {
    const ticketQuote = {
        legacy: false,
        admissionContext: 'reserved_table_room',
        dayType: 'weekday',
        pricingDate: '2026-07-17',
        pricedAt: '2026-07-17T10:00:00.000Z',
        ticketSubtotal: 3740,
        ticketLines: [{
            ticketTypeId: 1,
            ticketTypeCode: 'regular_child',
            ticketTypeName: 'Regular child',
            audience: 'child',
            quantity: 1,
            unitPriceUah: 3740,
            subtotalUah: 3740,
            tariffVersionId: 101,
            effectiveFrom: '2026-07-14',
            admissionContext: 'reserved_table_room',
            dayType: 'weekday',
            currency: 'UAH'
        }]
    };
    const cases = [
        { price: 3600, expectedBase: 0, expectedTotal: 3740 },
        { price: 4600, expectedBase: 1000, expectedTotal: 4740 }
    ];

    for (const fixture of cases) {
        const booking = {
            date: '2026-07-17',
            price: fixture.price,
            extraData: {
                bookingPackage: {
                    schemaVersion: 2,
                    entryCharge: {
                        quantity: 12,
                        unitPrice: 300,
                        subtotal: 3600,
                        ruleCode: 'banquet_entry_weekday_child'
                    },
                    entrySubtotal: 3600,
                    warnings: [
                        { code: 'entry_quantity_missing', message: 'Stale legacy warning' },
                        { code: 'custom_warning', message: 'Keep this warning' }
                    ]
                }
            },
            ticketQuote
        };

        applyBookingPackage(booking);

        assert.equal(booking.extraData.bookingPackage.programBasePrice, fixture.expectedBase);
        assert.equal(booking.extraData.bookingPackage.ticketSubtotal, 3740);
        assert.equal(booking.extraData.bookingPackage.finalTotal, fixture.expectedTotal);
        assert.equal(booking.price, fixture.expectedTotal);
        assert.deepEqual(
            booking.extraData.bookingPackage.warnings.map(warning => warning.code),
            ['custom_warning']
        );
    }
});

test('historical no-ticket package stays at zero during an unrelated update', async () => {
    let tariffQueries = 0;
    const booking = {
        date: '2026-07-17',
        price: 0,
        banquetGuests: 2,
        banquetAdults: 1,
        extraData: {
            bookingPackage: {
                schemaVersion: 2,
                programBasePrice: 0,
                entryCharge: null,
                entrySubtotal: 0,
                finalTotal: 0,
                menuPositions: [],
                serviceEvents: []
            }
        }
    };

    await applyBookingPackageEntryCharge({
        async query() {
            tariffQueries += 1;
            return {
                rows: [{ code: BANQUET_ENTRY_PRICE_RULE_CODES.weekday, value: 310 }]
            };
        }
    }, booking, { preserveNoTicketPackage: true });

    assert.equal(tariffQueries, 0);
    assert.equal(booking.extraData.bookingPackage.schemaVersion, 2);
    assert.equal(booking.extraData.bookingPackage.entryCharge, null);
    assert.equal(booking.extraData.bookingPackage.entrySubtotal, 0);
    assert.equal(booking.extraData.bookingPackage.finalTotal, 0);
    assert.equal(booking.price, 0);
});

test('applyBookingPackage rejects ticket quotes hidden in package or extra-data aliases', () => {
    const candidates = [{
        bookingPackage: {
            ticketQuote: { ticketLines: [], ticketSubtotal: 1 }
        }
    }, {
        extraData: {},
        extra_data: JSON.stringify({
            booking_package: {
                ticket_quote: { ticket_lines: [], ticket_subtotal: 1 }
            }
        })
    }];
    for (const booking of candidates) {
        assert.throws(
            () => applyBookingPackage(booking),
            error => (
                error.code === 'TICKET_SNAPSHOT_INPUT_FORBIDDEN'
                && error.statusCode === 422
                && Boolean(error.details?.field)
            )
        );
    }
});

test('booking update calculates package only after locked legacy data and canonical ticket quote are resolved', () => {
    const source = read('routes', 'bookings.js');
    const updateStart = source.indexOf("router.put('/:id'");
    const updateEnd = source.indexOf("router.patch('/:id/payment'", updateStart);
    assert.notEqual(updateStart, -1);
    assert.notEqual(updateEnd, -1);
    const updateRoute = source.slice(updateStart, updateEnd);
    const mergeIndex = updateRoute.indexOf('mergeExistingExtraDataForBookingUpdate(b, oldBooking)');
    const quoteIndex = updateRoute.indexOf('await resolveAndApplyAdmissionTicketQuote({');
    const packageIndex = updateRoute.indexOf('await applyBookingPackageEntryCharge(client, b');

    assert.ok(mergeIndex >= 0);
    assert.ok(quoteIndex > mergeIndex);
    assert.ok(packageIndex > quoteIndex);
    assert.match(updateRoute, /const ticketResolution = await resolveAndApplyAdmissionTicketQuote\(\{/);
    assert.match(
        updateRoute,
        /preserveNoTicketPackage:\s*ticketResolution\.preserveNoTicketPackage === true/
    );
    assert.equal(
        updateRoute.slice(0, quoteIndex).includes('applyBookingPackage(b)'),
        false,
        'an unvalidated client quote must not overwrite the legacy package base before canonical resolution'
    );
});

test('booking package v3 supports explicit zero-ticket snapshot and blocks manual Вхід rows', () => {
    const empty = buildBookingPackage({
        date: '2026-07-18',
        programBasePrice: 0,
        menuPositions: [],
        ticketQuote: {
            legacy: false,
            ticketLines: [],
            ticketSubtotal: 0,
            admissionContext: 'standard',
            dayType: 'weekend',
            pricingDate: '2026-07-18',
            pricedAt: '2026-07-18T10:00:00.000Z'
        }
    });
    assert.equal(empty.schemaVersion, 3);
    assert.deepEqual(empty.ticketLines, []);
    assert.equal(empty.ticketSubtotal, 0);
    assert.throws(
        () => buildBookingPackage({
            date: '2026-07-18',
            menuPositions: [{ title: 'Вхід', quantity: 1, unitPrice: 1 }],
            ticketQuote: {
                legacy: false,
                ticketLines: [],
                ticketSubtotal: 0,
                admissionContext: 'standard',
                dayType: 'weekend',
                pricingDate: '2026-07-18'
            }
        }),
        error => (
            error.code === 'TICKET_MANUAL_ENTRY_CONFLICT'
            && error.statusCode === 422
            && /«Вхід»/.test(error.publicMessage)
            && error.details?.field === 'menuPositions'
            && error.details?.conflictWith === 'ticketLines'
        )
    );
});

test('booking package audit records ticket lines, subtotal, and explicit conversion reason', () => {
    const line = {
        ticketTypeId: 1,
        ticketTypeCode: 'regular_child',
        ticketTypeName: 'Звичайний дитячий',
        audience: 'child',
        quantity: 1,
        unitPriceUah: 350,
        subtotalUah: 350,
        tariffVersionId: 101,
        effectiveFrom: '2026-07-14',
        admissionContext: 'standard',
        dayType: 'weekday',
        currency: 'UAH'
    };
    const audit = bookingPackageAudit(
        { date: '2026-07-18', extra_data: { bookingPackage: { schemaVersion: 2, entryCharge: { subtotal: 300 } } } },
        {
            date: '2026-07-18',
            convertLegacy: true,
            extraData: { bookingPackage: { schemaVersion: 3, ticketLines: [line], ticketSubtotal: 350 } }
        }
    );
    assert.equal(audit.ticketAudit.changed, true);
    assert.equal(audit.ticketAudit.reason, 'explicit_conversion');
    assert.equal(audit.ticketAudit.newTicketSubtotal, 350);
    assert.equal(audit.ticketAudit.newTicketLines[0].ticketTypeCode, 'regular_child');
});

test('booking modal renders the attached pinata once and ignores cancelled or foreign activities', () => {
    const context = createBanquetModalDetailHarness();
    const primary = {
        id: 'BK-PINATA-PRIMARY',
        businessContext: 'event_genix',
        date: '2026-07-20',
        time: '14:00',
        room: 'Марвел',
        label: 'Кухня',
        status: 'confirmed',
        extraData: {
            bookingPackage: {
                finalTotal: 1200,
                menuPositions: [{
                    id: 'menu-pinata-test',
                    title: 'Дитяче меню',
                    quantity: 1,
                    servingUnit: 'порція',
                    unitPrice: 1200,
                    subtotal: 1200
                }]
            }
        }
    };
    const pinata = {
        time: '15:30',
        room: 'Марвел',
        label: 'Піньята XL',
        programName: 'Піньята',
        status: 'confirmed',
        price: 1800
    };
    const cancelledPinata = {
        id: 'BK-PINATA-CANCELLED',
        time: '16:00',
        room: 'Марвел',
        programName: 'Піньята скасована',
        status: 'cancelled'
    };
    const foreignPinata = {
        id: 'BK-PINATA-FOREIGN',
        time: '17:00',
        room: 'Інший зал',
        programName: 'Піньята стороння',
        status: 'confirmed'
    };
    const snapshot = {
        source: 'group',
        groupId: 'BQ-PINATA-ACTIVITIES',
        group: {
            id: 'BQ-PINATA-ACTIVITIES',
            date: '2026-07-20',
            room: 'Марвел',
            status: 'active'
        },
        members: [
            { bookingId: primary.id, role: 'primary', isPrimary: true, isKitchenCandidate: true, booking: primary },
            { bookingId: 'BK-PINATA-ATTACHED', role: 'activity', booking: pinata },
            { bookingId: 'BK-PINATA-ATTACHED', role: 'activity', booking: { ...pinata, id: 'BK-PINATA-ATTACHED' } },
            { bookingId: cancelledPinata.id, role: 'activity', booking: cancelledPinata }
        ],
        bookings: {
            activities: [{ ...pinata, id: 'BK-PINATA-ATTACHED' }, cancelledPinata, foreignPinata]
        },
        warnings: []
    };

    const render = () => new JSDOM(
        `<main>${context.renderFullBanquetDetail(primary, [], snapshot)}</main>`
    ).window.document;
    const document = render();
    const activitiesSection = document.querySelector('.booking-banquet-section--activities');
    const activityCards = activitiesSection?.querySelectorAll('.booking-banquet-member') || [];
    const activityText = activitiesSection?.textContent || '';

    assert.ok(activitiesSection, 'attached activity membership renders in the canonical section');
    assert.equal(activityCards.length, 1);
    assert.equal(activitiesSection.querySelectorAll('[data-booking-id="BK-PINATA-ATTACHED"]').length, 1);
    assert.match(activityText, /15:30\s*·\s*Піньята/);
    assert.match(activityText, /#BK-PINATA-ATTACHED\s*·\s*Марвел/);
    assert.match(activityText, /Активність/);
    assert.doesNotMatch(activityText, /Піньята XL/);
    assert.doesNotMatch(document.body.textContent || '', /BK-PINATA-CANCELLED|BK-PINATA-FOREIGN/);
    assert.equal(
        document.querySelectorAll('.booking-banquet-section--summary [data-booking-id="BK-PINATA-PRIMARY"]').length,
        1
    );

    const repeatedDocument = render();
    assert.equal(
        repeatedDocument.querySelectorAll('.booking-banquet-section--activities [data-booking-id="BK-PINATA-ATTACHED"]').length,
        1
    );
});

test('banquet activity regression renders membership card once outside menu', () => {
    const { document, menuSection } = renderScreenshotBanquetMenuRegressionFixture();
    const candyActivity = document.querySelector(
        '.booking-banquet-section--activities [data-booking-id="BK-SCREENSHOT-CANDY"]'
    );

    assert.ok(candyActivity, 'per-child candy activity renders from canonical membership');
    assert.equal(menuSection.textContent.includes('Цукерки(90)'), false);
    assert.equal(document.querySelectorAll('[data-booking-id="BK-SCREENSHOT-CANDY"]').length, 1);
    assert.match(candyActivity.textContent || '', /МК Цукерки/);
    assert.match(candyActivity.textContent || '', /12:30/);
    assert.match(candyActivity.textContent || '', /Марвел/);
    assert.match(candyActivity.textContent || '', /Активність/);
    assert.match(candyActivity.textContent || '', /#BK-SCREENSHOT-CANDY/);
});

test('banquet menu warning highlights per-child activity and entry children mismatch', () => {
    const { document } = renderScreenshotBanquetMenuRegressionFixture();
    const warningsText = document.querySelector('.booking-banquet-section--warnings')?.textContent || '';

    assert.match(warningsText, /Цукерки\(90\): ціна відповідає 11 дітям, але Вхід рахується на 15 дітей/);
});

test('booking modal puts primary banquet activity into canonical activities section without duplicates', () => {
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
        kidsCount: 8,
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
    const activitiesSection = document.querySelector('.booking-banquet-section--activities');
    assert.ok(activitiesSection, 'primary activity is visible in the canonical activities section');
    assert.equal(activitiesSection.querySelectorAll('[data-booking-id="BK-ACTIVITY-PRIMARY"]').length, 1);
    assert.equal(activitiesSection.querySelectorAll('.booking-banquet-member--primary').length, 1);
    assert.match(activitiesSection.textContent || '', /15:00\s*·\s*Мафія/);
    assert.match(activitiesSection.textContent || '', /#BK-ACTIVITY-PRIMARY\s*·\s*Диван 3/);
    assert.match(activitiesSection.textContent || '', /Основна/);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-row').length, 1);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-row--entertainment').length, 0);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-table-head').length, 1);
    assert.equal(document.querySelectorAll('.booking-banquet-section--menu .booking-detail-package-serving-title').length, 0);
    assert.match(menuText, /Овочева тарілка/);
    assert.doesNotMatch(menuText, /Мафія\(90\)/);
    assert.match(menuText, /Вхід/);
    assert.doesNotMatch(menuText, /РОЗВАГИ/);
    assert.doesNotMatch(menuText, /Меню:\s*1/);
    assert.doesNotMatch(menuText, /Розваги:\s*1/);
    assert.doesNotMatch(menuText, /Позиції меню/);
    assert.doesNotMatch(menuText, /Розважальні позиції/);
    assert.doesNotMatch(menuText, /1\s*позиці/);
    assert.match(menuText, /6\s*600/);
    assert.equal(document.querySelector('.booking-banquet-section--summary'), null);
    assert.doesNotMatch(
        document.querySelector('details.booking-banquet-technical')?.textContent || '',
        /BK-ACTIVITY-PRIMARY/
    );
    assert.equal(document.querySelector('.booking-banquet-section--warnings'), null);
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

test('booking finance inserts use one explicit PostgreSQL type for business context', () => {
    const route = read('routes', 'bookings.js');
    const financeInsertValues = route.match(
        /INSERT INTO finance_transactions \(business_context,[\s\S]*?VALUES \(\$1::varchar,[\s\S]*?COALESCE\(business_context, 'event_genix'\) = \$1::varchar/gi
    ) || [];

    assert.ok(financeInsertValues.length >= 5);
    assert.doesNotMatch(
        route,
        /INSERT INTO finance_transactions \(business_context,[\s\S]{0,400}?VALUES \(\$1,[\s\S]{0,300}?COALESCE\(business_context, 'event_genix'\) = \$1(?:\s|LIMIT)/
    );
});

test('booking modal banquet overview separates work summary from technical metadata', () => {
    const bookingJs = read('js', 'booking.js');
    const bookingPackageRendererJs = read('js', 'booking-package-renderer.js');
    const bookingBanquetDetailJs = read('js', 'booking-banquet-detail.js');
    assert.match(bookingJs, /function renderFullBanquetDetail\(/);
    assert.match(bookingJs, /function bookingBanquetDetailRendererCall\(/);
    assert.match(bookingBanquetDetailJs, /function renderFullBanquetDetail\(/);
    assert.match(bookingBanquetDetailJs, /root\.BookingBanquetDetail = Object\.assign\(root\.BookingBanquetDetail \|\| \{\}, api\)/);
    assert.match(bookingBanquetDetailJs, /renderBookingPackageDetailSafe/);
    assert.match(bookingJs, /function bookingDetailHasMenuOverview\(/);
    assert.match(bookingJs, /function bookingDetailHasServiceOverview\(/);
    assert.match(bookingJs, /function bookingDetailCanOwnBanquetPackage\(/);
    assert.match(bookingJs, /function bookingDetailIsBanquetArrivalMode\(/);
    assert.match(bookingJs, /const bookingDetailDateLabel = isBanquetArrivalMode \? 'Дата банкету' : 'Дата';/);
    assert.match(bookingJs, /const isActivityDetailMode = isActivityDetailBooking;/);
    assert.match(bookingJs, /const bookingDetailTimeLabel = isActivityDetailMode \? 'Час активності' : \(isBanquetArrivalMode \? 'Прихід гостей' : 'Час'\);/);
    assert.match(bookingJs, /const bookingDetailTimeValue = isBanquetArrivalMode \? \(banquetArrival\?\.time \|\| '-'\) : bookingDetailTimeRange;/);
    assert.doesNotMatch(bookingJs, /const bookingDetailTimeValue = isBanquetArrivalMode \? \(booking\.time \|\| '-'\)/);
    assert.match(bookingJs, /<span class="label">\$\{escapeHtml\(bookingDetailDateLabel\)\}:<\/span>/);
    assert.match(bookingJs, /<span class="label">\$\{escapeHtml\(bookingDetailTimeLabel\)\}:<\/span>/);
    assert.doesNotMatch(bookingJs, /const bookingDetailDateLabel = isBanquetArrivalMode \? 'Дата\/час'/);
    assert.doesNotMatch(bookingJs, /const bookingDetailTimeLabel = isBanquetArrivalMode \? 'Час'/);
    assert.match(bookingJs, /bookingDetailIsRoot\(booking\)[\s\S]*bookingDetailHasMenuOverview\(booking\)[\s\S]*bookingDetailHasServiceOverview\(booking\)/);
    assert.match(bookingJs, /candidates\.find\(booking => booking && bookingDetailCanOwnBanquetPackage\(booking\)\)/);
    assert.match(bookingJs, /function bookingDetailEntertainmentRowsFromMembers\(/);
    assert.match(bookingJs, /function bookingDetailEntertainmentMembers\(/);
    assert.match(bookingBanquetDetailJs, /function banquetDetailActivityMembers\(/);
    assert.match(bookingBanquetDetailJs, /const members = banquetDetailVisibleMembers\(snapshot\?\.members\)/);
    assert.match(bookingBanquetDetailJs, /if \(!packageBooking \|\| !bookingDetailHasMenuOverview\(packageBooking\)\) return '';/);
    assert.match(bookingBanquetDetailJs, /renderBanquetWorkSection\('Банкет'/);
    assert.match(bookingBanquetDetailJs, /renderBanquetMenuSection\(packageBooking\)/);
    assert.match(bookingBanquetDetailJs, /renderBanquetServiceSection\(packageBooking, serviceManualMembers\)/);
    assert.match(bookingBanquetDetailJs, /renderBanquetActivitiesSection\(visibleActivityMembers\)/);
    assert.match(bookingBanquetDetailJs, /renderBanquetWarningsSection\(warnings\)/);
    assert.match(bookingBanquetDetailJs, /renderBanquetTechnicalSection\(\{/);
    assert.match(bookingBanquetDetailJs, /includeServiceEvents: false/);
    assert.match(bookingPackageRendererJs, /booking-detail-package-table/);
    assert.match(bookingPackageRendererJs, /booking-detail-package-table-row/);
    assert.match(bookingPackageRendererJs, /booking-detail-package-service-row/);
    assert.match(bookingBanquetDetailJs, /booking-banquet-service-row--checklist/);
    assert.match(bookingBanquetDetailJs, /\$\{event\.time \? `\$\{escapeHtml\(event\.time\)\} · ` : ''\}/);
    assert.match(bookingJs, /booking-customer-block--priority/);
    assert.doesNotMatch(bookingBanquetDetailJs, /group-first/);
    assert.doesNotMatch(bookingBanquetDetailJs, /Service \/ manual/);
    assert.doesNotMatch(bookingBanquetDetailJs, /Кухня \/ меню не прив/);
    assert.doesNotMatch(bookingBanquetDetailJs, /Технічні linked_to children/);
    assert.doesNotMatch(bookingBanquetDetailJs, /<strong>\$\{escapeHtml\(BOOKING_SERVICE_EVENT_TYPES\[event\.type\] \|\| 'Подія'\)\}<\/strong>/);
});

test('booking UI resolves the material package owner ahead of stale metadata and fails closed on split owners', () => {
    const context = createBanquetModalDetailHarness();
    const primary = {
        id: 'BK-PRIMARY',
        status: 'confirmed',
        bookingPackage: {
            schemaVersion: 2,
            menuPositions: [],
            serviceEvents: []
        }
    };
    const kitchen = {
        id: 'BK-KITCHEN',
        status: 'confirmed',
        bookingPackage: {
            schemaVersion: 2,
            menuPositions: [{ productId: 'pizza', quantity: 1, unitPrice: 250, subtotal: 250 }],
            serviceEvents: []
        }
    };
    const baseSnapshot = {
        group: {
            id: 'BQ-OWNER',
            primaryBookingId: primary.id,
            meta: {
                packageOwnerBookingId: primary.id
            }
        },
        members: [
            { bookingId: primary.id, role: 'primary', isPrimary: true, booking: primary },
            { bookingId: kitchen.id, role: 'kitchen', booking: kitchen }
        ]
    };

    const resolution = context.banquetSnapshotPackageOwnerResolution(baseSnapshot, primary);
    assert.equal(resolution.valid, true);
    assert.equal(resolution.packageOwnerBookingId, kitchen.id);
    assert.equal(resolution.source, 'material_package');

    const legacyEntryOwner = {
        id: 'BK-LEGACY-ENTRY',
        status: 'confirmed',
        bookingPackage: {
            schemaVersion: 2,
            menuPositions: [],
            serviceEvents: [],
            entryCharge: {
                quantity: 2,
                unitPrice: 310,
                subtotal: 620
            }
        }
    };
    const legacyResolution = context.banquetSnapshotPackageOwnerResolution({
        ...baseSnapshot,
        members: [
            baseSnapshot.members[0],
            { bookingId: legacyEntryOwner.id, role: 'kitchen', booking: legacyEntryOwner }
        ]
    }, primary);
    assert.equal(legacyResolution.valid, true);
    assert.equal(legacyResolution.packageOwnerBookingId, legacyEntryOwner.id);

    const staleTicketMeta = context.banquetSnapshotPackageOwnerResolution({
        ...baseSnapshot,
        group: {
            ...baseSnapshot.group,
            meta: {
                packageOwnerBookingId: kitchen.id,
                ticketBookingId: primary.id
            }
        }
    }, primary);
    assert.equal(staleTicketMeta.valid, false);
    assert.equal(staleTicketMeta.code, 'TICKET_PACKAGE_OWNER_METADATA_INVALID');

    const ticketOwner = {
        id: 'BK-TICKETS',
        status: 'confirmed',
        bookingPackage: {
            schemaVersion: 3,
            menuPositions: [],
            serviceEvents: [],
            ticketLines: [],
            ticketSubtotal: 0
        }
    };
    const splitOwners = context.banquetSnapshotPackageOwnerResolution({
        ...baseSnapshot,
        members: [
            ...baseSnapshot.members,
            { bookingId: ticketOwner.id, role: 'manual', booking: ticketOwner }
        ]
    }, primary);
    assert.equal(splitOwners.valid, false);
    assert.equal(splitOwners.code, 'BANQUET_PACKAGE_OWNER_CONFLICT');
});

test('booking detail combines menu and canonical ticket-only owner once with a component-safe total', () => {
    const context = createBanquetModalDetailHarness();
    const primary = {
        id: 'BK-PRIMARY',
        date: '2026-07-18',
        time: '12:00',
        duration: 60,
        room: 'Room A',
        label: 'Birthday',
        programId: 'program-1',
        price: 1000,
        status: 'confirmed'
    };
    const menuOwner = {
        id: 'BK-MENU',
        date: primary.date,
        time: primary.time,
        duration: 60,
        room: primary.room,
        label: 'Kitchen',
        status: 'confirmed',
        banquetGuests: 2,
        bookingPackage: {
            schemaVersion: 2,
            programBasePrice: 0,
            positionsSubtotal: 250,
            menuPositions: [{
                productId: 'pizza',
                title: 'Pizza',
                quantity: 1,
                unitPrice: 250,
                subtotal: 250,
                kitchenType: 'menu'
            }],
            serviceEvents: [],
            entryCharge: {
                quantity: 2,
                unitPrice: 300,
                subtotal: 600
            },
            entrySubtotal: 600,
            finalTotal: 850
        }
    };
    const ticketOwner = {
        id: 'BK-TICKETS',
        date: primary.date,
        time: primary.time,
        duration: 60,
        room: primary.room,
        label: 'Tickets',
        status: 'confirmed',
        bookingPackage: {
            schemaVersion: 3,
            programBasePrice: 0,
            menuPositions: [],
            serviceEvents: [],
            ticketLines: [{
                ticketTypeCode: 'regular_child',
                ticketTypeName: 'Regular child',
                audience: 'child',
                quantity: 2,
                unitPriceUah: 400,
                subtotalUah: 800
            }],
            ticketSubtotal: 800,
            finalTotal: 800
        }
    };
    const snapshot = {
        source: 'banquet_group',
        groupId: 'BQ-OWNER',
        group: {
            id: 'BQ-OWNER',
            primaryBookingId: primary.id,
            meta: {
                ticketBookingId: ticketOwner.id,
                packageOwnerBookingId: ticketOwner.id
            }
        },
        members: [
            { bookingId: primary.id, role: 'primary', isPrimary: true, booking: primary },
            { bookingId: menuOwner.id, role: 'kitchen', isKitchenCandidate: true, booking: menuOwner },
            { bookingId: ticketOwner.id, role: 'manual', booking: ticketOwner }
        ]
    };

    const document = new JSDOM(`<main>${context.renderFullBanquetDetail(primary, [], snapshot)}</main>`).window.document;
    assert.equal(document.querySelectorAll('.booking-detail-package-table-row--ticket').length, 1);
    assert.match(document.querySelector('.booking-detail-package-table-row--ticket').textContent, /Regular child/);
    assert.match(document.querySelector('.booking-banquet-section--menu').textContent, /Pizza/);
    assert.equal(
        document.querySelector('.booking-detail-package-money--total').textContent.replace(/\D/g, ''),
        '1050'
    );
});

test('CRM create handoff exchanges created entity IDs only', async () => {
    const handoff = require('../js/crm-create-handoff');
    const channels = new Map();

    class FakeBroadcastChannel {
        constructor(name) {
            this.name = name;
            this.listeners = new Set();
            if (!channels.has(name)) channels.set(name, new Set());
            channels.get(name).add(this);
        }

        addEventListener(type, listener) {
            if (type === 'message') this.listeners.add(listener);
        }

        removeEventListener(type, listener) {
            if (type === 'message') this.listeners.delete(listener);
        }

        postMessage(message) {
            const peers = channels.get(this.name) || new Set();
            for (const peer of peers) {
                if (peer === this) continue;
                queueMicrotask(() => {
                    for (const listener of peer.listeners) listener({ data: message });
                });
            }
        }

        close() {
            channels.get(this.name)?.delete(this);
        }
    }

    const windowListeners = new Map();
    const openerWindow = {
        location: { origin: 'https://crm.test' },
        BroadcastChannel: FakeBroadcastChannel,
        addEventListener(type, listener) { windowListeners.set(listener, type); },
        removeEventListener(type, listener) { windowListeners.delete(listener); }
    };
    const childWindow = {
        location: { origin: 'https://crm.test' },
        BroadcastChannel: FakeBroadcastChannel,
        opener: { postMessage() {} },
        close() { this.closed = true; }
    };

    const created = new Promise((resolve, reject) => {
        const receiver = handoff.createReceiver({
            entity: 'lead',
            businessContext: 'eventgenix',
            token: 'a'.repeat(32),
            returnPath: '/index.html?view=timeline',
            timeoutMs: 5000,
            windowRef: openerWindow,
            onCreated: resolve,
            onTimeout: () => reject(new Error('handoff timed out'))
        });

        const createUrl = receiver.urlFor('/sales-funnel');
        assert.equal(createUrl.searchParams.get('crm_handoff'), '1');
        assert.equal(createUrl.searchParams.get('crm_handoff_token'), 'a'.repeat(32));
        assert.equal(createUrl.searchParams.get('crm_handoff_context'), 'eventgenix');
        assert.equal(createUrl.searchParams.get('crm_handoff_entity'), 'lead');
        assert.equal(createUrl.searchParams.get('name'), null);
        assert.equal(createUrl.searchParams.get('phone'), null);

        const request = handoff.readRequestFromUrl(createUrl.href, { windowRef: childWindow });
        const result = handoff.sendCreated(request, 'lead.created', {
            id: 44,
            customerId: 22,
            client_name: 'Sensitive Name',
            phone: '+380000000000'
        }, { windowRef: childWindow });

        assert.equal(result.ok, true);
        assert.deepEqual(result.envelope.payload, { leadId: 44, customerId: 22 });
        assert.equal(result.envelope.payload.client_name, undefined);
        assert.equal(result.envelope.payload.phone, undefined);
    });

    assert.deepEqual(await created, { leadId: 44, customerId: 22 });
});

test('CRM create handoff rejects mismatched token context and entity type', () => {
    const handoff = require('../js/crm-create-handoff');
    const request = handoff.createRequest({
        entity: 'customer',
        businessContext: 'eventgenix',
        token: 'b'.repeat(32),
        windowRef: { location: { origin: 'https://crm.test' } }
    });

    assert.equal(handoff.validateEnvelope({
        app: handoff.CONTRACT_APP,
        version: handoff.CONTRACT_VERSION,
        type: 'customer.created',
        token: 'c'.repeat(32),
        businessContext: 'eventgenix',
        payload: { id: 1 }
    }, request).reason, 'token_mismatch');

    assert.equal(handoff.validateEnvelope({
        app: handoff.CONTRACT_APP,
        version: handoff.CONTRACT_VERSION,
        type: 'customer.created',
        token: request.token,
        businessContext: 'other',
        payload: { id: 1 }
    }, request).reason, 'business_context_mismatch');

    assert.equal(handoff.validateEnvelope({
        app: handoff.CONTRACT_APP,
        version: handoff.CONTRACT_VERSION,
        type: 'lead.created',
        token: request.token,
        businessContext: 'eventgenix',
        payload: { id: 1 }
    }, request).reason, 'entity_mismatch');
});

test('CRM create handoff helper loads before booking customer and lead page controllers', () => {
    const indexHtml = read('index.html');
    const customersHtml = read('customers.html');
    const leadsHtml = read('leads.html');

    assert.ok(indexHtml.includes('js/crm-create-handoff.js?v='));
    assert.ok(customersHtml.includes('js/crm-create-handoff.js?v='));
    assert.ok(leadsHtml.includes('js/crm-create-handoff.js?v='));
    assert.ok(indexHtml.indexOf('js/crm-create-handoff.js') < indexHtml.indexOf('js/booking.js'));
    assert.ok(customersHtml.indexOf('js/crm-create-handoff.js') < customersHtml.indexOf('js/customers-page.js'));
    assert.ok(leadsHtml.indexOf('js/crm-create-handoff.js') < leadsHtml.indexOf('js/leads-page.js'));
});

test('Sales funnel lead create deep link uses createStage booking handoff contract', () => {
    const leadsHtml = read('leads.html');
    const leadsJs = read('js/leads-page.js');
    const leadsRoute = read('routes/leads.js');

    assert.ok(leadsHtml.includes('id="leadStageGroup"'));
    assert.ok(leadsHtml.includes('id="leadTypeGroup"'));
    const initStart = leadsJs.indexOf("document.addEventListener('DOMContentLoaded'");
    const initBlock = leadsJs.slice(initStart, leadsJs.indexOf('async function checkTestMode', initStart));

    assert.ok(leadsJs.includes("const LEAD_CREATE_STAGE_PARAM = 'createStage'"));
    assert.ok(leadsJs.includes("if (params.get(LEAD_CREATE_ACTION_PARAM) !== 'create') return null;"));
    assert.ok(leadsJs.includes("const createStage = fromBooking ? 'deal'"));
    assert.ok(leadsJs.includes('lockStage: fromBooking'));
    assert.ok(leadsJs.includes('sourceCustomerId: readLeadCreateCustomerId(params)'));
    assert.ok(leadsJs.includes('handoffRequest: leadCreateHandoffRequestFromUrl(params)'));
    assert.ok(initBlock.indexOf('await loadUsers();') < initBlock.indexOf('await maybeOpenLeadCreateFromUrl();'));
    assert.ok(initBlock.indexOf('await maybeOpenLeadCreateFromUrl();') < initBlock.indexOf('await loadLeads();'));
    assert.ok(leadsJs.includes('async function loadLeadCreateCustomer(customerId)'));
    assert.ok(leadsJs.includes('apiFetch(`/api/customers/${normalizedCustomerId}`)'));
    assert.ok(leadsJs.includes('sourceCustomer = await loadLeadCreateCustomer(options.sourceCustomerId)'));
    assert.ok(leadsJs.includes('prefillLeadModalFromCustomer(sourceCustomer, { includeFallbackNote: false });'));
    assert.ok(leadsJs.includes('sourceCustomerLoadFailed'));
    assert.ok(leadsJs.includes('Object.assign(body, stagePayload);'));
    assert.ok(leadsJs.includes('body.customerId = sourceCustomerId'));
    assert.ok(leadsJs.includes('responseCustomerId !== sourceCustomerId'));
    assert.ok(leadsRoute.includes('requestedCreateCustomerId'));
    assert.ok(leadsRoute.includes('responseLead.customer_id = dealCustomerLink.customer.id'));
    assert.ok(leadsRoute.includes('responseLead.customerId = dealCustomerLink.customer.id'));
    assert.ok(leadsRoute.includes("source: 'leads.post_requested_customer'"));
    assert.ok(leadsJs.includes("handoffApi.sendCreated(request, 'lead.created', payload)"));
    assert.ok(leadsJs.includes('payload.customerId = normalizedCustomerId'));
    assert.ok(leadsJs.includes('completeLeadCreateHandoff(savedLeadId'));
    assert.ok(leadsJs.includes('url.searchParams.delete(key)'));
    assert.ok(!leadsJs.includes("params.get('pipeline_stage') || params.get('createStage')"));
});

test('Lead and customer delete routes clean up canonical handoff dependencies', () => {
    const leadsRoute = read('routes/leads.js');
    const customersRoute = read('routes/customers.js');

    assert.match(leadsRoute, /DELETE FROM lead_customer_links[\s\S]*WHERE lead_id = \$1 AND business_context = \$2/);
    assert.match(leadsRoute, /DELETE FROM lead_event_preferences[\s\S]*WHERE lead_id = \$1 AND business_context = \$2/);
    assert.match(leadsRoute, /DELETE FROM lead_interactions WHERE lead_id = \$1/);
    assert.match(leadsRoute, /UPDATE customer_children[\s\S]*SET lead_id = NULL[\s\S]*WHERE lead_id = \$1 AND business_context = \$2/);
    assert.match(customersRoute, /DELETE FROM customer_children[\s\S]*WHERE customer_id = \$1 AND business_context = \$2/);
    assert.match(customersRoute, /DELETE FROM lead_customer_links[\s\S]*WHERE customer_id = \$1 AND business_context = \$2/);
});

test('Customers create deep link uses canonical modal and customer handoff contract', () => {
    const customersHtml = read('customers.html');
    const customersJs = read('js/customers-page.js');

    assert.ok(customersHtml.includes('id="customerEditModal"'));
    assert.ok(customersHtml.includes('js/crm-create-handoff.js?v='));
    assert.ok(customersHtml.indexOf('js/crm-create-handoff.js') < customersHtml.indexOf('js/customers-page.js'));
    assert.ok(customersJs.includes("const CUSTOMER_CREATE_ACTION_PARAM = 'action'"));
    assert.ok(customersJs.includes("const CUSTOMER_CREATE_HANDOFF_PARAM = 'handoff'"));
    assert.ok(customersJs.includes('function maybeOpenCustomerCreateFromUrl'));
    assert.ok(customersJs.includes('openEditModal(null, options);'));
    assert.ok(customersJs.includes('if (!maybeOpenCustomerCreateFromUrl()) openCustomerDeepLink();'));
    assert.ok(customersJs.indexOf('await refreshData();') < customersJs.indexOf('if (!maybeOpenCustomerCreateFromUrl()) openCustomerDeepLink();'));
    assert.ok(customersJs.includes("handoffApi.sendCreated(request, 'customer.created', { customerId: normalizedCustomerId })"));
    assert.ok(customersJs.includes('completeCustomerCreateHandoff(result.id)'));
    assert.ok(customersJs.includes("'reception'"));
    assert.ok(customersJs.includes("document.getElementById('exportCsvBtn').style.display = canManage ? '' : 'none';"));
});
