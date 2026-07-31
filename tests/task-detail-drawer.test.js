const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const { withTaskDrawerContract } = require('../services/taskDetailContract');

function loadDrawerContext() {
    const sandbox = {
        URL,
        console,
        location: {
            href: 'https://crm.test/tasks?mode=overview',
            origin: 'https://crm.test'
        },
        history: {
            entries: [],
            pushState(state, _, url) { this.entries.push({ kind: 'push', state, url: String(url) }); },
            replaceState(state, _, url) { this.entries.push({ kind: 'replace', state, url: String(url) }); }
        },
        addEventListener() {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'task-detail-drawer.js'), 'utf8'), sandbox);
    return sandbox;
}

test('drawer contract exposes only server-derived allowed actions and a safe CRM source link', () => {
    const owner = { id: 11, role: 'user', username: 'owner' };
    const task = withTaskDrawerContract({
        id: 42,
        status: 'todo',
        owner_user_id: 11,
        visibility: 'team',
        source_type: 'booking',
        source_id: 'BK/42',
        source_module: 'bookings',
        control_meta: { reportRequired: true }
    }, owner);

    assert.equal(task.drawer.contract, 'task_drawer_v1');
    assert.equal(task.drawer.actions.edit, true);
    assert.equal(task.drawer.actions.complete, true);
    assert.equal(task.drawer.actions.manageObservers, true);
    assert.equal(task.drawer.source.href, '/?open=BK%2F42');
    assert.equal(task.drawer.completion.reportRequired, true);

    const observer = withTaskDrawerContract({
        id: 43,
        status: 'todo',
        owner_user_id: 99,
        visibility: 'private',
        viewer_is_observer: true,
        source_type: 'automation',
        source_id: 'run-1'
    }, owner);
    assert.equal(observer.drawer.actions.edit, false);
    assert.equal(observer.drawer.actions.complete, false);
    assert.equal(observer.drawer.actions.openSource, false);
    assert.equal(observer.drawer.source.href, null);
});

test('shared drawer controller preserves open URLs and routes non-task surfaces to the canonical task page', async () => {
    const ctx = loadDrawerContext();
    assert.equal(ctx.TaskDetailDrawer.taskUrl(17, { view: 'my' }), '/tasks?view=my&open=17');

    await ctx.TaskDetailDrawer.open(17, { view: 'my', sourceSurface: 'profile_my_day' });
    assert.equal(ctx.location.href, '/tasks?view=my&open=17');

    let rendered = null;
    ctx.location.href = 'https://crm.test/tasks?mode=overview';
    ctx.TaskDetailDrawer.registerRenderer((id, options) => { rendered = { id, options }; return true; }, () => true);
    await ctx.TaskDetailDrawer.open(22, { sourceSurface: 'tasks_page' });
    assert.equal(rendered.id, 22);
    assert.equal(rendered.options.sourceSurface, 'tasks_page');
    assert.equal(ctx.history.entries.at(-1).url, 'https://crm.test/tasks?mode=overview&open=22');
});

test('task surfaces use the shared controller rather than a second detail renderer', () => {
    const tasksPage = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
    const profilePage = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    const tasksHtml = fs.readFileSync(path.join(ROOT, 'tasks.html'), 'utf8');
    const profileHtml = fs.readFileSync(path.join(ROOT, 'profile.html'), 'utf8');
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');

    assert.match(tasksPage, /TaskDetailDrawer\.registerRenderer\(renderTaskDetailDrawer, closeTaskDetailOverlay\)/);
    assert.match(tasksPage, /TaskDetailDrawer\.load\(taskId/);
    assert.match(tasksPage, /renderTaskDetailSource\(t\)/);
    assert.match(profilePage, /TaskDetailDrawer\.open\(taskId, \{ view: 'my'/);
    assert.match(tasksHtml, /js\/task-detail-drawer\.js/);
    assert.match(profileHtml, /js\/task-detail-drawer\.js/);
    assert.match(route, /withTaskDrawerContract\(normalizeTaskPayload\(result\.rows\[0\]\), req\.user\)/);
    assert.match(route, /COALESCE\(dep\.dependencies, '\[\]'::json\) AS dependencies/);
});
