const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'guardian-ops-test-secret';
const originalJwtSecret = process.env.JWT_SECRET;

let server;
let baseUrl;
let state;

function listen(app) {
    return new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => {
            resolve({ server: s, baseUrl: `http://127.0.0.1:${s.address().port}` });
        });
    });
}

function close(s) {
    return new Promise((resolve, reject) => {
        s.close(err => err ? reject(err) : resolve());
    });
}

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../routes/guardian',
        '../services/guardian',
        '../services/eventBus',
        '../services/guardianDelivery',
        '../services/guardianRepair',
        '../services/guardianModerationState',
        '../services/adminAudit'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function resetState() {
    const now = new Date('2026-05-12T10:00:00.000Z').toISOString();
    state = {
        outbox: [
            {
                id: 1,
                aggregate_type: 'guardian_mute',
                aggregate_id: '77',
                event_type: 'guardian.telegram_alert.requested',
                payload: {
                    deliveryKey: 'guardian.mute.telegram:77',
                    deliveryType: 'guardian_mute_telegram',
                    sourceType: 'guardian_mute',
                    sourceId: '77',
                    channelId: 10,
                    userId: 42,
                    username: 'repeat-user',
                    content: '<b>provider down</b>'
                },
                idempotency_key: 'guardian.mute.telegram:77',
                occurred_at: now,
                published_at: null,
                publish_attempts: 5,
                last_error: 'provider down',
                created_at: now
            },
            {
                id: 2,
                aggregate_type: 'booking',
                aggregate_id: 'BK-1',
                event_type: 'booking.created',
                payload: {},
                idempotency_key: 'booking:1',
                occurred_at: now,
                published_at: null,
                publish_attempts: 1,
                last_error: 'not guardian',
                created_at: now
            },
            {
                id: 3,
                aggregate_type: 'guardian_mute',
                aggregate_id: '88',
                event_type: 'guardian.director_dm.requested',
                payload: { deliveryKey: 'guardian.mute.dm:88', content: 'already sent' },
                idempotency_key: 'guardian.mute.dm:88',
                occurred_at: now,
                published_at: now,
                publish_attempts: 0,
                last_error: null,
                created_at: now
            }
        ],
        eventQueue: [
            {
                id: 10,
                event_type: 'guardian.telegram_alert.requested',
                payload: { deliveryKey: 'guardian.mute.telegram:77', content: 'retry me' },
                idempotency_key: 'guardian.mute.telegram:77',
                status: 'failed',
                attempts: 3,
                max_attempts: 3,
                last_error: 'telegram 500',
                created_at: now,
                processed_at: null,
                next_retry_at: null,
                convergence_status: 'retryable_failed',
                failure_class: 'transient_provider_failure',
                terminal_at: null
            },
            {
                id: 11,
                event_type: 'booking.created',
                payload: {},
                idempotency_key: 'booking:1',
                status: 'failed',
                attempts: 1,
                max_attempts: 3,
                last_error: 'not guardian',
                created_at: now,
                processed_at: null,
                next_retry_at: null,
                convergence_status: 'retryable_failed',
                failure_class: 'unknown_retryable',
                terminal_at: null
            },
            {
                id: 12,
                event_type: 'guardian.director_dm.requested',
                payload: { deliveryKey: 'guardian.mute.dm:12', content: 'pending' },
                idempotency_key: 'guardian.mute.dm:12',
                status: 'pending',
                attempts: 0,
                max_attempts: 3,
                last_error: null,
                created_at: now,
                processed_at: null,
                next_retry_at: null,
                convergence_status: null,
                failure_class: null,
                terminal_at: null
            },
            {
                id: 13,
                event_type: 'guardian.telegram_alert.requested',
                payload: { deliveryKey: 'guardian.mute.telegram:13', content: 'terminal' },
                idempotency_key: 'guardian.mute.telegram:13',
                status: 'terminal_failed',
                attempts: 1,
                max_attempts: 3,
                last_error: 'telegram configuration missing',
                created_at: now,
                processed_at: null,
                next_retry_at: null,
                convergence_status: 'terminal_failed',
                failure_class: 'configuration_missing',
                terminal_at: now
            }
        ],
        deadLetter: [
            {
                id: 30,
                original_event_id: 10,
                event_type: 'guardian.telegram_alert.requested',
                payload: { deliveryKey: 'guardian.mute.telegram:77', content: 'retry me' },
                error: 'telegram 500',
                idempotency_key: 'guardian.mute.telegram:77',
                attempts: 3,
                max_attempts: 3,
                failure_class: 'transient_provider_failure',
                terminal_reason: 'telegram 500',
                moved_at: now,
                requeued_at: null,
                requeued_event_id: null
            },
            {
                id: 31,
                original_event_id: 11,
                event_type: 'booking.created',
                payload: {},
                error: 'not guardian',
                idempotency_key: 'booking:1',
                attempts: 3,
                max_attempts: 3,
                failure_class: 'unknown',
                terminal_reason: 'not guardian',
                moved_at: now,
                requeued_at: null,
                requeued_event_id: null
            },
            {
                id: 32,
                original_event_id: 12,
                event_type: 'guardian.director_dm.requested',
                payload: { deliveryKey: 'guardian.mute.dm:12', content: 'already replayed' },
                error: 'old failure',
                idempotency_key: 'guardian.mute.dm:12',
                attempts: 3,
                max_attempts: 3,
                failure_class: 'missing_target',
                terminal_reason: 'old failure',
                moved_at: now,
                requeued_at: now,
                requeued_event_id: 99
            }
        ],
        activeMutes: [
            { id: 50, channel_id: 10, channel_name: 'Ops', user_id: 42, username: 'repeat-user', display_name: 'Repeat User', reason: 'Guardian mute', muted_until: now, created_at: now }
        ],
        actions: [
            { id: 70, action_type: 'mute', channel_id: 10, channel_name: 'Ops', target_user_id: 42, target_username: 'repeat-user', message_id: null, details: { reason: 'mute' }, created_at: now }
        ],
        counters: [
            { id: 90, counter_type: 'repeat_offender', user_id: 42, username: 'repeat-user', window_key: 'rolling-7d', window_start: now, window_end: '2026-05-19T10:00:00.000Z', count: 1, alerted_at: now, last_channel_id: 10, last_channel_name: 'Ops', last_username: 'repeat-user', last_source_type: 'guardian_mute', last_source_id: '77', updated_at: now }
        ],
        users: [
            { id: 42, username: 'repeat-user', name: 'Repeat User' }
        ],
        moderationEvents: [
            { id: 500, counter_type: 'repeat_offender', user_id: 42, channel_id: 10, source_type: 'guardian_mute', source_id: '77', username: 'repeat-user', occurred_at: '2026-05-12T10:00:00.000Z' },
            { id: 501, counter_type: 'repeat_offender', user_id: 42, channel_id: 10, source_type: 'guardian_mute', source_id: '78', username: 'repeat-user', occurred_at: '2026-05-12T10:20:00.000Z' },
            { id: 502, counter_type: 'hourly_blocks', user_id: 42, channel_id: 10, source_type: 'guardian_mute', source_id: '77', username: 'repeat-user', occurred_at: '2026-05-12T10:00:00.000Z' },
            { id: 503, counter_type: 'hourly_blocks', user_id: 42, channel_id: 10, source_type: 'guardian_mute', source_id: '78', username: 'repeat-user', occurred_at: '2026-05-12T10:20:00.000Z' }
        ],
        writes: []
    };
}

