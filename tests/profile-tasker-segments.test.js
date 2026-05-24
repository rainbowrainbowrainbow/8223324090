const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadProfileTaskerContext() {
    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        document: { addEventListener() {} },
        localStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        navigator: {},
        window: null
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8'), sandbox);
    return sandbox;
}

test('profile tasker segments match canonical task mode, visibility, workflow and kind fields', () => {
    const ctx = loadProfileTaskerContext();
    const tasks = [
        { id: 1, taskMode: 'work', visibility: 'team', category: 'admin', taskKind: 'action', workflowState: 'todo' },
        { id: 2, taskMode: 'work', visibility: 'me_only', category: 'admin', taskKind: 'action', workflowState: 'todo' },
        { id: 3, taskMode: 'private', visibility: 'private', category: 'personal', taskKind: 'action', workflowState: 'todo' },
        { id: 4, taskMode: 'work', visibility: 'team', category: 'admin', taskKind: 'waiting', workflowState: 'todo' },
        { id: 5, taskMode: 'work', visibility: 'team', category: 'improvement', taskKind: 'action', workflowState: 'todo' },
        { id: 6, task_mode: 'work', visibility: 'team', category: 'admin', task_kind: 'action', workflow_state: 'waiting' }
    ];

    assert.deepEqual(tasks.filter(task => ctx.cabinetTaskMatchesSegment(task, 'all')).map(task => task.id), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(tasks.filter(task => ctx.cabinetTaskMatchesSegment(task, 'work')).map(task => task.id), [1, 2, 4, 5, 6]);
    assert.deepEqual(tasks.filter(task => ctx.cabinetTaskMatchesSegment(task, 'personal')).map(task => task.id), [2, 3]);
    assert.deepEqual(tasks.filter(task => ctx.cabinetTaskMatchesSegment(task, 'private')).map(task => task.id), [3]);
    assert.deepEqual(tasks.filter(task => ctx.cabinetTaskMatchesSegment(task, 'actionable')).map(task => task.id), [1, 2, 3]);
    assert.deepEqual(tasks.filter(task => ctx.cabinetTaskMatchesSegment(task, 'idea')).map(task => task.id), [5]);
});

test('profile my day ordering keeps decomposed groups and sorts newest tasks first inside the slice', () => {
    const ctx = loadProfileTaskerContext();
    const tasks = [
        { id: 1, title: 'older plain', date: '2026-05-23', createdAt: '2026-05-23T08:00:00.000Z' },
        { id: 2, title: 'newer plain', date: '2026-05-23', createdAt: '2026-05-23T10:00:00.000Z' },
        { id: 3, title: 'older decomposed', date: '2026-05-23', createdAt: '2026-05-23T07:00:00.000Z', subtask_count: 2 },
        { id: 4, title: 'newer decomposed', date: '2026-05-23', createdAt: '2026-05-23T09:00:00.000Z', subtask_count: 1 }
    ];

    assert.deepEqual(Array.from(ctx.sortCabinetTasksForDisplay(tasks).map(task => task.id)), [4, 3, 2, 1]);
});

test('profile quick task card uses completed-today and today-or-undated remaining counts', () => {
    const ctx = loadProfileTaskerContext();
    const counts = ctx.cabinetTaskQuickCounts({
        stats: {
            taskQuick: {
                completed: 99,
                completedToday: 12,
                remaining: 3,
                scope: 'completed_today_and_active_today_or_undated'
            }
        }
    });

    assert.equal(counts.completed, 12);
    assert.equal(counts.remaining, 3);
    assert.equal(counts.scope, 'completed_today_and_active_today_or_undated');
    const html = ctx.renderCabinetTaskQuickSplit(counts);
    assert.match(html, /cabinet-quick-half--completed/);
    assert.match(html, /cabinet-quick-half--remaining/);
    assert.match(html, />12</);
    assert.match(html, />3</);
    assert.match(html, /виконано сьогодні/);
});

test('profile task composer starts collapsed with advanced fields behind an explicit toggle', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext('cabinetTaskComposerExpanded = false;', ctx);
    const collapsedHtml = ctx.renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' });

    assert.match(collapsedHtml, /cabinet-task-composer is-collapsed/);
    assert.match(collapsedHtml, /data-cabinet-composer-state="collapsed"/);
    assert.match(collapsedHtml, /data-cabinet-composer-toggle/);
    assert.match(collapsedHtml, /Більше параметрів/);
    assert.match(collapsedHtml, /id="cabinetTaskTitle"/);
    assert.match(collapsedHtml, /class="cabinet-due-presets"/);
    assert.match(collapsedHtml, /data-cabinet-composer-advanced aria-hidden="true"[^>]*hidden/);

    vm.runInContext('cabinetTaskComposerExpanded = true;', ctx);
    const expandedHtml = ctx.renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' });
    assert.match(expandedHtml, /cabinet-task-composer is-expanded/);
    assert.match(expandedHtml, /data-cabinet-composer-state="expanded"/);
    assert.match(expandedHtml, /Згорнути/);
    assert.doesNotMatch(expandedHtml, /data-cabinet-composer-advanced aria-hidden="true"[^>]*hidden/);
});

