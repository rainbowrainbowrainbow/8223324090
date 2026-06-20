const test = require('node:test');
const assert = require('node:assert/strict');

const {
    BANQUET_SUMMARY_SCHEMA_VERSION,
    buildBanquetSummary
} = require('../services/banquetSummary');
const {
    renderBanquetTermsFromPriceRules,
    loadBanquetTermsDefaults,
    bookingNeedsBanquetTermsSnapshot,
    snapshotBanquetTermsForBooking
} = require('../services/banquetTerms');

function standardBanquetTermsPriceRules(overrides = {}) {
    const omitted = new Set(overrides.omit || []);
    return [
        ['banquet_own_cake_fee', 500],
        ['banquet_cork_fee', 100],
        ['banquet_menu_correction_deadline_days', 3],
        ['banquet_date_change_deadline_days', 5]
    ]
        .filter(([code]) => !omitted.has(code))
        .map(([code, value]) => ({ code, value: overrides[code] ?? value }));
}

test('banquet summary builds structured KeyCRM-like contract from booking package and linked activities', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        generatedBy: { username: 'manager', name: 'Manager Name' },
        banquetTermsDefaults: renderBanquetTermsFromPriceRules(standardBanquetTermsPriceRules()),
        customer: {
            id: 10,
            name: 'Олена Тест',
            phone: '+380000000001',
            child_name: 'Мія',
            child_birthday: '2020-06-01'
        },
        mainBooking: {
            id: 'BK-SUMMARY',
            business_context: 'event_genix',
            date: '2099-06-20',
            time: '14:00',
            room: 'Марвел',
            program_name: 'День народження',
            program_id: 'birthday_90',
            program_code: 'BD90',
            category: 'birthday',
            price: 3700,
            kids_count: 8,
            banquet_adults: 4,
            banquet_guests: 12,
            banquet_tables: 2,
            paid_amount: 1000,
            payment_method: 'cash',
            payment_status: 'partial',
            created_by: 'manager',
            extra_data: {
                bookingPackage: {
                    programBasePrice: 2500,
                    positionsSubtotal: 1200,
                    finalTotal: 3700,
                    menuPositions: [
                        { productId: 'pizza', title: 'Піца', quantity: 2, unitPrice: 300, subtotal: 600, note: 'без грибів', servingTime: '16:30', servingBatchId: 'serve-1630' },
                        { productId: 'juice', title: 'Сік', quantity: 3, unitPrice: 200, subtotal: 600 }
                    ],
                    serviceEvents: [
                        { type: 'cake', title: 'Винос торта', time: '17:10' }
                    ]
                },
                banquetDeposit: {
                    amount: 1000,
                    paymentMethod: 'cash',
                    paymentStatus: 'partial',
                    note: 'deposit marker'
                },
                banquetTerms: ['Завдаток не повертається']
            }
        },
        linkedBookings: [{
            id: 'BK-ACTIVITY',
            program_name: 'Аквагрим',
            price: 700,
            time: '15:00',
            duration: 30,
            room: 'Марвел',
            _banquetLink: { relation_type: 'banquet_activity', label: 'додатково' }
        }]
    });

    assert.equal(summary.success, true);
    assert.equal(summary.schemaVersion, BANQUET_SUMMARY_SCHEMA_VERSION);
    assert.equal(summary.bookingId, 'BK-SUMMARY');
    assert.equal(summary.document.title, 'БАНКЕТНИЙ ЛИСТ');
    assert.equal(summary.document.generatedBy, 'Manager Name');
    assert.equal(summary.event.manager, 'manager');
    assert.equal(summary.venue.name, 'Розважальний центр "Парк Закревського Періоду"');
    assert.equal(summary.customer.name, 'Олена Тест');
    assert.equal(summary.celebrant.name, 'Мія');
    assert.equal(summary.counts.children, 8);
    assert.equal(summary.counts.adults, 4);
    assert.equal(summary.counts.guests, null);
    assert.equal(summary.counts.tables, 2);
    assert.equal(summary.orderRows.length, 5);
    assert.equal(summary.orderRows[0].type, 'program');
    assert.equal(summary.orderRows[1].type, 'activity');
    assert.equal(summary.orderRows[2].type, 'menu');
    assert.equal(summary.orderRows[2].meta.servingTime, '16:30');
    assert.equal(summary.orderRows[4].type, 'service_event');
    assert.equal(summary.orderRows[4].meta.time, '17:10');
    assert.equal(summary.serviceEvents.length, 1);
    assert.equal(summary.serviceEvents[0].title, 'Винос торта');
    assert.equal(summary.serviceEvents[0].meta.time, '17:10');
    assert.equal(summary.totals.programBasePrice, 2500);
    assert.equal(summary.totals.menuSubtotal, 1200);
    assert.equal(summary.totals.orderTotal, 4400);
    assert.equal(summary.totals.bookingPrice, 3700);
    assert.equal(summary.totals.currency, 'UAH');
    assert.equal(summary.deposit.amount, 1000);
    assert.equal(summary.deposit.paymentMethod, 'cash');
    assert.equal(summary.deposit.paymentStatus, 'partial');
    assert.equal(summary.deposit.source, 'extra_data.banquetDeposit');
    assert.deepEqual(summary.terms.items, ['Завдаток не повертається']);
    assert.equal(summary.warnings.some(warning => warning.code === 'deposit_not_specified'), false);
    assert.equal(summary.warnings.some(warning => warning.code === 'serving_time_missing'), true);
});

