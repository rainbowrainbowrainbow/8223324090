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

test('profile my day ordering lifts urgent priority above lower-priority work', () => {
    const ctx = loadProfileTaskerContext();
    const tasks = [
        { id: 1, title: 'normal decomposed', priority: 'normal', date: '2026-05-23', subtask_count: 2 },
        { id: 2, title: 'low task', priority: 'low', date: '2026-05-23' },
        { id: 3, title: 'urgent task', priority: 'urgent', date: '2026-05-23' },
        { id: 4, title: 'high task', priority: 'high', date: '2026-05-23' }
    ];

    assert.deepEqual(Array.from(ctx.sortCabinetTasksForDisplay(tasks).map(task => task.id)), [3, 4, 1, 2]);
});

test('profile quick task card uses completed-today and active My Day workload counts', () => {
    const ctx = loadProfileTaskerContext();
    const counts = ctx.cabinetTaskQuickCounts({
        stats: {
            taskQuick: {
                completed: 99,
                completedToday: 12,
                remaining: 3,
                activeMyDay: 4,
                todayRemaining: 3,
                overdueCarryover: 1,
                scope: 'completed_units_today_and_active_my_day_or_undated'
            }
        }
    });

    assert.equal(counts.completed, 12);
    assert.equal(counts.remaining, 4);
    assert.equal(counts.todayRemaining, 3);
    assert.equal(counts.overdueCarryover, 1);
    assert.equal(counts.scope, 'completed_units_today_and_active_my_day_or_undated');
    const html = ctx.renderCabinetTaskQuickSplit(counts);
    assert.match(html, /cabinet-quick-half--completed/);
    assert.match(html, /cabinet-quick-half--remaining/);
    assert.match(html, />12</);
    assert.match(html, />4</);
    assert.match(html, /виконано сьогодні/);
});

test('profile quick task card counts overdue carry-over when activeMyDay is absent', () => {
    const ctx = loadProfileTaskerContext();
    const counts = ctx.cabinetTaskQuickCounts({
        today: [{ id: 1 }],
        overdue: [{ id: 2 }],
        stats: {
            taskQuick: {
                completedToday: 0,
                remaining: 1
            }
        }
    });

    assert.equal(counts.completed, 0);
    assert.equal(counts.remaining, 2);
    assert.equal(counts.todayRemaining, 1);
    assert.equal(counts.overdueCarryover, 1);
    assert.equal(counts.scope, 'completed_units_today_and_active_my_day_or_undated');
});

test('profile task-count quick segment keeps users in My Day cockpit', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext(`
        myCabinetData = {
            stats: {
                taskQuick: {
                    completedToday: 2,
                    remaining: 4
                }
            }
        };
        cabinetPulseCounts = { alerts: 0, funnel: 0 };
    `, ctx);

    const html = ctx.renderCabinetPulseCluster();

    assert.match(html, /cabinet-quick-segment--tasks/);
    assert.match(html, /switchTab\('myday'\)/);
    assert.doesNotMatch(html, /switchTab\('mytasks'\)/);
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
    assert.match(collapsedHtml, /class="cabinet-priority-presets"/);
    assert.match(collapsedHtml, /data-cabinet-priority-preset="urgent"/);
    assert.match(collapsedHtml, /Терміново/);
    assert.match(collapsedHtml, /data-cabinet-composer-advanced aria-hidden="true"[^>]*hidden/);

    vm.runInContext('cabinetTaskComposerExpanded = true;', ctx);
    const expandedHtml = ctx.renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' });
    assert.match(expandedHtml, /cabinet-task-composer is-expanded/);
    assert.match(expandedHtml, /data-cabinet-composer-state="expanded"/);
    assert.match(expandedHtml, /Згорнути/);
    assert.doesNotMatch(expandedHtml, /data-cabinet-composer-advanced aria-hidden="true"[^>]*hidden/);
});

