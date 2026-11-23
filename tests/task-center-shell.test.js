const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const tasksSource = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');

function resolveRoute(query = '') {
    const start = tasksSource.indexOf('const TASK_CENTER_MODE_CONFIG');
    const end = tasksSource.indexOf('let currentCategory', start);
    assert.ok(start >= 0 && end > start, 'Task Center route helpers are present');
    const sandbox = { URL, URLSearchParams, window: { location: { href: 'https://crm.test/tasks' } } };
    vm.createContext(sandbox);
    vm.runInContext(tasksSource.slice(start, end), sandbox);
    return JSON.parse(vm.runInContext(`JSON.stringify(resolveTaskCenterRoute(new URLSearchParams(${JSON.stringify(query)})))`, sandbox));
}

test('Task Center maps every legacy task view to a compatible new mode', () => {
    const expected = {
        inbox: ['overview', 'inbox'],
        today: ['overview', 'today'],
        team: ['team', 'team'],
        board: ['planning', 'board'],
        templates: ['library', 'templates'],
        archive: ['library', 'archive']
    };

    for (const [view, [mode, resolvedView]] of Object.entries(expected)) {
        const route = resolveRoute(`view=${view}&open=42`);
        assert.equal(route.mode, mode, view);
        assert.equal(route.view, resolvedView, view);
        assert.equal(route.legacy, true, view);
    }
});

test('Task Center mode URLs receive a stable default view and mode takes priority over conflicting legacy view', () => {
    assert.deepEqual(resolveRoute(''), { mode: 'team', view: 'team', legacy: false });
    assert.deepEqual(resolveRoute('mode=team'), { mode: 'team', view: 'team', legacy: false });
    assert.deepEqual(resolveRoute('mode=planning'), { mode: 'planning', view: 'next', legacy: false });
    assert.deepEqual(resolveRoute('mode=library&view=today'), { mode: 'library', view: 'templates', legacy: false });
});

test('Task Center shell keeps legacy controls available but hidden by default, with mobile-safe CSS', () => {
    const html = fs.readFileSync(path.join(ROOT, 'tasks.html'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'css', 'pages-tasks.css'), 'utf8');
    const sidebar = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');

    assert.match(html, /data-task-mode="team" aria-label="Центр задач"/);
    assert.match(html, /id="taskCenterCreateLink" href="\/profile\?tab=myday&amp;create=1"/);
    assert.doesNotMatch(html, /id="quickAdd"|id="operationPackBar"/);
    assert.match(html, /<summary>Інші перегляди<\/summary>/);
    for (const view of ['board', 'routines', 'archive']) {
        assert.match(html, new RegExp(`data-view="${view}"`));
    }
    assert.match(html, /id="taskCenterLegacyControls" hidden/);
    assert.match(css, /@media \(max-width: 900px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(sidebar, /href: '\/tasks'.*label: 'Центр задач'.*access: 'tasks'/);
});
