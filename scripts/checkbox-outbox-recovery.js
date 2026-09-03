#!/usr/bin/env node
'use strict';

const { pool } = require('../db');
const { resolveCapability } = require('../services/accountAccessPolicy');

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
const SERVICE_PRE_MUTATION_STAGES = new Set(['auth', 'readiness']);
const SERVICE_POST_SUBMIT_STAGES = new Set(['service_submit', 'service_lookup', 'complete']);
const RETURN_PRE_MUTATION_STAGES = new Set(['auth', 'readiness']);
const RETURN_POST_SUBMIT_STAGES = new Set(['return_submit', 'return_lookup', 'complete']);
const SHIFT_OPEN_RECOVERY_STAGES = new Set([
    'auth',
    'readiness',
    'shift_request',
    'shift_request_maybe_submitted',
    'shift_lookup',
    'shift_lookup_not_found',
    'shift_request_retry_same_uuid'
]);
const SHIFT_CLOSE_RECOVERY_STAGES = new Set([
    'auth',
    'readiness',
    'shift_close_request',
    'shift_close_request_maybe_submitted',
    'shift_close_lookup',
    'shift_close_lookup_still_open',
    'shift_close_retry_exact_shift'
]);
const MUTATING_MODES = new Set(['requeue-pre-sell', 'lookup-only']);
const MODES = new Set(['status', 'dead-letter', ...MUTATING_MODES]);

function parseArgs(argv) {
    const args = {
        mode: 'status',
        apply: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--apply') {
            args.apply = true;
            continue;
        }
        if (!token.startsWith('--')) {
            throw new Error(`Unexpected argument: ${token}`);
        }
        const key = token.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for ${token}`);
        }
        args[key] = value;
        index += 1;
    }

    if (!MODES.has(args.mode)) {
        throw new Error(`Unsupported mode: ${args.mode}`);
    }
    return args;
}

function toPositiveInt(value, label) {
    if (value == null) {
        throw new Error(`${label} is required`);
    }
    if (!/^\d+$/.test(String(value))) {
        throw new Error(`${label} must be a positive integer`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a safe positive integer`);
    }
    return parsed;
}

function jsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function externalStage(row) {
    const requestSnapshot = jsonObject(row.request_snapshot);
    const payload = jsonObject(row.payload);
    const current = [
        row.job_external_stage,
        payload.external_stage,
        row.operation_external_stage
    ].map(value => String(value || '').trim()).filter(Boolean);
    const snapshot = String(requestSnapshot.external_stage || '').trim();
    const all = snapshot ? [...current, snapshot] : current;
    const distinctCurrent = [...new Set(current)];
    const operationType = String(row.operation_type || '').trim();
    const jobType = String(row.job_type || '').trim();
    const isShiftOpen = operationType === 'shift_open' || jobType === 'shift_open';
    const isShiftClose = operationType === 'shift_close' || jobType === 'shift_close';
    const isServiceReceipt = jobType === 'service_receipt';
    const isReturnReceipt = jobType === 'receipt_return';

    if (isServiceReceipt && all.some(stage => SERVICE_POST_SUBMIT_STAGES.has(stage))) {
        if (distinctCurrent.length === 1 && SERVICE_POST_SUBMIT_STAGES.has(distinctCurrent[0])) {
            return distinctCurrent[0];
        }
        return 'service_lookup';
    }
    if (isReturnReceipt && all.some(stage => RETURN_POST_SUBMIT_STAGES.has(stage))) {
        if (distinctCurrent.length === 1 && RETURN_POST_SUBMIT_STAGES.has(distinctCurrent[0])) {
            return distinctCurrent[0];
        }
        return 'return_lookup';
    }
    if (!isShiftOpen && !isShiftClose && !isServiceReceipt && !isReturnReceipt && all.some(stage => POST_SELL_STAGES.has(stage))) {
        if (distinctCurrent.length === 1 && POST_SELL_STAGES.has(distinctCurrent[0])) {
            return distinctCurrent[0];
        }
        return 'receipt_lookup';
    }
    if (isShiftOpen && all.some(stage => SHIFT_OPEN_RECOVERY_STAGES.has(stage) && !['auth', 'readiness', 'shift_request'].includes(stage))) {
        if (distinctCurrent.length === 1 && SHIFT_OPEN_RECOVERY_STAGES.has(distinctCurrent[0])) {
            return distinctCurrent[0];
        }
        return 'shift_lookup';
    }
    if (isShiftClose && all.some(stage => SHIFT_CLOSE_RECOVERY_STAGES.has(stage) && !['auth', 'readiness', 'shift_close_request'].includes(stage))) {
        if (distinctCurrent.length === 1 && SHIFT_CLOSE_RECOVERY_STAGES.has(distinctCurrent[0])) {
            return distinctCurrent[0];
        }
        return 'shift_close_lookup';
    }
    return current[0] || all[0] || null;
}

