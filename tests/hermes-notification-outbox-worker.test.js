'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const worker = require('../scripts/hermes-notification-outbox-worker');

function baseEnv(overrides = {}) {
    return {
        ...overrides
    };
}

function targetEnv(overrides = {}) {
    return baseEnv({
        HERMES_OUTBOX_OWNER_TARGETS_JSON: JSON.stringify({
            1: 'telegram:1001',
            3: 'telegram:1003',
            4: 'telegram:1004',
            13: 'telegram:1013',
            40: 'telegram:1040'
        }),
        ...overrides
    });
}

function event(ownerUserId = 4, id = 1, extra = {}) {
    return {
        event_id: `task_created:${id}:owner:${ownerUserId}`,
        task_id: id,
        owner_user_id: ownerUserId,
        event_type: 'task_created',
        payload_json: {
            taskId: id,
            title: `Task ${id}`,
            ownerUserId,
            ownerLabel: `Owner ${ownerUserId}`,
            priority: 'normal',
            crmUrl: `https://crm.example/tasks?open=${id}`
        },
        status: 'pending',
        attempts: 0,
        ...extra
    };
}

function depsFor(events, calls = []) {
    return {
        listNotificationOutboxEvents: async filters => {
            calls.push(['list', filters]);
            return { events };
        },
        getNotificationOutboxStats: async () => ({ stats: { pending: events.length, claimed: 0, failed: 0 } }),
        claimNotificationOutboxEvent: async (eventId, body) => {
            calls.push(['claim', eventId, body]);
            return { event: events.find(item => item.event_id === eventId), claimed: true };
        },
        ackNotificationOutboxEvent: async (eventId, body) => {
            calls.push(['ack', eventId, body]);
            return { event: events.find(item => item.event_id === eventId), alreadySent: false };
        },
        failNotificationOutboxEvent: async (eventId, body) => {
            calls.push(['fail', eventId, body]);
            return { event: events.find(item => item.event_id === eventId), retryable: true };
        },
        sendTelegramMessage: async (chatId, text) => {
            calls.push(['send', chatId, text]);
            return { ok: true, messageId: 555 };
        }
    };
}

test('default config is read-only with exact approved owner allowlist and no live gates', () => {
    const config = worker.buildConfig(baseEnv());
    assert.equal(config.ok, true);
    assert.equal(config.mode, 'read_only');
    assert.deepEqual(config.ownerAllowlist, [4, 3, 40, 13, 1]);
    assert.equal(config.ownerAllowlistExact, true);
    assert.equal(config.allowSend, false);
    assert.equal(config.allowCrmMutation, false);
    assert.equal(config.confirmSend, false);
    assert.equal(config.localCronPausedConfirmed, false);
    assert.equal(config.maxEvents <= worker.MAX_EVENTS_HARD_CAP, true);
});

test('live gates require exact approvals, Telegram token, targets, and local cron pause proof', () => {
    const config = worker.buildConfig(targetEnv({
        HERMES_OUTBOX_WORKER_MODE: 'live_once',
        HERMES_OUTBOX_ALLOW_SEND: '1',
        HERMES_OUTBOX_ALLOW_CRM_MUTATION: '1',
        HERMES_OUTBOX_CONFIRM_SEND: '1',
        TELEGRAM_BOT_TOKEN: '[REDACTED_TEST_PLACEHOLDER]'
    }));
    const blockers = worker.liveGateBlockers(config);
    assert.ok(blockers.includes('LOCAL_CRON_PAUSED_CONFIRMATION_MISSING'));
    assert.equal(blockers.includes(worker.OWNER16_BLOCK_CODE), false);
});

test('owner16 is hard-blocked even when a target exists', () => {
    const config = worker.buildConfig(targetEnv({
        HERMES_OUTBOX_OWNER_TARGETS_JSON: JSON.stringify({
            16: 'telegram:1016',
            4: 'telegram:1004',
            3: 'telegram:1003',
            40: 'telegram:1040',
            13: 'telegram:1013',
            1: 'telegram:1001'
        })
    }));
    const plan = worker.classifyEvent(event(16, 16), config);
    assert.equal(plan.ready, false);
    assert.ok(plan.blockers.includes(worker.OWNER16_BLOCK_CODE));
});

test('read_only run builds a plan and never claims, sends, acks, or fails', async () => {
    const calls = [];
    const result = await worker.runOnce({
        env: targetEnv(),
        deps: {
            listNotificationOutboxEvents: async filters => {
                calls.push(['list', filters]);
                return { events: [event(4, 1)] };
            },
            claimNotificationOutboxEvent: async () => { throw new Error('claim must not run'); },
            ackNotificationOutboxEvent: async () => { throw new Error('ack must not run'); },
            failNotificationOutboxEvent: async () => { throw new Error('fail must not run'); },
            sendTelegramMessage: async () => { throw new Error('send must not run'); }
        }
    });
    assert.equal(result.status, 'READ_ONLY_PLAN');
    assert.equal(result.ready_count, 1);
    assert.equal(result.send_attempted, false);
    assert.equal(result.crm_mutation_attempted, false);
    assert.deepEqual(calls.map(call => call[0]), ['list']);
});

