'use strict';

const router = require('express').Router();
const { requestSharedTestDrain, requestSharedTestResume } = require('../services/payments/sharedTestDayService');
const authMiddleware = require('../middleware/auth');
const { authenticateToken, requireAction } = authMiddleware;
const {
    cancelDraftPaymentOrder,
    confirmPaymentOrder,
    createAdmissionTicketPaymentOrder,
    getPaymentOrderDetails,
    paymentErrorResponse
} = require('../services/payments/paymentService');
const { createCatalogSalePaymentOrder, listCatalogDiscounts, listCatalogItems, scopeForBusiness } = require('../services/payments/catalogSaleService');
const { listCashierBindings, listSelectableCashiers, updateCashierBinding } = require('../services/payments/cashierBindingAdminService');
const {
    approveServiceOut,
    autoCloseShift,
    cashierOperationsErrorResponse,
    closeShift,
    createFullRefund,
    createReconciliationRevision,
    createServiceIn,
    createServiceOutRequest,
    enrollFiscalActionPin,
    getOperationalReport,
    loadPilotRegisterState,
    applyPhase1CloseReadiness
} = require('../services/payments/cashierOperationsService');
const {
    PaymentReadinessError,
    loadCheckboxSalesReport,
    listUnresolvedPaymentOrders,
    loadOperationalHealth,
    loadReadinessState,
    listOperationalIncidents,
    normalizeUnresolvedPagination,
    probeCheckboxReadiness,
    readinessErrorResponse,
    requestPhase1ShiftClose,
    updateOperationalIncidentStatus
} = require('../services/payments/paymentReadinessService');
const { isCashierProEnabled, isCheckboxIntegrationEnabled } = require('../services/checkbox/config');
const {
    assertNoClientFiscalRouteOverride,
    listFiscalSaleRouteOptions,
    resolveFiscalSaleRoute
} = require('../services/payments/fiscalSaleRouteService');

router.use(authenticateToken);

function idempotencyKeyFromRequest(req) {
    return req.get('Idempotency-Key') || req.get('idempotency-key') || '';
}

function localManualQaStatus(env = process.env, businessContext) {
    const enabled = String(env.EVENTGENIX_LOCAL_MANUAL_QA || '').trim().toLowerCase() === 'true';
    if (!enabled) return null;
    const safe = env.NODE_ENV === 'test'
        && String(env.REQUIRE_ISOLATED_TEST_TARGET || '').trim().toLowerCase() === 'true'
        && String(env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER || '').trim().toLowerCase() === 'true'
        && String(env.CHECKBOX_LOCAL_QA_FETCH_SHIM_ACTIVE || '').trim().toLowerCase() === 'true'
        && String(env.CHECKBOX_INTEGRATION_ENABLED || '').trim().toLowerCase() === 'true'
        && String(env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED || '').trim().toLowerCase() === 'true'
        && Number.isSafeInteger(Number(env.CHECKBOX_LOCAL_QA_MOCK_PORT))
        && Number(env.CHECKBOX_LOCAL_QA_MOCK_PORT) > 0;
    if (!safe) return { enabled: false };
    const scope = scopeForBusiness(businessContext);
    return {
        enabled: true,
        providerMode: 'loopback_mock',
        externalNetwork: false,
        acceptanceScope: 'process_only',
        businessContext: scope.crmProfileKey,
        locationAlias: scope.locationAlias,
        registerAlias: scope.registerAlias
    };
}

function fiscalScopeValueFromRequest(req, camelKey, snakeKey) {
    return req.body?.[camelKey]
        ?? req.body?.[snakeKey]
        ?? req.query?.[camelKey]
        ?? req.query?.[snakeKey]
        ?? null;
}

function routeOptionIdFromRequest(req) {
    return req.body?.routeOptionId
        ?? req.body?.route_option_id
        ?? req.query?.routeOptionId
        ?? req.query?.route_option_id
        ?? null;
}

function cashierBindingIdFromRequest(req) {
    const value = req.body?.cashierBindingId
        ?? req.body?.cashier_binding_id
        ?? req.query?.cashierBindingId
        ?? req.query?.cashier_binding_id
        ?? null;
    if (value == null || value === '') return null;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw Object.assign(new Error('Cashier binding option is invalid'), {
            name: 'FiscalSaleRouteError',
            code: 'cashier_binding_id_invalid',
            status: 422
        });
    }
    return id;
}

