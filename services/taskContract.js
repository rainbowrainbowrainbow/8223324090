'use strict';

/**
 * Canonical task response contract shared by the Tasks API and My Day projection.
 * It adds stable camelCase read fields without removing legacy database fields.
 */
const {
    canMutateTask,
    canReassignTask,
    canRescheduleTask,
    taskOwnerState
} = require('./taskPolicy');
const { getPermissions } = require('../config/roles');
const { attachTaskSchedule } = require('./taskScheduling');
const {
    taskCompletionReportId,
    taskControlMeta,
    taskRequiresCompletionReport
} = require('./taskExecution');
const { normalizeSubtaskRow, subtaskProgress } = require('./taskSubtasks');
const { deriveTaskIntelligence } = require('./taskIntelligence');
const {
    buildPostponementExplanation,
    normalizePostponementCount,
    postponementAttentionLevel
} = require('./taskPostponementPolicy');

function workflowFromStatus(status = 'todo') {
    if (status === 'done') return 'done';
    if (status === 'archived') return 'archived';
    if (status === 'in_progress') return 'in_progress';
    return 'todo';
}

function isExplicitFalse(value) {
    return value === false || value === 'false' || value === '0' || value === 0 || value === 'off' || value === 'no';
}

function normalizeTaskPayload(row = {}, options = {}) {
    const scheduledRow = attachTaskSchedule(row);
    const ownerLabel = row.owner_name || row.owner_username || row.assigned_to || row.owner || null;
    const ownerState = taskOwnerState(row);
    const status = row.status || 'todo';
    const taskMode = row.task_mode || 'work';
    const taskKind = row.task_kind || 'action';
    const visibility = row.visibility || (taskMode === 'private' ? 'private' : 'team');
    const workflowState = row.workflow_state || workflowFromStatus(status);
    const controlMeta = taskControlMeta(row);
    const fallbackCanReschedule = !isExplicitFalse(controlMeta.canReschedule)
        && !isExplicitFalse(controlMeta.allowReschedule)
        && !isExplicitFalse(controlMeta.rescheduleAllowed);
    const user = options.user || null;
    const permissions = user ? getPermissions(user.role) : null;
    const canUseTaskWriteRoutes = Boolean(permissions?.canCreateTasks)
        || ['senior_instructor', 'instructor'].includes(String(user?.role || ''));
    const canMutate = user ? canMutateTask(user, row) : false;
    const actionPermissions = user ? {
        canMutate,
        canSplit: canUseTaskWriteRoutes && canMutate,
        canReassign: canReassignTask(user, row),
        canReschedule: canRescheduleTask(user, row),
        canArchive: canUseTaskWriteRoutes && canMutate
    } : null;
    const canReschedule = actionPermissions ? actionPermissions.canReschedule : fallbackCanReschedule;
    const reportId = taskCompletionReportId(row);
    const reportRequired = taskRequiresCompletionReport(row);
    const subtaskCount = Number(row.subtask_count || 0);
    const subtaskDoneCount = Number(row.subtask_done_count || 0);
    const progress = subtaskProgress(subtaskDoneCount, subtaskCount);
    const subtasks = Array.isArray(row.subtasks) ? row.subtasks.map(normalizeSubtaskRow) : [];
    const postponementCount = normalizePostponementCount(row.postponement_count ?? row.postponementCount);
    const postponementExplanation = buildPostponementExplanation(row, options.postponementEvent);

    return {
        ...scheduledRow,
        ownerLabel,
        ownerState,
        ownerUserId: row.owner_user_id || null,
        taskMode,
        taskKind,
        visibility,
        observerCount: Number(row.observer_count || 0),
        viewerIsObserver: row.viewer_is_observer === true,
        viewerObserverAccessLevel: row.viewer_observer_access_level || null,
        observers: Array.isArray(row.observers) ? row.observers : [],
        observerUserIds: Array.isArray(row.observers) ? row.observers.map(item => item.userId || item.user_id).filter(Boolean) : [],
        materialAccess: row.viewer_is_observer === true ? 'observer_full_read' : 'policy_default',
        workflowState,
        focusRank: row.focus_rank || 0,
        remindAt: row.remind_at || null,
        snoozedUntil: row.snoozed_until || null,
        postponementCount,
        attentionLevel: postponementAttentionLevel(postponementCount),
        originalDueAt: row.original_due_at || row.originalDueAt || null,
        lastPostponedAt: row.last_postponed_at || row.lastPostponedAt || null,
        ...(postponementExplanation ? { postponementExplanation } : {}),
        nextNotificationAt: row.next_notification_at || null,
        completedAt: row.completed_at || null,
        archivedAt: row.archived_at || null,
        archiveReason: row.archive_reason || null,
        duplicateOfTaskId: row.duplicate_of_task_id || null,
        eveningReviewDate: row.evening_review_date || null,
        relatedEntityType: row.related_entity_type || null,
        relatedEntityId: row.related_entity_id || null,
        sourceType: row.source_type || null,
        sourceId: row.source_id || null,
        sourceModule: row.source_module || null,
        sourceSurface: row.source_surface || null,
        creatorLabel: row.created_by || row.creator_name || row.creator_username || null,
        expectedResult: row.expected_result || row.expectedResult || null,
        effortMinutes: row.effort_minutes || null,
        subcategory: row.subcategory || null,
        checklistTemplateKey: row.checklist_template_key || null,
        sourceEntityType: row.source_entity_type || null,
        sourceEntityId: row.source_entity_id || null,
        packId: row.pack_id || null,
        packStatus: row.pack_status || null,
        ownerRole: row.owner_role || null,
        slaMinutes: row.sla_minutes || null,
        escalateAfter: row.escalate_after || null,
        controlMode: row.control_mode || 'normal',
        criticalReason: row.critical_reason || null,
        controlMeta,
        canReschedule,
        allowReschedule: canReschedule,
        ...(actionPermissions ? { actionPermissions } : {}),
        reportRequired,
        requiresReport: reportRequired,
        reportId,
        subtaskCount,
        subtaskDoneCount,
        subtaskProgress: progress,
        subtaskProgressPercent: progress,
        subtasks,
        dependencyCount: Number(row.dependency_count || 0),
        openDependencyCount: Number(row.open_dependency_count || 0),
        blockedByTitles: row.blocked_by_titles || null,
        dependencies: Array.isArray(row.dependencies) ? row.dependencies : [],
        isBlocked: Number(row.open_dependency_count || 0) > 0,
        intelligence: deriveTaskIntelligence({
            ...row,
            owner_label: ownerLabel,
            ownerState
        })
    };
}

module.exports = {
    normalizeTaskPayload,
    workflowFromStatus
};
