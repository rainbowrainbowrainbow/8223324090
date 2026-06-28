'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    REASON_CODES,
    handleTaskWatchdogAck,
    parseTaskWatchdogCallbackData
} = require('../services/taskWatchdog');
const {
    buildTaskWatchdogSoloRolloutPacket,
    createTaskWatchdogCallbackDryRunHandler,
    createTaskWatchdogDryRunHandler,
    createTaskWatchdogPreviewHandler,
    redactWatchdogTargets
} = require('../services/taskWatchdogRoutes');

const OWNER_SCOPE = {
    3: { crmOwnerUserId: 3, displayName: 'Наталія' },
    4: { crmOwnerUserId: 4, displayName: 'Сергій' }
};

function createAckPool({ task = null, insertRowCount = 1 } = {}) {
    const calls = [];
    return {
        calls,
        async query(text, values) {
            calls.push({ text, values });
            if (/^\s*SELECT\b/i.test(text) && /\bFROM tasks\b/i.test(text)) {
                return { rows: task ? [task] : [], rowCount: task ? 1 : 0 };
            }
            if (/^\s*INSERT\s+INTO task_watchdog_events\b/i.test(text)) {
                return { rows: insertRowCount ? [{ id: 1, idempotency_key: values[0] }] : [], rowCount: insertRowCount };
            }
            throw new Error(`unexpected query: ${text}`);
        }
    };
}

function createResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('parseTaskWatchdogCallbackData accepts tw_ack task id and does not encode owner or Telegram ids', () => {
    assert.deepEqual(parseTaskWatchdogCallbackData('tw_ack:123'), { ok: true, action: 'ack', taskId: 123 });
    assert.equal(parseTaskWatchdogCallbackData('tw_ack:123:owner:3').reasonCode, REASON_CODES.CALLBACK_DATA_UNSAFE);
    assert.equal(parseTaskWatchdogCallbackData('tw_ack:123:tg:9').reasonCode, REASON_CODES.CALLBACK_DATA_UNSAFE);
});

test('parseTaskWatchdogCallbackData rejects unsafe, long and malformed callback data', () => {
    const unsafe = [
        '',
        'tw_ack:0',
        'tw_ack:-1',
        'tw_ack:abc',
        'tw_ack:123<script>',
        '{"action":"ack","taskId":123}',
        `tw_ack:${'1'.repeat(70)}`,
        'tw_ack:9007199254740993123'
    ];
    for (const value of unsafe) {
        assert.equal(parseTaskWatchdogCallbackData(value).reasonCode, REASON_CODES.CALLBACK_DATA_UNSAFE, value);
    }
});

test('handleTaskWatchdogAck reads task by id and owner can ack in dry-run without write', async () => {
    const pool = createAckPool({ task: { id: 123, owner_user_id: 3, account_user_id: 4, title: 'Owned by Natalia' } });

    const result = await handleTaskWatchdogAck(pool, {
        callbackData: 'tw_ack:123',
        actorCrmUserId: 3,
        ownerScope: OWNER_SCOPE,
        now: new Date('2026-06-28T10:00:00.000Z')
    });

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.liveSideEffects, false);
    assert.equal(result.ownerUserId, 3);
    assert.equal(result.actorCrmUserId, 3);
    assert.deepEqual(result.persistence, { applied: false, reasonCode: REASON_CODES.PERSISTENCE_PREVIEW_NOT_APPLIED });
    assert.equal(pool.calls.length, 1);
    assert.match(pool.calls[0].text, /FROM tasks/);
    assert.deepEqual(pool.calls[0].values, [123]);
});

test('handleTaskWatchdogAck blocks cross-owner actor and never treats Telegram id as CRM actor', async () => {
    const pool = createAckPool({ task: { id: 123, owner_user_id: 3, account_user_id: 3 } });

    const result = await handleTaskWatchdogAck(pool, {
        callbackData: 'tw_ack:123',
        actorCrmUserId: 4,
        ownerScope: OWNER_SCOPE
    });

    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, REASON_CODES.ACK_FORBIDDEN_NOT_OWNER);
    assert.equal(result.liveSideEffects, false);
    assert.equal(pool.calls.length, 1);
});

