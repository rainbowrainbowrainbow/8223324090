'use strict';

const { pool: defaultPool } = require('../db');
const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('./businessContext');

const PAYMENT_METHODS = new Set(['cash', 'card']);
const DEPOSIT_STATUSES = new Set([
    'manager_reported',
    'needs_booking_link',
    'accountant_verified',
    'corrected',
    'cancelled'
]);
const MANAGER_DEPOSIT_STATUSES = new Set([
    'Не потрібен',
    'Очікуємо оплату',
    'Клієнт повідомив про оплату',
    'Потрібна перевірка бухгалтерії'
]);
const ACCOUNTING_DEPOSIT_STATUSES = new Set([
    'Не перевірено',
    'На перевірці',
    'Підтверджено',
    'Оплату не знайдено',
    'Сума не збігається',
    'Скасовано / повернено'
]);
const FINAL_ACCOUNTING_DEPOSIT_STATUSES = new Set([
    'Підтверджено',
    'Оплату не знайдено',
    'Сума не збігається',
    'Скасовано / повернено'
]);
const DEFAULT_MANAGER_DEPOSIT_STATUS = 'Очікуємо оплату';
const DEFAULT_ACCOUNTING_DEPOSIT_STATUS = 'Не перевірено';

class BanquetDepositError extends Error {
    constructor(message, { status = 400, code = 'BANQUET_DEPOSIT_ERROR', details = null } = {}) {
        super(message);
        this.name = 'BanquetDepositError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function cleanText(value, maxLength = 500) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text.slice(0, maxLength) : null;
}

function positiveInteger(value, fieldName, { required = false } = {}) {
    if (value === undefined || value === null || value === '') {
        if (required) {
            throw new BanquetDepositError(`${fieldName} is required`, {
                code: 'VALIDATION_REQUIRED',
                details: { field: fieldName }
            });
        }
        return null;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new BanquetDepositError(`${fieldName} must be a positive integer`, {
            code: 'VALIDATION_INVALID_INTEGER',
            details: { field: fieldName }
        });
    }
    return parsed;
}

function normalizeAmount(value, { required = false, allowZero = true } = {}) {
    if (value === undefined || value === null || value === '') {
        if (required) {
            throw new BanquetDepositError('amount is required', {
                code: 'VALIDATION_AMOUNT_REQUIRED',
                details: { field: 'amount' }
            });
        }
        return null;
    }

    const text = String(value).trim().replace(/\s+/g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(text)) {
        throw new BanquetDepositError('amount must be a non-negative number', {
            code: 'VALIDATION_AMOUNT_INVALID',
            details: { field: 'amount' }
        });
    }

    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed > 2147483647) {
        throw new BanquetDepositError('amount is out of supported range', {
            code: 'VALIDATION_AMOUNT_RANGE',
            details: { field: 'amount' }
        });
    }

    const amount = Math.round(parsed);
    if (!allowZero && amount <= 0) {
        throw new BanquetDepositError('amount must be greater than zero', {
            code: 'VALIDATION_AMOUNT_REQUIRED',
            details: { field: 'amount' }
        });
    }
    return amount;
}

function normalizePaymentMethod(value, { required = false } = {}) {
    const method = cleanText(value, 20);
    if (!method) {
        if (required) {
            throw new BanquetDepositError('paymentMethod is required', {
                code: 'VALIDATION_PAYMENT_METHOD_REQUIRED',
                details: { field: 'paymentMethod' }
            });
        }
        return null;
    }
    const normalized = method.toLowerCase();
    if (!PAYMENT_METHODS.has(normalized)) {
        throw new BanquetDepositError('paymentMethod must be cash or card', {
            code: 'VALIDATION_PAYMENT_METHOD_INVALID',
            details: { field: 'paymentMethod', value: method }
        });
    }
    return normalized;
}

function normalizeStatus(value, fallback = 'manager_reported') {
    const status = cleanText(value, 32) || fallback;
    if (!DEPOSIT_STATUSES.has(status)) {
        throw new BanquetDepositError('Unsupported deposit status', {
            code: 'VALIDATION_STATUS_INVALID',
            details: { field: 'status', value: status }
        });
    }
    return status;
}

function normalizeManagerStatus(value, fallback = DEFAULT_MANAGER_DEPOSIT_STATUS) {
    const status = cleanText(value, 64) || fallback;
    if (!MANAGER_DEPOSIT_STATUSES.has(status)) {
        throw new BanquetDepositError('Unsupported manager deposit status', {
            code: 'VALIDATION_MANAGER_STATUS_INVALID',
            details: { field: 'managerStatus', value: status }
        });
    }
    return status;
}

function normalizeAccountingStatus(value, fallback = DEFAULT_ACCOUNTING_DEPOSIT_STATUS) {
    const status = cleanText(value, 64) || fallback;
    if (!ACCOUNTING_DEPOSIT_STATUSES.has(status)) {
        throw new BanquetDepositError('Unsupported accounting deposit status', {
            code: 'VALIDATION_ACCOUNTING_STATUS_INVALID',
            details: { field: 'accountingStatus', value: status }
        });
    }
    return status;
}

function normalizeFinalAccountingStatus(value) {
    const status = normalizeAccountingStatus(value, null);
    if (!FINAL_ACCOUNTING_DEPOSIT_STATUSES.has(status)) {
        throw new BanquetDepositError('Final accounting status is required', {
            code: 'VALIDATION_ACCOUNTING_FINAL_STATUS_REQUIRED',
            details: { field: 'accountingStatus', value: status }
        });
    }
    return status;
}

function isFinalAccountingStatus(status) {
    return FINAL_ACCOUNTING_DEPOSIT_STATUSES.has(cleanText(status, 64));
}

function legacyStatusForAccountingStatus(accountingStatus, fallback = 'manager_reported') {
    if (accountingStatus === 'Підтверджено') return 'accountant_verified';
    if (accountingStatus === 'Сума не збігається' || accountingStatus === 'Оплату не знайдено') return 'corrected';
    if (accountingStatus === 'Скасовано / повернено') return 'cancelled';
    return fallback || 'manager_reported';
}

function accountingStatusFromLegacyStatus(status) {
    if (status === 'accountant_verified' || status === 'corrected') return 'Підтверджено';
    if (status === 'cancelled') return 'Скасовано / повернено';
    return DEFAULT_ACCOUNTING_DEPOSIT_STATUS;
}

function normalizeDateOnly(value, fieldName = 'date') {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const text = String(value).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new BanquetDepositError(`${fieldName} must be YYYY-MM-DD`, {
            code: 'VALIDATION_DATE_INVALID',
            details: { field: fieldName }
        });
    }
    return text;
}

function normalizeTimestamp(value, fieldName = 'timestamp') {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    const text = String(value).trim();
    const candidate = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text;
    const date = new Date(candidate);
    if (Number.isNaN(date.getTime())) {
        throw new BanquetDepositError(`${fieldName} must be a valid date or timestamp`, {
            code: 'VALIDATION_TIMESTAMP_INVALID',
            details: { field: fieldName }
        });
    }
    return date.toISOString();
}

function jsonObject(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function jsonParam(value) {
    return JSON.stringify(jsonObject(value));
}

function dateOnlyFromRow(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const text = String(value);
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function timestampFromRow(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    return String(value);
}

function actorUserId(value) {
    return positiveInteger(value?.id || value?.userId || value, 'actorUserId');
}

function queryable(options = {}) {
    return options.db || options.client || options.pool || defaultPool;
}

async function withTransaction(options, callback) {
    if (options.client || options.db) return callback(queryable(options), false);

    const pool = options.pool || defaultPool;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client, true);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

function mapLeadRow(row = null) {
    if (!row) return null;
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        clientName: row.client_name || null,
        phone: row.phone || null,
        eventDate: dateOnlyFromRow(row.event_date),
        bookingId: row.booking_id || null,
        pipelineStage: row.pipeline_stage || null,
        status: row.status || null,
        customerId: row.customer_id || null
    };
}

function mapCustomerRow(row = null) {
    if (!row) return null;
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        name: row.name || null,
        phone: row.phone || null,
        leadId: row.lead_id || null
    };
}

