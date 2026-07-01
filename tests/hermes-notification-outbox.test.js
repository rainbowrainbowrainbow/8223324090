const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHermesRouter } = require('../routes/hermes');

const AUTH_HEADERS = { 'x-api-key': 'unit-hermes-key' };
const NOW = '2026-06-29T12:00:00.000Z';

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

async function request(baseUrl, method, path, body, headers = AUTH_HEADERS) {
    const reqHeaders = { ...headers };
    if (body !== undefined && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: res.status, data, text };
}

function hermesOutboxAuth(req, res, next) {
    if (req.get('x-api-key') !== 'unit-hermes-key') {
        return res.status(401).json({
            success: false,
            code: 'HERMES_AUTH_REQUIRED',
            error: 'Hermes API key is required'
        });
    }
    req.user = {
        id: 42,
        username: 'hermes.worker',
        name: 'Hermes Worker',
        role: 'director',
        business_contexts: ['event_genix'],
        defaultBusinessContext: 'event_genix'
    };
    req.integration = { id: 'hermes-event-genix-crm', source: 'hermes' };
    return next();
}

function outboxRow(overrides = {}) {
    const id = overrides.id || 1;
    return {
        id,
        event_id: overrides.event_id || `task_created:${id}:owner:4`,
        task_id: overrides.task_id || id,
        owner_user_id: overrides.owner_user_id || 4,
        event_type: overrides.event_type || 'task_created',
        payload_json: overrides.payload_json || {
            taskId: overrides.task_id || id,
            title: `Task ${id}`,
            status: 'open',
            priority: 'high',
            ownerUserId: overrides.owner_user_id || 4,
            ownerLabel: 'Owner',
            dueAt: '2026-06-30T15:00:00.000Z',
            crmUrl: `/tasks?open=${id}`,
            createdAt: '2026-06-29T09:00:00.000Z',
            updatedAt: '2026-06-29T09:00:00.000Z',
            secretToken: 'must-not-leak'
        },
        payload_hash: overrides.payload_hash || `hash-${id}`,
        status: overrides.status || 'pending',
        attempts: overrides.attempts || 0,
        available_at: overrides.available_at === undefined ? '2026-06-29T09:00:00.000Z' : overrides.available_at,
        created_at: overrides.created_at || '2026-06-29T09:00:00.000Z',
        updated_at: overrides.updated_at || '2026-06-29T09:00:00.000Z',
        claimed_at: overrides.claimed_at || null,
        sent_at: overrides.sent_at || null,
        last_error: overrides.last_error || null,
        last_error_code: overrides.last_error_code || null,
        last_delivery_channel: overrides.last_delivery_channel || null,
        last_delivery_target: overrides.last_delivery_target || null,
        claimed_by: overrides.claimed_by || null,
        locked_until: overrides.locked_until || null
    };
}

function cloneRow(row) {
    if (!row) return null;
    return JSON.parse(JSON.stringify(row));
}

function isAvailableAt(value, nowIso) {
    if (!value) return true;
    return new Date(value).getTime() <= new Date(nowIso).getTime();
}

class FakeNotificationOutboxPool {
    constructor(rows = [], options = {}) {
        this.rows = new Map(rows.map(row => [row.event_id, cloneRow(row)]));
        this.calls = [];
        this.now = options.now || NOW;
        this.tasks = new Map((options.tasks || []).map(row => [Number(row.id), cloneRow(row)]));
        this.users = new Map((options.users || []).map(row => [Number(row.id), cloneRow(row)]));
    }

    nextIso(seconds = 0) {
        return new Date(new Date(this.now).getTime() + seconds * 1000).toISOString();
    }

    ownerLabel(ownerUserId) {
        const user = this.users.get(Number(ownerUserId)) || {};
        const label = String(user.name || user.username || '').trim();
        return label || `User #${ownerUserId}`;
    }

