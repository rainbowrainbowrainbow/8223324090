const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHermesRouter } = require('../routes/hermes');
const { createHermesAuthMiddleware } = require('../middleware/hermesAuth');

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

async function request(baseUrl, method, path, body, headers = {}) {
    const reqHeaders = { ...headers };
    if (body !== undefined && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, text, headers: res.headers };
}

function hermesTestAuth(req, res, next) {
    req.user = {
        id: 7,
        username: 'hermes.actor',
        name: 'Hermes Actor',
        role: 'creator',
        business_contexts: ['event_genix', 'dar'],
        defaultBusinessContext: 'event_genix'
    };
    req.integration = {
        id: 'hermes-event-genix-crm',
        source: 'hermes'
    };
    return next();
}

function createHermesActorPool(row = {}) {
    const calls = [];
    const actor = {
        id: 7,
        username: 'hermes.actor',
        role: 'creator',
        extra_roles: [],
        page_allowlist: [],
        action_allowlist: [],
        action_denylist: [],
        business_contexts: ['event_genix', 'dar'],
        default_business_context: 'dar',
        name: 'Hermes Actor',
        telegram_chat_id: null,
        is_active: true,
        ...row
    };

    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            assert.match(sql, /FROM users/i);
            assert.deepEqual(params, [7]);
            return { rows: [actor], rowCount: 1 };
        }
    };
}

function isoMinute(index) {
    return `2026-06-27T07:${String(index).padStart(2, '0')}:00.000Z`;
}

function taskRow(id, overrides = {}) {
    return {
        id,
        title: `Task ${id}`,
        description: `Task ${id} description`,
        status: 'todo',
        priority: 'normal',
        date: '2026-06-27',
        deadline: `2026-06-27T12:00:00.000Z`,
        scheduled_start_at: null,
        scheduled_end_at: null,
        schedule_slot: null,
        schedule_mode: null,
        schedule_status: 'unscheduled',
        created_at: '2026-06-27T07:00:00.000Z',
        updated_at: isoMinute(id % 60),
        completed_at: null,
        business_context: 'event_genix',
        version: 1,
        category: 'admin',
        subcategory: null,
        task_type: 'human',
        task_mode: 'work',
        task_kind: 'action',
        visibility: 'team',
        workflow_state: 'todo',
        owner_user_id: 7,
        assigned_to: 'Hermes Actor',
        owner: 'Hermes Actor',
        created_by_user_id: 2,
        owner_name: 'Hermes Actor',
        owner_username: 'hermes.actor',
        creator_name: 'Creator Name',
        created_by_username: 'creator',
        ...overrides
    };
}

function productRow(id, overrides = {}) {
    return {
        id: String(id),
        code: `menu-${id}`,
        name: `Menu item ${id}`,
        label: `Menu item ${id}`,
        business_context: 'event_genix',
        icon_url: '/uploads/catalog-images/items/current.png',
        ai_card_draft: {},
        domain: 'kitchen',
        kitchen_type: 'menu',
        menu_section: 'cold-snacks',
        serving_unit: 'portion',
        weight_value: '250 g',
        ingredients: 'Cheese, greens',
        short_description: 'Internal product description',
        description: 'Detailed internal product description',
        allergens: ['milk'],
        tech_card: 'Internal kitchen notes',
        price: 650,
        legacy_price: null,
        availability_status: 'active',
        is_active: true,
        created_at: '2026-06-27T07:00:00.000Z',
        updated_at: '2026-06-27T07:00:00.000Z',
        ...overrides
    };
}

function createFakePool(options = {}) {
    const calls = [];
    const hiddenIds = new Set(options.hiddenIds || []);
    const listRows = options.listRows || Array.from({ length: 51 }, (_, index) => taskRow(1000 + index, {
        title: `Visible task ${index + 1}`,
        updated_at: isoMinute(59 - (index % 60))
    }));
    const detailRows = new Map([
        [123, taskRow(123, {
            title: 'Detail task',
            status: 'in_progress',
            subtasks: [
                { id: 1, title: 'Done part', is_done: true, completed_at: '2026-06-27T08:00:00.000Z' },
                { id: 2, title: 'Open part', is_done: false }
            ],
            customer_phone: '+380000000000',
            customer_email: 'hidden@example.com'
        })]
    ]);
    const historyRows = [
        {
            id: 500,
            task_id: 123,
            action_type: 'task_completed',
            actor_user_id: 7,
            actor_name_snapshot: 'Hermes Actor',
            source_surface: 'task_detail',
            old_value_json: { status: 'in_progress', phone: '+380111111111' },
            new_value_json: { status: 'done', control_meta: { secret: 'no' } },
            summary: 'Task completed',
            created_at: '2026-06-27T09:00:00.000Z'
        }
    ];

    return {
        calls,
        async query(text, params = []) {
            calls.push({ text, params });
            if (/FROM task_action_history/i.test(text)) {
                return { rows: historyRows };
            }
            if (/SELECT t\.id\s+FROM tasks t/i.test(text)) {
                const id = Number(params[0]);
                return { rows: hiddenIds.has(id) ? [] : [{ id }] };
            }
            if (/WHERE t\.id = \$1/i.test(text)) {
                const id = Number(params[0]);
                if (hiddenIds.has(id)) return { rows: [] };
                return { rows: detailRows.has(id) ? [detailRows.get(id)] : [] };
            }
            if (/FROM tasks t/i.test(text)) {
                return { rows: listRows };
            }
            throw new Error(`Unexpected query: ${text}`);
        }
    };
}

function mutationHeaders(idempotencyKey, extra = {}) {
    return {
        'Idempotency-Key': idempotencyKey,
        'X-Hermes-User-Confirmed': 'true',
        'X-Integration-Id': 'hermes-event-genix-crm',
        ...extra
    };
}

