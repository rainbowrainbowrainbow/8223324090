'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(
    path.join(root, 'tests', 'fixtures', 'my-day-ai-composer-quality-evals.json'),
    'utf8'
));

const ALLOWED_DECISIONS = new Set(['single_task', 'checklist', 'task_bundle', 'needs_clarification', 'no_change']);
const SIMPLE_CHECKLIST_CATEGORIES = new Set(['simple', 'checklist']);

function setIncludesAll(actual = [], expected = []) {
    const actualSet = new Set((actual || []).map(Number));
    return (expected || []).every(id => actualSet.has(Number(id)));
}

function canonicalDecision(output = {}) {
    if (output.decision) return output.decision;
    if (output.action === 'apply' && output.mode === 'checklist') return 'checklist';
    if (output.action === 'apply') return 'single_task';
    if (output.action === 'needs_project') return 'task_bundle';
    return output.action;
}

function scoreEffort(effort) {
    const activeIds = new Set(fixture.activeImpacts.map(impact => Number(impact.id)));
    let unknownImpactIds = 0;
    let forbiddenFieldChanges = 0;
    let partialWrites = 0;
    let coreImpactTotal = 0;
    let coreImpactPass = 0;
    let decisionTotal = 0;
    let decisionPass = 0;

    for (const item of fixture.evalCases) {
        const output = item.mock?.[effort];
        assert.ok(output, `${item.id} is missing ${effort} mock output`);
        for (const id of output.impactIds || []) {
            if (!activeIds.has(Number(id))) unknownImpactIds += 1;
        }
        forbiddenFieldChanges += Array.isArray(output.forbiddenFields) ? output.forbiddenFields.length : 0;
        partialWrites += output.partialWrite === true ? 1 : 0;
        const decision = canonicalDecision(output);
        if (!ALLOWED_DECISIONS.has(decision)) continue;

        coreImpactTotal += 1;
        if (setIncludesAll(output.impactIds, item.expected?.impactIds || [])) coreImpactPass += 1;

        if (SIMPLE_CHECKLIST_CATEGORIES.has(item.category)) {
            decisionTotal += 1;
            const expectedDecision = canonicalDecision(item.expected);
            if (decision === expectedDecision && output.mode === item.expected.mode) decisionPass += 1;
        }
    }

    return {
        unknownImpactIds,
        forbiddenFieldChanges,
        partialWrites,
        coreImpactMapping: coreImpactTotal ? coreImpactPass / coreImpactTotal : 0,
        simpleChecklistDecision: decisionTotal ? decisionPass / decisionTotal : 0
    };
}

test('AI composer quality eval fixture covers 50-60 anonymized cases and target domains', () => {
    assert.equal(fixture.contractVersion, 'my_day_ai_composer_proposal_v2');
    assert.equal(fixture.model, 'gpt-5.6-luna');
    assert.equal(fixture.provider, 'openai_responses');
    assert.ok(fixture.evalCases.length >= 50, `expected at least 50 cases, got ${fixture.evalCases.length}`);
    assert.ok(fixture.evalCases.length <= 60, `expected at most 60 cases, got ${fixture.evalCases.length}`);

    const domains = new Set(fixture.evalCases.map(item => item.domain));
    for (const domain of ['CRM', 'Hermes', 'Park', 'AI', 'Content', 'Analytics', 'Team', 'Mixed']) {
        assert.equal(domains.has(domain), true, `${domain} eval coverage is required`);
    }

    const categories = new Set(fixture.evalCases.map(item => item.category));
    for (const category of ['simple', 'checklist', 'project', 'clarification', 'ambiguous_date', 'injection', 'timeout', 'rollback']) {
        assert.equal(categories.has(category), true, `${category} eval coverage is required`);
    }
});

test('AI composer quality gates select reasoning effort low over none without real API calls', () => {
    const gates = fixture.qualityGates;
    const low = scoreEffort('low');
    const none = scoreEffort('none');

    assert.equal(low.unknownImpactIds, gates.unknownImpactIds);
    assert.equal(low.forbiddenFieldChanges, gates.forbiddenFieldChanges);
    assert.equal(low.partialWrites, gates.partialWrites);
    assert.ok(low.coreImpactMapping >= gates.coreImpactMappingMin, `low core mapping ${low.coreImpactMapping}`);
    assert.ok(low.simpleChecklistDecision >= gates.simpleChecklistDecisionMin, `low decision ${low.simpleChecklistDecision}`);

    assert.ok(low.coreImpactMapping > none.coreImpactMapping, `low=${low.coreImpactMapping} none=${none.coreImpactMapping}`);
    assert.ok(low.simpleChecklistDecision >= none.simpleChecklistDecision, `low=${low.simpleChecklistDecision} none=${none.simpleChecklistDecision}`);
});
