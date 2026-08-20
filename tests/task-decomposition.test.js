const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    generateTaskDecompositionDraft,
    getTaskDecompositionTemplates,
    normalizeDraftItems,
    parseAiDraftText,
    pickTemplateKey
} = require('../services/taskDecomposition');

const root = path.resolve(__dirname, '..');

test('exposes real starter templates for common task families', () => {
    const templates = getTaskDecompositionTemplates();
    assert.ok(templates.length >= 4);
    assert.deepEqual(
        templates.map(item => item.key).sort(),
        ['content_creation', 'crm_sales_followup', 'event_preparation', 'personal_home'].sort()
    );
});

test('picks a useful template from task context', () => {
    assert.equal(pickTemplateKey({ title: 'Прибрати квартиру', category: 'personal' }), 'personal_home');
    assert.equal(pickTemplateKey({ title: 'Підготувати день народження в залі' }), 'event_preparation');
    assert.equal(pickTemplateKey({ title: 'Написати пост для Instagram' }), 'content_creation');
    assert.equal(pickTemplateKey({ title: 'Передзвонити ліду по бронюванню' }), 'crm_sales_followup');
});

test('template mode returns editable template draft without calling AI', async () => {
    let called = false;
    const result = await generateTaskDecompositionDraft({
        title: 'Підготувати івент',
        mode: 'template',
        templateKey: 'event_preparation'
    }, {
        aiClient: async () => {
            called = true;
            return { ok: false };
        }
    });
    assert.equal(called, false);
    assert.equal(result.success, true);
    assert.equal(result.source, 'template');
    assert.ok(result.subtasks.length >= 3);
    assert.equal(result.subtasks[0].source_type, 'template');
});

test('AI mode parses JSON, removes duplicates, and marks source truthfully', async () => {
    const result = await generateTaskDecompositionDraft({
        title: 'Прибрати квартиру',
        mode: 'ai'
    }, {
        aiClient: async () => ({
            ok: true,
            provider: 'openai',
            model: 'test-model',
            text: JSON.stringify({
                subtasks: [
                    { title: 'Прибрати кухню' },
                    { title: 'Прибрати кухню' },
                    { title: 'Винести сміття' },
                    { title: 'Помити підлогу' }
                ]
            })
        })
    });
    assert.equal(result.success, true);
    assert.equal(result.source, 'ai');
    assert.deepEqual(result.subtasks.map(item => item.title), ['Прибрати кухню', 'Винести сміття', 'Помити підлогу']);
    assert.ok(result.subtasks.every(item => item.source_type === 'ai'));
});

test('template-assisted mode falls back honestly to template when AI is unavailable', async () => {
    const result = await generateTaskDecompositionDraft({
        title: 'Підготувати контент-план',
        mode: 'template_ai',
        templateKey: 'content_creation'
    }, {
        aiClient: async () => ({ ok: false, reason: 'missing_key', enabled: true, keyConfigured: false })
    });
    assert.equal(result.success, true);
    assert.equal(result.source, 'template_fallback');
    assert.equal(result.meta.aiUsed, false);
    assert.equal(result.meta.aiReason, 'missing_key');
    assert.ok(result.subtasks.every(item => item.source_type === 'template'));
});

test('rejects empty context and unusable AI output without persisting anything', async () => {
    const missing = await generateTaskDecompositionDraft({ title: '', mode: 'ai' });
    assert.equal(missing.success, false);
    assert.equal(missing.status, 400);

    const empty = await generateTaskDecompositionDraft({ title: 'Task', mode: 'ai' }, {
        aiClient: async () => ({ ok: true, text: '{"subtasks":[]}' })
    });
    assert.equal(empty.success, false);
    assert.equal(empty.status, 422);
});

test('parses fenced or plain AI draft text safely', () => {
    assert.deepEqual(parseAiDraftText('```json\n{"subtasks":["A","B"]}\n```'), ['A', 'B']);
    assert.deepEqual(parseAiDraftText('- A\n- B'), ['A', 'B']);
    assert.deepEqual(
        normalizeDraftItems(['Перший крок', 'Перший крок', 'Другий крок'], { sourceType: 'ai' }).map(item => item.title),
        ['Перший крок', 'Другий крок']
    );
});

test('taskDecomposition stays scoped to subtasks and does not import AI task draft normalization', () => {
    const source = fs.readFileSync(path.join(root, 'services', 'taskDecomposition.js'), 'utf8');

    assert.doesNotMatch(source, /taskAiDraftNormalization|taskAiDraftPreview|taskAiDraftCommit|impactIds|impact_ids/);
    assert.match(source, /callUnifiedChatCompletion/);
    assert.match(source, /normalizeDraftItems/);
});
