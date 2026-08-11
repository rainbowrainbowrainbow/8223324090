'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    PAYROLL_KPI_BONUS_RULE_VERSION,
    buildPayrollKpiAuditSnapshot,
    fetchPayrollKpiAuditSnapshots
} = require('../services/payroll');
const {
    TASK_PERFORMANCE_POLICY_VERSION,
    taskKpiEligibleSql,
    taskKpiMachineSignalSql
} = require('../services/taskPerformancePolicy');

test('payroll KPI audit snapshot query uses shared task KPI policy and exposes machine aggregates', async () => {
    const queries = [];
    const fakeDb = {
        async query(sql, params) {
            queries.push({ sql: String(sql), params });
            return {
                rows: [{
                    staff_id: 7,
                    source_timestamp: '2026-08-10T10:00:00.000Z',
                    tasks_assigned: 3,
                    tasks_done: 2,
                    tasks_overdue: 1,
                    tasks_machine_accepted: 1,
                    tasks_machine_excluded: 4,
                    tasks_ambiguous_excluded: 2,
                    onboarding_total: 0,
                    onboarding_completed: 0,
                    onboarding_active: 0,
                    onboarding_total_items: 0,
                    onboarding_completed_items: 0,
                    events_period: 0
                }]
            };
        }
    };

    const snapshots = await fetchPayrollKpiAuditSnapshots('2026-08', [7], fakeDb);
    const query = queries[0].sql;

    assert.match(query, /task_action_history/);
    assert.match(query, /actor_user_id = t\.owner_user_id/);
    assert.match(query, /tasks_machine_accepted/);
    assert.match(query, /tasks_machine_excluded/);
    assert.match(query, /tasks_ambiguous_excluded/);
    assert.match(query, new RegExp(escapeRegExp(taskKpiEligibleSql('t').slice(0, 80))));
    assert.match(query, /COUNT\(t\.id\) FILTER \(WHERE/);
    assert.doesNotMatch(query, /COUNT\(t\.id\)::int AS tasks_assigned/);
    assert.match(query, /source_type/);
    assert.match(query, new RegExp(escapeRegExp(taskKpiMachineSignalSql('t').slice(0, 80))));

    const row = snapshots.get(7);
    assert.equal(row.metrics.tasks.assigned, 3);
    assert.equal(row.metrics.tasks.done, 2);
    assert.equal(row.metrics.tasks.overdue, 1);
    assert.equal(row.metrics.tasks.machineAccepted, 1);
    assert.equal(row.metrics.tasks.machineExcluded, 4);
    assert.equal(row.metrics.tasks.ambiguousExcluded, 2);
    assert.equal(row.metrics.tasks.eligibilityPolicyVersion, TASK_PERFORMANCE_POLICY_VERSION);
});

test('payroll KPI audit snapshot preserves manual bonus rule and stores eligibility policy separately', () => {
    const snapshot = buildPayrollKpiAuditSnapshot('2026-08', {
        daysWorked: 5,
        plannedHours: 40,
        overtimeHours: 2,
        lines: [{ lineType: 'kpi_bonus', amount: 500 }]
    }, {
        sourceTimestamp: '2026-08-10T10:00:00.000Z',
        metrics: {
            tasks: {
                assigned: 1,
                done: 1,
                overdue: 0,
                machineAccepted: 1,
                machineExcluded: 3,
                ambiguousExcluded: 2,
                eligibilityPolicyVersion: TASK_PERFORMANCE_POLICY_VERSION
            }
        }
    });

    assert.equal(snapshot.ruleVersion, PAYROLL_KPI_BONUS_RULE_VERSION);
    assert.equal(snapshot.eligibilityPolicyVersion, TASK_PERFORMANCE_POLICY_VERSION);
    assert.equal(snapshot.approvedBonusAmount, 500);
    assert.equal(snapshot.formulaStatus, 'not_configured');
    assert.deepEqual(snapshot.metrics.tasks, {
        assigned: 1,
        done: 1,
        overdue: 0,
        machineAccepted: 1,
        machineExcluded: 3,
        ambiguousExcluded: 2,
        eligibilityPolicyVersion: TASK_PERFORMANCE_POLICY_VERSION
    });
});

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}
