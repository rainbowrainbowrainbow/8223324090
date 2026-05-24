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

test('profile quick task card uses completed and today-or-undated remaining counts', () => {
    const ctx = loadProfileTaskerContext();
    const counts = ctx.cabinetTaskQuickCounts({
        stats: {
            taskQuick: {
                completed: 12,
                remaining: 3,
                scope: 'today_or_undated'
            }
        }
    });

    assert.equal(counts.completed, 12);
    assert.equal(counts.remaining, 3);
    assert.equal(counts.scope, 'today_or_undated');
    const html = ctx.renderCabinetTaskQuickSplit(counts);
    assert.match(html, /cabinet-quick-half--completed/);
    assert.match(html, /cabinet-quick-half--remaining/);
    assert.match(html, />12</);
    assert.match(html, />3</);
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
    assert.match(html, /data-reschedule-option="tomorrow"/);
    assert.match(html, /data-reschedule-option="day_after"/);
    assert.match(html, /data-reschedule-option="custom"/);
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
    assert.match(source, /remaining_today/);
    assert.match(source, /scheduled_start_at/);
    assert.match(source, /dueDate === today \|\| !dueDate/);
    assert.match(source, /COALESCE\(subtask_rows\.subtasks, '\[\]'::json\) AS subtasks/);
    assert.doesNotMatch(sidebarSource, /Number\(tasks\.assigned \|\| 0\) \+ Number\(tasks\.in_progress \|\| 0\)/);
});
