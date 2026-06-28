'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    REASON_CODES,
    acknowledgeTaskSeen,
    applyTaskWatchdogAutoRescheduleMutationPlan,
    buildDryRunReport,
    buildNewTaskAlarmCandidate,
    buildTaskWatchdogAckCallbackData,
    buildTaskWatchdogAutoRescheduleBatch,
    buildTaskWatchdogAutoRescheduleCandidate,
    buildTaskWatchdogAutoRescheduleMutationPlan,
    buildTaskWatchdogOwnerDigest,
    buildTaskWatchdogOwnerDigests,
    buildTaskWatchdogStateSchemaSql,
    classifyTask,
    ensureTaskWatchdogStateSchema,
    formatTaskTitleForTelegram,
    persistTaskWatchdogEvent,
    runTaskWatchdogCycle,
    runTaskWatchdogScheduler,
    validateTaskWatchdogAutoRescheduleApproval
} = require('../services/taskWatchdog');

const OWNER_SCOPE = {
    3: { crmOwnerUserId: 3, displayName: 'Наталія' },
    4: { crmOwnerUserId: 4, displayName: 'Сергій' }
};

const NOTIFICATION_TARGETS = {
    3: { crmUserId: 3, channel: 'telegram', telegramChatId: '333333', watchdogEnabled: true },
    4: { crmUserId: 4, channel: 'telegram', telegramUserId: 9, telegramChatId: '444444', watchdogEnabled: true }
};

const NOW = new Date('2026-06-28T09:30:00.000Z');
const BASE_OPTIONS = {
    now: NOW,
    ownerScope: OWNER_SCOPE,
    notificationTargets: NOTIFICATION_TARGETS,
    activeOwnerIds: [3, 4],
    policy: { quietHours: { start: '23:00', end: '06:00' } }
};

function task(overrides = {}) {
    return {
        id: 100,
        title: 'Test task',
        owner_user_id: 3,
        account_user_id: 3,
        status: 'todo',
        priority: 'normal',
        created_at: '2026-06-26T09:00:00.000Z',
        updated_at: '2026-06-26T10:00:00.000Z',
        deadline: '2026-06-27T08:00:00.000Z',
        ...overrides
    };
}

function createCyclePool({ tasks = [], users = [] } = {}) {
    const calls = [];
    return {
        calls,
        async query(text, values) {
            calls.push({ text, values });
            if (/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(text)) {
                throw new Error(`unexpected write query: ${text}`);
            }
            if (/FROM users/i.test(text) && !/FROM tasks/i.test(text)) return { rows: users, rowCount: users.length };
            if (/FROM tasks/i.test(text)) return { rows: tasks, rowCount: tasks.length };
            return { rows: [], rowCount: 0 };
        }
    };
}

test('Telegram id 9 is never accepted as CRM owner by accident', () => {
    const row = classifyTask(task({ id: 9, owner_user_id: 9, account_user_id: 4 }), BASE_OPTIONS);

    assert.equal(row.ownerUserId, 9);
    assert.equal(row.watchdogState, 'excluded');
    assert.ok(row.reasonCodes.includes(REASON_CODES.OWNER_NOT_ALLOWED));
    assert.ok(row.reasonCodes.includes(REASON_CODES.TELEGRAM_ID_USED_AS_OWNER_BLOCKED));
    assert.equal(row.proposedRecipient.crmUserId, 9);
    assert.equal(row.proposedRecipient.channelUserIdOrChatIdRedactedOrNull, null);
});

test('Сергій owner 4 and Наталія owner 3 classify separately', () => {
    const report = buildDryRunReport([
        task({ id: 301, owner_user_id: 3, title: 'Наталія task' }),
        task({ id: 401, owner_user_id: 4, account_user_id: 4, title: 'Сергій task' })
    ], BASE_OPTIONS);

    assert.deepEqual(report.ownerScope, [3, 4]);
    const natalia = report.tasks.find(item => item.taskId === 301);
    const sergiy = report.tasks.find(item => item.taskId === 401);
    assert.equal(natalia.ownerUserId, 3);
    assert.equal(natalia.ownerName, 'Наталія');
    assert.equal(sergiy.ownerUserId, 4);
    assert.equal(sergiy.ownerName, 'Сергій');
});

test('Наталія task routes planned reminder to Наталія notification target, not Сергій', () => {
    const row = classifyTask(task({ id: 302, owner_user_id: 3, account_user_id: 4 }), BASE_OPTIONS);

    assert.equal(row.proposedAction, 'first_reminder');
    assert.equal(row.proposedRecipient.crmUserId, 3);
    assert.equal(row.proposedRecipient.channel, 'telegram');
    assert.equal(row.proposedRecipient.channelUserIdOrChatIdRedactedOrNull, '[redacted-present]');
    assert.ok(row.reasonCodes.includes(REASON_CODES.ACCOUNT_USER_NOT_OWNER));
});

test('Unknown owner is skipped with OWNER_NOT_ALLOWED', () => {
    const row = classifyTask(task({ id: 501, owner_user_id: 5, account_user_id: 5 }), BASE_OPTIONS);

    assert.equal(row.watchdogState, 'excluded');
    assert.ok(row.reasonCodes.includes(REASON_CODES.OWNER_NOT_ALLOWED));
    assert.equal(row.proposedAction, 'none');
});

test('accountUserId does not override ownerUserId', () => {
    const row = classifyTask(task({ id: 303, ownerUserId: 3, owner_user_id: undefined, accountUserId: 4 }), BASE_OPTIONS);

    assert.equal(row.ownerUserId, 3);
    assert.equal(row.proposedRecipient.crmUserId, 3);
    assert.notEqual(row.proposedRecipient.crmUserId, 4);
    assert.ok(row.reasonCodes.includes(REASON_CODES.ACCOUNT_USER_NOT_OWNER));
});

test('New urgent task creates new_task_alarm candidate with Бачив ✅ button', () => {
    const { candidate, classification } = buildNewTaskAlarmCandidate(task({
        id: 777,
        owner_user_id: 4,
        account_user_id: 4,
        title: 'Новий VIP договір',
        priority: 'urgent',
        created_at: '2026-06-28T08:30:00.000Z',
        updated_at: '2026-06-28T08:30:00.000Z',
        deadline: '2026-06-28T12:00:00.000Z'
    }), BASE_OPTIONS);

    assert.equal(classification.ownerUserId, 4);
    assert.equal(candidate.kind, 'new_task_alarm');
    assert.equal(candidate.ownerUserId, 4);
    assert.equal(candidate.recipientCrmUserId, 4);
    assert.equal(candidate.dryRun, true);
    assert.deepEqual(candidate.buttons, [
        { label: 'Бачив ✅', action: 'task_watchdog_ack', taskId: 777, callbackData: 'tw_ack:777' }
    ]);
});

test('Ack cannot acknowledge another owner task', () => {
    const denied = acknowledgeTaskSeen({ task: task({ id: 888, owner_user_id: 3 }), actorCrmUserId: 4, ownerScope: OWNER_SCOPE, now: NOW });
    const allowed = acknowledgeTaskSeen({ task: task({ id: 888, owner_user_id: 3 }), actorCrmUserId: 3, ownerScope: OWNER_SCOPE, now: NOW });

    assert.equal(denied.ok, false);
    assert.equal(denied.reasonCode, REASON_CODES.ACK_FORBIDDEN_NOT_OWNER);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.state, 'acknowledged');
    assert.equal(allowed.event.meta.callbackDataShape, 'tw_ack:888');
});