function tokenFor(role = 'creator', userId = 1) {
    return jwt.sign(
        { id: userId, userId, username: `${role}-${userId}`, name: `${role} ${userId}`, role },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function request(method, pathname, body, role = 'creator', userId = 1) {
    const res = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: {
            Authorization: `Bearer ${tokenFor(role, userId)}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
}

function fakePool() {
    const pool = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();

            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) {
                state.writes.push({ type: text.toLowerCase() });
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('UPDATE employee_profiles') || text.startsWith('UPDATE users SET last_seen_at')) {
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('INSERT INTO admin_audit_log')) {
                state.writes.push({ type: 'audit', params });
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('SELECT COUNT(*)::int AS total') && text.includes('FROM outbox_events')) {
                const rows = state.outbox.filter(row => row.event_type.startsWith('guardian.'));
                return {
                    rows: [{
                        total: rows.length,
                        pending: rows.filter(row => !row.published_at && !row.publish_attempts && !row.last_error).length,
                        retry_needed: rows.filter(row => !row.published_at && (row.publish_attempts > 0 || row.last_error)).length,
                        blocked: rows.filter(row => !row.published_at && row.publish_attempts >= 5).length,
                        published: rows.filter(row => row.published_at).length
                    }],
                    rowCount: 1
                };
            }
            if (text.startsWith('SELECT id, aggregate_type, aggregate_id, event_type')) {
                const rows = state.outbox.filter(row =>
                    row.event_type.startsWith('guardian.') &&
                    (!row.published_at || row.last_error || row.publish_attempts > 0)
                );
                return { rows, rowCount: rows.length };
            }
            if (text.startsWith('SELECT status, COUNT(*)::int AS count FROM event_queue')) {
                const counts = new Map();
                for (const row of state.eventQueue.filter(event => event.event_type.startsWith('guardian.'))) {
                    counts.set(row.status, (counts.get(row.status) || 0) + 1);
                }
                return { rows: [...counts.entries()].map(([status, count]) => ({ status, count })), rowCount: counts.size };
            }
            if (text.startsWith('SELECT id, event_type, payload, idempotency_key, status')) {
                const rows = state.eventQueue.filter(row =>
                    row.event_type.startsWith('guardian.') &&
                    ['pending', 'failed', 'terminal_failed'].includes(row.status)
                );
                return { rows, rowCount: rows.length };
            }
            if (text.startsWith("SELECT COALESCE(failure_class, 'unknown') AS failure_class")) {
                const counts = new Map();
                for (const row of state.deadLetter.filter(event =>
                    event.event_type.startsWith('guardian.') && !event.requeued_at
                )) {
                    const failureClass = row.failure_class || 'unknown';
                    counts.set(failureClass, (counts.get(failureClass) || 0) + 1);
                }
                return { rows: [...counts.entries()].map(([failure_class, count]) => ({ failure_class, count })), rowCount: counts.size };
            }
            if (text.startsWith('SELECT id, original_event_id, event_type, payload, error') && text.includes('WHERE id = $1')) {
                const row = state.deadLetter.find(event => String(event.id) === String(params[0]));
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            if (text.startsWith('SELECT id, original_event_id, event_type, payload, error')) {
                const rows = state.deadLetter.filter(row => row.event_type.startsWith('guardian.'));
                return { rows, rowCount: rows.length };
            }
            if (text.startsWith('SELECT cm.id, cm.channel_id')) {
                return { rows: state.activeMutes, rowCount: state.activeMutes.length };
            }
            if (text.startsWith('SELECT ga.id, ga.action_type')) {
                return { rows: state.actions, rowCount: state.actions.length };
            }
            if (text.startsWith('SELECT gmc.id, gmc.counter_type')) {
                return { rows: state.counters, rowCount: state.counters.length };
            }
            if (text.startsWith('SELECT id, username, name FROM users WHERE id')) {
                const row = state.users.find(user => String(user.id) === String(params[0]));
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            if (text.startsWith('SELECT id, counter_type, user_id, window_key')) {
                const rows = state.counters.filter(row =>
                    String(row.user_id) === String(params[0]) &&
                    params[1].includes(row.counter_type)
                );
                return { rows, rowCount: rows.length };
            }
            if (text.startsWith('SELECT id, counter_type, user_id, channel_id')) {
                const rows = state.moderationEvents.filter(row =>
                    String(row.user_id) === String(params[0]) &&
                    params[1].includes(row.counter_type)
                );
                return { rows, rowCount: rows.length };
            }
            if (text.startsWith('INSERT INTO guardian_moderation_counters')) {
                const [
                    counterType,
                    userId,
                    windowKey,
                    windowStart,
                    windowEnd,
                    count,
                    lastChannelId,
                    lastUsername,
                    lastSourceType,
                    lastSourceId
                ] = params;
                let row = state.counters.find(counter =>
                    counter.counter_type === counterType &&
                    String(counter.user_id) === String(userId) &&
                    counter.window_key === windowKey
                );
                if (!row) {
                    row = {
                        id: 800 + state.counters.length,
                        counter_type: counterType,
                        user_id: userId,
                        window_key: windowKey,
                        alerted_at: null
                    };
                    state.counters.push(row);
                }
                Object.assign(row, {
                    window_start: windowStart,
                    window_end: windowEnd,
                    count,
                    last_channel_id: lastChannelId,
                    last_username: lastUsername,
                    last_source_type: lastSourceType,
                    last_source_id: lastSourceId,
                    updated_at: new Date('2026-05-12T10:00:00.000Z').toISOString()
                });
                state.writes.push({ type: 'counter-repair', counterType, windowKey });
                return { rows: [row], rowCount: 1 };
            }
            if (text.startsWith('SELECT id, event_type, aggregate_type, aggregate_id')) {
                const row = state.outbox.find(event => String(event.id) === String(params[0]));
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            if (text.startsWith('UPDATE outbox_events SET publish_attempts')) {
                const row = state.outbox.find(event => String(event.id) === String(params[0]));
                row.publish_attempts = 0;
                row.last_error = null;
                state.writes.push({ type: 'outbox-requeue', id: row.id });
                return { rows: [row], rowCount: 1 };
            }
            if (text.startsWith('SELECT id, event_type, status, attempts')) {
                const row = state.eventQueue.find(event => String(event.id) === String(params[0]));
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }
            if (text.startsWith('UPDATE event_queue SET status')) {
                const row = state.eventQueue.find(event => String(event.id) === String(params[0]));
                row.status = 'pending';
                row.attempts = 0;
                row.last_error = null;
                row.next_retry_at = null;
                row.convergence_status = 'replayed';
                row.failure_class = null;
                row.terminal_at = null;
                state.writes.push({ type: 'event-requeue', id: row.id });
                return { rows: [row], rowCount: 1 };
            }
            if (text.startsWith('INSERT INTO event_queue ( event_type, payload, idempotency_key')) {
                const exists = state.eventQueue.find(event => event.idempotency_key === params[2]);
                if (exists) return { rows: [], rowCount: 0 };
                const row = {
                    id: 100 + state.eventQueue.length,
                    event_type: params[0],
                    payload: params[1],
                    idempotency_key: params[2],
                    status: 'pending',
                    attempts: 0,
                    max_attempts: Math.max(Number(params[3] || 3), 1),
                    last_error: null,
                    created_at: new Date('2026-05-12T10:00:00.000Z').toISOString(),
                    processed_at: null,
                    next_retry_at: null,
                    convergence_status: 'replayed',
                    failure_class: null,
                    terminal_at: null
                };
                state.eventQueue.push(row);
                state.writes.push({ type: 'dead-letter-replay-insert', id: row.id });
                return { rows: [row], rowCount: 1 };
            }
            if (text.startsWith('UPDATE event_dead_letter SET requeued_at')) {
                const row = state.deadLetter.find(event => String(event.id) === String(params[1]));
                row.requeued_at = new Date('2026-05-12T10:00:00.000Z').toISOString();
                row.requeued_event_id = params[0];
                state.writes.push({ type: 'dead-letter-requeue', id: row.id, eventId: params[0] });
                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unexpected Guardian ops query: ${text}`);
        },
        async connect() {
            return {
                query: pool.query.bind(pool),
                release: () => {}
            };
        }
    };
    return pool;
}

