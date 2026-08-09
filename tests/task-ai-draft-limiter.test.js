'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const limiter = require('../services/taskAiDraftLimiter');

test('task AI draft limiter is per user, business context, action, and reset window', () => {
    limiter.resetTaskAiDraftRateLimiter();
    const options = { limit: 2, windowMs: 1_000, now: 10_000 };
    assert.equal(limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, options).allowed, true);
    assert.equal(limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, options).allowed, true);
    const blocked = limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, options);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 1);

    assert.equal(limiter.checkTaskAiDraftRateLimit({ userId: 8, businessContext: 'event_genix', action: 'preview' }, options).allowed, true);
    assert.equal(limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'maysternya_doli', action: 'preview' }, options).allowed, true);
    assert.equal(limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'commit' }, options).allowed, true);
    assert.equal(limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, { ...options, now: 11_001 }).allowed, true);
});
