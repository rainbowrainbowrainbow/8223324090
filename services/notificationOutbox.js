'use strict';

const crypto = require('crypto');
const { pool: defaultPool } = require('../db');
const { isTrustedDisposableQaSource } = require('./disposableQa');

const NOTIFICATION_OUTBOX_STATUSES = Object.freeze([
    'pending',
    'claimed',
    'sent',
    'failed',
    'dead_letter',
    'skipped'
]);

const INITIAL_TASK_NOTIFICATION_EVENT_TYPES = Object.freeze([
    'task_created',
    'task_assigned'
]);

const FUTURE_TASK_NOTIFICATION_EVENT_TYPES = Object.freeze([
    'task_reminder_due',
    'task_overdue',
    'task_updated'
]);

const TASK_NOTIFICATION_EVENT_TYPES = Object.freeze([
    ...INITIAL_TASK_NOTIFICATION_EVENT_TYPES,
    ...FUTURE_TASK_NOTIFICATION_EVENT_TYPES
]);

const TASK_NOTIFICATION_EVENT_TYPE_SET = new Set(TASK_NOTIFICATION_EVENT_TYPES);
const NOTIFICATION_OUTBOX_STATUS_SET = new Set(NOTIFICATION_OUTBOX_STATUSES);

const DEFAULT_NOTIFICATION_OUTBOX_LIMIT = 20;
const MAX_NOTIFICATION_OUTBOX_LIMIT = 50;
const DEFAULT_NOTIFICATION_OUTBOX_LOCK_SECONDS = 120;
const MAX_NOTIFICATION_OUTBOX_LOCK_SECONDS = 3600;
const DEAD_LETTER_ATTEMPT_THRESHOLD = 5;

const NOTIFICATION_OUTBOX_RETRY_BACKOFF_MINUTES = Object.freeze({
    1: 1,
    2: 5,
    3: 30,
    4: 120
});

const SAFE_TASK_PAYLOAD_FIELDS = Object.freeze([
    'taskId',
    'title',
    'status',
    'priority',
    'ownerUserId',
    'ownerLabel',
    'dueAt',
    'crmUrl',
    'createdAt',
    'updatedAt'
]);

const STATUS_MAP = Object.freeze({
    todo: 'open',
    in_progress: 'in_progress',
    done: 'done',
    archived: 'archived',
    cancelled: 'cancelled',
    canceled: 'cancelled'
});

const PRIORITIES = new Set(['critical', 'urgent', 'high', 'normal', 'low']);

function positiveIntegerOrNull(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function envFlag(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
}

function firstEnvFlag(...values) {
    for (const value of values) {
        const parsed = envFlag(value);
        if (parsed !== null) return parsed;
    }
    return null;
}

function firstPresent(source = {}, keys = []) {
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
}

function textOrNull(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
}

function safeTextOrNull(value, maxLength = 500) {
    const text = textOrNull(value);
    if (!text) return null;
    return text
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function trustedQaRunPublicIdFromNotificationPayload(...values) {
    for (const value of values) {
        if (!value || typeof value !== 'object') continue;
        const direct = safeTextOrNull(value.trustedQaRunPublicId || value.trusted_qa_run_public_id, 100);
        if (direct) return direct;
        const disposableQa = value.disposableQa
            || value.disposable_qa
            || value.extraData?.disposableQa
            || value.extra_data?.disposableQa;
        const runId = safeTextOrNull(disposableQa?.runId || disposableQa?.run_id, 100);
        if (runId && isTrustedDisposableQaSource(disposableQa?.source)) return runId;
    }
    return null;
}

function isoOrNull(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function compactObject(input = {}) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined && value !== null)
    );
}

function normalizeTaskId(task = {}) {
    return positiveIntegerOrNull(firstPresent(task, ['taskId', 'task_id', 'id']));
}

function normalizeOwnerUserId(task = {}) {
    return positiveIntegerOrNull(firstPresent(task, ['ownerUserId', 'owner_user_id']));
}

function normalizeEventType(eventType) {
    const normalized = String(eventType || '').trim();
    return TASK_NOTIFICATION_EVENT_TYPE_SET.has(normalized) ? normalized : null;
}

function normalizeOutboxStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return NOTIFICATION_OUTBOX_STATUS_SET.has(normalized) ? normalized : null;
}

