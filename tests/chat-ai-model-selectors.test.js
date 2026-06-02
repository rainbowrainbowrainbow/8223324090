const assert = require('node:assert/strict');
const test = require('node:test');

const {
    DEFAULT_MODELS,
    getAIModelOptions,
    normalizeModelForProvider
} = require('../services/ai-config');

test('chat AI model options expose current OpenRouter token rail defaults', () => {
    const options = getAIModelOptions();

    assert.equal(DEFAULT_MODELS.openrouter, process.env.SUMMARY_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-5.4-mini');
    assert.deepEqual(Object.keys(options).sort(), ['auto', 'openrouter']);
    assert.equal(options.openrouter[0].value, 'openai/gpt-5.4-mini');
    assert.ok(options.openrouter.some(option => option.value === 'openai/gpt-5.5'));
    assert.ok(options.openrouter.some(option => option.value === 'openai/gpt-5.4-nano'));
});

test('chat AI model sanitizer blocks provider/model mismatch', () => {
    assert.equal(normalizeModelForProvider('claude-haiku-4-5-20251001', 'openai'), DEFAULT_MODELS.openrouter);
    assert.equal(normalizeModelForProvider('', 'openai'), DEFAULT_MODELS.openrouter);
    assert.equal(normalizeModelForProvider('gpt-5.4-mini', 'openai'), DEFAULT_MODELS.openrouter);
    assert.equal(normalizeModelForProvider('openai/gpt-5.4-mini', 'openrouter'), 'openai/gpt-5.4-mini');
    assert.equal(normalizeModelForProvider('gpt-5.4-mini', 'auto'), '');
});
