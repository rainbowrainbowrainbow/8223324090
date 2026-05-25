const assert = require('node:assert/strict');
const test = require('node:test');

const {
    DEFAULT_MODELS,
    getAIModelOptions,
    normalizeModelForProvider
} = require('../services/ai-config');

test('chat AI model options expose current OpenAI mini default', () => {
    const options = getAIModelOptions();

    assert.equal(DEFAULT_MODELS.openai, process.env.OPENAI_MODEL || 'gpt-5.4-mini');
    assert.equal(options.openai[0].value, 'gpt-5.4-mini');
    assert.ok(options.openai.some(option => option.value === 'gpt-5.5'));
    assert.ok(options.openai.some(option => option.value === 'gpt-5.4'));
    assert.ok(options.openai.some(option => option.value === 'gpt-5.4-nano'));
});

test('chat AI model sanitizer blocks provider/model mismatch', () => {
    assert.equal(normalizeModelForProvider('claude-haiku-4-5-20251001', 'openai'), DEFAULT_MODELS.openai);
    assert.equal(normalizeModelForProvider('', 'openai'), DEFAULT_MODELS.openai);
    assert.equal(normalizeModelForProvider('gpt-5.4-mini', 'openai'), 'gpt-5.4-mini');
    assert.equal(normalizeModelForProvider('gpt-5.4-mini', 'auto'), '');
});