function installCabinetCreateDom(ctx, title) {
    const elements = new Map();
    const addElement = (id, node) => elements.set(id, node);
    addElement('cabinetTaskTitle', { value: title, focus() {} });
    addElement('cabinetTaskKind', { value: 'action' });
    addElement('cabinetTaskMode', { value: 'personal' });
    addElement('cabinetTaskDate', { value: '2099-05-31' });
    addElement('cabinetTaskCategory', { value: 'personal' });
    addElement('cabinetTaskPriority', { value: 'normal' });
    addElement('cabinetTaskVisibility', { value: 'me_only' });
    addElement('cabinetTaskReportRequired', { checked: false });
    addElement('cabinetTaskAllowReschedule', { checked: true });
    addElement('cabinetSubtaskList', { innerHTML: '' });
    addElement('cabinetSubtaskAcceptDraftBtn', { setAttribute() {} });
    addElement('cabinetSubtaskDraftStatus', { textContent: '', className: '' });
    addElement('cabinetDecompositionMode', { value: 'none' });
    addElement('cabinetDecompositionTemplate', { disabled: false });
    addElement('cabinetSubtaskDraftBtn', { disabled: false, textContent: '' });
    ctx.document = {
        addEventListener() {},
        getElementById(id) {
            return elements.get(id) || null;
        },
        querySelectorAll() {
            return [];
        }
    };
    return elements;
}

test('profile My Day create accepts URL-first titles and confirms the refreshed cabinet projection before success', async () => {
    const ctx = loadProfileTaskerContext();
    const title = 'https://example.com перевірити';
    const elements = installCabinetCreateDom(ctx, title);
    const notices = [];
    let createdPayload = null;

    ctx.AppState = { currentUser: { id: 7, username: 'serhiy' } };
    ctx.showNotification = (message, type) => notices.push({ message, type });
    ctx.TaskCreate = {
        buildPayload(draft) {
            return { ...draft, title: String(draft.title || '').trim(), task_mode: draft.mode, visibility: draft.visibility };
        },
        async createTask(payload) {
            createdPayload = payload;
            return { success: true, task: { id: 501, title: payload.title } };
        }
    };
    ctx.apiGet = async (url) => {
        if (url === '/tasks/my-cabinet') {
            return {
                all: [{ id: 501, title }],
                today: [{ id: 501, title }],
                overdue: [],
                waiting: [],
                private: [],
                completedHistory: [],
                stats: { taskQuick: { completedToday: 0, activeMyDay: 1 } }
            };
        }
        return null;
    };

    await ctx.createCabinetTask({ preventDefault() {} }, 'personal');

    assert.equal(createdPayload.title, title);
    assert.equal(createdPayload.ownerUserId, 7);
    assert.equal(createdPayload.priority, 'normal');
    assert.equal(elements.get('cabinetTaskTitle').value, '');
    assert.equal(notices.at(-1)?.type, 'success');
});

test('profile My Day create sends urgent priority from the mini priority selector', async () => {
    const ctx = loadProfileTaskerContext();
    const title = 'терміново перевірити';
    const elements = installCabinetCreateDom(ctx, title);
    elements.get('cabinetTaskPriority').value = 'urgent';
    let createdPayload = null;

    ctx.AppState = { currentUser: { id: 7, username: 'serhiy' } };
    ctx.showNotification = () => {};
    ctx.TaskCreate = {
        buildPayload(draft) {
            return { ...draft, title: String(draft.title || '').trim() };
        },
        async createTask(payload) {
            createdPayload = payload;
            return { success: true, task: { id: 509, title: payload.title } };
        }
    };
    ctx.apiGet = async (url) => {
        if (url === '/tasks/my-cabinet') {
            return {
                all: [{ id: 509, title, priority: 'urgent' }],
                today: [{ id: 509, title, priority: 'urgent' }],
                overdue: [],
                waiting: [],
                private: [],
                completedHistory: [],
                stats: { taskQuick: { completedToday: 0, activeMyDay: 1 } }
            };
        }
        return null;
    };

    await ctx.createCabinetTask({ preventDefault() {} }, 'personal');

    assert.equal(createdPayload.priority, 'urgent');
    assert.equal(elements.get('cabinetTaskPriority').value, 'normal');
});