function hermesTaskOutboxEnabled(options = {}, env = process.env) {
    if (typeof options.hermesOutboxEnabled === 'boolean') return options.hermesOutboxEnabled;

    const explicit = firstEnvFlag(
        env.HERMES_TASK_OUTBOX_ENABLED,
        env.HERMES_NOTIFICATION_OUTBOX_ENABLED,
        env.NOTIFICATION_OUTBOX_ENABLED
    );
    if (explicit !== null) return explicit;

    const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
    return ['test', 'development', 'local'].includes(nodeEnv);
}

function isActiveTaskForHermesOutbox(task = {}) {
    if (task.is_active === false || task.deleted_at || task.archived_at) return false;
    const status = String(task.status || task.workflow_state || 'todo').trim().toLowerCase();
    return !['done', 'completed', 'archived', 'cancelled', 'canceled', 'deleted'].includes(status);
}

function notificationOutboxHttpError(statusCode, code, message, meta = null) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    if (meta && typeof meta === 'object') err.meta = meta;
    return err;
}

function requireTaskNotificationIdentity(task = {}, eventType) {
    const taskId = normalizeTaskId(task);
    if (!taskId) {
        const err = new Error('Valid task_id is required for notification_outbox');
        err.code = 'NOTIFICATION_OUTBOX_TASK_ID_REQUIRED';
        throw err;
    }

    const ownerUserId = normalizeOwnerUserId(task);
    if (!ownerUserId) {
        const err = new Error('Valid owner_user_id is required for notification_outbox');
        err.code = 'NOTIFICATION_OUTBOX_OWNER_USER_ID_REQUIRED';
        throw err;
    }

    const type = normalizeEventType(eventType);
    if (!type) {
        const err = new Error('Valid event_type is required for notification_outbox');
        err.code = 'NOTIFICATION_OUTBOX_EVENT_TYPE_INVALID';
        throw err;
    }

    return { taskId, ownerUserId, eventType: type };
}

function normalizeStatus(value) {
    const raw = String(value || 'todo').trim().toLowerCase();
    return STATUS_MAP[raw] || 'open';
}

function normalizePriority(value) {
    const raw = String(value || 'normal').trim().toLowerCase();
    if (raw === 'medium') return 'normal';
    return PRIORITIES.has(raw) ? raw : 'normal';
}

function taskCrmUrl(taskId, context = {}) {
    const explicit = textOrNull(context.crmUrl || context.taskUrl);
    if (explicit) return explicit;

    const baseUrl = textOrNull(
        context.crmBaseUrl
        || context.baseUrl
        || context.publicBaseUrl
        || process.env.PUBLIC_BASE_URL
        || process.env.APP_BASE_URL
    );
    const path = `/tasks?open=${encodeURIComponent(taskId)}`;
    return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : path;
}

function taskDueAt(task = {}) {
    return isoOrNull(firstPresent(task, [
        'dueAt',
        'due_at',
        'scheduledStartAt',
        'scheduled_start_at',
        'deadline',
        'date'
    ]));
}

function ownerLabel(task = {}) {
    return textOrNull(firstPresent(task, [
        'ownerLabel',
        'owner_label',
        'owner_name',
        'ownerName',
        'owner_username',
        'ownerUsername',
        'assigned_to',
        'assignedTo',
        'owner'
    ]));
}

function buildTaskNotificationPayload(task = {}, context = {}) {
    const { taskId, ownerUserId } = requireTaskNotificationIdentity(
        task,
        context.eventType || context.event_type || 'task_created'
    );

    return compactObject({
        taskId,
        title: textOrNull(task.title) || `Task #${taskId}`,
        status: normalizeStatus(task.status),
        priority: normalizePriority(task.priority),
        ownerUserId,
        ownerLabel: ownerLabel(task),
        dueAt: taskDueAt(task),
        crmUrl: taskCrmUrl(taskId, context),
        createdAt: isoOrNull(firstPresent(task, ['createdAt', 'created_at'])),
        updatedAt: isoOrNull(firstPresent(task, ['updatedAt', 'updated_at', 'createdAt', 'created_at']))
    });
}

function stableValue(value) {
    if (value === undefined) return null;
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(stableValue);
    if (typeof value !== 'object') return value;

    const output = {};
    for (const key of Object.keys(value).sort()) {
        output[key] = stableValue(value[key]);
    }
    return output;
}