async function resolvePaymentFiscalScope(req) {
    const input = { ...(req.query || {}), ...(req.body || {}) };
    assertNoClientFiscalRouteOverride(input);
    const requestedBusiness = String(
        fiscalScopeValueFromRequest(req, 'businessContext', 'business_context') || ''
    ).trim().toLowerCase();
    const routeOptionId = String(routeOptionIdFromRequest(req) || '').trim();
    if (!requestedBusiness || !routeOptionId) {
        throw Object.assign(new Error('Business context and safe fiscal register option are required'), {
            name: 'FiscalSaleRouteError',
            code: 'fiscal_route_option_required',
            status: 422
        });
    }
    const route = await resolveFiscalSaleRoute({
        user: req.user,
        routeOptionId,
        businessContext: requestedBusiness
    });
    return {
        crmProfileKey: route.mapping.crm_profile_key,
        locationAlias: route.mapping.location_alias,
        registerAlias: route.mapping.register_alias,
        authorizationCrmProfileKey: route.businessContext,
        businessContext: route.businessContext,
        routeOptionId: route.routeOptionId,
        cashierBindingId: cashierBindingIdFromRequest(req)
    };
}

function projectReadinessForViewer(_user, readiness = {}) {
    return {
        readinessCode: readiness.readinessCode || 'unknown',
        integrationReady: readiness.integrationReady === true,
        providerReady: readiness.providerReady === true,
        providerIdentityVerified: readiness.providerIdentityVerified === true,
        registerActive: readiness.registerActive === true,
        cashierReady: readiness.cashierReady === true,
        signatureCertificateReady: readiness.signatureCertificateReady === true,
        taxMappingReady: readiness.taxMappingReady === true,
        providerUnavailable: readiness.providerUnavailable === true,
        staleReadiness: readiness.staleReadiness !== false,
        shiftState: readiness.shiftState || 'unknown',
        checkedAt: readiness.checkedAt || null,
        expiresAt: readiness.expiresAt || null
    };
}

function projectPilotRegisterStateForViewer(user, localState = {}, readiness = {}, phase1Close = null) {
    return {
        cashierProEnabled: localState.cashierProEnabled === true,
        fiscalProfileId: localState.fiscalProfileId ?? null,
        fiscalLocationId: localState.fiscalLocationId ?? null,
        fiscalRegisterId: localState.fiscalRegisterId ?? null,
        crmProfileKey: localState.crmProfileKey || null,
        legalEntityName: localState.legalEntityName || null,
        locationAlias: localState.locationAlias || null,
        registerAlias: localState.registerAlias || null,
        registerDisplayName: localState.registerDisplayName || null,
        shift: localState.shift || null,
        phase1Close,
        sharedTestDay: localState.sharedTestDay || null,
        checklist: null,
        readiness: projectReadinessForViewer(user, readiness),
        readinessCode: readiness.readinessCode || 'unknown',
        integrationReady: readiness.integrationReady === true
    };
}

function projectPaymentOrderDetailsForViewer(_user, details = {}) {
    const order = details.order ? { ...details.order } : details.order;
    if (order?.confirmationSnapshot && typeof order.confirmationSnapshot === 'object') {
        const {
            provider_context,
            providerContext,
            fiscal_configuration_hash,
            fiscalConfigurationHash,
            ...cashierConfirmationSnapshot
        } = order.confirmationSnapshot;
        order.confirmationSnapshot = cashierConfirmationSnapshot;
    }
    const fiscalOperation = details.fiscalOperation ? {
        operationType: details.fiscalOperation.operationType || null,
        status: details.fiscalOperation.status || null,
        providerStatus: details.fiscalOperation.providerStatus || null,
        amountMinor: details.fiscalOperation.amountMinor ?? null,
        currency: details.fiscalOperation.currency || null,
        lastErrorCode: details.fiscalOperation.lastErrorCode || null,
        sentAt: details.fiscalOperation.sentAt || null,
        completedAt: details.fiscalOperation.completedAt || null,
        nextStatusCheckAt: details.fiscalOperation.nextStatusCheckAt || null
    } : details.fiscalOperation;
    const outboxJob = details.outboxJob ? {
        status: details.outboxJob.status || null,
        attempts: details.outboxJob.attempts ?? null,
        maxAttempts: details.outboxJob.maxAttempts ?? null,
        nextRunAt: details.outboxJob.nextRunAt || null,
        lastErrorCode: details.outboxJob.lastErrorCode || null
    } : details.outboxJob;
    const receipts = Array.isArray(details.receipts) ? details.receipts.map(receipt => {
        const {
            id,
            fiscalOperationId,
            paymentOrderId,
            providerSnapshot,
            providerReceiptId,
            provider,
            ...cashierReceipt
        } = receipt || {};
        return cashierReceipt;
    }) : [];
    return {
        ...details,
        order,
        items: Array.isArray(details.items) ? details.items.map(item => {
            const {
                taxReference,
                taxCode,
                taxRateBps,
                providerTaxId,
                itemSnapshot,
                ...cashierItem
            } = item || {};
            return cashierItem;
        }) : [],
        fiscalOperation,
        outboxJob,
        receipts
    };
}

