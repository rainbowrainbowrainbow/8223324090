'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    AdmissionTicketError,
    MANUAL_TICKET_TYPE_CODES,
    TICKET_TYPE_CODES,
    deriveTicketQuantities,
    listAdmissionTicketCatalog,
    normalizeManualTicketQuantities,
    readAdmissionTicketSnapshot,
    resolveAndApplyAdmissionTicketQuote,
    resolveAdmissionTicketQuote,
    validateTariffMutation
} = require('../services/admissionTickets');

const ROOT = path.resolve(__dirname, '..');
const serviceSource = fs.readFileSync(path.join(ROOT, 'services', 'admissionTickets.js'), 'utf8');
const bookingRouteSource = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');
const clientApiSource = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');

const MATRIX = Object.freeze({
    regular_child: {
        standard: { weekday: 350, weekend: 400 },
        reserved_table_room: { weekday: 310, weekend: 350 }
    },
    under_3_child: {
        standard: { weekday: 175, weekend: null },
        reserved_table_room: { weekday: 175, weekend: null }
    },
    discounted_child: {
        standard: { weekday: 175, weekend: 200 },
        reserved_table_room: { weekday: 175, weekend: 200 }
    },
    birthday_child: {
        standard: { weekday: 10, weekend: 10 },
        reserved_table_room: { weekday: 10, weekend: 10 }
    },
    adult_companion: {
        standard: { weekday: 10, weekend: 10 },
        reserved_table_room: { weekday: 10, weekend: 10 }
    },
    adult_game: {
        standard: { weekday: 75, weekend: 75 },
        reserved_table_room: { weekday: 75, weekend: 75 }
    }
});

const TYPE_META = Object.freeze({
    regular_child: { id: 1, name: 'Звичайний дитячий', audience: 'child', allocation: 'remainder' },
    under_3_child: { id: 2, name: 'Дитина до 3 років', audience: 'child', allocation: 'manual' },
    discounted_child: { id: 3, name: 'Пільговий дитячий', audience: 'child', allocation: 'manual' },
    birthday_child: { id: 4, name: 'Іменинник', audience: 'child', allocation: 'manual' },
    adult_companion: { id: 5, name: 'Дорослий супроводжуючий', audience: 'adult', allocation: 'remainder' },
    adult_game: { id: 6, name: 'Дорослий ігровий', audience: 'adult', allocation: 'manual' }
});

function tariffRows(context, day, options = {}) {
    return TICKET_TYPE_CODES
        .filter(code => code !== options.missingTypeCode)
        .map(code => {
            const amount = code === options.unavailableCode
                ? null
                : (code === options.zeroCode ? 0 : MATRIX[code][context][day]);
            return {
                ticket_type_id: TYPE_META[code].id,
                code,
                name: TYPE_META[code].name,
                audience: TYPE_META[code].audience,
                allocation_strategy: TYPE_META[code].allocation,
                requirement_text: null,
                is_active: options.inactiveCode === code ? false : true,
                tariff_version_id: code === options.missingTariffCode
                    ? null
                    : 100 + TYPE_META[code].id + Number(options.versionOffset || 0),
                admission_context: context,
                day_type: day,
                availability: amount === null ? 'unavailable' : 'available',
                amount_uah: amount,
                effective_from: '2026-07-14',
                revision: 1
            };
        });
}

function quoteQueryable(options = {}) {
    return {
        async query(sql, params = []) {
            if (/FROM timeline_resources/i.test(sql)) {
                const resourceId = params[1];
                return {
                    rows: resourceId && resourceId !== 'room-takeaway'
                        ? [{
                            resource_id: resourceId,
                            business_context: params[0],
                            type: 'room',
                            is_active: true
                        }]
                        : []
                };
            }
            if (/FROM banquet_group_bookings/i.test(sql)) {
                return {
                    rows: options.existingBanquet === false
                        ? []
                        : [{
                            booking_id: params[0],
                            group_id: 'BQ-TEST',
                            business_context: params[1],
                            banquet_group_id: 'BQ-TEST',
                            banquet_group_business_context: params[1],
                            banquet_group_status: 'active'
                        }]
                };
            }
            if (/LEFT JOIN LATERAL/i.test(sql)) {
                return {
                    rows: tariffRows(params[1], params[2], options)
                };
            }
            throw new Error(`Unexpected query: ${String(sql).slice(0, 80)}`);
        }
    };
}

