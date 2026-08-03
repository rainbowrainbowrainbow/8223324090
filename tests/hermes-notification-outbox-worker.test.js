'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

test('batch config supports read-only loop without opening live gates', () => {
    const config = worker.buildConfig(targetEnv({
        HERMES_OUTBOX_WORKER_MODE: 'read_only_loop',
        HERMES_OUTBOX_BATCH_ENABLED: '1',
        HERMES_OUTBOX_BATCH_OWNER_USER_IDS: '4,3'
    }));
    assert.equal(config.ok, true);
    assert.equal(config.mode, 'read_only_loop');
    assert.equal(config.batchEnabled, true);
    assert.deepEqual(config.batchOwnerIds, [4, 3]);
    assert.deepEqual(worker.liveGateBlockers(config), []);
});

test('invalid explicit active owner scope blocks config instead of widening scope', () => {
    const config = worker.buildConfig(targetEnv({ HERMES_OUTBOX_ACTIVE_OWNER_USER_IDS: 'not-a-user' }));
    assert.equal(config.ok, false);
    assert.equal(config.reasonCode, 'INVALID_ACTIVE_OWNER_IDS');
});

test('read_only batch mode groups normal task events without claim, send, ack, or fail', async () => {
    const calls = [];
    const result = await worker.runOnce({
        env: targetEnv({
            HERMES_OUTBOX_BATCH_ENABLED: '1',
            HERMES_OUTBOX_BATCH_OWNER_USER_IDS: '4'
        }),
        deps: depsFor([event(4, 1), event(4, 2)], calls),
        includePreview: true
    });
    assert.equal(result.status, 'READ_ONLY_PLAN');
    assert.equal(result.ready_count, 2);
    assert.equal(result.immediate_ready_count, 0);
    assert.equal(result.batch_candidate_count, 2);
    assert.equal(result.batchPlan.batch_count, 1);
    assert.deepEqual(result.batchPlan.buckets[0].taskIds, [1, 2]);
    assert.match(result.batchPlan.buckets[0].messagePreview, /Нові задачі за годину/);
    assert.equal(result.send_attempted, false);
    assert.equal(result.crm_mutation_attempted, false);
    assert.deepEqual(calls.map(call => call[0]), ['list']);
});

test('high priority task stays on immediate path while normal tasks are batched', async () => {
    const calls = [];
    const urgent = event(4, 9);
    urgent.payload_json.priority = 'high';
    const result = await worker.runOnce({
        env: targetEnv({
            HERMES_OUTBOX_BATCH_ENABLED: '1',
            HERMES_OUTBOX_BATCH_OWNER_USER_IDS: '4'
        }),
        deps: depsFor([event(4, 1), urgent], calls)
    });
    assert.equal(result.status, 'READ_ONLY_PLAN');
    assert.equal(result.ready_count, 2);
    assert.equal(result.immediate_ready_count, 1);
    assert.equal(result.batch_candidate_count, 1);
    assert.deepEqual(result.ready.map(item => item.taskId), [9]);
    assert.deepEqual(result.batchPlan.buckets[0].taskIds, [1]);
    assert.equal(result.send_attempted, false);
    assert.equal(result.crm_mutation_attempted, false);
    assert.deepEqual(calls.map(call => call[0]), ['list']);
});

test('live_once active owner scope blocks other approved owners during an owner-scoped pilot', async () => {
    const calls = [];
    const result = await worker.runOnce({
        env: targetEnv({
            HERMES_OUTBOX_WORKER_MODE: 'live_once',
            HERMES_OUTBOX_ALLOW_SEND: '1',
            HERMES_OUTBOX_ALLOW_CRM_MUTATION: '1',
            HERMES_OUTBOX_CONFIRM_SEND: '1',
            HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED: '1',
            HERMES_OUTBOX_ACTIVE_OWNER_USER_IDS: '4',
            TELEGRAM_BOT_TOKEN: '[REDACTED_TEST_PLACEHOLDER]'
        }),
        deps: depsFor([event(4, 1), event(3, 3)], calls)
    });
    assert.equal(result.ok, true);
    assert.equal(result.activeOwnerIds.length, 1);
    assert.equal(result.ready_count, 1);
    assert.equal(result.blocked_count, 1);
    assert.deepEqual(result.ready.map(item => item.ownerUserId), [4]);
    assert.ok(result.blocked[0].blockers.includes('OWNER_NOT_IN_ACTIVE_SCOPE'));
    assert.deepEqual(calls.map(call => call[0]), ['list', 'claim', 'send', 'ack']);
});

test('live_once approved event ids restrict processing to an exact selected set', async () => {
    const calls = [];
    const result = await worker.runOnce({
        env: targetEnv({
            HERMES_OUTBOX_WORKER_MODE: 'live_once',
            HERMES_OUTBOX_ALLOW_SEND: '1',
            HERMES_OUTBOX_ALLOW_CRM_MUTATION: '1',
            HERMES_OUTBOX_CONFIRM_SEND: '1',
            HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED: '1',
            HERMES_OUTBOX_APPROVED_EVENT_IDS: 'task_created:1:owner:4',
            TELEGRAM_BOT_TOKEN: '[REDACTED_TEST_PLACEHOLDER]'
        }),
        deps: depsFor([event(4, 1), event(4, 2)], calls)
    });
    assert.equal(result.ok, true);
    assert.equal(result.approvedEventIdsConfigured, true);
    assert.equal(result.approvedEventIdsCount, 1);
    assert.equal(result.ready_count, 1);
    assert.equal(result.blocked_count, 1);
    assert.deepEqual(result.processed.map(item => item.eventId), ['task_created:1:owner:4']);
    assert.ok(result.blocked[0].blockers.includes('EVENT_NOT_IN_APPROVED_LIVE_SELECTION'));
    assert.deepEqual(calls.map(call => call[0]), ['list', 'claim', 'send', 'ack']);
});

