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
    hasTicketQuoteInput,
    hasTicketSnapshotFields,
    listAdmissionTicketCatalog,
    normalizeManualTicketQuantities,
    readAdmissionTicketSnapshot,
    resolveAndApplyAdmissionTicketQuote,
    resolveAdmissionTicketQuote,
    ticketQuoteDiff,
    ticketQuoteFingerprint,
    validateTariffMutation
} = require('../services/admissionTickets');
const {
    assertRecurringTemplateTicketSafe
} = require('../services/recurring');

const ROOT = path.resolve(__dirname, '..');
const serviceSource = fs.readFileSync(path.join(ROOT, 'services', 'admissionTickets.js'), 'utf8');
const bookingRouteSource = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');
const recurringRouteSource = fs.readFileSync(path.join(ROOT, 'routes', 'recurring.js'), 'utf8');
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
            if (
                /FROM admission_ticket_types/i.test(sql)
                && /ORDER BY code\s+FOR SHARE/i.test(sql)
            ) {
                return {
                    rows: TICKET_TYPE_CODES.map((code, index) => ({
                        id: index + 1,
                        code
                    }))
                };
            }
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
    for (const amountUah of [10.5, 2147483648, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(
            () => validateTariffMutation({
                admissionContext: 'standard',
                dayType: 'weekday',
                availability: 'available',
                amountUah,
                effectiveFrom: '2026-07-14',
                expectedRevision: 1
            }),
            error => error.code === 'TICKET_AMOUNT_INVALID'
        );
    }
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
                            && error.message === 'Квиток для дитини до 3 років недоступний у вихідні.'
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

test('save resolver rejects tampered client prices and returns the canonical server quote', async () => {
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
    await assert.rejects(
        resolveAndApplyAdmissionTicketQuote({
            queryable: quoteQueryable(),
            businessContext: 'event_genix',
            booking,
            newBanquetFlow: true
        }),
        error => (
            error instanceof AdmissionTicketError
            && error.status === 409
            && error.code === 'TICKET_PRICE_CHANGED'
            && error.details?.quote?.ticketSubtotal === 350
            && error.details?.quote?.ticketLines?.[0]?.unitPriceUah === 350
        )
    );
});

test('save resolver rejects client-supplied ticket snapshots and quotes without quantities', async () => {
    const ticketLine = {
        ticketTypeId: 1,
        ticketTypeCode: 'regular_child',
        ticketTypeName: TYPE_META.regular_child.name,
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
    const candidates = [{
        date: '2026-07-17',
        banquetGuests: 1,
        banquetAdults: 0,
        extraData: {
            bookingPackage: {
                schemaVersion: 3,
                ticketLines: [ticketLine],
                ticketSubtotal: 350
            }
        }
    }, {
        date: '2026-07-17',
        banquetGuests: 1,
        banquetAdults: 0,
        ticketQuote: {
            legacy: false,
            ticketLines: [ticketLine],
            ticketSubtotal: 350
        }
    }];

    for (const booking of candidates) {
        await assert.rejects(
            resolveAndApplyAdmissionTicketQuote({
                queryable: quoteQueryable(),
                businessContext: 'event_genix',
                booking,
                newBanquetFlow: false
            }),
            error => (
                error instanceof AdmissionTicketError
                && error.status === 422
                && error.code === 'TICKET_SNAPSHOT_INPUT_FORBIDDEN'
            )
        );
    }
});

test('ticket input guards scan every package and extra-data alias without shadowing', () => {
    const forgedSnapshot = {
        schemaVersion: 3,
        ticketLines: [],
        ticketSubtotal: 1
    };
    const snapshotCandidates = [
        { bookingPackage: {}, extraData: { bookingPackage: forgedSnapshot } },
        { booking_package: {}, extra_data: { booking_package: forgedSnapshot } },
        { extraData: {}, extra_data: { bookingPackage: forgedSnapshot } },
        { extra_data: {}, extraData: { booking_package: forgedSnapshot } },
        {
            bookingPackage: {},
            extra_data: JSON.stringify({ booking_package: forgedSnapshot })
        }
    ];
    for (const candidate of snapshotCandidates) {
        assert.equal(hasTicketSnapshotFields(candidate), true);
    }

    const nestedQuoteCandidates = [
        { bookingPackage: { ticketQuote: {} } },
        { booking_package: { ticket_quote: {} } },
        { extraData: { ticketQuote: {} } },
        { extra_data: { ticket_quote: {} } },
        { extraData: { booking_package: { ticketQuote: {} } } },
        {
            extra_data: JSON.stringify({
                bookingPackage: { ticket_quote: {} }
            })
        }
    ];
    for (const candidate of nestedQuoteCandidates) {
        assert.equal(hasTicketQuoteInput(candidate), true);
    }
});

test('save resolver rejects shadowed or nested ticket data before querying tariffs', async () => {
    let queryCount = 0;
    const queryable = {
        async query() {
            queryCount += 1;
            throw new Error('Ticket input guard must run before database pricing');
        }
    };
    const candidates = [
        {
            bookingPackage: {},
            extraData: {
                bookingPackage: {
                    schemaVersion: 3,
                    ticketLines: [],
                    ticketSubtotal: 1
                }
            },
            ticketQuantities: []
        },
        {
            extraData: {
                bookingPackage: {
                    ticketQuote: {
                        ticketLines: [],
                        ticketSubtotal: 1
                    }
                }
            },
            ticketQuantities: []
        }
    ];
    for (const booking of candidates) {
        await assert.rejects(
            resolveAndApplyAdmissionTicketQuote({
                queryable,
                businessContext: 'event_genix',
                booking,
                newBanquetFlow: false
            }),
            error => (
                error instanceof AdmissionTicketError
                && error.status === 422
                && error.code === 'TICKET_SNAPSHOT_INPUT_FORBIDDEN'
                && Boolean(error.details?.field)
            )
        );
    }
    assert.equal(queryCount, 0);
});

test('existing ticket preview treats banquetGuests as source of truth and kidsCount as an explicit mirror', async () => {
    const storedQuote = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable(),
        businessContext: 'event_genix',
        input: {
            date: '2026-07-17',
            roomResourceId: 'room-yellow-table',
            banquetGuests: 5,
            banquetAdults: 0,
            ticketQuantities: []
        },
        newBanquetFlow: true
    });
    const existingBooking = {
        id: 'BK-V3-GUESTS',
        business_context: 'event_genix',
        date: '2026-07-17',
        room_resource_id: 'room-yellow-table',
        banquet_guests: 5,
        banquet_adults: 0,
        kids_count: 5,
        extra_data: {
            bookingPackage: {
                schemaVersion: 3,
                ticketLines: storedQuote.ticketLines,
                ticketSubtotal: storedQuote.ticketSubtotal,
                ticketPricingContext: storedQuote.admissionContext,
                ticketDayType: storedQuote.dayType,
                ticketPricingDate: storedQuote.pricingDate,
                ticketPricedAt: storedQuote.pricedAt
            }
        }
    };

    const changedGuestsQuote = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable(),
        businessContext: 'event_genix',
        input: {
            date: '2026-07-17',
            roomResourceId: 'room-yellow-table',
            banquetGuests: 7,
            banquetAdults: 0,
            ticketQuantities: []
        },
        existingBooking
    });
    assert.equal(changedGuestsQuote.normalizedQuantities.regular_child, 7);

    await assert.rejects(
        resolveAdmissionTicketQuote({
            queryable: quoteQueryable(),
            businessContext: 'event_genix',
            input: {
                date: '2026-07-17',
                roomResourceId: 'room-yellow-table',
                banquetGuests: 7,
                banquetAdults: 0,
                kidsCount: 5,
                ticketQuantities: []
            },
            existingBooking
        }),
        error => (
            error.code === 'TICKET_GUEST_COUNT_CONFLICT'
            && error.details?.kidsCount === 5
            && error.details?.banquetGuests === 7
        )
    );
});

