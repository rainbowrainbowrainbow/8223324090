'use strict';

const express = require('express');
const { pool } = require('../db');
const {
    HERMES_INTEGRATION_ID,
    hermesAuth
} = require('../middleware/hermesAuth');
const {
    buildTaskVisibilityScope,
    normalizeUserId
} = require('../services/taskPolicy');
const {
    DEFAULT_TASK_BUSINESS_CONTEXT,
    activeTaskBusinessContext,
    ensureTaskBusinessScope,
    ensureWritableTaskBusinessScope,
    pushTaskBusinessScopeCondition,
    taskBusinessScopeMeta
} = require('../services/taskBusinessScope');
const {
    completeTask,
    getAssignableTaskOwner,
    reassignTaskOwner,
    resolveDeadline,
    rescheduleTask,
    updateTaskStatus
} = require('../services/taskExecution');
const {
    TaskDuplicateError,
    findActiveDuplicateTask
} = require('../services/taskDuplicatePolicy');
const {
    normalizeSubtasksInput,
    replaceTaskSubtasks
} = require('../services/taskSubtasks');
const { listTaskActionHistory } = require('../services/taskActionHistory');
const {
    MAX_HERMES_LIMIT,
    toHermesPagination,
    toHermesTaskDetail,
    toHermesTaskHistoryEvent,
    toHermesTaskListItem
} = require('../services/hermesTaskMapper');
const { requireHermesMutationGuard } = require('../services/hermesMutationGuard');
const { withHermesIdempotency } = require('../services/hermesIdempotency');
const {
    buildMenuImagePrompt,
    generateAndStoreMenuPhotoDraft,
    normalizeMenuImageSize,
    normalizeMenuImageStyle,
    resolveMenuImageOpenAIModel
} = require('../services/menuPhotoGeneration');
const { buildTaskCabinetProjection } = require('../services/taskCabinetProjection');
const {
    createTaskWatchdogCallbackDryRunHandler,
    createTaskWatchdogPreviewHandler
} = require('../services/taskWatchdogRoutes');
const {
    ackNotificationOutboxEvent,
    claimNotificationOutboxEvent,
    failNotificationOutboxEvent,
    findNotificationOutboxEventByEventId,
    getNotificationOutboxStats,
    listNotificationOutboxDebugEvents,
    listNotificationOutboxEvents,
    toNotificationOutboxApiEvent
} = require('../services/notificationOutbox');
const { createLogger } = require('../utils/logger');

const log = createLogger('Hermes');

const SUPPORTED_ACTIONS = [
    'tasks.read',
    'tasks.detail',
    'tasks.history',
    'tasks.my_cabinet',
    'tasks.create',
    'tasks.complete',
    'tasks.reassign',
    'tasks.reschedule',
    'tasks.status',
    'menu_photos.read',
    'menu_photos.candidates',
    'menu_photos.draft',
    'menu_photos.apply',
    'menu_photos.reject',
    'task_watchdog.preview',
    'task_watchdog.callback_dry_run',
    'notification_outbox.read',
    'notification_outbox.detail',
    'notification_outbox.claim',
    'notification_outbox.ack',
    'notification_outbox.fail',
    'notification_outbox.stats',
    'notification_outbox.debug'
];

const PLANNED_MUTATION_ACTIONS = [];

const HERMES_TO_CRM_STATUS = Object.freeze({
    open: 'todo',
    todo: 'todo',
    in_progress: 'in_progress',
    done: 'done',
    archived: 'archived',
    cancelled: 'cancelled'
});

const HERMES_TO_CRM_PRIORITY = Object.freeze({
    critical: 'urgent',
    urgent: 'urgent',
    high: 'high',
    normal: 'normal',
    medium: 'normal',
    low: 'low'
});

const HERMES_CREATE_ALLOWED_FIELDS = new Set([
    'title',
    'description',
    'date',
    'due_at',
    'dueAt',
    'deadline',
    'priority',
    'assignee',
    'ownerUserId',
    'businessContext',
    'labels',
    'subtasks'
]);

const HERMES_COMPLETE_ALLOWED_FIELDS = new Set([
    'reportId',
    'report_id'
]);

const HERMES_REASSIGN_ALLOWED_FIELDS = new Set([
    'ownerUserId',
    'assignee'
]);

const HERMES_RESCHEDULE_ALLOWED_FIELDS = new Set([
    'deadline',
    'due_at',
    'dueAt',
    'snoozeMinutes',
    'snooze_minutes',
    'snoozeHours',
    'snooze_hours'
]);

const HERMES_STATUS_ALLOWED_FIELDS = new Set([
    'status'
]);

const HERMES_MENU_PHOTO_DRAFT_ALLOWED_FIELDS = new Set([
    'settings',
    'size',
    'style'
]);

const HERMES_MENU_PHOTO_REJECT_ALLOWED_FIELDS = new Set([
    'reason'
]);

const HERMES_MENU_PHOTO_STATUSES = new Set([
    'draft',
    'generating',
    'ready',
    'failed',
    'approved',
    'rejected',
    'applied'
]);

const MAX_HERMES_SUBTASKS = 50;
const MAX_HERMES_LABELS = 20;
const DEFAULT_HERMES_RATE_LIMIT_WINDOW_MS = 60000;
const DEFAULT_HERMES_RATE_LIMIT_MAX = 60;

const TASK_DUE_DATE_SQL = `COALESCE(
    (t.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date,
    (t.deadline AT TIME ZONE 'Europe/Kyiv')::date,
    CASE WHEN LEFT(COALESCE(t.date, ''), 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
         THEN LEFT(t.date, 10)::date
    END
)`;

const TASK_SELECT_FIELDS = `
    t.id, t.title, t.description, t.status, t.priority, t.date, t.deadline,
    t.scheduled_start_at, t.scheduled_end_at, t.schedule_slot, t.schedule_mode, t.schedule_status,
    t.created_at, t.updated_at, t.completed_at, t.business_context, t.version,
    t.category, t.subcategory, t.task_type, t.task_mode, t.task_kind, t.visibility, t.workflow_state,
    t.owner_user_id, t.assigned_to, t.owner, t.created_by_user_id,
    u.name AS owner_name, u.username AS owner_username,
    creator.name AS creator_name, creator.username AS created_by_username
`;

const SUBTASK_JOIN_SQL = `
    LEFT JOIN (
        SELECT task_id,
               json_agg(json_build_object(
                   'id', id,
                   'task_id', task_id,
                   'title', title,
                   'is_done', is_done,
                   'sort_order', sort_order,
                   'source_type', COALESCE(source_type, 'manual'),
                   'created_at', created_at,
                   'completed_at', completed_at,
                   'updated_at', updated_at
               ) ORDER BY sort_order ASC, id ASC) AS subtasks
        FROM task_subtasks
        GROUP BY task_id
    ) subtask_rows ON subtask_rows.task_id = t.id
`;

function sendHermesError(res, status, code, error, meta = null) {
    const body = {
        success: false,
        error,
        code
    };

    if (meta && typeof meta === 'object' && Object.keys(meta).length) {
        body.meta = meta;
    }

    if (status === 429 && Number.isFinite(Number(meta?.retryAfterSeconds))) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(Number(meta.retryAfterSeconds)))));
    }

    return res.status(status).json(body);
}

function sendNotificationOutboxError(res, err, fallbackCode, fallbackMessage) {
    if (err.statusCode && err.statusCode < 500) {
        return sendHermesError(
            res,
            err.statusCode,
            err.code || fallbackCode,
            err.message || fallbackMessage,
            err.meta || null
        );
    }
    log.error(fallbackMessage, err);
    return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', fallbackMessage);
}

function hermesRateLimitKey(req = {}) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded
        || req.ip
        || req.connection?.remoteAddress
        || req.socket?.remoteAddress
        || 'unknown';
    const integrationId = String(
        (typeof req.get === 'function' ? req.get('x-integration-id') : req.headers?.['x-integration-id'])
        || HERMES_INTEGRATION_ID
    ).trim() || HERMES_INTEGRATION_ID;

    return `${ip}:${integrationId}`;
}