    ownerWorkloadDiagnosticRows(params = []) {
        const scopedContexts = params
            .flatMap(value => Array.isArray(value) ? value : [value])
            .map(value => String(value || '').trim())
            .filter(Boolean);
        const contexts = new Set(scopedContexts.length ? scopedContexts : ['event_genix']);
        const scopedTasks = Array.from(this.tasks.values()).filter(task => {
            const ownerUserId = Number(task.owner_user_id || task.ownerUserId || 0);
            const businessContext = String(task.business_context || task.businessContext || 'event_genix');
            return ownerUserId > 0 && contexts.has(businessContext);
        });
        const scopedTasksById = new Map(scopedTasks.map(task => [Number(task.id), task]));
        const byOwner = new Map();
        const ensureOwner = ownerUserId => {
            const id = Number(ownerUserId);
            if (!byOwner.has(id)) {
                byOwner.set(id, {
                    owner_user_id: id,
                    owner_label: this.ownerLabel(id),
                    active: 0,
                    urgent: 0,
                    outbox_pending: 0,
                    outbox_skipped: 0,
                    blocked_missing_route: 0
                });
            }
            return byOwner.get(id);
        };

        for (const task of scopedTasks) {
            const ownerUserId = Number(task.owner_user_id || task.ownerUserId);
            const row = ensureOwner(ownerUserId);
            const status = String(task.status || 'todo').toLowerCase();
            const priority = String(task.priority || 'normal').toLowerCase();
            if (!['done', 'cancelled', 'archived'].includes(status)) {
                row.active += 1;
                if (['urgent', 'critical'].includes(priority)) row.urgent += 1;
            }
        }

        for (const outbox of this.rows.values()) {
            const task = scopedTasksById.get(Number(outbox.task_id));
            if (!task) continue;
            const row = ensureOwner(Number(task.owner_user_id || task.ownerUserId));
            if (outbox.status === 'pending') row.outbox_pending += 1;
            if (outbox.status === 'skipped') {
                row.outbox_skipped += 1;
                if (outbox.last_error_code === 'MISSING_TELEGRAM_ROUTE') {
                    row.blocked_missing_route += 1;
                }
            }
        }

        return Array.from(byOwner.values())
            .filter(row =>
                row.active > 0
                || row.urgent > 0
                || row.outbox_pending > 0
                || row.outbox_skipped > 0
                || row.blocked_missing_route > 0
            )
            .sort((a, b) =>
                (b.urgent - a.urgent)
                || (b.active - a.active)
                || (b.blocked_missing_route - a.blocked_missing_route)
                || (b.outbox_pending - a.outbox_pending)
                || (a.owner_user_id - b.owner_user_id)
            )
            .map(row => ({
                ...row,
                active: String(row.active),
                urgent: String(row.urgent),
                outbox_pending: String(row.outbox_pending),
                outbox_skipped: String(row.outbox_skipped),
                blocked_missing_route: String(row.blocked_missing_route)
            }));
    }

