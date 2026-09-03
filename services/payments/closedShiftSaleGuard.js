'use strict';

const POST_SUBMIT_STAGES = Object.freeze(['sale_submit', 'receipt_lookup', 'complete']);
const INCIDENT_TYPE = 'checkbox.paid_sale_blocked_by_closed_shift';
const ERROR_CODE = 'provider_shift_closed_before_sale_submit';

function postSubmitStageEvidenceSql(alias = 'job', operationAlias = 'operation', parameter = '$1') {
    return `EXISTS (
        SELECT 1
          FROM unnest(ARRAY[
                   NULLIF(BTRIM(${alias}.external_stage), ''),
                   NULLIF(BTRIM(${alias}.payload->>'external_stage'), ''),
                   NULLIF(BTRIM(${operationAlias}.external_stage), ''),
                   NULLIF(BTRIM(${operationAlias}.request_snapshot->>'external_stage'), '')
               ]::text[]) AS observed_stage(stage)
         WHERE LOWER(observed_stage.stage) = ANY(${parameter}::text[])
    )`;
}

function hasPostSubmitStageEvidence({
    jobExternalStage = null,
    payloadExternalStage = null,
    operationExternalStage = null,
    requestSnapshotExternalStage = null
} = {}) {
    const observedStages = [
        jobExternalStage,
        payloadExternalStage,
        operationExternalStage,
        requestSnapshotExternalStage
    ];
    return observedStages.some(stage => POST_SUBMIT_STAGES.includes(String(stage || '').trim().toLowerCase()));
}

