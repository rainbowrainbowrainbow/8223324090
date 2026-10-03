'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hourlyAmount, money, projectManagementPnl } = require('../services/costingManagement');

function earned(sourceId, financeId) {
    return { id: String(sourceId), source_id: String(sourceId), plan_id: '1', business_context: 'event_genix',
        entry_id: String(sourceId), active_entry_id: String(sourceId), evidence_state: 'confirmed',
        kind: 'earned_revenue', amount_minor: '10000', effect_on: '2026-10-12',
        performance_state: 'performed', performance_on: '2026-10-12', performance_evidence_type: 'operator',
        finance_transaction_id: String(financeId), finance_type: 'income', finance_amount_uah: '100',
        finance_business: 'event_genix', finance_booking_id: 'booking-1', booking_status: 'confirmed',
        booking_business: 'event_genix', payment_order_id: null };
}

test('hourly rounding is half-up in integer minor units and rejects overflow', () => {
    assert.equal(hourlyAmount('10001', 30), 5001n);
    assert.equal(hourlyAmount('10000', 90), 15000n);
    assert.throws(() => money('9223372036854775808'), /range/);
    assert.throws(() => hourlyAmount('9223372036854775807', 1440), /range/);
});

test('a finance transaction claimed twice is withheld from the management subtotal', () => {
    const report = projectManagementPnl([earned(1, 9), earned(2, 9)],
        { finance: { count: 0 }, costingSourceCount: 0 }, '2026-10-01', '2026-10-31');
    assert.equal(report.summary.earnedRevenueMinor, '0');
    assert.equal(report.lines.length, 0);
    assert.equal(report.unresolved.length, 2);
});

test('a corrected or voided execution fact cannot remain recognized', () => {
    const corrected = earned(1, 9);
    corrected.active_entry_id = '2';
    const voided = earned(2, 10);
    voided.performance_state = 'voided';
    const report = projectManagementPnl([corrected, voided],
        { finance: { count: 0 }, costingSourceCount: 0 }, '2026-10-01', '2026-10-31');
    assert.equal(report.summary.earnedRevenueMinor, '0');
    assert.equal(report.unresolved.length, 2);
});

test('invalid execution labor leaves the finance payroll expense at business level', () => {
    const row = { ...earned(1, 9), kind: 'piecework', amount_minor: '30000',
        finance_type: 'expense', finance_amount_uah: '1000', finance_date: '2026-10-12',
        payroll_installment_id: '4', payroll_report_id: '3', payroll_finance_id: '9',
        installment_status: 'approved', allocation_status: 'single', report_status: 'approved',
        installment_business: 'event_genix', locked_amount: '1000', performance_state: 'voided' };
    const report = projectManagementPnl([row],
        { finance: { count: 0 }, costingSourceCount: 0 }, '2026-10-01', '2026-10-31');
    assert.equal(report.summary.directCostMinor, '100000');
    assert.equal(report.lines.length, 1);
    assert.equal(report.lines[0].kind, 'unallocated_payroll');
    assert.equal(report.unresolved.length, 1);
});