function stableJsonStringify(value) {
    return JSON.stringify(stableValue(value));
}

function hashNotificationPayload(payload) {
    return crypto
        .createHash('sha256')
        .update(stableJsonStringify(payload))
        .digest('hex');
}

function generateNotificationEventId(task = {}, eventType) {
    const identity = requireTaskNotificationIdentity(task, eventType);
    return `${identity.eventType}:${identity.taskId}:owner:${identity.ownerUserId}`;
}

function normalizeOutboxRow(row = null) {
    if (!row) return null;
    let payloadJson = row.payload_json;
    if (typeof payloadJson === 'string') {
        try {
            payloadJson = JSON.parse(payloadJson);
        } catch {
            payloadJson = {};
        }
    }
    return {
        ...row,
        payload_json: payloadJson && typeof payloadJson === 'object' && !Array.isArray(payloadJson)
            ? payloadJson
            : {}
    };
}

function sanitizeTaskNotificationPayload(payload = {}) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const sanitized = {};
    for (const key of SAFE_TASK_PAYLOAD_FIELDS) {
        if (source[key] !== undefined && source[key] !== null) {
            sanitized[key] = source[key];
        }
    }
    return sanitized;
}

function toNotificationOutboxApiEvent(row = null) {
    const normalized = normalizeOutboxRow(row);
    if (!normalized) return null;

    return compactObject({
        eventId: normalized.event_id,
        taskId: normalized.task_id === undefined || normalized.task_id === null ? null : Number(normalized.task_id),
        ownerUserId: normalized.owner_user_id === undefined || normalized.owner_user_id === null ? null : Number(normalized.owner_user_id),
        eventType: normalized.event_type,
        payload: sanitizeTaskNotificationPayload(normalized.payload_json),
        payloadHash: normalized.payload_hash || null,
        status: normalized.status,
        attempts: Number(normalized.attempts || 0),
        availableAt: isoOrNull(normalized.available_at),
        createdAt: isoOrNull(normalized.created_at),
        updatedAt: isoOrNull(normalized.updated_at),
        claimedAt: isoOrNull(normalized.claimed_at),
        sentAt: isoOrNull(normalized.sent_at),
        claimedBy: safeTextOrNull(normalized.claimed_by, 120),
        lockedUntil: isoOrNull(normalized.locked_until),
        lastError: safeTextOrNull(normalized.last_error, 500),
        lastErrorCode: safeTextOrNull(normalized.last_error_code, 120),
        lastDeliveryChannel: safeTextOrNull(normalized.last_delivery_channel, 80),
        lastDeliveryTarget: safeTextOrNull(normalized.last_delivery_target, 200)
    });
}

function toNotificationOutboxDebugItem(row = null) {
    if (!row) return null;
    return {
        event_id: safeTextOrNull(row.event_id, 240),
        task_id: row.task_id === undefined || row.task_id === null ? null : Number(row.task_id),
        owner_user_id: row.owner_user_id === undefined || row.owner_user_id === null ? null : Number(row.owner_user_id),
        event_type: safeTextOrNull(row.event_type, 80),
        status: safeTextOrNull(row.status, 40),
        attempts: Number(row.attempts || 0),
        created_at: isoOrNull(row.created_at),
        available_at: isoOrNull(row.available_at),
        last_error_code: safeTextOrNull(row.last_error_code, 120),
        last_error: safeTextOrNull(row.last_error, 500)
    };
}

function normalizeNotificationOutboxLimit(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_NOTIFICATION_OUTBOX_LIMIT;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_NOTIFICATION_OUTBOX_LIMIT;
    return Math.min(parsed, MAX_NOTIFICATION_OUTBOX_LIMIT);
}

function normalizeCursor(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) {
        throw notificationOutboxHttpError(400, 'OUTBOX_INVALID_CURSOR', 'cursor must be a positive integer cursor');
    }
    const parsed = Number.parseInt(text, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw notificationOutboxHttpError(400, 'OUTBOX_INVALID_CURSOR', 'cursor must be a positive integer cursor');
    }
    return parsed;
}

function pushSqlParam(params, value) {
    params.push(value);
    return `$${params.length}`;
}

function isFutureTimestamp(value) {
    const iso = isoOrNull(value);
    return iso ? new Date(iso).getTime() > Date.now() : false;
}

