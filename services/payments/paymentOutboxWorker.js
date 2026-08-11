'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { publishInTransaction } = require('../eventBus');
const { CheckboxClientError } = require('../checkbox/errors');
const { createCheckboxProviderFactory, runtimeContextKey } = require('../checkbox/provider');
const { isCashierProEnabled } = require('../checkbox/config');

const WORKER_NAME = 'payment-outbox-worker';
const DEFAULT_BATCH_SIZE = 1;
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
const PRE_SELL_STAGES = new Set(['auth', 'readiness', 'shift_request', 'shift_request_maybe_submitted', 'shift_lookup', 'receipt_validation']);
const POST_SELL_STAGES = new Set(['sale_submit', 'receipt_lookup', 'complete']);
const SHIFT_OPEN_LOOKUP_STAGES = new Set(['shift_request_maybe_submitted', 'shift_lookup']);
const SHIFT_CLOSE_LOOKUP_STAGES = new Set(['shift_close_request', 'shift_close_lookup']);
const SHIFT_LIFECYCLE_TRANSITIONS = Object.freeze({
    CREATED: ['OPENING'],
    OPENING: ['OPENED', 'CLOSED'],
    OPENED: ['CLOSING', 'CLOSED'],
    CLOSING: ['CLOSED'],
    CLOSED: ['OPENING']
});
const CASHIER_PRO_JOB_TYPES = new Set(['receipt_return', 'service_receipt']);

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

function safeJsonObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function normalizeBoolean(value) {
    if (value === true || value === false) return value;
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
    return null;
}

function assertLifecycleTransition(current, next) {
    const currentText = String(current || '').trim().toUpperCase();
    const nextText = String(next || '').trim().toUpperCase();
    const allowed = SHIFT_LIFECYCLE_TRANSITIONS[currentText] || [];
    if (!allowed.includes(nextText)) {
        throw new PaymentOutboxWorkerError('invalid_shift_lifecycle_transition', 'Invalid fiscal shift lifecycle transition', {
            retryable: false,
            details: { current: currentText || null, next: nextText || null, allowed }
        });
    }
}

