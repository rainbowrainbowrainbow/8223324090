'use strict';

const { TASK_ACTION_TYPES } = require('./taskActionConstants');

const TASK_AUTOMATION_POLICY_VERSION = 'task_automation_policy_v1';
const TASK_AUTOMATION_MARKER_SCOPE_VERSION = 'task_automation_marker_scope_v1';
const MACHINE_LIFECYCLE_MARKER_VERSION = 'machine_lifecycle_marker_v1_2026_08_11';
const MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING = 'strict_cancelled_booking_auto_archive_v1_2026_08_11';

const TERMINAL_STATUSES = Object.freeze(['done', 'completed', 'complete', 'cancelled', 'canceled', 'archived']);
const KPI_EXCLUDED_STATUSES = Object.freeze(['archived', 'cancelled', 'canceled']);
const PRIVATE_OR_PERSONAL = Object.freeze(['private', 'me_only', 'personal']);
const SYSTEM_ACTORS = Object.freeze(['', 'system', 'scheduler', 'kleshnya', 'rule_engine', 'task_lifecycle', 'automation', 'attendance-review-scheduler']);
const MACHINE_CREATORS = Object.freeze(['system', 'scheduler', 'kleshnya', 'rule_engine', 'task_lifecycle', 'attendance-review-scheduler']);
const MACHINE_TASK_TYPES = Object.freeze(['auto', 'auto_complete', 'recurring']);
const MACHINE_SOURCE_TYPES = Object.freeze(['booking', 'recurring', 'attendance', 'attendance_daily_review']);
const PROTECTED_SOURCE_TYPES = Object.freeze(['ai_draft', 'ai_draft_bundle', 'hermes', 'integration', 'attendance', 'attendance_daily_review']);
const INTEGRATION_SOURCE_TYPES = Object.freeze(['hermes', 'integration']);
const AI_SOURCE_TYPES = Object.freeze(['ai_draft', 'ai_draft_bundle']);
const AUTOMATION_MARKER_SOURCE_TYPES = Object.freeze([
    'automation',
    'trigger',
    'booking',
    'recurring',
    'attendance',
    'attendance_daily_review',
    'hermes',
    'integration',
    'ai_draft',
    'ai_draft_bundle'
]);
const AUTOMATION_MARKER_TASK_TYPES = Object.freeze(['auto', 'auto_complete', 'recurring', 'ai_draft', 'ai_draft_bundle']);
const AUTOMATION_MARKER_CREATORS = Object.freeze([...MACHINE_CREATORS, 'automation']);
const BOOKING_TERMINAL_STATUSES = Object.freeze(['cancelled', 'canceled']);

