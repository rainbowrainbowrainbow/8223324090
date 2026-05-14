const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { apiAuthBoundary } = require('../middleware/apiAuthBoundary');

const TEST_JWT_SECRET = 'work-queue-test-secret';

let server;
let baseUrl;
let queries;

const originalJwtSecret = process.env.JWT_SECRET;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../services/workQueue',
        '../services/queueIntelligence',
        '../services/omni-hub',
        '../services/replyEscalation',
        '../services/replyActionHistory',
        '../routes/work-queue'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

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

function tokenFor(role = 'manager') {
    return jwt.sign(
        { id: role === 'manager' ? 20 : 14, username: `${role}-user`, name: `${role} user`, role },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function request(path, role = 'manager', options = {}) {
    const headers = role ? { Authorization: `Bearer ${tokenFor(role)}` } : {};
    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

function createFakePool() {
    function replyRow(overrides = {}) {
        return {
            id: overrides.conversation_id || 41,
            conversation_id: 41,
            channel: 'viber',
            customer_name: 'Reply Client',
            customer_phone: '+380000000041',
            customer_id: 401,
            assigned_to: 'manager user',
            reply_expected: true,
            awaiting_reply_since: '2026-05-13T09:30:00Z',
            reply_expected_message_id: 1201,
            reply_owner: 'manager user',
            reply_owner_user_id: 501,
            reply_sla_at: '2099-05-13T15:00:00Z',
            due_at: '2099-05-13T15:00:00Z',
            delivery_status: 'delivered',
            delivery_error: null,
            failed_at: null,
            reply_escalation_task_id: 700,
            lead_id: 41,
            ...overrides
        };
    }

    return {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });

            if (/FROM users/i.test(text) && /ORDER BY COALESCE\(NULLIF\(name, ''\), username\), id/i.test(text)) {
                return { rows: [
                    { id: 20, username: 'manager-user', name: 'manager user', role: 'manager' },
                    { id: 30, username: 'new-owner', name: 'New Owner', role: 'manager' }
                ] };
            }

            if (/FROM users/i.test(text) && /COALESCE\(is_active, true\) = true/i.test(text)) {
                if (params[0] === 30 && Array.isArray(params[1]) && params[1].includes('manager')) {
                    return { rows: [{
                        id: 30,
                        username: 'new-owner',
                        name: 'New Owner',
                        role: 'manager',
                        is_active: true
                    }] };
                }
                return { rows: [] };
            }

            if (/UPDATE conversations/i.test(text) && /SET reply_owner_user_id =/i.test(text)) {
                if (params[0] === 99) return { rows: [] };
                return { rows: [replyRow({
                    conversation_id: params[0],
                    reply_owner_user_id: params[1],
                    reply_owner: params[2]
                })] };
            }

            if (/WITH target AS/i.test(text) && /SET reply_expected = false/i.test(text)) {
                if (params[0] === 99) return { rows: [] };
                return { rows: [{
                    ...replyRow({
                        conversation_id: params[0],
                        reply_expected: false,
                        awaiting_reply_since: null,
                        reply_expected_message_id: null,
                        reply_owner: null,
                        reply_owner_user_id: null,
                        reply_sla_at: null
                    }),
                    cleared_reply_expected_message_id: 1201
                }] };
            }

            if (/UPDATE conversations/i.test(text) && /SET reply_sla_at =/i.test(text)) {
                if (params[0] === 99) return { rows: [] };
                return { rows: [replyRow({
                    conversation_id: params[0],
                    reply_sla_at: params[1],
                    due_at: params[1]
                })] };
            }

            if (/UPDATE tasks/i.test(text) && /assigned_to =/i.test(text) && /source_type = \$1/i.test(text)) {
                return { rows: [{
                    id: 700,
                    source_type: 'conversation_reply',
                    source_id: '1201',
                    assigned_to: params[2],
                    owner: params[3],
                    status: 'todo'
                }] };
            }

            if (/UPDATE tasks/i.test(text) && /deadline =/i.test(text) && /source_type = \$1/i.test(text)) {
                return { rows: [{
                    id: 700,
                    source_type: 'conversation_reply',
                    source_id: '1201',
                    deadline: params[2],
                    status: 'todo'
                }] };
            }

            if (/UPDATE tasks/i.test(text) && /SET status = 'cancelled'/i.test(text)) {
                return { rows: [{
                    id: 700,
                    source_type: 'conversation_reply',
                    source_id: String(params[1]),
                    status: 'cancelled'
                }] };
            }

            if (/INSERT INTO task_logs/i.test(text)) {
                return { rows: [] };
            }

            if (/INSERT INTO reply_action_history/i.test(text)) {
                return { rows: [{
                    id: queries.filter(q => /INSERT INTO reply_action_history/i.test(q.text)).length,
                    conversation_id: params[0],
                    reply_expected_message_id: params[1],
                    action_type: params[2],
                    actor_user_id: params[3],
                    actor_name_snapshot: params[4],
                    source_surface: params[5],
                    old_value_json: params[6] ? JSON.parse(params[6]) : null,
                    new_value_json: params[7] ? JSON.parse(params[7]) : null,
                    meta_json: params[8] ? JSON.parse(params[8]) : null,
                    summary: params[9],
                    created_at: '2026-05-14T12:00:00Z'
                }] };
            }

            if (/FROM reply_action_history/i.test(text)) {
                return { rows: [
                    {
                        id: 12,
                        conversation_id: params[0],
                        reply_expected_message_id: 1201,
                        action_type: 'reply_owner_reassigned',
                        actor_user_id: 20,
                        actor_name_snapshot: 'manager user',
                        source_surface: 'manager_queue_execution_v6',
                        old_value_json: { replyOwnerUserId: 501, replyOwner: 'manager user' },
                        new_value_json: { replyOwnerUserId: 30, replyOwner: 'New Owner' },
                        meta_json: { route: 'work_queue_reply_owner' },
                        summary: 'Reply owner reassigned',
                        created_at: '2026-05-14T12:00:00Z'
                    },
                    {
                        id: 11,
                        conversation_id: params[0],
                        reply_expected_message_id: 1201,
                        action_type: 'reply_sla_snoozed',
                        actor_user_id: 20,
                        actor_name_snapshot: 'manager user',
                        source_surface: 'manager_queue_execution_v6',
                        old_value_json: { replySlaAt: '2099-05-13T15:00:00Z' },
                        new_value_json: { replySlaAt: '2099-05-14T10:00:00.000Z' },
                        meta_json: { route: 'work_queue_reply_sla' },
                        summary: 'Reply SLA moved',
                        created_at: '2026-05-14T11:00:00Z'
                    }
                ] };
            }

            if (/WITH inserted AS/i.test(text) && /INSERT INTO tasks/i.test(text) && /conversation_reply/i.test(text)) {
                return { rows: [{
                    id: 710,
                    title: 'Overdue reply escalation',
                    status: 'todo',
                    source_type: 'conversation_reply',
                    source_id: String(params[8]),
                    deadline: params[6],
                    created: true
                }] };
            }

            if (/FROM tasks t/i.test(text) && /LEFT\(COALESCE\(t\.date, ''\), 10\) < \$1/i.test(text)) {
                return { rows: [{
                    id: 1,
                    title: 'Overdue lead task',
                    description: 'Call client',
                    status: 'todo',
                    priority: 'high',
                    deadline: '2026-05-12T08:00:00Z',
                    date: null,
                    category: 'admin',
                    assigned_to: 'manager user',
                    owner: null,
                    task_source_type: 'lead',
                    task_source_id: '10',
                    linked_lead_id: 10,
                    linked_booking_id: null,
                    linked_booking_date: null,
                    linked_customer_id: null,
                    created_at: '2026-05-10T10:00:00Z'
                }] };
            }

            if (/FROM tasks t/i.test(text) && /t\.deadline >= NOW\(\)/i.test(text)) {
                return { rows: [{
                    id: 2,
                    title: 'Today task',
                    description: null,
                    status: 'in_progress',
                    priority: 'normal',
                    deadline: '2026-05-13T16:00:00Z',
                    date: '2026-05-13',
                    category: 'event',
                    assigned_to: 'manager user',
                    owner: null,
                    task_source_type: 'manual',
                    task_source_id: null,
                    linked_lead_id: null,
                    linked_booking_id: null,
                    linked_booking_date: null,
                    linked_customer_id: null,
                    created_at: '2026-05-13T09:00:00Z'
                }] };
            }

            if (/FROM tasks t/i.test(text)) {
                return { rows: [{
                    id: 3,
                    title: 'Tomorrow booking task',
                    description: null,
                    status: 'todo',
                    priority: 'low',
                    deadline: '2026-05-14T10:00:00Z',
                    date: '2026-05-14',
                    category: 'event',
                    assigned_to: 'manager user',
                    owner: null,
                    task_source_type: 'booking',
                    task_source_id: 'BK-1',
                    linked_lead_id: null,
                    linked_booking_id: 'BK-1',
                    linked_booking_date: '2026-05-14',
                    linked_customer_id: 300,
                    created_at: '2026-05-13T09:00:00Z'
                }] };
            }

            if (/FROM lead_interactions li/i.test(text)) {
                return { rows: [{
                    interaction_id: 4,
                    lead_id: 11,
                    type: 'call',
                    summary: 'Передзвонити після обіду',
                    details: null,
                    due_at: '2026-05-13',
                    client_name: 'Callback Client',
                    phone: '+380000000011',
                    pipeline_stage: 'contacted',
                    assigned_to: 20,
                    booking_id: null,
                    assigned_name: 'Manager User'
                }] };
            }

            if (/FROM conversations c/i.test(text) && /rt\.id AS reply_escalation_task_id/i.test(text) && /WHERE c\.id = \$1/i.test(text)) {
                if (params[0] === 44) {
                    return { rows: [replyRow({
                        conversation_id: 44,
                        reply_expected_message_id: 1204,
                        reply_owner: null,
                        reply_owner_user_id: null,
                        reply_sla_at: '2026-05-13T08:00:00Z',
                        due_at: '2026-05-13T08:00:00Z',
                        reply_escalation_task_id: null,
                        reply_escalation_status: null,
                        lead_id: 44
                    })] };
                }
                if (params[0] === 99) return { rows: [] };
                return { rows: [replyRow({ conversation_id: params[0], reply_escalation_status: 'todo' })] };
            }

            if (/FROM conversations c/i.test(text) && /reply_expected IS TRUE/i.test(text)) {
                if (/c\.id = \$1/i.test(text)) {
                    if (params[0] === 44) {
                        return { rows: [replyRow({
                            conversation_id: 44,
                            reply_expected_message_id: 1204,
                            reply_owner: null,
                            reply_owner_user_id: null,
                            reply_sla_at: '2026-05-13T08:00:00Z',
                            due_at: '2026-05-13T08:00:00Z',
                            reply_escalation_task_id: null,
                            lead_id: 44
                        })] };
                    }
                    return { rows: [replyRow({ conversation_id: params[0] })] };
                }
                if (/c\.reply_owner_user_id = \$\d+/i.test(text)) {
                    return { rows: [replyRow({
                        conversation_id: 42,
                        reply_expected_message_id: 1202,
                        reply_owner: 'Renamed label',
                        reply_owner_user_id: 20,
                        lead_id: 42
                    })] };
                }
                if (/c\.reply_owner_user_id IS NULL OR c\.reply_owner_user_id <> \$\d+/i.test(text)) {
                    return { rows: [
                        replyRow(),
                        replyRow({
                            conversation_id: 43,
                            reply_expected_message_id: 1203,
                            reply_owner: 'manager user',
                            reply_owner_user_id: null,
                            lead_id: 43
                        })
                    ] };
                }
                if (/c\.reply_sla_at IS NOT NULL AND c\.reply_sla_at <= NOW\(\)/i.test(text)) {
                    return { rows: [replyRow({
                        conversation_id: 44,
                        reply_expected_message_id: 1204,
                        reply_owner: null,
                        reply_owner_user_id: null,
                        reply_sla_at: '2026-05-13T08:00:00Z',
                        due_at: '2026-05-13T08:00:00Z',
                        reply_escalation_task_id: 704,
                        lead_id: 44
                    })] };
                }
                return { rows: [replyRow()] };
            }

            if (/FROM bookings b/i.test(text) && /b\.status = 'preliminary'/i.test(text)) {
                return { rows: [{
                    id: 'BK-2',
                    date: '2026-05-13',
                    time: '18:00',
                    label: 'Needs Confirm',
                    group_name: null,
                    program_name: 'Quest',
                    room: 'Room 1',
                    status: 'preliminary',
                    customer_id: 301,
                    lead_id: 12
                }] };
            }

            if (/FROM leads l/i.test(text) && /l\.event_date IS NOT NULL/i.test(text)) {
                return { rows: [{
                    id: 12,
                    client_name: 'Soon Event Lead',
                    phone: '+380000000012',
                    due_at: '2026-05-15',
                    pipeline_stage: 'deal',
                    assigned_to: 20,
                    booking_id: null,
                    assigned_name: 'Manager User',
                    program_name: 'Birthday'
                }] };
            }

            if (/FROM leads l/i.test(text) && /INTERVAL '48 hours'/i.test(text)) {
                return { rows: [{
                    id: 13,
                    client_name: 'Idle Lead',
                    phone: '+380000000013',
                    pipeline_stage: 'info_sent',
                    assigned_to: 20,
                    booking_id: null,
                    due_at: '2026-05-10T10:00:00Z',
                    hours_idle: 80,
                    assigned_name: 'Manager User'
                }] };
            }

            if (/FROM bookings b/i.test(text) && /b\.status IN \('confirmed', 'preliminary'\)/i.test(text)) {
                return { rows: [{
                    id: 'BK-3',
                    date: '2026-05-14',
                    time: '12:00',
                    label: 'Tomorrow Event',
                    group_name: null,
                    program_name: 'Show',
                    room: 'Room 2',
                    status: 'confirmed',
                    customer_id: 302,
                    lead_id: null
                }] };
            }

            throw new Error(`Unexpected work-queue query: ${text}`);
        }
    };
}

