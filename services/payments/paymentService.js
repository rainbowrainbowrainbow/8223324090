'use strict';

const crypto = require('node:crypto');
const { pool } = require('../../db');
const {
    AdmissionTicketError,
    resolveAdmissionTicketQuote
} = require('../admissionTickets');
const { normalizeBusinessContext } = require('../businessContext');
const { authorizeFiscalAction, FiscalAccessError } = require('./fiscalAccess');
const { toPostgresBigint } = require('./money');
const { ensureOpenShiftForSale } = require('./cashierOperationsService');
const {
    PaymentWorkflowError,
    assertManualConfirmationBody,
    normalizeTender
} = require('./paymentStateMachine');

const PILOT_CRM_PROFILE_KEY = 'event_genix';
const PILOT_REGISTER_ALIAS = 'middle';
const ORDER_SOURCE_TYPE = 'admission_ticket';
const OUTBOX_JOB_TYPE = 'receipt_sell';

class PaymentServiceError extends Error {
    constructor(code, message, { status = 400, details = null } = {}) {
        super(message || code);
        this.name = 'PaymentServiceError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
        this.details = details;
    }
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function fingerprint(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function requireIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (!key) {
        throw new PaymentServiceError('idempotency_key_required', 'Idempotency-Key header is required', { status: 400 });
    }
    if (key.length > 160) {
        throw new PaymentServiceError('idempotency_key_too_long', 'Idempotency-Key is too long', { status: 422 });
    }
    return key;
}

function assertNoClientFiscalOverride(body = {}) {
    for (const field of [
        'fiscalProfileId',
        'fiscal_profile_id',
        'fiscalRegisterId',
        'fiscal_register_id',
        'registerAlias',
        'register_alias',
        'legalEntityKey',
        'legal_entity_key',
        'fop',
        'price',
        'amount',
        'totalAmountMinor',
        'total_amount_minor',
        'sourceId',
        'source_id'
    ]) {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            throw new PaymentServiceError('client_payment_field_forbidden', 'Client cannot override price, fiscal profile, FOP, or register mapping', {
                status: 422,
                details: { field }
            });
        }
    }
}

function uahWholeToMinor(value, field) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new PaymentServiceError('admission_ticket_amount_invalid', 'Admission ticket amount must be a whole UAH integer', {
            status: 422,
            details: { field }
        });
    }
    return BigInt(value) * 100n;
}

function quantityToMillis(value, field) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new PaymentServiceError('admission_ticket_quantity_invalid', 'Admission ticket quantity must be a positive integer', {
            status: 422,
            details: { field }
        });
    }
    return BigInt(value) * 1000n;
}

function normalizePaymentOrder(row = {}) {
    if (!row) return null;
    return {
        id: Number(row.id),
        fiscalProfileId: Number(row.fiscal_profile_id),
        fiscalRegisterId: Number(row.fiscal_register_id),
        sourceType: row.source_type,
        sourceId: row.source_id,
        orderKey: row.order_key,
        status: row.status,
        paymentStatus: row.payment_status,
        fiscalStatus: row.fiscal_status,
        paymentMethod: row.payment_method,
        totalAmountMinor: String(row.total_amount_minor),
        currency: row.currency,
        confirmedAt: row.confirmed_at || null,
        sourceSnapshot: row.source_snapshot || {},
        confirmationSnapshot: row.confirmation_snapshot || {}
    };
}

