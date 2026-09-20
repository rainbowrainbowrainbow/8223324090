'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    classifyBrowserRequest,
    normalizeProductionBase,
    parseConversationIds,
    parseSecretAssignments,
    sanitizedPath
} = require('../scripts/live-omni-smoke');

test('Omni live smoke parses only the supported local secret assignments', () => {
    const values = parseSecretAssignments([
        '$env:LIVE_SMOKE_URL = "https://crm.example.test"',
        '$env:LIVE_SMOKE_USER = "qa-user"',
        '$env:LIVE_SMOKE_PASS = "private"',
        '$env:UNRELATED_SECRET = "must-not-load"'
    ].join('\n'));
    assert.deepEqual({ ...values }, {
        LIVE_SMOKE_URL: 'https://crm.example.test',
        LIVE_SMOKE_USER: 'qa-user',
        LIVE_SMOKE_PASS: 'private'
    });
});

test('Omni live smoke requires explicit positive QA conversation IDs', () => {
    assert.deepEqual(parseConversationIds('42, 77,42'), ['42', '77']);
    assert.throws(() => parseConversationIds('42,client-name'), /positive integer IDs/);
});

test('Omni live smoke accepts HTTPS origins without embedded credentials', () => {
    assert.equal(normalizeProductionBase('https://crm.example.test/omni?x=1'), 'https://crm.example.test');
    assert.throws(() => normalizeProductionBase('http://crm.example.test'), /HTTPS/);
    assert.throws(() => normalizeProductionBase('https://user:pass@crm.example.test'), /credentials/);
});

test('Omni live smoke blocks business writes and permits read-only requests', () => {
    const origin = 'https://crm.example.test';
    assert.equal(classifyBrowserRequest('GET', `${origin}/api/omni/conversations`, origin).decision, 'allow-read');
    assert.equal(classifyBrowserRequest('POST', `${origin}/api/auth/refresh`, origin).decision, 'allow-auth');
    assert.deepEqual(classifyBrowserRequest('POST', `${origin}/api/omni/conversations/42/read`, origin), {
        decision: 'block-write', method: 'POST', path: '/api/omni/conversations/:id/read'
    });
    assert.equal(classifyBrowserRequest('POST', `${origin}/api/omni/conversations/42/send`, origin).decision, 'block-write');
    assert.equal(classifyBrowserRequest('GET', 'https://fonts.googleapis.com/css2', origin).decision, 'external');
});

test('Omni live smoke sanitizes numeric record identifiers in reports', () => {
    assert.equal(sanitizedPath('https://crm.example.test/api/omni/conversations/42/messages?limit=100'),
        '/api/omni/conversations/:id/messages');
});