function sanitizeRow(row) {
    return {
        jobId: row.job_id,
        jobType: row.job_type,
        jobStatus: row.job_status,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        locked: Boolean(row.locked_by || row.heartbeat_at || row.locked_at),
        lastErrorCode: row.job_last_error_code || null,
        operationId: row.operation_id,
        operationType: row.operation_type,
        operationStatus: row.operation_status,
        providerOperationId: row.provider_operation_id || null,
        externalStage: externalStage(row),
        fiscalProfileId: row.fiscal_profile_id,
        fiscalRegisterId: row.fiscal_register_id,
        registerAlias: row.register_alias || null,
        registerFeatureEnabled: row.register_feature_enabled,
        shiftId: row.shift_id || null,
        shiftStatus: row.shift_status || null,
        shiftLifecycleStage: row.shift_lifecycle_stage || null,
        providerShiftId: row.provider_shift_id || null,
        paymentOrderId: row.payment_order_id || null,
        paymentStatus: row.payment_status || null,
        fiscalStatus: row.fiscal_status || null
    };
}

async function loadScopedRows(client, args, options = {}) {
    const fiscalProfileId = toPositiveInt(args.profileId, '--profile-id');
    const fiscalRegisterId = toPositiveInt(args.registerId, '--register-id');
    const jobId = args.jobId == null ? null : toPositiveInt(args.jobId, '--job-id');
    const operationId = args.operationId == null ? null : toPositiveInt(args.operationId, '--operation-id');

    if (!jobId && !operationId) {
        throw new Error('Either --job-id or --operation-id is required');
    }

    const params = [fiscalProfileId, fiscalRegisterId, jobId, operationId];
    const lockClause = options.forUpdate ? ' FOR UPDATE OF poj, fo' : '';
    const result = await client.query(
        `SELECT
            poj.id AS job_id,
            poj.fiscal_profile_id,
            poj.fiscal_operation_id,
            poj.payment_order_id,
            poj.job_type,
            poj.status AS job_status,
            poj.attempts,
            poj.max_attempts,
            poj.locked_at,
            poj.locked_by,
            poj.heartbeat_at,
            poj.last_error_code AS job_last_error_code,
            poj.external_stage AS job_external_stage,
            poj.payload,
            fo.id AS operation_id,
            fo.fiscal_register_id,
            fo.operation_type,
            fo.status AS operation_status,
            fo.provider_operation_id,
            fo.external_stage AS operation_external_stage,
            fo.request_snapshot,
            fo.last_error_code AS operation_last_error_code,
            fr.register_alias AS register_alias,
            fr.feature_enabled AS register_feature_enabled,
            fs.id AS shift_id,
            fs.status AS shift_status,
            fs.lifecycle_stage AS shift_lifecycle_stage,
            fs.provider_shift_id,
            po.payment_status,
            po.fiscal_status
         FROM payment_outbox_jobs poj
         JOIN fiscal_operations fo
           ON fo.id = poj.fiscal_operation_id
          AND fo.fiscal_profile_id = poj.fiscal_profile_id
         JOIN fiscal_registers fr
           ON fr.id = fo.fiscal_register_id
          AND fr.fiscal_profile_id = fo.fiscal_profile_id
         LEFT JOIN fiscal_shifts fs
           ON fs.id = fo.fiscal_shift_id
          AND fs.fiscal_profile_id = fo.fiscal_profile_id
         LEFT JOIN payment_orders po
           ON po.id = poj.payment_order_id
          AND po.fiscal_profile_id = poj.fiscal_profile_id
         WHERE poj.fiscal_profile_id = $1
           AND fo.fiscal_register_id = $2
           AND ($3::BIGINT IS NULL OR poj.id = $3::BIGINT)
           AND ($4::BIGINT IS NULL OR fo.id = $4::BIGINT)
         ORDER BY poj.id${lockClause}`,
        params
    );
    return result.rows;
}

