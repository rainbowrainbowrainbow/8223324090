/**
 * routes/tasks.js — Tasks CRUD + Kleshnya integration (v10.0)
 */
const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { requireRole, authenticateToken, canUseAction } = require('../middleware/auth');
const { buildTaskPaginationMetadata } = require('../services/taskPagination');

// v39.8: Security — require authentication for all task endpoints
router.use(authenticateToken);
// v40: Validate :id param is numeric
router.param('id', (req, res, next, val) => { if (val && !/^\d+$/.test(val)) return res.status(400).json({ error: 'Invalid ID format' }); next(); });
const { createLogger } = require('../utils/logger');
const { getPermissions } = require('../config/roles');
const {
    buildTaskOwnerMatch,
    buildTaskVisibilityScope,
    canManageTaskObservers,
    canMutateTask,
    canReassignTask,
    normalizeUserId,
    taskRouteCapabilityDecision
} = require('../services/taskPolicy');
const {
    completeTask,
    getAssignableTaskOwner,
    listTaskOwnerCandidates,
    taskCompletionReportId,
    taskControlMeta,
    taskRequiresCompletionReport,
    reassignTaskOwner,
    resolveDeadline,
    rescheduleTask
} = require('../services/taskExecution');
const { listTaskActionHistory, logTaskActionEvent, TASK_ACTION_TYPES } = require('../services/taskActionHistory');
const { normalizeTaskPayload: normalizeTaskContractPayload } = require('../services/taskContract');
const { withTaskDrawerContract } = require('../services/taskDetailContract');
const { buildTaskOverview } = require('../services/taskOverviewProjection');
const { buildTaskTeamControlProjection } = require('../services/taskTeamControlProjection');
const { loadTaskOwnerCapacity, normalizeTaskPlanningRange } = require('../services/taskTeamCapacityReadModel');
const { savedViewsPatchFromBody, taskSavedViewsFromPreferences } = require('../services/taskSavedViews');
const {
    attachTaskSchedule,
    canonicalTaskOrderSql,
    dateOnly: taskKyivDateOnly,
    getAvailability,
    getSchedulePolicy,
    hasSchedulePayload,
    scheduleTask
} = require('../services/taskScheduling');
const {
    TaskDuplicateError,
    activeDuplicateCanonicalFilterSql,
    canForceTaskDuplicate,
    duplicateSignatureSql,
    findActiveDuplicateTask
} = require('../services/taskDuplicatePolicy');
const {
    hasSubtaskPayload,
    listTaskSubtasks,
    normalizeSubtaskReorderIds,
    normalizeSubtaskRow,
    normalizeSubtaskSourceType,
    reorderTaskSubtasks,
    replaceTaskSubtasks,
    subtaskPayloadFromBody,
    subtaskProgress
} = require('../services/taskSubtasks');
const {
    generateTaskDecompositionDraft,
    getTaskDecompositionTemplates
} = require('../services/taskDecomposition');
const {
    applySavedDecompositionTemplate,
    createSavedDecompositionTemplate,
    deleteSavedDecompositionTemplate,
    getDecompositionSuggestions,
    listSavedDecompositionTemplates,
    updateSavedDecompositionTemplate
} = require('../services/taskDecompositionLibrary');
const { getTaskProductivity } = require('../services/taskProductivity');
const {
    VALID_TASK_CATEGORIES,
    VALID_TASK_SUBCATEGORIES,
    ORDER_OPERATION_PRESETS,
    normalizeTaskCategory,
    normalizeTaskSubcategory,
    normalizePackStatus,
    normalizeChecklistTemplateKey,
    normalizeSourceEntityType,
    normalizeSourceEntityId,
    normalizeUuid,
    normalizeOwnerRole,
    normalizeSlaMinutes,
    getChecklistTemplate,
    createChecklistSubtasks
} = require('../services/taskTaxonomy');
const {
    activeTaskBusinessContext,
    appendTaskBusinessScopeSql,
    ensureTaskBusinessScope,
    ensureWritableTaskBusinessScope,
    pushTaskBusinessScopeCondition,
    taskBusinessScopeMeta
} = require('../services/taskBusinessScope');
const {
    emitTaskAssignedToOwner: emitCanonicalTaskAssignedToOwner
} = require('../services/taskNotifications');
const {
    buildTaskCabinetProjection,
    ensureTaskPreferences,
    normalizeTaskCabinetFocusDate
} = require('../services/taskCabinetProjection');

const { sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
const { formatTaskNotification } = require('../services/templates');
const log = createLogger('Tasks');
let _triggerAlertBroadcast;
try { _triggerAlertBroadcast = require('./dashboard').triggerAlertBroadcast; } catch {}
function _alertPush() { if (_triggerAlertBroadcast) _triggerAlertBroadcast(); }

function emitTaskAssignedToOwner(task, actor, options = {}) {
    return emitCanonicalTaskAssignedToOwner(task, actor, {
        source: 'routes/tasks',
        ...options
    });
}

// Lazy require to avoid circular dependency
function getKleshnya() {
    return require('../services/kleshnya');
}

// v19.10: Send task notification to Telegram (fire-and-forget)
async function notifyTaskAssignment(task, username) {
    try {
        const chatId = await getConfiguredChatId();
        if (!chatId) return { sent: false, reason: 'no_chat_id' };
        const text = formatTaskNotification('task_assigned', task, { username });
        if (!text) return { sent: false, reason: 'empty_template' };
        const result = await sendTelegramMessage(chatId, text);
        return { sent: !!result?.ok, result };
    } catch (err) {
        log.error(`Task notification failed: ${err.message}`);
        return { sent: false, reason: 'error', error: err.message };
    }
}

function taskAssigneeChanged(oldTask = {}, newTask = {}) {
    const oldOwner = Number(oldTask.owner_user_id || 0);
    const newOwner = Number(newTask.owner_user_id || 0);
    const oldLabel = String(oldTask.assigned_to || '');
    const newLabel = String(newTask.assigned_to || '');
    return oldOwner !== newOwner || oldLabel !== newLabel;
}

function normalizedComparable(value) {
    if (value === undefined || value === null) return null;
    return String(value);
}

async function logDirectTaskUpdateHistory(oldTask = {}, updatedTask = {}, actor = {}, body = {}) {
    const historyEvents = [];
    const taskId = Number(updatedTask.id || oldTask.id);
    if (!Number.isInteger(taskId) || taskId <= 0) return historyEvents;

    async function record(event) {
        try {
            const historyEvent = await logTaskActionEvent({
                taskId,
                actor,
                sourceSurface: sourceSurface(body, 'task_detail'),
                ...event
            });
            historyEvents.push(historyEvent);
        } catch (historyErr) {
            log.warn(`Direct task update history skipped: ${historyErr.message}`);
        }
    }

    if (normalizedComparable(oldTask.status) !== normalizedComparable(updatedTask.status)) {
        await record({
            actionType: TASK_ACTION_TYPES.STATUS_CHANGED,
            oldValue: { status: oldTask.status || null },
            newValue: { status: updatedTask.status || null },
            meta: { route: 'tasks_put_update', canonicalField: 'tasks.status' }
        });
    }

    if (taskAssigneeChanged(oldTask, updatedTask)) {
        await record({
            actionType: TASK_ACTION_TYPES.OWNER_REASSIGNED,
            oldValue: {
                ownerUserId: oldTask.owner_user_id || null,
                assignedTo: oldTask.assigned_to || null,
                owner: oldTask.owner || null
            },
            newValue: {
                ownerUserId: updatedTask.owner_user_id || null,
                assignedTo: updatedTask.assigned_to || null,
                owner: updatedTask.owner || null
            },
            meta: {
                route: 'tasks_put_update',
                canonicalField: 'tasks.owner_user_id',
                legacyDisplayFields: ['assigned_to', 'owner']
            }
        });
    }

    const timingChanged = ['date', 'deadline', 'time_window_start', 'time_window_end'].some(field =>
        normalizedComparable(oldTask[field]) !== normalizedComparable(updatedTask[field])
    );
    if (timingChanged && !hasSchedulePayload(body)) {
        await record({
            actionType: TASK_ACTION_TYPES.RESCHEDULED,
            oldValue: {
                date: oldTask.date || null,
                deadline: oldTask.deadline || null,
                timeWindowStart: oldTask.time_window_start || null,
                timeWindowEnd: oldTask.time_window_end || null
            },
            newValue: {
                date: updatedTask.date || null,
                deadline: updatedTask.deadline || null,
                timeWindowStart: updatedTask.time_window_start || null,
                timeWindowEnd: updatedTask.time_window_end || null
            },
            meta: { route: 'tasks_put_update', canonicalField: 'tasks.deadline' }
        });
    }

    if (normalizedComparable(oldTask.priority) !== normalizedComparable(updatedTask.priority)) {
        await record({
            actionType: TASK_ACTION_TYPES.PRIORITY_CHANGED,
            oldValue: { priority: oldTask.priority || null },
            newValue: { priority: updatedTask.priority || null },
            meta: { route: 'tasks_put_update', canonicalField: 'tasks.priority' }
        });
    }

    return historyEvents;
}

const VALID_STATUSES = ['todo', 'in_progress', 'done'];
const FILTERABLE_STATUSES = [...VALID_STATUSES, 'archived', 'cancelled', 'overdue'];
const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const URGENT_PRIORITY_ESCALATION_MINUTES = 90;
const URGENT_PRIORITY_NOTIFICATION_COOLDOWN_MINUTES = 60;
const TASK_SOUND_THEMES = ['rock', 'classic', 'subtle'];
const URGENT_TASK_MOVEMENT_ACTION_TYPES = [
    TASK_ACTION_TYPES.COMPLETED,
    TASK_ACTION_TYPES.STATUS_CHANGED,
    TASK_ACTION_TYPES.RESCHEDULED,
    TASK_ACTION_TYPES.SCHEDULED,
    TASK_ACTION_TYPES.SCHEDULE_MOVED,
    TASK_ACTION_TYPES.SCHEDULE_MANUAL_OVERRIDE,
    TASK_ACTION_TYPES.SCHEDULE_PROPOSAL_CREATED,
    TASK_ACTION_TYPES.SNOOZED,
    TASK_ACTION_TYPES.URGENT_COMMITMENT_SET,
    TASK_ACTION_TYPES.PRIORITY_CHANGED,
    TASK_ACTION_TYPES.SUBTASK_COMPLETED
];
const VALID_CATEGORIES = VALID_TASK_CATEGORIES;
const VALID_TASK_TYPES = ['human', 'bot'];
const VALID_TASK_MODES = ['work', 'personal', 'private', 'system'];
const VALID_TASK_KINDS = ['action', 'reminder', 'followup', 'deep_work', 'checklist', 'routine', 'waiting', 'idea', 'decision'];
const VALID_TASK_VISIBILITIES = ['team', 'me_only', 'private'];
const VALID_WORKFLOW_STATES = ['inbox', 'todo', 'in_progress', 'waiting', 'scheduled', 'done', 'archived'];

function isTruthy(value) {
    return value === true || value === 'true' || value === '1' || value === 1;
}

function optionalInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function parseJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function hasOwn(body = {}, key) {
    return Object.prototype.hasOwnProperty.call(body, key);
}

function normalizeTaskPriority(value = 'normal') {
    const priority = String(value || 'normal').trim().toLowerCase();
    return VALID_PRIORITIES.includes(priority) ? priority : 'normal';
}

function taskPriorityOrderSql(alias = 't') {
    return `CASE ${alias}.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 2 END`;
}

function normalizeTaskControlMeta(body = {}, oldTask = {}) {
    const base = taskControlMeta(oldTask);
    const incoming = parseJsonObject(body.controlMeta || body.control_meta || {});
    const meta = { ...base, ...incoming };
    const reportRequiredRaw = hasOwn(body, 'reportRequired')
        ? body.reportRequired
        : (hasOwn(body, 'requiresReport') ? body.requiresReport
            : (hasOwn(body, 'report_required') ? body.report_required
                : (hasOwn(body, 'requires_report') ? body.requires_report : undefined)));
    if (reportRequiredRaw !== undefined) meta.reportRequired = isTruthy(reportRequiredRaw);

    const rescheduleRaw = hasOwn(body, 'allowReschedule')
        ? body.allowReschedule
        : (hasOwn(body, 'allow_reschedule') ? body.allow_reschedule
            : (hasOwn(body, 'canReschedule') ? body.canReschedule
                : (hasOwn(body, 'can_reschedule') ? body.can_reschedule : undefined)));
    if (rescheduleRaw !== undefined) {
        const allowed = isTruthy(rescheduleRaw);
        meta.canReschedule = allowed;
        meta.allowReschedule = allowed;
    }

    const reportIdRaw = body.reportId || body.report_id || meta.reportId || meta.report_id;
    const reportId = optionalInteger(reportIdRaw);
    if (reportId) meta.reportId = reportId;
    if (meta.reportRequired === false && !reportId) {
        delete meta.reportId;
        delete meta.report_id;
        delete meta.taskReportId;
        delete meta.completionReportId;
    }
    return meta;
}

function makeTaskReportRequiredError(task = {}) {
    const err = new Error('Для виконання цієї задачі спочатку потрібно додати звіт.');
    err.statusCode = 409;
    err.code = 'TASK_REPORT_REQUIRED';
    err.requiresReport = true;
    err.task = { id: task.id, title: task.title || null, reportRequired: true };
    return err;
}

async function ensureTaskReportReference(reportId, businessContext = null) {
    const id = optionalInteger(reportId);
    if (!id) return null;
    const params = [id];
    let businessCondition = '';
    if (businessContext) {
        params.push(activeTaskBusinessContext(businessContext));
        businessCondition = ` AND COALESCE(business_context, 'event_genix') = $${params.length}`;
    }
    const result = await pool.query(`SELECT id FROM reports WHERE id = $1${businessCondition} LIMIT 1`, params);
    if (!result.rows.length) {
        const err = new Error('Звіт не знайдено або його ще не збережено.');
        err.statusCode = 400;
        err.code = 'TASK_REPORT_NOT_FOUND';
        throw err;
    }
    return id;
}

function enumValue(value, allowed, fallback) {
    const raw = String(value || '').trim();
    return allowed.includes(raw) ? raw : fallback;
}

function workflowFromStatus(status = 'todo') {
    if (status === 'done') return 'done';
    if (status === 'archived') return 'archived';
    if (status === 'in_progress') return 'in_progress';
    return 'todo';
}

function defaultVisibilityForMode(mode, explicitVisibility) {
    if (VALID_TASK_VISIBILITIES.includes(explicitVisibility)) return explicitVisibility;
    if (mode === 'private') return 'private';
    if (mode === 'personal') return 'me_only';
    return 'team';
}

function normalizeOptionalDateTime(value) {
    if (value === undefined) return undefined;
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : value;
}

function normalizeTaskOperations(body = {}, oldTask = {}) {
    const categoryInput = body.category !== undefined ? body.category : oldTask.category;
    const category = normalizeTaskCategory(categoryInput, oldTask.category || 'admin');
    const subcategoryInput = body.subcategory !== undefined
        ? body.subcategory
        : (body.category_leaf !== undefined ? body.category_leaf
            : (body.categoryLeaf !== undefined ? body.categoryLeaf : oldTask.subcategory));
    const subcategory = normalizeTaskSubcategory(category, subcategoryInput);
    const checklistKeyInput = body.checklist_template_key !== undefined
        ? body.checklist_template_key
        : (body.checklistTemplateKey !== undefined ? body.checklistTemplateKey : oldTask.checklist_template_key);
    const checklistTemplateKey = category === 'checklist'
        ? normalizeChecklistTemplateKey(checklistKeyInput, subcategory)
        : null;
    const sourceEntityType = body.source_entity_type !== undefined
        ? normalizeSourceEntityType(body.source_entity_type)
        : (body.sourceEntityType !== undefined ? normalizeSourceEntityType(body.sourceEntityType) : (oldTask.source_entity_type || null));
    const sourceEntityId = body.source_entity_id !== undefined
        ? normalizeSourceEntityId(body.source_entity_id)
        : (body.sourceEntityId !== undefined ? normalizeSourceEntityId(body.sourceEntityId) : (oldTask.source_entity_id || null));
    const packId = body.pack_id !== undefined
        ? normalizeUuid(body.pack_id)
        : (body.packId !== undefined ? normalizeUuid(body.packId) : (oldTask.pack_id || null));
    const packStatus = body.pack_status !== undefined
        ? normalizePackStatus(body.pack_status, null)
        : (body.packStatus !== undefined ? normalizePackStatus(body.packStatus, null) : (oldTask.pack_status || null));
    const ownerRole = body.owner_role !== undefined
        ? normalizeOwnerRole(body.owner_role)
        : (body.ownerRole !== undefined ? normalizeOwnerRole(body.ownerRole) : (oldTask.owner_role || null));
    const slaMinutes = body.sla_minutes !== undefined
        ? normalizeSlaMinutes(body.sla_minutes)
        : (body.slaMinutes !== undefined ? normalizeSlaMinutes(body.slaMinutes) : (oldTask.sla_minutes || null));
    const escalateAfter = normalizeOptionalDateTime(
        body.escalate_after !== undefined
            ? body.escalate_after
            : (body.escalateAfter !== undefined ? body.escalateAfter : oldTask.escalate_after)
    );

    return {
        category,
        subcategory,
        checklist_template_key: checklistTemplateKey,
        source_entity_type: sourceEntityType,
        source_entity_id: sourceEntityId,
        pack_id: packId,
        pack_status: packStatus,
        owner_role: ownerRole,
        sla_minutes: slaMinutes,
        escalate_after: escalateAfter
    };
}

function normalizeDependencyIds(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(id => parseInt(id, 10))
        .filter(id => Number.isInteger(id) && id > 0);
}

function normalizeObserverIds(value) {
    const raw = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(',') : []);
    return [...new Set(raw
        .map(item => {
            if (item && typeof item === 'object') return parseInt(item.userId || item.user_id || item.id, 10);
            return parseInt(item, 10);
        })
        .filter(id => Number.isInteger(id) && id > 0))];
}

