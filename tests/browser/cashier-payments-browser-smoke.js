#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HEADLESS = process.env.CASHIER_PAYMENTS_BROWSER_SMOKE_HEADLESS !== 'false';

function requirePlaywright() {
    try { return require('playwright'); }
    catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

const state = {
    nextOrderId: 100,
    orders: new Map(),
    createKeys: [],
    confirmKeys: [],
    shift: null,
    serviceOutOperations: new Map(),
    operationCalls: [],
    reportLoaded: false
};

function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

function readBody(req) {
    return new Promise(resolve => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch { resolve({}); }
        });
    });
}

function permissionPayload(allowed = true) {
    const capabilities = {};
    for (const key of ['page:/cashier-payments', 'action:payments.view', 'action:payments.create', 'action:payments.confirm_received', 'action:fiscal.shift.open', 'action:fiscal.shift.close', 'action:fiscal.service_in', 'action:fiscal.service_out.request', 'action:fiscal.service_out.approve', 'action:fiscal.refund', 'action:fiscal.reconcile', 'action:fiscal.audit.view']) {
        capabilities[key] = { allowed, source: allowed ? 'server_effective' : 'default_deny', reason: allowed ? 'smoke_allow' : 'smoke_deny', key: key.split(':')[1], type: key.split(':')[0] };
    }
    return {
        capabilities,
        pages: { '/cashier-payments': allowed },
        actions: { 'payments.view': allowed, 'payments.create': allowed, 'payments.confirm_received': allowed, 'fiscal.shift.open': allowed, 'fiscal.shift.close': allowed, 'fiscal.service_in': allowed, 'fiscal.service_out.request': allowed, 'fiscal.service_out.approve': allowed, 'fiscal.refund': allowed, 'fiscal.reconcile': allowed, 'fiscal.audit.view': allowed },
        pageAllowlist: allowed ? ['/cashier-payments'] : [],
        pageDenylist: allowed ? [] : ['/cashier-payments'],
        actionAllowlist: allowed ? ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open', 'fiscal.shift.close', 'fiscal.service_in', 'fiscal.service_out.request', 'fiscal.service_out.approve', 'fiscal.refund', 'fiscal.reconcile', 'fiscal.audit.view'] : [],
        actionDenylist: allowed ? [] : ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open', 'fiscal.shift.close', 'fiscal.service_in', 'fiscal.service_out.request', 'fiscal.service_out.approve', 'fiscal.refund', 'fiscal.reconcile', 'fiscal.audit.view'],
        capabilityCatalog: {
            pageRoles: { '/cashier-payments': ['reception'] },
            actionRoles: { 'payments.view': ['reception'], 'payments.create': ['reception'], 'payments.confirm_received': ['reception'], 'fiscal.shift.open': ['reception'], 'fiscal.shift.close': ['reception'], 'fiscal.service_in': ['reception'], 'fiscal.service_out.request': ['reception'], 'fiscal.service_out.approve': ['administrator'], 'fiscal.refund': ['administrator'], 'fiscal.reconcile': ['administrator'], 'fiscal.audit.view': ['reception'] },
            pageAliases: {}, actionAliases: {}, actionLegacyKeys: {}, explicitAllowDisabledPages: [], explicitAllowDisabledActions: [], nonDelegableActions: []
        }
    };
}