test('banquet summary exposes canonical comments from workspace and legacy notes', () => {
    const primary = {
        id: 'BK-COMMENTS-PRIMARY',
        business_context: 'event_genix',
        date: '2099-08-12',
        time: '12:00',
        room: 'Марвел',
        program_name: 'Свято',
        price: 2500,
        extra_data: {
            banquetDeposit: { amount: 500 },
            bookingWorkspace: {
                comments: {
                    internal: 'Передзвонити клієнту перед друком листа'
                }
            }
        }
    };
    const kitchen = {
        id: 'BK-COMMENTS-KITCHEN',
        business_context: 'event_genix',
        program_code: 'KITCHEN',
        label: 'Кухня',
        price: 900,
        notes: 'legacy kitchen duplicate',
        extra_data: {
            bookingPackage: {
                positionsSubtotal: 900,
                menuPositions: [
                    { productId: 'pizza', title: 'Pizza', quantity: 3, unitPrice: 300, subtotal: 900 }
                ]
            },
            bookingWorkspace: {
                comments: {
                    kitchen: 'Підготувати дитячий стіл'
                }
            }
        }
    };
    const activity = {
        id: 'BK-COMMENTS-ACTIVITY',
        business_context: 'event_genix',
        program_name: 'Аквагрим',
        price: 700,
        notes: 'Попросити майстра прийти на 10 хв раніше'
    };

    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: primary,
        resolvedGroup: {
            source: 'banquet_group',
            groupId: 'BQ-COMMENTS',
            group: { id: 'BQ-COMMENTS', primaryBookingId: primary.id },
            members: [
                { bookingId: primary.id, role: 'primary', isPrimary: true, booking: primary },
                { bookingId: kitchen.id, role: 'kitchen', isKitchenCandidate: true, booking: kitchen },
                { bookingId: activity.id, role: 'activity', booking: activity }
            ]
        }
    });

    assert.deepEqual(summary.comments, [
        { type: 'kitchen', label: 'Кухня', text: 'Підготувати дитячий стіл', bookingId: 'BK-COMMENTS-KITCHEN' },
        { type: 'activity', label: 'Активність — Аквагрим', text: 'Попросити майстра прийти на 10 хв раніше', bookingId: 'BK-COMMENTS-ACTIVITY' },
        { type: 'internal', label: 'Внутрішній коментар', text: 'Передзвонити клієнту перед друком листа', bookingId: 'BK-COMMENTS-PRIMARY' }
    ]);
    assert.equal(summary.orderRows.some(row => row.type === 'menu' && row.title === 'Pizza'), true);
    assert.equal(summary.totals.orderTotal, 4100);
});