function payloadForType(code, context, day) {
    const payload = {
        date: day === 'weekend' ? '2026-07-18' : '2026-07-17',
        roomResourceId: context === 'reserved_table_room' ? 'room-yellow-table' : 'room-takeaway',
        banquetGuests: 0,
        banquetAdults: 0,
        ticketQuantities: []
    };
    if (code === 'regular_child') payload.banquetGuests = 1;
    if (code === 'adult_companion') payload.banquetAdults = 1;
    if (['under_3_child', 'discounted_child', 'birthday_child'].includes(code)) {
        payload.banquetGuests = 1;
        payload.ticketQuantities.push({ code, quantity: 1 });
    }
    if (code === 'adult_game') {
        payload.banquetAdults = 1;
        payload.ticketQuantities.push({ code, quantity: 1 });
    }
    return payload;
}

test('manual quantity parser accepts only the four explicit manual codes', () => {
    assert.deepEqual(normalizeManualTicketQuantities([
        { code: 'birthday_child', quantity: 2 },
        { code: 'under_3_child', quantity: 1 },
        { code: 'discounted_child', quantity: 3 },
        { code: 'adult_game', quantity: 4 }
    ]), {
        birthday_child: 2,
        under_3_child: 1,
        discounted_child: 3,
        adult_game: 4
    });
    assert.deepEqual(
        Object.keys(normalizeManualTicketQuantities([])).sort(),
        [...MANUAL_TICKET_TYPE_CODES].sort()
    );
});

test('server derives child and adult remainder quantities for mixed and zero-remainder cases', () => {
    assert.deepEqual(deriveTicketQuantities({
        banquetGuests: 10,
        banquetAdults: 5,
        manualQuantities: {
            birthday_child: 2,
            under_3_child: 1,
            discounted_child: 3,
            adult_game: 2
        }
    }), {
        regular_child: 4,
        under_3_child: 1,
        discounted_child: 3,
        birthday_child: 2,
        adult_companion: 3,
        adult_game: 2
    });
    assert.equal(deriveTicketQuantities({
        banquetGuests: 3,
        banquetAdults: 2,
        manualQuantities: {
            birthday_child: 2,
            under_3_child: 1,
            discounted_child: 0,
            adult_game: 2
        }
    }).regular_child, 0);
});

test('quantity validation rejects negative, decimal, duplicate, unknown, remainder, and overflow input', () => {
    const invalidCases = [
        [[{ code: 'birthday_child', quantity: -1 }], 'TICKET_QUANTITY_INVALID'],
        [[{ code: 'birthday_child', quantity: 1.5 }], 'TICKET_QUANTITY_INVALID'],
        [[
            { code: 'birthday_child', quantity: 1 },
            { code: 'birthday_child', quantity: 1 }
        ], 'TICKET_TYPE_DUPLICATE'],
        [[{ code: 'other_child', quantity: 1 }], 'TICKET_TYPE_UNKNOWN'],
        [[{ code: 'regular_child', quantity: 1 }], 'TICKET_TYPE_UNKNOWN']
    ];
    for (const [input, code] of invalidCases) {
        assert.throws(
            () => normalizeManualTicketQuantities(input),
            error => error instanceof AdmissionTicketError && error.code === code
        );
    }
    assert.throws(
        () => deriveTicketQuantities({
            banquetGuests: 1,
            banquetAdults: 0,
            manualQuantities: {
                birthday_child: 1,
                under_3_child: 1,
                discounted_child: 0,
                adult_game: 0
            }
        }),
        error => error.code === 'TICKET_CHILD_TOTAL_EXCEEDED'
    );
    assert.throws(
        () => deriveTicketQuantities({
            banquetGuests: 0,
            banquetAdults: 1,
            manualQuantities: {
                birthday_child: 0,
                under_3_child: 0,
                discounted_child: 0,
                adult_game: 2
            }
        }),
        error => error.code === 'TICKET_ADULT_TOTAL_EXCEEDED'
    );
});