function createHermesRateLimiter(options = {}) {
    const windowMs = Number.isInteger(options.windowMs) && options.windowMs > 0
        ? options.windowMs
        : DEFAULT_HERMES_RATE_LIMIT_WINDOW_MS;
    const max = Number.isInteger(options.max) && options.max > 0
        ? options.max
        : DEFAULT_HERMES_RATE_LIMIT_MAX;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const keyGenerator = typeof options.keyGenerator === 'function' ? options.keyGenerator : hermesRateLimitKey;
    const buckets = options.store || new Map();
    let lastCleanupAt = 0;

    return function hermesRateLimiter(req, res, next) {
        const current = now();

        if (current - lastCleanupAt > windowMs) {
            lastCleanupAt = current;
            for (const [key, entry] of buckets) {
                if (!entry || entry.resetAt <= current) buckets.delete(key);
            }
        }

        const key = String(keyGenerator(req) || 'unknown');
        let entry = buckets.get(key);
        if (!entry || entry.resetAt <= current) {
            entry = {
                count: 0,
                resetAt: current + windowMs
            };
            buckets.set(key, entry);
        }

        entry.count += 1;
        if (entry.count > max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - current) / 1000));
            return sendHermesError(
                res,
                429,
                'HERMES_RATE_LIMITED',
                'Hermes rate limit exceeded',
                {
                    retryAfterSeconds,
                    limit: max,
                    windowSeconds: Math.ceil(windowMs / 1000)
                }
            );
        }

        return next();
    };
}

function hermesHttpError(statusCode, code, message, extra = {}) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    Object.assign(err, extra);
    return err;
}

function parseLimit(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return MAX_HERMES_LIMIT;
    return Math.min(parsed, MAX_HERMES_LIMIT);
}

function parsePositiveInt(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const parsed = Number.parseInt(text, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function envText(env, key) {
    return String(env?.[key] || '').trim();
}

function parseHermesOwnerAllowlist(env = process.env) {
    const raw = envText(env, 'EVENT_GENIX_CRM_ALLOWED_OWNER_USER_IDS');
    if (!raw) return { enabled: false, ids: new Set() };
    const ids = raw
        .split(/[,;\s]+/)
        .map(parsePositiveInt)
        .filter(Boolean);
    return { enabled: true, ids: new Set(ids) };
}

function resolveHermesCabinetOwnerId(req, env = process.env) {
    const hasQueryOwner = req.query?.ownerUserId !== undefined && String(req.query.ownerUserId || '').trim() !== '';
    const rawOwner = hasQueryOwner
        ? String(req.query.ownerUserId || '').trim()
        : envText(env, 'EVENT_GENIX_CRM_AGENT_OWNER_USER_ID');

    if (!rawOwner) {
        throw hermesHttpError(400, 'HERMES_OWNER_REQUIRED', 'ownerUserId is required');
    }

    const ownerUserId = parsePositiveInt(rawOwner);
    if (!ownerUserId) {
        throw hermesHttpError(400, 'HERMES_INVALID_OWNER', 'ownerUserId must be a positive integer');
    }

    const allowlist = parseHermesOwnerAllowlist(env);
    if (allowlist.enabled && !allowlist.ids.has(ownerUserId)) {
        throw hermesHttpError(403, 'HERMES_OWNER_NOT_ALLOWED', 'ownerUserId is not allowed for Hermes my-cabinet access');
    }

    return ownerUserId;
}

async function loadHermesCabinetOwner(queryable, ownerUserId) {
    const result = await queryable.query(
        `SELECT id, username, name, role, business_contexts, default_business_context, is_active
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [ownerUserId]
    );
    const owner = result.rows[0] || null;
    if (!owner || owner.is_active === false) {
        throw hermesHttpError(404, 'HERMES_OWNER_NOT_FOUND', 'Hermes my-cabinet owner was not found');
    }
    return {
        ...owner,
        defaultBusinessContext: owner.default_business_context,
        businessContexts: owner.business_contexts
    };
}

function businessScopeRequestForUser(req, user) {
    return {
        ...req,
        user,
        query: req.query || {},
        body: req.body || {},
        headers: req.headers || {}
    };
}

function assertHermesActorCanReadOwnerBusinessScope(actorScope = {}, ownerScope = {}) {
    const actorAllowed = new Set(
        (Array.isArray(actorScope.allowedContexts) && actorScope.allowedContexts.length
            ? actorScope.allowedContexts
            : actorScope.selectedContexts || [actorScope.activeContext])
            .filter(Boolean)
    );
    const ownerContexts = (Array.isArray(ownerScope.selectedContexts) && ownerScope.selectedContexts.length
        ? ownerScope.selectedContexts
        : [ownerScope.activeContext]).filter(Boolean);

    if (actorAllowed.size && ownerContexts.some(context => !actorAllowed.has(context))) {
        throw hermesHttpError(403, 'business_context_unavailable', 'Business scope is not available for this Hermes integration');
    }
}

function isDateOnly(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeJsonObject(value) {
    if (isPlainObject(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return isPlainObject(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function cleanNullableString(value, maxLength = 1000) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.slice(0, maxLength);
}

function pushParam(params, value) {
    params.push(value);
    return `$${params.length}`;
}

function parseCsvValues(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

function applyEnumFilter({ whereParts, params, rawValue, map, column, label }) {
    if (!rawValue) return true;
    const mapped = Array.from(new Set(parseCsvValues(rawValue).map(value => map[value])));
    if (!mapped.length || mapped.some(value => !value)) {
        const err = new Error(`Invalid ${label}`);
        err.statusCode = 400;
        err.code = 'HERMES_INVALID_FILTER';
        throw err;
    }
    whereParts.push(`${column} = ANY(${pushParam(params, mapped)}::text[])`);
    return true;
}

function encodeCursor(row = {}) {
    const updatedAt = row.updated_at || row.updatedAt || row.created_at || row.createdAt;
    const id = parsePositiveInt(row.id);
    if (!updatedAt || !id) return null;
    return Buffer.from(JSON.stringify({
        updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt),
        id
    })).toString('base64url');
}

function decodeCursor(value) {
    if (!value) return null;
    try {
        const decoded = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
        const updatedAt = decoded.updatedAt || decoded.updated_at;
        const id = parsePositiveInt(decoded.id);
        if (!updatedAt || !id || Number.isNaN(new Date(updatedAt).getTime())) throw new Error('invalid cursor');
        return { updatedAt: new Date(updatedAt).toISOString(), id };
    } catch {
        const err = new Error('Invalid cursor');
        err.statusCode = 400;
        err.code = 'HERMES_INVALID_CURSOR';
        throw err;
    }
}

function getCrmBaseUrl(req) {
    const configured = process.env.PUBLIC_BASE_URL || process.env.CRM_PUBLIC_URL || process.env.APP_URL;
    if (configured) return configured;
    const protocol = req.get?.('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get?.('host');
    return host ? `${protocol}://${host}` : '';
}

function taskMapperOptions(req) {
    return {
        baseUrl: getCrmBaseUrl(req)
    };
}

function normalizeHermesCreateLabels(value) {
    if (value === undefined) return [];
    const labels = Array.isArray(value) ? value : String(value).split(',');
    const seen = new Set();
    return labels
        .map(label => String(label || '').trim())
        .filter(Boolean)
        .map(label => label.slice(0, 80))
        .filter(label => {
            const key = label.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, MAX_HERMES_LABELS);
}

function normalizeHermesCreatePriority(value) {
    if (value === undefined || value === null || value === '') return 'normal';
    const raw = String(value).trim().toLowerCase();
    const mapped = HERMES_TO_CRM_PRIORITY[raw];
    if (!mapped) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'Invalid priority');
    }
    return mapped;
}

function normalizeHermesDeadline(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'Invalid due_at/deadline');
    }
    return String(value);
}

function parseHermesOwnerUserId(body = {}) {
    const direct = body.ownerUserId;
    const assignee = body.assignee;
    const nested = assignee && typeof assignee === 'object' && !Array.isArray(assignee) ? assignee.id : undefined;

    if (assignee !== undefined && (typeof assignee !== 'object' || Array.isArray(assignee))) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'assignee must be an object with id');
    }

    const present = [direct, nested].filter(value => value !== undefined && value !== null && value !== '');
    if (!present.length) return null;

    const ids = present.map(parsePositiveInt);
    if (ids.some(value => !value)) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_OWNER', 'ownerUserId must be a valid user id');
    }
    if (new Set(ids).size > 1) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_OWNER', 'ownerUserId and assignee.id must match');
    }
    return ids[0];
}

function assertAllowedHermesFields(body = {}, allowedFields, code = 'HERMES_UNSUPPORTED_FIELD') {
    const unsupported = Object.keys(body).filter(key => !allowedFields.has(key));
    if (unsupported.length) {
        throw hermesHttpError(
            400,
            code,
            `Unsupported field: ${unsupported[0]}`
        );
    }
}

