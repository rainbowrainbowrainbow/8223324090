'use strict';

const router = require('express').Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
    businessContextFromRequest,
    requireBusinessContext
} = require('../services/businessContext');
const {
    BanquetDepositError,
    confirmDeposit,
    getDepositProjectionById,
    patchDeposit
} = require('../services/banquetDeposits');
const { createLogger } = require('../utils/logger');

const log = createLogger('BanquetDeposits');
const VIEW_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'accountant'];
const CONFIRM_ROLES = ['accountant', 'director'];

router.use(authenticateToken);

function parseDepositId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanText(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
}

function firstValue(source, ...keys) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source || {}, key)) return source[key];
    }
    return undefined;
}

function requireField(body, keys, field) {
    const value = firstValue(body, ...keys);
    if (value === undefined || value === null || String(value).trim() === '') {
        return { error: `${field} is required`, field };
    }
    return { value };
}

function confirmationPayload(body = {}) {
    const required = [
        requireField(body, ['clientNameSnapshot', 'client_name_snapshot', 'clientName', 'client_name'], 'clientName'),
        requireField(body, ['receivedDate', 'received_date', 'depositReceivedDate', 'deposit_received_date'], 'receivedDate'),
        requireField(body, ['eventDate', 'event_date'], 'eventDate'),
        requireField(body, ['banquetNumberSnapshot', 'banquet_number_snapshot', 'banquetNumber', 'banquet_number'], 'banquetNumber'),
        requireField(body, ['amount'], 'amount'),
        requireField(body, ['paymentMethod', 'payment_method'], 'paymentMethod')
    ];
    const missing = required.find(item => item.error);
    if (missing) return { error: missing.error, field: missing.field };

    return {
        clientNameSnapshot: cleanText(required[0].value),
        receivedDate: required[1].value,
        eventDate: required[2].value,
        banquetNumberSnapshot: cleanText(required[3].value),
        amount: required[4].value,
        paymentMethod: required[5].value,
        note: body.note || body.comment || null,
        sourcePayload: {
            source: 'routes/banquet-deposits.confirm',
            requestPayload: body.sourcePayload || body.source_payload || null
        },
        meta: {
            route: 'POST /api/banquet-deposits/:id/confirm'
        }
    };
}

function patchPayload(body = {}) {
    return {
        clientNameSnapshot: firstValue(body, 'clientNameSnapshot', 'client_name_snapshot', 'clientName', 'client_name'),
        eventDate: firstValue(body, 'eventDate', 'event_date'),
        banquetNumberSnapshot: firstValue(body, 'banquetNumberSnapshot', 'banquet_number_snapshot', 'banquetNumber', 'banquet_number'),
        amount: firstValue(body, 'amount'),
        paymentMethod: firstValue(body, 'paymentMethod', 'payment_method'),
        status: firstValue(body, 'status'),
        accountantTaskId: firstValue(body, 'accountantTaskId', 'accountant_task_id'),
        note: body.note || body.comment || null,
        sourcePayload: {
            source: 'routes/banquet-deposits.patch',
            requestPayload: body.sourcePayload || body.source_payload || null
        },
        meta: {
            ...((body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) ? body.meta : {}),
            route: 'PATCH /api/banquet-deposits/:id'
        }
    };
}

function sendDepositError(res, err) {
    if (err instanceof BanquetDepositError) {
        return res.status(err.status || 400).json({
            success: false,
            error: err.message,
            code: err.code,
            details: err.details || undefined
        });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
}

router.get('/:id', requireRole(...VIEW_ROLES), async (req, res) => {
    try {
        const depositId = parseDepositId(req.params.id);
        if (!depositId) {
            return res.status(400).json({ success: false, error: 'Invalid deposit ID', code: 'INVALID_DEPOSIT_ID' });
        }
        const businessContext = businessContextFromRequest(req);
        if (!requireBusinessContext(req, res, businessContext)) return;
        const projection = await getDepositProjectionById({ depositId, businessContext });
        return res.json({ success: true, ...projection });
    } catch (err) {
        if (!(err instanceof BanquetDepositError)) log.error('GET /banquet-deposits/:id error', err);
        return sendDepositError(res, err);
    }
});

router.post('/:id/confirm', requireRole(...CONFIRM_ROLES), async (req, res) => {
    try {
        const depositId = parseDepositId(req.params.id);
        if (!depositId) {
            return res.status(400).json({ success: false, error: 'Invalid deposit ID', code: 'INVALID_DEPOSIT_ID' });
        }
        const businessContext = businessContextFromRequest(req);
        if (!requireBusinessContext(req, res, businessContext)) return;
        const payload = confirmationPayload(req.body || {});
        if (payload.error) {
            return res.status(400).json({
                success: false,
                error: payload.error,
                code: 'DEPOSIT_CONFIRMATION_INCOMPLETE',
                field: payload.field
            });
        }
        const result = await confirmDeposit({
            ...payload,
            depositId,
            businessContext,
            actor: req.user,
            verifiedBy: req.user?.id || null
        });
        return res.json({ success: true, ...result.projection });
    } catch (err) {
        if (!(err instanceof BanquetDepositError)) log.error('POST /banquet-deposits/:id/confirm error', err);
        return sendDepositError(res, err);
    }
});

router.patch('/:id', requireRole(...CONFIRM_ROLES), async (req, res) => {
    try {
        const depositId = parseDepositId(req.params.id);
        if (!depositId) {
            return res.status(400).json({ success: false, error: 'Invalid deposit ID', code: 'INVALID_DEPOSIT_ID' });
        }
        const businessContext = businessContextFromRequest(req);
        if (!requireBusinessContext(req, res, businessContext)) return;
        const result = await patchDeposit({
            ...patchPayload(req.body || {}),
            depositId,
            businessContext,
            actor: req.user,
            correctedBy: req.user?.id || null
        });
        return res.json({ success: true, ...result.projection });
    } catch (err) {
        if (!(err instanceof BanquetDepositError)) log.error('PATCH /banquet-deposits/:id error', err);
        return sendDepositError(res, err);
    }
});

module.exports = router;
