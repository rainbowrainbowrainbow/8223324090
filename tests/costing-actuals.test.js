'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ActualInputError, normalizeRecord, summarizeTarget, aggregateGroup } = require('../services/costingActuals');

const plan = { revenue_minor: '200000', direct_cost_minor: '72000', contribution_minor: '128000' };
const source = (category, amount_minor, evidence_state = 'confirmed') => ({ category, amount_minor, evidence_state });
const complete = (id, category) => ({ id: String(id), category, is_complete: true, reason: 'Reconciled synthetic evidence' });

test('missing and estimated actuals never become a completed profit or a false zero', () => {
    const empty = summarizeTarget(plan);
    assert.equal(empty.revenue.status, 'missing');
    assert.equal(empty.revenue.confirmedMinor, null);
    assert.equal(empty.actualContributionMinor, null);
    const partial = summarizeTarget(plan, [source('revenue', '200000'), source('direct_cost', '28000', 'estimate')]);
    assert.equal(partial.revenue.status, 'partial');
    assert.equal(partial.directCost.estimateMinor, '28000');
    assert.equal(partial.directCost.confirmedMinor, null);
    assert.equal(partial.actualContributionMinor, null);
    assert.equal(summarizeTarget(plan, [source('direct_cost', '28000', 'estimate')], [complete(1, 'direct_cost')]).directCost.status, 'partial');
    const deliberateZero = summarizeTarget(plan, [], [complete(1, 'revenue'), complete(2, 'direct_cost')]);
    assert.equal(deliberateZero.revenue.confirmedMinor, '0');
    assert.equal(deliberateZero.actualContributionMinor, '0');
});

test('rental host estimate is replaced by confirmed payroll evidence only after completion', () => {
    const evidence = [source('revenue', '200000'), source('direct_cost', '18000'),
        source('direct_cost', '30000'), source('direct_cost', '18000'), source('direct_cost', '8000')];
    const result = summarizeTarget(plan, evidence, [complete(1, 'revenue'), complete(2, 'direct_cost')]);
    assert.equal(result.directCost.confirmedMinor, '74000');
    assert.equal(result.actualContributionMinor, '126000');
    assert.equal(result.contributionVarianceMinor, '-2000');
});

test('negative and zero revenue require explicit semantics; cost records cannot be negative', () => {
    assert.deepEqual(normalizeRecord({ amountMinor: '-30000', evidenceState: 'confirmed', semantic: 'refund' }, 'revenue'),
        { amountMinor: '-30000', evidenceState: 'confirmed', semantic: 'refund' });
    assert.equal(normalizeRecord({ amountMinor: '0', semantic: 'adjustment' }, 'revenue').amountMinor, '0');
    assert.throws(() => normalizeRecord({ amountMinor: '-30000', semantic: 'charge' }, 'revenue'), ActualInputError);
    assert.throws(() => normalizeRecord({ amountMinor: '-30000', semantic: 'cost' }, 'direct_cost'), ActualInputError);
    const refunded = summarizeTarget(plan, [source('revenue', '10000'), source('revenue', '-30000'), source('direct_cost', '1000')],
        [complete(1, 'revenue'), complete(2, 'direct_cost')]);
    assert.equal(refunded.revenue.confirmedMinor, '-20000');
    assert.equal(refunded.actualContributionMinor, '-21000');
});

test('course/day group includes package revenue once and session costs once', () => {
    const make = (revenue, cost) => summarizeTarget({ revenue_minor: String(revenue), direct_cost_minor: String(cost),
        contribution_minor: String(revenue - cost) }, [source('revenue', String(revenue)), source('direct_cost', String(cost))],
    [complete(1, 'revenue'), complete(2, 'direct_cost')]);
    const members = [
        { include_plan_revenue: true, include_plan_direct_cost: false, summary: make(100000, 0) },
        { include_plan_revenue: false, include_plan_direct_cost: true, summary: make(50000, 20000) },
        { include_plan_revenue: false, include_plan_direct_cost: true, summary: make(50000, 30000) }
    ];
    const own = summarizeTarget(null, [], [complete(1, 'revenue'), complete(2, 'direct_cost')]);
    const group = aggregateGroup(members, own);
    assert.equal(group.planned.revenueMinor, '100000');
    assert.equal(group.planned.directCostMinor, '50000');
    assert.equal(group.actualContributionMinor, '50000');
});