function requireWorkerId(value) {
    const workerId = safeTextOrNull(value, 120);
    if (!workerId) {
        throw notificationOutboxHttpError(400, 'OUTBOX_WORKER_ID_REQUIRED', 'workerId is required');
    }
    return workerId;
}

function normalizeLockSeconds(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_NOTIFICATION_OUTBOX_LOCK_SECONDS;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw notificationOutboxHttpError(400, 'OUTBOX_INVALID_LOCK_SECONDS', 'lockSeconds must be a positive integer');
    }
    return Math.min(parsed, MAX_NOTIFICATION_OUTBOX_LOCK_SECONDS);
}

function normalizeSentAt(value) {
    if (value === undefined || value === null || value === '') return null;
    const iso = isoOrNull(value);
    if (!iso) {
        throw notificationOutboxHttpError(400, 'OUTBOX_INVALID_SENT_AT', 'sentAt must be a valid timestamp');
    }
    return iso;
}

function requireDeliveryChannel(value) {
    const channel = safeTextOrNull(value, 80);
    if (!channel) {
        throw notificationOutboxHttpError(400, 'OUTBOX_DELIVERY_CHANNEL_REQUIRED', 'channel is required');
    }
    return channel;
}

function requireDeliveryTarget(value) {
    const target = safeTextOrNull(value, 200);
    if (!target) {
        throw notificationOutboxHttpError(400, 'OUTBOX_DELIVERY_TARGET_REQUIRED', 'target is required');
    }
    return target;
}

function requireSkipReasonCode(value) {
    const reasonCode = safeTextOrNull(value, 120);
    if (!reasonCode) {
        throw notificationOutboxHttpError(400, 'OUTBOX_SKIP_REASON_CODE_REQUIRED', 'reasonCode is required');
    }
    return reasonCode;
}

function requireSkipReasonMessage(value) {
    const reasonMessage = safeTextOrNull(value, 500);
    if (!reasonMessage) {
        throw notificationOutboxHttpError(400, 'OUTBOX_SKIP_REASON_REQUIRED', 'reasonMessage is required');
    }
    return reasonMessage;
}

function canWorkerMutateClaim(row, workerId) {
    const claimedBy = safeTextOrNull(row?.claimed_by, 120);
    return !claimedBy || !workerId || claimedBy === workerId;
}

function assertClaimedByWorker(row, workerId) {
    if (row?.status !== 'claimed') {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_NOT_CLAIMED', 'notification_outbox event is not claimed');
    }
    if (!canWorkerMutateClaim(row, workerId)) {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_CLAIMED_BY_DIFFERENT_WORKER', 'notification_outbox event is claimed by another worker', {
            claimedBy: safeTextOrNull(row.claimed_by, 120),
            lockedUntil: isoOrNull(row.locked_until)
        });
    }
}

function throwClaimConflict(row) {
    if (!row) {
        throw notificationOutboxHttpError(404, 'OUTBOX_EVENT_NOT_FOUND', 'notification_outbox event was not found');
    }
    if (row.status === 'sent') {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_ALREADY_SENT', 'notification_outbox event is already sent');
    }
    if (row.status === 'claimed') {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_ALREADY_CLAIMED', 'notification_outbox event is already claimed', {
            claimedBy: safeTextOrNull(row.claimed_by, 120),
            lockedUntil: isoOrNull(row.locked_until)
        });
    }
    if ((row.status === 'pending' || row.status === 'failed') && isFutureTimestamp(row.available_at)) {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_NOT_AVAILABLE', 'notification_outbox event is not available yet', {
            availableAt: isoOrNull(row.available_at)
        });
    }
    throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_NOT_CLAIMABLE', 'notification_outbox event cannot be claimed from its current status', {
        status: row.status
    });
}

async function findNotificationOutboxEventByEventId(eventId, options = {}) {
    const query = options.pool || defaultPool;
    const normalizedEventId = textOrNull(eventId);
    if (!normalizedEventId) return null;

    const result = await query.query(
        `SELECT *
         FROM notification_outbox
         WHERE event_id = $1
         LIMIT 1`,
        [normalizedEventId]
    );
    return normalizeOutboxRow(result.rows?.[0] || null);
}

