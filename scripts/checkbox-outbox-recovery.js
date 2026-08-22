#!/usr/bin/env node
'use strict';

const { pool } = require('../db');

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
    const stage = row.operation_external_stage || payload.external_stage || requestSnapshot.external_stage || null;
    return typeof stage === 'string' ? stage : null;
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
    if (row.locked_by && (row.heartbeat_at || row.locked_at)) {
        const leaseAt = Date.parse(row.heartbeat_at || row.locked_at);
        if (Number.isFinite(leaseAt) && Date.now() - leaseAt < 5 * 60 * 1000) {
            throw new Error('Cannot recover an active non-expired outbox lease');
        }
    }
    if (mode === 'requeue-pre-sell') {
        if (!PRE_SELL_STAGES.has(stage)) {
            throw new Error(`requeue-pre-sell is allowed only before sale submit; current stage is ${stage || 'unknown'}`);
        }
        if (row.operation_status === 'fiscalized' || row.fiscal_status === 'fiscalized') {
            throw new Error('Cannot requeue a fiscalized operation');
        }
        return {
            targetStage: stage || 'auth',
            operationStatus: row.operation_status === 'unknown' ? 'pending' : row.operation_status,
            action: 'requeue_pre_sell'
        };
    }

    if (mode === 'lookup-only') {
        if (!row.provider_operation_id) {
            throw new Error('lookup-only requires provider_operation_id');
        }
        if (row.operation_status === 'fiscalized' || row.fiscal_status === 'fiscalized') {
            throw new Error('Cannot lookup-only a fiscalized operation through recovery; use status');
        }
        if (!POST_SELL_STAGES.has(stage) && row.job_type !== 'receipt_status_lookup') {
            throw new Error(`lookup-only is allowed only for possibly submitted sale; current stage is ${stage || 'unknown'}`);
        }
        return {
            targetStage: 'receipt_lookup',
            operationStatus: 'unknown',
            action: 'force_lookup_only'
        };
    }

    throw new Error(`Mode ${mode} is not mutating`);
}

async function applyMutation(client, row, plan, reason, actorUserId = null) {
    const metadata = {
        recovery_action: plan.action,
        external_stage: plan.targetStage,
        reason: reason || 'operator recovery',
        no_provider_http: true,
        no_repeat_sale: true
    };

    await client.query(
        `UPDATE fiscal_operations
            SET status = $2,
                external_stage = $3
          WHERE id = $1
            AND fiscal_profile_id = $4
            AND fiscal_register_id = $5`,
        [
            row.operation_id,
            plan.operationStatus,
            plan.targetStage,
            row.fiscal_profile_id,
            row.fiscal_register_id
        ]
    );

    await client.query(
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
            AND fiscal_profile_id = $3`,
        [row.job_id, plan.targetStage, row.fiscal_profile_id]
    );

    if (row.operation_type === 'shift_open' && row.shift_id) {
        await client.query(
            `UPDATE fiscal_shifts
                SET status = CASE WHEN $3 = 'receipt_lookup' THEN status ELSE 'opening' END,
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
                AND status IN ('opening', 'failed', 'blocked')`,
            [row.shift_id, row.fiscal_profile_id, plan.targetStage]
        );
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