test('profile My Day create does not fake success when the created task is missing from the refreshed projection', async () => {
    const ctx = loadProfileTaskerContext();
    const title = 'https://example.com';
    const elements = installCabinetCreateDom(ctx, title);
    const notices = [];

    ctx.AppState = { currentUser: { id: 7, username: 'serhiy' } };
    ctx.showNotification = (message, type) => notices.push({ message, type });
    ctx.TaskCreate = {
        buildPayload(draft) {
            return { ...draft, title: String(draft.title || '').trim(), task_mode: draft.mode, visibility: draft.visibility };
        },
        async createTask(payload) {
            return { success: true, task: { id: 777, title: payload.title } };
        }
    };
    ctx.apiGet = async (url) => {
        if (url === '/tasks/my-cabinet') return { all: [], today: [], overdue: [], waiting: [], private: [], completedHistory: [] };
        if (url === '/tasks/777') return { id: 777, title };
        return null;
    };

    await ctx.createCabinetTask({ preventDefault() {} }, 'personal');

    assert.equal(elements.get('cabinetTaskTitle').value, title);
    assert.equal(notices.some(item => item.type === 'success'), false);
    assert.equal(notices.at(-1)?.type, 'warning');
});

test('profile completion applies local My Day projection before the refresh round-trip', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext(`
        myCabinetData = {
            all: [{ id: 61, title: 'Finish me', priority: 'urgent', status: 'todo' }],
            today: [{ id: 61, title: 'Finish me', priority: 'urgent', status: 'todo' }],
            overdue: [],
            waiting: [],
            private: [],
            completedHistory: [],
            stats: {
                todayDone: 0,
                todayPlanned: 1,
                todayWorkloadCount: 1,
                activeMyDay: 1,
                activeMyDayCount: 1,
                taskQuick: {
                    completed: 0,
                    completedToday: 0,
                    completedTotal: 0,
                    completedParentToday: 0,
                    remaining: 1,
                    todayRemaining: 1,
                    activeMyDay: 1
                }
            }
        };
    `, ctx);

    const applied = ctx.applyCabinetTaskStatusToProjection(61, 'done', {
        id: 61,
        title: 'Finish me',
        priority: 'urgent',
        completedAt: '2026-06-01T09:00:00.000Z'
    });
    const data = vm.runInContext('myCabinetData', ctx);

    assert.equal(applied, true);
    assert.equal(data.today.length, 0);
    assert.equal(data.all.length, 0);
    assert.equal(data.completedHistory[0].id, 61);
    assert.equal(data.completedHistory[0].status, 'done');
    assert.equal(data.stats.taskQuick.completedToday, 1);
    assert.equal(data.stats.taskQuick.todayRemaining, 0);
    assert.equal(data.stats.activeMyDay, 0);
});

test('profile routes mytasks compatibility into the single My Day projection', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext(`
        myCabinetData = {
            all: [],
            today: [],
            overdue: [],
            waiting: [],
            private: [],
            completedHistory: []
        };
        myTasksSegment = 'all';
        cabinetTaskComposerExpanded = false;
    `, ctx);

    const myDayHtml = ctx.renderMyDayTab();
    const myTasksHtml = ctx.renderMyTasksTab();
    const source = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');

    assert.match(myDayHtml, /cabinet-quick-cluster/);
    assert.match(myDayHtml, /cabinet-task-composer/);
    assert.match(myDayHtml, /data-cabinet-task-drop-target="today"/);
    assert.match(myTasksHtml, /cabinet-quick-cluster/);
    assert.match(myTasksHtml, /cabinet-task-composer/);
    assert.match(source, /function normalizeProfileTaskTab/);
    assert.match(source, /return tab === 'mytasks' \? 'myday' : tab;/);
    assert.match(source, /function syncProfileTabToUrl/);
    assert.match(source, /params\.set\('tab', normalized\)/);
    assert.match(source, /addEventListener\('popstate'/);
    assert.doesNotMatch(source, /cabinet-shell--mytasks/);
    assert.doesNotMatch(source, /href="\/profile\?tab=mytasks"/);
});