test('Cooldown, quiet hours and daily caps suppress reminders with reason codes', () => {
    const cooldown = classifyTask(task({
        last_notified_at: '2026-06-27T03:00:00.000Z',
        updated_at: '2026-06-26T10:00:00.000Z'
    }), {
        ...BASE_OPTIONS,
        policy: { quietHours: { start: '23:00', end: '06:00' }, minReminderCooldownHours: 48 }
    });
    assert.equal(cooldown.proposedAction, 'suppressed');
    assert.ok(cooldown.reasonCodes.includes(REASON_CODES.COOLDOWN_ACTIVE));

    const quiet = classifyTask(task({ id: 901 }), {
        ...BASE_OPTIONS,
        now: new Date('2026-06-28T19:30:00.000Z'),
        policy: { quietHours: { start: '20:00', end: '09:00' } }
    });
    assert.equal(quiet.proposedAction, 'suppressed');
    assert.ok(quiet.reasonCodes.includes(REASON_CODES.QUIET_HOURS));

    const capped = classifyTask(task({ id: 902, selfRemindersToday: 2 }), BASE_OPTIONS);
    assert.equal(capped.proposedAction, 'suppressed');
    assert.ok(capped.reasonCodes.includes(REASON_CODES.DAILY_CAP_REACHED));
});

test('Dry-run report produces no notification send and no live side effect', () => {
    let sendCalled = false;
    const report = buildDryRunReport([task({ id: 1001 })], {
        ...BASE_OPTIONS,
        send: () => { sendCalled = true; }
    });

    assert.equal(report.dryRun, true);
    assert.equal(report.liveSideEffects, false);
    assert.equal(sendCalled, false);
    assert.equal(report.totals.scanned, 1);
});

test('Scheduler helper defaults to disabled dry-run', async () => {
    let queried = false;
    const fakePool = {
        async query() {
            queried = true;
            return { rows: [] };
        }
    };

    const result = await runTaskWatchdogScheduler(fakePool, { now: NOW });

    assert.equal(result.status, 'disabled');
    assert.equal(result.enabled, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.liveSideEffects, false);
    assert.equal(queried, false);
});

test('Scheduler helper blocks enabled live/send mode before query', async () => {
    let queried = false;
    const fakePool = {
        async query() {
            queried = true;
            return { rows: [] };
        }
    };

    const result = await runTaskWatchdogScheduler(fakePool, {
        enabled: true,
        dryRun: false,
        notificationMode: 'send',
        now: NOW
    });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reasonCode, REASON_CODES.LIVE_ACTIVATION_REQUIRES_APPROVAL);
    assert.ok(result.reasonCodes.includes(REASON_CODES.NOTIFICATION_MODE_NOT_ALLOWED));
    assert.equal(result.liveSideEffects, false);
    assert.equal(queried, false);
});

test('Dry-run deduplicates notification and reminder candidates by stable task id', () => {
    const duplicated = task({
        id: 1201,
        priority: 'urgent',
        created_at: '2026-06-28T08:45:00.000Z',
        updated_at: '2026-06-28T08:45:00.000Z',
        deadline: '2026-06-28T08:00:00.000Z'
    });
    const report = buildDryRunReport([
        duplicated,
        { ...duplicated, title: 'duplicate row copy' },
        { ...duplicated, id: 1202, title: duplicated.title }
    ], BASE_OPTIONS);

    assert.equal(report.totals.scanned, 3);
    assert.equal(report.totals.reminderCandidates, 2);
    assert.equal(report.notificationCandidates.length, 2);
    assert.deepEqual(report.notificationCandidates.map(item => item.taskId).sort((a, b) => a - b), [1201, 1202]);
    assert.ok(report.tasks.find(item => item.taskId === 1201 && item.reasonCodes.includes(REASON_CODES.DUPLICATE_TASK_ID_SUPPRESSED)));
});

test('Telegram title formatter escapes HTML-sensitive chars, controls and missing values', () => {
    const formatted = formatTaskTitleForTelegram('<script>x</script> <b>bold</b> & line\nnext');

    assert.equal(formatted.includes('<script>'), false);
    assert.equal(formatted.includes('<b>'), false);
    assert.equal(formatted.includes('&lt;script&gt;'), true);
    assert.equal(formatted.includes('&amp;'), true);
    assert.equal(formatted.includes('\n'), false);
    assert.equal(formatTaskTitleForTelegram(null), 'Без назви');
    assert.equal(Buffer.byteLength(formatTaskTitleForTelegram('Д'.repeat(500)), 'utf8') <= 120, true);
});

test('New task alarm uses sanitized Telegram text fallback and never raw title HTML', () => {
    const { candidate } = buildNewTaskAlarmCandidate(task({
        id: 1301,
        title: '<b>VIP</b> & urgent\nline',
        priority: 'urgent',
        created_at: '2026-06-28T09:00:00.000Z',
        updated_at: '2026-06-28T09:00:00.000Z'
    }), BASE_OPTIONS);

    assert.equal(candidate.text.includes('<b>'), false);
    assert.equal(candidate.text.includes('&lt;b&gt;VIP&lt;/b&gt; &amp; urgent line'), true);

    const fallback = buildNewTaskAlarmCandidate(task({
        id: 1302,
        title: null,
        priority: 'urgent',
        created_at: '2026-06-28T09:00:00.000Z',
        updated_at: '2026-06-28T09:00:00.000Z'
    }), BASE_OPTIONS).candidate;
    assert.equal(fallback.text.includes('Задача #1302'), true);
});

test('Ack callback data accepts only compact positive integer task ids', () => {
    assert.equal(buildTaskWatchdogAckCallbackData(777), 'tw_ack:777');
    assert.equal(buildTaskWatchdogAckCallbackData('00777'), 'tw_ack:777');
    assert.equal(buildTaskWatchdogAckCallbackData('123 abc'), null);
    assert.equal(buildTaskWatchdogAckCallbackData('<script>1</script>'), null);
    assert.equal(buildTaskWatchdogAckCallbackData('{"id":1}'), null);
    assert.equal(buildTaskWatchdogAckCallbackData('9'.repeat(80)), null);
});

test('Unsafe callback task id suppresses alarm safely with blocker reason', () => {
    const { candidate, classification } = buildNewTaskAlarmCandidate(task({
        id: '<script>1</script>',
        priority: 'urgent',
        created_at: '2026-06-28T09:00:00.000Z'
    }), BASE_OPTIONS);

    assert.equal(candidate, null);
    assert.ok(classification.reasonCodes.includes(REASON_CODES.CALLBACK_DATA_UNSAFE));
});

test('Ack is service-level idempotent for same owner/action and still blocks cross-owner', () => {
    const first = acknowledgeTaskSeen({ task: task({ id: 1401, owner_user_id: 3 }), actorCrmUserId: 3, ownerScope: OWNER_SCOPE, now: NOW });
    const second = acknowledgeTaskSeen({
        task: task({ id: 1401, owner_user_id: 3 }),
        actorCrmUserId: 3,
        ownerScope: OWNER_SCOPE,
        existingAckEvents: [first.event],
        now: NOW
    });
    const crossOwner = acknowledgeTaskSeen({
        task: task({ id: 1401, owner_user_id: 3, watchdogState: 'acknowledged', watchdogAcknowledgedBy: 3 }),
        actorCrmUserId: 4,
        ownerScope: OWNER_SCOPE,
        now: NOW
    });

    assert.equal(first.ok, true);
    assert.equal(first.idempotent, false);
    assert.equal(second.ok, true);
    assert.equal(second.idempotent, true);
    assert.equal(second.alreadyAcknowledged, true);
    assert.equal(second.event, null);
    assert.equal(crossOwner.ok, false);
    assert.equal(crossOwner.reasonCode, REASON_CODES.ACK_FORBIDDEN_NOT_OWNER);
});