function assertSingleJob(rows, mode) {
    if (rows.length === 0) {
        throw new Error('No scoped outbox job found');
    }
    if (rows.length > 1) {
        throw new Error(`${mode} requires exactly one scoped job; pass --job-id`);
    }
    return rows[0];
}

function buildMutationPlan(row, mode) {
    const stage = externalStage(row);
    const operationType = String(row.operation_type || '').trim();
    const jobType = String(row.job_type || '').trim();
    const shiftLifecycleStage = String(row.shift_lifecycle_stage || '').trim().toUpperCase();
    const shiftStatus = String(row.shift_status || '').trim().toLowerCase();
    const isShiftOpen = operationType === 'shift_open' || jobType === 'shift_open';
    const isShiftClose = operationType === 'shift_close' || jobType === 'shift_close';
    const isServiceReceipt = jobType === 'service_receipt';
    const isReturnReceipt = jobType === 'receipt_return';
    if ((operationType === 'shift_open') !== (jobType === 'shift_open')) {
        throw new Error('Shift-open recovery requires matching shift_open operation and job types');
    }
    if ((operationType === 'shift_close') !== (jobType === 'shift_close')) {
        throw new Error('Shift-close recovery requires matching shift_close operation and job types');
    }
    if (row.locked_by && (row.heartbeat_at || row.locked_at)) {
        const leaseAt = Date.parse(row.heartbeat_at || row.locked_at);
        if (Number.isFinite(leaseAt) && Date.now() - leaseAt < 5 * 60 * 1000) {
            throw new Error('Cannot recover an active non-expired outbox lease');
        }
    }
    if (mode === 'requeue-pre-sell') {
        const allowedPreMutationStages = isServiceReceipt
            ? SERVICE_PRE_MUTATION_STAGES
            : (isReturnReceipt ? RETURN_PRE_MUTATION_STAGES : PRE_SELL_STAGES);
        if (!allowedPreMutationStages.has(stage)) {
            throw new Error(`requeue-pre-sell is allowed only before sale submit; current stage is ${stage || 'unknown'}`);
        }
        if (isShiftOpen) {
            if (!row.shift_id || !SHIFT_OPEN_RECOVERY_STAGES.has(stage)) {
                throw new Error(`shift_open recovery stage is invalid: ${stage || 'unknown'}`);
            }
            if (!['CREATED', 'OPENING'].includes(shiftLifecycleStage) || !['opening', 'failed', 'blocked'].includes(shiftStatus)) {
                throw new Error(`shift_open recovery requires CREATED/OPENING lifecycle; current state is ${shiftStatus || 'unknown'}/${shiftLifecycleStage || 'unknown'}`);
            }
        }
        if (isShiftClose) {
            if (!row.shift_id || !row.provider_shift_id || !SHIFT_CLOSE_RECOVERY_STAGES.has(stage)) {
                throw new Error(`shift_close recovery stage is invalid: ${stage || 'unknown'}`);
            }
            if (shiftLifecycleStage !== 'CLOSING' || !['closing', 'failed', 'blocked'].includes(shiftStatus)) {
                throw new Error(`shift_close recovery requires CLOSING lifecycle; current state is ${shiftStatus || 'unknown'}/${shiftLifecycleStage || 'unknown'}`);
            }
        }
        if (row.operation_status === 'fiscalized' || row.fiscal_status === 'fiscalized') {
            throw new Error('Cannot requeue a fiscalized operation');
        }
        return {
            targetStage: stage || 'auth',
            operationStatus: 'pending',
            action: isServiceReceipt
                ? 'requeue_pre_service_submit'
                : (isReturnReceipt ? 'requeue_pre_return_submit' : 'requeue_pre_sell')
        };
    }

    if (mode === 'lookup-only') {
        if (isShiftOpen || isShiftClose) {
            throw new Error('lookup-only is receipt-only; recover shift jobs through their exact shift lookup stage');
        }
        if (!row.provider_operation_id) {
            throw new Error('lookup-only requires provider_operation_id');
        }
        if (row.operation_status === 'fiscalized' || row.fiscal_status === 'fiscalized') {
            throw new Error('Cannot lookup-only a fiscalized operation through recovery; use status');
        }
        const allowedPostSubmitStages = isServiceReceipt
            ? SERVICE_POST_SUBMIT_STAGES
            : (isReturnReceipt ? RETURN_POST_SUBMIT_STAGES : POST_SELL_STAGES);
        if (!allowedPostSubmitStages.has(stage) && row.job_type !== 'receipt_status_lookup') {
            throw new Error(`lookup-only is allowed only for possibly submitted sale; current stage is ${stage || 'unknown'}`);
        }
        const targetStage = isServiceReceipt
            ? 'service_lookup'
            : (isReturnReceipt ? 'return_lookup' : 'receipt_lookup');
        return {
            targetStage,
            operationStatus: 'unknown',
            action: isServiceReceipt
                ? 'force_service_lookup_only'
                : (isReturnReceipt ? 'force_return_lookup_only' : 'force_lookup_only')
        };
    }

    throw new Error(`Mode ${mode} is not mutating`);
}

