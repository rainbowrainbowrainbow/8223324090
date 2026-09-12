'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function fixture(business = 'event_genix', routeOptionId = '') {
    const root = path.join(__dirname, '..');
    const routeParam = routeOptionId ? `&routeOptionId=${encodeURIComponent(routeOptionId)}` : '';
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'cashier-payments.html'), 'utf8'), {
        url: `http://localhost/cashier-payments?saleMode=catalog&businessContext=${business}${routeParam}`, runScripts: 'outside-only'
    });
    const { window } = dom;
    Object.defineProperty(window.navigator, 'locks', { value: { request: (_key, callback) => callback() } });
    // Exercise the actual page functions without authentication/bootstrap or external IO.
    window.eval(fs.readFileSync(path.join(root, 'js/catalog-discount-calculator.js'), 'utf8'));
    const source = fs.readFileSync(path.join(root, 'js/cashier-payments-page.js'), 'utf8')
        .replace("document.addEventListener('DOMContentLoaded', () => { void initCashierPaymentsPage(); });", '')
        .replace('window.CashierPaymentsPage = {', 'window.CashierPaymentsPage = { loadCatalogData, loadCheckboxSalesReport, renderCheckboxSalesReport, applyReceiptHistoryPeriod, handleReceiptHistoryFilterChange, loadReceiptHistoryOnOpen, changeReceiptHistoryPage, receiptHistorySnapshot, loadUnresolvedOrders, renderReadinessState, renderSharedTestDay, renderOrder, syncCreateAvailability, syncConfirmationAvailability, syncOrderPolling, scheduleUnresolvedRefresh, refreshCatalogSelects, startNextOrder, addCatalogLine, confirmPayment, bindEvents, clearCreateIdempotencyKey, cancelDraftOrder, renderRouteSelectors,');
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

test('closed shared test day explains the exact resume blocker', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.window.canAccess = () => true;
    Object.assign(f.page.state.registerState, {
        readinessCode: 'ready',
        integrationReady: true,
        sharedTestDay: {
            visible: true,
            localDrainBlocked: true,
            canResume: false,
            reasonCode: 'shared_test_owner_mismatch',
            activeDrain: { id: 91, status: 'closed' }
        }
    });
    f.page.addCatalogLine();
    f.page.renderReadinessState();
    f.page.renderSharedTestDay();

    assert.match(f.el('cashierReadinessSummary').textContent, /початок наступного тестового дня зараз недоступний/);
    assert.match(f.el('cashierReadinessTechnicalList').textContent, /відповідальний, який зупинив цю тестову касу/);
    assert.match(f.el('sharedTestDayNotice').textContent, /відповідальний, який зупинив цю тестову касу/);
    assert.equal(f.el('sharedTestResumeBtn').disabled, true);
});

test('unverified shared test close is shown as pending proof, not as a completed day', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.window.canAccess = () => true;
    Object.assign(f.page.state.registerState, {
        readinessCode: 'ready',
        integrationReady: true,
        sharedTestDay: {
            visible: true,
            localDrainBlocked: true,
            canResume: false,
            reasonCode: 'shared_test_close_not_verified',
            activeDrain: { id: 91, status: 'closed' }
        }
    });
    f.page.addCatalogLine();
    f.page.renderReadinessState();
    f.page.renderSharedTestDay();

    const readiness = f.el('cashierReadinessSummary').textContent;
    const notice = f.el('sharedTestDayNotice').textContent;
    assert.match(readiness, /очікує підтвердження Checkbox/);
    assert.match(notice, /очікує підтвердження Checkbox/);
    assert.match(notice, /Нові оплати PARK і ДАР зупинено/);
    assert.doesNotMatch(readiness, /Тестову зміну закрито/);
    assert.doesNotMatch(notice, /Зміну закрито/);
    assert.equal(f.el('sharedTestResumeBtn').disabled, true);
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
});

test('cashier dangerous actions are fail-closed before async readiness settles', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.equal(f.el('createPaymentOrderBtn').getAttribute('aria-disabled'), 'true');
    assert.equal(f.el('createXReportBtn').disabled, true);
    assert.equal(f.el('createXReportBtn').getAttribute('aria-disabled'), 'true');
    assert.equal(f.el('closeZReportBtn').disabled, true);
    assert.equal(f.el('closeZReportBtn').getAttribute('aria-disabled'), 'true');
});

test('completed order requires next customer and locks cart editing', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.addCatalogLine();
    f.page.state.orderDetails = { order: { id: 10, paymentStatus: 'confirmed', fiscalStatus: 'fiscalized' } };
    f.page.syncCreateAvailability();
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.equal(f.el('addCatalogLineBtn').disabled, true);
    assert.equal(f.el('startNextOrderBtn').textContent, 'Наступний клієнт');
});

test('completed order exposes next customer beside the fiscal result without unlocking the paid sale', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.orderDetails = { order: { id: 10, paymentStatus: 'confirmed', fiscalStatus: 'fiscalized' } };
    f.page.syncCreateAvailability();
    assert.equal(f.el('paymentBusinessContext').disabled, true);
    assert.equal(f.el('paymentRegisterRoute').disabled, true);
    assert.equal(f.el('paymentCashierBinding').disabled, true);
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.equal(f.el('startNextOrderBtn').closest('#fiscalResultPanel'), f.el('fiscalResultPanel'));
    assert.equal(f.el('startNextOrderBtn').disabled, false);
    assert.equal(f.el('startNextOrderBtn').classList.contains('hidden'), false);
    assert.match(f.el('paymentRouteHelp').textContent, /продаж №10.*зафіксовані.*Наступний клієнт/);
    f.page.state.unresolvedQueueState = 'unknown';
    f.page.syncCreateAvailability();
    assert.equal(f.el('startNextOrderBtn').disabled, true);
    assert.match(f.el('paymentRouteHelp').textContent, /Черга незавершених чеків ще не перевірена/);
});

test('blocked create action looks disabled while ready action keeps semantic availability', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.routeReady = false;
    f.page.addCatalogLine();
    f.page.syncCreateAvailability();
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.equal(f.el('createPaymentOrderBtn').classList.contains('is-blocked'), true);
    assert.equal(f.el('createPaymentOrderBtn').classList.contains('is-ready'), false);

    f.page.state.routeReady = true;
    f.page.state.registerState.integrationReady = true;
    f.page.syncCreateAvailability();
    assert.equal(f.el('createPaymentOrderBtn').disabled, false);
    assert.equal(f.el('createPaymentOrderBtn').classList.contains('is-ready'), true);
    assert.equal(f.el('createPaymentOrderBtn').classList.contains('is-blocked'), false);
});

test('seller legal entity and selected test cashier remain distinct when rendering a paid order', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.el('paymentCashierBinding').options[0].textContent = 'Test cashier';
    const details = { order: { id: 10, paymentStatus: 'confirmed', fiscalStatus: 'fiscalized', crmProfileKey: 'event_genix', legalEntityName: 'Test legal seller', totalAmountMinor: '1000' } };
    f.page.state.orderDetails = details;
    f.page.renderOrder(details);
    assert.match(f.el('cashierFiscalProfile').textContent, /Test legal seller/);
    assert.equal(f.el('paymentCashierBinding').selectedOptions[0].textContent, 'Test cashier');
    assert.equal(f.el('paymentCashierBinding').value, '3');
});