test('State machine covers approaching_due, reminded_once and ignored_after_reminder prerequisites', () => {
    const approaching = classifyTask(task({
        id: 1501,
        created_at: '2026-06-28T07:00:00.000Z',
        updated_at: '2026-06-28T07:10:00.000Z',
        deadline: '2026-06-28T11:00:00.000Z'
    }), BASE_OPTIONS);
    const reminded = classifyTask(task({
        id: 1502,
        last_notified_at: '2026-06-28T08:30:00.000Z'
    }), BASE_OPTIONS);
    const ignored = classifyTask(task({
        id: 1503,
        last_notified_at: '2026-06-28T03:00:00.000Z',
        updated_at: '2026-06-27T00:00:00.000Z'
    }), BASE_OPTIONS);
    const oldNoReminder = classifyTask(task({ id: 1504, deadline: '2026-06-26T00:00:00.000Z' }), BASE_OPTIONS);

    assert.equal(approaching.watchdogState, 'approaching_due');
    assert.equal(reminded.watchdogState, 'reminded_once');
    assert.equal(ignored.watchdogState, 'ignored_after_reminder');
    assert.equal(ignored.proposedAction, 'second_reminder');
    assert.notEqual(oldNoReminder.watchdogState, 'ignored_after_reminder');
});

test('State machine covers escalation, resolved exclusions, no due fallback and owner action after reminder', () => {
    const escalation = classifyTask(task({
        id: 1510,
        priority: 'urgent',
        last_notified_at: '2026-06-28T02:00:00.000Z',
        updated_at: '2026-06-27T00:00:00.000Z'
    }), BASE_OPTIONS);
    const excludedStates = ['completed', 'cancelled', 'resolved'].map(status => classifyTask(task({ id: 1520, status }), BASE_OPTIONS));
    const snoozed = classifyTask(task({ id: 1521, snoozed_until: '2026-06-28T12:00:00.000Z' }), BASE_OPTIONS);
    const noDueFallback = classifyTask(task({
        id: 1522,
        deadline: null,
        date: null,
        remind_at: null,
        created_at: '2026-06-27T00:00:00.000Z',
        updated_at: '2026-06-27T00:00:00.000Z'
    }), BASE_OPTIONS);
    const ownerActionAfterReminder = classifyTask(task({
        id: 1523,
        last_notified_at: '2026-06-28T03:00:00.000Z',
        last_owner_action_at: '2026-06-28T08:00:00.000Z',
        updated_at: '2026-06-28T08:00:00.000Z'
    }), BASE_OPTIONS);

    assert.equal(escalation.watchdogState, 'escalation_pending');
    assert.equal(escalation.proposedAction, 'escalate');
    for (const row of excludedStates) {
        assert.equal(row.watchdogState, 'resolved');
        assert.equal(row.proposedAction, 'none');
    }
    assert.equal(snoozed.watchdogState, 'snoozed');
    assert.equal(snoozed.proposedAction, 'none');
    assert.equal(noDueFallback.watchdogState, 'stale');
    assert.equal(noDueFallback.proposedAction, 'first_reminder');
    assert.notEqual(ownerActionAfterReminder.watchdogState, 'ignored_after_reminder');
    assert.notEqual(ownerActionAfterReminder.proposedAction, 'second_reminder');
});

test('Anti-spam covers owner cap, escalation cap, weekend and quiet-hour policies', () => {
    const ownerCapped = classifyTask(task({ id: 1601 }), {
        ...BASE_OPTIONS,
        dailyCounters: { notificationsByOwner: { 3: 10 } }
    });
    const escalationCapped = classifyTask(task({
        id: 1602,
        priority: 'urgent',
        last_notified_at: '2026-06-28T02:00:00.000Z',
        updated_at: '2026-06-27T00:00:00.000Z'
    }), {
        ...BASE_OPTIONS,
        dailyCounters: { escalationsByTask: { 1602: 1 } }
    });
    const weekendNormal = classifyTask(task({
        id: 1603,
        last_notified_at: '2026-06-27T00:00:00.000Z',
        updated_at: '2026-06-26T00:00:00.000Z'
    }), BASE_OPTIONS);
    const weekendUrgent = classifyTask(task({
        id: 1604,
        priority: 'urgent',
        last_notified_at: '2026-06-28T02:00:00.000Z',
        updated_at: '2026-06-27T00:00:00.000Z'
    }), BASE_OPTIONS);
    const quietUrgent = classifyTask(task({
        id: 1605,
        priority: 'urgent',
        deadline: '2026-06-28T18:00:00.000Z'
    }), {
        ...BASE_OPTIONS,
        now: new Date('2026-06-28T19:30:00.000Z'),
        policy: { quietHours: { start: '20:00', end: '09:00' } }
    });

    assert.equal(ownerCapped.proposedAction, 'suppressed');
    assert.ok(ownerCapped.reasonCodes.includes(REASON_CODES.DAILY_CAP_REACHED));
    assert.equal(escalationCapped.proposedAction, 'suppressed');
    assert.ok(escalationCapped.reasonCodes.includes(REASON_CODES.DAILY_CAP_REACHED));
    assert.equal(weekendNormal.proposedAction, 'suppressed');
    assert.ok(weekendNormal.reasonCodes.includes(REASON_CODES.QUIET_HOURS));
    assert.equal(weekendUrgent.proposedAction, 'escalate');
    assert.equal(quietUrgent.proposedAction, 'suppressed');
    assert.ok(quietUrgent.reasonCodes.includes(REASON_CODES.QUIET_HOURS));
});

test('Future last_notified_at clock skew suppresses safely instead of spamming', () => {
    const row = classifyTask(task({
        id: 1610,
        last_notified_at: '2026-06-29T09:30:00.000Z'
    }), BASE_OPTIONS);

    assert.equal(row.proposedAction, 'suppressed');
    assert.ok(row.reasonCodes.includes(REASON_CODES.COOLDOWN_ACTIVE));
});

test('Default-danger: missing notification map, active owners and owner scope do not expand unsafely', () => {
    const missingTargets = buildDryRunReport([task({ id: 1701 })], {
        now: NOW,
        ownerScope: OWNER_SCOPE,
        activeOwnerIds: [3],
        policy: BASE_OPTIONS.policy
    });
    const missingActiveOwners = buildDryRunReport([task({ id: 1702 })], {
        now: NOW,
        ownerScope: OWNER_SCOPE,
        notificationTargets: NOTIFICATION_TARGETS,
        policy: BASE_OPTIONS.policy
    });
    const defaultOwnerScope = buildDryRunReport([task({ id: 1703, owner_user_id: 999, account_user_id: 999 })], {
        now: NOW,
        notificationTargets: { 999: { crmUserId: 999, channel: 'telegram', telegramChatId: '999', watchdogEnabled: true } },
        activeOwnerIds: [999],
        policy: BASE_OPTIONS.policy
    });

    assert.equal(missingTargets.notificationCandidates.length, 0);
    assert.ok(missingTargets.tasks[0].reasonCodes.includes(REASON_CODES.NOTIFICATION_TARGET_MISSING));
    assert.equal(missingActiveOwners.notificationCandidates.length, 0);
    assert.ok(missingActiveOwners.tasks[0].reasonCodes.includes(REASON_CODES.NEEDS_SCHEMA_OR_USAGE_SIGNAL));
    assert.deepEqual(defaultOwnerScope.ownerScope, [3, 4]);
    assert.equal(defaultOwnerScope.tasks[0].watchdogState, 'excluded');
    assert.ok(defaultOwnerScope.tasks[0].reasonCodes.includes(REASON_CODES.OWNER_NOT_ALLOWED));
});

