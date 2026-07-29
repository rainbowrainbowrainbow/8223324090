'use strict';

const PRIORITY_RANK = Object.freeze({ low: 0, normal: 1, high: 2, urgent: 3 });
const POSTPONEMENT_ACTOR_TYPES = new Set(['manual', 'bot', 'system']);
const EXCLUDED_POSTPONEMENT_MUTATIONS = new Set(['snooze', 'technical_correction']);

function normalizePostponementCount(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function postponementAttentionLevel(value) {
    return Math.min(3, normalizePostponementCount(value));
}

function minimumPriorityForPostponement(value) {
    const level = postponementAttentionLevel(value);
    if (level >= 2) return 'urgent';
    if (level === 1) return 'high';
    return null;
}

function normalizeTaskPriority(value) {
    const priority = String(value || 'normal').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, priority) ? priority : 'normal';
}

function derivePostponementPriority(value, currentPriority) {
    const count = normalizePostponementCount(value);
    const attentionLevel = postponementAttentionLevel(count);
    const priorityBefore = normalizeTaskPriority(currentPriority);
    const minimumPriority = minimumPriorityForPostponement(count);
    const priorityAfter = minimumPriority && PRIORITY_RANK[minimumPriority] > PRIORITY_RANK[priorityBefore]
        ? minimumPriority
        : priorityBefore;
    return {
        count,
        attentionLevel,
        minimumPriority,
        priorityBefore,
        priorityAfter,
        priorityEscalated: priorityAfter !== priorityBefore
    };
}

function isPenaltyPostponementEvent(event = {}) {
    const meta = event.meta && typeof event.meta === 'object' ? event.meta : {};
    const mutationKind = String(meta.mutationKind || '').trim().toLowerCase();
    return event.actionType === 'task_rescheduled'
        && meta.countsAsPostponement === true
        && !EXCLUDED_POSTPONEMENT_MUTATIONS.has(mutationKind);
}

function normalizePostponementActorType(event = {}) {
    if (!isPenaltyPostponementEvent(event)) return null;
    const meta = event.meta && typeof event.meta === 'object' ? event.meta : {};
    const explicitType = String(meta.actorType || '').trim().toLowerCase();
    if (POSTPONEMENT_ACTOR_TYPES.has(explicitType)) return explicitType;
    const source = String(event.sourceSurface || meta.sourceSurface || '').trim().toLowerCase();
    if (source.includes('hermes')) return 'bot';
    if (source.includes('watchdog') || source.includes('scheduler')) return 'system';
    return event.actor?.name ? 'manual' : 'system';
}

function normalizePostponementSourceSurface(event = {}, actorType = null) {
    if (!isPenaltyPostponementEvent(event)) return null;
    const meta = event.meta && typeof event.meta === 'object' ? event.meta : {};
    const source = String(event.sourceSurface || meta.sourceSurface || '').trim().toLowerCase();
    if (source.includes('hermes')) return 'hermes';
    if (source.includes('watchdog')) return 'task_watchdog';
    if (source.includes('scheduler')) return 'scheduler';
    if (source.includes('profile_my_cabinet')) return 'my_day';
    if (source.includes('alert')) return 'alerts';
    if (source.includes('work_queue') || source.includes('manager_queue')) return 'work_queue';
    if (source.includes('task_detail') || source.includes('tasks')) return 'tasks';
    if (actorType === 'bot') return 'bot';
    if (actorType === 'system') return 'system';
    return 'manual';
}

function historyDueValue(value = {}) {
    if (!value || typeof value !== 'object') return null;
    if (value.instant || value.value) return value.instant || value.value;
    return value.scheduledStartAt
        || value.scheduled_start_at
        || value.deadline
        || value.date
        || null;
}

function optionalPriority(value) {
    const priority = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, priority) ? priority : null;
}

function buildPostponementExplanation(task = {}, event = null) {
    const count = normalizePostponementCount(task.postponement_count ?? task.postponementCount);
    if (!count) return null;

    const validEvent = isPenaltyPostponementEvent(event || {}) ? event : null;
    const meta = validEvent?.meta && typeof validEvent.meta === 'object' ? validEvent.meta : {};
    const actorType = validEvent ? normalizePostponementActorType(validEvent) : null;
    const sourceSurface = validEvent ? normalizePostponementSourceSurface(validEvent, actorType) : null;
    const actorName = actorType === 'system'
        ? '\u0421\u0438\u0441\u0442\u0435\u043c\u0430'
        : sourceSurface === 'hermes'
            ? 'Hermes'
            : String(validEvent?.actor?.name || '').trim() || null;
    const priorityBefore = optionalPriority(meta.priorityBefore);
    const priorityAfter = optionalPriority(meta.priorityAfter);

    return {
        count,
        attentionLevel: postponementAttentionLevel(count),
        lastPostponedAt: task.last_postponed_at || task.lastPostponedAt || validEvent?.createdAt || null,
        actorType,
        actorName,
        sourceSurface,
        reason: validEvent && meta.reason !== undefined && meta.reason !== null
            ? String(meta.reason).trim() || null
            : null,
        oldDue: validEvent ? historyDueValue(meta.oldDue) || historyDueValue(validEvent.oldValue) : null,
        newDue: validEvent ? historyDueValue(meta.newDue) || historyDueValue(validEvent.newValue) : null,
        priorityBefore,
        priorityAfter,
        priorityEscalated: validEvent
            ? typeof meta.priorityEscalated === 'boolean'
                ? meta.priorityEscalated
                : Boolean(priorityBefore && priorityAfter && priorityBefore !== priorityAfter)
            : null
    };
}

module.exports = {
    buildPostponementExplanation,
    derivePostponementPriority,
    isPenaltyPostponementEvent,
    minimumPriorityForPostponement,
    normalizePostponementActorType,
    normalizePostponementCount,
    normalizePostponementSourceSurface,
    normalizeTaskPriority,
    postponementAttentionLevel
};