function sanitizeCardReference(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.replace(/[^\p{L}\p{N}\s._:\/#-]/gu, '').replace(/\s+/g, ' ').slice(0, 160) || null;
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

async function loadPilotFiscalMapping(client, { crmProfileKey = PILOT_CRM_PROFILE_KEY, registerAlias = PILOT_REGISTER_ALIAS } = {}) {
    const result = await client.query(
        `SELECT
             fp.id AS fiscal_profile_id,
             fp.crm_profile_key,
             fp.legal_entity_key,
             fp.legal_entity_name,
             fp.status AS fiscal_profile_status,
             fl.id AS fiscal_location_id,
             fl.location_alias,
             fr.id AS fiscal_register_id,
             fr.register_alias,
             fr.display_name AS register_display_name,
             fr.feature_enabled,
             fr.status AS fiscal_register_status
           FROM fiscal_profiles fp
           JOIN fiscal_locations fl
             ON fl.fiscal_profile_id = fp.id
            AND fl.crm_profile_key = fp.crm_profile_key
            AND fl.status = 'active'
           JOIN fiscal_registers fr
             ON fr.fiscal_profile_id = fp.id
            AND fr.fiscal_location_id = fl.id
            AND fr.crm_profile_key = fp.crm_profile_key
            AND fr.register_alias = $2
            AND fr.status = 'active'
            AND fr.feature_enabled = TRUE
          WHERE fp.crm_profile_key = $1
            AND fp.status = 'active'`,
        [crmProfileKey, registerAlias]
    );
    if (result.rows.length !== 1) {
        throw new PaymentServiceError('fiscal_mapping_ambiguous_or_missing', 'Fiscal profile/register mapping is missing or ambiguous', {
            status: 409,
            details: { crmProfileKey, registerAlias, matches: result.rows.length }
        });
    }
    return result.rows[0];
}

async function findOrderByIdempotency(client, idempotencyKey) {
    const result = await client.query(
        `SELECT *
           FROM payment_orders
          WHERE idempotency_key = $1
          LIMIT 1`,
        [idempotencyKey]
    );
    return result.rows[0] || null;
}

async function findOrderByOrderKey(client, fiscalProfileId, orderKey) {
    const result = await client.query(
        `SELECT *
           FROM payment_orders
          WHERE fiscal_profile_id = $1
            AND order_key = $2
          LIMIT 1`,
        [fiscalProfileId, orderKey]
    );
    return result.rows[0] || null;
}

async function loadFiscalItemMappings(client, { fiscalProfileId, fiscalRegisterId, crmProfileKey, lines }) {
    const codes = [...new Set((lines || []).map(line => String(line.ticketTypeCode || '').trim()).filter(Boolean))];
    if (!codes.length) {
        throw new PaymentServiceError('fiscal_item_mapping_missing', 'Admission ticket fiscal item mapping is missing', { status: 409 });
    }
    const result = await client.query(
        `SELECT *
           FROM fiscal_item_mappings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND crm_profile_key = $3
            AND source_type = $4
            AND item_type = 'admission_ticket'
            AND item_code = ANY($5::text[])
            AND provider = 'checkbox'
            AND status = 'active'`,
        [fiscalProfileId, fiscalRegisterId, crmProfileKey, ORDER_SOURCE_TYPE, codes]
    );
    const byCode = new Map();
    for (const row of result.rows) {
        const code = String(row.item_code || '').trim();
        if (byCode.has(code)) {
            throw new PaymentServiceError('fiscal_item_mapping_ambiguous', 'Admission ticket fiscal item mapping is ambiguous', {
                status: 409,
                details: { itemCode: code }
            });
        }
        const fiscalItemName = String(row.fiscal_item_name || '').trim();
        const providerTaxId = String(row.provider_tax_id || '').trim();
        if (!fiscalItemName || !providerTaxId || /^admission_tariff:/i.test(providerTaxId)) {
            throw new PaymentServiceError('fiscal_item_tax_mapping_missing', 'Admission ticket fiscal tax mapping is incomplete', {
                status: 409,
                details: { itemCode: code }
            });
        }
        byCode.set(code, row);
    }
    const missing = codes.filter(code => !byCode.has(code));
    if (missing.length) {
        throw new PaymentServiceError('fiscal_item_mapping_missing', 'Admission ticket fiscal item mapping is missing', {
            status: 409,
            details: { itemCodes: missing }
        });
    }
    return byCode;
}

async function assertOrderItemsFiscalReady(client, { fiscalProfileId, paymentOrderId }) {
    const result = await client.query(
        `SELECT line_number, item_code, item_name, tax_reference, provider_tax_id
           FROM payment_order_items
          WHERE fiscal_profile_id = $1
            AND payment_order_id = $2
          ORDER BY line_number ASC`,
        [fiscalProfileId, paymentOrderId]
    );
    if (!result.rows.length) {
        throw new PaymentServiceError('payment_order_items_missing', 'Payment order has no immutable items', { status: 409 });
    }
    const invalid = result.rows.filter(row => {
        const providerTaxId = String(row.provider_tax_id || '').trim();
        return !providerTaxId || /^admission_tariff:/i.test(providerTaxId);
    });
    if (invalid.length) {
        throw new PaymentServiceError('payment_order_fiscal_item_not_ready', 'Payment order fiscal item/tax mapping is incomplete', {
            status: 409,
            details: { lines: invalid.map(row => Number(row.line_number)) }
        });
    }
    return result.rows;
}

async function loadOrderSnapshot(client, orderId) {
    const result = await client.query(
        `SELECT po.*,
                fp.crm_profile_key,
                fp.legal_entity_key,
                fp.legal_entity_name,
                fl.id AS fiscal_location_id,
                fr.register_alias,
                fr.display_name AS register_display_name
           FROM payment_orders po
           JOIN fiscal_profiles fp ON fp.id = po.fiscal_profile_id
           JOIN fiscal_registers fr
             ON fr.id = po.fiscal_register_id
            AND fr.fiscal_profile_id = po.fiscal_profile_id
           JOIN fiscal_locations fl
             ON fl.id = fr.fiscal_location_id
            AND fl.fiscal_profile_id = po.fiscal_profile_id
          WHERE po.id = $1
          LIMIT 1`,
        [orderId]
    );
    return result.rows[0] || null;
}

async function findAttemptByIdempotency(client, idempotencyKey) {
    const result = await client.query(
        `SELECT *
           FROM payment_attempts
          WHERE idempotency_key = $1
          LIMIT 1`,
        [idempotencyKey]
    );
    return result.rows[0] || null;
}

async function createAdmissionTicketPaymentOrder({
    dbPool = pool,
    user,
    body = {},
    idempotencyKey,
    quoteResolver = resolveAdmissionTicketQuote,
    authorizer = authorizeFiscalAction,
    now = new Date()
} = {}) {
    const key = requireIdempotencyKey(idempotencyKey);
    assertNoClientFiscalOverride(body);

    const rawCrmProfileKey = body.crmProfileKey || body.crm_profile_key || PILOT_CRM_PROFILE_KEY;
    const rawCrmProfileText = String(rawCrmProfileKey || '').trim().toLowerCase();
    if (rawCrmProfileText && rawCrmProfileText !== PILOT_CRM_PROFILE_KEY) {
        throw new PaymentServiceError('crm_profile_not_supported_for_pilot', 'Only the park CRM profile is enabled for the Checkbox pilot', {
            status: 409,
            details: { crmProfileKey: rawCrmProfileText }
        });
    }
    const crmProfileKey = normalizeBusinessContext(rawCrmProfileKey);
    if (crmProfileKey !== PILOT_CRM_PROFILE_KEY) {
        throw new PaymentServiceError('crm_profile_not_supported_for_pilot', 'Only the park CRM profile is enabled for the Checkbox pilot', {
            status: 409,
            details: { crmProfileKey }
        });
    }
    const { tender, paymentMethod } = normalizeTender(body.tender || body.paymentMethod || body.payment_method);
    const admissionTicketInput = body.admissionTicket || body.admission_ticket || {};
    const requestFingerprint = fingerprint({
        endpoint: 'create_admission_ticket_payment_order',
        crmProfileKey,
        tender,
        admissionTicketInput
    });

    return withTransaction(dbPool, async client => {
        const existing = await findOrderByIdempotency(client, key);
        if (existing) {
            if (existing.source_snapshot?.request_fingerprint !== requestFingerprint) {
                throw new PaymentServiceError('idempotency_key_conflict', 'Same idempotency key was used with a different payment order body', { status: 409 });
            }
            return { replayed: true, order: normalizePaymentOrder(existing) };
        }

        const mapping = await loadPilotFiscalMapping(client, { crmProfileKey });
        await authorizer(client, {
            user,
            action: 'payments.create',
            fiscalProfileId: mapping.fiscal_profile_id,
            crmProfileKey: mapping.crm_profile_key,
            fiscalLocationId: mapping.fiscal_location_id,
            fiscalRegisterId: mapping.fiscal_register_id
        });

        const quote = await quoteResolver({
            queryable: client,
            businessContext: mapping.crm_profile_key,
            input: admissionTicketInput,
            now,
            lockTariffTypes: true
        });
        if (!quote || quote.legacy || quote.requiresExplicitConversion || !Array.isArray(quote.ticketLines) || quote.ticketLines.length === 0) {
            throw new PaymentServiceError('admission_snapshot_invalid', 'Admission ticket snapshot is not valid for payment', { status: 409 });
        }

        const totalAmountMinor = uahWholeToMinor(quote.ticketSubtotal, 'ticketSubtotal');
        if (totalAmountMinor <= 0n) {
            throw new PaymentServiceError('admission_snapshot_empty', 'Admission ticket payment amount must be greater than zero', { status: 422 });
        }

        const mappingByItemCode = await loadFiscalItemMappings(client, {
            fiscalProfileId: mapping.fiscal_profile_id,
            fiscalRegisterId: mapping.fiscal_register_id,
            crmProfileKey: mapping.crm_profile_key,
            lines: quote.ticketLines
        });
        const sourceId = String(quote.quoteFingerprint || fingerprint({ crmProfileKey, tender, quote })).trim();
        const orderKey = `${ORDER_SOURCE_TYPE}:${mapping.crm_profile_key}:${PILOT_REGISTER_ALIAS}:${paymentMethod}:${sourceId}`;
        const existingLogicalOrder = await findOrderByOrderKey(client, mapping.fiscal_profile_id, orderKey);
        if (existingLogicalOrder) {
            return { replayed: true, order: normalizePaymentOrder(existingLogicalOrder), logicalReplay: true };
        }
        const sourceSnapshot = {
            source: ORDER_SOURCE_TYPE,
            request_fingerprint: requestFingerprint,
            logical_source_key: orderKey,
            quote,
            crm_profile_key: mapping.crm_profile_key,
            register_alias: mapping.register_alias,
            fiscal_location_id: Number(mapping.fiscal_location_id),
            legal_entity_key: mapping.legal_entity_key,
            legal_entity_name: mapping.legal_entity_name,
            tender
        };

        const inserted = await client.query(
            `INSERT INTO payment_orders (
                 fiscal_profile_id, fiscal_register_id, cashier_user_id, source_type, source_id,
                 order_key, idempotency_key, status, payment_status, fiscal_status,
                 payment_method, total_amount_minor, currency, source_snapshot, created_by_user_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', 'unpaid', 'pending', $8, $9, 'UAH', $10::jsonb, $11)
             RETURNING *`,
            [
                mapping.fiscal_profile_id,
                mapping.fiscal_register_id,
                user?.id || null,
                ORDER_SOURCE_TYPE,
                sourceId,
                orderKey,
                key,
                paymentMethod,
                toPostgresBigint(totalAmountMinor, { allowZero: false }),
                JSON.stringify(sourceSnapshot),
                user?.id || null
            ]
        );
        const order = inserted.rows[0];

        let lineNumber = 0;
        for (const line of quote.ticketLines) {
            lineNumber += 1;
            const itemMapping = mappingByItemCode.get(String(line.ticketTypeCode || '').trim());
            const unitPriceMinor = uahWholeToMinor(line.unitPriceUah, `ticketLines[${lineNumber}].unitPriceUah`);
            const totalLineMinor = uahWholeToMinor(line.subtotalUah, `ticketLines[${lineNumber}].subtotalUah`);
            const quantityMillis = quantityToMillis(line.quantity, `ticketLines[${lineNumber}].quantity`);
            await client.query(
                `INSERT INTO payment_order_items (
                     fiscal_profile_id, payment_order_id, line_number, item_type, item_code, item_name,
                     unit_price_minor, quantity_millis, total_amount_minor, currency, tax_reference,
                     tax_code, tax_rate_bps, provider_tax_id, item_snapshot
                 )
                 VALUES ($1, $2, $3, 'admission_ticket', $4, $5, $6, $7, $8, 'UAH', $9, $10, $11, $12, $13::jsonb)`,
                [
                    order.fiscal_profile_id,
                    order.id,
                    lineNumber,
                    line.ticketTypeCode,
                    itemMapping.fiscal_item_name,
                    toPostgresBigint(unitPriceMinor),
                    toPostgresBigint(quantityMillis),
                    toPostgresBigint(totalLineMinor),
                    line.tariffVersionId ? `admission_tariff:${line.tariffVersionId}` : null,
                    itemMapping.tax_code == null ? null : Number(itemMapping.tax_code),
                    itemMapping.tax_rate_bps == null ? null : Number(itemMapping.tax_rate_bps),
                    itemMapping.provider_tax_id,
                    JSON.stringify({ ...line, fiscal_item_mapping_id: Number(itemMapping.id), original_ticket_type_name: line.ticketTypeName })
                ]
            );
        }

        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
                 idempotency_key, after_snapshot
             )
             VALUES ($1, $2, 'payment_order_created', 'payment_orders', $3, $4, $5::jsonb)`,
            [order.fiscal_profile_id, user?.id || null, order.id, key, JSON.stringify({ status: order.status, total_amount_minor: String(order.total_amount_minor) })]
        );

        return { replayed: false, order: normalizePaymentOrder(order) };
    });
}

async function confirmPaymentOrder({
    dbPool = pool,
    user,
    orderId,
    body = {},
    idempotencyKey,
    authorizer = authorizeFiscalAction
} = {}) {
    const key = requireIdempotencyKey(idempotencyKey);
    assertNoClientFiscalOverride(body);

    const numericOrderId = Number(orderId);
    if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
        throw new PaymentServiceError('payment_order_id_invalid', 'Payment order id is invalid', { status: 422 });
    }
    const requestFingerprint = fingerprint({
        endpoint: 'confirm_payment_order',
        orderId: numericOrderId,
        tender: body.tender || body.paymentMethod || body.payment_method,
        confirmedAmountMinor: String(body.confirmedAmountMinor ?? body.confirmed_amount_minor ?? ''),
        terminalShowedSuccess: Boolean(body.terminalShowedSuccess ?? body.terminal_showed_success),
        terminalReference: sanitizeCardReference(body.terminalReference ?? body.terminal_reference)
    });

    return withTransaction(dbPool, async client => {
        const existingAttempt = await findAttemptByIdempotency(client, key);
        if (existingAttempt) {
            if (existingAttempt.request_snapshot?.fingerprint !== requestFingerprint) {
                throw new PaymentServiceError('idempotency_key_conflict', 'Same idempotency key was used with a different confirmation body', { status: 409 });
            }
            const existingOrder = await loadOrderSnapshot(client, existingAttempt.payment_order_id);
            return {
                replayed: true,
                order: normalizePaymentOrder(existingOrder),
                attemptId: Number(existingAttempt.id)
            };
        }

        const lockResult = await client.query(
            `SELECT po.*,
                    fp.crm_profile_key,
                    fp.legal_entity_key,
                    fp.legal_entity_name,
                    fl.id AS fiscal_location_id,
                    fr.register_alias,
                    fr.display_name AS register_display_name
               FROM payment_orders po
               JOIN fiscal_profiles fp ON fp.id = po.fiscal_profile_id
               JOIN fiscal_registers fr
                 ON fr.id = po.fiscal_register_id
                AND fr.fiscal_profile_id = po.fiscal_profile_id
               JOIN fiscal_locations fl
                 ON fl.id = fr.fiscal_location_id
                AND fl.fiscal_profile_id = po.fiscal_profile_id
              WHERE po.id = $1
              FOR UPDATE`,
            [numericOrderId]
        );
        if (!lockResult.rows.length) {
            throw new PaymentServiceError('payment_order_not_found', 'Payment order not found', { status: 404 });
        }
        const order = lockResult.rows[0];

        await authorizer(client, {
            user,
            action: 'payments.confirm_received',
            fiscalProfileId: order.fiscal_profile_id,
            crmProfileKey: order.crm_profile_key,
            fiscalLocationId: order.fiscal_location_id,
            fiscalRegisterId: order.fiscal_register_id
        });

        const confirmation = assertManualConfirmationBody({ order, body });
        await assertOrderItemsFiscalReady(client, { fiscalProfileId: order.fiscal_profile_id, paymentOrderId: order.id });
        const terminalReference = sanitizeCardReference(body.terminalReference ?? body.terminal_reference);
        const confirmationSnapshot = {
            tender: confirmation.tender,
            amount_minor: confirmation.amountMinor.toString(),
            received_amount_minor: confirmation.receivedAmountMinor.toString(),
            change_amount_minor: confirmation.changeAmountMinor.toString(),
            terminal_reference: terminalReference,
            terminal_showed_success: confirmation.tender === 'card_terminal_manual' ? true : undefined,
            confirmed_by_user_id: user?.id || null
        };

        const attempt = await client.query(
            `INSERT INTO payment_attempts (
                 fiscal_profile_id, payment_order_id, attempt_type, status, idempotency_key,
                 provider, provider_payment_reference, amount_minor, currency, request_snapshot,
                 result_snapshot, completed_at
             )
             VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7, 'UAH', $8::jsonb, $9::jsonb, NOW())
             RETURNING *`,
            [
                order.fiscal_profile_id,
                order.id,
                confirmation.tender === 'cash' ? 'cash_confirmation' : 'card_terminal_confirmation',
                key,
                confirmation.tender === 'cash' ? 'manual' : 'terminal',
                terminalReference,
                toPostgresBigint(confirmation.amountMinor, { allowZero: false }),
                JSON.stringify({ fingerprint: requestFingerprint, tender: confirmation.tender }),
                JSON.stringify({
                    confirmed: true,
                    received_amount_minor: confirmation.receivedAmountMinor.toString(),
                    change_amount_minor: confirmation.changeAmountMinor.toString()
                })
            ]
        );

        await client.query(
            `INSERT INTO payment_allocations (
                 fiscal_profile_id, payment_order_id, payment_method, amount_minor, currency,
                 status, allocation_snapshot, recorded_by_user_id
             )
             VALUES ($1, $2, $3, $4, 'UAH', 'recorded', $5::jsonb, $6)`,
            [
                order.fiscal_profile_id,
                order.id,
                order.payment_method,
                toPostgresBigint(confirmation.amountMinor, { allowZero: false }),
                JSON.stringify({
                    attempt_id: Number(attempt.rows[0].id),
                    tender: confirmation.tender,
                    received_amount_minor: confirmation.receivedAmountMinor.toString(),
                    change_amount_minor: confirmation.changeAmountMinor.toString()
                }),
                user?.id || null
            ]
        );

        await client.query(
            `UPDATE payment_orders
                SET status = 'confirmed',
                    payment_status = 'confirmed',
                    confirmation_snapshot = $2::jsonb,
                    confirmed_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1`,
            [order.id, JSON.stringify(confirmationSnapshot)]
        );

        const recorded = await client.query(
            `UPDATE payment_orders
                SET status = 'payment_recorded',
                    payment_status = 'confirmed',
                    fiscal_status = 'pending',
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [order.id]
        );
        const recordedOrder = recorded.rows[0];

        const shift = await ensureOpenShiftForSale(client, { order, user });
        const providerRequestUuid = crypto.randomUUID();
        const fiscalOperation = await client.query(
            `INSERT INTO fiscal_operations (
                 fiscal_profile_id, fiscal_register_id, payment_order_id, fiscal_shift_id, operation_type, status,
                 idempotency_key, provider, provider_operation_id, amount_minor, currency,
                 request_fingerprint, request_snapshot, initiated_by_user_id
             )
             VALUES ($1, $2, $3, $4, 'sale', 'pending', $5, 'checkbox', $6, $7, 'UAH', $8, $9::jsonb, $10)
             RETURNING *`,
            [
                order.fiscal_profile_id,
                order.fiscal_register_id,
                order.id,
                shift.id,
                `fiscal_operation:sale:${order.id}`,
                providerRequestUuid,
                toPostgresBigint(confirmation.amountMinor, { allowZero: false }),
                requestFingerprint,
                JSON.stringify({
                    provider_request_uuid: providerRequestUuid,
                    payment_order_id: Number(order.id),
                    fiscal_shift_id: Number(shift.id),
                    source_type: order.source_type,
                    source_id: order.source_id
                }),
                user?.id || null
            ]
        );

        const job = await client.query(
            `INSERT INTO payment_outbox_jobs (
                 fiscal_profile_id, fiscal_operation_id, payment_order_id, job_type,
                 status, idempotency_key, payload
             )
             VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb)
             RETURNING *`,
            [
                order.fiscal_profile_id,
                fiscalOperation.rows[0].id,
                order.id,
                OUTBOX_JOB_TYPE,
                `payment_outbox:receipt_sell:${order.id}`,
                JSON.stringify({
                    provider: 'checkbox',
                    provider_request_uuid: providerRequestUuid,
                    action: 'lookup_before_retry_on_unknown'
                })
            ]
        );

        await client.query(
            `INSERT INTO fiscal_audit_events (
                 fiscal_profile_id, actor_user_id, event_type, entity_table, entity_id,
                 idempotency_key, before_snapshot, after_snapshot
             )
             VALUES ($1, $2, 'payment_confirmed_outbox_queued', 'payment_orders', $3, $4, $5::jsonb, $6::jsonb)`,
            [
                order.fiscal_profile_id,
                user?.id || null,
                order.id,
                key,
                JSON.stringify({ status: order.status, payment_status: order.payment_status }),
                JSON.stringify({
                    status: recordedOrder.status,
                    payment_status: recordedOrder.payment_status,
                    fiscal_status: recordedOrder.fiscal_status,
                    fiscal_operation_id: Number(fiscalOperation.rows[0].id),
                    fiscal_shift_id: Number(shift.id),
                    outbox_job_id: Number(job.rows[0].id)
                })
            ]
        );

        return {
            replayed: false,
            order: normalizePaymentOrder(recordedOrder),
            attemptId: Number(attempt.rows[0].id),
            fiscalOperationId: Number(fiscalOperation.rows[0].id),
            outboxJobId: Number(job.rows[0].id),
            providerRequestUuid
        };
    });
}