test('read_only run returns source-unavailable blocker without send or CRM mutation when source read fails', async () => {
    const calls = [];
    const result = await worker.runOnce({
        env: targetEnv(),
        deps: {
            listNotificationOutboxEvents: async () => {
                calls.push(['list']);
                const err = new Error('');
                err.code = 'ECONNREFUSED';
                throw err;
            },
            claimNotificationOutboxEvent: async () => { throw new Error('claim must not run'); },
            ackNotificationOutboxEvent: async () => { throw new Error('ack must not run'); },
            failNotificationOutboxEvent: async () => { throw new Error('fail must not run'); },
            sendTelegramMessage: async () => { throw new Error('send must not run'); }
        }
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED_SOURCE_UNAVAILABLE');
    assert.equal(result.source_error_code, 'ECONNREFUSED');
    assert.equal(result.send_attempted, false);
    assert.equal(result.crm_mutation_attempted, false);
    assert.deepEqual(calls.map(call => call[0]), ['list']);
});

test('live_once without local cron pause proof blocks before claim/send', async () => {
    const calls = [];
    const result = await worker.runOnce({
        env: targetEnv({
            HERMES_OUTBOX_WORKER_MODE: 'live_once',
            HERMES_OUTBOX_ALLOW_SEND: '1',
            HERMES_OUTBOX_ALLOW_CRM_MUTATION: '1',
            HERMES_OUTBOX_CONFIRM_SEND: '1',
            TELEGRAM_BOT_TOKEN: '[REDACTED_TEST_PLACEHOLDER]'
        }),
        deps: depsFor([event(4, 1)], calls)
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED_LIVE_GATES');
    assert.ok(result.liveGateBlockers.includes('LOCAL_CRON_PAUSED_CONFIRMATION_MISSING'));
    assert.equal(result.send_attempted, false);
    assert.equal(result.crm_mutation_attempted, false);
    assert.deepEqual(calls.map(call => call[0]), ['list']);
});

test('live_once processes only ready approved owners and leaves owner16 blocked', async () => {
    const calls = [];
    const env = targetEnv({
        HERMES_OUTBOX_WORKER_MODE: 'live_once',
        HERMES_OUTBOX_ALLOW_SEND: '1',
        HERMES_OUTBOX_ALLOW_CRM_MUTATION: '1',
        HERMES_OUTBOX_CONFIRM_SEND: '1',
        HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED: '1',
        TELEGRAM_BOT_TOKEN: '[REDACTED_TEST_PLACEHOLDER]'
    });
    const result = await worker.runOnce({
        env,
        deps: depsFor([event(4, 1), event(16, 16)], calls)
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'LIVE_RUN_COMPLETE');
    assert.equal(result.ready_count, 1);
    assert.equal(result.blocked_count, 1);
    assert.ok(result.blocked[0].blockers.includes(worker.OWNER16_BLOCK_CODE));
    assert.equal(result.sent_count, 1);
    assert.equal(result.processed_count, 1);
    assert.equal(result.send_attempted, true);
    assert.equal(result.crm_mutation_attempted, true);
    assert.deepEqual(calls.map(call => call[0]), ['list', 'claim', 'send', 'ack']);
});

test('live_once records a retryable fail when Telegram send fails', async () => {
    const calls = [];
    const deps = depsFor([event(4, 1)], calls);
    deps.sendTelegramMessage = async chatId => {
        calls.push(['send', chatId]);
        return { ok: false, errorCode: 'TELEGRAM_500', description: 'mock failure' };
    };
    const result = await worker.runOnce({
        env: targetEnv({
            HERMES_OUTBOX_WORKER_MODE: 'live_once',
            HERMES_OUTBOX_ALLOW_SEND: '1',
            HERMES_OUTBOX_ALLOW_CRM_MUTATION: '1',
            HERMES_OUTBOX_CONFIRM_SEND: '1',
            HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED: '1',
            TELEGRAM_BOT_TOKEN: '[REDACTED_TEST_PLACEHOLDER]'
        }),
        deps
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'LIVE_RUN_WITH_FAILURES');
    assert.equal(result.failed_count, 1);
    assert.deepEqual(calls.map(call => call[0]), ['list', 'claim', 'send', 'fail']);
});

test('max events are hard-capped at 10 even if env requests more', () => {
    const config = worker.buildConfig(targetEnv({ HERMES_OUTBOX_WORKER_MAX_EVENTS: '999' }));
    assert.equal(config.maxEvents, 10);
});