test('full quote fingerprint ignores pricedAt and line order but detects quantity and context changes', async () => {
    const quote = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable({ existingBanquet: false }),
        businessContext: 'event_genix',
        input: {
            date: '2026-07-17',
            roomResourceId: 'room-takeaway',
            banquetGuests: 2,
            banquetAdults: 1,
            ticketQuantities: []
        },
        newBanquetFlow: false
    });
    const reordered = {
        ...quote,
        pricedAt: '2099-01-01T00:00:00.000Z',
        ticketLines: [...quote.ticketLines].reverse()
    };
    assert.equal(ticketQuoteFingerprint(quote), ticketQuoteFingerprint(reordered));
    assert.deepEqual(ticketQuoteDiff(quote, reordered), []);

    const changedQuantity = {
        ...quote,
        ticketLines: quote.ticketLines.map(line => (
            line.ticketTypeCode === 'regular_child'
                ? {
                    ...line,
                    quantity: line.quantity + 1,
                    subtotalUah: line.subtotalUah + line.unitPriceUah
                }
                : line
        )),
        ticketSubtotal: quote.ticketSubtotal + 350
    };
    assert.notEqual(ticketQuoteFingerprint(quote), ticketQuoteFingerprint(changedQuantity));
    assert.ok(ticketQuoteDiff(quote, changedQuantity).some(item => (
        item.ticketTypeCode === 'regular_child'
        && item.previousQuantity === 2
        && item.currentQuantity === 3
    )));

    assert.notEqual(
        ticketQuoteFingerprint(quote),
        ticketQuoteFingerprint({ ...quote, admissionContext: 'reserved_table_room' })
    );
});

