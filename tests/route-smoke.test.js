const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { apiAuthBoundary } = require('../middleware/apiAuthBoundary');
const pkg = require('../package.json');

const TEST_JWT_SECRET = 'route-smoke-jwt-secret';
const TEST_REPORT_KEY = 'route-smoke-report-key';
const TEST_REPORT_SECRET = 'route-smoke-report-secret';
const TEST_TELEGRAM_SECRET = 'route-smoke-telegram-secret';
const TEST_UNIVERSAL_WEBHOOK_TOKEN = 'route-smoke-universal-webhook-token';

let server;
let baseUrl;
let authToken;
let queries;
let notifiedLeads;

const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    REPORT_BOT_API_KEY: process.env.REPORT_BOT_API_KEY,
    REPORT_WEBHOOK_SECRET: process.env.REPORT_WEBHOOK_SECRET,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    UNIVERSAL_WEBHOOK_TOKEN: process.env.UNIVERSAL_WEBHOOK_TOKEN,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
};

function listen(app) {
    return new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => {
            const { port } = s.address();
            resolve({ server: s, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(s) {
    return new Promise((resolve, reject) => {
        s.close(err => err ? reject(err) : resolve());
    });
}

async function request(method, path, body, headers = {}) {
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
    return { status: res.status, data, text };
}

async function requestMultipart(path, formData, headers = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: formData
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, text };
}

function tokenFor(role = 'creator') {
    return jwt.sign(
        {
            id: role === 'creator' ? 1 : role.length + 10,
            username: role === 'creator' ? 'route-smoke' : `${role}-user`,
            name: role === 'creator' ? 'Route Smoke' : `${role} user`,
            role
        },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

function withAuth(headers = {}, role = 'creator') {
    return { ...headers, Authorization: `Bearer ${role === 'creator' ? authToken : tokenFor(role)}` };
}

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/kleshnya',
        '../services/leadNotifier',
        '../services/report-bot',
        '../services/telegram',
        '../services/chatService',
        '../services/websocket',
        '../services/chat-bot',
        '../services/guardian',
        '../services/linkPreview',
        '../routes/settings',
        '../routes/landing',
        '../routes/leads',
        '../routes/packages',
        '../routes/tasks',
        '../routes/users',
        '../routes/designs',
        '../routes/art-director',
        '../routes/warehouse',
        '../routes/hr',
        '../routes/music',
        '../routes/reports',
        '../routes/dashboard',
        '../routes/analytics',
        '../routes/chat',
        '../routes/report-bot',
        '../routes/telegram',
        '../services/costumeInventory'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function createFakePool() {
    const hrState = {
        staff: new Map([
            [42, {
                id: 42,
                name: 'HR Offboard Normal',
                is_active: true,
                hr_pool_status: 'core',
                blacklist_reason: null,
                notes: ''
            }],
            [43, {
                id: 43,
                name: 'HR Offboard Creator',
                is_active: true,
                hr_pool_status: 'core',
                blacklist_reason: null,
                notes: ''
            }],
            [44, {
                id: 44,
                name: 'HR Offboard Current',
                is_active: true,
                hr_pool_status: 'core',
                blacklist_reason: null,
                notes: ''
            }],
            [45, {
                id: 45,
                name: 'HR Onboarding Newbie',
                is_active: true,
                hr_pool_status: 'core',
                blacklist_reason: null,
                notes: '',
                department: 'Operations',
                position: 'Trainee',
                role_type: 'animator'
            }]
        ]),
        resourcesByStaff: new Map([
            [42, [{
                id: 501,
                resource_kind: 'warehouse_stock',
                title: 'Радіостанція',
                quantity: '1.00',
                issued_at: '2099-05-01',
                due_return_at: '2099-06-01',
                warehouse_stock_name: 'Рація складу',
                costume_name: null,
                total_count: 1
            }]]
        ]),
        accountsByStaff: new Map([
            [42, [{
                id: 77,
                username: 'offboard.employee',
                name: 'Offboard Employee',
                role: 'animator',
                extra_roles: [],
                profile_id: 770,
                full_name: 'Offboard Employee',
                is_active: true,
                profile_active: true
            }]],
            [43, [{
                id: 78,
                username: 'protected.creator',
                name: 'Protected Creator',
                role: 'creator',
                extra_roles: [],
                profile_id: 780,
                full_name: 'Protected Creator',
                is_active: true,
                profile_active: true
            }]],
            [44, [{
                id: 1,
                username: 'route-smoke',
                name: 'Route Smoke',
                role: 'creator',
                extra_roles: [],
                profile_id: 790,
                full_name: 'Route Smoke',
                is_active: true,
                profile_active: true
            }]]
        ]),
        users: new Map([
            [1, { id: 1, username: 'route-smoke', name: 'Route Smoke', role: 'creator', is_active: true }],
            [2, { id: 2, username: 'dasha', name: 'Dasha', role: 'manager', is_active: true }],
            [3, { id: 3, username: 'mentor', name: 'Mentor HR', role: 'hr', is_active: true }]
        ]),
        onboardingTemplates: new Map([
            [11, {
                id: 11,
                name: 'Відповідальний онбординг',
                department: null,
                items: [
                    { key: 'role_intro', title: 'Вступ у роль' },
                    { key: 'access_tools', title: 'Доступи та інструменти' },
                    { key: 'readiness', title: 'Підтвердження готовності' }
                ]
            }]
        ]),
        onboardingProgress: new Map(),
        tasks: [],
        nextOnboardingTemplateId: 12,
        nextOnboardingProgressId: 1001,
        nextTaskId: 880,
        documentAlertsByStaff: new Map([
            [42, [{
                source: 'document',
                id: 301,
                type: 'medical_book',
                title: 'Медкнижка 2026',
                expires_at: '2099-06-02',
                status: 'active',
                total_count: 1
            }]]
        ]),
        nextOffboardingEventId: 900
    };
    const activeTaskStatuses = new Set(['done', 'completed', 'archived', 'cancelled']);
    const ownerRows = () => Array.from(hrState.users.values())
        .filter(user => user.is_active !== false)
        .map(({ id, username, name, role }) => ({ id, username, name, role }));
    const taskRowsForProgress = progressId => hrState.tasks.filter(task =>
        task.source_type === 'onboarding'
        && String(task.source_id || '').startsWith(`${progressId}:`)
    );
    const onboardingRow = progress => {
        const staff = hrState.staff.get(Number(progress.staff_id)) || {};
        const template = hrState.onboardingTemplates.get(Number(progress.template_id)) || {};
        const responsible = hrState.users.get(Number(progress.responsible_user_id)) || {};
        const tasks = taskRowsForProgress(progress.id);
        return {
            ...progress,
            staff_name: staff.name || null,
            department: staff.department || null,
            template_name: template.name || null,
            responsible_name: responsible.name || null,
            responsible_username: responsible.username || null,
            responsible_role: responsible.role || null,
            generated_task_count: tasks.length,
            active_task_count: tasks.filter(task => !activeTaskStatuses.has(task.status || 'todo')).length,
            completed_task_count: tasks.filter(task => ['done', 'completed'].includes(task.status || 'todo')).length
        };
    };

    return {
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
        connect: async function() {
            return {
                query: this.query.bind(this),
                release() {}
            };
        },
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });

            if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (/^SELECT 1\b/i.test(text)) {
                return { rows: [{ ok: 1 }] };
            }
            if (/SELECT COUNT\(\*\)::int as c FROM users/i.test(text)) {
                return { rows: [{ c: 2 }] };
            }
            if (/SELECT is_active, session_revoked_at FROM users WHERE id = \$1/i.test(text)) {
                return { rows: [{ is_active: true, session_revoked_at: null }] };
            }
            if (/SELECT id, username, name FROM users WHERE id = \$1 AND COALESCE\(is_active, true\) = true LIMIT 1/i.test(text)) {
                const user = hrState.users.get(Number(params[0]));
                return { rows: user ? [{ id: user.id, username: user.username, name: user.name }] : [] };
            }
            if (/SELECT id, username, name FROM users WHERE COALESCE\(is_active, true\) = true AND \(LOWER\(username\) = LOWER\(\$1\) OR LOWER\(COALESCE\(name, ''\)\) = LOWER\(\$1\)\)/i.test(text)) {
                const needle = String(params[0] || '').toLowerCase();
                const user = Array.from(hrState.users.values()).find(row =>
                    String(row.username || '').toLowerCase() === needle
                    || String(row.name || '').toLowerCase() === needle
                );
                return { rows: user ? [{ id: user.id, username: user.username, name: user.name }] : [] };
            }
            if (/SELECT id, name, is_active, hr_pool_status, blacklist_reason, notes FROM staff WHERE id = \$1/i.test(text)) {
                const staff = hrState.staff.get(Number(params[0]));
                return { rows: staff ? [staff] : [] };
            }
            if (/SELECT id, name, department, position, role_type, is_active FROM staff WHERE id = \$1/i.test(text)) {
                const staff = hrState.staff.get(Number(params[0]));
                return { rows: staff ? [{
                    id: staff.id,
                    name: staff.name,
                    department: staff.department || 'HR',
                    position: staff.position || 'Animator',
                    role_type: staff.role_type || 'animator',
                    is_active: staff.is_active
                }] : [] };
            }
            if (/SELECT \* FROM onboarding_templates ORDER BY name/i.test(text)) {
                return { rows: Array.from(hrState.onboardingTemplates.values()) };
            }
            if (/SELECT \* FROM onboarding_templates WHERE id = \$1/i.test(text)) {
                const template = hrState.onboardingTemplates.get(Number(params[0]));
                return { rows: template ? [template] : [] };
            }
            if (/SELECT id, name, items FROM onboarding_templates WHERE id = \$1/i.test(text)) {
                const template = hrState.onboardingTemplates.get(Number(params[0]));
                return { rows: template ? [template] : [] };
            }
            if (/SELECT id, name, items FROM onboarding_templates WHERE name = \$1/i.test(text)) {
                const template = Array.from(hrState.onboardingTemplates.values()).find(row => row.name === params[0]);
                return { rows: template ? [template] : [] };
            }
            if (/INSERT INTO onboarding_templates \(name, department, items\)/i.test(text)) {
                const id = hrState.nextOnboardingTemplateId++;
                const template = {
                    id,
                    name: params[0],
                    department: params[1] || null,
                    items: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2]
                };
                hrState.onboardingTemplates.set(id, template);
                return { rows: [template], rowCount: 1 };
            }
            if (/FROM onboarding_progress op LEFT JOIN onboarding_templates ot ON ot\.id = op\.template_id LEFT JOIN users u ON u\.id = op\.responsible_user_id LEFT JOIN tasks t ON t\.source_type = \$2/i.test(text) && /WHERE op\.staff_id = \$1 AND op\.status <> 'completed'/i.test(text)) {
                const progress = Array.from(hrState.onboardingProgress.values())
                    .filter(row => Number(row.staff_id) === Number(params[0]) && row.status !== 'completed')
                    .sort((a, b) => Number(b.id) - Number(a.id))[0];
                return { rows: progress ? [onboardingRow(progress)] : [] };
            }
            if (/INSERT INTO onboarding_progress/i.test(text)) {
                const id = hrState.nextOnboardingProgressId++;
                const hasResponsible = text.includes('responsible_user_id');
                const row = hasResponsible ? {
                    id,
                    staff_id: Number(params[0]),
                    template_id: Number(params[1]),
                    items: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2],
                    total_items: Number(params[3]),
                    completed_items: 0,
                    status: 'in_progress',
                    started_at: '2099-06-06T12:00:00Z',
                    completed_at: null,
                    responsible_user_id: Number(params[4]),
                    assigned_by_user_id: params[5],
                    assigned_by_username: params[6],
                    assigned_at: '2099-06-06T12:00:00Z',
                    reassigned_at: null,
                    training_status: 'not_started',
                    assignment_history: typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7],
                    checklist_template_key: params[8],
                    last_task_sync_at: null
                } : {
                    id,
                    staff_id: Number(params[0]),
                    template_id: Number(params[1]),
                    items: typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2],
                    total_items: Number(params[3]),
                    completed_items: 0,
                    status: 'in_progress',
                    started_at: '2099-06-06T12:00:00Z',
                    completed_at: null,
                    training_status: params[4] || 'not_started',
                    checklist_template_key: params[4] || null,
                    assignment_history: []
                };
                hrState.onboardingProgress.set(id, row);
                return { rows: [row], rowCount: 1 };
            }
            if (/UPDATE onboarding_progress SET responsible_user_id = \$2/i.test(text)) {
                const row = hrState.onboardingProgress.get(Number(params[0]));
                if (!row) return { rows: [], rowCount: 0 };
                Object.assign(row, {
                    responsible_user_id: Number(params[1]),
                    assigned_by_user_id: params[2],
                    assigned_by_username: params[3],
                    reassigned_at: params[4] ? '2099-06-06T12:10:00Z' : row.reassigned_at,
                    training_status: params[5],
                    status: params[6],
                    assignment_history: typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7],
                    checklist_template_key: row.checklist_template_key || params[8],
                    total_items: row.total_items || Number(params[9]),
                    completed_items: Number(params[10])
                });
                return { rows: [row], rowCount: 1 };
            }
            if (/UPDATE onboarding_progress SET last_task_sync_at = NOW\(\) WHERE id = \$1/i.test(text)) {
                const row = hrState.onboardingProgress.get(Number(params[0]));
                if (row) row.last_task_sync_at = '2099-06-06T12:05:00Z';
                return { rows: [], rowCount: row ? 1 : 0 };
            }
            if (/SELECT op\.\*, s\.name AS staff_name, s\.department, ot\.name AS template_name/i.test(text) && /FROM onboarding_progress op JOIN staff s ON s\.id = op\.staff_id/i.test(text)) {
                return { rows: Array.from(hrState.onboardingProgress.values()).map(onboardingRow) };
            }
            if (/SELECT \* FROM tasks WHERE source_type = \$1 AND source_id = \$2/i.test(text)) {
                const row = hrState.tasks.find(task => task.source_type === params[0] && String(task.source_id) === String(params[1]));
                return { rows: row ? [row] : [] };
            }
            if (/SELECT t\.\* FROM tasks t WHERE COALESCE\(t\.status, 'todo'\) NOT IN \('done','archived','cancelled'\)/i.test(text)) {
                return { rows: [] };
            }
            if (/UPDATE tasks SET title = \$2,/i.test(text) && /WHERE id = \$1 RETURNING \*/i.test(text)) {
                const row = hrState.tasks.find(task => Number(task.id) === Number(params[0]));
                if (!row) return { rows: [], rowCount: 0 };
                Object.assign(row, {
                    title: params[1],
                    description: params[2],
                    priority: params[3],
                    assigned_to: params[4],
                    owner: params[4],
                    owner_user_id: params[5],
                    related_entity_id: params[6],
                    checklist_template_key: params[7],
                    updated_at: '2099-06-06T12:10:00Z',
                    version: Number(row.version || 1) + 1
                });
                return { rows: [row], rowCount: 1 };
            }
            if (/FROM staff_resource_assignments sra LEFT JOIN warehouse_stock ws ON ws\.id = sra\.warehouse_stock_id LEFT JOIN costumes c ON c\.id = sra\.costume_id WHERE sra\.staff_id = \$1 AND sra\.status = 'issued'/i.test(text)) {
                return { rows: hrState.resourcesByStaff.get(Number(params[0])) || [] };
            }
            if (/FROM employee_profiles ep JOIN users u ON u\.id = ep\.user_id WHERE ep\.staff_id = \$1/i.test(text)) {
                const rows = (hrState.accountsByStaff.get(Number(params[0])) || [])
                    .filter(row => row.is_active !== false && row.profile_active !== false)
                    .map(row => ({
                        id: row.id,
                        username: row.username,
                        name: row.name,
                        role: row.role,
                        extra_roles: row.extra_roles || [],
                        profile_id: row.profile_id,
                        full_name: row.full_name
                    }));
                return { rows, rowCount: rows.length };
            }
            if (/FROM \( SELECT 'document'::text AS source/i.test(text) && /FROM staff_documents sd/i.test(text) && /FROM staff_certifications sc/i.test(text)) {
                return { rows: hrState.documentAlertsByStaff.get(Number(params[0])) || [] };
            }
            if (/FROM staff_offboarding_events WHERE staff_id = \$1/i.test(text)) {
                return { rows: [] };
            }
            if (/INSERT INTO staff_offboarding_events/i.test(text)) {
                return {
                    rows: [{
                        id: hrState.nextOffboardingEventId++,
                        staff_id: Number(params[0]),
                        status: 'completed',
                        effective_date: params[1],
                        reason: params[2],
                        target_pool_status: params[3],
                        account_action: params[4],
                        open_resource_count: params[5],
                        notes: params[6],
                        created_by: params[7],
                        completed_by: params[7],
                        created_at: '2099-06-06T12:00:00Z',
                        completed_at: '2099-06-06T12:00:00Z'
                    }],
                    rowCount: 1
                };
            }
            if (/UPDATE staff SET is_active = false,/i.test(text) && /termination_recorded_by = \$5 WHERE id = \$1 RETURNING \*/i.test(text)) {
                const id = Number(params[0]);
                const staff = hrState.staff.get(id);
                if (!staff) return { rows: [], rowCount: 0 };
                const updated = {
                    ...staff,
                    is_active: false,
                    hr_pool_status: params[1],
                    blacklist_reason: params[1] === 'blacklisted' ? params[2] : null,
                    termination_date: params[3],
                    termination_reason: params[2],
                    termination_recorded_by: params[4]
                };
                hrState.staff.set(id, updated);
                return { rows: [updated], rowCount: 1 };
            }
            if (/UPDATE users SET is_active = false, session_revoked_at = NOW\(\) WHERE id = ANY\(\$1::int\[\]\) RETURNING id, username, name, role/i.test(text)) {
                const ids = Array.isArray(params[0]) ? params[0].map(Number) : [];
                const rows = [];
                for (const accounts of hrState.accountsByStaff.values()) {
                    for (const account of accounts) {
                        if (ids.includes(Number(account.id)) && account.is_active !== false) {
                            account.is_active = false;
                            rows.push({
                                id: account.id,
                                username: account.username,
                                name: account.name,
                                role: account.role
                            });
                        }
                    }
                }
                return { rows, rowCount: rows.length };
            }
            if (/UPDATE employee_profiles SET is_active = false WHERE staff_id = \$1 AND user_id = ANY\(\$2::int\[\]\)/i.test(text)) {
                const ids = Array.isArray(params[1]) ? params[1].map(Number) : [];
                const accounts = hrState.accountsByStaff.get(Number(params[0])) || [];
                let rowCount = 0;
                for (const account of accounts) {
                    if (ids.includes(Number(account.id)) && account.profile_active !== false) {
                        account.profile_active = false;
                        rowCount += 1;
                    }
                }
                return { rows: [], rowCount };
            }
            if (/UPDATE refresh_tokens SET revoked_at = NOW\(\) WHERE user_id = ANY\(\$1::int\[\]\) AND revoked_at IS NULL/i.test(text)) {
                const ids = Array.isArray(params[0]) ? params[0] : [];
                return { rows: [], rowCount: ids.length };
            }
            if (/INSERT INTO account_security_events/i.test(text)) {
                return { rows: [{ id: 990 }], rowCount: 1 };
            }
            if (/INSERT INTO hr_audit_log/i.test(text)) {
                return { rows: [{ id: 991 }], rowCount: 1 };
            }
            if (/SELECT id FROM leads/i.test(text) && /external_id = \$2/i.test(text)) {
                return { rows: params[1] === 'existing-external' ? [{ id: 777 }] : [] };
            }
            if (/SELECT id FROM leads/i.test(text) && /telegram_id = \$2::bigint/i.test(text)) {
                return { rows: [] };
            }
            if (/SELECT id FROM leads/i.test(text) && /regexp_replace\(COALESCE\(phone/i.test(text)) {
                return { rows: [] };
            }
            if (/INSERT INTO leads/i.test(text) && /source_channel/i.test(text) && /raw_payload/i.test(text)) {
                return {
                    rows: [{
                        id: 601,
                        business_context: params[0] || 'event_genix',
                        client_name: params[1],
                        phone: params[2],
                        telegram_id: params[3],
                        instagram: params[4],
                        source: params[5],
                        source_channel: params[5],
                        external_id: params[6],
                        notes: params[7],
                        raw_payload: JSON.parse(params[8] || '{}'),
                        event_date: params[9],
                        quality_category: params[10],
                        status: 'new',
                        created_at: new Date('2026-05-11T00:00:00Z').toISOString()
                    }]
                };
            }
            if (/INSERT INTO leads/i.test(text)) {
                return {
                    rows: [{
                        id: 501,
                        business_context: params[0] || 'event_genix',
                        client_name: params[1],
                        phone: params[2],
                        source: 'landing',
                        status: 'new',
                        created_at: new Date('2026-05-11T00:00:00Z').toISOString()
                    }]
                };
            }
            if (/SELECT id, username, name, role FROM users WHERE is_active = true AND role = ANY\(\$1::text\[\]\)/i.test(text)) {
                return {
                    rows: ownerRows().filter(user => user.id !== 1)
                };
            }
            if (/SELECT id, username, name, role FROM users WHERE COALESCE\(is_active, true\) = true AND role = ANY\(\$1::text\[\]\)/i.test(text)) {
                return {
                    rows: ownerRows().filter(user => user.id !== 1)
                };
            }
            if (/SELECT id, username, name, role FROM users WHERE users\.id = \$1 AND COALESCE\(is_active, true\) = true AND role = ANY\(\$2::text\[\]\)/i.test(text)) {
                const user = hrState.users.get(Number(params[0]));
                return { rows: user ? [{ id: user.id, username: user.username, name: user.name, role: user.role }] : [] };
            }
            if (/FROM task_action_history/i.test(text)) {
                return { rows: [{
                    id: 41,
                    task_id: params[0],
                    action_type: 'task_completed',
                    actor_user_id: 1,
                    actor_name_snapshot: 'Route Smoke',
                    source_surface: 'task_page',
                    old_value_json: { status: 'todo' },
                    new_value_json: { status: 'done' },
                    meta_json: { route: 'tasks_task_complete' },
                    summary: 'Task completed',
                    created_at: '2099-05-02T12:00:00Z'
                }] };
            }
            if (/INSERT INTO task_action_history/i.test(text)) {
                return { rows: [{
                    id: 42,
                    task_id: params[0],
                    action_type: params[1],
                    actor_user_id: params[2],
                    actor_name_snapshot: params[3],
                    source_surface: params[4],
                    old_value_json: params[5] ? JSON.parse(params[5]) : null,
                    new_value_json: params[6] ? JSON.parse(params[6]) : null,
                    meta_json: params[7] ? JSON.parse(params[7]) : null,
                    summary: params[8],
                    created_at: '2099-05-02T12:05:00Z'
                }] };
            }
            if (/FROM tasks t LEFT JOIN users u ON u\.id = t\.owner_user_id WHERE t\.id = \$1/i.test(text)) {
                if (String(params[0]) === '99') {
                    return { rows: [{
                        id: params[0],
                        title: 'Report required task',
                        status: 'todo',
                        priority: 'high',
                        owner_user_id: 1,
                        assigned_to: 'Route Smoke',
                        owner_name: 'Route Smoke',
                        owner_username: 'route-smoke',
                        version: 1,
                        control_meta: { reportRequired: true },
                        active: true,
                        created_at: '2099-05-01T10:00:00Z'
                    }] };
                }
                return { rows: [{
                    id: params[0],
                    title: 'Route smoke task',
                    status: 'todo',
                    priority: 'high',
                    deadline: '2099-05-02T12:00:00Z',
                    owner_user_id: 1,
                    assigned_to: 'Route Smoke',
                    owner: null,
                    owner_name: 'Route Smoke',
                    owner_username: 'route-smoke',
                    version: 1,
                    active: true,
                    created_at: '2099-05-01T10:00:00Z'
                }] };
            }
            if (/SELECT id FROM reports WHERE id = \$1 LIMIT 1/i.test(text)) {
                return { rows: Number(params[0]) === 701 ? [{ id: 701 }] : [] };
            }
            if (/FROM task_subtasks/i.test(text) && /WHERE task_id = \$1/i.test(text)) {
                return { rows: [{ total: 0, done: 0 }] };
            }
            if (/SELECT t\.id FROM tasks t WHERE t\.id = \$1/i.test(text)) {
                return { rows: [{ id: params[0] }] };
            }
            if (/UPDATE tasks/i.test(text) && /SET status = 'done'/i.test(text) && /RETURNING \*/i.test(text)) {
                return { rows: [{
                    id: params[0],
                    title: 'Route smoke task',
                    status: 'done',
                    priority: 'high',
                    deadline: '2099-05-02T12:00:00Z',
                    owner_user_id: 1,
                    assigned_to: 'Route Smoke',
                    completed_at: '2099-05-02T12:05:00Z'
                }] };
            }
            if (/FROM leads l LEFT JOIN users u ON l\.assigned_to = u\.id LEFT JOIN products p ON l\.program_id = p\.id WHERE l\.id = \$1(?: AND COALESCE\(l\.business_context, 'event_genix'\) = \$2)? LIMIT 1/i.test(text)) {
                return {
                    rows: [{
                        id: params[0],
                        client_name: 'Workspace Lead',
                        phone: '+380000000001',
                        instagram: 'workspace_lead',
                        source: 'instagram',
                        source_channel: 'instagram',
                        notes: 'Needs follow-up',
                        status: 'contact',
                        pipeline_stage: 'contacted',
                        assigned_to: 2,
                        assigned_name: 'Dasha Manager',
                        lead_type: 'quality',
                        quality_category: 'birthday',
                        event_date: '2099-05-12',
                        children_count: 12,
                        program_name: 'Quest',
                        booking_id: null,
                        created_at: '2099-05-01T10:00:00Z',
                        updated_at: '2099-05-01T10:00:00Z',
                        last_contact_at: '2099-05-02T10:00:00Z'
                    }]
                };
            }
            if (/FROM customer_cards WHERE lead_id = \$1(?: AND COALESCE\(business_context, 'event_genix'\) = \$2)? LIMIT 1/i.test(text)) {
                return { rows: [{ lead_id: params[0], event_type: 'birthday', event_date: '2099-05-12', guest_count: 20, notes: 'Card note' }] };
            }
            if (/FROM customers c LEFT JOIN \( SELECT (?:b\.)?customer_id,/i.test(text)) {
                return {
                    rows: [{
                        id: 701,
                        name: 'Workspace Customer',
                        phone: '+380000000001',
                        instagram: 'workspace_lead',
                        child_name: 'Mia',
                        source: 'lead',
                        notes: 'Customer note',
                        real_total_bookings: 1,
                        real_total_spent: 2500,
                        real_last_visit: '2099-05-12',
                        created_at: '2099-05-01T10:00:00Z',
                        updated_at: '2099-05-01T10:00:00Z'
                    }]
                };
            }
            if (/FROM bookings b WHERE \(b\.customer_id = \$1\)(?: AND COALESCE\(b\.business_context, 'event_genix'\) = \$2)? AND NULLIF\(b\.linked_to, ''\) IS NULL/i.test(text)) {
                return {
                    rows: [{
                        id: 'BK-WS',
                        date: '2099-05-12',
                        time: '14:00',
                        status: 'confirmed',
                        program_name: 'Quest',
                        category: 'quest',
                        price: 2500,
                        room: 'Room 1',
                        kids_count: 12,
                        customer_id: 701,
                        notes: 'Booking note'
                    }]
                };
            }
            if (/FROM tasks t/i.test(text) && /t\.source_type = 'lead' AND t\.source_id = \$1/i.test(text)) {
                return {
                    rows: [{
                        id: 801,
                        title: 'Call Workspace Customer',
                        description: 'Follow-up for Workspace Lead',
                        status: 'todo',
                        priority: 'high',
                        assigned_to: 'Dasha Manager',
                        owner: 'Dasha Manager',
                        deadline: '2099-05-10T12:00:00Z',
                        category: 'admin',
                        task_type: 'human',
                        source_type: 'lead',
                        source_id: '501',
                        created_at: '2099-05-01T10:00:00Z'
                    }]
                };
            }
            if (/FROM lead_interactions li LEFT JOIN users u ON li\.user_id = u\.id WHERE li\.lead_id = \$1/i.test(text)) {
                return { rows: [{ id: 901, lead_id: params[0], type: 'call', summary: 'Called client', details: 'Asked for date', manager_name: 'Dasha Manager', created_at: '2099-05-02T10:00:00Z' }] };
            }
            if (/FROM communication_log cl LEFT JOIN users u ON cl\.created_by = u\.id WHERE cl\.customer_id = \$1/i.test(text)) {
                return { rows: [{ id: 902, customer_id: params[0], type: 'note', direction: 'internal', summary: 'Customer prefers Telegram', created_by_name: 'Dasha Manager', created_at: '2099-05-02T11:00:00Z' }] };
            }
            if (/FROM conversations c .*LEFT JOIN LATERAL/i.test(text)) {
                return {
                    rows: [{
                        id: 903,
                        channel: 'telegram',
                        customer_name: 'Workspace Customer',
                        customer_phone: '+380000000001',
                        customer_id: 701,
                        status: 'open',
                        assigned_to: 'Dasha Manager',
                        unread_count: 1,
                        last_message_at: '2099-05-02T12:00:00Z',
                        last_inbound_at: '2099-05-01T12:00:00Z',
                        last_outbound_at: '2099-05-02T12:00:00Z',
                        reply_expected: true,
                        awaiting_reply_since: '2099-05-02T12:00:00Z',
                        reply_expected_message_id: 1203,
                        reply_owner: 'Dasha Manager',
                        reply_owner_user_id: 2,
                        reply_sla_at: '2099-05-03T12:00:00Z',
                        reply_expected_delivery_status: 'accepted',
                        last_message: 'Hello'
                    }]
                };
            }
            if (/INSERT INTO tasks \((?:business_context, )?title, description, date, priority, assigned_to, owner, owner_user_id, created_by,/i.test(text)) {
                const offset = /^INSERT INTO tasks \(business_context,/i.test(text.trim()) ? 1 : 0;
                const task = {
                    id: hrState.nextTaskId++,
                    business_context: offset ? params[0] : 'event_genix',
                    title: params[offset + 0],
                    description: params[offset + 1],
                    date: params[offset + 2],
                    priority: params[offset + 3],
                    assigned_to: params[offset + 4],
                    owner: params[offset + 5],
                    owner_user_id: params[offset + 6],
                    created_by: params[offset + 7],
                    task_type: params[offset + 8],
                    deadline: params[offset + 9],
                    source_type: params[offset + 14],
                    source_id: params[offset + 15],
                    category: params[offset + 16],
                    checklist_template_key: params[offset + 18] || null,
                    related_entity_type: params[offset + 39] || null,
                    related_entity_id: params[offset + 40] || null,
                    source_module: params[offset + 41] || null,
                    control_meta: params[offset + 43] ? JSON.parse(params[offset + 43]) : {},
                    created_by_user_id: params[offset + 44] || null,
                    status: 'todo',
                    workflow_state: params[offset + 32] || 'todo',
                    version: 1,
                    created_at: '2099-06-06T12:00:00Z'
                };
                hrState.tasks.push(task);
                return {
                    rows: [task]
                };
            }
            if (/INSERT INTO task_logs \(task_id, action, old_value, new_value, actor\)/i.test(text)) {
                return { rows: [], rowCount: 1 };
            }
            if (/SELECT id FROM users WHERE id = \$1 AND is_active = true AND role = ANY\(\$2::text\[\]\)/i.test(text)) {
                return { rows: params[0] === 2 ? [{ id: 2 }] : [] };
            }
            if (/UPDATE leads SET .* WHERE id = \$\d+(?: AND COALESCE\(business_context, 'event_genix'\) = \$\d+)? RETURNING \*/i.test(text)) {
                return {
                    rows: [{
                        id: params[params.length - 2] || params[params.length - 1],
                        client_name: 'Lead Smoke',
                        assigned_to: params[0] ?? null,
                        status: 'new'
                    }]
                };
            }
            if (/SELECT \* FROM packages WHERE is_active = true/i.test(text)) {
                return {
                    rows: [
                        { id: 1, code: 'demo', name: 'Demo', is_active: true, sort_order: 1 }
                    ]
                };
            }
            if (/SELECT tag, COUNT\(\*\) as count FROM design_tags GROUP BY tag ORDER BY count DESC, tag ASC/i.test(text)) {
                return { rows: [] };
            }
            if (/FROM costumes c LEFT JOIN staff s ON s\.id = c\.assigned_to ORDER BY c\.name/i.test(text)) {
                return {
                    rows: [{
                        id: 301,
                        name: 'Пірат Джек',
                        category: 'піратський',
                        size: 'M',
                        condition: 'good',
                        assigned_to: null,
                        assigned_name: null,
                        notes: null
                    }]
                };
            }
            if (/INSERT INTO costumes \(name, category, size, condition, assigned_to, assigned_at, notes\)/i.test(text)) {
                return {
                    rows: [{
                        id: 302,
                        name: params[0],
                        category: params[1],
                        size: params[2],
                        condition: params[3],
                        assigned_to: params[4],
                        assigned_at: params[5],
                        notes: params[6]
                    }]
                };
            }
            if (/SELECT \* FROM job_applications WHERE vacancy_id=\$1 ORDER BY created_at DESC/i.test(text)) {
                return {
                    rows: [{
                        id: 701,
                        vacancy_id: Number(params[0]),
                        name: 'РђРЅРЅР° РљР°РЅРґРёРґР°С‚',
                        phone: '+380501112233',
                        telegram_username: 'anna_hr',
                        status: 'new',
                        raw_application_text: 'РџР°СЃС‚РµРґ CV',
                        experience: 'РђРЅС–РјР°С†С–СЏ',
                        interview_notes: 'Р”РѕРґР°С‚Рё С‚РµСЃС‚'
                    }]
                };
            }
            if (/FROM job_application_resume_files WHERE application_id = ANY\(\$1::int\[\]\)/i.test(text)) {
                return {
                    rows: [{
                        id: 801,
                        application_id: 701,
                        original_name: 'anna-resume.txt',
                        mime_type: 'text/plain',
                        file_ext: '.txt',
                        file_size: 42,
                        extracted_text: 'РўРµРєСЃС‚ СЂРµР·СЋРјРµ',
                        extraction_status: 'extracted',
                        extraction_note: 'РўРµРєСЃС‚ С–РјРїРѕСЂС‚РѕРІР°РЅРѕ',
                        uploaded_by: 'route-smoke',
                        created_at: '2099-05-02T12:00:00Z'
                    }]
                };
            }
            if (/INSERT INTO job_applications/i.test(text)) {
                return {
                    rows: [{
                        id: 702,
                        vacancy_id: params[0],
                        name: params[1],
                        phone: params[2],
                        telegram_username: params[3],
                        source: params[5],
                        status: 'new',
                        raw_application_text: params[15]
                    }]
                };
            }
            if (/SELECT id, raw_application_text, cv_url FROM job_applications WHERE id=\$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: params[0], raw_application_text: null, cv_url: null }] };
            }
            if (/SELECT id FROM job_applications WHERE id=\$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: params[0] }] };
            }
            if (/INSERT INTO job_application_resume_files/i.test(text)) {
                return {
                    rows: [{
                        id: 802,
                        application_id: params[0],
                        original_name: params[1],
                        mime_type: params[2],
                        file_ext: params[3],
                        file_size: params[4],
                        extracted_text: params[6],
                        extraction_status: params[7],
                        extraction_note: params[8],
                        uploaded_by: params[9],
                        created_at: '2099-05-02T12:05:00Z'
                    }]
                };
            }
            if (/UPDATE job_applications SET raw_application_text = CASE/i.test(text)) {
                return { rows: [], rowCount: 1 };
            }
            if (/FROM job_application_resume_files WHERE id=\$1 AND application_id=\$2/i.test(text)) {
                return {
                    rows: [{
                        id: params[0],
                        application_id: params[1],
                        original_name: 'anna-resume.txt',
                        mime_type: 'text/plain',
                        file_size: 18,
                        file_data: Buffer.from('resume text content', 'utf8')
                    }]
                };
            }
            if (/SELECT value FROM settings WHERE key = 'hr_company_structure'/i.test(text)) {
                return {
                    rows: [{
                        value: JSON.stringify({
                            schemaVersion: 1,
                            structure: 'Saved structure notes',
                            instructions: 'Saved HR instructions',
                            nodes: [
                                {
                                    id: 'director',
                                    title: 'Директор',
                                    description: 'Root node',
                                    tone: 'gold',
                                    lane: 'root',
                                    parentId: null,
                                    order: 1,
                                    meta: 'center'
                                }
                            ],
                            updatedAt: '2099-05-02T12:00:00Z'
                        })
                    }]
                };
            }
            if (/SELECT value FROM settings WHERE key = 'telegram_chat_id'/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (/INSERT INTO settings \(key, value\) VALUES \('hr_company_structure', \$1\)/i.test(text)) {
                return { rows: [], rowCount: 1 };
            }
            if (/UPDATE staff SET company_structure_node_id = NULL/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (/UPDATE hr_professions SET structure_node_id = NULL, updated_at = NOW\(\)/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (/INSERT INTO hr_audit_log \(action, staff_id, performed_by, details, ip_address\)/i.test(text)) {
                return { rows: [], rowCount: 1 };
            }
            if (/FROM announcements/i.test(text) && /total_plays/i.test(text)) {
                return { rows: [{ active: 0, draft: 0, scheduled: 0, total_plays: 0 }] };
            }
            if (/FROM playlists/i.test(text) && /COUNT\(\*\)::int AS total/i.test(text)) {
                return { rows: [{ active: 0, total: 0 }] };
            }
            if (/FROM music_log WHERE action='play' AND created_at>CURRENT_DATE/i.test(text)) {
                return { rows: [{ plays_today: 0 }] };
            }
            if (/SELECT \* FROM accountants ORDER BY is_on_duty DESC, name/i.test(text)) {
                return { rows: [] };
            }
            if (/FROM bookings b LEFT JOIN products p ON p\.id = NULLIF\(b\.program_id, ''\)/i.test(text) && /GROUP BY 1, 2, 3, 4, 5/i.test(text)) {
                return {
                    rows: [
                        {
                            program_key: 'pinata_1',
                            program_id: 'pinata_1',
                            code: 'PIN',
                            name: 'Піньята',
                            category: 'pinata',
                            count: 1,
                            revenue: 1500,
                            paid_amount: 1500,
                            unpaid_amount: 0,
                            avg_price: 1500
                        },
                        {
                            program_key: 'quest_1',
                            program_id: 'quest_1',
                            code: 'Q1',
                            name: 'Квест',
                            category: 'quest',
                            count: 1,
                            revenue: 2200,
                            paid_amount: 1200,
                            unpaid_amount: 1000,
                            avg_price: 2200
                        }
                    ]
                };
            }
            if (/SELECT b\.id, b\.date, b\.time/i.test(text) && /FROM bookings b LEFT JOIN products p ON p\.id = NULLIF\(b\.program_id, ''\)/i.test(text)) {
                return {
                    rows: [
                        {
                            id: 'B1',
                            date: '2099-05-02',
                            time: '12:00',
                            program_key: 'pinata_1',
                            program_id: 'pinata_1',
                            code: 'PIN',
                            name: 'Піньята',
                            category: 'pinata',
                            group_name: 'Свято',
                            customer_name: 'Олена',
                            customer_phone: '+380000000001',
                            room: 'Зал 1',
                            kids_count: 10,
                            price: 1500,
                            paid_amount: 1500,
                            unpaid_amount: 0,
                            payment_status: 'paid',
                            payment_method: 'cash',
                            created_by: 'manager'
                        },
                        {
                            id: 'B2',
                            date: '2099-05-03',
                            time: '14:00',
                            program_key: 'quest_1',
                            program_id: 'quest_1',
                            code: 'Q1',
                            name: 'Квест',
                            category: 'quest',
                            group_name: '',
                            customer_name: 'Ірина',
                            customer_phone: '+380000000002',
                            room: 'Зал 2',
                            kids_count: 8,
                            price: 2200,
                            paid_amount: 1200,
                            unpaid_amount: 1000,
                            payment_status: 'partial',
                            payment_method: 'card',
                            created_by: 'manager'
                        }
                    ]
                };
            }
            if (/FROM bookings(?: b)? WHERE (?:b\.)?date::date >= \$1::date AND (?:b\.)?date::date <= \$2::date/i.test(text)) {
                return {
                    rows: [{
                        revenue: 0,
                        total: 0,
                        confirmed: 0,
                        preliminary: 0,
                        avg_check: 0
                    }]
                };
            }
            if (/FROM finance_transactions WHERE date::date >= \$1::date AND date::date <= \$2::date/i.test(text)) {
                return {
                    rows: [{
                        income: 0,
                        expense: 0,
                        income_count: 0,
                        expense_count: 0
                    }]
                };
            }
            if (/FROM customers WHERE created_at::date >= \$1::date AND created_at::date <= \$2::date/i.test(text)) {
                return { rows: [{ new_customers: 0 }] };
            }
            if (/FROM hr_time_records WHERE record_date >= \$1 AND record_date <= \$2/i.test(text)) {
                return { rows: [{ total_minutes: 0, active_staff: 0 }] };
            }
            if (/SELECT COALESCE\(SUM\((?:b\.)?price\), 0\) as total FROM bookings(?: b)? WHERE (?:b\.)?date = \$1 AND (?:b\.)?status = 'confirmed'/i.test(text)) {
                return { rows: [{ total: 0 }] };
            }
            if (/SELECT COALESCE\(SUM\(amount\), 0\) as total FROM finance_transactions WHERE date = \$1 AND type = 'expense'/i.test(text)) {
                return { rows: [{ total: 0 }] };
            }
            if (/SELECT COUNT\(\*\) as count FROM bookings(?: b)? WHERE (?:b\.)?date = \$1 AND (?:b\.)?status != 'cancelled'/i.test(text)) {
                return { rows: [{ count: 0 }] };
            }
            if (/FROM tasks t\s+WHERE COALESCE\(t\.status, 'todo'\) NOT IN \('done','archived','cancelled'\)\s+AND lower\(regexp_replace/i.test(text)) {
                return { rows: [] };
            }

            throw new Error(`Unexpected route-smoke DB query: ${text}`);
        }
    };
}

describe('route-level API safety smoke', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        process.env.REPORT_BOT_API_KEY = TEST_REPORT_KEY;
        process.env.REPORT_WEBHOOK_SECRET = TEST_REPORT_SECRET;
        process.env.WEBHOOK_SECRET = TEST_TELEGRAM_SECRET;
        process.env.UNIVERSAL_WEBHOOK_TOKEN = TEST_UNIVERSAL_WEBHOOK_TOKEN;
        delete process.env.TELEGRAM_BOT_TOKEN;

        clearModules();
        queries = [];
        notifiedLeads = [];

        const fakePool = createFakePool();
        installMock('../db', { pool: fakePool, query: fakePool.query.bind(fakePool) });
        installMock('../services/leadNotifier', {
            notifyNewLead: async lead => { notifiedLeads.push(lead); }
        });
        installMock('../services/chatService', {
            ensureDefaultMemberships: async () => {},
            getChannels: async () => [{ id: 1, name: 'General', unread: 0 }]
        });
        installMock('../services/websocket', {
            broadcastToChannel: () => {},
            sendToUser: () => {}
        });
        installMock('../services/chat-bot', { processMessage: async () => null });
        installMock('../services/guardian', {});
        installMock('../services/linkPreview', {});

        const { authenticateToken } = require('../middleware/auth');
        authToken = tokenFor('creator');

        const app = express();
        app.use(express.json());
        app.use('/api', apiAuthBoundary(authenticateToken));
        app.use('/api/landing', require('../routes/landing'));
        app.use('/api/leads', require('../routes/leads'));
        app.use('/api/packages', require('../routes/packages'));
        app.use('/api/tasks', require('../routes/tasks'));
        app.use('/api/users', require('../routes/users'));
        app.use('/api/designs', require('../routes/designs'));
        app.use('/api/art-director', require('../routes/art-director'));
        app.use('/api/warehouse', require('../routes/warehouse'));
        app.use('/api/hr', require('../routes/hr'));
        app.use('/api/music', require('../routes/music'));
        app.use('/api/reports', require('../routes/reports'));
        app.use('/api/dashboard', require('../routes/dashboard'));
        app.use('/api/analytics', require('../routes/analytics'));
        app.use('/api/chat-real', require('../routes/chat'));
        app.use('/api/report-bot', require('../routes/report-bot'));
        app.use('/api/telegram', require('../routes/telegram'));

        // Boundary-only chat smoke: the full chat router is DB/WebSocket heavy and
        // remains outside the fast baseline.
        app.get('/api/chat/channels', (req, res) => res.json({ ok: true, user: req.user.username }));

        // Match server.js ordering: generic /api settings routes come after
        // mounted feature routers so their auth wall does not catch public
        // feature endpoints first.
        app.use('/api', require('../routes/settings'));

        ({ server, baseUrl } = await listen(app));
    });

    beforeEach(() => {
        queries.length = 0;
        notifiedLeads.length = 0;
    });

    after(async () => {
        if (server) await close(server);
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        clearModules();
    });

    it('keeps version and health public through the actual settings router', async () => {
        const version = await request('GET', '/api/version');
        assert.equal(version.status, 200, JSON.stringify(version.data));
        assert.equal(version.data.success, true);
        assert.equal(version.data.version, pkg.version);
        assert.equal(version.data.releaseLabel, pkg.eventGenix.releaseLabel);
        assert.equal(version.data.name, 'Event Genix');

        const health = await request('GET', '/api/health');
        assert.equal(health.status, 200, JSON.stringify(health.data));
        assert.equal(health.data.version, pkg.version);
        assert.equal(health.data.releaseLabel, pkg.eventGenix.releaseLabel);
        assert.equal(health.data.status, 'ok');
        assert.equal(health.data.database, 'connected');
    });

    it('keeps public landing demo validation available without JWT', async () => {
        const invalid = await request('POST', '/api/landing/demo-request', { name: 'Only Name' });
        assert.equal(invalid.status, 400);

        const valid = await request('POST', '/api/landing/demo-request', {
            name: 'Landing Smoke',
            contact: '@route_smoke',
            package: 'demo'
        });
        assert.equal(valid.status, 200, JSON.stringify(valid.data));
        assert.equal(valid.data.ok, true);
    });

    it('keeps the active leads landing route public and persists the lead shape', async () => {
        const res = await request('POST', '/api/leads/landing', {
            name: 'Lead Smoke',
            phone: '+380000000001',
            package: 'demo'
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.lead.id, 501);
        assert.equal(notifiedLeads.length, 1);
        assert.ok(queries.some(q => /INSERT INTO leads/i.test(q.text)));
    });

    it('accepts Maysternya Doli bot leads through the token-guarded universal webhook', async () => {
        const res = await request('POST', '/api/leads/webhook/universal?source=maysternya_bot', {
            external_id: '123456789',
            name: 'Марія Тест',
            phone: '+380501112233',
            telegram_id: '123456789',
            telegram_username: 'maria_test',
            whatsapp: '+380501112233',
            contact_channels: ['telegram', 'whatsapp'],
            request_topic: 'Натальна карта',
            session_type: 'повна сесія',
            booking_date: '2026-05-30',
            booking_time: '14:00',
            message: 'Хоче консультацію після оплати'
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`,
            'X-Business-Context': 'maysternya_doli'
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.created, true);
        assert.equal(res.data.lead.id, 601);
        assert.equal(notifiedLeads.length, 1);

        const insert = queries.find(q => /INSERT INTO leads/i.test(q.text) && /source_channel/i.test(q.text));
        assert.ok(insert);
        assert.equal(insert.params[0], 'maysternya_doli');
        assert.equal(insert.params[3], '123456789');
        assert.equal(insert.params[5], 'maysternya_bot');
        assert.equal(insert.params[6], '123456789');
        assert.match(insert.params[7], /Тип сесії: повна сесія/);
        assert.match(insert.params[7], /Запис: 2026-05-30 14:00/);
    });

    it('rejects the universal lead webhook without the shared webhook token', async () => {
        const res = await request('POST', '/api/leads/webhook/universal?source=maysternya_bot', {
            external_id: 'missing-token',
            name: 'No Token'
        });

        assert.equal(res.status, 401);
    });

    it('upserts Maysternya Doli bot leads by external_id without mixing business contexts', async () => {
        const res = await request('POST', '/api/leads/webhook/universal?source=maysternya_bot', {
            external_id: 'existing-external',
            name: 'Existing MD Lead',
            phone: '+380501112244',
            telegram_id: '123456780',
            request_topic: 'Updated topic',
            session_type: 'znaiomstvo',
            booking_date: '2026-05-31',
            booking_time: '12:00',
            message: 'Updated comment'
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`,
            'X-Business-Context': 'event_genix'
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.created, false);
        assert.equal(res.data.updated, true);
        assert.equal(notifiedLeads.length, 0);

        const lookup = queries.find(q => /SELECT id FROM leads/i.test(q.text) && /external_id = \$2/i.test(q.text));
        assert.ok(lookup);
        assert.equal(lookup.params[0], 'maysternya_doli');
        assert.equal(lookup.params[1], 'existing-external');

        const update = queries.find(q => /UPDATE leads/i.test(q.text) && /raw_payload/i.test(q.text));
        assert.ok(update);
        assert.equal(update.params[11], 777);
        assert.equal(update.params[12], 'maysternya_doli');
        assert.match(update.params[9], /Updated topic/);
    });

    it('keeps public package reads open but protects package mutations', async () => {
        const list = await request('GET', '/api/packages');
        assert.equal(list.status, 200, JSON.stringify(list.data));
        assert.equal(list.data.success, true);
        assert.equal(list.data.packages[0].code, 'demo');

        const noAuthPost = await request('POST', '/api/packages', { code: 'x', name: 'X' });
        assert.equal(noAuthPost.status, 401);

        const queryTokenPost = await request('POST', `/api/packages?token=${authToken}`, { code: 'x', name: 'X' });
        assert.equal(queryTokenPost.status, 401);
    });

    it('keeps protected task/user route smoke behind bearer auth', async () => {
        const blocked = await request('GET', '/api/tasks/permissions');
        assert.equal(blocked.status, 401);

        const taskPerms = await request('GET', '/api/tasks/permissions', undefined, withAuth());
        assert.equal(taskPerms.status, 200, JSON.stringify(taskPerms.data));
        assert.equal(taskPerms.data.success, true);
        assert.equal(taskPerms.data.role, 'creator');
        assert.equal(taskPerms.data.permissions.canCreateTasks, true);

        const roles = await request('GET', '/api/users/roles', undefined, withAuth());
        assert.equal(roles.status, 200, JSON.stringify(roles.data));
        assert.ok(roles.data.hierarchy.includes('creator'));
        assert.ok(roles.data.hierarchy.includes('security'));
        assert.ok(roles.data.pageAccess['/dashboard']);
        assert.deepEqual(roles.data.pageAccess['/sales-funnel'], roles.data.pageAccess['/leads']);
        assert.ok(roles.data.pageAccess['/staff'].includes('security'));
        assert.ok(!roles.data.pageAccess['/tasks'].includes('waiter'));
        assert.ok(roles.data.actionPermissions.create_booking);
    });

    it('keeps HR offboarding readiness connected to resources, accounts, and document alerts', async () => {
        const res = await request('GET', '/api/hr/staff/42/offboarding-readiness', undefined, withAuth());
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.data.open_resource_count, 1);
        assert.equal(res.data.data.active_account_count, 1);
        assert.equal(res.data.data.document_alert_count, 1);
        assert.equal(res.data.data.disable_available, true);
        assert.equal(res.data.data.open_resources[0].title, 'Рація складу');
        assert.equal(res.data.data.active_accounts[0].username, 'offboard.employee');
        assert.equal(res.data.data.document_alerts[0].title, 'Медкнижка 2026');
    });

    it('deactivates linked CRM account, profile, tokens, and audit when HR offboarding disables account', async () => {
        const res = await request('POST', '/api/hr/staff/42/offboarding', {
            effective_date: '2099-06-06',
            target_pool_status: 'reserve',
            account_action: 'disable',
            reason: 'Завершення тестової співпраці',
            notes: 'route smoke'
        }, withAuth());

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.open_resource_count, 1);
        assert.equal(res.data.disabled_accounts, 1);
        assert.deepEqual(res.data.disabled_account_usernames, ['offboard.employee']);
        assert.ok(queries.some(q => /UPDATE users SET is_active = false, session_revoked_at = NOW\(\)/i.test(q.text)));
        assert.ok(queries.some(q => /UPDATE employee_profiles SET is_active = false WHERE staff_id = \$1 AND user_id = ANY\(\$2::int\[\]\)/i.test(q.text)));
        assert.ok(queries.some(q => /UPDATE refresh_tokens SET revoked_at = NOW\(\)/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO account_security_events/i.test(q.text) && q.params[4] === 'account_deactivated' && q.params[5] === 'hr_offboarding'));
        assert.ok(queries.some(q => /INSERT INTO hr_audit_log/i.test(q.text) && q.params[0] === 'staff_offboarding_complete'));
    });

    it('blocks HR offboarding from disabling protected creator or current CRM accounts', async () => {
        const protectedCreator = await request('POST', '/api/hr/staff/43/offboarding', {
            effective_date: '2099-06-06',
            target_pool_status: 'reserve',
            account_action: 'disable',
            reason: 'Creator should stay protected'
        }, withAuth());
        assert.equal(protectedCreator.status, 409, JSON.stringify(protectedCreator.data));
        assert.match(protectedCreator.data.error, /Creator-акаунт/);

        queries.length = 0;
        const currentUser = await request('POST', '/api/hr/staff/44/offboarding', {
            effective_date: '2099-06-06',
            target_pool_status: 'reserve',
            account_action: 'disable',
            reason: 'Current user should stay protected'
        }, withAuth());
        assert.equal(currentUser.status, 409, JSON.stringify(currentUser.data));
        assert.match(currentUser.data.error, /власний CRM-акаунт/);
        assert.equal(queries.some(q => /UPDATE users SET is_active = false/i.test(q.text)), false);
        assert.equal(queries.some(q => /INSERT INTO staff_offboarding_events/i.test(q.text)), false);
    });

    it('assigns HR onboarding responsible owners and syncs canonical tasks without duplicates', async () => {
        const owners = await request('GET', '/api/hr/onboarding/responsible-candidates', undefined, withAuth());
        assert.equal(owners.status, 200, JSON.stringify(owners.data));
        assert.equal(owners.data.success, true);
        assert.deepEqual(owners.data.data.map(user => user.id), [2, 3]);
        assert.equal(owners.data.meta.canonicalOwnerField, 'tasks.owner_user_id');

        queries.length = 0;
        const assigned = await request('PUT', '/api/hr/staff/45/onboarding-assignment', {
            responsible_user_id: 2,
            template_id: 11
        }, withAuth());
        assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
        assert.equal(assigned.data.success, true);
        assert.equal(assigned.data.progress.responsible_user_id, 2);
        assert.equal(assigned.data.taskSync.created_count, 4);
        assert.equal(assigned.data.progress.active_task_count, 4);
        assert.ok(queries.some(q => /INSERT INTO onboarding_progress/i.test(q.text)));
        assert.equal(queries.filter(q => /INSERT INTO tasks \((?:business_context, )?title, description, date, priority/i.test(q.text)).length, 4);

        queries.length = 0;
        const repeated = await request('PUT', '/api/hr/staff/45/onboarding-assignment', {
            responsible_user_id: 2,
            template_id: 11
        }, withAuth());
        assert.equal(repeated.status, 200, JSON.stringify(repeated.data));
        assert.equal(repeated.data.success, true);
        assert.equal(repeated.data.action, 'confirmed');
        assert.equal(repeated.data.taskSync.created_count, 0);
        assert.equal(repeated.data.taskSync.updated_count, 4);
        assert.equal(queries.filter(q => /INSERT INTO tasks \((?:business_context, )?title, description, date, priority/i.test(q.text)).length, 0);

        queries.length = 0;
        const reassigned = await request('PUT', '/api/hr/staff/45/onboarding-assignment', {
            responsible_user_id: 3,
            template_id: 11
        }, withAuth());
        assert.equal(reassigned.status, 200, JSON.stringify(reassigned.data));
        assert.equal(reassigned.data.success, true);
        assert.equal(reassigned.data.action, 'reassigned');
        assert.equal(reassigned.data.progress.responsible_user_id, 3);
        assert.equal(reassigned.data.taskSync.created_count, 0);
        assert.equal(reassigned.data.taskSync.updated_count, 4);
        assert.ok(queries.some(q => /UPDATE tasks SET title = \$2,/i.test(q.text)));

        const list = await request('GET', '/api/hr/onboarding', undefined, withAuth());
        assert.equal(list.status, 200, JSON.stringify(list.data));
        assert.equal(list.data.success, true);
        assert.equal(list.data.data[0].responsible_username, 'mentor');
        assert.equal(list.data.data[0].generated_task_count, 4);
        assert.equal(list.data.data[0].active_task_count, 4);
    });

    it('exposes typed task operations endpoints behind object visibility', async () => {
        const owners = await request('GET', '/api/tasks/owners', undefined, withAuth({}, 'manager'));
        assert.equal(owners.status, 200, JSON.stringify(owners.data));
        assert.equal(owners.data.success, true);
        assert.deepEqual(owners.data.users.map(user => user.id), [2, 3]);
        assert.equal(owners.data.meta.canonicalField, 'tasks.owner_user_id');

        const history = await request('GET', '/api/tasks/1/history?limit=5', undefined, withAuth());
        assert.equal(history.status, 200, JSON.stringify(history.data));
        assert.equal(history.data.success, true);
        assert.equal(history.data.meta.source, 'task_action_history');
        assert.equal(history.data.history[0].actionType, 'task_completed');

        queries.length = 0;
        const completed = await request('POST', '/api/tasks/1/complete', { sourceSurface: 'task_page' }, withAuth());
        assert.equal(completed.status, 200, JSON.stringify(completed.data));
        assert.equal(completed.data.success, true);
        assert.equal(completed.data.historyEvent.actionType, 'task_completed');
        assert.ok(queries.some(q => /UPDATE tasks/i.test(q.text) && /SET status = 'done'/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO task_action_history/i.test(q.text)));

        const blocked = await request('POST', '/api/tasks/99/complete', { sourceSurface: 'task_page' }, withAuth());
        assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
        assert.equal(blocked.data.code, 'TASK_REPORT_REQUIRED');
        assert.equal(blocked.data.requiresReport, true);

        const completedWithReport = await request('POST', '/api/tasks/99/complete', { sourceSurface: 'task_page', reportId: 701 }, withAuth());
        assert.equal(completedWithReport.status, 200, JSON.stringify(completedWithReport.data));
        assert.equal(completedWithReport.data.success, true);
    });

    it('lets lead roles load assignable users without opening user management', async () => {
        const assignees = await request('GET', '/api/leads/assignees', undefined, withAuth({}, 'manager'));
        assert.equal(assignees.status, 200, JSON.stringify(assignees.data));
        assert.equal(assignees.data.success, true);
        assert.deepEqual(assignees.data.users.map(u => u.id), [2, 3]);

        const users = await request('GET', '/api/users', undefined, withAuth({}, 'manager'));
        assert.equal(users.status, 403);
    });

    it('composes the lead manager workspace from the canonical pipeline stage', async () => {
        const res = await request('GET', '/api/leads/501/workspace', undefined, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.workspace.canonical.statusField, 'pipeline_stage');
        assert.equal(res.data.workspace.canonical.stage, 'contacted');
        assert.equal(res.data.workspace.canonical.aggregateStatus, 'contact');
        assert.equal(res.data.workspace.customer.id, 701);
        assert.equal(res.data.workspace.bookings[0].id, 'BK-WS');
        assert.equal(res.data.workspace.tasks[0].sourceType, 'lead');
        assert.equal(res.data.workspace.conversations[0].channel, 'telegram');
        assert.equal(res.data.workspace.conversations[0].confidence, 'exact');
        assert.equal(res.data.workspace.conversations[0].replyOwner, 'Dasha Manager');
        assert.equal(res.data.workspace.conversations[0].replyOwnerUserId, 2);
    });

    it('preserves exact lead source linkage when creating manager callback tasks', async () => {
        const res = await request('POST', '/api/tasks', {
            title: 'Передзвонити клієнту',
            source_type: 'lead',
            source_id: '501',
            category: 'operational',
            priority: 'high'
        }, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.task.source_type, 'lead');
        assert.equal(res.data.task.source_id, '501');
        assert.ok(queries.some(q => /INSERT INTO tasks \((?:business_context, )?title, description, date, priority/i.test(q.text)
            && q.params[/^INSERT INTO tasks \(business_context,/i.test(q.text.trim()) ? 15 : 14] === 'lead'
            && q.params[/^INSERT INTO tasks \(business_context,/i.test(q.text.trim()) ? 16 : 15] === '501'));
    });

    it('creates URL-first Profile My Day tasks through the canonical task route', async () => {
        const title = 'https://example.com перевірити';
        const res = await request('POST', '/api/tasks', {
            title,
            ownerUserId: 1,
            category: 'personal',
            task_mode: 'personal',
            task_kind: 'action',
            visibility: 'me_only',
            workflow_state: 'inbox',
            date: '2099-05-31',
            source_type: 'manual',
            source_module: 'profile_my_cabinet',
            source_surface: 'profile_my_cabinet'
        }, withAuth({}, 'creator'));

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.task.title, title);
        assert.equal(res.data.task.ownerUserId, 1);
        assert.ok(queries.some(q => /INSERT INTO tasks \((?:business_context, )?title, description, date, priority/i.test(q.text)
            && q.params[/^INSERT INTO tasks \(business_context,/i.test(q.text.trim()) ? 1 : 0] === title));
    });

    it('validates and applies lead assignee updates', async () => {
        const invalid = await request('PATCH', '/api/leads/501', { assigned_to: 'not-a-user' }, withAuth({}, 'manager'));
        assert.equal(invalid.status, 400, JSON.stringify(invalid.data));
        assert.match(invalid.data.error, /assigned_to/);

        const missing = await request('PATCH', '/api/leads/501', { assigned_to: 999 }, withAuth({}, 'manager'));
        assert.equal(missing.status, 400, JSON.stringify(missing.data));
        assert.match(missing.data.error, /Відповідального/);

        const valid = await request('PATCH', '/api/leads/501', { assigned_to: '2' }, withAuth({}, 'manager'));
        assert.equal(valid.status, 200, JSON.stringify(valid.data));
        assert.equal(valid.data.success, true);
        assert.equal(valid.data.lead.assigned_to, 2);
        assert.ok(queries.some(q =>
            /UPDATE leads SET assigned_to = \$1 WHERE id = \$2(?: AND COALESCE\(business_context, 'event_genix'\) = \$3)? RETURNING \*/i.test(q.text)
            && q.params[0] === 2
            && (q.params[2] === undefined || q.params[2] === 'event_genix')
        ));
    });

    it('keeps analytics API access aligned to manager-up roles', async () => {
        const path = '/api/analytics/overview?from=2099-01-01&to=2099-01-01';

        const blocked = await request('GET', path, undefined, withAuth({}, 'admin'));
        assert.equal(blocked.status, 403, JSON.stringify(blocked.data));

        const manager = await request('GET', path, undefined, withAuth({}, 'manager'));
        assert.equal(manager.status, 200, JSON.stringify(manager.data));
        assert.ok(manager.data.bookings, 'manager should receive analytics data');
        assert.ok(manager.data.finance, 'manager should receive finance analytics section');
    });

    it('serves product sales only to manager-up roles and excludes linked bookings', async () => {
        const blocked = await request('GET', '/api/analytics/product-sales?month=2099-05', undefined, withAuth({}, 'admin'));
        assert.equal(blocked.status, 403, JSON.stringify(blocked.data));

        const invalid = await request('GET', '/api/analytics/product-sales?month=bad', undefined, withAuth({}, 'manager'));
        assert.equal(invalid.status, 400, JSON.stringify(invalid.data));

        queries.length = 0;
        const manager = await request('GET', '/api/analytics/product-sales?month=2099-05', undefined, withAuth({}, 'manager'));
        assert.equal(manager.status, 200, JSON.stringify(manager.data));
        assert.equal(manager.data.success, true);
        assert.equal(manager.data.period.month, '2099-05');
        assert.equal(manager.data.totals.count, 2);
        assert.equal(manager.data.totals.revenue, 3700);
        assert.equal(manager.data.totals.programCount, 2);
        assert.equal(manager.data.totals.avgPrice, 1850);
        assert.equal(manager.data.summary[0].category, 'pinata');
        assert.equal(manager.data.details[0].date, '2099-05-02');
        assert.equal(manager.data.summary[0].paidAmount, undefined);
        assert.equal(manager.data.details[0].paymentStatus, undefined);
        assert.ok(queries.some(q => q.text.includes("b.status = 'confirmed'")));
        assert.ok(queries.some(q => q.text.includes("NULLIF(b.linked_to, '') IS NULL")));
    });

    it('exports product sales CSV and XLSX with attachment headers', async () => {
        const csv = await fetch(`${baseUrl}/api/analytics/product-sales/export?month=2099-05&format=csv`, {
            headers: withAuth({}, 'manager')
        });
        assert.equal(csv.status, 200);
        assert.match(csv.headers.get('content-type'), /text\/csv/);
        assert.match(csv.headers.get('content-disposition'), /product_sales_2099-05\.csv/);
        const csvText = await csv.text();
        assert.match(csvText, /"Дата";"Час";"Програма";"Код";"Категорія";"Клієнт\/група";"Кімната";"Дітей";"Сума";"ID бронювання";"Створив"/);
        assert.ok(!csvText.includes('Оплачено'));
        assert.ok(!csvText.includes('Борг'));
        assert.ok(!csvText.includes('Підсумок за'));

        const xlsx = await fetch(`${baseUrl}/api/analytics/product-sales/export?month=2099-05&format=xlsx`, {
            headers: withAuth({}, 'manager')
        });
        assert.equal(xlsx.status, 200);
        assert.match(xlsx.headers.get('content-type'), /spreadsheetml\.sheet/);
        assert.match(xlsx.headers.get('content-disposition'), /product_sales_2099-05\.xlsx/);
        const body = await xlsx.arrayBuffer();
        assert.ok(body.byteLength > 1000);
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(body));
        const summaryHeaders = workbook.getWorksheet('Підсумок').getRow(1).values.join('|');
        const detailHeaders = workbook.getWorksheet('Виписка').getRow(1).values.join('|');
        assert.ok(summaryHeaders.includes('Середній чек'));
        assert.ok(detailHeaders.includes('Клієнт/група'));
        assert.ok(!summaryHeaders.includes('Оплачено'));
        assert.ok(!detailHeaders.includes('Борг'));
    });

    it('enforces sensitive dashboard widget permissions server-side', async () => {
        const managerFinance = await request('GET', '/api/dashboard/widgets/finance_today', undefined, withAuth({}, 'manager'));
        assert.equal(managerFinance.status, 403, JSON.stringify(managerFinance.data));

        const managerDirectorPnl = await request('GET', '/api/dashboard/widgets/director_pnl', undefined, withAuth({}, 'manager'));
        assert.equal(managerDirectorPnl.status, 403, JSON.stringify(managerDirectorPnl.data));

        const accountantFinance = await request('GET', '/api/dashboard/widgets/finance_today', undefined, withAuth({}, 'accountant'));
        assert.equal(accountantFinance.status, 200, JSON.stringify(accountantFinance.data));
        assert.equal(accountantFinance.data.success, true);
        assert.equal(accountantFinance.data.data.profit, 0);
    });

    it('supports HR vacancy resume intake with pasted text, file upload, and download metadata', async () => {
        const created = await request('POST', '/api/hr/vacancies/55/applications', {
            name: 'РђРЅРЅР° РљР°РЅРґРёРґР°С‚',
            phone: '+380501112233',
            raw_application_text: 'РџР°СЃС‚РµРґ CV'
        }, withAuth());
        assert.equal(created.status, 200, JSON.stringify(created.data));
        assert.equal(created.data.success, true);
        assert.equal(created.data.application.raw_application_text, 'РџР°СЃС‚РµРґ CV');

        const listed = await request('GET', '/api/hr/vacancies/55/applications', undefined, withAuth());
        assert.equal(listed.status, 200, JSON.stringify(listed.data));
        assert.equal(listed.data.applications[0].resume_files[0].original_name, 'anna-resume.txt');
        assert.equal(listed.data.applications[0].resume_files[0].download_url, '/api/hr/applications/701/resume-files/801/download');

        const form = new FormData();
        form.append('files', new Blob(['РўРµРєСЃС‚ СЂРµР·СЋРјРµ'], { type: 'text/plain' }), 'resume.txt');
        const uploaded = await requestMultipart('/api/hr/applications/702/resume-files', form, withAuth());
        assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
        assert.equal(uploaded.data.success, true);
        assert.equal(uploaded.data.files[0].extraction_status, 'extracted');
        assert.equal(uploaded.data.extracted_text_appended, true);

        const download = await fetch(`${baseUrl}/api/hr/applications/701/resume-files/801/download`, { headers: withAuth() });
        assert.equal(download.status, 200);
        assert.match(download.headers.get('content-disposition') || '', /filename=/);
        assert.equal(await download.text(), 'resume text content');
    });

    it('persists HR company structure as editable org chart nodes', async () => {
        const loaded = await request('GET', '/api/hr/company-structure', undefined, withAuth());
        assert.equal(loaded.status, 200, JSON.stringify(loaded.data));
        assert.equal(loaded.data.success, true);
        assert.equal(loaded.data.data.schemaVersion, 1);
        assert.equal(loaded.data.data.nodes[0].id, 'director');
        assert.equal(loaded.data.data.nodes[0].tone, 'gold');

        const saved = await request('PUT', '/api/hr/company-structure', {
            schemaVersion: 1,
            structure: 'оновлені нотатки',
            instructions: 'нова інструкція',
            nodes: [
                { id: 'director', title: 'Директор без корони', description: 'Root', tone: 'gold', lane: 'root', order: 1, x: 180, y: 40 },
                { id: 'ops', title: 'Операційний вузол', description: 'Ops', tone: 'bad-tone', lane: 'bad-lane', parentId: 'director', order: 2, x: 340, y: 210 }
            ]
        }, withAuth());
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        assert.equal(saved.data.success, true);
        assert.equal(saved.data.data.schemaVersion, 1);
        assert.equal(saved.data.data.nodes.length, 2);
        assert.equal(saved.data.data.nodes[0].title, 'Директор без корони');
        assert.equal(saved.data.data.nodes[1].tone, 'blue');
        assert.equal(saved.data.data.nodes[1].lane, 'leadership');
        assert.equal(saved.data.data.nodes[1].parentId, 'director');
        assert.equal(saved.data.data.nodes[0].x, 180);
        assert.equal(saved.data.data.nodes[0].y, 40);
        assert.equal(saved.data.data.nodes[1].x, 340);
        assert.equal(saved.data.data.nodes[1].y, 210);
        assert.ok(queries.some(q => /INSERT INTO settings \(key, value\)/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO hr_audit_log/i.test(q.text)));
    });

    it('keeps exposed module APIs aligned with page-level role access', async () => {
        const waiterDesigns = await request('GET', '/api/designs/tags', undefined, withAuth({}, 'waiter'));
        assert.equal(waiterDesigns.status, 403, JSON.stringify(waiterDesigns.data));
        const artDesigns = await request('GET', '/api/designs/tags', undefined, withAuth({}, 'art_director'));
        assert.equal(artDesigns.status, 200, JSON.stringify(artDesigns.data));
        assert.deepEqual(artDesigns.data, []);

        const waiterCostumes = await request('GET', '/api/art-director/costumes', undefined, withAuth({}, 'waiter'));
        assert.equal(waiterCostumes.status, 403, JSON.stringify(waiterCostumes.data));
        const artCostumes = await request('GET', '/api/art-director/costumes', undefined, withAuth({}, 'art_director'));
        assert.equal(artCostumes.status, 200, JSON.stringify(artCostumes.data));
        assert.equal(artCostumes.data.success, true);
        assert.equal(artCostumes.data.data[0].name, 'Пірат Джек');
        const createdCostume = await request('POST', '/api/art-director/costumes', { name: 'Космонавт', category: 'sci-fi', size: 'L' }, withAuth({}, 'art_director'));
        assert.equal(createdCostume.status, 200, JSON.stringify(createdCostume.data));
        assert.equal(createdCostume.data.data.name, 'Космонавт');
        const hrCostumesCompatibility = await request('GET', '/api/hr/costumes', undefined, withAuth({}, 'manager'));
        assert.equal(hrCostumesCompatibility.status, 200, JSON.stringify(hrCostumesCompatibility.data));
        assert.equal(hrCostumesCompatibility.data.data[0].name, 'Пірат Джек');
        assert.equal(hrCostumesCompatibility.data.deprecated, true);
        assert.equal(hrCostumesCompatibility.data.replacement, '/api/warehouse/costumes');
        const warehouseCostumes = await request('GET', '/api/warehouse/costumes', undefined, withAuth({}, 'manager'));
        assert.equal(warehouseCostumes.status, 200, JSON.stringify(warehouseCostumes.data));
        assert.equal(warehouseCostumes.data.success, true);
        assert.equal(warehouseCostumes.data.data[0].name, 'Пірат Джек');

        const waiterMusic = await request('GET', '/api/music/overview', undefined, withAuth({}, 'waiter'));
        assert.equal(waiterMusic.status, 403, JSON.stringify(waiterMusic.data));
        const artMusic = await request('GET', '/api/music/overview', undefined, withAuth({}, 'art_director'));
        assert.equal(artMusic.status, 200, JSON.stringify(artMusic.data));
        assert.equal(artMusic.data.success, true);

        const managerReports = await request('GET', '/api/reports/accountants', undefined, withAuth({}, 'manager'));
        assert.equal(managerReports.status, 403, JSON.stringify(managerReports.data));
        const accountantReports = await request('GET', '/api/reports/accountants', undefined, withAuth({}, 'accountant'));
        assert.equal(accountantReports.status, 200, JSON.stringify(accountantReports.data));
        assert.deepEqual(accountantReports.data, []);

        const waiterChat = await request('GET', '/api/chat-real/channels', undefined, withAuth({}, 'waiter'));
        assert.equal(waiterChat.status, 403, JSON.stringify(waiterChat.data));
        const animatorChat = await request('GET', '/api/chat-real/channels', undefined, withAuth({}, 'animator'));
        assert.equal(animatorChat.status, 200, JSON.stringify(animatorChat.data));
        assert.equal(animatorChat.data[0].name, 'General');
    });

    it('does not allow broad query-token fallback on chat-adjacent protected routes', async () => {
        const noAuth = await request('GET', '/api/chat/channels');
        assert.equal(noAuth.status, 401);

        const queryToken = await request('GET', `/api/chat/channels?token=${authToken}`);
        assert.equal(queryToken.status, 401);

        const allowed = await request('GET', '/api/chat/channels', undefined, withAuth());
        assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
        assert.equal(allowed.data.user, 'route-smoke');
    });

    it('keeps custom-secret Telegram and report-bot routes secret-gated', async () => {
        const reportMissing = await request('POST', '/api/report-bot/webhook', {});
        assert.equal(reportMissing.status, 403);

        const reportWrong = await request('POST', '/api/report-bot/webhook', {}, {
            'x-telegram-bot-api-secret-token': 'wrong'
        });
        assert.equal(reportWrong.status, 403);

        const reportOk = await request('POST', '/api/report-bot/webhook', {}, {
            'x-telegram-bot-api-secret-token': TEST_REPORT_SECRET
        });
        assert.equal(reportOk.status, 200);

        const telegramWrong = await request('POST', '/api/telegram/webhook', {}, {
            'x-telegram-bot-api-secret-token': 'wrong'
        });
        assert.equal(telegramWrong.status, 403);

        const telegramOk = await request('POST', '/api/telegram/webhook', {}, {
            'x-telegram-bot-api-secret-token': TEST_TELEGRAM_SECRET
        });
        assert.equal(telegramOk.status, 200);
    });

    it('keeps report-bot API-key routes behind the bot API key', async () => {
        const missing = await request('POST', '/api/report-bot/submit', {});
        assert.equal(missing.status, 403);

        const wrong = await request('POST', '/api/report-bot/submit', {}, { 'x-api-key': 'wrong' });
        assert.equal(wrong.status, 403);

        const acceptedKeyInvalidPayload = await request('POST', '/api/report-bot/submit', {}, {
            'x-api-key': TEST_REPORT_KEY
        });
        assert.equal(acceptedKeyInvalidPayload.status, 400);
    });
});
