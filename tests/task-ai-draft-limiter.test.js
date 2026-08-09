'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const limiter = require('../services/taskAiDraftLimiter');

function createDurableLimiterPool() {
    const rows = new Map();
    const calls = [];
    return {
        rows,
        calls,
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            calls.push({ sql, params });
            const key = `${params[0]}:${params[1]}:${params[2]}`;
            if (/INSERT INTO task_ai_rate_limit_buckets/i.test(sql)) {
                const now = new Date(params[3]).getTime();
                const nextResetAt = new Date(params[4]);
                const limit = Number(params[5]);
                const current = rows.get(key);
                if (current && current.resetAt.getTime() > now && current.requestCount >= limit) {
                    return { rows: [] };
                }
                const reset = !current || current.resetAt.getTime() <= now;
                const next = {
                    requestCount: reset ? 1 : current.requestCount + 1,
                    windowStartedAt: reset ? new Date(params[3]) : current.windowStartedAt,
                    resetAt: reset ? nextResetAt : current.resetAt
                };
                rows.set(key, next);
                return { rows: [{ request_count: next.requestCount, reset_at: next.resetAt }] };
            }
            if (/SELECT request_count, reset_at FROM task_ai_rate_limit_buckets/i.test(sql)) {
                const current = rows.get(key);
                return {
                    rows: current ? [{ request_count: current.requestCount, reset_at: current.resetAt }] : []
                };
            }
            throw new Error(`Unexpected limiter SQL: ${sql}`);
        }
    };
}

test('task AI memory limiter remains available only as an explicit unit-test adapter', () => {
    limiter.resetTaskAiDraftRateLimiter();
    const options = { limit: 2, windowMs: 1_000, now: 10_000 };
    assert.equal(limiter.checkMemoryTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, options).allowed, true);
    assert.equal(limiter.checkMemoryTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, options).allowed, true);
    const blocked = limiter.checkMemoryTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, options);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 1);
});

test('task AI production limiter uses durable PostgreSQL buckets per user, context, action, and window', async () => {
    const pool = createDurableLimiterPool();
    const options = { pool, limit: 2, windowMs: 1_000, now: 10_000 };
    assert.equal((await limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, options)).allowed, true);
    const second = await limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, options);
    assert.equal(second.allowed, true);
    assert.equal(second.durable, true);
    const blocked = await limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, options);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 1);

    assert.equal((await limiter.checkTaskAiDraftRateLimit({ userId: 8, businessContext: 'event_genix', action: 'preview' }, options)).allowed, true);
    assert.equal((await limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'maysternya_doli', action: 'preview' }, options)).allowed, true);
    assert.equal((await limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'commit' }, options)).allowed, true);
    assert.equal((await limiter.checkTaskAiDraftRateLimit({ userId: 7, businessContext: 'event_genix', action: 'preview' }, { ...options, now: 11_001 })).allowed, true);
    assert.ok(pool.calls.some(call => /ON CONFLICT \(user_id, business_context, action\)/i.test(call.sql)));
    assert.ok(pool.calls.some(call => /request_count < \$6/i.test(call.sql)));
});

test('task AI durable limiter and canonical bundle migrations are additive and content-free', () => {
    const root = path.resolve(__dirname, '..');
    const limiterMigration = fs.readFileSync(path.join(root, 'db', 'migrations', '324_task_ai_durable_rate_limits.sql'), 'utf8');
    const bundleMigration = fs.readFileSync(path.join(root, 'db', 'migrations', '323_task_ai_bundle_foundation.sql'), 'utf8');
    const limiterDdl = limiterMigration.slice(limiterMigration.indexOf('CREATE TABLE'));
    assert.match(limiterMigration, /CREATE TABLE IF NOT EXISTS task_ai_rate_limit_buckets/);
    assert.match(limiterMigration, /PRIMARY KEY \(user_id, business_context, action\)/);
    assert.doesNotMatch(limiterDdl, /\b(prompt|description|api_key|provider_response)\b/i);
    assert.match(bundleMigration, /CREATE TABLE IF NOT EXISTS task_bundles/);
    assert.match(bundleMigration, /CREATE TABLE IF NOT EXISTS task_bundle_tasks/);
    assert.match(bundleMigration, /UNIQUE \(created_by_user_id, business_context, idempotency_key\)/);
    assert.doesNotMatch(bundleMigration, /DELETE FROM|UPDATE tasks|ALTER TABLE tasks/i);
});
