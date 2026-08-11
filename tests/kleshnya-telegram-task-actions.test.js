'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODULES_TO_CLEAR = [
    '../db',
    '../services/kleshnya',
    '../services/notificationOutbox',
    '../services/telegram',
    '../services/taskDuplicatePolicy',
    '../services/taskBusinessScope',
    '../services/taskNotifications',
    '../utils/logger'
];

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    for (const modulePath of MODULES_TO_CLEAR) {
        try { delete require.cache[require.resolve(modulePath)]; } catch (_) {}
    }
}

function loadKleshnya(pool = { query: async () => ({ rows: [] }) }) {
    clearModules();
    installMock('../db', { pool });
    installMock('../services/telegram', {
        sendTelegramMessage: async () => ({ ok: true }),
        getConfiguredChatId: async () => 'group-chat',
        getConfiguredThreadId: async () => null,
        telegramRequest: async () => ({ ok: true })
    });
    installMock('../services/taskDuplicatePolicy', {
        TaskDuplicateError: class TaskDuplicateError extends Error {},
        findActiveDuplicateTask: async () => null
    });
    installMock('../services/taskBusinessScope', {
        DEFAULT_TASK_BUSINESS_CONTEXT: 'event_genix',
        taskBusinessContextFromPayload: () => 'event_genix'
    });
    installMock('../services/taskNotifications', {
        emitTaskAssignedToOwner: () => {}
    });
    installMock('../utils/logger', {
        createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} })
    });
    return require('../services/kleshnya');
}

test.afterEach(() => {
    delete process.env.TASK_TELEGRAM_RESCHEDULE_BUTTONS;
    clearModules();
});

test('task inline buttons include acknowledgement and completion without reschedule by default', () => {
    const { getTaskInlineButtons } = loadKleshnya();
    const buttons = getTaskInlineButtons({ id: 42, status: 'todo', task_type: 'human' });

    const flat = buttons.flat();
    assert.ok(flat.some(button => button.text.includes('Бачив') && button.callback_data === 'task_ack:42:todo'));
    assert.ok(flat.some(button => button.text.includes('В роботу') && button.callback_data === 'task_confirm:42:todo'));
    assert.ok(flat.some(button => button.text.includes('Виконано') && button.callback_data === 'task_done:42:todo'));
    assert.equal(flat.some(button => button.callback_data.startsWith('task_reschedule:')), false);
});

test('reschedule button is opt-in only and callback data remains short', () => {
    process.env.TASK_TELEGRAM_RESCHEDULE_BUTTONS = 'true';
    const { getTaskInlineButtons } = loadKleshnya();
    const buttons = getTaskInlineButtons({ id: 123456, status: 'in_progress', task_type: 'human' });
    const flat = buttons.flat();
    const reschedule = flat.find(button => button.callback_data.startsWith('task_reschedule:'));

    assert.ok(reschedule, 'expected opt-in reschedule button');
    assert.equal(reschedule.callback_data, 'task_reschedule:123456:in_progress');
    assert.ok(Buffer.byteLength(reschedule.callback_data, 'utf8') <= 64);
});

test('terminal tasks do not expose Telegram action buttons', () => {
    const { getTaskInlineButtons } = loadKleshnya();

    for (const status of ['done', 'completed', 'complete', 'cancelled', 'canceled', 'archived']) {
        assert.equal(getTaskInlineButtons({ id: 42, status, task_type: 'human' }), null);
    }
});

test('Kleshnya reminder queries exclude archived and terminal tasks', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'kleshnya.js'), 'utf8');

    assert.match(source, /WHERE archived_at IS NULL\s+AND LOWER\(COALESCE\(status, 'todo'\)\) NOT IN \$\{TERMINAL_TASK_STATUS_SQL\}\s+AND task_type = 'human'/);
    assert.match(source, /WHERE archived_at IS NULL\s+AND LOWER\(COALESCE\(status, 'todo'\)\) NOT IN \$\{TERMINAL_TASK_STATUS_SQL\}\s+AND deadline IS NOT NULL/);
    assert.match(source, /const TERMINAL_TASK_STATUSES = \['done', 'completed', 'complete', 'cancelled', 'canceled', 'archived'\]/);
});

