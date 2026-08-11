'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gate = require('../services/taskAiDraftFeatureGate');

const root = path.resolve(__dirname, '..');

test('Task AI draft feature gate is production safe and supports test-user allowlists', () => {
    const user = { id: 42, username: 'serhii', email: 'owner@example.test' };
    assert.deepEqual(
        gate.publicTaskAiDraftFeatureStatus(user, { env: { NODE_ENV: 'production' } }),
        { enabled: false, reason: 'not_enabled', rolloutPercent: 0, matched: null }
    );

    assert.deepEqual(
        gate.publicTaskAiDraftFeatureStatus(user, {
            env: { NODE_ENV: 'production', TASK_AI_DRAFT_TEST_USER_IDS: '41,42' }
        }),
        { enabled: true, reason: 'test_user_id', rolloutPercent: 0, matched: 'user_id' }
    );

    assert.deepEqual(
        gate.publicTaskAiDraftFeatureStatus(user, {
            env: { NODE_ENV: 'production', TASK_AI_DRAFT_TEST_USERNAMES: 'serhii' }
        }),
        { enabled: true, reason: 'test_username', rolloutPercent: 0, matched: 'username' }
    );

    assert.deepEqual(
        gate.publicTaskAiDraftFeatureStatus(user, {
            env: { NODE_ENV: 'production', TASK_AI_DRAFT_TEST_EMAILS: 'owner@example.test' }
        }),
        { enabled: true, reason: 'test_email', rolloutPercent: 0, matched: 'email' }
    );
});

test('Task AI draft feature gate supports explicit enable, hard disable, and stable percent rollout', () => {
    const user = { id: 7, username: 'operator' };

    assert.equal(
        gate.publicTaskAiDraftFeatureStatus(user, {
            env: { NODE_ENV: 'production', TASK_AI_DRAFT_ENABLED: 'true' }
        }).enabled,
        true
    );

    assert.equal(
        gate.publicTaskAiDraftFeatureStatus(user, {
            env: { NODE_ENV: 'production', TASK_AI_DRAFT_ENABLED: 'true', TASK_AI_DRAFT_DISABLED: 'true' }
        }).enabled,
        false
    );

    const first = gate.publicTaskAiDraftFeatureStatus(user, {
        env: { NODE_ENV: 'production', TASK_AI_DRAFT_ROLLOUT_PERCENT: '20' }
    });
    const second = gate.publicTaskAiDraftFeatureStatus(user, {
        env: { NODE_ENV: 'production', TASK_AI_DRAFT_ROLLOUT_PERCENT: '20' }
    });
    assert.deepEqual(first, second);
    assert.equal(first.rolloutPercent, 20);
});

test('Task AI draft feature gate throws controlled disabled error', () => {
    assert.throws(
        () => gate.assertTaskAiDraftFeatureEnabled({ id: 1 }, { env: { NODE_ENV: 'production' } }),
        error => error.code === 'TASK_AI_DRAFT_DISABLED' && error.statusCode === 403
    );
});

test('Task AI draft bundle gate is separate and defaults to off/test-only', () => {
    const user = { id: 42, username: 'serhii', email: 'owner@example.test' };
    assert.deepEqual(
        gate.publicTaskAiDraftBundleFeatureStatus(user, { env: { NODE_ENV: 'production', TASK_AI_DRAFT_ROLLOUT_PERCENT: '100' } }),
        { enabled: false, reason: 'bundle_not_enabled', rolloutPercent: 0, matched: null }
    );
    assert.deepEqual(
        gate.publicTaskAiDraftBundleFeatureStatus(user, { env: { NODE_ENV: 'production', TASK_AI_DRAFT_BUNDLE_TEST_USER_IDS: '42' } }),
        { enabled: true, reason: 'bundle_test_user_id', rolloutPercent: 0, matched: 'user_id' }
    );
    assert.equal(
        gate.publicTaskAiDraftBundleFeatureStatus(user, { env: { NODE_ENV: 'production', TASK_AI_DRAFT_BUNDLE_ENABLED: 'true' } }).enabled,
        true
    );
    assert.throws(
        () => gate.assertTaskAiDraftBundleFeatureEnabled(user, { env: { NODE_ENV: 'production' } }),
        error => error.code === 'TASK_AI_DRAFT_BUNDLE_DISABLED' && error.statusCode === 403
    );
});

test('Task AI draft routes and diagnostics expose rollout state without secrets', () => {
    const routes = fs.readFileSync(path.join(root, 'routes', 'tasks.js'), 'utf8');
    const aiConfig = fs.readFileSync(path.join(root, 'services', 'ai-config.js'), 'utf8');
    const taskCreate = fs.readFileSync(path.join(root, 'js', 'task-create.js'), 'utf8');
    const taskAiDraft = fs.readFileSync(path.join(root, 'js', 'task-ai-draft.js'), 'utf8');

    assert.match(routes, /router\.get\('\/ai-draft\/status'/);
    assert.match(routes, /assertTaskAiDraftFeatureEnabled\(req\.user\)/);
    assert.match(routes, /bundleFeature: publicTaskAiDraftBundleFeatureStatus\(req\.user\)/);
    assert.match(routes, /assertTaskAiDraftBundleFeatureEnabled\(req\.user\)/);
    assert.match(aiConfig, /id: 'task_ai_draft_composer'/);
    assert.match(aiConfig, /featureEnabled: taskAiDraftFeature\.enabled/);
    assert.match(aiConfig, /bundleFeatureEnabled: taskAiDraftBundleFeature\.enabled/);
    assert.match(aiConfig, /bundleRolloutPercent: taskAiDraftBundleFeature\.rolloutPercent/);
    assert.match(aiConfig, /model: MY_DAY_TASK_AI_MODEL/);
    assert.match(taskCreate, /requestAiDraftStatus/);
    assert.match(taskAiDraft, /applyFeatureStatus/);
    assert.match(taskAiDraft, /button\.hidden = true/);
    assert.doesNotMatch(aiConfig, /TASK_AI_DRAFT_TEST_EMAILS.*email/i);
});