function orderDetails(order) {
    return {
        success: true,
        order: {
            id: order.id,
            fiscalProfileId: 1,
            fiscalRegisterId: 10,
            sourceType: 'admission_ticket',
            sourceId: order.sourceId,
            orderKey: `admission_ticket:${order.sourceId}`,
            status: order.status,
            paymentStatus: order.paymentStatus,
            fiscalStatus: order.fiscalStatus,
            fiscalQueueStatus: order.fiscalStatus === 'failed' ? 'failed_retryable' : order.fiscalStatus,
            paymentMethod: order.tender === 'card_terminal_manual' ? 'card_terminal' : 'cash',
            totalAmountMinor: '50000',
            currency: 'UAH',
            confirmedAt: order.paymentStatus === 'confirmed' ? '2026-08-04T10:00:00.000Z' : null,
            sourceSnapshot: { tender: order.tender, crm_profile_key: 'event_genix', register_alias: 'middle' },
            confirmationSnapshot: {},
            crmProfileKey: 'event_genix',
            legalEntityKey: 'fop_smoke',
            legalEntityName: 'Smoke FOP',
            fiscalLocationId: 7,
            registerAlias: 'middle',
            registerDisplayName: 'Middle cash desk'
        },
        items: [{ id: 1, lineNumber: 1, itemType: 'admission_ticket', itemCode: 'regular_child', itemName: 'Вхідний квиток парку', unitPriceMinor: '50000', quantityMillis: '1000', totalAmountMinor: '50000', currency: 'UAH', taxReference: 'admission_tariff:smoke' }],
        fiscalOperation: order.paymentStatus === 'confirmed' ? { id: 8, fiscalShiftId: state.shift?.id || null, status: order.fiscalStatus, provider: 'checkbox', providerOperationId: 'provider-smoke', providerStatus: order.fiscalStatus } : null,
        outboxJob: order.paymentStatus === 'confirmed' && order.fiscalStatus !== 'fiscalized' ? { id: 77, jobType: 'receipt_sell', status: 'queued', externalStage: 'receipt_lookup', attempts: 0, maxAttempts: 10, nextRunAt: '2026-08-04T10:01:00.000Z', lastErrorCode: null } : null,
        receipts: order.fiscalStatus === 'fiscalized' ? [{ id: 9, fiscalOperationId: 8, paymentOrderId: order.id, receiptType: 'sale', status: 'fiscalized', provider: 'checkbox', providerReceiptId: 'chk-smoke', providerTaxUrl: 'https://api.checkbox.ua/check', providerPdfUrl: 'https://api.checkbox.ua/check.pdf', providerQrUrl: 'https://api.checkbox.ua/qr', totalAmountMinor: '50000', currency: 'UAH', fiscalizedAt: '2026-08-04T10:00:01.000Z' }] : [],
        artifacts: order.fiscalStatus === 'fiscalized' ? { taxUrl: 'https://api.checkbox.ua/check', pdfUrl: 'https://api.checkbox.ua/check.pdf', qrUrl: 'https://api.checkbox.ua/qr' } : { taxUrl: null, pdfUrl: null, qrUrl: null }
    };
}

function ensureShift() {
    if (!state.shift) state.shift = { id: 501, status: 'open', openedAt: '2026-08-04T10:00:00.000Z', closedAt: null };
    return state.shift;
}

function activeChecklist() {
    const blockers = [];
    for (const order of state.orders.values()) {
        if (order.paymentStatus === 'confirmed' && order.fiscalStatus !== 'fiscalized') blockers.push({ id: 8, type: 'sale', status: order.fiscalStatus });
    }
    return {
        pendingUnknownOperations: blockers,
        cashExpectedMinor: '50000',
        terminalExpectedMinor: '50000',
        salesCashMinor: '50000',
        salesTerminalMinor: '50000',
        serviceInMinor: '10000',
        serviceOutMinor: '5000',
        cashRefundsMinor: '0',
        terminalRefundsMinor: '0'
    };
}

