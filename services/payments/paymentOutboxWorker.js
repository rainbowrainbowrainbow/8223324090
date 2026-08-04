'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');

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
    lockExpiryMs = DEFAULT_LOCK_EXPIRY_MS
} = {}) {
    const limit = Math.max(1, Math.min(Number(batchSize) || DEFAULT_BATCH_SIZE, 50));
    const lockExpirySeconds = Math.max(30, Math.floor(Number(lockExpiryMs || DEFAULT_LOCK_EXPIRY_MS) / 1000));
    const result = await client.query(
        `WITH candidate_jobs AS (
             SELECT id
               FROM payment_outbox_jobs
              WHERE job_type = ANY($1::text[])
                AND attempts < max_attempts
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
        [RETRYABLE_JOB_TYPES, limit, lockedBy, lockExpirySeconds]
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
             fo.request_snapshot AS fiscal_request_snapshot,
             po.status AS payment_order_status,
             po.payment_status,
             po.fiscal_status AS payment_order_fiscal_status,
             po.total_amount_minor,
             po.payment_method,
             po.source_snapshot,
             po.confirmation_snapshot
           FROM payment_outbox_jobs job
           LEFT JOIN fiscal_operations fo
             ON fo.id = job.fiscal_operation_id
            AND fo.fiscal_profile_id = job.fiscal_profile_id
           LEFT JOIN payment_orders po
             ON po.id = job.payment_order_id
            AND po.fiscal_profile_id = job.fiscal_profile_id
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

async function markFiscalized(client, context, receipt) {
    const normalized = normalizeProviderReceipt(receipt, {
        providerOperationId: context.job.provider_operation_id,
        totalAmountMinor: context.job.total_amount_minor
    });
    const operationId = context.job.fiscal_operation_id;
    const profileId = context.job.fiscal_profile_id;
    const orderId = context.job.payment_order_id;

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
             fiscal_profile_id, fiscal_operation_id, payment_order_id, receipt_type, status,
             provider, provider_receipt_id, provider_fiscal_code, provider_serial,
             provider_tax_url, provider_pdf_url, provider_qr_url, total_amount_minor,
             currency, fiscalized_at, provider_snapshot
         )
         VALUES ($1, $2, $3, 'sale', 'fiscalized', 'checkbox', $4, $5, $6, $7, $8, $9, $10, 'UAH', COALESCE($11::timestamptz, NOW()), $12::jsonb)
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

    await client.query(
        `UPDATE payment_orders
            SET fiscal_status = 'fiscalized',
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $2`,
        [orderId, profileId]
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
            SET status = $3,
                locked_at = NULL,
                locked_by = NULL,
                next_run_at = CASE WHEN $3 = 'dead' THEN next_run_at ELSE $4::timestamptz END,
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
                SET status = $3,
                    last_error_code = $4,
                    last_error_message = $5,
                    next_status_check_at = CASE WHEN $3 IN ('unknown', 'failed') THEN $6::timestamptz ELSE next_status_check_at END
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND status <> 'fiscalized'`,
            [context.job.fiscal_operation_id, context.job.fiscal_profile_id, nextStatus, errorInfo.code, errorInfo.message, nextRun]
        );
    }
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
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items
    });
    const receipt = await provider.createSaleReceipt({
        providerOperationId: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items
    });
    return { receipt, source: 'sale' };
}

async function processOnePaymentOutboxJob({ dbPool, provider, job }) {
    return withTransaction(dbPool, async client => {
        const context = await loadJobContext(client, job);
        try {
            let result;
            if (context.job.job_type === 'receipt_sell' || context.job.job_type === 'receipt_status_lookup') {
                result = await runReceiptSaleJob(provider, context);
                await markFiscalized(client, context, result.receipt);
                await markJobSucceeded(client, context.job);
                return { ok: true, jobId: Number(context.job.id), source: result.source };
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
    provider = createUnavailableCheckboxProvider(),
    batchSize = DEFAULT_BATCH_SIZE,
    lockedBy = workerId(),
    lockExpiryMs = DEFAULT_LOCK_EXPIRY_MS
} = {}) {
    const claimed = await withTransaction(dbPool, client => claimPaymentOutboxJobs(client, { batchSize, lockedBy, lockExpiryMs }));
    const results = [];
    for (const job of claimed) {
        results.push(await processOnePaymentOutboxJob({ dbPool, provider, job }));
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