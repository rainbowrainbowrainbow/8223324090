const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildBanquetSummary } = require('../services/banquetSummary');
const { renderBanquetTermsFromPriceRules } = require('../services/banquetTerms');
const {
    buildBanquetSummaryPdfBuffer,
    buildBanquetSummaryPdfView,
    validateBanquetSummaryPdf
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

function pdfPageCount(buffer) {
    const matches = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g);
    return matches ? matches.length : 0;
}

function pdfFrozenConstant(source, objectName, key) {
    const body = source.match(new RegExp(`const ${objectName} = Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\);`))?.[1] || '';
    const value = body.match(new RegExp(`\\b${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`))?.[1];
    return value === undefined ? null : Number(value);
}

function loadLayoutFixture(name) {
    const fixturePath = path.join(__dirname, 'fixtures', `booking-summary-layout-${name}.fixture.json`);
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    return {
        name,
        expected: fixture.expected || {},
        summary: fixture.summary || fixture
    };
}

function missingVisibleOrderNotes(summary = {}, view = {}) {
    const metaText = (view.orderTableRows || []).map(row => String(row[0] || '')).join('\n');
    return (Array.isArray(summary.orderRows) ? summary.orderRows : [])
        .filter(row => row && row.comment)
        .filter(row => !metaText.includes(String(row.comment || '').trim()))
        .map(row => row.title || row.name || row.id || 'order row');
}