test('same-tariff quantity change requires fresh confirmation and retry syncs compatibility counts', async () => {
    const preview = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable({ existingBanquet: false }),
        businessContext: 'event_genix',
        input: {
            date: '2026-07-17',
            roomResourceId: 'room-takeaway',
            banquetGuests: 1,
            banquetAdults: 0,
            ticketQuantities: []
        },
        newBanquetFlow: false
    });
    const booking = {
        date: '2026-07-17',
        roomResourceId: 'room-takeaway',
        banquetGuests: 2,
        banquetAdults: 0,
        ticketQuantities: [],
        ticketQuote: preview
    };
    let freshQuote = null;
    await assert.rejects(
        resolveAndApplyAdmissionTicketQuote({
            queryable: quoteQueryable({ existingBanquet: false }),
            businessContext: 'event_genix',
            booking,
            newBanquetFlow: false
        }),
        error => {
            freshQuote = error.details?.quote || null;
            return (
                error.code === 'TICKET_QUOTE_CHANGED'
                && error.status === 409
                && error.details?.diff?.some(item => (
                    item.ticketTypeCode === 'regular_child'
                    && item.previousQuantity === 1
                    && item.currentQuantity === 2
                ))
            );
        }
    );
    assert.equal(freshQuote?.ticketSubtotal, 700);

    booking.ticketQuote = freshQuote;
    const result = await resolveAndApplyAdmissionTicketQuote({
        queryable: quoteQueryable({ existingBanquet: false }),
        businessContext: 'event_genix',
        booking,
        newBanquetFlow: false
    });
    assert.equal(result.applied, true);
    assert.equal(booking.banquetGuests, 2);
    assert.equal(booking.kidsCount, 2);
    assert.equal(booking.banquetAdults, 0);
});

