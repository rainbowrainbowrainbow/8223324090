const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

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

const ROOT = path.resolve(__dirname, '..');

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
            duration: 90,
            lineName: 'Олена',
            second_animator: 'Петро',
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
                        { productId: 'pizza', title: 'Піца', quantity: 2, servingUnit: '100г', unitPrice: 300, subtotal: 600, note: 'без грибів', servingTime: '16:30', servingBatchId: 'serve-1630' },
                        { productId: 'juice', title: 'Сік', quantity: 3, unitPrice: 200, subtotal: 600 }
                    ],
                    serviceEvents: [
                        { type: 'cake', title: 'Винос торта', time: '17:10' }
                    ]
                },
                bookingWorkspace: {
                    responsiblePeople: {
                        kitchenResponsible: 'Ірина',
                        waiterResponsible: 'Денис',
                        roomResponsible: 'Марія'
                    }
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
            category: 'activity',
            lineName: 'Максим',
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
    assert.equal(summary.event.hasRealProgram, true);
    assert.equal(summary.event.programDisplayName, 'День народження');
    assert.equal(summary.counts.children, 8);
    assert.equal(summary.counts.adults, 4);
    assert.equal(summary.counts.guests, null);
    assert.equal(summary.counts.tables, 2);
    assert.equal(summary.orderRows.length, 5);
    assert.equal(summary.orderRows[0].type, 'program');
    assert.equal(summary.orderRows[0].durationMinutes, 90);
    assert.equal(summary.orderRows[0].quantity, null);
    assert.equal(summary.orderRows[1].type, 'activity');
    assert.equal(summary.orderRows[1].durationMinutes, 30);
    assert.equal(summary.orderRows[1].quantity, null);
    assert.equal(summary.orderRows[2].type, 'menu');
    assert.equal(summary.orderRows[2].meta.servingTime, '16:30');
    assert.equal(summary.orderRows[2].meta.servingUnit, '100г');
    assert.equal(summary.orderRows[4].type, 'service_event');
    assert.equal(summary.orderRows[4].meta.time, '17:10');
    assert.equal(summary.serviceEvents.length, 1);
    assert.equal(summary.serviceEvents[0].title, 'Винос торта');
    assert.equal(summary.serviceEvents[0].meta.time, '17:10');
    assert.deepEqual(summary.schedule.map(item => `${item.time} ${item.title}`), [
        '14:00 Прихід гостей',
        '14:00 День народження',
        '15:00 Аквагрим',
        '16:30 Видача меню',
        '16:30 Видача: Піца',
        '17:10 Винос торта'
    ]);
    assert.equal(summary.schedule.filter(item => item.time === '14:00').length, 2);
    assert.deepEqual(summary.schedule.find(item => item.title === 'Видача меню')?.modes, ['client']);
    assert.deepEqual(summary.schedule.find(item => item.title === 'Видача: Піца')?.modes, ['kitchen', 'staff']);
    assert.deepEqual(summary.responsible.rows.map(row => `${row.label}:${row.name || '—'}`), [
        'Менеджер:manager',
        'Аніматор:Олена',
        'Другий аніматор:Петро',
        'Аніматор активності:Максим',
        'Кухня:Ірина',
        'Офіціант:Денис',
        'Кімната:Марія'
    ]);
    assert.deepEqual(summary.responsible.rows.find(row => row.label === 'Менеджер')?.modes, ['client', 'kitchen', 'staff']);
    assert.deepEqual(summary.responsible.rows.find(row => row.label === 'Аніматор')?.modes, ['staff']);
    assert.equal(summary.totals.programBasePrice, 2500);
    assert.equal(summary.totals.menuSubtotal, 1200);
    assert.equal(summary.totals.orderTotal, 4400);
    assert.equal(summary.totals.bookingPrice, 3700);
    assert.equal(summary.totals.currency, 'UAH');
    assert.equal(summary.deposit.amount, 1000);
    assert.equal(summary.deposit.paymentMethod, 'cash');
    assert.equal(summary.deposit.paymentStatus, 'partial');
    assert.equal(summary.deposit.source, 'extra_data.banquetDeposit');
    assert.deepEqual(summary.finance.rows.map(row => row.label), [
        'Програма',
        'Меню',
        'Додаткові активності',
        'Бронювання',
        'Разом',
        'Завдаток',
        'До сплати'
    ]);
    assert.equal(summary.finance.rows.find(row => row.key === 'deposit')?.amount, 1000);
    assert.equal(summary.finance.rows.find(row => row.key === 'amount_due')?.amount, 3400);
    assert.deepEqual(summary.terms.items, ['Завдаток не повертається']);
    assert.equal(summary.warnings.some(warning => warning.code === 'deposit_not_specified'), false);
    assert.equal(summary.warnings.some(warning => warning.code === 'serving_time_missing'), true);
});

