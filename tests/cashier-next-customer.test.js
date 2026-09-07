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
        .replace('window.CashierPaymentsPage = {', 'window.CashierPaymentsPage = { syncCreateAvailability, syncConfirmationAvailability, refreshCatalogSelects, startNextOrder, addCatalogLine, confirmPayment, bindEvents, clearCreateIdempotencyKey, cancelDraftOrder,');
    window.fetch = async () => { throw new Error('offline fixture'); };
    window.showNotification = (message, type) => { window.__notifications.push({ message, type }); };
    window.__notifications = [];
    window.eval(source);
    const page = window.CashierPaymentsPage;
    Object.assign(page.state, {
        user: { id: 1 }, routeReady: true, routeLoading: false, catalogReady: true,
        registerState: { integrationReady: true, fiscalProfileId: 1, fiscalRegisterId: 2, requiredTender: 'cash' },
        unresolvedQueueState: 'available', unresolvedLastRefreshAt: Date.now(),
        catalogItems: [
            { itemCode: 'same', name: 'Long catalog service name', category: 'Services', priceMinor: '1000' },
            { itemCode: 'vip', name: 'VIP park ticket', category: 'Tickets', priceMinor: '2500' }
        ]
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

test('catalog search exposes selectable results before a cart row exists', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.el('catalogSearch').value = 'vip';
    f.page.refreshCatalogSelects();
    const results = [...f.window.document.querySelectorAll('#catalogSearchResults .cashier-catalog-result')];
    assert.equal(results.length, 1);
    assert.match(results[0].textContent, /VIP park ticket/);
    results[0].click();
    assert.equal(f.el('catalogSaleLines').children.length, 1);
    assert.equal(f.window.document.querySelector('[data-catalog-item]').value, 'vip');
});

test('add catalog line respects active filters and does not pick the first unrelated item', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.el('catalogSearch').value = 'missing item';
    f.page.addCatalogLine();
    assert.equal(f.el('catalogSaleLines').children.length, 0);
    assert.equal(f.el('cashierGlobalStatus').classList.contains('cashier-alert-danger'), true);
    assert.match(f.el('cashierGlobalStatus').textContent, /немає доступних позицій/);
});

function jsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => 'application/json' },
        json: async () => payload
    };
}

function draftOrder(id = 10) {
    return {
        id,
        status: 'draft',
        paymentStatus: 'unpaid',
        fiscalStatus: 'not_created',
        totalAmountMinor: '1000',
        crmProfileKey: 'event_genix',
        sourceSnapshot: { tender: 'cash' }
    };
}

function installPaymentFetch(f, confirmResponse, options = {}) {
    const readOrder = options.readOrder || (() => draftOrder(10));
    f.window.fetch = async (path, options = {}) => {
        const url = String(path);
        const method = String(options.method || 'GET').toUpperCase();
        if (url === '/api/payments/orders/10/confirm' && method === 'POST') return confirmResponse();
        if (url === '/api/payments/orders/10' && method === 'GET') {
            const order = readOrder();
            if (order instanceof Error) throw order;
            return jsonResponse(200, { success: true, order, items: [], receipts: [], artifacts: {} });
        }
        if (url.startsWith('/api/payments/pilot-register-state') && method === 'GET') {
            const requiredTender = new URL(url, 'http://localhost').searchParams.get('requiredTender') || 'cash';
            return jsonResponse(200, {
                success: true,
                integrationReady: true,
                readinessCode: 'ready',
                fiscalProfileId: 1,
                fiscalLocationId: 1,
                fiscalRegisterId: 2,
                requiredTender,
                readiness: { readinessCode: 'ready', integrationReady: true, requiredTender }
            });
        }
        if (url.startsWith('/api/payments/unresolved-orders') && method === 'GET') {
            return jsonResponse(200, {
                success: true,
                registerWide: true,
                fiscalProfileId: 1,
                fiscalLocationId: 1,
                fiscalRegisterId: 2,
                page: 1,
                pageSize: 50,
                registerCount: 0,
                myCount: 0,
                hasMore: false,
                snapshotRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                nextCursor: null,
                orders: []
            });
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
    };
}

test('definite confirm rejection restores the draft form with actionable provider permission text', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.orderDetails = { order: draftOrder(10), items: [] };
    f.el('cashReceivedAmount').value = '10';
    installPaymentFetch(f, () => jsonResponse(409, {
        success: false,
        code: 'checkbox_payment_permission_unreported',
        error: 'Checkbox is not ready for payment confirmation',
        details: { requiredTender: 'cash', unreportedPaymentPermissions: ['cash_payment'] }
    }));
    await f.page.confirmPayment();
    assert.equal(f.page.state.confirmSubmitted, false);
    assert.equal(f.page.state.confirmOutcomePending, false);
    assert.equal(f.el('confirmCashBtn').disabled, false);
    assert.match(f.el('cashierGlobalStatus').textContent, /Checkbox не повідомив право касира на готівку/);
});