function normalizeHermesCreatePayload(body = {}) {
    if (!isPlainObject(body)) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'Request body must be a JSON object');
    }

    assertAllowedHermesFields(body, HERMES_CREATE_ALLOWED_FIELDS);

    const title = String(body.title || '').trim();
    if (!title) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'title is required');
    }
    if (title.length > 200) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'title must be 200 characters or less');
    }

    const description = body.description === undefined || body.description === null
        ? null
        : String(body.description);
    const date = body.date === undefined || body.date === null || body.date === ''
        ? null
        : String(body.date);
    if (date && !isDateOnly(date)) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'Invalid date');
    }

    if (body.subtasks !== undefined && !Array.isArray(body.subtasks)) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'subtasks must be an array');
    }
    if (Array.isArray(body.subtasks) && body.subtasks.length > MAX_HERMES_SUBTASKS) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', `subtasks limit is ${MAX_HERMES_SUBTASKS}`);
    }

    return {
        title,
        description,
        date,
        deadline: normalizeHermesDeadline(body.due_at ?? body.dueAt ?? body.deadline),
        priority: normalizeHermesCreatePriority(body.priority),
        ownerUserId: parseHermesOwnerUserId(body),
        labels: normalizeHermesCreateLabels(body.labels),
        subtasks: normalizeSubtasksInput(body.subtasks || [], { sourceType: 'manual' })
    };
}

function normalizeHermesCompletePayload(body = {}) {
    if (!isPlainObject(body)) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'Request body must be a JSON object');
    }
    assertAllowedHermesFields(body, HERMES_COMPLETE_ALLOWED_FIELDS);
    return {
        reportId: body.reportId ?? body.report_id ?? null
    };
}

function normalizeHermesReassignPayload(body = {}) {
    if (!isPlainObject(body)) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'Request body must be a JSON object');
    }
    assertAllowedHermesFields(body, HERMES_REASSIGN_ALLOWED_FIELDS);
    const ownerUserId = parseHermesOwnerUserId(body);
    if (!ownerUserId) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_OWNER', 'ownerUserId or assignee.id is required');
    }
    return { ownerUserId };
}

function normalizeHermesReschedulePayload(body = {}) {
    if (!isPlainObject(body)) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'Request body must be a JSON object');
    }
    assertAllowedHermesFields(body, HERMES_RESCHEDULE_ALLOWED_FIELDS);
    return {
        deadline: resolveDeadline(body)
    };
}

function normalizeHermesStatusPayload(body = {}) {
    if (!isPlainObject(body)) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_PAYLOAD', 'Request body must be a JSON object');
    }
    assertAllowedHermesFields(body, HERMES_STATUS_ALLOWED_FIELDS);
    const status = String(body.status || '').trim().toLowerCase();
    if (!['todo', 'in_progress'].includes(status)) {
        throw hermesHttpError(400, 'HERMES_INVALID_TASK_STATUS', 'status must be todo or in_progress; use /complete for done');
    }
    return { status };
}

function enrichHermesCreatedTask(task = {}, context = {}) {
    const actor = context.actor || {};
    const owner = context.owner || null;
    const subtasks = context.subtasks || [];
    const actorId = normalizeUserId(actor);
    const ownerMatchesActor = actorId && Number(task.owner_user_id || 0) === actorId;

    return {
        ...task,
        owner_name: owner?.name || (ownerMatchesActor ? actor.name : task.owner_name),
        owner_username: owner?.username || (ownerMatchesActor ? actor.username : task.owner_username),
        creator_name: actor.name || task.creator_name || null,
        created_by_username: actor.username || task.created_by_username || task.created_by || null,
        subtasks,
        subtask_count: subtasks.length,
        subtask_done_count: subtasks.filter(item => item.isDone || item.is_done).length
    };
}

function hermesMutationTaskBody(req, businessScope, task, meta = {}) {
    return {
        success: true,
        task: toHermesTaskDetail(task, taskMapperOptions(req)),
        meta: {
            businessScope: taskBusinessScopeMeta(businessScope),
            sourceSurface: 'hermes',
            source: HERMES_INTEGRATION_ID,
            idempotencyKey: req.hermesMutation?.idempotencyKey || null,
            ...meta
        }
    };
}

function parseMenuPhotoProductId(value) {
    const id = cleanNullableString(value, 80);
    return id && !/\s/.test(id) ? id : null;
}

function normalizeHermesMenuPhotoStatus(value, fallback = 'draft') {
    const status = String(value || fallback).trim().toLowerCase();
    return HERMES_MENU_PHOTO_STATUSES.has(status) ? status : fallback;
}

function normalizeHermesMenuImageStudio(value = {}) {
    const raw = safeJsonObject(value);
    const imageUrl = cleanNullableString(raw.imageUrl || raw.image_url, 2000);
    const prompt = cleanNullableString(raw.prompt, 5000);
    const preparedAt = raw.preparedAt || raw.prepared_at || null;
    const generatedAt = raw.generatedAt || raw.generated_at || null;
    const approvedAt = raw.approvedAt || raw.approved_at || null;
    const appliedAt = raw.appliedAt || raw.applied_at || null;
    const rejectedAt = raw.rejectedAt || raw.rejected_at || null;
    const error = cleanNullableString(raw.error, 500);
    const status = normalizeHermesMenuPhotoStatus(raw.status, 'draft');
    if (!imageUrl && !prompt && !preparedAt && !generatedAt && !approvedAt && !appliedAt && !rejectedAt && !error && status === 'draft') {
        return {};
    }
    return {
        version: 1,
        status,
        source: cleanNullableString(raw.source, 40) || 'products-menu',
        imageUrl,
        prompt,
        provider: cleanNullableString(raw.provider, 40),
        model: cleanNullableString(raw.model, 100),
        size: normalizeMenuImageSize(raw.size),
        style: normalizeMenuImageStyle(raw.style),
        preparedAt,
        generatedAt,
        approvedAt,
        approvedBy: cleanNullableString(raw.approvedBy || raw.approved_by, 100),
        appliedAt,
        appliedBy: cleanNullableString(raw.appliedBy || raw.applied_by, 100),
        rejectedAt,
        rejectedBy: cleanNullableString(raw.rejectedBy || raw.rejected_by, 100),
        previousImageUrl: cleanNullableString(raw.previousImageUrl || raw.previous_image_url, 2000),
        storage: safeJsonObject(raw.storage),
        error
    };
}

function currentHermesMenuPhotoDraft(product = {}) {
    return safeJsonObject(product.ai_card_draft || product.aiCardDraft || {});
}

function buildHermesMenuPhotoDraft(product = {}, imageStudioPatch = {}, options = {}) {
    const currentDraft = safeJsonObject(options.currentDraft || currentHermesMenuPhotoDraft(product));
    const currentImageStudio = normalizeHermesMenuImageStudio(currentDraft.imageStudio || currentDraft.image_studio || {});
    const imageStudio = normalizeHermesMenuImageStudio({
        ...currentImageStudio,
        ...imageStudioPatch
    });
    return {
        ...currentDraft,
        version: Number(currentDraft.version || 1) || 1,
        status: cleanNullableString(currentDraft.status, 40) || 'draft',
        source: cleanNullableString(currentDraft.source, 40) || 'stored',
        aiAvailable: currentDraft.aiAvailable !== false,
        generatedAt: currentDraft.generatedAt || currentDraft.generated_at || new Date().toISOString(),
        imageStudio
    };
}

function toHermesMenuPhotoDraft(imageStudio = {}) {
    const normalized = normalizeHermesMenuImageStudio(imageStudio);
    return {
        status: normalized.status || 'draft',
        imageUrl: normalized.imageUrl || null,
        prompt: normalized.prompt || null,
        provider: normalized.provider || null,
        model: normalized.model || null,
        size: normalized.size || null,
        style: normalized.style || null,
        generatedAt: normalized.generatedAt || null,
        approvedAt: normalized.approvedAt || null,
        approvedBy: normalized.approvedBy || null,
        appliedAt: normalized.appliedAt || null,
        appliedBy: normalized.appliedBy || null,
        rejectedAt: normalized.rejectedAt || null,
        rejectedBy: normalized.rejectedBy || null,
        previousImageUrl: normalized.previousImageUrl || null,
        error: normalized.error || null
    };
}

function hermesMenuPhotoCrmUrl(req, product = {}) {
    const baseUrl = getCrmBaseUrl(req).replace(/\/+$/, '');
    const id = product.id ? encodeURIComponent(String(product.id)) : '';
    return baseUrl ? `${baseUrl}/programs.html#kitchen-menu${id ? `:${id}` : ''}` : null;
}

