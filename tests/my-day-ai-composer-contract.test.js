'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'tests', 'fixtures', 'my-day-ai-composer-evals.json');
const contractPath = path.join(root, 'docs', 'MY_DAY_AI_COMPOSER_PROPOSAL_CONTRACT.md');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('My Day AI composer proposal contract fixture is strict and impacts-only', () => {
    const fixture = readJson(fixturePath);
    const schema = fixture.schema;

    assert.equal(fixture.contractVersion, 'my_day_ai_composer_proposal_v1');
    assert.equal(fixture.provider, 'openai_responses');
    assert.equal(fixture.model, 'gpt-5.6-luna');
    assert.deepEqual(fixture.allowedActions, ['apply', 'needs_clarification', 'needs_project', 'no_change']);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, [
        'action',
        'mode',
        'title',
        'description',
        'impactIds',
        'subtasks',
        'confidence',
        'reason'
    ]);
    assert.deepEqual(schema.properties.action.enum, fixture.allowedActions);
    assert.deepEqual(schema.properties.mode.enum, ['simple', 'checklist', null]);
    assert.equal(schema.properties.impactIds.maxItems, 3);
    assert.equal(schema.properties.impactIds.uniqueItems, true);
    assert.equal(schema.properties.subtasks.maxItems, 7);
    assert.equal(schema.properties.subtasks.items.additionalProperties, false);
    assert.equal(schema.properties.confidence.additionalProperties, false);
    assert.deepEqual(schema.properties.confidence.required, [
        'overall',
        'title',
        'description',
        'impacts',
        'subtasks',
        'mode'
    ]);
    assert.equal(Object.hasOwn(schema.properties, 'tags'), false);
    assert.equal(Object.hasOwn(schema.properties, 'directions'), false);
    assert.equal(Object.hasOwn(schema.properties, 'dependencies'), false);
    assert.equal(Object.hasOwn(schema.properties, 'priority'), false);
    assert.equal(Object.hasOwn(schema.properties, 'deadline'), false);
    assert.equal(Object.hasOwn(schema.properties, 'assignee'), false);
});

test('My Day AI composer eval fixture covers target domains and safe action decisions', () => {
    const fixture = readJson(fixturePath);
    const activeImpactIds = new Set(fixture.activeImpacts.map(impact => impact.id));
    const domains = new Set(fixture.evalCases.map(item => item.domain));

    for (const domain of ['CRM', 'Hermes', 'Park', 'AI', 'Content', 'Analytics', 'Team']) {
        assert.equal(domains.has(domain), true, `${domain} eval case is required`);
    }
    for (const action of fixture.allowedActions) {
        assert.equal(
            fixture.evalCases.some(item => item.expected.action === action),
            true,
            `${action} eval case is required`
        );
    }

    for (const item of fixture.evalCases) {
        assert.ok(item.id);
        assert.ok(item.input?.title);
        assert.equal(fixture.allowedActions.includes(item.expected.action), true, `${item.id} has known action`);
        assert.ok(['simple', 'checklist', null].includes(item.expected.mode), `${item.id} has known mode`);
        assert.ok(Number.isInteger(item.expected.subtasksMin), `${item.id} has numeric subtask minimum`);
        assert.ok(item.expected.subtasksMin <= fixture.limits.maxSubtasks, `${item.id} respects max subtasks`);
        for (const impactId of item.expected.impactIdsMustInclude || []) {
            assert.equal(activeImpactIds.has(impactId), true, `${item.id} references active impact ${impactId}`);
        }
    }
});

test('My Day AI composer contract documents preview/commit and current rail split', () => {
    const doc = fs.readFileSync(contractPath, 'utf8');

    assert.match(doc, /POST \/api\/tasks\/ai-draft\/preview/);
    assert.match(doc, /POST \/api\/tasks\/ai-draft\/commit/);
    assert.match(doc, /gpt-5\.6-luna/);
    assert.match(doc, /Responses API/);
    assert.match(doc, /Structured Outputs/);
    assert.match(doc, /decompose-draft/);
    assert.match(doc, /compatibility wrapper/);
    assert.match(doc, /signed proposal token/);
    assert.match(doc, /field masks/);
    assert.match(doc, /Quality gates/);
    assert.doesNotMatch(doc, /OPENAI_API_KEY=.*|OPENROUTER_API_KEY=.*/);
});
