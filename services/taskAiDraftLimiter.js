'use strict';

const { pool } = require('../db');

const DEFAULT_LIMIT = 12;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const buckets = new Map();

function safePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRateLimitOptions(options = {}) {
    const env = options.env || process.env;
    return {
        limit: safePositiveInteger(options.limit ?? env.TASK_AI_DRAFT_RATE_LIMIT_MAX, DEFAULT_LIMIT),
        windowMs: safePositiveInteger(options.windowMs ?? env.TASK_AI_DRAFT_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
        now: Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
    };
}

function rateLimitKey({ userId, businessContext, action = 'preview' } = {}) {
    return [
        'task-ai-draft',
        action,
        Number(userId || 0),
        String(businessContext || 'event_genix').trim() || 'event_genix'
    ].join(':');
}

function checkMemoryTaskAiDraftRateLimit(input = {}, options = {}) {
    const normalized = normalizeRateLimitOptions(options);
    const key = rateLimitKey(input);
    const current = buckets.get(key);
    const resetAt = current && current.resetAt > normalized.now
        ? current.resetAt
        : normalized.now + normalized.windowMs;
    const count = current && current.resetAt > normalized.now ? current.count : 0;
    if (count >= normalized.limit) {
        return {
            allowed: false,
            key,
            limit: normalized.limit,
            remaining: 0,
            resetAt,
            retryAfterSeconds: Math.max(1, Math.ceil((resetAt - normalized.now) / 1000))
        };
    }
    const nextCount = count + 1;
    buckets.set(key, { count: nextCount, resetAt });
    return {
        allowed: true,
        key,
        limit: normalized.limit,
        remaining: Math.max(0, normalized.limit - nextCount),
        resetAt,
        retryAfterSeconds: 0
    };
}

function normalizeLimiterInput(input = {}) {
    const userId = Number(input.userId || input.user_id || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
        const error = new Error('Valid user is required for task AI rate limiting.');
        error.statusCode = 401;
        error.code = 'TASK_AI_DRAFT_RATE_LIMIT_USER_REQUIRED';
        throw error;
    }
    const businessContext = String(input.businessContext || input.business_context || 'event_genix').trim() || 'event_genix';
    const action = String(input.action || 'preview').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'preview';
    return { userId, businessContext: businessContext.slice(0, 100), action };
}

async function checkTaskAiDraftRateLimit(input = {}, options = {}) {
    if (options.memory === true) return checkMemoryTaskAiDraftRateLimit(input, options);
    const normalized = normalizeRateLimitOptions(options);
    const identity = normalizeLimiterInput(input);
    const db = options.pool || pool;
    const windowStartedAt = new Date(normalized.now);
    const nextResetAt = new Date(normalized.now + normalized.windowMs);
    const result = await db.query(
        `INSERT INTO task_ai_rate_limit_buckets (
            user_id, business_context, action, request_count,
            window_started_at, reset_at, updated_at
         ) VALUES ($1, $2, $3, 1, $4, $5, NOW())
         ON CONFLICT (user_id, business_context, action)
         DO UPDATE SET
            request_count = CASE
                WHEN task_ai_rate_limit_buckets.reset_at <= $4 THEN 1
                ELSE task_ai_rate_limit_buckets.request_count + 1
            END,
            window_started_at = CASE
                WHEN task_ai_rate_limit_buckets.reset_at <= $4 THEN $4
                ELSE task_ai_rate_limit_buckets.window_started_at
            END,
            reset_at = CASE
                WHEN task_ai_rate_limit_buckets.reset_at <= $4 THEN $5
                ELSE task_ai_rate_limit_buckets.reset_at
            END,
            updated_at = NOW()
         WHERE task_ai_rate_limit_buckets.reset_at <= $4
            OR task_ai_rate_limit_buckets.request_count < $6
         RETURNING request_count, reset_at`,
        [identity.userId, identity.businessContext, identity.action, windowStartedAt, nextResetAt, normalized.limit]
    );
    const row = result.rows?.[0];
    if (row) {
        const resetAtMs = new Date(row.reset_at).getTime();
        const count = Number(row.request_count || 0);
        return {
            allowed: true,
            key: rateLimitKey(identity),
            limit: normalized.limit,
            remaining: Math.max(0, normalized.limit - count),
            resetAt: resetAtMs,
            retryAfterSeconds: 0,
            durable: true
        };
    }
    const current = await db.query(
        `SELECT request_count, reset_at
         FROM task_ai_rate_limit_buckets
         WHERE user_id = $1 AND business_context = $2 AND action = $3
         LIMIT 1`,
        [identity.userId, identity.businessContext, identity.action]
    );
    const blocked = current.rows?.[0] || {};
    const resetAtMs = new Date(blocked.reset_at || nextResetAt).getTime();
    return {
        allowed: false,
        key: rateLimitKey(identity),
        limit: normalized.limit,
        remaining: 0,
        resetAt: resetAtMs,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - normalized.now) / 1000)),
        durable: true
    };
}

function resetTaskAiDraftRateLimiter() {
    buckets.clear();
}

module.exports = {
    DEFAULT_LIMIT,
    DEFAULT_WINDOW_MS,
    checkTaskAiDraftRateLimit,
    checkMemoryTaskAiDraftRateLimit,
    rateLimitKey,
    resetTaskAiDraftRateLimiter
};