function mapBookingRow(row = null) {
    if (!row) return null;
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        customerId: row.customer_id || null,
        date: dateOnlyFromRow(row.date),
        time: row.time || null,
        label: row.label || null,
        programName: row.program_name || null,
        category: row.category || null,
        status: row.status || null,
        groupName: row.group_name || null,
        linkedTo: row.linked_to || null,
        paymentMethod: row.payment_method || null,
        paymentStatus: row.payment_status || null,
        paidAmount: row.paid_amount ?? null
    };
}

function mapGroupRow(row = null) {
    if (!row) return null;
    return {
        id: row.group_id || row.id || null,
        businessContext: row.group_business_context || row.business_context || DEFAULT_BUSINESS_CONTEXT,
        primaryBookingId: row.primary_booking_id || null,
        customerId: row.group_customer_id || row.customer_id || null,
        date: dateOnlyFromRow(row.group_date || row.date),
        status: row.group_status || row.status || null,
        source: row.group_source || row.source || null,
        role: row.group_role || row.role || null,
        groupName: row.group_name || null
    };
}

function mapDepositRow(row = null) {
    if (!row) return null;
    return {
        id: row.id,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        banquetGroupId: row.banquet_group_id || null,
        primaryBookingId: row.primary_booking_id || null,
        leadId: row.lead_id || null,
        customerId: row.customer_id || null,
        accountantTaskId: row.accountant_task_id || null,
        clientNameSnapshot: row.client_name_snapshot || null,
        eventDate: dateOnlyFromRow(row.event_date),
        banquetNumberSnapshot: row.banquet_number_snapshot || null,
        amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
        expectedAmount: row.expected_amount === null || row.expected_amount === undefined ? null : Number(row.expected_amount),
        paidAmount: row.paid_amount === null || row.paid_amount === undefined ? null : Number(row.paid_amount),
        paymentMethod: row.payment_method || null,
        status: row.status || 'manager_reported',
        managerStatus: row.manager_status || DEFAULT_MANAGER_DEPOSIT_STATUS,
        accountingStatus: row.accounting_status || accountingStatusFromLegacyStatus(row.status),
        dueDate: dateOnlyFromRow(row.due_date),
        managerNote: row.manager_note || null,
        accountingNote: row.accounting_note || null,
        reviewStartedAt: timestampFromRow(row.review_started_at),
        reviewStartedBy: row.review_started_by || null,
        sourceKind: row.source_kind || null,
        sourcePayload: jsonObject(row.source_payload),
        managerReportedAt: timestampFromRow(row.manager_reported_at),
        managerReportedBy: row.manager_reported_by || null,
        verifiedAt: timestampFromRow(row.verified_at),
        verifiedBy: row.verified_by || null,
        correctedAt: timestampFromRow(row.corrected_at),
        correctedBy: row.corrected_by || null,
        financeTransactionId: row.finance_transaction_id || null,
        meta: jsonObject(row.meta),
        createdAt: timestampFromRow(row.created_at),
        updatedAt: timestampFromRow(row.updated_at)
    };
}

function managerStatusForProjection(deposit = null) {
    if (!deposit) return DEFAULT_MANAGER_DEPOSIT_STATUS;
    const hasManagerAmount = deposit.expectedAmount !== null && deposit.expectedAmount !== undefined;
    const hasManagerDueDate = Boolean(deposit.dueDate);
    const hasManagerNote = Boolean(deposit.managerNote);
    const managerStatus = deposit.managerStatus || DEFAULT_MANAGER_DEPOSIT_STATUS;
    if (!hasManagerAmount && !hasManagerDueDate && !hasManagerNote && managerStatus === DEFAULT_MANAGER_DEPOSIT_STATUS) {
        return null;
    }
    return managerStatus;
}

function projectionState(status) {
    if (!status) return 'missing';
    if (status === 'Підтверджено') return 'verified';
    if (status === 'Скасовано / повернено') return 'cancelled';
    if (status === 'Оплату не знайдено' || status === 'Сума не збігається') return 'problem';
    if (status === 'accountant_verified' || status === 'corrected') return 'verified';
    if (status === 'cancelled') return 'cancelled';
    return 'pending';
}

function displayProjection(deposit, context = {}) {
    const amount = deposit?.paidAmount ?? deposit?.expectedAmount ?? deposit?.amount ?? null;
    const paymentMethod = deposit?.paymentMethod || null;
    const eventDate = deposit?.eventDate || context.eventDate || null;
    const clientName = deposit?.clientNameSnapshot || context.clientName || null;
    const banquetNumber = deposit?.banquetNumberSnapshot || context.banquetNumber || null;
    const managerStatus = managerStatusForProjection(deposit);
    return {
        clientName,
        eventDate,
        banquetNumber,
        amount,
        amountLabel: amount === null || amount === undefined ? null : String(amount),
        paymentMethod,
        paymentMethodLabel: paymentMethod,
        managerStatus,
        accountingStatus: deposit?.accountingStatus || DEFAULT_ACCOUNTING_DEPOSIT_STATUS,
        dueDate: deposit?.dueDate || null,
        isVerified: projectionState(deposit?.accountingStatus || deposit?.status) === 'verified',
        needsBookingLink: deposit?.status === 'needs_booking_link' || context.needsBookingLink === true
    };
}

function depositProjection(depositRow, context = {}) {
    const deposit = mapDepositRow(depositRow);
    if (!deposit) {
        return {
            state: 'missing',
            status: 'missing',
            deposit: null,
            businessContext: context.businessContext || DEFAULT_BUSINESS_CONTEXT,
            leadId: context.lead?.id || context.leadId || null,
            bookingId: context.booking?.id || context.bookingId || null,
            banquetGroupId: context.group?.id || context.banquetGroupId || null,
            customerId: context.customer?.id || context.customerId || null,
            needsBookingLink: context.needsBookingLink === true,
            display: displayProjection(null, context)
        };
    }
    const managerStatus = managerStatusForProjection(deposit);
    const projectedDeposit = { ...deposit, managerStatus };
    return {
        state: projectionState(deposit.accountingStatus || deposit.status),
        status: deposit.status,
        managerStatus,
        accountingStatus: deposit.accountingStatus,
        deposit: projectedDeposit,
        businessContext: deposit.businessContext,
        leadId: deposit.leadId,
        bookingId: deposit.primaryBookingId,
        banquetGroupId: deposit.banquetGroupId,
        customerId: deposit.customerId,
        needsBookingLink: deposit.status === 'needs_booking_link',
        display: displayProjection(projectedDeposit, context)
    };
}