function toHermesMenuPhotoProduct(product = {}, req) {
    const draft = currentHermesMenuPhotoDraft(product);
    return {
        id: String(product.id),
        code: cleanNullableString(product.code, 120),
        name: cleanNullableString(product.name || product.label || product.code || product.id, 220),
        businessContext: cleanNullableString(product.business_context || DEFAULT_TASK_BUSINESS_CONTEXT, 80),
        currentImageUrl: cleanNullableString(product.icon_url, 2000),
        draft: toHermesMenuPhotoDraft(draft.imageStudio || draft.image_studio || {}),
        crm_url: hermesMenuPhotoCrmUrl(req, product)
    };
}

function menuPhotoSelectSql(whereSql, options = {}) {
    return `SELECT
                p.id,
                p.code,
                p.name,
                p.label,
                p.business_context,
                p.icon_url,
                p.ai_card_draft,
                p.domain,
                p.kitchen_type,
                p.menu_section,
                p.serving_unit,
                p.weight_value,
                p.ingredients,
                p.short_description,
                p.description,
                p.allergens,
                p.tech_card,
                p.price,
                p.legacy_price,
                p.availability_status,
                p.is_active,
                p.created_at,
                p.updated_at
            FROM products p
            WHERE ${whereSql}
              AND COALESCE(p.domain, 'program') = 'kitchen'
              AND p.kitchen_type = 'menu'
              AND COALESCE(p.is_active, true) = true
              AND COALESCE(p.availability_status, 'active') <> 'hidden'
            ${options.orderBy || ''}
            ${options.limitSql || ''}
            ${options.forUpdate ? 'FOR UPDATE' : ''}`;
}

async function selectHermesMenuPhotoProduct(query, productId, scopeOrContext, options = {}) {
    const params = [];
    const whereParts = [
        `p.id = ${pushParam(params, productId)}`,
        pushTaskBusinessScopeCondition(params, scopeOrContext, 'p')
    ];
    const result = await query.query(
        menuPhotoSelectSql(whereParts.join('\n              AND '), {
            forUpdate: options.forUpdate === true
        }),
        params
    );
    return result.rows[0] || null;
}

async function listHermesMenuPhotoCandidates(query, businessScope, limit) {
    const params = [];
    const whereParts = [
        pushTaskBusinessScopeCondition(params, businessScope, 'p')
    ];
    const limitRef = pushParam(params, limit);
    const result = await query.query(
        menuPhotoSelectSql(whereParts.join('\n              AND '), {
            orderBy: `ORDER BY
                CASE WHEN NULLIF(p.icon_url, '') IS NULL THEN 0 ELSE 1 END ASC,
                CASE COALESCE(p.ai_card_draft->'imageStudio'->>'status', 'draft')
                    WHEN 'failed' THEN 0
                    WHEN 'draft' THEN 1
                    ELSE 2
                END ASC,
                COALESCE(p.updated_at, p.created_at) DESC,
                p.name ASC`,
            limitSql: `LIMIT ${limitRef}`
        }),
        params
    );
    return result.rows || [];
}

async function persistHermesMenuPhotoDraft(query, productId, businessContext, username, draft) {
    await query.query(
        `UPDATE products
         SET ai_card_draft = $1::jsonb,
             updated_at = NOW(),
             updated_by = $2
         WHERE id = $3
           AND COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $4`,
        [JSON.stringify(draft), username, productId, businessContext]
    );
}

function menuPhotoPublicError(err) {
    const message = String(err?.message || '');
    if (err?.code === 'openai_not_configured' || /OPENAI_API_KEY is not configured/i.test(message)) {
        return {
            status: 503,
            code: 'openai_not_configured',
            error: 'OPENAI_API_KEY is not configured'
        };
    }
    if (err?.code === 'menu_image_upload_failed') {
        return {
            status: 502,
            code: 'menu_image_upload_failed',
            error: 'Generated image could not be saved to CRM uploads'
        };
    }
    if (err?.status === 429 || err?.code === 'openai_rate_limited') {
        return {
            status: 429,
            code: 'menu_image_generation_rate_limited',
            error: 'Menu image generation is temporarily rate limited'
        };
    }
    return {
        status: 502,
        code: 'menu_image_generation_failed',
        error: 'Menu image generation failed'
    };
}

function normalizeHermesMenuPhotoDraftPayload(body = {}) {
    if (!isPlainObject(body)) {
        throw hermesHttpError(400, 'HERMES_INVALID_MENU_PHOTO_PAYLOAD', 'Request body must be a JSON object');
    }
    assertAllowedHermesFields(body, HERMES_MENU_PHOTO_DRAFT_ALLOWED_FIELDS, 'HERMES_UNSUPPORTED_MENU_PHOTO_FIELD');
    const settings = safeJsonObject(body.settings || {});
    return {
        size: body.size || settings.size || null,
        style: body.style || settings.style || null
    };
}

function normalizeHermesMenuPhotoRejectPayload(body = {}) {
    if (!isPlainObject(body)) {
        throw hermesHttpError(400, 'HERMES_INVALID_MENU_PHOTO_PAYLOAD', 'Request body must be a JSON object');
    }
    assertAllowedHermesFields(body, HERMES_MENU_PHOTO_REJECT_ALLOWED_FIELDS, 'HERMES_UNSUPPORTED_MENU_PHOTO_FIELD');
    return {
        reason: cleanNullableString(body.reason, 500)
    };
}

function hermesMenuPhotoBody(req, businessScope, product, meta = {}) {
    return {
        success: true,
        product: toHermesMenuPhotoProduct(product, req),
        meta: {
            businessScope: taskBusinessScopeMeta(businessScope),
            sourceSurface: 'hermes',
            source: HERMES_INTEGRATION_ID,
            idempotencyKey: req.hermesMutation?.idempotencyKey || null,
            ...meta
        }
    };
}

function getKleshnya() {
    return require('../services/kleshnya');
}

function taskWhereForRequest(req, options = {}) {
    const businessScope = ensureTaskBusinessScope(req, options.res);
    if (!businessScope) return null;

    const params = [];
    const whereParts = [];
    if (options.taskId) {
        whereParts.push(`t.id = ${pushParam(params, options.taskId)}`);
    }
    whereParts.push(pushTaskBusinessScopeCondition(params, businessScope, 't'));
    whereParts.push(buildTaskVisibilityScope(req.user, params, 't').replace(/^AND\s+/i, ''));

    return { businessScope, params, whereParts };
}

function applyListFilters(req, queryParts) {
    const { whereParts, params } = queryParts;
    applyEnumFilter({
        whereParts,
        params,
        rawValue: req.query.status,
        map: HERMES_TO_CRM_STATUS,
        column: "COALESCE(t.status, 'todo')",
        label: 'status'
    });
    applyEnumFilter({
        whereParts,
        params,
        rawValue: req.query.priority,
        map: HERMES_TO_CRM_PRIORITY,
        column: "COALESCE(t.priority, 'normal')",
        label: 'priority'
    });

    if (req.query.ownerUserId !== undefined) {
        const ownerUserId = parsePositiveInt(req.query.ownerUserId);
        if (!ownerUserId) {
            const err = new Error('Invalid ownerUserId');
            err.statusCode = 400;
            err.code = 'HERMES_INVALID_FILTER';
            throw err;
        }
        whereParts.push(`t.owner_user_id = ${pushParam(params, ownerUserId)}`);
    }

    if (req.query.dateFrom !== undefined) {
        if (!isDateOnly(req.query.dateFrom)) {
            const err = new Error('Invalid dateFrom');
            err.statusCode = 400;
            err.code = 'HERMES_INVALID_FILTER';
            throw err;
        }
        whereParts.push(`${TASK_DUE_DATE_SQL} >= ${pushParam(params, req.query.dateFrom)}::date`);
    }

    if (req.query.dateTo !== undefined) {
        if (!isDateOnly(req.query.dateTo)) {
            const err = new Error('Invalid dateTo');
            err.statusCode = 400;
            err.code = 'HERMES_INVALID_FILTER';
            throw err;
        }
        whereParts.push(`${TASK_DUE_DATE_SQL} <= ${pushParam(params, req.query.dateTo)}::date`);
    }

    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
        const updatedRef = pushParam(params, cursor.updatedAt);
        const idRef = pushParam(params, cursor.id);
        whereParts.push(`(
            COALESCE(t.updated_at, t.created_at) < ${updatedRef}::timestamptz
            OR (
                COALESCE(t.updated_at, t.created_at) = ${updatedRef}::timestamptz
                AND t.id < ${idRef}::int
            )
        )`);
    }
}

