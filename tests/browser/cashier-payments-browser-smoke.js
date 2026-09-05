#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HEADLESS = process.env.CASHIER_PAYMENTS_BROWSER_SMOKE_HEADLESS !== 'false';
const FISCAL_CONFIGURE = process.env.CASHIER_PAYMENTS_BROWSER_FISCAL_CONFIGURE === 'true';
const VISUAL_ARTIFACT_DIR = String(process.env.CASHIER_PAYMENTS_VISUAL_ARTIFACT_DIR || '').trim()
    ? path.resolve(process.env.CASHIER_PAYMENTS_VISUAL_ARTIFACT_DIR)
    : null;
const UNRESOLVED_NEXT_RUN_AT = '2026-08-04T21:30:00.000Z';

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
    unresolvedPayloadMode: 'normal',
    unresolvedSnapshotConflictServed: false,
    unresolvedRequestCount: 0,
    unresolvedDelayMs: 0,
    nextPilotRegisterStateDelayMs: 0,
    nextCreateDelayMs: 0,
    nextConfirmDelayMs: 0,
    orderGetPlans: [],
    nextReadinessDelayMs: 0,
    nextSalesReportDelayMs: 0,
    readinessRequestCount: 0,
    salesReportRequestCount: 0,
    unresolvedDisplayOverride: null,
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