function buildContext({ businessContext, lead, booking, customer, group, reason = null } = {}) {
    const context = normalizeBusinessContext(businessContext || lead?.business_context || booking?.business_context || DEFAULT_BUSINESS_CONTEXT);
    const mappedLead = mapLeadRow(lead);
    const mappedBooking = mapBookingRow(booking);
    const mappedCustomer = mapCustomerRow(customer);
    const mappedGroup = mapGroupRow(group);
    const primaryBookingId = mappedGroup?.primaryBookingId || mappedBooking?.id || null;
    const customerId = mappedGroup?.customerId || mappedBooking?.customerId || mappedCustomer?.id || mappedLead?.customerId || null;
    const eventDate = mappedGroup?.date || mappedBooking?.date || mappedLead?.eventDate || null;
    const clientName = mappedCustomer?.name || mappedLead?.clientName || mappedBooking?.label || mappedBooking?.groupName || null;
    const banquetNumber = mappedGroup?.id || primaryBookingId || null;
    const needsBookingLink = !mappedBooking && !primaryBookingId;
    return {
        businessContext: context,
        lead: mappedLead,
        booking: mappedBooking,
        customer: mappedCustomer,
        group: mappedGroup,
        leadId: mappedLead?.id || null,
        primaryBookingId,
        bookingId: mappedBooking?.id || null,
        customerId,
        banquetGroupId: mappedGroup?.id || null,
        eventDate,
        clientName,
        banquetNumber,
        needsBookingLink,
        reason
    };
}

async function loadLeadById(db, leadId, businessContext) {
    const result = await db.query(
        `SELECT *
           FROM leads
          WHERE id = $1
            AND COALESCE(business_context, $2) = $2
          LIMIT 1`,
        [leadId, businessContext]
    );
    return result.rows[0] || null;
}

async function loadBookingById(db, bookingId, businessContext, { forUpdate = false } = {}) {
    const result = await db.query(
        `SELECT b.*, c.name AS customer_name, c.lead_id AS customer_lead_id
           FROM bookings b
           LEFT JOIN customers c
             ON c.id = b.customer_id
            AND COALESCE(c.business_context, $2) = $2
          WHERE b.id = $1
            AND COALESCE(b.business_context, $2) = $2
          LIMIT 1${forUpdate ? ' FOR UPDATE OF b' : ''}`,
        [bookingId, businessContext]
    );
    return result.rows[0] || null;
}

async function loadCustomerForLead(db, leadId, businessContext) {
    const result = await db.query(
        `SELECT c.*
           FROM customers c
          WHERE COALESCE(c.business_context, $2) = $2
            AND (
                c.lead_id = $1
                OR EXISTS (
                    SELECT 1
                      FROM lead_customer_links lcl
                     WHERE lcl.customer_id = c.id
                       AND lcl.lead_id = $1
                       AND COALESCE(lcl.business_context, $2) = $2
                )
            )
          ORDER BY CASE WHEN c.lead_id = $1 THEN 0 ELSE 1 END,
                   c.updated_at DESC NULLS LAST,
                   c.id DESC
          LIMIT 1`,
        [leadId, businessContext]
    );
    return result.rows[0] || null;
}

async function loadLeadForBooking(db, booking, businessContext) {
    if (!booking) return null;
    const result = await db.query(
        `SELECT *
           FROM (
                SELECT l.*, 0 AS match_priority
                  FROM leads l
                 WHERE l.booking_id = $1
                   AND COALESCE(l.business_context, $3) = $3

                UNION ALL

                SELECT l.*, 1 AS match_priority
                  FROM leads l
                 WHERE $2::integer IS NOT NULL
                   AND l.id = (
                       SELECT c.lead_id
                         FROM customers c
                        WHERE c.id = $2
                          AND COALESCE(c.business_context, $3) = $3
                          AND c.lead_id IS NOT NULL
                        LIMIT 1
                   )
                   AND COALESCE(l.business_context, $3) = $3

                UNION ALL

                SELECT l.*, 2 AS match_priority
                  FROM lead_customer_links lcl
                  JOIN leads l ON l.id = lcl.lead_id
                 WHERE $2::integer IS NOT NULL
                   AND lcl.customer_id = $2
                   AND COALESCE(lcl.business_context, $3) = $3
                   AND COALESCE(l.business_context, $3) = $3
           ) lead_matches
          ORDER BY match_priority, id
          LIMIT 1`,
        [booking.id, booking.customer_id || null, businessContext]
    );
    return result.rows[0] || null;
}

async function loadCustomerById(db, customerId, businessContext) {
    const id = positiveInteger(customerId, 'customerId');
    if (!id) return null;
    const result = await db.query(
        `SELECT *
           FROM customers
          WHERE id = $1
            AND COALESCE(business_context, $2) = $2
          LIMIT 1`,
        [id, businessContext]
    );
    return result.rows[0] || null;
}

async function loadGroupForBooking(db, bookingId, businessContext) {
    const result = await db.query(
        `SELECT
            bgb.group_id,
            bgb.role AS group_role,
            bg.business_context AS group_business_context,
            bg.primary_booking_id,
            bg.customer_id AS group_customer_id,
            bg.date AS group_date,
            bg.group_name,
            bg.status AS group_status,
            bg.source AS group_source
           FROM banquet_group_bookings bgb
           JOIN banquet_groups bg ON bg.id = bgb.group_id
          WHERE bgb.booking_id = $1
            AND COALESCE(bgb.business_context, $2) = $2
            AND COALESCE(bg.business_context, $2) = $2
          ORDER BY CASE WHEN bgb.role = 'primary' THEN 0 ELSE 1 END, bgb.id
          LIMIT 1`,
        [bookingId, businessContext]
    );
    return result.rows[0] || null;
}

async function loadGroupById(db, groupId, businessContext) {
    const result = await db.query(
        `SELECT
            bg.id AS group_id,
            bg.business_context AS group_business_context,
            bg.primary_booking_id,
            bg.customer_id AS group_customer_id,
            bg.date AS group_date,
            bg.group_name,
            bg.status AS group_status,
            bg.source AS group_source
           FROM banquet_groups bg
          WHERE bg.id = $1
            AND COALESCE(bg.business_context, $2) = $2
          LIMIT 1`,
        [groupId, businessContext]
    );
    return result.rows[0] || null;
}

async function resolveDepositContextFromBooking(bookingIdInput, businessContextInput, options = {}) {
    const args = typeof bookingIdInput === 'object' && bookingIdInput !== null
        ? bookingIdInput
        : { bookingId: bookingIdInput, businessContext: businessContextInput };
    const bookingId = cleanText(args.bookingId || args.booking_id, 50);
    if (!bookingId) {
        return buildContext({
            businessContext: normalizeBusinessContext(args.businessContext || businessContextInput),
            reason: 'booking_id_missing'
        });
    }

    const businessContext = normalizeBusinessContext(args.businessContext || businessContextInput);
    const db = queryable(options);
    const booking = await loadBookingById(db, bookingId, businessContext, { forUpdate: options.forUpdate === true });
    if (!booking) {
        return buildContext({ businessContext, reason: 'booking_not_found' });
    }

    const group = await loadGroupForBooking(db, booking.id, businessContext);
    const lead = await loadLeadForBooking(db, booking, businessContext);
    const customer = await loadCustomerById(db, booking.customer_id, businessContext);
    return buildContext({ businessContext, lead, booking, customer, group });
}

async function resolveDepositContextFromLead(leadIdInput, businessContextInput, options = {}) {
    const args = typeof leadIdInput === 'object' && leadIdInput !== null
        ? leadIdInput
        : { leadId: leadIdInput, businessContext: businessContextInput };
    const leadId = positiveInteger(args.leadId || args.lead_id, 'leadId', { required: true });
    const businessContext = normalizeBusinessContext(args.businessContext || businessContextInput);
    const db = queryable(options);
    const lead = await loadLeadById(db, leadId, businessContext);
    if (!lead) {
        throw new BanquetDepositError('Lead not found', {
            status: 404,
            code: 'LEAD_NOT_FOUND',
            details: { leadId, businessContext }
        });
    }

    if (lead.booking_id) {
        const bookingContext = await resolveDepositContextFromBooking(
            { bookingId: lead.booking_id, businessContext },
            businessContext,
            options
        );
        return {
            ...bookingContext,
            lead: mapLeadRow(lead),
            leadId: lead.id,
            clientName: bookingContext.clientName || lead.client_name || null,
            eventDate: bookingContext.eventDate || dateOnlyFromRow(lead.event_date),
            needsBookingLink: !bookingContext.booking,
            reason: bookingContext.reason
        };
    }

    const customer = await loadCustomerForLead(db, lead.id, businessContext);
    return buildContext({
        businessContext,
        lead,
        customer,
        reason: 'lead_without_booking'
    });
}