test('live_once sends high priority immediate items before spending maxEvents on batch backlog', async () => {
    const calls = [];
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-outbox-batch-priority-'));
    const urgent = event(4, 9);
    urgent.payload_json.priority = 'high';
    const result = await worker.runOnce({
        env: targetEnv({
            HERMES_OUTBOX_WORKER_MODE: 'live_once',
            HERMES_OUTBOX_ALLOW_SEND: '1',
            HERMES_OUTBOX_ALLOW_CRM_MUTATION: '1',
            HERMES_OUTBOX_CONFIRM_SEND: '1',
            HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED: '1',
            HERMES_OUTBOX_BATCH_ENABLED: '1',
            HERMES_OUTBOX_BATCH_FORCE: '1',
            HERMES_OUTBOX_BATCH_OWNER_USER_IDS: '4',
            HERMES_OUTBOX_BATCH_STATE_DIR: stateDir,
            HERMES_OUTBOX_WORKER_MAX_EVENTS: '1',
            TELEGRAM_BOT_TOKEN: '[REDACTED_TEST_PLACEHOLDER]'
        }),
        deps: depsFor([event(4, 1), urgent], calls)
    });
    assert.equal(result.ok, true);
    assert.equal(result.sent_count, 1);
    assert.deepEqual(result.processed.map(item => item.taskId), [9]);
    assert.equal(result.batch_processed[0].status, 'not_selected_max_events_reached');
    assert.deepEqual(calls.map(call => call[0]), ['list', 'claim', 'send', 'ack']);
});

test('live_once batch sends one grouped Telegram message and acks selected events when all live gates are approved', async () => {
    const calls = [];
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-outbox-batch-test-'));
    const deps = depsFor([event(4, 1), event(4, 2)], calls);
    let sentText = '';
    deps.sendTelegramMessage = async (chatId, text) => {
        calls.push(['send', chatId, text]);
        sentText = text;
        return { ok: true, messageId: 777 };
    };
    const result = await worker.runOnce({
        env: targetEnv({
            HERMES_OUTBOX_WORKER_MODE: 'live_once',
            HERMES_OUTBOX_ALLOW_SEND: '1',
            HERMES_OUTBOX_ALLOW_CRM_MUTATION: '1',
            HERMES_OUTBOX_CONFIRM_SEND: '1',
            HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED: '1',
            HERMES_OUTBOX_BATCH_ENABLED: '1',
            HERMES_OUTBOX_BATCH_FORCE: '1',
            HERMES_OUTBOX_BATCH_OWNER_USER_IDS: '4',
            HERMES_OUTBOX_BATCH_STATE_DIR: stateDir,
            TELEGRAM_BOT_TOKEN: '[REDACTED_TEST_PLACEHOLDER]'
        }),
        deps
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'LIVE_RUN_COMPLETE');
    assert.equal(result.sent_count, 2);
    assert.equal(result.processed_count, 2);
    assert.equal(result.send_attempted, true);
    assert.equal(result.crm_mutation_attempted, true);
    assert.match(sentText, /Нові задачі за годину/);
    assert.match(sentText, /#1/);
    assert.match(sentText, /#2/);
    assert.deepEqual(calls.map(call => call[0]), ['list', 'claim', 'claim', 'send', 'ack', 'ack']);
    assert.ok(fs.existsSync(path.join(stateDir, 'owner-4.json')));
});

test('batch duplicate guard holds recently attempted event ids instead of resending them', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-outbox-batch-guard-'));
    const env = targetEnv({
        HERMES_OUTBOX_WORKER_MODE: 'live_once',
        HERMES_OUTBOX_ALLOW_SEND: '1',
        HERMES_OUTBOX_ALLOW_CRM_MUTATION: '1',
        HERMES_OUTBOX_CONFIRM_SEND: '1',
        HERMES_OUTBOX_LOCAL_CRON_PAUSED_CONFIRMED: '1',
        HERMES_OUTBOX_BATCH_ENABLED: '1',
        HERMES_OUTBOX_BATCH_FORCE: '1',
        HERMES_OUTBOX_BATCH_OWNER_USER_IDS: '4',
        HERMES_OUTBOX_BATCH_STATE_DIR: stateDir,
        TELEGRAM_BOT_TOKEN: '[REDACTED_TEST_PLACEHOLDER]'
    });
    const firstCalls = [];
    const first = await worker.runOnce({
        env,
        deps: depsFor([event(4, 1), event(4, 2)], firstCalls)
    });
    assert.equal(first.ok, true);
    assert.equal(first.sent_count, 2);
    assert.deepEqual(firstCalls.map(call => call[0]), ['list', 'claim', 'claim', 'send', 'ack', 'ack']);

    const secondCalls = [];
    const second = await worker.runOnce({
        env,
        deps: depsFor([event(4, 1), event(4, 2)], secondCalls)
    });
    assert.equal(second.ok, true);
    assert.equal(second.sent_count, 0);
    assert.equal(second.send_attempted, false);
    assert.equal(second.crm_mutation_attempted, false);
    assert.equal(second.batch_processed[0].status, 'held_duplicate_guard');
    assert.deepEqual(second.batch_processed[0].heldEventIds, ['task_created:1:owner:4', 'task_created:2:owner:4']);
    assert.deepEqual(secondCalls.map(call => call[0]), ['list']);
});