test('banquet terms renderer builds standard terms from price rules', () => {
    const rendered = renderBanquetTermsFromPriceRules(standardBanquetTermsPriceRules());

    assert.equal(rendered.title, 'Умови банкету');
    assert.deepEqual(rendered.missingCodes, []);
    assert.deepEqual(rendered.items, [
        'Заборонено приносити їжу/напої/торт.',
        'Сума завдатку не повертається. Свій торт - 500грн. Cork Fee – 100грн.',
        'Корегування меню здійснюється максимум за 3 доби. Зміна дати за 5 діб.',
        'Винагорода офіціантів вітається, але завжди залишається на ваш розсуд.'
    ]);
});

test('banquet terms defaults load required numeric values from price_rules', async () => {
    const queries = [];
    const defaults = await loadBanquetTermsDefaults({
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows: standardBanquetTermsPriceRules() };
        }
    });

    assert.equal(queries.length, 1);
    assert.match(queries[0].sql, /FROM price_rules/);
    assert.deepEqual([...queries[0].params[0]].sort(), [
        'banquet_cork_fee',
        'banquet_date_change_deadline_days',
        'banquet_menu_correction_deadline_days',
        'banquet_own_cake_fee'
    ]);
    assert.equal(defaults.items.length, 4);
    assert.deepEqual(defaults.missingCodes, []);
});

test('banquet terms snapshot is captured for new kitchen booking payloads', async () => {
    const booking = {
        programCode: 'KITCHEN',
        category: 'kitchen',
        extraData: {
            bookingWorkspace: { scenario: 'kitchen_only', hasEvent: false },
            bookingPackage: {
                menuPositions: [
                    { id: 'menu-1', title: 'Ковбаски гриль', quantity: 1 }
                ],
                serviceEvents: []
            }
        }
    };
    const result = await snapshotBanquetTermsForBooking({
        async query() {
            return { rows: standardBanquetTermsPriceRules() };
        }
    }, booking);

    assert.equal(result.applied, true);
    assert.equal(bookingNeedsBanquetTermsSnapshot(booking), false);
    assert.equal(Array.isArray(booking.extraData.banquetTerms), true);
    assert.equal(booking.extraData.banquetTerms.length, 4);
    assert.equal(booking.extraData.banquetTerms.some(item => item.includes('500грн') && item.includes('100грн')), true);
    assert.equal(booking.extraData.banquetTermsSnapshot.source, 'price_rules');
    assert.deepEqual([...booking.extraData.banquetTermsSnapshot.priceRuleCodes].sort(), [
        'banquet_cork_fee',
        'banquet_date_change_deadline_days',
        'banquet_menu_correction_deadline_days',
        'banquet_own_cake_fee'
    ]);
});

test('banquet terms snapshot is not overwritten when manual terms already exist', async () => {
    let queried = false;
    const booking = {
        programCode: 'KITCHEN',
        category: 'kitchen',
        extraData: {
            banquetTerms: ['Індивідуальні умови клієнта.'],
            bookingWorkspace: { scenario: 'kitchen_only', hasEvent: false },
            bookingPackage: {
                menuPositions: [
                    { id: 'menu-1', title: 'Ковбаски гриль', quantity: 1 }
                ],
                serviceEvents: []
            }
        }
    };
    const result = await snapshotBanquetTermsForBooking({
        async query() {
            queried = true;
            return { rows: standardBanquetTermsPriceRules({ banquet_own_cake_fee: 999 }) };
        }
    }, booking);

    assert.equal(result.applied, false);
    assert.equal(queried, false);
    assert.deepEqual(booking.extraData.banquetTerms, ['Індивідуальні умови клієнта.']);
});