test('profile my day renders compact completed task history with hover/focus details', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext(`
        myCabinetData = {
            all: [],
            today: [],
            overdue: [],
            waiting: [],
            private: [],
            completedHistory: [
                {
                    id: 501,
                    title: 'Закрити закупівлю',
                    status: 'done',
                    priority: 'high',
                    category: 'purchase',
                    completedAt: '2026-05-26T09:30:00.000Z',
                    subtask_count: 2,
                    subtask_done_count: 2
                },
                {
                    id: 502,
                    title: 'Передати звіт',
                    status: 'done',
                    priority: 'normal',
                    category: 'admin',
                    completedAt: '2026-05-25T16:00:00.000Z'
                }
            ],
            stats: {
                taskQuick: {
                    completedTotal: 4,
                    completedHistoryShown: 2,
                    completedHistoryOverflow: 2
                }
            }
        };
        cabinetTaskComposerExpanded = false;
    `, ctx);

    const stripHtml = ctx.renderCabinetCompletedHistoryStrip();
    const myDayHtml = ctx.renderMyDayTab();

    assert.match(stripHtml, /cabinet-completed-strip/);
    assert.match(stripHtml, /cabinet-completed-tile/);
    assert.match(stripHtml, /role="tooltip"/);
    assert.match(stripHtml, /aria-describedby="cabinetCompletedDetail501"/);
    assert.match(stripHtml, /cabinet-completed-day-divider/);
    assert.match(stripHtml, /data-cabinet-completed-day-divider/);
    assert.match(stripHtml, /data-day-key="2026-05-26"/);
    assert.match(stripHtml, /data-day-key="2026-05-25"/);
    assert.match(stripHtml, /cabinet-completed-day-stats/);
    assert.match(stripHtml, /Видимі дні/);
    assert.match(stripHtml, /Закрити закупівлю/);
    assert.match(stripHtml, /Передати звіт/);
    assert.match(stripHtml, /Високий/);
    assert.match(stripHtml, /Закупівлі/);
    assert.match(stripHtml, /\+2/);
    assert.match(myDayHtml, /cabinet-completed-strip/);
    assert.match(myDayHtml, /Компактна історія виконаних задач/);
});

test('profile my tasks no longer forces the daily quick mode when switching tabs', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    assert.doesNotMatch(source, /if \(tab === 'mytasks'\)\s*\{\s*setCabinetQuickMode\('tasks'\);\s*\}/);
});

test('profile keeps My Day only and sends full task lists to canonical Tasks', () => {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    const workHubStart = source.indexOf('function profileWorkHubTabOrder()');
    const secondaryStart = source.indexOf('function profileSecondaryTabOrder()');
    const secondaryEnd = source.indexOf('const PROFILE_CREATOR_ONLY_TABS', secondaryStart);
    const workHub = source.slice(workHubStart, secondaryStart);
    const secondary = source.slice(secondaryStart, secondaryEnd);

    assert.doesNotMatch(workHub, /id: 'myday'/);
    assert.doesNotMatch(workHub, /id: 'mytasks'/);
    assert.match(secondary, /profileWorkHubTabOrder\(\)\.map/);
    assert.match(secondary, /id: 'myday'/);
    assert.doesNotMatch(secondary, /id: 'mytasks'/);
    assert.match(source, /href="\/tasks\?view=my">Повний список задач/);
    assert.doesNotMatch(source, /renderProfileWorkHubTabs\(professionEntries\)/);
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
    assert.match(html, /data-cabinet-inline-subtask/);
    assert.match(html, /data-cabinet-subtask-drag-handle/);
    assert.match(html, /draggable="true"/);
    assert.match(html, /data-cabinet-subtask-done/);
});

test('profile task cards expose move-to-today drag for typed planned tasks', () => {
    const ctx = loadProfileTaskerContext();
    const html = ctx.renderCabinetTaskCard({
        id: 46,
        title: 'Typed planned task',
        deadline: '2099-01-01T09:00:00.000Z',
        ownerUserId: 12,
        ownerState: 'typed',
        taskMode: 'work',
        taskKind: 'action',
        controlMeta: { canReschedule: true }
    });

    assert.match(html, /draggable="true"/);
    assert.match(html, /data-cabinet-task-drag="to-today"/);
    assert.match(html, /data-cabinet-task-drag-target="today"/);
    assert.match(html, /data-cabinet-task-action="move-to-today"/);
});

