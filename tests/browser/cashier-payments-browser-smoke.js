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
    phase1CloseKeys: [],
    unresolvedAvailable: true,
    unresolvedDelayMs: 0,
    nextPilotRegisterStateDelayMs: 0,
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
    if (!state.shift) state.shift = { id: 501, status: 'open', providerStatus: 'OPENED', openedAt: '2026-08-04T10:00:00.000Z', closedAt: null };
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
    const unresolvedCount = [...state.orders.values()].filter(order => order.paymentStatus === 'confirmed' && order.fiscalStatus !== 'fiscalized').length;
    const phase1Close = state.shift ? {
        visible: true,
        allowed: state.shift.providerStatus === 'OPENED' && unresolvedCount === 0,
        shiftId: state.shift.id,
        status: state.shift.providerStatus,
        reasonCode: unresolvedCount > 0 ? 'unresolved_operations' : null
    } : null;
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
        phase1Close,
        checklist: state.shift ? activeChecklist() : null
    };
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/auth/verify') return json(res, 200, { user: { id: 50, name: 'Smoke Cashier', role: 'administrator', roles: ['reception', 'administrator'], businessProfile: 'event_genix' } });
    if (url.pathname === '/api/auth/permissions') return json(res, 200, permissionPayload(url.searchParams.get('deny') !== '1' && req.headers['x-smoke-deny'] !== '1'));
    if (url.pathname === '/api/payments/pilot-register-state' && req.method === 'GET') {
        const delayMs = Math.max(0, Number(state.nextPilotRegisterStateDelayMs || 0));
        state.nextPilotRegisterStateDelayMs = 0;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        return json(res, 200, registerStatePayload());
    }
    if (url.pathname === '/api/payments/readiness/probe' && req.method === 'POST') return json(res, 200, { success: true, readinessCode: 'ready', integrationReady: true });
    if (url.pathname === '/api/payments/unresolved-orders' && req.method === 'GET') {
        const delayMs = Math.max(0, Number(state.unresolvedDelayMs || 0));
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        if (!state.unresolvedAvailable) return json(res, 503, { success: false, code: 'queue_unavailable', error: 'queue unavailable' });
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
        return json(res, 200, {
            success: true,
            fiscalProfileId: 1,
            fiscalRegisterId: 10,
            page: 1,
            pageSize: 50,
            totalCount: orders.length,
            registerCount: orders.length,
            myCount: orders.filter(order => order.isMine === true).length,
            hasMore: false,
            orders
        });
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
    const phase1CloseMatch = url.pathname.match(/^\/api\/payments\/shifts\/(\d+)\/phase1-close$/);
    if (phase1CloseMatch && req.method === 'POST') {
        const shiftId = Number(phase1CloseMatch[1]);
        const key = req.headers['idempotency-key'];
        state.phase1CloseKeys.push(key);
        if (!state.shift || state.shift.id !== shiftId) return json(res, 409, { success: false, code: 'shift_identity_mismatch' });
        const replayed = state.shift.providerStatus === 'CLOSING' || state.shift.providerStatus === 'CLOSED';
        state.shift.status = 'closing';
        state.shift.providerStatus = 'CLOSING';
        setTimeout(() => {
            state.shift.status = 'closed';
            state.shift.providerStatus = 'CLOSED';
            state.shift.closedAt = '2026-08-04T18:00:00.000Z';
        }, 100);
        return json(res, 202, { success: true, replayed, fiscalShiftId: shiftId, status: 'closing' });
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

async function assertCanonicalCashierButtons(page) {
    const contract = await page.evaluate(() => {
        const ids = [
            'refreshReadinessBtn',
            'createPaymentOrderBtn',
            'startNextOrderBtn',
            'cancelDraftOrderBtn',
            'confirmCashBtn',
            'confirmCardBtn',
            'providerTaxUrl',
            'providerPdfUrl',
            'providerQrUrl',
            'refreshUnresolvedOrdersBtn',
            'loadMoreUnresolvedOrdersBtn',
            'phase1CloseShiftBtn',
            'loadCheckboxSalesReportBtn'
        ];
        const bodyFont = getComputedStyle(document.body).fontFamily;
        return ids.map(id => {
            const element = document.getElementById(id);
            const style = element ? getComputedStyle(element) : null;
            return {
                id,
                exists: Boolean(element),
                visible: Boolean(element && element.getClientRects().length),
                display: style?.display || '',
                alignItems: style?.alignItems || '',
                justifyContent: style?.justifyContent || '',
                boxSizing: style?.boxSizing || '',
                minHeight: Number.parseFloat(style?.minHeight || '0'),
                paddingInline: Number.parseFloat(style?.paddingLeft || '0') + Number.parseFloat(style?.paddingRight || '0'),
                borderRadius: Number.parseFloat(style?.borderRadius || '0'),
                borderWidth: Number.parseFloat(style?.borderTopWidth || '0'),
                backgroundColor: style?.backgroundColor || '',
                backgroundImage: style?.backgroundImage || '',
                color: style?.color || '',
                fontFamily: style?.fontFamily || '',
                bodyFont,
                textDecoration: style?.textDecorationLine || '',
                cursor: style?.cursor || '',
                opacity: Number.parseFloat(style?.opacity || '1'),
                disabled: Boolean(element?.disabled || element?.getAttribute('aria-disabled') === 'true')
            };
        });
    });

    for (const item of contract) {
        assert.equal(item.exists, true, `${item.id} exists`);
        assert.ok(item.minHeight >= 40, `${item.id} has a canonical >=40px minimum height: ${JSON.stringify(item)}`);
        assert.ok(item.paddingInline >= 24, `${item.id} has canonical horizontal padding: ${JSON.stringify(item)}`);
        assert.ok(item.borderRadius >= 10, `${item.id} has a canonical rounded shape: ${JSON.stringify(item)}`);
        if (['createPaymentOrderBtn', 'confirmCashBtn', 'confirmCardBtn'].includes(item.id)) {
            assert.notEqual(item.backgroundImage, 'none', `${item.id} keeps a visible primary background`);
            assert.equal(item.color, 'rgb(255, 255, 255)', `${item.id} keeps readable primary text`);
        } else {
            assert.ok(item.borderWidth >= 1, `${item.id} keeps a visible secondary border: ${JSON.stringify(item)}`);
            assert.doesNotMatch(item.backgroundColor, /^rgba?\(0, 0, 0, 0\)$/, `${item.id} keeps a visible secondary surface`);
        }
        assert.equal(item.boxSizing, 'border-box', `${item.id} uses border-box sizing`);
        assert.equal(item.fontFamily, item.bodyFont, `${item.id} inherits the page font`);
        if (item.visible) {
            assert.match(item.display, /^(inline-)?flex$/, `${item.id} renders as a flex control`);
            assert.equal(item.alignItems, 'center', `${item.id} centers its label vertically`);
            assert.equal(item.justifyContent, 'center', `${item.id} centers its label horizontally`);
        }
        if (item.id.startsWith('provider')) assert.equal(item.textDecoration, 'none', `${item.id} looks like a button, not a raw link`);
        if (item.disabled) {
            assert.equal(item.cursor, 'not-allowed', `${item.id} explains its disabled state with the pointer`);
            assert.ok(item.opacity <= 0.65, `${item.id} has a visible disabled treatment`);
        }
    }
}

async function assertPaymentStepState(page, expected) {
    const steps = await page.evaluate(() => [...document.querySelectorAll('.cashier-step[data-payment-step]')].map(step => ({
        step: step.getAttribute('data-payment-step'),
        state: ['active', 'complete', 'inactive'].find(value => step.classList.contains(`is-${value}`)) || null,
        current: step.getAttribute('aria-current'),
        disabled: step.getAttribute('aria-disabled')
    })));
    assert.equal(steps.length, 3, 'the payment flow exposes exactly three semantic steps');
    assert.equal(steps.filter(step => step.current === 'step').length, 1, 'exactly one payment step is current');
    for (const [step, stateName] of Object.entries(expected)) {
        const actual = steps.find(item => item.step === step);
        assert.ok(actual, `payment step ${step} exists`);
        assert.equal(actual.state, stateName, `payment step ${step} is ${stateName}`);
        assert.equal(actual.current, stateName === 'active' ? 'step' : null, `payment step ${step} aria-current matches visual state`);
        assert.equal(actual.disabled, stateName === 'inactive' ? 'true' : null, `payment step ${step} aria-disabled matches visual state`);
    }
}

async function refreshUnresolvedOrders(page) {
    await page.locator('#unresolvedOrdersPanel').evaluate(panel => { panel.open = true; });
    await page.click('#refreshUnresolvedOrdersBtn');
}

async function assertNoCashierPageOverflow(page) {
    const widths = [360, 390, 640, 800, 961, 1023, 1024, 1440];
    const originalDisclosureState = await page.evaluate(() => [...document.querySelectorAll('.cashier-secondary-disclosure')].map(item => item.open));
    await page.evaluate(() => document.querySelectorAll('.cashier-secondary-disclosure').forEach(item => { item.open = true; }));
    for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(500);
        const layout = await page.evaluate(() => {
            const viewportWidth = document.documentElement.clientWidth;
            const selector = [
                '.cashier-payments-page',
                '.cashier-hero',
                '.cashier-grid',
                '.cashier-card',
                '.cashier-card-head',
                '.cashier-toolbar-row',
                '.cashier-report-filters'
            ].join(',');
            const offenders = [...document.querySelectorAll(selector)]
                .filter(element => element.getClientRects().length)
                .map(element => ({
                    name: element.id || element.className,
                    left: element.getBoundingClientRect().left,
                    right: element.getBoundingClientRect().right
                }))
                .filter(rect => rect.left < -1 || rect.right > viewportWidth + 1);
            return {
                viewportWidth,
                documentScrollWidth: document.documentElement.scrollWidth,
                bodyScrollWidth: document.body.scrollWidth,
                offenders
            };
        });
        assert.ok(layout.documentScrollWidth <= layout.viewportWidth + 1, `document does not overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.ok(layout.bodyScrollWidth <= layout.viewportWidth + 1, `body does not overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.deepEqual(layout.offenders, [], `cashier cards stay inside the viewport at ${width}px`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(states => {
        [...document.querySelectorAll('.cashier-secondary-disclosure')].forEach((item, index) => { item.open = Boolean(states[index]); });
    }, originalDisclosureState);
}

async function darkWarningContrast(page) {
    return page.evaluate(() => {
        const parse = value => {
            const match = String(value || '').match(/rgba?\(([^)]+)\)/i);
            if (!match) return null;
            const parts = match[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
            return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
        };
        const composite = (top, bottom) => {
            const alpha = top.a + bottom.a * (1 - top.a);
            if (!alpha) return { r: 0, g: 0, b: 0, a: 0 };
            return {
                r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
                g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
                b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
                a: alpha
            };
        };
        const linear = value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        };
        const luminance = color => 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
        const panel = document.getElementById('cashierReadinessStatus');
        const chain = [];
        for (let node = panel; node; node = node.parentElement) chain.push(node);
        let background = { r: 255, g: 255, b: 255, a: 1 };
        for (const node of chain.reverse()) {
            const layer = parse(getComputedStyle(node).backgroundColor);
            if (layer) background = composite(layer, background);
        }
        const foreground = composite(parse(getComputedStyle(panel).color), background);
        const light = Math.max(luminance(foreground), luminance(background));
        const dark = Math.min(luminance(foreground), luminance(background));
        return {
            ratio: (light + 0.05) / (dark + 0.05),
            foreground: getComputedStyle(panel).color,
            background: getComputedStyle(panel).backgroundColor
        };
    });
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
        await page.waitForFunction(() => window.CashierPaymentsPage?.state?.unresolvedQueueState === 'available');
        await assertPaymentStepState(page, { 1: 'active', 2: 'inactive', 3: 'inactive' });

        assert.equal(await page.evaluate(() => document.getElementById('unresolvedOrdersPanel') instanceof HTMLDetailsElement), true, 'unresolved receipts use a native disclosure');
        assert.equal(await page.evaluate(() => document.getElementById('checkboxSalesReportPanel') instanceof HTMLDetailsElement), true, 'sales report uses a native disclosure');
        assert.equal(await page.getAttribute('#unresolvedOrdersPanel', 'open'), null, 'empty unresolved disclosure starts collapsed');
        assert.equal(await page.getAttribute('#checkboxSalesReportPanel', 'open'), null, 'sales report starts collapsed');
        await page.focus('#unresolvedOrdersPanel > summary');
        await page.keyboard.press('Enter');
        assert.equal(await page.getAttribute('#unresolvedOrdersPanel', 'open'), '', 'unresolved disclosure opens from the keyboard');
        assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#unresolvedOrdersPanel > summary')), true, 'unresolved disclosure keeps focus on its summary');
        await page.keyboard.press('Enter');
        assert.equal(await page.getAttribute('#unresolvedOrdersPanel', 'open'), null, 'unresolved disclosure closes from the keyboard');
        await page.focus('#checkboxSalesReportPanel > summary');
        await page.keyboard.press('Enter');
        assert.equal(await page.getAttribute('#checkboxSalesReportPanel', 'open'), '', 'sales report opens from the keyboard');
        assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#checkboxSalesReportPanel > summary')), true, 'sales report keeps focus on its summary');
        await assertCanonicalCashierButtons(page);
        await assertNoCashierPageOverflow(page);
        await page.keyboard.press('Enter');
        assert.equal(await page.getAttribute('#checkboxSalesReportPanel', 'open'), null, 'sales report closes from the keyboard');

        await page.fill('#paymentKidsCount', '1');
        state.nextPilotRegisterStateDelayMs = 400;
        await page.click('#createPaymentOrderBtn');
        await page.waitForSelector('#cancelDraftOrderBtn:not(.hidden)');
        assert.equal(await page.isDisabled('#cashReceivedAmount'), true, 'a newly rendered draft stays fail-closed until its register queue refresh completes');
        assert.equal(await page.isDisabled('#confirmCashBtn'), true, 'confirmation stays fail-closed while the refreshed register state is pending');
        assert.equal(await page.locator('#unresolvedOrdersBody [data-queue-state="checking"]').count(), 1, 'the visible queue state immediately explains the temporary block');
        await page.waitForSelector('#cashReceivedAmount:not([disabled])');
        await assertPaymentStepState(page, { 1: 'complete', 2: 'active', 3: 'inactive' });
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'cashReceivedAmount', 'creating a cash draft focuses the received amount');
        await page.fill('#cashReceivedAmount', '600');
        await page.click('#confirmCashBtn');
        await page.waitForSelector('#unresolvedOrdersBody [data-order-id]');
        await assertPaymentStepState(page, { 1: 'complete', 2: 'complete', 3: 'active' });
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'fiscalResultPanel', 'payment confirmation focuses the fiscal result');
        assert.equal(await page.getAttribute('#unresolvedOrdersPanel', 'open'), '', 'a paid unresolved receipt opens the safety disclosure');
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
        await page.waitForSelector('#startNextOrderBtn:not(.hidden):not([disabled])');
        state.unresolvedDelayMs = 500;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="checking"]');
        assert.match(await page.textContent('#unresolvedOrdersBody'), new RegExp(`RCP-${currentOrderId}`), 'checking retains the last known unresolved receipt');
        assert.equal(await page.getAttribute('#unresolvedOrdersBody', 'aria-busy'), 'true', 'checking exposes an accessible busy state');
        assert.equal(await page.isDisabled('#startNextOrderBtn'), true, 'checking blocks next customer even when the previous payment is confirmed');
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="available"]');
        state.unresolvedDelayMs = 0;
        await page.waitForSelector('#startNextOrderBtn:not([disabled])');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#unresolvedOrdersBody [data-order-id]');
        assert.equal(await page.isDisabled('#confirmCardBtn'), true, 'reload keeps pending payment blocked');
        assert.equal(await page.locator('#operationalContourPanel').isVisible(), false, 'Cashier PRO panel stays hidden when flag is false');
        assert.equal(await page.isDisabled('#phase1CloseShiftBtn'), true, 'Phase-1 close is blocked while the register has an unresolved receipt');
        await page.click('#startNextOrderBtn');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        assert.match(await page.textContent('#unresolvedOrdersBody'), new RegExp(`RCP-${currentOrderId}`), 'next customer keeps unresolved previous receipt visible');

        for (const order of state.orders.values()) order.fiscalStatus = 'fiscalized';
        const current = state.orders.get(currentOrderId);
        await page.goto(`${base}/cashier-payments?orderId=${currentOrderId}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#providerReceiptLinks:not(.hidden)');
        await assertPaymentStepState(page, { 1: 'complete', 2: 'complete', 3: 'active' });
        assert.match(await page.getAttribute('#providerTaxUrl', 'href'), /api\.checkbox\.ua\/check/);
        assert.match(await page.getAttribute('#providerPdfUrl', 'href'), /api\.checkbox\.ua\/check\.pdf/);
        assert.match(await page.getAttribute('#providerQrUrl', 'href'), /api\.checkbox\.ua\/qr/);
        await page.waitForSelector('#startNextOrderBtn:not(.hidden)');
        await page.waitForSelector('#phase1CloseShiftBtn:not([disabled])');
        state.unresolvedDelayMs = 500;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="checking"]');
        assert.equal(await page.isDisabled('#startNextOrderBtn'), true, 'checking blocks the next-customer transition');
        assert.equal(await page.isDisabled('#phase1CloseShiftBtn'), true, 'checking blocks Phase-1 shift close');
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="empty"]');
        state.unresolvedDelayMs = 0;
        await page.waitForSelector('#startNextOrderBtn:not([disabled])');
        await page.waitForSelector('#phase1CloseShiftBtn:not([disabled])');
        await page.click('#startNextOrderBtn');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        state.unresolvedDelayMs = 500;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="checking"]');
        assert.equal(await page.isDisabled('#createPaymentOrderBtn'), true, 'checking blocks creating a new payment order');
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="empty"]');
        state.unresolvedDelayMs = 0;
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await page.check('input[name="paymentTender"][value="cash"]');
        await page.fill('#paymentKidsCount', '2');
        await page.click('#createPaymentOrderBtn');
        await page.waitForFunction(() => document.querySelector('#paymentTotalAmount')?.textContent.includes('500'));
        assert.equal(state.nextOrderId, currentOrderId + 1, 'new payment can start after fiscalized receipt');
        await page.waitForSelector('#cashReceivedAmount:not([disabled])');
        state.unresolvedDelayMs = 500;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="checking"]');
        assert.equal(await page.isDisabled('#cashReceivedAmount'), true, 'checking blocks received-cash input on an unpaid draft');
        assert.equal(await page.isDisabled('#confirmCashBtn'), true, 'checking blocks payment confirmation on an unpaid draft');
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="empty"]');
        state.unresolvedDelayMs = 0;
        await page.waitForSelector('#cashReceivedAmount:not([disabled])');

        await page.waitForSelector('#phase1ShiftPanel:not(.hidden)');
        await page.waitForSelector('#phase1CloseShiftBtn:not([disabled])');
        state.unresolvedAvailable = false;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="queue_unavailable"]');
        assert.equal(await page.isDisabled('#phase1CloseShiftBtn'), true, 'Phase-1 close is blocked when the unresolved queue is unavailable');
        state.unresolvedAvailable = true;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="empty"]');
        await page.waitForSelector('#phase1CloseShiftBtn:not([disabled])');
        await page.evaluate(() => {
            window.__cashierSmokeConfirmModal = window.confirmModal;
            window.confirmModal = undefined;
        });
        await page.click('#phase1CloseShiftBtn');
        await page.waitForFunction(() => document.querySelector('#cashierGlobalStatus')?.textContent.includes('Безпечне підтвердження тимчасово недоступне'));
        assert.equal(state.phase1CloseKeys.length, 0, 'missing shared confirmation sends no Phase-1 close request');
        await page.evaluate(() => { window.confirmModal = window.__cashierSmokeConfirmModal; });
        await page.waitForSelector('#phase1CloseShiftBtn:not([disabled])');
        await page.click('#phase1CloseShiftBtn');
        await page.waitForSelector('.confirm-overlay[data-confirm-kind="confirm"]');
        assert.match(await page.textContent('.confirm-overlay .confirm-message'), /нові чеки потребуватимуть відкриття нової зміни/);
        await page.click('.confirm-overlay .confirm-cancel');
        await page.waitForSelector('.confirm-overlay[data-confirm-kind="confirm"]', { state: 'detached' });
        assert.equal(state.phase1CloseKeys.length, 0, 'cancelled final confirmation sends no Phase-1 close request');
        await page.waitForSelector('#phase1CloseShiftBtn:not([disabled])');
        await page.evaluate(() => {
            const button = document.querySelector('#phase1CloseShiftBtn');
            button.click();
            button.click();
        });
        await page.waitForSelector('.confirm-overlay[data-confirm-kind="confirm"]');
        await page.click('.confirm-overlay .confirm-ok');
        await page.waitForFunction(() => document.querySelector('#phase1ShiftStatus')?.textContent.trim() === 'закрита', null, { timeout: 10000 });
        assert.equal(state.phase1CloseKeys.length, 1, 'Phase-1 close double click sends one request');
        assert.ok(state.phase1CloseKeys[0], 'Phase-1 close uses a stable Idempotency-Key');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'phase1ShiftStatus', 'focus moves to the confirmed CLOSED status');

        const disabledContext = await browser.newContext();
        await disabledContext.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'true'); });
        await disabledContext.route('**/api/payments/pilot-register-state*', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ...registerStatePayload(),
                checkboxIntegrationEnabled: false,
                paymentAcceptanceEnabled: false,
                mappingExists: false,
                featureEnabled: false,
                registerFeatureEnabled: false,
                runtimeConfigResolvable: false,
                integrationReady: false,
                readinessCode: 'global_integration_disabled',
                shift: null,
                phase1Close: null,
                checklist: null
            })
        }));
        await disabledContext.route('**/api/payments/unresolved-orders*', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, page: 1, pageSize: 50, totalCount: 0, registerCount: 0, myCount: 0, hasMore: false, orders: [] })
        }));
        const disabledPage = await disabledContext.newPage();
        await disabledPage.goto(`${base}/cashier-payments`, { waitUntil: 'domcontentloaded' });
        await disabledPage.waitForFunction(() => document.querySelector('#cashierReadinessSummary')?.textContent?.includes('лише для перегляду'));
        const readinessSummary = (await disabledPage.textContent('#cashierReadinessSummary')).trim();
        assert.equal(readinessSummary, 'Оплати поки вимкнені — сторінка працює лише для перегляду.');
        assert.ok(readinessSummary.length < 90, 'cashier-facing readiness remains concise');
        assert.doesNotMatch(readinessSummary, /CHECKBOX_|mapping|credential|provider|runtime|register|pending|unknown/i, 'cashier-facing readiness hides raw technical language');
        assert.equal(await disabledPage.isDisabled('#createPaymentOrderBtn'), true, 'disabled integration keeps payment creation fail closed');
        assert.equal(await disabledPage.getAttribute('#cashierReadinessDetails', 'open'), null, 'administrator details start collapsed');
        await disabledPage.focus('#cashierReadinessDetails > summary');
        await disabledPage.keyboard.press('Enter');
        assert.equal(await disabledPage.getAttribute('#cashierReadinessDetails', 'open'), '', 'administrator details open from the keyboard');
        assert.equal(await disabledPage.evaluate(() => document.activeElement === document.querySelector('#cashierReadinessDetails > summary')), true, 'administrator disclosure keeps keyboard focus');
        const technicalReadiness = (await disabledPage.textContent('#cashierReadinessTechnicalList')).trim();
        assert.match(technicalReadiness, /Інтеграція Checkbox вимкнена|Глобальна інтеграція Checkbox вимкнена/, 'technical reasons remain available to an administrator');
        const contrast = await darkWarningContrast(disabledPage);
        assert.ok(contrast.ratio >= 4.5, `dark warning contrast is WCAG AA: ${JSON.stringify(contrast)}`);
        await disabledContext.close();

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
