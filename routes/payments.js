'use strict';

const router = require('express').Router();
const authMiddleware = require('../middleware/auth');
const { authenticateToken, requireAction } = authMiddleware;
const {
    cancelDraftPaymentOrder,
    confirmPaymentOrder,
    createAdmissionTicketPaymentOrder,
    getPaymentOrderDetails,
    paymentErrorResponse
} = require('../services/payments/paymentService');
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

router.use(authenticateToken);

function idempotencyKeyFromRequest(req) {
    return req.get('Idempotency-Key') || req.get('idempotency-key') || '';
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
    return {
        ...result,
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
    const { fiscalProfileId, fiscalRegisterId, ...publicResult } = result;
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
    const { fiscalProfileId, fiscalRegisterId, ...publicResult } = result;
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
        const result = await createAdmissionTicketPaymentOrder({
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
        const crmProfileKey = req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix';
        const registerAlias = req.query.registerAlias || req.query.register_alias || 'middle';
        const [localState, readiness] = await Promise.all([
            loadPilotRegisterState({
                user: req.user,
                crmProfileKey,
                registerAlias
            }),
            loadReadinessState({
                user: req.user,
                crmProfileKey,
                registerAlias
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
        const result = await probeCheckboxReadiness({
            user: req.user,
            crmProfileKey: req.body?.crmProfileKey || req.body?.crm_profile_key || req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix',
            registerAlias: req.body?.registerAlias || req.body?.register_alias || req.query.registerAlias || req.query.register_alias || 'middle',
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
        const result = await listUnresolvedPaymentOrders({
            user: req.user,
            crmProfileKey: req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix',
            registerAlias: req.query.registerAlias || req.query.register_alias || 'middle',
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
        const result = await loadCheckboxSalesReport({
            user: req.user,
            crmProfileKey: req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix',
            registerAlias: req.query.registerAlias || req.query.register_alias || 'middle',
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
        const result = await loadOperationalHealth({
            user: req.user,
            crmProfileKey: req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix',
            registerAlias: req.query.registerAlias || req.query.register_alias || 'middle'
        });
        return res.status(200).json({ success: true, ...projectOperationalHealthForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.get('/incidents', requireAction('fiscal.audit.view'), async (req, res) => {
    try {
        const result = await listOperationalIncidents({
            user: req.user,
            crmProfileKey: req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix',
            registerAlias: req.query.registerAlias || req.query.register_alias || 'middle',
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
        const result = await updateOperationalIncidentStatus({
            user: req.user,
            incidentId: req.params.incidentId,
            status: 'acknowledged',
            reason: req.body?.reason || null,
            crmProfileKey: req.body?.crmProfileKey || req.body?.crm_profile_key || req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix',
            registerAlias: req.body?.registerAlias || req.body?.register_alias || req.query.registerAlias || req.query.register_alias || 'middle'
        });
        return res.status(200).json({ success: true, ...projectIncidentsForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/incidents/:incidentId/resolve', requireAction('fiscal.incident.manage'), async (req, res) => {
    try {
        const result = await updateOperationalIncidentStatus({
            user: req.user,
            incidentId: req.params.incidentId,
            status: 'resolved',
            reason: req.body?.reason || null,
            crmProfileKey: req.body?.crmProfileKey || req.body?.crm_profile_key || req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix',
            registerAlias: req.body?.registerAlias || req.body?.register_alias || req.query.registerAlias || req.query.register_alias || 'middle'
        });
        return res.status(200).json({ success: true, ...projectIncidentsForViewer(req.user, result) });
    } catch (error) {
        const response = projectReadinessErrorForViewer(req.user, readinessErrorResponse(error));
        return res.status(response.status).json(response.body);
    }
});

router.post('/shifts/:shiftId/phase1-close', requireAction('fiscal.shift.close'), async (req, res) => {
    try {
        const result = await requestPhase1ShiftClose({
            user: req.user,
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