test('banquet summary prefers captured snapshot over current price-rule defaults', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        banquetTermsDefaults: renderBanquetTermsFromPriceRules(standardBanquetTermsPriceRules({
            banquet_own_cake_fee: 900,
            banquet_cork_fee: 300
        })),
        mainBooking: {
            id: 'BK-TERMS-SNAPSHOT',
            date: '2099-08-01',
            time: '12:00',
            room: 'Marvel',
            program_name: 'Banquet',
            price: 0,
            extra_data: {
                banquetTerms: [
                    'Snapshot cake fee 500грн.',
                    'Snapshot cork fee 100грн.'
                ],
                bookingPackage: {
                    menuPositions: [
                        { id: 'menu-1', title: 'Ковбаски гриль', quantity: 1 }
                    ],
                    serviceEvents: []
                }
            }
        }
    });

    assert.deepEqual(summary.terms.items, [
        'Snapshot cake fee 500грн.',
        'Snapshot cork fee 100грн.'
    ]);
    assert.equal(summary.terms.items.some(item => item.includes('900грн') || item.includes('300грн')), false);
});

test('banquet summary falls back to price-rule terms when booking snapshot terms are missing', () => {
    const defaults = renderBanquetTermsFromPriceRules(standardBanquetTermsPriceRules({
        banquet_own_cake_fee: 650,
        banquet_cork_fee: 120,
        banquet_menu_correction_deadline_days: 4,
        banquet_date_change_deadline_days: 6
    }));
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        banquetTermsDefaults: defaults,
        mainBooking: {
            id: 'BK-TERMS-DEFAULT',
            date: '2099-08-01',
            time: '12:00',
            room: 'Marvel',
            program_name: 'Banquet',
            price: 0,
            extra_data: {
                bookingPackage: {
                    programBasePrice: 0,
                    positionsSubtotal: 0,
                    finalTotal: 0,
                    menuPositions: []
                }
            }
        }
    });

    assert.equal(summary.terms.items.some(item => item.includes('650грн') && item.includes('120грн')), true);
    assert.equal(summary.terms.items.some(item => item.includes('4 доби') && item.includes('6 діб')), true);
    assert.equal(summary.warnings.some(warning => warning.code === 'banquet_terms_price_rule_missing'), false);
    assert.equal(summary.warnings.some(warning => warning.code === 'terms_missing'), false);
});

test('banquet summary warns and avoids fake values when banquet terms price rules are incomplete', () => {
    const defaults = renderBanquetTermsFromPriceRules(standardBanquetTermsPriceRules({
        omit: ['banquet_cork_fee']
    }));
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        banquetTermsDefaults: defaults,
        mainBooking: {
            id: 'BK-TERMS-MISSING',
            date: '2099-08-01',
            time: '12:00',
            room: 'Marvel',
            program_name: 'Banquet',
            price: 0
        }
    });

    assert.deepEqual(defaults.missingCodes, ['banquet_cork_fee']);
    assert.deepEqual(summary.terms.items, []);
    assert.equal(summary.warnings.some(warning => warning.code === 'banquet_terms_price_rule_missing'), true);
    assert.equal(summary.warnings.some(warning => warning.code === 'terms_missing'), true);
});