function projectPaymentMutationResultForViewer(user, result = {}) {
    const {
        attemptId,
        fiscalOperationId,
        outboxJobId,
        providerRequestUuid,
        ...cashierResult
    } = result;
    return {
        ...cashierResult,
        order: projectPaymentOrderDetailsForViewer(user, { order: result.order }).order
    };
}

function projectReadinessErrorForViewer(_user, response = {}) {
    if (!response.body) return response;
    const { details, ...publicBody } = response.body;
    return { ...response, body: publicBody };
}

function projectUnresolvedOrdersForViewer(_user, result = {}) {
    const {
        fiscalProfileId,
        fiscalLocationId,
        fiscalRegisterId,
        ...publicResult
    } = result || {};
    return {
        ...publicResult,
        fiscalProfileId,
        fiscalLocationId,
        fiscalRegisterId,
        orders: Array.isArray(result.orders) ? result.orders.map(order => {
            const {
                orderKey,
                fiscalOperationId,
                providerOperationId,
                outboxJobId,
                ...publicOrder
            } = order || {};
            return publicOrder;
        }) : []
    };
}

function projectSalesReportForViewer(_user, result = {}) {
    const { fiscalProfileId, fiscalLocationId, fiscalRegisterId, ...publicResult } = result;
    return {
        ...publicResult,
        orders: Array.isArray(result.orders) ? result.orders.map(order => {
            const { orderKey, providerReceiptId, ...publicOrder } = order || {};
            return publicOrder;
        }) : []
    };
}

function projectIncidentDetails(details = {}) {
    const source = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
    const projected = {};
    for (const key of [
        'error_code',
        'readiness_code',
        'retryable',
        'unknown',
        'external_stage',
        'sanitized',
        'recovery_policy',
        'auto_resolved_reason'
    ]) {
        if (source[key] != null) projected[key] = source[key];
    }
    if (Array.isArray(source.mismatches)) {
        projected.mismatches = source.mismatches.map(value => String(value || '').slice(0, 80)).filter(Boolean).slice(0, 50);
    }
    return projected;
}

function projectIncidentsForViewer(_user, result = {}) {
    if (result.incident) {
        return {
            incident: {
                id: result.incident.id,
                status: result.incident.status,
                resolvedAt: result.incident.resolvedAt || null
            }
        };
    }
    return {
        incidents: Array.isArray(result.incidents) ? result.incidents.map(incident => ({
            id: incident.id,
            paymentOrderId: incident.paymentOrderId ?? null,
            severity: incident.severity || null,
            incidentType: incident.incidentType || null,
            status: incident.status || null,
            details: projectIncidentDetails(incident.details),
            createdAt: incident.createdAt || null,
            resolvedAt: incident.resolvedAt || null
        })) : []
    };
}

function projectOperationalHealthForViewer(_user, result = {}) {
    const { fiscalProfileId, fiscalLocationId, fiscalRegisterId, ...publicResult } = result;
    return publicResult;
}

function projectPhase1CloseResultForViewer(_user, result = {}) {
    return {
        replayed: result.replayed === true,
        fiscalShiftId: result.fiscalShiftId ?? null,
        status: result.status || null
    };
}

function requireCashierProEnabled(req, res, next) {
    if (!isCashierProEnabled(process.env)) {
        return res.status(403).json({
            success: false,
            code: 'cashier_pro_disabled',
            error: 'Cashier PRO operations are disabled'
        });
    }
    return next();
}