test('unrelated edit preserves an old v3 snapshot and upgrades its quote fingerprint without tariff queries', async () => {
    const storedQuote = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable({ existingBanquet: false }),
        businessContext: 'event_genix',
        input: {
            date: '2026-07-17',
            roomResourceId: 'room-takeaway',
            banquetGuests: 1,
            banquetAdults: 0,
            ticketQuantities: []
        },
        newBanquetFlow: false
    });
    const bookingPackage = {
        schemaVersion: 3,
        ticketLines: storedQuote.ticketLines,
        ticketSubtotal: storedQuote.ticketSubtotal,
        ticketPricingContext: storedQuote.admissionContext,
        ticketDayType: storedQuote.dayType,
        ticketPricingDate: storedQuote.pricingDate,
        ticketPricedAt: storedQuote.pricedAt
    };
    const existingBooking = {
        id: 'BK-V3-UNRELATED',
        business_context: 'event_genix',
        date: '2026-07-17',
        room_resource_id: 'room-takeaway',
        banquet_guests: 1,
        banquet_adults: 0,
        kids_count: 1,
        extra_data: { bookingPackage }
    };
    const booking = {
        id: existingBooking.id,
        businessContext: 'event_genix',
        date: existingBooking.date,
        roomResourceId: existingBooking.room_resource_id,
        banquetGuests: 1,
        banquetAdults: 0,
        extraData: { bookingPackage: structuredClone(bookingPackage) }
    };
    const result = await resolveAndApplyAdmissionTicketQuote({
        queryable: {
            async query() {
                throw new Error('Unrelated edit must not reprice a stored snapshot');
            }
        },
        businessContext: 'event_genix',
        booking,
        existingBooking
    });
    assert.equal(result.applied, true);
    assert.equal(result.preserved, true);
    assert.equal(result.quote.quoteContractVersion, 1);
    assert.match(result.quote.quoteFingerprint, /^v1:[a-f0-9]{64}$/);
    assert.equal(booking.ticketQuote.ticketSubtotal, storedQuote.ticketSubtotal);
    assert.equal(booking.banquetGuests, 1);
    assert.equal(booking.kidsCount, 1);
    assert.equal(booking.banquetAdults, 0);
});

test('save resolver locks ticket types before reading tariffs', async () => {
    const preview = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable({ existingBanquet: false }),
        businessContext: 'event_genix',
        input: {
            date: '2026-07-17',
            roomResourceId: 'room-takeaway',
            banquetGuests: 1,
            banquetAdults: 0,
            ticketQuantities: []
        },
        newBanquetFlow: false
    });
    const queries = [];
    const base = quoteQueryable({ existingBanquet: false });
    const booking = {
        date: '2026-07-17',
        roomResourceId: 'room-takeaway',
        banquetGuests: 1,
        banquetAdults: 0,
        ticketQuantities: [],
        ticketQuote: preview
    };

    await resolveAndApplyAdmissionTicketQuote({
        queryable: {
            async query(sql, params) {
                queries.push(String(sql));
                return base.query(sql, params);
            }
        },
        businessContext: 'event_genix',
        booking,
        newBanquetFlow: false
    });

    const lockIndex = queries.findIndex(sql => /ORDER BY code\s+FOR SHARE/i.test(sql));
    const tariffIndex = queries.findIndex(sql => /LEFT JOIN LATERAL/i.test(sql));
    assert.ok(lockIndex >= 0);
    assert.ok(tariffIndex > lockIndex);
});

test('unrelated edit rejects a corrupted stored v3 snapshot before it can receive a new fingerprint', async () => {
    const storedQuote = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable({ existingBanquet: false }),
        businessContext: 'event_genix',
        input: {
            date: '2026-07-17',
            roomResourceId: 'room-takeaway',
            banquetGuests: 1,
            banquetAdults: 0,
            ticketQuantities: []
        },
        newBanquetFlow: false
    });
    const corruptedPackage = {
        schemaVersion: 3,
        ticketLines: storedQuote.ticketLines.map(line => ({
            ...line,
            subtotalUah: line.subtotalUah + 1
        })),
        ticketSubtotal: storedQuote.ticketSubtotal,
        ticketPricingContext: storedQuote.admissionContext,
        ticketDayType: storedQuote.dayType,
        ticketPricingDate: storedQuote.pricingDate,
        ticketPricedAt: storedQuote.pricedAt
    };
    const existingBooking = {
        id: 'BK-V3-CORRUPTED',
        business_context: 'event_genix',
        date: '2026-07-17',
        room_resource_id: 'room-takeaway',
        banquet_guests: 1,
        banquet_adults: 0,
        kids_count: 1,
        extra_data: { bookingPackage: corruptedPackage }
    };

    await assert.rejects(
        resolveAndApplyAdmissionTicketQuote({
            queryable: {
                async query() {
                    throw new Error('Corrupted snapshot validation must happen before tariff queries');
                }
            },
            businessContext: 'event_genix',
            booking: {
                id: existingBooking.id,
                date: existingBooking.date,
                roomResourceId: existingBooking.room_resource_id,
                banquetGuests: 1,
                banquetAdults: 0,
                extraData: { bookingPackage: structuredClone(corruptedPackage) }
            },
            existingBooking
        }),
        error => (
            error.code === 'TICKET_SNAPSHOT_INVALID'
            && error.details?.reason === 'line_subtotal'
        )
    );
});