for (const blocker of ['queue', 'route', 'drain_open', 'drain_closed']) {
    test(`server-approved test permission warning does not blame provider rights for a ${blocker} blocker`, t => {
        const f = fixture(); t.after(() => f.dom.window.close());
        f.window.canAccess = () => true;
        Object.assign(f.page.state.registerState, {
            readinessCode: 'ready', integrationReady: true,
            readiness: { unreportedPaymentPermissions: ['cash_payment'], deniedPaymentPermissions: [] }
        });
        if (blocker === 'queue') f.page.state.unresolvedQueueState = 'unavailable';
        else if (blocker === 'route') {
            f.page.state.routeReady = false;
            f.page.state.routeOptions = [{ id: f.page.PILOT_SCOPE.routeOptionId, businessContext: f.page.PILOT_SCOPE.crmProfileKey, mode: 'test', sequentialReady: false, readinessCode: 'shared_test_register_owned_by_other_business' }];
        } else {
            f.page.state.registerState.sharedTestDay = {
                localDrainBlocked: true, canResume: blocker === 'drain_closed',
                activeDrain: { status: blocker === 'drain_closed' ? 'closed' : 'draining' }
            };
        }
        f.page.addCatalogLine();
        f.page.renderReadinessState();
        const text = f.el('cashierReadinessTechnicalList').textContent;
        assert.match(text, /сервер застосував погоджений тестовий виняток/);
        assert.doesNotMatch(text, /потрібна перевірка прав у Checkbox/);
        const reasons = {
            queue: /Черга незавершених чеків недоступна/,
            route: /Спільну тестову зміну використовує інший напрямок/,
            drain_open: /Приймання оплат зупинене для завершення тестового дня/,
            drain_closed: /Закриття тестової зміни підтверджене.*Почати наступний тестовий день/
        };
        assert.match(text, reasons[blocker]);
        if (blocker.startsWith('drain_')) {
            assert.match(f.el('cashierReadinessSummary').textContent, reasons[blocker]);
            assert.match(f.el('createPaymentDisabledReason').textContent, reasons[blocker]);
            assert.equal(f.page.state.registerState.sharedTestDay.localDrainBlocked, true);
        }
        assert.equal(f.el('cashierReadinessStatus').classList.contains('is-blocked'), true);
        assert.equal(f.el('createPaymentOrderBtn').disabled, true);
        assert.equal(f.page.state.registerState.integrationReady, true);
    });
}

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

test('draft key is stable for retries and changes for cashier edits including returning to original cashier', async t => {
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
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
});

test('last cart row can be removed and does not reappear automatically', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.addCatalogLine();
    f.window.document.querySelector('[data-catalog-remove]').click();
    assert.equal(f.el('catalogSaleLines').children.length, 0);
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
});

test('basket line renders scan-friendly metadata, quantity, price and total labels', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.catalogItems[0].unit = 'заняття';
    f.page.addCatalogLine('same');
    const row = f.el('catalogSaleLines').firstElementChild;
    assert.ok(row);
    assert.match(row.querySelector('[data-catalog-name]').textContent, /Long catalog service name/);
    assert.equal(row.querySelector('[data-catalog-category]').textContent, 'Services');
    assert.equal(row.querySelector('[data-catalog-unit-label]').textContent, 'за заняття');
    assert.match(row.querySelector('[data-catalog-price]').textContent, /Ціна/);
    assert.match(row.querySelector('[data-catalog-price]').textContent, /10,00/);
    assert.match(row.querySelector('.cashier-catalog-control-label').textContent, /К-сть/);
    assert.match(row.querySelector('.cashier-catalog-line-money').textContent, /Сума/);
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

for (const business of ['event_genix', 'dar']) {
    test(`${business} async catalog bootstrap displays items before any search or manual refresh`, async t => {
        const f = fixture(business); t.after(() => f.dom.window.close());
        const items = f.page.state.catalogItems;
        const reads = [];
        f.window.fetch = async url => {
            const parsed = new URL(url, 'http://localhost');
            assert.equal(parsed.searchParams.get('businessContext'), business);
            reads.push(parsed.pathname);
            if (parsed.pathname === '/api/payments/catalog/items') return jsonResponse(200, { items });
            if (parsed.pathname === '/api/payments/catalog/discounts') return jsonResponse(200, { discounts: [] });
            throw new Error('unexpected catalog request');
        };
        await f.page.loadCatalogData();
        assert.equal(reads.length, 2);
        assert.equal(f.page.state.catalogReady, true);
        assert.equal(f.el('catalogSearch').value, '');
        assert.equal(f.el('catalogPicker').hidden, false);
        assert.equal(f.el('addCatalogLineBtn').getAttribute('aria-expanded'), 'true');
        assert.equal(f.el('catalogSearchResults').classList.contains('hidden'), false);
        const results = f.el('catalogSearchResults').querySelectorAll('button');
        assert.equal(results.length, items.length);
        results[0].click();
        assert.equal(f.el('catalogSaleLines').children.length, 1);
        assert.equal(f.el('createPaymentOrderBtn').disabled, false);
    });
}

for (const nested of [false, true]) for (const [tender, permission] of [['cash', 'cash_payment'], ['card_terminal_manual', 'card_payment']]) {
    test(`server-approved ${tender} readiness (${nested ? 'projected' : 'flat'}) displays unreported permission as a warning without contradicting controls`, t => {
        const f = fixture(); t.after(() => f.dom.window.close());
        f.page.state.tender = tender;
        Object.assign(f.page.state.registerState, {
            requiredTender: tender, readinessCode: 'ready', integrationReady: true
        });
        const permissionFields = { unreportedPaymentPermissions: [permission], deniedPaymentPermissions: [] };
        Object.assign(f.page.state.registerState, nested ? { readiness: permissionFields } : permissionFields);
        f.page.addCatalogLine();
        f.page.syncCreateAvailability();
        f.page.renderReadinessState();
        assert.equal(f.el('createPaymentOrderBtn').disabled, false);
        assert.equal(f.el('cashierReadinessStatus').classList.contains('is-blocked'), false);
        assert.equal(f.el('cashierReadinessStatus').classList.contains('is-ready'), false);
        assert.equal(f.el('cashierReadinessStatus').classList.contains('cashier-alert-warning'), true);
        assert.match(f.el('cashierReadinessSummary').textContent, /Сервер дозволив.*попередженням.*не повідомив/);
        assert.deepEqual(permissionFields.unreportedPaymentPermissions, [permission]);
    });
}

test('projected explicit permission denial stays visible and blocked', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    Object.assign(f.page.state.registerState, {
        readinessCode: 'checkbox_cashier_permissions_missing', integrationReady: false,
        readiness: { deniedPaymentPermissions: ['cash_payment'], unreportedPaymentPermissions: [] }
    });
    f.page.addCatalogLine(); f.page.renderReadinessState();
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.equal(f.el('cashierReadinessStatus').classList.contains('is-blocked'), true);
});

