'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    addTaskDependency,
    emptyDependencyState,
    loadTaskDependencyStates,
    removeTaskDependency
} = require('../services/taskDependencies');

test('dependency projection computes blocked state from canonical task_dependencies only', async () => {
    const states = await loadTaskDependencyStates({
        async query(sql, params) {
            assert.match(sql, /FROM task_dependencies/);
            assert.deepEqual(params, [[10, 11]]);
            return { rows: [
                { task_id: 10, depends_on_task_id: 4, title: 'Find charger', status: 'todo', is_open: true },
                { task_id: 10, depends_on_task_id: 5, title: 'Old prerequisite', status: 'done', is_open: false }
            ] };
        }
    }, [10, 11]);
    assert.equal(states.get(10).dependencyCount, 2);
    assert.equal(states.get(10).openDependencyCount, 1);
    assert.equal(states.get(10).isBlocked, true);
    assert.deepEqual(states.get(11), emptyDependencyState());
});

test('link and unlink synchronize canonical rows with the legacy array in the same service path', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('SELECT source.id')) return { rows: [{ task_id: 10, depends_on_task_id: 4 }] };
            if (sql.includes('WITH RECURSIVE')) return { rows: [] };
            if (sql.includes('SELECT d.depends_on_task_id')) return { rows: [] };
            return { rows: [] };
        }
    };
    await addTaskDependency(queryable, { taskId: 10, dependsOnTaskId: 4 });
    await removeTaskDependency(queryable, { taskId: 10, dependsOnTaskId: 4 });
    assert.equal(calls.filter(call => call.sql.includes('INSERT INTO task_dependencies')).length, 1);
    assert.equal(calls.filter(call => call.sql.includes('DELETE FROM task_dependencies')).length, 1);
    assert.equal(calls.filter(call => call.sql.includes('SET dependency_ids')).length, 2);
});

test('self links and cycles are rejected before a canonical insert', async () => {
    await assert.rejects(() => addTaskDependency({ query: async () => ({ rows: [] }) }, { taskId: 10, dependsOnTaskId: 10 }), { code: 'TASK_DEPENDENCY_SELF_REFERENCE' });
    const calls = [];
    await assert.rejects(() => addTaskDependency({
        async query(sql) {
            calls.push(sql);
            if (sql.includes('SELECT source.id')) return { rows: [{ task_id: 10, depends_on_task_id: 4 }] };
            if (sql.includes('WITH RECURSIVE')) return { rows: [{ task_id: 10 }] };
            return { rows: [] };
        }
    }, { taskId: 10, dependsOnTaskId: 4 }), { code: 'TASK_DEPENDENCY_CYCLE' });
    assert.equal(calls.some(sql => sql.includes('INSERT INTO task_dependencies')), false);
});

test('Task 3 route, projection, UI, and compatibility migration retain the blocker contract', () => {
    const root = path.resolve(__dirname, '..');
    const routes = fs.readFileSync(path.join(root, 'routes', 'tasks.js'), 'utf8');
    const projection = fs.readFileSync(path.join(root, 'services', 'taskCabinetProjection.js'), 'utf8');
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-dependencies.js'), 'utf8');
    assert.match(routes, /router\.get\('\/:id\/dependencies'/);
    assert.match(routes, /router\.post\('\/:id\/dependencies\/quick-create'/);
    assert.match(routes, /router\.delete\('\/:id\/dependencies\/:dependsOnTaskId'/);
    assert.match(routes, /BEGIN/);
    assert.match(routes, /my_day_task_metadata/);
    assert.match(projection, /loadTaskDependencyStates/);
    assert.match(profile, /data-cabinet-task-action': 'dependencies'/);
    assert.match(profile, /complete-despite-blocker/);
    assert.match(ui, /Спочатку:/);
});