test('banquet summary builds compact finance rows without duplicate booking or zero subtotals', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: {
            id: 'BK-FINANCE-COMPACT',
            business_context: 'event_genix',
            date: '2026-06-23',
            time: '14:00',
            room: 'Рок',
            program_name: 'Анімація 60хв',
            program_id: 'animation_60',
            category: 'activity',
            duration: 60,
            price: 1500
        }
    });

    assert.deepEqual(summary.finance.rows.map(row => row.label), ['Програма', 'Разом', 'До сплати']);
    assert.equal(summary.finance.rows.find(row => row.key === 'program')?.amount, 1500);
    assert.equal(summary.finance.rows.find(row => row.key === 'total')?.amount, 1500);
    assert.equal(summary.finance.rows.find(row => row.key === 'amount_due')?.amount, 1500);
    assert.equal(summary.finance.rows.some(row => row.key === 'booking'), false);
    assert.equal(summary.finance.rows.some(row => row.key === 'entry'), false);
    assert.equal(summary.finance.rows.some(row => row.key === 'menu'), false);
    assert.equal(summary.finance.rows.some(row => row.key === 'activities'), false);
    assert.equal(summary.finance.rows.some(row => row.key === 'deposit'), false);
    assert.ok(summary.warnings.some(warning => warning.code === 'deposit_not_specified'));
});

test('banquet summary adds staff warning for schedule items without time', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: {
            id: 'BK-SCHEDULE-MISSING-TIME',
            business_context: 'event_genix',
            date: '2026-06-23',
            time: '13:45',
            room: 'Растішка',
            program_name: 'Паперове шоу',
            program_id: 'paper_show',
            category: 'activity',
            duration: 60,
            price: 1500,
            extra_data: {
                bookingPackage: {
                    serviceEvents: [
                        { type: 'room_setup', title: 'Підготовка кімнати' }
                    ]
                }
            }
        }
    });

    assert.equal(summary.schedule.some(item => item.title === 'Підготовка кімнати'), false);
    assert.ok(summary.warnings.some(warning => (
        warning.code === 'schedule_time_missing'
        && warning.staffOnly === true
        && /Підготовка кімнати/.test(warning.message)
    )));
});

test('banquet summary renders package entry charge as a separate order row and total', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: {
            id: 'BK-ENTRY-SUMMARY',
            business_context: 'event_genix',
            date: '2026-06-23',
            time: '12:30',
            room: 'Рок',
            program_name: 'Паперове неон-шоу',
            category: 'activity',
            price: 7700,
            kids_count: 12,
            extra_data: {
                bookingPackage: {
                    programBasePrice: 2900,
                    positionsSubtotal: 1200,
                    entryCharge: {
                        title: 'Вхід',
                        quantity: 12,
                        unitPrice: 300,
                        subtotal: 3600,
                        ruleCode: 'banquet_entry_weekday_child',
                        dateType: 'weekday',
                        source: 'banquet_entry_price_rules'
                    },
                    entrySubtotal: 3600,
                    finalTotal: 7700,
                    menuPositions: [
                        { id: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 600, subtotal: 1200 }
                    ],
                    warnings: [
                        { code: 'entry_test_warning', message: 'Entry warning is visible.' }
                    ]
                }
            }
        }
    });

    const entryRow = summary.orderRows.find(row => row.type === 'entry');
    assert.ok(entryRow, 'entry charge should be rendered as a separate row');
    assert.equal(entryRow.title, 'Вхід');
    assert.equal(entryRow.quantity, 12);
    assert.equal(entryRow.subtotal, 3600);
    assert.equal(summary.totals.entrySubtotal, 3600);
    assert.equal(summary.totals.menuSubtotal, 1200);
    assert.equal(summary.totals.orderTotal, 7700);
    assert.equal(summary.warnings.some(warning => warning.code === 'entry_test_warning'), true);
});