function createHermesCreateFakePool(options = {}) {
    const calls = [];
    const records = new Map();
    const createdTasks = [];
    const historyEvents = [];
    const users = new Map([
        [7, { id: 7, username: 'hermes.actor', name: 'Hermes Actor', role: 'creator' }],
        [8, { id: 8, username: 'ops.user', name: 'Ops User', role: 'manager' }],
        ...(options.users || [])
    ]);
    const tasks = new Map(
        (options.tasks || []).map(([id, task]) => [Number(id), { ...task }])
    );
    const products = new Map(
        (options.products || []).map(([id, product]) => [String(id), { ...product }])
    );
    const hiddenIds = new Set(options.hiddenIds || []);
    const hiddenProductIds = new Set((options.hiddenProductIds || []).map(String));
    const subtaskStates = new Map(
        Object.entries(options.subtaskStates || {}).map(([id, state]) => [Number(id), state])
    );
    const reportIds = new Set(options.reportIds || [321]);
    let nextId = 2000;
    let nextSubtaskId = 9000;
    let nextHistoryId = 12000;

    function key(integrationId, idempotencyKey) {
        return `${integrationId}:${idempotencyKey}`;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    async function query(text, params = []) {
        const compact = text.replace(/\s+/g, ' ').trim();
        calls.push({ text, params, compact });

        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact)) {
            return { rows: [], rowCount: 0 };
        }

        if (compact.startsWith('DELETE FROM integration_idempotency_keys')) {
            return { rows: [], rowCount: 0 };
        }

        if (compact.startsWith('INSERT INTO integration_idempotency_keys')) {
            const recordKey = key(params[0], params[1]);
            if (records.has(recordKey)) return { rows: [], rowCount: 0 };
            const record = {
                id: records.size + 1,
                integration_id: params[0],
                idempotency_key: params[1],
                request_hash: params[2],
                response_status: null,
                response_body: null,
                created_at: '2026-06-27T07:00:00.000Z',
                expires_at: '2026-06-29T07:00:00.000Z'
            };
            records.set(recordKey, record);
            return { rows: [clone(record)], rowCount: 1 };
        }

        if (compact.startsWith('SELECT id, integration_id, idempotency_key')) {
            const record = records.get(key(params[0], params[1]));
            return { rows: record ? [clone(record)] : [], rowCount: record ? 1 : 0 };
        }

        if (compact.startsWith('UPDATE integration_idempotency_keys')) {
            const record = records.get(key(params[0], params[1]));
            if (!record || record.request_hash !== params[2] || record.response_status !== null) {
                return { rows: [], rowCount: 0 };
            }
            record.response_status = params[3];
            record.response_body = JSON.parse(params[4]);
            return { rows: [clone(record)], rowCount: 1 };
        }

        if (/FROM users WHERE users\.id = \$1/i.test(compact)) {
            const user = users.get(Number(params[0]));
            return { rows: user ? [clone(user)] : [], rowCount: user ? 1 : 0 };
        }

        if (/FROM users WHERE id = \$1 AND COALESCE\(is_active, true\) = true/i.test(compact)) {
            const user = users.get(Number(params[0]));
            return {
                rows: user ? [{ id: user.id, username: user.username, name: user.name }] : [],
                rowCount: user ? 1 : 0
            };
        }

        if (/FROM users WHERE COALESCE\(is_active, true\) = true AND \(LOWER\(username\) = LOWER\(\$1\)/i.test(compact)) {
            const lookup = String(params[0] || '').toLowerCase();
            const user = Array.from(users.values()).find(item =>
                String(item.username || '').toLowerCase() === lookup
                || String(item.name || '').toLowerCase() === lookup
            );
            return {
                rows: user ? [{ id: user.id, username: user.username, name: user.name }] : [],
                rowCount: user ? 1 : 0
            };
        }

        if (/SELECT t\.\*, u\.name AS owner_name, u\.username AS owner_username, u\.role AS owner_role FROM tasks t LEFT JOIN users u ON u\.id = t\.owner_user_id WHERE t\.id = \$1/i.test(compact)) {
            const id = Number(params[0]);
            if (hiddenIds.has(id)) return { rows: [], rowCount: 0 };
            const task = tasks.get(id);
            if (!task) return { rows: [], rowCount: 0 };
            const owner = users.get(Number(task.owner_user_id || 0));
            return {
                rows: [{
                    ...clone(task),
                    owner_name: owner?.name || task.owner_name || null,
                    owner_username: owner?.username || task.owner_username || null,
                    owner_role: owner?.role || task.owner_role || null
                }],
                rowCount: 1
            };
        }

        if (/SELECT COUNT\(\*\)::int AS total, COUNT\(\*\) FILTER \(WHERE is_done = true\)::int AS done FROM task_subtasks WHERE task_id = \$1/i.test(compact)) {
            const state = subtaskStates.get(Number(params[0])) || { total: 0, done: 0 };
            return { rows: [{ total: state.total || 0, done: state.done || 0 }], rowCount: 1 };
        }

        if (/SELECT id FROM reports WHERE id = \$1/i.test(compact)) {
            const id = Number(params[0]);
            return { rows: reportIds.has(id) ? [{ id }] : [], rowCount: reportIds.has(id) ? 1 : 0 };
        }

        if (/FROM tasks t WHERE COALESCE\(t\.status, 'todo'\) NOT IN/i.test(compact)) {
            if (options.duplicate) return { rows: [taskRow(501, options.duplicate)], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        }

        if (/FROM products p/i.test(compact) && /WHERE p\.id = \$1/i.test(compact)) {
            const id = String(params[0]);
            const context = String(params[1] || 'event_genix');
            const product = products.get(id);
            if (
                hiddenProductIds.has(id)
                || !product
                || String(product.business_context || 'event_genix') !== context
                || product.domain !== 'kitchen'
                || product.kitchen_type !== 'menu'
                || product.is_active === false
                || product.availability_status === 'hidden'
            ) {
                return { rows: [], rowCount: 0 };
            }
            return { rows: [clone(product)], rowCount: 1 };
        }

        if (/FROM products p/i.test(compact)) {
            const requested = Array.isArray(params[0]) ? params[0].map(String) : [String(params[0] || 'event_genix')];
            const limit = Number(params.at(-1) || 50);
            const rows = Array.from(products.values())
                .filter(product => requested.includes(String(product.business_context || 'event_genix')))
                .filter(product => product.domain === 'kitchen' && product.kitchen_type === 'menu')
                .filter(product => product.is_active !== false && product.availability_status !== 'hidden')
                .filter(product => !hiddenProductIds.has(String(product.id)))
                .slice(0, limit)
                .map(clone);
            return { rows, rowCount: rows.length };
        }

        if (compact.startsWith('UPDATE products SET ai_card_draft =')) {
            const id = String(params[2]);
            const context = String(params[3] || 'event_genix');
            const product = products.get(id);
            if (!product || String(product.business_context || 'event_genix') !== context) {
                return { rows: [], rowCount: 0 };
            }
            product.ai_card_draft = JSON.parse(params[0]);
            product.updated_by = params[1];
            product.updated_at = '2026-06-27T08:40:00.000Z';
            return { rows: [], rowCount: 1 };
        }

        if (compact.startsWith('UPDATE products SET icon_url =')) {
            const id = String(params[3]);
            const context = String(params[4] || 'event_genix');
            const product = products.get(id);
            if (!product || String(product.business_context || 'event_genix') !== context) {
                return { rows: [], rowCount: 0 };
            }
            product.icon_url = params[0];
            product.ai_card_draft = JSON.parse(params[1]);
            product.updated_by = params[2];
            product.updated_at = '2026-06-27T08:45:00.000Z';
            return { rows: [], rowCount: 1 };
        }

        if (compact.startsWith('INSERT INTO tasks')) {
            const task = {
                id: nextId++,
                business_context: params[0],
                title: params[1],
                description: params[2],
                date: params[3],
                priority: params[4],
                assigned_to: params[5],
                owner: params[6],
                owner_user_id: params[7],
                created_by: params[8],
                task_type: params[9],
                deadline: params[10],
                status: 'todo',
                created_at: '2026-06-27T07:10:00.000Z',
                updated_at: '2026-06-27T07:10:00.000Z',
                completed_at: null,
                source_type: params[15],
                source_id: params[16],
                category: params[17],
                subcategory: params[18],
                task_mode: params[30],
                task_kind: params[31],
                visibility: params[32],
                workflow_state: params[33],
                source_module: params[42],
                control_meta: params[44],
                created_by_user_id: params[45],
                schedule_status: 'unscheduled',
                version: 1
            };
            createdTasks.push(task);
            tasks.set(task.id, task);
            return { rows: [clone(task)], rowCount: 1 };
        }

        if (compact.startsWith('INSERT INTO task_logs')) {
            return { rows: [], rowCount: 1 };
        }

        if (compact.startsWith('UPDATE tasks SET status =')) {
            const task = tasks.get(Number(params[0]));
            if (!task || ['done', 'cancelled', 'archived'].includes(String(task.status || 'todo'))) {
                return { rows: [], rowCount: 0 };
            }
            Object.assign(task, {
                status: 'done',
                workflow_state: 'done',
                completed_at: '2026-06-27T08:00:00.000Z',
                updated_at: '2026-06-27T08:00:00.000Z',
                version: Number(task.version || 1) + 1
            });
            return { rows: [clone(task)], rowCount: 1 };
        }

        if (compact.startsWith('UPDATE tasks SET owner_user_id =')) {
            const task = tasks.get(Number(params[0]));
            if (!task) return { rows: [], rowCount: 0 };
            const owner = users.get(Number(params[1]));
            Object.assign(task, {
                owner_user_id: Number(params[1]),
                assigned_to: params[2],
                owner: task.owner || params[2],
                owner_name: owner?.name || null,
                owner_username: owner?.username || null,
                updated_at: '2026-06-27T08:10:00.000Z',
                version: Number(task.version || 1) + 1
            });
            return { rows: [clone(task)], rowCount: 1 };
        }

        if (compact.startsWith('UPDATE tasks SET deadline =')) {
            const task = tasks.get(Number(params[0]));
            if (!task || ['done', 'cancelled', 'archived'].includes(String(task.status || 'todo'))) {
                return { rows: [], rowCount: 0 };
            }
            Object.assign(task, {
                deadline: params[1],
                date: String(params[1] || '').slice(0, 10) || task.date,
                status: task.status === 'overdue' ? 'todo' : task.status,
                workflow_state: task.workflow_state === 'overdue' ? 'todo' : task.workflow_state,
                snoozed_until: null,
                remind_at: null,
                updated_at: '2026-06-27T08:20:00.000Z',
                version: Number(task.version || 1) + 1
            });
            return { rows: [clone(task)], rowCount: 1 };
        }

        if (compact.startsWith('INSERT INTO task_action_history')) {
            const event = {
                id: nextHistoryId++,
                task_id: params[0],
                action_type: params[1],
                actor_user_id: params[2],
                actor_name_snapshot: params[3],
                source_surface: params[4],
                old_value_json: params[5] ? JSON.parse(params[5]) : null,
                new_value_json: params[6] ? JSON.parse(params[6]) : null,
                meta_json: params[7] ? JSON.parse(params[7]) : null,
                summary: params[8],
                created_at: '2026-06-27T08:30:00.000Z'
            };
            historyEvents.push(event);
            return { rows: [event], rowCount: 1 };
        }

        if (compact.startsWith('SELECT id FROM task_subtasks WHERE task_id = $1')) {
            return { rows: [], rowCount: 0 };
        }

        if (compact.startsWith('DELETE FROM task_subtasks WHERE task_id = $1')) {
            return { rows: [], rowCount: 0 };
        }

        if (compact.startsWith('INSERT INTO task_subtasks')) {
            const subtask = {
                id: nextSubtaskId++,
                task_id: params[0],
                title: params[1],
                is_done: params[2] === true,
                sort_order: params[3],
                source_type: params[4],
                created_at: '2026-06-27T07:11:00.000Z',
                updated_at: '2026-06-27T07:11:00.000Z',
                completed_at: params[2] === true ? '2026-06-27T07:11:00.000Z' : null
            };
            return { rows: [subtask], rowCount: 1 };
        }

        if (compact.startsWith('UPDATE tasks SET task_kind')) {
            return { rows: [], rowCount: 1 };
        }

        throw new Error(`Unexpected create fake query: ${compact}`);
    }

    return {
        calls,
        records,
        createdTasks,
        historyEvents,
        tasks,
        products,
        async query(text, params = []) {
            return query(text, params);
        },
        async connect() {
            return {
                query,
                release() {}
            };
        }
    };
}

async function withHermesCreateServer(fakePool, testFn, options = {}) {
    const app = express();
    app.use(express.json());
    app.use('/api/hermes', createHermesRouter({
        authMiddleware: hermesTestAuth,
        pool: fakePool,
        skipNotifications: options.skipNotifications !== false
    }));
    const { server, baseUrl } = await listen(app);
    try {
        await testFn({ baseUrl, fakePool });
    } finally {
        await close(server);
    }
}

describe('Hermes read-only task routes', () => {
    let server;
    let baseUrl;
    let fakePool;

    before(async () => {
        fakePool = createFakePool({ hiddenIds: [404] });
        const app = express();
        app.use(express.json());
        app.use('/api/hermes', createHermesRouter({
            authMiddleware: hermesTestAuth,
            pool: fakePool
        }));
        ({ server, baseUrl } = await listen(app));
    });

    after(async () => {
        await close(server);
    });

    it('reports task write actions as supported confirmed mutation capabilities', async () => {
        const res = await request(baseUrl, 'GET', '/api/hermes/capabilities');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.mutationActionsAvailable, true);
        assert.deepEqual(res.data.webhooks, {
            crmToHermesEnabled: false
        });
        assert.ok(res.data.supportedActions.includes('tasks.create'));
        assert.ok(res.data.supportedActions.includes('tasks.complete'));
        assert.ok(res.data.supportedActions.includes('tasks.reassign'));
        assert.ok(res.data.supportedActions.includes('tasks.reschedule'));
        assert.ok(res.data.supportedActions.includes('menu_photos.read'));
        assert.ok(res.data.supportedActions.includes('menu_photos.candidates'));
        assert.ok(res.data.supportedActions.includes('menu_photos.draft'));
        assert.ok(res.data.supportedActions.includes('menu_photos.apply'));
        assert.ok(res.data.supportedActions.includes('menu_photos.reject'));
        assert.deepEqual(res.data.plannedMutationActions, []);
    });

    it('lists visible tasks with Hermes schema, hard limit, and cursor pagination', async () => {
        const res = await request(
            baseUrl,
            'GET',
            '/api/hermes/tasks?limit=500&status=open&ownerUserId=7&priority=critical&dateFrom=2026-06-01&dateTo=2026-06-30&businessContext=event_genix'
        );

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.items.length, 50);
        assert.equal(res.data.pagination.limit, 50);
        assert.equal(res.data.pagination.has_more, true);
        assert.ok(res.data.pagination.next_cursor);
        assert.deepEqual(Object.keys(res.data.items[0]).sort(), [
            'assignee',
            'completed_at',
            'created_at',
            'crm_url',
            'description',
            'due_at',
            'id',
            'labels',
            'metadata',
            'priority',
            'status',
            'title',
            'updated_at'
        ].sort());
        assert.equal(res.data.items[0].status, 'open');
        assert.equal(res.data.items[0].crm_url.startsWith('http://127.0.0.1:'), true);
        assert.equal(JSON.stringify(res.data).includes('control_meta'), false);

        const listCall = fakePool.calls.find(call => /ORDER BY COALESCE\(t\.updated_at, t\.created_at\) DESC/i.test(call.text));
        assert.ok(listCall, 'list query should run');
        assert.match(listCall.text, /task_observer_scope/);
        assert.match(listCall.text, /COALESCE\(t\.business_context, 'event_genix'\)/);
        assert.ok(listCall.params.some(value => Array.isArray(value) && value.includes('todo')));
        assert.ok(listCall.params.includes(7));
        assert.ok(listCall.params.some(value => Array.isArray(value) && value.includes('urgent')));
        assert.ok(listCall.params.includes('2026-06-01'));
        assert.ok(listCall.params.includes('2026-06-30'));
        assert.equal(listCall.params.at(-1), 51);
    });

    it('respects Hermes business context allowlist on task reads', async () => {
        const actorPool = createHermesActorPool();
        const taskPool = createFakePool({
            listRows: [taskRow(3001, {
                title: 'Allowed context task',
                business_context: 'event_genix'
            })]
        });
        const app = express();
        app.use(express.json());
        app.use('/api/hermes', createHermesRouter({
            authMiddleware: createHermesAuthMiddleware({
                env: {
                    HERMES_API_KEY: 'unit-hermes-key',
                    HERMES_ACTOR_USER_ID: '7',
                    HERMES_ALLOWED_BUSINESS_CONTEXTS: 'event_genix'
                },
                pool: actorPool
            }),
            pool: taskPool
        }));

        const { server, baseUrl: restrictedBaseUrl } = await listen(app);
        try {
            const allowed = await request(
                restrictedBaseUrl,
                'GET',
                '/api/hermes/tasks?limit=5&businessContext=event_genix',
                undefined,
                { 'x-api-key': 'unit-hermes-key' }
            );
            const beforeDeniedQueries = taskPool.calls.length;
            const denied = await request(
                restrictedBaseUrl,
                'GET',
                '/api/hermes/tasks?limit=5&businessContext=dar',
                undefined,
                { 'x-api-key': 'unit-hermes-key' }
            );

            assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
            assert.equal(allowed.data.meta.businessScope.activeContext, 'event_genix');
            assert.equal(allowed.data.items.length, 1);
            assert.equal(denied.status, 403, denied.text);
            assert.equal(denied.data.code, 'business_context_unavailable');
            assert.equal(taskPool.calls.length, beforeDeniedQueries);
        } finally {
            await close(server);
        }
    });

    it('returns task detail with subtasks and no raw DB fields', async () => {
        const res = await request(baseUrl, 'GET', '/api/hermes/tasks/123?businessContext=event_genix');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.task.id, '123');
        assert.equal(res.data.task.title, 'Detail task');
        assert.equal(res.data.task.status, 'in_progress');
        assert.deepEqual(res.data.task.subtasks.map(item => item.status), ['done', 'open']);
        assert.deepEqual(res.data.task.creator, { id: '2', name: 'Creator Name' });
        assert.equal(JSON.stringify(res.data).includes('+380000000000'), false);
        assert.equal(JSON.stringify(res.data).includes('hidden@example.com'), false);

        const detailCall = fakePool.calls.find(call => /COALESCE\(subtask_rows\.subtasks/.test(call.text));
        assert.ok(detailCall, 'detail query should include subtask projection');
        assert.match(detailCall.text, /task_observer_scope/);
        assert.match(detailCall.text, /COALESCE\(t\.business_context, 'event_genix'\)/);
    });

    it('returns 404 for hidden or missing task detail', async () => {
        const res = await request(baseUrl, 'GET', '/api/hermes/tasks/404?businessContext=event_genix');

        assert.equal(res.status, 404);
        assert.equal(res.data.success, false);
        assert.equal(res.data.code, 'HERMES_TASK_NOT_FOUND');
    });

    it('returns consistent Hermes error JSON for invalid filters', async () => {
        const res = await request(baseUrl, 'GET', '/api/hermes/tasks?priority=impossible&businessContext=event_genix');

        assert.equal(res.status, 400);
        assert.equal(res.data.success, false);
        assert.equal(res.data.code, 'HERMES_INVALID_FILTER');
        assert.equal(typeof res.data.error, 'string');
        assert.deepEqual(Object.keys(res.data).sort(), ['code', 'error', 'success'].sort());
    });

    it('rate-limits only Hermes routes with Retry-After and consistent error JSON', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/hermes', createHermesRouter({
            authMiddleware: hermesTestAuth,
            pool: createFakePool(),
            rateLimit: {
                windowMs: 60000,
                max: 1,
                now: () => 1000,
                keyGenerator: () => 'hermes-rate-limit-test'
            }
        }));

        const { server, baseUrl: limitedBaseUrl } = await listen(app);
        try {
            const first = await request(limitedBaseUrl, 'GET', '/api/hermes/capabilities');
            const second = await request(limitedBaseUrl, 'GET', '/api/hermes/capabilities');

            assert.equal(first.status, 200, JSON.stringify(first.data));
            assert.equal(second.status, 429);
            assert.equal(second.headers.get('retry-after'), '60');
            assert.equal(second.data.success, false);
            assert.equal(second.data.code, 'HERMES_RATE_LIMITED');
            assert.equal(second.data.error, 'Hermes rate limit exceeded');
            assert.deepEqual(second.data.meta, {
                retryAfterSeconds: 60,
                limit: 1,
                windowSeconds: 60
            });
        } finally {
            await close(server);
        }
    });

    it('returns mapped history only after visibility check', async () => {
        const visible = await request(baseUrl, 'GET', '/api/hermes/tasks/123/history?limit=100&businessContext=event_genix');

        assert.equal(visible.status, 200, JSON.stringify(visible.data));
        assert.equal(visible.data.events.length, 1);
        assert.equal(visible.data.events[0].type, 'completed');
        assert.equal(visible.data.meta.limit, 50);
        assert.equal(JSON.stringify(visible.data).includes('+380111111111'), false);
        assert.equal(JSON.stringify(visible.data).includes('control_meta'), false);

        const visibleCheck = fakePool.calls.find(call => /SELECT t\.id\s+FROM tasks t/i.test(call.text));
        assert.ok(visibleCheck, 'history should check task visibility before loading events');
        assert.match(visibleCheck.text, /task_observer_scope/);

        const beforeHistoryQueries = fakePool.calls.filter(call => /FROM task_action_history/i.test(call.text)).length;
        const hidden = await request(baseUrl, 'GET', '/api/hermes/tasks/404/history?businessContext=event_genix');
        const afterHistoryQueries = fakePool.calls.filter(call => /FROM task_action_history/i.test(call.text)).length;

        assert.equal(hidden.status, 404);
        assert.equal(hidden.data.code, 'HERMES_TASK_NOT_FOUND');
        assert.equal(afterHistoryQueries, beforeHistoryQueries);
    });
});