for (const business of ['event_genix', 'dar']) {
    test(`${business} picker stays visible, never truncates at 24 and merges repeated choices without losing filtered cart`, t => {
        const f = fixture(business); t.after(() => f.dom.window.close());
        f.page.state.catalogItems.push(...Array.from({ length: 30 }, (_, index) => ({
            itemCode: `extra-${index}`, name: `Service ${index}`, category: 'Services', priceMinor: '1000'
        })));
        f.page.refreshCatalogSelects();
        assert.equal(f.el('catalogSearchResults').querySelectorAll('button').length, 32);
        f.el('catalogSearchResults').querySelector('button').click();
        assert.equal(f.el('catalogPicker').hidden, false);
        assert.equal(f.el('catalogSearchResults').classList.contains('hidden'), false);
        f.el('catalogSearchResults').querySelector('button').click();
        assert.equal(f.el('catalogSaleLines').children.length, 1);
        assert.equal(f.window.document.querySelector('[data-catalog-quantity]').value, '2');
        f.window.document.querySelector('[data-catalog-step="-1"]').click();
        assert.equal(f.window.document.querySelector('[data-catalog-quantity]').value, '1');
        f.el('catalogSearch').value = 'extra-29';
        f.page.refreshCatalogSelects();
        assert.equal(f.el('catalogSearchResults').querySelectorAll('button').length, 1);
        assert.equal(f.window.document.querySelector('[data-catalog-item]').value, 'same');
        assert.equal(f.window.document.querySelector('[data-catalog-quantity]').value, '1');
        f.el('catalogSearch').value = 'not present';
        f.page.refreshCatalogSelects();
        assert.match(f.el('catalogSearchResults').textContent, /немає доступних позицій/);
        assert.equal(f.el('catalogSaleLines').children.length, 1);
        f.page.state.orderDetails = { order: { id: 10, paymentStatus: 'confirmed', fiscalStatus: 'unknown' } };
        f.page.syncCreateAvailability();
        assert.equal(f.window.document.querySelector('[data-catalog-step="1"]').disabled, true);
    });
}

test('picker toggle and Escape preserve cart, search, tender and focus without adding products', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    assert.equal(f.el('catalogPicker').hidden, false);
    assert.equal(f.el('catalogSaleLines').children.length, 0);
    assert.equal(f.el('addCatalogLineBtn').getAttribute('aria-expanded'), 'true');
    f.page.addCatalogLine();
    f.el('catalogSearch').value = 'extra';
    const tender = f.page.state.tender;
    f.el('addCatalogLineBtn').click();
    assert.equal(f.el('catalogPicker').hidden, true);
    assert.equal(f.el('catalogSaleLines').children.length, 1);
    f.el('addCatalogLineBtn').click();
    assert.equal(f.window.document.activeElement, f.el('catalogSearch'));
    assert.equal(f.el('catalogSearch').value, 'extra');
    assert.equal(f.page.state.tender, tender);
    f.el('catalogSearch').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(f.el('catalogPicker').hidden, true);
    assert.equal(f.el('addCatalogLineBtn').getAttribute('aria-expanded'), 'false');
    assert.equal(f.window.document.activeElement, f.el('addCatalogLineBtn'));
    assert.equal(f.el('catalogSaleLines').children.length, 1);
});

test('second direction discount explains zero eligibility and updates after basket changes', t => {
    const f = fixture('dar'); t.after(() => f.dom.window.close());
    f.page.state.catalogItems[0].quantityRule = { club_direction: 'painting' };
    f.page.state.catalogItems[1].quantityRule = { club_direction: 'logic' };
    f.page.state.catalogDiscounts = [{ code: 'second_direction_template', rateBps: 1000, eligibilityMode: 'second_club_direction' }];
    f.el('catalogDiscountRule').innerHTML = '<option value="second_direction_template">10%</option>';
    f.page.addCatalogLine('same');
    assert.match(f.el('catalogDiscountExplanation').textContent, /0 грн знижки/);
    assert.match(f.el('catalogDiscountTotal').textContent, /0,00/);
    f.page.addCatalogLine('vip');
    assert.match(f.el('catalogDiscountExplanation').textContent, /іншого гурткового напрямку/);
    assert.match(f.el('catalogDiscountTotal').textContent, /2,50/);
    assert.equal(f.window.document.querySelector('[data-catalog-line-discount]').hidden, true);
    assert.match(f.window.document.querySelectorAll('[data-catalog-line-discount]')[1].textContent, /2,50/);
    f.el('catalogSaleLines').lastElementChild.querySelector('[data-catalog-remove]').click();
    assert.match(f.el('catalogDiscountExplanation').textContent, /0 грн знижки/);
});

for (const [status, error, label] of [
    ['failed_retryable', 'checkbox_receipt_pending', /Checkbox обробляє чек/],
    ['failed_retryable', 'provider_receipt_pending', /Checkbox обробляє чек/],
    ['failed_retryable', 'receipt_lookup_required_before_retry', /Checkbox обробляє чек/],
    ['failed_retryable', 'provider_timeout', /помилка/],
    ['failed_terminal', 'checkbox_receipt_pending', /помилка без автоповтору/],
    ['fiscalized', 'checkbox_receipt_pending', /чек створено/]
]) {
    test(`receipt display ${status}/${error} does not alter canonical outcome or unlock payment`, t => {
        const f = fixture(); t.after(() => f.dom.window.close());
        const details = { order: { id: 10, paymentStatus: 'confirmed', fiscalStatus: status }, outboxJob: { lastErrorCode: error } };
        f.page.state.orderDetails = details;
        f.page.renderOrder(details);
        f.page.syncConfirmationAvailability();
        assert.match(f.el('cashierFiscalStatus').textContent, label);
        assert.match(f.el('fiscalReceiptBadge').textContent, label);
        assert.equal(details.order.fiscalStatus, status);
        assert.equal(f.el('confirmCashBtn').disabled, true);
        assert.equal(f.el('confirmCardBtn').disabled, true);
        if (['checkbox_receipt_pending', 'provider_receipt_pending', 'receipt_lookup_required_before_retry'].includes(error) && status === 'failed_retryable') {
            assert.match(f.el('fiscalPendingMessage').textContent, /перевіряється автоматично/);
        }
    });
}

test('unreported permission without server approval stays blocked; rendering never grants readiness', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    Object.assign(f.page.state.registerState, {
        readinessCode: 'checkbox_payment_permission_unreported', integrationReady: false,
        unreportedPaymentPermissions: ['cash_payment'], deniedPaymentPermissions: []
    });
    f.page.addCatalogLine();
    f.page.syncCreateAvailability();
    f.page.renderReadinessState();
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.equal(f.page.state.registerState.integrationReady, false);
    assert.equal(f.el('cashierReadinessStatus').classList.contains('is-blocked'), true);
    assert.match(f.el('cashierReadinessSummary').textContent, /приймання оплат заблоковано/);
});

test('explicit denial and previous-tender readiness cannot become an allowed warning', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.addCatalogLine();
    Object.assign(f.page.state.registerState, {
        readinessCode: 'checkbox_cashier_permissions_missing', integrationReady: false,
        unreportedPaymentPermissions: ['cash_payment'], deniedPaymentPermissions: ['sales']
    });
    f.page.syncCreateAvailability();
    f.page.renderReadinessState();
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.equal(f.el('cashierReadinessStatus').classList.contains('is-blocked'), true);
    Object.assign(f.page.state.registerState, {
        readinessCode: 'ready', integrationReady: true, deniedPaymentPermissions: [], requiredTender: 'card_terminal_manual'
    });
    f.page.syncCreateAvailability();
    f.page.renderReadinessState();
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.equal(f.el('cashierReadinessStatus').classList.contains('is-blocked'), true);
});

