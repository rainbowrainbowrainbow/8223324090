'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const preview = require('../services/taskAiDraftPreview');
const openAIClient = require('../services/myDayTaskOpenAIClient');
const telemetry = require('../services/taskAiDraftTelemetry');

const impacts = [
    { id: 101, name: 'Work: CRM', icon: '🗂️', isActive: true },
    { id: 102, name: 'Work: Hermes', icon: '⚡', isActive: true },
    { id: 103, name: 'Archived impact', icon: 'x', isActive: false }
];

function validProposal(overrides = {}) {
    return {
        action: 'apply',
        mode: 'checklist',
        title: 'Fix CRM booking form',
        description: 'Make booking validation clear and safe.',
        impactIds: [101],
        subtasks: [
            { title: 'Reproduce invalid booking submit' },
            { title: 'Patch validation handling' },
            { title: 'Verify CRM booking form' }
        ],
        confidence: {
            overall: 0.86,
            title: 0.92,
            description: 0.82,
            impacts: 0.88,
            subtasks: 0.8,
            mode: 0.84
        },
        reason: 'CRM validation task with clear checklist steps.',
        ...overrides
    };
}

test('task AI draft preview uses one direct Luna Responses call with strict schema, safety id, diff, and signed token', async () => {
    const calls = [];
    const result = await preview.generateTaskAiDraftPreview({
        draft: {
            title: 'crm form',
            description: 'broken submit',
            mode: 'simple',
            impactIds: []
        },
        impacts,
        userId: 7,
        businessScope: { businessContext: 'event_genix' }
    }, {
        proposalSecret: 'proposal-secret',
        safetySecret: 'safety-secret',
        safetyIdentifier: 'safe-user-hash',
        openAIClient: async request => {
            calls.push(request);
            return {
                ok: true,
                provider: 'openai',
                model: request.model,
                payload: {
                    output_text: JSON.stringify(validProposal()),
                    usage: { total_tokens: 123 }
                },
                usage: { total_tokens: 123 }
            };
        }
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-5.6-luna');
    assert.equal(result.contractVersion, 'my_day_ai_composer_proposal_v1');
    assert.deepEqual(result.proposal.impactIds, [101]);
    assert.equal(result.proposal.subtasks.length, 3);
    assert.match(result.proposalToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(result.proposalHash, preview.proposalHash(result.proposal));
    assert.equal(result.diff.fields.title.changed, true);
    assert.equal(result.diff.fields.impactIds.changed, true);
    assert.equal(result.diff.changedFields.includes('subtasks'), true);

    assert.equal(calls.length, 1);
    const request = calls[0];
    assert.equal(request.model, 'gpt-5.6-luna');
    assert.equal(request.schemaName, 'my_day_task_draft_preview');
    assert.equal(request.schema.additionalProperties, false);
    assert.deepEqual(request.schema.required, [
        'action',
        'mode',
        'title',
        'description',
        'impactIds',
        'subtasks',
        'confidence',
        'reason'
    ]);
    assert.equal(request.schema.properties.impactIds.maxItems, 3);
    assert.equal(request.schema.properties.impactIds.uniqueItems, true);
    assert.equal(request.reasoningEffort, 'low');
    assert.equal(request.maxOutputTokens, preview.TASK_AI_DRAFT_MAX_OUTPUT_TOKENS);
    assert.equal(request.safetyIdentifier, 'safe-user-hash');

    const serializedInput = JSON.stringify(request.input);
    assert.match(serializedInput, /currentDraft/);
    assert.match(serializedInput, /activeImpacts/);
    assert.match(serializedInput, /server will compute the diff|server/i);
    assert.match(serializedInput, /Do not output tags, directions/);
    assert.doesNotMatch(serializedInput, /OPENAI_API_KEY|OPENROUTER_API_KEY|chat_ai/i);
});

test('task AI preview telemetry records only metadata and strips task text/provider payloads', async () => {
    const events = [];
    const result = await preview.generateTaskAiDraftPreview({
        draft: {
            title: 'Sensitive CRM customer title',
            description: 'Sensitive customer description',
            mode: 'simple',
            impactIds: []
        },
        impacts,
        userId: 7,
        businessScope: { businessContext: 'event_genix' }
    }, {
        proposalSecret: 'proposal-secret',
        safetySecret: 'safety-secret',
        telemetry: {
            logger: {
                info: (message, data) => events.push({ message, data })
            }
        },
        openAIClient: async request => ({
            ok: true,
            provider: 'openai',
            model: request.model,
            payload: {
                output_text: JSON.stringify(validProposal()),
                usage: { input_tokens: 41, output_tokens: 52, total_tokens: 93 }
            },
            usage: { input_tokens: 41, output_tokens: 52, total_tokens: 93 }
        })
    });

    assert.equal(result.ok, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].message, 'task_ai_draft_event');
    assert.equal(events[0].data.status, 'success');
    assert.equal(events[0].data.model, 'gpt-5.6-luna');
    assert.equal(events[0].data.promptVersion, preview.TASK_AI_DRAFT_PROMPT_VERSION);
    assert.deepEqual(events[0].data.changedFields.sort(), ['description', 'impactIds', 'mode', 'subtasks', 'title'].sort());
    assert.deepEqual(events[0].data.usage, { inputTokens: 41, outputTokens: 52, totalTokens: 93 });
    const serialized = JSON.stringify(events[0].data);
    assert.doesNotMatch(serialized, /Sensitive CRM customer title|Sensitive customer description|output_text|Bearer|OPENAI_API_KEY/i);

    assert.throws(
        () => telemetry.recordTaskAiDraftTelemetry({ type: 'preview', status: 'success', promptText: 'secret task text' }),
        /sensitive fields/i
    );
});

test('task AI draft preview returns clarification/no-project decisions without inventing subtasks', async () => {
    const clarification = await preview.generateTaskAiDraftPreview({
        draft: { title: '3321' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({
                action: 'needs_clarification',
                mode: null,
                title: null,
                description: null,
                impactIds: [],
                subtasks: [],
                confidence: {
                    overall: 0.3,
                    title: 0.2,
                    description: 0.1,
                    impacts: 0.2,
                    subtasks: 0.1,
                    mode: 0.2
                },
                reason: 'Need a clearer task goal.'
            }))
        })
    });
    assert.equal(clarification.ok, true);
    assert.equal(clarification.proposal.action, 'needs_clarification');
    assert.deepEqual(clarification.proposal.subtasks, []);

    const inventedClarification = await preview.generateTaskAiDraftPreview({
        draft: { title: 'unclear' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({
                action: 'needs_clarification',
                mode: null,
                title: null,
                description: null,
                impactIds: [],
                subtasks: [{ title: 'Invented step' }],
                reason: 'Need clarification.'
            }))
        })
    });
    assert.equal(inventedClarification.ok, false);
    assert.equal(inventedClarification.code, 'TASK_AI_DRAFT_INVALID_RESPONSE');
});

