const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fsp = require('node:fs/promises');
const jwt = require('jsonwebtoken');
const os = require('node:os');
const path = require('node:path');
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

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    const previous = require.cache[id] || null;
    require.cache[id] = { id, filename: id, loaded: true, exports };
    return () => {
        if (previous) require.cache[id] = previous;
        else delete require.cache[id];
    };
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

function cabinetOwner(overrides = {}) {
    return {
        id: 4,
        username: 'owner.user',
        name: 'Owner User',
        role: 'creator',
        business_contexts: ['event_genix'],
        default_business_context: 'event_genix',
        is_active: true,
        ...overrides
    };
}

function createCabinetFakePool(options = {}) {
    const calls = [];
    const owner = options.owner === undefined ? cabinetOwner() : options.owner;
    const taskRows = options.taskRows || [
        taskRow(4101, {
            title: 'Focus task',
            owner_user_id: 4,
            owner_name: 'Owner User',
            owner_username: 'owner.user',
            assigned_to: 'Owner User',
            owner: 'Owner User',
            date: null,
            focus_rank: 1
        }),
        taskRow(4102, {
            title: 'Waiting task',
            owner_user_id: 4,
            owner_name: 'Owner User',
            owner_username: 'owner.user',
            assigned_to: 'Owner User',
            owner: 'Owner User',
            date: null,
            workflow_state: 'waiting',
            task_kind: 'waiting'
        })
    ];
    const completedRows = options.completedRows || [
        taskRow(4199, {
            title: 'Completed task',
            owner_user_id: 4,
            owner_name: 'Owner User',
            owner_username: 'owner.user',
            assigned_to: 'Owner User',
            owner: 'Owner User',
            status: 'done',
            completed_at: '2026-06-27T08:00:00.000Z'
        })
    ];
    const preferences = options.preferences === undefined
        ? {
            id: 40,
            user_id: 4,
            focus_limit: 3,
            digest_mode: 'important_only',
            default_task_mode: 'personal',
            default_privacy: 'me_only',
            show_private_in_tasks_page: false,
            enable_telegram_reminders: true,
            enable_evening_review: true,
            task_sound_enabled: true,
            task_sound_volume: '0.400',
            task_sound_theme: 'subtle',
            created_at: '2026-06-27T07:00:00.000Z',
            updated_at: '2026-06-27T07:00:00.000Z'
        }
        : options.preferences;
    const quickStats = options.quickStats || {
        done_total: 4,
        done_today: 2,
        parent_done_today: 1,
        subtask_done_today: 1,
        subtask_done_total: 2,
        remaining_today: taskRows.length,
        overdue_carryover: 0,
        active_my_day: taskRows.length
    };

    return {
        calls,
        async query(text, params = []) {
            const compact = text.replace(/\s+/g, ' ').trim();
            calls.push({ text, params, compact });

            if (/^UPDATE employee_profiles SET last_activity_at/i.test(compact)
                || /^UPDATE users SET last_seen_at/i.test(compact)) {
                return { rows: [], rowCount: 0 };
            }

            if (/SELECT is_active, session_revoked_at FROM users WHERE id = \$1/i.test(compact)) {
                return owner ? { rows: [{ is_active: owner.is_active, session_revoked_at: null }] } : { rows: [] };
            }

            if (/FROM users WHERE id = \$1/i.test(compact)) {
                return owner ? { rows: [owner], rowCount: 1 } : { rows: [], rowCount: 0 };
            }

            if (/INSERT INTO task_user_preferences/i.test(compact)) {
                return { rows: [preferences], rowCount: 1 };
            }

            if (/FROM task_user_preferences/i.test(compact)) {
                return preferences ? { rows: [preferences], rowCount: 1 } : { rows: [], rowCount: 0 };
            }

            if (/COUNT\(\*\)::int AS open_count/i.test(compact)) {
                return { rows: [{ open_count: taskRows.length }], rowCount: 1 };
            }

            if (/AS done_total/i.test(compact) && /AS active_my_day/i.test(compact)) {
                return { rows: [quickStats], rowCount: 1 };
            }

            if (/COALESCE\(t\.status, 'todo'\) = 'done'/i.test(compact)) {
                return { rows: completedRows, rowCount: completedRows.length };
            }

            if (/FROM tasks t/i.test(compact)) {
                return { rows: taskRows, rowCount: taskRows.length };
            }

            throw new Error(`Unexpected cabinet fake query: ${compact}`);
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
    const outbox = [];
    const users = new Map([
        [7, { id: 7, username: 'hermes.actor', name: 'Hermes Actor', role: 'creator' }],
        [8, { id: 8, username: 'ops.user', name: 'Ops User', role: 'manager' }],
        ...(options.users || [])
    ]);
    const tasks = new Map(
        (options.tasks || []).map(([id, task]) => [Number(id), { ...task }])
    );
    const subtasks = new Map(
        Object.entries(options.subtasks || {}).map(([taskId, rows]) => [
            Number(taskId),
            (Array.isArray(rows) ? rows : []).map((row, index) => ({
                id: row.id || (9000 + index),
                task_id: Number(taskId),
                title: row.title || `Subtask ${index + 1}`,
                is_done: row.is_done === true || row.isDone === true,
                sort_order: row.sort_order ?? row.sortOrder ?? index,
                source_type: row.source_type || row.sourceType || 'manual',
                created_at: row.created_at || '2026-06-27T07:20:00.000Z',
                updated_at: row.updated_at || '2026-06-27T07:20:00.000Z',
                completed_at: row.completed_at || (row.is_done || row.isDone ? '2026-06-27T07:20:00.000Z' : null)
            }))
        ])
    );
    const products = new Map(
        (options.products || []).map(([id, product]) => [String(id), { ...product }])
    );
    const catalogImageBlobs = new Map();
    const hiddenIds = new Set(options.hiddenIds || []);
    const hiddenProductIds = new Set((options.hiddenProductIds || []).map(String));
    const subtaskStates = new Map(
        Object.entries(options.subtaskStates || {}).map(([id, state]) => [Number(id), state])
    );
    const reportIds = new Set(options.reportIds || [321]);
    const reports = [];
    let nextId = 2000;
    let nextSubtaskId = 9000;
    let nextHistoryId = 12000;
    let nextReportId = options.nextReportId || 41000;

    function key(integrationId, idempotencyKey) {
        return `${integrationId}:${idempotencyKey}`;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function subtaskRows(taskId) {
        return (subtasks.get(Number(taskId)) || [])
            .slice()
            .sort((a, b) => (Number(a.sort_order || 0) - Number(b.sort_order || 0)) || (Number(a.id) - Number(b.id)));
    }

    function subtaskCounts(taskId) {
        const rows = subtaskRows(taskId);
        if (rows.length) {
            return {
                total: rows.length,
                done: rows.filter(row => row.is_done === true).length
            };
        }
        const state = subtaskStates.get(Number(taskId)) || { total: 0, done: 0 };
        return { total: state.total || 0, done: state.done || 0 };
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

        if (/SELECT t\.id(?:, t\.status, t\.updated_at, t\.version)? FROM tasks t WHERE t\.id = \$1/i.test(compact)) {
            const id = Number(params[0]);
            if (hiddenIds.has(id)) return { rows: [], rowCount: 0 };
            const task = tasks.get(id);
            if (!task) return { rows: [], rowCount: 0 };
            return {
                rows: [{
                    id: task.id,
                    status: task.status || 'todo',
                    updated_at: task.updated_at || null,
                    version: task.version || 1
                }],
                rowCount: 1
            };
        }

        if (/SELECT t\.id, t\.title, t\.description/i.test(compact)
            && /FROM tasks t LEFT JOIN users u ON u\.id = t\.owner_user_id LEFT JOIN users creator ON creator\.id = t\.created_by_user_id/i.test(compact)
            && /WHERE t\.id = \$1/i.test(compact)) {
            const id = Number(params[0]);
            if (hiddenIds.has(id)) return { rows: [], rowCount: 0 };
            const task = tasks.get(id);
            if (!task) return { rows: [], rowCount: 0 };
            const owner = users.get(Number(task.owner_user_id || 0));
            const rowSubtasks = subtaskRows(id);
            return {
                rows: [{
                    ...clone(task),
                    owner_name: owner?.name || task.owner_name || null,
                    owner_username: owner?.username || task.owner_username || null,
                    creator_name: task.creator_name || 'Creator Name',
                    created_by_username: task.created_by_username || 'creator',
                    subtasks: compact.includes('COALESCE(subtask_rows.subtasks') ? clone(rowSubtasks) : task.subtasks
                }],
                rowCount: 1
            };
        }

        if (/SELECT COUNT\(\*\)::int AS total, COUNT\(\*\) FILTER \(WHERE is_done = true\)::int AS done FROM task_subtasks WHERE task_id = \$1/i.test(compact)) {
            const state = subtaskCounts(params[0]);
            return { rows: [{ total: state.total || 0, done: state.done || 0 }], rowCount: 1 };
        }

        if (/SELECT id FROM reports WHERE id = \$1/i.test(compact)) {
            const id = Number(params[0]);
            return { rows: reportIds.has(id) ? [{ id }] : [], rowCount: reportIds.has(id) ? 1 : 0 };
        }

        if (compact.startsWith('INSERT INTO reports')) {
            const report = {
                id: nextReportId++,
                business_context: params[0],
                type: params[1],
                amount: params[2],
                description: params[3],
                category: params[4],
                submitted_by: params[5],
                submitted_via: 'web',
                raw_data: JSON.parse(params[6]),
                hashtags: JSON.parse(params[7]),
                created_at: '2026-06-27T08:55:00.000Z',
                assigned_to: null
            };
            reports.push(report);
            reportIds.add(report.id);
            return {
                rows: [{
                    id: report.id,
                    category: report.category,
                    amount: report.amount,
                    created_at: report.created_at
                }],
                rowCount: 1
            };
        }

        if (compact.startsWith('SELECT id FROM accountants')) {
            return { rows: options.accountantId ? [{ id: options.accountantId }] : [], rowCount: options.accountantId ? 1 : 0 };
        }

        if (compact.startsWith('UPDATE reports SET assigned_to =')) {
            const report = reports.find(item => item.id === Number(params[1]));
            if (report) report.assigned_to = Number(params[0]);
            return { rows: [], rowCount: report ? 1 : 0 };
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

        if (compact.startsWith('INSERT INTO catalog_image_blobs')) {
            const [filename, contentType, data, sizeBytes, sourceUrl, metadata] = params;
            catalogImageBlobs.set(filename, {
                filename,
                content_type: contentType,
                data,
                size_bytes: sizeBytes,
                source_url: sourceUrl,
                metadata: JSON.parse(metadata || '{}')
            });
            return { rows: [], rowCount: 1 };
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

        if (compact.startsWith('INSERT INTO notification_outbox')) {
            const duplicate = outbox.find(row =>
                row.event_id === params[0]
                || (
                    row.task_id === params[1]
                    && row.owner_user_id === params[2]
                    && row.event_type === params[3]
                    && row.payload_hash === params[5]
                )
            );
            if (duplicate) return { rows: [], rowCount: 0 };
            const row = {
                id: outbox.length + 1,
                event_id: params[0],
                task_id: params[1],
                owner_user_id: params[2],
                event_type: params[3],
                payload_json: JSON.parse(params[4]),
                payload_hash: params[5],
                status: 'pending',
                attempts: 0,
                available_at: params[6] || '2026-06-27T07:10:00.000Z',
                created_at: '2026-06-27T07:10:00.000Z',
                updated_at: '2026-06-27T07:10:00.000Z',
                claimed_at: null,
                sent_at: null,
                last_error: null,
                last_error_code: null,
                last_delivery_channel: null,
                last_delivery_target: null,
                claimed_by: null,
                locked_until: null
            };
            outbox.push(row);
            return { rows: [row], rowCount: 1 };
        }

        if (compact.startsWith('SELECT * FROM notification_outbox WHERE event_id = $1 OR')) {
            const row = outbox.find(item => item.event_id === params[0])
                || outbox.find(item =>
                    item.task_id === params[1]
                    && item.owner_user_id === params[2]
                    && item.event_type === params[3]
                    && item.payload_hash === params[4]
                );
            return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
        }

        if (compact.startsWith('UPDATE tasks SET status =')) {
            const task = tasks.get(Number(params[0]));
            if (!task || ['done', 'cancelled', 'archived'].includes(String(task.status || 'todo'))) {
                return { rows: [], rowCount: 0 };
            }
            const isHermesStatusUpdate = compact.includes('status = $2::text');
            const incomingReportId = isHermesStatusUpdate ? null : Number(params[2] || 0);
            if (incomingReportId > 0) {
                task.control_meta = {
                    ...(task.control_meta || {}),
                    reportRequired: true,
                    reportId: incomingReportId,
                    reportSubmittedAt: '2026-06-27T09:00:00.000Z',
                    reportSubmittedBy: params[3] || 'Hermes Actor'
                };
            }
            Object.assign(task, isHermesStatusUpdate ? {
                status: params[1],
                workflow_state: params[1] === 'in_progress' ? 'in_progress' : 'todo',
                completed_at: null,
                updated_at: '2026-06-27T08:00:00.000Z',
                version: Number(task.version || 1) + 1
            } : {
                status: 'done',
                workflow_state: 'done',
                completed_at: '2026-06-27T08:00:00.000Z',
                updated_at: '2026-06-27T08:00:00.000Z',
                version: Number(task.version || 1) + 1
            });
            return { rows: [clone(task)], rowCount: 1 };
        }

        if (compact.startsWith('UPDATE tasks SET control_meta =')) {
            const task = tasks.get(Number(params[0]));
            if (!task || String(task.business_context || 'event_genix') !== String(params[3] || 'event_genix')) {
                return { rows: [], rowCount: 0 };
            }
            task.control_meta = {
                ...(task.control_meta || {}),
                reportRequired: true,
                reportId: Number(params[1]),
                reportSubmittedAt: '2026-06-27T08:56:00.000Z',
                reportSubmittedBy: params[2]
            };
            task.updated_at = '2026-06-27T08:56:00.000Z';
            task.version = Number(task.version || 1) + 1;
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

        if (/SELECT \*\s+FROM task_subtasks WHERE task_id = \$1 ORDER BY sort_order ASC, id ASC/i.test(compact)) {
            const rows = subtaskRows(params[0]);
            return { rows: clone(rows), rowCount: rows.length };
        }

        if (compact.startsWith('UPDATE task_subtasks SET is_done =')) {
            const taskId = Number(params[0]);
            const subtaskId = Number(params[1]);
            const isDone = params[2] === true;
            const rows = subtasks.get(taskId) || [];
            const row = rows.find(item => Number(item.id) === subtaskId);
            if (!row) return { rows: [], rowCount: 0 };
            row.is_done = isDone;
            row.completed_at = isDone ? '2026-06-27T09:15:00.000Z' : null;
            row.updated_at = '2026-06-27T09:15:00.000Z';
            return { rows: [clone(row)], rowCount: 1 };
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
            const rows = subtasks.get(Number(params[0])) || [];
            rows.push(subtask);
            subtasks.set(Number(params[0]), rows);
            return { rows: [subtask], rowCount: 1 };
        }

        if (compact.startsWith('UPDATE tasks SET updated_at = NOW(), version = COALESCE(version, 1) + 1')) {
            const task = tasks.get(Number(params[0]));
            if (!task) return { rows: [], rowCount: 0 };
            task.updated_at = '2026-06-27T09:16:00.000Z';
            task.version = Number(task.version || 1) + 1;
            return { rows: [{ id: task.id, updated_at: task.updated_at, version: task.version }], rowCount: 1 };
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
        outbox,
        reports,
        subtasks,
        tasks,
        products,
        catalogImageBlobs,
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
        skipNotifications: options.skipNotifications !== false,
        env: options.env || {},
        menuImageUploadOptions: options.menuImageUploadOptions || undefined
    }));
    const { server, baseUrl } = await listen(app);
    try {
        await testFn({ baseUrl, fakePool });
    } finally {
        await close(server);
    }
}

function hermesApiHeaders(extra = {}) {
    return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Hermes-Agent/Event-Genix-CRM-Integration',
        'X-Integration-Id': 'hermes-event-genix-crm',
        'x-api-key': 'unit-hermes-key',
        ...extra
    };
}

async function withHermesCabinetServer(testFn, options = {}) {
    const actorPool = createHermesActorPool(options.actor || {});
    const fakePool = createCabinetFakePool(options.poolOptions || {});
    const app = express();
    app.use(express.json());
    app.use('/api/hermes', createHermesRouter({
        authMiddleware: createHermesAuthMiddleware({
            env: {
                HERMES_API_KEY: 'unit-hermes-key',
                HERMES_ACTOR_USER_ID: '7',
                ...(options.authEnv || {})
            },
            pool: actorPool
        }),
        pool: fakePool,
        env: options.routeEnv || {}
    }));
    const { server, baseUrl } = await listen(app);
    try {
        await testFn({ baseUrl, fakePool, actorPool });
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
        assert.ok(res.data.supportedActions.includes('tasks.my_cabinet'));
        assert.ok(res.data.supportedActions.includes('tasks.create'));
        assert.ok(res.data.supportedActions.includes('tasks.complete'));
        assert.ok(res.data.supportedActions.includes('tasks.completion_report'));
        assert.ok(res.data.supportedActions.includes('tasks.comment'));
        assert.ok(res.data.supportedActions.includes('tasks.subtasks.read'));
        assert.ok(res.data.supportedActions.includes('tasks.subtask.toggle'));
        assert.ok(res.data.supportedActions.includes('tasks.reassign'));
        assert.ok(res.data.supportedActions.includes('tasks.reschedule'));
        assert.ok(res.data.supportedActions.includes('menu_photos.read'));
        assert.ok(res.data.supportedActions.includes('menu_photos.candidates'));
        assert.ok(res.data.supportedActions.includes('menu_photos.draft'));
        assert.ok(res.data.supportedActions.includes('menu_photos.apply'));
        assert.ok(res.data.supportedActions.includes('menu_photos.reject'));
        assert.deepEqual(res.data.myCabinet, {
            available: true,
            defaultOwnerConfigured: false,
            ownerAllowlistEnabled: false
        });
        assert.deepEqual(res.data.plannedMutationActions, []);
        assert.equal(
            res.data.endpoints.tasks.completionReport,
            'POST /api/hermes/tasks/:id/completion-report'
        );
        assert.equal(
            res.data.endpoints.tasks.comment,
            'POST /api/hermes/tasks/:id/comments'
        );
        assert.equal(
            res.data.endpoints.tasks.subtasks,
            'GET /api/hermes/tasks/:id/subtasks'
        );
        assert.equal(
            res.data.endpoints.tasks.subtaskToggle,
            'PATCH /api/hermes/tasks/:id/subtasks/:subtaskId'
        );
    });

    it('protects Hermes my-cabinet with x-api-key auth', async () => {
        await withHermesCabinetServer(async ({ baseUrl: cabinetBaseUrl }) => {
            const missing = await request(cabinetBaseUrl, 'GET', '/api/hermes/my-cabinet?ownerUserId=4');
            const wrong = await request(
                cabinetBaseUrl,
                'GET',
                '/api/hermes/my-cabinet?ownerUserId=4',
                undefined,
                hermesApiHeaders({ 'x-api-key': 'wrong-key' })
            );

            assert.equal(missing.status, 401);
            assert.equal(missing.data.code, 'HERMES_AUTH_REQUIRED');
            assert.equal(wrong.status, 401);
            assert.equal(wrong.data.code, 'HERMES_AUTH_INVALID');
        }, {
            routeEnv: {
                EVENT_GENIX_CRM_AGENT_OWNER_USER_ID: '4',
                EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS: '4'
            }
        });
    });

    it('validates Hermes my-cabinet owner input and allowlist', async () => {
        await withHermesCabinetServer(async ({ baseUrl: cabinetBaseUrl }) => {
            const res = await request(cabinetBaseUrl, 'GET', '/api/hermes/my-cabinet', undefined, hermesApiHeaders());
            assert.equal(res.status, 400);
            assert.equal(res.data.code, 'HERMES_OWNER_REQUIRED');
        });

        await withHermesCabinetServer(async ({ baseUrl: cabinetBaseUrl }) => {
            const res = await request(cabinetBaseUrl, 'GET', '/api/hermes/my-cabinet?ownerUserId=abc', undefined, hermesApiHeaders());
            assert.equal(res.status, 400);
            assert.equal(res.data.code, 'HERMES_INVALID_OWNER');
        }, {
            routeEnv: {
                EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS: '4'
            }
        });

        await withHermesCabinetServer(async ({ baseUrl: cabinetBaseUrl }) => {
            const res = await request(cabinetBaseUrl, 'GET', '/api/hermes/my-cabinet?ownerUserId=4abc', undefined, hermesApiHeaders());
            assert.equal(res.status, 400);
            assert.equal(res.data.code, 'HERMES_INVALID_OWNER');
        }, {
            routeEnv: {
                EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS: '4'
            }
        });

        await withHermesCabinetServer(async ({ baseUrl: cabinetBaseUrl }) => {
            const res = await request(cabinetBaseUrl, 'GET', '/api/hermes/my-cabinet?ownerUserId=4', undefined, hermesApiHeaders());
            assert.equal(res.status, 403);
            assert.equal(res.data.code, 'HERMES_OWNER_NOT_ALLOWED');
        }, {
            routeEnv: {
                EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS: '5'
            }
        });

        await withHermesCabinetServer(async ({ baseUrl: cabinetBaseUrl }) => {
            const res = await request(cabinetBaseUrl, 'GET', '/api/hermes/my-cabinet?ownerUserId=4', undefined, hermesApiHeaders());
            assert.equal(res.status, 404);
            assert.equal(res.data.code, 'HERMES_OWNER_NOT_FOUND');
        }, {
            routeEnv: {
                EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS: '4'
            },
            poolOptions: {
                owner: null
            }
        });
    });

    it('returns Hermes my-cabinet projection without writing preferences', async () => {
        await withHermesCabinetServer(async ({ baseUrl: cabinetBaseUrl, fakePool: cabinetPool }) => {
            const res = await request(
                cabinetBaseUrl,
                'GET',
                '/api/hermes/my-cabinet?ownerUserId=4&businessContext=event_genix',
                undefined,
                hermesApiHeaders()
            );

            assert.equal(res.status, 200, JSON.stringify(res.data));
            assert.equal(res.data.success, true);
            assert.equal(Array.isArray(res.data.today), true);
            assert.equal(Array.isArray(res.data.overdue), true);
            assert.equal(Array.isArray(res.data.all), true);
            assert.equal(Array.isArray(res.data.completedHistory), true);
            assert.equal(res.data.stats.openTaskCount, 2);
            assert.equal(res.data.stats.activeOpenCount, 2);
            assert.equal(res.data.stats.todayDone, 2);
            assert.equal(res.data.stats.taskQuick.completedToday, 2);
            assert.equal(res.data.meta.sourceSurface, 'hermes');
            assert.equal(res.data.meta.source, 'hermes-event-genix-crm');
            assert.equal(res.data.meta.ownerUserId, 4);
            assert.equal(res.data.meta.businessContext, 'event_genix');
            assert.equal(res.data.meta.projection, 'tasks.my_cabinet');
            assert.equal(
                cabinetPool.calls.some(call => /INSERT INTO task_user_preferences/i.test(call.text)),
                false,
                'Hermes read-only projection must not create task preference rows'
            );
            assert.equal(
                cabinetPool.calls.some(call => /FROM task_user_preferences/i.test(call.text)),
                true,
                'Hermes projection should read existing task preferences'
            );
        }, {
            routeEnv: {
                EVENT_GENIX_CRM_AGENT_OWNER_USER_ID: '4',
                EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS: '4'
            }
        });
    });

    it('matches the JWT my-cabinet projection counts for the same owner', async () => {
        const secret = 'hermes-my-cabinet-route-parity-secret';
        const originalJwtSecret = process.env.JWT_SECRET;
        const dbPath = require.resolve('../db');
        const authPath = require.resolve('../middleware/auth');
        const tasksPath = require.resolve('../routes/tasks');
        const originalDbCache = require.cache[dbPath];
        const originalAuthCache = require.cache[authPath];
        const originalTasksCache = require.cache[tasksPath];
        const cabinetPool = createCabinetFakePool();
        let server;

        try {
            process.env.JWT_SECRET = secret;
            delete require.cache[authPath];
            delete require.cache[tasksPath];
            require.cache[dbPath] = {
                id: dbPath,
                filename: dbPath,
                loaded: true,
                exports: { pool: cabinetPool }
            };

            const tasksRouter = require('../routes/tasks');
            const actorPool = createHermesActorPool();
            const app = express();
            app.use(express.json());
            app.use('/api/tasks', tasksRouter);
            app.use('/api/hermes', createHermesRouter({
                authMiddleware: createHermesAuthMiddleware({
                    env: {
                        HERMES_API_KEY: 'unit-hermes-key',
                        HERMES_ACTOR_USER_ID: '7'
                    },
                    pool: actorPool
                }),
                pool: cabinetPool,
                env: {
                    EVENT_GENIX_CRM_AGENT_OWNER_USER_ID: '4',
                    EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS: '4'
                }
            }));
            const listened = await listen(app);
            server = listened.server;
            const baseUrl = listened.baseUrl;
            const token = jwt.sign({
                id: 4,
                username: 'owner.user',
                name: 'Owner User',
                role: 'creator',
                business_contexts: ['event_genix'],
                default_business_context: 'event_genix'
            }, secret, { expiresIn: '1h' });

            const ui = await request(baseUrl, 'GET', '/api/tasks/my-cabinet?businessContext=event_genix', undefined, {
                Authorization: `Bearer ${token}`
            });
            const hermes = await request(
                baseUrl,
                'GET',
                '/api/hermes/my-cabinet?ownerUserId=4&businessContext=event_genix',
                undefined,
                hermesApiHeaders()
            );

            assert.equal(ui.status, 200, JSON.stringify(ui.data));
            assert.equal(hermes.status, 200, JSON.stringify(hermes.data));
            assert.deepEqual(
                {
                    today: hermes.data.today.length,
                    overdue: hermes.data.overdue.length,
                    all: hermes.data.all.length,
                    completedHistory: hermes.data.completedHistory.length,
                    openTaskCount: hermes.data.stats.openTaskCount,
                    activeOpenCount: hermes.data.stats.activeOpenCount,
                    todayDone: hermes.data.stats.todayDone,
                    taskQuickCompleted: hermes.data.stats.taskQuick.completedToday
                },
                {
                    today: ui.data.today.length,
                    overdue: ui.data.overdue.length,
                    all: ui.data.all.length,
                    completedHistory: ui.data.completedHistory.length,
                    openTaskCount: ui.data.stats.openTaskCount,
                    activeOpenCount: ui.data.stats.activeOpenCount,
                    todayDone: ui.data.stats.todayDone,
                    taskQuickCompleted: ui.data.stats.taskQuick.completedToday
                }
            );
        } finally {
            if (server) await close(server);
            if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
            else process.env.JWT_SECRET = originalJwtSecret;
            if (originalDbCache) require.cache[dbPath] = originalDbCache;
            else delete require.cache[dbPath];
            if (originalAuthCache) require.cache[authPath] = originalAuthCache;
            else delete require.cache[authPath];
            if (originalTasksCache) require.cache[tasksPath] = originalTasksCache;
            else delete require.cache[tasksPath];
        }
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
    it('uses real products.price as the menu photo legacy price alias', async () => {
        const source = await fsp.readFile(path.join(__dirname, '..', 'routes', 'hermes.js'), 'utf8');

        assert.doesNotMatch(source, /\bp\.legacy_price\b/);
        assert.match(source, /\bp\.price\s+AS\s+legacy_price\b/);
    });

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

    it('returns generation context through the Hermes menu photo context wrapper', async () => {
        const fakePool = createHermesCreateFakePool({
            products: [['dish-context', productRow('dish-context', {
                code: 'MENU-CONTEXT',
                name: 'Context dish',
                icon_url: '/uploads/catalog-images/items/context-current.png',
                ai_card_draft: {
                    imageStudio: {
                        status: 'ready',
                        imageUrl: '/uploads/catalog-images/items/context-draft.png',
                        size: '1536x1024',
                        style: 'catalog'
                    }
                }
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/menu-photos/dish-context/context?businessContext=event_genix');

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.success, true);
            assert.equal(res.data.product.id, 'dish-context');
            assert.equal(res.data.product.currentImageUrl, '/uploads/catalog-images/items/context-current.png');
            assert.equal(res.data.context.product.id, 'dish-context');
            assert.equal(res.data.context.product.code, 'MENU-CONTEXT');
            assert.equal(res.data.context.product.currentImageUrl, '/uploads/catalog-images/items/context-current.png');
            assert.equal(res.data.context.product.draftImageUrl, '/uploads/catalog-images/items/context-draft.png');
            assert.equal(res.data.context.product.techCard, 'Internal kitchen notes');
            assert.equal(res.data.context.imageRules.targetUsage, 'booking_menu_catalog');
            assert.ok(res.data.context.imageRules.allowedSizes.includes('1536x1024'));
            assert.equal(res.data.meta.businessScope.activeContext, 'event_genix');
        });
    });

    it('requires Hermes auth on the menu photo context wrapper', async () => {
        await withHermesCabinetServer(async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/menu-photos/dish-auth/context?businessContext=event_genix');

            assert.equal(res.status, 401, res.text);
            assert.equal(res.data.code, 'HERMES_AUTH_REQUIRED');
        });
    });

    it('requires Hermes auth on the external menu photo draft wrapper', async () => {
        await withHermesCabinetServer(async ({ baseUrl }) => {
            const res = await request(
                baseUrl,
                'POST',
                '/api/hermes/menu-photos/dish-auth/external-draft?businessContext=event_genix',
                {
                    imageBase64: Buffer.from('external-png').toString('base64'),
                    prompt: 'Hermes prompt',
                    source: 'hermes'
                },
                mutationHeaders('menu-photo-external-auth')
            );

            assert.equal(res.status, 401, res.text);
            assert.equal(res.data.code, 'HERMES_AUTH_REQUIRED');
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

    it('creates an external ready draft without applying it when autoApply is explicitly disabled', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-hermes-menu-photo-external-'));
        const fakePool = createHermesCreateFakePool({
            products: [['dish-ext', productRow('dish-ext', {
                code: 'MENU-EXT',
                name: 'External draft dish',
                icon_url: '/uploads/catalog-images/items/current-external.png'
            })]]
        });

        try {
            await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
                const body = {
                    businessContext: 'event_genix',
                    autoApply: false,
                    imageBase64: Buffer.from('external-png').toString('base64'),
                    prompt: 'Hermes final external prompt',
                    provider: 'hermes',
                    model: 'hermes-image-model',
                    size: '1536x1024',
                    style: 'catalog',
                    source: 'hermes'
                };
                const first = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-ext/external-draft', body, mutationHeaders('menu-photo-external'));
                const retry = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-ext/external-draft', body, mutationHeaders('menu-photo-external'));

                assert.equal(first.status, 200, first.text);
                assert.equal(retry.status, 200, retry.text);
                assert.deepEqual(retry.data, first.data);
                assert.equal(first.data.success, true);
                assert.equal(first.data.product.currentImageUrl, '/uploads/catalog-images/items/current-external.png');
                assert.equal(first.data.product.draft.status, 'ready');
                assert.equal(first.data.product.draft.provider, 'hermes');
                assert.equal(first.data.product.draft.model, 'hermes-image-model');
                assert.match(first.data.product.draft.imageUrl, /^\/uploads\/catalog-images\/items\/menu-menu-ext-\d+\.png$/);
                assert.equal(first.data.meta.idempotencyKey, 'menu-photo-external');
                assert.equal(first.data.meta.status, 'ready');
                assert.equal(first.data.meta.autoApplied, false);
                assert.equal(fakePool.products.get('dish-ext').icon_url, '/uploads/catalog-images/items/current-external.png');
                assert.equal(fakePool.products.get('dish-ext').ai_card_draft.imageStudio.status, 'ready');
                assert.equal(fakePool.products.get('dish-ext').ai_card_draft.imageStudio.prompt, 'Hermes final external prompt');
                assert.equal(fakePool.products.get('dish-ext').ai_card_draft.imageStudio.storage.provider, 'postgres');
                assert.equal(fakePool.products.get('dish-ext').ai_card_draft.imageStudio.storage.bucket, 'catalog_image_blobs');
                assert.equal(fakePool.catalogImageBlobs.size, 1);
                assert.ok(fakePool.calls.some(call => call.compact?.startsWith('INSERT INTO catalog_image_blobs')));
                assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET ai_card_draft =')).length, 1);
                assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET icon_url =')).length, 0);
                assert.equal((await fsp.readdir(tempDir)).length, 1);
            }, {
                menuImageUploadOptions: { localDir: tempDir }
            });
        } finally {
            await fsp.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('auto-applies a Hermes external menu photo draft by default in the same idempotent mutation', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-hermes-menu-photo-auto-apply-'));
        const fakePool = createHermesCreateFakePool({
            products: [['dish-auto-apply', productRow('dish-auto-apply', {
                code: 'MENU-AUTO',
                name: 'Auto applied dish',
                icon_url: '/uploads/catalog-images/items/current-auto.png'
            })]]
        });

        try {
            await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
                const body = {
                    businessContext: 'event_genix',
                    imageBase64: Buffer.from('external-auto-png').toString('base64'),
                    prompt: 'Hermes final auto apply prompt',
                    provider: 'hermes',
                    model: 'hermes-image-model',
                    size: '1536x1024',
                    style: 'catalog',
                    source: 'hermes'
                };
                const first = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-auto-apply/external-draft', body, mutationHeaders('menu-photo-external-auto-apply'));
                const retry = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-auto-apply/external-draft', body, mutationHeaders('menu-photo-external-auto-apply'));

                assert.equal(first.status, 200, first.text);
                assert.equal(retry.status, 200, retry.text);
                assert.deepEqual(retry.data, first.data);
                assert.equal(first.data.success, true);
                assert.equal(first.data.product.draft.status, 'applied');
                assert.equal(first.data.meta.status, 'applied');
                assert.equal(first.data.meta.autoApplied, true);
                assert.match(first.data.product.currentImageUrl, /^\/uploads\/catalog-images\/items\/menu-menu-auto-\d+\.png$/);
                assert.equal(first.data.product.currentImageUrl, first.data.product.draft.imageUrl);
                assert.equal(first.data.product.draft.previousImageUrl, '/uploads/catalog-images/items/current-auto.png');
                assert.equal(fakePool.products.get('dish-auto-apply').icon_url, first.data.product.currentImageUrl);
                assert.equal(fakePool.products.get('dish-auto-apply').ai_card_draft.imageStudio.status, 'applied');
                assert.equal(fakePool.products.get('dish-auto-apply').ai_card_draft.imageStudio.prompt, 'Hermes final auto apply prompt');
                assert.equal(fakePool.catalogImageBlobs.size, 1);
                assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET ai_card_draft =')).length, 0);
                assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET icon_url =')).length, 1);
                assert.equal((await fsp.readdir(tempDir)).length, 1);
            }, {
                menuImageUploadOptions: { localDir: tempDir }
            });
        } finally {
            await fsp.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects conflicting Hermes autoApply aliases without writing a draft', async () => {
        const fakePool = createHermesCreateFakePool({
            products: [['dish-auto-apply-conflict', productRow('dish-auto-apply-conflict')]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-auto-apply-conflict/external-draft', {
                autoApply: true,
                auto_apply: false,
                imageBase64: Buffer.from('external-png').toString('base64'),
                prompt: 'Hermes prompt',
                source: 'hermes'
            }, mutationHeaders('menu-photo-auto-apply-conflict'));

            assert.equal(res.status, 400, res.text);
            assert.equal(res.data.code, 'HERMES_INVALID_MENU_PHOTO_PAYLOAD');
            assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET ai_card_draft =')).length, 0);
            assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET icon_url =')).length, 0);
        });
    });

    it('requires confirmation and idempotency headers on the Hermes external menu photo draft wrapper', async () => {
        const fakePool = createHermesCreateFakePool({
            products: [['dish-ext-guard', productRow('dish-ext-guard')]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const body = {
                imageBase64: Buffer.from('external-png').toString('base64'),
                prompt: 'Hermes prompt',
                source: 'hermes'
            };
            const missingConfirmation = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-ext-guard/external-draft', body, {
                'Idempotency-Key': 'menu-photo-external-missing-confirmation'
            });
            const missingIdempotency = await request(baseUrl, 'POST', '/api/hermes/menu-photos/dish-ext-guard/external-draft', body, {
                'X-Hermes-User-Confirmed': 'true'
            });

            assert.equal(missingConfirmation.status, 400, missingConfirmation.text);
            assert.equal(missingConfirmation.data.code, 'HERMES_CONFIRMATION_REQUIRED');
            assert.equal(missingIdempotency.status, 400, missingIdempotency.text);
            assert.equal(missingIdempotency.data.code, 'IDEMPOTENCY_KEY_REQUIRED');
            assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET ai_card_draft =')).length, 0);
        });
    });

    it('rejects invalid Hermes external menu photo payloads without draft writes or base64 echo', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-hermes-menu-photo-invalid-'));
        const fakePool = createHermesCreateFakePool({
            products: [['dish-ext-invalid', productRow('dish-ext-invalid', {
                icon_url: '/uploads/catalog-images/items/current-invalid.png'
            })]]
        });

        try {
            await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
                const secretBase64 = Buffer.from('secret-image-payload').toString('base64');
                const conflict = await request(
                    baseUrl,
                    'POST',
                    '/api/hermes/menu-photos/dish-ext-invalid/external-draft',
                    {
                        imageUrl: 'https://example.test/image.png',
                        imageBase64: secretBase64,
                        prompt: 'Hermes prompt',
                        source: 'hermes'
                    },
                    mutationHeaders('menu-photo-external-invalid-conflict')
                );
                const invalidUrl = await request(
                    baseUrl,
                    'POST',
                    '/api/hermes/menu-photos/dish-ext-invalid/external-draft',
                    {
                        imageUrl: 'ftp://example.test/image.png',
                        prompt: 'Hermes prompt',
                        source: 'hermes'
                    },
                    mutationHeaders('menu-photo-external-invalid-url')
                );

                assert.equal(conflict.status, 400, conflict.text);
                assert.equal(conflict.data.code, 'menu_image_source_conflict');
                assert.equal(conflict.text.includes(secretBase64), false);
                assert.equal(invalidUrl.status, 400, invalidUrl.text);
                assert.equal(invalidUrl.data.code, 'menu_image_source_invalid');
                assert.equal(fakePool.products.get('dish-ext-invalid').icon_url, '/uploads/catalog-images/items/current-invalid.png');
                assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET ai_card_draft =')).length, 0);
                assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET icon_url =')).length, 0);
                assert.deepEqual(await fsp.readdir(tempDir), []);
            }, {
                menuImageUploadOptions: { localDir: tempDir }
            });
        } finally {
            await fsp.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('rejects Hermes external menu photo drafts in read-only all-business scope', async () => {
        const fakePool = createHermesCreateFakePool({
            products: [['dish-ext-read-only', productRow('dish-ext-read-only')]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(
                baseUrl,
                'POST',
                '/api/hermes/menu-photos/dish-ext-read-only/external-draft?businessScope=all',
                {
                    imageBase64: Buffer.from('external-png').toString('base64'),
                    prompt: 'Hermes prompt',
                    source: 'hermes'
                },
                mutationHeaders('menu-photo-external-read-only')
            );

            assert.equal(res.status, 403, res.text);
            assert.equal(res.data.code, 'business_scope_read_only');
            assert.equal(fakePool.calls.filter(call => call.compact?.startsWith('UPDATE products SET ai_card_draft =')).length, 0);
        });
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

    it('does not trigger legacy notifications when Hermes create is outbox-owned', async () => {
        const fakePool = createHermesCreateFakePool();
        const telegramCalls = [];
        const taskNotificationCalls = [];
        const kleshnyaId = require.resolve('../services/kleshnya');
        const previousKleshnya = require.cache[kleshnyaId] || null;
        delete require.cache[kleshnyaId];
        const restoreTelegram = installMock('../services/telegram', {
            getConfiguredChatId: async () => 'legacy-group-chat',
            getConfiguredThreadId: async () => null,
            telegramRequest: async (method, body) => {
                telegramCalls.push({ method, body });
                return { ok: true };
            },
            sendTelegramMessage: async (chatId, text, options) => {
                telegramCalls.push({ method: 'sendTelegramMessage', body: { chat_id: chatId, text, options } });
                return { ok: true };
            }
        });
        const restoreTaskNotifications = installMock('../services/taskNotifications', {
            emitTaskAssignedToOwner: (...args) => {
                taskNotificationCalls.push(args);
            }
        });

        try {
            await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
                const res = await request(baseUrl, 'POST', '/api/hermes/tasks', {
                    title: 'Outbox-owned route create',
                    ownerUserId: 8,
                    businessContext: 'event_genix'
                }, mutationHeaders('create-outbox-owned-no-legacy'));
                await new Promise(resolve => setImmediate(resolve));

                assert.equal(res.status, 201, res.text);
                assert.equal(fakePool.createdTasks.length, 1);
                assert.equal(fakePool.outbox.length, 1);
                assert.equal(fakePool.outbox[0].event_type, 'task_created');
                assert.equal(telegramCalls.length, 0);
                assert.equal(taskNotificationCalls.length, 0);
            }, {
                skipNotifications: false,
                env: { NODE_ENV: 'production', HERMES_TASK_OUTBOX_ENABLED: 'true' }
            });
        } finally {
            restoreTaskNotifications();
            restoreTelegram();
            if (previousKleshnya) require.cache[kleshnyaId] = previousKleshnya;
            else delete require.cache[kleshnyaId];
        }
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
    it('lists subtasks through a read-only Hermes endpoint', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[730, taskRow(730, {
                status: 'todo',
                workflow_state: 'todo',
                version: 2
            })]],
            subtasks: {
                730: [
                    { id: 9301, title: 'Open part', is_done: false, sort_order: 0 },
                    { id: 9302, title: 'Done part', is_done: true, sort_order: 1, completed_at: '2026-06-27T08:00:00.000Z' }
                ]
            }
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/tasks/730/subtasks?businessContext=event_genix');

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.success, true);
            assert.deepEqual(res.data.subtasks.map(item => item.id), ['9301', '9302']);
            assert.deepEqual(res.data.subtasks.map(item => item.status), ['open', 'done']);
            assert.equal(res.data.parent.subtaskCount, 2);
            assert.equal(res.data.parent.subtaskDoneCount, 1);
            assert.equal(res.data.parent.subtaskOpenCount, 1);
            assert.equal(res.data.parent.canCompleteParent, false);
            assert.equal(res.data.meta.readOnly, true);
            assert.equal(fakePool.records.size, 0);
            assert.equal(JSON.stringify(res.data).includes('control_meta'), false);
        });
    });

    it('toggles a Hermes subtask done and keeps task detail subtasks current', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[730, taskRow(730, {
                status: 'todo',
                workflow_state: 'todo',
                version: 2
            })]],
            subtasks: {
                730: [
                    { id: 9301, title: 'Open part', is_done: false, sort_order: 0 },
                    { id: 9302, title: 'Done part', is_done: true, sort_order: 1, completed_at: '2026-06-27T08:00:00.000Z' }
                ]
            }
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(
                baseUrl,
                'PATCH',
                '/api/hermes/tasks/730/subtasks/9301?businessContext=event_genix',
                { is_done: true },
                mutationHeaders('subtask-toggle-done')
            );
            const detail = await request(baseUrl, 'GET', '/api/hermes/tasks/730?businessContext=event_genix');

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.subtask.id, '9301');
            assert.equal(res.data.subtask.status, 'done');
            assert.equal(res.data.subtask.is_done, true);
            assert.ok(res.data.subtask.completed_at);
            assert.equal(res.data.parent.subtaskDoneCount, 2);
            assert.equal(res.data.parent.subtaskOpenCount, 0);
            assert.equal(res.data.parent.canCompleteParent, true);
            assert.equal(res.data.parent.version, 3);
            assert.equal(res.data.meta.action, 'subtask_toggle');
            assert.equal(fakePool.subtasks.get(730).find(item => item.id === 9301).is_done, true);
            assert.equal(detail.status, 200, detail.text);
            assert.deepEqual(detail.data.task.subtasks.map(item => item.status), ['done', 'done']);
            const serialized = JSON.stringify(res.data);
            assert.equal(serialized.includes('task_id'), false);
            assert.equal(serialized.includes('control_meta'), false);
        });
    });

    it('toggles a Hermes subtask back to open', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[731, taskRow(731, {
                status: 'todo',
                workflow_state: 'todo',
                version: 1
            })]],
            subtasks: {
                731: [
                    { id: 9311, title: 'Done part', is_done: true, sort_order: 0, completed_at: '2026-06-27T08:00:00.000Z' },
                    { id: 9312, title: 'Still done', is_done: true, sort_order: 1, completed_at: '2026-06-27T08:00:00.000Z' }
                ]
            }
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(
                baseUrl,
                'PATCH',
                '/api/hermes/tasks/731/subtasks/9311?businessContext=event_genix',
                { isDone: false },
                mutationHeaders('subtask-toggle-open')
            );

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.subtask.status, 'open');
            assert.equal(res.data.subtask.is_done, false);
            assert.equal(res.data.subtask.completed_at, null);
            assert.equal(res.data.parent.subtaskDoneCount, 1);
            assert.equal(res.data.parent.subtaskOpenCount, 1);
            assert.equal(res.data.parent.canCompleteParent, false);
            assert.equal(fakePool.subtasks.get(731).find(item => item.id === 9311).completed_at, null);
        });
    });

    it('requires confirmation and idempotency headers on the Hermes subtask toggle endpoint', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[732, taskRow(732)]],
            subtasks: {
                732: [{ id: 9321, title: 'Open', is_done: false }]
            }
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const missingConfirmation = await request(
                baseUrl,
                'PATCH',
                '/api/hermes/tasks/732/subtasks/9321?businessContext=event_genix',
                { is_done: true },
                { 'Idempotency-Key': 'subtask-missing-confirmation' }
            );
            const missingIdempotency = await request(
                baseUrl,
                'PATCH',
                '/api/hermes/tasks/732/subtasks/9321?businessContext=event_genix',
                { is_done: true },
                { 'X-Hermes-User-Confirmed': 'true' }
            );

            assert.equal(missingConfirmation.status, 400, missingConfirmation.text);
            assert.equal(missingConfirmation.data.code, 'HERMES_CONFIRMATION_REQUIRED');
            assert.equal(missingIdempotency.status, 400, missingIdempotency.text);
            assert.equal(missingIdempotency.data.code, 'IDEMPOTENCY_KEY_REQUIRED');
            assert.equal(fakePool.subtasks.get(732)[0].is_done, false);
        });
    });

    it('rejects invalid Hermes subtask toggle payloads before mutation', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[732, taskRow(732)]],
            subtasks: {
                732: [{ id: 9321, title: 'Open', is_done: false }]
            }
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const unsupported = await request(
                baseUrl,
                'PATCH',
                '/api/hermes/tasks/732/subtasks/9321?businessContext=event_genix',
                { is_done: true, title: 'Not allowed' },
                mutationHeaders('subtask-unsupported')
            );
            const missing = await request(
                baseUrl,
                'PATCH',
                '/api/hermes/tasks/732/subtasks/9321?businessContext=event_genix',
                {},
                mutationHeaders('subtask-missing-state')
            );

            assert.equal(unsupported.status, 400, unsupported.text);
            assert.equal(unsupported.data.code, 'HERMES_UNSUPPORTED_FIELD');
            assert.equal(missing.status, 400, missing.text);
            assert.equal(missing.data.code, 'HERMES_INVALID_SUBTASK_PAYLOAD');
            assert.equal(fakePool.subtasks.get(732)[0].is_done, false);
        });
    });

    it('does not mutate subtasks for invisible tasks', async () => {
        const fakePool = createHermesCreateFakePool({
            hiddenIds: [733],
            tasks: [[733, taskRow(733)]],
            subtasks: {
                733: [{ id: 9331, title: 'Hidden open', is_done: false }]
            }
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(
                baseUrl,
                'PATCH',
                '/api/hermes/tasks/733/subtasks/9331?businessContext=event_genix',
                { is_done: true },
                mutationHeaders('subtask-hidden')
            );

            assert.equal(res.status, 404, res.text);
            assert.equal(res.data.code, 'TASK_NOT_VISIBLE');
            assert.equal(fakePool.subtasks.get(733)[0].is_done, false);
        });
    });

    it('replays the stored Hermes subtask toggle response on idempotent retry', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[736, taskRow(736, {
                status: 'todo',
                workflow_state: 'todo',
                version: 1
            })]],
            subtasks: {
                736: [{ id: 9361, title: 'Open', is_done: false }]
            }
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const path = '/api/hermes/tasks/736/subtasks/9361?businessContext=event_genix';
            const body = { is_done: true };
            const first = await request(baseUrl, 'PATCH', path, body, mutationHeaders('subtask-toggle-retry'));
            const retry = await request(baseUrl, 'PATCH', path, body, mutationHeaders('subtask-toggle-retry'));

            assert.equal(first.status, 200, first.text);
            assert.equal(retry.status, 200, retry.text);
            assert.deepEqual(retry.data, first.data);
            assert.equal(fakePool.subtasks.get(736)[0].is_done, true);
            assert.equal(fakePool.tasks.get(736).version, 2);
        });
    });

    it('keeps parent completion blocked while Hermes subtasks remain incomplete', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[735, taskRow(735, {
                status: 'todo',
                workflow_state: 'todo',
                version: 1
            })]],
            subtasks: {
                735: [
                    { id: 9351, title: 'First open', is_done: false, sort_order: 0 },
                    { id: 9352, title: 'Second open', is_done: false, sort_order: 1 }
                ]
            }
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const toggle = await request(
                baseUrl,
                'PATCH',
                '/api/hermes/tasks/735/subtasks/9351?businessContext=event_genix',
                { is_done: true },
                mutationHeaders('subtask-one-done')
            );
            const complete = await request(
                baseUrl,
                'POST',
                '/api/hermes/tasks/735/complete',
                {},
                mutationHeaders('complete-still-blocked')
            );

            assert.equal(toggle.status, 200, toggle.text);
            assert.equal(toggle.data.parent.subtaskDoneCount, 1);
            assert.equal(toggle.data.parent.subtaskOpenCount, 1);
            assert.equal(toggle.data.parent.canCompleteParent, false);
            assert.equal(complete.status, 409, complete.text);
            assert.equal(complete.data.code, 'SUBTASKS_INCOMPLETE');
        });
    });

    it('requires Hermes auth on the task comment endpoint', async () => {
        await withHermesCabinetServer(async ({ baseUrl: cabinetBaseUrl }) => {
            const res = await request(cabinetBaseUrl, 'POST', '/api/hermes/tasks/720/comments', {
                text: 'Done from Telegram',
                source: 'telegram_tasker'
            }, mutationHeaders('comment-missing-auth'));

            assert.equal(res.status, 401, res.text);
            assert.equal(res.data.code, 'HERMES_AUTH_REQUIRED');
        });
    });

    it('requires confirmation and idempotency headers on the task comment endpoint', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[720, taskRow(720)]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const missingConfirmation = await request(baseUrl, 'POST', '/api/hermes/tasks/720/comments', {
                text: 'Done'
            }, {
                'Idempotency-Key': 'comment-missing-confirmation'
            });
            const missingIdempotency = await request(baseUrl, 'POST', '/api/hermes/tasks/720/comments', {
                text: 'Done'
            }, {
                'X-Hermes-User-Confirmed': 'true'
            });

            assert.equal(missingConfirmation.status, 400, missingConfirmation.text);
            assert.equal(missingConfirmation.data.code, 'HERMES_CONFIRMATION_REQUIRED');
            assert.equal(missingIdempotency.status, 400, missingIdempotency.text);
            assert.equal(missingIdempotency.data.code, 'IDEMPOTENCY_KEY_REQUIRED');
            assert.equal(fakePool.historyEvents.length, 0);
        });
    });

    it('rejects invalid task comment payloads before writing history', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[720, taskRow(720)]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const unsupported = await request(baseUrl, 'POST', '/api/hermes/tasks/720/comments', {
                text: 'Done',
                rawPayload: 'must not be accepted'
            }, mutationHeaders('comment-unsupported'));
            const emptyText = await request(baseUrl, 'POST', '/api/hermes/tasks/720/comments', {
                text: '   '
            }, mutationHeaders('comment-empty-text'));

            assert.equal(unsupported.status, 400, unsupported.text);
            assert.equal(unsupported.data.code, 'HERMES_UNSUPPORTED_FIELD');
            assert.equal(emptyText.status, 400, emptyText.text);
            assert.equal(emptyText.data.code, 'TASK_COMMENT_TEXT_REQUIRED');
            assert.equal(fakePool.historyEvents.length, 0);
        });
    });

    it('does not create comments for hidden tasks', async () => {
        const fakePool = createHermesCreateFakePool({
            hiddenIds: [723],
            tasks: [[723, taskRow(723)]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/723/comments', {
                text: 'Should not be saved',
                source: 'telegram_tasker',
                businessContext: 'event_genix'
            }, mutationHeaders('comment-hidden'));

            assert.equal(res.status, 404, res.text);
            assert.equal(res.data.code, 'TASK_NOT_VISIBLE');
            assert.equal(fakePool.historyEvents.length, 0);
        });
    });

    it('writes a structured task_action_history comment without leaking raw text in the response', async () => {
        const longSecretText = `Line 1\r\nsecret-token-456\u0000${'x'.repeat(4100)}`;
        const fakePool = createHermesCreateFakePool({
            tasks: [[720, taskRow(720, {
                status: 'todo',
                workflow_state: 'todo'
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/720/comments', {
                text: longSecretText,
                source: 'telegram tasker',
                businessContext: 'event_genix'
            }, mutationHeaders('comment-create'));

            assert.equal(res.status, 201, res.text);
            assert.equal(res.data.success, true);
            assert.equal(res.data.commentId, 12000);
            assert.equal(res.data.logId, 12000);
            assert.equal(res.data.task.id, '720');
            assert.equal(res.data.meta.durableLog, 'task_action_history');
            assert.equal(res.data.meta.actionType, 'task_commented');
            assert.equal(res.data.meta.commentSource, 'telegram_tasker');
            assert.equal(fakePool.historyEvents.length, 1);
            assert.equal(fakePool.historyEvents[0].action_type, 'task_commented');
            assert.equal(fakePool.historyEvents[0].source_surface, 'hermes');
            assert.equal(fakePool.historyEvents[0].new_value_json.comment.text.includes('\u0000'), false);
            assert.equal(fakePool.historyEvents[0].new_value_json.comment.text.length, 4000);
            assert.equal(fakePool.historyEvents[0].meta_json.route, 'hermes_task_comment');
            assert.equal(fakePool.historyEvents[0].meta_json.source, 'telegram_tasker');
            assert.equal(fakePool.historyEvents[0].meta_json.textLength, 4000);
            const serialized = JSON.stringify(res.data);
            assert.equal(serialized.includes('Line 1'), false);
            assert.equal(serialized.includes('secret-token-456'), false);
            assert.equal(serialized.includes('rawPayload'), false);
            assert.equal(serialized.includes('new_value_json'), false);
        });
    });

    it('replays the stored task comment response on idempotent retry', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[721, taskRow(721)]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const body = {
                text: 'Retry-safe comment',
                source: 'telegram_tasker',
                businessContext: 'event_genix'
            };
            const first = await request(baseUrl, 'POST', '/api/hermes/tasks/721/comments', body, mutationHeaders('comment-retry'));
            const retry = await request(baseUrl, 'POST', '/api/hermes/tasks/721/comments', body, mutationHeaders('comment-retry'));

            assert.equal(first.status, 201, first.text);
            assert.equal(retry.status, 201, retry.text);
            assert.deepEqual(retry.data, first.data);
            assert.equal(fakePool.historyEvents.length, 1);
            assert.equal(first.data.commentId, fakePool.historyEvents[0].id);
        });
    });

    it('requires Hermes auth on the completion report endpoint', async () => {
        await withHermesCabinetServer(async ({ baseUrl: cabinetBaseUrl }) => {
            const res = await request(cabinetBaseUrl, 'POST', '/api/hermes/tasks/710/completion-report', {
                reportText: 'Done'
            }, mutationHeaders('completion-report-missing-auth'));

            assert.equal(res.status, 401, res.text);
            assert.equal(res.data.code, 'HERMES_AUTH_REQUIRED');
        });
    });

    it('requires confirmation and idempotency headers on the completion report endpoint', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[710, taskRow(710)]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const missingConfirmation = await request(baseUrl, 'POST', '/api/hermes/tasks/710/completion-report', {
                reportText: 'Done'
            }, {
                'Idempotency-Key': 'completion-report-missing-confirmation'
            });
            const missingIdempotency = await request(baseUrl, 'POST', '/api/hermes/tasks/710/completion-report', {
                reportText: 'Done'
            }, {
                'X-Hermes-User-Confirmed': 'true'
            });

            assert.equal(missingConfirmation.status, 400, missingConfirmation.text);
            assert.equal(missingConfirmation.data.code, 'HERMES_CONFIRMATION_REQUIRED');
            assert.equal(missingIdempotency.status, 400, missingIdempotency.text);
            assert.equal(missingIdempotency.data.code, 'IDEMPOTENCY_KEY_REQUIRED');
            assert.equal(fakePool.reports.length, 0);
        });
    });

    it('rejects invalid completion report payloads before writing reports', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[710, taskRow(710)]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const unsupported = await request(baseUrl, 'POST', '/api/hermes/tasks/710/completion-report', {
                reportText: 'Done',
                rawPayload: 'must not be accepted'
            }, mutationHeaders('completion-report-unsupported'));
            const emptyText = await request(baseUrl, 'POST', '/api/hermes/tasks/710/completion-report', {
                reportText: '   '
            }, mutationHeaders('completion-report-empty-text'));

            assert.equal(unsupported.status, 400, unsupported.text);
            assert.equal(unsupported.data.code, 'HERMES_UNSUPPORTED_FIELD');
            assert.equal(emptyText.status, 400, emptyText.text);
            assert.equal(emptyText.data.code, 'TASK_REPORT_TEXT_REQUIRED');
            assert.equal(fakePool.reports.length, 0);
        });
    });

    it('does not create completion reports for hidden tasks', async () => {
        const fakePool = createHermesCreateFakePool({
            hiddenIds: [713],
            tasks: [[713, taskRow(713)]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/713/completion-report', {
                reportText: 'Should not be saved',
                businessContext: 'event_genix'
            }, mutationHeaders('completion-report-hidden'));

            assert.equal(res.status, 404, res.text);
            assert.equal(res.data.code, 'TASK_NOT_VISIBLE');
            assert.equal(fakePool.reports.length, 0);
        });
    });

    it('creates a durable completion report and links reportId without auto-completing the task', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[710, taskRow(710, {
                status: 'todo',
                workflow_state: 'todo',
                control_meta: { reportRequired: true }
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/710/completion-report', {
                reportText: 'Finished private secret-token-123',
                type: 'expense',
                amount: 0,
                category: '\u0417\u0430\u0434\u0430\u0447\u0430',
                businessContext: 'event_genix'
            }, mutationHeaders('completion-report-create'));

            assert.equal(res.status, 201, res.text);
            assert.equal(res.data.success, true);
            assert.equal(res.data.reportId, 41000);
            assert.equal(res.data.task.id, '710');
            assert.equal(res.data.task.status, 'open');
            assert.equal(res.data.meta.durableReport, 'reports');
            assert.equal(res.data.meta.linkField, 'tasks.control_meta.reportId');
            assert.equal(res.data.meta.autoComplete, false);
            assert.equal(fakePool.reports.length, 1);
            assert.equal(fakePool.reports[0].id, 41000);
            assert.equal(fakePool.reports[0].raw_data.taskCompletionReport.sourceSurface, 'hermes');
            assert.equal(fakePool.reports[0].raw_data.taskCompletionReport.taskId, 710);
            assert.equal(fakePool.tasks.get(710).control_meta.reportId, 41000);
            assert.equal(fakePool.tasks.get(710).status, 'todo');
            const serialized = JSON.stringify(res.data);
            assert.equal(serialized.includes('Finished private'), false);
            assert.equal(serialized.includes('secret-token-123'), false);
            assert.equal(serialized.includes('raw_data'), false);
            assert.equal(serialized.includes('"control_meta":'), false);
        });
    });

    it('replays the stored completion report response on idempotent retry', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[711, taskRow(711, {
                status: 'todo',
                workflow_state: 'todo',
                control_meta: { reportRequired: true }
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const body = {
                reportText: 'Retry-safe report',
                businessContext: 'event_genix'
            };
            const first = await request(baseUrl, 'POST', '/api/hermes/tasks/711/completion-report', body, mutationHeaders('completion-report-retry'));
            const retry = await request(baseUrl, 'POST', '/api/hermes/tasks/711/completion-report', body, mutationHeaders('completion-report-retry'));

            assert.equal(first.status, 201, first.text);
            assert.equal(retry.status, 201, retry.text);
            assert.deepEqual(retry.data, first.data);
            assert.equal(fakePool.reports.length, 1);
            assert.equal(fakePool.tasks.get(711).control_meta.reportId, first.data.reportId);
        });
    });

    it('allows a report-required task to complete with the Hermes-created reportId', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[712, taskRow(712, {
                status: 'todo',
                workflow_state: 'todo',
                control_meta: { reportRequired: true }
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const report = await request(baseUrl, 'POST', '/api/hermes/tasks/712/completion-report', {
                reportText: 'Completion evidence',
                businessContext: 'event_genix'
            }, mutationHeaders('completion-report-before-complete'));
            const complete = await request(baseUrl, 'POST', '/api/hermes/tasks/712/complete', {
                reportId: report.data.reportId
            }, mutationHeaders('complete-with-hermes-report'));

            assert.equal(report.status, 201, report.text);
            assert.equal(complete.status, 200, complete.text);
            assert.equal(complete.data.task.id, '712');
            assert.equal(complete.data.task.status, 'done');
            assert.equal(complete.data.meta.historyEvent.actionType, 'task_completed');
            assert.equal(fakePool.reports.length, 1);
            assert.equal(fakePool.tasks.get(712).control_meta.reportId, report.data.reportId);
        });
    });

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

    it('updates a visible task status through taskExecution with explicit text casts', async () => {
        const fakePool = createHermesCreateFakePool({
            tasks: [[709, taskRow(709, {
                status: 'todo',
                workflow_state: 'todo',
                version: 2
            })]]
        });

        await withHermesCreateServer(fakePool, async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/tasks/709/status', {
                status: 'in_progress'
            }, mutationHeaders('status-success'));

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.task.id, '709');
            assert.equal(res.data.task.status, 'in_progress');
            assert.equal(res.data.meta.historyEvent.actionType, 'task_status_changed');
            assert.equal(res.data.meta.historyEvent.sourceSurface, 'hermes');
            assert.equal(res.data.meta.historyEvent.meta.route, 'hermes_task_status');
            const statusUpdate = fakePool.calls.find(call => call.compact?.startsWith('UPDATE tasks SET status ='));
            assert.ok(statusUpdate, 'status update SQL should be executed');
            assert.match(statusUpdate.compact, /SET status = \$2::text/);
            assert.match(statusUpdate.compact, /CASE WHEN \$2::text = 'in_progress'/);
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
