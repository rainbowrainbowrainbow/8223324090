'use strict';

const MAX_MINOR = 9223372036854775807n;

class ManagementInputError extends Error {
    constructor(message) { super(message); this.name = 'ManagementInputError'; this.status = 400; }
}

function positiveId(value, field = 'ID') {
    const text = String(value ?? '');
    if (!/^[1-9]\d{0,17}$/.test(text)) throw new ManagementInputError(`${field} must be a positive ID`);
    return text;
}

function revision(value) {
    if (!/^(0|[1-9]\d*)$/.test(String(value ?? '')) || Number(value) > 2147483646) {
        throw new ManagementInputError('expectedRevision must be a nonnegative integer');
    }
    return Number(value);
}

function date(value, field = 'date') {
    const text = String(value ?? '');
    const parsed = new Date(`${text}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== text) throw new ManagementInputError(`${field} must be YYYY-MM-DD`);
    return text;
}

function reason(value) {
    const text = String(value ?? '').trim();
    if (!text || text.length > 300) throw new ManagementInputError('reason must be 1–300 characters');
    return text;
}

function money(value, field = 'amount') {
    const text = String(value ?? '');
    if (!/^-?(0|[1-9]\d{0,18})$/.test(text) || BigInt(text) > MAX_MINOR || BigInt(text) < -MAX_MINOR) {
        throw new ManagementInputError(`${field} must be integer minor UAH within BIGINT range`);
    }
    return BigInt(text);
}

function hourlyAmount(rateMinor, minutes) {
    const rate = money(rateMinor, 'hourly rate');
    if (rate < 0n || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
        throw new ManagementInputError('Hourly rate/minutes are invalid');
    }
    const result = (rate * BigInt(minutes) + 30n) / 60n;
    if (result > MAX_MINOR) throw new ManagementInputError('Hourly amount exceeds supported range');
    return result;
}

function bounded(total, field) {
    if (total < -MAX_MINOR || total > MAX_MINOR) throw new ManagementInputError(`${field} exceeds supported range`);
    return total.toString();
}

function projectManagementPnl(rows, legacy, from, to) {
    const inPeriod = value => value >= from && value <= to;
    const lines = [];
    const unresolved = [];
    const payroll = new Map();
    const financeClaims = new Map();
    const refundClaims = new Map();
    const correctionClaims = new Map();
    const installmentClaims = new Map();
    for (const row of rows) {
        if (['piecework', 'hourly'].includes(row.kind) && row.finance_transaction_id &&
            row.finance_type === 'expense' && row.finance_business === row.business_context &&
            row.finance_amount_uah !== null) {
            const key = String(row.finance_transaction_id);
            if (!payroll.has(key)) payroll.set(key, { financeTransactionId: key,
                total: money(row.finance_amount_uah) * 100n, financeDate: row.finance_date, allocated: 0n });
        }
        if (['piecework', 'hourly'].includes(row.kind) && row.payroll_installment_id) {
            const key = String(row.payroll_installment_id);
            installmentClaims.set(key, (installmentClaims.get(key) || 0n) + money(row.amount_minor));
        }
        if (row.kind === 'revenue_correction' && row.original_link_id) {
            const key = String(row.original_link_id);
            correctionClaims.set(key, (correctionClaims.get(key) || 0n) - money(row.amount_minor));
        }
        if (row.kind === 'revenue_correction' && row.payment_refund_id) {
            const key = String(row.payment_refund_id);
            refundClaims.set(key, (refundClaims.get(key) || 0) + 1);
        }
        if (!row.finance_transaction_id || row.kind === 'unresolved') continue;
        const key = String(row.finance_transaction_id);
        const claims = financeClaims.get(key) || [];
        claims.push(row);
        financeClaims.set(key, claims);
    }
    let revenue = 0n;
    let cost = 0n;
    for (const row of rows) {
        const issues = [];
        if (row.kind === 'unresolved') issues.push('Reconciliation explicitly unresolved');
        if (String(row.entry_id) !== String(row.active_entry_id) || row.evidence_state !== 'confirmed') {
            issues.push('Confirmed evidence changed or is no longer active');
        }
        if (row.kind === 'earned_revenue' || row.kind === 'revenue_correction') {
            if (row.performance_state !== 'performed' || row.performance_on !== row.effect_on && row.kind === 'earned_revenue') {
                issues.push('Execution performance is absent, voided, or changed');
            }
            if (row.performance_evidence_type === 'attendance' &&
                (row.attendance_status !== 'present' || row.attendance_business !== row.business_context ||
                 row.attendance_booking_business !== row.business_context ||
                 row.attendance_date !== row.performance_on)) {
                issues.push('Present attendance evidence changed');
            }
        }
        if (row.finance_transaction_id) {
            if (!row.finance_type || row.finance_business !== row.business_context) issues.push('Linked finance transaction is missing or outside this business');
            const claims = financeClaims.get(String(row.finance_transaction_id)) || [];
            if (claims.length > 1 && claims.some(claim => !['piecework', 'hourly'].includes(claim.kind))) {
                issues.push('Finance transaction is claimed by multiple economic operations');
            }
            if (claims.every(claim => ['piecework', 'hourly'].includes(claim.kind)) && row.finance_amount_uah !== null &&
                claims.reduce((total, claim) => total + money(claim.amount_minor), 0n) > money(row.finance_amount_uah) * 100n) {
                issues.push('Payroll allocations exceed finance expense');
            }
        }
        if (row.kind === 'earned_revenue' && (row.finance_type !== 'income' || money(row.finance_amount_uah ?? '0') * 100n !== money(row.amount_minor))) {
            issues.push('Earned revenue does not match the linked finance income');
        }
        if (row.kind === 'earned_revenue' && (row.booking_business !== row.business_context ||
            ['cancelled', 'preliminary'].includes(String(row.booking_status).toLowerCase()) || !row.booking_status ||
            row.payment_order_id && (row.payment_business !== row.business_context ||
                row.payment_order_type !== 'booking' || row.payment_source_id !== row.finance_booking_id))) {
            issues.push('Canonical booking or cash reference changed');
        }
        if (row.kind === 'direct_cost' && (row.finance_type !== 'expense' || money(row.finance_amount_uah ?? '0') * 100n !== money(row.amount_minor))) {
            issues.push('Direct cost does not match the linked finance expense');
        }
        if (row.kind === 'direct_cost' && row.finance_date !== row.effect_on) issues.push('Finance cost recognition date changed');
        if (['piecework', 'hourly'].includes(row.kind)) {
            if (row.performance_state !== 'performed' || row.performance_on !== row.effect_on) {
                issues.push('Execution performance changed after labor allocation');
            }
            if (row.finance_type !== 'expense' || !row.payroll_report_id ||
                row.payroll_finance_id !== row.finance_transaction_id || row.installment_status !== 'approved' ||
                row.allocation_status !== 'single' || !['approved', 'paid'].includes(row.report_status) ||
                row.installment_business !== row.business_context) issues.push('Payroll approval, business, or finance link changed');
            if (row.locked_amount === null ||
                installmentClaims.get(String(row.payroll_installment_id)) > money(row.locked_amount) * 100n) {
                issues.push('Labor allocations exceed the approved installment');
            }
            if (row.kind === 'hourly') {
                let hourlyValid = false;
                try {
                    hourlyValid = row.time_business === row.business_context && !!row.clock_out && !row.auto_closed &&
                        Number(row.worked_minutes) === Number(row.confirmed_minutes) &&
                        row.time_staff_id === row.payroll_staff_id &&
                        hourlyAmount(row.hourly_rate_minor, Number(row.confirmed_minutes)) === money(row.amount_minor);
                } catch (_error) { hourlyValid = false; }
                if (!hourlyValid) issues.push('Confirmed hourly time or amount changed');
            }
        }
        if (row.kind === 'revenue_correction') {
            if (!row.original_kind || row.original_kind !== 'earned_revenue' ||
                row.original_business !== row.business_context || row.original_plan_id !== row.plan_id ||
                row.original_active_revision !== row.original_revision_number ||
                String(row.original_entry_id) !== String(row.original_active_entry_id) ||
                money(row.amount_minor) >= 0n || money(row.amount_minor) < -money(row.original_amount_minor) ||
                correctionClaims.get(String(row.original_link_id)) > money(row.original_amount_minor)) {
                issues.push('Original earned-revenue link is missing or correction is too large');
            }
            if (row.semantic === 'refund' && (!['money_refunded', 'fiscal_returned'].includes(row.refund_status) ||
                row.refund_business !== row.business_context || row.refund_order_id !== row.original_payment_order_id ||
                money(row.refund_amount_minor ?? '0') < -money(row.amount_minor) ||
                refundClaims.get(String(row.payment_refund_id)) !== 1)) {
                issues.push('Refund is not linked to the original payment');
            }
        }
        if (issues.length) {
            unresolved.push({ linkId: row.id, sourceId: row.source_id, issues });
            continue;
        }
        if (['piecework', 'hourly'].includes(row.kind)) {
            const key = String(row.finance_transaction_id);
            payroll.get(key).allocated += money(row.amount_minor);
        }
        if (!inPeriod(row.effect_on)) continue;
        const amount = money(row.amount_minor);
        if (['earned_revenue', 'revenue_correction'].includes(row.kind)) revenue += amount;
        else cost += amount;
        lines.push({ linkId: row.id, sourceId: row.source_id, kind: row.kind,
            effectOn: row.effect_on, amountMinor: amount.toString(),
            financeTransactionId: row.finance_transaction_id || null,
            provenance: row.kind === 'revenue_correction' ? 'explicit_correction' : 'linked_finance_transaction' });
    }
    for (const item of payroll.values()) {
        if (item.allocated > item.total) {
            unresolved.push({ financeTransactionId: item.financeTransactionId, issues: ['Payroll allocations exceed finance expense'] });
            continue;
        }
        const remainder = item.total - item.allocated;
        if (remainder > 0n && inPeriod(item.financeDate)) {
            cost += remainder;
            lines.push({ kind: 'unallocated_payroll', effectOn: item.financeDate,
                amountMinor: remainder.toString(), financeTransactionId: item.financeTransactionId,
                provenance: 'finance_transaction_business_level' });
        }
    }
    return { period: { from, to }, summary: { earnedRevenueMinor: bounded(revenue, 'revenue'),
        directCostMinor: bounded(cost, 'cost'), contributionMinor: bounded(revenue - cost, 'contribution') },
    lines, unresolved, legacyUnlinked: legacy, scope: 'linked_operations_only',
    note: 'Unlinked legacy finance rows and manual/estimated costing sources are not added to these totals.' };
}

module.exports = { ManagementInputError, positiveId, revision, date, reason, money, hourlyAmount, projectManagementPnl };