function normalizePaymentOrderDetails(row = {}) {
    const order = normalizePaymentOrder(row);
    if (!order) return null;
    return {
        ...order,
        crmProfileKey: row.crm_profile_key,
        legalEntityKey: row.legal_entity_key,
        legalEntityName: row.legal_entity_name,
        fiscalLocationId: Number(row.fiscal_location_id),
        registerAlias: row.register_alias,
        registerDisplayName: row.register_display_name
    };
}

function normalizePaymentOrderItem(row = {}) {
    return {
        id: Number(row.id),
        lineNumber: Number(row.line_number),
        itemType: row.item_type,
        itemCode: row.item_code,
        itemName: row.item_name,
        unitPriceMinor: String(row.unit_price_minor),
        quantityMillis: String(row.quantity_millis),
        totalAmountMinor: String(row.total_amount_minor),
        currency: row.currency,
        taxReference: row.tax_reference || null,
        taxCode: row.tax_code == null ? null : Number(row.tax_code),
        taxRateBps: row.tax_rate_bps == null ? null : Number(row.tax_rate_bps),
        providerTaxId: row.provider_tax_id || null,
        itemSnapshot: row.item_snapshot || {}
    };
}

function normalizeFiscalOperation(row = {}) {
    if (!row) return null;
    return {
        id: Number(row.id),
        fiscalRegisterId: row.fiscal_register_id == null ? null : Number(row.fiscal_register_id),
        fiscalShiftId: row.fiscal_shift_id == null ? null : Number(row.fiscal_shift_id),
        paymentOrderId: row.payment_order_id == null ? null : Number(row.payment_order_id),
        operationType: row.operation_type,
        status: row.status,
        provider: row.provider,
        providerOperationId: row.provider_operation_id || null,
        providerStatus: row.provider_status || null,
        amountMinor: row.amount_minor == null ? null : String(row.amount_minor),
        currency: row.currency,
        lastErrorCode: row.last_error_code || null,
        lastErrorMessage: row.last_error_message || null,
        sentAt: row.sent_at || null,
        completedAt: row.completed_at || null,
        nextStatusCheckAt: row.next_status_check_at || null
    };
}

