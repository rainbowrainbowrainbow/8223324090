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

test('My Day dependency manager keeps backend flow while using the styled dependency surface contract', () => {
    const root = path.resolve(__dirname, '..');
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-dependencies.js'), 'utf8');
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const taskUi = fs.readFileSync(path.join(root, 'js', 'task-ui.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css', 'pages-profile.css'), 'utf8');

    assert.match(ui, /surfaceClassName: 'task-ui-action-surface--dependencies'/);
    assert.match(ui, /Поточні передумови[\s\S]*Пошук задачі[\s\S]*Швидке створення/);
    assert.match(ui, /data-dependency-current[\s\S]*data-dependency-search[\s\S]*data-dependency-create/);
    assert.match(ui, /const MIN_SEARCH_CHARS = 2/);
    assert.match(ui, /query\.length < MIN_SEARCH_CHARS[\s\S]*Введіть мінімум 2 символи/);
    assert.ok(ui.indexOf('Збігів немає') > ui.indexOf('query.length < MIN_SEARCH_CHARS'), 'empty state is only after a real search branch');
    assert.match(ui, /data-dependency-quick-create disabled aria-disabled="true"/);
    assert.match(ui, /quickCreateButton\.disabled = disabled/);
    assert.match(ui, /class="my-day-dependency-result-row"/);
    assert.match(ui, /role="listbox"/);
    assert.match(ui, /role="option"/);
    assert.match(ui, /Введіть мінімум 2 символи/);
    assert.match(ui, /🔗/);
    assert.match(ui, /request\('\/' \+ taskId \+ '\/dependencies'/);
    assert.match(ui, /request\('\/' \+ taskId \+ '\/dependencies\/quick-create'/);
    assert.match(ui, /request\('\/' \+ taskId \+ '\/dependencies\/' \+ encodeURIComponent/);
    assert.doesNotMatch(profile, /my-day-dependency-manager/);

    assert.match(css, /\.task-ui-action-surface--dependencies\.is-popover \.task-ui-action-panel\s*\{[\s\S]*width:\s*min\(430px, calc\(100vw - 24px\)\)/);
    assert.match(css, /\.my-day-dependency-section\s*\{[\s\S]*border-radius:\s*16px/);
    assert.match(css, /\.my-day-dependency-field input\s*\{[\s\S]*min-height:\s*40px/);
    assert.match(css, /\.my-day-dependency-results\s*\{[\s\S]*max-height:\s*210px;[\s\S]*overflow-y:\s*auto/);
    assert.match(css, /\.cabinet-task-dependency-action,[\s\S]*\.cabinet-task-blocker-badge\s*\{[\s\S]*color:\s*#334155/);
    assert.match(css, /body\.dark-mode[\s\S]*\.task-ui-action-surface--dependencies \.my-day-dependency-section/);
    assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.task-ui-action-surface--dependencies/);

    assert.match(taskUi, /if \(event\.key === 'Escape'\)[\s\S]*closeActionMenu\(\)/);
    assert.match(taskUi, /aria-label="\$\{escapeHtml\(title\)\}"/);
    assert.match(taskUi, /actionMenuFocusableElements\(root\)\[0\]\?\.focus/);
});
