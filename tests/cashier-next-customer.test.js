'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function fixture() {
    const root = path.join(__dirname, '..');
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'cashier-payments.html'), 'utf8'), {
        url: 'http://localhost/cashier-payments', runScripts: 'outside-only'
    });
    const { window } = dom;
    Object.defineProperty(window.navigator, 'locks', { value: { request: (_key, callback) => callback() } });
    // Exercise the actual page functions without authentication/bootstrap or external IO.
    const source = fs.readFileSync(path.join(root, 'js/cashier-payments-page.js'), 'utf8')
        .replace("document.addEventListener('DOMContentLoaded', () => { void initCashierPaymentsPage(); });", '')
        .replace('window.CashierPaymentsPage = {', 'window.CashierPaymentsPage = { syncCreateAvailability, startNextOrder, addCatalogLine, bindEvents, clearCreateIdempotencyKey,');
    window.fetch = async () => { throw new Error('offline fixture'); };
    window.eval(source);
    const page = window.CashierPaymentsPage;
    Object.assign(page.state, {
        user: { id: 1 }, routeReady: true, routeLoading: false, catalogReady: true,
        registerState: { integrationReady: true, fiscalProfileId: 1, fiscalRegisterId: 2 },
        unresolvedQueueState: 'available', unresolvedLastRefreshAt: Date.now(),
        catalogItems: [{ itemCode: 'same', name: 'Long catalog service name', priceMinor: '1000' }]
    });
    window.document.querySelector('#paymentCashierBinding').innerHTML = '<option value="3">Cashier</option><option value="4">Other</option>';
    page.bindEvents();
    return { dom, window, page, el: id => window.document.getElementById(id) };
}

test('completed order requires next customer and locks cart editing', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.addCatalogLine();
    f.page.state.orderDetails = { order: { id: 10, paymentStatus: 'confirmed', fiscalStatus: 'fiscalized' } };
    f.page.syncCreateAvailability();
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.equal(f.el('addCatalogLineBtn').disabled, true);
    assert.equal(f.el('startNextOrderBtn').textContent, 'Наступний клієнт');
});

test('next customer clears items, quantities, discount and confirmation but preserves pending queue', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.addCatalogLine();
    f.el('catalogDiscountRule').innerHTML = '<option value="discount">Discount</option><option value="">None</option>';
    f.el('cashReceivedAmount').value = '100';
    f.page.state.orderDetails = { order: { id: 10, paymentStatus: 'confirmed', fiscalStatus: 'pending' } };
    f.page.state.unresolvedOrders = [{ id: 10 }];
    const reset = f.page.startNextOrder();
    assert.equal(f.el('catalogSaleLines').children.length, 0);
    assert.equal(f.el('catalogDiscountRule').value, '');
    assert.equal(f.el('cashReceivedAmount').value, '');
    assert.equal(f.el('paymentCashierBinding').value, '3');
    assert.equal(f.page.state.unresolvedOrders[0].id, 10);
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    await reset;
});

test('draft key is stable for retries and changes for cashier edits including returning to original cashier', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.addCatalogLine();
    const first = f.page.getCreateIdempotencyKey();
    assert.equal(f.page.getCreateIdempotencyKey(), first);
    f.el('paymentCashierBinding').value = '4';
    f.el('paymentCashierBinding').dispatchEvent(new f.window.Event('change', { bubbles: true }));
    assert.notEqual(f.page.getCreateIdempotencyKey(), first);
    f.el('paymentCashierBinding').value = '3';
    f.el('paymentCashierBinding').dispatchEvent(new f.window.Event('change', { bubbles: true }));
    assert.notEqual(f.page.getCreateIdempotencyKey(), first);
});

test('last cart row can be removed and does not reappear automatically', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.addCatalogLine();
    f.window.document.querySelector('[data-catalog-remove]').click();
    assert.equal(f.el('catalogSaleLines').children.length, 0);
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
});