test('handleTaskWatchdogAck blocks owner 9 unless CRM owner scope explicitly includes 9', async () => {
    const pool = createAckPool({ task: { id: 901, owner_user_id: 9, account_user_id: 9 } });

    const blocked = await handleTaskWatchdogAck(pool, {
        callbackData: 'tw_ack:901',
        actorCrmUserId: 9,
        ownerScope: OWNER_SCOPE
    });
    const allowed = await handleTaskWatchdogAck(pool, {
        callbackData: 'tw_ack:901',
        actorCrmUserId: 9,
        ownerScope: { ...OWNER_SCOPE, 9: { crmOwnerUserId: 9, displayName: 'CRM 9' } }
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.reasonCode, REASON_CODES.OWNER_NOT_ALLOWED);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.ownerUserId, 9);
});

test('handleTaskWatchdogAck returns safe not-found and unsafe callback receipts', async () => {
    const pool = createAckPool({ task: null });

    const missing = await handleTaskWatchdogAck(pool, { callbackData: 'tw_ack:777', actorCrmUserId: 3, ownerScope: OWNER_SCOPE });
    const unsafe = await handleTaskWatchdogAck(pool, { callbackData: '<b>tw_ack:777</b>', actorCrmUserId: 3, ownerScope: OWNER_SCOPE });

    assert.equal(missing.ok, false);
    assert.equal(missing.reasonCode, REASON_CODES.TASK_NOT_FOUND);
    assert.equal(missing.liveSideEffects, false);
    assert.equal(unsafe.ok, false);
    assert.equal(unsafe.reasonCode, REASON_CODES.CALLBACK_DATA_UNSAFE);
    assert.equal(pool.calls.length, 1);
});

test('handleTaskWatchdogAck allowWrite persists one idempotent event via fake pool insert', async () => {
    const pool = createAckPool({ task: { id: 123, owner_user_id: 3, account_user_id: 3 }, insertRowCount: 0 });

    const result = await handleTaskWatchdogAck(pool, {
        callbackData: 'tw_ack:123',
        actorCrmUserId: 3,
        ownerScope: OWNER_SCOPE,
        allowWrite: true
    });

    const inserts = pool.calls.filter(call => /^\s*INSERT\s+INTO task_watchdog_events\b/i.test(call.text));
    assert.equal(result.ok, true);
    assert.equal(result.persistence.applied, false);
    assert.equal(result.persistence.idempotent, true);
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].values[0], 'task_watchdog:ack:3:123:3');
});

test('task watchdog migration artifact contains idempotency unique key and required indexes', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '272_task_watchdog_events.sql'), 'utf8');

    assert.match(sql, /MIGRATION_KIND: schema/);
    assert.match(sql, /ROLLBACK:/);
    assert.match(sql, /idempotency_key TEXT NOT NULL UNIQUE/i);
    assert.match(sql, /ON task_watchdog_events\(task_id, owner_user_id, action_type, created_at DESC\)/i);
    assert.match(sql, /ON task_watchdog_events\(owner_user_id, created_at DESC\)/i);
});

test('route handler factory dry-run validates CRM owner, calls cycle and redacts Telegram targets', async () => {
    const calls = [];
    const handler = createTaskWatchdogDryRunHandler({
        pool: { query: async () => ({ rows: [] }) },
        ownerScope: OWNER_SCOPE,
        runCycle: async (pool, options) => {
            calls.push({ pool, options });
            return {
                ok: true,
                dryRun: true,
                liveSideEffects: false,
                notificationCandidates: [{ telegramChatId: '333333', nested: { telegramUserId: 9 } }]
            };
        }
    });
    const response = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };

    await handler({ query: { ownerUserId: '3' } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.notificationCandidates[0].telegramChatId, '[redacted-present]');
    assert.equal(response.body.notificationCandidates[0].nested.telegramUserId, '[redacted-present]');
    assert.equal(response.body.liveSideEffects, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.ownerUserId, 3);
    assert.equal(calls[0].options.notificationMode, 'plan');
});

