'use strict';

const MAX_HERMES_LIMIT = 50;

const STATUS_MAP = Object.freeze({
    todo: 'open',
    in_progress: 'in_progress',
    done: 'done',
    archived: 'archived',
    cancelled: 'cancelled'
});

const HISTORY_TYPE_MAP = Object.freeze({
    task_completed: 'completed',
    task_owner_reassigned: 'reassigned',
    task_rescheduled: 'rescheduled',
    task_status_changed: 'status_changed',
    task_priority_changed: 'priority_changed',
    task_snoozed: 'snoozed',
    task_urgent_commitment_set: 'urgent_commitment_set',
    task_subtask_completed: 'subtask_completed',
    task_observers_updated: 'observers_updated',
    task_scheduled: 'scheduled',
    task_schedule_moved: 'schedule_moved',
    task_schedule_manual_override: 'schedule_manual_override',
    task_schedule_proposal_created: 'schedule_proposal_created',
    task_slot_missed: 'slot_missed',
    task_discipline_penalty_applied: 'discipline_penalty_applied'
});

const SENSITIVE_KEY_PATTERN = /(?:phone|email|e[-_]?mail|token|secret|password|cookie|authorization|control_?meta|raw_?data)/i;

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

function idOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    return String(value);
}

function numberOrNull(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function isoValue(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function dueValue(value) {
    if (!value) return null;
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    return isoValue(value);
}

function compactObject(input = {}) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined && value !== null)
    );
}

function normalizeHermesStatus(status) {
    const raw = String(status || 'todo').trim().toLowerCase();
    return STATUS_MAP[raw] || 'open';
}

function normalizePriority(value) {
    const raw = String(value || 'normal').trim().toLowerCase();
    if (raw === 'medium') return 'normal';
    return ['critical', 'urgent', 'high', 'normal', 'low'].includes(raw) ? raw : 'normal';
}

function crmTaskId(task = {}) {
    return idOrNull(firstPresent(task, ['id', 'taskId', 'task_id'])) || '';
}

function crmUrlForTask(task = {}, options = {}) {
    const id = crmTaskId(task);
    const path = `/tasks?open=${encodeURIComponent(id)}`;
    const baseUrl = textOrNull(options.crmBaseUrl || options.baseUrl || options.publicBaseUrl);
    return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : path;
}

function dueAtForTask(task = {}) {
    return dueValue(firstPresent(task, [
        'due_at',
        'dueAt',
        'scheduledStartAt',
        'scheduled_start_at',
        'deadline',
        'date'
    ]));
}

function actorPayload(idValue, nameValue, fallbackName = null) {
    const id = idOrNull(idValue);
    const name = textOrNull(nameValue || fallbackName);
    if (!id && !name) return null;
    return { id, name };
}

function assigneeForTask(task = {}) {
    return actorPayload(
        firstPresent(task, ['ownerUserId', 'owner_user_id']),
        firstPresent(task, ['ownerLabel', 'owner_label', 'owner_name', 'ownerName', 'owner_username', 'ownerUsername', 'assigned_to', 'assignedTo', 'owner'])
    );
}

function creatorForTask(task = {}) {
    return actorPayload(
        firstPresent(task, ['createdByUserId', 'created_by_user_id', 'creatorUserId', 'creator_user_id']),
        firstPresent(task, ['creatorName', 'creator_name', 'created_by_name', 'createdByName', 'created_by_username', 'createdByUsername'])
    );
}

function clientForTask(task = {}) {
    return actorPayload(
        firstPresent(task, ['clientId', 'client_id', 'customerId', 'customer_id']),
        firstPresent(task, ['clientName', 'client_name', 'customerName', 'customer_name'])
    );
}

