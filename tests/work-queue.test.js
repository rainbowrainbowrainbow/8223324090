const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
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
        '../services/omni-hub',
        '../services/replyEscalation',
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

            if (/FROM users/i.test(text) && /COALESCE\(is_active, true\) = true/i.test(text)) {
                if (params[0] === 30) {
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
                return { rows: [replyRow({
                    reply_owner_user_id: params[1],
                    reply_owner: params[2]
                })] };
            }

            if (/WITH target AS/i.test(text) && /SET reply_expected = false/i.test(text)) {
                return { rows: [{
                    ...replyRow({
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
                return { rows: [replyRow({
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

            if (/FROM conversations c/i.test(text) && /reply_expected IS TRUE/i.test(text)) {
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
        assert.equal(buckets.needs_confirmation.items[0].href, '/?date=2026-05-13&highlight=BK-2');
        assert.equal(buckets.event_soon.items[0].leadId, 12);
        assert.equal(buckets.idle_lead.items[0].confidence, 'suggested');
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

    it('lets managers reassign reply backlog owner by typed user id only', async () => {
        const res = await request('/api/work-queue/replies/41/owner', 'manager', {
            method: 'PATCH',
            body: { ownerUserId: 30, reply_owner: 'Label Should Not Drive Filtering' }
        });
        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.equal(res.data.success, true);
        assert.equal(res.data.conversation.replyOwnerUserId, 30);
        assert.equal(res.data.conversation.replyOwner, 'New Owner');

        assert.ok(queries.some(q => /FROM users/i.test(q.text) && /COALESCE\(is_active, true\) = true/i.test(q.text) && q.params[0] === 30));
        const ownerUpdate = queries.find(q => /UPDATE conversations/i.test(q.text) && /SET reply_owner_user_id =/i.test(q.text));
        assert.ok(ownerUpdate, 'reply owner reassignment must update typed owner field');
        assert.deepEqual(ownerUpdate.params.slice(0, 3), [41, 30, 'New Owner']);
        assert.doesNotMatch(ownerUpdate.text, /WHERE .*reply_owner\s*=/i);

        const taskSync = queries.find(q => /UPDATE tasks/i.test(q.text) && /assigned_to =/i.test(q.text));
        assert.ok(taskSync, 'existing reply escalation task should stay assigned coherently');
        assert.equal(taskSync.params[0], 'conversation_reply');
        assert.equal(taskSync.params[1], '1201');
        assert.equal(taskSync.params[2], 'New Owner');
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
    });

    it('keeps reply backlog mutation routes manager-up only', async () => {
        const admin = await request('/api/work-queue/replies/41/clear', 'admin', {
            method: 'POST',
            body: {}
        });
        assert.equal(admin.status, 403);
    });

    it('does not reuse stale status=new cold-lead logic as queue authority', async () => {
        await request('/api/work-queue', 'manager');
        assert.ok(queries.some(q => /pipeline_stage/i.test(q.text)), 'queue should inspect canonical pipeline_stage');
        assert.ok(!queries.some(q => /status\s*=\s*'new'/i.test(q.text)), 'queue must not use legacy status=new cold lead query');
    });

    it('wires dashboard waiting-reply rendering without unread heuristics', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const dashboardJs = fs.readFileSync(path.join(repoRoot, 'js/dashboard-page.js'), 'utf8');
        const dashboardCss = fs.readFileSync(path.join(repoRoot, 'css/dashboard.css'), 'utf8');

        assert.match(dashboardJs, /item\.bucket === 'waiting_reply'/);
        assert.match(dashboardJs, /replyScope: _workQueueReplyScope/);
        assert.match(dashboardJs, /setWorkQueueReplyScope/);
        assert.match(dashboardJs, /eg_reply_backlog_scope/);
        assert.match(dashboardJs, /item\.meta\?\.awaitingReplySince/);
        assert.match(dashboardJs, /replySlaState/);
        assert.match(dashboardJs, /reassignReplyOwner/);
        assert.match(dashboardJs, /snoozeReplySla/);
        assert.match(dashboardJs, /clearReplyExpectation/);
        assert.match(dashboardJs, /work-queue\/replies/);
        assert.match(dashboardJs, /work-queue-state-pill/);
        assert.match(dashboardJs, /work-queue-sla-pill/);
        assert.match(dashboardJs, /work-queue-reply-actions/);
        assert.doesNotMatch(dashboardJs, /unread_count\s*>\s*0/i);
        assert.match(dashboardCss, /bucket-waiting_reply/);
        assert.match(dashboardCss, /is-waiting-reply/);
        assert.match(dashboardCss, /work-queue-scope-btn/);
        assert.match(dashboardCss, /work-queue-action-btn/);
    });
});