test('telegram task actor guard keeps CRM owner id separate from Telegram ids', () => {
    const { isTelegramTaskActorAllowed } = loadKleshnya();
    const task = { id: 99, owner_user_id: 4, assigned_to: 'sergiy' };

    assert.equal(isTelegramTaskActorAllowed(task, { id: 4, username: 'sergiy' }), true);
    assert.equal(isTelegramTaskActorAllowed(task, { id: 9, username: 'sergiy' }), false, 'Telegram id 9 must not satisfy CRM ownerUserId 4');
    assert.equal(isTelegramTaskActorAllowed(task, { id: 3, username: 'nataliia' }), false);
});

test('acknowledgeTask only records acknowledgement and reminder timestamp, not done status', async () => {
    const queries = [];
    const task = { id: 77, status: 'todo', owner_user_id: 4, title: 'Test task' };
    const pool = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ text, params });
            if (text.startsWith('SELECT * FROM tasks WHERE id = $1')) return { rows: [task] };
            if (text.startsWith('UPDATE tasks SET last_reminded_at = NOW()')) return { rowCount: 1, rows: [] };
            if (text.startsWith('INSERT INTO task_logs')) return { rowCount: 1, rows: [] };
            return { rows: [] };
        }
    };
    const { acknowledgeTask } = loadKleshnya(pool);

    const result = await acknowledgeTask(77, 'sergiy', 4);

    assert.equal(result.id, 77);
    assert.equal(queries.some(q => q.text.includes("status='done'") || q.text.includes('status = \'done\'') || q.text.includes('SET status')), false);
    assert.ok(queries.some(q => q.text.startsWith('UPDATE tasks SET last_reminded_at = NOW()')));
    assert.ok(queries.some(q => q.text.startsWith('INSERT INTO task_logs') && q.params[1] === 'acknowledged'));
});

test('updateTaskStatus does not reopen completed scheduled tasks through generic path', async () => {
    const queries = [];
    const task = {
        id: 88,
        status: 'done',
        workflow_state: 'done',
        schedule_status: 'completed',
        scheduled_start_at: '2099-02-01T09:00:00.000Z',
        completed_at: '2099-02-01T10:00:00.000Z',
        version: 5,
        task_type: 'human'
    };
    const pool = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ text, params });
            if (text.startsWith('SELECT * FROM tasks WHERE id = $1')) {
                return { rows: [task] };
            }
            if (text.startsWith('UPDATE tasks')) {
                throw new Error('generic reopen must not update archived or terminal tasks');
            }
            if (text.startsWith('INSERT INTO task_logs')) return { rowCount: 1, rows: [] };
            return { rows: [] };
        }
    };
    const { updateTaskStatus } = loadKleshnya(pool);

    await assert.rejects(
        () => updateTaskStatus(88, 'todo', 'route-smoke'),
        /explicit restore\/reopen flow/
    );
    assert.equal(queries.some(q => q.text.startsWith('UPDATE tasks')), false);
    assert.equal(queries.some(q => q.text.startsWith('INSERT INTO task_logs')), false);
});

