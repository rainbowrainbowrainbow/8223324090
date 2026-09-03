'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const { publishInTransaction } = require('../eventBus');
const { CheckboxClientError } = require('../checkbox/errors');
const { createCheckboxProviderFactory } = require('../checkbox/provider');
const { isCashierProEnabled } = require('../checkbox/config');
const {
    CLOSED_SHIFT_PRE_SUBMIT_ERROR_CODE,
    guardPaidPreSubmitSalesForClosedShift
} = require('./closedShiftSaleGuard');

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
const PRE_SELL_STAGES = new Set([
    'auth',
    'readiness',
    'shift_request',
    'shift_request_maybe_submitted',
    'shift_lookup',
    'shift_lookup_not_found',
    'shift_request_retry_same_uuid',
    'shift_close_request',
    'shift_close_request_maybe_submitted',
    'shift_close_lookup',
    'shift_close_lookup_still_open',
    'shift_close_retry_exact_shift',
    'receipt_validation'
]);
const POST_SELL_STAGES = new Set(['sale_submit', 'receipt_lookup', 'complete']);
const RETURN_PRE_MUTATION_STAGES = new Set(['auth', 'readiness']);
const RETURN_POST_SUBMIT_STAGES = new Set(['return_submit', 'return_lookup', 'complete']);
const SERVICE_PRE_MUTATION_STAGES = new Set(['auth', 'readiness']);
const SERVICE_POST_SUBMIT_STAGES = new Set(['service_submit', 'service_lookup', 'complete']);
const SHIFT_OPEN_LOOKUP_STAGES = new Set([
    'shift_request_maybe_submitted',
    'shift_lookup',
    'shift_lookup_not_found',
    'shift_request_retry_same_uuid'
]);
const SHIFT_CLOSE_LOOKUP_STAGES = new Set([
    'shift_close_request_maybe_submitted',
    'shift_close_lookup',
    'shift_close_lookup_still_open',
    'shift_close_retry_exact_shift'
]);
const SHIFT_LIFECYCLE_TRANSITIONS = Object.freeze({
    CREATED: ['OPENING'],
    OPENING: ['OPENED', 'CLOSED'],
    OPENED: ['CLOSING', 'CLOSED'],
    CLOSING: ['CLOSED'],
    CLOSED: []
});
const CASHIER_PRO_JOB_TYPES = new Set(['receipt_return', 'service_receipt']);