async function listNotificationOutboxEvents(filters = {}, options = {}) {
    const query = options.pool || defaultPool;
    const limit = normalizeNotificationOutboxLimit(filters.limit);
    const status = filters.status === undefined || filters.status === null || filters.status === ''
        ? 'pending'
        : normalizeOutboxStatus(filters.status);
    if (!status) {
        throw notificationOutboxHttpError(400, 'OUTBOX_INVALID_STATUS', 'Invalid notification_outbox status');
    }

    const ownerUserId = filters.ownerUserId === undefined || filters.ownerUserId === null || filters.ownerUserId === ''
        ? null
        : positiveIntegerOrNull(filters.ownerUserId);
    if (filters.ownerUserId !== undefined && filters.ownerUserId !== null && filters.ownerUserId !== '' && !ownerUserId) {
        throw notificationOutboxHttpError(400, 'OUTBOX_INVALID_OWNER_USER_ID', 'ownerUserId must be a positive integer');
    }

    const eventType = filters.eventType === undefined || filters.eventType === null || filters.eventType === ''
        ? null
        : normalizeEventType(filters.eventType);
    if (filters.eventType !== undefined && filters.eventType !== null && filters.eventType !== '' && !eventType) {
        throw notificationOutboxHttpError(400, 'OUTBOX_INVALID_EVENT_TYPE', 'Invalid notification_outbox eventType');
    }

    const cursor = normalizeCursor(filters.cursor);
    const whereParts = ['status = $1'];
    const params = [status];

    if (status === 'pending' || status === 'failed') {
        whereParts.push('(available_at IS NULL OR available_at <= NOW())');
    }
    if (ownerUserId) {
        whereParts.push(`owner_user_id = ${pushSqlParam(params, ownerUserId)}`);
    }
    if (eventType) {
        whereParts.push(`event_type = ${pushSqlParam(params, eventType)}`);
    }
    if (cursor) {
        whereParts.push(`id > ${pushSqlParam(params, cursor)}`);
    }

    const limitParam = pushSqlParam(params, limit + 1);
    const result = await query.query(
        `SELECT *
         FROM notification_outbox
         WHERE ${whereParts.join(' AND ')}
         ORDER BY id ASC
         LIMIT ${limitParam}`,
        params
    );
    const rows = (result.rows || []).map(normalizeOutboxRow);
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit);
    const lastEvent = events[events.length - 1] || null;

    return {
        events,
        pagination: {
            limit,
            hasMore,
            nextCursor: hasMore && lastEvent?.id ? String(lastEvent.id) : null
        }
    };
}

async function getNotificationOutboxStats(options = {}) {
    const query = options.pool || defaultPool;
    const result = await query.query(
        `SELECT
             COUNT(*) FILTER (WHERE status = 'pending') AS pending,
             COUNT(*) FILTER (WHERE status = 'claimed') AS claimed,
             COUNT(*) FILTER (WHERE status = 'sent' AND sent_at >= NOW() - INTERVAL '24 hours') AS sent_24h,
             COUNT(*) FILTER (WHERE status = 'failed') AS failed,
             COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter,
             COUNT(*) FILTER (WHERE status = 'skipped') AS skipped,
             COUNT(*) FILTER (WHERE status = 'skipped' AND last_error_code = 'MISSING_TELEGRAM_ROUTE') AS blocked_missing_route,
             MIN(COALESCE(available_at, created_at)) FILTER (WHERE status = 'pending') AS oldest_pending_at,
             MAX(sent_at) FILTER (WHERE status = 'sent') AS last_sent_at
         FROM notification_outbox`
    );
    const row = result.rows?.[0] || {};
    return {
        stats: {
            pending: Number(row.pending || 0),
            claimed: Number(row.claimed || 0),
            sent_24h: Number(row.sent_24h || 0),
            failed: Number(row.failed || 0),
            dead_letter: Number(row.dead_letter || 0),
            skipped: Number(row.skipped || 0),
            blocked_missing_route: Number(row.blocked_missing_route || 0)
        },
        oldestPendingAt: isoOrNull(row.oldest_pending_at),
        lastSentAt: isoOrNull(row.last_sent_at)
    };
}