test('runTaskWatchdogCycle defaults to dry-run plan with no sends or DB writes', async () => {
    let sendCalled = false;
    const pool = createCyclePool({
        users: [{ id: 3, telegram_chat_id: '333333', telegram_username: 'natalia' }],
        tasks: [task({
            id: 1801,
            title: 'VIP <contract> & urgent',
            priority: 'urgent',
            created_at: '2026-06-28T09:00:00.000Z',
            updated_at: '2026-06-28T09:00:00.000Z',
            deadline: '2026-06-28T10:00:00.000Z'
        })]
    });

    const result = await runTaskWatchdogCycle(pool, { now: NOW, send: () => { sendCalled = true; } });

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.liveSideEffects, false);
    assert.equal(result.mode, 'task_watchdog_cycle');
    assert.deepEqual(result.ownerScope, [3, 4]);
    assert.equal(sendCalled, false);
    assert.equal(pool.calls.some(call => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(call.text)), false);
    assert.equal(result.receipt.tasksScanned, 1);
    assert.equal(result.receipt.candidatesPlanned, 1);
    assert.equal(result.ackRequiredCount, 1);
    assert.equal(result.notificationCandidates[0].text.includes('<contract>'), false);
    assert.equal(result.notificationCandidates[0].text.includes('&lt;contract&gt; &amp; urgent'), true);
});

test('runTaskWatchdogCycle owner filter stays in CRM namespace for owners 3 and 4', async () => {
    const nataliaPool = createCyclePool({
        users: [{ id: 3, telegram_chat_id: '333333' }],
        tasks: [task({ id: 1810, owner_user_id: 3, title: 'Наталія only' })]
    });
    const sergiyPool = createCyclePool({
        users: [{ id: 4, telegram_chat_id: '444444' }],
        tasks: [task({ id: 1811, owner_user_id: 4, account_user_id: 4, title: 'Сергій only' })]
    });

    const natalia = await runTaskWatchdogCycle(nataliaPool, { now: NOW, ownerUserId: 3 });
    const sergiy = await runTaskWatchdogCycle(sergiyPool, { now: NOW, ownerUserId: 4 });

    assert.equal(natalia.ok, true);
    assert.deepEqual(natalia.ownerScope, [3]);
    assert.equal(natalia.report.tasks[0].ownerUserId, 3);
    assert.deepEqual(nataliaPool.calls.map(call => call.values[0]), [[3], [3]]);
    assert.equal(sergiy.ok, true);
    assert.deepEqual(sergiy.ownerScope, [4]);
    assert.equal(sergiy.report.tasks[0].ownerUserId, 4);
    assert.deepEqual(sergiyPool.calls.map(call => call.values[0]), [[4], [4]]);
});

test('runTaskWatchdogCycle blocks ownerUserId 9 instead of treating Telegram id as CRM owner', async () => {
    const pool = createCyclePool({
        users: [{ id: 4, telegram_chat_id: '9' }],
        tasks: [task({ id: 1819, owner_user_id: 9, account_user_id: 9 })]
    });

    const result = await runTaskWatchdogCycle(pool, { now: NOW, ownerUserId: 9 });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.ok(result.reasonCodes.includes(REASON_CODES.OWNER_NOT_ALLOWED));
    assert.equal(pool.calls.length, 0);
    assert.equal(result.liveSideEffects, false);
});

test('runTaskWatchdogCycle live activation fail-closes before send or query/write', async () => {
    let queried = false;
    const pool = {
        async query() {
            queried = true;
            return { rows: [] };
        }
    };

    const result = await runTaskWatchdogCycle(pool, { dryRun: false, notificationMode: 'send', now: NOW });

    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
    assert.equal(result.reasonCode, REASON_CODES.LIVE_ACTIVATION_REQUIRES_APPROVAL);
    assert.ok(result.reasonCodes.includes(REASON_CODES.NOTIFICATION_MODE_NOT_ALLOWED));
    assert.equal(result.liveSideEffects, false);
    assert.equal(queried, false);
});

test('runTaskWatchdogCycle uses Telegram target only as metadata and does not fallback on missing target', async () => {
    const targetedPool = createCyclePool({
        users: [{ id: 4, telegram_chat_id: '444444', telegram_username: 'sergiy' }],
        tasks: [task({ id: 1820, owner_user_id: 4, account_user_id: 4, priority: 'urgent' })]
    });
    const missingTargetPool = createCyclePool({
        users: [],
        tasks: [task({ id: 1821, owner_user_id: 3, account_user_id: 4, priority: 'urgent' })]
    });

    const targeted = await runTaskWatchdogCycle(targetedPool, { now: NOW, ownerUserId: 4 });
    const missingTarget = await runTaskWatchdogCycle(missingTargetPool, { now: NOW, ownerUserId: 3 });

    assert.equal(targeted.report.tasks[0].proposedRecipient.crmUserId, 4);
    assert.equal(targeted.report.tasks[0].proposedRecipient.channelUserIdOrChatIdRedactedOrNull, '[redacted-present]');
    assert.equal(targeted.report.tasks[0].proposedRecipient.telegram_chat_id, undefined);
    assert.equal(missingTarget.notificationCandidates.length, 0);
    assert.equal(missingTarget.receipt.skippedDueToMissingTarget, 1);
    assert.ok(missingTarget.reasonCodes.includes(REASON_CODES.NOTIFICATION_TARGET_MISSING));
    assert.notEqual(missingTarget.report.tasks[0].proposedRecipient.crmUserId, 4);
});

test('runTaskWatchdogCycle integrates duplicate suppression, unsafe callback and sanitization', async () => {
    const duplicated = task({
        id: 1830,
        title: '<b>VIP</b> & now',
        priority: 'urgent',
        created_at: '2026-06-28T09:00:00.000Z',
        updated_at: '2026-06-28T09:00:00.000Z'
    });
    const pool = createCyclePool({
        users: [{ id: 3, telegram_chat_id: '333333' }],
        tasks: [
            duplicated,
            { ...duplicated, title: 'duplicate row' },
            task({ id: '<script>bad</script>', priority: 'urgent', created_at: '2026-06-28T09:00:00.000Z' })
        ]
    });

    const result = await runTaskWatchdogCycle(pool, { now: NOW, ownerUserId: 3 });

    assert.equal(result.notificationCandidates.length, 1);
    assert.equal(result.receipt.duplicateSuppressed, 1);
    assert.ok(result.reasonCodes.includes(REASON_CODES.CALLBACK_DATA_UNSAFE));
    assert.equal(result.notificationCandidates[0].text.includes('<b>'), false);
    assert.equal(result.notificationCandidates[0].text.includes('&lt;b&gt;VIP&lt;/b&gt; &amp; now'), true);
});