test('route handler factory blocks ownerUserId 9 and performs no live send/write', async () => {
    let called = false;
    const handler = createTaskWatchdogDryRunHandler({
        ownerScope: OWNER_SCOPE,
        runCycle: async () => { called = true; return { ok: true }; }
    });
    const response = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };

    await handler({ query: { ownerUserId: '9' } }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.reasonCode, REASON_CODES.OWNER_NOT_ALLOWED);
    assert.equal(response.body.liveSideEffects, false);
    assert.equal(called, false);
});

test('rich preview handler returns grouped cycle digest auto-reschedule and mutation plan with safety flags false', async () => {
    const calls = { runCycle: [], batch: [], plan: [] };
    const handler = createTaskWatchdogPreviewHandler({
        pool: { query: async () => ({ rows: [] }) },
        runCycle: async (pool, options) => {
            calls.runCycle.push({ pool, options });
            return {
                ok: true,
                mode: 'task_watchdog_cycle',
                dryRun: true,
                liveSideEffects: false,
                ownerScope: [4],
                generatedAt: '2026-06-28T09:30:00.000Z',
                receipt: { tasksScanned: 1, candidatesPlanned: 1 },
                report: {
                    totals: { scanned: 1, reminderCandidates: 1 },
                    tasks: [{ taskId: 4701, title: 'Sergiy task', ownerUserId: 4, status: 'todo', dueAt: '2026-06-28T18:00:00.000Z', telegramChatId: '444444' }]
                },
                ownerDigests: [{ ownerUserId: 4, ownerName: 'Сергій', taskCount: 1, text: 'digest', telegramChatId: '444444' }],
                ackRequiredCount: 1,
                blockers: [],
                reasonCodes: []
            };
        },
        buildAutoRescheduleBatch: (tasks, options) => {
            calls.batch.push({ tasks, options });
            return {
                ok: true,
                mode: 'task_watchdog_auto_reschedule_batch',
                dryRun: true,
                liveSideEffects: false,
                ownerUserId: 4,
                summary: { scanned: tasks.length, eligible: 1, blocked: 0, maxWrites: 1 },
                proposedChanges: [{ taskId: 4701, ownerUserId: 4 }],
                blockedTasks: [],
                approvalPacket: { packetId: 'packet', fields: ['dueAt', 'tags', 'audit'], maxTasks: 1, approvalString: 'APPROVE CRM/BOT CHANGE packet OWNER=4 MAX_TASKS=1 FIELDS=dueAt,tags,audit AUTO_RESCHEDULE_COUNT_MAX=2' },
                safety: { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 }
            };
        },
        buildMutationPlan: (batch, options) => {
            calls.plan.push({ batch, options });
            return {
                ok: true,
                mode: 'task_watchdog_auto_reschedule_mutation_plan',
                dryRun: true,
                liveSideEffects: false,
                ownerUserId: 4,
                approvalRequired: true,
                approved: false,
                summary: { proposed: 1, plannedUpdates: 1, plannedAuditEvents: 1, blocked: 0 },
                operations: [{ operation: 'update_task_due_and_watchdog_meta' }, { operation: 'insert_task_action_history' }],
                readbackPlan: [{ taskId: 4701 }],
                rollbackPlan: [{ taskId: 4701 }],
                approvalPacket: batch.approvalPacket,
                safety: { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 }
            };
        }
    });
    const response = createResponse();

    await handler({ query: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.mode, 'task_watchdog_preview');
    assert.equal(response.body.ownerUserId, 4);
    assert.equal(response.body.dryRun, true);
    assert.equal(response.body.liveSideEffects, false);
    assert.deepEqual(response.body.safety, {
        wouldSendTelegram: false,
        wouldMutateCrm: false,
        wouldEnableCron: false,
        wouldApplyMigration: false,
        wouldDeploy: false
    });
    assert.equal(response.body.cycleReceipt.receipt.tasksScanned, 1);
    assert.equal(response.body.digestPreview.grouped, true);
    assert.equal(response.body.digestPreview.perTaskSpam, false);
    assert.equal(response.body.autoReschedulePreview.summary.eligible, 1);
    assert.equal(response.body.mutationPlanPreview.operationCount, 2);
    assert.equal(calls.runCycle.length, 1);
    assert.equal(calls.runCycle[0].options.dryRun, true);
    assert.equal(calls.runCycle[0].options.notificationMode, 'plan');
    assert.equal(calls.runCycle[0].options.groupByOwner, true);
    assert.equal(calls.runCycle[0].options.ownerUserId, 4);
    assert.equal(calls.batch[0].tasks[0].telegramChatId, '444444');
    assert.equal(response.body.digestPreview.owners[0].telegramChatId, undefined);
});

test('rich preview handler allows owner 4 and redacts Telegram targets', async () => {
    const handler = createTaskWatchdogPreviewHandler({
        runCycle: async () => ({
            ok: true,
            ownerScope: [4],
            report: { totals: { scanned: 1 }, tasks: [{ taskId: 1, ownerUserId: 4, status: 'todo', dueAt: '2026-06-28T18:00:00.000Z' }] },
            ownerDigests: [{ ownerUserId: 4, telegramUserId: 9, telegramChatId: '444444', taskCount: 1 }]
        }),
        buildAutoRescheduleBatch: () => ({ ok: true, ownerUserId: 4, proposedChanges: [], blockedTasks: [], safety: { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 } }),
        buildMutationPlan: () => ({ ok: true, ownerUserId: 4, approvalRequired: true, approved: false, operations: [], readbackPlan: [], rollbackPlan: [], safety: { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 } })
    });
    const response = createResponse();

    await handler({ query: { ownerUserId: '4' } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(JSON.stringify(response.body).includes('444444'), false);
    assert.equal(JSON.stringify(response.body).includes('telegramChatId'), false);
});

test('rich preview handler blocks owner 9 before query', async () => {
    let called = false;
    const handler = createTaskWatchdogPreviewHandler({ runCycle: async () => { called = true; return { ok: true }; } });
    const response = createResponse();

    await handler({ query: { ownerUserId: '9' } }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.reasonCode, REASON_CODES.OWNER_NOT_ALLOWED);
    assert.equal(called, false);
});

test('rich preview handler blocks owner 3 by default but allows explicit non-default scope', async () => {
    let defaultCalled = false;
    const blocked = createTaskWatchdogPreviewHandler({ runCycle: async () => { defaultCalled = true; return { ok: true }; } });
    const blockedResponse = createResponse();
    await blocked({ query: { ownerUserId: '3' } }, blockedResponse);

    let allowedOwner = null;
    const allowed = createTaskWatchdogPreviewHandler({
        ownerScope: OWNER_SCOPE,
        runCycle: async (pool, options) => {
            allowedOwner = options.ownerUserId;
            return { ok: true, ownerScope: [3], report: { tasks: [], totals: { scanned: 0 } }, ownerDigests: [] };
        },
        buildAutoRescheduleBatch: () => ({ ok: true, ownerUserId: 3, proposedChanges: [], blockedTasks: [], safety: { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 } }),
        buildMutationPlan: () => ({ ok: true, ownerUserId: 3, operations: [], readbackPlan: [], rollbackPlan: [], safety: { crmWrites: 0, telegramSends: 0, cronGatewayDeploy: false, secretReads: 0 } })
    });
    const allowedResponse = createResponse();
    await allowed({ query: { ownerUserId: '3' } }, allowedResponse);

    assert.equal(blockedResponse.statusCode, 400);
    assert.equal(defaultCalled, false);
    assert.equal(allowedResponse.statusCode, 200);
    assert.equal(allowedOwner, 3);
});

test('callback dry-run handler accepts tw_ack for owner 4 and returns no persistence write', async () => {
    const calls = [];
    const handler = createTaskWatchdogCallbackDryRunHandler({
        pool: { query: async () => { throw new Error('should use injected handleAck'); } },
        handleAck: async (pool, options) => {
            calls.push({ pool, options });
            return { ok: true, action: 'ack', taskId: 123, ownerUserId: 4, actorCrmUserId: 4, persistence: { applied: false, reasonCode: REASON_CODES.PERSISTENCE_PREVIEW_NOT_APPLIED } };
        }
    });
    const response = createResponse();

    await handler({ body: { callbackData: 'tw_ack:123', actorCrmUserId: '4' } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.dryRun, true);
    assert.equal(response.body.liveSideEffects, false);
    assert.equal(response.body.wouldMutateCrm, false);
    assert.equal(response.body.persistence.applied, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.dryRun, true);
    assert.equal(calls[0].options.allowWrite, false);
    assert.equal(calls[0].options.actorCrmUserId, 4);
});

test('callback dry-run handler blocks cross-owner actor and unsafe callback', async () => {
    const unsafeCalls = [];
    const unsafe = createTaskWatchdogCallbackDryRunHandler({ handleAck: async () => { unsafeCalls.push(true); return { ok: true }; } });
    const unsafeResponse = createResponse();
    await unsafe({ query: { data: '<b>tw_ack:123</b>', actorCrmUserId: '4' } }, unsafeResponse);

    const crossOwner = createTaskWatchdogCallbackDryRunHandler({
        handleAck: async () => ({ ok: false, reasonCode: REASON_CODES.ACK_FORBIDDEN_NOT_OWNER, liveSideEffects: false })
    });
    const crossOwnerResponse = createResponse();
    await crossOwner({ body: { callbackData: 'tw_ack:123', actorCrmUserId: '3' } }, crossOwnerResponse);

    assert.equal(unsafeResponse.statusCode, 400);
    assert.equal(unsafeResponse.body.reasonCode, REASON_CODES.CALLBACK_DATA_UNSAFE);
    assert.equal(unsafeCalls.length, 0);
    assert.equal(crossOwnerResponse.statusCode, 400);
    assert.equal(crossOwnerResponse.body.reasonCode, REASON_CODES.ACK_FORBIDDEN_NOT_OWNER);
    assert.equal(crossOwnerResponse.body.wouldMutateCrm, false);
});

test('callback dry-run handler never uses Telegram id as CRM actor', async () => {
    let called = false;
    const handler = createTaskWatchdogCallbackDryRunHandler({ handleAck: async () => { called = true; return { ok: true }; } });
    const response = createResponse();

    await handler({ body: { callbackData: 'tw_ack:123', telegramUserId: 9 } }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.reasonCode, 'ACTOR_CRM_USER_REQUIRED');
    assert.equal(called, false);
});

test('rollout packet helper lists exact approvals and safe-local gates', () => {
    const packet = buildTaskWatchdogSoloRolloutPacket({ ownerUserId: 4 });

    assert.equal(packet.dryRun, true);
    assert.equal(packet.liveSideEffects, false);
    assert.equal(packet.currentSafeLocalGates.send, false);
    assert.equal(packet.currentSafeLocalGates.crmWrite, false);
    assert.equal(packet.currentSafeLocalGates.cron, false);
    assert.equal(packet.currentSafeLocalGates.gateway, false);
    assert.ok(packet.exactApprovalsStillRequired.some(item => /DB migration/i.test(item)));
    assert.ok(packet.exactApprovalsStillRequired.some(item => /Telegram send/i.test(item)));
    assert.ok(packet.exactApprovalsStillRequired.some(item => /CRM write/i.test(item)));
    assert.ok(packet.exactApprovalsStillRequired.some(item => /cron\/gateway/i.test(item)));
    assert.ok(packet.exactApprovalsStillRequired.some(item => /deploy/i.test(item)));
});

test('redactWatchdogTargets redacts raw Telegram target values in nested receipts', () => {
    assert.deepEqual(redactWatchdogTargets({ telegram_chat_id: '123', keep: 'ok', nested: { channelUserIdOrChatIdRedactedOrNull: 'raw' } }), {
        telegram_chat_id: '[redacted-present]',
        keep: 'ok',
        nested: { channelUserIdOrChatIdRedactedOrNull: '[redacted-present]' }
    });
});
