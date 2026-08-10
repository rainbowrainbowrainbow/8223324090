'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const {
    TASK_PERFORMANCE_POLICY_VERSION,
    OWNER_ACCEPTANCE_ACTIONS,
    taskKpiEligibleSql,
    taskKpiHumanCreatedSql,
    taskKpiMachineSignalSql,
    taskKpiOwnerAcceptedSql,
    taskKpiTerminalExclusionSql
} = require('../services/taskPerformancePolicy');

function readRepoFile(...segments) {
    return fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
}

test('task performance policy is fail-closed for machine-generated KPI tasks', () => {
    assert.equal(TASK_PERFORMANCE_POLICY_VERSION, 'task_performance_policy_v1');
    assert.ok(OWNER_ACCEPTANCE_ACTIONS.includes('task_acknowledged'));
    assert.ok(OWNER_ACCEPTANCE_ACTIONS.includes('task_completed'));

    const terminal = taskKpiTerminalExclusionSql('t');
    assert.match(terminal, /archived_at IS NOT NULL/);
    assert.match(terminal, /'cancelled'/);
    assert.match(terminal, /'canceled'/);

    const machine = taskKpiMachineSignalSql('t');
    assert.match(machine, /created_by/);
    assert.match(machine, /'rule_engine'/);
    assert.match(machine, /source_type/);
    assert.match(machine, /'booking'/);
    assert.match(machine, /'attendance'/);
    assert.match(machine, /'hermes'/);
    assert.match(machine, /'auto_complete'/);

    const human = taskKpiHumanCreatedSql('t');
    assert.match(human, /created_by_user_id/);
    assert.match(human, /source_type, 'manual'/);
    assert.match(human, /NOT IN \('auto', 'auto_complete', 'recurring'\)/);

    const accepted = taskKpiOwnerAcceptedSql('t');
    assert.match(accepted, /task_action_history/);
    assert.match(accepted, /actor_user_id = t\.owner_user_id/);
    assert.match(accepted, /'task_acknowledged'/);
    assert.match(accepted, /'urgent_commitment'/);

    const eligible = taskKpiEligibleSql('t');
    assert.match(eligible, /NOT \(/);
    assert.match(eligible, /task_action_history/);
    assert.match(eligible, /LOWER\(COALESCE\(t\.status, 'todo'\)\) IN \('done', 'completed'\)/);
});

test('HR KPI queries use task performance policy instead of raw task counts', () => {
    const hrRoute = readRepoFile('routes', 'hr.js');
    const loadKpiBlock = hrRoute.slice(hrRoute.indexOf('async function loadKpiSnapshot'), hrRoute.indexOf('function normalizeAuditValue'));
    const monthlyBlock = hrRoute.slice(hrRoute.indexOf("router.get('/report/monthly'"), hrRoute.indexOf("// GET /api/hr/kpi"));

    assert.match(hrRoute, /services\/taskPerformancePolicy/);
    assert.match(loadKpiBlock, /TASK_PERFORMANCE_POLICY_VERSION/);
    assert.match(loadKpiBlock, /taskKpiEligibleSql\('t'\)/);
    assert.match(loadKpiBlock, /taskKpiMachineSignalSql\('t'\)/);
    assert.match(monthlyBlock, /taskKpiEligibleSql\('t'\)/);
    assert.match(monthlyBlock, /taskKpiMachineSignalSql\('t'\)/);

    assert.doesNotMatch(loadKpiBlock, /COUNT\(t\.id\)::int AS tasks_assigned/);
    assert.doesNotMatch(monthlyBlock, /COUNT\(t\.id\)::int AS tasks_assigned/);
    for (const token of ['tasks_machine_accepted', 'tasks_machine_excluded', 'tasks_ambiguous_excluded']) {
        assert.match(loadKpiBlock, new RegExp(token));
        assert.match(monthlyBlock, new RegExp(token));
    }
});

test('HR KPI UI explains system task exclusions without affecting manual KPI bonus', () => {
    const hrPage = readRepoFile('js', 'hr-page.js');

    assert.match(hrPage, /Системні задачі/);
    assert.match(hrPage, /taskMachineExcluded/);
    assert.match(hrPage, /tasks_ambiguous_excluded/);
    assert.match(hrPage, /системних виключено/);
    assert.match(hrPage, /Ручний KPI bonus|manual KPI bonus/);
});
