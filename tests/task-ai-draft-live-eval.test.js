'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const fixture = require('./fixtures/my-day-ai-composer-quality-evals.json');
const {
    MIN_CASES_PER_EFFORT,
    REQUIRED_CONFIRMATION,
    runControlledEval,
    validateOperatorEnvironment
} = require('../scripts/task-ai-draft-live-eval');

test('operator live eval requires explicit confirmation and never runs in CI/test', () => {
    assert.throws(() => validateOperatorEnvironment({
        CI: 'true',
        OPENAI_API_KEY: 'not-a-real-key',
        TASK_AI_LIVE_EVAL_CONFIRM: REQUIRED_CONFIRMATION
    }, fixture), /forbidden in CI\/test/);
    assert.throws(() => validateOperatorEnvironment({
        OPENAI_API_KEY: 'not-a-real-key'
    }, fixture), /TASK_AI_LIVE_EVAL_CONFIRM/);
    assert.doesNotThrow(() => validateOperatorEnvironment({
        OPENAI_API_KEY: 'not-a-real-key',
        TASK_AI_LIVE_EVAL_CONFIRM: REQUIRED_CONFIRMATION
    }, fixture));
    assert.ok(fixture.evalCases.length >= MIN_CASES_PER_EFFORT);
});

test('quality fixture contains readable Ukrainian instead of mojibake', () => {
    const serializedInputs = fixture.evalCases
        .map(item => `${item.input?.title || ''} ${item.input?.description || ''}`)
        .join('\n');
    assert.match(serializedInputs, /Виправити форму бронювання в CRM/);
    assert.doesNotMatch(serializedInputs, /Р[’СЂ]/);
    assert.equal(fixture.activeImpacts[0].name, 'Робота: CRM');
    assert.ok(fixture.evalCases.some(item => item.expected?.coreImpactIds?.length > 1), 'mixed work must declare every required core context');
});

test('controlled eval scores low and none with injected transport and no real OpenAI call', async () => {
    const smallFixture = {
        ...fixture,
        qualityGates: {
            unknownImpactIds: 0,
            forbiddenFieldChanges: 0,
            partialWrites: 0,
            coreImpactMappingMin: 1,
            simpleChecklistDecisionMin: 1
        },
        evalCases: Array.from({ length: MIN_CASES_PER_EFFORT }, (_, index) => ({
            id: `case_${index + 1}`,
            domain: 'CRM',
            category: index % 2 === 0 ? 'simple' : 'checklist',
            input: { title: `Safe CRM case ${index + 1}`, description: '' },
            expected: {
                action: 'apply',
                mode: index % 2 === 0 ? 'simple' : 'checklist',
                impactIds: [101]
            }
        }))
    };
    let calls = 0;
    const report = await runControlledEval({
        fixture: smallFixture,
        efforts: ['low', 'none'],
        env: { TASK_AI_LIVE_EVAL_CONCURRENCY: '3' },
        preview: async (_input, options) => {
            calls += 1;
            const caseNumber = Number(_input.draft.title.match(/\d+$/)?.[0] || 0);
            const isSimple = caseNumber % 2 === 1;
            return {
                ok: true,
                proposal: {
                    decision: options.reasoningEffort === 'low' || options.reasoningEffort === 'none'
                        ? (isSimple ? 'single_task' : 'checklist')
                        : null,
                    mode: isSimple ? 'simple' : 'checklist',
                    impactIds: [101],
                    tasks: []
                },
                usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
            };
        }
    });

    assert.equal(calls, MIN_CASES_PER_EFFORT * 2);
    assert.equal(report.summary.efforts.low.successfulProposals, MIN_CASES_PER_EFFORT);
    assert.equal(report.summary.efforts.none.tokens.totalTokens, MIN_CASES_PER_EFFORT * 15);
    assert.equal(report.summary.efforts.low.partialWrites, 0);
    assert.equal(report.summary.passed, true);
});