function buildCapabilitiesPayload(env = process.env) {
    const ownerAllowlist = parseHermesOwnerAllowlist(env);
    return {
        success: true,
        integrationId: HERMES_INTEGRATION_ID,
        auth: 'x-api-key',
        authFallback: 'authorization-bearer',
        maxLimit: 50,
        pagination: 'cursor',
        mutationsRequireConfirmation: true,
        mutationsRequireIdempotencyKey: true,
        features: {
            notificationOutbox: true
        },
        endpoints: {
            tasks: {
                status: 'POST /api/hermes/tasks/:id/status'
            },
            notificationOutbox: {
                list: 'GET /api/hermes/notification-outbox',
                detail: 'GET /api/hermes/notification-outbox/:eventId',
                claim: 'POST /api/hermes/notification-outbox/:eventId/claim',
                ack: 'POST /api/hermes/notification-outbox/:eventId/ack',
                fail: 'POST /api/hermes/notification-outbox/:eventId/fail',
                stats: 'GET /api/hermes/notification-outbox/stats',
                debug: 'GET /api/hermes/notification-outbox/debug',
                maxLimit: 50,
                defaultLimit: 20,
                mutationsRequireConfirmation: false,
                mutationsRequireIdempotencyKey: false
            }
        },
        supportedActions: SUPPORTED_ACTIONS,
        mutationActionsAvailable: true,
        plannedMutationActions: PLANNED_MUTATION_ACTIONS,
        myCabinet: {
            available: true,
            defaultOwnerConfigured: Boolean(envText(env, 'EVENT_GENIX_CRM_AGENT_OWNER_USER_ID')),
            ownerAllowlistEnabled: ownerAllowlist.enabled
        },
        webhooks: {
            crmToHermesEnabled: false
        }
    };
}

