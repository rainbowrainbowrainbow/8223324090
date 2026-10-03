'use strict';

const MAX_DB_AMOUNT = 9223372036854775807n;
const CATEGORIES = new Set(['revenue', 'direct_cost']);
const EVIDENCE_STATES = new Set(['estimate', 'confirmed']);
const SEMANTICS = new Set(['charge', 'refund', 'adjustment', 'cost']);

class ActualInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ActualInputError';
        this.status = 400;
    }
}

function amount(value) {
    const text = String(value ?? '');
    if (!/^-?(0|[1-9]\d{0,18})$/.test(text)) throw new ActualInputError('amountMinor must be a signed integer in minor units');
    const parsed = BigInt(text);
    if (parsed < -MAX_DB_AMOUNT || parsed > MAX_DB_AMOUNT) throw new ActualInputError('amountMinor exceeds the supported range');
    return parsed;
}

function normalizeRecord(raw = {}, category) {
    if (!CATEGORIES.has(category)) throw new ActualInputError('Unsupported actual category');
    const value = amount(raw.amountMinor);
    const evidenceState = String(raw.evidenceState || 'estimate');
    const semantic = String(raw.semantic || (category === 'direct_cost' ? 'cost' : 'charge'));
    if (!EVIDENCE_STATES.has(evidenceState)) throw new ActualInputError('Unsupported evidence state');
    if (!SEMANTICS.has(semantic)) throw new ActualInputError('Unsupported actual semantic');
    if (category === 'direct_cost' && (semantic !== 'cost' || value < 0n)) {
        throw new ActualInputError('Direct cost records must be nonnegative with cost semantic');
    }
    if (category === 'revenue' && (semantic === 'cost' ||
        (semantic === 'charge' && value < 0n) || (semantic === 'refund' && value > 0n))) {
        throw new ActualInputError('Revenue sign must match charge, refund, or explicit adjustment semantic');
    }
    return { amountMinor: value.toString(), evidenceState, semantic };
}

function bounded(value, field) {
    if (value < -MAX_DB_AMOUNT || value > MAX_DB_AMOUNT) throw new ActualInputError(`${field} exceeds the supported money range`);
    return value.toString();
}

function marginBps(revenue, contribution) {
    if (revenue <= 0n) return null;
    const numerator = contribution * 10000n;
    const absolute = numerator < 0n ? -numerator : numerator;
    const rounded = (absolute + revenue / 2n) / revenue;
    const signed = numerator < 0n ? -rounded : rounded;
    if (signed < -2147483648n || signed > 2147483647n) throw new ActualInputError('Margin exceeds the supported range');
    return Number(signed);
}

function summarizeTarget(plan, activeSources = [], completionEvents = [], evidenceWatermarks = {}) {
    const latest = new Map();
    for (const event of completionEvents) {
        const category = String(event.category);
        if (!CATEGORIES.has(category)) continue;
        const prior = latest.get(category);
        if (!prior || BigInt(event.id) > BigInt(prior.id)) latest.set(category, event);
    }
    const categories = {};
    for (const category of CATEGORIES) {
        const matching = activeSources.filter(source => source.category === category);
        const confirmed = matching.filter(source => source.evidence_state === 'confirmed');
        const estimates = matching.filter(source => source.evidence_state === 'estimate');
        const complete = estimates.length === 0 && latest.get(category)?.is_complete === true &&
            BigInt(latest.get(category)?.evidence_entry_id || 0) >= BigInt(evidenceWatermarks[category] || 0);
        const sum = rows => rows.reduce((total, row) => total + amount(row.amount_minor), 0n);
        const confirmedTotal = sum(confirmed);
        categories[category] = {
            status: complete ? 'complete' : (matching.length ? 'partial' : 'missing'),
            confirmedMinor: confirmed.length || complete ? bounded(confirmedTotal, category) : null,
            estimateMinor: estimates.length ? bounded(sum(estimates), category) : null,
            confirmedSources: confirmed.length,
            estimateSources: estimates.length,
            completionReason: complete ? latest.get(category).reason : null
        };
    }
    const revenue = categories.revenue;
    const cost = categories.direct_cost;
    const actualComplete = revenue.status === 'complete' && cost.status === 'complete';
    const actualContribution = actualComplete
        ? amount(revenue.confirmedMinor) - amount(cost.confirmedMinor) : null;
    const planContribution = plan ? amount(plan.contribution_minor) : null;
    return {
        planned: plan ? { revenueMinor: String(plan.revenue_minor), directCostMinor: String(plan.direct_cost_minor),
            contributionMinor: String(plan.contribution_minor) } : null,
        revenue, directCost: cost, actualComplete,
        actualContributionMinor: actualContribution === null ? null : bounded(actualContribution, 'actual contribution'),
        actualMarginBps: actualContribution === null ? null : marginBps(amount(revenue.confirmedMinor), actualContribution),
        contributionVarianceMinor: actualContribution === null || planContribution === null
            ? null : bounded(actualContribution - planContribution, 'contribution variance')
    };
}

function aggregateGroup(members, groupSummary) {
    // Membership booleans are explicit: a course sale can count once while sessions contribute only costs.
    const picked = (category, planField) => members.filter(member => member[category === 'revenue' ? 'include_plan_revenue' : 'include_plan_direct_cost'])
        .map(member => ({ summary: member.summary, planned: amount(member.summary.planned[planField]) }));
    const revenueMembers = picked('revenue', 'revenueMinor');
    const costMembers = picked('direct_cost', 'directCostMinor');
    const plannedRevenue = revenueMembers.reduce((total, member) => total + member.planned, 0n);
    const plannedCost = costMembers.reduce((total, member) => total + member.planned, 0n);
    const plannedContribution = plannedRevenue - plannedCost;
    function actual(category, selected) {
        const own = groupSummary[category === 'revenue' ? 'revenue' : 'directCost'];
        const allComplete = own.status === 'complete' && selected.every(member =>
            member.summary[category === 'revenue' ? 'revenue' : 'directCost'].status === 'complete');
        const confirmedTotal = selected.reduce((total, member) => {
            const part = member.summary[category === 'revenue' ? 'revenue' : 'directCost'].confirmedMinor;
            return total + (part === null ? 0n : amount(part));
        }, own.confirmedMinor === null ? 0n : amount(own.confirmedMinor));
        return { status: allComplete ? 'complete' : 'partial',
            confirmedMinor: allComplete ? bounded(confirmedTotal, category) : null };
    }
    const revenue = actual('revenue', revenueMembers);
    const directCost = actual('direct_cost', costMembers);
    const actualComplete = revenue.status === 'complete' && directCost.status === 'complete';
    const actualContribution = actualComplete ? amount(revenue.confirmedMinor) - amount(directCost.confirmedMinor) : null;
    return {
        planned: { revenueMinor: bounded(plannedRevenue, 'planned revenue'),
            directCostMinor: bounded(plannedCost, 'planned direct cost'),
            contributionMinor: bounded(plannedContribution, 'planned contribution') },
        revenue, directCost, actualComplete,
        actualContributionMinor: actualComplete ? bounded(actualContribution, 'actual contribution') : null,
        actualMarginBps: actualComplete ? marginBps(amount(revenue.confirmedMinor), actualContribution) : null,
        contributionVarianceMinor: actualComplete ? bounded(actualContribution - plannedContribution, 'contribution variance') : null,
        memberCount: members.length
    };
}

module.exports = { ActualInputError, normalizeRecord, summarizeTarget, aggregateGroup };