test('banquet summary keeps kitchen-only customer identity out of order rows', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        generatedBy: { username: 'sergey', name: 'Сергій' },
        customer: {
            id: 48,
            name: 'Живий тест форми',
            phone: '+380501112233'
        },
        mainBooking: {
            id: 'BK-2026-0489',
            business_context: 'event_genix',
            date: '2026-06-19',
            time: '12:45',
            room: 'Марвел',
            label: 'Кухня',
            program_code: 'KITCHEN',
            program_name: 'Живий тест форми',
            category: 'custom',
            duration: 30,
            price: 4780,
            notes: 'тест примітка',
            created_by: 'Sergey',
            created_at: '2026-06-18T13:35:00.000Z',
            status: 'confirmed',
            kids_count: 11,
            banquet_adults: 2,
            banquet_tables: 1,
            extra_data: {
                bookingPackage: {
                    schemaVersion: 2,
                    programBasePrice: 0,
                    positionsSubtotal: 4780,
                    finalTotal: 4780,
                    menuPositions: [
                        { productId: 'meat_platter', title: 'Мʼясне плато', quantity: 1, unitPrice: 1200, subtotal: 1200, servingTime: '18:45' },
                        { productId: 'grill_sausages', title: 'Ковбаски гриль', quantity: 1, unitPrice: 980, subtotal: 980, servingTime: '12:45' },
                        { productId: 'pasta_spinach', title: 'Паста зі шпинатом', quantity: 5, unitPrice: 520, subtotal: 2600, servingTime: '12:45' }
                    ],
                    serviceEvents: []
                },
                bookingWorkspace: {
                    schemaVersion: 2,
                    scenario: 'kitchen_only',
                    hasEvent: false,
                    source: 'booking_workspace_v2'
                }
            }
        }
    });

    assert.equal(summary.customer.name, 'Живий тест форми');
    assert.equal(summary.event.programName, 'Живий тест форми');
    assert.equal(summary.totals.programBasePrice, 0);
    assert.equal(summary.totals.menuSubtotal, 4780);
    assert.equal(summary.totals.orderTotal, 4780);
    assert.equal(summary.orderRows.some(row => row.type === 'program' && row.title === 'Живий тест форми'), false);
    assert.equal(summary.orderRows.some(row => row.title === 'Живий тест форми'), false);
    assert.equal(summary.orderRows[0].type, 'menu');
    assert.deepEqual(summary.orderRows.map(row => row.title), ['Мʼясне плато', 'Ковбаски гриль', 'Паста зі шпинатом']);
    assert.deepEqual(summary.comments, [
        { type: 'kitchen', label: 'Кухня', text: 'тест примітка', bookingId: 'BK-2026-0489' }
    ]);
});

test('banquet summary treats legacy banquet_guests as children fallback without duplicate guests', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: {
            id: 'BK-LEGACY-CHILDREN',
            date: '2099-06-21',
            time: '13:00',
            room: 'Marvel',
            program_name: 'Kitchen-only birthday',
            price: 900,
            banquet_guests: 7,
            banquet_adults: 3,
            banquet_tables: 1,
            extra_data: {
                bookingPackage: {
                    positionsSubtotal: 900,
                    menuPositions: [
                        { productId: 'pizza', title: 'Pizza', quantity: 3, unitPrice: 300, subtotal: 900 }
                    ]
                }
            }
        }
    });

    assert.equal(summary.counts.children, 7);
    assert.equal(summary.counts.adults, 3);
    assert.equal(summary.counts.guests, null);
    assert.equal(summary.counts.tables, 1);
});

