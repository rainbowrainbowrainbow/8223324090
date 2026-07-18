'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function createBookingTicketsHarness({
    editingBookingId = 'booking-1',
    quoteHandler = async () => ({ success: true, quote: { ticketLines: [], ticketSubtotal: 0 } })
} = {}) {
    const dom = new JSDOM(`<!doctype html><body>
        <section id="bookingTicketsSection">
            <div id="bookingTicketsLegacyBanner" class="hidden">
                <strong></strong>
                <span id="bookingTicketsLegacyAmount"></span>
                <button type="button" id="bookingTicketsConvert"></button>
            </div>
            <input id="banquetGuests" value="2">
            <input id="banquetAdults" value="0">
            <input id="bookingGuestArrivalTime" value="12:30">
            <select id="roomSelect">
                <option value="room-a" data-resource-id="room-a" selected>Room A</option>
            </select>
            <input id="ticketBirthdayChildQuantity" value="0">
            <input id="ticketUnder3ChildQuantity" value="0">
            <input id="ticketDiscountedChildQuantity" value="0">
            <input id="ticketAdultGameQuantity" value="0">
            <output id="ticketRegularChildQuantity"></output>
            <output id="ticketAdultCompanionQuantity"></output>
            <div id="bookingTicketQuoteState"></div>
            <div id="bookingTicketQuoteMeta"></div>
            <div id="bookingTicketQuoteLines"></div>
            <div id="bookingTicketQuoteTotal"></div>
            <div id="bookingTicketStickyError" class="hidden"></div>
        </section>
    </body>`, {
        runScripts: 'outside-only',
        url: 'https://eventgenix.test/'
    });
    const { window } = dom;
    window.AppState = {
        editingBookingId,
        selectedDate: new Date(2026, 6, 18)
    };
    window.BookingDrawerState = {
        banquetCreationMode: null,
        arrivalDraft: null
    };
    window.escapeHtml = value => {
        const node = window.document.createElement('div');
        node.textContent = String(value ?? '');
        return node.innerHTML;
    };
    window.formatDate = () => '2026-07-18';
    window.renderBookingPackageSummary = () => {};
    window.apiQuoteAdmissionTickets = quoteHandler;
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.eval(read('js/booking-tickets.js'));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    return {
        close: () => dom.window.close(),
        document: window.document,
        tickets: window.BookingTickets,
        window
    };
}

