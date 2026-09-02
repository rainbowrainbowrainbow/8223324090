'use strict';

const router = require('express').Router();
const { authenticateToken, requireAction } = require('../middleware/auth');
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
        return res.status(result.replayed ? 200 : 201).json({ success: true, ...result });
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
        return res.status(200).json({
            success: true,
            ...result,
            checkboxIntegrationEnabled: isCheckboxIntegrationEnabled(process.env),
            cashierProEnabled: isCashierProEnabled(process.env)
        });
    } catch (error) {
        const response = paymentErrorResponse(error);
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
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = paymentErrorResponse(error);
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
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = paymentErrorResponse(error);
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
            ...localState,
            phase1Close,
            readiness,
            readinessCode: readiness.readinessCode,
            integrationReady: readiness.integrationReady
        });
    } catch (error) {
        const response = readinessErrorResponse(error);
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
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = readinessErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});

router.get('/unresolved-orders', requireAction('payments.view'), async (req, res) => {
    try {
        const pagination = normalizeUnresolvedPagination({
            page: req.query.page,
            pageSize: req.query.pageSize ?? req.query.page_size
        });
        const result = await listUnresolvedPaymentOrders({
            user: req.user,
            crmProfileKey: req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix',
            registerAlias: req.query.registerAlias || req.query.register_alias || 'middle',
            ...pagination
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = readinessErrorResponse(error);
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
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = readinessErrorResponse(error);
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
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = readinessErrorResponse(error);
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
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = readinessErrorResponse(error);
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
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = readinessErrorResponse(error);
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
            shiftId: req.params.shiftId,
            idempotencyKey: idempotencyKeyFromRequest(req),
            body: req.body || {}
        });
        return res.status(202).json({ success: true, ...result });
    } catch (error) {
        const response = readinessErrorResponse(error);
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

module.exports = router;