test('Owner digest groups multiple owner 4 tasks into one list candidate', () => {
    const report = buildDryRunReport([
        task({ id: 1352, owner_user_id: 4, account_user_id: 4, title: 'TW тест Сергій — перевірка watchdog', priority: 'urgent', created_at: '2026-06-28T09:00:00.000Z' }),
        task({ id: 1354, owner_user_id: 4, account_user_id: 4, title: 'TW тест Сергій — другий пункт', priority: 'urgent', created_at: '2026-06-28T09:05:00.000Z' })
    ], BASE_OPTIONS);

    const digests = buildTaskWatchdogOwnerDigests(report, BASE_OPTIONS);

    assert.equal(digests.length, 1);
    assert.equal(digests[0].kind, 'owner_task_digest');
    assert.equal(digests[0].ownerUserId, 4);
    assert.equal(digests[0].taskCount, 2);
    assert.deepEqual(digests[0].tasks.map(item => item.taskId), [1352, 1354]);
    assert.equal(digests[0].buttons.length, 2);
    assert.equal(digests[0].buttons[0][0].callback_data, 'tw_ack:1352');
    assert.match(digests[0].text, /👊 Сергій, задачі чекають/);
    assert.match(digests[0].text, /1\. #1352/);
    assert.match(digests[0].text, /2\. #1354/);
    assert.equal(digests[0].liveSideEffects, false);
});

test('Owner digest keeps one-task owner as one digest and separates owners 3 and 4', () => {
    const report = buildDryRunReport([
        task({ id: 1353, owner_user_id: 3, title: 'TW тест Наталія — перевірка watchdog', priority: 'urgent', created_at: '2026-06-28T09:00:00.000Z' }),
        task({ id: 1352, owner_user_id: 4, account_user_id: 4, title: 'TW тест Сергій — перевірка watchdog', priority: 'urgent', created_at: '2026-06-28T09:00:00.000Z' })
    ], BASE_OPTIONS);

    const digests = buildTaskWatchdogOwnerDigests(report, BASE_OPTIONS);

    assert.equal(digests.length, 2);
    assert.deepEqual(digests.map(item => item.ownerUserId), [3, 4]);
    assert.deepEqual(digests.map(item => item.taskCount), [1, 1]);
    assert.match(digests[0].text, /Наталія/);
    assert.match(digests[1].text, /Сергій/);
});

test('Owner digest skips CRM owner 9 unless explicitly allowed in ownerScope', () => {
    const candidates = [{ kind: 'new_task_alarm', taskId: 9001, title: 'owner 9 task', ownerUserId: 9, callbackData: 'tw_ack:9001' }];

    const blocked = buildTaskWatchdogOwnerDigests(candidates, BASE_OPTIONS);
    const allowed = buildTaskWatchdogOwnerDigests(candidates, {
        ...BASE_OPTIONS,
        ownerScope: { ...OWNER_SCOPE, 9: { crmOwnerUserId: 9, displayName: 'CRM 9' } }
    });

    assert.equal(blocked.length, 0);
    assert.equal(allowed.length, 1);
    assert.equal(allowed[0].ownerUserId, 9);
});

test('Owner digest suppresses duplicate task ids in one owner list', () => {
    const digest = buildTaskWatchdogOwnerDigest([
        { kind: 'new_task_alarm', taskId: 2001, title: 'first copy', ownerUserId: 4, callbackData: 'tw_ack:2001' },
        { kind: 'new_task_alarm', taskId: '02001', title: 'duplicate copy', ownerUserId: 4, callbackData: 'tw_ack:2001' },
        { kind: 'new_task_alarm', taskId: 2002, title: 'second task', ownerUserId: 4, callbackData: 'tw_ack:2002' }
    ], BASE_OPTIONS);

    assert.equal(digest.taskCount, 2);
    assert.deepEqual(digest.tasks.map(item => item.taskId), [2001, 2002]);
    assert.ok(digest.reasonCodes.includes(REASON_CODES.DUPLICATE_TASK_ID_SUPPRESSED));
});

test('Owner digest sanitizes and truncates long HTML/newline task titles', () => {
    const unsafeTitle = `<script>x</script> & line\n${'Д'.repeat(500)}`;
    const digest = buildTaskWatchdogOwnerDigest([
        { kind: 'new_task_alarm', taskId: 2101, title: unsafeTitle, ownerUserId: 4, callbackData: 'tw_ack:2101' }
    ], { ...BASE_OPTIONS, maxTextLength: 600 });

    assert.equal(digest.text.includes('<script>'), false);
    assert.equal(digest.text.includes('&lt;script&gt;x&lt;/script&gt; &amp; line'), true);
    assert.equal(digest.text.includes('\nД'), false);
    assert.equal(Buffer.byteLength(digest.text, 'utf8') <= 600, true);
});

test('Owner digest applies max items and reports remaining count', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => {
        const taskIdValue = 3000 + index;
        return { kind: 'new_task_alarm', taskId: taskIdValue, title: `task ${index}`, ownerUserId: 4, callbackData: `tw_ack:${taskIdValue}` };
    });

    const digest = buildTaskWatchdogOwnerDigest(candidates, { ...BASE_OPTIONS, maxItems: 10 });

    assert.equal(digest.taskCount, 12);
    assert.equal(digest.tasks.length, 12);
    assert.equal(digest.buttons.length, 10);
    assert.equal(digest.remainingCount, 2);
    assert.match(digest.text, /\+2 ще/);
    assert.equal(digest.text.includes('#3010'), false);
});

test('Owner digest suppresses unsafe callback id without crashing', () => {
    const digest = buildTaskWatchdogOwnerDigest([
        { kind: 'new_task_alarm', taskId: '<script>bad</script>', title: 'unsafe id', ownerUserId: 4, callbackData: 'tw_ack:<bad>' },
        { kind: 'new_task_alarm', taskId: 3101, title: 'safe id wrong callback', ownerUserId: 4, callbackData: 'tw_ack:9999' }
    ], BASE_OPTIONS);

    assert.equal(digest.taskCount, 2);
    assert.equal(digest.buttons.length, 0);
    assert.ok(digest.tasks.every(item => item.callbackData === null));
    assert.ok(digest.reasonCodes.includes(REASON_CODES.CALLBACK_DATA_UNSAFE));
});

test('runTaskWatchdogCycle groupByOwner returns safe digests without send or DB write', async () => {
    let sendCalled = false;
    const pool = createCyclePool({
        users: [{ id: 4, telegram_chat_id: '444444', telegram_username: 'sergiy' }],
        tasks: [
            task({ id: 3201, owner_user_id: 4, account_user_id: 4, title: 'Сергій digest one', priority: 'urgent', created_at: '2026-06-28T09:00:00.000Z' }),
            task({ id: 3202, owner_user_id: 4, account_user_id: 4, title: 'Сергій digest two', priority: 'urgent', created_at: '2026-06-28T09:05:00.000Z' })
        ]
    });

    const result = await runTaskWatchdogCycle(pool, { now: NOW, ownerUserId: 4, groupByOwner: true, send: () => { sendCalled = true; } });

    assert.equal(result.ok, true);
    assert.equal(result.liveSideEffects, false);
    assert.equal(sendCalled, false);
    assert.equal(pool.calls.some(call => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(call.text)), false);
    assert.equal(result.ownerDigests.length, 1);
    assert.equal(result.ownerDigests[0].ownerUserId, 4);
    assert.equal(result.ownerDigests[0].taskCount, 2);
    assert.equal(result.ownerDigests[0].liveSideEffects, false);
});