    async query(sql, params = []) {
        const text = sql.replace(/\s+/g, ' ').trim();
        this.calls.push({ text, params });

        if (text.startsWith('WITH task_scope AS')) {
            return { rows: this.ownerWorkloadDiagnosticRows(params) };
        }

        if (text.startsWith('SELECT COUNT(*) FILTER')) {
            const rows = Array.from(this.rows.values());
            const dayAgo = new Date(new Date(this.now).getTime() - 24 * 60 * 60 * 1000).getTime();
            const pendingRows = rows.filter(row => row.status === 'pending');
            const sentRows = rows.filter(row => row.status === 'sent');
            const oldestPending = pendingRows
                .map(row => row.available_at || row.created_at)
                .filter(Boolean)
                .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || null;
            const lastSent = sentRows
                .map(row => row.sent_at)
                .filter(Boolean)
                .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

            return {
                rows: [{
                    pending: String(pendingRows.length),
                    claimed: String(rows.filter(row => row.status === 'claimed').length),
                    sent_24h: String(sentRows.filter(row => row.sent_at && new Date(row.sent_at).getTime() >= dayAgo).length),
                    failed: String(rows.filter(row => row.status === 'failed').length),
                    dead_letter: String(rows.filter(row => row.status === 'dead_letter').length),
                    skipped: String(rows.filter(row => row.status === 'skipped').length),
                    blocked_missing_route: String(rows.filter(row =>
                        row.status === 'skipped' && row.last_error_code === 'MISSING_TELEGRAM_ROUTE'
                    ).length),
                    oldest_pending_at: oldestPending,
                    last_sent_at: lastSent
                }]
            };
        }

        if (text.startsWith('SELECT event_id, task_id, owner_user_id')) {
            const limit = Number(params[0]);
            const status = text.includes('WHERE status = $2') ? params[1] : null;
            let rows = Array.from(this.rows.values());
            if (status) rows = rows.filter(row => row.status === status);
            rows = rows
                .sort((a, b) => {
                    const timeDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                    return timeDiff || Number(b.id) - Number(a.id);
                })
                .slice(0, limit)
                .map(row => ({
                    event_id: row.event_id,
                    task_id: row.task_id,
                    owner_user_id: row.owner_user_id,
                    event_type: row.event_type,
                    status: row.status,
                    attempts: row.attempts,
                    created_at: row.created_at,
                    available_at: row.available_at,
                    last_error_code: row.last_error_code,
                    last_error: row.last_error
                }));
            return { rows };
        }

        if (text.startsWith('SELECT * FROM notification_outbox') && text.includes('ORDER BY id ASC')) {
            const status = params[0];
            let index = 1;
            let rows = Array.from(this.rows.values()).filter(row => row.status === status);
            if (status === 'pending' || status === 'failed') {
                rows = rows.filter(row => isAvailableAt(row.available_at, this.now));
            }
            if (text.includes('owner_user_id = $')) {
                const ownerUserId = Number(params[index]);
                index += 1;
                rows = rows.filter(row => Number(row.owner_user_id) === ownerUserId);
            }
            if (text.includes('event_type = $')) {
                const eventType = params[index];
                index += 1;
                rows = rows.filter(row => row.event_type === eventType);
            }
            if (text.includes('id > $')) {
                const cursor = Number(params[index]);
                rows = rows.filter(row => Number(row.id) > cursor);
            }
            const limit = Number(params[params.length - 1]);
            return {
                rows: rows
                    .sort((a, b) => Number(a.id) - Number(b.id))
                    .slice(0, limit)
                    .map(cloneRow)
            };
        }

        if (text.startsWith('SELECT * FROM notification_outbox') && text.includes('WHERE event_id = $1')) {
            const row = this.rows.get(params[0]);
            return { rows: row ? [cloneRow(row)] : [] };
        }

        if (text.startsWith("UPDATE notification_outbox SET status = 'claimed'")) {
            const [eventId, workerId, lockSeconds] = params;
            const row = this.rows.get(eventId);
            if (
                row
                && ['pending', 'failed', 'claimed'].includes(row.status)
                && isAvailableAt(row.available_at, this.now)
                && (row.status !== 'claimed' || !row.locked_until || isAvailableAt(row.locked_until, this.now))
            ) {
                row.status = 'claimed';
                row.claimed_at = this.now;
                row.claimed_by = workerId;
                row.locked_until = this.nextIso(Number(lockSeconds));
                row.updated_at = this.now;
                return { rows: [cloneRow(row)] };
            }
            return { rows: [] };
        }

        if (text.startsWith("UPDATE notification_outbox SET status = 'sent'")) {
            const [eventId, sentAt, channel, target] = params;
            const row = this.rows.get(eventId);
            row.status = 'sent';
            row.sent_at = sentAt || this.now;
            row.last_error = null;
            row.last_error_code = null;
            row.last_delivery_channel = channel;
            row.last_delivery_target = target;
            row.locked_until = null;
            row.updated_at = this.now;
            return { rows: [cloneRow(row)] };
        }

        if (text.startsWith("UPDATE notification_outbox SET status = 'skipped'")) {
            const [eventId, reasonMessage, reasonCode] = params;
            const row = this.rows.get(eventId);
            row.status = 'skipped';
            row.available_at = this.now;
            row.last_error = reasonMessage;
            row.last_error_code = reasonCode;
            row.locked_until = null;
            row.updated_at = this.now;
            return { rows: [cloneRow(row)] };
        }

        if (text.startsWith('UPDATE notification_outbox SET status = $2')) {
            const [eventId, status, attempts, backoffMinutes, errorMessage, errorCode] = params;
            const row = this.rows.get(eventId);
            row.status = status;
            row.attempts = attempts;
            row.available_at = status === 'failed'
                ? new Date(new Date(this.now).getTime() + Number(backoffMinutes) * 60000).toISOString()
                : this.now;
            row.last_error = errorMessage;
            row.last_error_code = errorCode;
            row.locked_until = null;
            row.updated_at = this.now;
            return { rows: [cloneRow(row)] };
        }

        throw new Error(`Unexpected fake query: ${text}`);
    }
}

async function withHermesOutboxApp(rows, work, options = {}) {
    const app = express();
    const pool = new FakeNotificationOutboxPool(rows, {
        now: options.now,
        tasks: options.tasks,
        users: options.users
    });
    app.use(express.json());
    app.use('/api/hermes', createHermesRouter({
        authMiddleware: hermesOutboxAuth,
        pool,
        rateLimit: false,
        env: options.env || {}
    }));
    const { server, baseUrl } = await listen(app);
    try {
        await work({ baseUrl, pool });
    } finally {
        await close(server);
    }
}