describe('Hermes menu photo routes', () => {
    it('lists menu photo candidates with safe product fields', async () => {
        const fakePool = createHermesCreateFakePool({
            products: [[
                'dish-1',
                productRow('dish-1', {
                    icon_url: null,
                    ai_card_draft: {
                        imageStudio: {
                            status: 'ready',
                            imageUrl: '/uploads/catalog-images/items/draft.png',
                            prompt: 'Create one clean product photo',
                            provider: 'openai',
                            model: 'gpt-image-1-mini',
                            size: '1536x1024',
                            style: 'catalog',
                            generatedAt: '2026-06-27T08:00:00.000Z'
                        }
                    }
                })
            ]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/menu-photos/candidates?limit=5&businessContext=event_genix');

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.success, true);
            assert.equal(res.data.items.length, 1);
            assert.deepEqual(Object.keys(res.data.items[0]).sort(), [
                'businessContext',
                'code',
                'crm_url',
                'currentImageUrl',
                'draft',
                'id',
                'name'
            ].sort());
            assert.equal(res.data.items[0].id, 'dish-1');
            assert.equal(res.data.items[0].currentImageUrl, null);
            assert.equal(res.data.items[0].draft.status, 'ready');
            assert.equal(JSON.stringify(res.data).includes('Internal kitchen notes'), false);
            assert.equal(JSON.stringify(res.data).includes('allergens'), false);
        });
    });

    it('returns 404 for hidden or inaccessible menu photo products', async () => {
        const fakePool = createHermesCreateFakePool({
            hiddenProductIds: ['dish-hidden'],
            products: [['dish-hidden', productRow('dish-hidden')]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/menu-photos/dish-hidden?businessContext=event_genix');

            assert.equal(res.status, 404, res.text);
            assert.equal(res.data.code, 'HERMES_MENU_PHOTO_NOT_FOUND');
        });
    });

    it('creates a failed draft safely when OpenAI image generation is unavailable', async () => {
        const previousKey = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        const fakePool = createHermesCreateFakePool({
            products: [['dish-2', productRow('dish-2', {
                icon_url: '/uploads/catalog-images/items/current-dish-2.png'
            })]]
        });

        try {
            await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
                const res = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-2/draft', {
                    size: '1536x1024',
                    style: 'catalog'
                }, mutationHeaders('menu-photo-draft-no-key'));

                assert.equal(res.status, 503, res.text);
                assert.equal(res.data.success, false);
                assert.equal(res.data.code, 'openai_not_configured');
                assert.equal(res.data.product.currentImageUrl, '/uploads/catalog-images/items/current-dish-2.png');
                assert.equal(res.data.product.draft.status, 'failed');
                assert.equal(fakePool.products.get('dish-2').icon_url, '/uploads/catalog-images/items/current-dish-2.png');
                assert.equal(fakePool.products.get('dish-2').ai_card_draft.imageStudio.status, 'failed');
                assert.match(fakePool.products.get('dish-2').ai_card_draft.imageStudio.prompt, /Menu item:/);
            });
        } finally {
            if (previousKey === undefined) {
                delete process.env.OPENAI_API_KEY;
            } else {
                process.env.OPENAI_API_KEY = previousKey;
            }
        }
    });

    it('applies a ready draft through an idempotent Hermes mutation', async () => {
        const fakePool = createHermesCreateFakePool({
            products: [[
                'dish-3',
                productRow('dish-3', {
                    icon_url: '/uploads/catalog-images/items/current-dish-3.png',
                    ai_card_draft: {
                        imageStudio: {
                            status: 'ready',
                            imageUrl: '/uploads/catalog-images/items/generated-dish-3.png',
                            prompt: 'Create one clean product photo',
                            provider: 'openai',
                            model: 'gpt-image-1-mini',
                            size: '1536x1024',
                            style: 'catalog',
                            generatedAt: '2026-06-27T08:00:00.000Z'
                        }
                    }
                })
            ]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const first = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-3/apply', {}, mutationHeaders('menu-photo-apply'));
            const retry = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-3/apply', {}, mutationHeaders('menu-photo-apply'));

            assert.equal(first.status, 200, first.text);
            assert.equal(retry.status, 200, retry.text);
            assert.deepEqual(retry.data, first.data);
            assert.equal(first.data.product.currentImageUrl, '/uploads/catalog-images/items/generated-dish-3.png');
            assert.equal(first.data.product.draft.status, 'applied');
            assert.equal(fakePool.products.get('dish-3').icon_url, '/uploads/catalog-images/items/generated-dish-3.png');
            assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET icon_url =')).length, 1);
        });
    });

    it('rejects a ready draft without changing the applied image', async () => {
        const fakePool = createHermesCreateFakePool({
            products: [[
                'dish-4',
                productRow('dish-4', {
                    icon_url: '/uploads/catalog-images/items/current-dish-4.png',
                    ai_card_draft: {
                        imageStudio: {
                            status: 'ready',
                            imageUrl: '/uploads/catalog-images/items/generated-dish-4.png',
                            prompt: 'Create one clean product photo',
                            provider: 'openai',
                            model: 'gpt-image-1-mini',
                            size: '1536x1024',
                            style: 'catalog',
                            generatedAt: '2026-06-27T08:00:00.000Z'
                        }
                    }
                })
            ]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-4/reject', {
                reason: 'Wrong plating'
            }, mutationHeaders('menu-photo-reject'));

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.product.currentImageUrl, '/uploads/catalog-images/items/current-dish-4.png');
            assert.equal(res.data.product.draft.status, 'rejected');
            assert.equal(res.data.product.draft.error, 'Wrong plating');
            assert.equal(fakePool.products.get('dish-4').icon_url, '/uploads/catalog-images/items/current-dish-4.png');
            assert.equal(fakePool.products.get('dish-4').ai_card_draft.imageStudio.status, 'rejected');
        });
    });

    it('rejects menu photo mutations in read-only all-business scope', async () => {
        const fakePool = createHermesCreateFakePool({
            products: [['dish-5', productRow('dish-5')]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(
                baseUrl,
                'POST',
                '/api/hermes/menu-photos/dish-5/apply?businessScope=all',
                {},
                mutationHeaders('menu-photo-read-only')
            );

            assert.equal(res.status, 403, res.text);
            assert.equal(res.data.code, 'business_scope_read_only');
            assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET icon_url =')).length, 0);
        });
    });
});