function registerStatePayload() {
    return {
        success: true,
        fiscalProfileId: 1,
        crmProfileKey: 'event_genix',
        legalEntityKey: 'fop_smoke',
        legalEntityName: 'Smoke FOP',
        fiscalLocationId: 7,
        locationAlias: 'park',
        fiscalRegisterId: 10,
        registerAlias: 'middle',
        registerDisplayName: 'Middle cash desk',
        featureEnabled: true,
        checkboxIntegrationEnabled: true,
        cashierProEnabled: false,
        mappingExists: true,
        registerFeatureEnabled: true,
        runtimeConfigResolvable: true,
        integrationReady: true,
        readinessCode: 'ready',
        shift: state.shift,
        checklist: state.shift ? activeChecklist() : null
    };
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/auth/verify') return json(res, 200, { user: { id: 50, name: 'Smoke Cashier', role: 'administrator', roles: ['reception', 'administrator'], businessProfile: 'event_genix' } });
    if (url.pathname === '/api/auth/permissions') return json(res, 200, permissionPayload(url.searchParams.get('deny') !== '1' && req.headers['x-smoke-deny'] !== '1'));
    if (url.pathname === '/api/payments/pilot-register-state' && req.method === 'GET') return json(res, 200, registerStatePayload());
    if (url.pathname === '/api/payments/readiness/probe' && req.method === 'POST') return json(res, 200, { success: true, readinessCode: 'ready', integrationReady: true });
    if (url.pathname === '/api/payments/unresolved-orders' && req.method === 'GET') {
        const orders = [...state.orders.values()]
            .filter(order => order.paymentStatus === 'confirmed' && order.fiscalStatus !== 'fiscalized')
            .map(order => ({
                id: order.id,
                orderKey: `admission_ticket:${order.sourceId}`,
                paymentStatus: order.paymentStatus,
                fiscalStatus: order.fiscalStatus === 'failed' ? 'failed_retryable' : order.fiscalStatus,
                rawFiscalStatus: order.fiscalStatus,
                totalAmountMinor: '50000',
                currency: 'UAH',
                confirmedAt: '2026-08-04T10:00:00.000Z',
                outboxStatus: 'queued',
                nextRunAt: '2026-08-04T10:01:00.000Z',
                incidentReason: null
            }));
        return json(res, 200, { success: true, fiscalProfileId: 1, fiscalRegisterId: 10, orders });
    }
    if (url.pathname === '/api/payments/checkbox-sales-report' && req.method === 'GET') {
        const orders = [...state.orders.values()]
            .filter(order => order.paymentStatus === 'confirmed')
            .map(order => ({
                id: order.id,
                paymentStatus: order.paymentStatus,
                fiscalStatus: order.fiscalStatus,
                paymentMethod: order.tender === 'card_terminal_manual' ? 'card_terminal' : 'cash',
                totalAmountMinor: '50000',
                currency: 'UAH',
                confirmedAt: '2026-08-04T10:00:00.000Z',
                providerTaxUrl: order.fiscalStatus === 'fiscalized' ? 'https://api.checkbox.ua/check' : null
            }));
        return json(res, 200, { success: true, internalReport: true, officialZReport: false, page: 1, pageSize: 50, totalCount: orders.length, filters: {}, totals: { paymentTotalMinor: String(orders.length * 50000), cashTotalMinor: '50000', cardTerminalTotalMinor: '50000', statusCounts: { pending: orders.filter(order => order.fiscalStatus === 'pending').length, fiscalized: orders.filter(order => order.fiscalStatus === 'fiscalized').length } }, orders });
    }
    if (url.pathname === '/api/payments/admission-ticket/orders' && req.method === 'POST') {
        const body = await readBody(req);
        const key = req.headers['idempotency-key'];
        state.createKeys.push(key);
        const replay = [...state.orders.values()].find(order => order.createKey === key);
        if (replay) return json(res, 200, { success: true, replayed: true, order: orderDetails(replay).order });
        const sourceId = `server-source:${body?.admissionTicket?.date || 'no-date'}:${body?.admissionTicket?.banquetGuests || 0}:${body?.admissionTicket?.banquetAdults || 0}:${body.tender || 'cash'}`;
        const order = { id: ++state.nextOrderId, sourceId, tender: body.tender || 'cash', status: 'draft', paymentStatus: 'unpaid', fiscalStatus: 'pending', createKey: key, confirmKey: null };
        state.orders.set(order.id, order);
        return json(res, 201, { success: true, replayed: false, order: orderDetails(order).order });
    }
    if (url.pathname === '/api/payments/service-in' && req.method === 'POST') {
        ensureShift();
        const key = req.headers['idempotency-key'];
        state.operationCalls.push({ type: 'service_in', key });
        return json(res, 201, { success: true, replayed: false, operationId: 601, fiscalShiftId: state.shift.id });
    }
    if (url.pathname === '/api/payments/service-out' && req.method === 'POST') {
        ensureShift();
        const key = req.headers['idempotency-key'];
        const operationId = 700 + state.serviceOutOperations.size;
        state.serviceOutOperations.set(operationId, { key, status: 'blocked' });
        state.operationCalls.push({ type: 'service_out_request', key });
        return json(res, 201, { success: true, replayed: false, operationId, fiscalShiftId: state.shift.id });
    }
    const serviceOutApproveMatch = url.pathname.match(/^\/api\/payments\/service-out\/(\d+)\/approve$/);
    if (serviceOutApproveMatch && req.method === 'POST') {
        const operationId = Number(serviceOutApproveMatch[1]);
        const operation = state.serviceOutOperations.get(operationId);
        if (!operation) return json(res, 404, { success: false, code: 'service_out_not_found' });
        operation.status = 'pending';
        state.operationCalls.push({ type: 'service_out_approve', key: req.headers['idempotency-key'] });
        return json(res, 200, { success: true, replayed: false, operationId, fiscalShiftId: state.shift.id });
    }
    const refundMatch = url.pathname.match(/^\/api\/payments\/orders\/(\d+)\/refund$/);
    if (refundMatch && req.method === 'POST') {
        ensureShift();
        state.operationCalls.push({ type: 'refund', key: req.headers['idempotency-key'] });
        return json(res, 201, { success: true, replayed: false, refundId: 801, fiscalOperationId: 802, moneyRefundStatus: 'refunded', fiscalRefundStatus: 'pending' });
    }
    const reconcileMatch = url.pathname.match(/^\/api\/payments\/shifts\/(\d+)\/reconcile$/);
    if (reconcileMatch && req.method === 'POST') {
        state.operationCalls.push({ type: 'reconcile', key: req.headers['idempotency-key'] });
        return json(res, 201, { success: true, replayed: false, revisionId: 901, fiscalShiftId: Number(reconcileMatch[1]), differenceMinor: '0', checklist: activeChecklist() });
    }
    const closeMatch = url.pathname.match(/^\/api\/payments\/shifts\/(\d+)\/close$/);
    if (closeMatch && req.method === 'POST') {
        state.operationCalls.push({ type: 'close', key: req.headers['idempotency-key'] });
        state.shift.status = 'closing';
        return json(res, 200, { success: true, replayed: false, fiscalShiftId: Number(closeMatch[1]), status: 'closing', checklist: activeChecklist() });
    }
    const reportMatch = url.pathname.match(/^\/api\/payments\/shifts\/(\d+)\/report$/);
    if (reportMatch && req.method === 'GET') {
        state.reportLoaded = true;
        return json(res, 200, { success: true, fiscalShiftId: Number(reportMatch[1]), internalReportLabel: 'Internal operational report', officialZReport: false, checkboxZDocumentUrl: 'https://example.test/z', checklist: activeChecklist() });
    }
    const orderMatch = url.pathname.match(/^\/api\/payments\/orders\/(\d+)(\/confirm)?$/);
    if (orderMatch && req.method === 'GET') {
        const order = state.orders.get(Number(orderMatch[1]));
        return order ? json(res, 200, orderDetails(order)) : json(res, 404, { success: false, code: 'payment_order_not_found' });
    }
    if (orderMatch && orderMatch[2] && req.method === 'POST') {
        const order = state.orders.get(Number(orderMatch[1]));
        if (!order) return json(res, 404, { success: false, code: 'payment_order_not_found' });
        const key = req.headers['idempotency-key'];
        state.confirmKeys.push(key);
        order.confirmKey = order.confirmKey || key;
        ensureShift();
        order.status = 'payment_recorded';
        order.paymentStatus = 'confirmed';
        order.fiscalStatus = 'pending';
        return json(res, 200, { success: true, replayed: order.confirmKey === key && state.confirmKeys.filter(k => k === key).length > 1, order: orderDetails(order).order, outboxJobId: 77 });
    }
    return json(res, 404, { success: false, code: 'not_found' });
}