test('banquet summary renders safe entry fallback when charge details are missing', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        mainBooking: {
            id: 'BK-ENTRY-FALLBACK',
            business_context: 'event_genix',
            date: '2026-06-28',
            time: '13:00',
            room: 'Рок',
            program_name: 'Банкет',
            price: 4800,
            extra_data: {
                bookingPackage: {
                    programBasePrice: 0,
                    positionsSubtotal: 1200,
                    entrySubtotal: 3600,
                    finalTotal: 4800,
                    menuPositions: [
                        { id: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 600, subtotal: 1200 }
                    ]
                }
            }
        }
    });

    const entryRow = summary.orderRows.find(row => row.type === 'entry');
    assert.ok(entryRow, 'entry subtotal fallback should still render an entry row');
    assert.equal(entryRow.source, 'booking_package_entry_subtotal_fallback');
    assert.equal(entryRow.quantity, null);
    assert.equal(entryRow.unitPrice, null);
    assert.equal(entryRow.subtotal, 3600);
    assert.equal(summary.orderRows.filter(row => row.type === 'entry').length, 1);
    assert.equal(summary.totals.entrySubtotal, 3600);
    assert.equal(summary.totals.menuSubtotal, 1200);
    assert.equal(summary.warnings.some(warning => warning.code === 'entry_charge_snapshot_missing'), true);
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
        { type: 'internal', label: 'Внутрішній коментар', text: 'Передзвонити клієнту перед друком листа', bookingId: 'BK-COMMENTS-PRIMARY' }
    ]);
    assert.equal(summary.orderRows.find(row => row.type === 'menu')?.comment, 'Підготувати дитячий стіл');
    assert.equal(summary.orderRows.find(row => row.type === 'activity')?.comment, 'Попросити майстра прийти на 10 хв раніше');
    assert.equal(summary.orderRows.some(row => row.type === 'menu' && row.title === 'Pizza'), true);
    assert.equal(summary.totals.orderTotal, 4100);
});