test('updateTaskStatus allows explicit non-archived user reopen without clearing archive markers', async () => {
    const queries = [];
    let taskSelectCount = 0;
    const task = {
        id: 87,
        status: 'done',
        workflow_state: 'done',
        schedule_status: 'completed',
        scheduled_start_at: '2099-02-01T09:00:00.000Z',
        completed_at: '2099-02-01T10:00:00.000Z',
        version: 5,
        task_type: 'human',
        archived_at: null
    };
    const reopened = {
        ...task,
        status: 'todo',
        workflow_state: 'todo',
        schedule_status: 'scheduled',
        completed_at: null,
        version: 6
    };
    const pool = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ text, params });
            if (text.startsWith('SELECT * FROM tasks WHERE id = $1')) {
                taskSelectCount += 1;
                return { rows: [taskSelectCount === 1 ? task : reopened] };
            }
            if (text.startsWith('UPDATE tasks')) {
                assert.equal(params[0], 'todo');
                assert.equal(params[1], 87);
                assert.equal(params[2], 5);
                assert.equal(params[3], 'todo');
                assert.match(text, /archived_at IS NULL/);
                assert.doesNotMatch(text, /archive_reason\s*=\s*NULL/i);
                assert.doesNotMatch(text, /LOWER\(COALESCE\(status, 'todo'\)\) NOT IN/);
                return { rowCount: 1, rows: [] };
            }
            if (text.startsWith('INSERT INTO task_logs')) return { rowCount: 1, rows: [] };
            if (text.startsWith('INSERT INTO task_action_history')) return { rowCount: 1, rows: [{}] };
            return { rows: [] };
        }
    };
    const { updateTaskStatus } = loadKleshnya(pool);

    const result = await updateTaskStatus(87, 'todo', 'sergiy', {
        allowTerminalReopen: true,
        actorUserId: 7
    });

    assert.equal(result.status, 'todo');
    assert.equal(result.completed_at, null);
    assert.equal(result.workflow_state, 'todo');
    assert.equal(result.schedule_status, 'scheduled');
    assert.equal(queries.some(q => q.text.startsWith('INSERT INTO task_logs') && q.params[2] === 'done' && q.params[3] === 'todo'), true);
});

test('updateTaskStatus preserves archive markers on active-to-done updates', async () => {
    const queries = [];
    let taskSelectCount = 0;
    const task = {
        id: 89,
        status: 'todo',
        workflow_state: 'todo',
        schedule_status: 'scheduled',
        scheduled_start_at: '2099-02-01T09:00:00.000Z',
        version: 2,
        task_type: 'human',
        assigned_to: null,
        archived_at: null
    };
    const done = { ...task, status: 'done', workflow_state: 'done', schedule_status: 'completed', version: 3 };
    const pool = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ text, params });
            if (text.startsWith('SELECT * FROM tasks WHERE id = $1')) {
                taskSelectCount += 1;
                return { rows: [taskSelectCount === 1 ? task : done] };
            }
            if (text.startsWith('UPDATE tasks')) {
                assert.doesNotMatch(text, /archived_at\s*=\s*NULL/i);
                assert.doesNotMatch(text, /archive_reason\s*=\s*NULL/i);
                assert.match(text, /archived_at IS NULL/);
                assert.match(text, /LOWER\(COALESCE\(status, 'todo'\)\) NOT IN/);
                return { rowCount: 1, rows: [] };
            }
            if (text.startsWith('INSERT INTO task_logs')) return { rowCount: 1, rows: [] };
            return { rows: [] };
        }
    };
    const { updateTaskStatus } = loadKleshnya(pool);

    const result = await updateTaskStatus(89, 'done', 'route-smoke');

    assert.equal(result.status, 'done');
    assert.equal(queries.some(q => q.text.startsWith('INSERT INTO task_logs') && q.params[2] === 'todo' && q.params[3] === 'done'), true);
});

test('updateTaskStatus gates completion points through shared KPI policy after canonical history', async () => {
    const queries = [];
    let taskSelectCount = 0;
    const task = {
        id: 90,
        status: 'todo',
        workflow_state: 'todo',
        schedule_status: 'scheduled',
        version: 1,
        task_type: 'human',
        assigned_to: 'sergiy',
        owner: 'sergiy',
        archived_at: null
    };
    const done = { ...task, status: 'done', workflow_state: 'done', version: 2 };
    const pool = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ text, params });
            if (text.startsWith('SELECT * FROM tasks WHERE id = $1')) {
                taskSelectCount += 1;
                return { rows: [taskSelectCount === 1 ? task : done] };
            }
            if (text.startsWith('UPDATE tasks')) return { rowCount: 1, rows: [] };
            if (text.startsWith('INSERT INTO task_logs')) return { rowCount: 1, rows: [] };
            if (text.startsWith('INSERT INTO task_action_history')) return { rowCount: 1, rows: [{}] };
            if (text.includes('AS eligible') && text.includes('task_action_history')) return { rows: [{ eligible: false }] };
            if (text.startsWith('INSERT INTO user_points')) throw new Error('ineligible task must not receive completion points');
            return { rows: [], rowCount: 1 };
        }
    };
    const { updateTaskStatus } = loadKleshnya(pool);

    await updateTaskStatus(90, 'done', 'system');

    const canonicalIndex = queries.findIndex(q => q.text.startsWith('INSERT INTO task_action_history'));
    const eligibilityIndex = queries.findIndex(q => q.text.includes('AS eligible') && q.text.includes('task_action_history'));
    assert.ok(canonicalIndex >= 0);
    assert.ok(eligibilityIndex > canonicalIndex, 'eligibility must be checked after canonical owner-action history is written');
    assert.equal(queries.some(q => q.text.startsWith('INSERT INTO user_points')), false);
});

