'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { publishInTransaction } = require('../eventBus');
const { CheckboxClientError } = require('../checkbox/errors');
const { createCheckboxProviderFactory } = require('../checkbox/provider');

const WORKER_NAME = 'payment-outbox-worker';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LOCK_EXPIRY_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const RETRYABLE_JOB_TYPES = Object.freeze([
    'receipt_sell',
    'receipt_status_lookup',
    'receipt_validate',
    'receipt_return',
    'service_receipt',
    'shift_open',
    'shift_close'
]);

class PaymentOutboxWorkerError extends Error {
    constructor(code, message, { retryable = true, unknown = false, details = null } = {}) {
        super(message || code);
        this.name = 'PaymentOutboxWorkerError';
        this.code = code;
        this.retryable = retryable;
        this.unknown = unknown;
        this.details = details;
    }
}

function createUnavailableCheckboxProvider() {
    return {
        async lookupReceipt() {
            throw new PaymentOutboxWorkerError('checkbox_provider_unconfigured', 'Checkbox provider is not configured', { retryable: true });
        },
        async validateSale() {
            throw new PaymentOutboxWorkerError('checkbox_provider_unconfigured', 'Checkbox provider is not configured', { retryable: true });
        },
        async createSaleReceipt() {
            throw new PaymentOutboxWorkerError('checkbox_provider_unconfigured', 'Checkbox provider is not configured', { retryable: true, unknown: true });
        },
        async createReturnReceipt() {
            throw new PaymentOutboxWorkerError('checkbox_provider_unconfigured', 'Checkbox provider is not configured', { retryable: true, unknown: true });
        },
        async createServiceReceipt() {
            throw new PaymentOutboxWorkerError('checkbox_provider_unconfigured', 'Checkbox provider is not configured', { retryable: true, unknown: true });
        },
        async openShift() {
            throw new PaymentOutboxWorkerError('checkbox_provider_unconfigured', 'Checkbox provider is not configured', { retryable: true, unknown: true });
        },
        async closeShift() {
            throw new PaymentOutboxWorkerError('checkbox_provider_unconfigured', 'Checkbox provider is not configured', { retryable: true, unknown: true });
        }
    };
}