function normalizeFiscalReceipt(row = {}) {
    if (!row) return null;
    return {
        id: Number(row.id),
        fiscalOperationId: Number(row.fiscal_operation_id),
        paymentOrderId: row.payment_order_id == null ? null : Number(row.payment_order_id),
        receiptType: row.receipt_type,
        status: row.status,
        provider: row.provider,
        providerReceiptId: row.provider_receipt_id,
        providerFiscalCode: row.provider_fiscal_code || null,
        providerSerial: row.provider_serial || null,
        providerTaxUrl: row.provider_tax_url || null,
        providerPdfUrl: row.provider_pdf_url || null,
        providerQrUrl: row.provider_qr_url || null,
        totalAmountMinor: String(row.total_amount_minor),
        currency: row.currency,
        fiscalizedAt: row.fiscalized_at || null,
        providerSnapshot: row.provider_snapshot || {}
    };
}

function receiptArtifacts(receipts = []) {
    const fiscalized = receipts.find(receipt => receipt.status === 'fiscalized') || receipts[0] || null;
    if (!fiscalized) {
        return { qrUrl: null, taxUrl: null, pdfUrl: null };
    }
    return {
        qrUrl: fiscalized.providerQrUrl || null,
        taxUrl: fiscalized.providerTaxUrl || null,
        pdfUrl: fiscalized.providerPdfUrl || null
    };
}

