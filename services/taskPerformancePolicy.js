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

module.exports = {
    TASK_PERFORMANCE_POLICY_VERSION,
    OWNER_ACCEPTANCE_ACTIONS,
    taskKpiEligibleSql,
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