test('confirm success is not shown and form stays locked when authoritative reread is still unpaid', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.orderDetails = { order: draftOrder(10), items: [] };
    f.el('cashReceivedAmount').value = '10';
    installPaymentFetch(f, () => jsonResponse(200, {
        success: true,
        order: { ...draftOrder(10), paymentStatus: 'confirmed', status: 'payment_recorded' }
    }));
    await f.page.confirmPayment();
    assert.equal(f.page.state.confirmSubmitted, true);
    assert.equal(f.page.state.confirmOutcomePending, true);
    assert.equal(f.el('confirmCashBtn').disabled, true);
    assert.equal(f.el('cancelDraftOrderBtn').disabled, true);
    assert.equal(f.window.__notifications.some(item => item.type === 'success' && /Оплату підтверджено/.test(item.message)), false);
    assert.match(f.el('cashierGlobalStatus').textContent, /не підтвердило оплату/);
});

test('unknown 409 confirmation result stays pending even when reread shows unpaid draft', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.orderDetails = { order: draftOrder(10), items: [] };
    f.el('cashReceivedAmount').value = '10';
    installPaymentFetch(f, () => jsonResponse(409, {
        success: false,
        code: 'unexpected_provider_state',
        error: 'Provider result is unknown'
    }));
    await f.page.confirmPayment();
    assert.equal(f.page.state.confirmSubmitted, true);
    assert.equal(f.page.state.confirmOutcomePending, true);
    assert.equal(f.el('confirmCashBtn').disabled, true);
    assert.match(f.el('cashierGlobalStatus').textContent, /Результат підтвердження уточнюється/);
});

test('known rejection stays pending when authoritative reread fails', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.orderDetails = { order: draftOrder(10), items: [] };
    f.el('cashReceivedAmount').value = '10';
    installPaymentFetch(
        f,
        () => jsonResponse(409, {
            success: false,
            code: 'checkbox_payment_permission_unreported',
            error: 'Checkbox is not ready for payment confirmation',
            details: { requiredTender: 'cash', unreportedPaymentPermissions: ['cash_payment'] }
        }),
        { readOrder: () => new Error('reread unavailable') }
    );
    await f.page.confirmPayment();
    assert.equal(f.page.state.confirmSubmitted, true);
    assert.equal(f.page.state.confirmOutcomePending, true);
    assert.equal(f.el('confirmCashBtn').disabled, true);
    assert.match(f.el('cashierGlobalStatus').textContent, /Результат підтвердження уточнюється/);
});

test('network failure during confirmation keeps same draft locked for clarification', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.orderDetails = { order: draftOrder(10), items: [] };
    f.el('cashReceivedAmount').value = '10';
    installPaymentFetch(f, () => { throw new Error('network timeout'); });
    await f.page.confirmPayment();
    assert.equal(f.page.state.confirmSubmitted, true);
    assert.equal(f.page.state.confirmOutcomePending, true);
    assert.equal(f.el('confirmCashBtn').disabled, true);
    assert.match(f.el('confirmDisabledReason').textContent, /Результат підтвердження уточнюється/);
});

test('late readiness responses for the previous tender do not mark the current tender ready', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    let releaseCash;
    const cashResponse = new Promise(resolve => { releaseCash = resolve; });
    f.window.fetch = async (path, options = {}) => {
        const url = String(path);
        const method = String(options.method || 'GET').toUpperCase();
        if (url.startsWith('/api/payments/pilot-register-state') && method === 'GET') {
            const requiredTender = new URL(url, 'http://localhost').searchParams.get('requiredTender') || 'cash';
            const payload = {
                success: true,
                integrationReady: true,
                readinessCode: 'ready',
                fiscalProfileId: 1,
                fiscalLocationId: 1,
                fiscalRegisterId: 2,
                requiredTender,
                readiness: { readinessCode: 'ready', integrationReady: true, requiredTender }
            };
            if (requiredTender === 'cash') return cashResponse.then(() => jsonResponse(200, payload));
            return jsonResponse(200, payload);
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
    };

    f.page.state.tender = 'cash';
    const first = f.page.loadPilotRegisterState({ silent: true });
    f.page.state.tender = 'card_terminal_manual';
    await f.page.loadPilotRegisterState({ silent: true });
    releaseCash();
    await first;
    assert.equal(f.page.state.registerState.requiredTender, 'card_terminal_manual');
    assert.equal(f.page.state.registerState.integrationReady, true);
});
