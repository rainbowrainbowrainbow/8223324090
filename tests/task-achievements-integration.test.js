const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('task decomposition milestones use the canonical achievements route', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'achievements.js'), 'utf8');
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '213_task_decomposition_achievements.sql'), 'utf8');

    assert.match(route, /FROM task_subtasks/);
    assert.match(route, /buildTaskOwnerMatch/);
    assert.match(route, /completed_parent_tasks/);
    assert.match(route, /completed_subtasks/);
    assert.match(route, /tasks_completed:\s*tasksR\.rows\[0\]\?\.cnt/);
    assert.match(route, /COUNT\(\*\) FILTER \(WHERE is_done = true\)::int AS done/);
    assert.match(route, /decomposed_tasks_completed/);
    assert.match(route, /ai_decomposed_tasks_completed/);
    assert.match(route, /template_decomposed_tasks_completed/);
    assert.match(route, /subtasks_completed/);

    for (const code of [
        'task_10_done',
        'task_decompose_5',
        'task_decompose_5_done',
        'subtask_10_done',
        'task_ai_decompose_done',
        'task_template_done'
    ]) {
        assert.match(migration, new RegExp(code));
    }
    assert.match(migration, /INSERT INTO achievements/);
    assert.match(migration, /ON CONFLICT \(code\) DO UPDATE/);
});

test('profile keeps the existing achievements tab instead of a separate productivity panel', () => {
    const profileCode = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    const profileCss = fs.readFileSync(path.join(ROOT, 'css', 'pages.css'), 'utf8');

    assert.match(profileCode, /function renderAchievements/);
    assert.match(profileCode, /apiGet\('\/achievements'\)/);
    assert.doesNotMatch(profileCode, /renderCabinetProductivitySurface/);
    assert.doesNotMatch(profileCode, /\/tasks\/productivity/);
    assert.doesNotMatch(profileCss, /cabinet-productivity-surface/);
});
