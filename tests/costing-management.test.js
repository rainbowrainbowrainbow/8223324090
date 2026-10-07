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
        booking_business: 'event_genix', execution_booking_id: 'booking-1', payment_order_id: null };
}

function hourly(sourceId, minutes, workedMinutes = 120) {
    return { ...earned(sourceId, 9), kind: 'hourly', amount_minor: String(minutes * 100),
        finance_type: 'expense', finance_amount_uah: '1000', finance_date: '2026-10-12',
        payroll_installment_id: '4', payroll_report_id: '3', payroll_finance_id: '9',
        installment_status: 'approved', allocation_status: 'single', report_status: 'approved',
        installment_business: 'event_genix', locked_amount: '1000', payroll_staff_id: 7,
        hr_time_record_id: '71', confirmed_minutes: minutes, hourly_rate_minor: '6000',
        time_business: 'event_genix', time_staff_id: 7, clock_out: '2026-10-12T12:00:00Z',
        auto_closed: false, worked_minutes: workedMinutes };
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

test('overallocated confirmed time withholds every hourly share and retains business payroll remainder', () => {
    const report = projectManagementPnl([hourly(1, 70), hourly(2, 70)],
        { finance: { count: 0 }, costingSourceCount: 0 }, '2026-10-01', '2026-10-31');
    assert.equal(report.lines.filter(item => item.kind === 'hourly').length, 0);
    assert.equal(report.lines.find(item => item.kind === 'unallocated_payroll').amountMinor, '100000');
    assert.equal(report.unresolved.length, 2);
    assert.ok(report.unresolved.every(item => item.issues.some(issue => /allocations exceed confirmed time/.test(issue))));
});

test('valid partial time shares contribute without crossing business boundaries', () => {
    const otherBusiness = { ...hourly(3, 120), business_context: 'dar', time_business: 'dar',
        finance_business: 'dar', installment_business: 'dar', hr_time_record_id: '71',
        finance_transaction_id: '10', payroll_finance_id: '10', payroll_installment_id: '5' };
    const report = projectManagementPnl([hourly(1, 60), hourly(2, 60), otherBusiness],
        { finance: { count: 0 }, costingSourceCount: 0 }, '2026-10-01', '2026-10-31');
    assert.equal(report.unresolved.length, 0);
    assert.equal(report.lines.filter(item => item.kind === 'hourly').length, 3);
});

test('an unresolved revision releases time while remaining visible in its effect period', () => {
    const released = { ...hourly(2, 60), kind: 'unresolved', finance_transaction_id: null };
    const report = projectManagementPnl([hourly(1, 60), released],
        { finance: { count: 0 }, costingSourceCount: 0 }, '2026-10-01', '2026-10-31');
    assert.equal(report.lines.filter(item => item.kind === 'hourly').length, 1);
    assert.deepEqual(report.unresolved.map(item => item.sourceId), ['2']);
    assert.ok(report.unresolved[0].issues.includes('Reconciliation explicitly unresolved'));
});

test('a preexisting misplaced unresolved revision reports in the prior hourly effect period', () => {
    const misplaced = { ...hourly(2, 60), kind: 'unresolved', finance_transaction_id: null,
        effect_on: '2026-11-12', prior_effect_kind: 'hourly', prior_effect_on: '2026-10-12' };
    const legacy = { finance: { count: 0 }, costingSourceCount: 0 };
    const october = projectManagementPnl([hourly(1, 60), misplaced], legacy, '2026-10-01', '2026-10-31');
    const november = projectManagementPnl([hourly(1, 60), misplaced], legacy, '2026-11-01', '2026-11-30');
    assert.deepEqual(october.unresolved.map(item => item.sourceId), ['2']);
    assert.equal(november.unresolved.length, 0);
});

test('out-of-period issues stay hidden while invalid originals still block in-period corrections', () => {
    const original = earned(1, 9);
    original.active_entry_id = '99';
    const correction = { ...earned(2, 10), kind: 'revenue_correction', amount_minor: '-2000',
        effect_on: '2026-11-20', semantic: 'adjustment', finance_transaction_id: null,
        original_link_id: '1', original_kind: 'earned_revenue', original_business: 'event_genix',
        original_plan_id: '1', original_amount_minor: '10000', original_revision_number: 1,
        original_active_revision: 1, original_entry_id: '1', original_active_entry_id: '1' };
    const report = projectManagementPnl([original, correction],
        { finance: { count: 0 }, costingSourceCount: 0 }, '2026-11-01', '2026-11-30');
    assert.deepEqual(report.unresolved.map(item => item.linkId), ['2']);
    assert.match(report.unresolved[0].issues.join(' '), /Original earned revenue/);
});

test('cross-period correction is withheld when original finance or source evidence drifts', () => {
    const original = earned(1, 9);
    const correction = { ...earned(2, 10), kind: 'revenue_correction', amount_minor: '-2000',
        effect_on: '2026-11-20', semantic: 'adjustment', finance_transaction_id: null,
        original_link_id: '1', original_kind: 'earned_revenue', original_business: 'event_genix',
        original_plan_id: '1', original_amount_minor: '10000', original_revision_number: 1,
        original_active_revision: 1, original_entry_id: '1', original_active_entry_id: '1' };
    const legacy = { finance: { count: 0 }, costingSourceCount: 0 };
    const report = rows => projectManagementPnl(rows, legacy, '2026-11-01', '2026-11-30');
    assert.equal(report([original, correction]).summary.earnedRevenueMinor, '-2000');
    assert.equal(report([correction, original]).summary.earnedRevenueMinor, '-2000');
    for (const changed of [{ finance_amount_uah: '90' }, { active_entry_id: '99' }]) {
        const invalid = report([{ ...original, ...changed }, correction]);
        assert.equal(invalid.summary.earnedRevenueMinor, '0');
        assert.equal(invalid.lines.length, 0);
        assert.equal(invalid.unresolved.length, 1);
        assert.ok(invalid.unresolved.find(item => item.linkId === '2').issues.some(issue => /Original earned revenue/.test(issue)));
    }
});