function classifyWorkerError(error) {
    if (error instanceof PaymentOutboxWorkerError) {
        return { retryable: error.retryable !== false, unknown: error.unknown === true, ...sanitizeError(error) };
    }
    if (error instanceof CheckboxClientError) {
        const sanitized = sanitizeError(error);
        return {
            retryable: error.retryable === true,
            unknown: error.unknown === true,
            configuration: error.configuration === true || /^checkbox_(runtime_env|credential_ref|integration_disabled)/.test(sanitized.code),
            ...sanitized
        };
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

function lockToken() {
    return crypto.randomUUID();
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
    eligibleFiscalProfileIds = null,
    eligibleRuntimeContexts = null,
    cashierProEnabled = isCashierProEnabled(process.env)
} = {}) {
    const limit = Math.max(1, Math.min(Number(batchSize) || DEFAULT_BATCH_SIZE, 50));
    const lockExpirySeconds = Math.max(30, Math.floor(Number(lockExpiryMs || DEFAULT_LOCK_EXPIRY_MS) / 1000));
    if (Array.isArray(eligibleFiscalProfileIds) && eligibleFiscalProfileIds.length === 0) {
        return [];
    }
    const runtimeKeys = Array.isArray(eligibleRuntimeContexts)
        ? eligibleRuntimeContexts.map(runtimeContextKey).filter(Boolean)
        : null;
    if (Array.isArray(runtimeKeys) && runtimeKeys.length === 0) {
        return [];
    }
    const token = lockToken();
    const claimableJobTypes = cashierProEnabled
        ? RETRYABLE_JOB_TYPES
        : RETRYABLE_JOB_TYPES.filter(type => !CASHIER_PRO_JOB_TYPES.has(type));
    const result = await client.query(
        `WITH candidate_jobs AS (
             SELECT job.id
               FROM payment_outbox_jobs job
               JOIN fiscal_operations fo
                 ON fo.id = job.fiscal_operation_id
                AND fo.fiscal_profile_id = job.fiscal_profile_id
                AND fo.provider = 'checkbox'
               LEFT JOIN payment_orders po
                 ON po.id = job.payment_order_id
                AND po.fiscal_profile_id = job.fiscal_profile_id
               LEFT JOIN fiscal_shifts fs
                 ON fs.id = fo.fiscal_shift_id
                AND fs.fiscal_profile_id = job.fiscal_profile_id
               JOIN fiscal_registers fr
                 ON fr.id = COALESCE(po.fiscal_register_id, fo.fiscal_register_id)
                AND fr.fiscal_profile_id = job.fiscal_profile_id
                AND fr.provider = 'checkbox'
                AND fr.status = 'active'
                AND fr.feature_enabled = TRUE
              WHERE job.job_type = ANY($1::text[])
                AND ($8::boolean = TRUE OR job.job_type <> 'shift_close' OR job.payload->>'phase' = 'thin_mvp_shift_close')
                AND ($5::bigint[] IS NULL OR job.fiscal_profile_id = ANY($5::bigint[]))
                AND ($6::text[] IS NULL OR (job.fiscal_profile_id::text || ':' || COALESCE(po.fiscal_register_id, fo.fiscal_register_id)::text) = ANY($6::text[]))
                AND COALESCE(job.payload->>'provider', fo.provider, fr.provider) = 'checkbox'
                AND (
                    job.job_type <> 'receipt_sell'
                    OR (fs.status = 'open' AND fs.provider_shift_id IS NOT NULL AND fs.lifecycle_stage = 'OPENED')
                )
                AND NOT EXISTS (
                    SELECT 1
                      FROM payment_outbox_jobs active_job
                      LEFT JOIN fiscal_operations active_fo
                        ON active_fo.id = active_job.fiscal_operation_id
                       AND active_fo.fiscal_profile_id = active_job.fiscal_profile_id
                      LEFT JOIN payment_orders active_po
                        ON active_po.id = active_job.payment_order_id
                       AND active_po.fiscal_profile_id = active_job.fiscal_profile_id
                     WHERE active_job.id <> job.id
                       AND active_job.fiscal_profile_id = job.fiscal_profile_id
                       AND COALESCE(active_po.fiscal_register_id, active_fo.fiscal_register_id) = COALESCE(po.fiscal_register_id, fo.fiscal_register_id)
                       AND active_job.status IN ('claimed', 'running')
                       AND COALESCE(active_job.heartbeat_at, active_job.locked_at) >= NOW() - ($4::int * INTERVAL '1 second')
                )
                AND job.attempts < job.max_attempts
                AND (
                    (job.status IN ('queued', 'failed') AND job.next_run_at <= NOW())
                    OR (job.status IN ('claimed', 'running') AND COALESCE(job.heartbeat_at, job.locked_at) < NOW() - ($4::int * INTERVAL '1 second'))
                )
              ORDER BY job.priority ASC, job.next_run_at ASC, job.id ASC
              FOR UPDATE OF job SKIP LOCKED
              LIMIT $2
         )
         UPDATE payment_outbox_jobs job
            SET status = 'claimed',
                locked_at = NOW(),
                locked_by = $3,
                lock_token = $7::uuid,
                lock_version = lock_version + 1,
                heartbeat_at = NOW(),
                attempts = job.attempts + 1,
                updated_at = NOW()
           FROM candidate_jobs
          WHERE job.id = candidate_jobs.id
          RETURNING job.*`,
        [
            claimableJobTypes,
            limit,
            lockedBy,
            lockExpirySeconds,
            Array.isArray(eligibleFiscalProfileIds) ? eligibleFiscalProfileIds.map(id => Number(id)) : null,
            runtimeKeys,
            token,
            cashierProEnabled === true
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
             fo.provider_organization_id,
             fo.provider_outlet_id,
             fo.provider_register_id,
             fo.provider_cashier_id,
             fo.register_credential_ref,
             fo.cashier_credential_ref,
             fo.expected_is_test,
             fo.fiscal_configuration_hash,
             fo.fiscal_location_id AS operation_fiscal_location_id,
             fo.external_stage AS fiscal_operation_external_stage,
             fo.payment_refund_id,
             fo.fiscal_shift_id,
             fo.amount_minor AS fiscal_operation_amount_minor,
             fo.request_snapshot AS fiscal_request_snapshot,
             fo.initiated_by_user_id AS fiscal_operation_initiated_by_user_id,
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
             fr.provider_register_id AS current_provider_register_id,
             fr.provider AS register_provider,
             fr.status AS register_status,
             fr.provider_license_ref,
             fr.feature_enabled AS register_feature_enabled,
             fr.metadata->>'expected_is_test' AS current_expected_is_test,
             fp.provider_organization_id AS current_provider_organization_id,
             fl.provider_outlet_id AS current_provider_outlet_id,
             fs.status AS fiscal_shift_status,
             fs.lifecycle_stage AS fiscal_shift_lifecycle_stage,
             fs.provider_shift_id,
             fcb.provider_cashier_id AS current_provider_cashier_id,
             fcb.provider_cashier_login_ref AS current_provider_cashier_login_ref
           FROM payment_outbox_jobs job
           LEFT JOIN fiscal_operations fo
             ON fo.id = job.fiscal_operation_id
            AND fo.fiscal_profile_id = job.fiscal_profile_id
           LEFT JOIN payment_orders po
             ON po.id = job.payment_order_id
            AND po.fiscal_profile_id = job.fiscal_profile_id
           LEFT JOIN fiscal_registers fr
             ON fr.id = COALESCE(po.fiscal_register_id, fo.fiscal_register_id)
            AND fr.fiscal_profile_id = job.fiscal_profile_id
           LEFT JOIN fiscal_profiles fp
             ON fp.id = job.fiscal_profile_id
           LEFT JOIN fiscal_locations fl
             ON fl.id = fr.fiscal_location_id
            AND fl.fiscal_profile_id = fr.fiscal_profile_id
           LEFT JOIN fiscal_shifts fs
             ON fs.id = fo.fiscal_shift_id
            AND fs.fiscal_profile_id = job.fiscal_profile_id
           LEFT JOIN fiscal_cashier_bindings fcb
             ON fcb.fiscal_profile_id = job.fiscal_profile_id
            AND fcb.fiscal_register_id = COALESCE(po.fiscal_register_id, fo.fiscal_register_id)
            AND fcb.user_id = COALESCE(po.cashier_user_id, fo.initiated_by_user_id)
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

function externalStage(contextJob = {}) {
    const payload = safeJsonObject(contextJob.payload);
    const request = safeJsonObject(contextJob.fiscal_request_snapshot);
    return String(contextJob.external_stage || payload.external_stage || contextJob.fiscal_operation_external_stage || request.external_stage || 'auth').trim() || 'auth';
}

function saleStageRequiresLookup(stage) {
    return POST_SELL_STAGES.has(String(stage || '').trim());
}

async function recordExternalStage(dbPool, context, stage) {
    const safeStage = String(stage || '').trim();
    if (!safeStage) return;
    context.job.payload = { ...safeJsonObject(context.job.payload), external_stage: safeStage };
    context.job.fiscal_request_snapshot = { ...safeJsonObject(context.job.fiscal_request_snapshot), external_stage: safeStage };
    context.job.external_stage = safeStage;
    await withTransaction(dbPool, async client => {
        const owner = await client.query(
            `UPDATE payment_outbox_jobs
                SET payload = payload || $3::jsonb,
                    external_stage = $5,
                    status = CASE WHEN status = 'claimed' THEN 'running' ELSE status END,
                    locked_at = NOW(),
                    heartbeat_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND locked_by = $4
                AND lock_token = $6::uuid
                AND status IN ('claimed', 'running')
              RETURNING id`,
            [
                context.job.id,
                context.job.fiscal_profile_id,
                JSON.stringify({ external_stage: safeStage }),
                context.job.locked_by,
                safeStage,
                context.job.lock_token
            ]
        );
        if (!owner.rows.length) {
            throw new PaymentOutboxWorkerError('payment_outbox_job_ownership_lost', 'Payment outbox job ownership was lost before external stage change', { retryable: true });
        }
        if (context.job.fiscal_operation_id) {
            await client.query(
                `UPDATE fiscal_operations
                    SET status = CASE
                            WHEN $3::jsonb->>'external_stage' = 'receipt_validation' THEN 'validating'
                            WHEN $3::jsonb->>'external_stage' = 'sale_submit' THEN 'sending'
                            WHEN status IN ('pending', 'failed') THEN 'pending'
                            ELSE status
                        END,
                        external_stage = $3::jsonb->>'external_stage',
                        sent_at = CASE WHEN $3::jsonb->>'external_stage' = 'sale_submit' THEN COALESCE(sent_at, NOW()) ELSE sent_at END
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND status <> 'fiscalized'`,
                [
                    context.job.fiscal_operation_id,
                    context.job.fiscal_profile_id,
                    JSON.stringify({ external_stage: safeStage })
                ]
            );
        }
        if ((safeStage === 'shift_request' || safeStage === 'shift_request_maybe_submitted') && context.job.fiscal_shift_id) {
            await client.query(
                `UPDATE fiscal_shifts
                    SET lifecycle_stage = 'OPENING',
                        provider_snapshot = provider_snapshot || $3::jsonb,
                        updated_at = NOW()
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND lifecycle_stage IN ('CREATED', 'OPENING')`,
                [
                    context.job.fiscal_shift_id,
                    context.job.fiscal_profile_id,
                    JSON.stringify({ lifecycle_stage: 'OPENING', external_stage: safeStage })
                ]
            );
        }
    });
}

async function recordExternalStageInTransaction(client, context, stage) {
    const safeStage = String(stage || '').trim();
    if (!safeStage) return;
    await client.query(
        `UPDATE payment_outbox_jobs
            SET payload = payload || $3::jsonb,
                external_stage = $3::jsonb->>'external_stage',
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $2`,
        [context.job.id, context.job.fiscal_profile_id, JSON.stringify({ external_stage: safeStage })]
    );
    if (context.job.fiscal_operation_id) {
        await client.query(
            `UPDATE fiscal_operations
                SET external_stage = $3::jsonb->>'external_stage'
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND status <> 'fiscalized'`,
            [context.job.fiscal_operation_id, context.job.fiscal_profile_id, JSON.stringify({ external_stage: safeStage })]
        );
    }
}

function assertImmutableProviderContext(context = {}) {
    const job = context.job || {};
    const hasSnapshot = Boolean(job.fiscal_configuration_hash);
    if (!hasSnapshot) return;
    const pairs = [
        ['provider_organization_id', job.provider_organization_id, job.current_provider_organization_id],
        ['provider_outlet_id', job.provider_outlet_id, job.current_provider_outlet_id],
        ['provider_register_id', job.provider_register_id, job.current_provider_register_id],
        ['provider_cashier_id', job.provider_cashier_id, job.current_provider_cashier_id],
        ['register_credential_ref', job.register_credential_ref, job.provider_license_ref],
        ['cashier_credential_ref', job.cashier_credential_ref, job.current_provider_cashier_login_ref]
    ];
    for (const [field, expected, current] of pairs) {
        const expectedText = String(expected ?? '').trim();
        const currentText = String(current ?? '').trim();
        if (expectedText && expectedText !== currentText) {
            throw new PaymentOutboxWorkerError('fiscal_provider_context_drift', 'Current fiscal mapping differs from immutable fiscal operation snapshot', {
                retryable: false,
                details: { field, expected: expectedText || null, current: currentText || null }
            });
        }
    }
    const expectedIsTest = normalizeBoolean(job.expected_is_test);
    const currentExpectedIsTest = normalizeBoolean(job.current_expected_is_test);
    if (expectedIsTest == null || currentExpectedIsTest == null || expectedIsTest !== currentExpectedIsTest) {
        throw new PaymentOutboxWorkerError('fiscal_provider_context_drift', 'Current fiscal mapping test-mode expectation differs from immutable fiscal operation snapshot', {
            retryable: false,
            details: { field: 'expected_is_test', expected: expectedIsTest, current: currentExpectedIsTest }
        });
    }
    const request = safeJsonObject(job.fiscal_request_snapshot);
    const requestHash = String(request.fiscal_configuration_hash || '').trim();
    const operationHash = String(job.fiscal_configuration_hash || '').trim();
    if (!operationHash || (requestHash && requestHash !== operationHash)) {
        throw new PaymentOutboxWorkerError('fiscal_configuration_hash_mismatch', 'Fiscal configuration hash is missing or inconsistent', {
            retryable: false,
            details: { hasOperationHash: Boolean(operationHash), hasRequestHash: Boolean(requestHash) }
        });
    }
}

async function lookupProviderReceipt(provider, context) {
    if (!context.job.provider_operation_id) {
        throw new PaymentOutboxWorkerError('provider_operation_id_missing', 'Fiscal operation has no provider operation id for lookup', { retryable: false });
    }
    return provider.lookupReceipt({
        providerOperationId: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items
    });
}

function requireProviderMatch(actual, expected, code, field) {
    const expectedText = String(expected ?? '').trim();
    if (!expectedText) return;
    const actualText = String(actual ?? '').trim();
    if (!actualText || actualText !== expectedText) {
        throw new PaymentOutboxWorkerError(code, `Provider receipt ${field} does not match immutable EventGenix context`, {
            retryable: false,
            details: { field, expected: expectedText, actual: actualText || null }
        });
    }
}

function receiptField(receipt = {}, ...names) {
    for (const name of names) {
        const value = receipt[name];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return null;
}

function normalizeProviderReceipt(receipt = {}, fallback = {}, context = {}) {
    const providerReceiptId = String(receipt.id || receipt.receiptId || receipt.providerReceiptId || '').trim();
    if (!providerReceiptId) {
        throw new PaymentOutboxWorkerError('provider_receipt_id_missing', 'Provider receipt response did not include a receipt id', { retryable: true, unknown: true });
    }
    requireProviderMatch(providerReceiptId, fallback.providerOperationId, 'provider_receipt_uuid_mismatch', 'id');
    const status = String(receipt.status || '').trim();
    const upperStatus = status.toUpperCase();
    if (upperStatus === 'CREATED') {
        throw new PaymentOutboxWorkerError('provider_receipt_pending', 'Provider receipt is not fiscalized yet', { retryable: true, unknown: true });
    }
    if (['ERROR', 'CANCELLATION', 'CANCELLED'].includes(upperStatus)) {
        throw new PaymentOutboxWorkerError('provider_receipt_failed', 'Provider receipt reached a terminal failure status', { retryable: false });
    }
    if (upperStatus !== 'DONE') {
        throw new PaymentOutboxWorkerError('provider_receipt_status_unknown', 'Provider receipt response has unsupported status', { retryable: true, unknown: true });
    }
    const expectedTotal = String(fallback.totalAmountMinor || '').trim();
    requireProviderMatch(receiptField(receipt, 'totalAmountMinor', 'total_amount_minor'), expectedTotal, 'provider_receipt_total_mismatch', 'totalAmountMinor');
    requireProviderMatch(receiptField(receipt, 'receiptType', 'receipt_type'), providerReceiptTypeForOperation(context.job?.operation_type), 'provider_receipt_type_mismatch', 'receiptType');
    requireProviderMatch(receiptField(receipt, 'providerRegisterId', 'provider_register_id'), context.job?.provider_register_id, 'provider_receipt_register_mismatch', 'providerRegisterId');
    requireProviderMatch(receiptField(receipt, 'providerCashierId', 'provider_cashier_id'), context.job?.provider_cashier_id, 'provider_receipt_cashier_mismatch', 'providerCashierId');
    return {
        providerReceiptId,
        fiscalCode: receipt.fiscalCode || receipt.fiscal_code || null,
        serial: receipt.serial || receipt.providerSerial || null,
        taxUrl: receipt.taxUrl || receipt.tax_url || receipt.link || null,
        pdfUrl: receipt.pdfUrl || receipt.pdf_url || null,
        qrUrl: receipt.qrUrl || receipt.qr_url || null,
        status: upperStatus,
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

function providerReceiptTypeForOperation(operationType) {
    if (operationType === 'return') return 'RETURN';
    if (operationType === 'service_in') return 'SERVICE_IN';
    if (operationType === 'service_out') return 'SERVICE_OUT';
    return 'SELL';
}

function valuesMismatch(existing, observed) {
    if (existing == null || observed == null) return false;
    return String(existing) !== String(observed);
}

function numberValuesMismatch(existing, observed) {
    if (existing == null || observed == null) return false;
    return Number(existing) !== Number(observed);
}

function collectReceiptMismatches(existing = {}, observed = {}, context = {}) {
    const mismatches = [];
    const expected = {
        fiscal_profile_id: context.job.fiscal_profile_id,
        fiscal_operation_id: context.job.fiscal_operation_id,
        payment_order_id: context.job.payment_order_id || null,
        payment_refund_id: context.job.payment_refund_id || null,
        receipt_type: receiptTypeForOperation(context.job.operation_type),
        provider: 'checkbox',
        provider_receipt_id: observed.providerReceiptId,
        provider_fiscal_code: observed.fiscalCode,
        provider_serial: observed.serial,
        provider_tax_url: observed.taxUrl,
        provider_pdf_url: observed.pdfUrl,
        provider_qr_url: observed.qrUrl,
        total_amount_minor: observed.totalAmountMinor,
        currency: 'UAH'
    };
    for (const field of [
        'fiscal_profile_id',
        'fiscal_operation_id',
        'payment_order_id',
        'payment_refund_id',
        'receipt_type',
        'provider',
        'provider_receipt_id',
        'currency'
    ]) {
        if (valuesMismatch(existing[field], expected[field])) {
            mismatches.push(field);
        }
    }
    if (numberValuesMismatch(existing.total_amount_minor, expected.total_amount_minor)) {
        mismatches.push('total_amount_minor');
    }
    for (const field of [
        'provider_fiscal_code',
        'provider_serial',
        'provider_tax_url',
        'provider_pdf_url',
        'provider_qr_url'
    ]) {
        if (valuesMismatch(existing[field], expected[field])) {
            mismatches.push(field);
        }
    }
    return mismatches;
}

async function recordReceiptObservation(client, context, normalized, { mismatches = [] } = {}) {
    await client.query(
        `INSERT INTO fiscal_audit_events (
             fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
             idempotency_key, after_snapshot, metadata
         )
         VALUES ($1, NULL, $2, 'fiscal_operations', $3, $4, $5::jsonb, $6::jsonb)`,
        [
            context.job.fiscal_profile_id,
            mismatches.length ? 'fiscal_receipt_mismatch_observed' : 'fiscal_provider_receipt_observed',
            context.job.fiscal_operation_id,
            `fiscal_receipt_observed:${context.job.fiscal_operation_id}:${normalized.providerReceiptId}:${mismatches.length ? 'mismatch' : 'ok'}:${Date.now()}`,
            JSON.stringify({
                provider_receipt_id: normalized.providerReceiptId,
                provider_status: normalized.status,
                provider_fiscal_code_present: Boolean(normalized.fiscalCode),
                provider_serial_present: Boolean(normalized.serial),
                total_amount_minor: normalized.totalAmountMinor == null ? null : String(normalized.totalAmountMinor)
            }),
            JSON.stringify({
                provider: 'checkbox',
                external_stage: externalStage(context.job),
                mismatches
            })
        ]
    );
}

async function recordReceiptMismatchIncident(client, context, normalized, mismatches = []) {
    await client.query(
        `INSERT INTO fiscal_operational_incidents (
             fiscal_profile_id, fiscal_register_id, fiscal_operation_id, payment_order_id,
             severity, incident_type, status, idempotency_key, details
         )
         VALUES ($1, $2, $3, $4, 'critical', 'fiscal.receipt_mismatch', 'open', $5, $6::jsonb)
         ON CONFLICT (idempotency_key) DO UPDATE
             SET status = 'open',
                 severity = EXCLUDED.severity,
                 details = fiscal_operational_incidents.details || EXCLUDED.details,
                 recurrence_count = CASE
                     WHEN fiscal_operational_incidents.status = 'resolved'
                     THEN fiscal_operational_incidents.recurrence_count + 1
                     ELSE fiscal_operational_incidents.recurrence_count
                 END,
                 last_seen_at = NOW(),
                 resolved_at = CASE
                     WHEN fiscal_operational_incidents.status = 'resolved' THEN NULL
                     ELSE fiscal_operational_incidents.resolved_at
                 END`,
        [
            context.job.fiscal_profile_id,
            context.job.fiscal_register_id || null,
            context.job.fiscal_operation_id,
            context.job.payment_order_id || null,
            `fiscal_receipt_mismatch:${context.job.fiscal_operation_id}:${normalized.providerReceiptId}`,
            JSON.stringify({
                provider_receipt_id: normalized.providerReceiptId,
                fiscal_operation_id: Number(context.job.fiscal_operation_id),
                payment_order_id: context.job.payment_order_id ? Number(context.job.payment_order_id) : null,
                mismatches
            })
        ]
    );
}

async function markFiscalized(client, context, receipt) {
    const normalized = normalizeProviderReceipt(receipt, {
        providerOperationId: context.job.provider_operation_id,
        totalAmountMinor: context.job.total_amount_minor || context.job.fiscal_operation_amount_minor
    }, context);
    const operationId = context.job.fiscal_operation_id;
    const profileId = context.job.fiscal_profile_id;
    const orderId = context.job.payment_order_id;
    const refundId = context.job.payment_refund_id;
    const receiptType = receiptTypeForOperation(context.job.operation_type);

    const existingReceipt = await client.query(
        `SELECT *
           FROM fiscal_receipts
          WHERE provider = 'checkbox'
            AND provider_receipt_id = $1
          LIMIT 1`,
        [normalized.providerReceiptId]
    );
    if (existingReceipt.rows.length) {
        const mismatches = collectReceiptMismatches(existingReceipt.rows[0], normalized, context);
        await recordReceiptObservation(client, context, normalized, { mismatches });
        if (mismatches.length) {
            await recordReceiptMismatchIncident(client, context, normalized, mismatches);
            throw new PaymentOutboxWorkerError('fiscal_receipt_identity_mismatch', 'Provider receipt observation conflicts with immutable local fiscal receipt', {
                retryable: false,
                details: { mismatches }
            });
        }
    } else {
        await recordReceiptObservation(client, context, normalized);
    }

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
                 provider_serial = COALESCE(fiscal_receipts.provider_serial, EXCLUDED.provider_serial),
                 provider_tax_url = COALESCE(fiscal_receipts.provider_tax_url, EXCLUDED.provider_tax_url),
                 provider_pdf_url = COALESCE(fiscal_receipts.provider_pdf_url, EXCLUDED.provider_pdf_url),
                 provider_qr_url = COALESCE(fiscal_receipts.provider_qr_url, EXCLUDED.provider_qr_url),
                 provider_snapshot = CASE
                     WHEN fiscal_receipts.provider_snapshot = '{}'::jsonb THEN EXCLUDED.provider_snapshot
                     ELSE fiscal_receipts.provider_snapshot
                 END,
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
                lock_token = NULL,
                heartbeat_at = NULL,
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
                lock_token = NULL,
                heartbeat_at = NULL,
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
        if (context.job.operation_type === 'shift_open' && context.job.fiscal_shift_id && (dead || errorInfo.retryable === false)) {
            await client.query(
                `UPDATE fiscal_shifts
                    SET status = $3::text,
                        provider_snapshot = provider_snapshot || $4::jsonb,
                        updated_at = NOW()
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND status = 'opening'`,
                [
                    context.job.fiscal_shift_id,
                    context.job.fiscal_profile_id,
                    errorInfo.retryable === false ? 'blocked' : 'failed',
                    JSON.stringify({ open_failed: { code: errorInfo.code, message: errorInfo.message } })
                ]
            );
        }
        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
                 idempotency_key, after_snapshot, metadata
             )
             VALUES ($1, NULL, 'payment_outbox_job_failed', 'payment_outbox_jobs', $2, $3, $4::jsonb, $5::jsonb)`,
            [
                context.job.fiscal_profile_id,
                context.job.id,
                `payment_outbox_job_failed:${context.job.id}:${context.job.attempts}`,
                JSON.stringify({ status: dead ? 'dead' : 'failed', error_code: errorInfo.code, external_stage: externalStage(context.job) }),
                JSON.stringify({ provider: 'checkbox', retryable: errorInfo.retryable, unknown: errorInfo.unknown, hermes_status_ignored: true })
            ]
        );
        await client.query(
            `INSERT INTO fiscal_operational_incidents (
                 fiscal_profile_id, fiscal_register_id, fiscal_operation_id, payment_order_id,
                 severity, incident_type, status, idempotency_key, details
             )
             VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8::jsonb)
             ON CONFLICT (idempotency_key) DO UPDATE
                 SET status = 'open',
                     severity = EXCLUDED.severity,
                     details = EXCLUDED.details,
                     recurrence_count = CASE
                         WHEN fiscal_operational_incidents.status = 'resolved'
                         THEN fiscal_operational_incidents.recurrence_count + 1
                         ELSE fiscal_operational_incidents.recurrence_count
                     END,
                     last_seen_at = NOW(),
                     resolved_at = CASE
                         WHEN fiscal_operational_incidents.status = 'resolved' THEN NULL
                         ELSE fiscal_operational_incidents.resolved_at
                     END`,
            [
                context.job.fiscal_profile_id,
                context.job.fiscal_register_id || null,
                context.job.fiscal_operation_id || null,
                context.job.payment_order_id || null,
                dead ? 'critical' : 'warning',
                nextStatus === 'unknown' ? 'fiscal.unknown' : (dead ? 'payment_outbox.dead' : 'payment_outbox.failed'),
                `payment_outbox_incident:${context.job.id}:${dead ? 'dead' : errorInfo.code}`,
                JSON.stringify({
                    job_id: Number(context.job.id),
                    fiscal_operation_id: context.job.fiscal_operation_id ? Number(context.job.fiscal_operation_id) : null,
                    payment_order_id: context.job.payment_order_id ? Number(context.job.payment_order_id) : null,
                    error_code: errorInfo.code,
                    retryable: errorInfo.retryable,
                    unknown: errorInfo.unknown,
                    external_stage: externalStage(context.job)
                })
            ]
        );
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

async function markJobConfigUnavailable(client, context, errorInfo) {
    await client.query(
        `UPDATE payment_outbox_jobs
            SET status = 'queued',
                locked_at = NULL,
                locked_by = NULL,
                lock_token = NULL,
                heartbeat_at = NULL,
                attempts = GREATEST(attempts - 1, 0),
                next_run_at = NOW() + INTERVAL '5 minutes',
                last_error_code = $3,
                last_error_message = $4,
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $2`,
        [context.job.id, context.job.fiscal_profile_id, errorInfo.code, errorInfo.message]
    );
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
    return { receipt: await provider.createReturnReceipt({ fiscalOperation: context.job, paymentOrder: context.job, items: context.items }), source: 'return' };
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
    if (!shiftId && (context.job.job_type === 'shift_open' || context.job.job_type === 'shift_close')) {
        throw new PaymentOutboxWorkerError('shift_id_missing', 'Shift job requires fiscal_shift_id', { retryable: false });
    }
    if (context.job.fiscal_operation_id) {
        await client.query(
            `UPDATE fiscal_operations
                SET status = 'fiscalized',
                    provider_status = $4,
                    response_snapshot = $3::jsonb,
                    completed_at = COALESCE(completed_at, NOW()),
                    last_error_code = NULL,
                    last_error_message = NULL
              WHERE id = $1
                AND fiscal_profile_id = $2`,
            [context.job.fiscal_operation_id, context.job.fiscal_profile_id, JSON.stringify(result.response || {}), result.response?.status || null]
        );
    }
    if (context.job.job_type === 'shift_open') {
        const providerStatus = String(result.response?.status || '').trim().toUpperCase();
        if (providerStatus !== 'OPENED') {
            throw new PaymentOutboxWorkerError('checkbox_shift_open_pending', 'Checkbox shift open has not reached OPENED status', {
                retryable: true,
                unknown: true,
                details: { providerStatus: providerStatus || null }
            });
        }
        assertLifecycleTransition(context.job.fiscal_shift_lifecycle_stage || 'OPENING', 'OPENED');
        await client.query(
            `UPDATE fiscal_shifts
                SET status = 'open',
                    lifecycle_stage = 'OPENED',
                    provider_shift_id = COALESCE(provider_shift_id, $3),
                    opened_at = COALESCE(opened_at, NOW()),
                    provider_opened_at = COALESCE(provider_opened_at, NOW()),
                    provider_snapshot = provider_snapshot || $4::jsonb,
                    updated_at = NOW()
                  WHERE id = $1
                AND fiscal_profile_id = $2
                AND status = 'opening'`,
            [
                shiftId,
                context.job.fiscal_profile_id,
                result.response?.id || null,
                JSON.stringify({ open_result: result.response || {}, lifecycle_stage: 'OPENED' })
            ]
        );
        await markJobSucceeded(client, context.job);
        return { ok: true, jobId: Number(context.job.id), source: result.source };
    }
    if (context.job.job_type === 'shift_close') {
        const expectedShiftId = String(context.job.provider_shift_id || context.job.payload?.provider_shift_id || '').trim();
        const actualShiftId = String(result.response?.id || '').trim();
        const providerStatus = String(result.response?.status || '').trim().toUpperCase();
        if (!expectedShiftId || !actualShiftId || actualShiftId !== expectedShiftId) {
            throw new PaymentOutboxWorkerError('checkbox_shift_close_identity_mismatch', 'Checkbox shift close lookup did not return the exact immutable provider shift id', {
                retryable: false,
                details: { expectedShiftId: expectedShiftId || null, actualShiftId: actualShiftId || null, providerStatus: providerStatus || null }
            });
        }
        if (providerStatus && providerStatus !== 'CLOSED') {
            throw new PaymentOutboxWorkerError('checkbox_shift_close_not_completed', 'Checkbox shift close has not reached CLOSED status', {
                retryable: true,
                unknown: true,
                details: { providerStatus }
            });
        }
        assertLifecycleTransition(context.job.fiscal_shift_lifecycle_stage || 'CLOSING', 'CLOSED');
    }
    await client.query(
        `UPDATE fiscal_shifts
            SET status = 'closed',
                lifecycle_stage = 'CLOSED',
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
    const stage = externalStage(context.job);
    if (context.job.job_type === 'shift_open' && SHIFT_OPEN_LOOKUP_STAGES.has(stage) && (provider.lookupShift || provider.ensureShiftOpened)) {
        await context.recordStage?.('shift_lookup');
        const lookupInput = {
            providerOperationId: context.job.provider_operation_id,
            providerRequestUuid: context.job.provider_operation_id,
            fiscalOperation: context.job,
            payload: context.job.payload || {}
        };
        const response = provider.lookupShift
            ? await provider.lookupShift(lookupInput)
            : await provider.ensureShiftOpened(lookupInput, { allowOpenRequest: false });
        return { response, source: 'shift_lookup' };
    }
    if (context.job.job_type === 'shift_close' && SHIFT_CLOSE_LOOKUP_STAGES.has(stage) && provider.getCurrentShiftStatus) {
        await context.recordStage?.('shift_close_lookup');
        const response = await provider.getCurrentShiftStatus({
            providerOperationId: context.job.provider_operation_id,
            providerRequestUuid: context.job.provider_operation_id,
            fiscalOperation: context.job,
            payload: context.job.payload || {}
        });
        const expectedShiftId = String(context.job.provider_shift_id || context.job.payload?.provider_shift_id || '').trim();
        const actualShiftId = String(response?.id || '').trim();
        if (!expectedShiftId || !actualShiftId || actualShiftId !== expectedShiftId) {
            throw new PaymentOutboxWorkerError('checkbox_shift_close_identity_mismatch', 'Checkbox current shift does not match the immutable shift being closed', {
                retryable: false,
                details: { expectedShiftId: expectedShiftId || null, actualShiftId: actualShiftId || null, providerStatus: response?.status || null }
            });
        }
        if (String(response?.status || '').toUpperCase() === 'CLOSED') {
            return { response: { ...response, status: 'CLOSED', id: actualShiftId }, source: 'shift_close_lookup' };
        }
        throw new PaymentOutboxWorkerError('checkbox_shift_close_pending', 'Checkbox shift close is still pending', {
            retryable: true,
            unknown: true,
            details: { providerStatus: response?.status || null }
        });
    }
    await context.recordStage?.('readiness');
    if (provider.prepareMutation) {
        await provider.prepareMutation({
            providerOperationId: context.job.provider_operation_id,
            providerRequestUuid: context.job.provider_operation_id,
            fiscalOperation: context.job,
            payload: context.job.payload || {}
        });
    }
    await context.recordStage?.(context.job.job_type === 'shift_open' ? 'shift_request' : 'shift_close_request');
    if (context.job.job_type === 'shift_open') {
        await context.recordStage?.('shift_request_maybe_submitted');
    }
    const response = await method.call(provider, {
        providerOperationId: context.job.provider_operation_id,
        providerRequestUuid: context.job.provider_operation_id,
        fiscalOperation: context.job,
        payload: context.job.payload || {}
    });
    const providerStatus = String(response?.status || '').trim().toUpperCase();
    if (context.job.job_type === 'shift_open' && providerStatus !== 'OPENED') {
        await context.recordStage?.('shift_lookup');
        throw new PaymentOutboxWorkerError('checkbox_shift_open_pending', 'Checkbox shift open has not reached OPENED status', {
            retryable: true,
            unknown: true,
            details: { providerStatus: providerStatus || null }
        });
    }
    if (context.job.job_type === 'shift_close' && providerStatus !== 'CLOSED') {
        await context.recordStage?.('shift_close_lookup');
        throw new PaymentOutboxWorkerError('checkbox_shift_close_pending', 'Checkbox shift close has not reached CLOSED status', {
            retryable: true,
            unknown: true,
            details: { providerStatus: providerStatus || null }
        });
    }
    return { response, source: context.job.job_type };
}

async function runReceiptSaleJob(provider, context) {
    const stage = externalStage(context.job);
    const mustLookupOnly = saleStageRequiresLookup(stage);
    if (
        context.job.fiscal_shift_status !== 'open'
        || (context.job.fiscal_shift_lifecycle_stage && context.job.fiscal_shift_lifecycle_stage !== 'OPENED')
        || !context.job.provider_shift_id
    ) {
        throw new PaymentOutboxWorkerError('shift_not_provider_opened', 'Sale cannot be sent until the provider shift is OPENED', {
            retryable: true,
            unknown: false,
            details: { fiscalShiftStatus: context.job.fiscal_shift_status || null, providerShiftId: context.job.provider_shift_id || null }
        });
    }

    if (context.job.job_type === 'receipt_status_lookup' || mustLookupOnly || (shouldLookupBeforeSale(context.job) && !PRE_SELL_STAGES.has(stage))) {
        await context.recordStage?.('receipt_lookup');
        const lookup = await lookupProviderReceipt(provider, context);
        if (lookup?.found || lookup?.receipt) {
            return { receipt: lookup.receipt || lookup, source: 'lookup' };
        }
        throw new PaymentOutboxWorkerError('receipt_lookup_required_before_retry', 'Possibly submitted sale must be reconciled by lookup before any further sale attempt', { retryable: true, unknown: true });
    }

    if (context.job.job_type === 'receipt_status_lookup') {
        throw new PaymentOutboxWorkerError('receipt_not_found_for_status_lookup', 'Provider receipt was not found during status lookup', { retryable: true, unknown: true });
    }

    await context.recordStage?.('receipt_validation');
    await provider.validateSale({
        providerOperationId: context.job.provider_operation_id,
        providerRequestUuid: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items
    });
    await context.recordStage?.('sale_submit');
    const submitSale = provider.submitSaleReceipt || provider.createSaleReceipt;
    const receipt = await submitSale.call(provider, {
        providerOperationId: context.job.provider_operation_id,
        providerRequestUuid: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items
    });
    return { receipt, source: 'sale' };
}

async function loadProcessingContext(dbPool, job) {
    return withTransaction(dbPool, async client => {
        const context = await loadJobContext(client, job);
        const owner = await client.query(
            `UPDATE payment_outbox_jobs
                SET status = 'running',
                    locked_at = NOW(),
                    heartbeat_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND locked_by = $3
                AND attempts = $4
                AND lock_token = $5::uuid
                AND status IN ('claimed', 'running')
              RETURNING id`,
            [context.job.id, context.job.fiscal_profile_id, job.locked_by, job.attempts, job.lock_token]
        );
        if (!owner.rows.length) {
            throw new PaymentOutboxWorkerError('payment_outbox_job_ownership_lost', 'Claimed payment outbox job ownership was lost before processing', { retryable: true });
        }
        context.job.locked_by = job.locked_by;
        context.job.lock_token = job.lock_token;
        context.job.status = 'running';
        return context;
    });
}

async function assertFinalizeOwnership(client, context) {
    const result = await client.query(
        `SELECT id
           FROM payment_outbox_jobs
          WHERE id = $1
            AND fiscal_profile_id = $2
            AND locked_by = $3
            AND attempts = $4
            AND lock_token = $5::uuid
            AND status IN ('claimed', 'running')
          FOR UPDATE`,
        [context.job.id, context.job.fiscal_profile_id, context.job.locked_by, context.job.attempts, context.job.lock_token]
    );
    if (!result.rows.length) {
        throw new PaymentOutboxWorkerError('payment_outbox_job_ownership_lost', 'Payment outbox job ownership was lost before finalize', { retryable: true });
    }
}

async function finalizeJobFailure(dbPool, context, errorInfo) {
    return withTransaction(dbPool, async client => {
        await assertFinalizeOwnership(client, context);
        if (errorInfo.configuration === true) {
            await markJobConfigUnavailable(client, context, errorInfo);
            return { ok: false, skipped: true, jobId: Number(context.job.id), error: errorInfo };
        }
        await markJobFailed(client, context, errorInfo);
        return { ok: false, jobId: Number(context.job.id), error: errorInfo };
    });
}

async function finalizeJobSuccess(dbPool, context, result) {
    return withTransaction(dbPool, async client => {
        const finalizeContext = await loadJobContext(client, context.job);
        finalizeContext.job.locked_by = context.job.locked_by;
        finalizeContext.job.lock_token = context.job.lock_token;
        finalizeContext.job.attempts = context.job.attempts;
        await assertFinalizeOwnership(client, finalizeContext);
        if (finalizeContext.job.job_type === 'receipt_sell' || finalizeContext.job.job_type === 'receipt_status_lookup') {
            await recordExternalStageInTransaction(client, finalizeContext, 'complete');
            await markFiscalized(client, finalizeContext, result.receipt);
            await markJobSucceeded(client, finalizeContext.job);
            return { ok: true, jobId: Number(finalizeContext.job.id), source: result.source };
        }
        if (finalizeContext.job.job_type === 'receipt_return') {
            await markFiscalized(client, finalizeContext, result.receipt);
            await markJobSucceeded(client, finalizeContext.job);
            return { ok: true, jobId: Number(finalizeContext.job.id), source: result.source };
        }
        if (finalizeContext.job.job_type === 'service_receipt') {
            await markFiscalized(client, finalizeContext, result.receipt);
            await markJobSucceeded(client, finalizeContext.job);
            return { ok: true, jobId: Number(finalizeContext.job.id), source: result.source };
        }
        if (finalizeContext.job.job_type === 'shift_open' || finalizeContext.job.job_type === 'shift_close') {
            return markShiftJobSucceeded(client, finalizeContext, result);
        }
        throw new PaymentOutboxWorkerError('payment_outbox_job_type_not_supported', 'Payment outbox job type is not supported by this worker', { retryable: false });
    });
}

async function processOnePaymentOutboxJob({ dbPool, provider, job }) {
    let context;
    try {
        context = await loadProcessingContext(dbPool, job);
        context.recordStage = stage => recordExternalStage(dbPool, context, stage);
        try {
            assertImmutableProviderContext(context);
            if (!saleStageRequiresLookup(externalStage(context.job))) {
                await context.recordStage('auth');
            }
            const effectiveProvider = provider?.createForContext ? provider.createForContext(context) : provider;
            let result;
            if (context.job.job_type === 'receipt_sell' || context.job.job_type === 'receipt_status_lookup') {
                result = await runReceiptSaleJob(effectiveProvider, context);
                return finalizeJobSuccess(dbPool, context, result);
            }
            if (context.job.job_type === 'receipt_return') {
                result = await runReceiptReturnJob(effectiveProvider, context);
                return finalizeJobSuccess(dbPool, context, result);
            }
            if (context.job.job_type === 'service_receipt') {
                result = await runServiceReceiptJob(effectiveProvider, context);
                return finalizeJobSuccess(dbPool, context, result);
            }
            if (context.job.job_type === 'shift_open' || context.job.job_type === 'shift_close') {
                result = await runShiftJob(effectiveProvider, context);
                return finalizeJobSuccess(dbPool, context, result);
            }
            throw new PaymentOutboxWorkerError('payment_outbox_job_type_not_supported', 'Payment outbox job type is not supported by this worker', { retryable: false });
        } catch (error) {
            const errorInfo = classifyWorkerError(error);
            return finalizeJobFailure(dbPool, context, errorInfo);
        }
    } catch (error) {
        const errorInfo = classifyWorkerError(error);
        return { ok: false, jobId: Number(job.id), error: errorInfo };
    }
}

async function processPaymentOutboxJobs({
    dbPool = pool,
    provider = null,
    batchSize = DEFAULT_BATCH_SIZE,
    lockedBy = workerId(),
    lockExpiryMs = DEFAULT_LOCK_EXPIRY_MS,
    throwOnDegraded = false
} = {}) {
    const effectiveProvider = provider || createCheckboxProviderFactory();
    let eligibleFiscalProfileIds = null;
    let eligibleRuntimeContexts = null;
    if (!provider && effectiveProvider?.getEligibleFiscalProfileIds) {
        if (effectiveProvider.isEnabled && !effectiveProvider.isEnabled()) {
            return {
                claimed: 0,
                succeeded: 0,
                failed: 0,
                skipped: true,
                reason: 'checkbox_integration_disabled',
                results: []
            };
        }
        if (effectiveProvider.getEligibleRuntimeContexts) {
            eligibleRuntimeContexts = await effectiveProvider.getEligibleRuntimeContexts(dbPool);
            eligibleFiscalProfileIds = [...new Set(eligibleRuntimeContexts.map(context => context.fiscalProfileId))];
        } else {
            eligibleFiscalProfileIds = await effectiveProvider.getEligibleFiscalProfileIds(dbPool);
        }
        if (!eligibleFiscalProfileIds.length) {
            return {
                claimed: 0,
                succeeded: 0,
                failed: 0,
                skipped: true,
                reason: 'checkbox_runtime_config_unavailable',
                results: []
            };
        }
    }
    const maxJobs = Math.max(1, Math.min(Number(batchSize) || DEFAULT_BATCH_SIZE, 25));
    const results = [];
    while (results.length < maxJobs) {
        const claimed = await withTransaction(dbPool, client => claimPaymentOutboxJobs(client, { batchSize: 1, lockedBy, lockExpiryMs, eligibleFiscalProfileIds, eligibleRuntimeContexts }));
        const job = claimed[0];
        if (!job) break;
        results.push(await processOnePaymentOutboxJob({ dbPool, provider: effectiveProvider, job }));
    }
    const summary = {
        claimed: results.length,
        succeeded: results.filter(result => result.ok).length,
        failed: results.filter(result => !result.ok).length,
        results
    };
    if (throwOnDegraded && summary.failed > 0) {
        const error = new PaymentOutboxWorkerError('payment_outbox_degraded', 'Payment outbox worker completed with failed jobs', {
            retryable: true,
            unknown: false,
            details: { claimed: summary.claimed, failed: summary.failed }
        });
        error.summary = summary;
        throw error;
    }
    return summary;
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