for (const [label, registerState, expectedText] of [
    ['null permission arrays', {
        readinessCode: 'checkbox_payment_permission_unreported',
        integrationReady: false,
        requiredTender: 'cash',
        readiness: { requiredTender: 'cash', unreportedPaymentPermissions: null, deniedPaymentPermissions: null }
    }, /Checkbox не повідомив право касира/],
    ['missing permission arrays', {
        readinessCode: 'checkbox_payment_permission_unreported',
        integrationReady: false,
        requiredTender: 'cash',
        readiness: { requiredTender: 'cash' }
    }, /Checkbox не повідомив право касира/],
    ['malformed permission shape', {
        readinessCode: 'checkbox_cashier_permissions_malformed',
        integrationReady: false,
        requiredTender: 'cash',
        readiness: { requiredTender: 'cash', unreportedPaymentPermissions: 'cash_payment', deniedPaymentPermissions: { cash_payment: true } }
    }, /неочікуваний формат прав касира/]
]) {
    test(`${label} keeps readiness fail-closed without granting create`, t => {
        const f = fixture(); t.after(() => f.dom.window.close());
        f.window.canAccess = () => true;
        f.page.addCatalogLine();
        f.page.state.registerState = registerState;
        f.page.renderReadinessState();
        f.page.syncCreateAvailability();
        assert.equal(f.el('createPaymentOrderBtn').disabled, true);
        assert.equal(f.el('cashierReadinessStatus').classList.contains('is-blocked'), true);
        assert.match(f.el('cashierReadinessTechnicalList').textContent, expectedText);
        assert.doesNotMatch(f.el('cashierReadinessSummary').textContent, /готова до оплати/);
    });
}

test('changing cashier invalidates old green readiness before the new lookup returns', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.addCatalogLine();
    f.page.state.registerState = {
        success: true,
        integrationReady: true,
        readinessCode: 'ready',
        requiredTender: 'cash',
        readiness: { integrationReady: true, readinessCode: 'ready', requiredTender: 'cash' }
    };
    f.page.renderReadinessState();
    f.page.syncCreateAvailability();
    assert.equal(f.el('createPaymentOrderBtn').disabled, false);

    let releaseLookup;
    const lookup = new Promise(resolve => { releaseLookup = resolve; });
    f.window.fetch = async (path, options = {}) => {
        const url = String(path);
        const method = String(options.method || 'GET').toUpperCase();
        if (url.startsWith('/api/payments/pilot-register-state') && method === 'GET') {
            await lookup;
            return jsonResponse(200, {
                success: true,
                integrationReady: true,
                readinessCode: 'ready',
                fiscalProfileId: 1,
                fiscalLocationId: 1,
                fiscalRegisterId: 2,
                requiredTender: 'cash',
                readiness: { readinessCode: 'ready', integrationReady: true, requiredTender: 'cash' }
            });
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
    };

    f.el('paymentCashierBinding').value = '4';
    f.el('paymentCashierBinding').dispatchEvent(new f.window.Event('change', { bubbles: true }));
    assert.equal(f.page.state.registerState, null);
    assert.equal(f.el('createPaymentOrderBtn').disabled, true);
    assert.match(f.el('cashierReadinessSummary').textContent, /Каса ще не готова|Не вдалося прочитати стан/);
    releaseLookup();
    await new Promise(resolve => setTimeout(resolve, 0));
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
    const calls = { confirm: 0, orderRead: 0 };
    f.window.fetch = async (path, options = {}) => {
        const url = String(path);
        const method = String(options.method || 'GET').toUpperCase();
        if (url === '/api/payments/orders/10/confirm' && method === 'POST') {
            calls.confirm += 1;
            return confirmResponse();
        }
        if (url === '/api/payments/orders/10' && method === 'GET') {
            calls.orderRead += 1;
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
        if (url.startsWith('/api/payments/checkbox-sales-report') && method === 'GET') {
            return jsonResponse(200, {
                success: true,
                internalReport: true,
                officialZReport: false,
                page: 1,
                pageSize: 50,
                totalCount: 0,
                filters: {},
                totals: { paymentTotalMinor: '0', cashTotalMinor: '0', cardTerminalTotalMinor: '0', statusCounts: {} },
                orders: []
            });
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
    };
    return calls;
}

function historyReport({ page = 1, pageSize = 50, totalCount = 1, orders, statusCounts } = {}) {
    return {
        success: true,
        internalReport: true,
        officialZReport: false,
        page,
        pageSize,
        totalCount,
        filters: {},
        totals: {
            paymentTotalMinor: '10000',
            cashTotalMinor: '7000',
            cardTerminalTotalMinor: '3000',
            statusCounts: statusCounts || { fiscalized: totalCount }
        },
        orders: orders || [{
            id: 71,
            confirmedAt: '2026-09-11T08:33:34.077Z',
            paymentMethod: 'cash',
            paymentStatus: 'confirmed',
            fiscalStatus: 'fiscalized',
            totalAmountMinor: '10000',
            providerTaxUrl: 'https://api.checkbox.ua/receipts/71',
            providerPdfUrl: 'https://api.checkbox.ua/receipts/71.pdf',
            providerQrUrl: 'https://api.checkbox.in.ua/receipts/71/qr'
        }]
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
    assert.equal(f.page.state.paymentErrorActive, true);
    assert.equal(f.el('confirmCashBtn').disabled, false);
    assert.match(f.el('cashierGlobalStatus').textContent, /Checkbox не повідомив право касира на готівку/);
    await f.page.loadCheckboxSalesReport({ silent: false });
    assert.match(f.el('cashierGlobalStatus').textContent, /Checkbox не повідомив право касира на готівку/);
    f.el('cashReceivedAmount').value = '11';
    f.el('cashReceivedAmount').dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(f.page.state.paymentErrorActive, false);
    assert.equal(f.el('cashierGlobalStatus').classList.contains('hidden'), true);
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
    assert.match(f.el('fiscalPendingMessage').textContent, /Результат підтвердження уточнюється/);
});

test('unknown 409 confirmation result stays pending even when reread shows unpaid draft', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.orderDetails = { order: draftOrder(10), items: [] };
    f.el('cashReceivedAmount').value = '10';
    const calls = installPaymentFetch(f, () => jsonResponse(409, {
        success: false,
        code: 'unexpected_provider_state',
        error: 'Provider result is unknown'
    }));
    await f.page.confirmPayment();
    const confirmKey = f.page.getConfirmIdempotencyKey(10);
    assert.equal(f.page.state.confirmSubmitted, true);
    assert.equal(f.page.state.confirmOutcomePending, true);
    assert.equal(f.el('confirmCashBtn').disabled, true);
    assert.match(f.el('cashierGlobalStatus').textContent, /Результат підтвердження уточнюється/);
    assert.match(f.el('fiscalPendingMessage').textContent, /Результат підтвердження уточнюється/);
    assert.equal(f.el('startNextOrderBtn').textContent, 'Звірити цей продаж');
    assert.equal(f.el('startNextOrderBtn').classList.contains('hidden'), false);
    await f.page.startNextOrder();
    assert.equal(calls.confirm, 1);
    assert.equal(calls.orderRead, 2);
    assert.equal(f.page.getConfirmIdempotencyKey(10), confirmKey);
    assert.equal(f.page.state.confirmOutcomePending, true);
    assert.equal(f.el('cancelDraftOrderBtn').disabled, true);
});

test('known 422 pre-payment rejection restores the draft without marking outcome unknown', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.orderDetails = { order: draftOrder(10), items: [] };
    f.el('cashReceivedAmount').value = '10';
    installPaymentFetch(f, () => jsonResponse(422, {
        success: false,
        code: 'cashier_binding_scope_invalid',
        error: 'Cashier binding does not belong to this register'
    }));
    await f.page.confirmPayment();
    assert.equal(f.page.state.confirmSubmitted, false);
    assert.equal(f.page.state.confirmOutcomePending, false);
    assert.equal(f.el('confirmCashBtn').disabled, false);
    assert.equal(f.el('cancelDraftOrderBtn').disabled, false);
    assert.match(f.el('cashierGlobalStatus').textContent, /Обраний касир не належить цій касі/);
    assert.doesNotMatch(f.el('fiscalPendingMessage').textContent, /уточнюється/);
});

for (const [status, code] of [
    [422, 'unexpected_validation_state'],
    [503, 'checkbox_payment_permission_unreported']
]) {
    test(`HTTP ${status} ${code} keeps the same order locked until reconciliation`, async t => {
        const f = fixture(); t.after(() => f.dom.window.close());
        f.page.state.orderDetails = { order: draftOrder(10), items: [] };
        f.el('cashReceivedAmount').value = '10';
        installPaymentFetch(f, () => jsonResponse(status, {
            success: false,
            code,
            error: 'Provider result is not safely classified',
            details: { requiredTender: 'cash', unreportedPaymentPermissions: ['cash_payment'] }
        }));
        await f.page.confirmPayment();
        assert.equal(f.page.state.confirmSubmitted, true);
        assert.equal(f.page.state.confirmOutcomePending, true);
        assert.equal(f.el('confirmCashBtn').disabled, true);
        assert.equal(f.el('cancelDraftOrderBtn').disabled, true);
        assert.match(f.el('cashierGlobalStatus').textContent, /Результат підтвердження уточнюється/);
        assert.match(f.el('fiscalPendingMessage').textContent, /Результат підтвердження уточнюється/);
        await f.page.loadCheckboxSalesReport({ silent: false });
        assert.match(f.el('cashierGlobalStatus').textContent, /Результат підтвердження уточнюється/);
        assert.equal(f.window.__notifications.some(item => item.type === 'success' && /Історію чеків/.test(item.message)), false);
    });
}

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
    assert.match(f.el('fiscalPendingMessage').textContent, /Результат підтвердження уточнюється/);
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
    assert.match(f.el('fiscalPendingMessage').textContent, /Результат підтвердження уточнюється/);
});