function contentType(file) {
    if (file.endsWith('.html')) return 'text/html; charset=utf-8';
    if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (file.endsWith('.css')) return 'text/css; charset=utf-8';
    if (file.endsWith('.svg')) return 'image/svg+xml';
    if (file.endsWith('.png')) return 'image/png';
    return 'text/plain; charset=utf-8';
}

async function startServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
        const requestPath = url.pathname === '/cashier-payments' ? '/cashier-payments.html' : url.pathname;
        const target = path.normalize(path.join(ROOT, requestPath.replace(/^\/+/, '')));
        if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
            res.writeHead(404); res.end('not found'); return;
        }
        res.writeHead(200, { 'content-type': contentType(target) });
        fs.createReadStream(target).pipe(res);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function run() {
    const { chromium } = requirePlaywright();
    const server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: HEADLESS });
    try {
        let context = await browser.newContext();
        await context.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        let page = await context.newPage();
        await page.goto(`${base}/cashier-payments`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#paymentOrderForm');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await page.fill('#paymentKidsCount', '1');
        await page.click('#createPaymentOrderBtn');
        await page.waitForSelector('#cashReceivedAmount:not([disabled])');
        await page.fill('#cashReceivedAmount', '600');
        await page.click('#confirmCashBtn');
        await page.waitForSelector('#unresolvedOrdersBody [data-order-id]');
        assert.equal(await page.isDisabled('#confirmCashBtn'), true, 'cash repeat submit is blocked after fiscal pending');
        assert.equal(state.confirmKeys.length, 1, 'cash confirmation should submit once after double-click guard');
        await context.close();

        context = await browser.newContext();
        await context.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        page = await context.newPage();
        await page.goto(`${base}/cashier-payments`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#paymentOrderForm');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await page.check('input[name="paymentTender"][value="card_terminal_manual"]');
        await page.click('#createPaymentOrderBtn');
        await page.waitForSelector('#terminalSuccessCheckbox:not([disabled])');
        await page.check('#terminalSuccessCheckbox');
        await page.fill('#terminalReference', 'term-ref-1');
        await Promise.all([page.click('#confirmCardBtn'), page.click('#confirmCardBtn').catch(() => {})]);
        await page.waitForSelector('#unresolvedOrdersBody [data-order-id]');
        assert.equal(new Set(state.confirmKeys).size, state.confirmKeys.length, 'duplicate UI clicks must not create a second idempotency key');

        const currentOrderId = state.nextOrderId;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#unresolvedOrdersBody [data-order-id]');
        assert.equal(await page.isDisabled('#confirmCardBtn'), true, 'reload keeps pending payment blocked');
        assert.equal(await page.locator('#operationalContourPanel').isVisible(), false, 'Cashier PRO panel stays hidden when flag is false');
        await page.click('#startNextOrderBtn');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        assert.match(await page.textContent('#unresolvedOrdersBody'), new RegExp(`RCP-${currentOrderId}`), 'next customer keeps unresolved previous receipt visible');

        for (const order of state.orders.values()) order.fiscalStatus = 'fiscalized';
        const current = state.orders.get(currentOrderId);
        await page.goto(`${base}/cashier-payments?orderId=${currentOrderId}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#providerReceiptLinks:not(.hidden)');
        assert.match(await page.getAttribute('#providerTaxUrl', 'href'), /api\.checkbox\.ua\/check/);
        assert.match(await page.getAttribute('#providerPdfUrl', 'href'), /api\.checkbox\.ua\/check\.pdf/);
        assert.match(await page.getAttribute('#providerQrUrl', 'href'), /api\.checkbox\.ua\/qr/);
        await page.waitForSelector('#startNextOrderBtn:not(.hidden)');
        await page.click('#startNextOrderBtn');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await page.fill('#paymentKidsCount', '2');
        await page.click('#createPaymentOrderBtn');
        await page.waitForFunction(() => document.querySelector('#paymentTotalAmount')?.textContent.includes('500'));
        assert.equal(state.nextOrderId, currentOrderId + 1, 'new payment can start after fiscalized receipt');

        const deniedContext = await browser.newContext();
        await deniedContext.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        await deniedContext.route('**/api/auth/permissions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(permissionPayload(false)) }));
        const deniedPage = await deniedContext.newPage();
        await deniedPage.goto(`${base}/cashier-payments`, { waitUntil: 'domcontentloaded' });
        await deniedPage.waitForFunction(() => {
            const denied = document.getElementById('cashierAccessDenied');
            const button = document.getElementById('createPaymentOrderBtn');
            return denied && !denied.classList.contains('hidden') && denied.offsetParent !== null && button && button.disabled === true;
        });
        await deniedContext.close();
        await context.close().catch(() => {});
    } finally {
        await browser.close().catch(() => {});
        await new Promise(resolve => server.close(resolve));
    }
    console.log('Cashier payments browser smoke passed');
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