function contextFromInput(input = {}) {
    return {
        businessContext: normalizeBusinessContext(input.businessContext || input.business_context),
        leadId: positiveInteger(input.leadId || input.lead_id, 'leadId'),
        bookingId: cleanText(input.bookingId || input.booking_id || input.primaryBookingId || input.primary_booking_id, 50),
        banquetGroupId: cleanText(input.banquetGroupId || input.banquet_group_id, 50),
        accountantTaskId: positiveInteger(input.accountantTaskId || input.accountant_task_id, 'accountantTaskId'),
        customerId: positiveInteger(input.customerId || input.customer_id, 'customerId')
    };
}

async function resolveContextForHandoff(input, db) {
    const base = contextFromInput(input);
    if (base.leadId) {
        return resolveDepositContextFromLead(
            { leadId: base.leadId, businessContext: base.businessContext },
            base.businessContext,
            { db, forUpdate: true }
        );
    }
    if (base.bookingId) {
        return resolveDepositContextFromBooking(
            { bookingId: base.bookingId, businessContext: base.businessContext },
            base.businessContext,
            { db, forUpdate: true }
        );
    }
    if (base.banquetGroupId) {
        const group = await loadGroupById(db, base.banquetGroupId, base.businessContext);
        return buildContext({
            businessContext: base.businessContext,
            group,
            reason: group ? null : 'group_not_found'
        });
    }
    throw new BanquetDepositError('leadId, bookingId, or banquetGroupId is required', {
        code: 'DEPOSIT_CONTEXT_REQUIRED'
    });
}