function createHermesRouter(options = {}) {
    const router = express.Router();
    const authMiddleware = options.authMiddleware || hermesAuth;
    const query = options.pool || pool;
    const env = options.env || process.env;
    const rateLimiter = options.rateLimiter !== undefined
        ? options.rateLimiter
        : (options.rateLimit === false ? null : createHermesRateLimiter(options.rateLimit || {}));

    if (rateLimiter) {
        router.use(rateLimiter);
    }
    router.use(authMiddleware);

    router.get('/capabilities', (req, res) => {
        res.json(buildCapabilitiesPayload(env));
    });

    const taskWatchdogPreviewHandler = createTaskWatchdogPreviewHandler({ pool: query });
    const taskWatchdogCallbackDryRunHandler = createTaskWatchdogCallbackDryRunHandler({ pool: query });

    router.get('/task-watchdog/preview', taskWatchdogPreviewHandler);
    router.post('/task-watchdog/callback-dry-run', taskWatchdogCallbackDryRunHandler);

    router.get('/notification-outbox', async (req, res) => {
        try {
            const result = await listNotificationOutboxEvents(req.query || {}, { pool: query });
            return res.json({
                success: true,
                items: result.events.map(toNotificationOutboxApiEvent),
                pagination: result.pagination,
                meta: {
                    sourceSurface: 'hermes',
                    source: HERMES_INTEGRATION_ID,
                    projection: 'notification_outbox.list'
                }
            });
        } catch (err) {
            return sendNotificationOutboxError(
                res,
                err,
                'HERMES_NOTIFICATION_OUTBOX_LIST_FAILED',
                'Hermes notification_outbox list failed'
            );
        }
    });

    router.get('/notification-outbox/stats', async (req, res) => {
        try {
            const result = await getNotificationOutboxStats({ pool: query });
            return res.json({
                success: true,
                stats: result.stats,
                oldestPendingAt: result.oldestPendingAt,
                lastSentAt: result.lastSentAt
            });
        } catch (err) {
            return sendNotificationOutboxError(
                res,
                err,
                'HERMES_NOTIFICATION_OUTBOX_STATS_FAILED',
                'Hermes notification_outbox stats failed'
            );
        }
    });

    router.get('/notification-outbox/debug', async (req, res) => {
        try {
            const result = await listNotificationOutboxDebugEvents(req.query || {}, { pool: query });
            return res.json({
                success: true,
                items: result.items,
                pagination: result.pagination
            });
        } catch (err) {
            return sendNotificationOutboxError(
                res,
                err,
                'HERMES_NOTIFICATION_OUTBOX_DEBUG_FAILED',
                'Hermes notification_outbox debug failed'
            );
        }
    });

    router.get('/notification-outbox/:eventId', async (req, res) => {
        try {
            const event = await findNotificationOutboxEventByEventId(req.params.eventId, { pool: query });
            if (!event) {
                return sendHermesError(res, 404, 'OUTBOX_EVENT_NOT_FOUND', 'notification_outbox event was not found');
            }
            return res.json({
                success: true,
                event: toNotificationOutboxApiEvent(event)
            });
        } catch (err) {
            return sendNotificationOutboxError(
                res,
                err,
                'HERMES_NOTIFICATION_OUTBOX_DETAIL_FAILED',
                'Hermes notification_outbox detail failed'
            );
        }
    });

    router.post('/notification-outbox/:eventId/claim', async (req, res) => {
        try {
            const result = await claimNotificationOutboxEvent(req.params.eventId, req.body || {}, { pool: query });
            return res.json({
                success: true,
                claimed: result.claimed === true,
                event: toNotificationOutboxApiEvent(result.event),
                meta: {
                    workerId: result.workerId,
                    lockSeconds: result.lockSeconds
                }
            });
        } catch (err) {
            return sendNotificationOutboxError(
                res,
                err,
                'HERMES_NOTIFICATION_OUTBOX_CLAIM_FAILED',
                'Hermes notification_outbox claim failed'
            );
        }
    });

    router.post('/notification-outbox/:eventId/ack', async (req, res) => {
        try {
            const result = await ackNotificationOutboxEvent(req.params.eventId, req.body || {}, { pool: query });
            return res.json({
                success: true,
                alreadySent: result.alreadySent === true,
                event: toNotificationOutboxApiEvent(result.event),
                meta: {
                    workerId: result.workerId
                }
            });
        } catch (err) {
            return sendNotificationOutboxError(
                res,
                err,
                'HERMES_NOTIFICATION_OUTBOX_ACK_FAILED',
                'Hermes notification_outbox ack failed'
            );
        }
    });

    router.post('/notification-outbox/:eventId/fail', async (req, res) => {
        try {
            const result = await failNotificationOutboxEvent(req.params.eventId, req.body || {}, { pool: query });
            return res.json({
                success: true,
                retryable: result.retryable,
                deadLetter: result.deadLetter,
                attempts: result.attempts,
                backoffMinutes: result.backoffMinutes,
                event: toNotificationOutboxApiEvent(result.event),
                meta: {
                    workerId: result.workerId
                }
            });
        } catch (err) {
            return sendNotificationOutboxError(
                res,
                err,
                'HERMES_NOTIFICATION_OUTBOX_FAIL_FAILED',
                'Hermes notification_outbox fail failed'
            );
        }
    });

    router.get('/my-cabinet', async (req, res) => {
        try {
            const ownerUserId = resolveHermesCabinetOwnerId(req, env);
            const owner = await loadHermesCabinetOwner(query, ownerUserId);
            const actorScope = ensureTaskBusinessScope(req, res);
            if (!actorScope) return;
            const ownerScope = ensureTaskBusinessScope(businessScopeRequestForUser(req, owner), res);
            if (!ownerScope) return;
            assertHermesActorCanReadOwnerBusinessScope(actorScope, ownerScope);

            const projection = await buildTaskCabinetProjection({
                pool: query,
                user: owner,
                businessScope: ownerScope,
                ensurePreferences: false
            });

            res.json({
                ...projection,
                meta: {
                    ...(projection.meta || {}),
                    sourceSurface: 'hermes',
                    source: HERMES_INTEGRATION_ID,
                    ownerUserId,
                    businessContext: activeTaskBusinessContext(ownerScope),
                    projection: 'tasks.my_cabinet'
                }
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_MY_CABINET_FAILED', err.message);
            }
            log.error('Hermes my-cabinet projection error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes my-cabinet projection failed');
        }
    });

    router.get('/menu-photos/candidates', async (req, res) => {
        try {
            const businessScope = ensureTaskBusinessScope(req, res);
            if (!businessScope) return;
            const limit = parseLimit(req.query.limit);
            const rows = await listHermesMenuPhotoCandidates(query, businessScope, limit);

            res.json({
                success: true,
                items: rows.map(product => toHermesMenuPhotoProduct(product, req)),
                pagination: toHermesPagination({
                    nextCursor: null,
                    hasMore: false,
                    limit
                }),
                meta: {
                    businessScope: taskBusinessScopeMeta(businessScope)
                }
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_REQUEST', err.message);
            }
            log.error('Hermes menu photo candidates error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes menu photo candidates failed');
        }
    });

    router.get('/menu-photos/:productId', async (req, res) => {
        try {
            const productId = parseMenuPhotoProductId(req.params.productId);
            if (!productId) {
                return sendHermesError(res, 404, 'HERMES_MENU_PHOTO_NOT_FOUND', 'Menu photo product not found');
            }
            const businessScope = ensureTaskBusinessScope(req, res);
            if (!businessScope) return;
            const product = await selectHermesMenuPhotoProduct(query, productId, businessScope);
            if (!product) {
                return sendHermesError(res, 404, 'HERMES_MENU_PHOTO_NOT_FOUND', 'Menu photo product not found');
            }

            res.json({
                success: true,
                product: toHermesMenuPhotoProduct(product, req),
                meta: {
                    businessScope: taskBusinessScopeMeta(businessScope)
                }
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_REQUEST', err.message);
            }
            log.error('Hermes menu photo detail error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes menu photo detail failed');
        }
    });

    router.post('/menu-photos/:productId/draft', requireHermesMutationGuard, async (req, res) => {
        const productId = parseMenuPhotoProductId(req.params.productId);
        if (!productId) {
            return sendHermesError(res, 404, 'HERMES_MENU_PHOTO_NOT_FOUND', 'Menu photo product not found');
        }

        let payload;
        let businessScope;
        try {
            payload = normalizeHermesMenuPhotoDraftPayload(req.body || {});
            businessScope = ensureWritableTaskBusinessScope(req, res);
            if (!businessScope) return;
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_MENU_PHOTO_PAYLOAD', err.message);
            }
            log.error('Hermes menu photo draft preflight error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes menu photo draft failed');
        }

        try {
            return await withHermesIdempotency(req, res, async ({ pool: mutationPool }) => {
                const businessContext = activeTaskBusinessContext(businessScope);
                const product = await selectHermesMenuPhotoProduct(mutationPool, productId, businessContext);
                if (!product) {
                    throw hermesHttpError(404, 'HERMES_MENU_PHOTO_NOT_FOUND', 'Menu photo product not found');
                }

                const currentDraft = currentHermesMenuPhotoDraft(product);
                const currentStudio = normalizeHermesMenuImageStudio(currentDraft.imageStudio || currentDraft.image_studio || {});
                const size = normalizeMenuImageSize(payload.size || currentStudio.size);
                const style = normalizeMenuImageStyle(payload.style || currentStudio.style);
                const prompt = buildMenuImagePrompt(product, { size, style });
                const preparedAt = new Date().toISOString();
                const generatingStudio = normalizeHermesMenuImageStudio({
                    ...currentStudio,
                    status: 'generating',
                    source: 'openai',
                    size,
                    style,
                    imageUrl: null,
                    prompt,
                    preparedAt: currentStudio.preparedAt || preparedAt,
                    generatedAt: null,
                    provider: 'openai',
                    model: resolveMenuImageOpenAIModel(),
                    previousImageUrl: product.icon_url || null,
                    error: null
                });
                const generatingDraft = buildHermesMenuPhotoDraft(product, generatingStudio, { currentDraft });
                await persistHermesMenuPhotoDraft(mutationPool, productId, businessContext, req.user?.username || 'hermes', generatingDraft);

                try {
                    const generatedStudio = await generateAndStoreMenuPhotoDraft(product, { size, style, prompt });
                    const readyStudio = normalizeHermesMenuImageStudio({
                        ...generatingStudio,
                        ...generatedStudio,
                        status: 'ready',
                        previousImageUrl: product.icon_url || null,
                        error: null
                    });
                    const readyDraft = buildHermesMenuPhotoDraft(product, readyStudio, { currentDraft });
                    await persistHermesMenuPhotoDraft(mutationPool, productId, businessContext, req.user?.username || 'hermes', readyDraft);

                    return {
                        status: 200,
                        body: hermesMenuPhotoBody(req, businessScope, {
                            ...product,
                            ai_card_draft: readyDraft
                        }, {
                            status: 'ready'
                        })
                    };
                } catch (err) {
                    const publicError = menuPhotoPublicError(err);
                    const failedStudio = normalizeHermesMenuImageStudio({
                        ...generatingStudio,
                        status: 'failed',
                        imageUrl: null,
                        prompt: err.prompt || prompt,
                        size: err.size || size,
                        style: err.style || style,
                        generatedAt: new Date().toISOString(),
                        provider: generatingStudio.provider || 'openai',
                        model: generatingStudio.model || resolveMenuImageOpenAIModel(),
                        previousImageUrl: product.icon_url || null,
                        error: publicError.error
                    });
                    const failedDraft = buildHermesMenuPhotoDraft(product, failedStudio, { currentDraft });
                    await persistHermesMenuPhotoDraft(mutationPool, productId, businessContext, req.user?.username || 'hermes', failedDraft);

                    return {
                        status: publicError.status,
                        body: {
                            success: false,
                            status: 'failed',
                            error: publicError.error,
                            code: publicError.code,
                            product: toHermesMenuPhotoProduct({
                                ...product,
                                ai_card_draft: failedDraft
                            }, req),
                            meta: {
                                businessScope: taskBusinessScopeMeta(businessScope),
                                sourceSurface: 'hermes',
                                source: HERMES_INTEGRATION_ID,
                                idempotencyKey: req.hermesMutation?.idempotencyKey || null
                            }
                        }
                    };
                }
            }, {
                pool: query,
                requestPath: '/api/hermes/menu-photos/:productId/draft'
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_MENU_PHOTO_MUTATION_FAILED', err.message);
            }
            log.error('Hermes menu photo draft error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes menu photo draft failed');
        }
    });

    router.post('/menu-photos/:productId/apply', requireHermesMutationGuard, async (req, res) => {
        const productId = parseMenuPhotoProductId(req.params.productId);
        if (!productId) {
            return sendHermesError(res, 404, 'HERMES_MENU_PHOTO_NOT_FOUND', 'Menu photo product not found');
        }

        let businessScope;
        try {
            businessScope = ensureWritableTaskBusinessScope(req, res);
            if (!businessScope) return;
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_MENU_PHOTO_PAYLOAD', err.message);
            }
            log.error('Hermes menu photo apply preflight error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes menu photo apply failed');
        }

        try {
            return await withHermesIdempotency(req, res, async ({ pool: mutationPool }) => {
                const businessContext = activeTaskBusinessContext(businessScope);
                const product = await selectHermesMenuPhotoProduct(mutationPool, productId, businessContext, { forUpdate: true });
                if (!product) {
                    throw hermesHttpError(404, 'HERMES_MENU_PHOTO_NOT_FOUND', 'Menu photo product not found');
                }

                const currentDraft = currentHermesMenuPhotoDraft(product);
                const imageStudio = normalizeHermesMenuImageStudio(currentDraft.imageStudio || currentDraft.image_studio || {});
                if (!imageStudio.imageUrl) {
                    throw hermesHttpError(409, 'HERMES_MENU_PHOTO_DRAFT_MISSING', 'No ready menu image draft to apply');
                }
                if (!['ready', 'approved', 'applied'].includes(imageStudio.status)) {
                    throw hermesHttpError(409, 'HERMES_MENU_PHOTO_DRAFT_NOT_READY', 'Menu image draft is not ready to apply');
                }

                const now = new Date().toISOString();
                const alreadyApplied = product.icon_url === imageStudio.imageUrl && imageStudio.status === 'applied';
                const appliedStudio = normalizeHermesMenuImageStudio({
                    ...imageStudio,
                    status: 'applied',
                    approvedAt: imageStudio.approvedAt || now,
                    approvedBy: imageStudio.approvedBy || req.user?.username || 'hermes',
                    appliedAt: alreadyApplied ? (imageStudio.appliedAt || now) : now,
                    appliedBy: req.user?.username || 'hermes',
                    previousImageUrl: alreadyApplied ? (imageStudio.previousImageUrl || product.icon_url || null) : (product.icon_url || null),
                    error: null
                });
                const draft = buildHermesMenuPhotoDraft(product, appliedStudio, { currentDraft });
                await mutationPool.query(
                    `UPDATE products
                     SET icon_url = $1,
                         ai_card_draft = $2::jsonb,
                         updated_at = NOW(),
                         updated_by = $3
                     WHERE id = $4
                       AND COALESCE(business_context, '${DEFAULT_TASK_BUSINESS_CONTEXT}') = $5`,
                    [appliedStudio.imageUrl, JSON.stringify(draft), req.user?.username || 'hermes', productId, businessContext]
                );

                return {
                    status: 200,
                    body: hermesMenuPhotoBody(req, businessScope, {
                        ...product,
                        icon_url: appliedStudio.imageUrl,
                        ai_card_draft: draft
                    }, {
                        status: 'applied'
                    })
                };
            }, {
                pool: query,
                requestPath: '/api/hermes/menu-photos/:productId/apply',
                transactional: true
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_MENU_PHOTO_MUTATION_FAILED', err.message);
            }
            log.error('Hermes menu photo apply error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes menu photo apply failed');
        }
    });

    router.post('/menu-photos/:productId/reject', requireHermesMutationGuard, async (req, res) => {
        const productId = parseMenuPhotoProductId(req.params.productId);
        if (!productId) {
            return sendHermesError(res, 404, 'HERMES_MENU_PHOTO_NOT_FOUND', 'Menu photo product not found');
        }

        let payload;
        let businessScope;
        try {
            payload = normalizeHermesMenuPhotoRejectPayload(req.body || {});
            businessScope = ensureWritableTaskBusinessScope(req, res);
            if (!businessScope) return;
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_MENU_PHOTO_PAYLOAD', err.message);
            }
            log.error('Hermes menu photo reject preflight error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes menu photo reject failed');
        }

        try {
            return await withHermesIdempotency(req, res, async ({ pool: mutationPool }) => {
                const businessContext = activeTaskBusinessContext(businessScope);
                const product = await selectHermesMenuPhotoProduct(mutationPool, productId, businessContext, { forUpdate: true });
                if (!product) {
                    throw hermesHttpError(404, 'HERMES_MENU_PHOTO_NOT_FOUND', 'Menu photo product not found');
                }

                const currentDraft = currentHermesMenuPhotoDraft(product);
                const imageStudio = normalizeHermesMenuImageStudio(currentDraft.imageStudio || currentDraft.image_studio || {});
                if (!Object.keys(imageStudio).length) {
                    throw hermesHttpError(409, 'HERMES_MENU_PHOTO_DRAFT_MISSING', 'No menu image draft to reject');
                }
                if (imageStudio.status === 'applied' && product.icon_url === imageStudio.imageUrl) {
                    throw hermesHttpError(409, 'HERMES_MENU_PHOTO_ALREADY_APPLIED', 'Applied menu image cannot be rejected; generate a new draft first');
                }

                const rejectedStudio = normalizeHermesMenuImageStudio({
                    ...imageStudio,
                    status: 'rejected',
                    rejectedAt: new Date().toISOString(),
                    rejectedBy: req.user?.username || 'hermes',
                    error: payload.reason
                });
                const draft = buildHermesMenuPhotoDraft(product, rejectedStudio, { currentDraft });
                await persistHermesMenuPhotoDraft(mutationPool, productId, businessContext, req.user?.username || 'hermes', draft);

                return {
                    status: 200,
                    body: hermesMenuPhotoBody(req, businessScope, {
                        ...product,
                        ai_card_draft: draft
                    }, {
                        status: 'rejected'
                    })
                };
            }, {
                pool: query,
                requestPath: '/api/hermes/menu-photos/:productId/reject',
                transactional: true
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_MENU_PHOTO_MUTATION_FAILED', err.message);
            }
            log.error('Hermes menu photo reject error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes menu photo reject failed');
        }
    });

    router.post('/tasks', requireHermesMutationGuard, async (req, res) => {
        let payload;
        let businessScope;
        try {
            payload = normalizeHermesCreatePayload(req.body || {});
            businessScope = ensureWritableTaskBusinessScope(req, res);
            if (!businessScope) return;
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_TASK_PAYLOAD', err.message);
            }
            log.error('Hermes task create preflight error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task create failed');
        }

        try {
            return await withHermesIdempotency(req, res, async ({ pool: mutationPool, afterCommit }) => {
                const businessContext = activeTaskBusinessContext(businessScope);
                const owner = payload.ownerUserId
                    ? await getAssignableTaskOwner(payload.ownerUserId, {
                        actor: req.user,
                        pool: mutationPool
                    })
                    : null;
                const ownerUserId = owner?.id || null;

                const duplicate = await findActiveDuplicateTask(mutationPool, {
                    title: payload.title,
                    date: payload.date,
                    deadline: payload.deadline,
                    owner_user_id: ownerUserId,
                    category: 'admin',
                    subcategory: null,
                    source_type: 'hermes',
                    source_id: null,
                    template_id: null,
                    source_entity_type: null,
                    source_entity_id: null,
                    pack_id: null,
                    checklist_template_key: null,
                    afisha_id: null,
                    businessContext
                });
                if (duplicate) {
                    throw hermesHttpError(409, 'TASK_DUPLICATE_ACTIVE', 'Active duplicate task exists', {
                        existingId: duplicate.id,
                        existingStatus: duplicate.status || null
                    });
                }

                const kleshnya = getKleshnya();
                const task = await kleshnya.createTask({
                    businessContext,
                    title: payload.title,
                    description: payload.description,
                    date: payload.date,
                    priority: payload.priority,
                    assigned_to: owner?.label || null,
                    owner_user_id: ownerUserId,
                    owner: owner?.label || null,
                    task_type: 'human',
                    deadline: payload.deadline,
                    source_type: 'hermes',
                    source_id: null,
                    category: 'admin',
                    subcategory: null,
                    created_by: req.user?.username || 'hermes',
                    created_by_user_id: normalizeUserId(req.user),
                    task_mode: 'work',
                    task_kind: payload.subtasks.length ? 'checklist' : 'action',
                    visibility: 'team',
                    workflow_state: 'todo',
                    source_module: 'hermes',
                    duplicateMode: 'reject',
                    sourceSurface: 'hermes'
                }, {
                    pool: mutationPool,
                    afterCommit,
                    skipNotifications: Boolean(options.skipNotifications)
                });

                const subtasks = payload.subtasks.length
                    ? await replaceTaskSubtasks(mutationPool, task.id, payload.subtasks, { sourceType: 'manual' })
                    : [];
                const responseTask = enrichHermesCreatedTask(task, {
                    actor: req.user,
                    owner,
                    subtasks
                });

                return {
                    status: 201,
                    body: {
                        success: true,
                        task: toHermesTaskDetail(responseTask, {
                            ...taskMapperOptions(req),
                            labels: payload.labels
                        }),
                        meta: {
                            businessScope: taskBusinessScopeMeta(businessScope),
                            sourceSurface: 'hermes',
                            source: HERMES_INTEGRATION_ID,
                            idempotencyKey: req.hermesMutation?.idempotencyKey || null
                        }
                    }
                };
            }, {
                pool: query,
                requestPath: '/api/hermes/tasks',
                transactional: true
            });
        } catch (err) {
            if (err instanceof TaskDuplicateError || err.code === 'TASK_DUPLICATE_ACTIVE') {
                return sendHermesError(res, 409, err.code || 'TASK_DUPLICATE_ACTIVE', err.message);
            }
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_TASK_PAYLOAD', err.message);
            }
            log.error('Hermes task create error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task create failed');
        }
    });

    router.post('/tasks/:id/complete', requireHermesMutationGuard, async (req, res) => {
        let payload;
        let businessScope;
        const taskId = parsePositiveInt(req.params.id);
        if (!taskId) {
            return sendHermesError(res, 404, 'HERMES_TASK_NOT_FOUND', 'Task not found');
        }

        try {
            payload = normalizeHermesCompletePayload(req.body || {});
            businessScope = ensureWritableTaskBusinessScope(req, res);
            if (!businessScope) return;
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_TASK_PAYLOAD', err.message);
            }
            log.error('Hermes task complete preflight error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task complete failed');
        }

        try {
            return await withHermesIdempotency(req, res, async ({ pool: mutationPool }) => {
                const result = await completeTask(taskId, req.user, {
                    pool: mutationPool,
                    businessScope,
                    sourceSurface: 'hermes',
                    route: 'hermes_task_complete',
                    reportId: payload.reportId
                });
                return {
                    status: 200,
                    body: hermesMutationTaskBody(req, businessScope, result.task, {
                        historyEvent: result.historyEvent || null
                    })
                };
            }, {
                pool: query,
                requestPath: '/api/hermes/tasks/:id/complete',
                transactional: true
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_TASK_MUTATION_FAILED', err.message);
            }
            log.error('Hermes task complete error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task complete failed');
        }
    });

    router.post('/tasks/:id/reassign', requireHermesMutationGuard, async (req, res) => {
        let payload;
        let businessScope;
        const taskId = parsePositiveInt(req.params.id);
        if (!taskId) {
            return sendHermesError(res, 404, 'HERMES_TASK_NOT_FOUND', 'Task not found');
        }

        try {
            payload = normalizeHermesReassignPayload(req.body || {});
            businessScope = ensureWritableTaskBusinessScope(req, res);
            if (!businessScope) return;
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_TASK_PAYLOAD', err.message);
            }
            log.error('Hermes task reassign preflight error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task reassign failed');
        }

        try {
            return await withHermesIdempotency(req, res, async ({ pool: mutationPool }) => {
                const result = await reassignTaskOwner(taskId, payload.ownerUserId, req.user, {
                    pool: mutationPool,
                    businessScope,
                    sourceSurface: 'hermes',
                    route: 'hermes_task_reassign'
                });
                const body = hermesMutationTaskBody(req, businessScope, result.task, {
                    historyEvent: result.historyEvent || null
                });
                body.assignee = body.task.assignee;
                return {
                    status: 200,
                    body
                };
            }, {
                pool: query,
                requestPath: '/api/hermes/tasks/:id/reassign',
                transactional: true
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_TASK_MUTATION_FAILED', err.message);
            }
            log.error('Hermes task reassign error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task reassign failed');
        }
    });

    router.post('/tasks/:id/reschedule', requireHermesMutationGuard, async (req, res) => {
        let payload;
        let businessScope;
        const taskId = parsePositiveInt(req.params.id);
        if (!taskId) {
            return sendHermesError(res, 404, 'HERMES_TASK_NOT_FOUND', 'Task not found');
        }

        try {
            payload = normalizeHermesReschedulePayload(req.body || {});
            businessScope = ensureWritableTaskBusinessScope(req, res);
            if (!businessScope) return;
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_TASK_PAYLOAD', err.message);
            }
            log.error('Hermes task reschedule preflight error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task reschedule failed');
        }

        try {
            return await withHermesIdempotency(req, res, async ({ pool: mutationPool }) => {
                const result = await rescheduleTask(taskId, payload.deadline, req.user, {
                    pool: mutationPool,
                    businessScope,
                    sourceSurface: 'hermes',
                    route: 'hermes_task_reschedule'
                });
                return {
                    status: 200,
                    body: hermesMutationTaskBody(req, businessScope, result.task, {
                        historyEvent: result.historyEvent || null
                    })
                };
            }, {
                pool: query,
                requestPath: '/api/hermes/tasks/:id/reschedule',
                transactional: true
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_TASK_MUTATION_FAILED', err.message);
            }
            log.error('Hermes task reschedule error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task reschedule failed');
        }
    });

    router.post('/tasks/:id/status', requireHermesMutationGuard, async (req, res) => {
        let payload;
        let businessScope;
        const taskId = parsePositiveInt(req.params.id);
        if (!taskId) {
            return sendHermesError(res, 404, 'HERMES_TASK_NOT_FOUND', 'Task not found');
        }

        try {
            payload = normalizeHermesStatusPayload(req.body || {});
            businessScope = ensureWritableTaskBusinessScope(req, res);
            if (!businessScope) return;
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_TASK_PAYLOAD', err.message);
            }
            log.error('Hermes task status preflight error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task status failed');
        }

        try {
            return await withHermesIdempotency(req, res, async ({ pool: mutationPool }) => {
                const result = await updateTaskStatus(taskId, payload.status, req.user, {
                    pool: mutationPool,
                    businessScope,
                    sourceSurface: 'hermes',
                    route: 'hermes_task_status'
                });
                return {
                    status: 200,
                    body: hermesMutationTaskBody(req, businessScope, result.task, {
                        historyEvent: result.historyEvent || null,
                        unchanged: result.unchanged === true
                    })
                };
            }, {
                pool: query,
                requestPath: '/api/hermes/tasks/:id/status',
                transactional: true
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_TASK_MUTATION_FAILED', err.message);
            }
            log.error('Hermes task status error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task status failed');
        }
    });

    router.get('/tasks', async (req, res) => {
        try {
            const queryParts = taskWhereForRequest(req, { res });
            if (!queryParts) return;
            applyListFilters(req, queryParts);

            const limit = parseLimit(req.query.limit);
            const limitRef = pushParam(queryParts.params, limit + 1);
            const result = await query.query(
                `SELECT ${TASK_SELECT_FIELDS}
                 FROM tasks t
                 LEFT JOIN users u ON u.id = t.owner_user_id
                 LEFT JOIN users creator ON creator.id = t.created_by_user_id
                 WHERE ${queryParts.whereParts.join('\n                   AND ')}
                 ORDER BY COALESCE(t.updated_at, t.created_at) DESC, t.id DESC
                 LIMIT ${limitRef}`,
                queryParts.params
            );
            const rows = result.rows || [];
            const visibleRows = rows.slice(0, limit);
            const nextRow = rows.length > limit ? visibleRows[visibleRows.length - 1] : null;

            res.json({
                success: true,
                items: visibleRows.map(task => toHermesTaskListItem(task, taskMapperOptions(req))),
                pagination: toHermesPagination({
                    nextCursor: nextRow ? encodeCursor(nextRow) : null,
                    hasMore: rows.length > limit,
                    limit
                }),
                meta: {
                    businessScope: taskBusinessScopeMeta(queryParts.businessScope)
                }
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_REQUEST', err.message);
            }
            log.error('Hermes task list error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task list failed');
        }
    });

    router.get('/tasks/:id/history', async (req, res) => {
        try {
            const taskId = parsePositiveInt(req.params.id);
            if (!taskId) {
                return sendHermesError(res, 404, 'HERMES_TASK_NOT_FOUND', 'Task not found');
            }
            const queryParts = taskWhereForRequest(req, { res, taskId });
            if (!queryParts) return;

            const visible = await query.query(
                `SELECT t.id
                 FROM tasks t
                 WHERE ${queryParts.whereParts.join('\n                   AND ')}
                 LIMIT 1`,
                queryParts.params
            );
            if (!visible.rows.length) {
                return sendHermesError(res, 404, 'HERMES_TASK_NOT_FOUND', 'Task not found');
            }

            const limit = parseLimit(req.query.limit);
            const history = await listTaskActionHistory(taskId, { limit, pool: query });
            res.json({
                success: true,
                events: history.map(toHermesTaskHistoryEvent),
                meta: {
                    newestFirst: true,
                    limit,
                    businessScope: taskBusinessScopeMeta(queryParts.businessScope)
                }
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_REQUEST', err.message);
            }
            log.error('Hermes task history error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task history failed');
        }
    });

    router.get('/tasks/:id', async (req, res) => {
        try {
            const taskId = parsePositiveInt(req.params.id);
            if (!taskId) {
                return sendHermesError(res, 404, 'HERMES_TASK_NOT_FOUND', 'Task not found');
            }
            const queryParts = taskWhereForRequest(req, { res, taskId });
            if (!queryParts) return;

            const result = await query.query(
                `SELECT ${TASK_SELECT_FIELDS},
                        COALESCE(subtask_rows.subtasks, '[]'::json) AS subtasks
                 FROM tasks t
                 LEFT JOIN users u ON u.id = t.owner_user_id
                 LEFT JOIN users creator ON creator.id = t.created_by_user_id
                 ${SUBTASK_JOIN_SQL}
                 WHERE ${queryParts.whereParts.join('\n                   AND ')}
                 LIMIT 1`,
                queryParts.params
            );
            if (!result.rows.length) {
                return sendHermesError(res, 404, 'HERMES_TASK_NOT_FOUND', 'Task not found');
            }

            res.json({
                success: true,
                task: toHermesTaskDetail(result.rows[0], taskMapperOptions(req)),
                meta: {
                    businessScope: taskBusinessScopeMeta(queryParts.businessScope)
                }
            });
        } catch (err) {
            if (err.statusCode && err.statusCode < 500) {
                return sendHermesError(res, err.statusCode, err.code || 'HERMES_INVALID_REQUEST', err.message);
            }
            log.error('Hermes task detail error', err);
            return sendHermesError(res, 500, 'HERMES_INTERNAL_ERROR', 'Hermes task detail failed');
        }
    });

    return router;
}

module.exports = createHermesRouter();
module.exports.createHermesRouter = createHermesRouter;
module.exports.buildCapabilitiesPayload = buildCapabilitiesPayload;
module.exports.createHermesRateLimiter = createHermesRateLimiter;
module.exports.PLANNED_MUTATION_ACTIONS = PLANNED_MUTATION_ACTIONS;
module.exports.requireHermesMutationGuard = requireHermesMutationGuard;
module.exports.SUPPORTED_ACTIONS = SUPPORTED_ACTIONS;
