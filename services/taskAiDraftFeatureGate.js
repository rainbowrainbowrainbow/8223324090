'use strict';

const crypto = require('node:crypto');

const DEFAULT_ROLLOUT_PERCENT = 0;

function parseBool(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    const raw = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(raw)) return false;
    return fallback;
}

function parseList(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

function normalizePercent(value, fallback = DEFAULT_ROLLOUT_PERCENT) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, parsed));
}

function userIdentity(user = {}) {
    const source = user && typeof user === 'object' ? user : {};
    return {
        id: String(source.id || source.userId || source.user_id || '').trim(),
        username: String(source.username || source.name || source.login || '').trim().toLowerCase(),
        email: String(source.email || '').trim().toLowerCase()
    };
}

function stableBucket(seed) {
    const hash = crypto.createHash('sha256').update(String(seed || '')).digest();
    return hash.readUInt32BE(0) % 100;
}

function isNonProduction(env = process.env) {
    const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
    return nodeEnv && nodeEnv !== 'production';
}

function taskAiDraftFeatureStatus(user = {}, options = {}) {
    const env = options.env || process.env;
    const identity = userIdentity(user);
    const forceDisabled = parseBool(env.TASK_AI_DRAFT_DISABLED, false);
    if (forceDisabled) {
        return {
            enabled: false,
            reason: 'disabled_by_env',
            rolloutPercent: 0,
            matched: null
        };
    }

    const explicitEnabled = parseBool(env.TASK_AI_DRAFT_ENABLED, isNonProduction(env));
    const testUserIds = parseList(env.TASK_AI_DRAFT_TEST_USER_IDS);
    const testUsernames = parseList(env.TASK_AI_DRAFT_TEST_USERNAMES);
    const testEmails = parseList(env.TASK_AI_DRAFT_TEST_EMAILS);
    const rolloutPercent = normalizePercent(env.TASK_AI_DRAFT_ROLLOUT_PERCENT, explicitEnabled ? 100 : DEFAULT_ROLLOUT_PERCENT);

    if (identity.id && testUserIds.includes(identity.id.toLowerCase())) {
        return { enabled: true, reason: 'test_user_id', rolloutPercent, matched: 'user_id' };
    }
    if (identity.username && testUsernames.includes(identity.username)) {
        return { enabled: true, reason: 'test_username', rolloutPercent, matched: 'username' };
    }
    if (identity.email && testEmails.includes(identity.email)) {
        return { enabled: true, reason: 'test_email', rolloutPercent, matched: 'email' };
    }

    if (!explicitEnabled && rolloutPercent <= 0) {
        return {
            enabled: false,
            reason: 'not_enabled',
            rolloutPercent,
            matched: null
        };
    }

    const bucketSeed = identity.id || identity.username || identity.email || 'anonymous';
    const bucket = stableBucket(`task-ai-draft:${bucketSeed}`);
    const enabled = bucket < rolloutPercent;
    return {
        enabled,
        reason: enabled ? 'rollout_bucket' : 'outside_rollout',
        rolloutPercent,
        bucket,
        matched: enabled ? 'rollout' : null
    };
}

function taskAiDraftBundleFeatureStatus(user = {}, options = {}) {
    const env = options.env || process.env;
    const identity = userIdentity(user);
    const forceDisabled = parseBool(env.TASK_AI_DRAFT_BUNDLE_DISABLED, false);
    if (forceDisabled) {
        return {
            enabled: false,
            reason: 'bundle_disabled_by_env',
            rolloutPercent: 0,
            matched: null
        };
    }

    const explicitEnabled = parseBool(env.TASK_AI_DRAFT_BUNDLE_ENABLED, false);
    const testUserIds = parseList(env.TASK_AI_DRAFT_BUNDLE_TEST_USER_IDS || env.TASK_AI_DRAFT_TEST_USER_IDS);
    const testUsernames = parseList(env.TASK_AI_DRAFT_BUNDLE_TEST_USERNAMES || env.TASK_AI_DRAFT_TEST_USERNAMES);
    const testEmails = parseList(env.TASK_AI_DRAFT_BUNDLE_TEST_EMAILS || env.TASK_AI_DRAFT_TEST_EMAILS);
    const rolloutPercent = normalizePercent(env.TASK_AI_DRAFT_BUNDLE_ROLLOUT_PERCENT, explicitEnabled ? 100 : 0);

    if (identity.id && testUserIds.includes(identity.id.toLowerCase())) {
        return { enabled: true, reason: 'bundle_test_user_id', rolloutPercent, matched: 'user_id' };
    }
    if (identity.username && testUsernames.includes(identity.username)) {
        return { enabled: true, reason: 'bundle_test_username', rolloutPercent, matched: 'username' };
    }
    if (identity.email && testEmails.includes(identity.email)) {
        return { enabled: true, reason: 'bundle_test_email', rolloutPercent, matched: 'email' };
    }

    if (!explicitEnabled && rolloutPercent <= 0) {
        return {
            enabled: false,
            reason: 'bundle_not_enabled',
            rolloutPercent,
            matched: null
        };
    }

    const bucketSeed = identity.id || identity.username || identity.email || 'anonymous';
    const bucket = stableBucket(`task-ai-draft-bundle:${bucketSeed}`);
    const enabled = bucket < rolloutPercent;
    return {
        enabled,
        reason: enabled ? 'bundle_rollout_bucket' : 'bundle_outside_rollout',
        rolloutPercent,
        bucket,
        matched: enabled ? 'rollout' : null
    };
}

function publicTaskAiDraftFeatureStatus(user = {}, options = {}) {
    const status = taskAiDraftFeatureStatus(user, options);
    return {
        enabled: status.enabled,
        reason: status.reason,
        rolloutPercent: status.rolloutPercent,
        matched: status.matched
    };
}

function publicTaskAiDraftBundleFeatureStatus(user = {}, options = {}) {
    const status = taskAiDraftBundleFeatureStatus(user, options);
    return {
        enabled: status.enabled,
        reason: status.reason,
        rolloutPercent: status.rolloutPercent,
        matched: status.matched
    };
}

function publicTaskAiDraftFeaturesStatus(user = {}, options = {}) {
    return {
        composer: publicTaskAiDraftFeatureStatus(user, options),
        bundle: publicTaskAiDraftBundleFeatureStatus(user, options)
    };
}

function assertTaskAiDraftFeatureEnabled(user = {}, options = {}) {
    const status = taskAiDraftFeatureStatus(user, options);
    if (status.enabled) return status;
    const error = new Error('AI draft composer is not enabled for this user.');
    error.statusCode = 403;
    error.code = 'TASK_AI_DRAFT_DISABLED';
    error.meta = publicTaskAiDraftFeatureStatus(user, options);
    throw error;
}

function assertTaskAiDraftBundleFeatureEnabled(user = {}, options = {}) {
    const status = taskAiDraftBundleFeatureStatus(user, options);
    if (status.enabled) return status;
    const error = new Error('AI task bundle creation is not enabled for this user.');
    error.statusCode = 403;
    error.code = 'TASK_AI_DRAFT_BUNDLE_DISABLED';
    error.meta = publicTaskAiDraftBundleFeatureStatus(user, options);
    throw error;
}

module.exports = {
    assertTaskAiDraftBundleFeatureEnabled,
    assertTaskAiDraftFeatureEnabled,
    publicTaskAiDraftBundleFeatureStatus,
    publicTaskAiDraftFeatureStatus,
    publicTaskAiDraftFeaturesStatus,
    taskAiDraftBundleFeatureStatus,
    stableBucket,
    taskAiDraftFeatureStatus
};
