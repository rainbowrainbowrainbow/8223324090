'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const service = require('../services/myDayClassificationAi');

const impacts = [
    { id: 11, name: 'Робота: CRM', icon: '🗂️', isActive: true },
    { id: 12, name: 'Робота: Hermes', icon: '⚡', isActive: true },
    { id: 13, name: 'Здоровʼя', icon: '❤️', isActive: false }
];

test('My Day AI classifier uses direct OpenAI Responses API with strict impacts-only schema', async () => {
    const requests = [];
    const env = {
        OPENAI_API_KEY: 'test-openai-key',
        OPENAI_API_BASE_URL: 'https://openai.test/v1'
    };
    const result = await service.classifyMyDayTask({
        task: { id: 99, title: 'Fix CRM booking form', description: 'validation and UX' },
        impacts
    }, {
        env,
        fetchImpl: async (url, options) => {
            requests.push({ url, options, body: JSON.parse(options.body) });
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    output_text: '{"impactIds":[11],"confidence":0.82,"reason":"CRM task"}',
                    usage: { total_tokens: 42 }
                })
            };
        }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.classification, { impactIds: [11] });
    assert.equal(Object.hasOwn(result.classification, 'tags'), false);
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, service.DEFAULT_MY_DAY_CLASSIFICATION_MODEL);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://openai.test/v1/responses');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer test-openai-key');

    const body = requests[0].body;
    assert.equal(body.model, 'gpt-5.6-luna');
    assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, 'low');
    assert.equal(body.max_output_tokens, service.MY_DAY_CLASSIFICATION_MAX_OUTPUT_TOKENS);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(body.text.format.schema.required, ['impactIds', 'confidence', 'reason']);
    assert.equal(body.text.format.schema.properties.impactIds.maxItems, 5);
    assert.equal(Object.hasOwn(body.text.format.schema.properties.impactIds, 'uniqueItems'), false);
    assert.equal(body.text.format.schema.properties.reason.maxLength, 180);

    const serializedInput = JSON.stringify(body.input);
    assert.match(serializedInput, /activeImpacts/);
    assert.match(serializedInput, /Fix CRM booking form/);
    assert.match(serializedInput, /context/);
    assert.match(serializedInput, /клієнтська база/);
    assert.doesNotMatch(serializedInput, /tags|tagRules|OPENROUTER_API_KEY|OPENROUTER_KEY|chat_ai/i);
    assert.doesNotMatch(requests[0].options.body, /test-openai-key/);
});