test('double confirm click sends one request and keeps the same order idempotency key', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.orderDetails = { order: draftOrder(10), items: [] };
    f.el('cashReceivedAmount').value = '10';
    let releaseConfirm;
    const confirmStarted = new Promise(resolve => { releaseConfirm = resolve; });
    let confirmCalls = 0;
    const confirmKeys = [];
    f.window.fetch = async (path, request = {}) => {
        const url = String(path);
        const method = String(request.method || 'GET').toUpperCase();
        if (url === '/api/payments/orders/10/confirm' && method === 'POST') {
            confirmCalls += 1;
            confirmKeys.push(request.headers?.['Idempotency-Key']);
            await confirmStarted;
            return jsonResponse(200, {
                success: true,
                order: { ...draftOrder(10), paymentStatus: 'confirmed', status: 'payment_recorded' }
            });
        }
        if (url === '/api/payments/orders/10' && method === 'GET') {
            return jsonResponse(200, {
                success: true,
                order: { ...draftOrder(10), paymentStatus: 'confirmed', status: 'payment_recorded', fiscalStatus: 'pending' },
                items: [],
                receipts: [],
                artifacts: {}
            });
        }
        if (url.startsWith('/api/payments/pilot-register-state') && method === 'GET') {
            return jsonResponse(200, {
                success: true,
                integrationReady: true,
                readinessCode: 'ready',
                fiscalProfileId: 1,
                fiscalLocationId: 1,
                fiscalRegisterId: 2,
                requiredTender: 'cash',
                readiness: { readinessCode: 'ready', integrationReady: true, requiredTender: 'cash' }
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
                registerCount: 1,
                myCount: 1,
                hasMore: false,
                snapshotRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                nextCursor: null,
                orders: [{ id: 10, isMine: true, paymentStatus: 'confirmed', fiscalStatus: 'pending', totalAmountMinor: '1000' }]
            });
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
    };
    const first = f.page.confirmPayment();
    const second = f.page.confirmPayment();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(confirmCalls, 1);
    assert.ok(confirmKeys[0]);
    releaseConfirm();
    await Promise.all([first, second]);
    assert.equal(confirmCalls, 1);
    assert.deepEqual(confirmKeys, [confirmKeys[0]]);
    assert.equal(f.page.state.orderDetails.order.id, 10);
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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function readDetails(order, progress = null) {
    return {
        success: true,
        order,
        items: [],
        receipts: order.fiscalStatus === 'fiscalized' ? [{ status: 'fiscalized' }] : [],
        artifacts: {},
        ...(progress ? { progress } : {})
    };
}

function queuePayload(orders = []) {
    return {
        success: true,
        registerWide: true,
        fiscalProfileId: 1,
        fiscalLocationId: 1,
        fiscalRegisterId: 2,
        page: 1,
        pageSize: 50,
        registerCount: orders.length,
        myCount: orders.length,
        hasMore: false,
        snapshotRevision: 'cccccccccccccccccccccccccccccccc',
        nextCursor: null,
        orders
    };
}

function installReadCoordinatorFetch(f, { orderRead, queueRead } = {}) {
    const calls = { order: 0, queue: 0, readiness: 0 };
    f.window.fetch = async (path, request = {}) => {
        const url = String(path);
        const method = String(request.method || 'GET').toUpperCase();
        if (/^\/api\/payments\/orders\/\d+$/.test(url) && method === 'GET') {
            calls.order += 1;
            return typeof orderRead === 'function'
                ? orderRead(calls.order)
                : jsonResponse(200, readDetails(draftOrder(Number(url.split('/').pop()))));
        }
        if (url.startsWith('/api/payments/unresolved-orders') && method === 'GET') {
            calls.queue += 1;
            return typeof queueRead === 'function'
                ? queueRead(calls.queue)
                : jsonResponse(200, queuePayload());
        }
        if (url.startsWith('/api/payments/pilot-register-state') && method === 'GET') {
            calls.readiness += 1;
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
        throw new Error(`unexpected fetch ${method} ${url}`);
    };
    return calls;
}

test('same order and queue reads are single-flight within one interaction scope', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const orderResponse = deferred();
    const queueResponse = deferred();
    const calls = installReadCoordinatorFetch(f, {
        orderRead: () => orderResponse.promise,
        queueRead: () => queueResponse.promise
    });

    const firstOrder = f.page.loadPaymentOrder(10, { silent: true });
    const secondOrder = f.page.loadPaymentOrder(10, { silent: true });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.order, 1);
    orderResponse.resolve(jsonResponse(200, readDetails(draftOrder(10))));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.queue, 1);
    const directQueue = f.page.loadUnresolvedOrders({ silent: true });
    assert.equal(calls.queue, 1);
    queueResponse.resolve(jsonResponse(200, queuePayload()));
    await Promise.all([firstOrder, secondOrder, directQueue]);
    assert.equal(calls.order, 1);
    assert.equal(calls.queue, 1);
});

test('tender change rejects a late order reply from the previous interaction generation', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const oldOrderResponse = deferred();
    const calls = installReadCoordinatorFetch(f, { orderRead: () => oldOrderResponse.promise });
    const staleLoad = f.page.loadPaymentOrder(10, { silent: true });
    await new Promise(resolve => setImmediate(resolve));
    const card = f.window.document.querySelector('input[name="paymentTender"][value="card_terminal_manual"]');
    card.checked = true;
    card.dispatchEvent(new f.window.Event('change', { bubbles: true }));
    oldOrderResponse.resolve(jsonResponse(200, readDetails({ ...draftOrder(10), sourceSnapshot: { tender: 'cash' } })));
    await staleLoad;
    assert.equal(calls.order, 1);
    assert.equal(f.page.state.tender, 'card_terminal_manual');
    assert.equal(f.page.state.orderDetails, null);
});