describe('Hermes notification_outbox routes', () => {
    it('rejects unauthenticated list requests', async () => {
        await withHermesOutboxApp([outboxRow({ id: 1 })], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/notification-outbox', undefined, {});
            assert.equal(res.status, 401);
            assert.equal(res.data.success, false);
        });
    });

    it('requires auth for notification_outbox stats', async () => {
        await withHermesOutboxApp([outboxRow({ id: 1 })], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/notification-outbox/stats', undefined, {});
            assert.equal(res.status, 401);
            assert.equal(res.data.success, false);
        });
    });

    it('requires auth for owner workload diagnostics', async () => {
        await withHermesOutboxApp([outboxRow({ id: 1 })], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/diagnostics/owner-workload', undefined, {});
            assert.equal(res.status, 401);
            assert.equal(res.data.success, false);
        });
    });

    it('advertises notification_outbox capabilities', async () => {
        await withHermesOutboxApp([], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/capabilities');
            assert.equal(res.status, 200);
            assert.equal(res.data.features.notificationOutbox, true);
            assert.equal(res.data.features.taskOutboxEmitEnabled, false);
            assert.equal(res.data.endpoints.notificationOutbox.maxLimit, 50);
            assert.equal(res.data.endpoints.notificationOutbox.claim, 'POST /api/hermes/notification-outbox/:eventId/claim');
            assert.equal(res.data.endpoints.notificationOutbox.skip, 'POST /api/hermes/notification-outbox/:eventId/skip');
            assert.equal(res.data.endpoints.notificationOutbox.stats, 'GET /api/hermes/notification-outbox/stats');
            assert.equal(res.data.endpoints.notificationOutbox.debug, 'GET /api/hermes/notification-outbox/debug');
            assert.equal(res.data.endpoints.diagnostics.ownerWorkload, 'GET /api/hermes/diagnostics/owner-workload');
            assert.ok(res.data.supportedActions.includes('notification_outbox.claim'));
            assert.ok(res.data.supportedActions.includes('notification_outbox.skip'));
            assert.ok(res.data.supportedActions.includes('notification_outbox.stats'));
            assert.ok(res.data.supportedActions.includes('diagnostics.owner_workload'));
        });
    });

    it('reports effective task outbox emit status from safe env-derived rules', async () => {
        await withHermesOutboxApp([], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/capabilities');
            assert.equal(res.status, 200);
            assert.equal(res.data.features.taskOutboxEmitEnabled, true);
        }, { env: { NODE_ENV: 'test' } });

        await withHermesOutboxApp([], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/capabilities');
            assert.equal(res.status, 200);
            assert.equal(res.data.features.taskOutboxEmitEnabled, true);
        }, { env: { NODE_ENV: 'production', HERMES_TASK_OUTBOX_ENABLED: 'true' } });

        await withHermesOutboxApp([], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/capabilities');
            assert.equal(res.status, 200);
            assert.equal(res.data.features.taskOutboxEmitEnabled, false);
        }, { env: { NODE_ENV: 'production', HERMES_TASK_OUTBOX_ENABLED: 'false' } });
    });

    it('does not leak raw env names or secret values in capabilities', async () => {
        await withHermesOutboxApp([], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/capabilities');
            assert.equal(res.status, 200);
            const serialized = JSON.stringify(res.data);
            assert.equal(serialized.includes('HERMES_TASK_OUTBOX_ENABLED'), false);
            assert.equal(serialized.includes('TELEGRAM_BOT_TOKEN'), false);
            assert.equal(serialized.includes('super-secret-token'), false);
        }, {
            env: {
                NODE_ENV: 'production',
                HERMES_TASK_OUTBOX_ENABLED: 'true',
                TELEGRAM_BOT_TOKEN: 'super-secret-token'
            }
        });
    });

    it('returns safe notification_outbox stats by status', async () => {
        await withHermesOutboxApp([
            outboxRow({ id: 1, event_id: 'task_created:1:owner:4', status: 'pending', available_at: '2026-06-29T11:00:00.000Z' }),
            outboxRow({ id: 2, event_id: 'task_created:2:owner:4', status: 'pending', available_at: '2026-06-29T10:00:00.000Z' }),
            outboxRow({ id: 3, event_id: 'task_created:3:owner:4', status: 'pending', available_at: '2026-06-29T13:00:00.000Z' }),
            outboxRow({ id: 4, event_id: 'task_created:4:owner:4', status: 'claimed' }),
            outboxRow({ id: 5, event_id: 'task_created:5:owner:4', status: 'sent', sent_at: '2026-06-29T11:50:00.000Z' }),
            outboxRow({ id: 6, event_id: 'task_created:6:owner:4', status: 'sent', sent_at: '2026-06-27T11:50:00.000Z' }),
            outboxRow({ id: 7, event_id: 'task_created:7:owner:4', status: 'failed' }),
            outboxRow({ id: 8, event_id: 'task_created:8:owner:4', status: 'dead_letter' }),
            outboxRow({
                id: 9,
                event_id: 'task_created:9:owner:4',
                status: 'skipped',
                last_error_code: 'MISSING_TELEGRAM_ROUTE'
            })
        ], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/notification-outbox/stats');
            assert.equal(res.status, 200);
            assert.deepEqual(res.data.stats, {
                pending: 3,
                claimed: 1,
                sent_24h: 1,
                failed: 1,
                dead_letter: 1,
                skipped: 1,
                blocked_missing_route: 1
            });
            assert.equal(res.data.oldestPendingAt, '2026-06-29T10:00:00.000Z');
            assert.equal(res.data.lastSentAt, '2026-06-29T11:50:00.000Z');
            assert.equal(res.data.payload_json, undefined);
        });
    });

    it('returns read-only owner workload and route-risk diagnostics by business scope', async () => {
        await withHermesOutboxApp([
            outboxRow({
                id: 101,
                event_id: 'task_created:101:owner:1',
                task_id: 101,
                owner_user_id: 1,
                status: 'pending',
                payload_json: {
                    title: 'Private title should not leak',
                    clientPhone: '+380001112233',
                    token: 'secret-token'
                }
            }),
            outboxRow({
                id: 102,
                event_id: 'task_created:102:owner:1',
                task_id: 102,
                owner_user_id: 1,
                status: 'skipped',
                last_error_code: 'MISSING_TELEGRAM_ROUTE',
                last_error: 'No Telegram route configured',
                payload_json: {
                    description: 'Private description should not leak',
                    cookie: 'secret-cookie'
                }
            }),
            outboxRow({
                id: 201,
                event_id: 'task_created:201:owner:2',
                task_id: 201,
                owner_user_id: 2,
                status: 'pending'
            }),
            outboxRow({
                id: 301,
                event_id: 'task_created:301:owner:1',
                task_id: 301,
                owner_user_id: 1,
                status: 'pending',
                payload_json: {
                    title: 'Foreign business title should not leak'
                }
            })
        ], async ({ baseUrl, pool }) => {
            const updateCallsBefore = pool.calls.filter(call => call.text.startsWith('UPDATE ')).length;
            const res = await request(baseUrl, 'GET', '/api/hermes/diagnostics/owner-workload?businessContext=event_genix');

            assert.equal(res.status, 200, res.text);
            assert.equal(res.data.success, true);
            assert.equal(res.data.meta.routeTruthSource, 'not_configured_in_crm');
            assert.equal(res.data.meta.sanitized, true);
            assert.equal(res.data.meta.readOnly, true);
            assert.equal(res.data.meta.businessScope.activeContext, 'event_genix');

            const owner1 = res.data.owners.find(owner => owner.ownerUserId === 1);
            const owner2 = res.data.owners.find(owner => owner.ownerUserId === 2);
            assert.ok(owner1);
            assert.ok(owner2);
            assert.equal(owner1.ownerLabel, 'Віталіна');
            assert.equal(owner1.active, 2);
            assert.equal(owner1.urgent, 1);
            assert.equal(owner1.outboxPending, 1);
            assert.equal(owner1.outboxSkipped, 1);
            assert.equal(owner1.blockedMissingRoute, 1);
            assert.equal(owner1.deliveryRouteStatus, 'unknown');
            assert.equal(owner2.active, 1);
            assert.equal(owner2.urgent, 0);
            assert.equal(owner2.outboxPending, 1);
            assert.equal(res.data.owners.some(owner => owner.ownerUserId === 3), false);

            const serialized = JSON.stringify(res.data);
            assert.equal(serialized.includes('Private title should not leak'), false);
            assert.equal(serialized.includes('Private description should not leak'), false);
            assert.equal(serialized.includes('Foreign business title should not leak'), false);
            assert.equal(serialized.includes('+380001112233'), false);
            assert.equal(serialized.includes('secret-token'), false);
            assert.equal(serialized.includes('secret-cookie'), false);
            assert.equal(serialized.includes('payload_json'), false);

            const updateCallsAfter = pool.calls.filter(call => call.text.startsWith('UPDATE ')).length;
            assert.equal(updateCallsAfter, updateCallsBefore);
            assert.equal(pool.rows.get('task_created:101:owner:1').status, 'pending');
            assert.equal(pool.rows.get('task_created:301:owner:1').status, 'pending');
        }, {
            users: [
                { id: 1, name: 'Віталіна' },
                { id: 2, name: 'Сергій' }
            ],
            tasks: [
                {
                    id: 101,
                    owner_user_id: 1,
                    status: 'todo',
                    priority: 'urgent',
                    business_context: 'event_genix',
                    title: 'Private title should not leak'
                },
                {
                    id: 102,
                    owner_user_id: 1,
                    status: 'in_progress',
                    priority: 'normal',
                    business_context: 'event_genix',
                    description: 'Private description should not leak'
                },
                {
                    id: 103,
                    owner_user_id: 1,
                    status: 'done',
                    priority: 'urgent',
                    business_context: 'event_genix'
                },
                {
                    id: 201,
                    owner_user_id: 2,
                    status: 'todo',
                    priority: 'high',
                    business_context: 'event_genix'
                },
                {
                    id: 301,
                    owner_user_id: 1,
                    status: 'todo',
                    priority: 'urgent',
                    business_context: 'dar',
                    title: 'Foreign business title should not leak'
                }
            ]
        });
    });

    it('caps notification_outbox debug limit at 50 and omits full payloads', async () => {
        const rows = Array.from({ length: 60 }, (_, index) => outboxRow({
            id: index + 1,
            event_id: `task_created:${index + 1}:owner:4`,
            task_id: index + 1,
            created_at: `2026-06-29T09:${String(index % 60).padStart(2, '0')}:00.000Z`
        }));
        await withHermesOutboxApp(rows, async ({ baseUrl, pool }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/notification-outbox/debug?limit=500');
            assert.equal(res.status, 200);
            assert.equal(res.data.items.length, 50);
            assert.equal(res.data.pagination.limit, 50);
            assert.equal(pool.calls.at(-1).params[0], 50);
            assert.equal(res.data.items[0].event_id.startsWith('task_created:'), true);
            assert.equal(res.data.items[0].payload_json, undefined);
            assert.equal(res.data.items[0].payload, undefined);
            assert.equal(res.data.items[0].last_error, null);
            assert.equal(Object.hasOwn(res.data.items[0], 'last_error_code'), true);
        });
    });

    it('lists only currently available pending events and sanitizes payloads', async () => {
        await withHermesOutboxApp([
            outboxRow({ id: 1, event_id: 'task_created:1:owner:4', status: 'pending' }),
            outboxRow({
                id: 2,
                event_id: 'task_created:2:owner:4',
                status: 'pending',
                available_at: '2026-06-30T09:00:00.000Z'
            }),
            outboxRow({ id: 3, event_id: 'task_created:3:owner:4', status: 'claimed' })
        ], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/notification-outbox?status=pending&limit=50');
            assert.equal(res.status, 200);
            assert.equal(res.data.items.length, 1);
            assert.equal(res.data.items[0].eventId, 'task_created:1:owner:4');
            assert.equal(res.data.items[0].payload.secretToken, undefined);
            assert.equal(res.data.pagination.limit, 50);
            assert.equal(res.data.pagination.hasMore, false);
        });
    });

    it('caps list limit at 50', async () => {
        const rows = Array.from({ length: 60 }, (_, index) => outboxRow({
            id: index + 1,
            event_id: `task_created:${index + 1}:owner:4`,
            task_id: index + 1
        }));
        await withHermesOutboxApp(rows, async ({ baseUrl, pool }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/notification-outbox?limit=500');
            assert.equal(res.status, 200);
            assert.equal(res.data.items.length, 50);
            assert.equal(res.data.pagination.limit, 50);
            assert.equal(pool.calls.at(-1).params.at(-1), 51);
        });
    });

    it('returns a sanitized event detail', async () => {
        await withHermesOutboxApp([outboxRow({ id: 10, event_id: 'task_created:10:owner:4' })], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'GET', '/api/hermes/notification-outbox/task_created:10:owner:4');
            assert.equal(res.status, 200);
            assert.equal(res.data.event.eventId, 'task_created:10:owner:4');
            assert.equal(res.data.event.payload.secretToken, undefined);
        });
    });

    it('claims pending events and reclaims expired locks', async () => {
        await withHermesOutboxApp([
            outboxRow({ id: 20, event_id: 'task_created:20:owner:4', status: 'pending' }),
            outboxRow({
                id: 21,
                event_id: 'task_created:21:owner:4',
                status: 'claimed',
                claimed_by: 'old-worker',
                locked_until: '2026-06-29T11:00:00.000Z'
            })
        ], async ({ baseUrl, pool }) => {
            const first = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:20:owner:4/claim', {
                workerId: 'worker-a',
                lockSeconds: 120
            });
            assert.equal(first.status, 200);
            assert.equal(first.data.event.status, 'claimed');
            assert.equal(pool.rows.get('task_created:20:owner:4').claimed_by, 'worker-a');

            const second = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:21:owner:4/claim', {
                workerId: 'worker-b',
                lockSeconds: 120
            });
            assert.equal(second.status, 200);
            assert.equal(second.data.event.claimedBy, 'worker-b');
            assert.equal(pool.rows.get('task_created:21:owner:4').claimed_by, 'worker-b');
        });
    });

    it('rejects claim when a lock is still active', async () => {
        await withHermesOutboxApp([
            outboxRow({
                id: 30,
                event_id: 'task_created:30:owner:4',
                status: 'claimed',
                claimed_by: 'worker-a',
                locked_until: '2026-06-29T12:10:00.000Z'
            })
        ], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:30:owner:4/claim', {
                workerId: 'worker-b',
                lockSeconds: 120
            });
            assert.equal(res.status, 409);
            assert.equal(res.data.code, 'OUTBOX_EVENT_ALREADY_CLAIMED');
        });
    });

    it('acks claimed events and treats already sent events as successful no-ops', async () => {
        await withHermesOutboxApp([
            outboxRow({
                id: 40,
                event_id: 'task_created:40:owner:4',
                status: 'claimed',
                claimed_by: 'worker-a',
                locked_until: '2026-06-29T12:10:00.000Z'
            })
        ], async ({ baseUrl, pool }) => {
            const ack = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:40:owner:4/ack', {
                workerId: 'worker-a',
                channel: 'telegram',
                target: '674972415',
                deliveryId: 'message-1',
                messageHash: 'message-hash',
                sentAt: '2026-06-29T12:01:00.000Z'
            });
            assert.equal(ack.status, 200);
            assert.equal(ack.data.alreadySent, false);
            assert.equal(ack.data.event.status, 'sent');
            assert.equal(pool.rows.get('task_created:40:owner:4').last_delivery_channel, 'telegram');

            const duplicate = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:40:owner:4/ack', {
                workerId: 'worker-a',
                channel: 'telegram',
                target: '674972415'
            });
            assert.equal(duplicate.status, 200);
            assert.equal(duplicate.data.alreadySent, true);
            assert.equal(duplicate.data.event.status, 'sent');
        });
    });

    it('skips missing-route events with sanitized reason and removes them from claimable pending', async () => {
        await withHermesOutboxApp([
            outboxRow({ id: 45, event_id: 'task_created:45:owner:1', status: 'pending' })
        ], async ({ baseUrl, pool }) => {
            const skipped = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:45:owner:1/skip', {
                workerId: 'worker-a',
                reasonCode: 'MISSING_TELEGRAM_ROUTE',
                reasonMessage: 'No Telegram\nroute configured for ownerUserId=1'
            });
            assert.equal(skipped.status, 200, skipped.text);
            assert.equal(skipped.data.alreadySkipped, false);
            assert.equal(skipped.data.event.status, 'skipped');
            assert.equal(skipped.data.event.lastErrorCode, 'MISSING_TELEGRAM_ROUTE');
            assert.equal(skipped.data.event.lastError, 'No Telegram route configured for ownerUserId=1');
            assert.equal(pool.rows.get('task_created:45:owner:1').status, 'skipped');

            const claim = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:45:owner:1/claim', {
                workerId: 'worker-b'
            });
            assert.equal(claim.status, 409);
            assert.equal(claim.data.code, 'OUTBOX_EVENT_NOT_CLAIMABLE');

            const stats = await request(baseUrl, 'GET', '/api/hermes/notification-outbox/stats');
            assert.equal(stats.status, 200);
            assert.equal(stats.data.stats.skipped, 1);
            assert.equal(stats.data.stats.blocked_missing_route, 1);

            const debug = await request(baseUrl, 'GET', '/api/hermes/notification-outbox/debug?status=skipped');
            assert.equal(debug.status, 200);
            assert.equal(debug.data.items[0].last_error_code, 'MISSING_TELEGRAM_ROUTE');
            assert.equal(debug.data.items[0].last_error, 'No Telegram route configured for ownerUserId=1');
            assert.equal(debug.data.items[0].payload_json, undefined);

            const duplicate = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:45:owner:1/skip', {
                workerId: 'worker-a',
                reasonCode: 'MISSING_TELEGRAM_ROUTE',
                reasonMessage: 'No Telegram route configured for ownerUserId=1'
            });
            assert.equal(duplicate.status, 200);
            assert.equal(duplicate.data.alreadySkipped, true);
        });
    });

    it('allows claimed events to be skipped only by the claiming worker', async () => {
        await withHermesOutboxApp([
            outboxRow({
                id: 46,
                event_id: 'task_created:46:owner:1',
                status: 'claimed',
                claimed_by: 'worker-a',
                locked_until: '2026-06-29T12:10:00.000Z'
            }),
            outboxRow({
                id: 47,
                event_id: 'task_created:47:owner:1',
                status: 'claimed',
                claimed_by: 'worker-a',
                locked_until: '2026-06-29T12:10:00.000Z'
            })
        ], async ({ baseUrl }) => {
            const wrongWorker = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:46:owner:1/skip', {
                workerId: 'worker-b',
                reasonCode: 'MISSING_TELEGRAM_ROUTE',
                reasonMessage: 'No Telegram route configured'
            });
            assert.equal(wrongWorker.status, 409);
            assert.equal(wrongWorker.data.code, 'OUTBOX_EVENT_CLAIMED_BY_DIFFERENT_WORKER');

            const sameWorker = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:47:owner:1/skip', {
                workerId: 'worker-a',
                reasonCode: 'MISSING_TELEGRAM_ROUTE',
                reasonMessage: 'No Telegram route configured'
            });
            assert.equal(sameWorker.status, 200, sameWorker.text);
            assert.equal(sameWorker.data.event.status, 'skipped');
        });
    });

    it('rejects skip for sent and dead-letter events', async () => {
        await withHermesOutboxApp([
            outboxRow({ id: 48, event_id: 'task_created:48:owner:1', status: 'sent' }),
            outboxRow({ id: 49, event_id: 'task_created:49:owner:1', status: 'dead_letter' })
        ], async ({ baseUrl }) => {
            const sent = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:48:owner:1/skip', {
                workerId: 'worker-a',
                reasonCode: 'MISSING_TELEGRAM_ROUTE',
                reasonMessage: 'No Telegram route configured'
            });
            assert.equal(sent.status, 409);
            assert.equal(sent.data.code, 'OUTBOX_EVENT_ALREADY_SENT');

            const deadLetter = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:49:owner:1/skip', {
                workerId: 'worker-a',
                reasonCode: 'MISSING_TELEGRAM_ROUTE',
                reasonMessage: 'No Telegram route configured'
            });
            assert.equal(deadLetter.status, 409);
            assert.equal(deadLetter.data.code, 'OUTBOX_EVENT_NOT_SKIPPABLE');
        });
    });

    it('fails retryable events with backoff', async () => {
        await withHermesOutboxApp([
            outboxRow({
                id: 50,
                event_id: 'task_created:50:owner:4',
                status: 'claimed',
                claimed_by: 'worker-a',
                locked_until: '2026-06-29T12:10:00.000Z'
            })
        ], async ({ baseUrl, pool }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:50:owner:4/fail', {
                workerId: 'worker-a',
                errorCode: 'TELEGRAM_RATE_LIMIT',
                errorMessage: 'rate\nlimit',
                retryable: true
            });
            assert.equal(res.status, 200);
            assert.equal(res.data.event.status, 'failed');
            assert.equal(res.data.attempts, 1);
            assert.equal(res.data.backoffMinutes, 1);
            assert.equal(pool.rows.get('task_created:50:owner:4').last_error, 'rate limit');
        });
    });

    it('rejects fail for pending or failed events that are not claimed', async () => {
        await withHermesOutboxApp([
            outboxRow({
                id: 55,
                event_id: 'task_created:55:owner:4',
                status: 'pending'
            }),
            outboxRow({
                id: 56,
                event_id: 'task_created:56:owner:4',
                status: 'failed',
                attempts: 1
            }),
            outboxRow({
                id: 57,
                event_id: 'task_created:57:owner:4',
                status: 'skipped',
                last_error_code: 'MISSING_TELEGRAM_ROUTE'
            })
        ], async ({ baseUrl }) => {
            const pending = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:55:owner:4/fail', {
                workerId: 'worker-a',
                errorCode: 'DELIVERY_FAILED',
                retryable: true
            });
            assert.equal(pending.status, 409);
            assert.equal(pending.data.code, 'OUTBOX_EVENT_NOT_CLAIMED');

            const failed = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:56:owner:4/fail', {
                workerId: 'worker-a',
                errorCode: 'DELIVERY_FAILED',
                retryable: true
            });
            assert.equal(failed.status, 409);
            assert.equal(failed.data.code, 'OUTBOX_EVENT_NOT_CLAIMED');

            const skipped = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:57:owner:4/fail', {
                workerId: 'worker-a',
                errorCode: 'DELIVERY_FAILED',
                retryable: true
            });
            assert.equal(skipped.status, 409);
            assert.equal(skipped.data.code, 'OUTBOX_EVENT_NOT_FAILABLE');
        });
    });

    it('rejects fail for events claimed by another worker', async () => {
        await withHermesOutboxApp([
            outboxRow({
                id: 57,
                event_id: 'task_created:57:owner:4',
                status: 'claimed',
                claimed_by: 'worker-a',
                locked_until: '2026-06-29T12:10:00.000Z'
            })
        ], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:57:owner:4/fail', {
                workerId: 'worker-b',
                errorCode: 'DELIVERY_FAILED',
                retryable: true
            });
            assert.equal(res.status, 409);
            assert.equal(res.data.code, 'OUTBOX_EVENT_CLAIMED_BY_DIFFERENT_WORKER');
        });
    });

    it('moves retryable failures to dead_letter on the fifth attempt', async () => {
        await withHermesOutboxApp([
            outboxRow({
                id: 60,
                event_id: 'task_created:60:owner:4',
                status: 'claimed',
                attempts: 4,
                claimed_by: 'worker-a',
                locked_until: '2026-06-29T12:10:00.000Z'
            })
        ], async ({ baseUrl }) => {
            const res = await request(baseUrl, 'POST', '/api/hermes/notification-outbox/task_created:60:owner:4/fail', {
                workerId: 'worker-a',
                errorCode: 'DELIVERY_FAILED',
                errorMessage: 'permanent after retries',
                retryable: true
            });
            assert.equal(res.status, 200);
            assert.equal(res.data.deadLetter, true);
            assert.equal(res.data.event.status, 'dead_letter');
            assert.equal(res.data.event.attempts, 5);
        });
    });
});