test('updateTaskStatus awards completion points only when shared KPI policy proves eligibility', async () => {
    const queries = [];
    let taskSelectCount = 0;
    const task = {
        id: 93,
        status: 'todo',
        workflow_state: 'todo',
        schedule_status: 'scheduled',
        version: 1,
        task_type: 'human',
        assigned_to: 'sergiy',
        owner: 'sergiy',
        archived_at: null
    };
    const done = { ...task, status: 'done', workflow_state: 'done', version: 2 };
    const pool = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ text, params });
            if (text.startsWith('SELECT * FROM tasks WHERE id = $1')) {
                taskSelectCount += 1;
                return { rows: [taskSelectCount === 1 ? task : done] };
            }
            if (text.startsWith('UPDATE tasks')) return { rowCount: 1, rows: [] };
            if (text.startsWith('INSERT INTO task_logs')) return { rowCount: 1, rows: [] };
            if (text.startsWith('INSERT INTO task_action_history')) return { rowCount: 1, rows: [{}] };
            if (text.includes('AS eligible') && text.includes('task_action_history')) return { rows: [{ eligible: true }] };
            return { rows: [], rowCount: 1 };
        }
    };
    const { updateTaskStatus } = loadKleshnya(pool);

    await updateTaskStatus(93, 'done', 'sergiy', { actorUserId: 7 });

    assert.equal(queries.some(q => q.text.startsWith('INSERT INTO user_points')), true);
});

test('sendReminder and escalateTask skip archived or terminal tasks without side effects', async () => {
    const queries = [];
    const terminalTask = {
        id: 91,
        title: 'Closed',
        status: 'archived',
        archived_at: '2026-08-11T10:00:00.000Z',
        escalation_level: 1,
        assigned_to: 'sergiy'
    };
    const pool = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ text, params });
            if (text.startsWith('SELECT * FROM tasks WHERE id = $1')) return { rows: [terminalTask] };
            if (text.startsWith('UPDATE tasks')) throw new Error('terminal task must not be updated');
            if (text.startsWith('INSERT INTO task_logs')) throw new Error('terminal task must not log reminder/escalation');
            return { rows: [] };
        }
    };
    const { sendReminder, escalateTask } = loadKleshnya(pool);

    assert.deepEqual(await sendReminder(91), { skipped: true, reason: 'terminal_or_archived' });
    assert.deepEqual(await escalateTask(91), { skipped: true, reason: 'terminal_or_archived' });
    assert.equal(queries.filter(q => q.text.startsWith('UPDATE tasks')).length, 0);
});

test('sendReminder and escalateTask repeat active predicate in UPDATE to avoid terminal races', async () => {
    const queries = [];
    const task = {
        id: 92,
        title: 'Active',
        status: 'todo',
        archived_at: null,
        escalation_level: 0,
        assigned_to: null
    };
    const pool = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ text, params });
            if (text.startsWith('SELECT * FROM tasks WHERE id = $1')) return { rows: [task] };
            if (text.startsWith('UPDATE tasks')) {
                assert.match(text, /archived_at IS NULL/);
                assert.match(text, /LOWER\(COALESCE\(status, 'todo'\)\) NOT IN/);
                return { rowCount: 0, rows: [] };
            }
            if (text.startsWith('INSERT INTO task_logs')) throw new Error('race-skipped task must not log reminder/escalation');
            return { rows: [] };
        }
    };
    const { sendReminder, escalateTask } = loadKleshnya(pool);

    assert.deepEqual(await sendReminder(92), { skipped: true, reason: 'terminal_or_archived_race' });
    assert.deepEqual(await escalateTask(92), { skipped: true, reason: 'terminal_or_archived_race' });
});

