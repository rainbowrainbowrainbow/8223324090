const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildBanquetSummary } = require('../services/banquetSummary');
const { renderBanquetTermsFromPriceRules } = require('../services/banquetTerms');
const {
    buildBanquetSummaryPdfBuffer,
    buildBanquetSummaryPdfView
} = require('../services/banquetSummaryPdf');

function standardTerms() {
    return renderBanquetTermsFromPriceRules([
        { code: 'banquet_own_cake_fee', value: 500 },
        { code: 'banquet_cork_fee', value: 100 },
        { code: 'banquet_menu_correction_deadline_days', value: 3 },
        { code: 'banquet_date_change_deadline_days', value: 5 }
    ]);
}

function qualitySummary() {
    return buildBanquetSummary({
        businessContext: 'event_genix',
        generatedBy: { username: 'manager', name: 'Олена менеджер' },
        banquetTermsDefaults: standardTerms(),
        customer: {
            id: 101,
            name: 'ШуткаМинутка',
            phone: '+380535232',
            child_name: 'Жартик'
        },
        mainBooking: {
            id: 'BK-PDF-QUALITY',
            business_context: 'event_genix',
            date: '2026-06-23',
            time: '13:45',
            room: 'Рок',
            program_name: 'Паперове неон-шоу',
            program_id: 'paper_neon_show',
            program_code: 'PAPER_NEON',
            category: 'activity',
            duration: 60,
            price: 2600,
            kids_count: 2,
            created_by: 'manager',
            created_at: '2026-06-22T10:15:00.000Z',
            extra_data: {
                bookingWorkspace: {
                    comments: {
                        activity: 'Хоче більше жартів 2',
                        internal: 'Передзвонити перед святом'
                    }
                },
                bookingPackage: {
                    programBasePrice: 1500,
                    entrySubtotal: 600,
                    positionsSubtotal: 500,
                    finalTotal: 2600,
                    entryCharge: {
                        title: 'Вхід',
                        quantity: 2,
                        unitPrice: 300,
                        subtotal: 600,
                        ruleCode: 'banquet_entry_weekday_child',
                        dateType: 'weekday',
                        source: 'banquet_entry_price_rules'
                    },
                    menuPositions: [
                        {
                            productId: 'pizza',
                            title: 'Піца',
                            quantity: 2,
                            servingUnit: 'порція',
                            unitPrice: 250,
                            subtotal: 500,
                            note: 'Без цибулі',
                            servingTime: '15:15'
                        }
                    ],
                    serviceEvents: [
                        { type: 'cake', title: 'Винос торта', time: '15:00' }
                    ]
                },
                banquetDeposit: {
                    amount: 1000,
                    paymentMethod: 'cash',
                    paymentStatus: 'paid'
                }
            }
        }
    });
}

test('banquet PDF client view keeps header, comments, program duration, finance, terms, and schedule clean', () => {
    const summary = qualitySummary();
    const clientView = buildBanquetSummaryPdfView(summary, 'client');
    const programRow = clientView.rows.find(row => row.type === 'program');
    const programTableRow = clientView.orderTableRows.find(row => String(row[0]).includes('Паперове неон-шоу'));
    const entryTableRow = clientView.orderTableRows.find(row => row[0] === 'Вхід');
    const menuTableRow = clientView.orderTableRows.find(row => String(row[0]).includes('Піца'));
    const financeLabels = clientView.financeRows.map(row => row.label);
    const termsText = summary.terms.items.join('\n');

    assert.equal(summary.document.generatedAt, undefined);
    assert.equal(clientView.mode, 'client');
    assert.equal(clientView.modeLabel, 'Для клієнта');
    assert.equal(summary.bookingId, 'BK-PDF-QUALITY');
    assert.equal(summary.event.createdAt, '2026-06-22T10:15:00.000Z');

    assert.equal(programRow.comment, 'Хоче більше жартів 2');
    assert.equal(summary.comments.some(comment => comment.text === 'Хоче більше жартів 2'), false);
    assert.equal(clientView.comments.length, 0);
    assert.equal(summary.comments.some(comment => comment.text === 'Передзвонити перед святом'), true);

    assert.deepEqual(clientView.orderTableColumns.map(column => column.label), ['Позиція', 'К-сть', 'Ціна', 'Сума']);
    assert.ok(programTableRow, 'program row is rendered in PDF table view');
    assert.match(programTableRow[0], /Тривалість: 60 хв/);
    assert.match(programTableRow[0], /Примітка: Хоче більше жартів 2/);
    assert.equal(programTableRow[1], '—');
    assert.match(programTableRow[2], /^1\s*500 грн$/);
    assert.match(programTableRow[3], /^1\s*500 грн$/);
    assert.equal(programTableRow.includes('1 порція'), false);
    assert.deepEqual(entryTableRow, ['Вхід', '2 дітей', '300 грн', '600 грн']);
    assert.equal(menuTableRow[1], '2 порція');
    assert.equal(menuTableRow[2], '250 грн');
    assert.equal(menuTableRow[3], '500 грн');
    assert.equal(clientView.orderTableRows.flat().includes('1 порція'), false);

    assert.deepEqual(financeLabels, ['Загальна сума']);
    assert.equal(clientView.financeRows.find(row => row.key === 'total')?.amount, 2600);
    assert.equal(clientView.financeRows.find(row => row.key === 'amount_due'), undefined);

    assert.match(termsText, /Заборонено приносити їжу та напої\. Свій торт дозволено за 500 грн\. Cork Fee - 100 грн\./);
    assert.doesNotMatch(termsText, /Заборонено приносити їжу\/напої\/торт/);
    assert.doesNotMatch(termsText, /Свій торт - 500грн/);

    assert.deepEqual(clientView.schedule.map(item => `${item.time} ${item.title}`), [
        '13:45 Прихід гостей',
        '13:45 Паперове неон-шоу',
        '15:00 Винос торта',
        '15:15 Видача меню'
    ]);
    assert.deepEqual(
        clientView.schedule.map(item => item.time),
        [...clientView.schedule.map(item => item.time)].sort()
    );
    assert.ok(clientView.orderTableRows.flat().some(cell => String(cell).includes('Паперове неон-шоу')));
});

test('banquet PDF buffer is a clean server PDF without browser print footer artifacts', async () => {
    const summary = qualitySummary();
    const buffer = await buildBanquetSummaryPdfBuffer(summary, { mode: 'client' });
    const raw = buffer.toString('latin1');
    const pdfRendererSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'banquetSummaryPdf.js'), 'utf8');

    assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
    assert.ok(buffer.length > 1000, 'PDF buffer contains rendered content');
    assert.doesNotMatch(pdfRendererSource, /drawFinalBrand/);
    assert.doesNotMatch(pdfRendererSource, /banquet-final-brand/);
    assert.doesNotMatch(raw, /https?:\/\//i);
    assert.doesNotMatch(raw, /localhost|127\.0\.0\.1|about:blank/i);
    assert.doesNotMatch(raw, /\b1\s*\/\s*1\b/);
    assert.doesNotMatch(raw, /Chrome|Microsoft Edge|Firefox/i);
});
