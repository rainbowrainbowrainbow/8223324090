'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const fixture = require('./fixtures/my-day-ai-composer-quality-evals.json');
const packageJson = require('../package.json');
const {
    MIN_CASES_PER_EFFORT,
    REQUIRED_CONFIRMATION,
    resolveReleaseSha,
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
        env: {
            TASK_AI_LIVE_EVAL_CONCURRENCY: '3',
            TASK_AI_LIVE_EVAL_RELEASE_SHA: '0f0ae742724b36f7e3b0d932911a003fbc963dea'
        },
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
    assert.equal(report.summary.releaseSha, '0f0ae742724b36f7e3b0d932911a003fbc963dea');
    assert.equal(report.summary.releaseVersion, packageJson.version);
    assert.equal(report.summary.schemaName, 'my_day_task_draft_preview');
    assert.equal(report.summary.promptVersion, fixture.promptVersion);
    assert.equal(report.summary.contractVersion, fixture.contractVersion);
    assert.equal(report.summary.efforts.low.successfulProposals, MIN_CASES_PER_EFFORT);
    assert.equal(report.summary.efforts.none.tokens.totalTokens, MIN_CASES_PER_EFFORT * 15);
    assert.equal(report.summary.efforts.low.partialWrites, 0);
    assert.equal(report.summary.passed, true);

    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /Safe CRM case/);
    assert.doesNotMatch(serialized, /not-a-real-key|OPENAI_API_KEY|proposalToken|providerResponse|"prompt":|"title":|"description":/i);
});

test('controlled eval release SHA resolver accepts only exact immutable commit ids', () => {
    assert.equal(resolveReleaseSha({
        TASK_AI_LIVE_EVAL_RELEASE_SHA: '0F0AE742724B36F7E3B0D932911A003FBC963DEA'
    }), '0f0ae742724b36f7e3b0d932911a003fbc963dea');
    assert.equal(resolveReleaseSha({
        TASK_AI_LIVE_EVAL_RELEASE_SHA: '0f0ae742',
        RELEASE_DEPLOY_COMMIT: '236d83dae4612de490a7f36972e2d13737f8bb63'
    }), '236d83dae4612de490a7f36972e2d13737f8bb63');
    assert.match(resolveReleaseSha({
        TASK_AI_LIVE_EVAL_RELEASE_SHA: 'not-a-sha',
        RELEASE_DEPLOY_COMMIT: 'also-not-a-sha'
    }), /^[0-9a-f]{40}$/);
});