test('unrelated edit marks a historical no-ticket package for explicit preservation', async () => {
    const existingBooking = {
        id: 'BK-NO-TICKETS',
        business_context: 'event_genix',
        date: '2026-07-17',
        room_resource_id: 'room-yellow-table',
        banquet_guests: 2,
        banquet_adults: 1,
        kids_count: 2,
        extra_data: {
            bookingPackage: {
                schemaVersion: 2,
                entryCharge: null,
                entrySubtotal: 0,
                finalTotal: 0,
                menuPositions: []
            }
        }
    };
    const booking = {
        id: existingBooking.id,
        date: existingBooking.date,
        roomResourceId: existingBooking.room_resource_id,
        banquetGuests: 2,
        banquetAdults: 1,
        extraData: structuredClone(existingBooking.extra_data)
    };

    const result = await resolveAndApplyAdmissionTicketQuote({
        queryable: {
            async query() {
                throw new Error('No-ticket preservation must not query tariffs');
            }
        },
        businessContext: 'event_genix',
        booking,
        existingBooking,
        newBanquetFlow: false
    });

    assert.deepEqual(result, {
        applied: false,
        quote: null,
        preserveNoTicketPackage: true
    });
    assert.equal(booking.ticketQuote, undefined);
});

test('legacy ticket conversion requires confirmation and explicit quantities', async () => {
    const existingBooking = {
        id: 'BK-LEGACY-TICKETS',
        business_context: 'event_genix',
        date: '2026-07-17',
        room_resource_id: 'room-takeaway',
        banquet_guests: null,
        banquet_adults: null,
        kids_count: 2,
        extra_data: {
            bookingPackage: {
                schemaVersion: 2,
                entryCharge: {
                    quantity: 2,
                    unitPrice: 300,
                    subtotal: 600
                },
                entrySubtotal: 600
            }
        }
    };

    await assert.rejects(
        resolveAdmissionTicketQuote({
            queryable: quoteQueryable({ existingBanquet: false }),
            businessContext: 'event_genix',
            input: { ticketQuantities: [] },
            existingBooking,
            newBanquetFlow: false
        }),
        error => (
            error instanceof AdmissionTicketError
            && error.status === 409
            && error.code === 'TICKET_LEGACY_CONVERSION_CONFIRMATION_REQUIRED'
        )
    );

    await assert.rejects(
        resolveAdmissionTicketQuote({
            queryable: quoteQueryable({ existingBanquet: false }),
            businessContext: 'event_genix',
            input: { convertLegacy: true },
            existingBooking,
            newBanquetFlow: false
        }),
        error => (
            error instanceof AdmissionTicketError
            && error.status === 422
            && error.code === 'TICKET_QUANTITIES_REQUIRED'
        )
    );
});