async function listNotificationOutboxDebugEvents(filters = {}, options = {}) {
    const query = options.pool || defaultPool;
    const limit = normalizeNotificationOutboxLimit(filters.limit);
    const status = filters.status === undefined || filters.status === null || filters.status === ''
        ? null
        : normalizeOutboxStatus(filters.status);
    if (filters.status !== undefined && filters.status !== null && filters.status !== '' && !status) {
        throw notificationOutboxHttpError(400, 'OUTBOX_INVALID_STATUS', 'Invalid notification_outbox status');
    }

    const params = [limit];
    const whereSql = status ? `WHERE status = ${pushSqlParam(params, status)}` : '';
    const result = await query.query(
        `SELECT
             event_id,
             task_id,
             owner_user_id,
             event_type,
             status,
             attempts,
             created_at,
             available_at,
             last_error_code,
             last_error
         FROM notification_outbox
         ${whereSql}
         ORDER BY created_at DESC, id DESC
         LIMIT $1`,
        params
    );

    return {
        items: (result.rows || []).map(toNotificationOutboxDebugItem).filter(Boolean),
        pagination: {
            limit,
            hasMore: false,
            nextCursor: null
        }
    };
}

async function claimNotificationOutboxEvent(eventId, input = {}, options = {}) {
    const query = options.pool || defaultPool;
    const normalizedEventId = textOrNull(eventId);
    if (!normalizedEventId) {
        throw notificationOutboxHttpError(404, 'OUTBOX_EVENT_NOT_FOUND', 'notification_outbox event was not found');
    }
    const workerId = requireWorkerId(input.workerId || input.worker_id);
    const lockSeconds = normalizeLockSeconds(input.lockSeconds || input.lock_seconds);

    const claimed = await query.query(
        `UPDATE notification_outbox
         SET status = 'claimed',
             claimed_at = NOW(),
             claimed_by = $2,
             locked_until = NOW() + ($3::int * INTERVAL '1 second'),
             updated_at = NOW()
         WHERE event_id = $1
           AND status IN ('pending', 'failed', 'claimed')
           AND (available_at IS NULL OR available_at <= NOW())
           AND (status <> 'claimed' OR locked_until IS NULL OR locked_until <= NOW())
         RETURNING *`,
        [normalizedEventId, workerId, lockSeconds]
    );
    if (claimed.rows?.length) {
        return {
            event: normalizeOutboxRow(claimed.rows[0]),
            claimed: true,
            workerId,
            lockSeconds
        };
    }

    throwClaimConflict(await findNotificationOutboxEventByEventId(normalizedEventId, { pool: query }));
}

async function ackNotificationOutboxEvent(eventId, input = {}, options = {}) {
    const query = options.pool || defaultPool;
    const normalizedEventId = textOrNull(eventId);
    if (!normalizedEventId) {
        throw notificationOutboxHttpError(404, 'OUTBOX_EVENT_NOT_FOUND', 'notification_outbox event was not found');
    }

    const workerId = requireWorkerId(input.workerId || input.worker_id);
    const channel = requireDeliveryChannel(input.channel);
    const target = requireDeliveryTarget(input.target);
    const sentAt = normalizeSentAt(input.sentAt || input.sent_at);
    const existing = await findNotificationOutboxEventByEventId(normalizedEventId, { pool: query });
    if (!existing) {
        throw notificationOutboxHttpError(404, 'OUTBOX_EVENT_NOT_FOUND', 'notification_outbox event was not found');
    }
    if (existing.status === 'sent') {
        return {
            event: existing,
            alreadySent: true,
            workerId
        };
    }
    assertClaimedByWorker(existing, workerId);

    const updated = await query.query(
        `UPDATE notification_outbox
         SET status = 'sent',
             sent_at = COALESCE($2::timestamptz, NOW()),
             last_error = NULL,
             last_error_code = NULL,
             last_delivery_channel = $3,
             last_delivery_target = $4,
             locked_until = NULL,
             updated_at = NOW()
         WHERE event_id = $1
         RETURNING *`,
        [normalizedEventId, sentAt, channel, target]
    );

    return {
        event: normalizeOutboxRow(updated.rows?.[0] || existing),
        alreadySent: false,
        workerId
    };
}