test('banquet sheet renderer and copy text use clear menu quantity wording', async () => {
    const pageCode = fs.readFileSync(path.join(ROOT, 'js', 'booking-summary-page.js'), 'utf8');
    const dom = new JSDOM(`<!doctype html><html><body>
        <a id="bookingSummaryBack"></a>
        <button id="bookingSummaryCopy" type="button"></button>
        <button id="bookingSummaryPrint" type="button"></button>
        <div id="bookingSummaryState"></div>
        <div id="bookingSummaryWarnings"></div>
        <div id="bookingSummaryPrintRoot">
            <article id="bookingSummaryDocument"></article>
        </div>
        <div id="bookingSummaryToast"></div>
    </body></html>`, {
        url: 'http://localhost:3000/booking-summary.html?id=BK-QTY&businessContext=event_genix',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const summary = {
        success: true,
        bookingId: 'BK-QTY',
        venue: { name: 'Банкетний лист' },
        document: { title: 'БАНКЕТНИЙ ЛИСТ' },
        event: {
            date: '2026-06-23',
            time: '12:30',
            room: 'Майнкрафт',
            programName: 'Юрій',
            hasRealProgram: false,
            createdAt: '2026-06-20T10:00:00.000Z',
            manager: 'Manager'
        },
        customer: { name: 'Банкети Юрія', phone: '+380501112233' },
        celebrant: { name: 'Сергій', birthday: 'Sat Oct 12 2018 00:00:00 GMT+0300' },
        counts: { children: 12, adults: 2 },
        orderRows: [
            {
                type: 'program',
                title: 'Анімація 60хв',
                durationMinutes: 60,
                quantity: null,
                unitPrice: 2900,
                subtotal: 2900,
                comment: 'Хоче більше жартів'
            },
            {
                type: 'menu',
                title: 'Нутелла',
                quantity: 5,
                unitPrice: 90,
                subtotal: 450,
                meta: { servingUnit: '100г', servingTime: '14:30' }
            },
            {
                type: 'menu',
                title: 'Бургер',
                quantity: 3,
                unitPrice: 260,
                subtotal: 780,
                meta: { servingUnit: 'порція', servingTime: '16:30' }
            },
            {
                type: 'menu',
                title: 'Свічка',
                quantity: 1,
                unitPrice: 30,
                subtotal: 30,
                meta: { servingUnit: 'порція', servingTime: '16:35' }
            },
            {
                type: 'menu',
                title: 'Лимонад',
                quantity: 2.5,
                unitPrice: 95,
                subtotal: 237.5,
                meta: { servingUnit: 'л', servingTime: '16:40' }
            },
            {
                type: 'entry',
                title: 'Вхід',
                quantity: 12,
                unitPrice: 300,
                subtotal: 3600,
                meta: {
                    ruleCode: 'banquet_entry_weekday_child',
                    dateType: 'weekday'
                }
            }
        ],
        serviceEvents: [],
        responsible: {
            rows: [
                { role: 'manager', label: 'Менеджер', name: 'Manager', modes: ['client', 'kitchen', 'staff'], showWhenEmpty: true },
                { role: 'animator', label: 'Аніматор', name: 'Олена', modes: ['staff'], showWhenEmpty: true },
                { role: 'kitchen', label: 'Кухня', name: null, modes: ['kitchen', 'staff'], showWhenEmpty: true }
            ]
        },
        comments: [],
        totals: {
            currency: 'UAH',
            orderTotal: 5097.5,
            bookingPrice: 5097.5,
            programBasePrice: 0,
            menuSubtotal: 1497.5,
            entrySubtotal: 3600,
            activitySubtotal: 0
        },
        deposit: { amount: null, paymentMethod: null },
        terms: { items: [] },
        warnings: []
    };
    let copiedText = '';
    window.localStorage.setItem('pzp_token', 'test-token');
    window.fetch = async () => ({
        ok: true,
        json: async () => summary
    });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(window.navigator, 'clipboard', {
        value: {
            writeText: async text => {
                copiedText = text;
            }
        },
        configurable: true
    });
    vm.runInContext(pageCode, dom.getInternalVMContext(), { filename: 'js/booking-summary-page.js' });

    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const tableText = window.document.getElementById('bookingSummaryDocument').textContent;
    assert.match(tableText, /Дата банкету/);
    assert.match(tableText, /Прихід гостей/);
    assert.match(tableText, /Бронь створено/);
    assert.doesNotMatch(tableText, /Сформовано/);
    assert.doesNotMatch(tableText, /Оформлено/);
    assert.match(tableText, /Діти/);
    assert.match(tableText, /12/);
    assert.match(tableText, /Дата народження/);
    assert.match(tableText, /12\.10\.2018/);
    assert.doesNotMatch(tableText, /Sat Oct 12/);
    assert.doesNotMatch(tableText, /Учасники/);
    assert.doesNotMatch(tableText, /Програма:\s*Юрій/);
    assert.doesNotMatch(tableText, /Дата\/час/);
    assert.match(tableText, /Відповідальні/);
    assert.match(tableText, /Менеджер\s*Manager/);
    assert.doesNotMatch(tableText, /Кухня\s*—/);
    assert.doesNotMatch(tableText, /Аніматор\s*Олена/);
    assert.match(tableText, /Розклад/);
    assert.match(tableText, /12:30\s*Прихід гостей/);
    assert.match(tableText, /12:30\s*Анімація 60хв/);
    assert.match(tableText, /14:30\s*Видача меню/);
    assert.match(tableText, /12:30/);
    assert.match(tableText, /Тривалість/);
    assert.match(tableText, /Анімація 60хв/);
    assert.match(tableText, /60 хв/);
    assert.match(tableText, /5 порцій по 100 г/);
    assert.match(tableText, /3 порції/);
    assert.match(tableText, /1 порція/);
    assert.match(tableText, /2,5 л/);
    assert.match(tableText, /Вхід/);
    assert.match(tableText, /12 дітей/);
    assert.match(tableText, /300 ₴ = 3\s*600 ₴/);
    assert.match(tableText, /Фінанси/);
    assert.match(tableText, /До сплати/);
    assert.doesNotMatch(tableText, /Сума бронювання/);
    assert.doesNotMatch(tableText, /Бронювання/);
    assert.doesNotMatch(tableText, /Завдаток/);
    assert.doesNotMatch(tableText, /5 100г|5 100 г|5 100г x 90/);

    window.document.getElementById('bookingSummaryCopy').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.match(copiedText, /Дата банкету: 23\.06\.2026/);
    assert.match(copiedText, /Прихід гостей: 12:30/);
    assert.match(copiedText, /Бронь створено:/);
    assert.doesNotMatch(copiedText, /Сформовано/);
    assert.doesNotMatch(copiedText, /Дата оформлення/);
    assert.doesNotMatch(copiedText, /Оформлено/);
    assert.match(copiedText, /Дата народження: 12\.10\.2018/);
    assert.match(copiedText, /Дітей: 12/);
    assert.doesNotMatch(copiedText, /Sat Oct 12/);
    assert.doesNotMatch(copiedText, /Програма: Юрій/);
    assert.doesNotMatch(copiedText, /Дата\/час/);
    assert.match(copiedText, /Відповідальні:\nМенеджер: Manager/);
    assert.doesNotMatch(copiedText, /Кухня: —/);
    assert.doesNotMatch(copiedText, /Аніматор: Олена/);
    assert.match(copiedText, /Розклад:\n12:30 — Прихід гостей/);
    assert.match(copiedText, /12:30 — Анімація 60хв/);
    assert.match(copiedText, /14:30 — Видача меню/);
    assert.match(copiedText, /Анімація 60хв — 60 хв — 2\s*900 ₴ \(Хоче більше жартів\)/);
    assert.doesNotMatch(copiedText, /Анімація 60хв.*1 порц/);
    assert.match(copiedText, /Нутелла — 14:30 — 5 порцій по 100 г × 90 ₴ = 450 ₴/);
    assert.match(copiedText, /Бургер — 16:30 — 3 порції × 260 ₴ = 780 ₴/);
    assert.match(copiedText, /Свічка — 16:35 — 1 порція × 30 ₴ = 30 ₴/);
    assert.match(copiedText, /Лимонад — 16:40 — 2,5 л × 95 ₴ = 237,5 ₴/);
    assert.match(copiedText, /Вхід — 12 дітей × 300 ₴ = 3\s*600 ₴/);
    assert.match(copiedText, /Вхід: 3\s*600 ₴/);
    assert.match(copiedText, /Фінанси:/);
    assert.match(copiedText, /До сплати: 5\s*097,5 ₴/);
    assert.doesNotMatch(copiedText, /Сума бронювання/);
    assert.doesNotMatch(copiedText, /Завдаток:/);
    assert.doesNotMatch(copiedText, /5 100г|5 100 г|5 100г x 90/);
});

test('banquet terms renderer builds standard terms from price rules', () => {
    const rendered = renderBanquetTermsFromPriceRules(standardBanquetTermsPriceRules());

    assert.equal(rendered.title, 'Умови банкету');
    assert.deepEqual(rendered.missingCodes, []);
    assert.deepEqual(rendered.items, [
        'Заборонено приносити їжу та напої. Свій торт дозволено за 500 грн. Cork Fee - 100 грн.',
        'Корегування меню здійснюється максимум за 3 доби. Зміна дати за 5 діб.',
        'Винагорода офіціантів вітається, але завжди залишається на ваш розсуд.'
    ]);
    assert.equal(rendered.items.some(item => item.includes('їжу/напої/торт')), false);
    assert.equal(rendered.items.some(item => item.includes('Свій торт -')), false);
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
    assert.equal(defaults.items.length, 3);
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
    assert.equal(booking.extraData.banquetTerms.length, 3);
    assert.equal(booking.extraData.banquetTerms.some(item => item.includes('500 грн') && item.includes('100 грн')), true);
    assert.equal(booking.extraData.banquetTerms.some(item => item.includes('їжу/напої/торт')), false);
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

test('banquet summary refreshes auto price-rule snapshot terms from current price rules', () => {
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
                banquetTermsSnapshot: {
                    source: 'price_rules',
                    priceRuleCodes: [
                        'banquet_own_cake_fee',
                        'banquet_cork_fee',
                        'banquet_menu_correction_deadline_days',
                        'banquet_date_change_deadline_days'
                    ],
                    capturedAt: '2099-07-01T09:00:00.000Z'
                },
                bookingPackage: {
                    menuPositions: [
                        { id: 'menu-1', title: 'Ковбаски гриль', quantity: 1 }
                    ],
                    serviceEvents: []
                }
            }
        }
    });

    assert.equal(summary.terms.items.some(item => item.includes('900 грн') && item.includes('300 грн')), true);
    assert.equal(summary.terms.items.some(item => item.includes('Snapshot cake fee 500грн.')), false);
    assert.equal(summary.terms.source, 'price_rules');
    assert.equal(summary.terms.snapshotSource, 'price_rules');
});