function sanitizeError(error) {
    const code = String(error?.code || error?.name || 'payment_outbox_error').slice(0, 80);
    const message = String(error?.message || code)
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[redacted]')
        .replace(/(token|secret|password|pin|api[_-]?key|authorization)(["'\s:=]+)([^"'\s,}]+)/gi, '$1$2[redacted]')
        .slice(0, 1000);
    return { code, message };
}

function classifyWorkerError(error) {
    if (error instanceof PaymentOutboxWorkerError) {
        return { retryable: error.retryable !== false, unknown: error.unknown === true, ...sanitizeError(error) };
    }
    if (error instanceof CheckboxClientError) {
        return { retryable: error.retryable === true, unknown: error.unknown === true, ...sanitizeError(error) };
    }
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    const unknown = /timeout|aborted|network|econn|socket|fetch/.test(`${code} ${message}`);
    return { retryable: true, unknown, ...sanitizeError(error) };
}

function computeBackoffMs(attempts) {
    const safeAttempts = Math.max(1, Math.min(Number(attempts || 1), 10));
    const base = 30 * 1000;
    return Math.min(MAX_BACKOFF_MS, base * (2 ** (safeAttempts - 1)));
}

function workerId() {
    return `${WORKER_NAME}-${process.pid}-${crypto.randomUUID()}`;
}

async function withTransaction(dbPool, run) {
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function claimPaymentOutboxJobs(client, {
    batchSize = DEFAULT_BATCH_SIZE,
    lockedBy = workerId(),
    lockExpiryMs = DEFAULT_LOCK_EXPIRY_MS,
    eligibleFiscalProfileIds = null
} = {}) {
    const limit = Math.max(1, Math.min(Number(batchSize) || DEFAULT_BATCH_SIZE, 50));
    const lockExpirySeconds = Math.max(30, Math.floor(Number(lockExpiryMs || DEFAULT_LOCK_EXPIRY_MS) / 1000));
    if (Array.isArray(eligibleFiscalProfileIds) && eligibleFiscalProfileIds.length === 0) {
        return [];
    }
    const result = await client.query(
        `WITH candidate_jobs AS (
             SELECT id
               FROM payment_outbox_jobs
              WHERE job_type = ANY($1::text[])
                AND ($5::bigint[] IS NULL OR fiscal_profile_id = ANY($5::bigint[]))
                AND attempts < max_attempts
                AND EXISTS (
                    SELECT 1
                      FROM payment_orders po
                      JOIN fiscal_registers fr
                        ON fr.id = po.fiscal_register_id
                       AND fr.fiscal_profile_id = po.fiscal_profile_id
                       AND fr.provider = 'checkbox'
                       AND fr.status = 'active'
                       AND fr.feature_enabled = TRUE
                     WHERE po.id = payment_outbox_jobs.payment_order_id
                       AND po.fiscal_profile_id = payment_outbox_jobs.fiscal_profile_id
                )
                AND (
                    (status IN ('queued', 'failed') AND next_run_at <= NOW())
                    OR (status IN ('claimed', 'running') AND locked_at < NOW() - ($4::int * INTERVAL '1 second'))
                )
              ORDER BY priority ASC, next_run_at ASC, id ASC
              FOR UPDATE SKIP LOCKED
              LIMIT $2
         )
         UPDATE payment_outbox_jobs job
            SET status = 'claimed',
                locked_at = NOW(),
                locked_by = $3,
                attempts = job.attempts + 1,
                updated_at = NOW()
           FROM candidate_jobs
          WHERE job.id = candidate_jobs.id
          RETURNING job.*`,
        [
            RETRYABLE_JOB_TYPES,
            limit,
            lockedBy,
            lockExpirySeconds,
            Array.isArray(eligibleFiscalProfileIds) ? eligibleFiscalProfileIds.map(id => Number(id)) : null
        ]
    );
    return result.rows;
}

async function loadJobContext(client, job) {
    const context = await client.query(
        `SELECT
             job.*,
             fo.status AS fiscal_operation_status,
             fo.operation_type,
             fo.provider_operation_id,
             fo.provider_status,
             fo.payment_refund_id,
             fo.fiscal_shift_id,
             fo.amount_minor AS fiscal_operation_amount_minor,
             fo.request_snapshot AS fiscal_request_snapshot,
             po.status AS payment_order_status,
             po.payment_status,
             po.fiscal_status AS payment_order_fiscal_status,
             po.fiscal_register_id,
             po.cashier_user_id,
             po.total_amount_minor,
             po.payment_method,
             po.source_snapshot,
             po.confirmation_snapshot,
             fr.register_alias,
             fr.provider_register_id,
             fr.provider_license_ref,
             fr.feature_enabled AS register_feature_enabled,
             fcb.provider_cashier_id,
             fcb.provider_cashier_login_ref
           FROM payment_outbox_jobs job
           LEFT JOIN fiscal_operations fo
             ON fo.id = job.fiscal_operation_id
            AND fo.fiscal_profile_id = job.fiscal_profile_id
           LEFT JOIN payment_orders po
             ON po.id = job.payment_order_id
            AND po.fiscal_profile_id = job.fiscal_profile_id
           LEFT JOIN fiscal_registers fr
             ON fr.id = po.fiscal_register_id
            AND fr.fiscal_profile_id = po.fiscal_profile_id
           LEFT JOIN fiscal_cashier_bindings fcb
             ON fcb.fiscal_profile_id = po.fiscal_profile_id
            AND fcb.fiscal_register_id = po.fiscal_register_id
            AND fcb.user_id = po.cashier_user_id
            AND fcb.status = 'active'
          WHERE job.id = $1
          LIMIT 1`,
        [job.id]
    );
    if (!context.rows.length) {
        throw new PaymentOutboxWorkerError('payment_outbox_job_missing', 'Claimed payment outbox job was not found', { retryable: false });
    }
    const items = await client.query(
        `SELECT *
           FROM payment_order_items
          WHERE fiscal_profile_id = $1
            AND payment_order_id = $2
          ORDER BY line_number ASC`,
        [context.rows[0].fiscal_profile_id, context.rows[0].payment_order_id]
    );
    return { job: context.rows[0], items: items.rows };
}

function shouldLookupBeforeSale(contextJob) {
    return contextJob.job_type === 'receipt_status_lookup'
        || contextJob.fiscal_operation_status === 'unknown'
        || contextJob.fiscal_operation_status === 'failed'
        || Number(contextJob.attempts || 0) > 1;
}

async function lookupProviderReceipt(provider, context) {
    if (!context.job.provider_operation_id) {
        throw new PaymentOutboxWorkerError('provider_operation_id_missing', 'Fiscal operation has no provider operation id for lookup', { retryable: false });
    }
    return provider.lookupReceipt({
        providerOperationId: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job
    });
}

function normalizeProviderReceipt(receipt = {}, fallback = {}) {
    const providerReceiptId = String(receipt.id || receipt.receiptId || receipt.providerReceiptId || fallback.providerOperationId || '').trim();
    if (!providerReceiptId) {
        throw new PaymentOutboxWorkerError('provider_receipt_id_missing', 'Provider receipt response did not include a receipt id', { retryable: true, unknown: true });
    }
    const status = String(receipt.status || '').trim();
    const upperStatus = status.toUpperCase();
    if (upperStatus === 'CREATED') {
        throw new PaymentOutboxWorkerError('provider_receipt_pending', 'Provider receipt is not fiscalized yet', { retryable: true, unknown: true });
    }
    if (['ERROR', 'CANCELLATION', 'CANCELLED'].includes(upperStatus)) {
        throw new PaymentOutboxWorkerError('provider_receipt_failed', 'Provider receipt reached a terminal failure status', { retryable: false });
    }
    if (status && !['DONE', 'FISCALIZED', 'SUCCESS', 'SUCCEEDED'].includes(upperStatus)) {
        throw new PaymentOutboxWorkerError('provider_receipt_status_unknown', 'Provider receipt response has unsupported status', { retryable: true, unknown: true });
    }
    return {
        providerReceiptId,
        fiscalCode: receipt.fiscalCode || receipt.fiscal_code || null,
        serial: receipt.serial || receipt.providerSerial || null,
        taxUrl: receipt.taxUrl || receipt.tax_url || receipt.link || null,
        pdfUrl: receipt.pdfUrl || receipt.pdf_url || null,
        qrUrl: receipt.qrUrl || receipt.qr_url || null,
        status: receipt.status || 'fiscalized',
        totalAmountMinor: String(receipt.totalAmountMinor || receipt.total_amount_minor || fallback.totalAmountMinor || '0'),
        fiscalizedAt: receipt.fiscalizedAt || receipt.fiscalized_at || null,
        snapshot: receipt
    };
}


async function safePublishFiscalEvent(client, eventType, payload, aggregateType, aggregateId, idempotencyKey) {
    try {
        await publishInTransaction(client, eventType, payload, aggregateType, aggregateId, idempotencyKey);
    } catch (_) {
        // EventBus/Hermes failures must not roll back payment/fiscal state.
    }
}

function receiptTypeForOperation(operationType) {
    if (operationType === 'return') return 'return';
    if (operationType === 'service_in') return 'service_in';
    if (operationType === 'service_out') return 'service_out';
    return 'sale';
}

async function markFiscalized(client, context, receipt) {
    const normalized = normalizeProviderReceipt(receipt, {
        providerOperationId: context.job.provider_operation_id,
        totalAmountMinor: context.job.total_amount_minor || context.job.fiscal_operation_amount_minor
    });
    const operationId = context.job.fiscal_operation_id;
    const profileId = context.job.fiscal_profile_id;
    const orderId = context.job.payment_order_id;
    const refundId = context.job.payment_refund_id;
    const receiptType = receiptTypeForOperation(context.job.operation_type);

    await client.query(
        `UPDATE fiscal_operations
            SET status = 'fiscalized',
                provider_status = $3,
                response_snapshot = $4::jsonb,
                completed_at = COALESCE(completed_at, NOW()),
                last_error_code = NULL,
                last_error_message = NULL
          WHERE id = $1
            AND fiscal_profile_id = $2`,
        [operationId, profileId, normalized.status, JSON.stringify(normalized.snapshot)]
    );

    await client.query(
        `INSERT INTO fiscal_receipts (
             fiscal_profile_id, fiscal_operation_id, payment_order_id, payment_refund_id, receipt_type, status,
             provider, provider_receipt_id, provider_fiscal_code, provider_serial,
             provider_tax_url, provider_pdf_url, provider_qr_url, total_amount_minor,
             currency, fiscalized_at, provider_snapshot
         )
         VALUES ($1, $2, $3, $4, $5, 'fiscalized', 'checkbox', $6, $7, $8, $9, $10, $11, $12, 'UAH', COALESCE($13::timestamptz, NOW()), $14::jsonb)
         ON CONFLICT (provider, provider_receipt_id) DO UPDATE
             SET status = 'fiscalized',
                 provider_fiscal_code = COALESCE(EXCLUDED.provider_fiscal_code, fiscal_receipts.provider_fiscal_code),
                 provider_snapshot = EXCLUDED.provider_snapshot,
                 updated_at = NOW()
         RETURNING id`,
        [
            profileId,
            operationId,
            orderId,
            refundId,
            receiptType,
            normalized.providerReceiptId,
            normalized.fiscalCode,
            normalized.serial,
            normalized.taxUrl,
            normalized.pdfUrl,
            normalized.qrUrl,
            normalized.totalAmountMinor,
            normalized.fiscalizedAt,
            JSON.stringify(normalized.snapshot)
        ]
    );

    if (orderId && receiptType === 'sale') {
        await client.query(
            `UPDATE payment_orders
                SET fiscal_status = 'fiscalized',
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2`,
            [orderId, profileId]
        );
    }

    if (refundId && receiptType === 'return') {
        await client.query(
            `UPDATE payment_refunds
                SET fiscal_refund_status = 'returned',
                    status = CASE WHEN money_refund_status = 'refunded' THEN 'fiscal_returned' ELSE status END,
                    completed_at = CASE WHEN money_refund_status = 'refunded' THEN COALESCE(completed_at, NOW()) ELSE completed_at END
              WHERE id = $1
                AND fiscal_profile_id = $2`,
            [refundId, profileId]
        );
        await safePublishFiscalEvent(
            client,
            'refund.completed',
            { fiscalProfileId: Number(profileId), paymentOrderId: orderId ? Number(orderId) : null, refundId: Number(refundId), fiscalOperationId: Number(operationId) },
            'payment_refund',
            String(refundId),
            `refund.completed:${refundId}`
        );
    }

    await safePublishFiscalEvent(
        client,
        'fiscal.receipt_succeeded',
        { fiscalProfileId: Number(profileId), paymentOrderId: orderId ? Number(orderId) : null, refundId: refundId ? Number(refundId) : null, fiscalOperationId: Number(operationId), providerReceiptId: normalized.providerReceiptId, receiptType },
        'fiscal_operation',
        String(operationId),
        `fiscal.receipt_succeeded:${operationId}`
    );
}

async function markJobSucceeded(client, job) {
    await client.query(
        `UPDATE payment_outbox_jobs
            SET status = 'succeeded',
                locked_at = NULL,
                locked_by = NULL,
                last_error_code = NULL,
                last_error_message = NULL,
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $2`,
        [job.id, job.fiscal_profile_id]
    );
}

async function markJobFailed(client, context, errorInfo) {
    const dead = Number(context.job.attempts || 0) >= Number(context.job.max_attempts || 1) || errorInfo.retryable === false;
    const nextRun = new Date(Date.now() + computeBackoffMs(context.job.attempts)).toISOString();
    await client.query(
        `UPDATE payment_outbox_jobs
            SET status = $3::text,
                locked_at = NULL,
                locked_by = NULL,
                next_run_at = CASE WHEN $3::text = 'dead' THEN next_run_at ELSE $4::timestamptz END,
                last_error_code = $5,
                last_error_message = $6,
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $2`,
        [context.job.id, context.job.fiscal_profile_id, dead ? 'dead' : 'failed', nextRun, errorInfo.code, errorInfo.message]
    );

    if (context.job.fiscal_operation_id) {
        const nextStatus = errorInfo.unknown ? 'unknown' : (errorInfo.retryable === false ? 'blocked' : 'failed');
        await client.query(
            `UPDATE fiscal_operations
                SET status = $3::text,
                    last_error_code = $4,
                    last_error_message = $5,
                    next_status_check_at = CASE WHEN $3::text IN ('unknown', 'failed') THEN $6::timestamptz ELSE next_status_check_at END
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND status <> 'fiscalized'`,
            [context.job.fiscal_operation_id, context.job.fiscal_profile_id, nextStatus, errorInfo.code, errorInfo.message, nextRun]
        );
        if (context.job.payment_order_id && context.job.operation_type === 'sale') {
            await client.query(
                `UPDATE payment_orders
                    SET fiscal_status = $3::text,
                        updated_at = NOW()
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND fiscal_status <> 'fiscalized'`,
                [context.job.payment_order_id, context.job.fiscal_profile_id, nextStatus]
            );
        }
        if (context.job.payment_refund_id && context.job.operation_type === 'return') {
            await client.query(
                `UPDATE payment_refunds
                    SET fiscal_refund_status = $3::text
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND fiscal_refund_status <> 'returned'`,
                [context.job.payment_refund_id, context.job.fiscal_profile_id, nextStatus === 'blocked' ? 'failed' : nextStatus]
            );
        }
        await safePublishFiscalEvent(
            client,
            nextStatus === 'unknown' ? 'fiscal.unknown' : 'fiscal.receipt_failed',
            { fiscalProfileId: Number(context.job.fiscal_profile_id), paymentOrderId: context.job.payment_order_id ? Number(context.job.payment_order_id) : null, refundId: context.job.payment_refund_id ? Number(context.job.payment_refund_id) : null, fiscalOperationId: Number(context.job.fiscal_operation_id), status: nextStatus, errorCode: errorInfo.code },
            'fiscal_operation',
            String(context.job.fiscal_operation_id),
            `${nextStatus === 'unknown' ? 'fiscal.unknown' : 'fiscal.receipt_failed'}:${context.job.fiscal_operation_id}:${context.job.attempts}`
        );
    }
}


async function runReceiptReturnJob(provider, context) {
    if (context.job.fiscal_operation_status === 'unknown' || Number(context.job.attempts || 0) > 1) {
        const lookup = await lookupProviderReceipt(provider, context);
        if (lookup?.found || lookup?.receipt) return { receipt: lookup.receipt || lookup, source: 'lookup' };
        if (context.job.fiscal_operation_status === 'unknown') {
            throw new PaymentOutboxWorkerError('return_lookup_required_before_retry', 'Unknown return operation must be reconciled before another return attempt', { retryable: true, unknown: true });
        }
    }
    if (!provider.createReturnReceipt) {
        throw new PaymentOutboxWorkerError('checkbox_return_not_supported', 'Checkbox return receipt operation is not configured', { retryable: false });
    }
    return { receipt: await provider.createReturnReceipt({ fiscalOperation: context.job, paymentOrder: context.job }), source: 'return' };
}

async function runServiceReceiptJob(provider, context) {
    if (!provider.createServiceReceipt) {
        throw new PaymentOutboxWorkerError('checkbox_service_receipt_not_supported', 'Checkbox service receipt operation is not configured', { retryable: false });
    }
    return { receipt: await provider.createServiceReceipt({ fiscalOperation: context.job }), source: 'service' };
}

async function markShiftJobSucceeded(client, context, result) {
    const payload = context.job.payload || {};
    const shiftId = payload.fiscal_shift_id || context.job.fiscal_shift_id;
    if (!shiftId && context.job.job_type === 'shift_close') {
        throw new PaymentOutboxWorkerError('shift_id_missing', 'Shift close job requires fiscal_shift_id', { retryable: false });
    }
    if (context.job.fiscal_operation_id) {
        await client.query(
            `UPDATE fiscal_operations
                SET status = 'fiscalized',
                    response_snapshot = $3::jsonb,
                    completed_at = COALESCE(completed_at, NOW()),
                    last_error_code = NULL,
                    last_error_message = NULL
              WHERE id = $1
                AND fiscal_profile_id = $2`,
            [context.job.fiscal_operation_id, context.job.fiscal_profile_id, JSON.stringify(result.response || {})]
        );
    }
    if (context.job.job_type === 'shift_open') {
        await markJobSucceeded(client, context.job);
        return { ok: true, jobId: Number(context.job.id), source: result.source };
    }
    await client.query(
        `UPDATE fiscal_shifts
            SET status = 'closed',
                closed_at = COALESCE(closed_at, NOW()),
                provider_closed_at = COALESCE(provider_closed_at, NOW()),
                provider_snapshot = provider_snapshot || $3::jsonb,
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $2`,
        [shiftId, context.job.fiscal_profile_id, JSON.stringify({ close_result: result.response || {} })]
    );
    await markJobSucceeded(client, context.job);
    return { ok: true, jobId: Number(context.job.id), source: result.source };
}

async function runShiftJob(provider, context) {
    const method = context.job.job_type === 'shift_open' ? provider.openShift : provider.closeShift;
    if (!method) {
        throw new PaymentOutboxWorkerError('checkbox_shift_operation_not_supported', 'Checkbox shift operation is not configured', { retryable: false });
    }
    const response = await method.call(provider, { fiscalOperation: context.job, payload: context.job.payload || {} });
    return { response, source: context.job.job_type };
}

async function runReceiptSaleJob(provider, context) {
    if (shouldLookupBeforeSale(context.job)) {
        const lookup = await lookupProviderReceipt(provider, context);
        if (lookup?.found || lookup?.receipt) {
            return { receipt: lookup.receipt || lookup, source: 'lookup' };
        }
        if (context.job.fiscal_operation_status === 'unknown') {
            throw new PaymentOutboxWorkerError('receipt_lookup_required_before_retry', 'Unknown fiscal operation must be reconciled before another sale attempt', { retryable: true, unknown: true });
        }
    }

    if (context.job.job_type === 'receipt_status_lookup') {
        throw new PaymentOutboxWorkerError('receipt_not_found_for_status_lookup', 'Provider receipt was not found during status lookup', { retryable: true, unknown: true });
    }

    await provider.validateSale({
        providerOperationId: context.job.provider_operation_id,
        providerRequestUuid: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items
    });
    const receipt = await provider.createSaleReceipt({
        providerOperationId: context.job.provider_operation_id,
        providerRequestUuid: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items
    });
    return { receipt, source: 'sale' };
}

async function processOnePaymentOutboxJob({ dbPool, provider, job }) {
    return withTransaction(dbPool, async client => {
        const context = await loadJobContext(client, job);
        const effectiveProvider = provider?.createForContext ? provider.createForContext(context) : provider;
        try {
            let result;
            if (context.job.job_type === 'receipt_sell' || context.job.job_type === 'receipt_status_lookup') {
                result = await runReceiptSaleJob(effectiveProvider, context);
                await markFiscalized(client, context, result.receipt);
                await markJobSucceeded(client, context.job);
                return { ok: true, jobId: Number(context.job.id), source: result.source };
            }
            if (context.job.job_type === 'receipt_return') {
                result = await runReceiptReturnJob(effectiveProvider, context);
                await markFiscalized(client, context, result.receipt);
                await markJobSucceeded(client, context.job);
                return { ok: true, jobId: Number(context.job.id), source: result.source };
            }
            if (context.job.job_type === 'service_receipt') {
                result = await runServiceReceiptJob(effectiveProvider, context);
                await markFiscalized(client, context, result.receipt);
                await markJobSucceeded(client, context.job);
                return { ok: true, jobId: Number(context.job.id), source: result.source };
            }
            if (context.job.job_type === 'shift_open' || context.job.job_type === 'shift_close') {
                result = await runShiftJob(effectiveProvider, context);
                return markShiftJobSucceeded(client, context, result);
            }
            throw new PaymentOutboxWorkerError('payment_outbox_job_type_not_supported', 'Payment outbox job type is not supported by this worker', { retryable: false });
        } catch (error) {
            const errorInfo = classifyWorkerError(error);
            await markJobFailed(client, context, errorInfo);
            return { ok: false, jobId: Number(context.job.id), error: errorInfo };
        }
    });
}

async function processPaymentOutboxJobs({
    dbPool = pool,
    provider = null,
    batchSize = DEFAULT_BATCH_SIZE,
    lockedBy = workerId(),
    lockExpiryMs = DEFAULT_LOCK_EXPIRY_MS
} = {}) {
    const effectiveProvider = provider || createCheckboxProviderFactory();
    let eligibleFiscalProfileIds = null;
    if (!provider && effectiveProvider?.getEligibleFiscalProfileIds) {
        eligibleFiscalProfileIds = await effectiveProvider.getEligibleFiscalProfileIds(dbPool);
        if (!eligibleFiscalProfileIds.length) {
            return {
                claimed: 0,
                succeeded: 0,
                failed: 0,
                skipped: true,
                reason: effectiveProvider.isEnabled && !effectiveProvider.isEnabled()
                    ? 'checkbox_integration_disabled'
                    : 'checkbox_runtime_config_unavailable',
                results: []
            };
        }
    }
    const claimed = await withTransaction(dbPool, client => claimPaymentOutboxJobs(client, { batchSize, lockedBy, lockExpiryMs, eligibleFiscalProfileIds }));
    const results = [];
    for (const job of claimed) {
        results.push(await processOnePaymentOutboxJob({ dbPool, provider: effectiveProvider, job }));
    }
    return {
        claimed: claimed.length,
        succeeded: results.filter(result => result.ok).length,
        failed: results.filter(result => !result.ok).length,
        results
    };
}

module.exports = {
    DEFAULT_BATCH_SIZE,
    DEFAULT_LOCK_EXPIRY_MS,
    PaymentOutboxWorkerError,
    RETRYABLE_JOB_TYPES,
    claimPaymentOutboxJobs,
    classifyWorkerError,
    computeBackoffMs,
    createUnavailableCheckboxProvider,
    processOnePaymentOutboxJob,
    processPaymentOutboxJobs,
    sanitizeError,
    shouldLookupBeforeSale
};
