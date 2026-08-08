'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');

const CHECKBOX_PROVIDER = 'checkbox';
const WEBHOOK_LOOKUP_JOB_TYPE = 'receipt_status_lookup';

class CheckboxWebhookError extends Error {
    constructor(code, message, { status = 400, details = null } = {}) {
        super(message || code);
        this.name = 'CheckboxWebhookError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
        this.details = details;
    }
}

function payloadHash(rawBody) {
    if (!Buffer.isBuffer(rawBody)) throw new TypeError('rawBody must be a Buffer');
    return crypto.createHash('sha256').update(rawBody).digest('hex');
}

function safeText(value, max = 160) {
    return String(value || '').trim().slice(0, max);
}

function sanitizeProviderPayload(value, depth = 0) {
    if (depth > 8) return '[depth-limit]';
    if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeProviderPayload(item, depth + 1));
    if (!value || typeof value !== 'object') {
        if (typeof value === 'string') return value.slice(0, 500);
        return value;
    }
    const result = {};
    for (const [key, raw] of Object.entries(value)) {
        if (/secret|token|password|pin|key|authorization|signature/i.test(key)) {
            result[key] = '[redacted]';
        } else {
            result[key] = sanitizeProviderPayload(raw, depth + 1);
        }
    }
    return result;
}

function parseJsonRawBody(rawBody) {
    try {
        return JSON.parse(rawBody.toString('utf8'));
    } catch {
        throw new CheckboxWebhookError('checkbox_webhook_json_invalid', 'Webhook body must be valid JSON', { status: 400 });
    }
}

