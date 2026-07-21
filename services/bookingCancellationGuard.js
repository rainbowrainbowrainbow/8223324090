'use strict';

const { DEFAULT_TIMELINE_CONTEXT } = require('./timelineContext');

class BookingCancellationGuardError extends Error {
    constructor(message, { code = 'BANQUET_BULK_CANCELLATION_BLOCKED', details = null } = {}) {
        super(message);
        this.name = 'BookingCancellationGuardError';
        this.status = 409;
        this.code = code;
        this.publicMessage = message;
        this.details = details;
    }
}

function contextColumnSql(column) {
    return `CASE
        WHEN LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), '${DEFAULT_TIMELINE_CONTEXT}')) IN ('park_zakrevsky', 'park', 'pzp') THEN '${DEFAULT_TIMELINE_CONTEXT}'
        ELSE LOWER(COALESCE(NULLIF(BTRIM(${column}), ''), '${DEFAULT_TIMELINE_CONTEXT}'))
    END`;
}

async function assertNoActiveBanquetBookingsInCancellationSet(queryable, {
    bookingIds = [],
    businessContext = null,
    operation = 'bulk_cancel'
} = {}) {
    const ids = [...new Set((bookingIds || []).map(value => String(value || '').trim()).filter(Boolean))];
    if (!ids.length) return { allowed: true, activeBanquetBookingCount: 0, activeBanquetGroupCount: 0 };
    const context = businessContext ? String(businessContext).trim().toLowerCase() : null;
    const result = await queryable.query(
        `SELECT b.id AS booking_id, bgb.group_id
           FROM bookings b
           JOIN banquet_group_bookings bgb ON bgb.booking_id = b.id
           JOIN banquet_groups bg ON bg.id = bgb.group_id
          WHERE b.id = ANY($1::text[])
            AND LOWER(COALESCE(NULLIF(BTRIM(bg.status), ''), 'active')) = 'active'
            AND ${contextColumnSql('b.business_context')} = ${contextColumnSql('bgb.business_context')}
            AND ${contextColumnSql('b.business_context')} = ${contextColumnSql('bg.business_context')}
            AND ($2::text IS NULL OR ${contextColumnSql('b.business_context')} = $2)
          ORDER BY bgb.group_id, b.id
          FOR UPDATE OF bg, bgb, b`,
        [ids, context]
    );
    if (!result.rows.length) {
        return { allowed: true, activeBanquetBookingCount: 0, activeBanquetGroupCount: 0 };
    }
    const groupCount = new Set(result.rows.map(row => String(row.group_id))).size;
    throw new BookingCancellationGuardError(
        'Масове скасування заблоковано: серед вибраних записів є активні складові банкету. Скасуйте банкет через canonical cancellation flow.',
        {
            details: {
                operation,
                blockers: ['active_banquet_membership'],
                activeBanquetBookingCount: result.rows.length,
                activeBanquetGroupCount: groupCount
            }
        }
    );
}

async function lockBookingCancellationSet(queryable, bookingIds = []) {
    const ids = [...new Set((bookingIds || []).map(value => String(value || '').trim()).filter(Boolean))];
    if (!ids.length) return [];
    const result = await queryable.query(
        `SELECT id
           FROM bookings
          WHERE id = ANY($1::text[])
          ORDER BY id
          FOR UPDATE`,
        [ids]
    );
    if (result.rows.length !== ids.length) {
        throw new BookingCancellationGuardError(
            'Скасування зупинено: набір бронювань змінився під час перевірки. Оновіть дані та повторіть дію.',
            {
                code: 'BOOKING_CANCELLATION_SET_CHANGED',
                details: {
                    blockers: ['state_changed'],
                    expectedBookingCount: ids.length,
                    lockedBookingCount: result.rows.length
                }
            }
        );
    }
    return result.rows || [];
}

function isBookingCancellationConcurrencyError(err) {
    return ['40001', '40P01'].includes(String(err?.code || ''));
}

module.exports = {
    BookingCancellationGuardError,
    assertNoActiveBanquetBookingsInCancellationSet,
    isBookingCancellationConcurrencyError,
    lockBookingCancellationSet
};
