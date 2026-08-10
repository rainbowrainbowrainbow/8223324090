'use strict';

const TASK_PERFORMANCE_POLICY_VERSION = 'task_performance_policy_v1';

const OWNER_ACCEPTANCE_ACTIONS = [
    'completed',
    'status_changed',
    'status_update',
    'task_completed',
    'task_acknowledged',
    'rescheduled',
    'snoozed',
    'scheduled',
    'commented',
    'subtask_completed',
    'urgent_commitment'
];

function quoteSqlList(values) {
    return values.map(value => `'${String(value).replace(/'/g, "''")}'`).join(', ');
}

function taskKpiTerminalExclusionSql(taskAlias = 't') {
    return `(
        ${taskAlias}.archived_at IS NOT NULL
        OR LOWER(COALESCE(${taskAlias}.status, 'todo')) IN ('archived', 'cancelled', 'canceled')
    )`;
}

function taskKpiMachineSignalSql(taskAlias = 't') {
    return `(
        LOWER(COALESCE(${taskAlias}.created_by, '')) IN ('system', 'scheduler', 'kleshnya', 'rule_engine', 'task_lifecycle', 'attendance-review-scheduler')
        OR LOWER(COALESCE(${taskAlias}.source_type, '')) IN ('booking', 'recurring', 'attendance', 'attendance_daily_review', 'hermes', 'integration')
        OR LOWER(COALESCE(${taskAlias}.type, '')) IN ('auto', 'auto_complete', 'recurring')
        OR LOWER(COALESCE(${taskAlias}.source_module, '')) ~ '(attendance|hermes|integration)'
        OR LOWER(COALESCE(${taskAlias}.source_entity_type, '')) ~ '(attendance|hermes|integration)'
        OR LOWER(COALESCE(${taskAlias}.related_entity_type, '')) ~ '(attendance|hermes|integration)'
    )`;
}

function taskKpiHumanCreatedSql(taskAlias = 't') {
    return `(
        COALESCE(${taskAlias}.created_by_user_id, 0) > 0
        OR (
            LOWER(COALESCE(${taskAlias}.source_type, 'manual')) = 'manual'
            AND LOWER(COALESCE(${taskAlias}.type, 'manual')) NOT IN ('auto', 'auto_complete', 'recurring')
            AND LOWER(COALESCE(${taskAlias}.created_by, '')) NOT IN ('system', 'scheduler', 'kleshnya', 'rule_engine', 'task_lifecycle', 'attendance-review-scheduler')
        )
    )`;
}

function taskKpiOwnerAcceptedSql(taskAlias = 't') {
    return `(
        LOWER(COALESCE(${taskAlias}.status, 'todo')) IN ('done', 'completed')
        OR EXISTS (
            SELECT 1
            FROM task_action_history task_kpi_history
            WHERE task_kpi_history.task_id = ${taskAlias}.id
              AND task_kpi_history.actor_user_id = ${taskAlias}.owner_user_id
              AND task_kpi_history.action_type IN (${quoteSqlList(OWNER_ACCEPTANCE_ACTIONS)})
            LIMIT 1
        )
    )`;
}

function taskKpiEligibleSql(taskAlias = 't') {
    return `(
        NOT ${taskKpiTerminalExclusionSql(taskAlias)}
        AND (
            ${taskKpiHumanCreatedSql(taskAlias)}
            OR (
                ${taskKpiMachineSignalSql(taskAlias)}
                AND ${taskKpiOwnerAcceptedSql(taskAlias)}
            )
        )
    )`;
}

module.exports = {
    TASK_PERFORMANCE_POLICY_VERSION,
    OWNER_ACCEPTANCE_ACTIONS,
    taskKpiEligibleSql,
    taskKpiHumanCreatedSql,
    taskKpiMachineSignalSql,
    taskKpiOwnerAcceptedSql,
    taskKpiTerminalExclusionSql
};
