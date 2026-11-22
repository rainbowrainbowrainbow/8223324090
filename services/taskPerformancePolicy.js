'use strict';

const {
    OWNER_ACCEPTANCE_ACTIONS,
    TASK_AUTOMATION_POLICY_VERSION,
    taskActiveWorkSql,
    taskCanonicalOverdueSql,
    taskCompletedSql,
    taskHumanCreatedSql,
    taskKpiEligibleSql,
    taskMachineSignalSql,
    taskOwnerAcceptedSql,
    taskProtectedKpiSignalSql,
    taskTerminalExclusionSql,
    taskWorkloadDateSql
} = require('./taskAutomationPolicy');

const TASK_PERFORMANCE_POLICY_VERSION = `${TASK_AUTOMATION_POLICY_VERSION}:performance_v2`;

function taskKpiCompletionJoinSql(task = 't', completion = 'completion') {
    return `LEFT JOIN LATERAL (
        SELECT h.actor_user_id, h.new_value_json FROM task_action_history h
        WHERE h.task_id = ${task}.id AND h.action_type = 'task_completed'
          AND h.created_at = ${task}.completed_at AT TIME ZONE 'UTC'
        ORDER BY h.id DESC LIMIT 1
    ) ${completion} ON TRUE`;
}

function taskKpiPrimaryOwnerSql(task = 't', completion = 'completion') {
    return `CASE WHEN ${taskCompletedSql(task)} AND ${completion}.new_value_json ? 'ownerUserId'
        THEN CASE WHEN jsonb_typeof(${completion}.new_value_json->'ownerUserId') = 'number'
                  THEN (${completion}.new_value_json->>'ownerUserId')::numeric END
        ELSE ${task}.owner_user_id END`;
}

function taskKpiDaySql(column) {
    return `((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Kyiv')::date`;
}

function taskKpiPeriodSql(task, from, through) {
    return `(${taskKpiDaySql(`${task}.created_at`)} BETWEEN ${from} AND ${through}
        OR ${taskKpiDaySql(`${task}.completed_at`)} BETWEEN ${from} AND ${through})`;
}

module.exports = {
    taskKpiPeriodSql,
    TASK_PERFORMANCE_POLICY_VERSION,
    OWNER_ACCEPTANCE_ACTIONS,
    taskKpiEligibleSql,
    taskKpiCompletionJoinSql,
    taskKpiPrimaryOwnerSql,
    taskKpiDaySql,
    taskKpiHumanCreatedSql: taskHumanCreatedSql,
    taskKpiMachineSignalSql: taskMachineSignalSql,
    taskKpiOwnerAcceptedSql: taskOwnerAcceptedSql,
    taskKpiProtectedSignalSql: taskProtectedKpiSignalSql,
    taskKpiTerminalExclusionSql: taskTerminalExclusionSql,
    taskKpiActiveWorkSql: taskActiveWorkSql,
    taskKpiCanonicalOverdueSql: taskCanonicalOverdueSql,
    taskKpiCompletedSql: taskCompletedSql,
    taskKpiWorkloadDateSql: taskWorkloadDateSql
};
