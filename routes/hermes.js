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
    rescheduleTask
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
const { createLogger } = require('../utils/logger');

const log = createLogger('Hermes');

const SUPPORTED_ACTIONS = [
    'tasks.read',
    'tasks.detail',
    'tasks.history',
    'tasks.create',
    'tasks.complete',
    'tasks.reassign',
    'tasks.reschedule'
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
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isDateOnly(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

function buildCapabilitiesPayload() {
    return {
        success: true,
        integrationId: HERMES_INTEGRATION_ID,
        auth: 'x-api-key',
        authFallback: 'authorization-bearer',
        maxLimit: 50,
        pagination: 'cursor',
        mutationsRequireConfirmation: true,
        mutationsRequireIdempotencyKey: true,
        supportedActions: SUPPORTED_ACTIONS,
        mutationActionsAvailable: true,
        plannedMutationActions: PLANNED_MUTATION_ACTIONS,
        webhooks: {
            crmToHermesEnabled: false
        }
    };
}

function createHermesRouter(options = {}) {
    const router = express.Router();
    const authMiddleware = options.authMiddleware || hermesAuth;
    const query = options.pool || pool;
    const rateLimiter = options.rateLimiter !== undefined
        ? options.rateLimiter
        : (options.rateLimit === false ? null : createHermesRateLimiter(options.rateLimit || {}));

    if (rateLimiter) {
        router.use(rateLimiter);
    }
    router.use(authMiddleware);

    router.get('/capabilities', (req, res) => {
        res.json(buildCapabilitiesPayload());
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
