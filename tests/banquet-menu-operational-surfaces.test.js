'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { buildBanquetSummary } = require('../services/banquetSummary');
const { buildBanquetSummaryPdfView } = require('../services/banquetSummaryPdf');

function bookingWithActualWorkflow(overrides = {}) {
    return {
        id: overrides.id || 6201,
        business_context: 'event_genix',
        date: '2026-08-15',
        time: '18:00',
        duration: 180,
        room: 'Зал 1',
        status: 'confirmed',
        created_by: 'olena',
        price: overrides.price ?? 2500,
        extra_data: {
            bookingPackage: {
                schemaVersion: 3,
                menuPositions: [{
                    id: 'm1',
                    title: 'Піца',
                    quantity: 1,
                    unitPrice: 1900,
                    subtotal: 1900,
                    servingTime: '18:30',
                    kitchenType: 'kitchen'
                }],
                positionsSubtotal: 1900,
                menuChargedSubtotal: overrides.menuChargedSubtotal ?? 2500,
                finalTotal: overrides.finalTotal ?? 2500,
                menuMinimumAdjustment: {
                    code: 'menu_minimum_adjustment',
                    title: 'Донарахування до мінімуму меню',
                    amount: 600,
                    financeOnly: true,
                    productionList: false
                },
                menuWorkflow: {
                    mode: 'actual',
                    status: overrides.status || 'awaiting_actual',
                    minimumSnapshot: {
                        minimumAmount: 2500,
                        source: 'server_rules'
                    },
                    finalizedBy: overrides.finalizedBy || null,
                    finalizedAt: overrides.finalizedAt || null,
                    creatorException: overrides.creatorException || null
                }
            }
        }
    };
}

test('banquet summary exposes actual menu operational projection and charged subtotal', () => {
    const summary = buildBanquetSummary({
        mainBooking: bookingWithActualWorkflow(),
        customer: { name: 'Client', phone: '+380000000000' },
        businessContext: 'event_genix',
        mode: 'client'
    });

    assert.equal(summary.menuWorkflow.mode, 'actual');
    assert.equal(summary.menuWorkflow.status, 'awaiting_actual');
    assert.equal(summary.menuWorkflow.statusLabel, 'Меню по факту · очікує закриття');
    assert.equal(summary.menuWorkflow.minimumAmount, 2500);
    assert.equal(summary.menuWorkflow.positionsSubtotal, 1900);
    assert.equal(summary.menuWorkflow.adjustmentAmount, 600);
    assert.equal(summary.menuWorkflow.chargedSubtotal, 2500);
    assert.deepEqual(summary.menuWorkflow.taskSource, {
        sourceType: 'booking',
        sourceId: '6201',
        sourceModule: 'banquet_menu_actual'
    });
    assert.equal(summary.totals.menuSubtotal, 1900);
    assert.equal(summary.totals.menuChargedSubtotal, 2500);
    assert.equal(summary.totals.orderTotal, 2500);
    assert.ok(summary.finance.rows.some(row => row.key === 'menu_positions_subtotal' && row.label === 'Попередня сума меню' && row.amount === 1900));
    assert.ok(summary.finance.rows.some(row => row.key === 'menu_minimum_adjustment' && row.amount === 600));
    assert.ok(summary.finance.rows.some(row => row.key === 'menu_charged_subtotal' && row.amount === 2500));
});

test('PDF view uses server actual menu projection before finance rows', () => {
    const summary = buildBanquetSummary({
        mainBooking: bookingWithActualWorkflow(),
        customer: { name: 'Client', phone: '+380000000000' },
        businessContext: 'event_genix',
        mode: 'client'
    });
    const view = buildBanquetSummaryPdfView(summary, 'client');

    assert.ok(view.menuWorkflowRows.some(row => row[0] === 'Статус' && row[1] === 'Меню по факту · очікує закриття'));
    assert.ok(view.menuWorkflowRows.some(row => row[0] === 'Попередня сума' && /1\s?900/.test(row[1])));
    assert.ok(view.menuWorkflowRows.some(row => row[0] === 'Контрольна задача' && row[1] === 'Закрити меню по факту'));
    assert.ok(view.financeRows.some(row => row.key === 'menu_charged_subtotal' && row.amount === 2500));
});

test('booking detail renderer displays actual menu status separately from preorder warning', () => {
    global.escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    global.formatPrice = value => `${Number(value || 0).toLocaleString('uk-UA')} ₴`;
    global.bookingKitchenTypeLabel = value => String(value || 'КУХНЯ').toUpperCase();
    global.formatBookingMenuPositionQuantity = item => String(item.quantity || 1);
    global.bookingMenuMissingServingTimeCount = positions => (Array.isArray(positions) ? positions.filter(item => !item.servingTime).length : 0);
    global.BOOKING_SERVICE_EVENT_TYPES = {};
    global.getBookingPackageFromBooking = booking => booking.extraData?.bookingPackage || booking.extra_data?.bookingPackage || null;
    delete require.cache[require.resolve('../js/booking-package-renderer')];
    const renderer = require('../js/booking-package-renderer');

    const html = renderer.renderBookingPackageDetail({
        price: 2500,
        extraData: bookingWithActualWorkflow().extra_data
    });

    assert.match(html, /Меню по факту · очікує закриття/);
    assert.match(html, /Контрольна задача: Закрити меню по факту/);
    assert.match(html, /Попередня сума/);
    assert.match(html, /Різниця до мінімуму/);
    assert.doesNotMatch(html, /Передзамовлення \/ завдаток.*Меню по факту/s);
});

test('static canonical surfaces consume menuWorkflow projection', () => {
    const root = path.join(__dirname, '..');
    const detailCode = fs.readFileSync(path.join(root, 'js', 'booking-package-renderer.js'), 'utf8');
    const summaryPageCode = fs.readFileSync(path.join(root, 'js', 'booking-summary-page.js'), 'utf8');
    const pdfCode = fs.readFileSync(path.join(root, 'services', 'banquetSummaryPdf.js'), 'utf8');

    assert.match(detailCode, /renderBookingPackageMenuWorkflow/);
    assert.match(summaryPageCode, /renderMenuWorkflowStatus/);
    assert.match(pdfCode, /menuWorkflowRowsForSummary/);
    assert.match(pdfCode, /view\.menuWorkflowRows/);
});