test('task AI draft preview rejects unknown or archived impacts and extra fields', async () => {
    const unknown = await preview.generateTaskAiDraftPreview({
        draft: { title: 'Fix CRM and archived thing' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify(validProposal({ impactIds: [101, 103] }))
        })
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'TASK_AI_DRAFT_UNKNOWN_IMPACT');

    const extra = await preview.generateTaskAiDraftPreview({
        draft: { title: 'Fix CRM' },
        impacts,
        userId: 7
    }, {
        proposalSecret: 'secret',
        openAIClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'gpt-5.6-luna',
            text: JSON.stringify({ ...validProposal(), tags: ['crm'] })
        })
    });
    assert.equal(extra.ok, false);
    assert.equal(extra.code, 'TASK_AI_DRAFT_INVALID_RESPONSE');
});

test('shared My Day task OpenAI client enforces official production host and sends safe Responses payload', async () => {
    const blocked = await openAIClient.callMyDayTaskOpenAIResponses({
        model: 'gpt-5.6-luna',
        env: {
            NODE_ENV: 'production',
            OPENAI_API_KEY: 'secret',
            OPENAI_API_BASE_URL: 'https://proxy.invalid/v1'
        },
        input: [],
        schemaName: 'smoke',
        schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
        maxOutputTokens: 10
    }, {
        fetchImpl: async () => {
            throw new Error('fetch must not be called for a non-official production host');
        }
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'api_base_not_allowed');

    const requests = [];
    const ok = await openAIClient.callMyDayTaskOpenAIResponses({
        model: 'gpt-5.6-luna',
        env: {
            OPENAI_API_KEY: 'secret',
            OPENAI_API_BASE_URL: 'https://openai.test/v1'
        },
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'x' }] }],
        schemaName: 'smoke',
        schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
        reasoningEffort: 'low',
        maxOutputTokens: 10,
        safetyIdentifier: 'safe-id'
    }, {
        fetchImpl: async (url, options) => {
            requests.push({ url, body: JSON.parse(options.body), authorization: options.headers.Authorization });
            return { ok: true, status: 200, json: async () => ({ output_text: '{}' }) };
        }
    });
    assert.equal(ok.ok, true);
    assert.equal(requests[0].url, 'https://openai.test/v1/responses');
    assert.equal(requests[0].body.model, 'gpt-5.6-luna');
    assert.equal(requests[0].body.store, false);
    assert.equal(requests[0].body.safety_identifier, 'safe-id');
    assert.equal(requests[0].body.text.format.strict, true);
    assert.equal(requests[0].body.reasoning.effort, 'low');
    assert.equal(requests[0].authorization, 'Bearer secret');
});

test('shared My Day task OpenAI client blocks real network calls in test or CI without an injected mock transport', async () => {
    const blocked = await openAIClient.callMyDayTaskOpenAIResponses({
        model: 'gpt-5.6-luna',
        env: {
            NODE_ENV: 'test',
            OPENAI_API_KEY: 'sk-real-looking-test-key'
        },
        input: [],
        schemaName: 'smoke',
        schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
        maxOutputTokens: 10
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'real_openai_blocked_in_tests');
    assert.equal(blocked.statusCode, 503);
});

test('tasks route exposes ai-draft preview and keeps decompose-draft as non-OpenRouter compatibility wrapper for AI mode', () => {
    const route = fs.readFileSync(path.join(root, 'routes', 'tasks.js'), 'utf8');
    const decomposeBlock = route.slice(route.indexOf("router.post('/decompose-draft'"), route.indexOf("router.get('/decomposition-saved-templates'"));

    assert.match(route, /router\.post\('\/ai-draft\/preview'/);
    assert.match(route, /generateTaskAiDraftPreview/);
    assert.match(route, /listTaxonomy\(pool, userId, 'impacts'\)/);
    assert.match(route, /hmacSafetyIdentifier\(`task_ai_draft:\$\{userId\}`/);
    assert.match(decomposeBlock, /legacyDecompositionResponseFromPreview/);
    assert.match(decomposeBlock, /deprecatedEndpoint: '\/api\/tasks\/ai-draft\/preview'/);
    assert.match(decomposeBlock, /TASK_AI_DRAFT_\$\{String\(preview\.proposal\?\.action/);
    assert.doesNotMatch(decomposeBlock, /callUnifiedChatCompletion|OPENROUTER_API_KEY|scope: 'chat_ai'/);
});