async function failNotificationOutboxEvent(eventId, input = {}, options = {}) {
    const query = options.pool || defaultPool;
    const normalizedEventId = textOrNull(eventId);
    if (!normalizedEventId) {
        throw notificationOutboxHttpError(404, 'OUTBOX_EVENT_NOT_FOUND', 'notification_outbox event was not found');
    }

    const workerId = requireWorkerId(input.workerId || input.worker_id);
    const errorCode = safeTextOrNull(input.errorCode || input.error_code, 120) || 'HERMES_DELIVERY_FAILED';
    const errorMessage = safeTextOrNull(input.errorMessage || input.error_message || input.message, 500);
    const retryable = input.retryable !== false;
    const existing = await findNotificationOutboxEventByEventId(normalizedEventId, { pool: query });
    if (!existing) {
        throw notificationOutboxHttpError(404, 'OUTBOX_EVENT_NOT_FOUND', 'notification_outbox event was not found');
    }
    if (existing.status === 'sent') {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_ALREADY_SENT', 'notification_outbox event is already sent');
    }
    if (existing.status === 'dead_letter' || existing.status === 'skipped') {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_NOT_FAILABLE', 'notification_outbox event cannot be failed from its current status', {
            status: existing.status
        });
    }
    assertClaimedByWorker(existing, workerId);

    const attempts = Number(existing.attempts || 0) + 1;
    const status = retryable && attempts < DEAD_LETTER_ATTEMPT_THRESHOLD ? 'failed' : 'dead_letter';
    const backoffMinutes = status === 'failed' ? NOTIFICATION_OUTBOX_RETRY_BACKOFF_MINUTES[attempts] || 120 : 0;

    const updated = await query.query(
        `UPDATE notification_outbox
         SET status = $2,
             attempts = $3,
             available_at = CASE
                 WHEN $2 = 'failed' THEN NOW() + ($4::int * INTERVAL '1 minute')
                 ELSE NOW()
             END,
             last_error = $5,
             last_error_code = $6,
             locked_until = NULL,
             updated_at = NOW()
         WHERE event_id = $1
         RETURNING *`,
        [normalizedEventId, status, attempts, backoffMinutes, errorMessage, errorCode]
    );

    return {
        event: normalizeOutboxRow(updated.rows?.[0] || existing),
        retryable,
        deadLetter: status === 'dead_letter',
        attempts,
        backoffMinutes,
        workerId
    };
}

async function skipNotificationOutboxEvent(eventId, input = {}, options = {}) {
    const query = options.pool || defaultPool;
    const normalizedEventId = textOrNull(eventId);
    if (!normalizedEventId) {
        throw notificationOutboxHttpError(404, 'OUTBOX_EVENT_NOT_FOUND', 'notification_outbox event was not found');
    }

    const workerId = requireWorkerId(input.workerId || input.worker_id);
    const reasonCode = requireSkipReasonCode(input.reasonCode || input.reason_code);
    const reasonMessage = requireSkipReasonMessage(input.reasonMessage || input.reason_message || input.message);
    const existing = await findNotificationOutboxEventByEventId(normalizedEventId, { pool: query });
    if (!existing) {
        throw notificationOutboxHttpError(404, 'OUTBOX_EVENT_NOT_FOUND', 'notification_outbox event was not found');
    }
    if (existing.status === 'skipped') {
        return {
            event: existing,
            alreadySkipped: true,
            workerId
        };
    }
    if (existing.status === 'sent') {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_ALREADY_SENT', 'notification_outbox event is already sent');
    }
    if (existing.status === 'dead_letter') {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_NOT_SKIPPABLE', 'notification_outbox event cannot be skipped from its current status', {
            status: existing.status
        });
    }
    if (!['pending', 'failed', 'claimed'].includes(existing.status)) {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_NOT_SKIPPABLE', 'notification_outbox event cannot be skipped from its current status', {
            status: existing.status
        });
    }
    if (existing.status === 'claimed' && !canWorkerMutateClaim(existing, workerId)) {
        throw notificationOutboxHttpError(409, 'OUTBOX_EVENT_CLAIMED_BY_DIFFERENT_WORKER', 'notification_outbox event is claimed by another worker', {
            claimedBy: safeTextOrNull(existing.claimed_by, 120),
            lockedUntil: isoOrNull(existing.locked_until)
        });
    }

    const updated = await query.query(
        `UPDATE notification_outbox
         SET status = 'skipped',
             available_at = NOW(),
             last_error = $2,
             last_error_code = $3,
             locked_until = NULL,
             updated_at = NOW()
         WHERE event_id = $1
         RETURNING *`,
        [normalizedEventId, reasonMessage, reasonCode]
    );

    return {
        event: normalizeOutboxRow(updated.rows?.[0] || existing),
        alreadySkipped: false,
        workerId
    };
}