test('banquet summary preserves manual custom terms over current price-rule defaults', () => {
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        banquetTermsDefaults: renderBanquetTermsFromPriceRules(standardBanquetTermsPriceRules({
            banquet_own_cake_fee: 900,
            banquet_cork_fee: 300
        })),
        mainBooking: {
            id: 'BK-TERMS-MANUAL',
            date: '2099-08-01',
            time: '12:00',
            room: 'Marvel',
            program_name: 'Banquet',
            price: 0,
            extra_data: {
                banquetTerms: [
                    'Manual custom terms stay locked.'
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

    assert.deepEqual(summary.terms.items, ['Manual custom terms stay locked.']);
    assert.equal(summary.terms.items.some(item => item.includes('900 грн') || item.includes('300 грн')), false);
    assert.equal(summary.terms.source, 'manual');
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

    assert.equal(summary.terms.items.some(item => item.includes('650 грн') && item.includes('120 грн')), true);
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

test('banquet summary falls back to stored price-rule snapshot when current terms rules are incomplete', () => {
    const defaults = renderBanquetTermsFromPriceRules(standardBanquetTermsPriceRules({
        omit: ['banquet_cork_fee']
    }));
    const summary = buildBanquetSummary({
        businessContext: 'event_genix',
        banquetTermsDefaults: defaults,
        mainBooking: {
            id: 'BK-TERMS-SNAPSHOT-FALLBACK',
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
                banquetTermsSnapshot: {
                    source: 'price_rules',
                    priceRuleCodes: [
                        'banquet_own_cake_fee',
                        'banquet_cork_fee',
                        'banquet_menu_correction_deadline_days',
                        'banquet_date_change_deadline_days'
                    ],
                    capturedAt: '2099-07-01T09:00:00.000Z'
                }
            }
        }
    });

    assert.deepEqual(summary.terms.items, [
        'Snapshot cake fee 500грн.',
        'Snapshot cork fee 100грн.'
    ]);
    assert.equal(summary.terms.source, 'snapshot_fallback');
    assert.equal(summary.terms.snapshotSource, 'price_rules');
    assert.deepEqual(summary.terms.missingCodes, ['banquet_cork_fee']);
    assert.equal(summary.warnings.some(warning => warning.code === 'banquet_terms_price_rule_missing'), true);
    assert.equal(summary.warnings.some(warning => warning.code === 'banquet_terms_snapshot_fallback'), true);
    assert.equal(summary.warnings.some(warning => warning.code === 'terms_missing'), false);
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
    assert.equal(summary.event.hasRealProgram, false);
    assert.equal(summary.event.programDisplayName, null);
    assert.equal(summary.totals.programBasePrice, 0);
    assert.equal(summary.totals.menuSubtotal, 4780);
    assert.equal(summary.totals.orderTotal, 4780);
    assert.equal(summary.orderRows.some(row => row.type === 'program' && row.title === 'Живий тест форми'), false);
    assert.equal(summary.orderRows.some(row => row.title === 'Живий тест форми'), false);
    assert.equal(summary.orderRows[0].type, 'menu');
    assert.deepEqual(summary.orderRows.map(row => row.title), ['Мʼясне плато', 'Ковбаски гриль', 'Паста зі шпинатом']);
    assert.equal(summary.orderRows[0].comment, 'тест примітка');
    assert.deepEqual(summary.comments, []);
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
