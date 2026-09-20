'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    LIVE_VIEWPORTS,
    assertLiveSmokePreflight,
    classifyBrowserRequest,
    loadLocalConfig,
    normalizeProductionBase,
    parseConversationIds,
    parseSecretAssignments,
    sanitizedPath,
    selectAllowedConversationId,
    summarizeRequests
} = require('../scripts/live-omni-smoke');

test('Omni live smoke parses only the supported local secret assignments', () => {
    const values = parseSecretAssignments([
        '$env:LIVE_SMOKE_URL = "https://crm.example.test"',
        '$env:LIVE_SMOKE_USER = "qa-user"',
        '$env:LIVE_SMOKE_PASS = "private"',
        '$env:LIVE_OMNI_QA_CONVERSATION_IDS = "42,77"',
        '$env:LIVE_OMNI_QA_BUSINESS_CONTEXT = "event_genix"',
        '$env:UNRELATED_SECRET = "must-not-load"'
    ].join('\n'));
    assert.deepEqual({ ...values }, {
        LIVE_SMOKE_URL: 'https://crm.example.test',
        LIVE_SMOKE_USER: 'qa-user',
        LIVE_SMOKE_PASS: 'private',
        LIVE_OMNI_QA_CONVERSATION_IDS: '42,77',
        LIVE_OMNI_QA_BUSINESS_CONTEXT: 'event_genix'
    });
});

test('Omni live smoke requires explicit positive QA conversation IDs', () => {
    assert.deepEqual(parseConversationIds('42, 77,42'), ['42', '77']);
    assert.throws(() => parseConversationIds('42,client-name'), /positive integer IDs/);
});

test('Omni live smoke fails closed when the secrets file is unavailable', () => {
    const config = loadLocalConfig('Z:\\missing-eventgenix-secrets.ps1');
    assert.equal(config.secretsFilePresent, false);
    assert.throws(() => assertLiveSmokePreflight({
        ...config,
        url: 'https://crm.example.test',
        username: 'qa-user',
        password: 'private',
        conversationIds: ['42']
    }), /blocked: local EventGenix secrets file is unavailable/);
});

test('Omni live smoke fails closed when the allowlist is empty', () => {
    assert.throws(() => assertLiveSmokePreflight({
        secretsFilePresent: true,
        url: 'https://crm.example.test',
        username: 'qa-user',
        password: 'private',
        conversationIds: []
    }), /blocked: set LIVE_OMNI_QA_CONVERSATION_IDS/);
});

test('Omni live smoke never selects a conversation outside the allowlist', () => {
    assert.equal(selectAllowedConversationId(['42'], ['77', '88']), null);
    assert.equal(selectAllowedConversationId(['42', '77'], ['77', '88']), '77');
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

test('Omni live smoke covers the required production viewport matrix', () => {
    assert.deepEqual(LIVE_VIEWPORTS, {
        laptop: { width: 1024, height: 600 },
        desktop: { width: 1366, height: 768 },
        mobile: { width: 390, height: 844 },
        smallMobile: { width: 320, height: 640 },
        shortMobile: { width: 390, height: 420 }
    });
});

test('Omni live smoke network summary aggregates only sanitized request paths', () => {
    const summary = summarizeRequests([
        { decision: 'allow-read', method: 'GET', path: '/api/omni/conversations/42/messages' },
        { decision: 'allow-read', method: 'GET', path: '/api/omni/conversations/77/messages' },
        { decision: 'block-write', method: 'POST', path: '/api/omni/conversations/42/read' }
    ]);
    assert.deepEqual(summary, [
        { decision: 'allow-read', method: 'GET', path: '/api/omni/conversations/:id/messages', count: 2 },
        { decision: 'block-write', method: 'POST', path: '/api/omni/conversations/:id/read', count: 1 }
    ]);
    assert.doesNotMatch(JSON.stringify(summary), /\b(?:42|77)\b/);
});