test('Auto-reschedule owner 4 missed_today creates approval-ready next business day 09:30 plan', () => {
    const batch = buildTaskWatchdogAutoRescheduleBatch([
        task({ id: 1352, owner_user_id: 4, account_user_id: 4, title: '<b>Сергій</b> missed', deadline: '2026-06-28T18:00:00.000Z' })
    ], { now: NOW, ownerUserId: 4 });

    assert.equal(batch.ok, true);
    assert.equal(batch.dryRun, true);
    assert.equal(batch.liveSideEffects, false);
    assert.deepEqual(batch.ownerScope, [4]);
    assert.equal(batch.summary.eligible, 1);
    assert.equal(batch.safety.crmWrites, 0);
    const change = batch.proposedChanges[0];
    assert.equal(change.taskId, 1352);
    assert.equal(change.ownerUserId, 4);
    assert.equal(change.title.includes('<b>'), false);
    assert.equal(change.proposedDueAt, '2026-06-29T09:30:00+03:00');
    assert.equal(change.reason, 'missed_today');
    assert.ok(change.proposedAddLabels.includes('watchdog'));
    assert.ok(change.proposedAddLabels.includes('watchdog:auto-reschedule-candidate'));
    assert.ok(change.proposedAddLabels.includes('crm_write_pending_approval'));
    assert.ok(change.proposedAddLabels.includes('rollout_serhii'));
    assert.ok(change.proposedAddLabels.includes('owner_4'));
    assert.ok(change.proposedAddLabels.includes('missed_today'));
    assert.equal(change.crmWriteRequired, true);
    assert.equal(change.readbackRequired, true);
    assert.equal(change.approvalRequired, true);
});

test('Auto-reschedule owner 4 overdue_previous_day uses 09:00 and risk_medium', () => {
    const candidate = buildTaskWatchdogAutoRescheduleCandidate(task({
        id: 1351,
        owner_user_id: 4,
        account_user_id: 4,
        deadline: '2026-06-27T15:00:00.000Z'
    }), { now: NOW });

    assert.equal(candidate.ok, true);
    assert.equal(candidate.proposedChange.proposedDueAt, '2026-06-29T09:00:00+03:00');
    assert.equal(candidate.proposedChange.reason, 'overdue_previous_day');
    assert.ok(candidate.proposedChange.proposedAddLabels.includes('risk_medium'));
});

test('Auto-reschedule blocks owners 3 and 9 by default CRM rollout scope', () => {
    const batch = buildTaskWatchdogAutoRescheduleBatch([
        task({ id: 3003, owner_user_id: 3, deadline: '2026-06-28T18:00:00.000Z' }),
        task({ id: 9009, owner_user_id: 9, account_user_id: 9, deadline: '2026-06-28T18:00:00.000Z' })
    ], { now: NOW });

    assert.equal(batch.proposedChanges.length, 0);
    assert.equal(batch.blockedTasks.length, 2);
    assert.ok(batch.blockedTasks.find(item => item.ownerUserId === 3 && item.reasonCode === REASON_CODES.OWNER_NOT_ALLOWED));
    assert.ok(batch.blockedTasks.find(item => item.ownerUserId === 9 && item.reasonCode === REASON_CODES.TELEGRAM_ID_USED_AS_OWNER_BLOCKED));
});

test('Auto-reschedule blocks completed cancelled and archived tasks', () => {
    const batch = buildTaskWatchdogAutoRescheduleBatch(['completed', 'cancelled', 'archived'].map((status, index) => task({
        id: 4100 + index,
        owner_user_id: 4,
        account_user_id: 4,
        status,
        deadline: '2026-06-28T18:00:00.000Z'
    })), { now: NOW });

    assert.equal(batch.proposedChanges.length, 0);
    assert.equal(batch.blockedTasks.length, 3);
    assert.ok(batch.blockedTasks.every(item => item.reasonCode === REASON_CODES.STATUS_EXCLUDED));
});

test('Auto-reschedule manual/problem/sensitive labels block into manual review', () => {
    const batch = buildTaskWatchdogAutoRescheduleBatch([
        task({ id: 4201, owner_user_id: 4, account_user_id: 4, labels: ['do_not_auto_reschedule'], deadline: '2026-06-28T18:00:00.000Z' }),
        task({ id: 4202, owner_user_id: 4, account_user_id: 4, problem_reported: true, deadline: '2026-06-28T18:00:00.000Z' }),
        task({ id: 4203, owner_user_id: 4, account_user_id: 4, title: 'VIP refund conflict', deadline: '2026-06-28T18:00:00.000Z' })
    ], { now: NOW });

    assert.equal(batch.proposedChanges.length, 0);
    assert.equal(batch.summary.manualReview, 3);
    assert.ok(batch.blockedTasks.every(item => item.manualReview === true));
    assert.ok(batch.blockedTasks.every(item => item.crmWriteRequired === false));
});

test('Auto-reschedule active snooze blocks', () => {
    const candidate = buildTaskWatchdogAutoRescheduleCandidate(task({
        id: 4301,
        owner_user_id: 4,
        account_user_id: 4,
        snoozeUntil: '2026-06-28T12:00:00.000Z',
        deadline: '2026-06-28T18:00:00.000Z'
    }), { now: NOW });

    assert.equal(candidate.ok, false);
    assert.equal(candidate.reasonCode, 'SNOOZE_ACTIVE');
});

test('Auto-reschedule already auto-rescheduled today blocks', () => {
    const candidate = buildTaskWatchdogAutoRescheduleCandidate(task({
        id: 4401,
        owner_user_id: 4,
        account_user_id: 4,
        lastAutoRescheduledAt: '2026-06-28T07:00:00.000Z',
        deadline: '2026-06-28T18:00:00.000Z'
    }), { now: NOW });

    assert.equal(candidate.ok, false);
    assert.equal(candidate.reasonCode, 'ALREADY_AUTO_RESCHEDULED_TODAY');
});

test('Auto-reschedule max count blocks at default 2', () => {
    const candidate = buildTaskWatchdogAutoRescheduleCandidate(task({
        id: 4501,
        owner_user_id: 4,
        account_user_id: 4,
        autoRescheduleCount: 2,
        deadline: '2026-06-28T18:00:00.000Z'
    }), { now: NOW });

    assert.equal(candidate.ok, false);
    assert.equal(candidate.reasonCode, 'AUTO_RESCHEDULE_LIMIT_REACHED');
});

test('Auto-reschedule original due older than 7 days blocks as rot risk manual review', () => {
    const candidate = buildTaskWatchdogAutoRescheduleCandidate(task({
        id: 4601,
        owner_user_id: 4,
        account_user_id: 4,
        originalDueAt: '2026-06-20T09:00:00.000Z',
        deadline: '2026-06-27T18:00:00.000Z'
    }), { now: NOW });

    assert.equal(candidate.ok, false);
    assert.equal(candidate.reasonCode, REASON_CODES.ROT_RISK_MANUAL_REVIEW);
    assert.equal(candidate.task.manualReview, true);
    assert.ok(candidate.task.proposedAddLabels.includes('rot_risk'));
});

