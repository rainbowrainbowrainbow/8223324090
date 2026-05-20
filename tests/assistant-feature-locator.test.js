const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../js/crm-feature-registry');
const { buildDirectFeatureLocatorReply, buildAssistantContext } = require('../services/dashboardAssistant');

test('feature registry maps grammar/certificate issue wording to canonical create route', () => {
    const matches = registry.searchCrmFeatures('підкажи де в системі знайти можливість видати грамоту');
    assert.ok(matches.length > 0);
    assert.equal(matches[0].href, '/certificates/new');
    assert.match(matches[0].breadcrumb, /Сертифікати/);
});

test('dashboard assistant answers feature location locally without OpenAI call', () => {
    const context = buildAssistantContext({
        role: 'manager',
        page: 'dashboard',
        userMessage: 'де знайти можливість видати грамоту'
    });
    const reply = buildDirectFeatureLocatorReply(context);
    assert.ok(reply);
    assert.match(reply.summary, /\/certificates\/new/);
    assert.equal(reply.actionProposal.actionId, 'assistant.navigate');
    assert.equal(reply.actionProposal.payload.href, '/certificates/new');
});

test('feature registry exposes Afisha as standalone product page', () => {
    const matches = registry.searchCrmFeatures('де створити афішу події');
    assert.equal(matches[0].href, '/afisha');
    assert.match(matches[0].summary, /Окрема сторінка/);
});
