const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
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

async function request(path, role = 'manager') {
    const headers = role ? { Authorization: `Bearer ${tokenFor(role)}` } : {};
    const res = await fetch(`${baseUrl}${path}`, { headers });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

function createFakePool() {
    return {
        query: async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });

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
        assert.equal(buckets.needs_confirmation.items[0].href, '/?date=2026-05-13&highlight=BK-2');
        assert.equal(buckets.event_soon.items[0].leadId, 12);
        assert.equal(buckets.idle_lead.items[0].confidence, 'suggested');
        assert.ok(res.data.queue.meta.omittedBuckets.includes('waiting_reply'));
    });

    it('does not reuse stale status=new cold-lead logic as queue authority', async () => {
        await request('/api/work-queue', 'manager');
        assert.ok(queries.some(q => /pipeline_stage/i.test(q.text)), 'queue should inspect canonical pipeline_stage');
        assert.ok(!queries.some(q => /status\s*=\s*'new'/i.test(q.text)), 'queue must not use legacy status=new cold lead query');
    });
});