describe('Hermes task create route', () => {
    it('requires confirmation and idempotency headers on the task create endpoint', async () => {
        const fakePool = createHermesCreateFakePool();
        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const missingConfirmation = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Missing confirmation'
            }, {
                'Idempotency-Key': 'create-missing-confirmation'
            });
            const missingIdempotency = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Missing idempotency'
            }, {
                'X-Hermes-User-Confirmed': 'true'
            });

            assert.equal(missingConfirmation.status, 400, missingConfirmation.text);
            assert.equal(missingConfirmation.data.code, 'HERMES_CONFIRMATION_REQUIRED');
            assert.equal(missingIdempotency.status, 400, missingIdempotency.text);
            assert.equal(missingIdempotency.data.code, 'IDEMPOTENCY_KEY_REQUIRED');
            assert.equal(fakePool.createdTasks.length, 0);
        });
    });

    it('creates a task through CRM services and returns Hermes detail schema', async () => {
        const fakePool = createHermesCreateFakePool();
        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Call client',
                description: 'Confirm details',
                date: '2026-06-30',
                due_at: '2026-06-30T12:00:00+03:00',
                priority: 'critical',
                ownerUserId: 8,
                businessContext: 'event_genix',
                labels: ['booking', 'booking', 'urgent'],
                subtasks: [
                    { title: 'Check availability' },
                    { title: 'Send summary', done: true }
                ]
            }, mutationHeaders('create-success-1'));

            assert.equal(res.status, 201, res.text);
            assert.equal(res.data.success, true);
            assert.equal(res.data.task.title, 'Call client');
            assert.equal(res.data.task.status, 'open');
            assert.equal(res.data.task.priority, 'urgent');
            assert.deepEqual(res.data.task.assignee, { id: '8', name: 'Ops User' });
            assert.deepEqual(res.data.task.creator, { id: '7', name: 'Hermes Actor' });
            assert.deepEqual(res.data.task.subtasks.map(item => item.status), ['open', 'done']);
            assert.equal(res.data.task.crm_url.includes('/tasks?open='), true);
            assert.equal(res.data.meta.sourceSurface, 'hermes');
            assert.equal(res.data.meta.idempotencyKey, 'create-success-1');

            assert.equal(fakePool.createdTasks.length, 1);
            assert.equal(fakePool.createdTasks[0].source_type, 'hermes');
            assert.equal(fakePool.createdTasks[0].source_module, 'hermes');
            assert.equal(fakePool.createdTasks[0].created_by_user_id, 7);
            assert.equal(fakePool.createdTasks[0].task_kind, 'checklist');
            assert.equal(JSON.stringify(res.data).includes('control_meta'), false);
        });
    });

    it('rejects invalid title before creating a task', async () => {
        const fakePool = createHermesCreateFakePool();
        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: '   '
            }, mutationHeaders('create-invalid-title'));

            assert.equal(res.status, 400);
            assert.equal(res.data.code, 'HERMES_INVALID_TASK_PAYLOAD');
            assert.equal(fakePool.createdTasks.length, 0);
        });
    });

    it('rejects active duplicates with a 409 response', async () => {
        const fakePool = createHermesCreateFakePool({
            duplicate: {
                title: 'Call client',
                status: 'todo'
            }
        });
        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Call client',
                businessContext: 'event_genix'
            }, mutationHeaders('create-duplicate'));

            assert.equal(res.status, 409, res.text);
            assert.equal(res.data.code, 'TASK_DUPLICATE_ACTIVE');
            assert.deepEqual(res.data.meta, {
                existingId: 501,
                existingStatus: 'todo'
            });
            assert.equal(fakePool.createdTasks.length, 0);
        });
    });

    it('rejects inactive or non-assignable owners', async () => {
        const fakePool = createHermesCreateFakePool();
        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                title: 'Assign invalid owner',
                ownerUserId: 999,
                businessContext: 'event_genix'
            }, mutationHeaders('create-invalid-owner'));

            assert.equal(res.status, 400, res.text);
            assert.equal(res.data.code, 'TASK_OWNER_NOT_ASSIGNABLE');
            assert.equal(fakePool.createdTasks.length, 0);
        });
    });

    it('rejects creates in read-only multi/all business scope', async () => {
        const fakePool = createHermesCreateFakePool();
        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks?businessScope=all', {
                title: 'Should not create'
            }, mutationHeaders('create-all-scope'));

            assert.equal(res.status, 403, res.text);
            assert.equal(res.data.code, 'business_scope_read_only');
            assert.equal(fakePool.createdTasks.length, 0);
        });
    });

    it('replays the stored create response on idempotent retry', async () => {
        const fakePool = createHermesCreateFakePool();
        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const body = {
                title: 'Retry-safe create',
                businessContext: 'event_genix'
            };
            const first = await request(baseUrl, 'POST', '/api/hermes/tasks', body, mutationHeaders('create-retry'));
            const retry = await request(baseUrl, 'POST', '/api/hermes/tasks', body, mutationHeaders('create-retry'));

            assert.equal(first.status, 201, first.text);
            assert.equal(retry.status, 201, retry.text);
            assert.deepEqual(retry.data, first.data);
            assert.deepEqual(first.data.task.assignee, { id: '7', name: 'Hermes Actor' });
            assert.equal(fakePool.createdTasks.length, 1);
        });
    });
});