router.post('/admission-ticket/orders', requireAction('payments.create'), async (req, res) => {
    try {
        const originalBody = req.body || {};
        assertNoClientFiscalRouteOverride(originalBody);
        const routeOptionId = String(routeOptionIdFromRequest(req) || 'park_production').trim();
        const route = await resolveFiscalSaleRoute({
            user: req.user,
            routeOptionId,
            businessContext: originalBody.businessContext ?? originalBody.business_context ?? 'event_genix',
            requireMutationReady: true
        });
        if (route.businessContext !== 'event_genix') {
            throw Object.assign(new Error('Admission tickets are available only for PARK'), {
                name: 'FiscalSaleRouteError',
                code: 'admission_ticket_route_invalid',
                status: 409
            });
        }
        const body = {
            ...originalBody,
            crmProfileKey: route.mapping.crm_profile_key,
            locationAlias: route.mapping.location_alias,
            registerAlias: route.mapping.register_alias
        };
        delete body.routeOptionId;
        delete body.route_option_id;
        delete body.businessContext;
        delete body.business_context;
        const result = await createAdmissionTicketPaymentOrder({
            user: req.user,
            body,
            idempotencyKey: idempotencyKeyFromRequest(req),
            requireCheckboxIntegrationReady: true,
            fiscalRoute: route
        });
        return res.status(result.replayed ? 200 : 201).json({
            success: true,
            ...projectPaymentMutationResultForViewer(req.user, result)
        });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, paymentErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/catalog/orders', requireAction('payments.create'), async (req, res) => {
    try {
        if (!String(routeOptionIdFromRequest(req) || '').trim()) {
            throw Object.assign(new Error('Safe fiscal register option is required'), {
                name: 'FiscalSaleRouteError',
                code: 'fiscal_route_option_required',
                status: 422
            });
        }
        const result = await createCatalogSalePaymentOrder({
            user: req.user,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req),
            requireCheckboxIntegrationReady: true
        });
        return res.status(result.replayed ? 200 : 201).json({
            success: true,
            ...projectPaymentMutationResultForViewer(req.user, result)
        });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, paymentErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.get('/catalog/routes', requireAction('payments.view'), async (req, res) => {
    try {
        const routes = await listFiscalSaleRouteOptions({ user: req.user });
        return res.status(200).json({ success: true, routes });
    } catch (error) {
        const response = paymentErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.get('/catalog/items', requireAction('payments.view'), async (req, res) => {
    try {
        assertNoClientFiscalRouteOverride(req.query || {});
        const items = await listCatalogItems({
            businessContext: req.query.businessContext || req.query.business_context,
            routeOptionId: routeOptionIdFromRequest(req),
            user: req.user
        });
        return res.status(200).json({ success: true, items });
    } catch (error) {
        const response = paymentErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.get('/catalog/discounts', requireAction('payments.view'), async (req, res) => {
    try {
        assertNoClientFiscalRouteOverride(req.query || {});
        const discounts = await listCatalogDiscounts({
            businessContext: req.query.businessContext || req.query.business_context,
            routeOptionId: routeOptionIdFromRequest(req),
            user: req.user
        });
        return res.status(200).json({ success: true, discounts });
    } catch (error) {
        const response = paymentErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.get('/local-qa-status', requireAction('payments.view'), (req, res) => {
    try {
        const status = localManualQaStatus(process.env, req.query.businessContext || req.query.business_context);
        if (!status) return res.status(404).json({ success: false, code: 'local_qa_disabled' });
        if (status.enabled !== true) return res.status(503).json({ success: false, code: 'local_qa_not_isolated' });
        return res.status(200).json({ success: true, ...status });
    } catch (error) {
        const response = paymentErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.get('/catalog/cashiers', requireAction('payments.create'), async (req, res) => {
    try {
        assertNoClientFiscalRouteOverride(req.query || {});
        const cashiers = await listSelectableCashiers({
            businessContext: req.query.businessContext || req.query.business_context,
            routeOptionId: routeOptionIdFromRequest(req),
            user: req.user
        });
        return res.status(200).json({ success: true, cashiers });
    } catch (error) {
        const response = paymentErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.get('/fiscal-bindings/cashiers', requireAction('fiscal.configure'), async (req, res) => {
    try {
        const cashiers = await listCashierBindings({ businessContext: req.query.businessContext || req.query.business_context });
        return res.status(200).json({ success: true, cashiers });
    } catch (error) {
        const response = paymentErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.put('/fiscal-bindings/cashiers/:bindingId', requireAction('fiscal.configure'), async (req, res) => {
    try {
        const result = await updateCashierBinding({ bindingId: req.params.bindingId, body: req.body || {}, actorUserId: req.user?.id });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = paymentErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.get('/orders/:orderId', requireAction('payments.view'), async (req, res) => {
    try {
        const result = await getPaymentOrderDetails({
            user: req.user,
            orderId: req.params.orderId
        });
        const projected = projectPaymentOrderDetailsForViewer(req.user, result);
        return res.status(200).json({
            success: true,
            ...projected,
            checkboxIntegrationEnabled: isCheckboxIntegrationEnabled(process.env),
            cashierProEnabled: isCashierProEnabled(process.env)
        });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, paymentErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/orders/:orderId/confirm', requireAction('payments.confirm_received'), async (req, res) => {
    try {
        const result = await confirmPaymentOrder({
            user: req.user,
            orderId: req.params.orderId,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req),
            requireCheckboxIntegrationReady: true
        });
        return res.status(200).json({
            success: true,
            ...projectPaymentMutationResultForViewer(req.user, result)
        });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, paymentErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/orders/:orderId/cancel', requireAction('payments.create'), async (req, res) => {
    try {
        const result = await cancelDraftPaymentOrder({
            user: req.user,
            orderId: req.params.orderId,
            idempotencyKey: idempotencyKeyFromRequest(req)
        });
        return res.status(200).json({
            success: true,
            ...projectPaymentMutationResultForViewer(req.user, result)
        });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, paymentErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});


router.get('/pilot-register-state', requireAction('payments.view'), async (req, res) => {
    try {
        const scope = await resolvePaymentFiscalScope(req);
        const [localState, readiness] = await Promise.all([
            loadPilotRegisterState({
                user: req.user,
                ...scope
            }),
            loadReadinessState({
                user: req.user,
                ...scope
            })
        ]);
        const phase1Close = applyPhase1CloseReadiness(localState.phase1Close, readiness);
        return res.status(200).json({
            success: true,
            ...projectPilotRegisterStateForViewer(req.user, localState, readiness, phase1Close)
        });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/readiness/probe', requireAction('payments.view'), async (req, res) => {
    try {
        const scope = await resolvePaymentFiscalScope(req);
        const result = await probeCheckboxReadiness({
            user: req.user,
            ...scope,
            force: req.body?.force === true || req.body?.force === 'true' || req.query.force === 'true'
        });
        return res.status(200).json({ success: true, ...projectReadinessForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.get('/unresolved-orders', requireAction('payments.view'), async (req, res) => {
    try {
        const pagination = normalizeUnresolvedPagination({
            page: req.query.page,
            pageSize: req.query.pageSize ?? req.query.page_size,
            cursor: req.query.cursor,
            snapshotRevision: req.query.snapshotRevision ?? req.query.snapshot_revision
        });
        const scope = await resolvePaymentFiscalScope(req);
        const result = await listUnresolvedPaymentOrders({
            user: req.user,
            ...scope,
            ...pagination
        });
        return res.status(200).json({ success: true, ...projectUnresolvedOrdersForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.get('/checkbox-sales-report', requireAction('payments.view'), async (req, res) => {
    try {
        const scope = await resolvePaymentFiscalScope(req);
        const result = await loadCheckboxSalesReport({
            user: req.user,
            ...scope,
            dateFrom: req.query.dateFrom || req.query.date_from || null,
            dateTo: req.query.dateTo || req.query.date_to || null,
            shiftId: req.query.shiftId || req.query.shift_id || null,
            cashierUserId: req.query.cashierUserId || req.query.cashier_user_id || null,
            page: req.query.page || 1,
            pageSize: req.query.pageSize || req.query.page_size || 50
        });
        return res.status(200).json({ success: true, ...projectSalesReportForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.get('/operational-health', requireAction('fiscal.audit.view'), async (req, res) => {
    try {
        const scope = await resolvePaymentFiscalScope(req);
        const result = await loadOperationalHealth({
            user: req.user,
            ...scope
        });
        return res.status(200).json({ success: true, ...projectOperationalHealthForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.get('/incidents', requireAction('fiscal.audit.view'), async (req, res) => {
    try {
        const scope = await resolvePaymentFiscalScope(req);
        const result = await listOperationalIncidents({
            user: req.user,
            ...scope,
            status: req.query.status || 'open'
        });
        return res.status(200).json({ success: true, ...projectIncidentsForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/incidents/:incidentId/acknowledge', requireAction('fiscal.incident.manage'), async (req, res) => {
    try {
        const scope = await resolvePaymentFiscalScope(req);
        const result = await updateOperationalIncidentStatus({
            user: req.user,
            incidentId: req.params.incidentId,
            status: 'acknowledged',
            reason: req.body?.reason || null,
            ...scope
        });
        return res.status(200).json({ success: true, ...projectIncidentsForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/incidents/:incidentId/resolve', requireAction('fiscal.incident.manage'), async (req, res) => {
    try {
        const scope = await resolvePaymentFiscalScope(req);
        const result = await updateOperationalIncidentStatus({
            user: req.user,
            incidentId: req.params.incidentId,
            status: 'resolved',
            reason: req.body?.reason || null,
            ...scope
        });
        return res.status(200).json({ success: true, ...projectIncidentsForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/shifts/:shiftId/phase1-drain', requireAction('fiscal.shift.close'), async (req, res) => {
    try {
        const result = await requestSharedTestDrain({ user: req.user, shiftId: req.params.shiftId,
            routeOptionId: req.get('X-Fiscal-Route-Option'), body: req.body || {}, idempotencyKey: idempotencyKeyFromRequest(req) });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = readinessErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.post('/test-drains/:drainId/resume', requireAction('fiscal.shift.close'), async (req, res) => {
    try {
        const result = await requestSharedTestResume({ user: req.user, drainId: req.params.drainId,
            routeOptionId: req.get('X-Fiscal-Route-Option'), body: req.body, idempotencyKey: idempotencyKeyFromRequest(req) });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = readinessErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.post('/shifts/:shiftId/phase1-close', requireAction('fiscal.shift.close'), async (req, res) => {
    try {
        const result = await requestPhase1ShiftClose({
            user: req.user,
            routeOptionId: req.get('X-Fiscal-Route-Option'),
            shiftId: req.params.shiftId,
            idempotencyKey: idempotencyKeyFromRequest(req),
            body: req.body || {}
        });
        return res.status(202).json({ success: true, ...projectPhase1CloseResultForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/fiscal-bindings/:bindingId/action-pin', requireAction('fiscal.configure'), async (req, res) => {
    try {
        const result = await enrollFiscalActionPin({
            user: req.user,
            bindingId: req.params.bindingId,
            body: req.body || {}
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.post('/service-in', requireCashierProEnabled, requireAction('fiscal.service_in'), async (req, res) => {
    try {
        const result = await createServiceIn({
            user: req.user,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req)
        });
        return res.status(result.replayed ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.post('/service-out', requireCashierProEnabled, requireAction('fiscal.service_out.request'), async (req, res) => {
    try {
        const result = await createServiceOutRequest({
            user: req.user,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req)
        });
        return res.status(result.replayed ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.post('/service-out/:operationId/approve', requireCashierProEnabled, requireAction('fiscal.service_out.approve'), async (req, res) => {
    try {
        const result = await approveServiceOut({
            user: req.user,
            operationId: req.params.operationId,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req)
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.post('/orders/:orderId/refund', requireCashierProEnabled, requireAction('fiscal.refund'), async (req, res) => {
    try {
        const result = await createFullRefund({
            user: req.user,
            orderId: req.params.orderId,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req)
        });
        return res.status(result.replayed ? 200 : 201).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.post('/shifts/:shiftId/reconcile', requireCashierProEnabled, requireAction('fiscal.reconcile'), async (req, res) => {
    try {
        const result = await createReconciliationRevision({
            user: req.user,
            shiftId: req.params.shiftId,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req)
        });
        return res.status(201).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.post('/shifts/:shiftId/close', requireCashierProEnabled, requireAction('fiscal.shift.close'), async (req, res) => {
    try {
        const result = await closeShift({
            user: req.user,
            shiftId: req.params.shiftId,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req)
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.post('/shifts/:shiftId/auto-close', requireCashierProEnabled, requireAction('fiscal.shift.close'), async (req, res) => {
    try {
        const result = await autoCloseShift({
            user: req.user,
            shiftId: req.params.shiftId,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req)
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.get('/shifts/:shiftId/report', requireCashierProEnabled, requireAction('fiscal.audit.view'), async (req, res) => {
    try {
        const result = await getOperationalReport({
            user: req.user,
            shiftId: req.params.shiftId
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.__cashierProjectionTest = Object.freeze({
    projectReadinessForViewer,
    projectPilotRegisterStateForViewer,
    projectPaymentOrderDetailsForViewer,
    projectPaymentMutationResultForViewer,
    projectUnresolvedOrdersForViewer,
    projectSalesReportForViewer,
    projectIncidentsForViewer,
    projectOperationalHealthForViewer,
    projectPhase1CloseResultForViewer,
    projectReadinessErrorForViewer
});

module.exports = router;
