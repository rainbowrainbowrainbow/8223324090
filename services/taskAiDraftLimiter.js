'use strict';

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

function checkTaskAiDraftRateLimit(input = {}, options = {}) {
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

function resetTaskAiDraftRateLimiter() {
    buckets.clear();
}

module.exports = {
    DEFAULT_LIMIT,
    DEFAULT_WINDOW_MS,
    checkTaskAiDraftRateLimit,
    rateLimitKey,
    resetTaskAiDraftRateLimiter
};
