'use strict';

const {
    DEFAULT_BUSINESS_CONTEXT,
    normalizeBusinessContext
} = require('./businessContext');
const { createLogger } = require('../utils/logger');

const BOOKING_FINANCE_CATEGORY = 'Бронювання';
const BOOKING_FINANCE_SAVEPOINT = 'booking_finance_optional_step';
const PARK_BUSINESS_CONTEXT_ALIASES = new Set([
    DEFAULT_BUSINESS_CONTEXT,
    'park',
    'park_zakrevsky',
    'pzp'
]);
const log = createLogger('BookingFinanceSync');

class BookingFinanceSyncError extends Error {
    constructor(message, code, details = null) {
        super(message);
        this.name = 'BookingFinanceSyncError';
        this.code = code || 'BOOKING_FINANCE_SYNC_ERROR';
        this.details = details;
    }
}

function firstValue(source, ...keys) {
    for (const key of keys) {
        if (source?.[key] !== undefined && source?.[key] !== null) {
            return source[key];
        }
    }
    return null;
}

function cleanText(value, maxLength = 500) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text.slice(0, maxLength) : null;
}

function firstCleanText(source, keys, maxLength) {
    for (const key of keys) {
        const text = cleanText(source?.[key], maxLength);
        if (text) return text;
    }
    return null;
}

function bookingFinanceEligibility(booking = {}, options = {}) {
    const rawContext = firstValue(
        options,
        'businessContext',
        'business_context'
    ) || firstValue(
        booking,
        'businessContext',
        'business_context'
    ) || DEFAULT_BUSINESS_CONTEXT;
    const rawContextKey = String(rawContext || '').trim().toLowerCase();
    const businessContext = normalizeBusinessContext(rawContext);
    const bookingId = firstCleanText(booking, ['id', 'bookingId', 'booking_id'], 50);
    const linkedTo = firstCleanText(booking, ['linkedTo', 'linked_to'], 50);
    const status = firstCleanText(booking, ['status'], 50)?.toLowerCase() || null;
    const amount = Number(firstValue(booking, 'price', 'amount') || 0);

    if (
        businessContext !== DEFAULT_BUSINESS_CONTEXT
        || !PARK_BUSINESS_CONTEXT_ALIASES.has(rawContextKey)
    ) {
        return {
            eligible: false,
            reason: 'business_context_not_supported',
            businessContext,
            bookingId
        };
    }
    if (linkedTo) {
        return {
            eligible: false,
            reason: 'linked_booking',
            businessContext,
            bookingId
        };
    }
    if (status === 'preliminary' || status === 'cancelled') {
        return {
            eligible: false,
            reason: status === 'cancelled' ? 'cancelled_booking' : 'preliminary_booking',
            businessContext,
            bookingId,
            removeExisting: true
        };
    }
    if (!Number.isFinite(amount) || amount < 0) {
        return {
            eligible: false,
            reason: 'invalid_amount',
            businessContext,
            bookingId
        };
    }
    if (amount === 0) {
        return {
            eligible: false,
            reason: 'zero_amount',
            businessContext,
            bookingId,
            removeExisting: true
        };
    }

    return {
        eligible: true,
        reason: null,
        businessContext,
        bookingId,
        amount
    };
}

function buildBookingFinanceRecord(booking = {}, options = {}, eligibility = bookingFinanceEligibility(booking, options)) {
    if (!eligibility.eligible) return null;
    if (!eligibility.bookingId) {
        throw new BookingFinanceSyncError(
            'Booking id is required for finance synchronization',
            'BOOKING_FINANCE_BOOKING_ID_REQUIRED'
        );
    }
    if (!Number.isSafeInteger(eligibility.amount)) {
        throw new BookingFinanceSyncError(
            'Booking finance amount must be a positive integer',
            'BOOKING_FINANCE_AMOUNT_INVALID',
            { bookingId: eligibility.bookingId, amount: eligibility.amount }
        );
    }

    const date = firstCleanText(booking, ['date'], 20);
    if (!date) {
        throw new BookingFinanceSyncError(
            'Booking date is required for finance synchronization',
            'BOOKING_FINANCE_DATE_REQUIRED',
            { bookingId: eligibility.bookingId }
        );
    }

    const bookingName = firstCleanText(
        booking,
        ['programName', 'program_name', 'label', 'programCode', 'program_code'],
        300
    ) || BOOKING_FINANCE_CATEGORY;
    const paymentMethod = firstCleanText(booking, ['paymentMethod', 'payment_method'], 30);
    const createdBy = firstCleanText(options, ['createdBy', 'created_by'], 50)
        || firstCleanText(booking, ['createdBy', 'created_by'], 50);

    return {
        bookingId: eligibility.bookingId,
        businessContext: eligibility.businessContext,
        amount: eligibility.amount,
        description: `${bookingName} (${eligibility.bookingId})`,
        date,
        paymentMethod,
        createdBy
    };
}

