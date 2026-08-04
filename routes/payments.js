'use strict';

const router = require('express').Router();
const { authenticateToken, requireAction } = require('../middleware/auth');
const {
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
    getOperationalReport,
    loadPilotRegisterState
} = require('../services/payments/cashierOperationsService');

router.use(authenticateToken);

function idempotencyKeyFromRequest(req) {
    return req.get('Idempotency-Key') || req.get('idempotency-key') || '';
}

router.post('/admission-ticket/orders', requireAction('payments.create'), async (req, res) => {
    try {
        const result = await createAdmissionTicketPaymentOrder({
            user: req.user,
            body: req.body || {},
            idempotencyKey: idempotencyKeyFromRequest(req)
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
        return res.status(200).json({ success: true, ...result });
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
        const result = await loadPilotRegisterState({
            user: req.user,
            crmProfileKey: req.query.crmProfileKey || req.query.crm_profile_key || 'event_genix',
            registerAlias: req.query.registerAlias || req.query.register_alias || 'middle'
        });
        return res.status(200).json({ success: true, ...result });
    } catch (error) {
        const response = cashierOperationsErrorResponse(error);
        return res.status(response.status).json(response.body);
    }
});
router.post('/service-in', requireAction('fiscal.service_in'), async (req, res) => {
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

router.post('/service-out', requireAction('fiscal.service_out.request'), async (req, res) => {
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

router.post('/service-out/:operationId/approve', requireAction('fiscal.service_out.approve'), async (req, res) => {
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

router.post('/orders/:orderId/refund', requireAction('fiscal.refund'), async (req, res) => {
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

router.post('/shifts/:shiftId/reconcile', requireAction('fiscal.reconcile'), async (req, res) => {
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

router.post('/shifts/:shiftId/close', requireAction('fiscal.shift.close'), async (req, res) => {
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

router.post('/shifts/:shiftId/auto-close', requireAction('fiscal.shift.close'), async (req, res) => {
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

router.get('/shifts/:shiftId/report', requireAction('fiscal.audit.view'), async (req, res) => {
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
