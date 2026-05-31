const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

let state;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/chatService',
        '../services/chatUploadStorage'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function normalizeSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function createFakePool() {
    async function handleQuery(sql, params = []) {
        const text = normalizeSql(sql);
        state.queries.push({ text, params });

        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
            state.tx.push(text);
            return { rows: [], rowCount: 0 };
        }

        if (/pg_advisory_xact_lock/i.test(text)) {
            state.locks.push(params);
            return { rows: [{ pg_advisory_xact_lock: true }], rowCount: 1 };
        }

        if (/SELECT \* FROM chat_tasks WHERE message_id = \$1/i.test(text)) {
            const [messageId, assignedBy, assignedTo, title] = params;
            const normalizedTitle = String(title).trim().toLowerCase();
            const match = [...state.tasks]
                .reverse()
                .find(task =>
                    task.message_id === messageId &&
                    task.assigned_by === assignedBy &&
                    task.assigned_to === assignedTo &&
                    String(task.title).trim().toLowerCase() === normalizedTitle &&
                    ['open', 'in_progress'].includes(task.status)
                );
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
        }

        if (/INSERT INTO chat_tasks \(channel_id, message_id, assigned_to, assigned_by, title, deadline\)/i.test(text)) {
            const [channelId, messageId, assignedTo, assignedBy, title, deadline] = params;
            const row = {
                id: state.nextTaskId++,
                channel_id: channelId,
                message_id: messageId,
                assigned_to: assignedTo,
                assigned_by: assignedBy,
                title,
                deadline,
                status: 'open',
                created_at: new Date('2026-05-11T12:00:00Z').toISOString()
            };
            state.tasks.push(row);
            state.inserts.push(row);
            return { rows: [row], rowCount: 1 };
        }

        if (/UPDATE chat_tasks SET/i.test(text)) {
            const [taskId, status, userId] = params;
            const task = state.tasks.find(row => row.id === taskId);
            const restricted = /\(assigned_to = \$3 OR assigned_by = \$3\)/i.test(text);
            state.updates.push({ text, params, restricted });
            if (!task) return { rows: [], rowCount: 0 };
            if (restricted && task.assigned_to !== userId && task.assigned_by !== userId) {
                return { rows: [], rowCount: 0 };
            }
            task.status = status;
            if (status === 'done') task.completed_at = new Date('2026-05-11T12:05:00Z').toISOString();
            return { rows: [task], rowCount: 1 };
        }

        throw new Error(`Unexpected query: ${text}`);
    }

    return {
        query: handleQuery,
        connect: async () => ({
            query: handleQuery,
            release: () => {
                state.released += 1;
            }
        })
    };
}

function loadChatService() {
    clearModules();
    installMock('../db', { pool: createFakePool() });
    installMock('../services/chatUploadStorage', {
        removeChatUploadObject: async () => false,
        removeLegacyLocalChatFile: async () => false
    });
    return require('../services/chatService');
}