test('client pricing fields are rejected even when nested in a manual ticket row', () => {
    for (const field of ['unitPrice', 'subtotal', 'ticketName', 'audience', 'admissionContext', 'tariffVersionId']) {
        assert.throws(
            () => normalizeManualTicketQuantities([{
                code: 'birthday_child',
                quantity: 1,
                [field]: field === 'ticketName' ? '<script>' : 999
            }]),
            error => error.code === 'TICKET_PRICING_FIELD_FORBIDDEN'
        );
    }
});

test('tariff mutation distinguishes available zero from unavailable null', () => {
    assert.deepEqual(validateTariffMutation({
        admissionContext: 'standard',
        dayType: 'weekday',
        availability: 'available',
        amountUah: 0,
        effectiveFrom: '2026-07-14',
        expectedRevision: 1
    }), {
        admissionContext: 'standard',
        dayType: 'weekday',
        availability: 'available',
        amountUah: 0,
        effectiveFrom: '2026-07-14',
        expectedRevision: 1,
        changeNote: null
    });
    assert.equal(validateTariffMutation({
        admissionContext: 'standard',
        dayType: 'weekend',
        availability: 'unavailable',
        amountUah: null,
        effectiveFrom: '2026-07-14',
        expectedRevision: 1
    }).amountUah, null);
    assert.throws(
        () => validateTariffMutation({
            admissionContext: 'standard',
            dayType: 'weekday',
            availability: 'available',
            amountUah: null,
            effectiveFrom: '2026-07-14',
            expectedRevision: 1
        }),
        error => error.code === 'TICKET_AMOUNT_INVALID'
    );
});

for (const code of TICKET_TYPE_CODES) {
    for (const context of ['standard', 'reserved_table_room']) {
        for (const day of ['weekday', 'weekend']) {
            test(`resolver matrix: ${code} / ${context} / ${day}`, async () => {
                const payload = payloadForType(code, context, day);
                if (code === 'under_3_child' && day === 'weekend') {
                    await assert.rejects(
                        resolveAdmissionTicketQuote({
                            queryable: quoteQueryable(),
                            businessContext: 'event_genix',
                            input: payload,
                            newBanquetFlow: true
                        }),
                        error => error.code === 'TICKET_TYPE_UNAVAILABLE'
                    );
                    return;
                }
                const quote = await resolveAdmissionTicketQuote({
                    queryable: quoteQueryable(),
                    businessContext: 'event_genix',
                    input: payload,
                    newBanquetFlow: true,
                    now: new Date('2026-07-18T12:00:00.000Z')
                });
                assert.equal(quote.admissionContext, context);
                assert.equal(quote.dayType, day);
                assert.equal(quote.ticketLines.length, 1);
                assert.equal(quote.ticketLines[0].ticketTypeCode, code);
                assert.equal(quote.ticketLines[0].quantity, 1);
                assert.equal(quote.ticketLines[0].unitPriceUah, MATRIX[code][context][day]);
                assert.equal(quote.ticketSubtotal, MATRIX[code][context][day]);
                assert.equal(quote.ticketLines[0].tariffVersionId, 100 + TYPE_META[code].id);
                assert.equal(quote.ticketLines[0].effectiveFrom, '2026-07-14');
                assert.equal(quote.currency, 'UAH');
                assert.equal(quote.pricingDate, payload.date);
                assert.equal(quote.pricedAt, '2026-07-18T12:00:00.000Z');
            });
        }
    }
}

test('missing tariff, unavailable tariff, and available zero have different resolver outcomes', async () => {
    const payload = payloadForType('regular_child', 'standard', 'weekday');
    await assert.rejects(
        resolveAdmissionTicketQuote({
            queryable: quoteQueryable({ missingTariffCode: 'regular_child' }),
            businessContext: 'event_genix',
            input: payload,
            newBanquetFlow: true
        }),
        error => error.status === 503 && error.code === 'TICKET_TARIFF_MISSING'
    );
    await assert.rejects(
        resolveAdmissionTicketQuote({
            queryable: quoteQueryable({ unavailableCode: 'regular_child' }),
            businessContext: 'event_genix',
            input: payload,
            newBanquetFlow: true
        }),
        error => error.code === 'TICKET_TYPE_UNAVAILABLE'
    );
    const zeroQuote = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable({ zeroCode: 'regular_child' }),
        businessContext: 'event_genix',
        input: payload,
        newBanquetFlow: true
    });
    assert.equal(zeroQuote.ticketLines[0].unitPriceUah, 0);
    assert.equal(zeroQuote.ticketSubtotal, 0);
});

