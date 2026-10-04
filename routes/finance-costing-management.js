'use strict';

// This route builds a separate management projection. It never writes finance, payment, payroll, or booking rows.
const router = require('express').Router();
const { pool } = require('../db');
const { businessContextFromRequest, requireBusinessContext } = require('../services/businessContext');
const { ManagementInputError, positiveId, revision, date, reason, money, hourlyAmount,
    projectManagementPnl } = require('../services/costingManagement');
const { createLogger } = require('../utils/logger');
const log = createLogger('FinanceCostingManagement');

const KINDS = new Set(['earned_revenue', 'direct_cost', 'piecework', 'hourly', 'revenue_correction', 'unresolved']);

function business(req, res) {
    const context = businessContextFromRequest(req);
    return requireBusinessContext(req, res, context) ? context : null;
}

function conflict(message) { const error = new Error(message); error.status = 409; return error; }
function missing(message) { const error = new Error(message); error.status = 404; return error; }
function fail(res, error, action) {
    if (error instanceof ManagementInputError) return res.status(400).json({ success: false, error: error.message });
    if (error.status === 404 || error.status === 409) return res.status(error.status).json({ success: false, error: error.message });
    if (error.code === '23505' || error.code === '40P01' || error.code === '40001') {
        return res.status(409).json({ success: false, error: 'Concurrent reconciliation changed; reload and retry' });
    }
    log.error(action, error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
}

async function plan(db, context, planId, lock = false) {
    const result = await db.query(
        `SELECT id, business_context, execution_kind, execution_date::text AS execution_date, booking_id
         FROM costing_plan_snapshots WHERE id=$1 AND business_context=$2${lock ? ' FOR UPDATE' : ''}`,
        [planId, context]
    );
    if (!result.rowCount) throw missing('Execution not found in this business');
    return result.rows[0];
}

async function latestPerformance(db, context, planId) {
    const result = await db.query(
        `SELECT id, revision_number, state, performed_on::text, evidence_type, evidence_id, reason, created_at
         FROM costing_performance_events WHERE plan_id=$1 AND business_context=$2
         ORDER BY revision_number DESC LIMIT 1`, [planId, context]
    );
    return result.rows[0] || null;
}

async function latestLink(db, context, sourceId) {
    const result = await db.query(
        `SELECT * FROM costing_management_links WHERE source_id=$1 AND business_context=$2
         ORDER BY revision_number DESC LIMIT 1`, [sourceId, context]
    );
    return result.rows[0] || null;
}

async function financeTransaction(db, context, raw, lock = false) {
    const financeId = positiveId(raw, 'financeTransactionId');
    const result = await db.query(
        `SELECT id, type, amount::text AS amount_uah, COALESCE(business_context, 'event_genix') AS business_context,
                COALESCE(recognition_date, date::date)::text AS recognition_on, source, booking_id
           FROM finance_transactions WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [financeId]
    );
    const row = result.rows[0];
    if (!row || row.business_context !== context) throw missing('Finance transaction not found in this business');
    return row;
}

async function activeSource(db, context, sourceId) {
    const result = await db.query(
        `SELECT s.id, s.plan_id, s.group_id, s.category, s.economic_role,
                e.id AS entry_id, e.amount_minor::text, e.evidence_state, e.semantic
         FROM costing_actual_sources s
         JOIN costing_actual_entries e ON e.source_id=s.id AND e.business_context=s.business_context AND e.entry_type='record'
         LEFT JOIN costing_actual_entries reversal ON reversal.reverses_entry_id=e.id
         WHERE s.id=$1 AND s.business_context=$2 AND reversal.id IS NULL
         ORDER BY e.revision_number DESC LIMIT 1`, [sourceId, context]
    );
    const source = result.rows[0];
    if (!source || !source.plan_id || source.group_id) throw missing('Plan-level source not found in this business');
    if (source.evidence_state !== 'confirmed') throw conflict('Estimated evidence cannot enter management P&L');
    return source;
}

async function assertFinanceAvailable(db, context, financeId, sourceId, labor, amountMinor) {
    const result = await db.query(
        `SELECT l.source_id, l.kind, l.amount_minor::text FROM costing_management_links l
         WHERE l.business_context=$1 AND l.finance_transaction_id=$2 AND l.source_id<>$3
           AND l.revision_number=(SELECT MAX(newest.revision_number) FROM costing_management_links newest
                                  WHERE newest.source_id=l.source_id) AND l.kind<>'unresolved'`,
        [context, financeId, sourceId]
    );
    if (result.rows.some(row => !labor || !['piecework', 'hourly'].includes(row.kind))) {
        throw conflict('Finance transaction already represents another economic operation');
    }
    return result.rows.reduce((total, row) => total + BigInt(row.amount_minor), amountMinor);
}

router.post('/plans/:id/performance', async (req, res) => {
    let client;
    try {
        const context = business(req, res); if (!context) return;
        const planId = positiveId(req.params.id, 'planId');
        const expectedRevision = revision(req.body?.expectedRevision);
        const state = String(req.body?.state || '');
        if (!['performed', 'voided'].includes(state)) throw new ManagementInputError('state must be performed or voided');
        const performedOn = state === 'performed' ? date(req.body?.performedOn, 'performedOn') : null;
        const evidenceType = state === 'voided' ? 'operator' : String(req.body?.evidenceType || '');
        if (!['operator', 'attendance'].includes(evidenceType)) throw new ManagementInputError('Unsupported performance evidence');
        const evidenceId = evidenceType === 'attendance' ? positiveId(req.body?.evidenceId, 'attendance ID') : null;
        const explanation = reason(req.body?.reason);
        client = await pool.connect();
        await client.query('BEGIN');
        const execution = await plan(client, context, planId, true);
        const current = await latestPerformance(client, context, planId);
        if ((current?.revision_number || 0) !== expectedRevision) throw conflict('Performance changed; reload before attesting');
        if (evidenceType === 'attendance') {
            if (execution.execution_kind !== 'lesson') throw conflict('Attendance can confirm only a lesson execution');
            const attendance = await client.query(
                `SELECT ea.id FROM education_attendance ea
                 JOIN bookings b ON b.id=ea.booking_id AND COALESCE(b.business_context,'event_genix')=ea.business_context
                 WHERE ea.id=$1 AND ea.business_context=$2 AND ea.status='present' AND ea.lesson_date=$3::date
                   AND ($4::varchar(50) IS NULL OR ea.booking_id=$4::varchar(50))`,
                [evidenceId, context, performedOn, execution.booking_id]
            );
            if (!attendance.rowCount) throw conflict('Present attendance on the performed date was not verified');
        }
        const saved = await client.query(
            `INSERT INTO costing_performance_events
             (business_context,plan_id,revision_number,state,performed_on,evidence_type,evidence_id,reason,created_by)
             VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9) RETURNING id,revision_number`,
            [context, planId, expectedRevision + 1, state, performedOn, evidenceType, evidenceId,
                explanation, req.user?.username || null]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, event: saved.rows[0] });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'POST performance');
    } finally { client?.release(); }
});

router.get('/plans/:id/performance', async (req, res) => {
    try {
        const context = business(req, res); if (!context) return;
        const planId = positiveId(req.params.id, 'planId');
        await plan(pool, context, planId);
        const history = await pool.query(
            `SELECT id,revision_number,state,performed_on::text,evidence_type,evidence_id,reason,created_by,created_at
             FROM costing_performance_events WHERE plan_id=$1 AND business_context=$2 ORDER BY revision_number`,
            [planId, context]
        );
        res.json({ success: true, current: history.rows.at(-1) || null, history: history.rows });
    } catch (error) { fail(res, error, 'GET performance'); }
});

router.post('/sources/:id/links', async (req, res) => {
    let client;
    try {
        const context = business(req, res); if (!context) return;
        const sourceId = positiveId(req.params.id, 'sourceId');
        const expectedRevision = revision(req.body?.expectedRevision);
        const kind = String(req.body?.kind || '');
        if (!KINDS.has(kind)) throw new ManagementInputError('Unsupported management link kind');
        const effectOn = date(req.body?.effectOn, 'effectOn');
        const explanation = reason(req.body?.reason);
        client = await pool.connect();
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const owner = await client.query(
            'SELECT plan_id FROM costing_actual_sources WHERE id=$1 AND business_context=$2', [sourceId, context]
        );
        if (!owner.rowCount || !owner.rows[0].plan_id) throw missing('Plan-level source not found in this business');
        const execution = await plan(client, context, owner.rows[0].plan_id, true);
        await client.query('SELECT id FROM costing_actual_sources WHERE id=$1 AND business_context=$2 FOR UPDATE', [sourceId, context]);
        const source = await activeSource(client, context, sourceId);
        const current = await latestLink(client, context, sourceId);
        if ((current?.revision_number || 0) !== expectedRevision) throw conflict('Source reconciliation changed; reload before linking');
        const amount = money(source.amount_minor);
        const perf = await latestPerformance(client, context, execution.id);
        let financeId = null;
        let paymentOrderId = null;
        let paymentRefundId = null;
        let originalLinkId = null;
        let payrollInstallmentId = null;
        let hrTimeRecordId = null;
        let confirmedMinutes = null;
        let hourlyRateMinor = null;
        if (kind === 'earned_revenue' || kind === 'piecework' || kind === 'hourly') {
            if (!perf || perf.state !== 'performed' || perf.performed_on !== effectOn) {
                throw conflict('Confirmed execution performance on this recognition date is required');
            }
        }
        if (kind === 'earned_revenue' || kind === 'direct_cost' || kind === 'piecework' || kind === 'hourly') {
            if ((kind === 'earned_revenue' && (source.category !== 'revenue' || amount <= 0n || source.semantic === 'refund')) ||
                (kind !== 'earned_revenue' && (source.category !== 'direct_cost' || amount < 0n))) {
                throw conflict('Source category, sign, or semantic does not match the management effect');
            }
            const ft = await financeTransaction(client, context, req.body?.financeTransactionId, true);
            financeId = ft.id;
            if (ft.type !== (kind === 'earned_revenue' ? 'income' : 'expense')) {
                throw conflict('Finance transaction type does not match the economic effect');
            }
            const labor = kind === 'piecework' || kind === 'hourly';
            if (!labor && BigInt(ft.amount_uah) * 100n !== amount) throw conflict('Finance and actual amounts differ');
            if (kind === 'direct_cost' && ft.recognition_on !== effectOn) {
                throw conflict('Direct cost uses the finance recognition date');
            }
            if (kind === 'earned_revenue') {
                if (!execution.booking_id || !ft.booking_id || ft.booking_id !== execution.booking_id) {
                    throw conflict('Earned revenue needs the exact booking fixed on this execution plan');
                }
                const booking = await client.query(
                    `SELECT id,status FROM bookings WHERE id=$1 AND COALESCE(business_context,'event_genix')=$2`,
                    [ft.booking_id, context]
                );
                if (!booking.rowCount || ['cancelled', 'preliminary'].includes(String(booking.rows[0].status).toLowerCase())) {
                    throw conflict('Canonical booking is missing or not eligible for performance recognition');
                }
            }
            const claimed = await assertFinanceAvailable(client, context, financeId, sourceId, labor, amount);
            if (labor && claimed > BigInt(ft.amount_uah) * 100n) {
                throw conflict('Labor allocations exceed the finance expense');
            }
            if (kind === 'earned_revenue' && req.body?.paymentOrderId != null) {
                paymentOrderId = positiveId(req.body.paymentOrderId, 'paymentOrderId');
                const cash = await client.query(
                    `SELECT po.id, po.source_type, po.source_id, fp.crm_profile_key AS business_context
                     FROM payment_orders po JOIN fiscal_profiles fp ON fp.id=po.fiscal_profile_id WHERE po.id=$1`,
                    [paymentOrderId]
                );
                if (!cash.rowCount || cash.rows[0].business_context !== context) throw missing('Payment order not found in this business');
                if (cash.rows[0].source_type !== 'booking' || cash.rows[0].source_id !== ft.booking_id) {
                    throw conflict('Subscription or non-booking payment allocation needs a separate policy');
                }
            }
            if (labor) {
                payrollInstallmentId = positiveId(req.body?.payrollInstallmentId, 'payrollInstallmentId');
                const result = await client.query(
                    `SELECT pi.business_context,pi.workflow_status,pi.allocation_status,pi.locked_amount::text,
                            pr.id AS report_id,pr.status AS report_status,pr.staff_id,
                            pr.finance_transaction_id
                     FROM payroll_installments pi JOIN payroll_reports pr ON pr.id=pi.payroll_report_id
                     WHERE pi.id=$1`, [payrollInstallmentId]
                );
                const pay = result.rows[0];
                if (!pay || pay.business_context !== context) throw missing('Payroll installment not found in this business');
                if (pay.workflow_status !== 'approved' || pay.allocation_status !== 'single' ||
                    !['approved', 'paid'].includes(pay.report_status) || String(pay.finance_transaction_id) !== String(financeId)) {
                    throw conflict('Approved payroll and its linked finance expense are required');
                }
                const allocated = await client.query(
                    `SELECT l.amount_minor::text FROM costing_management_links l
                     WHERE l.business_context=$1 AND l.payroll_installment_id=$2 AND l.source_id<>$3
                       AND l.revision_number=(SELECT MAX(newest.revision_number) FROM costing_management_links newest
                                              WHERE newest.source_id=l.source_id) AND l.kind IN ('piecework','hourly')`,
                    [context, payrollInstallmentId, sourceId]
                );
                const installmentClaimed = allocated.rows.reduce((total, row) => total + BigInt(row.amount_minor), amount);
                if (pay.locked_amount === null || installmentClaimed > BigInt(pay.locked_amount) * 100n) {
                    throw conflict('Execution labor allocations exceed approved payroll');
                }
                if (kind === 'hourly') {
                    hrTimeRecordId = positiveId(req.body?.hrTimeRecordId, 'hrTimeRecordId');
                    confirmedMinutes = Number(req.body?.confirmedMinutes);
                    hourlyRateMinor = money(req.body?.hourlyRateMinor, 'hourlyRateMinor');
                    const time = await client.query(
                        `SELECT id,business_context,staff_id,total_worked_minutes,clock_out,auto_closed
                         FROM hr_time_records WHERE id=$1 AND business_context=$2 FOR UPDATE`, [hrTimeRecordId, context]
                    );
                    const record = time.rows[0];
                    if (!record || record.staff_id !== pay.staff_id || !Number.isInteger(record.total_worked_minutes) ||
                        !record.clock_out || record.auto_closed || confirmedMinutes > record.total_worked_minutes ||
                        hourlyAmount(hourlyRateMinor.toString(), confirmedMinutes) !== amount) {
                        throw conflict('Confirmed time, staff, and hourly amount must match the source');
                    }
                    // The row lock serializes claims; READ COMMITTED sees the prior claimant after it commits.
                    const claimedTime = await client.query(
                        `SELECT l.confirmed_minutes FROM costing_management_links l
                         WHERE l.business_context=$1 AND l.hr_time_record_id=$2 AND l.source_id<>$3
                           AND l.revision_number=(SELECT MAX(newest.revision_number) FROM costing_management_links newest
                                                  WHERE newest.source_id=l.source_id) AND l.kind='hourly'`,
                        [context, hrTimeRecordId, sourceId]
                    );
                    const minutesClaimed = claimedTime.rows.reduce(
                        (total, row) => total + BigInt(row.confirmed_minutes), BigInt(confirmedMinutes));
                    if (minutesClaimed > BigInt(record.total_worked_minutes)) {
                        throw conflict('Hourly allocations exceed confirmed time');
                    }
                }
            }
        } else if (kind === 'revenue_correction') {
            if (source.category !== 'revenue' || amount >= 0n || !['refund', 'adjustment'].includes(source.semantic)) {
                throw conflict('Explicit negative revenue correction evidence is required');
            }
            originalLinkId = positiveId(req.body?.originalLinkId, 'originalLinkId');
            const original = await client.query(
                `SELECT l.* FROM costing_management_links l
                 WHERE l.id=$1 AND l.business_context=$2 AND l.kind='earned_revenue'
                   AND l.revision_number=(SELECT MAX(newest.revision_number) FROM costing_management_links newest
                                          WHERE newest.source_id=l.source_id)`, [originalLinkId, context]
            );
            const linked = original.rows[0];
            if (!linked || String(linked.plan_id) !== String(execution.id) ||
                amount < -BigInt(linked.amount_minor) || effectOn < linked.effect_on.toISOString().slice(0, 10)) {
                throw conflict('Correction must follow an active earned-revenue link in this execution');
            }
            const priorCorrections = await client.query(
                `SELECT l.amount_minor::text FROM costing_management_links l
                 WHERE l.business_context=$1 AND l.original_link_id=$2 AND l.source_id<>$3
                   AND l.revision_number=(SELECT MAX(latest.revision_number) FROM costing_management_links latest
                                          WHERE latest.source_id=l.source_id)
                   AND l.kind='revenue_correction'`,
                [context, originalLinkId, sourceId]
            );
            const correctionTotal = priorCorrections.rows.reduce((total, row) => total - BigInt(row.amount_minor), -amount);
            if (correctionTotal > BigInt(linked.amount_minor)) {
                throw conflict('Revenue corrections exceed the original earned amount');
            }
            if (source.semantic === 'refund') {
                if (!linked.payment_order_id) throw conflict('Original earned revenue lacks a linked payment order');
                paymentRefundId = positiveId(req.body?.paymentRefundId, 'paymentRefundId');
                await client.query('SELECT pg_advisory_xact_lock(378, hashtext($1::text))', [paymentRefundId]);
                const result = await client.query(
                    `SELECT pr.id,pr.payment_order_id,pr.status,pr.amount_minor::text,
                            fp.crm_profile_key AS business_context
                     FROM payment_refunds pr JOIN fiscal_profiles fp ON fp.id=pr.fiscal_profile_id WHERE pr.id=$1`,
                    [paymentRefundId]
                );
                const refund = result.rows[0];
                if (!refund || refund.business_context !== context) throw missing('Refund not found in this business');
                if (String(refund.payment_order_id) !== String(linked.payment_order_id) ||
                    !['money_refunded', 'fiscal_returned'].includes(refund.status) ||
                    -amount > BigInt(refund.amount_minor)) {
                    throw conflict('Refund does not match the original payment and explicit correction amount');
                }
                const alreadyLinked = await client.query(
                    `SELECT 1 FROM costing_management_links l
                     WHERE l.business_context=$1 AND l.payment_refund_id=$2 AND l.source_id<>$3
                       AND l.revision_number=(SELECT MAX(latest.revision_number) FROM costing_management_links latest
                                              WHERE latest.source_id=l.source_id)
                       AND l.kind='revenue_correction' LIMIT 1`,
                    [context, paymentRefundId, sourceId]
                );
                if (alreadyLinked.rowCount) throw conflict('Refund already represents another revenue correction');
            }
        } else if (kind === 'unresolved') {
            // Append an explicit hold; old links remain in history but cease contributing to the projection.
            if (current?.kind === 'hourly' && current.effect_on.toISOString().slice(0, 10) !== effectOn) {
                throw conflict('An unresolved hourly share must retain its original effect date');
            }
        }
        const saved = await client.query(
            `INSERT INTO costing_management_links
             (business_context,plan_id,source_id,entry_id,revision_number,kind,amount_minor,effect_on,
              finance_transaction_id,payment_order_id,payment_refund_id,original_link_id,
              payroll_installment_id,hr_time_record_id,confirmed_minutes,hourly_rate_minor,reason,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7::bigint,$8::date,$9,$10,$11,$12,$13,$14,$15,$16::bigint,$17,$18)
             RETURNING id,revision_number`,
            [context, execution.id, sourceId, source.entry_id, expectedRevision + 1, kind, amount.toString(), effectOn,
                financeId, paymentOrderId, paymentRefundId, originalLinkId, payrollInstallmentId,
                hrTimeRecordId, confirmedMinutes, hourlyRateMinor?.toString() || null, explanation,
                req.user?.username || null]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, link: saved.rows[0] });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'POST management link');
    } finally { client?.release(); }
});

router.get('/sources/:id/links', async (req, res) => {
    try {
        const context = business(req, res); if (!context) return;
        const sourceId = positiveId(req.params.id, 'sourceId');
        const source = await pool.query(
            'SELECT id,plan_id FROM costing_actual_sources WHERE id=$1 AND business_context=$2', [sourceId, context]
        );
        if (!source.rowCount || !source.rows[0].plan_id) throw missing('Plan-level source not found in this business');
        const history = await pool.query(
            `SELECT id,revision_number,kind,amount_minor::text,effect_on::text,finance_transaction_id,
                    payment_order_id,payment_refund_id,original_link_id,payroll_installment_id,
                    hr_time_record_id,confirmed_minutes,hourly_rate_minor::text,reason,created_by,created_at
             FROM costing_management_links WHERE source_id=$1 AND business_context=$2 ORDER BY revision_number`,
            [sourceId, context]
        );
        res.json({ success: true, current: history.rows.at(-1) || null, history: history.rows });
    } catch (error) { fail(res, error, 'GET management links'); }
});

router.get('/pnl', async (req, res) => {
    let client;
    try {
        const context = business(req, res); if (!context) return;
        const from = date(req.query.from, 'from');
        const to = date(req.query.to, 'to');
        if (from > to) throw new ManagementInputError('from must not be after to');
        client = await pool.connect();
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const links = await client.query(
            `SELECT l.id,l.business_context,l.plan_id,l.source_id,l.entry_id,l.kind,l.amount_minor::text,
                    l.effect_on::text,l.finance_transaction_id::text,l.payment_order_id::text,
                    l.payment_refund_id::text,l.original_link_id::text,l.payroll_installment_id::text,
                    l.hr_time_record_id::text,l.confirmed_minutes,l.hourly_rate_minor::text,l.reason,
                    active.id AS active_entry_id,active.evidence_state,active.semantic,
                    execution.booking_id AS execution_booking_id,
                    perf.state AS performance_state,perf.performed_on::text AS performance_on,
                    perf.evidence_type AS performance_evidence_type,
                    ea.status AS attendance_status,ea.business_context AS attendance_business,
                    ea.booking_id AS attendance_booking_id,
                    COALESCE(attendance_booking.business_context,'event_genix') AS attendance_booking_business,
                    ea.lesson_date::text AS attendance_date,
                    ft.type AS finance_type,ft.amount::text AS finance_amount_uah,
                    COALESCE(ft.business_context,'event_genix') AS finance_business,
                    ft.booking_id AS finance_booking_id,
                    COALESCE(ft.recognition_date,ft.date::date)::text AS finance_date,
                    COALESCE(revenue_booking.business_context,'event_genix') AS booking_business,
                    revenue_booking.status AS booking_status,
                    payment.source_type AS payment_order_type,payment.source_id AS payment_source_id,
                    payment_profile.crm_profile_key AS payment_business,
                    pi.business_context AS installment_business,pi.workflow_status AS installment_status,
                    pi.allocation_status,pi.locked_amount::text,
                    pr.id AS payroll_report_id,pr.status AS report_status,pr.staff_id AS payroll_staff_id,
                    pr.finance_transaction_id::text AS payroll_finance_id,
                    tr.business_context AS time_business,tr.staff_id AS time_staff_id,
                    tr.clock_out,tr.auto_closed,tr.total_worked_minutes AS worked_minutes,
                    original.kind AS original_kind,original.business_context AS original_business,
                    original.plan_id AS original_plan_id,original.amount_minor::text AS original_amount_minor,
                    original.payment_order_id::text AS original_payment_order_id,
                    original.revision_number AS original_revision_number,
                    original.entry_id AS original_entry_id,
                    (SELECT MAX(latest.revision_number) FROM costing_management_links latest
                     WHERE latest.source_id=original.source_id) AS original_active_revision,
                    (SELECT e.id FROM costing_actual_entries e
                     LEFT JOIN costing_actual_entries reversed ON reversed.reverses_entry_id=e.id
                     WHERE e.source_id=original.source_id AND e.entry_type='record' AND reversed.id IS NULL
                     ORDER BY e.revision_number DESC LIMIT 1) AS original_active_entry_id,
                    refund.status AS refund_status,refund.payment_order_id::text AS refund_order_id,
                    refund.amount_minor::text AS refund_amount_minor,profile.crm_profile_key AS refund_business
             FROM costing_management_links l
             JOIN costing_plan_snapshots execution ON execution.id=l.plan_id AND execution.business_context=l.business_context
             JOIN costing_actual_sources s ON s.id=l.source_id AND s.business_context=l.business_context
             LEFT JOIN LATERAL (
                 SELECT e.id,e.evidence_state,e.semantic FROM costing_actual_entries e
                 LEFT JOIN costing_actual_entries reversed ON reversed.reverses_entry_id=e.id
                 WHERE e.source_id=s.id AND e.entry_type='record' AND reversed.id IS NULL
                 ORDER BY e.revision_number DESC LIMIT 1
             ) active ON TRUE
             LEFT JOIN LATERAL (
                 SELECT state,performed_on,evidence_type,evidence_id FROM costing_performance_events
                 WHERE plan_id=l.plan_id AND business_context=l.business_context
                 ORDER BY revision_number DESC LIMIT 1
             ) perf ON TRUE
             LEFT JOIN education_attendance ea ON perf.evidence_type='attendance' AND ea.id::text=perf.evidence_id
             LEFT JOIN bookings attendance_booking ON attendance_booking.id=ea.booking_id
             LEFT JOIN finance_transactions ft ON ft.id=l.finance_transaction_id
             LEFT JOIN bookings revenue_booking ON revenue_booking.id=ft.booking_id
             LEFT JOIN payment_orders payment ON payment.id=l.payment_order_id
             LEFT JOIN fiscal_profiles payment_profile ON payment_profile.id=payment.fiscal_profile_id
             LEFT JOIN payroll_installments pi ON pi.id=l.payroll_installment_id
             LEFT JOIN payroll_reports pr ON pr.id=pi.payroll_report_id
             LEFT JOIN hr_time_records tr ON tr.id=l.hr_time_record_id
             LEFT JOIN costing_management_links original ON original.id=l.original_link_id
             LEFT JOIN payment_refunds refund ON refund.id=l.payment_refund_id
             LEFT JOIN fiscal_profiles profile ON profile.id=refund.fiscal_profile_id
             WHERE l.business_context=$1 AND l.revision_number=(
                 SELECT MAX(latest.revision_number) FROM costing_management_links latest WHERE latest.source_id=l.source_id)
             ORDER BY l.id`, [context]
        );
        const unlinkedFinance = await client.query(
            `SELECT COUNT(*)::int AS count,
                    COALESCE(SUM(CASE WHEN ft.type='income' THEN ft.amount::bigint*100 ELSE 0 END),0)::text AS income_minor,
                    COALESCE(SUM(CASE WHEN ft.type='expense' THEN ft.amount::bigint*100 ELSE 0 END),0)::text AS expense_minor
             FROM finance_transactions ft
             WHERE COALESCE(ft.business_context,'event_genix')=$1
               AND COALESCE(ft.recognition_date,ft.date::date) BETWEEN $2::date AND $3::date
               AND NOT EXISTS (
                   SELECT 1 FROM costing_management_links l
                   WHERE l.business_context=$1 AND l.finance_transaction_id=ft.id AND l.kind<>'unresolved'
                     AND l.revision_number=(SELECT MAX(latest.revision_number)
                                            FROM costing_management_links latest WHERE latest.source_id=l.source_id))`,
            [context, from, to]
        );
        const unlinkedEvidence = await client.query(
            `SELECT COUNT(*)::int AS count FROM costing_actual_sources s
             JOIN costing_plan_snapshots plan ON plan.id=s.plan_id AND plan.business_context=s.business_context
             WHERE s.business_context=$1 AND plan.execution_date BETWEEN $2::date AND $3::date AND NOT EXISTS (
                 SELECT 1 FROM costing_management_links l WHERE l.source_id=s.id AND l.business_context=s.business_context)`,
            [context, from, to]
        );
        const report = projectManagementPnl(links.rows, {
            finance: unlinkedFinance.rows[0], costingSourceCount: unlinkedEvidence.rows[0].count
        }, from, to);
        await client.query('COMMIT');
        res.json({ success: true, ...report });
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        fail(res, error, 'GET management P&L');
    } finally { client?.release(); }
});

module.exports = router;