function fakeGuardianService() {
    return {
        generateDailyReport: async () => ({}),
        runDailyReports: async () => {},
        ensureGuardianMemberships: async () => {},
        getMood: () => ({}),
        getGuardianState: () => ({}),
        clearMuteCache: () => {},
        setEmergencyStop: () => {},
        getEmergencyStop: () => false,
        getChannelSettings: async () => ({}),
        invalidateChannelSettingsCache: () => {},
        alertDirectorTelegram: () => {}
    };
}

describe('Guardian operator reliability endpoints', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        resetState();
        clearModules();

        const pool = fakePool();
        installMock('../db', { pool, query: pool.query.bind(pool) });
        installMock('../services/guardian', fakeGuardianService());

        const app = express();
        app.use(express.json());
        app.use('/api/guardian', require('../routes/guardian'));

        ({ server, baseUrl } = await listen(app));
    });

    beforeEach(() => {
        resetState();
    });

    after(async () => {
        if (server) await close(server);
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
        clearModules();
    });

    it('blocks non-operator roles from reliability inspection and requeue controls', async () => {
        let res = await request('GET', '/api/guardian/ops/reliability', undefined, 'manager', 20);
        assert.equal(res.status, 403);

        res = await request('POST', '/api/guardian/ops/outbox/1/requeue', {}, 'manager', 20);
        assert.equal(res.status, 403);

        res = await request('POST', '/api/guardian/ops/events/10/requeue', {}, 'manager', 20);
        assert.equal(res.status, 403);

        res = await request('POST', '/api/guardian/ops/dead-letter/30/requeue', {}, 'manager', 20);
        assert.equal(res.status, 403);

        res = await request('POST', '/api/guardian/ops/reconcile/users/42', { apply: true }, 'manager', 20);
        assert.equal(res.status, 403);
    });

    it('allows security operators to inspect Guardian delivery and moderation state', async () => {
        const res = await request('GET', '/api/guardian/ops/reliability?limit=5', undefined, 'security', 6);

        assert.equal(res.status, 200);
        assert.equal(res.data.outbox.summary.blocked, 1);
        assert.equal(res.data.outbox.events[0].eventType, 'guardian.telegram_alert.requested');
        assert.equal(res.data.outbox.events[0].payloadSummary.deliveryKey, 'guardian.mute.telegram:77');
        assert.equal(res.data.outbox.events[0].payloadSummary.hasContent, true);
        assert.equal(res.data.eventQueue.summary.failed, 1);
        assert.equal(res.data.eventQueue.summary.pending, 1);
        assert.equal(res.data.eventQueue.summary.terminal_failed, 1);
        assert.equal(res.data.eventQueue.events.some(event => event.failureClass === 'configuration_missing'), true);
        assert.equal(res.data.deadLetter.summary.transient_provider_failure, 1);
        assert.equal(res.data.deadLetter.events[0].status, 'dead_letter');
        assert.equal(res.data.deadLetter.events[0].payloadSummary.deliveryKey, 'guardian.mute.telegram:77');
        assert.equal(res.data.moderation.activeMutes[0].username, 'repeat-user');
        assert.equal(res.data.moderation.counters[0].counterType, 'repeat_offender');
    });

    it('requeues one unpublished Guardian outbox event and rejects unsafe outbox targets', async () => {
        let res = await request('POST', '/api/guardian/ops/outbox/1/requeue', {}, 'director', 2);
        assert.equal(res.status, 200);
        assert.equal(res.data.event.status, 'pending');
        assert.equal(state.outbox[0].publish_attempts, 0);
        assert.equal(state.outbox[0].last_error, null);
        assert.equal(state.writes.some(write => write.type === 'outbox-requeue'), true);

        res = await request('POST', '/api/guardian/ops/outbox/2/requeue', {}, 'director', 2);
        assert.equal(res.status, 400);

        res = await request('POST', '/api/guardian/ops/outbox/3/requeue', {}, 'director', 2);
        assert.equal(res.status, 409);
    });

    it('requeues one failed Guardian event_queue item and rejects unsafe event targets', async () => {
        let res = await request('POST', '/api/guardian/ops/events/10/requeue', {}, 'admin', 3);
        assert.equal(res.status, 200);
        assert.equal(res.data.event.status, 'pending');
        assert.equal(state.eventQueue[0].status, 'pending');
        assert.equal(state.eventQueue[0].attempts, 0);
        assert.equal(state.eventQueue[0].last_error, null);
        assert.equal(state.writes.some(write => write.type === 'event-requeue'), true);

        res = await request('POST', '/api/guardian/ops/events/11/requeue', {}, 'admin', 3);
        assert.equal(res.status, 400);

        res = await request('POST', '/api/guardian/ops/events/12/requeue', {}, 'admin', 3);
        assert.equal(res.status, 409);
    });

    it('replays one Guardian dead-letter event and rejects unsafe dead-letter targets', async () => {
        let res = await request('POST', '/api/guardian/ops/dead-letter/30/requeue', {}, 'security', 6);
        assert.equal(res.status, 200);
        assert.equal(res.data.event.status, 'pending');
        assert.equal(res.data.event.convergenceStatus, 'replayed');
        assert.equal(state.deadLetter[0].requeued_event_id, res.data.event.id);
        assert.equal(state.writes.some(write => write.type === 'dead-letter-requeue'), true);

        res = await request('POST', '/api/guardian/ops/dead-letter/31/requeue', {}, 'security', 6);
        assert.equal(res.status, 400);

        res = await request('POST', '/api/guardian/ops/dead-letter/32/requeue', {}, 'security', 6);
        assert.equal(res.status, 409);
    });

    it('previews and repairs one user moderation-counter drift with audit logging', async () => {
        let res = await request('GET', '/api/guardian/ops/reconcile/users/42', undefined, 'security', 6);
        assert.equal(res.status, 200);
        assert.equal(res.data.dryRun, true);
        assert.equal(res.data.preview.repairableIssueCount, 2);
        assert.equal(res.data.preview.issues.some(issue => issue.type === 'counter_mismatch'), true);
        assert.equal(res.data.preview.issues.some(issue => issue.type === 'missing_counter'), true);
        assert.equal(state.writes.some(write => write.type === 'counter-repair'), false);

        res = await request('POST', '/api/guardian/ops/reconcile/users/42', { apply: true }, 'director', 2);
        assert.equal(res.status, 200);
        assert.equal(res.data.dryRun, false);
        assert.equal(res.data.result.appliedCount, 2);
        assert.equal(state.counters.find(row => row.counter_type === 'repeat_offender').count, 2);
        assert.equal(state.counters.find(row => row.counter_type === 'hourly_blocks').count, 2);
        assert.equal(state.writes.filter(write => write.type === 'counter-repair').length, 2);
        assert.equal(state.writes.some(write => write.type === 'audit'), true);

        res = await request('GET', '/api/guardian/ops/reconcile/users/999', undefined, 'security', 6);
        assert.equal(res.status, 404);
    });
});