function normalizeLabels(task = {}, options = {}) {
    const explicit = options.labels || task.labels || task.tags || [];
    const values = Array.isArray(explicit) ? explicit : String(explicit).split(',');
    const derived = [
        task.category,
        task.subcategory,
        task.taskKind || task.task_kind,
        normalizePriority(task.priority) === 'urgent' ? 'urgent' : null
    ];
    const seen = new Set();
    return [...values, ...derived]
        .map(textOrNull)
        .filter(Boolean)
        .filter(label => {
            const key = label.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function safeMetadataForTask(task = {}, rawStatus = null) {
    return compactObject({
        crm_status: rawStatus || null,
        business_context: firstPresent(task, ['businessContext', 'business_context']),
        version: numberOrNull(task.version),
        category: task.category || null,
        subcategory: task.subcategory || null,
        task_type: firstPresent(task, ['taskType', 'task_type']),
        task_mode: firstPresent(task, ['taskMode', 'task_mode']),
        task_kind: firstPresent(task, ['taskKind', 'task_kind']),
        visibility: task.visibility || null,
        workflow_state: firstPresent(task, ['workflowState', 'workflow_state']),
        schedule_status: firstPresent(task, ['scheduleStatus', 'schedule_status'])
    });
}

function parseJsonish(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return value;
    const raw = value.trim();
    if (!raw || !/^[\[{]/.test(raw)) return value;
    try {
        return JSON.parse(raw);
    } catch {
        return value;
    }
}

function sanitizeForHermes(value) {
    const parsed = parseJsonish(value);
    if (parsed === undefined || parsed === null) return null;
    if (parsed instanceof Date) return parsed.toISOString();
    if (Array.isArray(parsed)) return parsed.map(sanitizeForHermes);
    if (typeof parsed !== 'object') return parsed;

    const output = {};
    for (const [key, nested] of Object.entries(parsed)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) continue;
        output[key] = sanitizeForHermes(nested);
    }
    return output;
}

function normalizeSubtaskStatus(subtask = {}) {
    const raw = String(subtask.status || '').trim().toLowerCase();
    if (raw === 'done' || raw === 'completed') return 'done';
    if (subtask.isDone === true || subtask.is_done === true || subtask.done === true) return 'done';
    return 'open';
}

function toHermesSubtask(subtask = {}) {
    return compactObject({
        id: idOrNull(firstPresent(subtask, ['id', 'subtaskId', 'subtask_id'])),
        title: textOrNull(subtask.title || subtask.name) || 'Untitled subtask',
        status: normalizeSubtaskStatus(subtask),
        completed_at: isoValue(firstPresent(subtask, ['completedAt', 'completed_at'])),
        updated_at: isoValue(firstPresent(subtask, ['updatedAt', 'updated_at']))
    });
}

function toHermesTaskListItem(task = {}, options = {}) {
    const rawStatus = String(firstPresent(task, ['status']) || 'todo').trim().toLowerCase();
    return {
        id: crmTaskId(task),
        title: textOrNull(task.title) || 'Untitled task',
        status: normalizeHermesStatus(rawStatus),
        description: textOrNull(task.description),
        priority: normalizePriority(task.priority),
        assignee: assigneeForTask(task),
        due_at: dueAtForTask(task),
        created_at: isoValue(firstPresent(task, ['createdAt', 'created_at'])),
        updated_at: isoValue(firstPresent(task, ['updatedAt', 'updated_at', 'createdAt', 'created_at'])),
        completed_at: isoValue(firstPresent(task, ['completedAt', 'completed_at'])),
        crm_url: crmUrlForTask(task, options),
        labels: normalizeLabels(task, options),
        metadata: safeMetadataForTask(task, rawStatus)
    };
}

function toHermesTaskHistoryEvent(event = {}) {
    const rawType = textOrNull(firstPresent(event, ['actionType', 'action_type', 'type'])) || 'task_event';
    const actor = event.actor && typeof event.actor === 'object' ? event.actor : {};
    const sourceSurface = textOrNull(firstPresent(event, ['sourceSurface', 'source_surface']));
    return {
        id: idOrNull(event.id) || '',
        type: HISTORY_TYPE_MAP[rawType] || rawType.replace(/^task_/, ''),
        actor: actorPayload(
            firstPresent(actor, ['userId', 'user_id', 'id']) || firstPresent(event, ['actorUserId', 'actor_user_id']),
            firstPresent(actor, ['name', 'username']) || firstPresent(event, ['actorNameSnapshot', 'actor_name_snapshot'])
        ),
        at: isoValue(firstPresent(event, ['createdAt', 'created_at', 'at'])),
        summary: textOrNull(event.summary),
        changes: {
            old: sanitizeForHermes(firstPresent(event, ['oldValue', 'old_value_json', 'old'])),
            new: sanitizeForHermes(firstPresent(event, ['newValue', 'new_value_json', 'new']))
        },
        metadata: compactObject({
            crm_action_type: rawType,
            source_surface: sourceSurface
        })
    };
}

function toHermesTaskDetail(task = {}, options = {}) {
    const base = toHermesTaskListItem(task, options);
    const subtasks = Array.isArray(options.subtasks)
        ? options.subtasks
        : (Array.isArray(task.subtasks) ? task.subtasks : []);
    const history = Array.isArray(options.history)
        ? options.history
        : (Array.isArray(task.history) ? task.history : []);
    return {
        ...base,
        creator: creatorForTask(task),
        client: clientForTask(task),
        subtasks: subtasks.map(toHermesSubtask),
        history: history.map(toHermesTaskHistoryEvent)
    };
}

function clampLimit(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return MAX_HERMES_LIMIT;
    return Math.min(parsed, MAX_HERMES_LIMIT);
}

function toHermesPagination(input = {}, options = {}) {
    const source = Array.isArray(input) ? options : (input || {});
    const nextCursor = source.next_cursor ?? source.nextCursor ?? null;
    const hasMore = source.has_more ?? source.hasMore ?? Boolean(nextCursor);
    return {
        next_cursor: nextCursor ? String(nextCursor) : null,
        has_more: Boolean(hasMore),
        limit: clampLimit(source.limit)
    };
}

module.exports = {
    MAX_HERMES_LIMIT,
    toHermesTaskListItem,
    toHermesTaskDetail,
    toHermesTaskHistoryEvent,
    toHermesPagination
};