const OWNER_ACCEPTANCE_ACTIONS = Object.freeze([
    TASK_ACTION_TYPES.ACKNOWLEDGED,
    TASK_ACTION_TYPES.COMPLETED,
    TASK_ACTION_TYPES.STATUS_CHANGED,
    TASK_ACTION_TYPES.RESCHEDULED,
    TASK_ACTION_TYPES.SNOOZED,
    TASK_ACTION_TYPES.SCHEDULED,
    TASK_ACTION_TYPES.SCHEDULE_MOVED,
    TASK_ACTION_TYPES.SCHEDULE_MANUAL_OVERRIDE,
    TASK_ACTION_TYPES.PRIORITY_CHANGED,
    TASK_ACTION_TYPES.SUBTASK_COMPLETED,
    TASK_ACTION_TYPES.URGENT_COMMITMENT_SET,
    TASK_ACTION_TYPES.COMMENTED
].filter(Boolean));

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function numeric(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function quoteSqlList(values) {
    return values.map(value => `'${String(value).replace(/'/g, "''")}'`).join(', ');
}

function listToSql(values) {
    return quoteSqlList(values);
}

function hasTypedCreator(row = {}) {
    return numeric(row.created_by_user_id) > 0;
}

function isTerminalStatus(value) {
    return TERMINAL_STATUSES.includes(normalize(value));
}

function isTerminalOrArchived(row = {}) {
    return Boolean(row.archived_at) || bool(row.archived) || isTerminalStatus(row.task_status || row.status);
}

function isPrivateOrPersonal(row = {}) {
    return PRIVATE_OR_PERSONAL.includes(normalize(row.visibility))
        || PRIVATE_OR_PERSONAL.includes(normalize(row.task_mode));
}

function isAiAssisted(row = {}) {
    const sourceType = normalize(row.source_type);
    const taskType = normalize(row.type || row.task_type || row.task_type_legacy);
    return AI_SOURCE_TYPES.includes(sourceType)
        || AI_SOURCE_TYPES.includes(taskType)
        || numeric(row.ai_bundle_count) > 0;
}

function isIntegration(row = {}) {
    const sourceType = normalize(row.source_type);
    const sourceModule = normalize(row.source_module);
    const creatorClass = normalize(row.creator_class || row.created_by_normalized || row.created_by);
    return INTEGRATION_SOURCE_TYPES.includes(sourceType)
        || INTEGRATION_SOURCE_TYPES.includes(sourceModule)
        || /hermes|integration/.test(creatorClass);
}

function isAttendance(row = {}) {
    return normalize(row.source_type) === 'attendance'
        || normalize(row.source_type) === 'attendance_daily_review'
        || normalize(row.source_module) === 'attendance';
}

function hasStrictMachineProvenance(row = {}) {
    if (hasTypedCreator(row)) return false;
    const sourceType = normalize(row.source_type);
    const taskType = normalize(row.type || row.task_type || row.task_type_legacy);
    const creator = normalize(row.creator_class || row.created_by_normalized || row.created_by);
    if (sourceType === 'booking' && creator === 'rule_engine' && MACHINE_TASK_TYPES.includes(taskType)) return true;
    if (sourceType === 'recurring' && creator === 'system' && taskType === 'recurring') return true;
    if (sourceType === 'attendance_daily_review' && creator === 'attendance-review-scheduler') return true;
    return false;
}

function protectionFlags(row = {}) {
    const flags = [];
    if (hasTypedCreator(row)) flags.push('typed_creator');
    if (isPrivateOrPersonal(row)) flags.push('private_or_personal');
    if (normalize(row.task_status || row.status) === 'in_progress' || normalize(row.workflow_state) === 'in_progress') flags.push('in_progress');
    if (numeric(row.focus_rank) > 0 || bool(row.is_focused)) flags.push('focus');
    if (bool(row.has_future_snooze) || bool(row.has_snooze)) flags.push('snooze');
    if (bool(row.human_touched)) flags.push('human_touched');
    if (numeric(row.subtask_count) > 0) flags.push('subtasks');
    if (numeric(row.dependency_count) > 0) flags.push('dependencies');
    if (numeric(row.observer_count) > 0) flags.push('observers');
    if (isAiAssisted(row)) flags.push('ai_assisted');
    if (isIntegration(row)) flags.push('integration');
    if (isAttendance(row)) flags.push('attendance');
    return flags;
}

function classifyTaskAutomation(row = {}) {
    if (isTerminalOrArchived(row) || !bool(row.active ?? true)) {
        return { classification: 'terminal_or_archived', protected: true, reason: 'terminal_or_archived' };
    }
    if (isAiAssisted(row)) return { classification: 'ambiguous_protected', protected: true, reason: 'ai_assisted' };
    if (isIntegration(row)) return { classification: 'ambiguous_protected', protected: true, reason: 'integration' };
    if (isAttendance(row)) return { classification: 'ambiguous_protected', protected: true, reason: 'attendance' };
    if (isPrivateOrPersonal(row)) return { classification: 'ambiguous_protected', protected: true, reason: 'private_or_personal' };
    if (hasTypedCreator(row)) return { classification: 'human_created', protected: true, reason: 'typed_creator' };
    const flags = protectionFlags(row);
    if (flags.length) {
        return { classification: 'ambiguous_protected', protected: true, reason: flags.join(',') };
    }
    if (hasStrictMachineProvenance(row)) {
        return bool(row.owner_accepted)
            ? { classification: 'machine_owner_accepted', protected: false, reason: 'owner_accepted' }
            : { classification: 'machine_unaccepted', protected: false, reason: 'strict_machine_unaccepted' };
    }
    const sourceType = normalize(row.source_type);
    const taskType = normalize(row.type || row.task_type || row.task_type_legacy);
    const creator = normalize(row.creator_class || row.created_by_normalized || row.created_by);
    if (
        MACHINE_SOURCE_TYPES.includes(sourceType)
        || MACHINE_TASK_TYPES.includes(taskType)
        || MACHINE_CREATORS.includes(creator)
    ) {
        return { classification: 'ambiguous_protected', protected: true, reason: 'unproven_machine_lineage' };
    }
    return { classification: 'human_created', protected: true, reason: 'manual_or_human' };
}

function isKpiExcluded(row = {}) {
    return Boolean(row.archived_at)
        || bool(row.archived)
        || KPI_EXCLUDED_STATUSES.includes(normalize(row.task_status || row.status));
}

function hasMachineSignal(row = {}) {
    const sourceType = normalize(row.source_type);
    const taskType = normalize(row.type || row.task_type || row.task_type_legacy);
    const creator = normalize(row.creator_class || row.created_by_normalized || row.created_by);
    const sourceModule = normalize(row.source_module);
    return MACHINE_CREATORS.includes(creator)
        || [...MACHINE_SOURCE_TYPES, ...PROTECTED_SOURCE_TYPES].includes(sourceType)
        || MACHINE_TASK_TYPES.includes(taskType)
        || AI_SOURCE_TYPES.includes(taskType)
        || /attendance|hermes|integration|ai/.test(sourceModule);
}

function hasHumanCreatedSignal(row = {}) {
    const sourceType = normalize(row.source_type);
    const taskType = normalize(row.type || row.task_type || row.task_type_legacy);
    const creator = normalize(row.creator_class || row.created_by_normalized || row.created_by);
    return hasTypedCreator(row)
        || (
            sourceType === 'manual'
            && !MACHINE_TASK_TYPES.includes(taskType)
            && !MACHINE_CREATORS.includes(creator)
        );
}

function hasProtectedKpiSignal(row = {}) {
    return isPrivateOrPersonal(row)
        || isAiAssisted(row)
        || isIntegration(row)
        || isAttendance(row);
}

function hasAutomationMarkerScope(row = {}) {
    const sourceType = normalize(row.source_type);
    const sourceModule = normalize(row.source_module);
    const sourceEntityType = normalize(row.source_entity_type);
    const relatedEntityType = normalize(row.related_entity_type);
    const taskType = normalize(row.type || row.task_type || row.task_type_legacy);
    const creator = normalize(row.creator_class || row.created_by_normalized || row.created_by);
    return AUTOMATION_MARKER_SOURCE_TYPES.includes(sourceType)
        || AUTOMATION_MARKER_SOURCE_TYPES.includes(sourceModule)
        || AUTOMATION_MARKER_SOURCE_TYPES.includes(sourceEntityType)
        || AUTOMATION_MARKER_SOURCE_TYPES.includes(relatedEntityType)
        || AUTOMATION_MARKER_TASK_TYPES.includes(taskType)
        || AUTOMATION_MARKER_CREATORS.includes(creator)
        || bool(row.has_template_id)
        || numeric(row.template_id) > 0;
}

function classifyTaskKpiEligibility(row = {}) {
    if (isKpiExcluded(row)) {
        return { eligible: false, classification: 'terminal_excluded', reason: 'archived_or_cancelled' };
    }
    if (isPrivateOrPersonal(row)) {
        return { eligible: false, classification: 'ambiguous_excluded', reason: 'private_or_personal' };
    }
    if (isAiAssisted(row)) {
        return { eligible: false, classification: 'ambiguous_excluded', reason: 'ai_assisted' };
    }
    if (isIntegration(row)) {
        return { eligible: false, classification: 'ambiguous_excluded', reason: 'integration' };
    }
    if (isAttendance(row)) {
        return { eligible: false, classification: 'ambiguous_excluded', reason: 'attendance' };
    }
    if (hasMachineSignal(row)) {
        if (bool(row.owner_accepted || row.ownerAccepted || row.has_owner_acceptance)) {
            return { eligible: true, classification: 'machine_owner_accepted', reason: 'owner_action_history' };
        }
        return { eligible: false, classification: 'machine_unaccepted', reason: 'missing_owner_action_history' };
    }
    if (hasHumanCreatedSignal(row)) {
        return { eligible: true, classification: 'human_created', reason: 'human_created' };
    }
    return { eligible: false, classification: 'ambiguous_excluded', reason: 'ambiguous_provenance' };
}

function taskTerminalExclusionSql(taskAlias = 't') {
    return `(
        ${taskAlias}.archived_at IS NOT NULL
        OR LOWER(COALESCE(${taskAlias}.status, 'todo')) IN (${listToSql(KPI_EXCLUDED_STATUSES)})
    )`;
}

function taskMachineSignalSql(taskAlias = 't') {
    return `(
        LOWER(COALESCE(${taskAlias}.created_by, '')) IN (${listToSql(MACHINE_CREATORS)})
        OR LOWER(COALESCE(${taskAlias}.source_type, '')) IN (${listToSql([...MACHINE_SOURCE_TYPES, ...PROTECTED_SOURCE_TYPES])})
        OR LOWER(COALESCE(${taskAlias}.type, '')) IN (${listToSql(MACHINE_TASK_TYPES)})
        OR LOWER(COALESCE(${taskAlias}.type, '')) IN (${listToSql(AI_SOURCE_TYPES)})
        OR LOWER(COALESCE(${taskAlias}.source_module, '')) ~ '(attendance|hermes|integration|ai)'
        OR LOWER(COALESCE(${taskAlias}.source_entity_type, '')) ~ '(attendance|hermes|integration|ai)'
        OR LOWER(COALESCE(${taskAlias}.related_entity_type, '')) ~ '(attendance|hermes|integration|ai)'
    )`;
}

function taskProtectedKpiSignalSql(taskAlias = 't') {
    return `(
        LOWER(COALESCE(${taskAlias}.visibility, '')) IN (${listToSql(PRIVATE_OR_PERSONAL)})
        OR LOWER(COALESCE(${taskAlias}.task_mode, '')) IN (${listToSql(PRIVATE_OR_PERSONAL)})
        OR LOWER(COALESCE(${taskAlias}.source_type, '')) IN (${listToSql(PROTECTED_SOURCE_TYPES)})
        OR LOWER(COALESCE(${taskAlias}.type, '')) IN (${listToSql([...AI_SOURCE_TYPES, 'attendance', 'attendance_daily_review'])})
        OR LOWER(COALESCE(${taskAlias}.source_module, '')) ~ '(attendance|hermes|integration|ai)'
        OR LOWER(COALESCE(${taskAlias}.source_entity_type, '')) ~ '(attendance|hermes|integration|ai)'
        OR LOWER(COALESCE(${taskAlias}.related_entity_type, '')) ~ '(attendance|hermes|integration|ai)'
    )`;
}

function taskStrictMachineSignalSql(taskAlias = 't') {
    return `(
        COALESCE(${taskAlias}.created_by_user_id, 0) = 0
        AND (
            (
                LOWER(COALESCE(${taskAlias}.source_type, '')) = 'booking'
                AND LOWER(COALESCE(${taskAlias}.created_by, '')) = 'rule_engine'
                AND LOWER(COALESCE(${taskAlias}.type, '')) IN ('auto', 'auto_complete')
            )
            OR (
                LOWER(COALESCE(${taskAlias}.source_type, '')) = 'recurring'
                AND LOWER(COALESCE(${taskAlias}.created_by, '')) = 'system'
                AND LOWER(COALESCE(${taskAlias}.type, '')) = 'recurring'
            )
        )
    )`;
}

function taskHumanCreatedSql(taskAlias = 't') {
    return `(
        COALESCE(${taskAlias}.created_by_user_id, 0) > 0
        OR (
            LOWER(COALESCE(${taskAlias}.source_type, '')) = 'manual'
            AND LOWER(COALESCE(${taskAlias}.type, '')) NOT IN (${listToSql(MACHINE_TASK_TYPES)})
            AND LOWER(COALESCE(${taskAlias}.created_by, '')) NOT IN (${listToSql(MACHINE_CREATORS)})
        )
    )`;
}

function taskOwnerAcceptedSql(taskAlias = 't', historyAlias = 'task_owner_acceptance_history') {
    return `EXISTS (
        SELECT 1
        FROM task_action_history ${historyAlias}
        WHERE ${historyAlias}.task_id = ${taskAlias}.id
          AND ${historyAlias}.actor_user_id = ${taskAlias}.owner_user_id
          AND ${historyAlias}.actor_user_id IS NOT NULL
          AND ${historyAlias}.action_type IN (${listToSql(OWNER_ACCEPTANCE_ACTIONS)})
        LIMIT 1
    )`;
}

function taskKpiEligibleSql(taskAlias = 't') {
    return `(
        NOT ${taskTerminalExclusionSql(taskAlias)}
        AND NOT ${taskProtectedKpiSignalSql(taskAlias)}
        AND (
            (
                NOT ${taskMachineSignalSql(taskAlias)}
                AND ${taskHumanCreatedSql(taskAlias)}
            )
            OR (
                ${taskMachineSignalSql(taskAlias)}
                AND ${taskOwnerAcceptedSql(taskAlias)}
            )
        )
    )`;
}

function taskCompletedSql(taskAlias = 't') {
    return `LOWER(COALESCE(${taskAlias}.status, 'todo')) IN ('done', 'completed', 'complete')`;
}

function taskActiveWorkSql(taskAlias = 't') {
    return `(
        ${taskAlias}.archived_at IS NULL
        AND LOWER(COALESCE(${taskAlias}.status, 'todo')) NOT IN ('done', 'completed', 'complete', 'cancelled', 'canceled', 'archived')
    )`;
}

function taskWorkloadDateSql(taskAlias = 't') {
    return `COALESCE(
        (${taskAlias}.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date,
        (${taskAlias}.snoozed_until AT TIME ZONE 'Europe/Kyiv')::date,
        CASE WHEN LEFT(COALESCE(${taskAlias}.date, ''), 10) ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN LEFT(${taskAlias}.date, 10)::date END,
        (${taskAlias}.deadline AT TIME ZONE 'Europe/Kyiv')::date,
        (${taskAlias}.remind_at AT TIME ZONE 'Europe/Kyiv')::date
    )`;
}

function taskCanonicalOverdueSql(taskAlias = 't', todaySql = "(NOW() AT TIME ZONE 'Europe/Kyiv')::date") {
    return `(
        ${taskActiveWorkSql(taskAlias)}
        AND ${taskKpiEligibleSql(taskAlias)}
        AND NOT (${taskAlias}.snoozed_until IS NOT NULL AND ${taskAlias}.snoozed_until > NOW())
        AND ${taskWorkloadDateSql(taskAlias)} IS NOT NULL
        AND ${taskWorkloadDateSql(taskAlias)} < ${todaySql}
    )`;
}

function taskHumanTouchSql(taskAlias = 't', options = {}) {
    const logAlias = options.logAlias || 'tl';
    const historyAlias = options.historyAlias || 'tah';
    const checks = [];
    if (options.includeTaskLogs !== false) {
        checks.push(`EXISTS (
            SELECT 1
            FROM task_logs ${logAlias}
            WHERE ${logAlias}.task_id = ${taskAlias}.id
              AND LOWER(COALESCE(${logAlias}.actor, '')) NOT IN (${listToSql(SYSTEM_ACTORS)})
            LIMIT 1
        )`);
    }
    if (options.includeTaskActionHistory !== false) {
        checks.push(`EXISTS (
            SELECT 1
            FROM task_action_history ${historyAlias}
            WHERE ${historyAlias}.task_id = ${taskAlias}.id
              AND (
                  ${historyAlias}.actor_user_id IS NOT NULL
                  OR LOWER(COALESCE(${historyAlias}.actor_name_snapshot, '')) NOT IN (${listToSql(SYSTEM_ACTORS)})
              )
            LIMIT 1
        )`);
    }
    return checks.length ? `(${checks.join('\n        OR ')})` : 'FALSE';
}

function buildMachineTaskControlMetaPatch(source, details = {}) {
    const patch = {
        automationProvenance: {
            policyVersion: TASK_AUTOMATION_POLICY_VERSION,
            source,
            serviceOwned: true,
            triggerActor: details.triggerActor || null,
            ruleCode: details.ruleCode || null,
            ruleId: details.ruleId || null,
            eventId: details.eventId || null
        }
    };

    patch.machineLifecycle = {
        markerVersion: MACHINE_LIFECYCLE_MARKER_VERSION,
        serviceOwned: true,
        source,
        autoArchivePolicy: details.lifecycleAutoArchivePolicy || null
    };

    return patch;
}

function isTrustedCancelledBookingAutoArchiveMarked(row = {}) {
    const controlMeta = row.control_meta || row.controlMeta || {};
    const lifecycle = controlMeta.machineLifecycle || {};
    return lifecycle.markerVersion === MACHINE_LIFECYCLE_MARKER_VERSION
        && lifecycle.serviceOwned === true
        && lifecycle.autoArchivePolicy === MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING;
}

module.exports = {
    AI_SOURCE_TYPES,
    AUTOMATION_MARKER_CREATORS,
    AUTOMATION_MARKER_SOURCE_TYPES,
    AUTOMATION_MARKER_TASK_TYPES,
    BOOKING_TERMINAL_STATUSES,
    INTEGRATION_SOURCE_TYPES,
    KPI_EXCLUDED_STATUSES,
    MACHINE_CREATORS,
    MACHINE_AUTO_ARCHIVE_POLICY_CANCELLED_BOOKING,
    MACHINE_LIFECYCLE_MARKER_VERSION,
    MACHINE_SOURCE_TYPES,
    MACHINE_TASK_TYPES,
    OWNER_ACCEPTANCE_ACTIONS,
    PRIVATE_OR_PERSONAL,
    PROTECTED_SOURCE_TYPES,
    SYSTEM_ACTORS,
    TASK_AUTOMATION_POLICY_VERSION,
    TASK_AUTOMATION_MARKER_SCOPE_VERSION,
    TERMINAL_STATUSES,
    bool,
    buildMachineTaskControlMetaPatch,
    classifyTaskAutomation,
    classifyTaskKpiEligibility,
    hasAutomationMarkerScope,
    hasProtectedKpiSignal,
    hasStrictMachineProvenance,
    isAiAssisted,
    isAttendance,
    isIntegration,
    isPrivateOrPersonal,
    isTerminalOrArchived,
    isTerminalStatus,
    isTrustedCancelledBookingAutoArchiveMarked,
    normalize,
    numeric,
    protectionFlags,
    taskActiveWorkSql,
    taskCanonicalOverdueSql,
    taskCompletedSql,
    taskHumanCreatedSql,
    taskHumanTouchSql,
    taskKpiEligibleSql,
    taskMachineSignalSql,
    taskOwnerAcceptedSql,
    taskProtectedKpiSignalSql,
    taskStrictMachineSignalSql,
    taskTerminalExclusionSql,
    taskWorkloadDateSql
};