describe('chat task authorization and duplicate-safe creation', () => {
    beforeEach(() => {
        state = {
            nextTaskId: 100,
            tasks: [
                { id: 1, channel_id: 10, message_id: 500, assigned_to: 2, assigned_by: 1, title: 'Existing task', status: 'open' },
                { id: 2, channel_id: 10, message_id: 501, assigned_to: 3, assigned_by: 2, title: 'Manager task', status: 'open' }
            ],
            queries: [],
            tx: [],
            locks: [],
            inserts: [],
            updates: [],
            released: 0
        };
    });

    afterEach(() => {
        clearModules();
    });

    it('allows assigned or creating users to update chat tasks and denies unrelated users', async () => {
        const chat = loadChatService();

        const byCreator = await chat.updateTask(1, 1, { status: 'in_progress', role: 'animator' });
        assert.equal(byCreator.id, 1);
        assert.equal(byCreator.status, 'in_progress');
        assert.equal(state.updates.at(-1).restricted, true);

        const byAssignee = await chat.updateTask(1, 2, { status: 'done', role: 'animator' });
        assert.equal(byAssignee.id, 1);
        assert.equal(byAssignee.status, 'done');

        const unrelated = await chat.updateTask(2, 99, { status: 'done', role: 'animator' });
        assert.equal(unrelated, null);
        assert.equal(state.tasks.find(task => task.id === 2).status, 'open');
    });

    it('allows elevated chat-task managers to update without ownership', async () => {
        const chat = loadChatService();

        const task = await chat.updateTask(2, 99, { status: 'in_progress', role: 'director' });

        assert.equal(task.id, 2);
        assert.equal(task.status, 'in_progress');
        assert.equal(state.updates.at(-1).restricted, false);
        assert.equal(state.updates.at(-1).params.length, 2);
    });

    it('deduplicates active message-scoped chat task creation inside a transaction', async () => {
        const chat = loadChatService();

        const first = await chat.createTask({
            channelId: 10,
            messageId: 700,
            assignedTo: 2,
            assignedBy: 1,
            title: '  Follow up with client  ',
            deadline: null
        });
        const second = await chat.createTask({
            channelId: 10,
            messageId: 700,
            assignedTo: 2,
            assignedBy: 1,
            title: 'follow up with CLIENT',
            deadline: null
        });

        assert.equal(first.created, true);
        assert.equal(second.created, false);
        assert.equal(second.task.id, first.task.id);
        assert.equal(state.inserts.length, 1);
        assert.deepEqual(state.tx, ['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
        assert.equal(state.locks.length, 2);
        assert.equal(state.released, 2);
    });

    it('keeps channel-only chat tasks repeatable', async () => {
        const chat = loadChatService();

        const first = await chat.createTask({
            channelId: 10,
            messageId: null,
            assignedTo: 2,
            assignedBy: 1,
            title: 'Repeatable ops task',
            deadline: null
        });
        const second = await chat.createTask({
            channelId: 10,
            messageId: null,
            assignedTo: 2,
            assignedBy: 1,
            title: 'Repeatable ops task',
            deadline: null
        });

        assert.equal(first.created, true);
        assert.equal(second.created, true);
        assert.notEqual(second.task.id, first.task.id);
        assert.equal(state.inserts.length, 2);
        assert.equal(state.tx.length, 0);
    });
});

describe('operations flow static contracts', () => {
    it('wires chat-created operational tasks through canonical tasks with explicit owner selection', () => {
        const chatPage = fs.readFileSync(path.join(repoRoot, 'js/chat-page.js'), 'utf8');

        assert.match(chatPage, /\/api\/tasks\/owners/);
        assert.match(chatPage, /ownerUserId: payload\.ownerUserId/);
        assert.match(chatPage, /function _findTaskOwnerForMessageAuthor/);
        assert.match(chatPage, /var authorOwner = _findTaskOwnerForMessageAuthor\(owners, msg, author\)/);
        assert.match(chatPage, /var defaultOwner = authorOwner \|\| currentOwner/);
        assert.match(chatPage, /sourceType: msg && msg\.id \? 'chat_message' : 'chat_channel'/);
        assert.match(chatPage, /Для \/task вкажіть виконавця/);
        assert.doesNotMatch(chatPage, /_api\('POST', '\/tasks'/);
    });

    it('keeps task assignment notifications change-aware and typed-owner aware', () => {
        const tasksRoute = fs.readFileSync(path.join(repoRoot, 'routes/tasks.js'), 'utf8');
        const kleshnya = fs.readFileSync(path.join(repoRoot, 'services/kleshnya.js'), 'utf8');
        const taskNotifications = fs.readFileSync(path.join(repoRoot, 'services/taskNotifications.js'), 'utf8');
        const workQueueRoute = fs.readFileSync(path.join(repoRoot, 'routes/work-queue.js'), 'utf8');
        const wsClient = fs.readFileSync(path.join(repoRoot, 'js/ws.js'), 'utf8');

        assert.match(tasksRoute, /function taskAssigneeChanged/);
        assert.match(tasksRoute, /function emitTaskAssignedToOwner/);
        assert.match(taskNotifications, /sendToUser\(String\(ownerUserId\), 'task:assigned'/);
        assert.match(taskNotifications, /canonicalField: 'tasks\.owner_user_id'/);
        assert.match(kleshnya, /emitTaskAssignedToOwner\(task/);
        assert.match(workQueueRoute, /emitTaskAssignedToOwner\(result\.task/);
        assert.match(tasksRoute, /router\.post\('\/:id\/reassign'[\s\S]*notifyTaskAssignment\(result\.task/);
        assert.match(tasksRoute, /router\.post\('\/:id\/reassign'[\s\S]*emitTaskAssignedToOwner\(result\.task/);
        assert.match(tasksRoute, /taskAssigneeChanged\(old, updatedTask\)/);
        assert.match(wsClient, /case 'task:assigned'/);
        assert.match(wsClient, /SoundEngine\.play\('task-new'\)/);
        assert.match(wsClient, /function _shouldSignalTaskArrival/);
        assert.match(wsClient, /crm:tasks-updated/);
        assert.match(kleshnya, /WHERE id = \$1 AND telegram_chat_id IS NOT NULL/);
    });

    it('keeps lead/customer linking explicit and duplicate handling suggest-only', () => {
        const leadsRoute = fs.readFileSync(path.join(repoRoot, 'routes/leads.js'), 'utf8');
        const leadsPage = fs.readFileSync(path.join(repoRoot, 'js/leads-page.js'), 'utf8');
        const customersPage = fs.readFileSync(path.join(repoRoot, 'js/customers-page.js'), 'utf8');
        const customersRoute = fs.readFileSync(path.join(repoRoot, 'routes/customers.js'), 'utf8');

        assert.match(leadsRoute, /\/:id\/link-customer/);
        assert.match(leadsRoute, /mergePolicy: 'suggest_only'/);
        assert.match(customersRoute, /function normalizeCustomerPayload/);
        assert.match(customersRoute, /Дата народження має бути у форматі YYYY-MM-DD/);
        assert.match(leadsPage, /linkWorkspaceLeadCustomer/);
        assert.match(leadsPage, /Telegram у CRM/);
        assert.match(customersPage, /function customerHubDialogTarget/);
        assert.match(customersPage, /customerHubDialogIcon\(dialogTarget\)/);
        assert.match(customersPage, /links\.omniExact/);
        assert.doesNotMatch(customersPage, /Telegram зовнішньо/);
    });

    it('adds accepted-vs-closed analytics with explicit missing stage timestamp truth', () => {
        const analyticsRoute = fs.readFileSync(path.join(repoRoot, 'routes/analytics.js'), 'utf8');
        const analyticsPage = fs.readFileSync(path.join(repoRoot, 'js/analytics-page.js'), 'utf8');
        const analyticsHtml = fs.readFileSync(path.join(repoRoot, 'analytics.html'), 'utf8');
        const financeHtml = fs.readFileSync(path.join(repoRoot, 'finance.html'), 'utf8');

        assert.match(analyticsRoute, /\/deals-lifecycle/);
        assert.match(analyticsRoute, /stageTimestampTruth: 'missing'/);
        assert.match(analyticsPage, /fetchDealsLifecycle/);
        assert.match(analyticsPage, /Прийняті vs закриті угоди/);
        assert.match(analyticsHtml, /\/finance\?mode=insights/);
        assert.match(financeHtml, /faWorkspace/);
    });
});
