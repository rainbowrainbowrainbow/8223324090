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
    confirmKeys: []
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
    for (const key of ['page:/cashier-payments', 'action:payments.view', 'action:payments.create', 'action:payments.confirm_received']) {
        capabilities[key] = { allowed, source: allowed ? 'server_effective' : 'default_deny', reason: allowed ? 'smoke_allow' : 'smoke_deny', key: key.split(':')[1], type: key.split(':')[0] };
    }
    return {
        capabilities,
        pages: { '/cashier-payments': allowed },
        actions: { 'payments.view': allowed, 'payments.create': allowed, 'payments.confirm_received': allowed },
        pageAllowlist: allowed ? ['/cashier-payments'] : [],
        pageDenylist: allowed ? [] : ['/cashier-payments'],
        actionAllowlist: allowed ? ['payments.view', 'payments.create', 'payments.confirm_received'] : [],
        actionDenylist: allowed ? [] : ['payments.view', 'payments.create', 'payments.confirm_received'],
        capabilityCatalog: {
            pageRoles: { '/cashier-payments': ['reception'] },
            actionRoles: { 'payments.view': ['reception'], 'payments.create': ['reception'], 'payments.confirm_received': ['reception'] },
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
        items: [{ id: 1, lineNumber: 1, itemType: 'admission_ticket', itemCode: 'regular_child', itemName: 'Park admission', unitPriceMinor: '50000', quantityMillis: '1000', totalAmountMinor: '50000', currency: 'UAH', taxReference: 'admission_tariff:smoke' }],
        fiscalOperation: order.paymentStatus === 'confirmed' ? { id: 8, status: order.fiscalStatus, provider: 'checkbox', providerOperationId: 'provider-smoke', providerStatus: order.fiscalStatus } : null,
        receipts: order.fiscalStatus === 'fiscalized' ? [{ id: 9, fiscalOperationId: 8, paymentOrderId: order.id, receiptType: 'sale', status: 'fiscalized', provider: 'checkbox', providerReceiptId: 'chk-smoke', providerTaxUrl: 'https://example.test/check', providerPdfUrl: 'https://example.test/check.pdf', providerQrUrl: 'https://example.test/qr', totalAmountMinor: '50000', currency: 'UAH', fiscalizedAt: '2026-08-04T10:00:01.000Z' }] : [],
        artifacts: order.fiscalStatus === 'fiscalized' ? { taxUrl: 'https://example.test/check', pdfUrl: 'https://example.test/check.pdf', qrUrl: 'https://example.test/qr' } : { taxUrl: null, pdfUrl: null, qrUrl: null }
    };
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/auth/verify') return json(res, 200, { user: { id: 50, name: 'Smoke Cashier', role: 'reception', roles: ['reception'], businessProfile: 'event_genix' } });
    if (url.pathname === '/api/auth/permissions') return json(res, 200, permissionPayload(url.searchParams.get('deny') !== '1' && req.headers['x-smoke-deny'] !== '1'));
    if (url.pathname === '/api/payments/admission-ticket/orders' && req.method === 'POST') {
        const body = await readBody(req);
        const key = req.headers['idempotency-key'];
        state.createKeys.push(key);
        const replay = [...state.orders.values()].find(order => order.createKey === key);
        if (replay) return json(res, 200, { success: true, replayed: true, order: orderDetails(replay).order });
        const order = { id: ++state.nextOrderId, sourceId: body.sourceId || `source-${state.nextOrderId}`, tender: body.tender || 'cash', status: 'draft', paymentStatus: 'unpaid', fiscalStatus: 'pending', createKey: key, confirmKey: null };
        state.orders.set(order.id, order);
        return json(res, 201, { success: true, replayed: false, order: orderDetails(order).order });
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
        await page.fill('#paymentSourceId', 'park-cash-smoke');
        await page.fill('#paymentKidsCount', '1');
        await page.click('#createPaymentOrderBtn');
        await page.waitForSelector('#cashReceivedAmount:not([disabled])');
        await page.fill('#cashReceivedAmount', '600');
        await page.click('#confirmCashBtn');
        await page.waitForFunction(() => document.querySelector('#cashierPaymentStatus')?.textContent.includes('confirmed'));
        assert.equal(await page.isDisabled('#confirmCashBtn'), true, 'cash repeat submit is blocked after fiscal pending');
        assert.equal(state.confirmKeys.length, 1, 'cash confirmation should submit once after double-click guard');
        await context.close();

        context = await browser.newContext();
        await context.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        page = await context.newPage();
        await page.goto(`${base}/cashier-payments`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#paymentOrderForm');
        await page.fill('#paymentSourceId', 'park-card-smoke');
        await page.check('input[name="paymentTender"][value="card_terminal_manual"]');
        await page.click('#createPaymentOrderBtn');
        await page.waitForSelector('#terminalSuccessCheckbox:not([disabled])');
        await page.check('#terminalSuccessCheckbox');
        await page.fill('#terminalReference', 'term-ref-1');
        await Promise.all([page.click('#confirmCardBtn'), page.click('#confirmCardBtn').catch(() => {})]);
        await page.waitForFunction(() => document.querySelector('#cashierFiscalStatus')?.textContent.includes('pending'));
        assert.equal(new Set(state.confirmKeys).size, state.confirmKeys.length, 'duplicate UI clicks must not create a second idempotency key');

        const currentOrderId = state.nextOrderId;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#fiscalPendingMessage')?.textContent.includes('Repeat payment is blocked'));
        assert.equal(await page.isDisabled('#confirmCardBtn'), true, 'reload keeps pending payment blocked');

        const current = state.orders.get(currentOrderId);
        current.fiscalStatus = 'fiscalized';
        await page.goto(`${base}/cashier-payments?orderId=${currentOrderId}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#providerReceiptLinks:not(.hidden)');
        assert.match(await page.getAttribute('#providerTaxUrl', 'href'), /example\.test\/check/);
        assert.match(await page.getAttribute('#providerPdfUrl', 'href'), /example\.test\/check\.pdf/);
        assert.match(await page.getAttribute('#providerQrUrl', 'href'), /example\.test\/qr/);

        const deniedContext = await browser.newContext();
        await deniedContext.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        await deniedContext.route('**/api/auth/permissions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(permissionPayload(false)) }));
        const deniedPage = await deniedContext.newPage();
        await deniedPage.goto(`${base}/cashier-payments`, { waitUntil: 'domcontentloaded' });
        await deniedPage.waitForFunction(() => { const el = document.getElementById('cashierAccessDenied'); return el && !el.classList.contains('hidden') && el.offsetParent !== null; });
        const deniedCreateButton = deniedPage.locator('#createPaymentOrderBtn');
        if (await deniedCreateButton.count()) {
            assert.equal(await deniedCreateButton.isDisabled(), true, 'denied cashier cannot create payment order');
        }
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