test('legacy conversion falls back to kids_count and zero adults when canonical counts are absent', async () => {
    const quote = await resolveAdmissionTicketQuote({
        queryable: quoteQueryable({ existingBanquet: false }),
        businessContext: 'event_genix',
        input: {
            convertLegacy: true,
            ticketQuantities: []
        },
        existingBooking: {
            id: 'BK-LEGACY-FALLBACK',
            business_context: 'event_genix',
            date: '2026-07-17',
            room_resource_id: 'room-takeaway',
            banquet_guests: null,
            banquet_adults: null,
            kids_count: 2,
            extra_data: {
                bookingPackage: {
                    schemaVersion: 2,
                    entryCharge: {
                        quantity: 2,
                        unitPrice: 300,
                        subtotal: 600
                    },
                    entrySubtotal: 600
                }
            }
        },
        newBanquetFlow: false
    });

    assert.equal(quote.legacy, false);
    assert.equal(quote.ticketSubtotal, 700);
    assert.deepEqual(
        quote.ticketLines.map(line => ({
            code: line.ticketTypeCode,
            quantity: line.quantity,
            subtotal: line.subtotalUah
        })),
        [{ code: 'regular_child', quantity: 2, subtotal: 700 }]
    );
    assert.equal(quote.normalizedQuantities.regular_child, 2);
    assert.equal(quote.normalizedQuantities.adult_companion, 0);
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
                        tariff_version_id: 13,
                        ticket_type_id: 1,
                        admission_context: 'standard',
                        day_type: 'weekday',
                        availability: 'available',
                        amount_uah: 340,
                        effective_from: '2026-06-01',
                        revision: 3
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
    assert.equal(catalog.ticketTypes[0].tariffHistory.length, 3);
    assert.equal(catalog.ticketTypes[0].currentTariffs[0].id, 11);
    assert.equal(catalog.ticketTypes[0].headTariffs[0].id, 13);
});

test('resolver SQL selects effective version by event date and revision without timezone conversion', () => {
    assert.match(
        serviceSource,
        /version\.effective_from <= \$4::date[\s\S]*ORDER BY version\.effective_from DESC, version\.revision DESC/
    );
    assert.doesNotMatch(serviceSource, /AT TIME ZONE/i);
});