function observerIdsFromBody(body = {}) {
    if (body.observerUserIds !== undefined) return normalizeObserverIds(body.observerUserIds);
    if (body.observer_user_ids !== undefined) return normalizeObserverIds(body.observer_user_ids);
    if (body.observers !== undefined) return normalizeObserverIds(body.observers);
    if (body.watchers !== undefined) return normalizeObserverIds(body.watchers);
    return [];
}

function hasObserverPatch(body = {}) {
    return body.observerUserIds !== undefined
        || body.observer_user_ids !== undefined
        || body.observers !== undefined
        || body.watchers !== undefined;
}

function normalizeObserverRow(row = {}) {
    return {
        userId: row.user_id || row.id || null,
        username: row.username || null,
        name: row.name || null,
        role: row.role || null,
        label: row.name || row.username || (row.user_id ? `User #${row.user_id}` : null),
        accessLevel: row.access_level || 'materials',
        addedBy: row.added_by || null,
        createdAt: row.created_at || null
    };
}

async function listTaskObservers(taskId, options = {}) {
    const query = options.pool || pool;
    const result = await query.query(
        `SELECT tob.user_id, tob.access_level, tob.added_by, tob.created_at,
                u.username, u.name, u.role
         FROM task_observers tob
         JOIN users u ON u.id = tob.user_id
         WHERE tob.task_id = $1
         ORDER BY COALESCE(NULLIF(u.name, ''), u.username), u.id`,
        [taskId]
    );
    return result.rows.map(normalizeObserverRow);
}

async function replaceTaskObservers(task, observerIds = [], actor) {
    const taskId = Number(task?.id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
        const err = new Error('Valid task id is required');
        err.statusCode = 400;
        err.code = 'INVALID_TASK_ID';
        throw err;
    }
    if (!canManageTaskObservers(actor, task)) {
        const err = new Error('Недостатньо прав для зміни спостерігачів задачі');
        err.statusCode = 403;
        err.code = 'TASK_OBSERVERS_FORBIDDEN';
        throw err;
    }

    const ownerId = Number(task.owner_user_id || task.ownerUserId || 0);
    const uniqueIds = normalizeObserverIds(observerIds).filter(id => id !== ownerId);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const previous = await listTaskObservers(taskId, { pool: client });
        const validated = [];
        for (const userId of uniqueIds) {
            const owner = await getAssignableTaskOwner(userId, { pool: client, actor });
            validated.push(owner);
        }

        await client.query('DELETE FROM task_observers WHERE task_id = $1', [taskId]);
        for (const owner of validated) {
            await client.query(
                `INSERT INTO task_observers (task_id, user_id, access_level, added_by)
                 VALUES ($1, $2, 'materials', $3)
                 ON CONFLICT (task_id, user_id) DO UPDATE
                 SET access_level = EXCLUDED.access_level,
                     added_by = EXCLUDED.added_by`,
                [taskId, owner.id, normalizeUserId(actor)]
            );
        }
        const observers = await listTaskObservers(taskId, { pool: client });
        await logTaskActionEvent({
            taskId,
            actionType: TASK_ACTION_TYPES.OBSERVERS_UPDATED,
            actor,
            sourceSurface: 'task_page',
            oldValue: { observerUserIds: previous.map(item => item.userId) },
            newValue: { observerUserIds: observers.map(item => item.userId) },
            meta: {
                route: 'tasks_task_observers',
                accessLevel: 'materials',
                policy: 'observers_can_read_task_materials'
            }
        }, { pool: client });
        await client.query('COMMIT');
        return observers;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
    } finally {
        client.release();
    }
}

async function createTaskDependencyRows(taskId, dependencyIds = []) {
    const ids = normalizeDependencyIds(dependencyIds).filter(id => Number(id) !== Number(taskId));
    if (!ids.length) return [];
    const owner = await pool.query(
        "SELECT COALESCE(business_context, 'event_genix') AS business_context FROM tasks WHERE id = $1 LIMIT 1",
        [taskId]
    );
    const businessContext = owner.rows[0]?.business_context || 'event_genix';
    const allowed = await pool.query(
        "SELECT id FROM tasks WHERE id = ANY($1::int[]) AND COALESCE(business_context, 'event_genix') = $2",
        [ids, businessContext]
    );
    const scopedIds = allowed.rows.map(row => Number(row.id)).filter(Boolean);
    if (!scopedIds.length) return [];
    const values = [];
    const placeholders = scopedIds.map((id, index) => {
        const offset = index * 2;
        values.push(taskId, id);
        return `($${offset + 1}, $${offset + 2})`;
    });
    const result = await pool.query(
        `INSERT INTO task_dependencies (task_id, depends_on_task_id)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
         RETURNING *`,
        values
    );
    return result.rows;
}

async function attachSubtaskSummary(task, options = {}) {
    if (!task?.id) return task;
    const hasKnownCounts = Number.isFinite(Number(task.subtask_count)) && Number.isFinite(Number(task.subtask_done_count));
    if (hasKnownCounts && (!options.includeSubtasks || Array.isArray(task.subtasks))) return task;
    const result = await pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_done = true)::int AS done
         FROM task_subtasks
         WHERE task_id = $1`,
        [task.id]
    );
    task.subtask_count = result.rows[0]?.total || 0;
    task.subtask_done_count = result.rows[0]?.done || 0;
    if (options.includeSubtasks) {
        task.subtasks = await listTaskSubtasks(pool, task.id);
    }
    return task;
}

function normalizeTaskOsFields(body = {}, oldTask = {}) {
    const mode = enumValue(body.task_mode ?? body.taskMode ?? oldTask.task_mode, VALID_TASK_MODES, oldTask.task_mode || 'work');
    const visibility = defaultVisibilityForMode(mode, body.visibility ?? oldTask.visibility);
    const kind = enumValue(body.task_kind ?? body.taskKind ?? oldTask.task_kind, VALID_TASK_KINDS, oldTask.task_kind || 'action');
    const workflow = enumValue(
        body.workflow_state ?? body.workflowState ?? oldTask.workflow_state,
        VALID_WORKFLOW_STATES,
        oldTask.workflow_state || workflowFromStatus(body.status || oldTask.status || 'todo')
    );
    const focusRankRaw = body.focus_rank ?? body.focusRank ?? oldTask.focus_rank ?? 0;
    const focusRank = Math.max(0, Math.min(99, parseInt(focusRankRaw, 10) || 0));
    const effortRaw = body.effort_minutes ?? body.effortMinutes ?? oldTask.effort_minutes;
    const effortMinutes = effortRaw === undefined || effortRaw === null || effortRaw === ''
        ? null
        : Math.max(1, parseInt(effortRaw, 10) || 0) || null;

    return {
        task_mode: mode,
        task_kind: kind,
        visibility,
        workflow_state: workflow,
        focus_rank: focusRank,
        remind_at: normalizeOptionalDateTime(body.remind_at ?? body.remindAt ?? oldTask.remind_at),
        snoozed_until: normalizeOptionalDateTime(body.snoozed_until ?? body.snoozedUntil ?? oldTask.snoozed_until),
        last_notified_at: normalizeOptionalDateTime(body.last_notified_at ?? body.lastNotifiedAt ?? oldTask.last_notified_at),
        next_notification_at: normalizeOptionalDateTime(body.next_notification_at ?? body.nextNotificationAt ?? oldTask.next_notification_at),
        evening_review_date: body.evening_review_date ?? body.eveningReviewDate ?? oldTask.evening_review_date ?? null,
        related_entity_type: body.related_entity_type ?? body.relatedEntityType ?? oldTask.related_entity_type ?? null,
        related_entity_id: body.related_entity_id ?? body.relatedEntityId ?? oldTask.related_entity_id ?? null,
        source_module: body.source_module ?? body.sourceModule ?? oldTask.source_module ?? null,
        effort_minutes: effortMinutes
    };
}

function taskDateOnly(value) {
    return taskKyivDateOnly(value);
}

function taskWorkloadDate(task = {}) {
    return taskDateOnly(
        task.scheduledStartAt ||
        task.scheduled_start_at ||
        task.schedule?.startAt ||
        task.snoozedUntil ||
        task.snoozed_until ||
        task.date ||
        task.deadline ||
        task.remindAt ||
        task.remind_at
    );
}

function taskWorkloadDateSql(alias = 't') {
    return `COALESCE(
        (${alias}.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.snoozed_until AT TIME ZONE 'Europe/Kyiv')::date,
        CASE WHEN LEFT(COALESCE(${alias}.date, ''), 10) ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN LEFT(${alias}.date, 10)::date END,
        (${alias}.deadline AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.remind_at AT TIME ZONE 'Europe/Kyiv')::date
    )`;
}

function todayKyivDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateText, days) {
    const d = new Date(`${dateText}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function minutesFromNow(minutes) {
    const d = new Date();
    d.setMinutes(d.getMinutes() + minutes);
    return d.toISOString();
}

function applyUrgentPriorityDefaults(priority, osFields = {}, opsFields = {}, controlMeta = {}, oldTask = {}) {
    const normalized = normalizeTaskPriority(priority);
    const wasUrgent = normalizeTaskPriority(oldTask.priority) === 'urgent';
    if (normalized === 'urgent') {
        const firstEscalationAt = minutesFromNow(URGENT_PRIORITY_ESCALATION_MINUTES);
        if (!opsFields.escalate_after) {
            opsFields.escalate_after = oldTask.escalate_after || firstEscalationAt;
        }
        if (!osFields.next_notification_at) {
            osFields.next_notification_at = oldTask.next_notification_at || opsFields.escalate_after || firstEscalationAt;
        }
        controlMeta.urgentPriority = {
            ...(controlMeta.urgentPriority || {}),
            enabled: true,
            escalation: 'no_movement',
            commitment: 'time_required',
            escalationMinutes: URGENT_PRIORITY_ESCALATION_MINUTES,
            cooldownMinutes: URGENT_PRIORITY_NOTIFICATION_COOLDOWN_MINUTES
        };
        return;
    }
    if (wasUrgent) {
        opsFields.escalate_after = null;
        osFields.next_notification_at = null;
        if (controlMeta.urgentPriority) {
            controlMeta.urgentPriority = {
                ...controlMeta.urgentPriority,
                enabled: false,
                disabledAt: new Date().toISOString()
            };
        }
    }
}

function urgentPriorityControlMeta(base = {}, patch = {}) {
    const meta = { ...parseJsonObject(base) };
    meta.urgentPriority = {
        ...(parseJsonObject(meta.urgentPriority) || {}),
        ...patch
    };
    return meta;
}

function urgentPriorityActivatedMeta(base = {}, patch = {}) {
    return urgentPriorityControlMeta(base, {
        enabled: true,
        activatedAt: base?.urgentPriority?.activatedAt || new Date().toISOString(),
        escalation: 'no_movement',
        commitment: 'time_required',
        escalationMinutes: URGENT_PRIORITY_ESCALATION_MINUTES,
        cooldownMinutes: URGENT_PRIORITY_NOTIFICATION_COOLDOWN_MINUTES,
        ...patch
    });
}

function urgentPriorityDisabledMeta(base = {}, patch = {}) {
    return urgentPriorityControlMeta(base, {
        ...(base?.urgentPriority || {}),
        enabled: false,
        disabledAt: new Date().toISOString(),
        ...patch
    });
}

function normalizeRequiredFutureDateTime(value) {
    const normalized = normalizeOptionalDateTime(value);
    if (!normalized) return null;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    if (parsed.getTime() <= Date.now()) return null;
    return parsed.toISOString();
}