async function getPaymentOrderDetails({
    dbPool = pool,
    user,
    orderId,
    authorizer = authorizeFiscalAction
} = {}) {
    const numericOrderId = Number(orderId);
    if (!Number.isSafeInteger(numericOrderId) || numericOrderId <= 0) {
        throw new PaymentServiceError('payment_order_id_invalid', 'Payment order id is invalid', { status: 422 });
    }

    return withTransaction(dbPool, async client => {
        const order = await loadOrderSnapshot(client, numericOrderId);
        if (!order) {
            throw new PaymentServiceError('payment_order_not_found', 'Payment order not found', { status: 404 });
        }

        await authorizer(client, {
            user,
            action: 'payments.view',
            fiscalProfileId: order.fiscal_profile_id,
            crmProfileKey: order.crm_profile_key,
            fiscalLocationId: order.fiscal_location_id,
            fiscalRegisterId: order.fiscal_register_id
        });

        const [itemsResult, operationsResult, receiptsResult] = await Promise.all([
            client.query(
                `SELECT *
                   FROM payment_order_items
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id = $2
                  ORDER BY line_number ASC`,
                [order.fiscal_profile_id, order.id]
            ),
            client.query(
                `SELECT *
                   FROM fiscal_operations
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id = $2
                  ORDER BY created_at DESC, id DESC
                  LIMIT 1`,
                [order.fiscal_profile_id, order.id]
            ),
            client.query(
                `SELECT *
                   FROM fiscal_receipts
                  WHERE fiscal_profile_id = $1
                    AND payment_order_id = $2
                  ORDER BY created_at DESC, id DESC`,
                [order.fiscal_profile_id, order.id]
            )
        ]);

        const receipts = receiptsResult.rows.map(normalizeFiscalReceipt);
        return {
            order: normalizePaymentOrderDetails(order),
            items: itemsResult.rows.map(normalizePaymentOrderItem),
            fiscalOperation: normalizeFiscalOperation(operationsResult.rows[0]),
            receipts,
            artifacts: receiptArtifacts(receipts)
        };
    });
}

function paymentErrorResponse(error) {
    if (error instanceof PaymentServiceError || error instanceof PaymentWorkflowError || error instanceof AdmissionTicketError || error instanceof FiscalAccessError) {
        return {
            status: error.status || error.statusCode || 400,
            body: {
                success: false,
                error: error.message,
                code: error.code,
                details: error.details || undefined
            }
        };
    }
    return {
        status: 500,
        body: {
            success: false,
            error: 'Internal payment workflow error',
            code: 'payment_workflow_internal_error'
        }
    };
}

module.exports = {
    ORDER_SOURCE_TYPE,
    OUTBOX_JOB_TYPE,
    PILOT_CRM_PROFILE_KEY,
    PILOT_REGISTER_ALIAS,
    PaymentServiceError,
    assertNoClientFiscalOverride,
    confirmPaymentOrder,
    createAdmissionTicketPaymentOrder,
    getPaymentOrderDetails,
    fingerprint,
    paymentErrorResponse,
    requireIdempotencyKey,
    stableJson
};
