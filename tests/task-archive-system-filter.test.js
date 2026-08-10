const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const tasksRoute = fs.readFileSync(path.join(root, 'routes', 'tasks.js'), 'utf8');
const tasksPage = fs.readFileSync(path.join(root, 'js', 'tasks-page.js'), 'utf8');

test('Task archive view hides system cleanup archive by default and supports explicit modes', () => {
    assert.match(tasksRoute, /function normalizeArchiveSystemMode/);
    assert.match(tasksRoute, /function taskSystemArchiveSql/);
    assert.match(tasksRoute, /archive_system,\s*archiveSystem,\s*system_archive,\s*systemArchive/);
    assert.match(tasksRoute, /const archiveSystemMode = normalizeArchiveSystemMode/);
    assert.match(tasksRoute, /case 'archive':[\s\S]*t\.status = 'archived'[\s\S]*archiveSystemMode === 'only'[\s\S]*archiveSystemMode === 'hide'/);
    assert.match(tasksRoute, /taskSystemArchiveSql\('t'\)/);
    assert.match(tasksRoute, /systemArchiveModes:\s*\['hide', 'include', 'only'\]/);

    assert.match(tasksPage, /let taskArchiveSystemMode = 'hide'/);
    assert.match(tasksPage, /params\.set\('archive_system', taskArchiveSystemMode\)/);
    assert.match(tasksPage, /data-task-archive-system-mode/);
    assert.match(tasksPage, /Робочий архів/);
    assert.match(tasksPage, /Системний архів/);
    assert.match(tasksPage, /Увесь архів/);
    assert.match(tasksPage, /taskArchiveSystemMode = \['hide', 'only', 'include'\]\.includes\(nextMode\) \? nextMode : 'hide'/);
});

test('Task archive system filter is source-only and does not add data mutation paths', () => {
    const helperBlock = tasksRoute.slice(
        tasksRoute.indexOf('function normalizeArchiveSystemMode'),
        tasksRoute.indexOf('// GET /api/tasks')
    );
    assert.ok(helperBlock.includes('SELECT 1 FROM task_logs'));
    assert.ok(helperBlock.includes('SELECT 1 FROM task_action_history'));
    assert.ok(!/UPDATE\s+tasks/i.test(helperBlock));
    assert.ok(!/DELETE\s+FROM\s+tasks/i.test(helperBlock));
});