function taskSnoozedUntilDate(task = {}) {
    const raw = task.snoozedUntil || task.snoozed_until || '';
    const parsed = raw ? new Date(raw) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function isTaskDeferred(task = {}, now = new Date()) {
    const snoozedUntil = taskSnoozedUntilDate(task);
    return Boolean(snoozedUntil && snoozedUntil > now);
}

async function markUrgentTaskMovement(taskId, task = {}, actor = {}, movementType = 'task_movement', options = {}) {
    if (normalizeTaskPriority(task.priority) !== 'urgent') return null;
    const now = new Date().toISOString();
    const nextNotificationAt = options.nextNotificationAt || minutesFromNow(URGENT_PRIORITY_NOTIFICATION_COOLDOWN_MINUTES);
    const controlMeta = urgentPriorityActivatedMeta(taskControlMeta(task), {
        lastMovementAt: now,
        lastMovementType: movementType,
        lastMovementBy: normalizeUserId(actor) || null
    });
    const result = await pool.query(
        `UPDATE tasks
         SET next_notification_at = $2,
             control_meta = $3::jsonb,
             updated_at = NOW(),
             version = COALESCE(version, 1) + 1
         WHERE id = $1
         RETURNING *`,
        [taskId, nextNotificationAt, JSON.stringify(controlMeta)]
    );
    return result.rows[0] || null;
}

async function resolveTypedTaskOwner(input = {}, actor = null) {
    const ownerUserId = input.owner_user_id ?? input.ownerUserId;
    const assigned = input.assigned_to ?? input.assignedTo;
    const candidate = ownerUserId ?? (/^\d+$/.test(String(assigned || '')) ? assigned : null);
    if (!candidate) return null;
    const owner = await getAssignableTaskOwner(candidate, { actor });
    return {
        ownerUserId: owner.id,
        assignedToSnapshot: owner.label,
        owner
    };
}

const normalizeTaskPayload = normalizeTaskContractPayload;
function serializeTaskPreferences(preferences = {}) {
    return {
        ...preferences,
        ...taskSavedViewsFromPreferences(preferences)
    };
}

function sourceSurface(body = {}, fallback = 'task_detail') {
    const raw = String(body.sourceSurface || body.source_surface || fallback).trim();
    if ([
        'manager_queue_task_execution_v2',
        'task_detail',
        'task_page',
        'task_page_overdue_badge',
        'profile_my_cabinet',
        'profile_my_cabinet_overdue_badge',
        'profile_my_cabinet_overdue_to_today_button',
        'profile_my_cabinet_overdue_to_today_drop',
        'profile_my_cabinet_move_to_today_button',
        'profile_my_cabinet_move_to_today_drop',
        'alerts_panel'
    ].includes(raw)) return raw;
    return fallback;
}

function sendTaskActionError(res, err) {
    const status = err.statusCode || 500;
    if (status >= 500) log.error('Task action error', err);
    return res.status(status).json({
        success: false,
        error: err.message || 'Task action failed',
        code: err.code || 'TASK_ACTION_FAILED',
        requiresReport: err.requiresReport === true,
        task: err.task || null,
        meta: err.requiresReport ? { reportRequired: true } : err.meta
    });
}

function requireTaskReadScope(req, res) {
    return ensureTaskBusinessScope(req, res);
}

function requireTaskWriteScope(req, res) {
    return ensureWritableTaskBusinessScope(req, res);
}

// GET /api/tasks — list with optional filters + pagination (v19.10)
router.get('/', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const {
            status, date, assigned_to, owner, owner_user_id, afisha_id, type, task_type, category, subcategory,
            task_mode, taskMode, task_kind, taskKind, visibility: visibilityFilter, workflow_state, workflowState,
            date_from, date_to, page, limit: lim, mine, private: privateOnly, focus,
            related_entity_type, relatedEntityType, related_entity_id, relatedEntityId, source_module, sourceModule,
            source_entity_type, sourceEntityType, source_entity_id, sourceEntityId, pack_id, packId, pack_status, packStatus,
            view, include_duplicates, includeDuplicates, pagination, paginated, priority, source, search, q
        } = req.query;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (status) {
            const statuses = String(status).split(',').map(s => s.trim()).filter(s => FILTERABLE_STATUSES.includes(s));
            if (statuses.length === 1) {
                conditions.push(`t.status = $${idx++}`);
                params.push(statuses[0]);
            } else if (statuses.length > 1) {
                conditions.push(`t.status = ANY($${idx++}::text[])`);
                params.push(statuses);
            }
        }
        if (priority) {
            const priorities = String(priority).split(',').map(value => value.trim()).filter(value => VALID_PRIORITIES.includes(value));
            if (priorities.length === 1) {
                conditions.push(`t.priority = $${idx++}`);
                params.push(priorities[0]);
            } else if (priorities.length > 1) {
                conditions.push(`t.priority = ANY($${idx++}::text[])`);
                params.push(priorities);
            }
        }        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            conditions.push(`t.date = $${idx++}`);
            params.push(date);
        }
        if (date_from && /^\d{4}-\d{2}-\d{2}$/.test(date_from)) {
            conditions.push(`t.date >= $${idx++}`);
            params.push(date_from);
        }
        if (date_to && /^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
            conditions.push(`t.date <= $${idx++}`);
            params.push(date_to);
        }
        if (assigned_to) {
            if (/^\d+$/.test(String(assigned_to))) {
                conditions.push(`t.owner_user_id = $${idx++}`);
                params.push(parseInt(assigned_to, 10));
            } else if (assigned_to === 'me') {
                conditions.push(buildTaskOwnerMatch(req.user, params, 't'));
                idx = params.length + 1;
            } else {
                conditions.push(`(t.owner_user_id IS NULL AND t.assigned_to = $${idx++})`);
                params.push(assigned_to);
            }
        }
        if (owner) {
            conditions.push(`(t.owner_user_id IS NULL AND t.owner = $${idx++})`);
            params.push(owner);
        }
        if (owner_user_id && /^\d+$/.test(String(owner_user_id))) {
            conditions.push(`t.owner_user_id = $${idx++}`);
            params.push(parseInt(owner_user_id, 10));
        }
        if (afisha_id && /^\d+$/.test(afisha_id)) {
            conditions.push(`afisha_id = $${idx++}`);
            params.push(parseInt(afisha_id));
        }
        if (type && ['recurring', 'afisha', 'manual', 'template', 'auto_complete', 'auto'].includes(type)) {
            conditions.push(`type = $${idx++}`);
            params.push(type);
        }
        if (task_type && VALID_TASK_TYPES.includes(task_type)) {
            conditions.push(`t.task_type = $${idx++}`);
            params.push(task_type);
        }
        if (category && VALID_CATEGORIES.includes(category)) {
            conditions.push(`t.category = $${idx++}`);
            params.push(category);
        }
        if (subcategory && VALID_TASK_SUBCATEGORIES.includes(subcategory)) {
            if (category === 'orders' && subcategory === 'confectionery') {
                conditions.push(`t.subcategory = ANY($${idx++}::text[])`);
                params.push(['confectionery', 'cakes', 'cake_decor']);
            } else {
                conditions.push(`t.subcategory = $${idx++}`);
                params.push(subcategory);
            }
        }
        const modeFilter = task_mode || taskMode;
        if (modeFilter && VALID_TASK_MODES.includes(modeFilter)) {
            conditions.push(`COALESCE(t.task_mode, 'work') = $${idx++}`);
            params.push(modeFilter);
        }
        const kindFilter = task_kind || taskKind;
        if (kindFilter && VALID_TASK_KINDS.includes(kindFilter)) {
            conditions.push(`COALESCE(t.task_kind, 'action') = $${idx++}`);
            params.push(kindFilter);
        }
        if (visibilityFilter && VALID_TASK_VISIBILITIES.includes(visibilityFilter)) {
            conditions.push(`COALESCE(t.visibility, 'team') = $${idx++}`);
            params.push(visibilityFilter);
        }
        const workflowFilter = workflow_state || workflowState;
        if (workflowFilter && VALID_WORKFLOW_STATES.includes(workflowFilter)) {
            conditions.push(`COALESCE(t.workflow_state, 'todo') = $${idx++}`);
            params.push(workflowFilter);
        }
        if (isTruthy(mine)) {
            conditions.push(buildTaskOwnerMatch(req.user, params, 't'));
            idx = params.length + 1;
        }
        if (isTruthy(privateOnly)) {
            conditions.push(`COALESCE(t.visibility, 'team') = 'private'`);
        }
        if (isTruthy(focus)) {
            conditions.push(`COALESCE(t.focus_rank, 0) > 0`);
        }
        const relType = related_entity_type || relatedEntityType;
        const relId = related_entity_id || relatedEntityId;
        const srcModule = source_module || sourceModule;
        if (relType) {
            conditions.push(`t.related_entity_type = $${idx++}`);
            params.push(String(relType).slice(0, 80));
        }
        if (relId) {
            conditions.push(`t.related_entity_id = $${idx++}`);
            params.push(String(relId).slice(0, 120));
        }
        if (srcModule) {
            conditions.push(`t.source_module = $${idx++}`);
            params.push(String(srcModule).slice(0, 80));
        }
        const sourceFilter = String(source || '').trim().toLowerCase().slice(0, 80);
        if (sourceFilter) {
            conditions.push(`(
                LOWER(COALESCE(t.source_module, '')) = $${idx}
                OR LOWER(COALESCE(t.source_entity_type, '')) = $${idx}
                OR LOWER(COALESCE(t.related_entity_type, '')) = $${idx}
            )`);
            params.push(sourceFilter);
            idx += 1;
        }
        const searchTerm = String(search || q || '').trim().slice(0, 120);
        if (searchTerm) {
            const like = `%${searchTerm.replace(/[\\%_]/g, '\\$&')}%`;
            const exactId = /^\d+$/.test(searchTerm) ? Number(searchTerm) : null;
            const searchParam = `$${idx++}`;
            params.push(like);
            const searchIdParam = exactId ? `$${idx++}` : null;
            if (exactId) params.push(exactId);
            conditions.push(`(
                t.title ILIKE ${searchParam} ESCAPE '\\'
                OR COALESCE(t.description, '') ILIKE ${searchParam} ESCAPE '\\'
                OR COALESCE(t.owner, '') ILIKE ${searchParam} ESCAPE '\\'
                OR COALESCE(t.assigned_to, '') ILIKE ${searchParam} ESCAPE '\\'
                OR COALESCE(t.source_module, '') ILIKE ${searchParam} ESCAPE '\\'
                OR COALESCE(t.source_entity_type, '') ILIKE ${searchParam} ESCAPE '\\'
                OR COALESCE(t.related_entity_type, '') ILIKE ${searchParam} ESCAPE '\\'
                OR EXISTS (
                    SELECT 1 FROM users search_owner
                    WHERE search_owner.id = t.owner_user_id
                      AND (COALESCE(search_owner.name, '') ILIKE ${searchParam} ESCAPE '\\'
                           OR COALESCE(search_owner.username, '') ILIKE ${searchParam} ESCAPE '\\')
                )
                ${searchIdParam ? `OR t.id = ${searchIdParam}` : ''}
            )`);
        }        const srcEntityType = source_entity_type || sourceEntityType;
        const srcEntityId = source_entity_id || sourceEntityId;
        const packIdFilter = pack_id || packId;
        const packStatusFilter = pack_status || packStatus;
        const normalizedSourceEntityType = normalizeSourceEntityType(srcEntityType);
        const normalizedSourceEntityId = normalizeSourceEntityId(srcEntityId);
        const normalizedPackId = normalizeUuid(packIdFilter);
        const normalizedPackStatus = normalizePackStatus(packStatusFilter, null);
        if (normalizedSourceEntityType) {
            conditions.push(`t.source_entity_type = $${idx++}`);
            params.push(normalizedSourceEntityType);
        }
        if (normalizedSourceEntityId) {
            conditions.push(`t.source_entity_id = $${idx++}`);
            params.push(normalizedSourceEntityId);
        }
        if (normalizedPackId) {
            conditions.push(`t.pack_id = $${idx++}`);
            params.push(normalizedPackId);
        }
        if (normalizedPackStatus) {
            conditions.push(`t.pack_status = $${idx++}`);
            params.push(normalizedPackStatus);
        }

        const includeDuplicateRows = isTruthy(include_duplicates || includeDuplicates);
        if (!includeDuplicateRows && view !== 'archive') {
            conditions.push(activeDuplicateCanonicalFilterSql('t'));
        }

        conditions.push(pushTaskBusinessScopeCondition(params, businessScope, 't'));
        idx = params.length + 1;

        // Role/object visibility: typed owner_user_id first, legacy string fallback for unmapped tasks.
        if (req.user) {
            const visibility = buildTaskVisibilityScope(req.user, params, 't');
            if (visibility) conditions.push(visibility.replace(/^AND\s+/i, ''));
            idx = params.length + 1;
        }

        // `pagination=1` is an opt-in response contract. Keep the historical array
        // response intact for integrations that call /api/tasks without it.
        const paginatedResponse = isTruthy(pagination || paginated);
        const taskView = String(view || '').trim();
        const activeTaskSql = `COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')`;
        const notDeferredSql = `(t.snoozed_until IS NULL OR t.snoozed_until <= NOW())`;
        const workloadDateSql = taskWorkloadDateSql('t');
        const weekStartSql = `date_trunc('week', CURRENT_DATE)::date`;

        // Apply the active view before LIMIT/OFFSET so populated views cannot be
        // hidden behind unrelated rows in the first legacy page.
        switch (taskView) {
            case 'inbox':
                conditions.push(activeTaskSql, notDeferredSql);
                conditions.push(`(COALESCE(t.workflow_state, 'todo') = 'inbox' OR (t.date IS NULL AND t.deadline IS NULL AND t.scheduled_start_at IS NULL))`);
                break;
            case 'today':
                conditions.push(activeTaskSql, notDeferredSql, `(${workloadDateSql} = CURRENT_DATE OR ${workloadDateSql} IS NULL)`);
                break;
            case 'next':
                conditions.push(activeTaskSql, notDeferredSql, `${workloadDateSql} > CURRENT_DATE`, `${workloadDateSql} <= (${weekStartSql} + 6)`);
                break;
            case 'deferred':
                conditions.push(activeTaskSql, `t.snoozed_until IS NOT NULL AND t.snoozed_until > NOW()`);
                break;
            case 'waiting':
                conditions.push(activeTaskSql, `(COALESCE(t.workflow_state, 'todo') = 'waiting' OR COALESCE(t.task_kind, 'action') = 'waiting')`);
                break;
            case 'team':
                conditions.push(activeTaskSql, `COALESCE(t.visibility, 'team') = 'team'`, `COALESCE(t.task_mode, 'work') = 'work'`);
                break;
            case 'week':
                conditions.push(activeTaskSql, notDeferredSql, `${workloadDateSql} >= ${weekStartSql}`, `${workloadDateSql} <= (${weekStartSql} + 6)`);
                break;
            case 'my': {
                const viewerId = normalizeUserId(req.user) || 0;
                conditions.push(activeTaskSql, `(t.owner_user_id = $${idx++} OR t.created_by_user_id = $${idx++})`);
                params.push(viewerId, viewerId);
                break;
            }
            case 'board':
                conditions.push(`COALESCE(t.status, 'todo') NOT IN ('archived','cancelled')`);
                break;
            case 'routines':
                conditions.push(activeTaskSql, `(COALESCE(t.task_kind, 'action') = 'routine' OR t.type = 'recurring')`);
                break;
            case 'done_today':
                conditions.push(`COALESCE(t.status, 'todo') = 'done'`, `DATE(t.completed_at AT TIME ZONE 'Europe/Kyiv') = CURRENT_DATE`);
                break;
            case 'archive':
                conditions.push(`t.status = 'archived'`);
                break;
            default:
                break;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Pagination (optional — backwards compatible: omit page/limit to get all)
        const limit = Math.max(1, Math.min(parseInt(lim, 10) || (paginatedResponse ? 100 : 500), 500));
        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const offset = (currentPage - 1) * limit;
        let total = null;
        if (paginatedResponse) {
            const countResult = await pool.query(
                `SELECT COUNT(*)::int AS total FROM tasks t ${where}`,
                params
            );
            total = Number(countResult.rows[0]?.total || 0);
        }
        const viewerUserIdParam = idx++;
        params.push(normalizeUserId(req.user) || 0);
        const orderViewParam = idx++;
        params.push(view || '');
        params.push(limit, offset);

        const result = await pool.query(
            `SELECT t.*, u.name AS owner_name, u.username AS owner_username,
                    COALESCE((SELECT COUNT(*) FROM task_observers tob WHERE tob.task_id = t.id), 0)::int AS observer_count,
                    EXISTS (
                        SELECT 1
                        FROM task_observers viewer_tob
                        WHERE viewer_tob.task_id = t.id
                          AND viewer_tob.user_id = $${viewerUserIdParam}
                    ) AS viewer_is_observer,
                    (
                        SELECT viewer_tob.access_level
                        FROM task_observers viewer_tob
                        WHERE viewer_tob.task_id = t.id
                          AND viewer_tob.user_id = $${viewerUserIdParam}
                        LIMIT 1
                    ) AS viewer_observer_access_level,
                    COALESCE(subtask_rows.subtasks, '[]'::json) AS subtasks,
                    COALESCE(st.total, 0)::int AS subtask_count,
                    COALESCE(st.done, 0)::int AS subtask_done_count,
                    COALESCE(dep.total, 0)::int AS dependency_count,
                    COALESCE(dep.open, 0)::int AS open_dependency_count,
                    dep.blocked_by_titles
             FROM tasks t
             LEFT JOIN users u ON u.id = t.owner_user_id
             LEFT JOIN (
                SELECT task_id,
                       COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE is_done = true)::int AS done
                FROM task_subtasks
                GROUP BY task_id
             ) st ON st.task_id = t.id
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
             LEFT JOIN (
                SELECT d.task_id,
                       COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE COALESCE(blocker.status, 'todo') NOT IN ('done','archived','cancelled'))::int AS open,
                       STRING_AGG(blocker.title, ', ' ORDER BY blocker.id)
                           FILTER (WHERE COALESCE(blocker.status, 'todo') NOT IN ('done','archived','cancelled')) AS blocked_by_titles
                FROM task_dependencies d
                JOIN tasks owner_task ON owner_task.id = d.task_id
                JOIN tasks blocker ON blocker.id = d.depends_on_task_id
                    AND COALESCE(blocker.business_context, 'event_genix') = COALESCE(owner_task.business_context, 'event_genix')
                GROUP BY d.task_id
             ) dep ON dep.task_id = t.id
             ${where}
             ORDER BY
                 CASE WHEN $${orderViewParam} = 'done_today' THEN COALESCE(t.completed_at, t.updated_at, t.created_at) END DESC NULLS LAST,
                 CASE WHEN COALESCE(st.total, 0) > 0 AND COALESCE(t.status, 'todo') NOT IN ('done','archived','cancelled') THEN 0 ELSE 1 END,
                 ${taskPriorityOrderSql('t')},
                 ${canonicalTaskOrderSql('t')},
                 CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 END,
                 t.created_at DESC
            LIMIT $${idx++} OFFSET $${idx++}`,
            params
        );
        const tasks = result.rows.map(normalizeTaskPayload);
        if (!paginatedResponse) return res.json(tasks);
        return res.json({
            success: true,
            tasks,
            pagination: buildTaskPaginationMetadata({ total, page: currentPage, limit, returned: tasks.length })
        });
    } catch (err) {
        log.error('Get error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/tasks/overview — full-scope, read-only exception projection.
// This deliberately does not use the list endpoint pagination: counts must describe
// every task the current user is allowed to see in the current business context.
router.get('/overview', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;

        const params = [];
        const conditions = [
            `COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')`,
            activeDuplicateCanonicalFilterSql('t'),
            pushTaskBusinessScopeCondition(params, businessScope, 't')
        ];
        const visibility = buildTaskVisibilityScope(req.user, params, 't');
        if (visibility) conditions.push(visibility.replace(/^AND\s+/i, ''));
        const where = `WHERE ${conditions.join(' AND ')}`;
        const result = await pool.query(
            `SELECT t.*, u.name AS owner_name, u.username AS owner_username,
                    COALESCE(dep.total, 0)::int AS dependency_count,
                    COALESCE(dep.open, 0)::int AS open_dependency_count,
                    dep.blocked_by_titles
             FROM tasks t
             LEFT JOIN users u ON u.id = t.owner_user_id
             LEFT JOIN (
                SELECT d.task_id,
                       COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE COALESCE(blocker.status, 'todo') NOT IN ('done','archived','cancelled'))::int AS open,
                       STRING_AGG(blocker.title, ', ' ORDER BY blocker.id)
                           FILTER (WHERE COALESCE(blocker.status, 'todo') NOT IN ('done','archived','cancelled')) AS blocked_by_titles
                FROM task_dependencies d
                JOIN tasks owner_task ON owner_task.id = d.task_id
                JOIN tasks blocker ON blocker.id = d.depends_on_task_id
                    AND COALESCE(blocker.business_context, 'event_genix') = COALESCE(owner_task.business_context, 'event_genix')
                GROUP BY d.task_id
             ) dep ON dep.task_id = t.id
             ${where}
             ORDER BY t.id ASC`,
            params
        );
        const tasks = result.rows.map(row => withTaskDrawerContract(normalizeTaskPayload(row, { user: req.user }), req.user));
        const overview = buildTaskOverview(tasks);
        res.json({
            success: true,
            ...overview,
            meta: {
                ...overview.meta,
                paginationIndependent: true,
                businessScope: taskBusinessScopeMeta(businessScope)
            }
        });
    } catch (err) {
        log.error('Task overview error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});
// GET /api/tasks/team-control — task-scoped workload and planning projection.
// HR schedule-derived capacity is included only for users who already hold
// hr.schedule.view; task visibility and business scope always apply first.
router.get('/team-control', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const capacityAvailable = canUseAction(req.user, 'hr.schedule.view');
        const range = normalizeTaskPlanningRange(req.query || {});
        const ownerUserId = /^\d+$/.test(String(req.query.ownerUserId || req.query.owner_user_id || ''))
            ? Number(req.query.ownerUserId || req.query.owner_user_id)
            : null;
        const status = String(req.query.status || '').trim();
        const department = String(req.query.department || '').trim();
        if (department && !capacityAvailable) {
            return res.status(403).json({ success: false, error: 'Capacity data is unavailable for the current access level' });
        }

        const params = [];
        const conditions = [
            `COALESCE(t.status, 'todo') NOT IN ('done','cancelled','archived')`,
            activeDuplicateCanonicalFilterSql('t'),
            pushTaskBusinessScopeCondition(params, businessScope, 't')
        ];
        if (ownerUserId) {
            params.push(ownerUserId);
            conditions.push(`t.owner_user_id = $${params.length}`);
        }
        if (FILTERABLE_STATUSES.includes(status) && status !== 'overdue') {
            params.push(status);
            conditions.push(`COALESCE(t.status, 'todo') = $${params.length}`);
        }
        const visibility = buildTaskVisibilityScope(req.user, params, 't');
        if (visibility) conditions.push(visibility.replace(/^AND\s+/i, ''));
        const staffJoin = capacityAvailable
            ? `LEFT JOIN LATERAL (
                    SELECT ep.staff_id
                    FROM employee_profiles ep
                    WHERE ep.user_id = t.owner_user_id AND ep.is_active = true
                    ORDER BY ep.id DESC
                    LIMIT 1
               ) owner_profile ON true
               LEFT JOIN staff owner_staff ON owner_staff.id = owner_profile.staff_id`
            : '';
        const departmentField = capacityAvailable ? ', owner_staff.department AS owner_department' : '';
        const where = `WHERE ${conditions.join(' AND ')}`;
        const result = await pool.query(
            `SELECT t.*, u.name AS owner_name, u.username AS owner_username
                    ${departmentField},
                    COALESCE(dep.total, 0)::int AS dependency_count,
                    COALESCE(dep.open, 0)::int AS open_dependency_count,
                    dep.blocked_by_titles
             FROM tasks t
             LEFT JOIN users u ON u.id = t.owner_user_id
             ${staffJoin}
             LEFT JOIN (
                SELECT d.task_id,
                       COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE COALESCE(blocker.status, 'todo') NOT IN ('done','archived','cancelled'))::int AS open,
                       STRING_AGG(blocker.title, ', ' ORDER BY blocker.id)
                           FILTER (WHERE COALESCE(blocker.status, 'todo') NOT IN ('done','archived','cancelled')) AS blocked_by_titles
                FROM task_dependencies d
                JOIN tasks owner_task ON owner_task.id = d.task_id
                JOIN tasks blocker ON blocker.id = d.depends_on_task_id
                    AND COALESCE(blocker.business_context, 'event_genix') = COALESCE(owner_task.business_context, 'event_genix')
                GROUP BY d.task_id
             ) dep ON dep.task_id = t.id
             ${where}
             ORDER BY t.id ASC`,
            params
        );
        let tasks = result.rows.map(row => withTaskDrawerContract(normalizeTaskPayload(row, { user: req.user }), req.user));
        if (department) tasks = tasks.filter(task => String(task.owner_department || '').trim() === department);
        const capacityRows = capacityAvailable ? await loadTaskOwnerCapacity(pool, tasks, range) : [];
        const projection = buildTaskTeamControlProjection(tasks, {
            ...range,
            capacityRows,
            capacityAvailable
        });
        res.json({
            success: true,
            ...projection,
            meta: {
                ...projection.meta,
                paginationIndependent: true,
                businessScope: taskBusinessScopeMeta(businessScope),
                filters: { ownerUserId, department: department || null, status: status || null }
            }
        });
    } catch (err) {
        log.error('Task team control error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});
// v20.9.16: GET /api/tasks/permissions — current user's task permissions
router.get('/permissions', (req, res) => {
    const perms = getPermissions(req.user?.role);
    const capabilities = Object.fromEntries(
        ['create', 'delete', 'review'].map(capability => [capability, taskRouteCapabilityDecision(req.user, capability)])
    );
    res.json({ success: true, permissions: perms, capabilities, role: req.user?.role });
});

// GET /api/tasks/owners — active assignable users for typed task ownership
router.get('/owners', async (req, res) => {
    try {
        const perms = getPermissions(req.user?.role);
        if (!perms.canCreateTasks && !perms.canAssignAnyone && !['all', 'department'].includes(perms.taskVisibility)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        const users = await listTaskOwnerCandidates({ actor: req.user });
        res.json({
            success: true,
            users,
            meta: {
                canonicalField: 'tasks.owner_user_id',
                legacyDisplayFields: ['assigned_to', 'owner']
            }
        });
    } catch (err) {
        log.error('Task owners lookup error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/tasks/dedup-report — active duplicate groups without mutating data
router.get('/dedup-report', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const params = [];
        const businessCondition = pushTaskBusinessScopeCondition(params, businessScope, 't');
        const signature = duplicateSignatureSql('t');
        const result = await pool.query(
            `WITH active AS (
                SELECT t.*, ${signature} AS duplicate_signature
                FROM tasks t
                WHERE COALESCE(t.status, 'todo') NOT IN ('done','archived','cancelled')
                  AND COALESCE(trim(t.title), '') <> ''
                  AND ${businessCondition}
             ),
             ranked AS (
                SELECT *,
                       MIN(id) OVER (PARTITION BY duplicate_signature) AS canonical_id,
                       ROW_NUMBER() OVER (PARTITION BY duplicate_signature ORDER BY id ASC) AS rn,
                       COUNT(*) OVER (PARTITION BY duplicate_signature) AS group_count
                FROM active
             )
             SELECT duplicate_signature,
                    MIN(canonical_id) AS canonical_id,
                    COUNT(*)::int AS total,
                    (COUNT(*) - 1)::int AS duplicate_count,
                    MIN(title) AS title,
                    json_agg(json_build_object(
                        'id', id,
                        'title', title,
                        'status', status,
                        'date', date,
                        'ownerUserId', owner_user_id,
                        'sourceType', source_type,
                        'sourceId', source_id,
                        'createdAt', created_at
                    ) ORDER BY id ASC) AS tasks
             FROM ranked
             WHERE group_count > 1
             GROUP BY duplicate_signature
             ORDER BY duplicate_count DESC, canonical_id ASC
             LIMIT 100`,
            params
        );
        res.json({
            success: true,
            groups: result.rows,
            meta: {
                policy: 'active signature: title + day + category + subcategory + owner + checklist + stable source anchor',
                cleanup: 'archives duplicates, no DELETE',
                businessScope: taskBusinessScopeMeta(businessScope)
            }
        });
    } catch (err) {
        log.error('Dedup report error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/tasks/dedup-cleanup — archive duplicate active records without deleting history
router.post('/dedup-cleanup', requireRole('admin'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const dryRun = isTruthy(req.body?.dryRun);
        const signature = duplicateSignatureSql('t');
        if (dryRun) {
            const params = [];
            const businessCondition = pushTaskBusinessScopeCondition(params, businessScope, 't');
            const report = await pool.query(
                `WITH active AS (
                    SELECT t.*, ${signature} AS duplicate_signature
                    FROM tasks t
                    WHERE COALESCE(t.status, 'todo') NOT IN ('done','archived','cancelled')
                      AND COALESCE(trim(t.title), '') <> ''
                      AND ${businessCondition}
                 ),
                 ranked AS (
                    SELECT *,
                           MIN(id) OVER (PARTITION BY duplicate_signature) AS canonical_id,
                           COUNT(*) OVER (PARTITION BY duplicate_signature) AS group_count
                    FROM active
                 )
                 SELECT COUNT(*)::int AS victims
                 FROM ranked
                 WHERE group_count > 1 AND id <> canonical_id`,
                params
            );
            return res.json({ success: true, dryRun: true, victims: report.rows[0]?.victims || 0 });
        }

        const params = [];
        const businessCondition = pushTaskBusinessScopeCondition(params, businessScope, 't');
        const cleanup = await pool.query(
            `WITH active AS (
                SELECT t.*, ${signature} AS duplicate_signature
                FROM tasks t
                WHERE COALESCE(t.status, 'todo') NOT IN ('done','archived','cancelled')
                  AND COALESCE(trim(t.title), '') <> ''
                  AND ${businessCondition}
             ),
             ranked AS (
                SELECT id,
                       MIN(id) OVER (PARTITION BY duplicate_signature) AS canonical_id,
                       ROW_NUMBER() OVER (PARTITION BY duplicate_signature ORDER BY id ASC) AS rn,
                       COUNT(*) OVER (PARTITION BY duplicate_signature) AS group_count
                FROM active
             ),
             victims AS (
                SELECT id, canonical_id
                FROM ranked
                WHERE group_count > 1 AND rn > 1
             )
             UPDATE tasks t
             SET status = 'archived',
                 workflow_state = 'archived',
                 archived_at = COALESCE(t.archived_at, NOW()),
                 archive_reason = 'auto_duplicate',
                 duplicate_of_task_id = victims.canonical_id,
                 updated_at = NOW()
             FROM victims
             WHERE t.id = victims.id
             RETURNING t.id, t.title, t.duplicate_of_task_id`,
            params
        );
        log.info(`Dedup cleanup archived ${cleanup.rowCount} duplicate active tasks`);
        res.json({
            success: true,
            archived: cleanup.rowCount,
            tasks: cleanup.rows
        });
        _alertPush();
    } catch (err) {
        log.error('Dedup cleanup error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/tasks/preferences — personal task OS preferences
router.get('/preferences', async (req, res) => {
    try {
        const userId = normalizeUserId(req.user);
        if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
        const prefs = await ensureTaskPreferences(pool, userId);
        res.json({ success: true, preferences: serializeTaskPreferences(prefs) });
    } catch (err) {
        log.error('Task preferences lookup error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/tasks/preferences — update personal task OS preferences
router.patch('/preferences', async (req, res) => {
    try {
        const userId = normalizeUserId(req.user);
        if (!userId) return res.status(401).json({ error: 'Unauthenticated' });
        await ensureTaskPreferences(pool, userId);

        const allowed = {
            focus_limit: value => Math.max(1, Math.min(9, parseInt(value, 10) || 3)),
            digest_mode: value => ['off', 'important_only', 'daily', 'all'].includes(value) ? value : 'important_only',
            default_task_mode: value => VALID_TASK_MODES.includes(value) ? value : 'personal',
            default_privacy: value => VALID_TASK_VISIBILITIES.includes(value) ? value : 'me_only',
            show_private_in_tasks_page: value => isTruthy(value),
            enable_telegram_reminders: value => isTruthy(value),
            enable_evening_review: value => isTruthy(value),
            task_sound_enabled: value => isTruthy(value),
            task_sound_volume: value => Math.max(0, Math.min(1, Number(value) || 0)),
            task_sound_theme: value => TASK_SOUND_THEMES.includes(String(value || '').trim()) ? String(value).trim() : 'subtle'
        };
        const savedViewsPatch = savedViewsPatchFromBody(req.body || {});
        const sets = [];
        const values = [];
        Object.entries(allowed).forEach(([field, normalize]) => {
            const camel = field.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
            const raw = req.body[field] !== undefined ? req.body[field] : req.body[camel];
            if (raw !== undefined) {
                values.push(normalize(raw));
                sets.push(`${field} = $${values.length}`);
            }
        });
        let savedViewsRevisionCondition = '';
        if (savedViewsPatch) {
            values.push(JSON.stringify(savedViewsPatch.views));
            sets.push(`saved_task_views = $${values.length}::jsonb`);
            sets.push('saved_task_views_revision = COALESCE(saved_task_views_revision, 0) + 1');
            values.push(savedViewsPatch.revision);
            savedViewsRevisionCondition = ` AND COALESCE(saved_task_views_revision, 0) = $${values.length}`;
        }        if (!sets.length) {
            const prefs = await ensureTaskPreferences(pool, userId);
            return res.json({ success: true, preferences: serializeTaskPreferences(prefs) });
        }
        values.push(userId);
        const result = await pool.query(
            `UPDATE task_user_preferences
             SET ${sets.join(', ')}, updated_at = NOW()
             WHERE user_id = $${values.length}${savedViewsRevisionCondition}
             RETURNING *`,
            values
        );
        if (!result.rows.length && savedViewsPatch) {
            const current = await pool.query(
                `SELECT saved_task_views, saved_task_views_revision
                 FROM task_user_preferences
                 WHERE user_id = $1`,
                [userId]
            );
            return res.status(409).json({
                success: false,
                code: 'TASK_SAVED_VIEWS_CONFLICT',
                error: 'Saved views were changed in another session. Reload and retry.',
                preferences: serializeTaskPreferences(current.rows[0] || {})
            });
        }
        res.json({ success: true, preferences: serializeTaskPreferences(result.rows[0] || {}) });
    } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code || 'TASK_SAVED_VIEWS_INVALID' });
        log.error('Task preferences update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/tasks/decomposition-templates - template families for draft subtasks.
router.get('/decomposition-templates', requireRole('admin', 'user'), async (req, res) => {
    res.json({
        success: true,
        templates: getTaskDecompositionTemplates(),
        modes: ['none', 'manual', 'template', 'ai', 'template_ai']
    });
});

// POST /api/tasks/decompose-draft - draft-only AI/template subtask suggestions.
router.post('/decompose-draft', requireRole('admin', 'user'), async (req, res) => {
    try {
        const b = req.body || {};
        const result = await generateTaskDecompositionDraft({
            title: b.title,
            description: b.description,
            category: b.category,
            subcategory: b.subcategory,
            taskKind: b.taskKind || b.task_kind,
            taskMode: b.taskMode || b.task_mode,
            taskType: b.taskType || b.task_type,
            sourceType: b.sourceType || b.source_type,
            sourceModule: b.sourceModule || b.source_module,
            mode: b.mode || b.decompositionMode || b.decomposition_mode,
            templateKey: b.templateKey || b.template_key
        });
        if (!result.success) {
            return res.status(result.status || 400).json(result);
        }
        res.json(result);
    } catch (err) {
        log.error('Task decomposition draft error', err);
        res.status(500).json({
            success: false,
            code: 'TASK_DECOMPOSITION_DRAFT_FAILED',
            error: 'Не вдалося підготувати чернетку підзадач. Нічого не збережено.'
        });
    }
});

// GET /api/tasks/decomposition-saved-templates - personal reusable decomposition templates.
router.get('/decomposition-saved-templates', requireRole('admin', 'user'), async (req, res) => {
    try {
        const templates = await listSavedDecompositionTemplates(pool, req.user, {
            category: req.query.category,
            limit: req.query.limit
        });
        res.json({ success: true, templates });
    } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
        log.error('List saved decomposition templates error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/tasks/decomposition-saved-templates - save the current editable subtask draft as a personal template.
router.post('/decomposition-saved-templates', requireRole('admin', 'user'), async (req, res) => {
    try {
        const template = await createSavedDecompositionTemplate(pool, req.user, req.body || {});
        res.json({ success: true, template });
    } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
        log.error('Create saved decomposition template error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PUT /api/tasks/decomposition-saved-templates/:templateId - edit a personal saved decomposition template.
router.put('/decomposition-saved-templates/:templateId', requireRole('admin', 'user'), async (req, res) => {
    try {
        const template = await updateSavedDecompositionTemplate(pool, req.user, req.params.templateId, req.body || {});
        res.json({ success: true, template });
    } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
        log.error('Update saved decomposition template error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// DELETE /api/tasks/decomposition-saved-templates/:templateId - soft-delete a personal saved template.
router.delete('/decomposition-saved-templates/:templateId', requireRole('admin', 'user'), async (req, res) => {
    try {
        await deleteSavedDecompositionTemplate(pool, req.user, req.params.templateId);
        res.json({ success: true });
    } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
        log.error('Delete saved decomposition template error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/tasks/decomposition-saved-templates/:templateId/apply - apply a saved template into editable draft rows.
router.post('/decomposition-saved-templates/:templateId/apply', requireRole('admin', 'user'), async (req, res) => {
    try {
        const template = await applySavedDecompositionTemplate(pool, req.user, req.params.templateId);
        res.json({
            success: true,
            source: 'saved_template',
            template,
            subtasks: template.subtasks,
            meta: { humanReviewRequired: true, persisted: false }
        });
    } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
        log.error('Apply saved decomposition template error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/tasks/decomposition-suggestions - restrained template/history suggestions for the current user.
router.post('/decomposition-suggestions', requireRole('admin', 'user'), async (req, res) => {
    try {
        const suggestions = await getDecompositionSuggestions(pool, req.user, req.body || {});
        res.json({ success: true, ...suggestions });
    } catch (err) {
        if (err.statusCode) return res.status(err.statusCode).json({ success: false, error: err.message });
        log.error('Task decomposition suggestions error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/tasks/my-cabinet — personal task projection for Profile/My Cabinet
router.get('/my-cabinet', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const projection = await buildTaskCabinetProjection({
            pool,
            user: req.user,
            businessScope,
            focusDate: normalizeTaskCabinetFocusDate(req.query.focusDate || req.query.focus_date)
        });
        res.json(projection);
    } catch (err) {
        log.error('My cabinet task projection error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    }
});

// GET /api/tasks/productivity — personal task productivity cockpit data
router.get('/productivity', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const productivity = await getTaskProductivity(pool, req.user, { businessScope });
        res.json({
            success: true,
            ...productivity
        });
    } catch (err) {
        if (err.statusCode === 401) return res.status(401).json({ error: 'Unauthenticated' });
        log.error('Task productivity error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/schedule-policy', async (req, res) => {
    res.json({ success: true, policy: getSchedulePolicy() });
});

router.get('/schedule/availability', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const availability = await getAvailability({
            ownerUserId: req.query.ownerUserId || req.query.owner_user_id,
            date: req.query.date || req.query.scheduledDate || req.query.scheduled_date,
            slot: req.query.slot || req.query.scheduleSlot || req.query.schedule_slot,
            durationMinutes: req.query.durationMinutes || req.query.duration_minutes,
            excludeTaskId: req.query.excludeTaskId || req.query.exclude_task_id
        }, { businessScope });
        res.json({ success: true, availability });
    } catch (err) {
        sendTaskActionError(res, err);
    }
});

router.get('/:id', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const { id } = req.params;
        if (id === 'logs') return res.status(400).json({ error: 'Use /api/tasks/:id/logs' });
        const params = [id];
        const visibility = buildTaskVisibilityScope(req.user, params, 't');
        const businessCondition = appendTaskBusinessScopeSql(params, businessScope, 't');
        const viewerUserIdParam = params.length + 1;
        params.push(normalizeUserId(req.user) || 0);
        const result = await pool.query(
            `SELECT t.*, u.name AS owner_name, u.username AS owner_username,
                    COALESCE((SELECT COUNT(*) FROM task_observers tob WHERE tob.task_id = t.id), 0)::int AS observer_count,
                    EXISTS (
                        SELECT 1
                        FROM task_observers viewer_tob
                        WHERE viewer_tob.task_id = t.id
                          AND viewer_tob.user_id = $${viewerUserIdParam}
                    ) AS viewer_is_observer,
                    (
                        SELECT viewer_tob.access_level
                        FROM task_observers viewer_tob
                        WHERE viewer_tob.task_id = t.id
                          AND viewer_tob.user_id = $${viewerUserIdParam}
                        LIMIT 1
                    ) AS viewer_observer_access_level,
                    COALESCE(observer_rows.observers, '[]'::json) AS observers,
                    COALESCE(subtask_rows.subtasks, '[]'::json) AS subtasks,
                    COALESCE(st.total, 0)::int AS subtask_count,
                    COALESCE(st.done, 0)::int AS subtask_done_count,
                    COALESCE(dep.total, 0)::int AS dependency_count,
                    COALESCE(dep.open, 0)::int AS open_dependency_count,
                    dep.blocked_by_titles,
                    COALESCE(dep.dependencies, '[]'::json) AS dependencies
             FROM tasks t
             LEFT JOIN users u ON u.id = t.owner_user_id
             LEFT JOIN (
                SELECT task_id,
                       COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE is_done = true)::int AS done
                FROM task_subtasks
                GROUP BY task_id
             ) st ON st.task_id = t.id
             LEFT JOIN (
                SELECT d.task_id,
                       COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE COALESCE(blocker.status, 'todo') NOT IN ('done','archived','cancelled'))::int AS open,
                       STRING_AGG(blocker.title, ', ' ORDER BY blocker.id)
                           FILTER (WHERE COALESCE(blocker.status, 'todo') NOT IN ('done','archived','cancelled')) AS blocked_by_titles,
                       JSON_AGG(JSON_BUILD_OBJECT(
                           'id', blocker.id,
                           'title', blocker.title,
                           'status', blocker.status,
                           'ownerUserId', blocker.owner_user_id,
                           'date', blocker.date,
                           'deadline', blocker.deadline
                       ) ORDER BY blocker.id) AS dependencies
                FROM task_dependencies d
                JOIN tasks owner_task ON owner_task.id = d.task_id
                JOIN tasks blocker ON blocker.id = d.depends_on_task_id
                    AND COALESCE(blocker.business_context, 'event_genix') = COALESCE(owner_task.business_context, 'event_genix')
                GROUP BY d.task_id
             ) dep ON dep.task_id = t.id
             LEFT JOIN (
                SELECT tob.task_id,
                       json_agg(json_build_object(
                           'userId', tob.user_id,
                           'username', ou.username,
                           'name', ou.name,
                           'role', ou.role,
                           'accessLevel', tob.access_level,
                           'createdAt', tob.created_at
                       ) ORDER BY COALESCE(NULLIF(ou.name, ''), ou.username), ou.id) AS observers
                FROM task_observers tob
                JOIN users ou ON ou.id = tob.user_id
                GROUP BY tob.task_id
             ) observer_rows ON observer_rows.task_id = t.id
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
             WHERE t.id = $1 ${visibility} ${businessCondition}
             LIMIT 1`,
            params
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        res.json(withTaskDrawerContract(normalizeTaskPayload(result.rows[0]), req.user));
    } catch (err) {
        log.error('Get by id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/tasks/:id/history — durable task execution action history
router.get('/:id/history', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const visibleParams = [req.params.id];
        const visibility = buildTaskVisibilityScope(req.user, visibleParams, 't');
        const businessCondition = appendTaskBusinessScopeSql(visibleParams, businessScope, 't');
        const visible = await pool.query(`SELECT t.id FROM tasks t WHERE t.id = $1 ${visibility} ${businessCondition} LIMIT 1`, visibleParams);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });
        const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 10, 50));
        const history = await listTaskActionHistory(req.params.id, { limit });
        res.json({
            success: true,
            history,
            meta: {
                source: 'task_action_history',
                newestFirst: true,
                bounded: limit
            }
        });
    } catch (err) {
        log.error('Get task action history error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/tasks/:id/observers — people with read/materials access to this task.
router.get('/:id/observers', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const visibleParams = [req.params.id];
        const visibility = buildTaskVisibilityScope(req.user, visibleParams, 't');
        const businessCondition = appendTaskBusinessScopeSql(visibleParams, businessScope, 't');
        const visible = await pool.query(`SELECT t.id FROM tasks t WHERE t.id = $1 ${visibility} ${businessCondition} LIMIT 1`, visibleParams);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });
        const observers = await listTaskObservers(req.params.id);
        res.json({
            success: true,
            observers,
            meta: {
                policy: 'task_observers',
                access: 'read_task_detail_subtasks_history_materials',
                mutation: 'not_granted_by_observer'
            }
        });
    } catch (err) {
        log.error('Get task observers error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/tasks/:id/observers — replace observer list for a visible mutable task.
router.put('/:id/observers', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const task = await loadMutableTask(req.params.id, req.user, businessScope);
        const observers = await replaceTaskObservers(task, observerIdsFromBody(req.body || {}), req.user);
        res.json({
            success: true,
            observers,
            meta: {
                policy: 'task_observers',
                accessLevel: 'materials',
                materialsAccess: 'detail_subtasks_history_logs'
            }
        });
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

router.post('/:id/completion-report', async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const task = await loadMutableTask(req.params.id, req.user, businessScope);
        const reportText = String(req.body?.reportText || req.body?.report_text || req.body?.description || '').trim();
        if (!reportText) {
            return res.status(400).json({ success: false, error: 'Заповніть звіт перед виконанням задачі', code: 'TASK_REPORT_TEXT_REQUIRED' });
        }
        const reportType = ['income', 'expense'].includes(req.body?.type) ? req.body.type : 'expense';
        const amount = Number.parseFloat(req.body?.amount);
        const rawData = {
            taskCompletionReport: {
                taskId: task.id,
                taskTitle: task.title || null,
                required: true,
                sourceSurface: sourceSurface(req.body, 'task_detail'),
                submittedByUserId: normalizeUserId(req.user),
                submittedByUsername: req.user?.username || null,
                submittedAt: new Date().toISOString()
            },
            text: reportText
        };
        const result = await pool.query(
            `INSERT INTO reports (business_context, type, amount, description, category, submitted_by, submitted_by_id,
                submitted_via, raw_data, hashtags)
             VALUES ($1,$2,$3,$4,$5,$6,NULL,'web',$7,$8)
             RETURNING *`,
            [
                activeTaskBusinessContext(task.business_context),
                reportType,
                Number.isFinite(amount) ? amount : 0,
                `Звіт по задачі #${task.id}: ${task.title || 'Без назви'}\n\n${reportText}`,
                req.body?.category || 'Задача',
                req.user?.name || req.user?.displayName || req.user?.username || 'Unknown',
                JSON.stringify(rawData),
                JSON.stringify(['task-report', `task-${task.id}`])
            ]
        );
        const report = result.rows[0];
        const accountant = await pool.query('SELECT id FROM accountants WHERE is_on_duty = true ORDER BY id ASC LIMIT 1').catch(() => ({ rows: [] }));
        if (accountant.rows[0]?.id) {
            await pool.query('UPDATE reports SET assigned_to = $1, assigned_at = NOW(), updated_at = NOW() WHERE id = $2', [accountant.rows[0].id, report.id]);
        }
        const update = await pool.query(
            `UPDATE tasks
             SET control_meta = COALESCE(control_meta, '{}'::jsonb) || jsonb_build_object(
                    'reportRequired', true,
                    'reportId', $2::int,
                    'reportSubmittedAt', NOW(),
                    'reportSubmittedBy', $3::text
                 ),
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
             WHERE id = $1
             RETURNING *`,
            [task.id, report.id, req.user?.username || req.user?.name || 'system']
        );
        res.status(201).json({
            success: true,
            report: { id: report.id, category: report.category, amount: Number(report.amount || 0), createdAt: report.created_at || null },
            reportId: report.id,
            task: normalizeTaskPayload(update.rows[0] || task),
            meta: {
                durableReport: 'reports',
                linkField: 'tasks.control_meta.reportId'
            }
        });
        _alertPush();
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

async function loadMutableTask(id, user, businessScope = null) {
    const params = [id];
    const visibility = buildTaskVisibilityScope(user, params, 't');
    const businessCondition = businessScope ? appendTaskBusinessScopeSql(params, businessScope, 't') : '';
    const result = await pool.query(`SELECT t.* FROM tasks t WHERE t.id = $1 ${visibility} ${businessCondition} LIMIT 1`, params);
    if (!result.rows.length) {
        const err = new Error('Task not found');
        err.statusCode = 404;
        throw err;
    }
    const task = result.rows[0];
    if (!canMutateTask(user, task)) {
        const err = new Error('Недостатньо прав для зміни задачі');
        err.statusCode = 403;
        throw err;
    }
    return task;
}

// PATCH /api/tasks/:id/priority — quick priority change with urgent defaults.
router.patch('/:id/priority', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const task = await loadMutableTask(req.params.id, req.user, businessScope);
        const rawPriority = String(req.body.priority || '').trim().toLowerCase();
        if (!VALID_PRIORITIES.includes(rawPriority)) return res.status(400).json({ error: 'Invalid priority' });

        const oldPriority = normalizeTaskPriority(task.priority);
        const controlMeta = taskControlMeta(task);
        const changedAt = new Date().toISOString();
        let escalateAfter = task.escalate_after || null;
        let nextNotificationAt = task.next_notification_at || null;
        let nextControlMeta = controlMeta;

        if (rawPriority === 'urgent') {
            const firstEscalationAt = minutesFromNow(URGENT_PRIORITY_ESCALATION_MINUTES);
            escalateAfter = escalateAfter || firstEscalationAt;
            nextNotificationAt = nextNotificationAt || escalateAfter || firstEscalationAt;
            nextControlMeta = urgentPriorityActivatedMeta(controlMeta, {
                lastMovementAt: changedAt,
                lastMovementType: 'priority_changed',
                lastPriorityChangedAt: changedAt,
                lastPriorityChangedBy: normalizeUserId(req.user) || null
            });
        } else if (oldPriority === 'urgent') {
            escalateAfter = null;
            nextNotificationAt = null;
            nextControlMeta = urgentPriorityDisabledMeta(controlMeta, {
                lastPriorityChangedAt: changedAt,
                lastPriorityChangedBy: normalizeUserId(req.user) || null
            });
        }

        const result = await pool.query(
            `UPDATE tasks
             SET priority = $1,
                 escalate_after = $2,
                 next_notification_at = $3,
                 control_meta = $4::jsonb,
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
             WHERE id = $5
             RETURNING *`,
            [rawPriority, escalateAfter, nextNotificationAt, JSON.stringify(nextControlMeta), req.params.id]
        );
        const updated = result.rows[0];
        const historyEvent = await logTaskActionEvent({
            taskId: task.id,
            actionType: TASK_ACTION_TYPES.PRIORITY_CHANGED,
            actor: req.user,
            sourceSurface: sourceSurface(req.body, 'task_page'),
            oldValue: { priority: oldPriority },
            newValue: { priority: rawPriority, escalateAfter, nextNotificationAt },
            meta: {
                urgentMovementActionTypes: URGENT_TASK_MOVEMENT_ACTION_TYPES
            }
        });
        _alertPush();
        res.json({ success: true, task: normalizeTaskPayload(updated), historyEvent });
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

// PATCH /api/tasks/:id/commitment — save when an urgent task will move next.
router.patch('/:id/commitment', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const task = await loadMutableTask(req.params.id, req.user, businessScope);
        if (normalizeTaskPriority(task.priority) !== 'urgent') {
            return res.status(400).json({ error: 'Commitment is available only for urgent tasks' });
        }
        const commitmentAt = normalizeRequiredFutureDateTime(
            req.body.commitmentAt || req.body.commitment_at || req.body.snoozedUntil || req.body.snoozed_until
        );
        if (!commitmentAt) return res.status(400).json({ error: 'Valid commitmentAt is required' });

        const now = new Date().toISOString();
        const controlMeta = urgentPriorityActivatedMeta(taskControlMeta(task), {
            commitmentAt,
            committedAt: now,
            committedBy: normalizeUserId(req.user) || null,
            lastMovementAt: now,
            lastMovementType: 'urgent_commitment'
        });
        const result = await pool.query(
            `UPDATE tasks
             SET snoozed_until = $2,
                 next_notification_at = $2,
                 control_meta = $3::jsonb,
                 workflow_state = CASE
                    WHEN COALESCE(workflow_state, 'todo') IN ('done','archived','waiting') THEN workflow_state
                    ELSE 'scheduled'
                 END,
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
             WHERE id = $1
             RETURNING *`,
            [req.params.id, commitmentAt, JSON.stringify(controlMeta)]
        );
        const updated = result.rows[0];
        const historyEvent = await logTaskActionEvent({
            taskId: task.id,
            actionType: TASK_ACTION_TYPES.URGENT_COMMITMENT_SET,
            actor: req.user,
            sourceSurface: sourceSurface(req.body, 'alerts_panel'),
            oldValue: {
                snoozedUntil: task.snoozed_until || null,
                nextNotificationAt: task.next_notification_at || null
            },
            newValue: { commitmentAt, snoozedUntil: commitmentAt, nextNotificationAt: commitmentAt },
            meta: { priority: 'urgent', commitment: true }
        });
        _alertPush();
        res.json({ success: true, task: normalizeTaskPayload(updated), historyEvent });
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

// GET /api/tasks/:id/subtasks — checklist projection
router.get('/:id/subtasks', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const params = [req.params.id];
        const visibility = buildTaskVisibilityScope(req.user, params, 't');
        const businessCondition = appendTaskBusinessScopeSql(params, businessScope, 't');
        const visible = await pool.query(`SELECT t.id FROM tasks t WHERE t.id = $1 ${visibility} ${businessCondition} LIMIT 1`, params);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });
        const result = await pool.query(
            `SELECT *
             FROM task_subtasks
             WHERE task_id = $1
             ORDER BY sort_order ASC, id ASC`,
            [req.params.id]
        );
        res.json({ success: true, subtasks: result.rows.map(normalizeSubtaskRow) });
    } catch (err) {
        log.error('Get subtasks error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/tasks/:id/subtasks — add checklist item
router.post('/:id/subtasks', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        await loadMutableTask(req.params.id, req.user, businessScope);
        const title = String(req.body.title || '').trim();
        if (!title) return res.status(400).json({ error: 'title required' });
        const sourceType = normalizeSubtaskSourceType(req.body.source_type || req.body.sourceType || 'manual');
        const rawSortOrder = req.body.sort_order ?? req.body.sortOrder;
        const parsedSortOrder = Number.parseInt(rawSortOrder, 10);
        const sortOrder = Number.isInteger(parsedSortOrder) ? parsedSortOrder : null;
        const result = await pool.query(
            `INSERT INTO task_subtasks (task_id, title, sort_order, source_type)
             VALUES (
                $1,
                $2,
                COALESCE(
                    $3::int,
                    (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_subtasks WHERE task_id = $1)
                ),
                $4
             )
             RETURNING *`,
            [req.params.id, title, sortOrder, sourceType]
        );
        await pool.query(
            `UPDATE tasks
             SET task_kind = CASE WHEN task_kind = 'action' THEN 'checklist' ELSE task_kind END,
                 updated_at = NOW()
             WHERE id = $1`,
            [req.params.id]
        );
        res.json({ success: true, subtask: normalizeSubtaskRow(result.rows[0]) });
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

// POST /api/tasks/:id/subtasks/reorder - persist checklist drag-and-drop order
router.post('/:id/subtasks/reorder', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        await loadMutableTask(req.params.id, req.user, businessScope);
        const orderedIds = normalizeSubtaskReorderIds(req.body);
        const subtasks = await reorderTaskSubtasks(pool, req.params.id, orderedIds);
        res.json({ success: true, subtasks });
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

// PATCH /api/tasks/:id/subtasks/:subtaskId - toggle/update checklist item
router.patch('/:id/subtasks/:subtaskId', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const task = await loadMutableTask(req.params.id, req.user, businessScope);
        const sets = [];
        const values = [];
        let nextDoneState = null;
        if (req.body.title !== undefined) {
            const title = String(req.body.title || '').trim();
            if (!title) return res.status(400).json({ error: 'title required' });
            values.push(title);
            sets.push(`title = $${values.length}`);
        }
        if (req.body.is_done !== undefined || req.body.isDone !== undefined) {
            const done = isTruthy(req.body.is_done !== undefined ? req.body.is_done : req.body.isDone);
            nextDoneState = done;
            values.push(done);
            sets.push(`is_done = $${values.length}`);
            sets.push(`completed_at = CASE WHEN $${values.length} = true THEN NOW() ELSE NULL END`);
        }
        if (req.body.sort_order !== undefined || req.body.sortOrder !== undefined) {
            values.push(parseInt(req.body.sort_order ?? req.body.sortOrder, 10) || 0);
            sets.push(`sort_order = $${values.length}`);
        }
        if (req.body.source_type !== undefined || req.body.sourceType !== undefined) {
            values.push(normalizeSubtaskSourceType(req.body.source_type ?? req.body.sourceType));
            sets.push(`source_type = $${values.length}`);
        }
        if (!sets.length) return res.status(400).json({ error: 'No changes' });
        sets.push('updated_at = NOW()');
        values.push(req.params.id, req.params.subtaskId);
        const result = await pool.query(
            `UPDATE task_subtasks
             SET ${sets.join(', ')}
             WHERE task_id = $${values.length - 1} AND id = $${values.length}
             RETURNING *`,
            values
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Subtask not found' });
        await pool.query('UPDATE tasks SET updated_at = NOW() WHERE id = $1', [req.params.id]);
        if (nextDoneState === true) {
            try {
                await logTaskActionEvent({
                    taskId: task.id,
                    actionType: TASK_ACTION_TYPES.SUBTASK_COMPLETED,
                    actor: req.user,
                    sourceSurface: sourceSurface(req.body, 'task_page'),
                    newValue: { subtaskId: Number(req.params.subtaskId), isDone: true },
                    meta: { movement: 'subtask_done' }
                });
                await markUrgentTaskMovement(task.id, task, req.user, 'subtask_done');
            } catch (historyErr) {
                log.warn(`Subtask movement history skipped: ${historyErr.message}`);
            }
        }
        res.json({ success: true, subtask: normalizeSubtaskRow(result.rows[0]) });
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

// DELETE /api/tasks/:id/subtasks/:subtaskId - remove checklist item
router.delete('/:id/subtasks/:subtaskId', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        await loadMutableTask(req.params.id, req.user, businessScope);
        const result = await pool.query(
            `DELETE FROM task_subtasks
             WHERE task_id = $1 AND id = $2
             RETURNING id`,
            [req.params.id, req.params.subtaskId]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Subtask not found' });
        await pool.query('UPDATE tasks SET updated_at = NOW() WHERE id = $1', [req.params.id]);
        res.json({ success: true, deletedId: Number(result.rows[0].id) });
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

// POST /api/tasks/:id/focus — pin/unpin in personal focus lane
router.post('/:id/focus', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        await loadMutableTask(req.params.id, req.user, businessScope);
        const enabled = req.body.enabled === undefined ? true : isTruthy(req.body.enabled);
        const rank = enabled ? Math.max(1, Math.min(99, parseInt(req.body.rank ?? req.body.focusRank ?? 1, 10) || 1)) : 0;
        const result = await pool.query(
            `UPDATE tasks
             SET focus_rank = $1,
                 workflow_state = CASE WHEN $1 > 0 AND workflow_state IN ('inbox','todo') THEN 'in_progress' ELSE workflow_state END,
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
             WHERE id = $2
             RETURNING *`,
            [rank, req.params.id]
        );
        res.json({ success: true, task: normalizeTaskPayload(result.rows[0]) });
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

// POST /api/tasks/:id/snooze — postpone reminder/attention state
router.post('/:id/snooze', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const task = await loadMutableTask(req.params.id, req.user, businessScope);
        let until = normalizeOptionalDateTime(req.body.until || req.body.snoozed_until || req.body.snoozedUntil);
        if (!until) {
            const minutes = parseInt(req.body.minutes ?? req.body.snoozeMinutes ?? 0, 10);
            const hours = parseInt(req.body.hours ?? req.body.snoozeHours ?? 0, 10);
            until = minutesFromNow(minutes || (hours ? hours * 60 : 60));
        }
        const result = await pool.query(
            `UPDATE tasks
             SET snoozed_until = $1,
                 next_notification_at = $1,
                 workflow_state = 'scheduled',
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
             WHERE id = $2
             RETURNING *`,
            [until, req.params.id]
        );
        const updated = result.rows[0];
        let historyEvent = null;
        try {
            historyEvent = await logTaskActionEvent({
                taskId: task.id,
                actionType: TASK_ACTION_TYPES.SNOOZED,
                actor: req.user,
                sourceSurface: sourceSurface(req.body, 'task_page'),
                oldValue: { snoozedUntil: task.snoozed_until || null, nextNotificationAt: task.next_notification_at || null },
                newValue: { snoozedUntil: until, nextNotificationAt: until },
                meta: { movement: 'snooze' }
            });
        } catch (historyErr) {
            log.warn(`Task snooze history skipped: ${historyErr.message}`);
        }
        res.json({ success: true, task: normalizeTaskPayload(updated), historyEvent });
    } catch (err) {
        return sendTaskActionError(res, err);
    }
});

router.post('/:id/complete', async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const result = await completeTask(req.params.id, req.user, {
            sourceSurface: sourceSurface(req.body),
            route: 'tasks_task_complete',
            reportId: req.body?.reportId || req.body?.report_id,
            businessScope
        });
        res.json({
            success: true,
            task: normalizeTaskPayload(result.task),
            historyEvent: result.historyEvent,
            meta: {
                durableMutation: true,
                canonicalField: 'tasks.status'
            }
        });
        _alertPush();
    } catch (err) {
        sendTaskActionError(res, err);
    }
});

router.post('/:id/reassign', async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const ownerUserId = req.body?.ownerUserId ?? req.body?.owner_user_id;
        const result = await reassignTaskOwner(req.params.id, ownerUserId, req.user, {
            sourceSurface: sourceSurface(req.body),
            route: 'tasks_task_reassign',
            businessScope
        });
        notifyTaskAssignment(result.task, req.user?.username || 'system').catch(() => {});
        emitTaskAssignedToOwner(result.task, req.user, { assignmentEvent: 'reassigned', source: 'routes/tasks.reassign' });
        res.json({
            success: true,
            task: normalizeTaskPayload(result.task),
            owner: result.owner,
            historyEvent: result.historyEvent,
            meta: {
                durableMutation: true,
                canonicalField: 'tasks.owner_user_id'
            }
        });
        _alertPush();
    } catch (err) {
        sendTaskActionError(res, err);
    }
});

router.post('/:id/reschedule', async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        if (hasSchedulePayload(req.body || {})) {
            const result = await scheduleTask(req.params.id, req.body || {}, req.user, {
                sourceSurface: sourceSurface(req.body),
                route: 'tasks_task_schedule',
                businessScope,
                reason: req.body?.reason || 'manual_schedule',
                idempotencyKey: req.body?.idempotencyKey || req.body?.idempotency_key
            });
            _alertPush();
            return res.json({
                success: true,
                task: normalizeTaskPayload(result.task),
                historyEvent: result.historyEvent,
                proposals: result.proposals || [],
                meta: {
                    durableMutation: true,
                    canonicalField: 'tasks.scheduled_start_at'
                }
            });
        }
        const deadline = resolveDeadline(req.body || {});
        const result = await rescheduleTask(req.params.id, deadline, req.user, {
            sourceSurface: sourceSurface(req.body),
            route: 'tasks_task_reschedule',
            businessScope,
            reason: req.body?.reason || 'manual_reschedule',
            idempotencyKey: req.body?.idempotencyKey || req.body?.idempotency_key
        });
        res.json({
            success: true,
            task: normalizeTaskPayload(result.task),
            historyEvent: result.historyEvent,
            meta: {
                durableMutation: true,
                canonicalField: 'tasks.deadline'
            }
        });
        _alertPush();
    } catch (err) {
        sendTaskActionError(res, err);
    }
});

// v10.0: GET /api/tasks/:id/logs — task change history
router.post('/:id/schedule', async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const result = await scheduleTask(req.params.id, req.body || {}, req.user, {
            sourceSurface: sourceSurface(req.body),
            route: 'tasks_task_schedule',
            businessScope,
            reason: req.body?.reason || 'manual_schedule',
            idempotencyKey: req.body?.idempotencyKey || req.body?.idempotency_key
        });
        _alertPush();
        res.json({
            success: true,
            task: normalizeTaskPayload(result.task),
            historyEvent: result.historyEvent,
            proposals: result.proposals || [],
            meta: {
                durableMutation: true,
                canonicalField: 'tasks.scheduled_start_at'
            }
        });
    } catch (err) {
        sendTaskActionError(res, err);
    }
});

router.get('/:id/logs', async (req, res) => {
    try {
        const businessScope = requireTaskReadScope(req, res);
        if (!businessScope) return;
        const { id } = req.params;
        const visibleParams = [id];
        const visibility = buildTaskVisibilityScope(req.user, visibleParams, 't');
        const businessCondition = appendTaskBusinessScopeSql(visibleParams, businessScope, 't');
        const visible = await pool.query(`SELECT t.id FROM tasks t WHERE t.id = $1 ${visibility} ${businessCondition} LIMIT 1`, visibleParams);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });
        const result = await pool.query(
            'SELECT * FROM task_logs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 100',
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get task logs error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/tasks/operation-pack — create preset-driven checklist bundle
router.post('/operation-pack', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const businessContext = activeTaskBusinessContext(businessScope);
        const presetKey = String(req.body.preset || req.body.presetKey || '').trim();
        const preset = ORDER_OPERATION_PRESETS[presetKey];
        if (!preset) return res.status(400).json({ error: 'Invalid operation preset' });

        const date = req.body.date && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : todayKyivDate();
        const packId = normalizeUuid(req.body.pack_id || req.body.packId) || crypto.randomUUID();
        const packStatus = normalizePackStatus(req.body.pack_status || req.body.packStatus, 'draft');
        const sourceEntityType = normalizeSourceEntityType(req.body.source_entity_type || req.body.sourceEntityType);
        const sourceEntityId = normalizeSourceEntityId(req.body.source_entity_id || req.body.sourceEntityId);
        const baseTitle = String(req.body.title || preset.title || 'Операційний пакет').trim();
        const priority = normalizeTaskPriority(req.body.priority);
        const username = req.user?.username || 'system';
        const kleshnya = getKleshnya();
        const created = [];
        const taskByTemplateKey = {};

        for (const item of preset.bundle) {
            const template = getChecklistTemplate(item.templateKey);
            if (!template) continue;
            const taskTitle = preset.bundle.length > 1
                ? `${baseTitle}: ${template.label}`
                : `${baseTitle}`;
            const task = await kleshnya.createTask({
                businessContext,
                title: taskTitle,
                description: item.description || null,
                date,
                priority,
                assigned_to: null,
                owner_user_id: null,
                task_type: 'human',
                source_type: 'operation_pack',
                source_id: packId,
                category: 'checklist',
                subcategory: template.subcategory,
                checklist_template_key: item.templateKey,
                source_entity_type: sourceEntityType,
                source_entity_id: sourceEntityId,
                pack_id: packId,
                pack_status: packStatus,
                owner_role: item.owner_role || template.owner_role,
                sla_minutes: item.sla_minutes || template.sla_minutes,
                escalate_after: null,
                created_by: username,
                created_by_user_id: normalizeUserId(req.user),
                task_mode: 'work',
                task_kind: 'checklist',
                visibility: 'team',
                workflow_state: 'todo',
                source_module: 'tasks_operation_pack'
            });
            if (!task.duplicateSkipped) {
                const subtasks = await createChecklistSubtasks(pool, task.id, item.templateKey);
                task.subtask_count = subtasks.length;
                task.subtask_done_count = 0;
            }
            created.push(task);
            taskByTemplateKey[item.templateKey] = task;
        }

        for (const dependency of preset.dependencies || []) {
            const task = taskByTemplateKey[dependency.taskTemplateKey];
            const dependsOn = taskByTemplateKey[dependency.dependsOnTemplateKey];
            if (task && dependsOn) await createTaskDependencyRows(task.id, [dependsOn.id]);
        }

        res.json({
            success: true,
            packId,
            preset: presetKey,
            tasks: created,
            meta: {
                packStatus,
                sourceEntityType,
                sourceEntityId,
                checklistTemplates: created.map(task => task.checklist_template_key),
                businessScope: taskBusinessScopeMeta(businessScope)
            }
        });
        _alertPush();
    } catch (err) {
        log.error('Create operation pack error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/tasks — create (via Kleshnya) — admin/user only
router.post('/', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const businessContext = activeTaskBusinessContext(businessScope);
        const b = req.body;
        // Support both snake_case and camelCase (for external integrations like OpenClaw)
        const title = b.title;
        const description = b.description;
        const date = b.date || b.schedule?.date || b.scheduledDate || b.scheduled_date;
        const priority = b.priority;
        const typedOwner = await resolveTypedTaskOwner(b, req.user);
        const assigned_to = typedOwner?.assignedToSnapshot || b.assigned_to || b.assignedTo;
        const owner_user_id = typedOwner?.ownerUserId || null;
        const owner = b.owner;
        const type = b.type;
        const template_id = b.template_id || b.templateId;
        const afisha_id = b.afisha_id || b.afishaId;
        const category = b.category;
        const task_type = b.task_type || b.taskType;
        const deadline = b.deadline;
        const time_window_start = b.time_window_start || b.timeWindowStart;
        const time_window_end = b.time_window_end || b.timeWindowEnd;
        const dependency_ids = b.dependency_ids || b.dependencyIds;
        const control_policy = b.control_policy || b.controlPolicy;
        const source_type = b.source_type || b.sourceType;
        const source_id = b.source_id || b.sourceId;
        const osFields = normalizeTaskOsFields(b, { status: 'todo' });
        const opsFields = normalizeTaskOperations(b, { category: 'admin' });
        const controlMeta = normalizeTaskControlMeta(b);
        const taskPriority = normalizeTaskPriority(priority);
        applyUrgentPriorityDefaults(taskPriority, osFields, opsFields, controlMeta);
        const hasManualSubtasks = hasSubtaskPayload(b);
        const manualSubtasks = hasManualSubtasks ? subtaskPayloadFromBody(b) : [];
        if (opsFields.category === 'checklist' && osFields.task_kind === 'action') {
            osFields.task_kind = 'checklist';
        }
        if (manualSubtasks.some(item => String((item && typeof item === 'object' ? item.title || item.name : item) || '').trim())) {
            osFields.task_kind = 'checklist';
        }

        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });

        const srcType = source_type || 'manual';
        const force = isTruthy(b.force || b.forceDuplicate);
        if (force && srcType !== 'manual') {
            return res.status(400).json({ error: 'force is available only for manual tasks' });
        }
        if (force && !canForceTaskDuplicate(req.user)) {
            return res.status(403).json({ error: 'Only managers can force duplicate manual tasks' });
        }
        const duplicate = await findActiveDuplicateTask(pool, {
            title,
            date,
            deadline,
            owner_user_id,
            category: opsFields.category,
            subcategory: opsFields.subcategory,
            source_type: srcType,
            source_id,
            template_id,
            source_entity_type: opsFields.source_entity_type,
            source_entity_id: opsFields.source_entity_id,
            pack_id: opsFields.pack_id,
            checklist_template_key: opsFields.checklist_template_key,
            afisha_id,
            businessContext
        });
        if (duplicate && !force) {
            return res.status(409).json({
                error: 'duplicate',
                code: 'TASK_DUPLICATE_ACTIVE',
                message: `Задача "${title.trim()}" вже існує`,
                existingId: duplicate.id,
                existingStatus: duplicate.status,
                forceAllowed: srcType === 'manual' && canForceTaskDuplicate(req.user),
                hint: 'Активний дубль не створено. Відкрий існуючу задачу або завершуй її.'
            });
        }

        const username = req.user?.username || 'system';
        const kleshnya = getKleshnya();

        const task = await kleshnya.createTask({
            businessContext,
            title, description, date,
            priority: taskPriority,
            assigned_to: assigned_to || null,
            owner_user_id,
            owner: owner || null,
            task_type: VALID_TASK_TYPES.includes(task_type) ? task_type : 'human',
            deadline: deadline || null,
            time_window_start: time_window_start || null,
            time_window_end: time_window_end || null,
            dependency_ids: dependency_ids || [],
            control_policy: control_policy || undefined,
            source_type: source_type || 'manual',
            source_id: source_id || null,
            category: opsFields.category,
            subcategory: opsFields.subcategory,
            checklist_template_key: opsFields.checklist_template_key,
            source_entity_type: opsFields.source_entity_type,
            source_entity_id: opsFields.source_entity_id,
            pack_id: opsFields.pack_id,
            pack_status: opsFields.pack_status,
            owner_role: opsFields.owner_role,
            sla_minutes: opsFields.sla_minutes,
            escalate_after: opsFields.escalate_after,
            template_id: template_id || null,
            afisha_id: afisha_id || null,
            created_by: username,
            created_by_user_id: normalizeUserId(req.user),
            control_meta: controlMeta,
            forceDuplicate: force,
            duplicateMode: 'reject',
            ...osFields
        });
        let responseTask = task;
        let scheduleResult = null;
        const postCreateWarnings = [];
        const recordPostCreateWarning = (step, err) => {
            const warning = {
                step,
                code: err?.code || err?.statusCode || null,
                message: err?.message || 'post-create step failed'
            };
            postCreateWarnings.push(warning);
            log.error(`Task create post-step failed after task #${task.id} [${step}]`, err);
        };
        if (!task.duplicateSkipped && hasSchedulePayload(b)) {
            try {
                scheduleResult = await scheduleTask(task.id, { ...b, date }, req.user, {
                    sourceSurface: sourceSurface(b, 'task_page'),
                    route: 'tasks_create_schedule',
                    businessScope
                });
                Object.assign(task, scheduleResult.task);
                responseTask = scheduleResult.task;
            } catch (err) {
                recordPostCreateWarning('schedule', err);
            }
        }
        if (hasManualSubtasks && !task.duplicateSkipped) {
            try {
                const subtasks = await replaceTaskSubtasks(pool, task.id, manualSubtasks, { sourceType: 'manual' });
                responseTask.subtask_count = subtasks.length;
                responseTask.subtask_done_count = subtasks.filter(item => item.isDone || item.is_done).length;
                responseTask.subtasks = subtasks;
            } catch (err) {
                recordPostCreateWarning('subtasks', err);
            }
        } else if (task.task_kind === 'checklist' && task.checklist_template_key) {
            try {
                const subtasks = await createChecklistSubtasks(pool, task.id, task.checklist_template_key);
                responseTask.subtask_count = subtasks.length;
                responseTask.subtask_done_count = 0;
            } catch (err) {
                recordPostCreateWarning('checklist_subtasks', err);
            }
        } else {
            responseTask.subtask_count = 0;
            responseTask.subtask_done_count = 0;
        }
        try {
            await createTaskDependencyRows(task.id, dependency_ids);
        } catch (err) {
            recordPostCreateWarning('dependencies', err);
        }
        if (hasObserverPatch(b)) {
            try {
                task.observers = await replaceTaskObservers(task, observerIdsFromBody(b), req.user);
                task.observer_count = task.observers.length;
            } catch (err) {
                recordPostCreateWarning('observers', err);
            }
        }
        try {
            responseTask = await attachSubtaskSummary(responseTask, { includeSubtasks: hasManualSubtasks });
        } catch (err) {
            recordPostCreateWarning('subtask_summary', err);
        }
        try {
            emitTaskAssignedToOwner(task, req.user, { assignmentEvent: 'created', source: 'routes/tasks.create' });
        } catch (err) {
            recordPostCreateWarning('assignment_event', err);
        }

        res.json({
            success: true,
            task: normalizeTaskPayload(responseTask),
            postCreateWarnings,
            schedule: scheduleResult ? { historyEvent: scheduleResult.historyEvent, proposals: scheduleResult.proposals || [] } : null,
            meta: {
                canonicalOwnerField: 'tasks.owner_user_id',
                legacyDisplayFields: ['assigned_to', 'owner'],
                sourceMetadata: {
                    typeField: 'tasks.source_type',
                    idField: 'tasks.source_id',
                    supportedChatSources: ['chat_message', 'chat_channel', 'chat_command']
                },
                notificationTrigger: 'services/kleshnya.notifyTaskAssigned',
                notificationFailure: 'logged_non_blocking',
                postCreateWarningCount: postCreateWarnings.length
            }
        });
        _alertPush();
    } catch (err) {
        if (err instanceof TaskDuplicateError || err.code === 'TASK_DUPLICATE_ACTIVE') {
            return res.status(409).json({
                error: 'duplicate',
                code: err.code || 'TASK_DUPLICATE_ACTIVE',
                message: err.message,
                existingId: err.task?.id || null,
                existingStatus: err.task?.status || null
            });
        }
        log.error('Create error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/tasks/:id — full update — admin/user only
// v19.10: Optimistic locking via version column
router.put('/:id', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const { id } = req.params;
        const b = req.body;
        // v40: Support partial updates — merge with existing task
        const existingParams = [id];
        const visibility = buildTaskVisibilityScope(req.user, existingParams, 't');
        const businessCondition = appendTaskBusinessScopeSql(existingParams, businessScope, 't');
        const existing = await pool.query(`SELECT t.* FROM tasks t WHERE t.id = $1 ${visibility} ${businessCondition} LIMIT 1`, existingParams);
        if (!existing.rows.length) return res.status(404).json({ error: 'Task not found' });
        const old = existing.rows[0];
        if (!canMutateTask(req.user, old)) return res.status(403).json({ error: 'Недостатньо прав для зміни задачі' });

        const title = b.title || old.title;
        const description = b.description !== undefined ? b.description : old.description;
        const date = b.date !== undefined ? b.date : old.date;
        const status = b.status || old.status;
        const priority = b.priority || old.priority;
        const typedOwner = await resolveTypedTaskOwner(b, req.user);
        const assigned_to = typedOwner?.assignedToSnapshot || b.assigned_to || b.assignedTo || old.assigned_to;
        const owner_user_id = typedOwner ? typedOwner.ownerUserId : old.owner_user_id;
        const owner = b.owner !== undefined ? b.owner : old.owner;
        const category = b.category || old.category;
        const task_type = b.task_type || b.taskType || old.task_type;
        const deadline = b.deadline !== undefined ? b.deadline : old.deadline;
        const dateChangeRequested = b.date !== undefined
            && normalizedComparable(b.date) !== normalizedComparable(old.date);
        const deadlineChangeRequested = b.deadline !== undefined
            && normalizedComparable(b.deadline) !== normalizedComparable(old.deadline);
        const time_window_start = b.time_window_start || b.timeWindowStart || old.time_window_start;
        const time_window_end = b.time_window_end || b.timeWindowEnd || old.time_window_end;
        const clientVersion = b.version !== undefined ? parseInt(b.version) : null;
        if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });

        const taskStatus = VALID_STATUSES.includes(status) ? status : 'todo';
        const taskPriority = normalizeTaskPriority(priority);
        const opsFields = normalizeTaskOperations(b, old);
        const taskCategory = opsFields.category;
        const osFields = normalizeTaskOsFields({ ...b, status: taskStatus }, old);
        const controlMeta = normalizeTaskControlMeta(b, old);
        if (taskStatus !== 'done') applyUrgentPriorityDefaults(taskPriority, osFields, opsFields, controlMeta, old);
        const hasManualSubtasks = hasSubtaskPayload(b);
        const manualSubtasks = hasManualSubtasks ? subtaskPayloadFromBody(b) : [];
        if (taskCategory === 'checklist' && osFields.task_kind === 'action') osFields.task_kind = 'checklist';
        if (manualSubtasks.some(item => String((item && typeof item === 'object' ? item.title || item.name : item) || '').trim())) {
            osFields.task_kind = 'checklist';
        }
        if (taskStatus === 'done') osFields.workflow_state = 'done';
        if (taskStatus === 'done') {
            const reportId = await ensureTaskReportReference(
                b.reportId || b.report_id || taskCompletionReportId({ ...old, control_meta: controlMeta }),
                old.business_context
            );
            if (taskRequiresCompletionReport({ ...old, control_meta: controlMeta }) && !reportId) {
                return sendTaskActionError(res, makeTaskReportRequiredError(old));
            }
            if (reportId) {
                controlMeta.reportRequired = true;
                controlMeta.reportId = reportId;
                controlMeta.reportSubmittedAt = controlMeta.reportSubmittedAt || new Date().toISOString();
                controlMeta.reportSubmittedBy = controlMeta.reportSubmittedBy || (req.user?.username || req.user?.name || 'system');
            }
        }
        const setClauses = ['title=$1', 'description=$2', 'date=$3', 'status=$4', 'priority=$5',
            'assigned_to=$6', 'owner=$7', 'owner_user_id=$8', `updated_at=NOW()`, `completed_at=CASE WHEN $9='done' THEN NOW() ELSE NULL END`,
            'version=COALESCE(version,1)+1'];
        const values = [title.trim(), description || null, old.date || null, taskStatus, taskPriority,
                        assigned_to || null, owner || null, owner_user_id || null, taskStatus];
        let paramIdx = 10;

        setClauses.push(`category=$${paramIdx++}`);
        values.push(taskCategory);
        setClauses.push(`subcategory=$${paramIdx++}`);
        values.push(opsFields.subcategory);
        setClauses.push(`checklist_template_key=$${paramIdx++}`);
        values.push(opsFields.checklist_template_key);
        setClauses.push(`source_entity_type=$${paramIdx++}`);
        values.push(opsFields.source_entity_type);
        setClauses.push(`source_entity_id=$${paramIdx++}`);
        values.push(opsFields.source_entity_id);
        setClauses.push(`pack_id=$${paramIdx++}`);
        values.push(opsFields.pack_id);
        setClauses.push(`pack_status=$${paramIdx++}`);
        values.push(opsFields.pack_status);
        setClauses.push(`owner_role=$${paramIdx++}`);
        values.push(opsFields.owner_role);
        setClauses.push(`sla_minutes=$${paramIdx++}`);
        values.push(opsFields.sla_minutes);
        setClauses.push(`escalate_after=$${paramIdx++}`);
        values.push(opsFields.escalate_after || null);
        if (task_type && VALID_TASK_TYPES.includes(task_type)) {
            setClauses.push(`task_type=$${paramIdx++}`);
            values.push(task_type);
        }
        if (time_window_start !== undefined) {
            setClauses.push(`time_window_start=$${paramIdx++}`);
            values.push(time_window_start || null);
        }
        if (time_window_end !== undefined) {
            setClauses.push(`time_window_end=$${paramIdx++}`);
            values.push(time_window_end || null);
        }
        Object.entries(osFields).forEach(([field, value]) => {
            setClauses.push(`${field}=$${paramIdx++}`);
            values.push(value);
        });
        setClauses.push(`control_meta=$${paramIdx++}::jsonb`);
        values.push(JSON.stringify(controlMeta));

        values.push(id);
        let whereClause = `WHERE id=$${paramIdx}`;
        values.push(activeTaskBusinessContext(old.business_context));
        whereClause += ` AND COALESCE(business_context, 'event_genix')=$${++paramIdx}`;

        // Optimistic locking: check version if client provides it
        if (clientVersion !== null) {
            values.push(clientVersion);
            whereClause += ` AND COALESCE(version,1)=$${++paramIdx}`;
        }

        const result = await pool.query(
            `UPDATE tasks SET ${setClauses.join(', ')} ${whereClause} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            const staleParams = [id];
            const staleBusinessCondition = appendTaskBusinessScopeSql(staleParams, businessScope, 'tasks');
            const existing = await pool.query(`SELECT * FROM tasks WHERE id = $1 ${staleBusinessCondition}`, staleParams);
            if (existing.rows.length === 0) {
                return res.status(404).json({ error: 'Task not found' });
            }
            return res.status(409).json({
                error: 'Задачу було змінено іншим користувачем',
                conflict: true,
                currentData: existing.rows[0]
            });
        }

        const directHistoryEvents = await logDirectTaskUpdateHistory(old, result.rows[0], req.user, b);

        // Log update via Kleshnya
        const kleshnya = getKleshnya();
        const actor = req.user?.username || 'system';
        await kleshnya.logTaskAction(parseInt(id), 'updated', null, title, actor);

        // v22.2.0: Gamification — award coins + XP on task completion
        if (status === 'done' && actor !== 'system') {
            try {
                const { onTaskComplete } = require('../services/gamification');
                onTaskComplete(actor, result.rows[0]).catch(() => {});
            } catch (e) { /* gamification not ready */ }
        }

        let updatedTask = result.rows[0];
        let scheduleResult = null;
        if (hasSchedulePayload(b)) {
            scheduleResult = await scheduleTask(id, { ...b, date }, req.user, {
                sourceSurface: sourceSurface(b, 'task_detail'),
                route: 'tasks_update_schedule',
                businessScope
            });
            updatedTask = scheduleResult.task;
        } else if (dateChangeRequested || deadlineChangeRequested) {
            const duePatch = {
                ...(dateChangeRequested ? { date: date || null } : {}),
                ...(deadlineChangeRequested ? { deadline: deadline || null } : {})
            };
            scheduleResult = await rescheduleTask(id, duePatch, req.user, {
                sourceSurface: sourceSurface(b, 'task_detail'),
                route: 'tasks_update_reschedule',
                businessScope,
                reason: b.reason || 'task_full_update_reschedule',
                idempotencyKey: b.idempotencyKey || b.idempotency_key
            });
            updatedTask = scheduleResult.task;
        }
        if (hasObserverPatch(b)) {
            updatedTask.observers = await replaceTaskObservers(updatedTask, observerIdsFromBody(b), req.user);
            updatedTask.observer_count = updatedTask.observers.length;
        }
        if (hasManualSubtasks) {
            const subtasks = await replaceTaskSubtasks(pool, updatedTask.id, manualSubtasks, { sourceType: 'manual' });
            updatedTask.subtask_count = subtasks.length;
            updatedTask.subtask_done_count = subtasks.filter(item => item.isDone || item.is_done).length;
            updatedTask.subtasks = subtasks;
        }
        if (
            updatedTask.task_kind === 'checklist' &&
            updatedTask.checklist_template_key &&
            !hasManualSubtasks &&
            old.checklist_template_key !== updatedTask.checklist_template_key
        ) {
            const existingSubtasks = await pool.query('SELECT COUNT(*)::int AS count FROM task_subtasks WHERE task_id = $1', [updatedTask.id]);
            if (!existingSubtasks.rows[0]?.count) {
                await createChecklistSubtasks(pool, updatedTask.id, updatedTask.checklist_template_key);
            }
        }

        // v19.10/v0.48.12: Notify only when assignment actually changes.
        if (taskAssigneeChanged(old, updatedTask) && (updatedTask.owner_user_id || updatedTask.assigned_to)) {
            notifyTaskAssignment(updatedTask, actor).catch(() => {});
            emitTaskAssignedToOwner(updatedTask, req.user, { assignmentEvent: 'updated_assignment', source: 'routes/tasks.update' });
        }

        updatedTask = await attachSubtaskSummary(updatedTask, { includeSubtasks: hasManualSubtasks });
        res.json({
            success: true,
            task: normalizeTaskPayload(updatedTask),
            historyEvents: directHistoryEvents,
            schedule: scheduleResult ? { historyEvent: scheduleResult.historyEvent, proposals: scheduleResult.proposals || [] } : null
        });
        _alertPush();
    } catch (err) {
        log.error('Update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/tasks/:id/status — quick status change (via Kleshnya) — admin/user only
router.patch('/:id/status', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const { id } = req.params;
        const { status } = req.body;
        if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

        const visibleParams = [id];
        const visibility = buildTaskVisibilityScope(req.user, visibleParams, 't');
        const businessCondition = appendTaskBusinessScopeSql(visibleParams, businessScope, 't');
        const visible = await pool.query(`SELECT t.* FROM tasks t WHERE t.id = $1 ${visibility} ${businessCondition} LIMIT 1`, visibleParams);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });
        if (!canMutateTask(req.user, visible.rows[0])) return res.status(403).json({ error: 'Недостатньо прав для зміни задачі' });

        const actor = req.user?.username || 'system';
        if (status === 'done') {
            const result = await completeTask(id, req.user, {
                sourceSurface: sourceSurface(req.body, 'task_detail'),
                route: 'tasks_status_complete',
                reportId: req.body?.reportId || req.body?.report_id,
                businessScope
            });
            if (actor !== 'system') {
                try {
                    const { onTaskComplete } = require('../services/gamification');
                    onTaskComplete(actor, result.task).catch(() => {});
                } catch (e) { /* gamification not ready */ }
            }
            _alertPush();
            return res.json({
                success: true,
                task: normalizeTaskPayload(result.task),
                historyEvent: result.historyEvent,
                meta: {
                    durableMutation: true,
                    canonicalField: 'tasks.status'
                }
            });
        }
        const kleshnya = getKleshnya();
        const task = await kleshnya.updateTaskStatus(parseInt(id), status, actor);
        let responseTask = task;
        let historyEvent = null;
        try {
            historyEvent = await logTaskActionEvent({
                taskId: Number(id),
                actionType: TASK_ACTION_TYPES.STATUS_CHANGED,
                actor: req.user,
                sourceSurface: sourceSurface(req.body, 'task_detail'),
                oldValue: { status: visible.rows[0].status || 'todo' },
                newValue: { status },
                meta: { movement: status === 'in_progress' ? 'in_progress' : 'status_changed' }
            });
            if (status === 'in_progress') {
                const urgentMoved = await markUrgentTaskMovement(id, visible.rows[0], req.user, 'in_progress');
                if (urgentMoved) responseTask = urgentMoved;
            }
        } catch (historyErr) {
            log.warn(`Task status movement history skipped: ${historyErr.message}`);
        }

        // v22.2.0: Gamification — award coins + XP on task completion
        if (status === 'done' && actor !== 'system') {
            try {
                const { onTaskComplete } = require('../services/gamification');
                onTaskComplete(actor, task).catch(() => {});
            } catch (e) { /* gamification not ready */ }
        }

        _alertPush();
        res.json({
            success: true,
            task: normalizeTaskPayload(responseTask),
            historyEvent,
            meta: {
                durableMutation: true,
                canonicalField: 'tasks.status'
            }
        });
    } catch (err) {
        if (err.code || err.statusCode) {
            return sendTaskActionError(res, err);
        }
        if (err.message === 'Task not found') {
            return res.status(404).json({ error: 'Task not found' });
        }
        if (err.message.startsWith('Conflict:')) {
            return res.status(409).json({ error: 'Internal server error' });
        }
        log.error('Status change error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/tasks/:id/review — review/score a completed task (manager+)
router.post('/:id/review', requireRole('admin', 'creator', 'director', 'manager'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const { score, comment } = req.body;
        const reviewScore = parseInt(score);
        if (!Number.isInteger(reviewScore) || reviewScore < 1 || reviewScore > 10) {
            return res.status(400).json({ error: 'score повинен бути від 1 до 10' });
        }
        const visibleParams = [req.params.id];
        const visibility = buildTaskVisibilityScope(req.user, visibleParams, 't');
        const businessCondition = appendTaskBusinessScopeSql(visibleParams, businessScope, 't');
        const visible = await pool.query(`SELECT t.id FROM tasks t WHERE t.id = $1 ${visibility} ${businessCondition} LIMIT 1`, visibleParams);
        if (!visible.rows.length) return res.status(404).json({ error: 'Task not found' });

        const result = await pool.query(
             `UPDATE tasks SET review_score = $1, review_comment = $2,
             reviewed_by = $3, reviewed_at = NOW()
             WHERE id = $4
               AND status = 'done'
               AND COALESCE(business_context, 'event_genix') = $5
             RETURNING *`,
            [reviewScore, comment || null, req.user.id || req.user.userId, req.params.id, activeTaskBusinessContext(businessScope)]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Задачу не знайдено або вона не завершена' });
        }

        // Award coins based on score
        const task = result.rows[0];
        const coinsReward = reviewScore * 5;
        try {
            const ownerUserId = parseInt(task.owner_user_id || (/^\d+$/.test(String(task.assigned_to || '')) ? task.assigned_to : 0), 10) || null;
            const assignedTo = String(task.assigned_to || task.owner || '').trim();
            if (ownerUserId || assignedTo) {
                const userResult = ownerUserId
                    ? await pool.query('SELECT username FROM users WHERE id = $1', [ownerUserId])
                    : await pool.query(
                        `SELECT username
                         FROM users
                         WHERE LOWER(username) = LOWER($1) OR LOWER(COALESCE(name, '')) = LOWER($1)
                         ORDER BY id
                         LIMIT 1`,
                        [assignedTo]
                    );
                if (userResult.rows.length > 0) {
                    const gamification = require('../services/gamification');
                    await gamification.awardCoins(userResult.rows[0].username, coinsReward, `Оцінка задачі: ${reviewScore}/10`, 'task_review');
                }
            }
        } catch (e) { /* gamification not ready */ }

        log.info(`Task ${req.params.id} reviewed: ${reviewScore}/10 by ${req.user.username}`);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        log.error('Review task error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/tasks/:id — admin only
router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const { id } = req.params;
        const params = [id];
        const businessCondition = appendTaskBusinessScopeSql(params, businessScope, 'tasks');
        const result = await pool.query(`DELETE FROM tasks WHERE id = $1 ${businessCondition} RETURNING id`, params);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

        // Log deletion
        const kleshnya = getKleshnya();
        const actor = req.user?.username || 'system';
        await kleshnya.logTaskAction(parseInt(id), 'deleted', null, null, actor);

        res.json({ success: true });
    } catch (err) {
        log.error('Delete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v33.3: POST /api/tasks/bulk — bulk actions on multiple tasks
router.post('/bulk', requireRole('admin', 'user'), async (req, res) => {
    try {
        const businessScope = requireTaskWriteScope(req, res);
        if (!businessScope) return;
        const { ids, action, assignTo, priority } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
        if (!action) return res.status(400).json({ error: 'action required' });

        const intIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
        if (intIds.length === 0) return res.status(400).json({ error: 'No valid ids' });

        const requestedIds = [...new Set(intIds)];
        const params = [requestedIds];
        const visibility = buildTaskVisibilityScope(req.user, params, 't');
        const businessCondition = appendTaskBusinessScopeSql(params, businessScope, 't');
        const targetResult = await pool.query(
            `SELECT t.* FROM tasks t WHERE t.id = ANY($1::int[]) ${visibility} ${businessCondition}`,
            params
        );
        if (targetResult.rows.length !== requestedIds.length) {
            return res.status(404).json({ success: false, error: 'Task not found', code: 'TASK_BULK_TARGET_NOT_FOUND' });
        }
        const mutationForbidden = targetResult.rows.filter(task => !canMutateTask(req.user, task));
        if (mutationForbidden.length) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions to modify every selected task',
                code: 'TASK_BULK_MUTATION_FORBIDDEN'
            });
        }
        if (action === 'assign' && targetResult.rows.some(task => !canReassignTask(req.user, task))) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions to reassign every selected task',
                code: 'TASK_BULK_REASSIGN_FORBIDDEN'
            });
        }
        let result;
        if (action === 'archive') {
            result = await pool.query(
                `UPDATE tasks t
                 SET status = 'archived',
                     workflow_state = 'archived',
                     archived_at = COALESCE(t.archived_at, NOW()),
                     archive_reason = COALESCE(t.archive_reason, 'manual_bulk'),
                     updated_at = NOW()
                 WHERE t.id = ANY($1::int[]) ${visibility} ${businessCondition} AND COALESCE(t.status, 'todo') NOT IN ('archived')`,
                params
            );
        } else if (action === 'restore') {
            result = await pool.query(
                `UPDATE tasks t
                 SET status = 'todo',
                     workflow_state = 'todo',
                     archived_at = NULL,
                     archive_reason = NULL,
                     duplicate_of_task_id = NULL,
                     completed_at = NULL,
                     updated_at = NOW()
                 WHERE t.id = ANY($1::int[]) ${visibility} ${businessCondition} AND COALESCE(t.status, 'todo') = 'archived'`,
                params
            );
        } else if (action === 'done') {
            result = await pool.query(
                `UPDATE tasks t SET status = 'done', workflow_state = 'done', completed_at = NOW(), updated_at = NOW()
                 WHERE t.id = ANY($1::int[]) ${visibility} ${businessCondition}
                   AND COALESCE(t.status, 'todo') NOT IN ('done','archived')
                   AND NOT EXISTS (
                       SELECT 1
                       FROM task_subtasks st
                       WHERE st.task_id = t.id
                         AND COALESCE(st.is_done, false) = false
                   )`,
                params
            );
        } else if (action === 'assign' && assignTo) {
            let typedOwner;
            try {
                typedOwner = await resolveTypedTaskOwner({ ownerUserId: assignTo }, req.user);
            } catch (ownerErr) {
                return res.status(ownerErr.statusCode || 400).json({
                    success: false,
                    error: ownerErr.message || 'Task owner is not assignable',
                    code: ownerErr.code || 'TASK_OWNER_NOT_ASSIGNABLE'
                });
            }
            result = await pool.query(
                `UPDATE tasks t SET owner_user_id = $${params.length + 1}, assigned_to = $${params.length + 2}, updated_at = NOW()
                 WHERE t.id = ANY($1::int[]) ${visibility} ${businessCondition}
                   AND (
                       t.owner_user_id IS DISTINCT FROM $${params.length + 1}
                       OR COALESCE(t.assigned_to, '') IS DISTINCT FROM COALESCE($${params.length + 2}, '')
                   )
                 RETURNING t.*`,
                [...params, typedOwner.ownerUserId, typedOwner.assignedToSnapshot]
            );
            for (const task of result.rows || []) {
                notifyTaskAssignment(task, req.user?.username || 'system').catch(() => {});
                emitTaskAssignedToOwner(task, req.user, { assignmentEvent: 'bulk_assign', source: 'routes/tasks.bulk_assign' });
            }
        } else if (action === 'priority' && priority) {
            if (!VALID_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
            if (priority === 'urgent') {
                result = await pool.query(
                    `UPDATE tasks t
                     SET priority = $${params.length + 1},
                         escalate_after = COALESCE(t.escalate_after, NOW() + INTERVAL '${URGENT_PRIORITY_ESCALATION_MINUTES} minutes'),
                         next_notification_at = COALESCE(t.next_notification_at, NOW() + INTERVAL '${URGENT_PRIORITY_ESCALATION_MINUTES} minutes'),
                         control_meta = COALESCE(t.control_meta, '{}'::jsonb) || jsonb_build_object(
                            'urgentPriority',
                            jsonb_build_object(
                                'enabled', true,
                                'escalation', 'no_movement',
                                'commitment', 'time_required',
                                'escalationMinutes', ${URGENT_PRIORITY_ESCALATION_MINUTES},
                                'cooldownMinutes', ${URGENT_PRIORITY_NOTIFICATION_COOLDOWN_MINUTES}
                            )
                         ),
                         updated_at = NOW()
                     WHERE t.id = ANY($1::int[]) ${visibility} ${businessCondition}`,
                    [...params, priority]
                );
            } else {
                result = await pool.query(
                    `UPDATE tasks t SET priority = $${params.length + 1}, updated_at = NOW()
                     WHERE t.id = ANY($1::int[]) ${visibility} ${businessCondition}`,
                    [...params, priority]
                );
            }
        } else {
            return res.status(400).json({ error: `Unknown action: ${action}` });
        }
        res.json({ success: true, affected: result.rowCount });
    } catch (err) {
        log.error('Bulk action error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