async function guardPaidPreSubmitSalesForClosedShift(client, {
    fiscalProfileId,
    fiscalRegisterId,
    fiscalShiftId,
    providerShiftId,
    source = 'provider_closed_observation'
} = {}) {
    if (!client || !fiscalProfileId || !fiscalRegisterId || !fiscalShiftId || !providerShiftId) {
        return { blocked: 0, activeObserved: 0 };
    }

    const active = await client.query(
        `UPDATE payment_outbox_jobs job
            SET payload = job.payload || jsonb_build_object(
                    'provider_shift_closed_pre_submit', TRUE,
                    'provider_shift_id', $4::text
                ),
                updated_at = NOW()
           FROM fiscal_operations operation,
                payment_orders payment
          WHERE operation.id = job.fiscal_operation_id
            AND operation.fiscal_profile_id = job.fiscal_profile_id
            AND payment.id = operation.payment_order_id
            AND payment.fiscal_profile_id = operation.fiscal_profile_id
            AND operation.fiscal_profile_id = $1
            AND operation.fiscal_register_id = $2
            AND operation.fiscal_shift_id = $3
            AND operation.operation_type = 'sale'
            AND job.job_type = 'receipt_sell'
            AND job.status IN ('claimed', 'running')
            AND NOT ${postSubmitStageEvidenceSql('job', 'operation', '$5')}
            AND payment.payment_status = 'confirmed'
          RETURNING job.id`,
        [fiscalProfileId, fiscalRegisterId, fiscalShiftId, providerShiftId, POST_SUBMIT_STAGES]
    );

    const blocked = await client.query(
        `UPDATE payment_outbox_jobs job
            SET status = 'dead',
                locked_at = NULL,
                locked_by = NULL,
                lock_token = NULL,
                heartbeat_at = NULL,
                last_error_code = $5,
                last_error_message = 'Provider shift closed before the sale mutation boundary; operator reconciliation is required',
                payload = job.payload || jsonb_build_object(
                    'provider_shift_closed_pre_submit', TRUE,
                    'provider_shift_id', $4::text
                ),
                updated_at = NOW()
           FROM fiscal_operations operation,
                payment_orders payment
          WHERE operation.id = job.fiscal_operation_id
            AND operation.fiscal_profile_id = job.fiscal_profile_id
            AND payment.id = operation.payment_order_id
            AND payment.fiscal_profile_id = operation.fiscal_profile_id
            AND operation.fiscal_profile_id = $1
            AND operation.fiscal_register_id = $2
            AND operation.fiscal_shift_id = $3
            AND operation.operation_type = 'sale'
            AND job.job_type = 'receipt_sell'
            AND job.status IN ('queued', 'failed', 'dead')
            AND NOT ${postSubmitStageEvidenceSql('job', 'operation', '$6')}
            AND payment.payment_status = 'confirmed'
          RETURNING job.id, operation.id AS fiscal_operation_id, payment.id AS payment_order_id`,
        [fiscalProfileId, fiscalRegisterId, fiscalShiftId, providerShiftId, ERROR_CODE, POST_SUBMIT_STAGES]
    );

    for (const row of blocked.rows) {
        await client.query(
            `UPDATE fiscal_operations
                SET status = 'blocked',
                    last_error_code = $3,
                    last_error_message = 'Provider shift closed before sale submission; operator reconciliation is required'
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND status <> 'fiscalized'`,
            [row.fiscal_operation_id, fiscalProfileId, ERROR_CODE]
        );
        await client.query(
            `UPDATE payment_orders
                SET fiscal_status = 'blocked',
                    updated_at = NOW()
              WHERE id = $1
                AND fiscal_profile_id = $2
                AND fiscal_status <> 'fiscalized'`,
            [row.payment_order_id, fiscalProfileId]
        );
        await client.query(
            `INSERT INTO fiscal_operational_incidents (
                 fiscal_profile_id, fiscal_register_id, fiscal_operation_id, payment_order_id,
                 severity, incident_type, status, idempotency_key, details
             )
             VALUES ($1, $2, $3, $4, 'critical', $5, 'open', $6, $7::jsonb)
             ON CONFLICT (idempotency_key) DO UPDATE
                 SET status = CASE
                         WHEN fiscal_operational_incidents.status = 'resolved' THEN 'open'
                         ELSE fiscal_operational_incidents.status
                     END,
                     recurrence_count = CASE
                         WHEN fiscal_operational_incidents.status = 'resolved'
                         THEN fiscal_operational_incidents.recurrence_count + 1
                         ELSE fiscal_operational_incidents.recurrence_count
                     END,
                     resolved_at = CASE
                         WHEN fiscal_operational_incidents.status = 'resolved' THEN NULL
                         ELSE fiscal_operational_incidents.resolved_at
                     END,
                     last_seen_at = NOW(),
                     details = fiscal_operational_incidents.details || EXCLUDED.details`,
            [
                fiscalProfileId,
                fiscalRegisterId,
                row.fiscal_operation_id,
                row.payment_order_id,
                INCIDENT_TYPE,
                `${INCIDENT_TYPE}:${row.fiscal_operation_id}`,
                JSON.stringify({
                    code: ERROR_CODE,
                    fiscal_shift_id: Number(fiscalShiftId),
                    source: String(source || 'provider_closed_observation').slice(0, 80),
                    automatic_resubmission_allowed: false,
                    sanitized: true
                })
            ]
        );
        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
                 idempotency_key, after_snapshot, metadata
             )
             SELECT $1::bigint, NULL::integer, 'paid_sale_blocked_by_closed_shift', 'fiscal_operations', $2::bigint,
                    $3::text, $4::jsonb, $5::jsonb
              WHERE NOT EXISTS (
                    SELECT 1
                      FROM fiscal_audit_events
                     WHERE fiscal_profile_id = $1::bigint
                       AND event_type = 'paid_sale_blocked_by_closed_shift'
                       AND entity_table = 'fiscal_operations'
                       AND entity_id = $2::bigint
                       AND idempotency_key = $3::text
              )`,
            [
                fiscalProfileId,
                row.fiscal_operation_id,
                `paid_sale_blocked_by_closed_shift:${row.fiscal_operation_id}`,
                JSON.stringify({ status: 'blocked', external_stage: 'pre_submit' }),
                JSON.stringify({
                    payment_order_id: Number(row.payment_order_id),
                    fiscal_shift_id: Number(fiscalShiftId),
                    recovery_policy: 'operator_reconciliation_only',
                    sanitized: true
                })
            ]
        );
    }

    return { blocked: blocked.rows.length, activeObserved: active.rows.length };
}

module.exports = {
    CLOSED_SHIFT_PRE_SUBMIT_ERROR_CODE: ERROR_CODE,
    CLOSED_SHIFT_SALE_INCIDENT_TYPE: INCIDENT_TYPE,
    hasPostSubmitStageEvidence,
    postSubmitStageEvidenceSql,
    guardPaidPreSubmitSalesForClosedShift
};
