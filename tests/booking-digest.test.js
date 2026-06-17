const test = require('node:test');
const assert = require('node:assert/strict');

const {
    BANQUET_SUMMARY_SCHEMA_VERSION,
    buildBanquetSummary
} = require('../services/banquetSummary');

test('banquet summary builds structured KeyCRM-like contract from booking package and linked activities', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        generatedBy: { username: 'manager', name: 'Manager Name' },
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