test('cashier change rejects a late order reply from the previous interaction generation', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const oldOrderResponse = deferred();
    installReadCoordinatorFetch(f, { orderRead: () => oldOrderResponse.promise });
    const staleLoad = f.page.loadPaymentOrder(10, { silent: true });
    await new Promise(resolve => setImmediate(resolve));
    f.el('paymentCashierBinding').value = '4';
    f.el('paymentCashierBinding').dispatchEvent(new f.window.Event('change', { bubbles: true }));
    oldOrderResponse.resolve(jsonResponse(200, readDetails(draftOrder(10))));
    await staleLoad;
    assert.equal(f.el('paymentCashierBinding').value, '4');
    assert.equal(f.page.state.orderDetails, null);
});

test('global business context change rejects an old order response while loading the new route scope', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const oldOrderResponse = deferred();
    const calls = installReadCoordinatorFetch(f, {
        orderRead: () => oldOrderResponse.promise,
        queueRead: () => jsonResponse(200, queuePayload())
    });
    const originalFetch = f.window.fetch;
    f.window.fetch = async (path, request = {}) => {
        const url = String(path);
        if (url.startsWith('/api/payments/catalog/cashiers')) return jsonResponse(200, { cashiers: [{ id: 3, cashierName: 'Test cashier', mode: 'test' }] });
        if (url.startsWith('/api/payments/catalog/items')) return jsonResponse(200, { items: [{ itemCode: 'dar-item', name: 'DAR item', category: 'DAR', priceMinor: '1000' }] });
        if (url.startsWith('/api/payments/catalog/discounts')) return jsonResponse(200, { discounts: [] });
        return originalFetch(path, request);
    };
    f.page.state.routeOptions = [
        { id: 'park_production', businessContext: 'event_genix', configured: true, status: 'active', featureEnabled: true, acceptanceEnabled: true, sequentialReady: true, mode: 'production', registerLabel: 'Park' },
        { id: 'dar_test', businessContext: 'dar', configured: true, status: 'active', featureEnabled: true, acceptanceEnabled: true, sequentialReady: true, mode: 'test', registerLabel: 'Test' }
    ];
    f.page.renderRouteSelectors();
    assert.equal(f.el('paymentBusinessContext').disabled, true);
    assert.equal(f.el('paymentRegisterRoute').value, 'park_production');
    const staleLoad = f.page.loadPaymentOrder(10, { silent: true });
    await new Promise(resolve => setImmediate(resolve));
    f.window.localStorage.setItem('pzp_crm_business_context', 'dar');
    f.window.localStorage.setItem('pzp_crm_business_context_user', '1');
    f.window.dispatchEvent(new f.window.CustomEvent('crmBusinessContextChanged', { detail: { previous: 'event_genix', current: 'dar' } }));
    oldOrderResponse.resolve(jsonResponse(200, readDetails(draftOrder(10))));
    await staleLoad;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.order, 1);
    assert.equal(new URL(f.window.location.href).searchParams.get('routeOptionId'), 'dar_test');
    assert.equal(f.page.PILOT_SCOPE.crmProfileKey, 'dar');
    assert.equal(f.page.state.orderDetails, null);
});

test('mixed business and register scope cannot submit another business cashier route', t => {
    const f = fixture('event_genix', 'dar_test'); t.after(() => f.dom.window.close());
    f.page.state.routeOptions = [
        { id: 'park_production', businessContext: 'event_genix', configured: true, status: 'active', featureEnabled: true, acceptanceEnabled: true, sequentialReady: true, mode: 'production', registerLabel: 'Park' },
        { id: 'dar_test', businessContext: 'dar', configured: true, status: 'active', featureEnabled: true, acceptanceEnabled: true, sequentialReady: true, mode: 'test', registerLabel: 'DAR test' }
    ];

    assert.throws(() => f.page.buildCatalogSalePayload(), error => error.code === 'fiscal_route_option_invalid');

    f.page.renderRouteSelectors();
    assert.equal(f.el('paymentBusinessContext').value, 'event_genix');
    assert.equal(f.el('paymentBusinessContext').disabled, true);
    assert.equal(f.el('paymentRegisterRoute').value, 'park_production');
    assert.equal(f.page.PILOT_SCOPE.crmProfileKey, 'event_genix');
    assert.equal(f.page.PILOT_SCOPE.routeOptionId, 'park_production');

    f.page.addCatalogLine('same');
    const payload = f.page.buildCatalogSalePayload();
    assert.equal(payload.businessContext, 'event_genix');
    assert.equal(payload.routeOptionId, 'park_production');
});

test('completed order cannot regress to pending and server progress is rendered without invented success', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const responses = [
        readDetails({ ...draftOrder(10), status: 'payment_recorded', paymentStatus: 'confirmed', fiscalStatus: 'fiscalized' }, { stage: 'complete' }),
        readDetails({ ...draftOrder(10), status: 'payment_recorded', paymentStatus: 'confirmed', fiscalStatus: 'pending' }, {
            stage: 'awaiting_receipt',
            lastCheckAt: '2026-09-11T09:00:00.000Z',
            nextCheckAt: '2026-09-11T09:00:05.000Z'
        })
    ];
    installReadCoordinatorFetch(f, { orderRead: call => jsonResponse(200, responses[call - 1]) });
    await f.page.loadPaymentOrder(10, { silent: true });
    assert.match(f.el('fiscalPendingMessage').textContent, /Офіційний чек Checkbox отримано/);
    await f.page.loadPaymentOrder(10, { silent: true });
    assert.equal(f.page.state.orderDetails.order.fiscalStatus, 'fiscalized');
    assert.equal(f.el('fiscalReceiptBadge').textContent, 'чек створено');

    f.page.state.orderDetails = responses[1];
    f.page.renderOrder(responses[1]);
    assert.match(f.el('fiscalPendingMessage').textContent, /Checkbox ще обробляє чек/);
    assert.match(f.el('fiscalPendingMessage').textContent, /Наступна серверна перевірка/);
    assert.doesNotMatch(f.el('fiscalPendingMessage').textContent, /чек.*створено/i);
});

test('canonical queue, not receipt history, owns the pending recovery cache', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const key = 'eventgenix:cashier-payments:u:1:route:park_production:fp:1:fr:2:pendingOrderIds';
    f.window.localStorage.setItem(key, JSON.stringify(['10']));
    f.page.renderCheckboxSalesReport({
        page: 1,
        pageSize: 50,
        totalCount: 1,
        totals: { statusCounts: { fiscalized: 1 } },
        orders: [{ id: 10, paymentStatus: 'confirmed', fiscalStatus: 'fiscalized', incidentReason: 'provider_unavailable' }]
    });
    assert.deepEqual(JSON.parse(f.window.localStorage.getItem(key)), ['10']);
    assert.match(f.el('checkboxSalesReportBody').textContent, /лишився окремий запис контролю/);
    assert.doesNotMatch(f.el('checkboxSalesReportBody').textContent, /оплата не пройшла/i);
});