test('escalateTask does not apply overdue points penalty to KPI-ineligible tasks', async () => {
    const queries = [];
    const task = {
        id: 94,
        title: 'System task',
        status: 'todo',
        archived_at: null,
        escalation_level: 1,
        assigned_to: 'sergiy'
    };
    const pool = {
        async query(sql, params) {
            const text = String(sql);
            queries.push({ text, params });
            if (text.startsWith('SELECT * FROM tasks WHERE id = $1')) return { rows: [task] };
            if (text.startsWith('UPDATE tasks')) return { rowCount: 1, rows: [] };
            if (text.startsWith('INSERT INTO task_logs')) return { rowCount: 1, rows: [] };
            if (text.includes('AS eligible') && text.includes('task_action_history')) return { rows: [{ eligible: false }] };
            if (text.startsWith('INSERT INTO user_points')) throw new Error('ineligible task must not receive escalation penalty');
            return { rows: [], rowCount: 1 };
        }
    };
    const { escalateTask } = loadKleshnya(pool);

    await escalateTask(94);

    assert.equal(queries.some(q => q.text.startsWith('INSERT INTO user_points')), false);
});

test('buildOwnerTaskDigestText groups tasks into one Telegram-safe message', () => {
    const { buildOwnerTaskDigestText } = loadKleshnya();
    const text = buildOwnerTaskDigestText([
        { id: 1, title: 'Перевірити парк', status: 'todo', priority: 'high', deadline: '2099-01-01T09:00:00.000Z' },
        { id: 2, title: 'Закрити звіт', status: 'in_progress', priority: 'normal' }
    ], { title: 'Мій день', ownerLabel: 'Сергій' });

    assert.match(text, /Мій день/);
    assert.match(text, /Сергій/);
    assert.match(text, /#1/);
    assert.match(text, /#2/);
    assert.equal(text.includes('Перевірити парк') && text.includes('Закрити звіт'), true);
});

async function withTelegramRouteApp(state, run) {
    clearModules();
    const express = require('express');
    const http = require('node:http');

    const pool = {
        async query(sql, params) {
            const text = String(sql);
            state.queries.push({ text, params });
            if (text.includes('INSERT INTO telegram_known_chats')) return { rows: [], rowCount: 1 };
            if (text.includes('SELECT id, status, owner_user_id, assigned_to, owner FROM tasks')) return { rows: [state.task] };
            if (text.includes('SELECT id, username, name, role, extra_roles, telegram_chat_id')) return { rows: state.actorUser ? [state.actorUser] : [] };
            return { rows: [] };
        }
    };

    installMock('../db', { pool });
    installMock('../services/telegram', {
        TELEGRAM_BOT_TOKEN: 'unit-token',
        WEBHOOK_SECRET: 'unit-secret',
        telegramRequest: async (method, body) => {
            state.telegramCalls.push({ method, body });
            return { ok: true, result: true };
        },
        sendTelegramMessage: async () => ({ ok: true }),
        getConfiguredChatId: async () => 'group-chat',
        getConfiguredThreadId: async () => null,
        getTelegramChatId: async () => [],
        ensureWebhook: async () => ({ ok: true })
    });
    installMock('../services/booking', { ensureDefaultLines: async () => {}, validateDate: () => true });
    installMock('../services/scheduler', { buildAndSendDigest: async () => ({}), sendTomorrowReminder: async () => ({}) });
    installMock('../services/bot', {
        handleBotCommand: async () => null,
        handleCertUse: async () => {},
        resolveActorName: async () => state.actorUser?.username || 'telegram'
    });
    installMock('../services/bookingAutomation', { handleContractorCallback: async () => {} });
    installMock('../utils/logger', {
        createLogger: () => ({ info: () => {}, warn: (...args) => state.logs.push(['warn', ...args]), error: (...args) => state.logs.push(['error', ...args]) })
    });
    installMock('../services/leadNotifier', { notifyNewLead: async () => {} });
    installMock('../middleware/auth', { authenticateToken: (_req, _res, next) => next() });
    installMock('../services/warehousePhotoIntake', {
        buildTelegramSummary: () => '',
        createTelegramPhotoIntake: async () => ({ ok: false }),
        confirmIntake: async () => ({ success: false }),
        cancelIntake: async () => ({ success: false })
    });
    installMock('../services/timelineBusinessScope', {
        DEFAULT_TIMELINE_CONTEXT: 'event_genix',
        pushDefaultTimelineBusinessContext: () => 'TRUE'
    });
    installMock('../services/businessContext', { DEFAULT_BUSINESS_CONTEXT: 'event_genix' });
    installMock('../services/kleshnya', {
        updateTaskStatus: async (taskId, status, actor) => {
            state.statusUpdates.push({ taskId, status, actor });
            return { ...state.task, status };
        },
        acknowledgeTask: async (taskId, actor, actorUserId) => {
            state.acks.push({ taskId, actor, actorUserId });
            return state.task;
        },
        isTelegramTaskActorAllowed: (task, actorUser) => Number(task.owner_user_id) === Number(actorUser.id)
    });

    delete require.cache[require.resolve('../routes/telegram')];
    const app = express();
    app.use(express.json());
    app.use('/api/telegram', require('../routes/telegram'));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
        await run(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearModules();
        delete require.cache[require.resolve('../routes/telegram')];
    }
}

function callbackPayload(data, from = { id: 9, username: 'other', first_name: 'Other' }) {
    return {
        update_id: 1,
        callback_query: {
            id: 'cb-1',
            data,
            from,
            message: { message_id: 55, chat: { id: 674972415, type: 'private', first_name: 'Сергій' }, text: 'Task message' }
        }
    };
}

test('telegram task_done callback is blocked when Telegram actor is not the CRM task owner', async () => {
    const state = {
        task: { id: 77, status: 'todo', owner_user_id: 4, assigned_to: 'sergiy', owner: 'sergiy' },
        actorUser: { id: 9, username: 'other', telegram_chat_id: '9' },
        telegramCalls: [],
        statusUpdates: [],
        acks: [],
        queries: [],
        logs: []
    };

    await withTelegramRouteApp(state, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'unit-secret' },
            body: JSON.stringify(callbackPayload('task_done:77:todo'))
        });
        assert.equal(res.status, 200);
    });

    assert.equal(state.statusUpdates.length, 0);
    assert.ok(state.telegramCalls.some(call => call.method === 'answerCallbackQuery' && /іншого виконавця/.test(call.body.text)));
});

test('telegram task_ack callback records acknowledgement for the matching CRM owner only', async () => {
    const state = {
        task: { id: 77, status: 'todo', owner_user_id: 4, assigned_to: 'sergiy', owner: 'sergiy' },
        actorUser: { id: 4, username: 'sergiy', telegram_chat_id: '674972415' },
        telegramCalls: [],
        statusUpdates: [],
        acks: [],
        queries: [],
        logs: []
    };

    await withTelegramRouteApp(state, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'unit-secret' },
            body: JSON.stringify(callbackPayload('task_ack:77:todo', { id: 674972415, username: 'sergiy', first_name: 'Сергій' }))
        });
        assert.equal(res.status, 200);
    });

    assert.deepEqual(state.statusUpdates, []);
    assert.deepEqual(state.acks, [{ taskId: 77, actor: 'sergiy', actorUserId: 4 }]);
    assert.ok(state.telegramCalls.some(call => call.method === 'answerCallbackQuery' && /Бачив/.test(call.body.text)));
});
