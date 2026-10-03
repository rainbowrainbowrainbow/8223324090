'use strict';

// Read-only canonical reference verification. It does not register actual evidence or post to finance.
const MAX_DB_AMOUNT = 9223372036854775807n;
const TYPES = new Set(['booking', 'education_attendance', 'payroll_installment', 'payment_order', 'payment_refund']);

class SourceLinkInputError extends Error {
    constructor(message) { super(message); this.name = 'SourceLinkInputError'; this.status = 400; }
}

function normalizeRequest(raw = {}) {
    const type = String(raw.type || '');
    const sourceId = String(raw.sourceId || '').trim();
    if (!TYPES.has(type)) throw new SourceLinkInputError('Unsupported canonical source type');
    if (type === 'booking') {
        if (!/^[a-zA-Z0-9:_-]{1,50}$/.test(sourceId)) throw new SourceLinkInputError('Invalid booking ID');
    } else if (!/^[1-9]\d{0,17}$/.test(sourceId)) throw new SourceLinkInputError('Source ID must be a positive integer');
    const expected = raw.expectedAmountMinor;
    if (type === 'education_attendance') {
        if (expected !== undefined && expected !== null && expected !== '') throw new SourceLinkInputError('Attendance has no monetary amount');
        return { type, sourceId, expectedAmountMinor: null };
    }
    const expectedText = String(expected ?? '');
    if (!/^-?(0|[1-9]\d{0,18})$/.test(expectedText)) throw new SourceLinkInputError('Expected amount must be integer minor units');
    const expectedAmount = BigInt(expectedText);
    if (expectedAmount < -MAX_DB_AMOUNT || expectedAmount > MAX_DB_AMOUNT) throw new SourceLinkInputError('Expected amount exceeds supported range');
    if (type !== 'payment_refund' && expectedAmount < 0n) throw new SourceLinkInputError('Only refund references may use a negative amount');
    if (type === 'payment_refund' && expectedAmount > 0n) throw new SourceLinkInputError('Refund reference amount must be nonpositive');
    return { type, sourceId, expectedAmountMinor: expectedAmount.toString() };
}

const QUERIES = {
    booking: `SELECT id::text AS id, COALESCE(business_context, 'event_genix') AS business_context,
                     price::text AS amount_uah, status::text AS status
                FROM bookings WHERE id=$1`,
    education_attendance: `SELECT ea.id::text AS id, ea.business_context, ea.booking_id, ea.status::text AS status
                             FROM education_attendance ea JOIN bookings b ON b.id=ea.booking_id
                              AND COALESCE(b.business_context, 'event_genix')=ea.business_context
                            WHERE ea.id=$1::bigint`,
    payroll_installment: `SELECT pi.id::text AS id, pi.business_context, pi.locked_amount::text AS amount_uah,
                                pi.workflow_status AS status, pi.allocation_status,
                                pr.id::text AS report_id, pr.status AS report_status,
                                pr.finance_transaction_id::text AS finance_transaction_id
                           FROM payroll_installments pi JOIN payroll_reports pr ON pr.id=pi.payroll_report_id
                          WHERE pi.id=$1::bigint`,
    payment_order: `SELECT po.id::text AS id, fp.crm_profile_key AS business_context,
                          po.total_amount_minor::text AS amount_minor, po.status::text AS status,
                          po.payment_status, po.source_type, po.source_id
                     FROM payment_orders po JOIN fiscal_profiles fp ON fp.id=po.fiscal_profile_id
                    WHERE po.id=$1::bigint`,
    payment_refund: `SELECT pr.id::text AS id, fp.crm_profile_key AS business_context,
                           pr.amount_minor::text AS amount_minor, pr.status::text AS status,
                           pr.payment_order_id::text AS payment_order_id
                      FROM payment_refunds pr JOIN fiscal_profiles fp ON fp.id=pr.fiscal_profile_id
                     WHERE pr.id=$1::bigint`
};

async function previewCanonicalSource(db, businessContext, raw) {
    const request = normalizeRequest(raw);
    const result = await db.query(QUERIES[request.type], [request.sourceId]);
    const row = result.rows[0];
    if (!row || row.business_context !== businessContext) {
        // Do not disclose whether another business owns the identifier.
        return { type: request.type, sourceId: request.sourceId, referenceValid: false,
            verifiedFields: [], amountMatches: null, reason: 'Source not found in this business', postingAllowed: false };
    }
    let amountMinor = row.amount_minor === undefined ? null : row.amount_minor;
    if (row.amount_uah !== undefined && row.amount_uah !== null) amountMinor = (BigInt(row.amount_uah) * 100n).toString();
    if (request.type === 'payment_refund' && amountMinor !== null) amountMinor = (-BigInt(amountMinor)).toString();
    const amountMatches = request.expectedAmountMinor === null ? null : amountMinor === request.expectedAmountMinor;
    const referenceValid = (amountMatches === true || request.type === 'education_attendance') &&
        (request.type === 'education_attendance' || amountMinor !== null);
    const verifiedFields = ['id', 'business_context'];
    if (amountMatches === true) verifiedFields.push('amount');
    const blockers = [];
    if (amountMatches === false && amountMinor !== null) blockers.push('Canonical amount differs from the expected amount');
    if (amountMinor === null && request.type !== 'education_attendance') blockers.push('Canonical amount is unavailable');
    if (request.type === 'booking') blockers.push('Booking price is an estimate, not an earned or paid revenue posting');
    if (request.type === 'education_attendance') blockers.push('Attendance identifies a lesson but has no cost/revenue amount');
    if (request.type === 'payroll_installment') {
        blockers.push('Monthly payroll installment has no execution-level earning allocation');
        if (row.status !== 'approved' || row.allocation_status !== 'single' || !['approved', 'paid'].includes(row.report_status)) {
            blockers.push('Payroll report/installment is not approved for single-business allocation');
        }
        if (row.finance_transaction_id) blockers.push('Linked finance transaction must be deduplicated');
    }
    if (request.type === 'payment_order') blockers.push('Payment status does not resolve earned-revenue recognition');
    if (request.type === 'payment_refund') blockers.push('Refund timing and recognition policy are unresolved');
    return { type: request.type, sourceId: request.sourceId, sourceClass: 'canonical_read_only_preview',
        referenceValid, verifiedFields, amountMatches, expectedAmountMinor: request.expectedAmountMinor,
        canonicalAmountMinor: amountMinor,
        status: row.status || null, linkedBookingId: request.type === 'education_attendance' ? row.booking_id : null,
        postingAllowed: false, blockers };
}

module.exports = { SourceLinkInputError, normalizeRequest, previewCanonicalSource };
