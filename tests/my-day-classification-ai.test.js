'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const service = require('../services/myDayClassificationAi');

const impacts = [
    { id: 11, name: 'Робота: CRM', icon: 'C', isActive: true },
    { id: 12, name: 'Робота: Hermes', icon: 'H', isActive: true },
    { id: 13, name: 'Здоров’я', icon: 'Z', isActive: false }
];

test('My Day AI classifier uses the shared OpenRouter rail and normalizes safe output without paid calls', async () => {
    const calls = [];
    const result = await service.classifyMyDayTask({
        task: { id: 99, title: 'Виправити форму бронювання в CRM', description: 'валідація і UX' },
        impacts
    }, {
        aiClient: async options => {
            calls.push(options);
            return {
                ok: true,
                provider: 'openrouter',
                model: 'openai/gpt-5.4-nano',
                text: '{"impactIds":[11],"tags":[" CRM ","crm","форма бронювання"],"confidence":0.82,"reason":"CRM task"}',
                usage: { total_tokens: 42 }
            };
        }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.classification, { impactIds: [11], tags: ['CRM', 'форма бронювання'] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].scope, 'chat_ai');
    assert.equal(calls[0].model, process.env.MY_DAY_CLASSIFICATION_MODEL || service.DEFAULT_MY_DAY_CLASSIFICATION_MODEL);
    assert.equal(calls[0].title, 'Event Genix My Day Classification');
    assert.match(calls[0].systemPrompt, /Return only strict JSON/);
    assert.match(calls[0].systemPrompt, /Do not classify direction, status, priority, deadline, owner, or dependencies/);
    assert.match(calls[0].userMessage, /activeImpacts/);
    assert.doesNotMatch(calls[0].userMessage, /OPENROUTER_API_KEY|OPENROUTER_KEY/);
});

test('My Day AI classifier refuses invented impacts, invalid JSON, low confidence, and provider errors', async () => {
    const base = { task: { id: 99, title: 'Налаштувати Hermes worker' }, impacts };
    const unknown = await service.classifyMyDayTask(base, {
        aiClient: async () => ({ ok: true, text: '{"impactIds":[999],"tags":["Hermes"],"confidence":0.8,"reason":"bad"}' })
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'MY_DAY_AI_UNKNOWN_IMPACT');

    const invalid = await service.classifyMyDayTask(base, {
        aiClient: async () => ({ ok: true, text: 'not json' })
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'MY_DAY_AI_INVALID_JSON');

    const low = await service.classifyMyDayTask(base, {
        aiClient: async () => ({ ok: true, text: '{"impactIds":[12],"tags":["Hermes"],"confidence":0.2,"reason":"unclear"}' })
    });
    assert.equal(low.ok, false);
    assert.equal(low.code, 'MY_DAY_AI_LOW_CONFIDENCE');

    const provider = await service.classifyMyDayTask(base, {
        aiClient: async () => ({ ok: false, reason: 'missing_key', provider: 'openrouter' })
    });
    assert.equal(provider.ok, false);
    assert.equal(provider.code, 'MY_DAY_AI_PROVIDER_UNAVAILABLE');
});

test('My Day AI route keeps LLM calls outside transactions and rechecks task before write', () => {
    const route = fs.readFileSync(path.join(root, 'routes', 'my-day.js'), 'utf8');
    const aiConfig = fs.readFileSync(path.join(root, 'services', 'ai-config.js'), 'utf8');
    const routeBlock = route.slice(route.indexOf("router.post('/tasks/:taskId/classification/auto'"));

    assert.match(route, /const myDayAiClassificationLimiter = rateLimit/);
    assert.match(route, /ipKeyGenerator/);
    assert.match(route, /keyGenerator: req => String\(req\.user\?\.id \|\| ipKeyGenerator\(req\.ip\)/);
    assert.match(route, /loadMyCabinetTaskSnapshot\(pool, req\.user, businessScope, req\.params\.taskId\)/);
    assert.match(route, /readTaskClassification\(pool, userId, req\.params\.taskId\)/);
    assert.match(route, /const aiResult = await classifyMyDayTask\(\{ task, impacts \}\)/);
    assert.ok(routeBlock.indexOf('const aiResult = await classifyMyDayTask') < routeBlock.indexOf("await client.query('BEGIN')"));
    assert.match(routeBlock, /const lockedTask = await loadMyCabinetTask\(client, req\.user, businessScope, req\.params\.taskId\)/);
    assert.match(routeBlock, /taskFingerprint\(lockedTask\) !== beforeFingerprint/);
    assert.match(routeBlock, /replaceTaskClassification\(client/);
    assert.match(routeBlock, /previousClassification/);
    assert.match(aiConfig, /id: 'my_day_classification'/);
    assert.match(aiConfig, /process\.env\.MY_DAY_CLASSIFICATION_MODEL \|\| 'openai\/gpt-5\.4-nano'/);
    assert.doesNotMatch(routeBlock, /directionId|priority|deadline|assigned_to|owner_user_id\s*=/);
});

test('My Day card exposes AI classification button, states, immediate chips, and undo contract', () => {
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-classification.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css', 'pages-profile.css'), 'utf8');

    assert.match(profile, /cabinet-task-action-ai/);
    assert.match(profile, /data-cabinet-task-action="ai-classification"/);
    assert.match(profile, /applyCabinetTaskMyDayClassification/);
    assert.match(profile, /data-my-day-classification-badges/);
    assert.match(profile, /task_ai_classification/);
    assert.match(ui, /autoClassifyTask/);
    assert.match(ui, /\/classification\/auto/);
    assert.match(ui, /dataset\.myDayAiState = 'loading'/);
    assert.match(ui, /dataset\.myDayAiState = error\.code/);
    assert.match(ui, /'provider-unavailable'/);
    assert.match(ui, /'retry'/);
    assert.match(ui, /data-my-day-ai-undo/);
    assert.match(ui, /data-my-day-ai-retry/);
    assert.match(ui, /saveTaskClassification\(result\.taskId, classificationPayload\(previous\)\)/);
    assert.match(css, /\.cabinet-task-action-ai/);
    assert.match(css, /\.task-ui-action-surface--ai-classification/);
    assert.match(css, /body\.dark-mode [\s\S]*\.cabinet-task-action-ai/);
});