test('quote rejects kids_count conflict and tampered top-level pricing fields', async () => {
    await assert.rejects(
        resolveAdmissionTicketQuote({
            queryable: quoteQueryable(),
            businessContext: 'event_genix',
            input: {
                ...payloadForType('regular_child', 'standard', 'weekday'),
                kidsCount: 2
            },
            newBanquetFlow: true
        }),
        error => error.code === 'TICKET_GUEST_COUNT_CONFLICT'
    );
    for (const field of ['unitPrice', 'subtotal', 'admissionContext', 'tariffVersionId']) {
        await assert.rejects(
            resolveAdmissionTicketQuote({
                queryable: quoteQueryable(),
                businessContext: 'event_genix',
                input: {
                    ...payloadForType('regular_child', 'standard', 'weekday'),
                    [field]: 999
                },
                newBanquetFlow: true
            }),
            error => error.code === 'TICKET_PRICING_FIELD_FORBIDDEN'
        );
    }
});

test('legacy adapter reads one historical regular-child line without inventing special or adult tickets', () => {
    const legacy = readAdmissionTicketSnapshot({
        extra_data: {
            bookingPackage: {
                schemaVersion: 2,
                entryCharge: {
                    quantity: 12,
                    unitPrice: 300,
                    subtotal: 3600
                },
                entrySubtotal: 3600
            }
        }
    });
    assert.equal(legacy.kind, 'legacy');
    assert.equal(legacy.requiresExplicitConversion, true);
    assert.equal(legacy.ticketLines.length, 1);
    assert.equal(legacy.ticketLines[0].ticketTypeCode, 'regular_child');
    assert.equal(legacy.ticketSubtotal, 3600);
    assert.deepEqual(legacy.manualQuantities, {
        birthday_child: 0,
        under_3_child: 0,
        discounted_child: 0,
        adult_game: 0
    });
});

test('v3 dual-reader preserves stored ticket prices and extracts only manual quantities', () => {
    const snapshot = readAdmissionTicketSnapshot({
        extra_data: {
            bookingPackage: {
                schemaVersion: 3,
                ticketLines: [{
                    ticketTypeId: 4,
                    ticketTypeCode: 'birthday_child',
                    ticketTypeName: 'Іменинник',
                    audience: 'child',
                    quantity: 2,
                    unitPriceUah: 10,
                    subtotalUah: 20,
                    tariffVersionId: 104,
                    effectiveFrom: '2026-07-14',
                    admissionContext: 'standard',
                    dayType: 'weekday',
                    currency: 'UAH'
                }],
                ticketSubtotal: 20
            }
        }
    });
    assert.equal(snapshot.kind, 'v3');
    assert.equal(snapshot.ticketSubtotal, 20);
    assert.equal(snapshot.manualQuantities.birthday_child, 2);
});

test('save resolver replaces tampered client prices with the canonical server quote', async () => {
    const preview = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable(),
        businessContext: 'event_genix',
        input: payloadForType('regular_child', 'standard', 'weekday'),
        newBanquetFlow: true
    });
    const booking = {
        ...payloadForType('regular_child', 'standard', 'weekday'),
        ticketQuote: {
            ...preview,
            ticketSubtotal: 999999,
            ticketLines: preview.ticketLines.map(line => ({
                ...line,
                unitPriceUah: 999999,
                subtotalUah: 999999
            }))
        }
    };
    const result = await resolveAndApplyAdmissionTicketQuote({
        queryable: quoteQueryable(),
        businessContext: 'event_genix',
        booking,
        newBanquetFlow: true
    });
    assert.equal(result.applied, true);
    assert.equal(booking.ticketQuote.ticketSubtotal, 350);
    assert.equal(booking.ticketQuote.ticketLines[0].unitPriceUah, 350);
});

