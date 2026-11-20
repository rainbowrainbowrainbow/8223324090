'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildTaskVisibilityScope, canChangeTaskStatus, canMutateTask, canViewTask } = require('../services/taskPolicy');
const { taskDrawerActionContract } = require('../services/taskDetailContract');
const { buildTaskPersonalQuery, taskViewerRoles } = require('../services/taskPersonalScope');

test('a co-assignee can view and change the status of a private task without editing it', () => {
    const user = { id: 42, role: 'instructor', username: 'co-worker' };
    const task = { owner_user_id: 7, visibility: 'private', status: 'todo', co_assignee_user_ids: [42] };
    assert.equal(canViewTask(user, task), true);
    assert.equal(canChangeTaskStatus(user, task), true);
    assert.equal(canMutateTask(user, task), false);
    const actions = taskDrawerActionContract(task, user).actions;
    assert.equal(actions.complete, true);
    assert.equal(actions.save, false);
    assert.equal(actions.manageObservers, false);
    assert.equal(actions.reassign, false);
});

test('observers and unrelated users do not acquire co-assignee status rights', () => {
    const user = { id: 42, role: 'instructor', username: 'observer' };
    const task = { owner_user_id: 7, visibility: 'private', observer_user_ids: [42], co_assignee_user_ids: [43] };
    assert.equal(canViewTask(user, task), true);
    assert.equal(canChangeTaskStatus(user, task), false);
    assert.equal(canChangeTaskStatus({ ...user, id: 44 }, task), false);
});

test('visibility SQL scopes co-assignees by both task and user', () => {
    const params = [];
    const sql = buildTaskVisibilityScope({ id: 42, role: 'instructor' }, params, 't');
    assert.match(sql, /task_co_scope\.task_id = t\.id/);
    assert.match(sql, /task_co_scope\.user_id = \$\d+/);
    assert.ok(params.includes(42));
});

test('personal task scope treats a co-assignee as an executor without granting edit rights', () => {
    const user = { id: 42, role: 'instructor', username: 'co-worker' };
    const task = { owner_user_id: 7, visibility: 'private', viewer_is_co_assignee: true };
    const params = [];
    const query = buildTaskPersonalQuery(user, params, 't');
    assert.match(query.match, /task_co_assignees/);
    assert.deepEqual(taskViewerRoles(user, task), ['executor']);
    assert.equal(canChangeTaskStatus(user, task), true);
    assert.equal(canMutateTask(user, task), false);
});

test('My Day card keeps completion available and disables editing for a restricted co-assignee', () => {
    const window = { escapeHtml: value => String(value ?? '') };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/profile-my-day.js'), 'utf8'), { window });
    const card = window.ProfileMyDay.renderCard({ id: 1, title: 'Task', status: 'todo', priority: 'normal', mode: 'work', modeLabel: 'Work', dueState: 'none', role: 'executor', canEdit: false, canReschedule: false, priorityControl: '' });
    assert.match(card, /data-cabinet-task-action="done"[^>]*>/);
    assert.doesNotMatch(card, /data-cabinet-task-action="done"[^>]*disabled/);
    assert.match(card, /data-cabinet-task-action="edit"[^>]*disabled/);
});
