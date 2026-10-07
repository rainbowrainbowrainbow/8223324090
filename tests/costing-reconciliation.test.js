'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { previewReconciliation, payrollAllocationCandidate } = require('../services/costingReconciliation');

test('read-only P&L bridge exposes unresolved recognition and never posts source candidates', () => {
    const result = previewReconciliation({ summary: { actualComplete: true, actualContributionMinor: '126000' }, sources: [
        { id: '1', source_system: 'manual', external_id: 'payment_b', economic_role: 'rental_sale',
            category: 'revenue', amount_minor: '200000', evidence_state: 'confirmed', semantic: 'charge' },
        { id: '2', source_system: 'manual', external_id: 'host_b', economic_role: 'host_pay',
            category: 'direct_cost', amount_minor: '30000', evidence_state: 'confirmed', semantic: 'cost' },
        { id: '3', source_system: 'manual', external_id: 'refund_b', economic_role: 'rental_refund',
            category: 'revenue', amount_minor: '-30000', evidence_state: 'confirmed', semantic: 'refund' }
    ] });
    assert.equal(result.postingAllowed, false);
    assert.ok(result.candidates.every(candidate => candidate.postingAllowed === false));
    assert.match(result.candidates[1].unresolved.join(' '), /Payroll earning allocation/);
    assert.match(result.candidates[2].unresolved.join(' '), /Refund recognition/);
});

test('payroll source-link proposal stays read-only and requires single-business execution allocation', () => {
    const report = { id: 41, status: 'approved' };
    const installment = { id: 52, workflow_status: 'approved', allocation_status: 'single', business_context: 'event_genix' };
    const unresolved = payrollAllocationCandidate(report, installment, { businessContext: 'dar', executionId: 7, earningShareMinor: '30000' });
    assert.equal(unresolved.contractComplete, false);
    assert.match(unresolved.unresolved.join(' '), /does not match/);
    const candidate = payrollAllocationCandidate(report, installment, { businessContext: 'event_genix', executionId: 7,
        earningShareMinor: '30000' });
    assert.equal(candidate.contractComplete, true);
    assert.equal(candidate.postingAllowed, false);
    assert.equal(candidate.suggestedCostMinor, '30000');
});