async function createNotificationOutboxEvent(input = {}, options = {}) {
    const query = options.pool || defaultPool;
    const task = input.task || input;
    const eventType = normalizeEventType(input.eventType || input.event_type || options.eventType || options.event_type);
    const identity = requireTaskNotificationIdentity(task, eventType);
    const rawPayload = input.payload || buildTaskNotificationPayload(task, {
        ...(options.context || {}),
        ...(input.context || {}),
        eventType: identity.eventType
    });
    const payload = sanitizeTaskNotificationPayload(rawPayload);
    const payloadHash = hashNotificationPayload(payload);
    const eventId = textOrNull(input.eventId || input.event_id)
        || generateNotificationEventId(task, identity.eventType);
    const availableAt = input.availableAt || input.available_at || options.availableAt || null;
    const trustedQaRunPublicId = trustedQaRunPublicIdFromNotificationPayload(
        input,
        options,
        payload,
        options.context,
        input.context
    );

    const inserted = await query.query(
        `INSERT INTO notification_outbox (
             event_id,
             task_id,
             owner_user_id,
             event_type,
             payload_json,
             payload_hash,
             status,
             available_at,
             trusted_qa_run_public_id
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'pending', COALESCE($7::timestamptz, NOW()), $8)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
            eventId,
            identity.taskId,
            identity.ownerUserId,
            identity.eventType,
            JSON.stringify(payload),
            payloadHash,
            availableAt,
            trustedQaRunPublicId
        ]
    );

    if (inserted.rows?.length) {
        return {
            event: normalizeOutboxRow(inserted.rows[0]),
            created: true
        };
    }

    const existing = await query.query(
        `SELECT *
         FROM notification_outbox
         WHERE event_id = $1
            OR (
                task_id = $2
                AND owner_user_id = $3
                AND event_type = $4
                AND payload_hash = $5
            )
         ORDER BY CASE WHEN event_id = $1 THEN 0 ELSE 1 END, id ASC
         LIMIT 1`,
        [eventId, identity.taskId, identity.ownerUserId, identity.eventType, payloadHash]
    );

    return {
        event: normalizeOutboxRow(existing.rows?.[0] || null),
        created: false
    };
}

async function emitTaskCreatedNotificationOutboxEvent(task = {}, options = {}) {
    const ownerUserId = normalizeOwnerUserId(task);
    if (!ownerUserId) {
        return { created: false, reason: 'no_owner_user_id' };
    }
    if (!isActiveTaskForHermesOutbox(task)) {
        return { created: false, reason: 'inactive_task_status' };
    }
    if (options.skipHermesOutbox === true) {
        return { created: false, reason: 'skip_hermes_outbox' };
    }
    if (!hermesTaskOutboxEnabled(options, options.env || process.env)) {
        return { created: false, reason: 'hermes_task_outbox_disabled' };
    }

    return createNotificationOutboxEvent({
        task,
        eventType: 'task_created',
        context: options.hermesOutboxContext || options.notificationContext || {}
    }, {
        pool: options.pool
    });
}

module.exports = {
    DEFAULT_NOTIFICATION_OUTBOX_LIMIT,
    FUTURE_TASK_NOTIFICATION_EVENT_TYPES,
    INITIAL_TASK_NOTIFICATION_EVENT_TYPES,
    MAX_NOTIFICATION_OUTBOX_LIMIT,
    NOTIFICATION_OUTBOX_STATUSES,
    TASK_NOTIFICATION_EVENT_TYPES,
    ackNotificationOutboxEvent,
    buildTaskNotificationPayload,
    claimNotificationOutboxEvent,
    createNotificationOutboxEvent,
    emitTaskCreatedNotificationOutboxEvent,
    failNotificationOutboxEvent,
    findNotificationOutboxEventByEventId,
    generateNotificationEventId,
    getNotificationOutboxStats,
    hashNotificationPayload,
    hermesTaskOutboxEnabled,
    isActiveTaskForHermesOutbox,
    listNotificationOutboxDebugEvents,
    listNotificationOutboxEvents,
    skipNotificationOutboxEvent,
    stableJsonStringify,
    toNotificationOutboxApiEvent,
    toNotificationOutboxDebugItem
};
