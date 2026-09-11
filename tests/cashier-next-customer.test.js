'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function fixture(business = 'event_genix') {
    const root = path.join(__dirname, '..');
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'cashier-payments.html'), 'utf8'), {
        url: `http://localhost/cashier-payments?saleMode=catalog&businessContext=${business}`, runScripts: 'outside-only'
    });
    const { window } = dom;
    Object.defineProperty(window.navigator, 'locks', { value: { request: (_key, callback) => callback() } });
    // Exercise the actual page functions without authentication/bootstrap or external IO.
    const source = fs.readFileSync(path.join(root, 'js/cashier-payments-page.js'), 'utf8')
        .replace("document.addEventListener('DOMContentLoaded', () => { void initCashierPaymentsPage(); });", '')
        .replace('window.CashierPaymentsPage = {', 'window.CashierPaymentsPage = { loadCatalogData, loadCheckboxSalesReport, renderReadinessState, renderSharedTestDay, renderOrder, syncCreateAvailability, syncConfirmationAvailability, refreshCatalogSelects, startNextOrder, addCatalogLine, confirmPayment, bindEvents, clearCreateIdempotencyKey, cancelDraftOrder,');
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

    assert.match(f.el('cashierReadinessSummary').textContent, /початок наступного тестового дня недоступний/);
    assert.match(f.el('cashierReadinessTechnicalList').textContent, /відповідальний, який зупинив цю тестову касу/);
    assert.match(f.el('sharedTestDayNotice').textContent, /відповідальний, який зупинив цю тестову касу/);
    assert.equal(f.el('sharedTestResumeBtn').disabled, true);
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
            f.page.state.routeOptions = [{ id: f.page.PILOT_SCOPE.routeOptionId, mode: 'test', sequentialReady: false, readinessCode: 'shared_test_register_owned_by_other_business' }];
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
            drain_closed: /Тестову зміну закрито.*Почати наступний тестовий день/
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
        assert.equal(f.el('catalogPicker').hidden, true);
        assert.equal(f.el('addCatalogLineBtn').getAttribute('aria-expanded'), 'false');
        f.el('addCatalogLineBtn').click();
        assert.equal(f.el('catalogPicker').hidden, false);
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
        f.el('addCatalogLineBtn').click();
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
    assert.equal(f.el('catalogPicker').hidden, true);
    f.el('addCatalogLineBtn').click();
    assert.equal(f.el('catalogSaleLines').children.length, 0);
    assert.equal(f.window.document.activeElement, f.el('catalogSearch'));
    assert.equal(f.el('addCatalogLineBtn').getAttribute('aria-expanded'), 'true');
    f.page.addCatalogLine();
    f.el('catalogSearch').value = 'extra';
    const tender = f.page.state.tender;
    f.el('addCatalogLineBtn').click();
    assert.equal(f.el('catalogPicker').hidden, true);
    assert.equal(f.el('catalogSaleLines').children.length, 1);
    f.el('addCatalogLineBtn').click();
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
    f.page.state.catalogDiscounts = [{ code: 'dar_second_club_direction_10', rateBps: 1000 }];
    f.el('catalogDiscountRule').innerHTML = '<option value="dar_second_club_direction_10">10%</option>';
    f.page.addCatalogLine('same');
    assert.match(f.el('catalogDiscountExplanation').textContent, /0 грн знижки/);
    assert.match(f.el('catalogDiscountTotal').textContent, /0,00/);
    f.page.addCatalogLine('vip');
    assert.match(f.el('catalogDiscountExplanation').textContent, /другого іншого/);
    assert.match(f.el('catalogDiscountTotal').textContent, /2,50/);
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
    assert.match(f.el('fiscalPendingMessage').textContent, /Результат підтвердження уточнюється/);
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
    assert.match(f.el('fiscalPendingMessage').textContent, /Результат підтвердження уточнюється/);
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