test('first history open sends one GET and repeated toggles do not duplicate or reload it', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const response = deferred();
    const requests = [];
    f.window.fetch = async (path, options = {}) => {
        assert.equal(String(options.method || 'GET').toUpperCase(), 'GET');
        requests.push(new URL(String(path), 'http://localhost'));
        return response.promise;
    };
    f.el('checkboxSalesReportPanel').open = true;
    f.el('checkboxSalesReportPanel').dispatchEvent(new f.window.Event('toggle'));
    f.page.loadReceiptHistoryOnOpen();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.equal(f.el('loadCheckboxSalesReportBtn').textContent, 'Оновлюємо…');
    response.resolve(jsonResponse(200, historyReport()));
    await f.page.state.reportRequest.promise;
    f.el('checkboxSalesReportPanel').open = false;
    f.el('checkboxSalesReportPanel').dispatchEvent(new f.window.Event('toggle'));
    f.el('checkboxSalesReportPanel').open = true;
    f.el('checkboxSalesReportPanel').dispatchEvent(new f.window.Event('toggle'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.equal(f.el('loadCheckboxSalesReportBtn').textContent, 'Оновити');
});

test('a later history filter wins when responses arrive in reverse order', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const firstResponse = deferred();
    const requests = [];
    f.window.fetch = async path => {
        const url = new URL(String(path), 'http://localhost');
        requests.push(url);
        if (requests.length === 1) return firstResponse.promise;
        return jsonResponse(200, historyReport({
            orders: [{ id: 82, confirmedAt: '2026-09-10T08:00:00.000Z', paymentMethod: 'card_terminal', fiscalStatus: 'fiscalized', totalAmountMinor: '3000' }]
        }));
    };
    f.el('checkboxSalesReportPanel').open = true;
    const oldLoad = f.page.loadCheckboxSalesReport({ silent: true });
    await new Promise(resolve => setImmediate(resolve));
    f.page.applyReceiptHistoryPeriod('yesterday', { load: false });
    const currentLoad = f.page.loadCheckboxSalesReport({ silent: true });
    await currentLoad;
    firstResponse.resolve(jsonResponse(200, historyReport({
        orders: [{ id: 81, confirmedAt: '2026-09-11T08:00:00.000Z', paymentMethod: 'cash', fiscalStatus: 'fiscalized', totalAmountMinor: '7000' }]
    })));
    await oldLoad;
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].searchParams.get('dateFrom'), requests[1].searchParams.get('dateFrom'));
    assert.match(f.el('checkboxSalesReportBody').textContent, /RCP-82/);
    assert.doesNotMatch(f.el('checkboxSalesReportBody').textContent, /RCP-81/);
    assert.match(f.el('checkboxReportAppliedFilter').textContent, /Вчора/);
});

test('manual history dates stay ordered and reset pagination before loading', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.reportPage = 3;
    f.el('checkboxReportDateFrom').value = '2026-09-11';
    f.el('checkboxReportDateTo').value = '2026-09-10';
    f.page.handleReceiptHistoryFilterChange({ load: false, changedId: 'checkboxReportDateFrom' });
    assert.equal(f.el('checkboxReportDateTo').value, '2026-09-11');
    assert.equal(f.el('checkboxReportDateTo').min, '2026-09-11');
    assert.equal(f.page.state.reportPage, 1);

    f.el('checkboxReportDateTo').value = '2026-09-09';
    f.page.handleReceiptHistoryFilterChange({ load: false, changedId: 'checkboxReportDateTo' });
    assert.equal(f.el('checkboxReportDateFrom').value, '2026-09-09');
    assert.equal(f.el('checkboxReportDateFrom').max, '2026-09-09');
});

test('history renders filter-wide totals, separate blocker groups, safe links and pagination', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.state.reportPage = 2;
    f.page.renderCheckboxSalesReport(historyReport({
        page: 2,
        totalCount: 75,
        statusCounts: { fiscalized: 69, pending: 2, failed_retryable: 1, unknown: 1, failed_terminal: 1, dead: 1 },
        orders: [{
            id: 91,
            confirmedAt: '2026-09-11T08:33:34.077Z',
            paymentMethod: 'cash',
            fiscalStatus: 'fiscalized',
            totalAmountMinor: '10000',
            providerTaxUrl: 'https://api.checkbox.ua/receipts/91',
            providerPdfUrl: 'https://api.checkbox.ua.attacker.test/91.pdf',
            providerQrUrl: 'https://api.checkbox.in.ua/receipts/91/qr'
        }]
    }), f.page.receiptHistorySnapshot({ page: 2 }));
    assert.equal(f.window.document.querySelectorAll('.cashier-history-totals > div').length, 7);
    assert.match(f.el('checkboxSalesReportBody').textContent, /В обробці\s*3/);
    assert.match(f.el('checkboxSalesReportBody').textContent, /Невідомо\s*1/);
    assert.match(f.el('checkboxSalesReportBody').textContent, /Зупинено\s*2/);
    assert.equal(f.el('checkboxReportRange').textContent, '51–75 із 75');
    assert.equal(f.el('checkboxReportPreviousPage').disabled, false);
    assert.equal(f.el('checkboxReportNextPage').disabled, true);
    assert.equal(f.window.document.querySelectorAll('.cashier-history-link').length, 2);
    assert.doesNotMatch(f.el('checkboxSalesReportBody').innerHTML, /attacker\.test/);
    assert.doesNotMatch(f.el('checkboxSalesReportBody').textContent, /Після оновлення.*зникне/);
});

test('X report affordance is disabled without an active shift and does not call a provider endpoint', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    let fetchCalls = 0;
    f.window.fetch = async () => {
        fetchCalls += 1;
        throw new Error('unexpected provider call');
    };
    f.page.renderFiscalReportsPanel();
    assert.equal(f.el('createXReportBtn').disabled, true);
    assert.match(f.el('fiscalReportsNotice').textContent, /Немає активної зміни/);
    f.page.createXReportFromPanel();
    assert.equal(fetchCalls, 0);
    assert.equal(f.window.__notifications.at(-1).type, 'error');
    assert.match(f.window.__notifications.at(-1).message, /X-звіт недоступний|Немає активної зміни/);
});

test('Z report affordance reuses guarded phase1 close instead of a separate report endpoint', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.window.canAccess = action => action === 'fiscal.shift.close';
    let confirmCalls = 0;
    let fetchCalls = 0;
    f.window.confirmModal = async () => {
        confirmCalls += 1;
        return false;
    };
    f.window.fetch = async () => {
        fetchCalls += 1;
        throw new Error('unexpected provider call');
    };
    Object.assign(f.page.state, {
        unresolvedQueueState: 'available',
        unresolvedRegisterCount: 0,
        unresolvedLastRefreshAt: Date.now(),
        registerState: {
            integrationReady: true,
            shift: { id: 77, status: 'open' },
            phase1Close: { visible: true, allowed: true, shiftId: 77, status: 'opened' }
        }
    });
    f.page.renderFiscalReportsPanel();
    assert.equal(f.el('closeZReportBtn').disabled, false);
    f.page.requestZReportClose();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(confirmCalls, 1);
    assert.equal(fetchCalls, 0);
    assert.doesNotMatch(f.el('fiscalReportsNotice').textContent, /окремий report endpoint/i);
});

test('service-out binding 403 becomes scoped unavailable state without enabling request', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.window.canAccess = action => action === 'fiscal.service_out.request';
    f.page.state.registerState = {
        integrationReady: true,
        shift: { id: 77, status: 'open' }
    };
    f.window.fetch = async path => {
        assert.match(String(path), /^\/api\/payments\/service-out\?/);
        return jsonResponse(403, {
            success: false,
            code: 'fiscal_binding_capability_denied',
            error: 'binding denied'
        });
    };

    await f.page.loadServiceOutRequests({ silent: false });

    assert.equal(f.page.state.serviceOutCapabilityDenied, true);
    assert.equal(f.page.state.serviceOutLastError, null);
    assert.equal(f.el('createServiceOutBtn').disabled, true);
    assert.match(f.el('serviceOutNotice').textContent, /прив’язка касира не дозволяє service-out/);
    assert.match(f.el('serviceOutList').textContent, /недоступний для поточної прив’язки/);
    assert.equal(f.window.__notifications.at(-1).type, 'info');
});