function bucketMap(queue) {
    return Object.fromEntries(queue.buckets.map(bucket => [bucket.key, bucket]));
}

function latestWaitingQuery() {
    return [...queries].reverse().find(q => /FROM conversations c/i.test(q.text) && /reply_expected IS TRUE/i.test(q.text));
}

describe('work queue endpoint', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        clearModules();
        queries = [];

        const fakePool = createFakePool();
        installMock('../db', { pool: fakePool, query: fakePool.query.bind(fakePool) });

        const { authenticateToken } = require('../middleware/auth');
        const app = express();
        app.use(express.json());
        app.use('/api', apiAuthBoundary(authenticateToken));
        app.use('/api/work-queue', require('../routes/work-queue'));

        ({ server, baseUrl } = await listen(app));
    });

    beforeEach(() => {
        queries.length = 0;
    });

    after(async () => {
        if (server) await close(server);
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
        clearModules();
    });

    it('requires manager-up access', async () => {
        const anonymous = await request('/api/work-queue', null);
        assert.equal(anonymous.status, 401);

        const admin = await request('/api/work-queue', 'admin');
        assert.equal(admin.status, 403);

        const manager = await request('/api/work-queue', 'manager');
        assert.equal(manager.status, 200, JSON.stringify(manager.data));
        assert.equal(manager.data.success, true);
    });

    it('exposes manager-safe assignable reply owner picker data', async () => {
        const admin = await request('/api/work-queue/reply-owners', 'admin');
        assert.equal(admin.status, 403);

        const res = await request('/api/work-queue/reply-owners', 'manager');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.deepEqual(res.data.users.map(user => user.id), [20, 30]);
        assert.equal(res.data.users[0].label, 'manager user');
        assert.equal(res.data.users.some(user => Object.hasOwn(user, 'is_active')), false);
        assert.equal(res.data.meta.canonicalValue, 'users.id');
        assert.equal(res.data.meta.inactiveUsers, 'excluded');
        assert.equal(res.data.meta.labelFiltering, false);

        const pickerQuery = queries.find(q => /FROM users/i.test(q.text) && /ORDER BY COALESCE\(NULLIF\(name, ''\), username\), id/i.test(q.text));
        assert.ok(pickerQuery, 'reply owner picker should use a dedicated active-user lookup');
        assert.match(pickerQuery.text, /role = ANY\(\$1::text\[\]\)/i);
        assert.ok(pickerQuery.params[0].includes('manager'));
        assert.ok(!pickerQuery.text.includes('password_hash'));
    });

    it('normalizes durable signals into canonical buckets and useful hrefs', async () => {
        const res = await request('/api/work-queue?limit=5', 'manager');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        const buckets = bucketMap(res.data.queue);

        assert.equal(buckets.overdue.items[0].taskId, 1);
        assert.equal(buckets.overdue.items[0].href, '/sales-funnel?lead=10');
        assert.equal(buckets.today.items[0].taskId, 2);
        assert.equal(buckets.tomorrow.items.some(item => item.bookingId === 'BK-3'), true);
        assert.equal(buckets.callback_due.items[0].leadId, 11);
        assert.equal(buckets.callback_due.items[0].confidence, 'exact');
        assert.equal(buckets.waiting_reply.items[0].sourceType, 'conversation');
        assert.equal(buckets.waiting_reply.items[0].sourceId, '41');
        assert.equal(buckets.waiting_reply.items[0].href, '/omni?conversation=41');
        assert.equal(buckets.waiting_reply.items[0].meta.signal, 'conversations.reply_expected');
        assert.equal(buckets.waiting_reply.items[0].meta.state, 'waiting_reply');
        assert.equal(buckets.waiting_reply.items[0].meta.awaitingReplySince, '2026-05-13T09:30:00Z');
        assert.equal(buckets.waiting_reply.items[0].meta.replySlaAt, '2099-05-13T15:00:00Z');
        assert.equal(buckets.waiting_reply.items[0].meta.replySlaState, 'on_track');
        assert.equal(buckets.waiting_reply.items[0].meta.replyExpectedMessageId, 1201);
        assert.equal(buckets.waiting_reply.items[0].meta.replyEscalationTaskId, 700);
        assert.equal(buckets.waiting_reply.items[0].meta.replyEscalationHref, '/tasks?open=700');
        assert.equal(buckets.waiting_reply.items[0].meta.replyOwnerUserId, 501);
        assert.equal(buckets.waiting_reply.items[0].meta.exactHref, '/omni?conversation=41');
        assert.equal(buckets.waiting_reply.items[0].meta.leadHref, '/sales-funnel?lead=41');
        assert.equal(buckets.waiting_reply.items[0].execution.model, 'reply_first_execution_engine_v6');
        assert.equal(buckets.waiting_reply.items[0].execution.depth, 'full_reply');
        assert.equal(buckets.waiting_reply.items[0].execution.autoAdvance, 'after_durable_mutation_refetch');
        assert.ok(buckets.waiting_reply.items[0].execution.actions.some(action => action.type === 'reply_clear_expectation'));
        assert.equal(buckets.callback_due.items[0].execution.routeOutOnly, true);
        assert.match(buckets.callback_due.items[0].execution.unavailableReason, /route-out only/i);
        assert.equal(buckets.needs_confirmation.items[0].href, '/?date=2026-05-13&highlight=BK-2');
        assert.equal(buckets.needs_confirmation.items[0].execution.routeOutOnly, true);
        assert.equal(buckets.event_soon.items[0].leadId, 12);
        assert.equal(buckets.idle_lead.items[0].confidence, 'suggested');
        assert.equal(buckets.idle_lead.items[0].execution.depth, 'summary_route_out');
        assert.equal(res.data.queue.meta.omittedBuckets.includes('waiting_reply'), false);
        assert.ok(!queries.some(q => /unread_count\s*>\s*0/i.test(q.text)));
        const waitingQuery = latestWaitingQuery();
        assert.ok(waitingQuery, 'waiting_reply must come from conversations.reply_expected');
        assert.match(waitingQuery.text, /awaiting_reply_since IS NOT NULL/i);
        assert.match(waitingQuery.text, /last_inbound_at IS NULL OR c\.last_inbound_at <= c\.awaiting_reply_since/i);
        assert.match(waitingQuery.text, /COALESCE\(cm\.delivery_status, ''\) NOT IN \('failed', 'later_failed'\)/i);
        assert.match(waitingQuery.text, /CASE WHEN c\.reply_sla_at IS NULL THEN 1 ELSE 0 END/i);
        assert.doesNotMatch(waitingQuery.text, /reply_owner\s*=\s*\$/i);
        assert.doesNotMatch(waitingQuery.text, /reply_owner_user_id\s*=\s*\$/i);
        assert.equal(res.data.queue.meta.replyBacklog.scope, 'all');
        assert.equal(res.data.queue.meta.replyBacklog.canonicalOwnerField, 'conversations.reply_owner_user_id');
        assert.equal(res.data.queue.meta.replyBacklog.labelFiltering, false);
        assert.equal(res.data.queue.meta.intelligence.model, 'bucket_aware_priority_bands_v1');
        assert.equal(res.data.queue.meta.intelligence.globalScore, false);
        assert.equal(res.data.queue.meta.intelligence.visibleScopeOnly, true);
        assert.equal(res.data.queue.meta.intelligence.hiddenDataScanned, false);
        assert.equal(res.data.queue.meta.intelligence.source, 'visible_queue_items');
        assert.equal(res.data.queue.meta.intelligence.weakBuckets.includes('idle_lead'), true);
    });

    it('adds bucket-aware intelligence without a fake global score', async () => {
        const res = await request('/api/work-queue?limit=5', 'manager');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        const buckets = bucketMap(res.data.queue);
        const waiting = buckets.waiting_reply.items[0];
        const callback = buckets.callback_due.items[0];
        const idle = buckets.idle_lead.items[0];
        const overdueTask = buckets.overdue.items[0];
        const summary = res.data.queue.meta.intelligence;

        assert.equal(waiting.intelligence.model, 'bucket_aware_priority_bands_v1');
        assert.equal(waiting.intelligence.globalScore, false);
        assert.equal(waiting.intelligence.priorityBand, 'critical');
        assert.equal(waiting.intelligence.confidence, 'high');
        assert.equal(waiting.intelligence.depth, 'full');
        assert.equal(waiting.intelligence.riskTypes.includes('reply_expected'), true);
        assert.equal(waiting.intelligence.riskTypes.includes('reply_escalated'), true);
        assert.equal(waiting.intelligence.recommendedAction.type, 'open_reply_escalation');
        assert.match(waiting.intelligence.why.join(' '), /conversations\.reply_expected/);

        assert.equal(overdueTask.intelligence.priorityBand, 'critical');
        assert.equal(overdueTask.intelligence.riskTypes.includes('task_overdue'), true);
        assert.equal(overdueTask.intelligence.depth, 'limited');

        assert.equal(callback.intelligence.recommendedAction.type, 'open_lead_for_callback');
        assert.equal(callback.intelligence.riskTypes.includes('callback_due'), true);
        assert.match(callback.intelligence.why.join(' '), /not canonical waiting_reply/);

        assert.equal(idle.intelligence.priorityBand, 'suggested');
        assert.equal(idle.intelligence.confidence, 'low');
        assert.equal(idle.intelligence.depth, 'summary_only');
        assert.equal(idle.intelligence.riskTypes.includes('lead_idle_heuristic'), true);
        assert.match(idle.intelligence.why.join(' '), /must not outrank canonical overdue reply/);

        assert.ok(Number(summary.priorityBands.critical || 0) >= 1);
        assert.ok(summary.topRisks.some(risk => risk.type === 'reply_escalated'));
        assert.ok(summary.bottlenecks.some(b => b.type === 'escalated_replies'));
        assert.ok(summary.bottlenecks.some(b => b.type === 'visible_overdue_tasks' && /string/.test(b.caveat)));
    });

    it('filters mine from typed reply_owner_user_id only', async () => {
        const res = await request('/api/work-queue?replyScope=mine&limit=5', 'manager');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        const buckets = bucketMap(res.data.queue);

        assert.equal(buckets.waiting_reply.items.length, 1);
        assert.equal(buckets.waiting_reply.items[0].sourceId, '42');
        assert.equal(buckets.waiting_reply.items[0].meta.replyOwnerUserId, 20);
        assert.equal(res.data.queue.meta.replyBacklog.scope, 'mine');
        assert.equal(res.data.queue.meta.replyBacklog.nullOwnerBehavior, 'excluded');

        const waitingQuery = latestWaitingQuery();
        assert.match(waitingQuery.text, /c\.reply_owner_user_id = \$\d+/i);
        assert.doesNotMatch(waitingQuery.text, /reply_owner\s*=\s*\$/i);
        assert.equal(waitingQuery.params.includes(20), true);
    });

    it('filters team as current manager-visible non-mine backlog and keeps null owner rows broader than mine', async () => {
        const res = await request('/api/work-queue?replyScope=team&limit=5', 'manager');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        const buckets = bucketMap(res.data.queue);
        const ownerIds = buckets.waiting_reply.items.map(item => item.meta.replyOwnerUserId);

        assert.equal(ownerIds.includes(20), false);
        assert.equal(ownerIds.includes(501), true);
        assert.equal(ownerIds.includes(null), true);
        assert.equal(res.data.queue.meta.replyBacklog.scope, 'team');
        assert.equal(res.data.queue.meta.replyBacklog.teamSemantics, 'manager_visible_non_mine');
        assert.equal(res.data.queue.meta.replyBacklog.nullOwnerBehavior, 'included_if_visible');

        const waitingQuery = latestWaitingQuery();
        assert.match(waitingQuery.text, /c\.reply_owner_user_id IS NULL OR c\.reply_owner_user_id <> \$\d+/i);
        assert.doesNotMatch(waitingQuery.text, /reply_owner\s*=\s*\$/i);
    });

    it('normalizes unknown reply backlog scope back to all', async () => {
        const res = await request('/api/work-queue?replyScope=label-match', 'manager');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.queue.meta.replyBacklog.scope, 'all');

        const waitingQuery = latestWaitingQuery();
        assert.doesNotMatch(waitingQuery.text, /reply_owner_user_id\s*=\s*\$/i);
        assert.doesNotMatch(waitingQuery.text, /reply_owner\s*=\s*\$/i);
    });

    it('filters reply operations console by canonical SLA, owner, and escalation state', async () => {
        const res = await request('/api/work-queue?replySla=overdue&replyOwner=without_owner&replyEscalation=escalated&limit=5', 'manager');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        const buckets = bucketMap(res.data.queue);

        assert.equal(buckets.waiting_reply.items.length, 1);
        assert.equal(buckets.waiting_reply.items[0].sourceId, '44');
        assert.equal(buckets.waiting_reply.items[0].meta.replyOwnerUserId, null);
        assert.equal(buckets.waiting_reply.items[0].meta.replyEscalationTaskId, 704);
        assert.deepEqual(res.data.queue.meta.replyBacklog.filters, {
            sla: 'overdue',
            owner: 'without_owner',
            escalation: 'escalated'
        });
        assert.equal(res.data.queue.meta.replyBacklog.availableFilters.sla.includes('due_soon'), true);

        const waitingQuery = latestWaitingQuery();
        assert.match(waitingQuery.text, /c\.reply_sla_at IS NOT NULL AND c\.reply_sla_at <= NOW\(\)/i);
        assert.match(waitingQuery.text, /c\.reply_owner_user_id IS NULL/i);
        assert.match(waitingQuery.text, /rt\.id IS NOT NULL/i);
        assert.doesNotMatch(waitingQuery.text, /reply_owner\s*=\s*\$/i);
    });

    it('normalizes unknown reply operations filters back to all', async () => {
        const res = await request('/api/work-queue?replySla=fake&replyOwner=label&replyEscalation=maybe', 'manager');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.deepEqual(res.data.queue.meta.replyBacklog.filters, {
            sla: 'all',
            owner: 'all',
            escalation: 'all'
        });

        const waitingQuery = latestWaitingQuery();
        assert.doesNotMatch(waitingQuery.text, /reply_sla_at <= NOW\(\)/i);
        assert.doesNotMatch(waitingQuery.text, /reply_owner_user_id IS NULL/i);
        assert.doesNotMatch(waitingQuery.text, /rt\.id IS NOT NULL/i);
        assert.doesNotMatch(waitingQuery.text, /reply_owner\s*=\s*\$/i);
    });

    it('lets managers reassign reply backlog owner by typed user id only', async () => {
        const res = await request('/api/work-queue/replies/41/owner', 'manager', {
            method: 'PATCH',
            body: { ownerUserId: 30, reply_owner: 'Label Should Not Drive Filtering' }
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.conversation.replyOwnerUserId, 30);
        assert.equal(res.data.conversation.replyOwner, 'New Owner');

        const ownerLookup = queries.find(q => /FROM users/i.test(q.text) && /COALESCE\(is_active, true\) = true/i.test(q.text) && q.params[0] === 30);
        assert.ok(ownerLookup);
        assert.match(ownerLookup.text, /role = ANY\(\$2::text\[\]\)/i);
        assert.ok(ownerLookup.params[1].includes('manager'));
        const ownerUpdate = queries.find(q => /UPDATE conversations/i.test(q.text) && /SET reply_owner_user_id =/i.test(q.text));
        assert.ok(ownerUpdate, 'reply owner reassignment must update typed owner field');
        assert.deepEqual(ownerUpdate.params.slice(0, 3), [41, 30, 'New Owner']);
        assert.doesNotMatch(ownerUpdate.text, /WHERE .*reply_owner\s*=/i);

        const taskSync = queries.find(q => /UPDATE tasks/i.test(q.text) && /assigned_to =/i.test(q.text));
        assert.ok(taskSync, 'existing reply escalation task should stay assigned coherently');
        assert.equal(taskSync.params[0], 'conversation_reply');
        assert.equal(taskSync.params[1], '1201');
        assert.equal(taskSync.params[2], 'New Owner');

        const historyInsert = queries.find(q => /INSERT INTO reply_action_history/i.test(q.text) && q.params[2] === 'reply_owner_reassigned');
        assert.ok(historyInsert, 'reply owner execution must leave durable action history');
        assert.equal(historyInsert.params[0], 41);
        assert.equal(historyInsert.params[1], 1201);
        assert.equal(historyInsert.params[3], 20);
        assert.equal(historyInsert.params[4], 'manager user');
        assert.equal(historyInsert.params[5], 'manager_queue_execution_v6');
        assert.deepEqual(JSON.parse(historyInsert.params[6]), { replyOwnerUserId: 501, replyOwner: 'manager user' });
        assert.deepEqual(JSON.parse(historyInsert.params[7]), { replyOwnerUserId: 30, replyOwner: 'New Owner' });
        assert.equal(res.data.historyEvent.actionType, 'reply_owner_reassigned');
    });

    it('blocks label-only reply owner reassignment', async () => {
        const res = await request('/api/work-queue/replies/41/owner', 'manager', {
            method: 'PATCH',
            body: { reply_owner: 'manager user' }
        });
        assert.equal(res.status, 400, JSON.stringify(res.data));
        assert.equal(res.data.code, 'INVALID_REPLY_OWNER');
        assert.ok(!queries.some(q => /UPDATE conversations/i.test(q.text) && /reply_owner_user_id/i.test(q.text)));
    });

    it('blocks inactive or non-assignable reply owner ids before mutation', async () => {
        const res = await request('/api/work-queue/replies/41/owner', 'manager', {
            method: 'PATCH',
            body: { ownerUserId: 31 }
        });
        assert.equal(res.status, 404, JSON.stringify(res.data));
        assert.equal(res.data.code, 'REPLY_OWNER_NOT_ASSIGNABLE');
        assert.ok(queries.some(q => /FROM users/i.test(q.text) && q.params[0] === 31));
        assert.ok(!queries.some(q => /UPDATE conversations/i.test(q.text) && /reply_owner_user_id/i.test(q.text)));
    });

    it('clears reply expectation without claiming an inbound reply and closes escalation', async () => {
        const res = await request('/api/work-queue/replies/41/clear', 'manager', {
            method: 'POST',
            body: {}
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.conversation.replyExpected, false);
        assert.equal(res.data.conversation.replyOwnerUserId, null);
        assert.equal(res.data.conversation.replySlaAt, null);

        const clearUpdate = queries.find(q => /WITH target AS/i.test(q.text) && /SET reply_expected = false/i.test(q.text));
        assert.ok(clearUpdate, 'clear action must update canonical reply expectation fields');
        assert.match(clearUpdate.text, /reply_expected_message_id = NULL/i);
        assert.match(clearUpdate.text, /reply_owner_user_id = NULL/i);
        assert.doesNotMatch(clearUpdate.text, /last_inbound_at/i);

        const taskClose = queries.find(q => /UPDATE tasks/i.test(q.text) && /SET status = 'cancelled'/i.test(q.text));
        assert.ok(taskClose, 'clear action should close active reply escalation task');
        assert.equal(taskClose.params[0], 'conversation_reply');
        assert.equal(taskClose.params[1], '1201');

        const historyInserts = queries.filter(q => /INSERT INTO reply_action_history/i.test(q.text));
        assert.equal(historyInserts.length, 2, 'clear should record the clear and linked escalation closure');
        assert.equal(historyInserts[0].params[2], 'reply_expectation_cleared');
        assert.equal(historyInserts[1].params[2], 'reply_escalation_closed');
        assert.deepEqual(JSON.parse(historyInserts[0].params[6]).replyOwnerUserId, 501);
        assert.equal(JSON.parse(historyInserts[0].params[7]).replyExpected, false);
        assert.equal(res.data.historyEvents.length, 2);
    });

    it('snoozes reply SLA through reply_sla_at and moves linked escalation deadline', async () => {
        const res = await request('/api/work-queue/replies/41/sla', 'manager', {
            method: 'PATCH',
            body: { replySlaAt: '2099-05-14T10:00:00.000Z' }
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.conversation.replySlaAt, '2099-05-14T10:00:00.000Z');

        const slaUpdate = queries.find(q => /UPDATE conversations/i.test(q.text) && /SET reply_sla_at =/i.test(q.text));
        assert.ok(slaUpdate, 'SLA action must mutate reply_sla_at');
        assert.deepEqual(slaUpdate.params.slice(0, 2), [41, '2099-05-14T10:00:00.000Z']);
        assert.doesNotMatch(slaUpdate.text, /tasks/i);
        assert.doesNotMatch(slaUpdate.text, /follow_up_date/i);

        const taskMove = queries.find(q => /UPDATE tasks/i.test(q.text) && /deadline =/i.test(q.text));
        assert.ok(taskMove, 'SLA move should keep linked escalation task coherent without breaking its idempotency anchor');
        assert.equal(taskMove.params[0], 'conversation_reply');
        assert.equal(taskMove.params[1], '1201');
        assert.equal(taskMove.params[2], '2099-05-14T10:00:00.000Z');
        assert.ok(!queries.some(q => /UPDATE tasks/i.test(q.text) && /SET status = 'cancelled'/i.test(q.text)));

        const historyInsert = queries.find(q => /INSERT INTO reply_action_history/i.test(q.text) && q.params[2] === 'reply_sla_snoozed');
        assert.ok(historyInsert, 'SLA execution must leave durable action history');
        assert.deepEqual(JSON.parse(historyInsert.params[6]), { replySlaAt: '2099-05-13T15:00:00Z' });
        assert.deepEqual(JSON.parse(historyInsert.params[7]), { replySlaAt: '2099-05-14T10:00:00.000Z' });
        assert.equal(res.data.historyEvent.actionType, 'reply_sla_snoozed');
    });

    it('escalates overdue reply expectations through the conversation_reply anchor only', async () => {
        const res = await request('/api/work-queue/replies/44/escalate', 'manager', {
            method: 'POST',
            body: {}
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.action, 'reply_escalate_overdue');
        assert.equal(res.data.created, true);
        assert.equal(res.data.task.source_type, 'conversation_reply');
        assert.equal(res.data.task.source_id, '1204');

        const expectationQuery = queries.find(q =>
            /FROM conversations c/i.test(q.text)
            && /reply_expected IS TRUE/i.test(q.text)
            && /c\.id = \$1/i.test(q.text)
            && q.params[0] === 44
        );
        assert.ok(expectationQuery, 'manual escalation must load the active explicit reply expectation');
        assert.match(expectationQuery.text, /reply_expected IS TRUE/i);
        assert.match(expectationQuery.text, /awaiting_reply_since IS NOT NULL/i);
        assert.match(expectationQuery.text, /COALESCE\(cm\.delivery_status, ''\) NOT IN \('failed', 'later_failed'\)/i);

        const insertQuery = queries.find(q => /WITH inserted AS/i.test(q.text) && /INSERT INTO tasks/i.test(q.text));
        assert.ok(insertQuery, 'manual escalation should reuse the idempotent conversation_reply task creation path');
        assert.equal(insertQuery.params[7], 'conversation_reply');
        assert.equal(insertQuery.params[8], '1204');

        const historyInsert = queries.find(q => /INSERT INTO reply_action_history/i.test(q.text) && q.params[2] === 'reply_escalated');
        assert.ok(historyInsert, 'manual reply escalation must leave durable action history');
        assert.equal(historyInsert.params[0], 44);
        assert.equal(historyInsert.params[1], 1204);
        assert.equal(JSON.parse(historyInsert.params[8]).sourceType, 'conversation_reply');
        assert.equal(res.data.historyEvent.actionType, 'reply_escalated');
    });

    it('bulk reassigns selected reply items through typed owner ids only', async () => {
        const res = await request('/api/work-queue/replies/bulk/owner', 'manager', {
            method: 'POST',
            body: { conversationIds: [41, 44, 41], ownerUserId: 30, reply_owner: 'Ignored Label', sourceSurface: 'reply_operations_console_v2' }
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.action, 'reply_owner_bulk_reassign');
        assert.equal(res.data.success, true);
        assert.deepEqual(res.data.counts, { requested: 2, applied: 2, failed: 0 });

        const ownerUpdates = queries.filter(q => /UPDATE conversations/i.test(q.text) && /SET reply_owner_user_id =/i.test(q.text));
        assert.equal(ownerUpdates.length, 2);
        assert.deepEqual(ownerUpdates.map(q => q.params[0]), [41, 44]);
        assert.ok(ownerUpdates.every(q => q.params[1] === 30 && q.params[2] === 'New Owner'));
        assert.ok(ownerUpdates.every(q => !/WHERE .*reply_owner\s*=/i.test(q.text)));
        const historyInserts = queries.filter(q => /INSERT INTO reply_action_history/i.test(q.text) && q.params[2] === 'reply_owner_reassigned');
        assert.equal(historyInserts.length, 2);
        assert.ok(historyInserts.every(q => q.params[5] === 'reply_operations_console_v2'));
    });

    it('bulk SLA move reports partial failures without hiding applied items', async () => {
        const res = await request('/api/work-queue/replies/bulk/sla', 'manager', {
            method: 'POST',
            body: { conversationIds: [41, 99], replySlaAt: '2099-05-15T10:00:00.000Z', sourceSurface: 'reply_operations_console_v2' }
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.action, 'reply_sla_bulk_move');
        assert.equal(res.data.success, false);
        assert.equal(res.data.partial, true);
        assert.deepEqual(res.data.counts, { requested: 2, applied: 1, failed: 1 });
        assert.equal(res.data.failed[0].conversationId, 99);
        assert.equal(res.data.failed[0].code, 'REPLY_EXPECTATION_NOT_FOUND');

        const slaUpdates = queries.filter(q => /UPDATE conversations/i.test(q.text) && /SET reply_sla_at =/i.test(q.text));
        assert.equal(slaUpdates.length, 2);
        assert.deepEqual(slaUpdates.map(q => q.params[0]), [41, 99]);
        assert.ok(!queries.some(q => /follow_up_date/i.test(q.text)));
        const historyInserts = queries.filter(q => /INSERT INTO reply_action_history/i.test(q.text) && q.params[2] === 'reply_sla_snoozed');
        assert.equal(historyInserts.length, 1, 'only successful bulk SLA mutation should be audited as success');
    });

    it('bulk clear closes linked escalation for applied items and reports stale rows', async () => {
        const res = await request('/api/work-queue/replies/bulk/clear', 'manager', {
            method: 'POST',
            body: { conversationIds: [41, 99], sourceSurface: 'reply_operations_console_v2' }
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.action, 'reply_expectation_bulk_clear');
        assert.equal(res.data.success, false);
        assert.equal(res.data.partial, true);
        assert.deepEqual(res.data.counts, { requested: 2, applied: 1, failed: 1 });

        const clearUpdates = queries.filter(q => /WITH target AS/i.test(q.text) && /SET reply_expected = false/i.test(q.text));
        assert.equal(clearUpdates.length, 2);
        const taskClose = queries.find(q => /UPDATE tasks/i.test(q.text) && /SET status = 'cancelled'/i.test(q.text));
        assert.ok(taskClose, 'bulk clear should use existing stale escalation close path');
        assert.equal(taskClose.params[0], 'conversation_reply');
        assert.equal(taskClose.params[1], '1201');
        const historyInserts = queries.filter(q => /INSERT INTO reply_action_history/i.test(q.text));
        assert.equal(historyInserts.filter(q => q.params[2] === 'reply_expectation_cleared').length, 1);
        assert.equal(historyInserts.filter(q => q.params[2] === 'reply_escalation_closed').length, 1);
    });

    it('rejects invalid bulk selection before any mutation', async () => {
        const res = await request('/api/work-queue/replies/bulk/clear', 'manager', {
            method: 'POST',
            body: { conversationIds: [] }
        });
        assert.equal(res.status, 400, JSON.stringify(res.data));
        assert.equal(res.data.code, 'INVALID_CONVERSATION_IDS');
        assert.ok(!queries.some(q => /UPDATE conversations/i.test(q.text)));
    });

    it('keeps reply backlog mutation routes manager-up only', async () => {
        const admin = await request('/api/work-queue/replies/41/clear', 'admin', {
            method: 'POST',
            body: {}
        });
        assert.equal(admin.status, 403);

        const bulk = await request('/api/work-queue/replies/bulk/clear', 'admin', {
            method: 'POST',
            body: { conversationIds: [41] }
        });
        assert.equal(bulk.status, 403);

        const escalate = await request('/api/work-queue/replies/44/escalate', 'admin', {
            method: 'POST',
            body: {}
        });
        assert.equal(escalate.status, 403);
    });

    it('returns bounded newest-first reply action history to managers only', async () => {
        const denied = await request('/api/work-queue/replies/41/history?limit=10', 'admin');
        assert.equal(denied.status, 403);

        const res = await request('/api/work-queue/replies/41/history?limit=2', 'manager');
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.meta.source, 'reply_action_history');
        assert.equal(res.data.meta.newestFirst, true);
        assert.equal(res.data.events.length, 2);
        assert.deepEqual(res.data.events.map(event => event.actionType), ['reply_owner_reassigned', 'reply_sla_snoozed']);

        const historyQuery = queries.find(q => /FROM reply_action_history/i.test(q.text));
        assert.ok(historyQuery);
        assert.match(historyQuery.text, /ORDER BY created_at DESC, id DESC/i);
        assert.deepEqual(historyQuery.params, [41, 2]);
    });

    it('does not reuse stale status=new cold-lead logic as queue authority', async () => {
        await request('/api/work-queue', 'manager');
        assert.ok(queries.some(q => /pipeline_stage/i.test(q.text)), 'queue should inspect canonical pipeline_stage');
        assert.ok(!queries.some(q => /status\s*=\s*'new'/i.test(q.text)), 'queue must not use legacy status=new cold lead query');
    });

    it('renders a triage workspace with truthful bucket-specific depth', async () => {
        const repoRoot = path.resolve(__dirname, '..');
        const dashboardJs = fs.readFileSync(path.join(repoRoot, 'js/dashboard-page.js'), 'utf8');
        const dom = new JSDOM(`<!doctype html>
            <div id="currentUser"></div>
            <section id="workQueuePanel" hidden>
                <p id="workQueueSubtitle"></p>
                <div id="workQueueScopeControls"></div>
                <div id="workQueueExplainability"></div>
                <div id="workQueueBody"></div>
            </section>
            <div id="dashboardGrid"></div>
        `, {
            url: 'http://localhost/dashboard',
            runScripts: 'outside-only'
        });
        const queue = {
            date: { today: '2026-05-14' },
            generatedAt: '2026-05-14T10:00:00Z',
            meta: {
                replyBacklog: { scope: 'all', filters: { sla: 'all', owner: 'all', escalation: 'all' } },
                omittedBuckets: [],
                heuristicBuckets: ['idle_lead'],
                intelligence: {
                    model: 'bucket_aware_priority_bands_v1',
                    globalScore: false,
                    source: 'visible_queue_items',
                    visibleScopeOnly: true,
                    hiddenDataScanned: false,
                    priorityBands: { critical: 1, action_today: 1 },
                    topRisks: [{ type: 'reply_escalated', count: 1 }],
                    bottlenecks: [{ type: 'escalated_replies', label: 'Escalated replies', count: 1 }],
                    weakBuckets: ['idle_lead']
                },
                warnings: []
            },
            buckets: [
                {
                    key: 'waiting_reply',
                    label: 'Waiting reply',
                    count: 1,
                    items: [{
                        id: 'waiting_reply:conversation:41',
                        bucket: 'waiting_reply',
                        sourceType: 'conversation',
                        sourceId: '41',
                        leadId: 41,
                        href: '/omni?conversation=41',
                        title: 'Reply Client',
                        subtitle: 'Viber conversation',
                        dueAt: '2026-05-14T09:00:00Z',
                        priority: 'high',
                        confidence: 'exact',
                        actionLabel: 'Відкрити Omni',
                        intelligence: {
                            model: 'bucket_aware_priority_bands_v1',
                            globalScore: false,
                            priorityBand: 'critical',
                            riskTypes: ['reply_expected', 'reply_escalated'],
                            recommendedAction: { type: 'open_reply_escalation', label: 'Open reply escalation context', href: '/tasks?open=700' },
                            why: ['Explicit reply expectation is active from conversations.reply_expected.', 'A linked conversation_reply escalation task exists.'],
                            confidence: 'high',
                            depth: 'full'
                        },
                        execution: {
                            model: 'reply_first_execution_engine_v6',
                            depth: 'full_reply',
                            inline: true,
                            routeOutOnly: false,
                            autoAdvance: 'after_durable_mutation_refetch',
                            actions: [
                                { type: 'reply_reassign_owner', durableMutation: true },
                                { type: 'reply_snooze_sla', durableMutation: true },
                                { type: 'reply_clear_expectation', durableMutation: true },
                                { type: 'open_reply_escalation', href: '/tasks?open=700', durableMutation: false }
                            ]
                        },
                        meta: {
                            conversationId: 41,
                            assignedTo: 'Manager User',
                            replyOwnerUserId: 20,
                            awaitingReplySince: '2026-05-13T09:30:00Z',
                            replySlaAt: '2026-05-14T09:00:00Z',
                            replySlaState: 'overdue',
                            replyEscalationTaskId: 700,
                            replyEscalationHref: '/tasks?open=700',
                            exactHref: '/omni?conversation=41',
                            leadHref: '/sales-funnel?lead=41',
                            signal: 'conversations.reply_expected'
                        }
                    }]
                },
                {
                    key: 'callback_due',
                    label: 'Callback due',
                    count: 1,
                    items: [{
                        id: 'callback_due:lead_interaction:4',
                        bucket: 'callback_due',
                        sourceType: 'lead_interaction',
                        sourceId: '4',
                        leadId: 11,
                        href: '/sales-funnel?lead=11',
                        title: 'Callback Client',
                        subtitle: 'Call after lunch',
                        dueAt: '2026-05-14',
                        priority: 'normal',
                        confidence: 'exact',
                        actionLabel: 'Відкрити лід',
                        intelligence: {
                            model: 'bucket_aware_priority_bands_v1',
                            globalScore: false,
                            priorityBand: 'action_today',
                            riskTypes: ['callback_due'],
                            recommendedAction: { type: 'open_lead_for_callback', label: 'Open lead and call client', href: '/sales-funnel?lead=11' },
                            why: ['lead_interactions.follow_up_date placed this item in callback_due.', 'This is callback/follow-up work, not canonical waiting_reply.'],
                            confidence: 'medium',
                            depth: 'limited'
                        },
                        execution: {
                            model: 'reply_first_execution_engine_v6',
                            depth: 'route_out_only',
                            inline: false,
                            routeOutOnly: true,
                            autoAdvance: 'never_on_route_out',
                            actions: [{ type: 'open_exact_context', href: '/sales-funnel?lead=11', durableMutation: false }],
                            unavailableReason: 'Callback completion/defer remains route-out only; follow-up state is not a shared queue execution outcome yet.'
                        },
                        meta: {
                            assignedTo: 'Manager User',
                            signal: 'lead_interactions.follow_up_date'
                        }
                    }]
                }
            ]
        };
        queue.items = queue.buckets.flatMap(bucket => bucket.items || []);
        let currentQueue = queue;

        dom.window.localStorage.setItem('pzp_token', 'token');
        dom.window.localStorage.setItem('pzp_current_user', JSON.stringify({ id: 20, name: 'Manager User', role: 'manager' }));
        dom.window.AppState = {};
        dom.window.ROLE_NAMES = { manager: 'Manager' };
        dom.window.hasMinRole = () => true;
        dom.window.apiVerifyToken = async () => ({ id: 20, name: 'Manager User', role: 'manager' });
        dom.window.Explainability = {
            renderFilterSummary: () => '<div>queue explainability</div>',
            setRegion: (target, html) => { target.innerHTML = html; }
        };
        dom.window.fetch = async (url, options = {}) => {
            const value = String(url);
            if (value.startsWith('/api/dashboard/config')) {
                return { ok: true, status: 200, json: async () => ({ success: true, config: { widgets: [], layout: {}, theme: 'default' } }) };
            }
            if (value.startsWith('/api/work-queue/replies/41/history')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        success: true,
                        events: [{
                            id: 12,
                            conversationId: 41,
                            replyExpectedMessageId: 1201,
                            actionType: 'reply_owner_reassigned',
                            createdAt: '2026-05-14T12:00:00Z',
                            actor: { userId: 20, name: 'Manager User' },
                            sourceSurface: 'manager_queue_execution_v6',
                            summary: 'Reply owner reassigned',
                            oldValue: { replyOwnerUserId: 501, replyOwner: 'Old Owner' },
                            newValue: { replyOwnerUserId: 20, replyOwner: 'Manager User' },
                            meta: { route: 'work_queue_reply_owner' }
                        }]
                    })
                };
            }
            if (value.startsWith('/api/work-queue/replies/41/clear') && options.method === 'POST') {
                currentQueue = {
                    ...queue,
                    buckets: queue.buckets.map(bucket => bucket.key === 'waiting_reply'
                        ? { ...bucket, count: 0, items: [] }
                        : bucket)
                };
                currentQueue.items = currentQueue.buckets.flatMap(bucket => bucket.items || []);
                return { ok: true, status: 200, json: async () => ({ success: true, conversation: { id: 41, replyExpected: false } }) };
            }
            if (value.startsWith('/api/work-queue')) {
                return { ok: true, status: 200, json: async () => ({ success: true, queue: currentQueue }) };
            }
            throw new Error(`Unexpected dashboard fetch: ${value}`);
        };
        dom.window.alert = () => {};
        dom.window.confirm = () => true;

        vm.runInContext(dashboardJs, dom.getInternalVMContext());
        const DashboardPage = vm.runInContext('DashboardPage', dom.getInternalVMContext());
        await DashboardPage.init();
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));

        const body = dom.window.document.getElementById('workQueueBody');
        assert.match(body.textContent, /Resolution workspace/);
        assert.match(body.textContent, /Queue Intelligence v1/);
        assert.match(body.textContent, /no global score/);
        assert.equal(body.querySelectorAll('.work-queue-detail-btn').length, 2);

        DashboardPage.selectTriageItem(encodeURIComponent('waiting_reply:conversation:41'));
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        let workspace = dom.window.document.getElementById('workQueueResolutionWorkspace');
        assert.match(workspace.textContent, /Reply Client/);
        assert.match(workspace.textContent, /Execution v6/);
        assert.match(workspace.textContent, /Reply Action History/);
        assert.match(workspace.textContent, /Owner reassigned/);
        assert.match(workspace.textContent, /Reply-first inline execution/);
        assert.match(workspace.textContent, /conversations\.reply_expected/);
        assert.match(workspace.textContent, /Open reply escalation context/);
        assert.match(workspace.textContent, /reply_escalated/);
        assert.equal(workspace.querySelectorAll('[data-triage-reply-action]').length, 3);
        assert.ok(workspace.querySelector('a[href="/omni?conversation=41"]'));
        assert.ok(workspace.querySelector('a[href="/sales-funnel?lead=41"]'));
        assert.ok(workspace.querySelector('a[href="/tasks?open=700"]'));

        DashboardPage.nextTriageItem();
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        workspace = dom.window.document.getElementById('workQueueResolutionWorkspace');
        assert.match(workspace.textContent, /Callback Client/);
        assert.match(workspace.textContent, /not canonical waiting_reply/);
        assert.match(workspace.textContent, /route-out only/i);
        assert.equal(workspace.querySelectorAll('[data-triage-reply-action]').length, 0);
        assert.equal(workspace.querySelector('#replyActionHistoryPanel'), null);
        assert.ok(workspace.querySelector('a[href="/sales-funnel?lead=11"]'));
        assert.ok(body.querySelector('[data-work-queue-item-id="callback_due:lead_interaction:4"].is-triage-selected'));

        DashboardPage.selectTriageItem(encodeURIComponent('waiting_reply:conversation:41'));
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        await DashboardPage.clearReplyExpectation(41, null);
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        workspace = dom.window.document.getElementById('workQueueResolutionWorkspace');
        assert.match(workspace.textContent, /Reply expectation cleared/);
        assert.match(workspace.textContent, /Callback Client/);
        assert.equal(workspace.querySelector('#replyActionHistoryPanel'), null, 'history from cleared reply must not leak into the next selected item');
        assert.ok(body.querySelector('[data-work-queue-item-id="callback_due:lead_interaction:4"].is-triage-selected'));
        assert.equal(body.querySelector('[data-work-queue-item-id="waiting_reply:conversation:41"]'), null);

        DashboardPage.setReplyConsoleFilter('sla', 'overdue');
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        workspace = dom.window.document.getElementById('workQueueResolutionWorkspace');
        assert.match(workspace.textContent, /Оберіть пункт черги/);
        assert.equal(body.querySelectorAll('.is-triage-selected').length, 0);

        DashboardPage.selectTriageItem(encodeURIComponent('callback_due:lead_interaction:4'));
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        DashboardPage.clearTriageSelection();
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));
        workspace = dom.window.document.getElementById('workQueueResolutionWorkspace');
        assert.match(workspace.textContent, /Оберіть пункт черги/);
    });

    it('wires dashboard waiting-reply rendering without unread heuristics', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const dashboardJs = fs.readFileSync(path.join(repoRoot, 'js/dashboard-page.js'), 'utf8');
        const dashboardCss = fs.readFileSync(path.join(repoRoot, 'css/dashboard.css'), 'utf8');

        assert.match(dashboardJs, /item\.bucket === 'waiting_reply'/);
        assert.match(dashboardJs, /replyScope: _workQueueReplyScope/);
        assert.match(dashboardJs, /replySla: _workQueueReplyFilters\.sla/);
        assert.match(dashboardJs, /replyOwner: _workQueueReplyFilters\.owner/);
        assert.match(dashboardJs, /replyEscalation: _workQueueReplyFilters\.escalation/);
        assert.match(dashboardJs, /setWorkQueueReplyScope/);
        assert.match(dashboardJs, /eg_reply_backlog_scope/);
        assert.match(dashboardJs, /eg_reply_console_filters/);
        assert.match(dashboardJs, /renderReplyOperationsConsole/);
        assert.match(dashboardJs, /renderQueueIntelligenceSummary/);
        assert.match(dashboardJs, /priorityBandLabel/);
        assert.match(dashboardJs, /item\.intelligence\?\.recommendedAction/);
        assert.match(dashboardJs, /toggleReplySelection/);
        assert.match(dashboardJs, /selectVisibleReplyItems/);
        assert.match(dashboardJs, /bulkReassignReplyOwners/);
        assert.match(dashboardJs, /bulkSnoozeReplySla/);
        assert.match(dashboardJs, /bulkClearReplyExpectations/);
        assert.match(dashboardJs, /\/api\/work-queue\/replies\/bulk\/owner/);
        assert.match(dashboardJs, /\/api\/work-queue\/replies\/bulk\/sla/);
        assert.match(dashboardJs, /\/api\/work-queue\/replies\/bulk\/clear/);
        assert.match(dashboardJs, /data-reply-bulk-action/);
        assert.match(dashboardJs, /item\.meta\?\.awaitingReplySince/);
        assert.match(dashboardJs, /replySlaState/);
        assert.match(dashboardJs, /reassignReplyOwner/);
        assert.match(dashboardJs, /replyOwnerPickerSelect/);
        assert.match(dashboardJs, /saveReplyOwnerPicker/);
        assert.match(dashboardJs, /setAttribute\('role', 'dialog'\)/);
        assert.match(dashboardJs, /\/api\/work-queue\/reply-owners/);
        assert.match(dashboardJs, /knownIds\.has\(ownerUserId\)/);
        assert.doesNotMatch(dashboardJs, /window\.prompt/);
        assert.match(dashboardJs, /snoozeReplySla/);
        assert.match(dashboardJs, /clearReplyExpectation/);
        assert.match(dashboardJs, /escalateReplyExpectation/);
        assert.match(dashboardJs, /refetchQueueAfterDurableExecution/);
        assert.match(dashboardJs, /Reply Action History/);
        assert.match(dashboardJs, /replyActionHistoryPanel/);
        assert.match(dashboardJs, /loadReplyActionHistoryForSelected/);
        assert.match(dashboardJs, /\/api\/work-queue\/replies\/.*\/history/);
        assert.match(dashboardJs, /reloadReplyActionHistory/);
        assert.match(dashboardJs, /never_on_route_out|route-out only/i);
        assert.match(dashboardJs, /Execution v6/);
        assert.match(dashboardJs, /\/api\/work-queue\/replies\/.*\/escalate/);
        assert.match(dashboardJs, /work-queue\/replies/);
        assert.match(dashboardJs, /work-queue-state-pill/);
        assert.match(dashboardJs, /work-queue-sla-pill/);
        assert.match(dashboardJs, /work-queue-reply-actions/);
        assert.match(dashboardJs, /renderTriageWorkspace/);
        assert.match(dashboardJs, /selectTriageItem/);
        assert.match(dashboardJs, /nextTriageItem/);
        assert.match(dashboardJs, /previousTriageItem/);
        assert.match(dashboardJs, /data-triage-reply-action/);
        assert.match(dashboardJs, /Route-out only|route-out only/);
        assert.doesNotMatch(dashboardJs, /unread_count\s*>\s*0/i);
        assert.match(dashboardCss, /bucket-waiting_reply/);
        assert.match(dashboardCss, /is-waiting-reply/);
        assert.match(dashboardCss, /work-queue-resolution-workspace/);
        assert.match(dashboardCss, /work-queue-triage-grid/);
        assert.match(dashboardCss, /work-queue-detail-btn/);
        assert.match(dashboardCss, /is-triage-selected/);
        assert.match(dashboardCss, /work-queue-scope-btn/);
        assert.match(dashboardCss, /reply-ops-console/);
        assert.match(dashboardCss, /reply-ops-filters/);
        assert.match(dashboardCss, /reply-ops-bulkbar/);
        assert.match(dashboardCss, /work-queue-intelligence/);
        assert.match(dashboardCss, /queue-band-pill/);
        assert.match(dashboardCss, /work-queue-select/);
        assert.match(dashboardCss, /work-queue-action-btn/);
        assert.match(dashboardCss, /reply-owner-picker/);
        assert.match(dashboardCss, /reply-owner-picker-select:focus-visible/);
        assert.match(dashboardCss, /work-queue-execution-feedback/);
        assert.match(dashboardCss, /reply-action-history-card/);
        assert.match(dashboardCss, /reply-action-history-row/);
    });
});