function normalizeTextArray(value) {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
        return value.slice(1, -1).split(',').map(item => item.trim().replace(/^"|"$/g, '')).filter(Boolean);
    }
    return [];
}

async function assertRecoveryActorAuthorized(client, row, actorUserId) {
    const result = await client.query(
        `SELECT u.id, u.username, u.name, u.role, u.extra_roles, u.action_allowlist, u.action_denylist, u.is_active,
                binding.capability_scope,
                register.metadata AS register_metadata
           FROM users u
           JOIN fiscal_cashier_bindings binding
             ON binding.user_id = u.id
            AND binding.fiscal_profile_id = $2
            AND binding.fiscal_register_id = $3
            AND binding.status = 'active'
           JOIN fiscal_registers register
             ON register.id = binding.fiscal_register_id
            AND register.fiscal_profile_id = binding.fiscal_profile_id
            AND register.status = 'active'
          WHERE u.id = $1
          LIMIT 1
          FOR UPDATE OF u, binding, register`,
        [actorUserId, row.fiscal_profile_id, row.fiscal_register_id]
    );
    if (result.rows.length !== 1) {
        throw new Error('Recovery actor requires one active exact fiscal profile/register binding');
    }
    const actor = result.rows[0];
    if (actor.is_active !== true) {
        throw new Error('Recovery actor user is not active');
    }
    const decision = resolveCapability(actor, 'fiscal.incident.manage');
    if (!decision.allowed) {
        throw new Error('Recovery actor lacks canonical fiscal.incident.manage capability');
    }
    if (!normalizeTextArray(actor.capability_scope).includes('fiscal.incident.manage')) {
        throw new Error('Recovery actor binding does not allow fiscal.incident.manage');
    }
    const metadata = jsonObject(actor.register_metadata);
    if (Number(metadata.integration_owner) !== Number(actorUserId)) {
        throw new Error('Only the exact fiscal register integration owner can recover outbox jobs');
    }
    return actor;
}