test('Z report stays disabled during route and readiness loading even with stale close context', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.window.canAccess = action => action === 'fiscal.shift.close';
    let confirmCalls = 0;
    f.window.confirmModal = async () => {
        confirmCalls += 1;
        return false;
    };
    Object.assign(f.page.state, {
        unresolvedQueueState: 'available',
        unresolvedRegisterCount: 0,
        unresolvedLastRefreshAt: Date.now(),
        registerState: {
            integrationReady: true,
            shift: { id: 77, status: 'open' },
            phase1Close: { visible: true, allowed: true, shiftId: 77, status: 'opened' }
        }
    });
    f.page.renderFiscalReportsPanel();
    assert.equal(f.el('closeZReportBtn').disabled, false);

    f.page.state.routeLoading = true;
    f.page.renderFiscalReportsPanel();
    assert.equal(f.el('closeZReportBtn').disabled, true);
    assert.match(f.el('fiscalReportsNotice').textContent, /Оновлюємо напрямок і касу/);
    f.page.requestZReportClose();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(confirmCalls, 0);
    assert.equal(f.window.__notifications.at(-1).type, 'error');
});

test('failed same-filter refresh preserves visibly stale rows instead of reporting zero', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    f.page.renderCheckboxSalesReport(historyReport());
    f.window.fetch = async () => jsonResponse(500, { success: false, code: 'history_failed', error: 'history failed' });
    await f.page.loadCheckboxSalesReport({ silent: true });
    assert.match(f.el('checkboxSalesReportBody').textContent, /RCP-71/);
    assert.equal(f.el('checkboxSalesReportBody').classList.contains('is-stale'), true);
    assert.equal(f.el('checkboxSalesReportBody').classList.contains('is-error'), true);
    assert.match(f.el('checkboxReportRefreshStatus').textContent, /попередні дані.*неактуальними/);
});

for (const [label, failure] of [
    ['403', () => jsonResponse(403, { success: false, code: 'forbidden', error: 'forbidden' })],
    ['500', () => jsonResponse(500, { success: false, code: 'history_failed', error: 'history failed' })],
    ['offline', () => { throw new Error('offline'); }]
]) {
    test(`history ${label} is an explicit error and never an empty result`, async t => {
        const f = fixture(); t.after(() => f.dom.window.close());
        f.window.fetch = async () => failure();
        await f.page.loadCheckboxSalesReport({ silent: true });
        assert.equal(f.page.state.receiptHistoryLoaded, false);
        assert.equal(f.el('checkboxSalesReportBody').classList.contains('is-error'), true);
        assert.match(f.el('checkboxSalesReportBody').textContent, /Дані не вважаються порожніми/);
        assert.doesNotMatch(f.el('checkboxSalesReportBody').textContent, /чеків немає/);
    });
}

test('pending queue uses a fast bounded timer while hidden pages schedule no polling', t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const scheduled = [];
    f.window.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
    };
    f.window.clearTimeout = () => {};
    f.page.state.unresolvedAutoRefreshEnabled = true;
    f.page.state.unresolvedQueueState = 'available';
    f.page.state.unresolvedRegisterCount = 1;
    f.page.state.unresolvedLastRefreshAt = Date.now();
    f.page.state.unresolvedFastRefreshStartedAt = Date.now();
    f.page.scheduleUnresolvedRefresh();
    assert.equal(scheduled.at(-1).delay, 2500);

    f.page.state.unresolvedRegisterCount = 0;
    f.page.state.unresolvedFastRefreshStartedAt = 0;
    f.page.scheduleUnresolvedRefresh();
    assert.ok(scheduled.at(-1).delay < 60000, 'empty queue refresh is scheduled before the unchanged freshness TTL');
    assert.ok(scheduled.at(-1).delay >= 50000, 'empty queue avoids the pending fast cadence');
    f.page.state.unresolvedQueueState = 'unavailable';
    f.page.state.unresolvedRefreshBackoffMs = 30000;
    f.page.scheduleUnresolvedRefresh();
    assert.equal(scheduled.at(-1).delay, 30000, 'offline queue uses bounded recovery backoff instead of fast polling');

    Object.defineProperty(f.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
    const beforeHiddenSchedule = scheduled.length;
    f.page.scheduleUnresolvedRefresh();
    f.page.state.orderDetails = readDetails({ ...draftOrder(10), status: 'payment_recorded', paymentStatus: 'confirmed', fiscalStatus: 'pending' }, { stage: 'awaiting_receipt' });
    f.page.syncOrderPolling(f.page.state.orderDetails.order);
    assert.equal(scheduled.length, beforeHiddenSchedule);
});

test('order polling leaves the fast cadence after a read error', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    const scheduled = [];
    f.window.setTimeout = (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
    };
    f.window.clearTimeout = () => {};
    f.window.fetch = async path => {
        if (/^\/api\/payments\/orders\/10$/.test(String(path))) throw new Error('offline');
        throw new Error(`unexpected fetch ${path}`);
    };
    f.page.state.orderDetails = readDetails({
        ...draftOrder(10),
        status: 'payment_recorded',
        paymentStatus: 'confirmed',
        fiscalStatus: 'pending'
    }, { stage: 'awaiting_receipt' });
    f.page.syncOrderPolling(f.page.state.orderDetails.order);
    assert.equal(scheduled[0].delay, 2500);
    await scheduled[0].callback();
    assert.equal(scheduled.at(-1).delay, 30000);
    assert.match(f.el('cashierGlobalStatus').textContent, /Не вдалося виконати дію/);
});

test('visibility return performs one coordinated CRM refresh and applies a completed receipt', async t => {
    const f = fixture(); t.after(() => f.dom.window.close());
    let visibility = 'visible';
    Object.defineProperty(f.window.document, 'visibilityState', {
        configurable: true,
        get: () => visibility
    });
    const calls = installReadCoordinatorFetch(f, {
        orderRead: () => jsonResponse(200, readDetails({
            ...draftOrder(10),
            status: 'payment_recorded',
            paymentStatus: 'confirmed',
            fiscalStatus: 'fiscalized'
        }, { stage: 'complete', stageUpdatedAt: '2026-09-11T09:00:01.000Z' }))
    });
    f.page.state.unresolvedAutoRefreshEnabled = true;
    f.page.state.unresolvedQueueState = 'available';
    f.page.state.unresolvedLastRefreshAt = Date.now();
    f.page.state.orderDetails = readDetails({
        ...draftOrder(10),
        status: 'payment_recorded',
        paymentStatus: 'confirmed',
        fiscalStatus: 'pending'
    }, { stage: 'awaiting_receipt' });
    f.page.syncOrderPolling(f.page.state.orderDetails.order);

    visibility = 'hidden';
    f.window.document.dispatchEvent(new f.window.Event('visibilitychange'));
    assert.equal(f.page.state.pollingTimer, null);
    assert.equal(f.page.state.unresolvedRefreshTimer, null);

    visibility = 'visible';
    f.window.document.dispatchEvent(new f.window.Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls.order, 1);
    assert.equal(calls.queue, 1);
    assert.equal(f.page.state.orderDetails.order.fiscalStatus, 'fiscalized');
    assert.equal(f.page.state.pollingOrderId, null);
});
