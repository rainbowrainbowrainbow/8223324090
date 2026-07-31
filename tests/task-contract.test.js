const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadTaskUiShared() {
    const sandbox = { console, window: null };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'task-ui-shared.js'), 'utf8'), sandbox);
    return sandbox.TaskUiShared;
}

test('frontend task contract preserves a legacy owner and uses the canonical due-date order', () => {
    const taskUi = loadTaskUiShared();
    const normalized = taskUi.normalizeTask({
        id: 41,
        owner: 'legacy.owner',
        status: 'in_progress',
        task_mode: 'personal',
        task_kind: 'action',
        date: '2026-08-02',
        deadline: '2026-08-03T10:00:00.000Z',
        source_type: 'booking',
        source_id: 'booking:11',
        business_context: 'event_genix',
        subtask_count: 2,
        subtask_done_count: 1,
        dependency_count: 1,
        open_dependency_count: 1,
        report_required: true
    });

    assert.equal(normalized.ownerUserId, null);
    assert.equal(normalized.ownerLabel, 'legacy.owner');
    assert.equal(normalized.ownerState, 'legacy_unknown_owner');
    assert.equal(normalized.workflowState, 'in_progress');
    assert.equal(normalized.visibility, 'team');
    assert.equal(normalized.dueDate, '2026-08-02');
    assert.equal(normalized.taskContext.source.type, 'booking');
    assert.equal(normalized.taskContext.source.id, 'booking:11');
    assert.equal(normalized.taskContext.source.module, null);
    assert.equal(normalized.taskContext.source.surface, null);
    assert.equal(normalized.taskContext.businessContext, 'event_genix');
    assert.equal(normalized.taskContext.subtasks.count, 2);
    assert.equal(normalized.taskContext.dependencies.openCount, 1);
    assert.equal(normalized.taskContext.report.required, true);
});

test('frontend task contract gives typed ownership and scheduled work precedence', () => {
    const taskUi = loadTaskUiShared();
    const normalized = taskUi.normalizeTask({
        owner_user_id: 7,
        assigned_to: 'Old display label',
        owner_name: 'Olena',
        workflow_state: 'waiting',
        status: 'todo',
        task_mode: 'private',
        scheduled_start_at: '2026-08-04T09:00:00.000Z',
        snoozed_until: '2026-08-05T09:00:00.000Z',
        date: '2026-08-06'
    });

    assert.equal(normalized.ownerUserId, 7);
    assert.equal(normalized.ownerLabel, 'Olena');
    assert.equal(normalized.ownerState, 'typed');
    assert.equal(normalized.workflowState, 'waiting');
    assert.equal(normalized.visibility, 'private');
    assert.equal(normalized.dueDate, '2026-08-04');
    assert.equal(taskUi.taskIsWaiting(normalized), true);
});

test('server task contract normalizes the same legacy and canonical response fields', () => {
    const { normalizeTaskPayload } = require('../services/taskContract');
    const normalized = normalizeTaskPayload({
        id: 99,
        assigned_to: 'legacy.owner',
        status: 'in_progress',
        task_mode: 'work',
        task_kind: 'action',
        date: '2026-08-02',
        deadline: '2026-08-03T10:00:00.000Z'
    });

    assert.equal(normalized.ownerUserId, null);
    assert.equal(normalized.ownerLabel, 'legacy.owner');
    assert.equal(normalized.ownerState, 'legacy_unknown_owner');
    assert.equal(normalized.workflowState, 'in_progress');
    assert.equal(normalized.taskMode, 'work');
    assert.equal(normalized.taskKind, 'action');
    assert.equal(normalized.visibility, 'team');
});

test('Tasks API and My Day projection use the one server response normalizer', () => {
    const taskRoute = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const cabinetProjection = fs.readFileSync(path.join(ROOT, 'services', 'taskCabinetProjection.js'), 'utf8');

    assert.match(taskRoute, /normalizeTaskPayload: normalizeTaskContractPayload/);
    assert.match(cabinetProjection, /normalizeTaskPayload: normalizeTaskContractPayload/);
    assert.doesNotMatch(taskRoute, /function normalizeTaskPayload\(row\)/);
    assert.doesNotMatch(cabinetProjection, /function normalizeTaskPayload\(row\)/);
});