test('profile my day and my tasks keep distinct presentation scopes', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext(`
        myCabinetData = {
            all: [],
            today: [],
            overdue: [],
            waiting: [],
            private: []
        };
        myTasksSegment = 'all';
        cabinetTaskComposerExpanded = false;
    `, ctx);

    const myDayHtml = ctx.renderMyDayTab();
    const myTasksHtml = ctx.renderMyTasksTab();

    assert.match(myDayHtml, /cabinet-quick-cluster/);
    assert.match(myDayHtml, /cabinet-task-composer/);
    assert.match(myDayHtml, /data-cabinet-task-drop-target="today"/);
    assert.doesNotMatch(myTasksHtml, /cabinet-quick-cluster/);
    assert.doesNotMatch(myTasksHtml, /cabinet-task-composer/);
    assert.match(myTasksHtml, /cabinet-shell--mytasks/);
    assert.match(myTasksHtml, /cabinet-segments/);
    assert.match(myTasksHtml, /data-cabinet-active-segment="all"/);
    assert.match(myTasksHtml, /Повний список задач/);
    assert.match(myTasksHtml, /Додати в Мій день/);
});

test('profile my tasks no longer forces the daily quick mode when switching tabs', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    assert.doesNotMatch(source, /if \(tab === 'mytasks'\)\s*\{\s*setCabinetQuickMode\('tasks'\);\s*\}/);
});

test('profile task cards expose overdue reschedule action and inline subtasks by default', () => {
    const ctx = loadProfileTaskerContext();
    const task = {
        id: 44,
        title: 'Overdue decomposed task',
        deadline: '2000-01-01T09:00:00.000Z',
        priority: 'high',
        subtask_count: 2,
        subtask_done_count: 1,
        subtasks: [
            { id: 1, title: 'First', is_done: true },
            { id: 2, title: 'Second', is_done: false }
        ],
        controlMeta: { canReschedule: true }
    };

    const html = ctx.renderCabinetTaskCard(task);
    assert.match(html, /data-cabinet-task-action="reschedule-overdue-menu"/);
    assert.match(html, /data-reschedule-option="today"/);
    assert.match(html, /data-reschedule-option="tomorrow"/);
    assert.match(html, /data-reschedule-option="day_after"/);
    assert.match(html, /data-reschedule-option="custom"/);
    assert.match(html, /draggable="true"/);
    assert.match(html, /data-cabinet-task-drag="overdue"/);
    assert.match(html, /data-cabinet-task-action="move-to-today"/);
    assert.match(html, /data-cabinet-subtasks-panel="44"/);
    assert.doesNotMatch(html, /data-cabinet-subtasks-panel="44" hidden/);
    assert.match(html, /data-cabinet-subtask-done/);
});

test('profile task cards respect disabled rescheduling control meta', () => {
    const ctx = loadProfileTaskerContext();
    const html = ctx.renderCabinetTaskCard({
        id: 45,
        title: 'Locked overdue task',
        deadline: '2000-01-01T09:00:00.000Z',
        controlMeta: { canReschedule: false }
    });

    assert.match(html, /data-cabinet-task-action="reschedule-overdue-menu"/);
    assert.match(html, /disabled/);
    assert.doesNotMatch(html, /data-cabinet-task-action="reschedule-overdue"/);
    assert.doesNotMatch(html, /data-cabinet-task-drag="overdue"/);
    assert.doesNotMatch(html, /data-cabinet-task-action="move-to-today"/);
});