test('Auto-reschedule proposed changes include idempotency/readback/approval and no live side effects', () => {
    const batch = buildTaskWatchdogAutoRescheduleBatch([
        task({ id: 4701, owner_user_id: 4, account_user_id: 4, deadline: '2026-06-28T18:00:00.000Z' })
    ], { now: NOW, watchdogRunId: 'run-1' });
    const change = batch.proposedChanges[0];

    assert.match(change.idempotencyKeySeed, /4701:.*next_business_day_missed_today:run-1/);
    assert.equal(change.readbackRequired, true);
    assert.equal(change.approvalRequired, true);
    assert.equal(batch.safety.telegramSends, 0);
    assert.equal(batch.safety.crmWrites, 0);
    assert.equal(batch.safety.cronGatewayDeploy, false);
    assert.equal(batch.safety.secretReads, 0);
});

test('Auto-reschedule live/write options fail closed before producing write plan', () => {
    const base = [task({ id: 4801, owner_user_id: 4, account_user_id: 4, deadline: '2026-06-28T18:00:00.000Z' })];
    const dryRunFalse = buildTaskWatchdogAutoRescheduleBatch(base, { now: NOW, dryRun: false });
    const allowWrite = buildTaskWatchdogAutoRescheduleBatch(base, { now: NOW, allowWrite: true });
    const execute = buildTaskWatchdogAutoRescheduleBatch(base, { now: NOW, execute: true });

    assert.equal(dryRunFalse.ok, false);
    assert.equal(dryRunFalse.reasonCode, REASON_CODES.LIVE_ACTIVATION_REQUIRES_APPROVAL);
    assert.equal(allowWrite.ok, false);
    assert.equal(allowWrite.reasonCode, REASON_CODES.CRM_WRITE_REQUIRES_APPROVAL);
    assert.equal(execute.ok, false);
    assert.equal(execute.reasonCode, REASON_CODES.CRM_WRITE_REQUIRES_APPROVAL);
    assert.equal(dryRunFalse.proposedChanges.length, 0);
    assert.equal(allowWrite.proposedChanges.length, 0);
    assert.equal(execute.proposedChanges.length, 0);
    assert.equal(dryRunFalse.dryRun, true);
    assert.equal(allowWrite.dryRun, true);
    assert.equal(execute.dryRun, true);
    assert.equal(dryRunFalse.liveSideEffects, false);
    assert.equal(allowWrite.liveSideEffects, false);
    assert.equal(execute.liveSideEffects, false);
});

test('Auto-reschedule approval packet max tasks and field diffs match proposed changes', () => {
    const batch = buildTaskWatchdogAutoRescheduleBatch([
        task({ id: 4901, owner_user_id: 4, account_user_id: 4, deadline: '2026-06-28T18:00:00.000Z' }),
        task({ id: 4902, owner_user_id: 4, account_user_id: 4, watchdogState: 'acknowledged_unfinished', deadline: '2026-06-28T18:00:00.000Z' })
    ], { now: NOW, ownerUserId: 4 });

    assert.equal(batch.approvalPacket.maxTasks, batch.proposedChanges.length);
    assert.deepEqual(batch.approvalPacket.fields, ['dueAt', 'tags', 'audit']);
    assert.match(batch.approvalPacket.approvalString, /APPROVE CRM\/BOT CHANGE EG-TASK-WATCHDOG-AUTO-RESCHEDULE-20260628-01 OWNER=4 MAX_TASKS=2 FIELDS=dueAt,tags,audit AUTO_RESCHEDULE_COUNT_MAX=2/);
    assert.equal(batch.approvalPacket.perTaskFieldDiffs.length, 2);
    assert.equal(batch.approvalPacket.perTaskFieldDiffs[1].fieldDiff.dueAt.to, '2026-06-29T11:00:00+03:00');
});

function createMutationShellBatch() {
    return buildTaskWatchdogAutoRescheduleBatch([
        task({ id: 1352, owner_user_id: 4, account_user_id: 4, deadline: '2026-06-28T18:00:00.000Z' }),
        task({ id: 1353, owner_user_id: 4, account_user_id: 4, watchdogState: 'acknowledged_unfinished', deadline: '2026-06-28T18:15:00.000Z' })
    ], { now: NOW, ownerUserId: 4, watchdogRunId: 'mutation-shell-test' });
}