function assertTransactionClient(client) {
    if (!client || typeof client.query !== 'function') {
        throw new TypeError('A transaction client with query() is required');
    }
}

async function lockBookingFinanceIdentity(client, record) {
    // This transaction-scoped lock closes the absent-row race without a schema change.
    // Callers must pass a client that is already inside their booking transaction.
    await client.query(
        `SELECT pg_advisory_xact_lock(
            hashtextextended($1::text, 0)
        )`,
        [`booking-finance:${record.businessContext}:${record.bookingId}`]
    );
}

async function findBookingFinanceRows(client, record) {
    const result = await client.query(
        `SELECT id
           FROM finance_transactions
          WHERE booking_id = $1
            AND type = 'income'
            AND certificate_id IS NULL
            AND COALESCE(business_context, 'event_genix') = $2
          ORDER BY id ASC
          FOR UPDATE`,
        [record.bookingId, record.businessContext]
    );
    return result.rows || [];
}

function assertSingleBookingFinanceRow(rows, record) {
    if (rows.length <= 1) return;
    throw new BookingFinanceSyncError(
        'Multiple non-certificate finance rows exist for one booking',
        'BOOKING_FINANCE_DUPLICATE_ROWS',
        {
            bookingId: record.bookingId,
            financeTransactionIds: rows.map(row => row.id)
        }
    );
}

async function removeBookingFinanceInTransaction(client, eligibility) {
    const record = {
        bookingId: eligibility.bookingId,
        businessContext: eligibility.businessContext
    };
    if (!record.bookingId) {
        return {
            applied: false,
            action: 'skipped',
            reason: eligibility.reason,
            bookingId: null,
            businessContext: record.businessContext
        };
    }
    await lockBookingFinanceIdentity(client, record);
    const rows = await findBookingFinanceRows(client, record);
    assertSingleBookingFinanceRow(rows, record);
    if (!rows.length) {
        return {
            applied: false,
            action: 'skipped',
            reason: eligibility.reason,
            bookingId: record.bookingId,
            businessContext: record.businessContext
        };
    }
    const result = await client.query(
        `DELETE FROM finance_transactions
          WHERE id = $1
            AND booking_id = $2
            AND type = 'income'
            AND certificate_id IS NULL
            AND COALESCE(business_context, 'event_genix') = $3
          RETURNING id`,
        [rows[0].id, record.bookingId, record.businessContext]
    );
    if (result.rowCount !== 1) {
        throw new BookingFinanceSyncError(
            'Booking finance row changed while it was being removed',
            'BOOKING_FINANCE_ROW_DELETE_CONFLICT',
            { bookingId: record.bookingId, financeTransactionId: rows[0].id }
        );
    }
    return {
        applied: true,
        action: 'deleted',
        reason: eligibility.reason,
        bookingId: record.bookingId,
        businessContext: record.businessContext,
        financeTransactionId: rows[0].id,
        amount: 0
    };
}

async function updateBookingFinanceRow(client, financeTransactionId, record) {
    const result = await client.query(
        `UPDATE finance_transactions
            SET amount = $1,
                description = $2,
                date = $3,
                payment_method = $4,
                updated_at = NOW()
          WHERE id = $5
            AND booking_id = $6
            AND type = 'income'
            AND certificate_id IS NULL
            AND COALESCE(business_context, 'event_genix') = $7
          RETURNING id`,
        [
            record.amount,
            record.description,
            record.date,
            record.paymentMethod,
            financeTransactionId,
            record.bookingId,
            record.businessContext
        ]
    );
    if (result.rowCount !== 1 || !result.rows?.[0]?.id) {
        throw new BookingFinanceSyncError(
            'Booking finance row changed while it was being synchronized',
            'BOOKING_FINANCE_ROW_UPDATE_CONFLICT',
            {
                bookingId: record.bookingId,
                financeTransactionId
            }
        );
    }
    return result.rows[0];
}

async function findBookingFinanceCategory(client, businessContext) {
    const result = await client.query(
        `SELECT id
           FROM finance_categories
          WHERE name = $1
            AND type = 'income'
            AND COALESCE(business_context, 'event_genix') = $2
          ORDER BY id ASC
          LIMIT 1
          FOR SHARE`,
        [BOOKING_FINANCE_CATEGORY, businessContext]
    );
    const category = result.rows?.[0] || null;
    if (!category?.id) {
        throw new BookingFinanceSyncError(
            `Finance category "${BOOKING_FINANCE_CATEGORY}" is missing`,
            'BOOKING_FINANCE_CATEGORY_MISSING',
            { businessContext }
        );
    }
    return category;
}