test('profile my day exposes today as a real overdue drop target', () => {
    const ctx = loadProfileTaskerContext();
    const html = ctx.renderCabinetSection('Сьогодні', [], 'Порожньо', false, {
        dropTarget: 'today',
        dropHint: 'Киньте сюди прострочену задачу'
    });

    assert.match(html, /cabinet-task-section--drop-target/);
    assert.match(html, /data-cabinet-task-drop-target="today"/);
    assert.match(html, /Киньте сюди прострочену задачу/);
});

test('profile overdue to today move persists through reschedule endpoint with today deadline', async () => {
    const ctx = loadProfileTaskerContext();
    const calls = [];
    ctx.apiPost = async (url, payload) => {
        calls.push({ url, payload });
        return { success: true };
    };
    ctx.showNotification = () => {};
    ctx.refreshMyCabinetTab = async () => {};

    await ctx.rescheduleCabinetTask(77, 'today', {
        sourceSurface: 'profile_my_cabinet_overdue_to_today_drop'
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/tasks/77/reschedule');
    assert.equal(calls[0].payload.sourceSurface, 'profile_my_cabinet_overdue_to_today_drop');
    assert.match(calls[0].payload.deadline, /^20\d{2}-\d{2}-\d{2}T18:00:00$/);
});

test('task reschedule keeps scheduled tasks in the same today projection contract', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'taskExecution.js'), 'utf8');
    const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');

    assert.match(source, /scheduled_start_at = CASE/);
    assert.match(source, /scheduled_end_at = CASE/);
    assert.match(source, /scheduled_end_at - scheduled_start_at/);
    assert.match(source, /schedule_status = CASE/);
    assert.match(source, /profile_my_cabinet_overdue_to_today_drop/);
    assert.match(routeSource, /profile_my_cabinet_overdue_to_today_drop/);
});

test('profile unfinished gamification tabs use soon lockdown by role', () => {
    const ctx = loadProfileTaskerContext();

    vm.runInContext(`
        AppState = { currentUser: { id: 7, role: 'manager' } };
        profileData = { user: { id: 7, role: 'manager', name: 'Manager' } };
        currentUserId = 7;
        isOwnProfile = true;
        activeTab = 'inventory';
        myInventory = [];
    `, ctx);

    assert.equal(ctx.profileCanOpenTab('inventory'), false);
    assert.equal(ctx.profileCanOpenTab('shop'), false);
    assert.equal(ctx.profileCanOpenTab('quests'), false);
    assert.match(ctx.renderProfilePrimaryTab('inventory', 'Інвентар', { ownOnly: true }), /is-soon/);
    assert.match(ctx.renderTabContent(), /profile-soon-panel/);
    assert.match(ctx.renderTabContent(), /data-profile-soon-panel="inventory"/);

    vm.runInContext(`
        AppState.currentUser.role = 'creator';
        profileData.user.role = 'creator';
        activeTab = 'inventory';
    `, ctx);

    assert.equal(ctx.profileCanOpenTab('inventory'), true);
    assert.equal(ctx.profileCanOpenTab('shop'), true);
    assert.equal(ctx.profileCanOpenTab('quests'), false);
    assert.doesNotMatch(ctx.renderProfilePrimaryTab('inventory', 'Інвентар', { ownOnly: true }), /is-soon/);
    assert.doesNotMatch(ctx.renderInventory(), /\uD83C\uDF92/);
});

test('my cabinet task projection counts scheduled workload by today or no date, not all active tasks', () => {
    const source = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const sidebarSource = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');

    assert.match(source, /function taskWorkloadDateSql/);
    assert.match(source, /taskQuick/);
    assert.match(source, /completed:\s*quickStats\.done_today/);
    assert.match(source, /completedToday:\s*quickStats\.done_today/);
    assert.match(source, /completedTotal:\s*quickStats\.done_total/);
    assert.match(source, /remaining_today/);
    assert.match(source, /scheduled_start_at/);
    assert.match(source, /dueDate === today \|\| !dueDate/);
    assert.match(source, /COALESCE\(subtask_rows\.subtasks, '\[\]'::json\) AS subtasks/);
    assert.doesNotMatch(sidebarSource, /Number\(tasks\.assigned \|\| 0\) \+ Number\(tasks\.in_progress \|\| 0\)/);
});