describe('Hermes task write routes', () => {
    it('completes a visible task through taskExecution', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[700, taskRow(700, {
                status: 'todo',
                workflow_state: 'todo',
                version: 3,
                control_meta: {}
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/700/complete', {}, mutationHeaders('complete-success'));

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.task.id, '700');
            assert.equal(res.data.task.status, 'done');
            assert.equal(res.data.meta.sourceSurface, 'hermes');
            assert.equal(res.data.meta.historyEvent.actionType, 'task_completed');
            assert.equal(res.data.meta.historyEvent.sourceSurface, 'hermes');
            assert.equal(res.data.meta.historyEvent.meta.route, 'hermes_task_complete');
        });
    });

    it('preserves report-required and incomplete-subtasks completion errors', async () => {
        const reportRequiredPool = createHermesCreateFakePool({
            tasks: [[701, taskRow(701, {
                status: 'todo',
                control_meta: { reportRequired: true }
            })]]
        });
        await withHermesCreateServer(reportRequiredPool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/701/complete', {}, mutationHeaders('complete-report-required'));

            assert.equal(res.status, 409, res.text);
            assert.equal(res.data.code, 'TASK_REPORT_REQUIRED');
        });

        const incompleteSubtasksPool = createHermesCreateFakePool({
            tasks: [[702, taskRow(702, { status: 'todo' })]],
            subtaskStates: {
                702: { total: 2, done: 1 }
            }
        });
        await withHermesCreateServer(incompleteSubtasksPool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/702/complete', {}, mutationHeaders('complete-subtasks-incomplete'));

            assert.equal(res.status, 409, res.text);
            assert.equal(res.data.code, 'SUBTASKS_INCOMPLETE');
        });
    });

    it('does not allow completing hidden tasks', async () => {
        const fakePool = createHermesCreateFakePool({
            hiddenIds: [703],
            tasks: [[703, taskRow(703, { status: 'todo' })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/703/complete', {}, mutationHeaders('complete-hidden'));

            assert.equal(res.status, 404, res.text);
            assert.equal(res.data.code, 'TASK_NOT_VISIBLE');
            assert.equal(fakePool.historyEvents.length, 0);
        });
    });

    it('reassigns a visible task and returns the mapped assignee', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[704, taskRow(704, {
                status: 'todo',
                owner_user_id: 7,
                assigned_to: 'Hermes Actor',
                owner: 'Hermes Actor'
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/704/reassign', {
                assignee: { id: 8 }
            }, mutationHeaders('reassign-success'));

            assert.equal(res.status, 200, res.text);
            assert.deepEqual(res.data.assignee, { id: '8', name: 'Ops User' });
            assert.deepEqual(res.data.task.assignee, { id: '8', name: 'Ops User' });
            assert.equal(res.data.meta.historyEvent.actionType, 'task_owner_reassigned');
            assert.equal(res.data.meta.historyEvent.sourceSurface, 'hermes');
            assert.equal(res.data.meta.historyEvent.meta.route, 'hermes_task_reassign');
        });
    });

    it('rejects invalid reassign owners', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[708, taskRow(708, {
                status: 'todo',
                owner_user_id: 7,
                assigned_to: 'Hermes Actor',
                owner: 'Hermes Actor'
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/708/reassign', {
                ownerUserId: 999
            }, mutationHeaders('reassign-invalid-owner'));

            assert.equal(res.status, 400, res.text);
            assert.equal(res.data.code, 'TASK_OWNER_NOT_ASSIGNABLE');
            assert.equal(fakePool.tasks.get(708).owner_user_id, 7);
            assert.equal(fakePool.historyEvents.length, 0);
        });
    });

    it('reschedules a visible task using due_at', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[705, taskRow(705, {
                status: 'todo',
                deadline: '2026-06-27T12:00:00.000Z'
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/705/reschedule', {
                due_at: '2026-07-01T12:00:00+03:00'
            }, mutationHeaders('reschedule-success'));

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.task.id, '705');
            assert.equal(res.data.task.due_at, '2026-07-01T09:00:00.000Z');
            assert.equal(res.data.meta.historyEvent.actionType, 'task_rescheduled');
            assert.equal(res.data.meta.historyEvent.sourceSurface, 'hermes');
            assert.equal(res.data.meta.historyEvent.meta.route, 'hermes_task_reschedule');
        });
    });

    it('rejects write actions in read-only multi/all business scope', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[706, taskRow(706, { status: 'todo' })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/706/reschedule?businessScope=all', {
                due_at: '2026-07-01T12:00:00+03:00'
            }, mutationHeaders('reschedule-read-only'));

            assert.equal(res.status, 403, res.text);
            assert.equal(res.data.code, 'business_scope_read_only');
            assert.equal(fakePool.historyEvents.length, 0);
        });
    });

    it('replays the stored complete response on idempotent retry', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[707, taskRow(707, {
                status: 'todo',
                workflow_state: 'todo',
                version: 1
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const first = await request(baseUrl, 'POST', '/api/hermes/tasks/707/complete', {}, mutationHeaders('complete-retry'));
            const retry = await request(baseUrl, 'POST', '/api/hermes/tasks/707/complete', {}, mutationHeaders('complete-retry'));

            assert.equal(first.status, 200, first.text);
            assert.equal(retry.status, 200, retry.text);
            assert.deepEqual(retry.data, first.data);
            assert.equal(fakePool.historyEvents.length, 1);
            assert.equal(fakePool.calls.filter(call => call.compact?.startsWith("UPDATE tasks SET status = 'done'")).length, 1);
        });
    });
});
