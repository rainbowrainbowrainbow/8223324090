'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const fixturePath = path.join(root, 'tests', 'fixtures', 'my-day-ai-composer-evals.json');
const bundleFixturePath = path.join(root, 'tests', 'fixtures', 'my-day-ai-bundle-preview-evals.json');
const contractPath = path.join(root, 'docs', 'MY_DAY_AI_COMPOSER_PROPOSAL_CONTRACT.md');
const preview = require('../services/taskAiDraftPreview');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function expectedDecision(expected = {}) {
    if (expected.decision) return expected.decision;
    if (expected.action === 'apply' && expected.mode === 'checklist') return 'checklist';
    if (expected.action === 'apply') return 'single_task';
    if (expected.action === 'needs_project') return 'task_bundle';
    return expected.action;
}

test('My Day AI composer proposal contract fixture is strict and impacts-only', () => {
    const fixture = readJson(fixturePath);
    const schema = preview.TASK_AI_DRAFT_PREVIEW_SCHEMA;

    assert.equal(fixture.contractVersion, preview.TASK_AI_DRAFT_CONTRACT_VERSION);
    assert.equal(fixture.provider, 'openai_responses');
    assert.equal(fixture.model, 'gpt-5.6-luna');
    assert.deepEqual(fixture.allowedDecisions, ['single_task', 'checklist', 'task_bundle', 'needs_clarification', 'no_change']);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, [
        'decision',
        'mode',
        'title',
        'description',
        'impactIds',
        'subtasks',
        'bundleTitle',
        'tasks',
        'confidence',
        'reason'
    ]);
    assert.deepEqual(schema.properties.decision.enum, fixture.allowedDecisions);
    assert.deepEqual(schema.properties.mode.enum, ['simple', 'checklist', null]);
    assert.equal(schema.properties.impactIds.maxItems, 3);
    assert.equal(Object.hasOwn(schema.properties.impactIds, 'uniqueItems'), false);
    assert.equal(schema.properties.subtasks.maxItems, 7);
    assert.equal(schema.properties.subtasks.items.additionalProperties, false);
    assert.equal(schema.properties.tasks.maxItems, 6);
    assert.equal(schema.properties.tasks.items.additionalProperties, false);
    assert.equal(schema.properties.tasks.items.properties.impactIds.maxItems, 3);
    assert.equal(Object.hasOwn(schema.properties.tasks.items.properties.impactIds, 'uniqueItems'), false);
    assert.deepEqual(schema.properties.tasks.items.required, [
        'title',
        'description',
        'impactIds',
        'priority',
        'dueDate',
        'ownerSuggestion',
        'confidence'
    ]);
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
});

test('My Day AI composer eval fixture covers target domains and safe action decisions', () => {
    const fixture = readJson(fixturePath);
    const activeImpactIds = new Set(fixture.activeImpacts.map(impact => impact.id));
    const domains = new Set(fixture.evalCases.map(item => item.domain));

    for (const domain of ['CRM', 'Hermes', 'Park', 'AI', 'Content', 'Analytics', 'Team']) {
        assert.equal(domains.has(domain), true, `${domain} eval case is required`);
    }
    for (const decision of fixture.allowedDecisions) {
        assert.equal(
            fixture.evalCases.some(item => expectedDecision(item.expected) === decision),
            true,
            `${decision} eval case is required`
        );
    }

    for (const item of fixture.evalCases) {
        assert.ok(item.id);
        assert.ok(item.input?.title);
        assert.equal(fixture.allowedDecisions.includes(expectedDecision(item.expected)), true, `${item.id} has known decision`);
        assert.ok(['simple', 'checklist', null].includes(item.expected.mode), `${item.id} has known mode`);
        assert.ok(Number.isInteger(item.expected.subtasksMin), `${item.id} has numeric subtask minimum`);
        assert.ok(item.expected.subtasksMin <= fixture.limits.maxSubtasks, `${item.id} respects max subtasks`);
        for (const impactId of item.expected.impactIdsMustInclude || []) {
            assert.equal(activeImpactIds.has(impactId), true, `${item.id} references active impact ${impactId}`);
        }
    }
});

test('My Day AI bundle preview eval fixture covers target bundle domains and safety cases', () => {
    const fixture = readJson(bundleFixturePath);
    const activeImpactIds = new Set(fixture.activeImpacts.map(impact => impact.id));
    const domains = new Set(fixture.evalCases.map(item => item.domain));

    assert.equal(fixture.contractVersion, preview.TASK_AI_DRAFT_CONTRACT_VERSION);
    assert.deepEqual(fixture.allowedDecisions, ['single_task', 'checklist', 'task_bundle', 'needs_clarification', 'no_change']);
    assert.equal(fixture.limits.minBundleTasks, 2);
    assert.equal(fixture.limits.maxBundleTasks, 6);
    assert.ok(fixture.evalCases.length >= 30, 'bundle eval fixture must include at least 30 cases');
    assert.ok(fixture.evalCases.length <= 40, 'bundle eval fixture must stay small enough for review');
    for (const domain of [
        'CRM',
        'CRM_Hermes',
        'Hermes',
        'Park',
        'AI',
        'Content',
        'Analytics',
        'Team',
        'Mixed',
        'SingleTask',
        'Checklist',
        'NoChange',
        'Ambiguous',
        'Injection',
        'Operations'
    ]) {
        assert.equal(domains.has(domain), true, `${domain} bundle eval case is required`);
    }
    for (const decision of fixture.allowedDecisions) {
        assert.equal(
            fixture.evalCases.some(item => item.expected.decision === decision),
            true,
            `${decision} bundle eval case is required`
        );
    }

    for (const item of fixture.evalCases) {
        assert.ok(item.id);
        assert.ok(item.input?.title);
        assert.equal(fixture.allowedDecisions.includes(item.expected.decision), true, `${item.id} has known decision`);
        if (item.expected.decision === 'task_bundle') {
            assert.ok(item.expected.taskCountMin >= fixture.limits.minBundleTasks, `${item.id} respects min bundle tasks`);
            assert.ok(item.expected.taskCountMax <= fixture.limits.maxBundleTasks, `${item.id} respects max bundle tasks`);
        }
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