async function applyMutation(client, row, plan, reason, actorUserId = null) {
    const metadata = {
        recovery_action: plan.action,
        external_stage: plan.targetStage,
        reason: reason || 'operator recovery',
        no_provider_http: true,
        no_repeat_sale: true
    };

    const operationUpdate = await client.query(
        `UPDATE fiscal_operations
            SET status = $2,
                external_stage = $3,
                last_error_code = NULL,
                last_error_message = NULL
          WHERE id = $1
            AND fiscal_profile_id = $4
            AND fiscal_register_id = $5
          RETURNING id`,
        [
            row.operation_id,
            plan.operationStatus,
            plan.targetStage,
            row.fiscal_profile_id,
            row.fiscal_register_id
        ]
    );
    if (operationUpdate.rows.length !== 1) {
        throw new Error('Recovery could not update the exact scoped fiscal operation');
    }

    const jobUpdate = await client.query(
        `UPDATE payment_outbox_jobs
            SET status = 'queued',
                locked_at = NULL,
                locked_by = NULL,
                lock_token = NULL,
                heartbeat_at = NULL,
                attempts = CASE WHEN status = 'dead' THEN LEAST(attempts, max_attempts) ELSE attempts END,
                max_attempts = CASE WHEN status = 'dead' THEN max_attempts + 1 ELSE max_attempts END,
                next_run_at = NOW(),
                last_error_code = NULL,
                last_error_message = NULL,
                payload = COALESCE(payload, '{}'::jsonb)
                    || jsonb_build_object('external_stage', $2, 'operator_recovery_at', to_jsonb(NOW())),
                updated_at = NOW()
          WHERE id = $1
            AND fiscal_profile_id = $3
            AND fiscal_operation_id = $4
          RETURNING id`,
        [row.job_id, plan.targetStage, row.fiscal_profile_id, row.operation_id]
    );
    if (jobUpdate.rows.length !== 1) {
        throw new Error('Recovery could not update the exact scoped outbox job');
    }

    if (row.operation_type === 'shift_open' && row.shift_id) {
        const shiftUpdate = await client.query(
            `UPDATE fiscal_shifts
                SET status = 'opening',
                    lifecycle_stage = CASE
                        WHEN $3 IN (
                            'shift_request_maybe_submitted',
                            'shift_lookup',
                            'shift_lookup_not_found',
                            'shift_request_retry_same_uuid'
                        ) THEN 'OPENING'
                        ELSE lifecycle_stage
                    END,
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND fiscal_register_id = $4
                AND open_operation_id = $5
                AND status IN ('opening', 'failed', 'blocked')
                AND lifecycle_stage IN ('CREATED', 'OPENING')
              RETURNING id`,
            [row.shift_id, row.fiscal_profile_id, plan.targetStage, row.fiscal_register_id, row.operation_id]
        );
        if (shiftUpdate.rows.length !== 1) {
            throw new Error('Shift-open recovery could not restore the exact canonical shift lifecycle');
        }
    }

    if (row.operation_type === 'shift_close' && row.shift_id) {
        const shiftUpdate = await client.query(
            `UPDATE fiscal_shifts
                SET status = 'closing',
                    lifecycle_stage = 'CLOSING',
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND fiscal_register_id = $3
                AND close_operation_id = $4
                AND provider_shift_id = $5
                AND status IN ('closing', 'failed', 'blocked')
                AND lifecycle_stage = 'CLOSING'
              RETURNING id`,
            [row.shift_id, row.fiscal_profile_id, row.fiscal_register_id, row.operation_id, row.provider_shift_id]
        );
        if (shiftUpdate.rows.length !== 1) {
            throw new Error('Shift-close recovery could not restore the exact canonical shift lifecycle');
        }
    }

    await client.query(
        `INSERT INTO fiscal_audit_events (
            fiscal_profile_id,
            actor_user_id,
            event_type,
            entity_table,
            entity_id,
            idempotency_key,
            metadata
        ) VALUES ($1, $5, 'checkbox_outbox_operator_recovery', 'payment_outbox_jobs', $2, $3, $4::jsonb)`,
        [
            row.fiscal_profile_id,
            row.job_id,
            `checkbox-outbox-recovery:${row.job_id}:${Date.now()}`,
            JSON.stringify(metadata),
            actorUserId
        ]
    );
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const client = await pool.connect();
    try {
        const rows = await loadScopedRows(client, args);
        if (args.mode === 'status' || args.mode === 'dead-letter') {
            if (args.mode === 'dead-letter') {
                const filtered = rows.filter((row) => row.job_status === 'dead');
                console.log(JSON.stringify({ mode: args.mode, count: filtered.length, jobs: filtered.map(sanitizeRow) }, null, 2));
                return;
            }
            console.log(JSON.stringify({ mode: args.mode, count: rows.length, jobs: rows.map(sanitizeRow) }, null, 2));
            return;
        }

        const row = assertSingleJob(rows, args.mode);
        const actorUserId = args.actorUserId == null ? null : toPositiveInt(args.actorUserId, '--actor-user-id');
        if (args.apply && !actorUserId) {
            throw new Error('--actor-user-id is required for mutating recovery');
        }
        if (args.apply && !String(args.reason || '').trim()) {
            throw new Error('--reason is required for mutating recovery');
        }
        const plan = buildMutationPlan(row, args.mode);
        const output = {
            mode: args.mode,
            apply: args.apply,
            before: sanitizeRow(row),
            plan
        };

        if (!args.apply) {
            console.log(JSON.stringify(output, null, 2));
            return;
        }

        await client.query('BEGIN');
        const lockedRows = await loadScopedRows(client, args, { forUpdate: true });
        const lockedRow = assertSingleJob(lockedRows, args.mode);
        await assertRecoveryActorAuthorized(client, lockedRow, actorUserId);
        const lockedPlan = buildMutationPlan(lockedRow, args.mode);
        await applyMutation(client, lockedRow, lockedPlan, args.reason, actorUserId);
        await client.query('COMMIT');

        console.log(JSON.stringify({ ...output, applied: true }, null, 2));
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (_) {
            // ignore rollback failures outside a transaction
        }
        console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    SHIFT_OPEN_RECOVERY_STAGES,
    SHIFT_CLOSE_RECOVERY_STAGES,
    externalStage,
    buildMutationPlan,
    assertRecoveryActorAuthorized,
    applyMutation
};