function createFakeMutationPool({ mismatchReadback = false } = {}) {
    const calls = [];
    const rowsById = new Map([
        [1352, { id: 1352, owner_user_id: 4, deadline: '2026-06-28T18:00:00.000Z', date: '2026-06-28', control_meta: {}, status: 'todo' }],
        [1353, { id: 1353, owner_user_id: 4, deadline: '2026-06-28T18:15:00.000Z', date: '2026-06-28', control_meta: {}, status: 'todo' }]
    ]);
    return {
        calls,
        async query(text, values) {
            calls.push({ text, values });
            if (/FOR UPDATE/i.test(text)) {
                const row = rowsById.get(values[0]);
                return { rows: row ? [{ ...row, control_meta: { ...row.control_meta } }] : [], rowCount: row ? 1 : 0 };
            }
            if (/^\s*UPDATE tasks/i.test(text)) {
                const row = rowsById.get(values[0]);
                const patch = JSON.parse(values[4]);
                row.deadline = values[2];
                row.date = values[3];
                row.control_meta = { ...row.control_meta, watchdog: patch.watchdog };
                return { rows: [{ ...row }], rowCount: 1 };
            }
            if (/^\s*INSERT INTO task_action_history/i.test(text)) {
                return { rows: [{ id: calls.length }], rowCount: 1 };
            }
            if (/^\s*SELECT id, owner_user_id, deadline, date, control_meta, status FROM tasks/i.test(text)) {
                const row = rowsById.get(values[0]);
                if (!row) return { rows: [], rowCount: 0 };
                if (mismatchReadback) return { rows: [{ ...row, deadline: '2026-06-30T09:30:00+03:00' }], rowCount: 1 };
                return { rows: [{ ...row, control_meta: { ...row.control_meta } }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }
    };
}

test('Auto-reschedule mutation plan produces update audit readback and rollback operations for two tasks', () => {
    const batch = createMutationShellBatch();
    const plan = buildTaskWatchdogAutoRescheduleMutationPlan(batch);

    assert.equal(plan.ok, true);
    assert.equal(plan.mode, 'task_watchdog_auto_reschedule_mutation_plan');
    assert.equal(plan.dryRun, true);
    assert.equal(plan.liveSideEffects, false);
    assert.equal(plan.summary.proposed, 2);
    assert.equal(plan.summary.plannedUpdates, 2);
    assert.equal(plan.summary.plannedAuditEvents, 2);
    assert.equal(plan.operations.filter(item => item.operation === 'update_task_due_and_watchdog_meta').length, 2);
    assert.equal(plan.operations.filter(item => item.operation === 'insert_task_action_history').length, 2);
    assert.equal(plan.readbackPlan.length, 2);
    assert.equal(plan.rollbackPlan.length, 2);
});

test('Auto-reschedule mutation plan stores labels under control_meta watchdog metadata only', () => {
    const plan = buildTaskWatchdogAutoRescheduleMutationPlan(createMutationShellBatch());
    const update = plan.operations.find(item => item.operation === 'update_task_due_and_watchdog_meta');

    assert.ok(update.set.control_meta_patch.watchdog.labels.includes('watchdog'));
    assert.equal(Object.prototype.hasOwnProperty.call(update.set, 'labels'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(update.set, 'tags'), false);
    assert.equal(update.set.control_meta_patch.watchdog.autoReschedule.autoRescheduleCountIncrement, 1);
});

test('Auto-reschedule mutation plan exposes future approval string but remains unapproved', () => {
    const plan = buildTaskWatchdogAutoRescheduleMutationPlan(createMutationShellBatch());

    assert.equal(plan.approvalRequired, true);
    assert.equal(plan.approved, false);
    assert.equal(plan.approvalString, 'APPROVE CRM/BOT CHANGE EG-TASK-WATCHDOG-AUTO-RESCHEDULE-20260628-01 OWNER=4 MAX_TASKS=2 FIELDS=dueAt,tags,audit AUTO_RESCHEDULE_COUNT_MAX=2');
    assert.equal(plan.approvalPacket.approvalString, plan.approvalString);
});

test('Auto-reschedule approval validation passes only on exact expected string', () => {
    const plan = buildTaskWatchdogAutoRescheduleMutationPlan(createMutationShellBatch());
    const ok = validateTaskWatchdogAutoRescheduleApproval(plan, { approvalString: plan.approvalString });
    const wrong = validateTaskWatchdogAutoRescheduleApproval(plan, { approvalString: `${plan.approvalString} ` });
    const missing = validateTaskWatchdogAutoRescheduleApproval(plan, {});

    assert.equal(ok.ok, true);
    assert.equal(ok.approved, true);
    assert.equal(wrong.ok, false);
    assert.ok(wrong.reasonCodes.includes('APPROVAL_STRING_MISMATCH'));
    assert.equal(missing.ok, false);
});

test('Auto-reschedule executor fails closed on missing or wrong approval without querying', async () => {
    const plan = buildTaskWatchdogAutoRescheduleMutationPlan(createMutationShellBatch());
    const pool = createFakeMutationPool();
    const missing = await applyTaskWatchdogAutoRescheduleMutationPlan(pool, plan, { allowWrite: true, execute: true, dryRun: false });
    const wrong = await applyTaskWatchdogAutoRescheduleMutationPlan(pool, plan, { allowWrite: true, execute: true, dryRun: false, approvalString: 'wrong' });
    const noExecute = await applyTaskWatchdogAutoRescheduleMutationPlan(pool, plan, { allowWrite: true, dryRun: false, approvalString: plan.approvalString });

    assert.equal(missing.ok, false);
    assert.equal(wrong.ok, false);
    assert.equal(noExecute.ok, false);
    assert.equal(missing.queryCount, 0);
    assert.equal(wrong.queryCount, 0);
    assert.equal(noExecute.queryCount, 0);
    assert.equal(pool.calls.length, 0);
});

test('Auto-reschedule executor with exact approval uses fake pool in deterministic select update insert readback order', async () => {
    const plan = buildTaskWatchdogAutoRescheduleMutationPlan(createMutationShellBatch());
    const pool = createFakeMutationPool();
    const receipt = await applyTaskWatchdogAutoRescheduleMutationPlan(pool, plan, { allowWrite: true, execute: true, dryRun: false, approvalString: plan.approvalString });

    assert.equal(receipt.ok, true);
    assert.equal(receipt.dryRun, false);
    assert.equal(receipt.applied, 2);
    assert.equal(pool.calls.length, 8);
    assert.match(pool.calls[0].text, /^SELECT .*FOR UPDATE$/i);
    assert.match(pool.calls[1].text, /^UPDATE tasks/i);
    assert.match(pool.calls[1].text, /jsonb_set\(COALESCE\(control_meta/);
    assert.match(pool.calls[2].text, /^INSERT INTO task_action_history/i);
    assert.match(pool.calls[2].text, /old_value_json, new_value_json, meta_json/);
    assert.match(pool.calls[3].text, /^SELECT id, owner_user_id, deadline, date, control_meta, status FROM tasks/i);
    assert.match(pool.calls[4].text, /^SELECT .*FOR UPDATE$/i);
    assert.match(pool.calls[5].text, /^UPDATE tasks/i);
    assert.match(pool.calls[5].text, /jsonb_set\(COALESCE\(control_meta/);
    assert.match(pool.calls[6].text, /^INSERT INTO task_action_history/i);
    assert.match(pool.calls[6].text, /old_value_json, new_value_json, meta_json/);
    assert.match(pool.calls[7].text, /^SELECT id, owner_user_id, deadline, date, control_meta, status FROM tasks/i);
    assert.equal(receipt.safety.crmWrites, 4);
});

test('Auto-reschedule executor blocks invalid pool even with approval', async () => {
    const plan = buildTaskWatchdogAutoRescheduleMutationPlan(createMutationShellBatch());
    const receipt = await applyTaskWatchdogAutoRescheduleMutationPlan(null, plan, { allowWrite: true, execute: true, dryRun: false, approvalString: plan.approvalString });

    assert.equal(receipt.ok, false);
    assert.equal(receipt.reasonCode, 'POOL_QUERY_MISSING');
    assert.equal(receipt.queryCount, 0);
});

test('Auto-reschedule executor reports readback mismatch as failure not success', async () => {
    const plan = buildTaskWatchdogAutoRescheduleMutationPlan(createMutationShellBatch());
    const pool = createFakeMutationPool({ mismatchReadback: true });
    const receipt = await applyTaskWatchdogAutoRescheduleMutationPlan(pool, plan, { allowWrite: true, execute: true, dryRun: false, approvalString: plan.approvalString });

    assert.equal(receipt.ok, false);
    assert.equal(receipt.reasonCode, 'READBACK_MISMATCH');
    assert.equal(receipt.applied, 0);
    assert.equal(receipt.queryCount, 4);
});

test('Auto-reschedule mutation shell keeps owner 3 and telegram namespace 9 empty by default', () => {
    const batch = buildTaskWatchdogAutoRescheduleBatch([
        task({ id: 3003, owner_user_id: 3, deadline: '2026-06-28T18:00:00.000Z' }),
        task({ id: 9009, owner_user_id: 9, account_user_id: 9, deadline: '2026-06-28T18:00:00.000Z' })
    ], { now: NOW });
    const plan = buildTaskWatchdogAutoRescheduleMutationPlan(batch);

    assert.equal(batch.proposedChanges.length, 0);
    assert.equal(plan.operations.length, 0);
    assert.equal(plan.summary.proposed, 0);
    assert.equal(plan.summary.blocked, 2);
});

test('Task watchdog persistence helpers are explicit and idempotency-oriented', async () => {
    const sql = buildTaskWatchdogStateSchemaSql();
    assert.equal(/UNIQUE/i.test(sql), true);
    assert.equal(/idempotency_key/i.test(sql), true);
    assert.equal(/ON CONFLICT/i.test(persistTaskWatchdogEvent.toString()), true);

    let queried = false;
    const pool = {
        async query() {
            queried = true;
            return { rows: [], rowCount: 0 };
        }
    };

    const skippedSchema = await ensureTaskWatchdogStateSchema(pool);
    const skippedPersist = await persistTaskWatchdogEvent(pool, { taskId: 1840, ownerUserId: 3, actionType: 'ack' });

    assert.equal(skippedSchema.skipped, true);
    assert.equal(skippedSchema.reasonCode, REASON_CODES.PERSISTENCE_PREVIEW_NOT_APPLIED);
    assert.equal(skippedPersist.skipped, true);
    assert.equal(skippedPersist.reasonCode, REASON_CODES.PERSISTENCE_PREVIEW_NOT_APPLIED);
    assert.equal(queried, false);
});