async function insertBookingFinanceRow(client, categoryId, record) {
    const result = await client.query(
        `INSERT INTO finance_transactions
            (business_context, type, category_id, amount, description, date,
             payment_method, booking_id, created_by)
         VALUES
            ($1::varchar, 'income', $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
            record.businessContext,
            categoryId,
            record.amount,
            record.description,
            record.date,
            record.paymentMethod,
            record.bookingId,
            record.createdBy
        ]
    );
    if (result.rowCount !== 1 || !result.rows?.[0]?.id) {
        throw new BookingFinanceSyncError(
            'Booking finance row was not created',
            'BOOKING_FINANCE_ROW_INSERT_FAILED',
            { bookingId: record.bookingId }
        );
    }
    return result.rows[0];
}

async function upsertBookingFinanceInTransaction(client, booking = {}, options = {}) {
    assertTransactionClient(client);
    const eligibility = bookingFinanceEligibility(booking, options);
    if (!eligibility.eligible) {
        return {
            applied: false,
            action: 'skipped',
            reason: eligibility.reason,
            bookingId: eligibility.bookingId,
            businessContext: eligibility.businessContext
        };
    }

    const record = buildBookingFinanceRecord(booking, options, eligibility);
    await lockBookingFinanceIdentity(client, record);
    const existingRows = await findBookingFinanceRows(client, record);
    assertSingleBookingFinanceRow(existingRows, record);
    const existing = existingRows[0] || null;
    if (existing) {
        const updated = await updateBookingFinanceRow(client, existing.id, record);
        return {
            applied: true,
            action: 'updated',
            reason: null,
            bookingId: record.bookingId,
            businessContext: record.businessContext,
            financeTransactionId: updated.id,
            amount: record.amount
        };
    }

    const category = await findBookingFinanceCategory(client, record.businessContext);
    const inserted = await insertBookingFinanceRow(client, category.id, record);
    return {
        applied: true,
        action: 'inserted',
        reason: null,
        bookingId: record.bookingId,
        businessContext: record.businessContext,
        financeTransactionId: inserted.id,
        amount: record.amount
    };
}

async function runOptionalBookingFinanceStep(client, label, step, options = {}) {
    const logger = options.logger || log;
    let savepointCreated = false;
    try {
        await client.query(`SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`);
        savepointCreated = true;
        const result = await step();
        await client.query(`RELEASE SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`);
        return result;
    } catch (err) {
        if (!savepointCreated) throw err;
        await client.query(`ROLLBACK TO SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`)
            .catch(rollbackError => logger.error(
                `Rollback to optional booking finance savepoint failed (${label})`,
                rollbackError
            ));
        await client.query(`RELEASE SAVEPOINT ${BOOKING_FINANCE_SAVEPOINT}`)
            .catch(releaseError => logger.error(
                `Release optional booking finance savepoint failed (${label})`,
                releaseError
            ));
        logger.warn(`${label} failed (non-critical): ${err.message}`);
        return {
            applied: false,
            action: 'skipped',
            reason: 'optional_finance_failed',
            bookingId: options.bookingId || null,
            businessContext: options.businessContext || null,
            errorCode: err.code || 'BOOKING_FINANCE_SYNC_ERROR'
        };
    }
}

async function syncBookingFinanceInTransaction(client, booking = {}, options = {}) {
    assertTransactionClient(client);
    const eligibility = bookingFinanceEligibility(booking, options);
    if (!eligibility.eligible) {
        if (eligibility.removeExisting) {
            const removeStep = () => removeBookingFinanceInTransaction(client, eligibility);
            if (options.optional === false) return removeStep();
            return runOptionalBookingFinanceStep(
                client,
                options.label || 'Booking finance synchronization',
                removeStep,
                {
                    logger: options.logger,
                    bookingId: eligibility.bookingId,
                    businessContext: eligibility.businessContext
                }
            );
        }
        return {
            applied: false,
            action: 'skipped',
            reason: eligibility.reason,
            bookingId: eligibility.bookingId,
            businessContext: eligibility.businessContext
        };
    }
    if (options.optional === false) {
        return upsertBookingFinanceInTransaction(client, booking, options);
    }
    return runOptionalBookingFinanceStep(
        client,
        options.label || 'Booking finance synchronization',
        () => upsertBookingFinanceInTransaction(client, booking, options),
        {
            logger: options.logger,
            bookingId: eligibility.bookingId,
            businessContext: eligibility.businessContext
        }
    );
}

async function createBookingFinanceInTransaction(client, booking = {}, options = {}) {
    return syncBookingFinanceInTransaction(client, booking, {
        ...options,
        label: options.label || 'Booking finance creation'
    });
}

module.exports = {
    BOOKING_FINANCE_CATEGORY,
    BOOKING_FINANCE_SAVEPOINT,
    BookingFinanceSyncError,
    bookingFinanceEligibility,
    buildBookingFinanceRecord,
    createBookingFinanceInTransaction,
    runOptionalBookingFinanceStep,
    removeBookingFinanceInTransaction,
    syncBookingFinanceInTransaction,
    upsertBookingFinanceInTransaction
};