function paginationSummary() {
    const summary = qualitySummary();
    const longNote = Array.from({ length: 18 }, (_, index) => `long-visible-note-${index + 1}`).join(' ');
    const orderRows = Array.from({ length: 14 }, (_, index) => ({
        id: `pagination-menu-${index + 1}`,
        type: 'menu',
        title: `Pagination menu item ${index + 1}`,
        quantity: 1,
        unitPrice: 120 + index,
        subtotal: 120 + index,
        comment: index === 4 ? longNote : `compact note ${index + 1}`,
        meta: {
            servingTime: `${String(15 + Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`,
            servingUnit: 'portion'
        }
    }));
    const total = orderRows.reduce((sum, row) => sum + row.subtotal, 0);

    summary.bookingId = 'BK-PDF-PAGINATION';
    summary.schedule = Array.from({ length: 10 }, (_, index) => ({
        time: `${String(13 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
        title: `Pagination schedule item ${index + 1}`,
        note: index === 6 ? 'schedule item with an extra note for page budget coverage' : `room checkpoint ${index + 1}`,
        modes: ['client']
    }));
    summary.orderRows = orderRows;
    summary.orderRowViews = summary.orderRowViews || {};
    summary.orderRowViews.client = orderRows.map(row => ({
        id: row.id,
        type: row.type,
        title: row.title,
        quantityLabel: `${row.quantity} portion`,
        unitPriceLabel: `${row.unitPrice} UAH`,
        subtotalLabel: `${row.subtotal} UAH`,
        metaLines: [
            `Serving: ${row.meta.servingTime}`,
            `Note: ${row.comment}`
        ]
    }));
    summary.finance = {
        currency: 'UAH',
        rows: [
            { key: 'total', label: 'Total', amount: total, currency: 'UAH', role: 'total' }
        ]
    };
    summary.totals = {
        ...summary.totals,
        currency: 'UAH',
        orderTotal: total,
        bookingPrice: total
    };
    return summary;
}

test('banquet PDF readability constants keep type floors and compact spacing ceilings', () => {
    const pdfRendererSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'banquetSummaryPdf.js'), 'utf8');

    assert.ok(pdfFrozenConstant(pdfRendererSource, 'PDF_TYPE_SCALE', 'tableBody') >= 8.8, 'table body font floor stays readable');
    assert.ok(pdfFrozenConstant(pdfRendererSource, 'PDF_TYPE_SCALE', 'keyValue') >= 8.8, 'key-value font floor stays readable');
    assert.ok(pdfFrozenConstant(pdfRendererSource, 'PDF_SPACING_LAYOUT', 'tablePadding') <= 2, 'table padding stays compact');
    assert.ok(pdfFrozenConstant(pdfRendererSource, 'PDF_SPACING_LAYOUT', 'sectionAfterY') <= 15, 'section gap stays compact');
});

test('banquet PDF layout fixture matrix keeps expected page counts and visible notes', async () => {
    for (const fixtureName of ['compact', 'realistic', 'long']) {
        const fixture = loadLayoutFixture(fixtureName);
        const view = buildBanquetSummaryPdfView(fixture.summary, 'client');
        const buffer = await buildBanquetSummaryPdfBuffer(fixture.summary, { mode: 'client' });
        const pageCount = pdfPageCount(buffer);
        const missingNotes = missingVisibleOrderNotes(fixture.summary, view);

        assert.equal(pageCount, fixture.expected.serverPdfPages, `${fixtureName} server PDF page count`);
        assert.equal(missingNotes.length, 0, `${fixtureName} keeps order notes visible: ${missingNotes.join(', ')}`);
        assert.ok(view.orderTableRows.length >= fixture.summary.orderRows.length, `${fixtureName} keeps all fixture order rows in client table`);
    }
});

test('banquet PDF client view keeps header, comments, program duration, finance, terms, and schedule clean', () => {
    const summary = qualitySummary();
    const clientView = buildBanquetSummaryPdfView(summary, 'client');
    const programRow = clientView.rows.find(row => row.type === 'program');
    const menuOrderView = summary.orderRowViews.client.find(row => row.type === 'menu');
    const programTableRow = clientView.orderTableRows.find(row => String(row[0]).includes('Паперове неон-шоу'));
    const entryTableRow = clientView.orderTableRows.find(row => row[0] === 'Вхід');
    const menuTableRow = clientView.orderTableRows.find(row => String(row[0]).includes('Піца'));
    const financeLabels = clientView.financeRows.map(row => row.label);
    const termsText = summary.terms.items.join('\n');

    assert.equal(summary.document.generatedAt, undefined);
    assert.equal(clientView.mode, 'client');
    assert.equal(clientView.modeLabel, 'Для клієнта');
    assert.equal(summary.orderRowViews.client.length, 3);
    assert.equal(clientView.orderRowViews, summary.orderRowViews.client);
    assert.equal(summary.bookingId, 'BK-PDF-QUALITY');
    assert.equal(summary.event.createdAt, '2026-06-22T10:15:00.000Z');

    assert.equal(programRow.comment, 'Хоче більше жартів 2');
    assert.equal(summary.comments.some(comment => comment.text === 'Хоче більше жартів 2'), false);
    assert.equal(clientView.comments.length, 0);
    assert.equal(summary.comments.some(comment => comment.text === 'Передзвонити перед святом'), true);

    assert.deepEqual(clientView.orderTableColumns.map(column => column.label), ['Позиція', 'К-сть', 'Ціна', 'Сума']);
    assert.deepEqual(clientView.orderTableColumns.map(column => column.align || 'left'), ['left', 'center', 'right', 'right']);
    assert.deepEqual(menuOrderView.metaLines, ['Видача: 15:15', 'Примітка: Без цибулі']);
    assert.ok(programTableRow, 'program row is rendered in PDF table view');
    assert.deepEqual(programTableRow[0].split('\n'), [
        'Паперове неон-шоу',
        'Тривалість: 60 хв',
        'Примітка: Хоче більше жартів 2'
    ]);
    assert.match(programTableRow[0], /Тривалість: 60 хв/);
    assert.match(programTableRow[0], /Примітка: Хоче більше жартів 2/);
    assert.equal(programTableRow[1], '—');
    assert.match(programTableRow[2], /^1\s*500 ₴$/);
    assert.match(programTableRow[3], /^1\s*500 ₴$/);
    assert.equal(programTableRow.includes('1 порція'), false);
    assert.deepEqual(entryTableRow, ['Вхід', '2 дітей', '300 ₴', '600 ₴']);
    assert.equal(menuTableRow[1], '2 порції');
    assert.equal(menuTableRow[2], '250 ₴');
    assert.equal(menuTableRow[3], '500 ₴');
    assert.match(menuTableRow[0], /Видача: 15:15/);
    assert.match(menuTableRow[0], /Примітка: Без цибулі/);
    assert.ok(menuTableRow[0].includes(menuOrderView.metaLines[0]), 'client order table includes serving meta line');
    assert.ok(menuTableRow[0].includes(menuOrderView.metaLines[1]), 'client order table includes comment meta line');
    assert.deepEqual(menuTableRow[0].split('\n'), ['Піца', 'Видача: 15:15', 'Примітка: Без цибулі']);
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

test('banquet PDF validation and fallback schedule use canonical arrival projection', async () => {
    const summary = qualitySummary();
    summary.arrival = {
        bookingId: summary.bookingId,
        date: '2026-06-24',
        time: '12:30',
        room: 'Sun Hall',
        source: 'banquet_group',
        groupSource: 'manual',
        updatedAt: '2026-06-20T10:00:00.000Z'
    };
    summary.banquetArrival = summary.arrival;
    summary.event = {
        ...summary.event,
        date: null,
        time: null,
        room: null
    };
    delete summary.schedule;

    const validation = validateBanquetSummaryPdf(summary, 'client');
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));

    const clientView = buildBanquetSummaryPdfView(summary, 'client', { validation });
    const arrivalRow = clientView.schedule.find(row => row.title === 'Прихід гостей');
    assert.equal(arrivalRow?.time, '12:30');
    assert.equal(arrivalRow?.note, 'Кімната: Sun Hall');

    const buffer = await buildBanquetSummaryPdfBuffer(summary, { mode: 'client' });
    assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

test('banquet PDF buffer is a clean server PDF without browser print footer artifacts', async () => {
    const summary = qualitySummary();
    const buffer = await buildBanquetSummaryPdfBuffer(summary, { mode: 'client' });
    const raw = buffer.toString('latin1');
    const pdfRendererSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'banquetSummaryPdf.js'), 'utf8');

    assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
    assert.ok(buffer.length > 1000, 'PDF buffer contains rendered content');
    assert.equal(pdfPageCount(buffer), 1, 'typical client PDF remains one page');
    assert.match(pdfRendererSource, /const PDFDocument = require\('pdfkit'\)/);
    assert.match(pdfRendererSource, /const PDF_TYPE_SCALE = Object\.freeze/);
    assert.match(pdfRendererSource, /const PDF_HEADER_LAYOUT = Object\.freeze/);
    assert.match(pdfRendererSource, /const PDF_TABLE_LAYOUT = Object\.freeze/);
    assert.match(pdfRendererSource, /const PDF_SPACING_LAYOUT = Object\.freeze/);
    assert.match(pdfRendererSource, /BANQUET_LOGO_PATH/);
    assert.match(pdfRendererSource, /doc\.image\(BANQUET_LOGO_PATH/);
    assert.doesNotMatch(pdfRendererSource, /drawFinalBrand/);
    assert.doesNotMatch(pdfRendererSource, /banquet-final-brand/);
    assert.doesNotMatch(pdfRendererSource, /displayHeaderFooter/);
    assert.doesNotMatch(pdfRendererSource, /puppeteer/i);
    assert.doesNotMatch(pdfRendererSource, /playwright/i);
    assert.doesNotMatch(raw, /https?:\/\//i);
    assert.doesNotMatch(raw, /localhost|127\.0\.0\.1|about:blank/i);
    assert.doesNotMatch(raw, /\b1\s*\/\s*1\b/);
    assert.doesNotMatch(raw, /Chrome|Microsoft Edge|Firefox/i);
});

test('banquet PDF uses controlled pagination for long client sheets', async () => {
    const summary = paginationSummary();
    const clientView = buildBanquetSummaryPdfView(summary, 'client');
    const buffer = await buildBanquetSummaryPdfBuffer(summary, { mode: 'client' });
    const raw = buffer.toString('latin1');
    const pdfRendererSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'banquetSummaryPdf.js'), 'utf8');

    assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
    assert.equal(clientView.schedule.length, 10, 'fixture has many schedule rows');
    assert.equal(clientView.orderTableRows.length, 14, 'fixture has many order rows');
    assert.ok(clientView.orderTableRows.some(row => String(row[0]).includes('long-visible-note-18')), 'fixture has one long visible order note');
    assert.equal(pdfPageCount(buffer), 2, 'long client PDF becomes a clean two-page document');
    assert.match(raw, /\/MediaBox \[0 0 595\.28 841\.89\]/, 'PDF remains A4');
    assert.match(pdfRendererSource, /function tableStartHeight/);
    assert.match(pdfRendererSource, /ensureSpace\(doc, PDF_SPACING_LAYOUT\.sectionAfterY \+ tableStartHeight/);
    assert.match(pdfRendererSource, /if \(pageAdded && !options\.header\) \{[\s\S]*?drawRow\(headerCells, headerOptions\);/);
    assert.match(pdfRendererSource, /addDecoratedPage\(doc\);[\s\S]*?drawRow\(headerCells, headerOptions\);/);
});