function normalizedLockExpiryMs(value) {
    return Math.max(30_000, Math.floor(Number(value) || DEFAULT_LOCK_EXPIRY_MS));
}

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

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
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
    const runtimeContexts = Array.isArray(eligibleRuntimeContexts)
        ? eligibleRuntimeContexts.map(context => ({
            fiscal_profile_id: Number(context?.fiscalProfileId),
            fiscal_register_id: Number(context?.fiscalRegisterId),
            register_credential_ref: String(context?.registerCredentialRef || '').trim(),
            cashier_credential_ref: String(context?.cashierCredentialRef || '').trim()
        })).filter(context => Number.isSafeInteger(context.fiscal_profile_id)
            && context.fiscal_profile_id > 0
            && Number.isSafeInteger(context.fiscal_register_id)
            && context.fiscal_register_id > 0
            && context.register_credential_ref
            && context.cashier_credential_ref)
        : null;
    if (Array.isArray(runtimeContexts) && runtimeContexts.length === 0) {
        return [];
    }
    const token = lockToken();
    const claimableJobTypes = cashierProEnabled
        ? RETRYABLE_JOB_TYPES
        : RETRYABLE_JOB_TYPES.filter(type => !CASHIER_PRO_JOB_TYPES.has(type));
    const result = await client.query(
        `WITH candidate_registers AS MATERIALIZED (
             SELECT
                 fr.id AS fiscal_register_id,
                 fr.fiscal_profile_id,
                 next_job.id AS job_id
               FROM fiscal_registers fr
               JOIN LATERAL (
                    SELECT job.id, job.priority, job.next_run_at
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
                       JOIN fiscal_cashier_bindings fcb
                         ON fcb.fiscal_profile_id = job.fiscal_profile_id
                        AND fcb.fiscal_register_id = fr.id
                        AND fcb.user_id = CASE
                            WHEN job.job_type IN ('receipt_sell', 'receipt_status_lookup', 'receipt_validate')
                                THEN COALESCE(po.cashier_user_id, fo.initiated_by_user_id)
                            ELSE fo.initiated_by_user_id
                        END
                        AND fcb.status = 'active'
                      WHERE job.fiscal_profile_id = fr.fiscal_profile_id
                        AND COALESCE(po.fiscal_register_id, fo.fiscal_register_id) = fr.id
                        AND fo.register_credential_ref = fr.provider_license_ref
                        AND fo.cashier_credential_ref = fcb.provider_cashier_login_ref
                        AND (
                            $6::jsonb IS NULL
                            OR EXISTS (
                                SELECT 1
                                  FROM jsonb_to_recordset($6::jsonb) AS eligible(
                                       fiscal_profile_id bigint,
                                       fiscal_register_id bigint,
                                       register_credential_ref text,
                                       cashier_credential_ref text
                                  )
                                 WHERE eligible.fiscal_profile_id = fr.fiscal_profile_id
                                   AND eligible.fiscal_register_id = fr.id
                                   AND eligible.register_credential_ref = fr.provider_license_ref
                                   AND eligible.cashier_credential_ref = fcb.provider_cashier_login_ref
                                   AND eligible.register_credential_ref = fo.register_credential_ref
                                   AND eligible.cashier_credential_ref = fo.cashier_credential_ref
                            )
                        )
                        AND job.job_type = ANY($1::text[])
                       AND ($8::boolean = TRUE OR job.job_type <> 'shift_close' OR job.payload->>'phase' = 'thin_mvp_shift_close')
                       AND COALESCE(job.payload->>'provider', fo.provider, fr.provider) = 'checkbox'
                       AND (
                           job.job_type <> 'receipt_sell'
                           OR (fs.status = 'open' AND fs.provider_shift_id IS NOT NULL AND fs.lifecycle_stage = 'OPENED')
                           OR (
                               fs.provider_shift_id IS NOT NULL
                               AND (
                                   NULLIF(job.external_stage, '') IN ('sale_submit', 'receipt_lookup', 'complete')
                                   OR NULLIF(job.payload->>'external_stage', '') IN ('sale_submit', 'receipt_lookup', 'complete')
                                   OR NULLIF(fo.external_stage, '') IN ('sale_submit', 'receipt_lookup', 'complete')
                                   OR NULLIF(fo.request_snapshot->>'external_stage', '') IN ('sale_submit', 'receipt_lookup', 'complete')
                               )
                           )
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
                              AND COALESCE(active_po.fiscal_register_id, active_fo.fiscal_register_id) = fr.id
                              AND active_job.status IN ('claimed', 'running')
                              AND COALESCE(active_job.heartbeat_at, active_job.locked_at) >= clock_timestamp() - ($4::int * INTERVAL '1 second')
                       )
                       AND job.attempts < job.max_attempts
                       AND (
                           (job.status IN ('queued', 'failed') AND job.next_run_at <= NOW())
                           OR (job.status IN ('claimed', 'running') AND COALESCE(job.heartbeat_at, job.locked_at) < clock_timestamp() - ($4::int * INTERVAL '1 second'))
                       )
                     ORDER BY job.priority ASC, job.next_run_at ASC, job.id ASC
                     LIMIT 1
               ) next_job ON TRUE
              WHERE fr.provider = 'checkbox'
                 AND fr.status = 'active'
                 AND fr.feature_enabled = TRUE
                 AND ($5::bigint[] IS NULL OR fr.fiscal_profile_id = ANY($5::bigint[]))
               ORDER BY next_job.priority ASC, next_job.next_run_at ASC, next_job.id ASC
              FOR UPDATE OF fr SKIP LOCKED
              LIMIT $2
         ), candidate_jobs AS MATERIALIZED (
             SELECT job.id
               FROM payment_outbox_jobs job
               JOIN candidate_registers candidate
                 ON candidate.job_id = job.id
                AND candidate.fiscal_profile_id = job.fiscal_profile_id
              FOR UPDATE OF job SKIP LOCKED
         )
         UPDATE payment_outbox_jobs job
            SET status = 'claimed',
                locked_at = clock_timestamp(),
                locked_by = $3,
                lock_token = $7::uuid,
                lock_version = lock_version + 1,
                heartbeat_at = clock_timestamp(),
                attempts = job.attempts + 1,
                updated_at = NOW()
           FROM candidate_jobs
          WHERE job.id = candidate_jobs.id
          RETURNING job.*, clock_timestamp() AS lease_claimed_at`,
        [
            claimableJobTypes,
            limit,
            lockedBy,
            lockExpirySeconds,
            Array.isArray(eligibleFiscalProfileIds) ? eligibleFiscalProfileIds.map(id => Number(id)) : null,
            Array.isArray(runtimeContexts) ? JSON.stringify(runtimeContexts) : null,
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
             COALESCE(po.fiscal_register_id, fo.fiscal_register_id) AS fiscal_register_id,
             po.cashier_user_id,
             po.total_amount_minor,
             po.payment_method,
             po.source_snapshot,
             po.confirmation_snapshot,
             fr.register_alias,
             fr.id AS current_fiscal_register_id,
             fr.fiscal_profile_id AS current_fiscal_profile_id,
             fr.fiscal_location_id AS current_fiscal_location_id,
             fr.crm_profile_key AS current_crm_profile_key,
             fr.provider_register_id AS current_provider_register_id,
             fr.provider AS register_provider,
             fr.status AS register_status,
             fr.provider_license_ref,
             fr.feature_enabled AS register_feature_enabled,
             COALESCE(fr.metadata->>'expected_is_test', fr.metadata->>'expectedIsTest') AS current_expected_is_test,
             fp.crm_profile_key AS current_profile_crm_profile_key,
             fp.legal_entity_key AS current_legal_entity_key,
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
            AND fcb.user_id = CASE
                WHEN job.job_type IN ('receipt_sell', 'receipt_status_lookup', 'receipt_validate')
                    THEN COALESCE(po.cashier_user_id, fo.initiated_by_user_id)
                ELSE fo.initiated_by_user_id
            END
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

function observedExternalStages(contextJob = {}) {
    const payload = safeJsonObject(contextJob.payload);
    const request = safeJsonObject(contextJob.fiscal_request_snapshot);
    const current = [
        contextJob.external_stage,
        payload.external_stage,
        contextJob.fiscal_operation_external_stage
    ].map(value => String(value || '').trim()).filter(Boolean);
    const snapshot = String(request.external_stage || '').trim();
    return { current, all: snapshot ? [...current, snapshot] : current };
}

function externalStage(contextJob = {}) {
    const { current, all } = observedExternalStages(contextJob);
    const jobType = String(contextJob.job_type || '').trim();
    const distinctCurrent = [...new Set(current)];

    if (jobType === 'receipt_sell' || jobType === 'receipt_status_lookup') {
        const submittedEvidence = all.filter(stage => POST_SELL_STAGES.has(stage));
        if (submittedEvidence.length) {
            if (distinctCurrent.length === 1 && POST_SELL_STAGES.has(distinctCurrent[0])) {
                return distinctCurrent[0];
            }
            return 'receipt_lookup';
        }
    }

    if (jobType === 'service_receipt') {
        const submittedEvidence = all.filter(stage => SERVICE_POST_SUBMIT_STAGES.has(stage));
        if (submittedEvidence.length) {
            if (distinctCurrent.length === 1 && SERVICE_POST_SUBMIT_STAGES.has(distinctCurrent[0])) {
                return distinctCurrent[0];
            }
            return 'service_lookup';
        }
    }

    if (jobType === 'receipt_return') {
        const submittedEvidence = all.filter(stage => RETURN_POST_SUBMIT_STAGES.has(stage));
        if (submittedEvidence.length) {
            if (distinctCurrent.length === 1 && RETURN_POST_SUBMIT_STAGES.has(distinctCurrent[0])) {
                return distinctCurrent[0];
            }
            return 'return_lookup';
        }
    }

    if (jobType === 'shift_open') {
        const submittedEvidence = all.filter(stage => SHIFT_OPEN_LOOKUP_STAGES.has(stage));
        if (submittedEvidence.length) {
            if (distinctCurrent.length === 1 && SHIFT_OPEN_LOOKUP_STAGES.has(distinctCurrent[0])) {
                return distinctCurrent[0];
            }
            return 'shift_lookup';
        }
    }

    if (jobType === 'shift_close') {
        const submittedEvidence = all.filter(stage => SHIFT_CLOSE_LOOKUP_STAGES.has(stage));
        if (submittedEvidence.length) {
            if (distinctCurrent.length === 1 && SHIFT_CLOSE_LOOKUP_STAGES.has(distinctCurrent[0])) {
                return distinctCurrent[0];
            }
            return 'shift_close_lookup';
        }
    }

    return current[0] || all[0] || 'auth';
}

function saleStageRequiresLookup(stage) {
    return POST_SELL_STAGES.has(String(stage || '').trim());
}

function failedOperationLacksPreMutationEvidence(contextJob, preMutationStages) {
    const status = String(contextJob?.fiscal_operation_status || '').trim().toLowerCase();
    if (!['failed', 'unknown'].includes(status)) return false;
    const currentStages = observedExternalStages(contextJob).current;
    return currentStages.length === 0
        || currentStages.some(stage => !preMutationStages.has(stage));
}

function shouldLookupBeforeSale(contextJob) {
    return contextJob?.job_type === 'receipt_status_lookup'
        || saleStageRequiresLookup(externalStage(contextJob))
        || failedOperationLacksPreMutationEvidence(contextJob, PRE_SELL_STAGES);
}

function createExternalMutationBoundary(context, stage) {
    return async () => {
        if (typeof context.recordStage === 'function') {
            await context.recordStage(stage);
            return;
        }
        await context.assertMutationOwnership?.();
    };
}

async function recordExternalStage(dbPool, context, stage) {
    const safeStage = String(stage || '').trim();
    if (!safeStage) return;
    const lockExpiryMs = normalizedLockExpiryMs(context.lockExpiryMs);
    await withTransaction(dbPool, async client => {
        if (safeStage === 'sale_submit') {
            const shiftReady = await client.query(
                `SELECT shift.id
                   FROM fiscal_operations operation
                   JOIN fiscal_shifts shift
                     ON shift.id = operation.fiscal_shift_id
                    AND shift.fiscal_profile_id = operation.fiscal_profile_id
                    AND shift.fiscal_register_id = operation.fiscal_register_id
                  WHERE operation.id = $1
                    AND operation.fiscal_profile_id = $2
                    AND operation.operation_type = 'sale'
                    AND shift.status = 'open'
                    AND shift.lifecycle_stage = 'OPENED'
                    AND shift.provider_shift_id IS NOT NULL
                  FOR UPDATE OF shift`,
                [context.job.fiscal_operation_id, context.job.fiscal_profile_id]
            );
            if (!shiftReady.rows.length) {
                throw new PaymentOutboxWorkerError(
                    CLOSED_SHIFT_PRE_SUBMIT_ERROR_CODE,
                    'Provider shift closed before the sale mutation boundary; automatic resubmission is forbidden',
                    { retryable: false, unknown: false }
                );
            }
        }
        const owner = await client.query(
            `UPDATE payment_outbox_jobs
                SET payload = payload || $3::jsonb,
                    external_stage = $5,
                    status = CASE WHEN status = 'claimed' THEN 'running' ELSE status END,
                    locked_at = clock_timestamp(),
                    heartbeat_at = clock_timestamp(),
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND locked_by = $4
                AND lock_token = $6::uuid
                AND status IN ('claimed', 'running')
                AND COALESCE(heartbeat_at, locked_at) >= clock_timestamp() - ($7::int * INTERVAL '1 millisecond')
              RETURNING id`,
            [
                context.job.id,
                context.job.fiscal_profile_id,
                JSON.stringify({ external_stage: safeStage }),
                context.job.locked_by,
                safeStage,
                context.job.lock_token,
                lockExpiryMs
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
                            WHEN $3::jsonb->>'external_stage' = 'return_submit' THEN 'sending'
                            WHEN $3::jsonb->>'external_stage' = 'service_submit' THEN 'sending'
                            WHEN status IN ('pending', 'failed') THEN 'pending'
                            ELSE status
                        END,
                        external_stage = $3::jsonb->>'external_stage',
                        sent_at = CASE WHEN $3::jsonb->>'external_stage' IN ('sale_submit', 'return_submit', 'service_submit') THEN COALESCE(sent_at, NOW()) ELSE sent_at END
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
        if (
            (
                safeStage === 'shift_request'
                || safeStage === 'shift_request_maybe_submitted'
                || safeStage === 'shift_request_retry_same_uuid'
            )
            && context.job.fiscal_shift_id
        ) {
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
        if (safeStage === 'shift_request_retry_same_uuid' || safeStage === 'shift_close_retry_exact_shift') {
            const isShiftOpenRetry = safeStage === 'shift_request_retry_same_uuid';
            await client.query(
                `INSERT INTO fiscal_audit_events (
                    fiscal_profile_id,
                    actor_user_id,
                    event_type,
                    entity_table,
                    entity_id,
                    idempotency_key,
                    metadata
                ) VALUES ($1, NULL, $5, 'payment_outbox_jobs', $2, $3, $4::jsonb)`,
                [
                    context.job.fiscal_profile_id,
                    context.job.id,
                    `${isShiftOpenRetry ? 'checkbox-shift-same-uuid-retry' : 'checkbox-shift-close-exact-retry'}:${context.job.id}:${context.job.attempts || 0}`,
                    JSON.stringify({
                        fiscal_operation_id: context.job.fiscal_operation_id || null,
                        fiscal_shift_id: context.job.fiscal_shift_id || null,
                        retry_policy: isShiftOpenRetry
                            ? 'two_exact_lookup_404_then_same_uuid_only'
                            : 'two_exact_lookup_opened_then_close_exact_shift_only'
                    }),
                    isShiftOpenRetry ? 'checkbox_shift_same_uuid_retry' : 'checkbox_shift_close_exact_retry'
                ]
            );
        }
    });
    context.job.payload = { ...safeJsonObject(context.job.payload), external_stage: safeStage };
    context.job.fiscal_request_snapshot = { ...safeJsonObject(context.job.fiscal_request_snapshot), external_stage: safeStage };
    context.job.external_stage = safeStage;
}

async function assertPaymentOutboxJobOwnership(dbPool, context) {
    const lockExpiryMs = normalizedLockExpiryMs(context.lockExpiryMs);
    await withTransaction(dbPool, async client => {
        const owner = await client.query(
            `UPDATE payment_outbox_jobs
                SET status = CASE WHEN status = 'claimed' THEN 'running' ELSE status END,
                    locked_at = clock_timestamp(),
                    heartbeat_at = clock_timestamp(),
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND locked_by = $3
                AND lock_token = $4::uuid
                AND status IN ('claimed', 'running')
                AND COALESCE(heartbeat_at, locked_at) >= clock_timestamp() - ($5::int * INTERVAL '1 millisecond')
              RETURNING id`,
            [
                context.job.id,
                context.job.fiscal_profile_id,
                context.job.locked_by,
                context.job.lock_token,
                lockExpiryMs
            ]
        );
        if (!owner.rows.length) {
            throw new PaymentOutboxWorkerError(
                'payment_outbox_job_ownership_lost',
                'Payment outbox job ownership was lost before provider communication',
                { retryable: true }
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
                AND (status <> 'fiscalized' OR $3::jsonb->>'external_stage' = 'complete')`,
            [context.job.fiscal_operation_id, context.job.fiscal_profile_id, JSON.stringify({ external_stage: safeStage })]
        );
    }
}

function assertImmutableProviderContext(context = {}) {
    const job = context.job || {};
    const request = safeJsonObject(job.fiscal_request_snapshot);
    const providerContext = safeJsonObject(request.provider_context);
    const operationHash = String(job.fiscal_configuration_hash || '').trim();
    const requestHash = String(request.fiscal_configuration_hash || '').trim();
    const requiredTextFields = [
        'provider_organization_id',
        'provider_register_id',
        'provider_cashier_id',
        'register_credential_ref',
        'cashier_credential_ref'
    ];
    const missing = requiredTextFields.filter(field => !String(job[field] ?? '').trim());
    for (const field of ['fiscal_profile_id', 'operation_fiscal_location_id', 'fiscal_register_id']) {
        const value = Number(job[field]);
        if (!Number.isSafeInteger(value) || value <= 0) missing.push(field);
    }
    if (normalizeBoolean(job.expected_is_test) == null) missing.push('expected_is_test');
    if (!/^[0-9a-f]{64}$/i.test(operationHash)) missing.push('fiscal_configuration_hash');
    if (!Object.keys(providerContext).length) missing.push('request_snapshot.provider_context');
    if (!/^[0-9a-f]{64}$/i.test(requestHash)) missing.push('request_snapshot.fiscal_configuration_hash');
    for (const field of [
        ...requiredTextFields,
        'provider_outlet_id',
        'expected_is_test',
        'fiscal_profile_id',
        'fiscal_location_id',
        'fiscal_register_id'
    ]) {
        if (!Object.prototype.hasOwnProperty.call(providerContext, field)) {
            missing.push(`request_snapshot.provider_context.${field}`);
        }
    }
    if (missing.length) {
        throw new PaymentOutboxWorkerError(
            'fiscal_provider_context_snapshot_incomplete',
            'Immutable fiscal provider context snapshot is incomplete',
            { retryable: false, details: { missing: [...new Set(missing)].sort() } }
        );
    }
    if (requestHash !== operationHash) {
        throw new PaymentOutboxWorkerError('fiscal_configuration_hash_mismatch', 'Fiscal configuration hash is inconsistent with the immutable operation snapshot', {
            retryable: false,
            details: { hasOperationHash: true, hasRequestHash: true }
        });
    }
    const recomputedHash = crypto.createHash('sha256').update(stableJson(providerContext)).digest('hex');
    if (recomputedHash !== operationHash) {
        throw new PaymentOutboxWorkerError('fiscal_configuration_hash_mismatch', 'Immutable fiscal provider context does not match its configuration hash', {
            retryable: false,
            details: { snapshotHashMatches: false }
        });
    }
    const snapshotPairs = [
        ['provider_organization_id', job.provider_organization_id, providerContext.provider_organization_id],
        ['provider_outlet_id', job.provider_outlet_id, providerContext.provider_outlet_id],
        ['provider_register_id', job.provider_register_id, providerContext.provider_register_id],
        ['provider_cashier_id', job.provider_cashier_id, providerContext.provider_cashier_id],
        ['register_credential_ref', job.register_credential_ref, providerContext.register_credential_ref],
        ['cashier_credential_ref', job.cashier_credential_ref, providerContext.cashier_credential_ref]
    ];
    for (const [field, operationValue, snapshotValue] of snapshotPairs) {
        if (String(operationValue ?? '').trim() !== String(snapshotValue ?? '').trim()) {
            throw new PaymentOutboxWorkerError('fiscal_provider_context_snapshot_mismatch', 'Fiscal operation context differs from its immutable request snapshot', {
                retryable: false,
                details: { field }
            });
        }
    }
    const snapshotIds = [
        ['fiscal_profile_id', job.fiscal_profile_id, providerContext.fiscal_profile_id],
        ['fiscal_location_id', job.operation_fiscal_location_id, providerContext.fiscal_location_id],
        ['fiscal_register_id', job.fiscal_register_id, providerContext.fiscal_register_id]
    ];
    for (const [field, operationValue, snapshotValue] of snapshotIds) {
        if (Number(operationValue) !== Number(snapshotValue)) {
            throw new PaymentOutboxWorkerError('fiscal_provider_context_snapshot_mismatch', 'Fiscal operation scope differs from its immutable request snapshot', {
                retryable: false,
                details: { field }
            });
        }
    }
    if (normalizeBoolean(providerContext.expected_is_test) !== normalizeBoolean(job.expected_is_test)) {
        throw new PaymentOutboxWorkerError('fiscal_provider_context_snapshot_mismatch', 'Fiscal operation test-mode expectation differs from its immutable request snapshot', {
            retryable: false,
            details: { field: 'expected_is_test' }
        });
    }
    if (providerContext.provider != null && String(providerContext.provider).trim() !== 'checkbox') {
        throw new PaymentOutboxWorkerError('fiscal_provider_context_snapshot_mismatch', 'Immutable provider snapshot is not scoped to Checkbox', {
            retryable: false,
            details: { field: 'provider' }
        });
    }
    if (
        String(job.register_provider || '').trim() !== 'checkbox'
        || String(job.register_status || '').trim() !== 'active'
        || job.register_feature_enabled !== true
    ) {
        throw new PaymentOutboxWorkerError('fiscal_provider_context_drift', 'Current fiscal register is not an active enabled Checkbox register', {
            retryable: false,
            details: { field: 'register_runtime_state' }
        });
    }
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
        if (expectedText !== currentText) {
            throw new PaymentOutboxWorkerError('fiscal_provider_context_drift', 'Current fiscal mapping differs from immutable fiscal operation snapshot', {
                retryable: false,
                details: { field, expected: expectedText || null, current: currentText || null }
            });
        }
    }
    const currentScopePairs = [
        ['fiscal_profile_id', job.fiscal_profile_id, job.current_fiscal_profile_id],
        ['fiscal_location_id', job.operation_fiscal_location_id, job.current_fiscal_location_id],
        ['fiscal_register_id', job.fiscal_register_id, job.current_fiscal_register_id]
    ];
    for (const [field, expected, current] of currentScopePairs) {
        if (Number(expected) !== Number(current)) {
            throw new PaymentOutboxWorkerError('fiscal_provider_context_drift', 'Current fiscal scope differs from immutable fiscal operation snapshot', {
                retryable: false,
                details: { field, expected: Number(expected) || null, current: Number(current) || null }
            });
        }
    }
    if (
        Object.prototype.hasOwnProperty.call(providerContext, 'crm_profile_key')
        && String(providerContext.crm_profile_key || '').trim() !== String(job.current_profile_crm_profile_key || job.current_crm_profile_key || '').trim()
    ) {
        throw new PaymentOutboxWorkerError('fiscal_provider_context_drift', 'Current CRM profile differs from immutable fiscal operation snapshot', {
            retryable: false,
            details: { field: 'crm_profile_key' }
        });
    }
    if (
        Object.prototype.hasOwnProperty.call(providerContext, 'legal_entity_key')
        && String(providerContext.legal_entity_key || '').trim() !== String(job.current_legal_entity_key || '').trim()
    ) {
        throw new PaymentOutboxWorkerError('fiscal_provider_context_drift', 'Current legal entity differs from immutable fiscal operation snapshot', {
            retryable: false,
            details: { field: 'legal_entity_key' }
        });
    }
    if (
        Object.prototype.hasOwnProperty.call(providerContext, 'register_alias')
        && String(providerContext.register_alias || '').trim() !== String(job.register_alias || '').trim()
    ) {
        throw new PaymentOutboxWorkerError('fiscal_provider_context_drift', 'Current register alias differs from immutable fiscal operation snapshot', {
            retryable: false,
            details: { field: 'register_alias' }
        });
    }
    const expectedIsTest = normalizeBoolean(job.expected_is_test);
    const currentExpectedIsTest = normalizeBoolean(job.current_expected_is_test);
    if (expectedIsTest == null || currentExpectedIsTest == null || expectedIsTest !== currentExpectedIsTest) {
        throw new PaymentOutboxWorkerError('fiscal_provider_context_drift', 'Current fiscal mapping test-mode expectation differs from immutable fiscal operation snapshot', {
            retryable: false,
            details: { field: 'expected_is_test', expected: expectedIsTest, current: currentExpectedIsTest }
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
    requireProviderMatch(receiptField(receipt, 'providerShiftId', 'provider_shift_id'), context.job?.provider_shift_id, 'provider_receipt_shift_mismatch', 'providerShiftId');
    requireProviderMatch(receiptField(receipt, 'providerOrganizationId', 'provider_organization_id'), context.job?.provider_organization_id, 'provider_receipt_organization_mismatch', 'providerOrganizationId');
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


async function safePublishFiscalEvent(
    client,
    eventType,
    payload,
    aggregateType,
    aggregateId,
    idempotencyKey,
    publish = publishInTransaction
) {
    const savepoint = 'payment_outbox_event_publish';
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
        await publish(client, eventType, payload, aggregateType, aggregateId, idempotencyKey);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (_) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
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
            const mismatchError = new PaymentOutboxWorkerError('fiscal_receipt_identity_mismatch', 'Provider receipt observation conflicts with immutable local fiscal receipt', {
                retryable: false,
                details: { mismatches }
            });
            // The finalize transaction must commit the append-only observation and incident
            // together with the failed job state instead of rolling them back with the error.
            mismatchError.receiptMismatchEvidenceRecorded = true;
            throw mismatchError;
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

    if (
        context.job.operation_type === 'sale'
        && errorInfo.code === CLOSED_SHIFT_PRE_SUBMIT_ERROR_CODE
        && context.job.fiscal_shift_id
        && context.job.provider_shift_id
    ) {
        await guardPaidPreSubmitSalesForClosedShift(client, {
            fiscalProfileId: context.job.fiscal_profile_id,
            fiscalRegisterId: context.job.fiscal_register_id,
            fiscalShiftId: context.job.fiscal_shift_id,
            providerShiftId: context.job.provider_shift_id,
            source: 'sale_mutation_boundary'
        });
    }

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
    const stage = externalStage(context.job);
    const lookupOnly = RETURN_POST_SUBMIT_STAGES.has(stage)
        || failedOperationLacksPreMutationEvidence(context.job, RETURN_PRE_MUTATION_STAGES);
    if (lookupOnly) {
        if (stage !== 'return_lookup') await context.recordStage?.('return_lookup');
        const lookup = await lookupProviderReceipt(provider, context);
        if (lookup?.found || lookup?.receipt) return { receipt: lookup.receipt || lookup, source: 'lookup' };
        throw new PaymentOutboxWorkerError('return_lookup_required_before_retry', 'Possibly submitted return must be reconciled before another return attempt', { retryable: true, unknown: true });
    }
    if (!provider.createReturnReceipt) {
        throw new PaymentOutboxWorkerError('checkbox_return_not_supported', 'Checkbox return receipt operation is not configured', { retryable: false });
    }
    await context.recordStage?.('readiness');
    return {
        receipt: await provider.createReturnReceipt({
            fiscalOperation: context.job,
            paymentOrder: context.job,
            items: context.items,
            beforeExternalMutation: createExternalMutationBoundary(context, 'return_submit')
        }),
        source: 'return'
    };
}

async function runServiceReceiptJob(provider, context) {
    const stage = externalStage(context.job);
    const lookupOnly = SERVICE_POST_SUBMIT_STAGES.has(stage)
        || failedOperationLacksPreMutationEvidence(context.job, SERVICE_PRE_MUTATION_STAGES);
    if (lookupOnly) {
        if (!provider.lookupReceipt) {
            throw new PaymentOutboxWorkerError('checkbox_service_receipt_lookup_not_supported', 'Checkbox service receipt lookup is not configured', { retryable: false });
        }
        if (stage !== 'service_lookup') await context.recordStage?.('service_lookup');
        const lookup = await lookupProviderReceipt(provider, context);
        if (lookup?.found || lookup?.receipt) {
            return { receipt: lookup.receipt || lookup, source: 'service_lookup' };
        }
        throw new PaymentOutboxWorkerError(
            'service_receipt_lookup_pending',
            'Possibly submitted service receipt is not visible yet; only same-UUID lookup is allowed',
            { retryable: true, unknown: true }
        );
    }
    if (!provider.createServiceReceipt) {
        throw new PaymentOutboxWorkerError('checkbox_service_receipt_not_supported', 'Checkbox service receipt operation is not configured', { retryable: false });
    }
    await context.recordStage?.('readiness');
    return {
        receipt: await provider.createServiceReceipt({
            fiscalOperation: context.job,
            beforeExternalMutation: createExternalMutationBoundary(context, 'service_submit')
        }),
        source: 'service_submit'
    };
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
        if (!['OPENED', 'CLOSED'].includes(providerStatus)) {
            throw new PaymentOutboxWorkerError('checkbox_shift_open_pending', 'Checkbox shift open has not reached OPENED status', {
                retryable: true,
                unknown: true,
                details: { providerStatus: providerStatus || null }
            });
        }
        const expectedShiftId = String(context.job.provider_operation_id || '').trim();
        const actualShiftId = String(result.response?.id || '').trim();
        if (!expectedShiftId || !actualShiftId || actualShiftId !== expectedShiftId) {
            throw new PaymentOutboxWorkerError('checkbox_shift_open_identity_mismatch', 'Checkbox shift lookup did not return the exact durable open request UUID', {
                retryable: false,
                details: { expectedShiftId: expectedShiftId || null, actualShiftId: actualShiftId || null, providerStatus }
            });
        }
        let currentLifecycleStage = String(context.job.fiscal_shift_lifecycle_stage || 'CREATED').trim().toUpperCase();
        if (currentLifecycleStage === 'CREATED') {
            const opening = await client.query(
                `UPDATE fiscal_shifts
                    SET status = 'opening',
                        lifecycle_stage = 'OPENING',
                        provider_snapshot = provider_snapshot || $3::jsonb,
                        updated_at = NOW()
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND fiscal_register_id = $4
                    AND open_operation_id = $5
                    AND status IN ('opening', 'failed', 'blocked', 'unknown')
                    AND lifecycle_stage = 'CREATED'
                  RETURNING id`,
                [
                    shiftId,
                    context.job.fiscal_profile_id,
                    JSON.stringify({ lifecycle_stage: 'OPENING', external_stage: 'shift_request_maybe_submitted', source: 'shift_finalize' }),
                    context.job.fiscal_register_id,
                    context.job.fiscal_operation_id
                ]
            );
            if (!opening.rows.length) {
                throw new PaymentOutboxWorkerError('checkbox_shift_lifecycle_mismatch', 'Shift lifecycle could not advance from CREATED to OPENING before finalize', {
                    retryable: true,
                    unknown: true,
                    details: { currentLifecycleStage }
                });
            }
            currentLifecycleStage = 'OPENING';
        }
        const targetLifecycleStage = providerStatus === 'CLOSED' ? 'CLOSED' : 'OPENED';
        if (currentLifecycleStage !== targetLifecycleStage) {
            assertLifecycleTransition(currentLifecycleStage, targetLifecycleStage);
        }
        if (providerStatus === 'CLOSED') {
            const updatedShift = await client.query(
                `UPDATE fiscal_shifts
                    SET status = 'closed',
                        lifecycle_stage = 'CLOSED',
                        provider_shift_id = COALESCE(provider_shift_id, $3),
                        opened_at = COALESCE(opened_at, $7::timestamptz),
                        provider_opened_at = COALESCE(provider_opened_at, $7::timestamptz),
                        closed_at = COALESCE(closed_at, $8::timestamptz, NOW()),
                        provider_closed_at = COALESCE(provider_closed_at, $8::timestamptz),
                        provider_snapshot = provider_snapshot || $4::jsonb,
                        updated_at = NOW()
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND fiscal_register_id = $5
                    AND open_operation_id = $6
                    AND (provider_shift_id IS NULL OR provider_shift_id = $3)
                    AND (
                        (status IN ('opening', 'failed', 'blocked', 'unknown') AND lifecycle_stage = 'OPENING')
                        OR (status = 'closed' AND lifecycle_stage = 'CLOSED')
                    )
                  RETURNING id`,
                [
                    shiftId,
                    context.job.fiscal_profile_id,
                    actualShiftId,
                    JSON.stringify({
                        open_result: result.response || {},
                        lifecycle_stage: 'CLOSED',
                        missed_opened_observation: true
                    }),
                    context.job.fiscal_register_id,
                    context.job.fiscal_operation_id,
                    result.response?.openedAt || null,
                    result.response?.closedAt || null
                ]
            );
            if (!updatedShift.rows.length) {
                throw new PaymentOutboxWorkerError('checkbox_shift_open_closed_finalize_mismatch', 'Provider-closed shift could not reconcile the exact local open workflow', {
                    retryable: false,
                    details: { shiftId: Number(shiftId), providerShiftId: actualShiftId, currentLifecycleStage }
                });
            }
            await guardPaidPreSubmitSalesForClosedShift(client, {
                fiscalProfileId: context.job.fiscal_profile_id,
                fiscalRegisterId: context.job.fiscal_register_id,
                fiscalShiftId: shiftId,
                providerShiftId: actualShiftId,
                source: 'shift_open_exact_closed_lookup'
            });
            await client.query(
                `INSERT INTO fiscal_audit_events (
                     fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
                     idempotency_key, after_snapshot, metadata
                 )
                 SELECT $1::bigint, NULL::integer, 'fiscal_shift_open_observed_closed', 'fiscal_shifts', $2::bigint,
                        $3::text, $4::jsonb, $5::jsonb
                  WHERE NOT EXISTS (
                        SELECT 1
                          FROM fiscal_audit_events
                         WHERE fiscal_profile_id = $1::bigint
                           AND event_type = 'fiscal_shift_open_observed_closed'
                           AND entity_table = 'fiscal_shifts'
                           AND entity_id = $2::bigint
                           AND idempotency_key = $3::text
                  )`,
                [
                    context.job.fiscal_profile_id,
                    shiftId,
                    `fiscal_shift_open_observed_closed:${context.job.fiscal_operation_id}`,
                    JSON.stringify({ status: 'closed', lifecycle_stage: 'CLOSED' }),
                    JSON.stringify({
                        provider_status: 'CLOSED',
                        recovery_policy: 'exact_open_uuid_lookup_only',
                        sanitized: true
                    })
                ]
            );
            await markJobSucceeded(client, context.job);
            return { ok: true, jobId: Number(context.job.id), source: `${result.source || 'shift_open'}_observed_closed` };
        }
        const updatedShift = await client.query(
            `UPDATE fiscal_shifts
                SET status = 'open',
                    lifecycle_stage = 'OPENED',
                    provider_shift_id = COALESCE(provider_shift_id, $3),
                    opened_at = COALESCE(opened_at, $7::timestamptz, NOW()),
                    provider_opened_at = COALESCE(provider_opened_at, $7::timestamptz),
                    provider_snapshot = provider_snapshot || $4::jsonb,
                    updated_at = NOW()
                  WHERE id = $1
                    AND fiscal_profile_id = $2
                    AND fiscal_register_id = $5
                    AND open_operation_id = $6
                    AND (provider_shift_id IS NULL OR provider_shift_id = $3)
                    AND status = 'opening'
                    AND lifecycle_stage = 'OPENING'
              RETURNING id`,
            [
                shiftId,
                context.job.fiscal_profile_id,
                actualShiftId,
                JSON.stringify({ open_result: result.response || {}, lifecycle_stage: 'OPENED' }),
                context.job.fiscal_register_id,
                context.job.fiscal_operation_id,
                result.response?.openedAt || null
            ]
        );
        if (!updatedShift.rows.length) {
            throw new PaymentOutboxWorkerError('checkbox_shift_open_finalize_mismatch', 'Provider-opened shift could not finalize the matching local shift row', {
                retryable: true,
                unknown: true,
                details: { shiftId: Number(shiftId), currentLifecycleStage }
            });
        }
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
        if (providerStatus !== 'CLOSED') {
            throw new PaymentOutboxWorkerError('checkbox_shift_close_not_completed', 'Checkbox shift close has not reached CLOSED status', {
                retryable: true,
                unknown: true,
                details: { providerStatus: providerStatus || null }
            });
        }
        const currentLifecycleStage = String(context.job.fiscal_shift_lifecycle_stage || '').trim().toUpperCase();
        if (currentLifecycleStage !== 'CLOSED') {
            assertLifecycleTransition(currentLifecycleStage || 'CLOSING', 'CLOSED');
        }
        const updatedShift = await client.query(
            `UPDATE fiscal_shifts
                SET status = 'closed',
                    lifecycle_stage = 'CLOSED',
                    closed_at = COALESCE(closed_at, $5::timestamptz, NOW()),
                    provider_closed_at = COALESCE(provider_closed_at, $5::timestamptz),
                    provider_snapshot = provider_snapshot || $4::jsonb,
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND provider_shift_id = $3
                AND (
                    (status = 'closing' AND lifecycle_stage = 'CLOSING')
                    OR (status = 'closed' AND lifecycle_stage = 'CLOSED')
                )
              RETURNING id`,
            [
                shiftId,
                context.job.fiscal_profile_id,
                expectedShiftId,
                JSON.stringify({ close_result: result.response || {} }),
                result.response?.closedAt || null
            ]
        );
        if (!updatedShift.rows.length) {
            throw new PaymentOutboxWorkerError('checkbox_shift_close_finalize_mismatch', 'Provider-closed shift could not finalize the exact local shift row', {
                retryable: false,
                details: { shiftId: Number(shiftId), providerShiftId: expectedShiftId, currentLifecycleStage: currentLifecycleStage || null }
            });
        }
        await guardPaidPreSubmitSalesForClosedShift(client, {
            fiscalProfileId: context.job.fiscal_profile_id,
            fiscalRegisterId: context.job.fiscal_register_id,
            fiscalShiftId: shiftId,
            providerShiftId: expectedShiftId,
            source: 'shift_close_exact_closed_lookup'
        });
        await markJobSucceeded(client, context.job);
        return { ok: true, jobId: Number(context.job.id), source: result.source };
    }
    await client.query(
        `UPDATE fiscal_shifts
            SET status = 'closed',
                lifecycle_stage = 'CLOSED',
                closed_at = COALESCE(closed_at, $4::timestamptz, NOW()),
                provider_closed_at = COALESCE(provider_closed_at, $4::timestamptz),
                provider_snapshot = provider_snapshot || $3::jsonb,
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $2`,
        [shiftId, context.job.fiscal_profile_id, JSON.stringify({ close_result: result.response || {} }), result.response?.closedAt || null]
    );
    await markJobSucceeded(client, context.job);
    return { ok: true, jobId: Number(context.job.id), source: result.source };
}

async function runShiftJob(provider, context) {
    const method = context.job.job_type === 'shift_open' ? provider.openShift : provider.closeShift;
    if (!method) {
        throw new PaymentOutboxWorkerError('checkbox_shift_operation_not_supported', 'Checkbox shift operation is not configured', { retryable: false });
    }
    let stage = externalStage(context.job);
    let forcedLocalClosedLookup = false;
    const localShiftStatus = String(context.job.fiscal_shift_status || '').trim().toLowerCase();
    const localShiftLifecycle = String(context.job.fiscal_shift_lifecycle_stage || '').trim().toUpperCase();
    const localShiftAlreadyClosed = localShiftStatus === 'closed' || localShiftLifecycle === 'CLOSED';
    if (
        context.job.job_type === 'shift_close'
        && !SHIFT_CLOSE_LOOKUP_STAGES.has(stage)
        && localShiftAlreadyClosed
    ) {
        await context.recordStage?.('shift_close_lookup');
        stage = 'shift_close_lookup';
        forcedLocalClosedLookup = true;
    }
    if (context.job.job_type === 'shift_open' && SHIFT_OPEN_LOOKUP_STAGES.has(stage) && (provider.lookupShift || provider.ensureShiftOpened)) {
        const lookupInput = {
            providerOperationId: context.job.provider_operation_id,
            providerRequestUuid: context.job.provider_operation_id,
            fiscalOperation: context.job,
            payload: context.job.payload || {},
            beforeExternalMutation: context.assertMutationOwnership
        };
        const confirmedNotFoundStage = stage === 'shift_lookup_not_found' || stage === 'shift_request_retry_same_uuid';
        if (!confirmedNotFoundStage) {
            await context.recordStage?.('shift_lookup');
        }
        try {
            const response = provider.lookupShift
                ? await provider.lookupShift(lookupInput)
                : await provider.ensureShiftOpened(lookupInput, { allowOpenRequest: false });
            return { response, source: 'shift_lookup' };
        } catch (error) {
            const exactShiftNotFound = error instanceof CheckboxClientError && error.status === 404;
            if (!exactShiftNotFound) throw error;
            if (!confirmedNotFoundStage) {
                await context.recordStage?.('shift_lookup_not_found');
                throw new PaymentOutboxWorkerError(
                    'checkbox_shift_open_lookup_not_found',
                    'Durable Checkbox shift UUID was not found; a second exact lookup is required before a same-UUID retry',
                    { retryable: true, unknown: true }
                );
            }

            await context.recordStage?.('readiness');
            if (provider.prepareMutation) {
                await provider.prepareMutation(lookupInput);
            }
            await context.recordStage?.('shift_request_retry_same_uuid');
            try {
                const response = await provider.openShift({
                    ...lookupInput,
                    beforeExternalMutation: createExternalMutationBoundary(context, 'shift_request_maybe_submitted')
                });
                const providerStatus = String(response?.status || '').trim().toUpperCase();
                if (providerStatus !== 'OPENED') {
                    await context.recordStage?.('shift_lookup');
                    throw new PaymentOutboxWorkerError('checkbox_shift_open_pending', 'Checkbox shift open has not reached OPENED status', {
                        retryable: true,
                        unknown: true,
                        details: { providerStatus: providerStatus || null }
                    });
                }
                return { response, source: 'shift_open_same_uuid_retry' };
            } catch (error) {
                if (error instanceof PaymentOutboxWorkerError) throw error;
                if (error instanceof CheckboxClientError && error.status === 409) {
                    await context.recordStage?.('shift_lookup');
                    throw new PaymentOutboxWorkerError(
                        'checkbox_shift_open_conflict_lookup_required',
                        'Checkbox shift open conflict must converge through exact lookup of the same durable UUID',
                        { retryable: true, unknown: true }
                    );
                }
                throw error;
            }
        }
    }
    if (context.job.job_type === 'shift_close' && SHIFT_CLOSE_LOOKUP_STAGES.has(stage)) {
        if (typeof provider.lookupShift !== 'function') {
            throw new PaymentOutboxWorkerError('checkbox_shift_lookup_unavailable', 'Exact Checkbox shift lookup is required to recover a possibly submitted close operation', {
                retryable: true,
                unknown: true
            });
        }
        const confirmedStillOpenStage = stage === 'shift_close_lookup_still_open' || stage === 'shift_close_retry_exact_shift';
        if (!confirmedStillOpenStage && !forcedLocalClosedLookup) {
            await context.recordStage?.('shift_close_lookup');
        }
        const lookupInput = {
            providerOperationId: context.job.provider_operation_id,
            providerRequestUuid: context.job.provider_operation_id,
            fiscalOperation: context.job,
            payload: context.job.payload || {},
            beforeExternalMutation: context.assertMutationOwnership
        };
        let response;
        try {
            response = await provider.lookupShift(lookupInput, { requireOpened: false });
        } catch (error) {
            if (error instanceof CheckboxClientError && error.status === 404) {
                await context.recordStage?.('shift_close_lookup');
                throw new PaymentOutboxWorkerError('checkbox_shift_close_lookup_not_found', 'Exact Checkbox shift is not visible yet after a possibly submitted close', {
                    retryable: true,
                    unknown: true
                });
            }
            throw error;
        }
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
        if (String(response?.status || '').toUpperCase() === 'OPENED') {
            if (localShiftAlreadyClosed) {
                throw new PaymentOutboxWorkerError(
                    'checkbox_shift_close_state_mismatch',
                    'A locally CLOSED shift was observed as OPENED by Checkbox during lookup-only recovery',
                    {
                        retryable: false,
                        details: {
                            expectedShiftId,
                            actualShiftId,
                            localShiftStatus: localShiftStatus || null,
                            localShiftLifecycle: localShiftLifecycle || null,
                            providerStatus: 'OPENED'
                        }
                    }
                );
            }
            if (!confirmedStillOpenStage) {
                await context.recordStage?.('shift_close_lookup_still_open');
                throw new PaymentOutboxWorkerError('checkbox_shift_close_still_open', 'Exact Checkbox shift is still OPENED; a second exact lookup is required before close retry', {
                    retryable: true,
                    unknown: true
                });
            }
            await context.recordStage?.('readiness');
            if (provider.prepareMutation) {
                await provider.prepareMutation(lookupInput);
            }
            await context.recordStage?.('shift_close_retry_exact_shift');
            try {
                const closeResponse = await provider.closeShift({
                    ...lookupInput,
                    beforeExternalMutation: createExternalMutationBoundary(context, 'shift_close_request_maybe_submitted')
                });
                const closeStatus = String(closeResponse?.status || '').trim().toUpperCase();
                if (closeStatus === 'CLOSED') {
                    return { response: closeResponse, source: 'shift_close_exact_retry' };
                }
                await context.recordStage?.('shift_close_lookup');
                throw new PaymentOutboxWorkerError('checkbox_shift_close_pending', 'Checkbox shift close has not reached CLOSED status', {
                    retryable: true,
                    unknown: true,
                    details: { providerStatus: closeStatus || null }
                });
            } catch (error) {
                if (error instanceof PaymentOutboxWorkerError) throw error;
                if (error instanceof CheckboxClientError && error.status === 409) {
                    await context.recordStage?.('shift_close_lookup');
                    throw new PaymentOutboxWorkerError('checkbox_shift_close_conflict_lookup_required', 'Checkbox shift close conflict must converge through exact shift lookup', {
                        retryable: true,
                        unknown: true
                    });
                }
                throw error;
            }
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
    let response;
    try {
        response = await method.call(provider, {
            providerOperationId: context.job.provider_operation_id,
            providerRequestUuid: context.job.provider_operation_id,
            fiscalOperation: context.job,
            payload: context.job.payload || {},
            beforeExternalMutation: createExternalMutationBoundary(
                context,
                context.job.job_type === 'shift_open'
                    ? 'shift_request_maybe_submitted'
                    : 'shift_close_request_maybe_submitted'
            )
        });
    } catch (error) {
        if (error instanceof CheckboxClientError && error.status === 409) {
            await context.recordStage?.(context.job.job_type === 'shift_open' ? 'shift_lookup' : 'shift_close_lookup');
            throw new PaymentOutboxWorkerError(
                context.job.job_type === 'shift_open'
                    ? 'checkbox_shift_open_conflict_lookup_required'
                    : 'checkbox_shift_close_conflict_lookup_required',
                'Checkbox shift conflict must converge through exact lookup',
                { retryable: true, unknown: true }
            );
        }
        throw error;
    }
    const providerStatus = String(response?.status || '').trim().toUpperCase();
    if (context.job.job_type === 'shift_open' && !['OPENED', 'CLOSED'].includes(providerStatus)) {
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
    const failureWithoutPreMutationEvidence = failedOperationLacksPreMutationEvidence(context.job, PRE_SELL_STAGES);

    if (context.job.job_type === 'receipt_status_lookup' || mustLookupOnly || failureWithoutPreMutationEvidence) {
        if (!context.job.provider_shift_id) {
            throw new PaymentOutboxWorkerError('receipt_lookup_shift_identity_missing', 'Receipt lookup requires the immutable provider shift identity', {
                retryable: false
            });
        }
        await context.recordStage?.('receipt_lookup');
        const lookup = await lookupProviderReceipt(provider, context);
        if (lookup?.found || lookup?.receipt) {
            return { receipt: lookup.receipt || lookup, source: 'lookup' };
        }
        throw new PaymentOutboxWorkerError('receipt_lookup_required_before_retry', 'Possibly submitted sale must be reconciled by lookup before any further sale attempt', { retryable: true, unknown: true });
    }

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

    const expectedTaxIds = [];
    for (const item of context.items || []) {
        const taxMode = String(item.tax_mode || item.item_snapshot?.fiscal_tax_mode || 'taxed').trim().toLowerCase();
        const providerTaxId = String(item.provider_tax_id || '').trim();
        if (taxMode === 'untaxed') {
            if (providerTaxId) {
                throw new PaymentOutboxWorkerError('checkbox_untaxed_provider_tax_forbidden', 'Immutable untaxed item unexpectedly contains a provider tax id', { retryable: false });
            }
            continue;
        }
        if (taxMode !== 'taxed' || !providerTaxId || /^admission_tariff:/i.test(providerTaxId)) {
            throw new PaymentOutboxWorkerError('checkbox_provider_tax_id_missing', 'Immutable taxed item is missing its Checkbox provider tax id', { retryable: false });
        }
        expectedTaxIds.push(providerTaxId);
    }
    const requiredTender = context.job.source_snapshot?.tender
        || (context.job.payment_method === 'card_terminal' ? 'card_terminal_manual' : context.job.payment_method);
    await context.recordStage?.('readiness');
    if (typeof provider.prepareMutation !== 'function') {
        throw new PaymentOutboxWorkerError(
            'checkbox_mutation_readiness_unavailable',
            'Checkbox provider cannot verify mutation readiness',
            { retryable: false }
        );
    }
    await provider.prepareMutation({
        providerOperationId: context.job.provider_operation_id,
        providerRequestUuid: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items,
        beforeExternalMutation: context.assertMutationOwnership
    }, {
        expectedTaxIds: [...new Set(expectedTaxIds)].sort(),
        requiredTender
    });
    await context.recordStage?.('receipt_validation');
    await provider.validateSale({
        providerOperationId: context.job.provider_operation_id,
        providerRequestUuid: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items,
        beforeExternalMutation: context.assertMutationOwnership
    });
    const submitSale = provider.submitSaleReceipt || provider.createSaleReceipt;
    const receipt = await submitSale.call(provider, {
        providerOperationId: context.job.provider_operation_id,
        providerRequestUuid: context.job.provider_operation_id,
        fiscalOperation: context.job,
        paymentOrder: context.job,
        items: context.items,
        beforeExternalMutation: createExternalMutationBoundary(context, 'sale_submit')
    });
    return { receipt, source: 'sale' };
}

async function loadProcessingContext(dbPool, job, lockExpiryMs = DEFAULT_LOCK_EXPIRY_MS) {
    const leaseWindowMs = normalizedLockExpiryMs(lockExpiryMs);
    return withTransaction(dbPool, async client => {
        const context = await loadJobContext(client, job);
        const owner = await client.query(
            `UPDATE payment_outbox_jobs
                SET status = 'running',
                    locked_at = clock_timestamp(),
                    heartbeat_at = clock_timestamp(),
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND locked_by = $3
                AND attempts = $4
                AND lock_token = $5::uuid
                AND status IN ('claimed', 'running')
                AND COALESCE(heartbeat_at, locked_at) >= clock_timestamp() - ($6::int * INTERVAL '1 millisecond')
              RETURNING id`,
            [context.job.id, context.job.fiscal_profile_id, job.locked_by, job.attempts, job.lock_token, leaseWindowMs]
        );
        if (!owner.rows.length) {
            throw new PaymentOutboxWorkerError('payment_outbox_job_ownership_lost', 'Claimed payment outbox job ownership was lost before processing', { retryable: true });
        }
        context.job.locked_by = job.locked_by;
        context.job.lock_token = job.lock_token;
        context.job.status = 'running';
        context.lockExpiryMs = leaseWindowMs;
        context.claimedHeartbeatAt = job.heartbeat_at || null;
        context.claimObservedAt = job.lease_claimed_at || null;
        return context;
    });
}

async function assertFinalizeOwnership(client, context) {
    const lockExpiryMs = normalizedLockExpiryMs(context.lockExpiryMs);
    const result = await client.query(
        `SELECT id
           FROM payment_outbox_jobs
          WHERE id = $1
            AND fiscal_profile_id = $2
            AND locked_by = $3
            AND attempts = $4
            AND lock_token = $5::uuid
            AND status IN ('claimed', 'running')
            AND COALESCE(heartbeat_at, locked_at) >= clock_timestamp() - ($6::int * INTERVAL '1 millisecond')
          FOR UPDATE`,
        [context.job.id, context.job.fiscal_profile_id, context.job.locked_by, context.job.attempts, context.job.lock_token, lockExpiryMs]
    );
    if (!result.rows.length) {
        const observed = await client.query(
            `SELECT status,
                    attempts,
                    attempts = $4::int AS attempts_match,
                    locked_by = $3 AS owner_matches,
                    lock_token = $5::uuid AS token_matches,
                    COALESCE(heartbeat_at, locked_at) >= clock_timestamp() - ($6::int * INTERVAL '1 millisecond') AS lease_fresh,
                    EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(heartbeat_at, locked_at))) * 1000 AS lease_age_ms
               FROM payment_outbox_jobs
              WHERE id = $1
                AND fiscal_profile_id = $2`,
            [context.job.id, context.job.fiscal_profile_id, context.job.locked_by, context.job.attempts, context.job.lock_token, lockExpiryMs]
        );
        const row = observed.rows[0] || null;
        const details = row ? {
            jobId: Number(context.job.id),
            status: row.status,
            attemptsMatch: row.attempts_match === true,
            ownerMatches: row.owner_matches === true,
            tokenMatches: row.token_matches === true,
            leaseFresh: row.lease_fresh === true,
            leaseAgeMs: Math.round(Number(row.lease_age_ms)),
            lockExpiryMs,
            claimedHeartbeatAt: context.claimedHeartbeatAt || null,
            claimObservedAt: context.claimObservedAt || null,
            processingErrorCode: context.processingErrorCode || null
        } : { jobMissing: true };
        throw new PaymentOutboxWorkerError(
            'payment_outbox_job_ownership_lost',
            `Payment outbox job ownership was lost before finalize (${JSON.stringify(details)})`,
            {
            retryable: true,
            details
            }
        );
    }
}

async function requeueActiveShiftJobAfterPortalClose(client, context, errorInfo) {
    if (!['shift_open', 'shift_close'].includes(context.job.job_type)) return false;
    const recoveryStage = context.job.job_type === 'shift_open' ? 'shift_lookup' : 'shift_close_lookup';
    const recovered = await client.query(
        `UPDATE payment_outbox_jobs job
            SET status = 'queued',
                max_attempts = GREATEST(job.max_attempts, job.attempts + 1),
                locked_at = NULL,
                locked_by = NULL,
                lock_token = NULL,
                heartbeat_at = NULL,
                external_stage = $3::text,
                payload = job.payload || jsonb_build_object(
                    'external_stage', $3::text,
                    'portal_closed_active_recovery_used', TRUE,
                    'portal_closed_active_recovery_error_code', $4::text
                ),
                next_run_at = NOW(),
                last_error_code = NULL,
                last_error_message = NULL,
                updated_at = NOW()
           FROM fiscal_operations operation,
                fiscal_shifts shift
          WHERE job.id = $1
            AND job.fiscal_profile_id = $2
            AND job.fiscal_operation_id = operation.id
            AND operation.fiscal_profile_id = job.fiscal_profile_id
            AND shift.id = operation.fiscal_shift_id
            AND shift.fiscal_profile_id = operation.fiscal_profile_id
            AND shift.fiscal_register_id = operation.fiscal_register_id
            AND shift.status = 'closed'
            AND shift.lifecycle_stage = 'CLOSED'
            AND shift.provider_shift_id IS NOT NULL
            AND COALESCE(LOWER(job.payload->>'portal_closed_sync_observed') IN ('true', '1'), FALSE) = TRUE
            AND COALESCE(LOWER(job.payload->>'portal_closed_active_recovery_used') IN ('true', '1'), FALSE) = FALSE
            AND (
                (
                    job.job_type = 'shift_open'
                    AND operation.operation_type = 'shift_open'
                    AND shift.open_operation_id = operation.id
                    AND operation.provider_operation_id = shift.provider_shift_id
                )
                OR (
                    job.job_type = 'shift_close'
                    AND operation.operation_type = 'shift_close'
                    AND shift.close_operation_id = operation.id
                    AND NULLIF(operation.request_snapshot->>'provider_shift_id', '') = shift.provider_shift_id
                )
            )
          RETURNING job.id, job.fiscal_operation_id`,
        [context.job.id, context.job.fiscal_profile_id, recoveryStage, String(errorInfo.code || 'provider_closed_active_recovery').slice(0, 120)]
    );
    if (!recovered.rows.length) return false;

    await client.query(
        `UPDATE fiscal_operations
            SET status = 'pending',
                external_stage = $3,
                next_status_check_at = NOW(),
                last_error_code = NULL,
                last_error_message = NULL
          WHERE id = $1
            AND fiscal_profile_id = $2
            AND status <> 'fiscalized'`,
        [context.job.fiscal_operation_id, context.job.fiscal_profile_id, recoveryStage]
    );
    await client.query(
        `INSERT INTO fiscal_audit_events (
             fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
             idempotency_key, after_snapshot, metadata
         )
         SELECT $1::bigint, NULL::integer, 'payment_outbox_active_portal_close_requeued', 'payment_outbox_jobs', $2::bigint,
                $3::text, $4::jsonb, $5::jsonb
          WHERE NOT EXISTS (
                SELECT 1
                  FROM fiscal_audit_events
                 WHERE fiscal_profile_id = $1::bigint
                   AND event_type = 'payment_outbox_active_portal_close_requeued'
                   AND entity_table = 'payment_outbox_jobs'
                   AND entity_id = $2::bigint
                   AND idempotency_key = $3::text
          )`,
        [
            context.job.fiscal_profile_id,
            context.job.id,
            `payment_outbox_active_portal_close_requeued:${context.job.id}:${context.job.attempts}`,
            JSON.stringify({ status: 'queued', external_stage: recoveryStage }),
            JSON.stringify({
                provider: 'checkbox',
                recovery_policy: 'exact_closed_shift_lookup_only',
                triggering_error_code: String(errorInfo.code || 'unknown').slice(0, 120),
                sanitized: true
            })
        ]
    );
    return true;
}

async function finalizeJobFailure(dbPool, context, errorInfo) {
    return withTransaction(dbPool, async client => {
        await assertFinalizeOwnership(client, context);
        if (errorInfo.configuration === true) {
            await markJobConfigUnavailable(client, context, errorInfo);
            return { ok: false, skipped: true, jobId: Number(context.job.id), error: errorInfo };
        }
        if (await requeueActiveShiftJobAfterPortalClose(client, context, errorInfo)) {
            return { ok: false, recoveryQueued: true, jobId: Number(context.job.id), error: errorInfo };
        }
        await markJobFailed(client, context, errorInfo);
        return { ok: false, jobId: Number(context.job.id), error: errorInfo };
    });
}

function isRecordedReceiptMismatchError(error) {
    return error instanceof PaymentOutboxWorkerError
        && error.code === 'fiscal_receipt_identity_mismatch'
        && error.receiptMismatchEvidenceRecorded === true;
}

async function finalizeReceiptJobInTransaction(client, context, result, { recordCompleteStage = false } = {}) {
    try {
        await markFiscalized(client, context, result.receipt);
    } catch (error) {
        if (!isRecordedReceiptMismatchError(error)) throw error;
        const errorInfo = classifyWorkerError(error);
        await markJobFailed(client, context, errorInfo);
        return {
            ok: false,
            jobId: Number(context.job.id),
            source: result.source,
            receiptMismatch: true,
            error: errorInfo
        };
    }
    if (recordCompleteStage) {
        await recordExternalStageInTransaction(client, context, 'complete');
    }
    await markJobSucceeded(client, context.job);
    return { ok: true, jobId: Number(context.job.id), source: result.source };
}

async function finalizeJobSuccess(dbPool, context, result) {
    return withTransaction(dbPool, async client => {
        const finalizeContext = await loadJobContext(client, context.job);
        finalizeContext.job.locked_by = context.job.locked_by;
        finalizeContext.job.lock_token = context.job.lock_token;
        finalizeContext.job.attempts = context.job.attempts;
        finalizeContext.lockExpiryMs = context.lockExpiryMs;
        finalizeContext.claimedHeartbeatAt = context.claimedHeartbeatAt || null;
        finalizeContext.claimObservedAt = context.claimObservedAt || null;
        await assertFinalizeOwnership(client, finalizeContext);
        if (finalizeContext.job.job_type === 'receipt_sell' || finalizeContext.job.job_type === 'receipt_status_lookup') {
            return finalizeReceiptJobInTransaction(client, finalizeContext, result, { recordCompleteStage: true });
        }
        if (finalizeContext.job.job_type === 'receipt_return') {
            return finalizeReceiptJobInTransaction(client, finalizeContext, result);
        }
        if (finalizeContext.job.job_type === 'service_receipt') {
            return finalizeReceiptJobInTransaction(client, finalizeContext, result, { recordCompleteStage: true });
        }
        if (finalizeContext.job.job_type === 'shift_open' || finalizeContext.job.job_type === 'shift_close') {
            return markShiftJobSucceeded(client, finalizeContext, result);
        }
        throw new PaymentOutboxWorkerError('payment_outbox_job_type_not_supported', 'Payment outbox job type is not supported by this worker', { retryable: false });
    });
}

async function processOnePaymentOutboxJob({ dbPool, provider, job, lockExpiryMs = DEFAULT_LOCK_EXPIRY_MS }) {
    let context;
    try {
        context = await loadProcessingContext(dbPool, job, lockExpiryMs);
        context.recordStage = stage => recordExternalStage(dbPool, context, stage);
        context.assertMutationOwnership = () => assertPaymentOutboxJobOwnership(dbPool, context);
        try {
            assertImmutableProviderContext(context);
            if (!saleStageRequiresLookup(externalStage(context.job))) {
                await context.recordStage(externalStage(context.job));
            }
            const effectiveProvider = provider?.createForContext ? provider.createForContext(context) : provider;
            let result;
            if (context.job.job_type === 'receipt_sell' || context.job.job_type === 'receipt_status_lookup') {
                result = await runReceiptSaleJob(effectiveProvider, context);
                return await finalizeJobSuccess(dbPool, context, result);
            }
            if (context.job.job_type === 'receipt_return') {
                result = await runReceiptReturnJob(effectiveProvider, context);
                return await finalizeJobSuccess(dbPool, context, result);
            }
            if (context.job.job_type === 'service_receipt') {
                result = await runServiceReceiptJob(effectiveProvider, context);
                return await finalizeJobSuccess(dbPool, context, result);
            }
            if (context.job.job_type === 'shift_open' || context.job.job_type === 'shift_close') {
                result = await runShiftJob(effectiveProvider, context);
                return await finalizeJobSuccess(dbPool, context, result);
            }
            throw new PaymentOutboxWorkerError('payment_outbox_job_type_not_supported', 'Payment outbox job type is not supported by this worker', { retryable: false });
        } catch (error) {
            const errorInfo = classifyWorkerError(error);
            context.processingErrorCode = errorInfo.code || null;
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
        results.push(await processOnePaymentOutboxJob({ dbPool, provider: effectiveProvider, job, lockExpiryMs }));
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
    assertImmutableProviderContext,
    claimPaymentOutboxJobs,
    classifyWorkerError,
    computeBackoffMs,
    createUnavailableCheckboxProvider,
    externalStage,
    finalizeJobSuccess,
    processOnePaymentOutboxJob,
    processPaymentOutboxJobs,
    runReceiptReturnJob,
    runReceiptSaleJob,
    runServiceReceiptJob,
    runShiftJob,
    safePublishFiscalEvent,
    sanitizeError,
    shouldLookupBeforeSale
};