test('save resolver returns TICKET_PRICE_CHANGED with a fresh quote and version diff', async () => {
    const preview = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable(),
        businessContext: 'event_genix',
        input: payloadForType('regular_child', 'standard', 'weekday'),
        newBanquetFlow: true
    });
    await assert.rejects(
        resolveAndApplyAdmissionTicketQuote({
            queryable: quoteQueryable({ versionOffset: 10 }),
            businessContext: 'event_genix',
            booking: {
                ...payloadForType('regular_child', 'standard', 'weekday'),
                ticketQuote: preview
            },
            newBanquetFlow: true
        }),
        error => (
            error.code === 'TICKET_PRICE_CHANGED'
            && error.status === 409
            && error.details?.quote?.ticketLines?.[0]?.tariffVersionId === 111
            && error.details?.diff?.[0]?.ticketTypeCode === 'regular_child'
        )
    );
});

test('catalog groups context-scoped history and selects latest effective tariff for pricingDate', async () => {
    const seenParams = [];
    const queryable = {
        async query(sql, params) {
            seenParams.push(params);
            return {
                rows: [
                    {
                        id: 1,
                        business_context: 'event_genix',
                        code: 'regular_child',
                        name: 'Звичайний дитячий',
                        audience: 'child',
                        allocation_strategy: 'remainder',
                        requirement_text: null,
                        is_system: true,
                        is_active: true,
                        sort_order: 10,
                        tariff_version_id: 12,
                        ticket_type_id: 1,
                        admission_context: 'standard',
                        day_type: 'weekday',
                        availability: 'available',
                        amount_uah: 375,
                        effective_from: '2026-08-01',
                        revision: 2
                    },
                    {
                        id: 1,
                        business_context: 'event_genix',
                        code: 'regular_child',
                        name: 'Звичайний дитячий',
                        audience: 'child',
                        allocation_strategy: 'remainder',
                        requirement_text: null,
                        is_system: true,
                        is_active: true,
                        sort_order: 10,
                        tariff_version_id: 11,
                        ticket_type_id: 1,
                        admission_context: 'standard',
                        day_type: 'weekday',
                        availability: 'available',
                        amount_uah: 350,
                        effective_from: '2026-07-14',
                        revision: 1
                    }
                ]
            };
        }
    };
    const catalog = await listAdmissionTicketCatalog(queryable, {
        businessContext: 'event_genix',
        pricingDate: '2026-07-18'
    });
    assert.deepEqual(seenParams, [['event_genix']]);
    assert.equal(catalog.ticketTypes.length, 1);
    assert.equal(catalog.ticketTypes[0].tariffHistory.length, 2);
    assert.equal(catalog.ticketTypes[0].currentTariffs[0].id, 11);
});

test('resolver SQL selects effective version by event date and revision without timezone conversion', () => {
    assert.match(
        serviceSource,
        /version\.effective_from <= \$4::date[\s\S]*ORDER BY version\.effective_from DESC, version\.revision DESC/
    );
    assert.doesNotMatch(serviceSource, /AT TIME ZONE/i);
});

test('quote route resolves business context outside the request body and disables caching', () => {
    assert.match(
        bookingRouteSource,
        /function ticketBusinessContextFromAuthenticatedRequest[\s\S]*query:\s*req\?\.query[\s\S]*headers:\s*req\?\.headers/
    );
    assert.doesNotMatch(
        bookingRouteSource,
        /function ticketBusinessContextFromAuthenticatedRequest[\s\S]{0,300}body:\s*req\?\.body/
    );
    assert.match(
        bookingRouteSource,
        /router\.post\('\/ticket-quote', requireAction\('edit_booking'\)/
    );
    assert.match(
        bookingRouteSource,
        /Cache-Control', 'no-store, no-cache, must-revalidate'/
    );
});

test('frontend quote helper aborts prior requests, rejects offline pricing, and ignores stale responses', () => {
    assert.match(clientApiSource, /const admissionTicketQuoteRequests = new Map\(\)/);
    assert.match(clientApiSource, /previous\?\.controller\) previous\.controller\.abort\(\)/);
    assert.match(clientApiSource, /navigator\.onLine === false/);
    assert.match(clientApiSource, /cache:\s*'no-store'/);
    assert.match(
        clientApiSource,
        /current\.sequence !== sequence[\s\S]*stale:\s*true,\s*aborted:\s*true/
    );
});
