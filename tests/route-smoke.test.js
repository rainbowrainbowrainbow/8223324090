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
let missingSchemaMigrations;
let missingSchemaColumns;

const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    REPORT_BOT_API_KEY: process.env.REPORT_BOT_API_KEY,
    REPORT_WEBHOOK_SECRET: process.env.REPORT_WEBHOOK_SECRET,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
    UNIVERSAL_WEBHOOK_TOKEN: process.env.UNIVERSAL_WEBHOOK_TOKEN,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    HR_VACANCY_AI_MODEL: process.env.HR_VACANCY_AI_MODEL
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
        '../routes/bookings',
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
        '../services/maysternyaBookingWebhook',
        '../services/banquetSummary',
        '../services/booking',
        '../services/timelineResources',
        '../services/leadBookingLink',
        '../services/historyLog',
        '../services/eventBus',
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
            }],
            [46, {
                id: 46,
                name: 'Dismissed HR Reactivation',
                is_active: false,
                hr_pool_status: 'dismissed',
                blacklist_reason: null,
                notes: '',
                department: 'Operations',
                position: 'Animator',
                role_type: 'animator',
                termination_date: '2099-05-30',
                termination_reason: 'Former employee'
            }],
            [47, {
                id: 47,
                name: 'Dismissed Creator Reactivation',
                is_active: false,
                hr_pool_status: 'dismissed',
                blacklist_reason: null,
                notes: '',
                department: 'Operations',
                position: 'Animator',
                role_type: 'animator',
                termination_date: '2099-05-30',
                termination_reason: 'Former employee'
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
            }]],
            [46, [{
                id: 79,
                username: 'rehire.hr.blocked',
                name: 'Rehire HR Blocked',
                role: 'animator',
                extra_roles: [],
                profile_id: 791,
                full_name: 'Rehire HR Blocked',
                is_active: false,
                profile_active: false
            }]],
            [47, [{
                id: 80,
                username: 'rehire.creator.allowed',
                name: 'Rehire Creator Allowed',
                role: 'animator',
                extra_roles: [],
                profile_id: 792,
                full_name: 'Rehire Creator Allowed',
                is_active: false,
                profile_active: false
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
        bookings: [],
        customers: [],
        historyRows: [],
        outboxEvents: [],
        nextOnboardingTemplateId: 12,
        nextOnboardingProgressId: 1001,
        nextTaskId: 880,
        nextBookingSeq: 1,
        nextCustomerId: 970,
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
        generateBookingNumber: async () => `BK-2099-${String(hrState.nextBookingSeq++).padStart(4, '0')}`,
        connect: async function() {
            return {
                query: this.query.bind(this),
                release() {}
            };
        },
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });

            if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT\s+\w+|RELEASE SAVEPOINT\s+\w+|ROLLBACK TO SAVEPOINT\s+\w+)$/i.test(text)) {
                return { rows: [], rowCount: 0, command: text.split(/\s+/)[0].toUpperCase() };
            }
            if (/SELECT pg_advisory_xact_lock/i.test(text)) {
                return { rows: [], rowCount: 1 };
            }
            if (/^SELECT 1\b/i.test(text)) {
                return { rows: [{ ok: 1 }] };
            }
            if (/SELECT b\.\* FROM bookings b WHERE b\.id = \$1 AND CASE/i.test(text) && /LIMIT 1/i.test(text)) {
                if (params[0] !== 'BK-SUMMARY') return { rows: [], rowCount: 0 };
                return {
                    rows: [{
                        id: 'BK-SUMMARY',
                        business_context: params[1] || 'event_genix',
                        date: '2099-06-20',
                        time: '14:00',
                        line_id: 'room-marvel',
                        program_id: 'birthday_90',
                        program_code: 'BD90',
                        label: 'Birthday',
                        program_name: 'Birthday package',
                        category: 'birthday',
                        duration: 90,
                        price: 3700,
                        hosts: 1,
                        second_animator: null,
                        costume: null,
                        room: 'Marvel',
                        notes: 'No mushrooms',
                        created_by: 'route-smoke',
                        linked_to: null,
                        status: 'confirmed',
                        kids_count: 8,
                        group_name: 'Mia birthday',
                        customer_id: 701,
                        payment_method: 'cash',
                        payment_status: null,
                        paid_amount: null,
                        banquet_guests: 12,
                        banquet_adults: 4,
                        banquet_tables: 2,
                        banquet_menu: 'Legacy should be ignored',
                        extra_data: {
                            bookingPackage: {
                                programBasePrice: 2500,
                                positionsSubtotal: 1200,
                                finalTotal: 3700,
                                menuPositions: [
                                    { productId: 'pizza', title: 'Pizza', quantity: 2, unitPrice: 300, subtotal: 600 },
                                    { productId: 'juice', title: 'Juice', quantity: 3, unitPrice: 200, subtotal: 600 }
                                ]
                            }
                        },
                        created_at: '2099-06-01T10:00:00.000Z',
                        updated_at: '2099-06-01T10:00:00.000Z'
                    }],
                    rowCount: 1
                };
            }
            if (/SELECT id, business_context, name, phone, instagram, child_name, child_birthday, source, notes,/i.test(text) && /FROM customers WHERE id = \$1/i.test(text)) {
                if (Number(params[0]) !== 701) return { rows: [], rowCount: 0 };
                return {
                    rows: [{
                        id: 701,
                        business_context: params[1] || 'event_genix',
                        name: 'Route Smoke Customer',
                        phone: '+380000000001',
                        instagram: 'route_customer',
                        child_name: 'Mia',
                        child_birthday: '2020-06-01',
                        source: 'site',
                        notes: 'Customer note'
                    }],
                    rowCount: 1
                };
            }
            if (/FROM booking_banquet_links WHERE business_context = \$1 AND relation_type = \$2/i.test(text)) {
                if (params[2] !== 'BK-SUMMARY') return { rows: [], rowCount: 0 };
                return {
                    rows: [{
                        id: 31,
                        booking_a_id: 'BK-SUMMARY',
                        booking_b_id: 'BK-ACTIVITY',
                        relation_type: 'banquet_activity',
                        label: 'extra activity',
                        created_at: '2099-06-01T11:00:00.000Z',
                        created_by: 'route-smoke'
                    }],
                    rowCount: 1
                };
            }
            if (/SELECT b\.\* FROM bookings b WHERE b\.id = ANY\(\$1::text\[\]\)/i.test(text)) {
                const ids = Array.isArray(params[0]) ? params[0].map(String) : [];
                const rows = ids.includes('BK-ACTIVITY') ? [{
                    id: 'BK-ACTIVITY',
                    business_context: params[1] || 'event_genix',
                    date: '2099-06-20',
                    time: '15:30',
                    line_id: 'animator-1',
                    program_name: 'Face painting',
                    label: 'Face painting',
                    category: 'activity',
                    duration: 30,
                    price: 700,
                    room: 'Marvel',
                    notes: 'After cake',
                    created_by: 'route-smoke',
                    status: 'confirmed',
                    extra_data: {},
                    created_at: '2099-06-01T10:30:00.000Z',
                    updated_at: '2099-06-01T10:30:00.000Z'
                }] : [];
                return { rows, rowCount: rows.length };
            }
            if (/SELECT \* FROM bookings WHERE COALESCE\(business_context, 'event_genix'\) = \$1 AND COALESCE\(extra_data->>'externalId'/i.test(text)) {
                const row = hrState.bookings.find(booking =>
                    booking.business_context === params[0]
                    && booking.extra_data?.externalId === params[1]
                    && booking.status !== 'cancelled'
                );
                return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
            }
            if (/SELECT value FROM settings WHERE key = \$1/i.test(text)) {
                return { rows: [{ value: JSON.stringify({ mode: 'simple', resourceModel: 'specialist' }) }], rowCount: 1 };
            }
            if (/SELECT \* FROM timeline_resources WHERE business_context = \$1 AND resource_id = \$2/i.test(text)) {
                const resourceId = String(params[1] || '');
                if (params[0] === 'maysternya_doli' && resourceId === 'md-consult-room') {
                    return {
                        rows: [{
                            id: 1001,
                            business_context: 'maysternya_doli',
                            resource_id: 'md-consult-room',
                            type: 'specialist',
                            name: 'Олександр',
                            short_name: 'Олександр',
                            color: '#0EA586',
                            capacity: 1,
                            equipment: ['online'],
                            is_active: true,
                            sort_order: 10,
                            metadata: { source: 'maysternya_default', online: true },
                            created_at: '2099-01-01T00:00:00.000Z',
                            updated_at: '2099-01-01T00:00:00.000Z'
                        }],
                        rowCount: 1
                    };
                }
                return { rows: [], rowCount: 0 };
            }
            if (/SELECT \* FROM timeline_resources WHERE business_context = \$1 AND \(LOWER\(BTRIM\(name\)\)/i.test(text)) {
                if (params[0] === 'maysternya_doli' && ['олександр', 'онлайн консультація'].includes(String(params[1] || '').toLowerCase())) {
                    return {
                        rows: [{
                            id: 1001,
                            business_context: 'maysternya_doli',
                            resource_id: 'md-consult-room',
                            type: 'specialist',
                            name: 'Олександр',
                            short_name: 'Олександр',
                            color: '#0EA586',
                            capacity: 1,
                            equipment: ['online'],
                            is_active: true,
                            sort_order: 10,
                            metadata: { source: 'maysternya_default', online: true },
                            created_at: '2099-01-01T00:00:00.000Z',
                            updated_at: '2099-01-01T00:00:00.000Z'
                        }],
                        rowCount: 1
                    };
                }
                return { rows: [], rowCount: 0 };
            }
            if (/SELECT id, time, duration, label, program_code FROM bookings WHERE date = \$1 AND line_id = \$2/i.test(text)) {
                const rows = hrState.bookings.filter(booking =>
                    booking.date === params[0]
                    && booking.line_id === params[1]
                    && booking.business_context === params[2]
                    && booking.status !== 'cancelled'
                );
                return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
            }
            if (/SELECT id, category, time, duration FROM bookings WHERE date = \$1 AND program_id = \$2/i.test(text)) {
                const rows = hrState.bookings.filter(booking =>
                    booking.date === params[0]
                    && booking.program_id === params[1]
                    && booking.business_context === params[2]
                    && booking.status !== 'cancelled'
                );
                return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
            }
            if (/SELECT id, time, duration, label, program_code FROM bookings WHERE date = \$1 AND room = \$2/i.test(text)) {
                const rows = hrState.bookings.filter(booking =>
                    booking.date === params[0]
                    && booking.room === params[1]
                    && booking.business_context === params[2]
                    && booking.status !== 'cancelled'
                );
                return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
            }
            if (/SELECT id FROM customers WHERE phone = \$1 AND COALESCE\(business_context, 'event_genix'\) = \$2 LIMIT 1/i.test(text)) {
                const row = hrState.customers.find(customer =>
                    customer.phone === params[0] && customer.business_context === params[1]
                );
                return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
            }
            if (/INSERT INTO customers \(business_context, name, phone, instagram, child_name, child_birthday, source\)/i.test(text)) {
                const row = {
                    id: hrState.nextCustomerId++,
                    business_context: params[0],
                    name: params[1],
                    phone: params[2] || null,
                    instagram: params[3] || null,
                    child_name: params[4] || null,
                    child_birthday: params[5] || null,
                    source: params[6] || null
                };
                hrState.customers.push(row);
                return { rows: [{ id: row.id }], rowCount: 1 };
            }
            if (/INSERT INTO bookings\s+\(id, business_context, date, time, line_id/i.test(text)) {
                const row = {
                    id: params[0],
                    business_context: params[1],
                    date: params[2],
                    time: params[3],
                    line_id: params[4],
                    program_id: params[5],
                    program_code: params[6],
                    label: params[7],
                    program_name: params[8],
                    category: params[9],
                    duration: params[10],
                    price: params[11],
                    hosts: params[12],
                    second_animator: params[13],
                    pinata_filler: params[14],
                    pinata_mode: params[15],
                    pinata_number: params[16],
                    pinata_filler_number: params[17],
                    client_pinata_service_price: params[18],
                    client_pinata_service_note: params[19],
                    costume: params[20],
                    room: params[21],
                    notes: params[22],
                    created_by: params[23],
                    linked_to: params[24],
                    status: params[25],
                    kids_count: params[26],
                    group_name: params[27],
                    extra_data: JSON.parse(params[28] || '{}'),
                    skip_notification: params[29],
                    customer_id: params[30],
                    payment_method: params[31],
                    created_at: '2099-01-01T00:00:00.000Z',
                    updated_at: '2099-01-01T00:00:00.000Z'
                };
                hrState.bookings.push(row);
                return { rows: [{ ...row }], rowCount: 1 };
            }
            if (/UPDATE customers SET\s+first_visit = LEAST/i.test(text)) {
                return { rows: [], rowCount: 1 };
            }
            if (/SELECT id FROM leads WHERE COALESCE\(business_context, \$1\) = \$1/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (/UPDATE customers SET lead_id = COALESCE\(lead_id, \$1\)/i.test(text)) {
                return { rows: [], rowCount: params[1] ? 1 : 0 };
            }
            if (/INSERT INTO history \(business_context, action, username, data\)/i.test(text)) {
                hrState.historyRows.push({
                    business_context: params[0],
                    action: params[1],
                    username: params[2],
                    data: JSON.parse(params[3] || '{}')
                });
                return { rows: [], rowCount: 1 };
            }
            if (/INSERT INTO outbox_events \(aggregate_type, aggregate_id, event_type, payload, idempotency_key\)/i.test(text)) {
                hrState.outboxEvents.push({
                    aggregate_type: params[0],
                    aggregate_id: params[1],
                    event_type: params[2],
                    payload: JSON.parse(params[3] || '{}'),
                    idempotency_key: params[4]
                });
                return { rows: [], rowCount: 1 };
            }
            if (/SELECT version FROM schema_migrations WHERE version = ANY\(\$1::text\[\]\)/i.test(text)) {
                return {
                    rows: (params[0] || [])
                        .filter(version => !missingSchemaMigrations.has(String(version)))
                        .map(version => ({ version }))
                };
            }
            if (/FROM information_schema\.columns/i.test(text)) {
                const values = Array.isArray(params) ? params : [];
                const rows = [];
                for (let i = 0; i < values.length; i += 2) {
                    const key = `${values[i]}.${values[i + 1]}`;
                    if (!missingSchemaColumns.has(key)) {
                        rows.push({ table_name: values[i], column_name: values[i + 1] });
                    }
                }
                return { rows };
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
            if (/SELECT \* FROM staff WHERE id = \$1 FOR UPDATE/i.test(text)) {
                const staff = hrState.staff.get(Number(params[0]));
                return { rows: staff ? [staff] : [], rowCount: staff ? 1 : 0 };
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
            if (/SELECT \* FROM onboarding_progress WHERE staff_id = \$1 AND status <> 'completed'/i.test(text)) {
                const progress = Array.from(hrState.onboardingProgress.values())
                    .filter(row => Number(row.staff_id) === Number(params[0]) && row.status !== 'completed')
                    .sort((a, b) => Number(b.id) - Number(a.id))[0];
                return { rows: progress ? [progress] : [] };
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
                if (params[0] === 'duplicate collaboration handoff') {
                    return {
                        rows: [{
                            id: 888,
                            title: 'Duplicate collaboration handoff',
                            status: 'todo',
                            priority: 'normal',
                            owner_user_id: 2,
                            source_type: 'lead',
                            source_id: '502'
                        }]
                    };
                }
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
            if (/FROM employee_profiles ep JOIN users u ON u\.id = ep\.user_id WHERE ep\.staff_id = \$1/i.test(text) && !/FOR UPDATE OF ep, u/i.test(text)) {
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
            if (/UPDATE staff SET is_active = true,/i.test(text) && /termination_date = NULL/i.test(text) && /WHERE id = \$1 RETURNING \*/i.test(text)) {
                const id = Number(params[0]);
                const staff = hrState.staff.get(id);
                if (!staff) return { rows: [], rowCount: 0 };
                const updated = {
                    ...staff,
                    is_active: true,
                    termination_date: null,
                    termination_reason: null,
                    termination_recorded_at: null,
                    termination_recorded_by: null
                };
                hrState.staff.set(id, updated);
                return { rows: [updated], rowCount: 1 };
            }
            if (/FROM employee_profiles ep JOIN users u ON u\.id = ep\.user_id WHERE ep\.staff_id = \$1 AND COALESCE\(ep\.is_active, true\) = true AND COALESCE\(u\.is_active, true\) = true FOR UPDATE OF ep, u/i.test(text)) {
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
            if (/FROM employee_profiles ep JOIN users u ON u\.id = ep\.user_id WHERE ep\.staff_id = \$1 AND ep\.user_id IS NOT NULL FOR UPDATE OF ep, u/i.test(text)) {
                const rows = (hrState.accountsByStaff.get(Number(params[0])) || []).map(row => ({
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
            if (/UPDATE employee_profiles SET is_active = true WHERE staff_id = \$1 AND user_id = ANY\(\$2::int\[\]\) RETURNING user_id/i.test(text)) {
                const ids = Array.isArray(params[1]) ? params[1].map(Number) : [];
                const accounts = hrState.accountsByStaff.get(Number(params[0])) || [];
                const rows = [];
                for (const account of accounts) {
                    if (ids.includes(Number(account.id))) {
                        account.profile_active = true;
                        rows.push({ user_id: account.id });
                    }
                }
                return { rows, rowCount: rows.length };
            }
            if (/DELETE FROM hr_shifts hs WHERE hs\.staff_id = \$1/i.test(text)) {
                return { rows: [], rowCount: 2 };
            }
            if (/DELETE FROM staff_schedule ss WHERE ss\.staff_id = \$1/i.test(text)) {
                return { rows: [], rowCount: 3 };
            }
            if (/UPDATE users SET is_active = true WHERE id = ANY\(\$1::int\[\]\) RETURNING id, username, name, role/i.test(text)) {
                const ids = Array.isArray(params[0]) ? params[0].map(Number) : [];
                const rows = [];
                for (const accounts of hrState.accountsByStaff.values()) {
                    for (const account of accounts) {
                        if (ids.includes(Number(account.id))) {
                            account.is_active = true;
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
                return { rows: params[1] === 'existing-external' && params[2] === 'maysternya_bot' ? [{ id: 777 }] : [] };
            }
            if (/SELECT id FROM leads/i.test(text) && /telegram_id = \$2::bigint/i.test(text)) {
                return { rows: [] };
            }
            if (/SELECT id FROM leads/i.test(text) && /regexp_replace\(COALESCE\(phone/i.test(text)) {
                return { rows: [] };
            }
            if (/SELECT COUNT\(\*\)::int AS total\s+FROM leads l/i.test(text)) {
                return { rows: [{ total: 650 }] };
            }
            if (/SELECT l\.\*, u\.name AS assigned_name, p\.label AS program_name,\s+COALESCE\(l\.potential_value, latest_card\.budget_approx\) AS budget_approx/i.test(text)) {
                const limit = Number(params[params.length - 2]) || 100;
                const offset = Number(params[params.length - 1]) || 0;
                const count = offset >= 500 ? 150 : Math.min(limit, 500);
                return {
                    rows: Array.from({ length: count }, (_, index) => ({
                        id: offset + index + 1,
                        business_context: 'event_genix',
                        client_name: `Lead ${offset + index + 1}`,
                        phone: '+380000000001',
                        source: 'instagram',
                        source_channel: 'instagram',
                        status: 'new',
                        pipeline_stage: 'new',
                        potential_value: 1200,
                        budget_approx: 1200,
                        created_at: '2099-05-01T10:00:00Z',
                        updated_at: '2099-05-02T10:00:00Z'
                    }))
                };
            }
            if (/INSERT INTO leads/i.test(text) && /booking_id/i.test(text) && params[1] === 'Lead Side Effect Fails') {
                throw new Error('synthetic lead handoff failure');
            }
            if (/INSERT INTO leads/i.test(text) && /booking_id/i.test(text) && /raw_payload/i.test(text)) {
                return {
                    rows: [{
                        id: 602,
                        business_context: params[0] || 'event_genix',
                        client_name: params[1],
                        phone: params[2],
                        telegram_id: params[3],
                        instagram: params[4],
                        source: params[5],
                        source_channel: params[6],
                        external_id: params[7],
                        event_date: params[9],
                        notes: params[11],
                        raw_payload: JSON.parse(params[12] || '{}'),
                        status: params[13],
                        pipeline_stage: params[14],
                        booking_id: params[15],
                        created_at: new Date('2026-05-11T00:00:00Z').toISOString()
                    }]
                };
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
            if (/SELECT id, username, name FROM users WHERE id = \$1 AND COALESCE\(is_active, true\) = true LIMIT 1/i.test(text)) {
                const user = hrState.users.get(Number(params[0]));
                return { rows: user ? [{ id: user.id, username: user.username, name: user.name }] : [] };
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
                        external_id: 'workspace-external',
                        raw_payload: {
                            inquiryId: 'workspace-inquiry',
                            email: 'workspace@example.com',
                            page: 'https://www.maisterniadoli.com/',
                            topic: 'Натальна консультація',
                            message: 'Хочу запис у Майстерні',
                            session_type: 'full',
                            contact_channels: ['site_form', 'whatsapp'],
                            utm: { source: 'google', campaign: 'natal' }
                        },
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
            if (/SELECT t\.\* FROM tasks t WHERE/i.test(text) && /lower\(regexp_replace\(trim\(COALESCE\(t\.title, ''\)\)/i.test(text)) {
                if (params[0] === 'duplicate collaboration handoff') {
                    return {
                        rows: [{
                            id: 888,
                            title: 'Duplicate collaboration handoff',
                            status: 'todo',
                            priority: 'normal',
                            owner_user_id: 2,
                            source_type: 'lead',
                            source_id: '502'
                        }]
                    };
                }
                return { rows: [] };
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
            if (/SELECT \* FROM leads WHERE id = \$1 AND COALESCE\(business_context, 'event_genix'\) = \$2 FOR UPDATE/i.test(text)) {
                return {
                    rows: [{
                        id: params[0],
                        business_context: params[1] || 'event_genix',
                        client_name: 'Lead Smoke',
                        phone: '+380000000009',
                        instagram: 'lead_smoke',
                        source: 'instagram',
                        source_channel: 'instagram',
                        assigned_to: null,
                        status: 'new',
                        pipeline_stage: 'new',
                        lead_type: 'quality',
                        lost_reason: null,
                        notes: 'Lead note',
                        created_at: '2099-05-01T10:00:00Z',
                        updated_at: '2099-05-02T10:00:00Z'
                    }]
                };
            }
            if (/SELECT id, pipeline_stage, status FROM leads WHERE id = \$1(?: AND COALESCE\(business_context, 'event_genix'\) = \$2)? FOR UPDATE/i.test(text)) {
                return { rows: [{ id: params[0], pipeline_stage: 'new', status: 'new' }] };
            }
            if (/UPDATE leads SET .* WHERE id = \$\d+(?: AND COALESCE\(business_context, 'event_genix'\) = \$\d+)? RETURNING \*/i.test(text)) {
                const paramFor = column => {
                    const match = text.match(new RegExp(`${column} = \\$(\\d+)`, 'i'));
                    return match ? params[Number(match[1]) - 1] : undefined;
                };
                const row = {
                    id: params[params.length - 2] || params[params.length - 1],
                    business_context: params[params.length - 1] || 'event_genix',
                    client_name: 'Lead Smoke',
                    phone: '+380000000009',
                    instagram: 'lead_smoke',
                    source: 'instagram',
                    source_channel: 'instagram',
                    assigned_to: null,
                    status: 'new',
                    pipeline_stage: 'new',
                    lead_type: 'quality',
                    lost_reason: null,
                    notes: 'Lead note',
                    created_at: '2099-05-01T10:00:00Z',
                    updated_at: '2099-05-02T10:00:00Z'
                };
                const assignedTo = paramFor('assigned_to');
                const pipelineStage = paramFor('pipeline_stage');
                const status = paramFor('status');
                const leadType = paramFor('lead_type');
                const lostReason = paramFor('lost_reason');
                if (assignedTo !== undefined) row.assigned_to = assignedTo;
                if (pipelineStage !== undefined) row.pipeline_stage = pipelineStage;
                if (status !== undefined) row.status = status;
                if (leadType !== undefined) row.lead_type = leadType;
                if (lostReason !== undefined) row.lost_reason = lostReason;
                return {
                    rows: [row]
                };
            }
            if (/INSERT INTO lead_interactions \(lead_id, user_id, type, summary, details, created_at\)/i.test(text)) {
                if (String(params[0]) === '501' && String(params[2] || '').includes('new -> lost')) {
                    throw new Error('route smoke interaction insert failure');
                }
                if (String(params[0]) === '503' && String(params[3] || '').includes('leads.collaboration_task')) {
                    throw new Error('route smoke collaboration audit insert failure');
                }
                return { rows: [], rowCount: 1 };
            }
            if (/FROM customers WHERE lead_id = \$1 AND COALESCE\(business_context, 'event_genix'\) = \$2 ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1/i.test(text)) {
                return { rows: [] };
            }
            if (/FROM lead_customer_links lcl\s+JOIN customers c ON c\.id = lcl\.customer_id/i.test(text)) {
                return { rows: [] };
            }
            if (/FROM customers WHERE COALESCE\(business_context, 'event_genix'\) = \$1 AND \(/i.test(text) && /regexp_replace\(COALESCE\(phone, ''\)/i.test(text)) {
                return { rows: [] };
            }
            if (/INSERT INTO customers \(business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities\)/i.test(text)) {
                return {
                    rows: [{
                        id: 8701,
                        business_context: params[0],
                        name: params[1],
                        phone: params[2],
                        instagram: params[3],
                        child_name: params[4],
                        source: params[5],
                        notes: params[6],
                        lead_id: params[7],
                        social_identities: params[8] ? JSON.parse(params[8]) : [],
                        created_at: '2099-05-02T10:05:00Z',
                        updated_at: '2099-05-02T10:05:00Z'
                    }]
                };
            }
            if (/INSERT INTO lead_customer_links \(business_context, lead_id, customer_id, link_type, source, metadata, created_by, updated_at\)/i.test(text)) {
                return {
                    rows: [{
                        id: 9901,
                        business_context: params[0],
                        lead_id: params[1],
                        customer_id: params[2],
                        link_type: params[3],
                        source: params[4],
                        metadata: params[5] ? JSON.parse(params[5]) : {},
                        created_by: params[6] || null,
                        created_at: '2099-05-02T10:05:00Z',
                        updated_at: '2099-05-02T10:05:00Z'
                    }],
                    rowCount: 1
                };
            }
            if (/INSERT INTO lead_customer_links \(business_context, lead_id, customer_id, link_type, source, metadata, updated_at\)/i.test(text)) {
                return {
                    rows: [{
                        id: 9902,
                        business_context: params[0],
                        lead_id: params[1],
                        customer_id: params[2],
                        link_type: 'booking_customer',
                        source: params[3],
                        metadata: params[4] ? JSON.parse(params[4]) : {},
                        created_by: null,
                        created_at: '2099-05-02T10:05:00Z',
                        updated_at: '2099-05-02T10:05:00Z'
                    }],
                    rowCount: 1
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
                if (params[0] === 'duplicate collaboration handoff') {
                    return {
                        rows: [{
                            id: 888,
                            title: 'Duplicate collaboration handoff',
                            status: 'todo',
                            priority: 'normal',
                            owner_user_id: 2,
                            source_type: 'lead',
                            source_id: '502'
                        }]
                    };
                }
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
        delete process.env.OPENAI_API_KEY;
        process.env.HR_VACANCY_AI_MODEL = 'route-smoke-mini';

        clearModules();
        queries = [];
        notifiedLeads = [];
        missingSchemaMigrations = new Set();
        missingSchemaColumns = new Set();

        const fakePool = createFakePool();
        installMock('../db', {
            pool: fakePool,
            query: fakePool.query.bind(fakePool),
            generateBookingNumber: fakePool.generateBookingNumber
        });
        installMock('../services/leadNotifier', {
            notifyNewLead: async lead => { notifiedLeads.push(lead); }
        });
        installMock('../services/chatService', {
            ensureDefaultMemberships: async () => {},
            getChannels: async () => [{ id: 1, name: 'General', unread: 0 }]
        });
        installMock('../services/websocket', {
            broadcast: () => {},
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
        app.use('/api/bookings', require('../routes/bookings'));
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
        missingSchemaMigrations.clear();
        missingSchemaColumns.clear();
    });

    after(async () => {
        if (server) await close(server);
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        clearModules();
    });

    it('requires auth for banquet summary endpoint', async () => {
        const res = await request('GET', '/api/bookings/BK-SUMMARY/banquet-summary?businessContext=event_genix');

        assert.equal(res.status, 401);
    });

    it('returns structured banquet summary rows with adults, linked activities, and deposit warning', async () => {
        const res = await request(
            'GET',
            '/api/bookings/BK-SUMMARY/banquet-summary?businessContext=event_genix',
            undefined,
            withAuth()
        );

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.schemaVersion, 1);
        assert.equal(res.data.bookingId, 'BK-SUMMARY');
        assert.equal(res.data.businessContext, 'event_genix');
        assert.equal(res.data.counts.adults, 4);
        assert.equal(res.data.customer.name, 'Route Smoke Customer');
        assert.equal(res.data.celebrant.name, 'Mia');
        assert.equal(res.data.orderRows.some(row => row.type === 'activity' && row.bookingId === 'BK-ACTIVITY'), true);
        assert.equal(res.data.orderRows.filter(row => row.type === 'menu').length, 2);
        assert.equal(res.data.totals.currency, 'UAH');
        assert.equal(res.data.deposit.amount, null);
        assert.ok(res.data.warnings.some(warning => warning.code === 'deposit_not_specified'));
        assert.ok(queries.some(q => /FROM booking_banquet_links/i.test(q.text)));
        const writeQueries = queries.filter(q => /\bINSERT\s+INTO\b|\bUPDATE\b|\bDELETE\b/i.test(q.text));
        const dataWriteQueries = writeQueries.filter(q =>
            !/^UPDATE employee_profiles SET last_activity_at = NOW\(\) WHERE user_id = \$1$/i.test(q.text)
            && !/^UPDATE users SET last_seen_at = NOW\(\) WHERE id = \$1$/i.test(q.text)
        );
        assert.deepEqual(dataWriteQueries.map(q => q.text), []);
    });

    it('keeps version, light health, readiness, and deep health public through the actual settings router', async () => {
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
        assert.equal(health.data.schema, undefined);

        const ready = await request('GET', '/api/ready');
        assert.equal(ready.status, 200, JSON.stringify(ready.data));
        assert.equal(ready.data.status, 'ok');
        assert.equal(ready.data.schema.status, 'ok');
        assert.equal(ready.data.schema.dataMigrations['261_leads_customer_card_canonical_customers'], true);
        assert.deepEqual(ready.data.schema.pendingDataMigrations, []);

        const deep = await request('GET', '/api/health/deep');
        assert.equal(deep.status, 200, JSON.stringify(deep.data));
        assert.equal(deep.data.status, 'ok');
        assert.equal(deep.data.schema.status, 'ok');
    });

    it('reports pending data-only migrations without failing readiness', async () => {
        missingSchemaMigrations.add('261_leads_customer_card_canonical_customers');

        const ready = await request('GET', '/api/ready');
        assert.equal(ready.status, 200, JSON.stringify(ready.data));
        assert.equal(ready.data.status, 'ok');
        assert.equal(ready.data.schema.status, 'ok');
        assert.equal(ready.data.schema.dataMigrations['261_leads_customer_card_canonical_customers'], false);
        assert.deepEqual(ready.data.schema.pendingDataMigrations, ['261_leads_customer_card_canonical_customers']);
        assert.ok(ready.data.schema.warnings.includes('pending-data-migration:261_leads_customer_card_canonical_customers'));
        assert.deepEqual(ready.data.schema.missing, []);
    });

    it('reports degraded schema health when required timeline/lead columns are missing', async () => {
        missingSchemaColumns.add('booking_banquet_links.relation_type');
        missingSchemaMigrations.add('262_leads_customer_links_and_value');

        const health = await request('GET', '/api/health');
        assert.equal(health.status, 200, JSON.stringify(health.data));
        assert.equal(health.data.database, 'connected');
        assert.equal(health.data.status, 'ok');
        assert.equal(health.data.schema, undefined);

        const ready = await request('GET', '/api/ready');
        assert.equal(ready.status, 503, JSON.stringify(ready.data));
        assert.equal(ready.data.status, 'degraded');
        assert.equal(ready.data.schema.status, 'degraded');
        assert.ok(ready.data.schema.missing.includes('column:booking_banquet_links.relation_type'));
        assert.ok(ready.data.schema.missing.includes('migration:262_leads_customer_links_and_value'));

        const deep = await request('GET', '/api/health/deep');
        assert.equal(deep.status, 200, JSON.stringify(deep.data));
        assert.equal(deep.data.status, 'degraded');
        assert.equal(deep.data.schema.status, 'degraded');
        assert.ok(deep.data.schema.missing.includes('column:booking_banquet_links.relation_type'));
        assert.ok(deep.data.schema.missing.includes('migration:262_leads_customer_links_and_value'));
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

    it('keeps universal webhook readiness status public and read-only', async () => {
        const res = await request('GET', '/api/leads/webhook/status');

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.webhooks.universal.configured, true);
        assert.equal(res.data.webhooks.universal.endpoint, '/api/leads/webhook/universal?source=<name>');
        assert.ok(res.data.webhooks.universal.sources.includes('maysternya_bot'));
        assert.ok(res.data.webhooks.universal.sources.includes('maysternya_site'));
        assert.match(res.data.webhooks.universal.dryRun, /dryRun=true/);
        assert.equal(res.data.webhooks.maysternyaBooking.endpoint, '/api/leads/webhook/maysternya-booking');
        assert.equal(res.data.webhooks.maysternyaBooking.businessContext, 'maysternya_doli');
        assert.equal(res.data.webhooks.maysternyaAvailability.endpoint, '/api/leads/webhook/maysternya-availability');
        assert.equal(res.data.webhooks.maysternyaAvailability.businessContext, 'maysternya_doli');
        assert.equal(queries.length, 0);
    });

    it('creates Maysternya Doli timeline bookings through the token-guarded booking webhook', async () => {
        const res = await request('POST', '/api/leads/webhook/maysternya-booking', {
            external_id: 'md-booking-1',
            date: '2099-06-14',
            time: '14:00',
            duration: 60,
            resource_id: 'md-consult-room',
            programId: 'natal-chart',
            programCode: 'NATAL',
            programName: 'Натальна карта',
            category: 'consultation',
            price: 1800,
            customer: {
                name: 'Марія Тест',
                phone: '+380501112233',
                email: 'maria@example.com',
                whatsapp: '+380501112244',
                contactChannels: ['telegram', 'whatsapp', 'email']
            },
            telegram: {
                id: '123456789',
                username: 'maria_test'
            },
            notes: 'Оплата в боті'
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.created, true);
        assert.equal(res.data.businessContext, 'maysternya_doli');
        assert.equal(res.data.resourceId, 'md-consult-room');
        assert.equal(res.data.resourceName, 'Олександр');
        assert.equal(res.data.leadId, 602);
        assert.equal(res.data.leadCreated, true);
        assert.equal(res.data.customerLinked, true);
        assert.equal(res.data.lead.id, 602);
        assert.equal(res.data.lead.created, true);
        assert.equal(res.data.lead.attached, true);
        assert.equal(res.data.lead.customerLinked, true);
        assert.equal(res.data.booking.businessContext, 'maysternya_doli');
        assert.equal(res.data.booking.status, 'confirmed');
        assert.equal(res.data.booking.createdBy, 'maysternya_bot');
        assert.equal(res.data.booking.lineId, 'md-consult-room');
        assert.equal(res.data.booking.lineName, 'Олександр');

        const insert = queries.find(q => /INSERT INTO bookings\s+\(id, business_context, date, time, line_id/i.test(q.text));
        assert.ok(insert);
        assert.equal(insert.params[1], 'maysternya_doli');
        assert.equal(insert.params[4], 'md-consult-room');
        assert.equal(insert.params[23], 'maysternya_bot');
        assert.equal(insert.params[25], 'confirmed');
        const extraData = JSON.parse(insert.params[28]);
        assert.equal(extraData.source, 'maysternya_bot');
        assert.equal(extraData.externalId, 'md-booking-1');
        assert.equal(extraData.timelineIdentity.resourceName, 'Олександр');

        assert.ok(queries.some(q => /INSERT INTO customers \(business_context, name, phone/i.test(q.text)));
        const leadInsert = queries.find(q => /INSERT INTO leads/i.test(q.text) && /booking_id/i.test(q.text) && /raw_payload/i.test(q.text));
        assert.ok(leadInsert);
        assert.equal(leadInsert.params[3], '123456789');
        assert.equal(leadInsert.params[5], 'maysternya_bot');
        assert.equal(leadInsert.params[6], 'maysternya_bot');
        assert.equal(leadInsert.params[7], 'md-booking-1');
        assert.equal(leadInsert.params[13], 'new');
        assert.equal(leadInsert.params[14], 'new');
        const leadRawPayload = JSON.parse(leadInsert.params[12]);
        assert.equal(leadRawPayload.email, 'maria@example.com');
        assert.equal(leadRawPayload.whatsapp, '+380501112244');
        assert.ok(leadRawPayload.contact_channels.includes('telegram'));
        assert.ok(leadRawPayload.contact_channels.includes('whatsapp'));
        assert.ok(leadRawPayload.contact_channels.includes('email'));
        assert.equal(leadRawPayload.normalized.source_channel, 'maysternya_bot');
        assert.equal(leadRawPayload.normalized.telegram_username, 'maria_test');
        assert.ok(queries.some(q => /INSERT INTO history \(business_context, action, username, data\)/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO outbox_events/i.test(q.text)));
    });

    it('keeps Maysternya bot booking webhook idempotent by external id', async () => {
        const res = await request('POST', '/api/leads/webhook/maysternya-booking', {
            external_id: 'md-booking-1',
            date: '2099-06-14',
            time: '14:00',
            duration: 60,
            resource_id: 'md-consult-room',
            programName: 'Натальна карта',
            customer: { name: 'Марія Тест' }
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.created, false);
        assert.equal(res.data.bookingId, 'BK-2099-0001');
        assert.equal(res.data.leadId, 602);
        assert.equal(res.data.lead?.attached, true);
        assert.ok(!queries.some(q => /INSERT INTO bookings\s+\(id, business_context, date, time, line_id/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO leads/i.test(q.text) && /booking_id/i.test(q.text) && /raw_payload/i.test(q.text)));
    });

    it('validates Maysternya bot booking webhook in dry-run mode without writing', async () => {
        const res = await request('POST', '/api/leads/webhook/maysternya-booking?dryRun=true', {
            external_id: 'md-booking-dry',
            date: '2099-06-15',
            time: '10:00',
            duration: 45,
            resource_name: 'Олександр',
            service: { name: 'Таро консультація', code: 'TARO', price: 1200 },
            customer: { name: 'Dry Run' }
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.dryRun, true);
        assert.equal(res.data.created, false);
        assert.equal(res.data.resourceId, 'md-consult-room');
        assert.equal(res.data.resourceName, res.data.preview.resourceName);
        assert.equal(res.data.preview.resourceId, 'md-consult-room');
        assert.equal(res.data.preview.resourceName, 'Олександр');
        assert.equal(res.data.preview.programName, 'Таро консультація');
        assert.equal(res.data.preview.programCode, 'TARO');
        assert.ok(!queries.some(q => /INSERT INTO bookings\s+\(id, business_context, date, time, line_id/i.test(q.text)));
    });

    it('rejects Maysternya bot booking when required lead handoff fails', async () => {
        const res = await request('POST', '/api/leads/webhook/maysternya-booking', {
            external_id: 'md-booking-lead-side-effect-fail',
            date: '2099-06-16',
            time: '09:00',
            duration: 60,
            resource_id: 'md-consult-room',
            programName: 'Side Effect Smoke',
            customer: { name: 'Lead Side Effect Fails' }
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 500, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.equal(res.data.code, 'booking_lead_handoff_failed');
        assert.ok(queries.some(q => /INSERT INTO bookings\s+\(id, business_context, date, time, line_id/i.test(q.text)));
        assert.ok(queries.some(q => /^ROLLBACK$/i.test(q.text)));
        assert.ok(!queries.some(q => /^COMMIT$/i.test(q.text)));
        assert.ok(!queries.some(q => /INSERT INTO history \(business_context, action, username, data\)/i.test(q.text)));
    });

    it('truncates Maysternya bot booking payload fields to CRM column limits', async () => {
        const longCustomerName = `Long Customer ${'x'.repeat(260)}`;
        const longProgramName = `Long Program ${'p'.repeat(160)}`;
        const longProgramId = `program-${'i'.repeat(80)}`;
        const longProgramCode = `CODE-${'c'.repeat(40)}`;
        const longCategory = `category-${'c'.repeat(80)}`;
        const longRoom = `Room ${'r'.repeat(140)}`;
        const longPaymentMethod = `method-${'m'.repeat(50)}`;
        const longPhone = `+${'3'.repeat(80)}`;

        const res = await request('POST', '/api/leads/webhook/maysternya-booking', {
            external_id: 'md-booking-long-fields',
            date: '2099-06-17',
            time: '11:00',
            duration: 60,
            resource_id: 'md-consult-room',
            programId: longProgramId,
            programCode: longProgramCode,
            programName: longProgramName,
            category: longCategory,
            room: longRoom,
            payment_method: longPaymentMethod,
            customer: {
                name: longCustomerName,
                phone: longPhone
            }
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));

        const bookingInsert = queries.find(q => {
            if (!/INSERT INTO bookings\s+\(id, business_context, date, time, line_id/i.test(q.text)) return false;
            return JSON.parse(q.params[28] || '{}').externalId === 'md-booking-long-fields';
        });
        const customerInsert = queries.find(q =>
            /INSERT INTO customers \(business_context, name, phone, instagram, child_name, child_birthday, source\)/i.test(q.text)
            && String(q.params[1] || '').startsWith('Long Customer')
        );

        assert.ok(bookingInsert);
        assert.ok(customerInsert);
        assert.equal(customerInsert.params[1].length, 200);
        assert.equal(customerInsert.params[2].length, 30);
        assert.equal(bookingInsert.params[5].length, 50);
        assert.equal(bookingInsert.params[6].length, 20);
        assert.equal(bookingInsert.params[7].length, 100);
        assert.equal(bookingInsert.params[8].length, 100);
        assert.equal(bookingInsert.params[9].length, 50);
        assert.equal(bookingInsert.params[21].length, 100);
        assert.equal(bookingInsert.params[27].length, 100);
        assert.equal(bookingInsert.params[31].length, 30);
    });

    it('rejects Maysternya bot booking webhook without provider token', async () => {
        const res = await request('POST', '/api/leads/webhook/maysternya-booking', {
            external_id: 'md-no-token'
        });

        assert.equal(res.status, 401);
    });

    it('rejects incomplete Maysternya bot booking payloads with missing fields', async () => {
        const res = await request('POST', '/api/leads/webhook/maysternya-booking', {
            external_id: 'md-missing-fields',
            date: '2099-06-14'
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 400, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.equal(res.data.code, 'missing_fields');
        assert.ok(res.data.missingFields.includes('time'));
        assert.ok(res.data.missingFields.includes('resource_id'));
        assert.ok(res.data.missingFields.includes('customer'));
    });

    it('returns conflict details when Maysternya bot booking slot is occupied', async () => {
        const res = await request('POST', '/api/leads/webhook/maysternya-booking', {
            external_id: 'md-booking-conflict',
            date: '2099-06-14',
            time: '14:30',
            duration: 30,
            resource_id: 'md-consult-room',
            programName: 'Повторна консультація',
            customer: { name: 'Конфлікт' }
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.equal(res.data.code, 'booking_time_conflict');
        assert.equal(res.data.conflictBookingId, 'BK-2099-0001');
    });

    it('returns Maysternya availability slots with conflict booking ids', async () => {
        const res = await request('POST', '/api/leads/webhook/maysternya-availability', {
            date_from: '2099-06-14',
            date_to: '2099-06-14',
            duration: 60,
            resource_id: 'md-consult-room',
            timezone: 'Europe/Kyiv',
            business_context: 'maysternya_doli'
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.businessContext, 'maysternya_doli');
        assert.equal(res.data.resourceId, 'md-consult-room');
        assert.equal(res.data.resourceName, 'Олександр');
        assert.equal(res.data.duration, 60);
        assert.ok(Array.isArray(res.data.slots));
        assert.ok(res.data.slots.length > 0);

        const occupied = res.data.slots.find(slot => slot.date === '2099-06-14' && slot.time === '14:00');
        assert.ok(occupied, '14:00 slot should be present');
        assert.equal(occupied.available, false);
        assert.equal(occupied.conflictBookingId, 'BK-2099-0001');

        const free = res.data.slots.find(slot => slot.date === '2099-06-14' && slot.time === '15:00');
        assert.ok(free, '15:00 slot should be present');
        assert.equal(free.available, true);
        assert.equal(free.conflictBookingId, null);
        assert.equal(res.data.days[0].date, '2099-06-14');
    });

    it('rejects Maysternya availability webhook without provider token', async () => {
        const res = await request('POST', '/api/leads/webhook/maysternya-availability', {
            date_from: '2099-06-14',
            date_to: '2099-06-14',
            duration: 60,
            resource_id: 'md-consult-room'
        });

        assert.equal(res.status, 401);
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

    it('accepts Maysternya Doli bot CRM event envelopes and preserves hook metadata', async () => {
        const res = await request('POST', '/api/leads/webhook/universal?source=maysternya_bot', {
            event_type: 'lead_submitted',
            event_id: 'evt-md-1',
            payload: {
                lead: {
                    external_id: 'bot-envelope-1',
                    name: 'Олена Бот',
                    telegram: {
                        id: '987654321',
                        username: 'olena_bot'
                    }
                },
                booking: {
                    id: 'bk-101',
                    date: '2026-06-20',
                    time: '15:30',
                    service: 'Натальна карта'
                },
                request_topic: 'Натальна карта',
                message: 'Прийшло з бота'
            }
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.created, true);

        const insert = queries.find(q => /INSERT INTO leads/i.test(q.text) && /source_channel/i.test(q.text));
        assert.ok(insert);
        assert.equal(insert.params[0], 'maysternya_doli');
        assert.equal(insert.params[1], 'Олена Бот');
        assert.equal(insert.params[3], '987654321');
        assert.equal(insert.params[5], 'maysternya_bot');
        assert.equal(insert.params[6], 'bot-envelope-1');
        assert.match(insert.params[7], /CRM event: lead_submitted/);
        assert.match(insert.params[7], /Booking ID: bk-101/);
        assert.match(insert.params[7], /Запис: 2026-06-20 15:30/);
        const rawPayload = JSON.parse(insert.params[8]);
        assert.equal(rawPayload.event_type, 'lead_submitted');
        assert.equal(rawPayload.normalized.crm_event_type, 'lead_submitted');
        assert.equal(rawPayload.normalized.crm_event_id, 'evt-md-1');
        assert.equal(rawPayload.normalized.crm_booking_id, 'bk-101');
        assert.equal(rawPayload.normalized.booking_date, '2026-06-20');
        assert.equal(rawPayload.normalized.booking_time, '15:30');
    });

    it('routes Maysternya Doli website leads into the Maysternya business context', async () => {
        const res = await request('POST', '/api/leads/webhook/universal?source=maysternya_site', {
            external_id: 'site-inquiry-1',
            name: 'Site Lead',
            contact: '+380501112255',
            email: 'site@example.com',
            page: 'https://www.maisterniadoli.com/',
            contact_channels: ['site_form', 'whatsapp'],
            utm: {
                source: 'google',
                medium: 'cpc',
                campaign: 'natal'
            },
            message: 'Website inquiry'
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`,
            'X-Business-Context': 'event_genix'
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.created, true);

        const insert = queries.find(q => /INSERT INTO leads/i.test(q.text) && /source_channel/i.test(q.text));
        assert.ok(insert);
        assert.equal(insert.params[0], 'maysternya_doli');
        assert.equal(insert.params[2], '+380501112255');
        assert.equal(insert.params[5], 'maysternya_site');
        assert.equal(insert.params[6], 'site-inquiry-1');
        const rawPayload = JSON.parse(insert.params[8]);
        assert.equal(rawPayload.contact, '+380501112255');
        assert.equal(rawPayload.page, 'https://www.maisterniadoli.com/');
        assert.deepEqual(rawPayload.contact_channels, ['site_form', 'whatsapp']);
        assert.deepEqual(rawPayload.utm, { source: 'google', medium: 'cpc', campaign: 'natal' });
    });

    it('creates a new website lead for repeat phone submissions without external_id', async () => {
        const res = await request('POST', '/api/leads/webhook/universal?source=maysternya_site', {
            name: 'Repeat Phone Lead',
            contact: '+380501112255',
            message: 'New inquiry from the same phone'
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.created, true);

        const phoneLookup = queries.find(q => /regexp_replace\(COALESCE\(phone/i.test(q.text));
        assert.equal(phoneLookup, undefined, 'webhook dedup must not merge repeat leads by phone');
        const insert = queries.find(q => /INSERT INTO leads/i.test(q.text) && /source_channel/i.test(q.text));
        assert.ok(insert);
        assert.equal(insert.params[2], '+380501112255');
        assert.equal(insert.params[6], null);
    });

    it('validates universal website leads in dry-run mode without writing to the CRM', async () => {
        const res = await request('POST', '/api/leads/webhook/universal?source=maysternya_site&dryRun=true', {
            external_id: 'site-dry-run',
            name: 'Dry Run Lead',
            phone: '+380501112266',
            topic: 'Dry topic',
            message: 'Dry message',
            page: 'https://www.maisterniadoli.com/',
            contact_channels: ['site_form'],
            utm: { source: 'codex' }
        }, {
            Authorization: `Bearer ${TEST_UNIVERSAL_WEBHOOK_TOKEN}`
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.dryRun, true);
        assert.equal(res.data.created, false);
        assert.equal(res.data.lead, null);
        assert.equal(res.data.preview.businessContext, 'maysternya_doli');
        assert.equal(res.data.preview.sourceChannel, 'maysternya_site');
        assert.equal(res.data.preview.externalId, 'site-dry-run');
        assert.equal(res.data.preview.topic, 'Dry topic');
        assert.equal(res.data.preview.message, 'Dry message');
        assert.deepEqual(res.data.preview.contactChannels, ['site_form']);
        assert.deepEqual(res.data.preview.utm, { source: 'codex' });
        assert.equal(queries.length, 0);
        assert.equal(notifiedLeads.length, 0);
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
        assert.equal(lookup.params[2], 'maysternya_bot');

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

    it('blocks HR-only offboarding from disabling linked CRM accounts without manage_accounts', async () => {
        queries.length = 0;
        const res = await request('POST', '/api/hr/staff/42/offboarding', {
            effective_date: '2099-06-06',
            target_pool_status: 'reserve',
            account_action: 'disable',
            reason: 'HR cannot disable CRM account directly'
        }, withAuth({}, 'hr'));

        assert.equal(res.status, 403, JSON.stringify(res.data));
        assert.match(res.data.error, /manage_accounts/);
        assert.equal(queries.some(q => /UPDATE users SET is_active = false/i.test(q.text)), false);
        assert.equal(queries.some(q => /INSERT INTO staff_offboarding_events/i.test(q.text)), false);
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
        assert.deepEqual(res.data.schedule_cleanup, { hr_shifts: 2, staff_schedule: 3, from_date: '2099-06-06' });
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

    it('keeps HR-only rehire from reactivating linked CRM accounts without manage_accounts', async () => {
        queries.length = 0;
        const res = await request('PUT', '/api/hr/staff/46/status', {
            is_active: true
        }, withAuth({}, 'hr'));

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.reactivated_accounts, 0);
        assert.equal(res.data.account_reactivation_blocked, true);
        assert.equal(res.data.account_reactivation_blockers[0].block_reason, 'requires_manage_accounts');
        assert.equal(queries.some(q => /UPDATE users SET is_active = true/i.test(q.text)), false);
        assert.equal(queries.some(q => /UPDATE employee_profiles SET is_active = true/i.test(q.text)), false);
    });

    it('lets account managers reactivate linked CRM accounts during staff rehire', async () => {
        queries.length = 0;
        const res = await request('PUT', '/api/hr/staff/47/status', {
            is_active: true
        }, withAuth());

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.reactivated_accounts, 1);
        assert.deepEqual(res.data.reactivated_account_usernames, ['rehire.creator.allowed']);
        assert.equal(res.data.account_reactivation_blocked, false);
        assert.ok(queries.some(q => /UPDATE employee_profiles SET is_active = true WHERE staff_id = \$1 AND user_id = ANY\(\$2::int\[\]\)/i.test(q.text)));
        assert.ok(queries.some(q => /UPDATE users SET is_active = true WHERE id = ANY\(\$1::int\[\]\)/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO account_security_events/i.test(q.text) && q.params[4] === 'account_activated' && q.params[5] === 'hr_rehire'));
    });

    it('assigns HR onboarding responsible owners and syncs canonical tasks without duplicates', async () => {
        const owners = await request('GET', '/api/hr/onboarding/responsible-candidates', undefined, withAuth());
        assert.equal(owners.status, 200, JSON.stringify(owners.data));
        assert.equal(owners.data.success, true);
        assert.deepEqual(owners.data.data.map(user => user.id), [2, 3]);
        assert.equal(owners.data.meta.canonicalOwnerField, 'tasks.owner_user_id');

        queries.length = 0;
        const rejectedStart = await request('POST', '/api/hr/onboarding/start', {
            staff_id: 45,
            template_id: 11
        }, withAuth());
        assert.equal(rejectedStart.status, 400, JSON.stringify(rejectedStart.data));
        assert.match(rejectedStart.data.error, /responsible_user_id/);
        assert.equal(queries.some(q => /INSERT INTO onboarding_progress/i.test(q.text)), false);
        assert.equal(queries.some(q => /INSERT INTO tasks \((?:business_context, )?title, description, date, priority/i.test(q.text)), false);

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
        assert.ok(queries.some(q => /^BEGIN$/i.test(q.text)));
        assert.ok(queries.some(q => /^COMMIT$/i.test(q.text)));
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
        assert.equal(queries.filter(q => /INSERT INTO task_action_history/i.test(q.text) && q.params[1] === 'task_owner_reassigned').length, 4);

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

    it('paginates lead kanban rows beyond the old 200 hard cap and keeps budget metadata', async () => {
        queries.length = 0;
        const res = await request('GET', '/api/leads?order=kanban&limit=999&offset=500', undefined, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.leads.length, 150);
        assert.equal(res.data.leads[0].budget_approx, 1200);
        assert.deepEqual(res.data.pagination, {
            total: 650,
            limit: 500,
            offset: 500,
            nextOffset: 650,
            hasMore: false
        });
        const listQuery = queries.find(q => /COALESCE\(l\.potential_value, latest_card\.budget_approx\) AS budget_approx/i.test(q.text));
        assert.ok(listQuery);
        assert.equal(listQuery.params.at(-2), 500);
        assert.equal(listQuery.params.at(-1), 500);
    });

    it('treats empty lead_type as quality in the lead list filter', async () => {
        queries.length = 0;
        const res = await request('GET', '/api/leads?lead_type=quality&limit=500&offset=0', undefined, withAuth({}, 'manager'));

        assert.equal(res.status, 200, JSON.stringify(res.data));
        const listQuery = queries.find(q => /FROM leads l/i.test(q.text) && /ORDER BY l\.created_at DESC/i.test(q.text));
        assert.ok(listQuery);
        assert.match(listQuery.text, /COALESCE\(NULLIF\(l\.lead_type, ''\), 'quality'\) = \$\d+/i);
    });

    it('composes the lead manager workspace from the canonical pipeline stage', async () => {
        const res = await request('GET', '/api/leads/501/workspace', undefined, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.workspace.canonical.statusField, 'pipeline_stage');
        assert.equal(res.data.workspace.canonical.stage, 'contacted');
        assert.equal(res.data.workspace.canonical.aggregateStatus, 'contact');
        assert.equal(res.data.workspace.lead.businessContext, 'event_genix');
        assert.equal(res.data.workspace.lead.externalId, 'workspace-external');
        assert.equal(res.data.workspace.lead.inquiryId, 'workspace-inquiry');
        assert.equal(res.data.workspace.lead.page, 'https://www.maisterniadoli.com/');
        assert.equal(res.data.workspace.lead.topic, 'Натальна консультація');
        assert.equal(res.data.workspace.lead.message, 'Хочу запис у Майстерні');
        assert.equal(res.data.workspace.lead.sessionType, 'full');
        assert.deepEqual(res.data.workspace.lead.contactChannels, ['site_form', 'whatsapp']);
        assert.deepEqual(res.data.workspace.lead.utm, { source: 'google', campaign: 'natal' });
        assert.equal(res.data.workspace.customer.id, 701);
        assert.equal(res.data.workspace.bookings[0].id, 'BK-WS');
        assert.equal(res.data.workspace.tasks[0].sourceType, 'lead');
        assert.equal(res.data.workspace.conversations[0].channel, 'telegram');
        assert.equal(res.data.workspace.conversations[0].confidence, 'exact');
        assert.equal(res.data.workspace.conversations[0].replyOwner, 'Dasha Manager');
        assert.equal(res.data.workspace.conversations[0].replyOwnerUserId, 2);
    });

    it('creates and returns a customer card when a lead moves to deal', async () => {
        queries.length = 0;
        const res = await request('PATCH', '/api/leads/501', { pipeline_stage: 'deal' }, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.lead.pipeline_stage, 'deal');
        assert.equal(res.data.customer.id, 8701);
        assert.equal(res.data.customer.name, 'Lead Smoke');
        assert.equal(res.data.customer.leadId, 501);
        assert.equal(res.data.customerLinkMode, 'created_new');
        assert.ok(queries.some(q => /^BEGIN$/i.test(q.text)));
        assert.ok(queries.some(q => /^COMMIT$/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO customers \(business_context, name, phone, instagram, child_name, source, notes, lead_id, social_identities\)/i.test(q.text)));
        const linkInsert = queries.find(q => /INSERT INTO lead_customer_links \(business_context, lead_id, customer_id, link_type, source, metadata, created_by, updated_at\)/i.test(q.text));
        assert.ok(linkInsert, 'deal conversion should persist durable lead/customer link');
        assert.equal(linkInsert.params[1], 501);
        assert.equal(linkInsert.params[2], 8701);
        assert.equal(linkInsert.params[3], 'deal_customer');
        const stageLog = queries.find(q => /INSERT INTO lead_interactions \(lead_id, user_id, type, summary, details, created_at\)/i.test(q.text));
        assert.ok(stageLog, 'stage change should be written to lead_interactions');
        assert.equal(stageLog.params[0], 501);
        assert.equal(stageLog.params[2], 'Pipeline: new -> deal');
        assert.deepEqual(JSON.parse(stageLog.params[3]), {
            oldStage: 'new',
            newStage: 'deal',
            oldStatus: 'new',
            newStatus: 'proposal',
            source: 'leads.patch'
        });
    });

    it('rolls back a lead stage change when the interaction audit cannot be written', async () => {
        queries.length = 0;
        const res = await request('PATCH', '/api/leads/501', { pipeline_stage: 'lost' }, withAuth({}, 'manager'));
        assert.equal(res.status, 500, JSON.stringify(res.data));
        assert.ok(queries.some(q => /^BEGIN$/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO lead_interactions \(lead_id, user_id, type, summary, details, created_at\)/i.test(q.text)));
        assert.ok(queries.some(q => /^ROLLBACK$/i.test(q.text)));
        assert.ok(!queries.some(q => /^COMMIT$/i.test(q.text)));
    });

    it('keeps pipeline_stage canonical when legacy status conflicts', async () => {
        queries.length = 0;
        const res = await request('PATCH', '/api/leads/501', { pipeline_stage: 'contacted', status: 'lost' }, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.lead.pipeline_stage, 'contacted');
        assert.equal(res.data.lead.status, 'contact');
    });

    it('maps legacy lead status updates to canonical pipeline stages', async () => {
        queries.length = 0;
        const res = await request('PATCH', '/api/leads/501', { status: 'booked' }, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.lead.pipeline_stage, 'deposit_received');
        assert.equal(res.data.lead.status, 'booked');
    });

    it('rejects unknown lead status values instead of storing arbitrary statuses', async () => {
        const res = await request('PATCH', '/api/leads/501', { status: 'whatever' }, withAuth({}, 'manager'));
        assert.equal(res.status, 400, JSON.stringify(res.data));
    });

    it('rejects unknown lead_type values instead of storing arbitrary classifications', async () => {
        const res = await request('PATCH', '/api/leads/501', { lead_type: 'maybe_spam' }, withAuth({}, 'manager'));
        assert.equal(res.status, 400, JSON.stringify(res.data));
    });

    it('routes spam leads out of the active pipeline without adding them to mailing', async () => {
        queries.length = 0;
        const res = await request('PATCH', '/api/leads/502', { lead_type: 'spam' }, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.lead.lead_type, 'spam');
        assert.equal(res.data.lead.pipeline_stage, 'lost');
        assert.equal(res.data.lead.status, 'lost');
        assert.equal(res.data.lead.lost_reason, 'Спам');
        assert.ok(!queries.some(q => /INSERT INTO mailing_list/i.test(q.text)));
    });

    it('preserves explicit lead_type workflow lost_reason from the manager reason modal', async () => {
        queries.length = 0;
        const res = await request('PATCH', '/api/leads/502', {
            lead_type: 'spam',
            lost_reason: 'Дубль'
        }, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.lead.lead_type, 'spam');
        assert.equal(res.data.lead.pipeline_stage, 'lost');
        assert.equal(res.data.lead.status, 'lost');
        assert.equal(res.data.lead.lost_reason, 'Дубль');
    });

    it('skips backend collaboration auto-task when the frontend already created the linked task', async () => {
        queries.length = 0;
        const res = await request('PATCH', '/api/leads/502', {
            lead_type: 'collaboration',
            collaboration_task_created: true,
            collaboration_task_id: 880
        }, withAuth({}, 'manager'));
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.lead.lead_type, 'collaboration');
        assert.equal(res.data.lead.pipeline_stage, 'contacted');
        assert.equal(res.data.lead.status, 'contact');
        assert.ok(!queries.some(q => /INSERT INTO tasks/i.test(q.text)), 'backend fallback must not create a duplicate collaboration task');
    });

    it('atomically creates a collaboration task and moves the lead in one transaction', async () => {
        queries.length = 0;
        const res = await request('POST', '/api/leads/502/collaboration-task', {
            title: 'Atomic collaboration handoff',
            ownerUserId: 2,
            deadline: '2099-05-03T12:00',
            priority: 'high',
            comment: 'Partner request'
        }, withAuth({}, 'manager'));

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.meta.atomic, true);
        assert.equal(res.data.meta.taskCreatedBy, 'backend');
        assert.equal(res.data.task.source_type, 'lead');
        assert.equal(res.data.task.source_id, '502');
        assert.equal(res.data.task.owner_user_id, 2);
        assert.equal(res.data.lead.lead_type, 'collaboration');
        assert.equal(res.data.lead.pipeline_stage, 'contacted');
        assert.equal(res.data.lead.status, 'contact');
        assert.ok(queries.some(q => /^BEGIN$/i.test(q.text)));
        assert.ok(queries.some(q => /^COMMIT$/i.test(q.text)));
        assert.ok(!queries.some(q => /^ROLLBACK$/i.test(q.text)));

        const taskInsertIndex = queries.findIndex(q => /INSERT INTO tasks \((?:business_context, )?title, description, date, priority/i.test(q.text));
        const leadUpdateIndex = queries.findIndex(q => /UPDATE leads SET lead_type = \$1, pipeline_stage = \$2, status = \$3/i.test(q.text));
        const interactionIndex = queries.findIndex(q => /INSERT INTO lead_interactions \(lead_id, user_id, type, summary, details, created_at\)/i.test(q.text)
            && q.params[2] === 'Lead type workflow: quality -> collaboration');
        assert.ok(taskInsertIndex >= 0, 'collaboration task should be inserted');
        assert.ok(leadUpdateIndex > taskInsertIndex, 'lead update should happen after task insert in the same transaction');
        assert.ok(interactionIndex > leadUpdateIndex, 'workflow audit should be logged after lead update');
        const details = JSON.parse(queries[interactionIndex].params[3]);
        assert.equal(details.source, 'leads.collaboration_task');
        assert.equal(details.taskId, res.data.task.id);
        assert.equal(details.newLeadType, 'collaboration');
    });

    it('rejects duplicate collaboration tasks without changing the lead', async () => {
        queries.length = 0;
        const res = await request('POST', '/api/leads/502/collaboration-task', {
            title: 'Duplicate collaboration handoff',
            ownerUserId: 2,
            deadline: '2099-05-03T12:00'
        }, withAuth({}, 'manager'));

        assert.equal(res.status, 409, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.equal(res.data.code, 'TASK_DUPLICATE_ACTIVE');
        assert.equal(res.data.existingId, 888);
        assert.ok(queries.some(q => /^BEGIN$/i.test(q.text)));
        assert.ok(queries.some(q => /^ROLLBACK$/i.test(q.text)));
        assert.ok(!queries.some(q => /^COMMIT$/i.test(q.text)));
        assert.ok(!queries.some(q => /INSERT INTO tasks/i.test(q.text)));
        assert.ok(!queries.some(q => /UPDATE leads SET lead_type = \$1, pipeline_stage = \$2, status = \$3/i.test(q.text)));
    });

    it('rolls back collaboration handoff when the workflow audit cannot be written', async () => {
        queries.length = 0;
        const res = await request('POST', '/api/leads/503/collaboration-task', {
            title: 'Collaboration audit rollback',
            ownerUserId: 2,
            deadline: '2099-05-03T12:00'
        }, withAuth({}, 'manager'));

        assert.equal(res.status, 500, JSON.stringify(res.data));
        assert.equal(res.data.success, false);
        assert.ok(queries.some(q => /^BEGIN$/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO tasks \((?:business_context, )?title, description, date, priority/i.test(q.text)));
        assert.ok(queries.some(q => /UPDATE leads SET lead_type = \$1, pipeline_stage = \$2, status = \$3/i.test(q.text)));
        assert.ok(queries.some(q => /INSERT INTO lead_interactions \(lead_id, user_id, type, summary, details, created_at\)/i.test(q.text)));
        assert.ok(queries.some(q => /^ROLLBACK$/i.test(q.text)));
        assert.ok(!queries.some(q => /^COMMIT$/i.test(q.text)));
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

    it('prepares HR vacancy platform templates and AI formatting preview', async () => {
        const templates = await request('GET', '/api/hr/vacancy-platforms', undefined, withAuth());
        assert.equal(templates.status, 200, JSON.stringify(templates.data));
        assert.equal(templates.data.success, true);
        assert.equal(templates.data.ai.model, 'route-smoke-mini');
        assert.equal(templates.data.ai.configured, false);
        assert.ok(templates.data.templates.some(template => template.id === 'workua'));
        assert.ok(templates.data.templates.some(template => template.id === 'instagram'));

        const preview = await request('POST', '/api/hr/vacancy-platforms/format-preview', {
            platform: 'telegram',
            vacancy: {
                title: 'Офіціант',
                role_type: 'waiter',
                schedule: '4-8 год/день',
                salary_from: 12000,
                salary_to: 18000,
                description: 'Гості, сервіс, робота в команді'
            },
            source_text: 'Потрібна людина на вихідні.'
        }, withAuth());
        assert.equal(preview.status, 200, JSON.stringify(preview.data));
        assert.equal(preview.data.success, true);
        assert.equal(preview.data.platform, 'telegram');
        assert.equal(preview.data.ai_used, false);
        assert.equal(preview.data.ai_model, 'deterministic-template');
        assert.match(preview.data.formatted_text, /Офіціант/);
        assert.match(preview.data.prompt, /Telegram/);
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