test('profile my day collapses decomposed cards by default while keeping progress visible', () => {
    const ctx = loadProfileTaskerContext();
    const task = {
        id: 44,
        title: 'Overdue decomposed task',
        deadline: '2000-01-01T09:00:00.000Z',
        priority: 'high',
        subtask_count: 3,
        subtask_done_count: 1,
        subtasks: [
            { id: 1, title: 'First', is_done: true },
            { id: 2, title: 'Second', is_done: false },
            { id: 3, title: 'Third', is_done: false }
        ],
        controlMeta: { canReschedule: true }
    };

    vm.runInContext(`activeTab = 'myday';`, ctx);
    const collapsedHtml = ctx.renderCabinetTaskCard(task);

    assert.match(collapsedHtml, /is-subtasks-collapsed/);
    assert.match(collapsedHtml, /data-cabinet-task-decomposed="true"/);
    assert.match(collapsedHtml, /aria-expanded="false"/);
    assert.match(collapsedHtml, /data-cabinet-subtasks-panel="44" hidden/);
    assert.match(collapsedHtml, /cabinet-subtask-progress/);
    assert.match(collapsedHtml, /cabinet-subtask-compact-summary/);
    assert.match(collapsedHtml, /Залишилось 2/);
    assert.doesNotMatch(collapsedHtml, /data-cabinet-subtask-done/);

    vm.runInContext(`expandedCabinetSubtaskIds.add(44); collapsedCabinetSubtaskIds.delete(44);`, ctx);
    const expandedHtml = ctx.renderCabinetTaskCard(task);

    assert.match(expandedHtml, /is-subtasks-expanded/);
    assert.match(expandedHtml, /aria-expanded="true"/);
    assert.doesNotMatch(expandedHtml, /data-cabinet-subtasks-panel="44" hidden/);
    assert.match(expandedHtml, /data-cabinet-subtask-done/);
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

test('profile planned task cards respect disabled rescheduling control meta', () => {
    const ctx = loadProfileTaskerContext();
    const html = ctx.renderCabinetTaskCard({
        id: 47,
        title: 'Locked planned task',
        deadline: '2099-01-01T09:00:00.000Z',
        controlMeta: { canReschedule: false }
    });

    assert.doesNotMatch(html, /draggable="true"/);
    assert.doesNotMatch(html, /data-cabinet-task-drag="to-today"/);
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

test('profile overdue to today move resolves the task due value before guarding reschedule', async () => {
    const ctx = loadProfileTaskerContext();
    const calls = [];
    const notices = [];
    vm.runInContext(`
        myCabinetData = {
            all: [{
                id: 78,
                title: 'Old task',
                deadline: '2000-01-01T09:00:00.000Z',
                controlMeta: { canReschedule: true }
            }],
            today: [],
            overdue: [{
                id: 78,
                title: 'Old task',
                deadline: '2000-01-01T09:00:00.000Z',
                controlMeta: { canReschedule: true }
            }],
            waiting: [],
            private: []
        };
    `, ctx);
    ctx.apiPost = async (url, payload) => {
        calls.push({ url, payload });
        return { success: true };
    };
    ctx.showNotification = (message, type) => notices.push({ message, type });
    ctx.refreshMyCabinetTab = async () => {};

    await ctx.moveCabinetTaskToToday(78, 'drag');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/tasks/78/reschedule');
    assert.equal(calls[0].payload.sourceSurface, 'profile_my_cabinet_overdue_to_today_drop');
    assert.equal(notices.at(-1)?.type, 'success');
});

test('profile typed planned task move persists through the same to-today reschedule path', async () => {
    const ctx = loadProfileTaskerContext();
    const calls = [];
    vm.runInContext(`
        myCabinetData = {
            all: [{
                id: 88,
                title: 'Future typed task',
                deadline: '2099-01-01T09:00:00.000Z',
                ownerUserId: 12,
                ownerState: 'typed',
                controlMeta: { canReschedule: true }
            }],
            today: [],
            overdue: [],
            next: [{
                id: 88,
                title: 'Future typed task',
                deadline: '2099-01-01T09:00:00.000Z',
                ownerUserId: 12,
                ownerState: 'typed',
                controlMeta: { canReschedule: true }
            }]
        };
    `, ctx);
    ctx.apiPost = async (url, payload) => {
        calls.push({ url, payload });
        return { success: true };
    };
    ctx.showNotification = () => {};
    ctx.refreshMyCabinetTab = async () => {};

    await ctx.moveCabinetTaskToToday(88, 'drag');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/tasks/88/reschedule');
    assert.equal(calls[0].payload.sourceSurface, 'profile_my_cabinet_move_to_today_drop');
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
    assert.match(source, /profile_my_cabinet_move_to_today_drop/);
    assert.match(routeSource, /profile_my_cabinet_overdue_to_today_drop/);
    assert.match(routeSource, /profile_my_cabinet_move_to_today_drop/);
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

test('my cabinet task projection counts today, undated and overdue carry-over workload', () => {
    const source = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const authSource = fs.readFileSync(path.join(ROOT, 'routes', 'auth.js'), 'utf8');
    const sidebarSource = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');

    assert.match(source, /function taskWorkloadDateSql/);
    assert.match(source, /taskQuick/);
    assert.match(source, /completed:\s*quickStats\.done_today/);
    assert.match(source, /completedToday:\s*quickStats\.done_today/);
    assert.match(source, /completedTotal:\s*quickStats\.done_total/);
    assert.match(source, /completedSubtasksToday:\s*quickStats\.subtask_done_today/);
    assert.match(source, /completedMetricContract:\s*'completed_units = completed_parent_tasks \+ completed_subtasks'/);
    assert.match(source, /remaining_today/);
    assert.match(source, /overdue_carryover/);
    assert.match(source, /active_my_day/);
    assert.match(source, /remaining:\s*activeMyDay/);
    assert.match(source, /scope:\s*'completed_units_today_and_active_my_day_or_undated'/);
    assert.match(source, /scheduled_start_at/);
    assert.match(source, /snoozed_until/);
    assert.match(source, /taskPriorityOrderSql/);
    assert.match(source, /applyUrgentPriorityDefaults/);
    assert.match(source, /dueDate && dueDate < today/);
    assert.match(source, /dueDate === today \|\| !dueDate/);
    assert.match(source, /COALESCE\(subtask_rows\.subtasks, '\[\]'::json\) AS subtasks/);
    assert.match(authSource, /Completed work units \(parent tasks \+ completed subtasks\)/);
    assert.match(authSource, /tasks\.completedUnits = parentDoneTotal \+ subtaskDoneTotal/);
    assert.match(authSource, /tasks\.done = tasks\.completedUnits/);
    assert.match(authSource, /subtasksDoneToday/);
    assert.doesNotMatch(sidebarSource, /Number\(tasks\.assigned \|\| 0\) \+ Number\(tasks\.in_progress \|\| 0\)/);
});

test('urgent priority has dashboard alert escalation and alert-panel commitment action', () => {
    const tasksSource = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const dashboardSource = fs.readFileSync(path.join(ROOT, 'routes', 'dashboard.js'), 'utf8');
    const alertsSource = fs.readFileSync(path.join(ROOT, 'js', 'alerts.js'), 'utf8');

    assert.match(tasksSource, /const VALID_PRIORITIES = \['low', 'normal', 'high', 'urgent'\]/);
    assert.match(tasksSource, /URGENT_PRIORITY_ESCALATION_MINUTES = 90/);
    assert.match(tasksSource, /next_notification_at/);
    assert.match(dashboardSource, /function buildUrgentTaskAlerts/);
    assert.match(dashboardSource, /urgent_task_/);
    assert.match(tasksSource, /commitment_time/);
    assert.match(alertsSource, /startsWith\('urgent_task_'\)/);
    assert.match(alertsSource, /Коли візьмете термінову задачу в роботу/);
});