test('banquet summary resolves group primary, kitchen menu, and root activity rows without linked children', () => {
    const primary = {
        id: 'BK-GROUP-PRIMARY',
        business_context: 'event_genix',
        date: '2099-07-01',
        time: '13:00',
        room: 'Marvel',
        program_name: 'Birthday room',
        price: 2500,
        kids_count: 9,
        group_name: 'Group birthday',
        extra_data: {
            banquetDeposit: { amount: 500 }
        }
    };
    const kitchen = {
        id: 'BK-GROUP-KITCHEN',
        business_context: 'event_genix',
        date: '2099-07-01',
        time: '13:00',
        room: 'Kitchen',
        label: 'Kitchen order',
        price: 1200,
        banquet_adults: 5,
        banquet_guests: 14,
        banquet_tables: 3,
        extra_data: {
            bookingPackage: {
                positionsSubtotal: 1200,
                menuPositions: [
                    { productId: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 300, subtotal: 600 },
                    { productId: 'juice', title: 'Juice', quantity: 3, unitPrice: 200, subtotal: 600 }
                ]
            }
        }
    };
    const activity = {
        id: 'BK-GROUP-ACTIVITY',
        business_context: 'event_genix',
        date: '2099-07-01',
        time: '14:30',
        room: 'Marvel',
        program_name: 'Face painting',
        price: 700
    };
    const linkedChild = {
        id: 'BK-GROUP-ACTIVITY-CHILD',
        business_context: 'event_genix',
        linked_to: 'BK-GROUP-ACTIVITY',
        program_name: 'Second host',
        price: 0
    };

    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: activity,
        resolvedGroup: {
            source: 'banquet_group',
            groupId: 'BQ-GROUP',
            group: {
                id: 'BQ-GROUP',
                primaryBookingId: primary.id,
                groupName: 'Group birthday',
                status: 'active'
            },
            members: [
                { bookingId: primary.id, role: 'primary', isPrimary: true, booking: primary, technicalChildren: [] },
                { bookingId: kitchen.id, role: 'kitchen', isKitchenCandidate: true, booking: kitchen, technicalChildren: [] },
                { bookingId: activity.id, role: 'activity', booking: activity, technicalChildren: [linkedChild] }
            ],
            warnings: [{ code: 'group_notice', message: 'Group warning' }]
        }
    });

    assert.equal(summary.bookingId, primary.id);
    assert.equal(summary.group.id, 'BQ-GROUP');
    assert.equal(summary.counts.children, 9);
    assert.equal(summary.counts.adults, 5);
    assert.equal(summary.counts.guests, null);
    assert.equal(summary.counts.tables, 3);
    assert.equal(summary.orderRows.some(row => row.type === 'menu' && row.title === 'Pizza'), true);
    assert.equal(summary.orderRows.some(row => row.type === 'activity' && row.bookingId === activity.id), true);
    assert.equal(summary.orderRows.some(row => row.bookingId === linkedChild.id), false);
    assert.equal(summary.totals.programBasePrice, 2500);
    assert.equal(summary.totals.menuSubtotal, 1200);
    assert.equal(summary.totals.activitySubtotal, 700);
    assert.equal(summary.totals.orderTotal, 4400);
    assert.ok(summary.warnings.some(warning => warning.code === 'group_notice'));
});

test('banquet summary uses legacy banquetMenu only when structured menu positions are missing', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: {
            id: 'BK-LEGACY',
            program_name: 'Свято',
            price: 1500,
            banquet_menu: 'Торт\nЧай',
            paid_amount: 0,
            extra_data: {
                bookingPackage: {
                    menuPositions: []
                }
            }
        }
    });

    const menuRows = summary.orderRows.filter(row => row.type === 'menu');
    assert.equal(menuRows.length, 2);
    assert.equal(menuRows[0].source, 'legacy_banquet_menu');
    assert.ok(summary.warnings.some(warning => warning.code === 'legacy_banquet_menu_used'));
});

test('banquet summary warns for neutral venue and missing deposit data', () => {
    const summary = buildBanquetSummary({
        businessContext: 'maysternya_doli',
        mainBooking: {
            id: 'BK-MD',
            business_context: 'maysternya_doli',
            program_name: 'Консультація',
            price: 1200
        }
    });

    assert.equal(summary.businessContext, 'maysternya_doli');
    assert.ok(summary.venue.name);
    assert.ok(summary.warnings.some(warning => warning.code === 'venue_neutral_fallback'));
    assert.ok(summary.warnings.some(warning => warning.code === 'deposit_not_specified'));
    assert.ok(summary.warnings.some(warning => warning.code === 'menu_rows_missing'));
});

test('banquet summary does not treat paid_amount as deposit without explicit marker', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: {
            id: 'BK-PAID',
            program_name: 'Р‘Р°РЅРєРµС‚',
            price: 5000,
            paid_amount: 1200,
            payment_method: 'cash',
            payment_status: 'partial'
        }
    });

    assert.equal(summary.deposit.amount, null);
    assert.equal(summary.deposit.paymentMethod, null);
    assert.equal(summary.deposit.paymentStatus, null);
    assert.ok(summary.warnings.some(warning => warning.code === 'deposit_not_specified'));
    assert.ok(summary.warnings.some(warning => warning.code === 'paid_amount_not_used_as_deposit'));
});