async function findDepositForContext(db, context = {}, { forUpdate = false, includeCancelled = false } = {}) {
    const businessContext = normalizeBusinessContext(context.businessContext);
    const params = [businessContext];
    const conditions = ['business_context = $1'];
    const identity = [];

    const addIdentity = (column, value) => {
        if (value === undefined || value === null || value === '') return;
        params.push(value);
        identity.push(`${column} = $${params.length}`);
    };

    addIdentity('id', context.depositId);
    addIdentity('accountant_task_id', context.accountantTaskId);
    addIdentity('lead_id', context.leadId || context.lead?.id);
    addIdentity('primary_booking_id', context.primaryBookingId || context.bookingId || context.booking?.id);
    addIdentity('banquet_group_id', context.banquetGroupId || context.group?.id);
    if (!identity.length) return null;
    conditions.push(`(${identity.join(' OR ')})`);
    if (!includeCancelled) conditions.push("status <> 'cancelled'");

    const result = await db.query(
        `SELECT *
           FROM banquet_deposits
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE status
                WHEN 'accountant_verified' THEN 0
                WHEN 'corrected' THEN 1
                WHEN 'manager_reported' THEN 2
                WHEN 'needs_booking_link' THEN 3
                ELSE 9
            END,
            updated_at DESC NULLS LAST,
            id DESC
          LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        params
    );
    return result.rows[0] || null;
}

function sourcePayloadForHandoff(input = {}, context = {}) {
    const original = jsonObject(input.sourcePayload || input.source_payload);
    return {
        source: input.source || 'banquetDeposits.createOrLoadDepositHandoff',
        sourceKind: input.sourceKind || input.source_kind || 'manager_handoff',
        businessContext: context.businessContext,
        leadId: context.leadId || null,
        bookingId: context.primaryBookingId || context.bookingId || null,
        banquetGroupId: context.banquetGroupId || null,
        original
    };
}

function metaForHandoff(input = {}, context = {}) {
    return {
        ...jsonObject(input.meta),
        context: {
            reason: context.reason || null,
            needsBookingLink: context.needsBookingLink === true,
            leadId: context.leadId || null,
            bookingId: context.primaryBookingId || context.bookingId || null,
            banquetGroupId: context.banquetGroupId || null,
            customerId: context.customerId || null
        }
    };
}

function firstProvided(source = {}, ...keys) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source || {}, key)) return source[key];
    }
    return undefined;
}

function depositPayloadFromInput(input = {}) {
    const payload = firstProvided(input, 'deposit', 'banquetDeposit', 'bookingDeposit', 'depositData');
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

function normalizeManagerDepositPayload(input = {}) {
    const payload = depositPayloadFromInput(input);
    if (!payload) return { provided: false };

    const rawStatus = firstProvided(payload, 'managerStatus', 'manager_status', 'status');
    const managerStatus = normalizeManagerStatus(rawStatus, DEFAULT_MANAGER_DEPOSIT_STATUS);
    const expectedAmount = normalizeAmount(
        firstProvided(payload, 'expectedAmount', 'expected_amount', 'amount', 'depositAmount', 'deposit_amount'),
        { required: false, allowZero: true }
    );
    const dueDate = normalizeDateOnly(firstProvided(payload, 'dueDate', 'due_date'), 'dueDate');
    const managerNote = cleanText(firstProvided(payload, 'managerNote', 'manager_note', 'note', 'comment'), 1000);
    const explicitlyEnabled = payload.enabled === true || payload.provided === true || payload.hasDeposit === true;
    const provided = explicitlyEnabled
        || expectedAmount !== null
        || Boolean(dueDate)
        || Boolean(managerNote)
        || (rawStatus !== undefined && managerStatus !== DEFAULT_MANAGER_DEPOSIT_STATUS);

    return {
        provided,
        expectedAmount,
        managerStatus,
        dueDate,
        managerNote,
        sourcePayload: jsonObject(payload.sourcePayload || payload.source_payload),
        raw: payload
    };
}

function managerSourcePayload(input = {}, context = {}, payload = {}) {
    return {
        ...jsonObject(input.sourcePayload || input.source_payload),
        managerBookingForm: {
            source: input.source || 'banquetDeposits.upsertManagerBookingDeposit',
            businessContext: context.businessContext,
            bookingId: context.primaryBookingId || context.bookingId || null,
            banquetGroupId: context.banquetGroupId || null,
            updatedAt: new Date().toISOString(),
            sourcePayload: payload.sourcePayload || null
        }
    };
}

function managerMeta(input = {}, context = {}, payload = {}) {
    return {
        ...jsonObject(input.meta),
        managerBookingForm: {
            bookingId: context.primaryBookingId || context.bookingId || null,
            banquetGroupId: context.banquetGroupId || null,
            managerStatus: payload.managerStatus,
            dueDate: payload.dueDate || null
        }
    };
}

async function upsertManagerBookingDeposit(input = {}, options = {}) {
    return withTransaction(options, async db => {
        const payload = normalizeManagerDepositPayload(input);
        if (!payload.provided) {
            return { skipped: true, reason: 'deposit_payload_absent', deposit: null, projection: null };
        }

        const bookingId = cleanText(input.bookingId || input.booking_id || input.primaryBookingId || input.primary_booking_id, 80);
        if (!bookingId) {
            throw new BanquetDepositError('bookingId is required', {
                code: 'VALIDATION_BOOKING_REQUIRED',
                details: { field: 'bookingId' }
            });
        }
        const businessContext = normalizeBusinessContext(input.businessContext || input.business_context);
        const context = await resolveDepositContextFromBooking(
            { bookingId, businessContext },
            businessContext,
            { db, forUpdate: false }
        );
        const actorId = actorUserId(input.managerReportedBy || input.manager_reported_by || input.actor || input.user);
        const now = new Date().toISOString();
        const sourcePayload = managerSourcePayload(input, context, payload);
        const meta = managerMeta(input, context, payload);
        const legacyStatus = context.needsBookingLink ? 'needs_booking_link' : 'manager_reported';
        const existing = await findDepositForContext(db, context, { forUpdate: true, includeCancelled: false });

        if (existing) {
            const current = mapDepositRow(existing);
            const result = await db.query(
                `UPDATE banquet_deposits
                    SET expected_amount = $1,
                        amount = CASE
                            WHEN paid_amount IS NULL
                             AND payment_method IS NULL
                             AND verified_at IS NULL
                             AND verified_by IS NULL THEN $1
                            ELSE amount
                        END,
                        manager_status = $2,
                        due_date = $3::date,
                        manager_note = $4,
                        status = CASE
                            WHEN status IN ('manager_reported', 'needs_booking_link') THEN $5
                            ELSE status
                        END,
                        client_name_snapshot = COALESCE($6, client_name_snapshot),
                        event_date = COALESCE($7::date, event_date),
                        banquet_number_snapshot = COALESCE($8, banquet_number_snapshot),
                        source_kind = COALESCE(source_kind, 'manager_booking_form'),
                        source_payload = $9::jsonb,
                        manager_reported_at = $10,
                        manager_reported_by = COALESCE($11, manager_reported_by),
                        meta = $12::jsonb,
                        updated_at = NOW()
                  WHERE id = $13
                    AND business_context = $14
                  RETURNING *`,
                [
                    payload.expectedAmount,
                    payload.managerStatus,
                    payload.dueDate,
                    payload.managerNote,
                    legacyStatus,
                    cleanText(context.clientName, 500),
                    normalizeDateOnly(context.eventDate, 'eventDate'),
                    cleanText(context.banquetNumber, 100),
                    JSON.stringify({
                        ...jsonObject(current.sourcePayload),
                        ...sourcePayload
                    }),
                    now,
                    actorId,
                    JSON.stringify({
                        ...jsonObject(current.meta),
                        ...meta
                    }),
                    current.id,
                    businessContext
                ]
            );
            const row = result.rows[0];
            return {
                created: false,
                skipped: false,
                deposit: mapDepositRow(row),
                projection: depositProjection(row, context),
                context
            };
        }

        const result = await db.query(
            `INSERT INTO banquet_deposits (
                business_context,
                banquet_group_id,
                primary_booking_id,
                lead_id,
                customer_id,
                client_name_snapshot,
                event_date,
                banquet_number_snapshot,
                amount,
                expected_amount,
                manager_status,
                accounting_status,
                due_date,
                manager_note,
                status,
                source_kind,
                source_payload,
                manager_reported_at,
                manager_reported_by,
                meta
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12::date,$13,$14,$15,$16::jsonb,$17,$18,$19::jsonb)
             RETURNING *`,
            [
                context.businessContext,
                context.banquetGroupId,
                context.primaryBookingId || bookingId,
                context.leadId,
                context.customerId,
                cleanText(context.clientName, 500),
                normalizeDateOnly(context.eventDate, 'eventDate'),
                cleanText(context.banquetNumber, 100),
                payload.expectedAmount,
                payload.managerStatus,
                DEFAULT_ACCOUNTING_DEPOSIT_STATUS,
                payload.dueDate,
                payload.managerNote,
                legacyStatus,
                'manager_booking_form',
                JSON.stringify(sourcePayload),
                now,
                actorId,
                JSON.stringify(meta)
            ]
        );
        const row = result.rows[0];
        return {
            created: true,
            skipped: false,
            deposit: mapDepositRow(row),
            projection: depositProjection(row, context),
            context
        };
    });
}

async function createOrLoadDepositHandoff(input = {}, options = {}) {
    return withTransaction(options, async db => {
        const context = await resolveContextForHandoff(input, db);
        const contextIdentity = {
            ...context,
            accountantTaskId: positiveInteger(input.accountantTaskId || input.accountant_task_id, 'accountantTaskId')
        };
        const existing = await findDepositForContext(db, contextIdentity, { forUpdate: true });
        if (existing) {
            return {
                created: false,
                deposit: mapDepositRow(existing),
                projection: depositProjection(existing, context),
                context
            };
        }

        const amount = normalizeAmount(input.amount, { required: false });
        const paymentMethod = normalizePaymentMethod(input.paymentMethod || input.payment_method, { required: false });
        const managerReportedBy = actorUserId(input.managerReportedBy || input.manager_reported_by || input.actor || input.user);
        const managerReportedAt = normalizeTimestamp(input.managerReportedAt || input.manager_reported_at) || new Date().toISOString();
        const eventDate = normalizeDateOnly(input.eventDate || input.event_date || context.eventDate, 'eventDate');
        const sourceKind = cleanText(input.sourceKind || input.source_kind, 64) || 'manager_handoff';
        const status = context.needsBookingLink ? 'needs_booking_link' : normalizeStatus(input.status, 'manager_reported');
        const sourcePayload = sourcePayloadForHandoff(input, context);
        const meta = metaForHandoff(input, context);

        const result = await db.query(
            `INSERT INTO banquet_deposits (
                business_context,
                banquet_group_id,
                primary_booking_id,
                lead_id,
                customer_id,
                accountant_task_id,
                client_name_snapshot,
                event_date,
                banquet_number_snapshot,
                amount,
                payment_method,
                status,
                source_kind,
                source_payload,
                manager_reported_at,
                manager_reported_by,
                meta
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb)
             RETURNING *`,
            [
                context.businessContext,
                context.banquetGroupId,
                context.primaryBookingId,
                context.leadId,
                context.customerId,
                contextIdentity.accountantTaskId,
                cleanText(input.clientNameSnapshot || input.client_name_snapshot || context.clientName, 500),
                eventDate,
                cleanText(input.banquetNumberSnapshot || input.banquet_number_snapshot || context.banquetNumber, 100),
                amount,
                paymentMethod,
                status,
                sourceKind,
                JSON.stringify(sourcePayload),
                managerReportedAt,
                managerReportedBy,
                JSON.stringify(meta)
            ]
        );
        const row = result.rows[0];
        return {
            created: true,
            deposit: mapDepositRow(row),
            projection: depositProjection(row, context),
            context
        };
    });
}

async function loadDepositForConfirmation(db, input, businessContext) {
    const depositId = positiveInteger(input.depositId || input.id, 'depositId');
    if (depositId) {
        const result = await db.query(
            `SELECT *
               FROM banquet_deposits
              WHERE id = $1
                AND business_context = $2
              LIMIT 1
              FOR UPDATE`,
            [depositId, businessContext]
        );
        return result.rows[0] || null;
    }
    const context = contextFromInput({ ...input, businessContext });
    return findDepositForContext(db, context, { forUpdate: true, includeCancelled: false });
}

async function confirmDeposit(input = {}, options = {}) {
    return withTransaction(options, async db => {
        const businessContext = normalizeBusinessContext(input.businessContext || input.business_context);
        const row = await loadDepositForConfirmation(db, input, businessContext);
        if (!row) {
            throw new BanquetDepositError('Deposit handoff not found', {
                status: 404,
                code: 'DEPOSIT_NOT_FOUND'
            });
        }

        const current = mapDepositRow(row);
        const amount = normalizeAmount(input.paidAmount ?? input.paid_amount ?? input.amount, { required: true, allowZero: false });
        const paymentMethod = normalizePaymentMethod(input.paymentMethod || input.payment_method, { required: true });
        const receivedDate = normalizeDateOnly(input.receivedDate || input.received_date || input.depositReceivedDate || input.deposit_received_date, 'receivedDate');
        const verifiedAt = normalizeTimestamp(
            input.verifiedAt || input.verified_at || input.receivedAt || input.received_at || receivedDate
        ) || new Date().toISOString();
        const actorId = actorUserId(input.verifiedBy || input.verified_by || input.actor || input.user);
        const eventDate = normalizeDateOnly(input.eventDate || input.event_date || current.eventDate, 'eventDate');
        const clientName = cleanText(input.clientNameSnapshot || input.client_name_snapshot || current.clientNameSnapshot, 500);
        const banquetNumber = cleanText(input.banquetNumberSnapshot || input.banquet_number_snapshot || current.banquetNumberSnapshot, 100);
        const sourcePayload = {
            ...jsonObject(current.sourcePayload),
            accountantConfirmation: {
                source: 'banquetDeposits.confirmDeposit',
                receivedDate,
                verifiedAt,
                sourcePayload: jsonObject(input.sourcePayload || input.source_payload)
            }
        };
        const meta = {
            ...jsonObject(current.meta),
            accountantConfirmation: {
                receivedDate,
                verifiedAt,
                note: cleanText(input.note || input.comment, 500)
            }
        };
        const hasBookingLink = Boolean(current.primaryBookingId);
        const changedAfterVerification = current.status === 'accountant_verified'
            || current.status === 'corrected';
        const nextStatus = hasBookingLink
            ? (changedAfterVerification ? 'corrected' : 'accountant_verified')
            : 'needs_booking_link';

        const result = await db.query(
            `UPDATE banquet_deposits
                SET amount = $1,
                    paid_amount = $1,
                    expected_amount = COALESCE(expected_amount, $1),
                    payment_method = $2,
                    status = $3,
                    accounting_status = $13,
                    accounting_note = COALESCE($14, accounting_note),
                    client_name_snapshot = COALESCE($4, client_name_snapshot),
                    event_date = COALESCE($5::date, event_date),
                    banquet_number_snapshot = COALESCE($6, banquet_number_snapshot),
                    source_payload = $7::jsonb,
                    verified_at = COALESCE(verified_at, $8),
                    verified_by = COALESCE(verified_by, $9),
                    corrected_at = CASE WHEN $3 = 'corrected' THEN $8 ELSE corrected_at END,
                    corrected_by = CASE WHEN $3 = 'corrected' THEN $9 ELSE corrected_by END,
                    meta = $10::jsonb,
                    updated_at = NOW()
              WHERE id = $11
                AND business_context = $12
              RETURNING *`,
            [
                amount,
                paymentMethod,
                nextStatus,
                clientName,
                eventDate,
                banquetNumber,
                JSON.stringify(sourcePayload),
                verifiedAt,
                actorId,
                JSON.stringify(meta),
                current.id,
                businessContext,
                'Підтверджено',
                cleanText(input.accountingNote || input.accounting_note || input.note || input.comment, 1000)
            ]
        );
        const updated = result.rows[0];
        return {
            deposit: mapDepositRow(updated),
            projection: depositProjection(updated, {
                businessContext,
                clientName,
                eventDate,
                banquetNumber,
                needsBookingLink: updated.status === 'needs_booking_link'
            })
        };
    });
}

function patchValueProvided(input, ...keys) {
    return keys.some(key => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined);
}

async function patchDeposit(input = {}, options = {}) {
    return withTransaction(options, async db => {
        const depositId = positiveInteger(input.depositId || input.id, 'depositId', { required: true });
        const businessContext = normalizeBusinessContext(input.businessContext || input.business_context);
        const currentResult = await db.query(
            `SELECT *
               FROM banquet_deposits
              WHERE id = $1
                AND business_context = $2
              LIMIT 1
              FOR UPDATE`,
            [depositId, businessContext]
        );
        if (!currentResult.rows.length) {
            throw new BanquetDepositError('Deposit handoff not found', {
                status: 404,
                code: 'DEPOSIT_NOT_FOUND'
            });
        }

        const current = mapDepositRow(currentResult.rows[0]);
        const updates = {};
        if (patchValueProvided(input, 'clientNameSnapshot', 'client_name_snapshot')) {
            const value = cleanText(input.clientNameSnapshot ?? input.client_name_snapshot, 500);
            if (!value) {
                throw new BanquetDepositError('clientNameSnapshot cannot be empty', {
                    code: 'VALIDATION_CLIENT_NAME_REQUIRED',
                    details: { field: 'clientNameSnapshot' }
                });
            }
            updates.clientNameSnapshot = value;
        }
        if (patchValueProvided(input, 'eventDate', 'event_date')) {
            updates.eventDate = normalizeDateOnly(input.eventDate ?? input.event_date, 'eventDate');
        }
        if (patchValueProvided(input, 'banquetNumberSnapshot', 'banquet_number_snapshot')) {
            const value = cleanText(input.banquetNumberSnapshot ?? input.banquet_number_snapshot, 100);
            if (!value) {
                throw new BanquetDepositError('banquetNumberSnapshot cannot be empty', {
                    code: 'VALIDATION_BANQUET_NUMBER_REQUIRED',
                    details: { field: 'banquetNumberSnapshot' }
                });
            }
            updates.banquetNumberSnapshot = value;
        }
        if (patchValueProvided(input, 'amount')) {
            updates.amount = normalizeAmount(input.amount, { required: false, allowZero: true });
        }
        if (patchValueProvided(input, 'paymentMethod', 'payment_method')) {
            updates.paymentMethod = normalizePaymentMethod(input.paymentMethod ?? input.payment_method, { required: false });
        }
        if (patchValueProvided(input, 'status')) {
            updates.status = normalizeStatus(input.status, current.status);
        }
        if (patchValueProvided(input, 'accountantTaskId', 'accountant_task_id')) {
            updates.accountantTaskId = positiveInteger(input.accountantTaskId ?? input.accountant_task_id, 'accountantTaskId');
        }

        const editableKeys = Object.keys(updates);
        if (!editableKeys.length && !input.meta && !input.sourcePayload && !input.source_payload) {
            throw new BanquetDepositError('No supported deposit fields to update', {
                code: 'VALIDATION_EMPTY_PATCH'
            });
        }

        const actorId = actorUserId(input.correctedBy || input.corrected_by || input.actor || input.user);
        const now = new Date().toISOString();
        const sourcePayload = {
            ...jsonObject(current.sourcePayload),
            lastApiPatch: {
                source: 'banquetDeposits.patchDeposit',
                actorUserId: actorId,
                patchedAt: now,
                fields: editableKeys,
                sourcePayload: jsonObject(input.sourcePayload || input.source_payload)
            }
        };
        const meta = {
            ...jsonObject(current.meta),
            ...jsonObject(input.meta),
            lastApiPatch: {
                actorUserId: actorId,
                patchedAt: now,
                fields: editableKeys,
                note: cleanText(input.note || input.comment, 500)
            }
        };

        const result = await db.query(
            `UPDATE banquet_deposits
                SET client_name_snapshot = COALESCE($1, client_name_snapshot),
                    event_date = COALESCE($2::date, event_date),
                    banquet_number_snapshot = COALESCE($3, banquet_number_snapshot),
                    amount = COALESCE($4, amount),
                    payment_method = COALESCE($5, payment_method),
                    status = COALESCE($6, status),
                    accountant_task_id = COALESCE($7, accountant_task_id),
                    source_payload = $8::jsonb,
                    meta = $9::jsonb,
                    corrected_at = CASE WHEN $10::integer IS NOT NULL THEN $11 ELSE corrected_at END,
                    corrected_by = COALESCE($10, corrected_by),
                    updated_at = NOW()
              WHERE id = $12
                AND business_context = $13
              RETURNING *`,
            [
                updates.clientNameSnapshot ?? null,
                updates.eventDate ?? null,
                updates.banquetNumberSnapshot ?? null,
                updates.amount ?? null,
                updates.paymentMethod ?? null,
                updates.status ?? null,
                updates.accountantTaskId ?? null,
                JSON.stringify(sourcePayload),
                JSON.stringify(meta),
                actorId,
                now,
                current.id,
                businessContext
            ]
        );
        const updated = result.rows[0];
        return {
            deposit: mapDepositRow(updated),
            projection: depositProjection(updated, {
                businessContext,
                clientName: updates.clientNameSnapshot || current.clientNameSnapshot,
                eventDate: updates.eventDate || current.eventDate,
                banquetNumber: updates.banquetNumberSnapshot || current.banquetNumberSnapshot,
                needsBookingLink: updated.status === 'needs_booking_link'
            })
        };
    });
}

async function listDepositsForAccounting(input = {}, options = {}) {
    const businessContext = normalizeBusinessContext(input.businessContext || input.business_context);
    const rawStatus = cleanText(input.accountingStatus || input.accounting_status || input.status, 64);
    const accountingStatus = rawStatus && rawStatus !== 'all'
        ? normalizeAccountingStatus(rawStatus, DEFAULT_ACCOUNTING_DEPOSIT_STATUS)
        : null;
    const db = queryable(options);
    const params = [businessContext];
    const conditions = [
        'business_context = $1',
        "NOT (status = 'cancelled' AND accounting_status = $2)"
    ];
    params.push(DEFAULT_ACCOUNTING_DEPOSIT_STATUS);
    if (accountingStatus) {
        params.push(accountingStatus);
        conditions.push(`accounting_status = $${params.length}`);
    }
    const result = await db.query(
        `SELECT *
           FROM banquet_deposits
          WHERE ${conditions.join(' AND ')}
          ORDER BY
            CASE accounting_status
                WHEN 'Не перевірено' THEN 0
                WHEN 'На перевірці' THEN 1
                WHEN 'Сума не збігається' THEN 2
                WHEN 'Оплату не знайдено' THEN 3
                WHEN 'Підтверджено' THEN 4
                WHEN 'Скасовано / повернено' THEN 5
                ELSE 9
            END,
            COALESCE(due_date, event_date) ASC NULLS LAST,
            updated_at DESC NULLS LAST,
            id DESC
          LIMIT 200`,
        params
    );
    return {
        businessContext,
        accountingStatus,
        count: result.rows.length,
        deposits: result.rows.map(row => depositProjection(row, {
            businessContext,
            bookingId: row.primary_booking_id || null,
            banquetGroupId: row.banquet_group_id || null,
            customerId: row.customer_id || null
        }))
    };
}

async function markDepositReviewStarted(input = {}, options = {}) {
    return withTransaction(options, async db => {
        const depositId = positiveInteger(input.depositId || input.id, 'depositId', { required: true });
        const businessContext = normalizeBusinessContext(input.businessContext || input.business_context);
        const actorId = actorUserId(input.reviewStartedBy || input.review_started_by || input.actor || input.user);
        const currentResult = await db.query(
            `SELECT *
               FROM banquet_deposits
              WHERE id = $1
                AND business_context = $2
              LIMIT 1
              FOR UPDATE`,
            [depositId, businessContext]
        );
        if (!currentResult.rows.length) {
            throw new BanquetDepositError('Deposit handoff not found', {
                status: 404,
                code: 'DEPOSIT_NOT_FOUND'
            });
        }
        const current = mapDepositRow(currentResult.rows[0]);
        if (isFinalAccountingStatus(current.accountingStatus)) {
            return {
                changed: false,
                deposit: current,
                projection: depositProjection(currentResult.rows[0], {
                    businessContext,
                    bookingId: current.primaryBookingId,
                    banquetGroupId: current.banquetGroupId,
                    customerId: current.customerId
                })
            };
        }

        const now = new Date().toISOString();
        const result = await db.query(
            `UPDATE banquet_deposits
                SET accounting_status = $1,
                    review_started_at = COALESCE(review_started_at, $2),
                    review_started_by = COALESCE(review_started_by, $3),
                    updated_at = NOW()
              WHERE id = $4
                AND business_context = $5
              RETURNING *`,
            ['На перевірці', now, actorId, current.id, businessContext]
        );
        const row = result.rows[0];
        return {
            changed: current.accountingStatus !== 'На перевірці',
            deposit: mapDepositRow(row),
            projection: depositProjection(row, {
                businessContext,
                bookingId: row.primary_booking_id || null,
                banquetGroupId: row.banquet_group_id || null,
                customerId: row.customer_id || null
            })
        };
    });
}

async function verifyDepositAccounting(input = {}, options = {}) {
    return withTransaction(options, async db => {
        const depositId = positiveInteger(input.depositId || input.id, 'depositId', { required: true });
        const businessContext = normalizeBusinessContext(input.businessContext || input.business_context);
        const accountingStatus = normalizeFinalAccountingStatus(input.accountingStatus || input.accounting_status || input.status);
        const paidAmount = normalizeAmount(input.paidAmount ?? input.paid_amount ?? input.amount, {
            required: accountingStatus === 'Підтверджено',
            allowZero: accountingStatus !== 'Підтверджено'
        });
        const paymentMethod = normalizePaymentMethod(input.paymentMethod || input.payment_method, { required: false });
        const accountingNote = cleanText(input.accountingNote || input.accounting_note || input.note || input.comment, 1000);
        const actorId = actorUserId(input.verifiedBy || input.verified_by || input.actor || input.user);
        const now = normalizeTimestamp(input.verifiedAt || input.verified_at) || new Date().toISOString();
        const currentResult = await db.query(
            `SELECT *
               FROM banquet_deposits
              WHERE id = $1
                AND business_context = $2
              LIMIT 1
              FOR UPDATE`,
            [depositId, businessContext]
        );
        if (!currentResult.rows.length) {
            throw new BanquetDepositError('Deposit handoff not found', {
                status: 404,
                code: 'DEPOSIT_NOT_FOUND'
            });
        }

        const current = mapDepositRow(currentResult.rows[0]);
        const legacyStatus = legacyStatusForAccountingStatus(accountingStatus, current.status);
        const sourcePayload = {
            ...jsonObject(current.sourcePayload),
            accountingReview: {
                source: 'banquetDeposits.verifyDepositAccounting',
                accountingStatus,
                verifiedAt: now,
                sourcePayload: jsonObject(input.sourcePayload || input.source_payload)
            }
        };
        const meta = {
            ...jsonObject(current.meta),
            accountingReview: {
                accountingStatus,
                paidAmount,
                verifiedAt: now,
                note: accountingNote
            }
        };
        const result = await db.query(
            `UPDATE banquet_deposits
                SET paid_amount = $1,
                    amount = COALESCE($1, expected_amount, amount),
                    payment_method = COALESCE($2, payment_method),
                    status = $3,
                    accounting_status = $4,
                    accounting_note = $5,
                    source_payload = $6::jsonb,
                    verified_at = $7,
                    verified_by = COALESCE($8, verified_by),
                    corrected_at = CASE WHEN $3 = 'corrected' THEN $7 ELSE corrected_at END,
                    corrected_by = CASE WHEN $3 = 'corrected' THEN COALESCE($8, corrected_by) ELSE corrected_by END,
                    meta = $9::jsonb,
                    updated_at = NOW()
              WHERE id = $10
                AND business_context = $11
              RETURNING *`,
            [
                paidAmount,
                paymentMethod,
                legacyStatus,
                accountingStatus,
                accountingNote,
                JSON.stringify(sourcePayload),
                now,
                actorId,
                JSON.stringify(meta),
                current.id,
                businessContext
            ]
        );
        const row = result.rows[0];
        return {
            deposit: mapDepositRow(row),
            projection: depositProjection(row, {
                businessContext,
                bookingId: row.primary_booking_id || null,
                banquetGroupId: row.banquet_group_id || null,
                customerId: row.customer_id || null,
                needsBookingLink: row.status === 'needs_booking_link'
            })
        };
    });
}

async function attachAccountantTask(input = {}, options = {}) {
    return withTransaction(options, async db => {
        const depositId = positiveInteger(input.depositId || input.id, 'depositId', { required: true });
        const taskId = positiveInteger(input.accountantTaskId || input.accountant_task_id || input.taskId || input.task_id, 'accountantTaskId', { required: true });
        const businessContext = normalizeBusinessContext(input.businessContext || input.business_context);
        const currentResult = await db.query(
            `SELECT *
               FROM banquet_deposits
              WHERE id = $1
                AND business_context = $2
              LIMIT 1
              FOR UPDATE`,
            [depositId, businessContext]
        );
        if (!currentResult.rows.length) {
            throw new BanquetDepositError('Deposit handoff not found', {
                status: 404,
                code: 'DEPOSIT_NOT_FOUND'
            });
        }

        const current = mapDepositRow(currentResult.rows[0]);
        if (Number(current.accountantTaskId) === Number(taskId)) {
            return {
                deposit: current,
                projection: depositProjection(currentResult.rows[0], {
                    businessContext,
                    clientName: current.clientNameSnapshot,
                    eventDate: current.eventDate,
                    banquetNumber: current.banquetNumberSnapshot,
                    needsBookingLink: current.status === 'needs_booking_link'
                })
            };
        }

        const now = new Date().toISOString();
        const sourcePayload = {
            ...jsonObject(current.sourcePayload),
            accountantTask: {
                source: 'banquetDeposits.attachAccountantTask',
                taskId,
                linkedAt: now,
                sourcePayload: jsonObject(input.sourcePayload || input.source_payload)
            }
        };
        const meta = {
            ...jsonObject(current.meta),
            ...jsonObject(input.meta),
            accountantTask: {
                taskId,
                linkedAt: now
            }
        };

        const result = await db.query(
            `UPDATE banquet_deposits
                SET accountant_task_id = $1,
                    source_payload = $2::jsonb,
                    meta = $3::jsonb,
                    updated_at = NOW()
              WHERE id = $4
                AND business_context = $5
              RETURNING *`,
            [
                taskId,
                JSON.stringify(sourcePayload),
                JSON.stringify(meta),
                current.id,
                businessContext
            ]
        );
        const updated = result.rows[0];
        return {
            deposit: mapDepositRow(updated),
            projection: depositProjection(updated, {
                businessContext,
                clientName: updated.client_name_snapshot,
                eventDate: dateOnlyFromRow(updated.event_date),
                banquetNumber: updated.banquet_number_snapshot,
                needsBookingLink: updated.status === 'needs_booking_link'
            })
        };
    });
}

async function getDepositProjectionForBooking(bookingIdInput, businessContextInput, options = {}) {
    const context = await resolveDepositContextFromBooking(bookingIdInput, businessContextInput, options);
    const db = queryable(options);
    const row = await findDepositForContext(db, context, { includeCancelled: true });
    return depositProjection(row, context);
}

async function getDepositProjectionForGroup(groupIdInput, businessContextInput, options = {}) {
    const args = typeof groupIdInput === 'object' && groupIdInput !== null
        ? groupIdInput
        : { groupId: groupIdInput, businessContext: businessContextInput };
    const groupId = cleanText(args.groupId || args.group_id, 50);
    const businessContext = normalizeBusinessContext(args.businessContext || businessContextInput);
    const db = queryable(options);
    const group = groupId ? await loadGroupById(db, groupId, businessContext) : null;
    const context = buildContext({
        businessContext,
        group,
        reason: group ? null : 'group_not_found'
    });
    const row = await findDepositForContext(db, {
        ...context,
        banquetGroupId: groupId || context.banquetGroupId
    }, { includeCancelled: true });
    return depositProjection(row, {
        ...context,
        banquetGroupId: groupId || context.banquetGroupId,
        needsBookingLink: !group?.primary_booking_id
    });
}

async function getDepositProjectionForKnownContext(input = {}, options = {}) {
    const context = {
        businessContext: normalizeBusinessContext(input.businessContext || input.business_context),
        primaryBookingId: cleanText(
            input.primaryBookingId || input.primary_booking_id || input.bookingId || input.booking_id,
            50
        ),
        bookingId: cleanText(input.bookingId || input.booking_id, 50),
        banquetGroupId: cleanText(input.banquetGroupId || input.banquet_group_id, 50),
        customerId: positiveInteger(input.customerId || input.customer_id, 'customerId'),
        eventDate: normalizeDateOnly(input.eventDate || input.event_date),
        clientName: cleanText(input.clientName || input.client_name, 200) || null,
        banquetNumber: cleanText(input.banquetNumber || input.banquet_number, 100) || null,
        needsBookingLink: input.needsBookingLink === true
    };
    const db = queryable(options);
    const row = await findDepositForContext(db, context, { includeCancelled: true });
    return depositProjection(row, context);
}

async function getDepositProjectionById(depositIdInput, businessContextInput, options = {}) {
    const depositId = positiveInteger(
        typeof depositIdInput === 'object' && depositIdInput !== null
            ? (depositIdInput.depositId || depositIdInput.id)
            : depositIdInput,
        'depositId',
        { required: true }
    );
    const businessContext = normalizeBusinessContext(
        typeof depositIdInput === 'object' && depositIdInput !== null
            ? (depositIdInput.businessContext || depositIdInput.business_context || businessContextInput)
            : businessContextInput
    );
    const db = queryable(options);
    const result = await db.query(
        `SELECT *
           FROM banquet_deposits
          WHERE id = $1
            AND business_context = $2
          LIMIT 1`,
        [depositId, businessContext]
    );
    const row = result.rows[0] || null;
    if (!row) {
        throw new BanquetDepositError('Deposit handoff not found', {
            status: 404,
            code: 'DEPOSIT_NOT_FOUND',
            details: { depositId, businessContext }
        });
    }
    return depositProjection(row, {
        businessContext,
        leadId: row.lead_id || null,
        bookingId: row.primary_booking_id || null,
        banquetGroupId: row.banquet_group_id || null,
        customerId: row.customer_id || null,
        needsBookingLink: row.status === 'needs_booking_link'
    });
}

module.exports = {
    attachAccountantTask,
    BanquetDepositError,
    confirmDeposit,
    createOrLoadDepositHandoff,
    getDepositProjectionById,
    getDepositProjectionForBooking,
    getDepositProjectionForGroup,
    getDepositProjectionForKnownContext,
    listDepositsForAccounting,
    markDepositReviewStarted,
    patchDeposit,
    resolveDepositContextFromBooking,
    resolveDepositContextFromLead,
    upsertManagerBookingDeposit,
    verifyDepositAccounting
};