test('recurring generation rejects stored v3 and legacy ticket packages before any booking write', () => {
    for (const bookingPackage of [{
        schemaVersion: 3,
        ticketLines: [],
        ticketSubtotal: 0
    }, {
        schemaVersion: 2,
        entryCharge: {
            quantity: 1,
            unitPrice: 350,
            subtotal: 350
        },
        entrySubtotal: 350
    }]) {
        assert.throws(
            () => assertRecurringTemplateTicketSafe({
                id: 77,
                extra_data: JSON.stringify({ bookingPackage })
            }),
            error => (
                error.code === 'TICKET_RECURRING_UNSUPPORTED'
                && error.details?.templateId === 77
            )
        );
    }
    assert.doesNotThrow(() => assertRecurringTemplateTicketSafe({
        id: 78,
        extra_data: JSON.stringify({
            bookingWorkspace: { scenario: 'standard' }
        })
    }));
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

test('booking create routes enable reserved pricing only for explicit new or server-verified existing banquet context', () => {
    const quoteStart = bookingRouteSource.indexOf("router.post('/ticket-quote'");
    const quoteEnd = bookingRouteSource.indexOf('// v33.3: GET /api/bookings/occupancy', quoteStart);
    const createStart = bookingRouteSource.indexOf("router.post('/',");
    const createEnd = bookingRouteSource.indexOf("router.post('/education-series'", createStart);
    const fullStart = bookingRouteSource.indexOf("router.post('/full'");
    const fullEnd = bookingRouteSource.indexOf("router.put('/:id'", fullStart);

    assert.ok(quoteStart >= 0 && quoteEnd > quoteStart, 'ticket quote route should be extractable');
    assert.ok(createStart >= 0 && createEnd > createStart, 'generic create route should be extractable');
    assert.ok(fullStart >= 0 && fullEnd > fullStart, 'full create route should be extractable');

    const quoteRoute = bookingRouteSource.slice(quoteStart, quoteEnd);
    const createRoute = bookingRouteSource.slice(createStart, createEnd);
    const fullRoute = bookingRouteSource.slice(fullStart, fullEnd);

    assert.match(quoteRoute, /let newBanquetFlow = false/);
    assert.match(quoteRoute, /validateBookingBanquetCreationContract\(res, body\.banquetContext\)/);
    assert.match(quoteRoute, /newBanquetFlow = banquetContract\.context\?\.mode === 'new'/);
    assert.match(
        quoteRoute,
        /JOIN banquet_group_bookings membership[\s\S]*membership\.booking_id = \$3[\s\S]*verifiedExistingBanquetGroup = true/
    );
    assert.match(quoteRoute, /if \(verifiedExistingBanquetGroup\) \{\s*newBanquetFlow = true/);
    assert.match(quoteRoute, /delete quoteInput\.banquetContext/);
    assert.match(quoteRoute, /delete quoteInput\.banquet_context/);
    assert.match(quoteRoute, /delete quoteInput\.banquetGroupId/);
    assert.match(quoteRoute, /delete quoteInput\.sourceBookingId/);
    assert.match(quoteRoute, /existingBooking,\s*newBanquetFlow/);
    assert.doesNotMatch(quoteRoute, /newBanquetFlow:\s*!existingBooking/);

    assert.match(createRoute, /newBanquetFlow:\s*banquetContext\?\.mode === 'new'/);
    assert.doesNotMatch(createRoute, /newBanquetFlow:\s*true/);
    assert.match(fullRoute, /newBanquetFlow:\s*banquetContext\?\.mode === 'new'/);
    assert.doesNotMatch(fullRoute, /newBanquetFlow:\s*true/);
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

test('booking and recurring routes reject nested or client-supplied ticket snapshots before writes', () => {
    assert.match(
        bookingRouteSource,
        /const BOOKING_WRITE_ALIAS_PAIRS = Object\.freeze\(\[[\s\S]*'banquetGuests', 'banquet_guests'[\s\S]*'kidsCount', 'kids_count'[\s\S]*'ticketQuantities', 'ticket_quantities'[\s\S]*'ticketQuote', 'ticket_quote'/
    );
    assert.match(
        bookingRouteSource,
        /function canonicalizeBookingWriteAliases\(booking = \{\}\) \{[\s\S]*if \(hasCamel && hasSnake\)[\s\S]*return \{ camel, snake \}[\s\S]*booking\[camel\] = booking\[snake\]/
    );
    assert.match(
        bookingRouteSource,
        /function rejectBookingWriteAliasConflict\(res, booking = \{\}\) \{[\s\S]*BOOKING_FIELD_ALIAS_CONFLICT/
    );
    assert.match(
        bookingRouteSource,
        /function hasAdmissionTicketPayload\(booking = \{\}\) \{[\s\S]*hasTicketQuoteInput\(booking\)[\s\S]*hasTicketSnapshotFields\(booking\)/
    );
    assert.match(
        bookingRouteSource,
        /function rejectClientTicketSnapshotPayload\(res, booking = \{\}\) \{[\s\S]*nestedTicketQuotePath\(booking\)[\s\S]*TICKET_SNAPSHOT_INPUT_FORBIDDEN/
    );

    const quoteStart = bookingRouteSource.indexOf("router.post('/ticket-quote'");
    const quoteEnd = bookingRouteSource.indexOf('// v33.3: GET /api/bookings/occupancy', quoteStart);
    const createStart = bookingRouteSource.indexOf("router.post('/',");
    const createEnd = bookingRouteSource.indexOf("router.post('/education-series'", createStart);
    const fullStart = bookingRouteSource.indexOf("router.post('/full'");
    const fullEnd = bookingRouteSource.indexOf("router.put('/:id'", fullStart);
    const updateStart = bookingRouteSource.indexOf("router.put('/:id'");

    const quoteRoute = bookingRouteSource.slice(quoteStart, quoteEnd);
    const createRoute = bookingRouteSource.slice(createStart, createEnd);
    const fullRoute = bookingRouteSource.slice(fullStart, fullEnd);
    const updateRoute = bookingRouteSource.slice(updateStart);

    assert.ok(
        quoteRoute.indexOf('rejectClientTicketSnapshotPayload(res, body)')
            < quoteRoute.indexOf('resolveAdmissionTicketQuote({'),
        'quote preview must reject nested snapshots before pricing'
    );
    assert.ok(
        quoteRoute.indexOf('rejectBookingWriteAliasConflict(res, body)')
            < quoteRoute.indexOf('resolveAdmissionTicketQuote({'),
        'quote preview must canonicalize or reject aliases before pricing'
    );
    assert.ok(
        createRoute.indexOf('rejectClientTicketSnapshotPayload(res, b)')
            < createRoute.indexOf('resolveAndApplyAdmissionTicketQuote({'),
        'generic create must reject client snapshots before canonical pricing'
    );
    assert.ok(
        createRoute.indexOf('rejectBookingWriteAliasConflict(res, b)')
            < createRoute.indexOf('resolveAndApplyAdmissionTicketQuote({'),
        'generic create must canonicalize or reject aliases before pricing'
    );
    assert.ok(
        createRoute.indexOf("String(b.linkedTo || b.linked_to || '').trim()")
            < createRoute.indexOf('resolveAndApplyAdmissionTicketQuote({'),
        'linked create must reject all ticket payload aliases before canonical pricing'
    );
    assert.doesNotMatch(
        createRoute.slice(0, createRoute.indexOf('resolveAndApplyAdmissionTicketQuote({')),
        /applyBookingPackage\(b\)/,
        'generic create must not apply an untrusted client quote before canonical pricing'
    );
    assert.ok(
        fullRoute.indexOf('rejectClientTicketSnapshotPayload(res, main)')
            < fullRoute.indexOf('resolveAndApplyAdmissionTicketQuote({'),
        'full create must reject main client snapshots before canonical pricing'
    );
    assert.ok(
        fullRoute.indexOf('rejectBookingWriteAliasConflict(res, main)')
            < fullRoute.indexOf('resolveAndApplyAdmissionTicketQuote({'),
        'full create must canonicalize or reject aliases before pricing'
    );
    assert.doesNotMatch(
        fullRoute.slice(0, fullRoute.indexOf('resolveAndApplyAdmissionTicketQuote({')),
        /applyBookingPackage\(main\)/,
        'full create must not apply an untrusted main quote before canonical pricing'
    );
    assert.match(
        fullRoute.slice(0, fullRoute.indexOf('resolveAndApplyAdmissionTicketQuote({')),
        /\[\.\.\.linked, \.\.\.banquetActivities\]\.some\(booking => \([\s\S]*bookingPackageHasBanquetData\(booking\)/,
        'full create must reject material package data on non-owner activity and linked bookings'
    );
    assert.match(
        bookingRouteSource,
        /function wouldPersistAdmissionTicketsOnLinkedBooking\(booking = \{\}, existingBooking = \{\}\) \{[\s\S]*existingBooking\.linked_to[\s\S]*booking\.linkedTo[\s\S]*booking\.linked_to[\s\S]*hasAdmissionTicketPayload\(booking\)[\s\S]*readAdmissionTicketSnapshot\(existingBooking\)\?\.kind === 'v3'/
    );
    assert.equal(
        (updateRoute.match(/wouldPersistAdmissionTicketsOnLinkedBooking\(b, (?:old|oldBooking)\)/g) || []).length,
        2,
        'the linked ticket-owner invariant must be checked before work and again under the row lock'
    );
    assert.ok(
        updateRoute.indexOf('wouldPersistAdmissionTicketsOnLinkedBooking(b, oldBooking)')
            < updateRoute.indexOf('mergeExistingExtraDataForBookingUpdate(b, oldBooking)'),
        'the authoritative locked guard must run before preserving or repricing a v3 snapshot'
    );
    assert.ok(
        updateRoute.indexOf('rejectBookingWriteAliasConflict(res, b)')
            < updateRoute.indexOf('const old = await getScopedBookingById'),
        'generic update must canonicalize or reject aliases before loading defaults'
    );
    assert.match(updateRoute, /if \(b\.kidsCount === undefined\) b\.kidsCount = old\.kids_count/);

    assert.match(
        recurringRouteSource,
        /function hasRecurringTicketPayload\(booking = \{\}\) \{[\s\S]*hasTicketQuoteInput\(booking\)[\s\S]*hasTicketSnapshotFields\(booking\)[\s\S]*readAdmissionTicketSnapshot\(booking\)/
    );
    assert.match(
        recurringRouteSource,
        /router\.post\('\/', async \(req, res\) => \{[\s\S]*rejectRecurringTicketPayload\(res, b\)/
    );
    assert.match(
        recurringRouteSource,
        /router\.put\('\/:id', async \(req, res\) => \{[\s\S]*rejectRecurringTicketPayload\(res, b\)/
    );
});
