'use strict';

// Read-only bridge. No entry returned here is eligible for automatic P&L posting.
function previewReconciliation(detail) {
    const summary = detail.summary;
    const candidates = detail.sources.map(source => {
        const unresolved = [];
        if (source.evidence_state !== 'confirmed') unresolved.push('Source is only an estimate');
        if (source.source_system === 'manual') unresolved.push('Manual assertion has no verified canonical source link');
        if (source.category === 'revenue') {
            unresolved.push(source.semantic === 'refund'
                ? 'Refund recognition and reversal policy is not mapped'
                : 'Booking, payment, and subscription revenue recognition are not mapped');
        } else {
            unresolved.push('Expense posting source and allocation are not mapped');
            if (/payroll|staff|host|teacher/.test(source.economic_role)) {
                unresolved.push('Payroll earning allocation and existing finance-posting deduplication are not mapped');
            }
        }
        return { sourceId: source.id, sourceSystem: source.source_system, externalId: source.external_id,
            economicRole: source.economic_role, category: source.category, amountMinor: source.amount_minor,
            evidenceState: source.evidence_state, semantic: source.semantic,
            postingAllowed: false, unresolved };
    });
    return { postingAllowed: false, actualComplete: summary.actualComplete,
        actualContributionMinor: summary.actualContributionMinor, candidates,
        decisionsRequired: [
            'Choose earned-revenue recognition for bookings, direct payments, and subscriptions.',
            'Choose refund/reversal dates and treatment of negative revenue.',
            'Choose execution allocation and existing finance-posting deduplication for payroll and shared costs.'
        ] };
}

function payrollAllocationCandidate(report, installment, allocation) {
    const unresolved = [];
    if (!report || !installment) unresolved.push('Payroll report and installment evidence are both required');
    if (report && !['approved', 'paid'].includes(report.status)) unresolved.push('Payroll report is not approved');
    if (installment && (installment.workflow_status !== 'approved' || installment.allocation_status !== 'single')) {
        unresolved.push('Payroll installment is not approved and allocated to one business');
    }
    if (installment && (!allocation?.businessContext || allocation.businessContext !== installment.business_context)) {
        unresolved.push('Execution business does not match the payroll allocation');
    }
    if (!allocation?.executionId || !allocation?.earningShareMinor) unresolved.push('Execution-level earning allocation is absent');
    if (installment?.finance_transaction_id || report?.finance_transaction_id) {
        unresolved.push('Existing finance transaction needs explicit deduplication before P&L use');
    }
    return { sourceSystem: 'payroll', reportId: report?.id || null, installmentId: installment?.id || null,
        businessContext: installment?.business_context || null, executionId: allocation?.executionId || null,
        suggestedCostMinor: allocation?.earningShareMinor || null,
        contractComplete: unresolved.length === 0,
        postingAllowed: false, unresolved };
}

module.exports = { previewReconciliation, payrollAllocationCandidate };