function extractWebhookIdentity(payload = {}, headers = {}) {
    const nestedReceipt = payload.receipt || payload.service_receipt || payload.data?.receipt || payload.data?.service_receipt || null;
    const nestedShift = payload.shift || payload.data?.shift || nestedReceipt?.shift || null;
    const providerEventId = safeText(
        payload.event_id
        || payload.eventId
        || payload.id
        || headers['x-checkbox-event-id']
        || headers['x-event-id']
    );
    const deliveryId = safeText(
        payload.delivery_id
        || payload.deliveryId
        || headers['x-checkbox-delivery-id']
        || headers['x-delivery-id']
    );
    const eventType = safeText(
        payload.event_type
        || payload.eventType
        || payload.type
        || payload.event
        || 'receipt_status'
    );
    const providerOperationId = safeText(
        payload.provider_operation_id
        || payload.providerOperationId
        || payload.receipt_id
        || payload.receiptId
        || nestedReceipt?.id
        || nestedReceipt?.receipt_id
        || payload.data?.id
        || payload.data?.receipt_id
    );
    const providerReceiptId = safeText(
        payload.provider_receipt_id
        || payload.providerReceiptId
        || payload.receipt_id
        || payload.receiptId
        || nestedReceipt?.id
        || nestedReceipt?.receipt_id
        || payload.data?.receipt_id
        || payload.data?.id
    );
    const claimedFiscalProfileId = payload.fiscal_profile_id ?? payload.fiscalProfileId ?? payload.data?.fiscal_profile_id ?? nestedReceipt?.context?.fiscal_profile_id;

    if (!providerOperationId && !providerReceiptId) {
        throw new CheckboxWebhookError('checkbox_webhook_operation_missing', 'Webhook must reference a known provider operation or receipt', { status: 422 });
    }
    return {
        providerEventId: providerEventId || null,
        deliveryId: deliveryId || null,
        eventType,
        providerOperationId: providerOperationId || null,
        providerReceiptId: providerReceiptId || null,
        claimedFiscalProfileId: claimedFiscalProfileId === undefined || claimedFiscalProfileId === null ? null : Number(claimedFiscalProfileId),
        receiptStatus: nestedReceipt?.status || null,
        receiptType: nestedReceipt?.type || null,
        shiftId: nestedShift?.id || nestedReceipt?.shift_id || null
    };
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

async function loadWebhookFiscalOperation(client, identity) {
    const result = await client.query(
        `SELECT fo.*, po.fiscal_status AS payment_order_fiscal_status
           FROM fiscal_operations fo
           LEFT JOIN payment_orders po
             ON po.id = fo.payment_order_id
            AND po.fiscal_profile_id = fo.fiscal_profile_id
          WHERE fo.provider = 'checkbox'
            AND (
                ($1::text IS NOT NULL AND fo.provider_operation_id = $1)
                OR ($2::text IS NOT NULL AND EXISTS (
                    SELECT 1
                      FROM fiscal_receipts fr
                     WHERE fr.fiscal_operation_id = fo.id
                       AND fr.fiscal_profile_id = fo.fiscal_profile_id
                       AND fr.provider = 'checkbox'
                       AND fr.provider_receipt_id = $2
                ))
            )
          LIMIT 2`,
        [identity.providerOperationId, identity.providerReceiptId]
    );
    if (result.rows.length !== 1) {
        throw new CheckboxWebhookError('checkbox_webhook_operation_not_found', 'Webhook does not match exactly one fiscal operation', {
            status: 409,
            details: { matches: result.rows.length }
        });
    }
    const operation = result.rows[0];
    if (identity.claimedFiscalProfileId && Number(operation.fiscal_profile_id) !== identity.claimedFiscalProfileId) {
        throw new CheckboxWebhookError('checkbox_webhook_cross_profile_rejected', 'Webhook fiscal profile does not match the provider operation', {
            status: 409
        });
    }
    return operation;
}

async function insertWebhookAudit(client, { identity, operation, hash, sanitizedPayload }) {
    if (identity.providerEventId) {
        const existingByEvent = await client.query(
            `SELECT id, payload_sha256, status
               FROM provider_webhook_events
              WHERE provider = 'checkbox'
                AND provider_event_id = $1
              LIMIT 1`,
            [identity.providerEventId]
        );
        if (existingByEvent.rows.length) {
            const existing = existingByEvent.rows[0];
            if (existing.payload_sha256 !== hash) {
                throw new CheckboxWebhookError('checkbox_webhook_event_payload_conflict', 'Same provider event id was replayed with different payload', { status: 409 });
            }
            return { replayed: true, eventId: Number(existing.id) };
        }
    }

    const existingByPayload = await client.query(
        `SELECT id, status
           FROM provider_webhook_events
          WHERE provider = 'checkbox'
            AND payload_sha256 = $1
          LIMIT 1`,
        [hash]
    );
    if (existingByPayload.rows.length) {
        return { replayed: true, eventId: Number(existingByPayload.rows[0].id) };
    }

    let inserted;
    try {
        inserted = await client.query(
            `INSERT INTO provider_webhook_events (
                 fiscal_profile_id, provider, provider_event_id, delivery_id, event_type,
                 related_provider_operation_id, related_provider_receipt_id, webhook_signature_valid,
                 payload_sha256, sanitized_payload, status
             )
             VALUES ($1, 'checkbox', $2, $3, $4, $5, $6, TRUE, $7, $8::jsonb, 'received')
             ON CONFLICT (provider, payload_sha256) DO NOTHING
             RETURNING id`,
            [
                operation.fiscal_profile_id,
                identity.providerEventId,
                identity.deliveryId,
                identity.eventType,
                identity.providerOperationId,
                identity.providerReceiptId,
                hash,
                JSON.stringify(sanitizedPayload)
            ]
        );
    } catch (error) {
        if (error?.code !== '23505' || !identity.providerEventId) throw error;
        const conflicting = await client.query(
            `SELECT id, payload_sha256, status
               FROM provider_webhook_events
              WHERE provider = 'checkbox'
                AND provider_event_id = $1
              LIMIT 1`,
            [identity.providerEventId]
        );
        if (conflicting.rows.length && conflicting.rows[0].payload_sha256 !== hash) {
            throw new CheckboxWebhookError('checkbox_webhook_event_payload_conflict', 'Same provider event id was replayed with different payload', { status: 409 });
        }
        if (conflicting.rows.length) return { replayed: true, eventId: Number(conflicting.rows[0].id) };
        throw error;
    }

    if (!inserted.rows.length) {
        const replay = await client.query(
            `SELECT id, status
               FROM provider_webhook_events
              WHERE provider = 'checkbox'
                AND payload_sha256 = $1
              LIMIT 1`,
            [hash]
        );
        if (replay.rows.length) return { replayed: true, eventId: Number(replay.rows[0].id) };
        throw new CheckboxWebhookError('checkbox_webhook_replay_lookup_failed', 'Webhook replay could not be resolved after conflict-safe insert', { status: 409 });
    }

    await client.query(
        `INSERT INTO fiscal_audit_events (
             fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
             request_id, idempotency_key, after_snapshot, metadata
         )
         VALUES ($1, NULL, 'checkbox_webhook_received', 'provider_webhook_events', $2, NULL, $3, $4::jsonb, $5::jsonb)`,
        [
            operation.fiscal_profile_id,
            inserted.rows[0].id,
            identity.providerEventId || hash,
            JSON.stringify({ event_type: identity.eventType, provider_operation_id: identity.providerOperationId }),
            JSON.stringify({ provider: CHECKBOX_PROVIDER, req_user_absent: true })
        ]
    );

    return { replayed: false, eventId: Number(inserted.rows[0].id) };
}

async function enqueueWebhookStatusLookup(client, { operation, hash, eventId }) {
    const idempotencyKey = `checkbox_webhook_lookup:${operation.id}:${hash}`;
    const result = await client.query(
        `INSERT INTO payment_outbox_jobs (
             fiscal_profile_id, fiscal_operation_id, payment_order_id, job_type,
             status, idempotency_key, priority, next_run_at, payload
         )
         VALUES ($1, $2, $3, $4, 'queued', $5, 50, NOW(), $6::jsonb)
         ON CONFLICT (idempotency_key) DO UPDATE
             SET next_run_at = LEAST(payment_outbox_jobs.next_run_at, NOW()),
                 updated_at = NOW()
         RETURNING id, status`,
        [
            operation.fiscal_profile_id,
            operation.id,
            operation.payment_order_id,
            WEBHOOK_LOOKUP_JOB_TYPE,
            idempotencyKey,
            JSON.stringify({ provider: CHECKBOX_PROVIDER, webhook_event_id: eventId, action: 'status_lookup' })
        ]
    );
    return { id: Number(result.rows[0].id), status: result.rows[0].status };
}

async function handleCheckboxWebhook({ dbPool = pool, rawBody, headers = {} } = {}) {
    if (!Buffer.isBuffer(rawBody)) {
        throw new CheckboxWebhookError('checkbox_webhook_raw_body_missing', 'Raw webhook body is required', { status: 400 });
    }
    const payload = parseJsonRawBody(rawBody);
    const identity = extractWebhookIdentity(payload, headers);
    const hash = payloadHash(rawBody);
    const sanitizedPayload = sanitizeProviderPayload(payload);

    return withTransaction(dbPool, async client => {
        const operation = await loadWebhookFiscalOperation(client, identity);
        const audit = await insertWebhookAudit(client, { identity, operation, hash, sanitizedPayload });
        if (audit.replayed) {
            return { replayed: true, eventId: audit.eventId, queued: false };
        }
        const job = await enqueueWebhookStatusLookup(client, { operation, hash, eventId: audit.eventId });
        return {
            replayed: false,
            eventId: audit.eventId,
            queued: true,
            outboxJobId: job.id,
            fiscalOperationId: Number(operation.id),
            fiscalProfileId: Number(operation.fiscal_profile_id)
        };
    });
}

function checkboxWebhookErrorResponse(error) {
    if (error instanceof CheckboxWebhookError) {
        return {
            status: error.status,
            body: { success: false, code: error.code, error: error.message, details: error.details || undefined }
        };
    }
    return {
        status: 500,
        body: { success: false, code: 'checkbox_webhook_internal_error', error: 'Internal Checkbox webhook error' }
    };
}

module.exports = {
    CHECKBOX_PROVIDER,
    WEBHOOK_LOOKUP_JOB_TYPE,
    CheckboxWebhookError,
    checkboxWebhookErrorResponse,
    extractWebhookIdentity,
    handleCheckboxWebhook,
    payloadHash,
    sanitizeProviderPayload
};