test('Center ticket tab uses exact senior-manager mutation gate and append-only API', () => {
    const html = read('center.html');
    const page = read('js/center-page.js');
    const api = read('js/api.js');
    const sidebar = read('js/components/sidebar.js');
    const css = read('css/pages-center-operations.css');
    assert.match(html, /data-tab="tickets"/);
    assert.match(html, /id="ticketCatalogMatrix"/);
    assert.match(page, /hasMinRole\('senior_manager'\)/);
    assert.match(page, /apiCreateAdmissionTicketTariffRevision/);
    assert.match(page, /expectedRevision/);
    assert.match(page, /result\?\.status === 409/);
    assert.match(page, /function admissionTicketLatestTariffFor/);
    assert.match(page, /Array\.isArray\(type\?\.tariffHistory\)/);
    assert.match(page, /function admissionTicketTodayDateOnly\(\)[\s\S]*timeZone: 'Europe\/Kyiv'/);
    assert.match(page, /ticketTariffExpectedRevision'\)\.value = String\(latestTariff\?\.revision \?\? 0\)/);
    assert.match(page, /availability === 'available'[\s\S]*!amountRaw[\s\S]*amountInput\?\.focus\(\)/);
    assert.match(page, /amount\.required = !unavailable/);
    const centerDom = new JSDOM(html);
    const tariffDialog = centerDom.window.document.getElementById('ticketTariffDialog');
    const amountInput = centerDom.window.document.getElementById('ticketTariffAmount');
    assert.equal(tariffDialog.getAttribute('aria-labelledby'), 'ticketTariffDialogTitle');
    assert.equal(tariffDialog.getAttribute('aria-describedby'), 'ticketTariffDialogMeta');
    assert.equal(amountInput.min, '0');
    assert.equal(amountInput.max, '2147483647');
    assert.equal(amountInput.step, '1');
    assert.equal(amountInput.getAttribute('inputmode'), 'numeric');
    assert.equal(amountInput.getAttribute('aria-describedby'), 'ticketTariffError');
    assert.equal(amountInput.required, true);
    assert.match(page, /Number\.isSafeInteger\(amountUah\)/);
    assert.match(page, /amountUah > 2147483647/);
    assert.match(page, /amountInput\?\.setAttribute\('aria-invalid', 'true'\)/);
    assert.match(page, /function admissionTicketLocalizedMessage/);
    assert.match(api, /\/center\/tickets\/\$\{encodeURIComponent/);
    assert.doesNotMatch(api, /apiCall\('(?:GET|POST)', `\/api\/center\/tickets/);
    assert.match(sidebar, /\/center\?tab=tickets/);
    assert.match(
        css,
        /\.ticket-tariff-form input,[\s\S]*?\.ticket-tariff-form textarea \{[\s\S]*?font-size: 16px;/
    );
});

test('booking ticket controls expose only four manual quantities and server quote state', () => {
    const html = read('index.html');
    const tickets = read('js/booking-tickets.js');
    const booking = read('js/booking.js');
    for (const id of [
        'ticketBirthdayChildQuantity',
        'ticketUnder3ChildQuantity',
        'ticketDiscountedChildQuantity',
        'ticketAdultGameQuantity'
    ]) {
        assert.match(html, new RegExp(`id="${id}"[^>]*inputmode="numeric"`));
    }
    assert.match(html, /id="ticketRegularChildQuantity"/);
    assert.match(html, /id="ticketAdultCompanionQuantity"/);
    assert.doesNotMatch(html, /id="ticketRegularChildQuantity"[^>]*<input/);
    assert.match(tickets, /apiQuoteAdmissionTickets/);
    assert.match(tickets, /sequenceKey:/);
    assert.match(tickets, /TICKET_PRICE_CHANGED/);
    assert.match(tickets, /TICKET_QUOTE_CHANGED/);
    assert.match(tickets, /kidsCount: guests/);
    assert.match(tickets, /conversionConfirmed/);
    assert.match(tickets, /comparisonSubtotal/);
    assert.match(tickets, /const previousSubtotal = state\.baselineSubtotal \?\? state\.comparisonSubtotal/);
    assert.match(tickets, /packageSchemaVersion\(booking\) >= 3 && Array\.isArray\(lines\)/);
    assert.doesNotMatch(tickets, /if \(!ticketLines\.length\) return null/);
    assert.match(tickets, /Boolean\(entry && typeof entry === 'object' && !Array\.isArray\(entry\)\)/);
    assert.doesNotMatch(tickets, /hasOwnProperty\.call\(pkg, 'entrySubtotal'\)/);
    for (const mode of ['legacy_entry', 'no_tickets', 'new', 'v3']) {
        assert.match(tickets, new RegExp(`['"]${mode}['"]`));
    }
    assert.match(tickets, /quoteEpoch/);
    assert.match(tickets, /requestEpoch !== state\.quoteEpoch/);
    assert.match(tickets, /Діти \$\{allocated\.children\}\/\$\{childrenTotal \?\? '—'\}/);
    assert.match(tickets, /Дорослі \$\{allocated\.adults\}\/\$\{adultsTotal \?\? '—'\}/);
    assert.match(tickets, /state\.priceDiff = Array\.isArray\(result\.details\?\.diff\)/);
    assert.match(tickets, /bookingTicketAcceptPrice'\)\?\.focus\(\)/);
    assert.match(tickets, /fields: \['bookingTicketAcceptPrice'\]/);
    assert.match(tickets, /function getComparison\(\)/);
    assert.match(tickets, /getComparison,/);
    assert.match(tickets, /conversionOrigin === 'legacy_entry' && state\.conversionConfirmed/);
    assert.match(tickets, /conversionOrigin === 'legacy_entry'[\s\S]*conversionPreview[\s\S]*\{ convertLegacy: true \}/);
    assert.match(booking, /window\.BookingTickets\?\.validationIssue/);
    assert.match(booking, /obj\.ticketQuantities = formData\.ticketQuantities/);
    assert.match(booking, /if \(formData\.convertLegacyTickets === true\) obj\.convertLegacy = true/);
    assert.doesNotMatch(booking, /obj\.convertLegacy = formData\.convertLegacyTickets === true/);
    assert.match(booking, /booking\?\.banquetAdults \?\? booking\?\.banquet_adults/);
    assert.match(booking, /hasV3TicketSnapshot = Number\(ticketPackage\.schemaVersion \?\? ticketPackage\.schema_version\) >= 3/);
    assert.match(booking, /adults\.value = banquetAdults \?\? \(hasV3TicketSnapshot \? 0 : ''\)/);
    assert.match(booking, /remainingAfterDeposit = deposit\?\.provided[\s\S]*Math\.max\(0, finalTotal - Number\(depositAmount \|\| 0\)\)/);
    assert.match(booking, /Залишок після завдатку/);
    assert.match(booking, /Попередня загальна сума/);
    assert.match(booking, /Зміна загальної суми/);
    assert.match(booking, /target\.matches\?\.\('input, select, textarea, button, \[tabindex\]'\)/);
});

test('booking ticket hydration preserves v3 snapshots and requotes duplicates as new work', () => {
    const tickets = read('js/booking-tickets.js');
    const hydrateStart = tickets.indexOf('function hydrate(booking = {}, options = {})');
    const collectStart = tickets.indexOf('function collect()', hydrateStart);
    assert.ok(hydrateStart >= 0 && collectStart > hydrateStart);
    const hydrate = tickets.slice(hydrateStart, collectStart);
    assert.match(hydrate, /const duplicateFlow = !window\.AppState\?\.editingBookingId/);
    assert.match(hydrate, /if \(duplicateFlow\) \{[\s\S]*state\.mode = 'new'[\s\S]*scheduleQuote\(\)/);
    assert.match(hydrate, /if \(storedQuote\) \{[\s\S]*state\.mode = 'v3'[\s\S]*render\(\);\s*return;/);
    const storedV3Branch = hydrate.slice(hydrate.indexOf('if (storedQuote) {'));
    assert.doesNotMatch(storedV3Branch, /scheduleQuote\(\)/);
    assert.match(hydrate, /state\.mode = legacyEntry \? 'legacy_entry' : 'no_tickets'/);
});

test('booking ticket quote uses the canonical non-primary package owner id', async () => {
    const payloads = [];
    const harness = createBookingTicketsHarness({
        editingBookingId: 'primary-booking',
        quoteHandler: async payload => {
            payloads.push(payload);
            return {
                success: true,
                quote: {
                    ticketLines: [],
                    ticketSubtotal: 0
                }
            };
        }
    });
    try {
        harness.tickets.setActive(true);
        harness.tickets.hydrate({
            id: 'kitchen-ticket-owner',
            bookingPackage: {
                schemaVersion: 3,
                ticketLines: [{
                    ticketTypeCode: 'regular_child',
                    quantity: 2,
                    unitPriceUah: 400,
                    subtotalUah: 800
                }],
                ticketSubtotal: 800
            }
        }, {
            bookingId: 'kitchen-ticket-owner'
        });

        await harness.tickets.quoteNow();

        assert.equal(payloads.at(-1).bookingId, 'kitchen-ticket-owner');
        assert.notEqual(payloads.at(-1).bookingId, 'primary-booking');
    } finally {
        harness.close();
    }
});

test('booking ticket renderer escapes server-owned ticket names and conflict labels', async () => {
    const maliciousName = '<img src=x onerror="window.__ticketXss = true">';
    const harness = createBookingTicketsHarness({
        quoteHandler: async () => ({
            success: true,
            quote: {
                ticketLines: [{
                    ticketTypeCode: 'regular_child',
                    ticketTypeName: maliciousName,
                    audience: 'child',
                    quantity: 2,
                    unitPriceUah: 400,
                    subtotalUah: 800
                }],
                ticketSubtotal: 800
            }
        })
    });
    try {
        harness.tickets.setActive(true);
        await harness.tickets.quoteNow();

        const lines = harness.document.getElementById('bookingTicketQuoteLines');
        assert.equal(lines.querySelector('img'), null);
        assert.match(lines.textContent, /<img src=x onerror=/);
        assert.equal(harness.window.__ticketXss, undefined);

        assert.equal(harness.tickets.handleSaveConflict({
            code: 'TICKET_PRICE_CHANGED',
            details: {
                quote: {
                    ticketLines: [{
                        ticketTypeCode: 'regular_child',
                        ticketTypeName: maliciousName,
                        audience: 'child',
                        quantity: 2,
                        unitPriceUah: 400,
                        subtotalUah: 800
                    }],
                    ticketSubtotal: 800
                },
                diff: [{
                    ticketTypeCode: 'regular_child',
                    previousUnitPriceUah: 350,
                    currentUnitPriceUah: 400
                }]
            }
        }), true);
        const stickyError = harness.document.getElementById('bookingTicketStickyError');
        assert.equal(stickyError.querySelector('img'), null);
        assert.match(stickyError.textContent, /<img src=x onerror=/);
        assert.equal(harness.window.__ticketXss, undefined);
    } finally {
        harness.close();
    }
});

test('untouched v3 edit preserves its snapshot while every pricing-input change requires a fresh payload', async () => {
    const storedBooking = {
        id: 'ticket-owner',
        bookingPackage: {
            schemaVersion: 3,
            ticketLines: [{
                ticketTypeCode: 'regular_child',
                quantity: 2,
                unitPriceUah: 400,
                subtotalUah: 800
            }],
            ticketSubtotal: 800
        }
    };
    const scenarios = [
        {
            name: 'guest count',
            mutate: harness => {
                harness.document.getElementById('banquetGuests').value = '3';
            }
        },
        {
            name: 'pricing date',
            mutate: harness => {
                harness.window.AppState.selectedDate = new Date(2026, 6, 19);
                harness.window.formatDate = value => {
                    const date = value instanceof harness.window.Date ? value : new harness.window.Date(value);
                    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                };
            }
        },
        {
            name: 'room resource',
            mutate: harness => {
                const option = harness.document.createElement('option');
                option.value = 'room-b';
                option.dataset.resourceId = 'room-b';
                option.textContent = 'Room B';
                harness.document.getElementById('roomSelect').append(option);
                harness.document.getElementById('roomSelect').value = 'room-b';
            }
        },
        {
            name: 'manual ticket quantity',
            mutate: harness => {
                harness.document.getElementById('ticketBirthdayChildQuantity').value = '1';
            }
        }
    ];

    for (const scenario of scenarios) {
        const harness = createBookingTicketsHarness({
            editingBookingId: 'primary-booking',
            quoteHandler: async payload => ({
                success: true,
                quote: {
                    ticketLines: payload.ticketQuantities,
                    ticketSubtotal: 800
                }
            })
        });
        try {
            harness.tickets.setActive(true);
            harness.tickets.hydrate(storedBooking, { bookingId: 'ticket-owner' });
            assert.equal(
                Object.keys(harness.tickets.collect()).length,
                0,
                `${scenario.name}: note-only/unrelated edit must preserve the stored snapshot`
            );

            scenario.mutate(harness);
            await harness.tickets.quoteNow();
            const payload = harness.tickets.collect();
            assert.ok(Array.isArray(payload.ticketQuantities), `${scenario.name}: quantities are sent after repricing`);
            assert.ok(payload.ticketQuote, `${scenario.name}: fresh quote is sent after repricing`);
        } finally {
            harness.close();
        }
    }
});

test('new existing-group member quote sends verified group evidence without impersonating the source booking', async () => {
    const payloads = [];
    const harness = createBookingTicketsHarness({
        editingBookingId: null,
        quoteHandler: async payload => {
            payloads.push(payload);
            return { success: true, quote: { ticketLines: [], ticketSubtotal: 0 } };
        }
    });
    try {
        harness.window.BookingDrawerState.selectedBanquetGroupId = 'BQ-EXISTING';
        harness.window.BookingDrawerState.explicitBanquetContext = {
            groupId: 'BQ-EXISTING',
            sourceBookingId: 'BK-GROUP-PRIMARY'
        };
        harness.window.selectedBookingBanquetGroupContext = () => ({
            groupId: 'BQ-EXISTING',
            sourceBookingId: 'BK-GROUP-PRIMARY',
            isExplicitBanquetContext: true
        });
        harness.tickets.setActive(true);

        await harness.tickets.quoteNow();

        assert.equal(payloads.at(-1).banquetGroupId, 'BQ-EXISTING');
        assert.equal(payloads.at(-1).sourceBookingId, 'BK-GROUP-PRIMARY');
        assert.equal(Object.hasOwn(payloads.at(-1), 'bookingId'), false);
        assert.equal(Object.hasOwn(payloads.at(-1), 'banquetContext'), false);
    } finally {
        harness.close();
    }
});

test('new banquet ticket preview uses reserved context only with a valid arrival time', () => {
    const tickets = read('js/booking-tickets.js');
    assert.match(tickets, /drawerState\?\.banquetCreationMode !== 'new'/);
    assert.match(tickets, /\/\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$\//);
    assert.match(tickets, /\{ mode: 'new', groupId: null, guestArrivalTime \}/);
    assert.match(tickets, /\.\.\.\(banquetContext \? \{ banquetContext \} : \{\}\)/);
    assert.match(tickets, /'bookingGuestArrivalTime'/);
});

test('new banquet preview does not reuse a stale arrival draft after the visible field is cleared', async () => {
    const payloads = [];
    const harness = createBookingTicketsHarness({
        editingBookingId: null,
        quoteHandler: async payload => {
            payloads.push(payload);
            return {
                success: true,
                quote: {
                    admissionContext: payload.banquetContext ? 'reserved_table_room' : 'standard',
                    dayType: 'weekend',
                    pricingDate: '2026-07-18',
                    ticketLines: [],
                    ticketSubtotal: 0
                }
            };
        }
    });
    try {
        harness.window.BookingDrawerState.banquetCreationMode = 'new';
        harness.window.BookingDrawerState.arrivalDraft = { guestArrivalTime: '12:30' };
        harness.document.getElementById('bookingGuestArrivalTime').value = '';
        harness.tickets.setActive(true);
        await harness.tickets.quoteNow();
        assert.equal(payloads[0].banquetContext, undefined);
        assert.equal(payloads[0].kidsCount, payloads[0].banquetGuests);

        harness.document.getElementById('bookingGuestArrivalTime').value = '13:15';
        await harness.tickets.quoteNow();
        assert.equal(payloads[1].kidsCount, payloads[1].banquetGuests);
        assert.deepEqual({ ...payloads[1].banquetContext }, {
            mode: 'new',
            groupId: null,
            guestArrivalTime: '13:15'
        });
    } finally {
        harness.close();
    }
});

test('ticket quote conflict shows quantity, subtotal, and scalar changes for confirmation', () => {
    const harness = createBookingTicketsHarness();
    try {
        harness.tickets.setActive(true);
        harness.tickets.hydrate({
            date: '2026-07-18',
            bookingPackage: {
                schemaVersion: 3,
                ticketPricingContext: 'standard',
                ticketDayType: 'weekend',
                ticketPricingDate: '2026-07-18',
                ticketLines: [{
                    ticketTypeCode: 'regular_child',
                    ticketTypeName: 'Звичайний дитячий',
                    audience: 'child',
                    quantity: 1,
                    unitPriceUah: 350,
                    subtotalUah: 350,
                    tariffVersionId: 7
                }],
                ticketSubtotal: 350
            }
        });

        const handled = harness.tickets.handleSaveConflict({
            code: 'TICKET_QUOTE_CHANGED',
            details: {
                quote: {
                    admissionContext: 'reserved_table_room',
                    dayType: 'weekend',
                    pricingDate: '2026-07-18',
                    ticketLines: [{
                        ticketTypeCode: 'regular_child',
                        ticketTypeName: 'Звичайний дитячий',
                        audience: 'child',
                        quantity: 2,
                        unitPriceUah: 350,
                        subtotalUah: 700,
                        tariffVersionId: 7
                    }],
                    ticketSubtotal: 700
                },
                diff: [{
                    field: 'admissionContext',
                    previousValue: 'standard',
                    currentValue: 'reserved_table_room'
                }, {
                    field: 'ticketSubtotal',
                    previousValue: 350,
                    currentValue: 700
                }, {
                    ticketTypeCode: 'regular_child',
                    previousQuantity: 1,
                    currentQuantity: 2,
                    previousTariffVersionId: 7,
                    currentTariffVersionId: 7,
                    previousUnitPriceUah: 350,
                    currentUnitPriceUah: 350,
                    previousSubtotalUah: 350,
                    currentSubtotalUah: 700
                }]
            }
        });

        assert.equal(handled, true);
        const sticky = harness.document.getElementById('bookingTicketStickyError');
        assert.match(sticky.textContent, /Розрахунок квитків змінився/);
        assert.match(sticky.textContent, /Контекст входу: стандартний вхід → бронювання столика \/ кімнатки/);
        assert.match(sticky.textContent, /Загальна сума квитків: 350 грн → 700 грн/);
        assert.match(sticky.textContent, /кількість 1 → 2/);
        assert.match(sticky.textContent, /сума 350 грн → 700 грн/);
        assert.doesNotMatch(sticky.textContent, /ціна 350 грн → 350 грн/);
        assert.equal(
            harness.document.getElementById('bookingTicketAcceptPrice').textContent,
            'Підтвердити новий розрахунок'
        );
        assert.equal(
            harness.tickets.validationIssue().message,
            'Підтвердьте актуальний розрахунок квитків після його зміни.'
        );
    } finally {
        harness.close();
    }
});

test('legacy preview and retry send explicit conversion while v2 without entry stays no-ticket', async () => {
    const payloads = [];
    const harness = createBookingTicketsHarness({
        quoteHandler: async payload => {
            payloads.push(payload);
            if (payloads.length === 1) {
                return { success: false, code: 'QUOTE_TEMPORARY_FAILURE', error: 'Temporary quote failure' };
            }
            return {
                success: true,
                quote: {
                    admissionContext: 'reserved_table_room',
                    dayType: 'weekend',
                    pricingDate: '2026-07-18',
                    ticketLines: [],
                    ticketSubtotal: 0
                }
            };
        }
    });
    try {
        harness.tickets.setActive(true);
        harness.tickets.hydrate({
            bookingPackage: {
                schemaVersion: 2,
                entryCharge: { quantity: 2, unitPrice: 350, subtotal: 700 },
                entrySubtotal: 700
            }
        });
        harness.document.getElementById('bookingTicketsConvert').click();
        await harness.tickets.quoteNow();
        assert.equal(payloads[0].convertLegacy, true);
        assert.equal(harness.document.getElementById('bookingTicketsConvert').textContent, 'Повторити розрахунок');

        harness.document.getElementById('bookingTicketsConvert').click();
        await harness.tickets.quoteNow();
        assert.equal(payloads[1].convertLegacy, true);
        harness.document.getElementById('bookingTicketsConvert').click();
        assert.equal(harness.tickets.collect().convertLegacy, true);

        harness.tickets.hydrate({
            bookingPackage: {
                schemaVersion: 2,
                entryCharge: null,
                entrySubtotal: 0
            }
        });
        const title = harness.document.querySelector('#bookingTicketsLegacyBanner strong').textContent;
        assert.equal(title, 'У цьому бронюванні ще немає квитків.');
    } finally {
        harness.close();
    }
});

test('stale quote cannot overwrite a newly hydrated empty v3 snapshot', async () => {
    let resolveQuote;
    let quoteCalls = 0;
    const harness = createBookingTicketsHarness({
        quoteHandler: () => {
            quoteCalls += 1;
            return new Promise(resolve => {
                resolveQuote = resolve;
            });
        }
    });
    try {
        harness.tickets.setActive(true);
        const pendingQuote = harness.tickets.quoteNow();
        assert.equal(quoteCalls, 1);
        harness.tickets.hydrate({
            bookingPackage: {
                schemaVersion: 3,
                ticketLines: [],
                ticketSubtotal: 0
            }
        });
        resolveQuote({
            success: true,
            quote: {
                ticketLines: [{ ticketTypeCode: 'regular_child', audience: 'child', quantity: 99 }],
                ticketSubtotal: 999
            }
        });
        await pendingQuote;
        assert.deepEqual(harness.tickets.getQuote().ticketLines, []);
        await new Promise(resolve => setTimeout(resolve, 240));
        assert.equal(quoteCalls, 1);
    } finally {
        harness.close();
    }
});

test('failed v3 requote keeps the stored subtotal visible but blocks stale ticket persistence', async () => {
    let resolveQuote;
    const harness = createBookingTicketsHarness({
        quoteHandler: () => new Promise(resolve => {
            resolveQuote = resolve;
        })
    });
    try {
        harness.tickets.setActive(true);
        harness.tickets.hydrate({
            id: 'ticket-owner',
            bookingPackage: {
                schemaVersion: 3,
                ticketLines: [{
                    ticketTypeCode: 'regular_child',
                    audience: 'child',
                    quantity: 2,
                    unitPriceUah: 400,
                    subtotalUah: 800
                }],
                ticketSubtotal: 800
            }
        }, { bookingId: 'ticket-owner' });
        harness.document.getElementById('banquetGuests').value = '3';

        const pendingQuote = harness.tickets.quoteNow();
        assert.equal(harness.tickets.getSubtotal(), 800);
        assert.deepEqual({ ...harness.tickets.collect() }, {});
        assert.equal(harness.tickets.validationIssue().key, 'ticket_quote_loading');

        resolveQuote({
            success: false,
            code: 'TICKET_TARIFF_MISSING',
            error: 'Ticket tariff configuration is incomplete',
            details: {
                missingTariffs: ['regular_child'],
                pricingDate: '2026-07-18'
            }
        });
        await pendingQuote;

        assert.equal(harness.tickets.getSubtotal(), 800);
        assert.equal(harness.tickets.getComparison(), null);
        assert.deepEqual({ ...harness.tickets.collect() }, {});
        assert.match(
            harness.tickets.validationIssue().message,
            /не налаштовано повний набір тарифів/
        );
        assert.deepEqual(
            [...harness.tickets.validationIssue().fields],
            ['bookingTicketRetryQuote', 'bookingTicketQuoteState']
        );
        assert.equal(
            harness.document.getElementById('bookingTicketQuoteState').getAttribute('tabindex'),
            '-1'
        );
        assert.equal(
            harness.document.getElementById('bookingTicketRetryQuote').textContent,
            'Повторити розрахунок'
        );
    } finally {
        harness.close();
    }
});

test('v3 quote retry replaces the display fallback with a fresh quote and exposes total comparison', async () => {
    let calls = 0;
    const harness = createBookingTicketsHarness({
        quoteHandler: async () => {
            calls += 1;
            if (calls === 1) {
                return {
                    success: false,
                    code: 'QUOTE_TEMPORARY_FAILURE',
                    error: 'Temporary quote failure',
                    details: { retryable: true }
                };
            }
            return {
                success: true,
                quote: {
                    admissionContext: 'standard',
                    dayType: 'weekend',
                    pricingDate: '2026-07-18',
                    ticketLines: [{
                        ticketTypeCode: 'regular_child',
                        audience: 'child',
                        quantity: 3,
                        unitPriceUah: 300,
                        subtotalUah: 900
                    }],
                    ticketSubtotal: 900
                }
            };
        }
    });
    try {
        harness.tickets.setActive(true);
        harness.tickets.hydrate({
            id: 'ticket-owner',
            bookingPackage: {
                schemaVersion: 3,
                ticketLines: [{
                    ticketTypeCode: 'regular_child',
                    audience: 'child',
                    quantity: 2,
                    unitPriceUah: 400,
                    subtotalUah: 800
                }],
                ticketSubtotal: 800
            }
        }, { bookingId: 'ticket-owner' });
        harness.document.getElementById('banquetGuests').value = '3';
        await harness.tickets.quoteNow();

        harness.document.getElementById('bookingTicketRetryQuote').click();
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.equal(calls, 2);
        assert.equal(harness.tickets.getSubtotal(), 900);
        assert.deepEqual(
            { ...harness.tickets.getComparison() },
            { previousSubtotal: 800, currentSubtotal: 900, delta: 100 }
        );
        assert.equal(harness.document.getElementById('bookingTicketRetryQuote'), null);
        assert.ok(harness.tickets.collect().ticketQuote);
    } finally {
        harness.close();
    }
});

test('allocation and availability quote errors are localized and target the relevant controls', async () => {
    const scenarios = [{
        name: 'child allocation',
        prepare: document => {
            document.getElementById('ticketBirthdayChildQuantity').value = '3';
        },
        result: {
            success: false,
            code: 'TICKET_CHILD_TOTAL_EXCEEDED',
            error: 'Special child ticket total exceeds banquetGuests',
            details: { banquetGuests: 2, specialChildTotal: 3 }
        },
        message: /Спеціальних дитячих квитків \(3\) більше, ніж дітей у бронюванні \(2\)/,
        fields: ['ticketBirthdayChildQuantity', 'banquetGuests']
    }, {
        name: 'adult allocation',
        prepare: document => {
            document.getElementById('ticketAdultGameQuantity').value = '2';
        },
        result: {
            success: false,
            code: 'TICKET_ADULT_TOTAL_EXCEEDED',
            error: 'adult_game exceeds banquetAdults',
            details: { banquetAdults: 0, adultGame: 2 }
        },
        message: /Ігрових квитків для дорослих \(2\) більше, ніж дорослих у бронюванні \(0\)/,
        fields: ['ticketAdultGameQuantity', 'banquetAdults']
    }, {
        name: 'under-three weekend tariff',
        prepare: document => {
            document.getElementById('ticketUnder3ChildQuantity').value = '1';
        },
        result: {
            success: false,
            code: 'TICKET_TYPE_UNAVAILABLE',
            error: 'Unavailable',
            details: {
                ticketTypeCode: 'under_3_child',
                dayType: 'weekend'
            }
        },
        message: /доступний лише у будні/,
        fields: ['ticketUnder3ChildQuantity']
    }];

    for (const scenario of scenarios) {
        const harness = createBookingTicketsHarness({
            quoteHandler: async () => scenario.result
        });
        try {
            harness.tickets.setActive(true);
            scenario.prepare(harness.document);
            await harness.tickets.quoteNow();
            const issue = harness.tickets.validationIssue();
            assert.match(issue.message, scenario.message, scenario.name);
            assert.deepEqual([...issue.fields], scenario.fields, scenario.name);
        } finally {
            harness.close();
        }
    }
});

test('unknown English quote errors are not exposed while localized connectivity guidance is preserved', async () => {
    const results = [{
        error: 'Temporary quote failure',
        expected: 'Не вдалося розрахувати квитки. Перевірте дані та повторіть спробу.'
    }, {
        error: 'Розрахунок квитків недоступний без зв’язку із сервером.',
        expected: 'Розрахунок квитків недоступний без зв’язку із сервером.'
    }];

    for (const result of results) {
        const harness = createBookingTicketsHarness({
            quoteHandler: async () => ({ success: false, error: result.error })
        });
        try {
            harness.tickets.setActive(true);
            await harness.tickets.quoteNow();
            assert.equal(harness.tickets.validationIssue().message, result.expected);
        } finally {
            harness.close();
        }
    }
});

test('ticket rows flow through booking detail, banquet summary, and PDF contracts', () => {
    const renderer = read('js/booking-package-renderer.js');
    const summary = read('services/banquetSummary.js');
    const pdf = read('services/banquetSummaryPdf.js');
    assert.match(renderer, /renderBookingPackageTicketRows/);
    assert.match(renderer, /line\.audience === 'adult' \? 'дорослих' : 'дітей'/);
    assert.match(summary, /function buildTicketRows/);
    assert.match(summary, /\.\.\.ticketRows/);
    assert.match(pdf, /\['ticket', 'entry'\]\.includes\(row\.type\)/);
});