test('My Day AI classifier refuses invented impacts, incomplete JSON, extra tags, no-match, low confidence, and provider errors', async () => {
    const base = { task: { id: 99, title: 'Configure Hermes worker' }, impacts };
    const unknown = await service.classifyMyDayTask(base, {
        aiClient: async () => ({ ok: true, provider: 'openai', text: '{"impactIds":[999],"confidence":0.8,"reason":"bad"}' })
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'MY_DAY_AI_UNKNOWN_IMPACT');

    const missingImpactIds = await service.classifyMyDayTask(base, {
        aiClient: async () => ({ ok: true, provider: 'openai', text: '{"confidence":0.8,"reason":"bad"}' })
    });
    assert.equal(missingImpactIds.ok, false);
    assert.equal(missingImpactIds.code, 'MY_DAY_AI_INVALID_RESPONSE');

    const withTags = await service.classifyMyDayTask(base, {
        aiClient: async () => ({ ok: true, provider: 'openai', text: '{"impactIds":[12],"tags":["crm"],"confidence":0.8,"reason":"bad"}' })
    });
    assert.equal(withTags.ok, false);
    assert.equal(withTags.code, 'MY_DAY_AI_INVALID_RESPONSE');

    const duplicateImpacts = await service.classifyMyDayTask(base, {
        aiClient: async () => ({ ok: true, provider: 'openai', text: '{"impactIds":[12,12],"confidence":0.8,"reason":"duplicate"}' })
    });
    assert.equal(duplicateImpacts.ok, false);
    assert.equal(duplicateImpacts.code, 'MY_DAY_VALIDATION_ERROR');

    const invalid = await service.classifyMyDayTask(base, {
        aiClient: async () => ({ ok: true, provider: 'openai', text: 'not json' })
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'MY_DAY_AI_INVALID_JSON');

    const noMatch = await service.classifyMyDayTask({ ...base, task: { id: 99, title: '3321' } }, {
        aiClient: async () => ({ ok: true, provider: 'openai', text: '{"impactIds":[],"confidence":0.2,"reason":"unclear"}' })
    });
    assert.equal(noMatch.ok, false);
    assert.equal(noMatch.code, 'MY_DAY_AI_NO_MATCH');

    const low = await service.classifyMyDayTask({ ...base, task: { id: 99, title: 'Improve this process' } }, {
        aiClient: async () => ({ ok: true, provider: 'openai', text: '{"impactIds":[12],"confidence":0.2,"reason":"unclear"}' })
    });
    assert.equal(low.ok, false);
    assert.equal(low.code, 'MY_DAY_AI_LOW_CONFIDENCE');

    const provider = await service.classifyMyDayTask(base, {
        env: {},
        fetchImpl: async () => {
            throw new Error('OpenAI should not be called without OPENAI_API_KEY');
        }
    });
    assert.equal(provider.ok, false);
    assert.equal(provider.code, 'MY_DAY_AI_PROVIDER_UNAVAILABLE');
    assert.equal(provider.provider, 'openai');
});

test('My Day AI preserves exact active impact names when Luna is uncertain', async () => {
    assert.deepEqual(service.findExplicitImpactIds({ title: 'Зроби тест для CRM' }, impacts), [11]);
    assert.deepEqual(service.findExplicitImpactIds({ title: 'Do routine work' }, impacts), []);
    assert.deepEqual(service.findExplicitImpactIds({ title: 'Це не для CRM' }, impacts), []);

    const exactCrm = await service.classifyMyDayTask({
        task: { id: 100, title: 'Зроби тест для CRM' },
        impacts
    }, {
        aiClient: async () => ({
            ok: true,
            provider: 'openai',
            text: '{"impactIds":[],"confidence":0.2,"reason":"too short"}'
        })
    });
    assert.equal(exactCrm.ok, true);
    assert.deepEqual(exactCrm.classification.impactIds, [11]);
    assert.equal(exactCrm.confidence, 0.9);
    assert.match(exactCrm.reason, /Явний збіг/);

    const crmAndHermes = await service.classifyMyDayTask({
        task: { id: 101, title: 'CRM + Hermes integration' },
        impacts
    }, {
        aiClient: async () => ({
            ok: true,
            provider: 'openai',
            text: '{"impactIds":[12],"confidence":0.8,"reason":"Hermes integration"}'
        })
    });
    assert.equal(crmAndHermes.ok, true);
    assert.deepEqual(crmAndHermes.classification.impactIds, [11, 12]);
});

test('My Day AI uses canonical group hints and Ukrainian inflection-safe explicit matches', () => {
    const guided = [
        ...impacts,
        { id: 14, name: 'Автоматизація / AI', icon: '🤖', isActive: true },
        { id: 15, name: 'Аналітика / рішення', icon: '📊', isActive: true },
        { id: 16, name: 'Продукт / розробка', icon: '💻', isActive: true }
    ];
    const payload = service.activeImpactPayload(guided);
    assert.equal(payload.find(item => item.id === 14).group, 'activity');
    assert.ok(payload.find(item => item.id === 14).hints.includes('автоматизація'));
    assert.deepEqual(
        service.findExplicitImpactIds({ title: 'Підготувати аналітику CRM та автоматизацію звітності' }, guided),
        [11, 14, 15]
    );
    assert.deepEqual(service.findExplicitImpactIds({ title: 'Зробити без автоматизації' }, guided), []);
    assert.deepEqual(service.findExplicitImpactIds({ title: '3321' }, guided), []);
    assert.match(service.buildSystemPrompt(), /context \+ activity \+ outcome/);
});

test('My Day AI model override is allowlisted and diagnostics does not expose secrets', async () => {
    assert.equal(service.resolveMyDayClassificationModel({}), 'gpt-5.6-luna');
    assert.equal(service.resolveMyDayClassificationTimeoutMs({}), service.MY_DAY_CLASSIFICATION_TIMEOUT_MS);
    assert.equal(service.resolveMyDayClassificationTimeoutMs({ MY_DAY_CLASSIFICATION_TIMEOUT_MS: '25' }), 100);
    assert.equal(service.resolveMyDayClassificationTimeoutMs({ MY_DAY_CLASSIFICATION_TIMEOUT_MS: '45000' }), 30000);
    assert.throws(
        () => service.resolveMyDayClassificationModel({ MY_DAY_CLASSIFICATION_MODEL: 'openai/gpt-5.4-nano' }),
        /Unsupported My Day classification model/
    );

    const ready = service.myDayClassificationDiagnostics({ OPENAI_API_KEY: 'secret' });
    assert.equal(ready.provider, 'openai');
    assert.equal(ready.configured, true);
    assert.equal(ready.status, 'ready');
    assert.equal(ready.model, 'gpt-5.6-luna');
    assert.equal(ready.keyEnv, 'OPENAI_API_KEY');
    assert.equal(ready.reasoningEffort, 'low');
    assert.equal(ready.store, false);
    assert.equal(ready.OPENAI_API_KEY, undefined);
    assert.doesNotMatch(JSON.stringify(ready), /secret/);

    const invalidModel = service.myDayClassificationDiagnostics({
        OPENAI_API_KEY: 'secret',
        MY_DAY_CLASSIFICATION_MODEL: 'openai/gpt-5.4-nano'
    });
    assert.equal(invalidModel.configured, false);
    assert.equal(invalidModel.status, 'model_not_allowed');
    assert.equal(invalidModel.model, 'openai/gpt-5.4-nano');

    const classified = await service.classifyMyDayTask({ task: { title: 'CRM' }, impacts }, {
        env: {
            OPENAI_API_KEY: 'secret',
            MY_DAY_CLASSIFICATION_MODEL: 'openai/gpt-5.4-nano'
        },
        fetchImpl: async () => {
            throw new Error('OpenAI should not be called for a disallowed model override');
        }
    });
    assert.equal(classified.ok, false);
    assert.equal(classified.code, 'MY_DAY_AI_MODEL_NOT_ALLOWED');
});

test('My Day AI route keeps LLM calls outside transactions, detects classification races, and returns server undo token', () => {
    const route = fs.readFileSync(path.join(root, 'routes', 'my-day.js'), 'utf8');
    const aiConfig = fs.readFileSync(path.join(root, 'services', 'ai-config.js'), 'utf8');
    const serviceSource = fs.readFileSync(path.join(root, 'services', 'myDayClassificationAi.js'), 'utf8');
    const sharedOpenAIClient = fs.readFileSync(path.join(root, 'services', 'myDayTaskOpenAIClient.js'), 'utf8');
    const routeBlock = route.slice(route.indexOf("router.post('/tasks/:taskId/classification/auto'"));
    const undoBlock = route.slice(route.indexOf("router.post('/tasks/:taskId/classification/undo'"));

    assert.match(route, /require\('node:crypto'\)/);
    assert.match(route, /JWT_SECRET/);
    assert.match(route, /const myDayAiClassificationLimiter = rateLimit/);
    assert.match(route, /ipKeyGenerator/);
    assert.match(route, /keyGenerator: req => String\(req\.user\?\.id \|\| ipKeyGenerator\(req\.ip\)/);
    assert.match(route, /loadMyCabinetTaskSnapshot\(pool, req\.user, businessScope, req\.params\.taskId\)/);
    assert.match(route, /loadMyDayAiImpactCatalog\(pool, userId\)/);
    assert.match(route, /readTaskClassification\(pool, userId, req\.params\.taskId\)/);
    assert.match(route, /beforeClassificationFingerprint = classificationFingerprint\(previousClassification, beforeTaskFingerprint\)/);
    assert.match(route, /const aiResult = await classifyMyDayTask\(\{ task, impacts \}\)/);
    assert.ok(routeBlock.indexOf('loadMyDayAiImpactCatalog') < routeBlock.indexOf('const aiResult = await classifyMyDayTask'));
    assert.ok(routeBlock.indexOf('const aiResult = await classifyMyDayTask') < routeBlock.indexOf("await client.query('BEGIN')"));
    assert.match(routeBlock, /const lockedTask = await loadMyCabinetTask\(client, req\.user, businessScope, req\.params\.taskId\)/);
    assert.match(routeBlock, /lockedTaskFingerprint !== beforeTaskFingerprint/);
    assert.match(routeBlock, /currentClassification = await readTaskClassification\(client, userId, req\.params\.taskId\)/);
    assert.match(routeBlock, /classificationFingerprint\(currentClassification, lockedTaskFingerprint\) !== beforeClassificationFingerprint/);
    assert.match(routeBlock, /replaceTaskClassification\(client/);
    assert.doesNotMatch(routeBlock, /tags: aiResult|directionId|priority|deadline|assigned_to|owner_user_id\s*=/);
    assert.match(routeBlock, /undoToken/);
    assert.match(routeBlock, /createClassificationUndoToken/);
    assert.match(undoBlock, /verifyClassificationUndoToken\(req\.body\?\.undoToken\)/);
    assert.match(undoBlock, /loadMyCabinetTask\(client, req\.user, businessScope, taskId\)/);
    assert.match(undoBlock, /classificationFingerprint\(currentClassification, taskFingerprint\(task\)\) !== token\.appliedFingerprint/);
    assert.match(undoBlock, /allowArchivedImpactIds: beforeImpactIds/);
    assert.match(aiConfig, /myDayClassificationDiagnostics/);
    assert.match(serviceSource, /DEFAULT_MY_DAY_CLASSIFICATION_MODEL = MY_DAY_TASK_AI_MODEL/);
    assert.match(serviceSource, /callMyDayTaskOpenAIResponses/);
    assert.match(serviceSource, /MY_DAY_CLASSIFICATION_REASONING_EFFORT/);
    assert.match(sharedOpenAIClient, /MY_DAY_TASK_AI_MODEL = 'gpt-5\.6-luna'/);
    assert.match(sharedOpenAIClient, /OPENAI_API_KEY/);
    assert.match(sharedOpenAIClient, /\/responses/);
    assert.match(sharedOpenAIClient, /reasoning: \{ effort: request\.reasoningEffort/);
    assert.match(sharedOpenAIClient, /store: false/);
    assert.match(sharedOpenAIClient, /safety_identifier/);
    assert.match(sharedOpenAIClient, /OPENAI_OFFICIAL_ORIGIN = 'https:\/\/api\.openai\.com'/);
    assert.doesNotMatch(serviceSource, /callUnifiedChatCompletion|OPENROUTER_API_KEY|scope: 'chat_ai'|openai\/gpt-5\.4-nano/);
});

test('My Day card exposes AI classification button, states, immediate impact chips, and undo contract', () => {
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-classification.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css', 'pages-profile.css'), 'utf8');

    assert.match(profile, /cabinet-task-action-ai/);
    assert.match(profile, /data-cabinet-task-action="ai-classification"/);
    assert.match(profile, /applyCabinetTaskMyDayClassification/);
    assert.match(profile, /data-my-day-classification-badges/);
    assert.match(profile, /task_ai_classification/);
    assert.doesNotMatch(profile, /classification\.tags|myDayClassification\?\.tags/);
    assert.match(ui, /autoClassifyTask/);
    assert.match(ui, /\/classification\/auto/);
    assert.match(ui, /setAiButtonState\(button, 'loading'/);
    assert.match(ui, /stateName === 'loading' \? 'true' : 'false'/);
    assert.match(ui, /'provider-unavailable'/);
    assert.match(ui, /'no-match'/);
    assert.match(ui, /'conflict'/);
    assert.match(ui, /'retry'/);
    assert.match(ui, /data-my-day-ai-undo/);
    assert.match(ui, /data-my-day-ai-retry/);
    assert.match(ui, /undoTaskClassification\(result\.taskId, result\.undoToken\)/);
    assert.match(ui, /\/classification\/undo/);
    assert.match(ui, /OpenAI My Day classification diagnostics/);
    assert.doesNotMatch(ui, /OpenRouter rail|tagRules|classification\.tags|myDay\.tags|tags:/);
    assert.match(css, /\.cabinet-task-action-ai/);
    assert.match(css, /\.task-ui-action-surface--ai-classification/);
    assert.match(css, /body\.dark-mode [\s\S]*\.cabinet-task-action-ai/);
});