async function captureVisualArtifact(page, filename) {
    if (!VISUAL_ARTIFACT_DIR) return;
    fs.mkdirSync(VISUAL_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({
        path: path.join(VISUAL_ARTIFACT_DIR, filename),
        fullPage: true,
        animations: 'disabled',
        caret: 'hide'
    });
}

function unresolvedSnapshotRevision(orders) {
    const membership = [...orders]
        .sort((left, right) => Number(right.id) - Number(left.id))
        .map(order => [
            Number(order.id),
            String(order.paymentStatus || ''),
            String(order.fiscalStatus || ''),
            String(order.outboxStatus || ''),
            String(order.nextRunAt || '')
        ].join(':'))
        .join('|');
    return crypto.createHash('md5').update(membership).digest('hex');
}

function permissionPayload(allowed = true, { fiscalConfigure = false } = {}) {
    const capabilities = {};
    const keys = ['page:/cashier-payments', 'action:payments.view', 'action:payments.create', 'action:payments.confirm_received', 'action:fiscal.shift.open', 'action:fiscal.shift.close', 'action:fiscal.service_in', 'action:fiscal.service_out.request', 'action:fiscal.service_out.approve', 'action:fiscal.refund', 'action:fiscal.reconcile', 'action:fiscal.audit.view'];
    if (fiscalConfigure) keys.push('action:fiscal.configure');
    for (const key of keys) {
        capabilities[key] = { allowed, source: allowed ? 'server_effective' : 'default_deny', reason: allowed ? 'smoke_allow' : 'smoke_deny', key: key.split(':')[1], type: key.split(':')[0] };
    }
    const actions = { 'payments.view': allowed, 'payments.create': allowed, 'payments.confirm_received': allowed, 'fiscal.shift.open': allowed, 'fiscal.shift.close': allowed, 'fiscal.service_in': allowed, 'fiscal.service_out.request': allowed, 'fiscal.service_out.approve': allowed, 'fiscal.refund': allowed, 'fiscal.reconcile': allowed, 'fiscal.audit.view': allowed };
    const actionAllowlist = allowed ? Object.keys(actions) : [];
    const actionDenylist = allowed ? [] : Object.keys(actions);
    if (fiscalConfigure) {
        actions['fiscal.configure'] = allowed;
        if (allowed) actionAllowlist.push('fiscal.configure');
        else actionDenylist.push('fiscal.configure');
    }
    return {
        capabilities,
        pages: { '/cashier-payments': allowed },
        actions,
        pageAllowlist: allowed ? ['/cashier-payments'] : [],
        pageDenylist: allowed ? [] : ['/cashier-payments'],
        actionAllowlist,
        actionDenylist,
        capabilityCatalog: {
            pageRoles: { '/cashier-payments': ['reception'] },
            actionRoles: { 'payments.view': ['reception'], 'payments.create': ['reception'], 'payments.confirm_received': ['reception'], 'fiscal.shift.open': ['reception'], 'fiscal.shift.close': ['reception'], 'fiscal.service_in': ['reception'], 'fiscal.service_out.request': ['reception'], 'fiscal.service_out.approve': ['administrator'], 'fiscal.refund': ['administrator'], 'fiscal.reconcile': ['administrator'], 'fiscal.audit.view': ['reception'], ...(fiscalConfigure ? { 'fiscal.configure': ['creator'] } : {}) },
            pageAliases: {}, actionAliases: {}, actionLegacyKeys: {}, explicitAllowDisabledPages: [], explicitAllowDisabledActions: [], nonDelegableActions: []
        }
    };
}

function routeOptionsPayload({ includeTest = false } = {}) {
    const routes = [
        { id: 'park_production', businessContext: 'event_genix', businessLabel: 'ПАРК', mode: 'production', registerLabel: 'Середня каса', status: 'active', configured: true, featureEnabled: true, acceptanceEnabled: true, sequentialReady: true, readinessCode: 'ready' },
        { id: 'dar_production', businessContext: 'dar', businessLabel: 'ДАР', mode: 'production', registerLabel: 'Студія / Каса ДАР', status: 'active', configured: true, featureEnabled: true, acceptanceEnabled: true, sequentialReady: true, readinessCode: 'ready' }
    ];
    if (includeTest) routes.push(
        { id: 'park_test', businessContext: 'event_genix', businessLabel: 'ПАРК', mode: 'test', registerLabel: 'Тестова каса', status: 'active', configured: true, featureEnabled: true, acceptanceEnabled: false, sequentialReady: true, readinessCode: 'payment_acceptance_disabled' },
        { id: 'dar_test', businessContext: 'dar', businessLabel: 'ДАР', mode: 'test', registerLabel: 'Тестова каса', status: 'active', configured: true, featureEnabled: true, acceptanceEnabled: false, sequentialReady: true, readinessCode: 'payment_acceptance_disabled' }
    );
    return { success: true, routes };
}

function catalogItems(count, prefix) {
    return Array.from({ length: count }, (_, index) => ({
        itemCode: `${prefix}_${String(index + 1).padStart(3, '0')}`,
        name: `${prefix === 'park' ? 'Позиція ПАРК' : 'Послуга ДАР'} ${index + 1}`,
        category: index % 2 === 0 ? 'Відвідування' : 'Послуги',
        unit: 'послуга',
        priceMinor: String((index + 1) * 1000),
        quantityRule: { minimum_quantity_millis: 1000, quantity_step_millis: 1000 },
        priceSource: 'price_rules',
        taxMode: 'untaxed'
    }));
}

function artDirectorPermissionPayload() {
    const payload = permissionPayload(true);
    const deniedActions = [
        'finance.manage',
        'fiscal.configure',
        'fiscal.service_in',
        'fiscal.service_out.request',
        'fiscal.service_out.approve',
        'fiscal.refund',
        'fiscal.reconcile'
    ];
    for (const action of deniedActions) {
        payload.actions[action] = false;
        payload.capabilities[`action:${action}`] = {
            allowed: false,
            source: 'default_deny',
            reason: 'art_director_boundary',
            key: action,
            type: 'action'
        };
        payload.actionAllowlist = payload.actionAllowlist.filter(value => value !== action);
        if (!payload.actionDenylist.includes(action)) payload.actionDenylist.push(action);
    }
    return payload;
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
            sourceSnapshot: { tender: order.tender, crm_profile_key: 'event_genix', location_alias: 'park', register_alias: 'middle' },
            confirmationSnapshot: {},
            crmProfileKey: 'event_genix',
            legalEntityKey: 'fop_smoke',
            legalEntityName: 'Smoke FOP',
            fiscalLocationId: 7,
            locationAlias: 'park',
            registerAlias: 'middle',
            registerDisplayName: 'Middle cash desk'
        },
        items: [{ id: 1, lineNumber: 1, itemType: 'admission_ticket', itemCode: 'regular_child', itemName: 'Вхідний квиток парку', unitPriceMinor: '50000', quantityMillis: '1000', totalAmountMinor: '50000', currency: 'UAH', taxReference: 'admission_tariff:smoke' }],
        fiscalOperation: order.paymentStatus === 'confirmed' ? { id: 8, fiscalShiftId: state.shift?.id || null, status: order.fiscalStatus, provider: 'checkbox', providerOperationId: 'provider-smoke', providerStatus: order.fiscalStatus } : null,
        outboxJob: order.paymentStatus === 'confirmed' && order.fiscalStatus !== 'fiscalized' ? { id: 77, jobType: 'receipt_sell', status: 'queued', externalStage: 'receipt_lookup', attempts: 0, maxAttempts: 10, nextRunAt: UNRESOLVED_NEXT_RUN_AT, lastErrorCode: null } : null,
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

function assertParkMiddleScope(input) {
    const get = key => {
        if (input instanceof URLSearchParams) return input.get(key);
        return input?.[key] ?? input?.[key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)];
    };
    assert.equal(get('businessContext'), 'event_genix', 'cashier request must include the safe business context');
    assert.ok(['park_production', 'park_test'].includes(get('routeOptionId')), 'cashier request must include only an allowed safe route option id');
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/auth/verify') return json(res, 200, { user: { id: 50, name: 'Smoke Cashier', role: 'administrator', roles: ['reception', 'administrator'], businessProfile: 'event_genix' } });
    if (url.pathname === '/api/auth/permissions') return json(res, 200, permissionPayload(url.searchParams.get('deny') !== '1' && req.headers['x-smoke-deny'] !== '1', { fiscalConfigure: FISCAL_CONFIGURE }));
    if (url.pathname === '/api/payments/catalog/routes' && req.method === 'GET') {
        return json(res, 200, routeOptionsPayload({ includeTest: FISCAL_CONFIGURE }));
    }
    if (url.pathname === '/api/payments/catalog/cashiers' && req.method === 'GET') {
        assertParkMiddleScope(url.searchParams);
        return json(res, 200, { success: true, cashiers: [{ id: 77, cashierName: 'Касир UI', status: 'active', mode: url.searchParams.get('routeOptionId') === 'park_test' ? 'test' : 'production' }] });
    }
    if (url.pathname === '/api/payments/catalog/items' && req.method === 'GET') {
        assertParkMiddleScope(url.searchParams);
        return json(res, 200, { success: true, items: catalogItems(140, 'park') });
    }
    if (url.pathname === '/api/payments/catalog/discounts' && req.method === 'GET') {
        assertParkMiddleScope(url.searchParams);
        return json(res, 200, { success: true, discounts: [] });
    }
    if (url.pathname === '/api/payments/pilot-register-state' && req.method === 'GET') {
        assertParkMiddleScope(url.searchParams);
        const delayMs = Math.max(0, Number(state.nextPilotRegisterStateDelayMs || 0));
        state.nextPilotRegisterStateDelayMs = 0;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        return json(res, 200, registerStatePayload());
    }
    if (url.pathname === '/api/payments/readiness/probe' && req.method === 'POST') {
        const body = await readBody(req);
        assertParkMiddleScope(body);
        state.readinessRequestCount += 1;
        const delayMs = Math.max(0, Number(state.nextReadinessDelayMs || 0));
        state.nextReadinessDelayMs = 0;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        return json(res, 200, { success: true, readinessCode: 'ready', integrationReady: true });
    }
    if (url.pathname === '/api/payments/unresolved-orders' && req.method === 'GET') {
        assertParkMiddleScope(url.searchParams);
        state.unresolvedRequestCount += 1;
        const delayMs = Math.max(0, Number(state.unresolvedDelayMs || 0));
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        if (!state.unresolvedAvailable) return json(res, 503, { success: false, code: 'queue_unavailable', error: 'queue unavailable' });
        if (state.unresolvedPayloadMode === 'malformed') {
            return json(res, 200, { success: true, page: 1, pageSize: 50, registerCount: 0, myCount: 0, hasMore: false });
        }
        if (state.unresolvedPayloadMode === 'snapshot_changed') {
            const page = Math.max(1, Number(url.searchParams.get('page') || 1));
            const makeOrder = id => ({
                id,
                isMine: true,
                orderKey: `admission_ticket:pagination-${id}`,
                paymentStatus: 'confirmed',
                fiscalStatus: 'unknown',
                rawFiscalStatus: 'unknown',
                totalAmountMinor: '10000',
                currency: 'UAH',
                confirmedAt: '2026-08-04T10:00:00.000Z',
                outboxStatus: 'failed',
                nextRunAt: UNRESOLVED_NEXT_RUN_AT,
                incidentReason: null
            });
            if (url.searchParams.has('cursor')) {
                const expectedOrders = Array.from({ length: 51 }, (_, index) => makeOrder(50050 - index));
                const expectedRevision = unresolvedSnapshotRevision(expectedOrders);
                assert.equal(page, 2, 'snapshot continuation requests the next logical page');
                assert.equal(url.searchParams.get('cursor'), '50001', 'snapshot continuation sends the exact server cursor');
                assert.equal(url.searchParams.get('snapshotRevision'), expectedRevision, 'snapshot continuation sends the exact server revision');
                state.unresolvedSnapshotConflictServed = true;
                return json(res, 409, {
                    success: false,
                    code: 'unresolved_snapshot_changed',
                    error: 'unresolved snapshot changed'
                });
            }
            if (state.unresolvedSnapshotConflictServed) {
                return json(res, 503, { success: false, code: 'queue_unavailable', error: 'queue unavailable after snapshot conflict' });
            }
            const orders = Array.from({ length: 50 }, (_, index) => makeOrder(50050 - index));
            const snapshotRevision = unresolvedSnapshotRevision([...orders, makeOrder(50000)]);
            return json(res, 200, {
                success: true,
                fiscalProfileId: 1,
                fiscalLocationId: 7,
                fiscalRegisterId: 10,
                registerWide: true,
                page,
                pageSize: 50,
                registerCount: 51,
                myCount: 51,
                hasMore: true,
                snapshotRevision,
                nextCursor: '50001',
                orders
            });
        }
        const orders = [...state.orders.values()]
            .filter(order => order.paymentStatus === 'confirmed' && order.fiscalStatus !== 'fiscalized')
            .map(order => ({
                id: order.id,
                isMine: true,
                orderKey: `admission_ticket:${order.sourceId}`,
                paymentStatus: order.paymentStatus,
                fiscalStatus: order.fiscalStatus === 'failed' ? 'failed_retryable' : order.fiscalStatus,
                rawFiscalStatus: order.fiscalStatus,
                totalAmountMinor: '50000',
                currency: 'UAH',
                confirmedAt: '2026-08-04T10:00:00.000Z',
                outboxStatus: 'queued',
                nextRunAt: UNRESOLVED_NEXT_RUN_AT,
                incidentReason: null,
                ...(state.unresolvedDisplayOverride || {})
            }))
            .sort((left, right) => Number(right.id) - Number(left.id));
        return json(res, 200, {
            success: true,
            fiscalProfileId: 1,
            fiscalLocationId: 7,
            fiscalRegisterId: 10,
            registerWide: true,
            page: 1,
            pageSize: 50,
            totalCount: orders.length,
            registerCount: orders.length,
            myCount: orders.filter(order => order.isMine === true).length,
            hasMore: false,
            snapshotRevision: unresolvedSnapshotRevision(orders),
            nextCursor: null,
            orders
        });
    }
    if (url.pathname === '/api/payments/checkbox-sales-report' && req.method === 'GET') {
        assertParkMiddleScope(url.searchParams);
        state.salesReportRequestCount += 1;
        const delayMs = Math.max(0, Number(state.nextSalesReportDelayMs || 0));
        state.nextSalesReportDelayMs = 0;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
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
                providerTaxUrl: order.fiscalStatus === 'fiscalized' ? 'https://api.checkbox.ua/check' : null,
                providerPdfUrl: order.fiscalStatus === 'fiscalized' ? 'https://api.checkbox.ua/check.pdf' : null,
                providerQrUrl: order.fiscalStatus === 'fiscalized' ? 'https://api.checkbox.ua/qr' : null
            }));
        return json(res, 200, { success: true, internalReport: true, officialZReport: false, page: 1, pageSize: 50, totalCount: orders.length, filters: {}, totals: { paymentTotalMinor: String(orders.length * 50000), cashTotalMinor: '50000', cardTerminalTotalMinor: '50000', statusCounts: { pending: orders.filter(order => order.fiscalStatus === 'pending').length, fiscalized: orders.filter(order => order.fiscalStatus === 'fiscalized').length } }, orders });
    }
    if (url.pathname === '/api/payments/admission-ticket/orders' && req.method === 'POST') {
        const body = await readBody(req);
        assertParkMiddleScope(body);
        const delayMs = Math.max(0, Number(state.nextCreateDelayMs || 0));
        state.nextCreateDelayMs = 0;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
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
        if (!order) return json(res, 404, { success: false, code: 'payment_order_not_found' });
        const plan = state.orderGetPlans.shift() || null;
        const responseOrder = plan?.orderPatch ? { ...order, ...plan.orderPatch } : order;
        const responseBody = orderDetails(responseOrder);
        if (plan?.delayMs) await new Promise(resolve => setTimeout(resolve, Number(plan.delayMs)));
        return json(res, 200, responseBody);
    }
    if (orderMatch && orderMatch[2] && req.method === 'POST') {
        const delayMs = Math.max(0, Number(state.nextConfirmDelayMs || 0));
        state.nextConfirmDelayMs = 0;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
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
                tableScrollWidth: document.querySelector('.cashier-table-wrap')?.scrollWidth || 0,
                tableClientWidth: document.querySelector('.cashier-table-wrap')?.clientWidth || 0,
                offenders
            };
        });
        assert.ok(layout.documentScrollWidth <= layout.viewportWidth + 1, `document does not overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.ok(layout.bodyScrollWidth <= layout.viewportWidth + 1, `body does not overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.ok(layout.tableScrollWidth <= layout.tableClientWidth + 1, `positions table stays readable without hidden horizontal scrolling at ${width}px: ${JSON.stringify(layout)}`);
        assert.deepEqual(layout.offenders, [], `cashier cards stay inside the viewport at ${width}px`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(states => {
        [...document.querySelectorAll('.cashier-secondary-disclosure')].forEach((item, index) => { item.open = Boolean(states[index]); });
    }, originalDisclosureState);
}

async function elementContrast(page, selector) {
    return page.evaluate(targetSelector => {
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
        const panel = document.querySelector(targetSelector);
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
    }, selector);
}

async function run() {
    const { chromium } = requirePlaywright();
    const server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: HEADLESS });
    try {
        const selectorContext = await browser.newContext({ timezoneId: 'UTC' });
        await selectorContext.addInitScript(() => { localStorage.setItem('pzp_token', 'selector-smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        await selectorContext.route('**/api/auth/verify', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: { id: 4, name: 'Smoke Creator', role: 'creator', roles: ['creator'], businessProfile: 'event_genix' } })
        }));
        await selectorContext.route('**/api/auth/permissions*', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(permissionPayload(true, { fiscalConfigure: true }))
        }));
        await selectorContext.route('**/api/payments/catalog/routes', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(routeOptionsPayload({ includeTest: true }))
        }));
        const selectorPage = await selectorContext.newPage();
        await selectorPage.setViewportSize({ width: 1440, height: 1000 });
        await selectorPage.goto(`${base}/cashier-payments?businessContext=event_genix&routeOptionId=park_production`, { waitUntil: 'domcontentloaded' });
        await selectorPage.waitForFunction(() => document.querySelector('#catalogSaleSummary')?.textContent.includes('140 активних позицій'));
        assert.deepEqual(
            await selectorPage.locator('#paymentRegisterRoute option').allTextContents(),
            ['Середня каса · готова', 'Тестова каса · приймання вимкнено'],
            'fiscal.configure user sees both production and test modes for PARK'
        );
        assert.equal(await selectorPage.locator('[name="providerRegisterId"], [name="registerAlias"], [name="locationAlias"], [name="isTest"]').count(), 0, 'production UI exposes no raw fiscal/provider inputs');
        await captureVisualArtifact(selectorPage, '00-catalog-park-production.png');
        await selectorPage.selectOption('#paymentRegisterRoute', 'park_test');
        await selectorPage.waitForSelector('#cashierTestModeBanner:not(.hidden)');
        await selectorPage.waitForFunction(() => document.querySelector('#cashierScopeMode')?.textContent.trim() === 'ТЕСТОВИЙ');
        assert.match(await selectorPage.textContent('#cashierTestModeBanner'), /ТЕСТОВА КАСА/i, 'test route has a prominent warning');
        assert.equal(await selectorPage.isDisabled('#createPaymentOrderBtn'), true, 'test route remains blocked while its acceptance gate is disabled');
        await captureVisualArtifact(selectorPage, '00-catalog-park-test-disabled.png');
        await selectorContext.close();

        let context = await browser.newContext({ timezoneId: 'UTC' });
        await context.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        let page = await context.newPage();
        await page.goto(`${base}/cashier-payments?saleMode=admission`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#paymentOrderForm');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        await page.waitForFunction(() => window.CashierPaymentsPage?.state?.unresolvedQueueState === 'available');
        await page.setViewportSize({ width: 1440, height: 1000 });
        await captureVisualArtifact(page, '01-light-ready-empty.png');
        await assertPaymentStepState(page, { 1: 'active', 2: 'inactive', 3: 'inactive' });
        assert.equal(await page.isHidden('#cashierReadinessDetails'), true, 'ordinary cashier does not see fiscal configuration diagnostics');
        assert.equal(await page.textContent('#cashierReadinessTechnicalList'), '', 'ordinary cashier receives no rendered technical checklist');
        const cashierProSelector = '[data-cashier-pro-page], [data-cashier-pro], #operationalContourPanel, #serviceInForm, #serviceOutForm, #serviceOutApprovalPanel, #refundForm, #reconciliationForm, #closeShiftBtn, #loadOperationalReportBtn, script[src*="cashier-payments-pro"]';
        assert.equal(await page.locator(cashierProSelector).count(), 0, 'thin page does not load any Cashier PRO markup or module');
        assert.equal(state.operationCalls.length, 0, 'opening the thin page performs no Cashier PRO request');
        assert.deepEqual(await page.evaluate(() => ({
            apiUa: window.CashierPaymentsPage.isTrustedCheckboxUrl('https://api.checkbox.ua/receipt'),
            apiInUa: window.CashierPaymentsPage.isTrustedCheckboxUrl('https://api.checkbox.in.ua/receipt'),
            subdomain: window.CashierPaymentsPage.isTrustedCheckboxUrl('https://files.checkbox.ua/receipt'),
            deceptive: window.CashierPaymentsPage.isTrustedCheckboxUrl('https://api.checkbox.ua.attacker.test/receipt'),
            http: window.CashierPaymentsPage.isTrustedCheckboxUrl('http://api.checkbox.ua/receipt')
        })), { apiUa: true, apiInUa: true, subdomain: false, deceptive: false, http: false }, 'receipt artifacts use the exact server host allowlist');

        const readinessCallsBefore = state.readinessRequestCount;
        state.nextReadinessDelayMs = 300;
        await page.click('#refreshReadinessBtn');
        await page.waitForFunction(() => {
            const button = document.getElementById('refreshReadinessBtn');
            return button?.disabled === true
                && button.getAttribute('aria-busy') === 'true'
                && button.textContent.trim() === 'Оновлюємо готовність…';
        });
        assert.equal(await page.getAttribute('#cashierReadinessStatus', 'aria-busy'), 'true', 'readiness region exposes its busy state');
        assert.equal((await page.textContent('#cashierReadinessSummary')).trim(), 'Оновлюємо готовність Checkbox…', 'readiness summary explains the active refresh');
        await page.waitForFunction(() => {
            const button = document.getElementById('refreshReadinessBtn');
            return button?.disabled === false
                && button.getAttribute('aria-busy') === 'false'
                && button.textContent.trim() === 'Оновити готовність Checkbox';
        });
        assert.equal(state.readinessRequestCount, readinessCallsBefore + 1, 'one readiness click sends one provider probe');

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
        const reportCallsBefore = state.salesReportRequestCount;
        state.nextSalesReportDelayMs = 300;
        await page.click('#loadCheckboxSalesReportBtn');
        await page.waitForFunction(() => {
            const button = document.getElementById('loadCheckboxSalesReportBtn');
            return button?.disabled === true
                && button.getAttribute('aria-busy') === 'true'
                && button.textContent.trim() === 'Формуємо звіт…';
        });
        assert.equal(await page.getAttribute('#checkboxSalesReportBody', 'aria-busy'), 'true', 'report region exposes its busy state');
        assert.equal((await page.textContent('#checkboxSalesReportBody')).trim(), 'Формуємо звіт…', 'report region explains the active request');
        await page.waitForFunction(() => {
            const button = document.getElementById('loadCheckboxSalesReportBtn');
            return button?.disabled === false
                && button.getAttribute('aria-busy') === 'false'
                && button.textContent.trim() === 'Завантажити історію чеків';
        });
        assert.equal(state.salesReportRequestCount, reportCallsBefore + 1, 'one report click sends one report request');
        assert.match(await page.textContent('#checkboxSalesReportBody'), /Історія чеків|Оплати всього|офіційний артефакт/i, 'receipt history renders cashier-facing labels');
        await assertCanonicalCashierButtons(page);
        await assertNoCashierPageOverflow(page);
        await page.focus('#checkboxSalesReportPanel > summary');
        await page.keyboard.press('Enter');
        assert.equal(await page.getAttribute('#checkboxSalesReportPanel', 'open'), null, 'sales report closes from the keyboard');

        await page.fill('#paymentKidsCount', '1');
        state.nextPilotRegisterStateDelayMs = 400;
        state.nextCreateDelayMs = 300;
        // Keep the register-wide queue refresh observable even if a scheduled
        // readiness request consumes the one-shot pilot-state delay first.
        state.unresolvedDelayMs = 500;
        await page.click('#createPaymentOrderBtn');
        await page.waitForFunction(() => {
            const button = document.getElementById('createPaymentOrderBtn');
            return button?.disabled === true
                && button.getAttribute('aria-busy') === 'true'
                && button.textContent.trim() === 'Створюємо оплату…';
        });
        assert.equal(await page.getAttribute('#paymentOrderForm', 'aria-busy'), 'true', 'payment form exposes the create busy state');
        assert.equal((await page.textContent('#createPaymentDisabledReason')).trim(), 'Створюємо оплату…', 'create disabled reason explains the active request');
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="checking"]');
        assert.equal(await page.isDisabled('#cashReceivedAmount'), true, 'a newly rendered draft stays fail-closed until its register queue refresh completes');
        assert.equal(await page.isDisabled('#confirmCashBtn'), true, 'confirmation stays fail-closed while the refreshed register state is pending');
        await page.waitForSelector('#cancelDraftOrderBtn:not(.hidden)');
        await page.waitForSelector('#cashReceivedAmount:not([disabled])');
        state.unresolvedDelayMs = 0;
        assert.equal(await page.getAttribute('#createPaymentOrderBtn', 'aria-busy'), 'false', 'create busy state clears after the request');
        assert.equal((await page.textContent('#createPaymentOrderBtn')).trim(), 'Створити оплату', 'create button restores its Ukrainian label');
        await assertPaymentStepState(page, { 1: 'complete', 2: 'active', 3: 'inactive' });
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'cashReceivedAmount', 'creating a cash draft focuses the received amount');
        assert.equal((await page.textContent('#cashierRegister')).trim(), 'ПАРК / Середня каса', 'order snapshot keeps the localized PARK and middle register context');
        assert.doesNotMatch(await page.textContent('#paymentItemsBody'), /admission_tariff:smoke/, 'cashier positions do not render internal tax references');
        assert.doesNotMatch(await page.textContent('#paymentItemsBody'), /regular_child/, 'cashier positions do not render internal CRM item codes');
        await page.fill('#cashReceivedAmount', '600');
        state.nextConfirmDelayMs = 300;
        await page.click('#confirmCashBtn');
        await page.waitForFunction(() => {
            const button = document.getElementById('confirmCashBtn');
            return button?.disabled === true
                && button.getAttribute('aria-busy') === 'true'
                && button.textContent.trim() === 'Підтверджуємо оплату…';
        });
        assert.equal(await page.getAttribute('[data-payment-step="2"]', 'aria-busy'), 'true', 'confirmation step exposes the active payment request');
        assert.equal((await page.textContent('#confirmDisabledReason')).trim(), 'Підтверджуємо оплату…', 'confirmation reason explains the active request');
        await page.waitForSelector('#unresolvedOrdersBody [data-order-id]');
        assert.equal(await page.getAttribute('#confirmCashBtn', 'aria-busy'), 'false', 'confirmation busy state clears after the request');
        assert.equal((await page.textContent('#confirmCashBtn')).trim(), 'Готівку отримано — створити чек', 'confirmation button restores its Ukrainian label');
        const unresolvedAccessibleName = await page.getAttribute('#unresolvedOrdersBody [data-order-id]', 'aria-label');
        assert.match(unresolvedAccessibleName, new RegExp(`RCP-${state.nextOrderId}`), 'unresolved accessible name identifies the order');
        assert.match(unresolvedAccessibleName, /сума.+оплата.+фіскалізація.+наступна спроба.+причин/i, 'unresolved accessible name preserves amount, statuses, retry and incident context');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'fiscalResultPanel', 'payment confirmation focuses the fiscal result');
        assert.match(await page.textContent('#unresolvedOrdersBody [data-order-id]'), /Мій чек/, 'own unresolved payment uses a human ownership label');
        assert.doesNotMatch(await page.textContent('#unresolvedOrdersBody'), /admission_ticket:/, 'technical order identity is not rendered');
        const expectedKyivTime = await page.evaluate(timestamp => new Intl.DateTimeFormat('uk-UA', {
            timeZone: 'Europe/Kyiv',
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(new Date(timestamp)), UNRESOLVED_NEXT_RUN_AT);
        assert.match(await page.textContent('#unresolvedOrdersBody'), new RegExp(expectedKyivTime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'recovery time stays in Europe/Kyiv even when the browser runs in UTC');

        state.unresolvedDisplayOverride = {
            isMine: false,
            cashierIdentity: 'user:47',
            orderKey: 'admission_ticket:do-not-render',
            fiscalStatus: 'provider_new_state_9000',
            incidentReason: 'internal_provider_stack_code'
        };
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="available"]');
        const sanitizedUnresolvedText = await page.textContent('#unresolvedOrdersBody');
        const sanitizedUnresolvedLabel = await page.getAttribute('#unresolvedOrdersBody [data-order-id]', 'aria-label');
        assert.match(sanitizedUnresolvedText, /Касир №47/, 'another cashier is shown with a sanitized register-local label');
        assert.match(sanitizedUnresolvedText, /потребує перевірки/i, 'unknown provider status uses a safe Ukrainian fallback');
        assert.match(sanitizedUnresolvedText, /Потрібна перевірка відповідального/i, 'unknown incident uses a safe Ukrainian fallback');
        assert.doesNotMatch(`${sanitizedUnresolvedText} ${sanitizedUnresolvedLabel}`, /admission_ticket:|user:47|provider_new_state_9000|internal_provider_stack_code/i, 'technical order, cashier, provider and incident codes stay hidden');
        state.unresolvedDisplayOverride = null;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="available"]');
        await assertPaymentStepState(page, { 1: 'complete', 2: 'complete', 3: 'active' });
        assert.equal(await page.locator('#fiscalReceiptBadge').evaluate(element => element.classList.contains('is-warn')), true, 'pending receipt exposes a visual warning status');
        assert.equal(await page.locator('#unresolvedOrdersPanel').evaluate(element => element.classList.contains('has-warning')), true, 'unresolved disclosure exposes a visual warning state');
        await captureVisualArtifact(page, '02-light-pending-unresolved.png');
        assert.equal(await page.getAttribute('#unresolvedOrdersPanel', 'open'), '', 'a paid unresolved receipt opens the safety disclosure');
        assert.equal(await page.isDisabled('#confirmCashBtn'), true, 'cash repeat submit is blocked after fiscal pending');
        assert.equal(state.confirmKeys.length, 1, 'cash confirmation should submit once after double-click guard');
        await context.close();

        context = await browser.newContext({ timezoneId: 'UTC' });
        await context.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        page = await context.newPage();
        await page.goto(`${base}/cashier-payments?saleMode=admission`, { waitUntil: 'domcontentloaded' });
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

        state.unresolvedPayloadMode = 'malformed';
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="queue_unavailable"]');
        assert.match(await page.textContent('#unresolvedOrdersBody'), new RegExp(`RCP-${currentOrderId}`), 'malformed HTTP 200 retains the last known unresolved receipt');
        assert.equal(await page.isDisabled('#startNextOrderBtn'), true, 'malformed HTTP 200 blocks the next-customer flow');
        state.unresolvedPayloadMode = 'normal';
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="available"]');
        await page.waitForSelector('#startNextOrderBtn:not([disabled])');

        state.unresolvedPayloadMode = 'snapshot_changed';
        state.unresolvedSnapshotConflictServed = false;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#loadMoreUnresolvedOrdersBtn:not(.hidden):not([disabled])');
        await page.click('#loadMoreUnresolvedOrdersBtn');
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="queue_unavailable"]');
        assert.match(await page.textContent('#unresolvedOrdersBody'), /RCP-50050/, 'snapshot conflict keeps the last complete page visible');
        assert.equal(await page.isDisabled('#startNextOrderBtn'), true, 'snapshot conflict fails closed while the canonical first page cannot reload');
        state.unresolvedPayloadMode = 'normal';
        state.unresolvedSnapshotConflictServed = false;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="available"]');
        await page.waitForSelector('#startNextOrderBtn:not([disabled])');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#unresolvedOrdersBody [data-order-id]');
        assert.equal(await page.isDisabled('#confirmCardBtn'), true, 'reload keeps pending payment blocked');
        assert.equal(await page.locator(cashierProSelector).count(), 0, 'reload still contains no Cashier PRO surface');
        assert.equal(state.operationCalls.length, 0, 'thin payment flow performs no Cashier PRO request');
        assert.equal(await page.isDisabled('#phase1CloseShiftBtn'), true, 'Phase-1 close is blocked while the register has an unresolved receipt');
        const readinessCallsBeforeFiscalizedNextCustomer = state.readinessRequestCount;
        await page.click('#startNextOrderBtn');
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        assert.equal(
            state.readinessRequestCount,
            readinessCallsBeforeFiscalizedNextCustomer + 1,
            'next customer refreshes provider readiness after the prior sale may have changed the shift context'
        );
        assert.match(await page.textContent('#unresolvedOrdersBody'), new RegExp(`RCP-${currentOrderId}`), 'next customer keeps unresolved previous receipt visible');

        for (const order of state.orders.values()) order.fiscalStatus = 'fiscalized';
        const current = state.orders.get(currentOrderId);
        await page.goto(`${base}/cashier-payments?orderId=${currentOrderId}&saleMode=admission`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#providerReceiptLinks:not(.hidden)');
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="empty"]', { state: 'attached' });
        await assertPaymentStepState(page, { 1: 'complete', 2: 'complete', 3: 'active' });
        assert.match(await page.getAttribute('#providerTaxUrl', 'href'), /api\.checkbox\.ua\/check/);
        assert.match(await page.getAttribute('#providerPdfUrl', 'href'), /api\.checkbox\.ua\/check\.pdf/);
        assert.match(await page.getAttribute('#providerQrUrl', 'href'), /api\.checkbox\.ua\/qr/);
        await page.locator('#checkboxSalesReportPanel').evaluate(panel => { panel.open = true; });
        await page.click('#loadCheckboxSalesReportBtn');
        await page.waitForSelector('#checkboxSalesReportBody .cashier-history-link');
        const receiptHistoryText = await page.textContent('#checkboxSalesReportBody');
        assert.match(receiptHistoryText, /RCP-\d+/, 'receipt history shows the internal receipt id');
        assert.match(receiptHistoryText, /Чек[\s\S]*PDF[\s\S]*QR/, 'receipt history exposes trusted official receipt, PDF and QR actions');
        assert.equal(await page.locator('#fiscalReceiptBadge').evaluate(element => element.classList.contains('is-ok')), true, 'fiscalized receipt exposes a visual success status');
        assert.equal(await page.locator('#pendingReceiptNotice').evaluate(element => element.classList.contains('hidden')), true, 'server-confirmed empty queue clears the stale local pending notice');
        assert.doesNotMatch(await page.textContent('#pendingReceiptNotice'), new RegExp(`RCP-${currentOrderId}`), 'fiscalized receipt is removed from local recovery fallback');
        await page.evaluate(orderIds => {
            const key = Object.keys(localStorage).find(item => item.endsWith(':pendingOrderIds'));
            if (!key) throw new Error('scoped pending-order cache key is missing');
            localStorage.setItem(key, JSON.stringify(orderIds));
        }, [String(currentOrderId), '888001', '888002']);
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="empty"]', { state: 'attached' });
        assert.deepEqual(await page.evaluate(() => {
            const key = Object.keys(localStorage).find(item => item.endsWith(':pendingOrderIds'));
            return key ? JSON.parse(localStorage.getItem(key) || '[]') : null;
        }), [], 'a complete authoritative empty snapshot clears every stale local recovery id');
        state.unresolvedAvailable = false;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="queue_unavailable"]');
        assert.equal(await page.locator('#pendingReceiptNotice').evaluate(element => element.classList.contains('hidden')), true, 'a later queue outage cannot resurrect ids cleared by an authoritative snapshot');
        assert.doesNotMatch(await page.textContent('#pendingReceiptNotice'), /RCP-(?:888001|888002)/, 'cleared historical recovery ids stay absent during an outage');
        state.unresolvedAvailable = true;
        await refreshUnresolvedOrders(page);
        await page.waitForSelector('#unresolvedOrdersBody [data-queue-state="empty"]', { state: 'attached' });
        state.orderGetPlans.push(
            { delayMs: 250, orderPatch: { fiscalStatus: 'pending' } },
            { delayMs: 0, orderPatch: { fiscalStatus: 'fiscalized' } }
        );
        await page.evaluate(async orderId => {
            const stale = window.CashierPaymentsPage.loadPaymentOrder(orderId, { silent: true });
            await new Promise(resolve => setTimeout(resolve, 40));
            const current = window.CashierPaymentsPage.loadPaymentOrder(orderId, { silent: true });
            await Promise.all([stale, current]);
        }, currentOrderId);
        assert.equal((await page.textContent('#fiscalReceiptBadge')).trim(), 'чек створено', 'a delayed stale pending response cannot overwrite a newer fiscalized response');
        assert.equal(await page.evaluate(() => window.CashierPaymentsPage.state.pollingOrderId), null, 'a delayed stale pending response cannot restart receipt polling');
        await page.waitForSelector('#startNextOrderBtn:not(.hidden)');
        await page.waitForSelector('#phase1CloseShiftBtn:not([disabled])');
        await page.setViewportSize({ width: 1440, height: 1000 });
        await captureVisualArtifact(page, '05-light-fiscalized-receipt.png');
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
        await page.setViewportSize({ width: 1440, height: 1000 });
        await captureVisualArtifact(page, '07-light-queue-unavailable.png');
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

        const disabledContext = await browser.newContext({ timezoneId: 'UTC' });
        await disabledContext.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'true'); });
        await disabledContext.route('**/api/auth/verify', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: { id: 4, name: 'Smoke Creator', role: 'creator', roles: ['creator'], businessProfile: 'event_genix' } })
        }));
        await disabledContext.route('**/api/auth/permissions', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(permissionPayload(true, { fiscalConfigure: true }))
        }));
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
            body: JSON.stringify({
                success: true,
                fiscalProfileId: 1,
                fiscalLocationId: 7,
                fiscalRegisterId: 10,
                registerWide: true,
                page: 1,
                pageSize: 50,
                registerCount: 0,
                myCount: 0,
                hasMore: false,
                snapshotRevision: 'd41d8cd98f00b204e9800998ecf8427e',
                nextCursor: null,
                orders: []
            })
        }));
        const disabledPage = await disabledContext.newPage();
        await disabledPage.goto(`${base}/cashier-payments?saleMode=admission`, { waitUntil: 'domcontentloaded' });
        await disabledPage.waitForFunction(() => document.querySelector('#cashierReadinessSummary')?.textContent?.includes('лише для перегляду'));
        const readinessSummary = (await disabledPage.textContent('#cashierReadinessSummary')).trim();
        assert.equal(readinessSummary, 'Оплати поки вимкнені — сторінка працює лише для перегляду.');
        assert.ok(readinessSummary.length < 90, 'cashier-facing readiness remains concise');
        assert.doesNotMatch(readinessSummary, /CHECKBOX_|mapping|credential|provider|runtime|register|pending|unknown/i, 'cashier-facing readiness hides raw technical language');
        assert.equal(await disabledPage.isHidden('#cashierAccessDenied'), true, 'creator keeps thin payment page access in disabled view-only mode');
        assert.equal(await disabledPage.isDisabled('#createPaymentOrderBtn'), true, 'disabled integration keeps payment creation fail closed');
        assert.equal(await disabledPage.getAttribute('#cashierReadinessDetails', 'open'), null, 'administrator details start collapsed');
        await disabledPage.focus('#cashierReadinessDetails > summary');
        await disabledPage.keyboard.press('Enter');
        assert.equal(await disabledPage.getAttribute('#cashierReadinessDetails', 'open'), '', 'administrator details open from the keyboard');
        assert.equal(await disabledPage.evaluate(() => document.activeElement === document.querySelector('#cashierReadinessDetails > summary')), true, 'administrator disclosure keeps keyboard focus');
        const technicalReadiness = (await disabledPage.textContent('#cashierReadinessTechnicalList')).trim();
        assert.match(technicalReadiness, /Інтеграція Checkbox вимкнена|Глобальна інтеграція Checkbox вимкнена/, 'technical reasons remain available to an administrator');
        const contrast = await elementContrast(disabledPage, '#cashierReadinessStatus');
        assert.ok(contrast.ratio >= 4.5, `dark warning contrast is WCAG AA: ${JSON.stringify(contrast)}`);
        await disabledPage.evaluate(() => {
            const samples = document.createElement('div');
            samples.id = 'cashierContrastSamples';
            samples.innerHTML = [
                '<span data-contrast="pill" class="cashier-pill">службова позначка</span>',
                '<span data-contrast="ok" class="cashier-status is-ok">готово</span>',
                '<span data-contrast="warn" class="cashier-status is-warn">очікує</span>',
                '<span data-contrast="danger" class="cashier-status is-danger">помилка</span>'
            ].join('');
            document.querySelector('#main-content').appendChild(samples);
        });
        for (const kind of ['pill', 'ok', 'warn', 'danger']) {
            const sampleContrast = await elementContrast(disabledPage, `[data-contrast="${kind}"]`);
            assert.ok(sampleContrast.ratio >= 4.5, `dark ${kind} badge contrast is WCAG AA: ${JSON.stringify(sampleContrast)}`);
        }
        await disabledPage.locator('#cashierContrastSamples').evaluate(element => element.remove());
        await disabledPage.setViewportSize({ width: 1440, height: 1000 });
        await captureVisualArtifact(disabledPage, '03-dark-disabled-admin.png');
        await disabledPage.setViewportSize({ width: 390, height: 844 });
        await captureVisualArtifact(disabledPage, '04-dark-disabled-admin-mobile.png');
        await disabledContext.close();

        state.unresolvedAvailable = true;
        state.unresolvedPayloadMode = 'normal';
        const artDirectorContext = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 1440, height: 1000 } });
        await artDirectorContext.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        await artDirectorContext.route('**/api/auth/verify', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ user: { id: 44, name: 'Smoke Art Director', role: 'art_director', roles: ['art_director'], businessProfile: 'event_genix' } })
        }));
        await artDirectorContext.route('**/api/auth/permissions', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(artDirectorPermissionPayload())
        }));
        const artDirectorPage = await artDirectorContext.newPage();
        await artDirectorPage.goto(`${base}/cashier-payments?saleMode=admission`, { waitUntil: 'domcontentloaded' });
        await artDirectorPage.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        assert.equal(await artDirectorPage.isHidden('#cashierAccessDenied'), true, 'art director keeps thin payment page access');
        assert.deepEqual(await artDirectorPage.evaluate(() => ({
            paymentsView: window.canUseAction?.('payments.view'),
            paymentsCreate: window.canUseAction?.('payments.create'),
            financeManage: window.canUseAction?.('finance.manage'),
            fiscalConfigure: window.canUseAction?.('fiscal.configure'),
            fiscalRefund: window.canUseAction?.('fiscal.refund')
        })), {
            paymentsView: true,
            paymentsCreate: true,
            financeManage: false,
            fiscalConfigure: false,
            fiscalRefund: false
        }, 'art director receives thin payment capabilities without finance or Cashier PRO mutation rights');
        assert.equal(await artDirectorPage.isHidden('#cashierReadinessDetails'), true, 'art director cannot see fiscal configuration diagnostics');
        assert.equal(await artDirectorPage.locator('a[href="/cashier-payments"]').filter({ hasText: 'Оплата та чек' }).count(), 1, 'art director sees the thin payment navigation entry');
        await captureVisualArtifact(artDirectorPage, '06-light-art-director-ready.png');
        await artDirectorContext.close();

        state.unresolvedAvailable = true;
        state.unresolvedPayloadMode = 'normal';
        const freshnessContext = await browser.newContext({ timezoneId: 'UTC' });
        await freshnessContext.addInitScript(() => {
            localStorage.setItem('pzp_token', 'smoke-token');
            localStorage.setItem('pzp_dark_mode', 'false');
            window.__EVENTGENIX_TEST_CASHIER_QUEUE_TIMING__ = { ttlMs: 300, retryMinMs: 100, retryMaxMs: 200 };
        });
        const freshnessPage = await freshnessContext.newPage();
        await freshnessPage.goto(`${base}/cashier-payments?saleMode=admission`, { waitUntil: 'domcontentloaded' });
        await freshnessPage.waitForSelector('#createPaymentOrderBtn:not([disabled])');
        const requestsBeforeExpiry = state.unresolvedRequestCount;
        state.unresolvedAvailable = false;
        await freshnessPage.waitForSelector('#unresolvedOrdersBody [data-queue-state="queue_unavailable"]', { timeout: 3000 });
        assert.ok(state.unresolvedRequestCount > requestsBeforeExpiry, 'the queue is refreshed automatically before its bounded freshness expires');
        assert.equal(await freshnessPage.isDisabled('#createPaymentOrderBtn'), true, 'an expired queue that cannot refresh blocks payment creation');
        state.unresolvedAvailable = true;
        await freshnessPage.waitForSelector('#createPaymentOrderBtn:not([disabled])', { timeout: 3000 });
        assert.ok(state.unresolvedRequestCount > requestsBeforeExpiry + 1, 'bounded backoff automatically recovers the queue after an outage');
        await freshnessContext.close();

        const deniedContext = await browser.newContext({ timezoneId: 'UTC' });
        await deniedContext.addInitScript(() => { localStorage.setItem('pzp_token', 'smoke-token'); localStorage.setItem('pzp_dark_mode', 'false'); });
        await deniedContext.route('**/api/auth/permissions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(permissionPayload(false)) }));
        const deniedPage = await deniedContext.newPage();
        await deniedPage.goto(`${base}/cashier-payments?saleMode=admission`, { waitUntil: 'domcontentloaded' });
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
