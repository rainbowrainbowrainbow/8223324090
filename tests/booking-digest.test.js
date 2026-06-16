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
                        { productId: 'pizza', title: 'Піца', quantity: 2, unitPrice: 300, subtotal: 600, note: 'без грибів' },
                        { productId: 'juice', title: 'Сік', quantity: 3, unitPrice: 200, subtotal: 600 }
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
    assert.equal(summary.counts.guests, 12);
    assert.equal(summary.counts.tables, 2);
    assert.equal(summary.orderRows.length, 4);
    assert.equal(summary.orderRows[0].type, 'program');
    assert.equal(summary.orderRows[1].type, 'activity');
    assert.equal(summary.orderRows[2].type, 'menu');
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
