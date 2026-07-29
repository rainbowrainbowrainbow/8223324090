const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadProfileTaskerContext() {
    const sandbox = {
        console,
        fetch: async (url) => {
            const target = String(url || '');
            if (target.includes('/business/live-counters')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        counters: {
                            total: { alerts: { active: 0 }, leads: { hot: 0, new: 0 } },
                            byBusiness: {
                                event_genix: { alerts: { active: 0 }, leads: { hot: 0, new: 0 } }
                            }
                        }
                    })
                };
            }
            throw new Error(`Unexpected profile tasker fetch in test harness: ${target}`);
        },
        getAuthHeaders: () => ({}),
        handleAuthError: () => false,
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

function loadTaskCreateContext() {
    const sandbox = {
        console,
        fetch: async () => ({ ok: true, json: async () => ({}) }),
        window: null
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'task-create.js'), 'utf8'), sandbox);
    return sandbox;
}

function addDaysToDateKey(dateText, days = 0) {
    const date = new Date(`${dateText}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function monthEndDateKey(dateText) {
    const date = new Date(`${dateText}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return date.toISOString().slice(0, 10);
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

test('profile My Day compact capsule uses existing identity and profession helpers', () => {
    const ctx = loadProfileTaskerContext();
    const html = vm.runInContext(`
        profileData = {
            user: {
                id: 7,
                name: 'Олена Коваль',
                username: 'olena',
                role: 'animator'
            },
            staffProfile: {
                primary_profession: 'animator'
            }
        };
        isOwnProfile = true;
        renderProfileMyDayCapsule(profileData, profileProfessionEntries());
    `, ctx);
    const source = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');

    assert.match(html, /data-profile-my-day-capsule/);
    assert.match(html, /Олена Коваль/);
    assert.doesNotMatch(html, /profile-my-day-capsule-subtitle/);
    assert.match(html, /profile-my-day-capsule-avatar/);
    assert.doesNotMatch(html, /profile-working-role-trigger/);
    assert.match(source, /const isMyDayTab = activeTab === 'myday';/);
    assert.match(source, /profile-work-header--myday/);
    assert.match(source, /renderProfileMyDayCapsule\(p, professionEntries\)/);
    assert.match(source, /renderProfileProfessionHeaderPanel\(professionEntries\)/);
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

test('profile My Day renders fixed today and overdue columns while hiding duplicated controls', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();
    const overdue = addDaysToDateKey(today, -1);
    vm.runInContext(`
        myCabinetData = {
            all: [
                { id: 101, title: 'Today segment task', date: '${today}' },
                { id: 102, title: 'Overdue segment task', date: '${overdue}' }
            ],
            today: [],
            next: [],
            overdue: [],
            waiting: [{ id: 103, title: 'Waiting segment task', workflowState: 'waiting' }],
            deferred: [],
            private: [{ id: 104, title: 'Private segment task', visibility: 'private', taskMode: 'private' }],
            completedHistory: [
                { id: 105, title: 'Completed segment task', status: 'done', completedAt: '${today}T10:00:00.000Z' },
                { id: 106, title: 'Completed second task', status: 'done', completedAt: '${today}T11:00:00.000Z' }
            ],
            stats: { taskQuick: { completedTotal: 2, completedToday: 2, activeMyDay: 4 } }
        };
        cabinetTaskComposerExpanded = false;
        cabinetMyDayListMode = 'focused';
        cabinetCreateDuePreset = 'today';
        cabinetMyDaySegment = 'today';
    `, ctx);

    const counts = ctx.cabinetMyDaySegmentCounts();
    assert.equal(counts.today, 1);
    assert.equal(counts.overdue, 1);
    assert.equal(counts.waiting, 1);
    assert.equal(counts.completed, 2);
    assert.equal(counts.private, 1);

    let html = ctx.renderMyDayTab();
    assert.doesNotMatch(html, /cabinet-day-command-bar/);
    assert.doesNotMatch(html, /cabinet-my-day-segments/);
    assert.doesNotMatch(html, /data-cabinet-my-day-segment="/);
    assert.doesNotMatch(html, /data-cabinet-my-day-sound-settings/);
    assert.doesNotMatch(html, /cabinet-support-panel/);
    assert.doesNotMatch(html, /cabinet-quick-cluster/);
    assert.match(html, /cabinet-task-composer/);
    assert.match(html, /data-cabinet-my-day-layout="today-overdue"/);
    assert.match(html, /cabinet-day-column--today/);
    assert.match(html, /cabinet-day-column--overdue/);
    assert.match(html, /data-active-today="1"/);
    assert.match(html, /data-active-overdue="1"/);
    assert.match(html, /Today segment task/);
    assert.match(html, /Overdue segment task/);
    assert.doesNotMatch(html, /Waiting segment task/);

    ctx.setCabinetMyDaySegment('waiting');
    html = ctx.renderMyDayTab();
    assert.doesNotMatch(html, /cabinet-my-day-segments/);
    assert.match(html, /data-cabinet-my-day-layout="today-overdue"/);
    assert.match(html, /Today segment task/);
    assert.match(html, /Overdue segment task/);
    assert.doesNotMatch(html, /Waiting segment task/);
    assert.doesNotMatch(html, /cabinet-list-mode-toggle/);

    ctx.setCabinetMyDaySegment('completed');
    html = ctx.renderMyDayTab();
    assert.match(html, /data-cabinet-my-day-layout="today-overdue"/);
    assert.match(html, /cabinet-completed-strip/);
    assert.match(html, /Completed segment task/);
});

test('profile My Day overdue segment renders triage rows with existing task actions', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const cabinetCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-cabinet.css'), 'utf8');
    const taskCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-tasks.css'), 'utf8');
    const today = taskCreateCtx.TaskCreate.todayStr();
    const overdue = addDaysToDateKey(today, -2);

    vm.runInContext(`
        activeTab = 'myday';
        cabinetMyDaySegment = 'overdue';
        cabinetMyDayListMode = 'focused';
        cabinetCreateDuePreset = 'today';
        myCabinetData = {
            all: [
                {
                    id: 201,
                    title: 'Overdue triage task',
                    date: '${overdue}',
                    priority: 'urgent',
                    subtask_count: 2,
                    subtask_done_count: 1,
                    controlMeta: { canReschedule: true }
                }
            ],
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: []
        };
    `, ctx);

    const html = ctx.renderMyDayTab();
    assert.match(html, /data-cabinet-my-day-layout="today-overdue"/);
    assert.match(html, /data-cabinet-overdue-triage/);
    assert.match(html, /Прострочено · 1/);
    assert.match(html, /cabinet-overdue-triage-row/);
    assert.match(html, /href="\/tasks\?view=my&open=201"/);
    assert.match(html, /data-cabinet-task-action="move-to-today"/);
    assert.match(html, /data-cabinet-task-action="reschedule-overdue"/);
    assert.match(html, /data-reschedule-option="custom"/);
    assert.match(html, /data-source-surface="profile_my_cabinet_overdue_triage"/);
    assert.match(html, /data-cabinet-task-action="done"/);
    assert.match(html, /data-cabinet-task-action="move-target"/);
    assert.match(html, /data-cabinet-move-target="no_date"/);
    assert.match(html, /data-cabinet-move-method="triage"/);
    assert.doesNotMatch(html, /data-cabinet-active-subtask-slice/);
    assert.match(cabinetCss, /\.cabinet-overdue-triage\s*\{[\s\S]*container-type:\s*inline-size;/);
    assert.match(cabinetCss, /@container \(max-width: 640px\)\s*\{[\s\S]*\.cabinet-overdue-triage-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    assert.match(cabinetCss, /\.cabinet-overdue-triage-actions\s*\{[\s\S]*flex-wrap:\s*wrap;/);
    assert.match(cabinetCss, /\.cabinet-overdue-triage-title\s*\{[\s\S]*overflow-wrap:\s*break-word;/);
    assert.match(taskCss, /\.cabinet-command-center\s*\{[\s\S]*container-type:\s*inline-size;/);
    assert.match(taskCss, /@container \(max-width: 1120px\)\s*\{[\s\S]*\.cabinet-day-workspace--two-column\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
});

test('profile My Day hides sound shortcut after command bar cleanup while preserving settings helpers', () => {
    const ctx = loadProfileTaskerContext();
    const profileSource = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');

    vm.runInContext(`
        activeTab = 'myday';
        cabinetMyDaySegment = 'today';
        cabinetMyDayListMode = 'focused';
        cabinetCreateDuePreset = 'today';
        myCabinetData = {
            all: [],
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: []
        };
    `, ctx);

    const html = ctx.renderMyDayTab();
    assert.doesNotMatch(html, /data-cabinet-my-day-sound-settings/);
    assert.doesNotMatch(html, /cabinet-day-command-bar/);
    assert.doesNotMatch(html, /cabinet-day-action--settings/);
    assert.doesNotMatch(html, /<h3>Звук<\/h3>[\s\S]*data-cabinet-task-sound-controls/);
    assert.match(profileSource, /function renderCabinetMyDaySoundSettingsAction/);
    assert.match(profileSource, /function openCabinetMyDaySoundSettings/);
    assert.match(profileSource, /function bindCabinetTaskSoundControls/);
    assert.match(profileSource, /bindCabinetTaskSoundControls\(root\)/);
    assert.match(profileSource, /apiPatch\('\/tasks\/preferences'/);
});

test('profile My Day completed history is compact by default while preserving day groups', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();

    vm.runInContext(`
        activeTab = 'myday';
        cabinetMyDaySegment = 'completed';
        myCabinetData = {
            all: [],
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: [
                { id: 301, title: 'Closed payload task', status: 'done', completedAt: '${today}T10:00:00.000Z' }
            ],
            stats: { taskQuick: { completedTotal: 1, completedToday: 1, activeMyDay: 0 } }
        };
    `, ctx);

    const html = ctx.renderMyDayTab();
    assert.match(html, /cabinet-completed-strip--compact/);
    assert.match(html, /<details class="cabinet-completed-details">/);
    assert.match(html, /<summary class="cabinet-completed-strip-summary">/);
    assert.doesNotMatch(html, /<details class="cabinet-completed-details" open>/);
    assert.match(html, /1 виконань/);
    assert.match(html, /Closed payload task/);
    assert.match(html, /data-cabinet-completed-day-divider/);
    assert.match(html, /aria-describedby=/);
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
    assert.match(collapsedHtml, /data-cabinet-due-preset="today"/);
    assert.match(collapsedHtml, /data-cabinet-due-preset="tomorrow"/);
    assert.match(collapsedHtml, /data-cabinet-due-preset="day_after_tomorrow"/);
    assert.match(collapsedHtml, /data-cabinet-due-preset="plus_3_days"/);
    assert.match(collapsedHtml, /data-cabinet-due-preset="month_end"/);
    assert.match(collapsedHtml, /data-cabinet-due-preset="no_date"/);
    assert.match(collapsedHtml, /data-cabinet-due-preset="custom"/);
    assert.doesNotMatch(collapsedHtml, /data-cabinet-due-preset="all"/);
    assert.doesNotMatch(collapsedHtml, /data-cabinet-due-preset="normal"/);
    assert.match(collapsedHtml, /class="cabinet-priority-presets"/);
    assert.match(collapsedHtml, /data-cabinet-priority-preset="urgent"/);
    assert.match(collapsedHtml, /data-cabinet-priority-preset="normal"/);
    assert.match(collapsedHtml, /Терміново/);
    assert.doesNotMatch(collapsedHtml, /cabinet-task-composer-hint/);
    assert.match(collapsedHtml, /data-cabinet-composer-advanced aria-hidden="true"[^>]*hidden/);

    vm.runInContext('cabinetTaskComposerExpanded = true;', ctx);
    const expandedHtml = ctx.renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' });
    assert.match(expandedHtml, /cabinet-task-composer is-expanded/);
    assert.match(expandedHtml, /data-cabinet-composer-state="expanded"/);
    assert.match(expandedHtml, /Згорнути/);
    assert.doesNotMatch(expandedHtml, /data-cabinet-composer-advanced aria-hidden="true"[^>]*hidden/);
});

test('profile task composer keeps date presets separate from priority presets', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext('cabinetTaskComposerExpanded = false; cabinetCreatePriority = "normal"; cabinetCreateDuePreset = "today";', ctx);

    const html = ctx.renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' });
    const dueRow = html.match(/<div class="cabinet-due-presets"[\s\S]*?<\/div>/)?.[0] || '';
    const priorityRow = html.match(/<div class="cabinet-priority-presets"[\s\S]*?<\/div>/)?.[0] || '';
    const normalPriorityLabel = vm.runInContext("CABINET_TASK_PRIORITIES.find(item => item.value === 'normal').label", ctx);

    assert.match(dueRow, /data-cabinet-due-preset="today"/);
    assert.match(dueRow, /data-cabinet-due-preset="tomorrow"/);
    assert.match(dueRow, /data-cabinet-due-preset="day_after_tomorrow"/);
    assert.match(dueRow, /data-cabinet-due-preset="plus_3_days"/);
    assert.match(dueRow, /data-cabinet-due-preset="month_end"/);
    assert.match(dueRow, /data-cabinet-due-preset="no_date"/);
    assert.match(dueRow, /data-cabinet-due-preset="custom"/);
    assert.doesNotMatch(dueRow, /data-cabinet-priority-preset=/);
    assert.doesNotMatch(dueRow, /data-cabinet-due-preset="normal"/);
    assert.equal(dueRow.includes(normalPriorityLabel), false);

    assert.match(priorityRow, /data-cabinet-priority-preset="urgent"/);
    assert.match(priorityRow, /data-cabinet-priority-preset="high"/);
    assert.match(priorityRow, /data-cabinet-priority-preset="normal"/);
    assert.match(priorityRow, /data-cabinet-priority-preset="low"/);
    assert.match(priorityRow, /aria-pressed="true"/);
    assert.match(priorityRow, new RegExp(normalPriorityLabel));
    assert.doesNotMatch(priorityRow, /data-cabinet-due-preset=/);
});

test('shared TaskCreate adapter resolves extended due presets from Kyiv date context', () => {
    const ctx = loadTaskCreateContext();
    const today = ctx.TaskCreate.todayStr();

    assert.equal(ctx.TaskCreate.dateForDuePresetValue('today'), today);
    assert.equal(ctx.TaskCreate.dateForDuePresetValue('tomorrow'), addDaysToDateKey(today, 1));
    assert.equal(ctx.TaskCreate.dateForDuePresetValue('day_after_tomorrow'), addDaysToDateKey(today, 2));
    assert.equal(ctx.TaskCreate.dateForDuePresetValue('day_after'), addDaysToDateKey(today, 2));
    assert.equal(ctx.TaskCreate.dateForDuePresetValue('plus_3_days'), addDaysToDateKey(today, 3));
    assert.equal(ctx.TaskCreate.dateForDuePresetValue('month_end'), monthEndDateKey(today));
    assert.equal(ctx.TaskCreate.dateForDuePresetValue('no_date'), '');
    assert.equal(ctx.TaskCreate.dateForDuePresetValue('custom', '2026-07-18'), '2026-07-18');
});

test('profile My Day state keeps list mode separate from due preset', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const controls = new Map([
        ['cabinetTaskDate', { value: '' }]
    ]);
    ctx.TaskCreate = taskCreateCtx.TaskCreate;
    ctx.document = {
        addEventListener() {},
        getElementById(id) {
            return controls.get(id) || null;
        },
        querySelectorAll() {
            return [];
        }
    };

    assert.equal(ctx.getCabinetMyDayState().selectedDuePreset, 'today');
    assert.equal(ctx.getCabinetMyDayState().listMode, 'focused');

    assert.equal(ctx.setCabinetMyDayListMode('all'), 'all');
    ctx.setCabinetDuePreset('day_after_tomorrow');
    const state = ctx.getCabinetMyDayState();
    const today = taskCreateCtx.TaskCreate.todayStr();

    assert.equal(state.selectedDuePreset, 'day_after_tomorrow');
    assert.equal(state.selectedDueDate, addDaysToDateKey(today, 2));
    assert.equal(state.selectedPriority, 'normal');
    assert.equal(state.listMode, 'all');
    assert.equal(controls.get('cabinetTaskDate').value, addDaysToDateKey(today, 2));

    ctx.setCabinetDuePreset('not-real');
    assert.equal(ctx.getCabinetMyDayState().selectedDuePreset, 'today');
    assert.equal(ctx.getCabinetMyDayState().listMode, 'all');
});

test('profile My Day fixed workspace ignores composer due preset for visible task columns', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();
    const tomorrow = addDaysToDateKey(today, 1);
    const afterTomorrow = addDaysToDateKey(today, 2);
    const plusThree = addDaysToDateKey(today, 3);
    const monthEnd = monthEndDateKey(today);
    const overdue = addDaysToDateKey(today, -1);
    const tasks = [
        { id: 1, title: 'Today focus task', date: today },
        { id: 2, title: 'No date focus task' },
        { id: 3, title: 'Tomorrow focus task', date: tomorrow },
        { id: 4, title: 'After tomorrow focus task', date: afterTomorrow },
        { id: 5, title: 'Plus three focus task', date: plusThree },
        { id: 6, title: 'Month end focus task', date: monthEnd },
        { id: 7, title: 'Overdue focus task', date: overdue },
        { id: 8, title: 'Deferred tomorrow task', date: tomorrow, snoozedUntil: '2999-01-01T09:00:00.000Z' }
    ];
    vm.runInContext(`
        myCabinetData = {
            all: ${JSON.stringify(tasks)},
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: [],
            stats: { taskQuick: { completedToday: 0, activeMyDay: ${tasks.length} } }
        };
        cabinetTaskComposerExpanded = false;
        cabinetMyDayListMode = 'focused';
        cabinetCreateDuePreset = 'tomorrow';
    `, ctx);

    let html = ctx.renderMyDayTab();
    assert.match(html, /data-cabinet-due-preset="tomorrow" aria-pressed="true"/);
    assert.match(html, /data-cabinet-my-day-layout="today-overdue"/);
    assert.match(html, /Today focus task/);
    assert.match(html, /Overdue focus task/);
    assert.doesNotMatch(html, /Tomorrow focus task/);
    assert.doesNotMatch(html, /No date focus task/);
    assert.doesNotMatch(html, /Deferred tomorrow task/);

    ctx.setCabinetMyDaySegment('overdue');
    const overdueHtml = ctx.renderMyDayTab();
    assert.match(overdueHtml, /data-cabinet-my-day-layout="today-overdue"/);
    assert.match(overdueHtml, /Today focus task/);
    assert.match(overdueHtml, /Overdue focus task/);
    ctx.setCabinetMyDaySegment('today');

    vm.runInContext(`cabinetCreateDuePreset = 'no_date';`, ctx);
    html = ctx.renderMyDayTab();
    assert.match(html, /data-cabinet-due-preset="no_date" aria-pressed="true"/);
    assert.match(html, /Today focus task/);
    assert.match(html, /Overdue focus task/);
    assert.doesNotMatch(html, /No date focus task/);
    assert.doesNotMatch(html, /Tomorrow focus task/);

    vm.runInContext(`cabinetCreateDuePreset = 'day_after_tomorrow';`, ctx);
    html = ctx.renderMyDayTab();
    assert.match(html, /data-cabinet-due-preset="day_after_tomorrow" aria-pressed="true"/);
    assert.doesNotMatch(html, /After tomorrow focus task/);
    assert.doesNotMatch(html, /Tomorrow focus task/);

    vm.runInContext(`cabinetCreateDuePreset = 'plus_3_days';`, ctx);
    html = ctx.renderMyDayTab();
    assert.match(html, /data-cabinet-due-preset="plus_3_days" aria-pressed="true"/);
    assert.doesNotMatch(html, /Plus three focus task/);
    assert.doesNotMatch(html, /After tomorrow focus task/);

    vm.runInContext(`cabinetCreateDuePreset = 'month_end';`, ctx);
    html = ctx.renderMyDayTab();
    assert.match(html, /data-cabinet-due-preset="month_end" aria-pressed="true"/);
    assert.doesNotMatch(html, /Month end focus task/);
});

test('profile My Day custom date stays a composer/projection setting without switching fixed columns', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const customDate = addDaysToDateKey(taskCreateCtx.TaskCreate.todayStr(), 10);
    const otherDate = addDaysToDateKey(customDate, 1);
    ctx.document = {
        addEventListener() {},
        getElementById(id) {
            return id === 'cabinetTaskDate' ? { value: customDate } : null;
        },
        querySelectorAll() {
            return [];
        }
    };
    vm.runInContext(`
        myCabinetData = {
            all: [
                { id: 11, title: 'Custom date focus task', date: '${customDate}' },
                { id: 12, title: 'Other date focus task', date: '${otherDate}' }
            ],
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: [],
            stats: { taskQuick: { completedToday: 0, activeMyDay: 2 } }
        };
        cabinetTaskComposerExpanded = false;
        cabinetMyDayListMode = 'focused';
        cabinetCreateDuePreset = 'custom';
    `, ctx);

    const state = ctx.getCabinetMyDayState();
    const focusedTasks = ctx.cabinetFocusedMyDayTasks(state);
    const html = ctx.renderMyDayTab();
    assert.equal(focusedTasks[0]?.title, 'Custom date focus task');
    assert.match(html, /data-cabinet-due-preset="custom" aria-pressed="true"/);
    assert.doesNotMatch(html, /Custom date focus task/);
    assert.doesNotMatch(html, /Other date focus task/);
});

test('profile My Day focused mode ignores invalid custom dates without throwing', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const futureDate = addDaysToDateKey(taskCreateCtx.TaskCreate.todayStr(), 10);
    ctx.document = {
        addEventListener() {},
        getElementById(id) {
            return id === 'cabinetTaskDate' ? { value: 'not-a-date' } : null;
        },
        querySelectorAll() {
            return [];
        }
    };
    vm.runInContext(`
        myCabinetData = {
            all: [
                { id: 14, title: 'Invalid custom date task', date: '${futureDate}' }
            ],
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: [],
            stats: { taskQuick: { completedToday: 0, activeMyDay: 1 } }
        };
        cabinetTaskComposerExpanded = false;
        cabinetMyDayListMode = 'focused';
        cabinetCreateDuePreset = 'custom';
    `, ctx);

    const state = ctx.getCabinetMyDayState();
    const html = ctx.renderMyDayTab();
    assert.equal(state.selectedDueDate, '');
    assert.doesNotMatch(html, /Invalid custom date task/);
});

test('profile My Day focus helpers can read additive planning without changing fixed columns', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();
    const monthEnd = monthEndDateKey(today);
    vm.runInContext(`
        myCabinetData = {
            all: [],
            planning: {
                all: [
                    { id: 18, title: 'Planning month end task', date: '${monthEnd}' }
                ],
                monthEnd: [
                    { id: 18, title: 'Planning month end task', date: '${monthEnd}' }
                ]
            },
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: [],
            stats: { taskQuick: { completedToday: 0, activeMyDay: 1 } }
        };
        cabinetTaskComposerExpanded = false;
        cabinetMyDayListMode = 'focused';
        cabinetCreateDuePreset = 'month_end';
    `, ctx);

    const state = ctx.getCabinetMyDayState();
    const focusedTasks = ctx.cabinetFocusedMyDayTasks(state);
    const html = ctx.renderMyDayTab();

    assert.equal(focusedTasks[0]?.title, 'Planning month end task');
    assert.match(html, /data-cabinet-due-preset="month_end" aria-pressed="true"/);
    assert.doesNotMatch(html, /Planning month end task/);
});

test('profile My Day hides all-mode groups in the fixed workspace without changing selected due preset', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();
    const tomorrow = addDaysToDateKey(today, 1);
    const laterEarly = addDaysToDateKey(today, 2);
    const laterLate = addDaysToDateKey(today, 5);
    const overdue = addDaysToDateKey(today, -1);
    const tasks = [
        { id: 21, title: 'All overdue task', date: overdue },
        { id: 22, title: 'All today task', date: today },
        { id: 22, title: 'All today duplicate task', date: today },
        { id: 23, title: 'All tomorrow task', date: tomorrow },
        { id: 24, title: 'All later late task', date: laterLate },
        { id: 25, title: 'All later early task', date: laterEarly },
        { id: 26, title: 'All no date task' },
        { id: 27, title: 'All done task', date: today, status: 'done' },
        { id: 28, title: 'All deferred task', date: tomorrow, snoozedUntil: '2999-01-01T09:00:00.000Z' }
    ];
    vm.runInContext(`
        myCabinetData = {
            all: ${JSON.stringify(tasks)},
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: [],
            stats: { taskQuick: { completedToday: 0, activeMyDay: ${tasks.length} } }
        };
        cabinetTaskComposerExpanded = false;
        cabinetMyDayListMode = 'all';
        cabinetCreateDuePreset = 'tomorrow';
    `, ctx);
    ctx.setCabinetAllGroupCollapsed('later', false);
    ctx.setCabinetAllGroupCollapsed('no_date', false);

    const html = ctx.renderMyDayTab();

    assert.equal(ctx.getCabinetMyDayState().selectedDuePreset, 'tomorrow');
    assert.equal(ctx.getCabinetMyDayState().listMode, 'all');
    assert.match(html, /data-cabinet-due-preset="tomorrow" aria-pressed="true"/);
    assert.doesNotMatch(html, /cabinet-list-mode-toggle/);
    assert.doesNotMatch(html, /data-cabinet-list-mode="all"/);
    assert.doesNotMatch(html, /data-cabinet-all-group=/);
    assert.match(html, /data-cabinet-my-day-layout="today-overdue"/);
    assert.match(html, /All overdue task/);
    assert.match(html, /All today task/);
    assert.doesNotMatch(html, /All tomorrow task/);
    assert.doesNotMatch(html, /All later early task/);
    assert.doesNotMatch(html, /All later late task/);
    assert.doesNotMatch(html, /All no date task/);
    assert.doesNotMatch(html, /All today duplicate task/);
    assert.doesNotMatch(html, /All done task/);
    assert.doesNotMatch(html, /All deferred task/);
});

test('profile My Day all-mode group helpers remain available without rendering the fixed workspace toggle', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();
    const later = addDaysToDateKey(today, 6);
    vm.runInContext(`
        myCabinetData = {
            all: [
                { id: 31, title: 'Visible today all task', date: '${today}' },
                { id: 32, title: 'Hidden later all task', date: '${later}' },
                { id: 33, title: 'Hidden no date all task' }
            ],
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: [],
            stats: { taskQuick: { completedToday: 0, activeMyDay: 3 } }
        };
        cabinetTaskComposerExpanded = false;
        cabinetMyDayListMode = 'all';
        cabinetCreateDuePreset = 'today';
    `, ctx);

    let html = ctx.renderMyDayTab();
    const groupsHtml = ctx.renderCabinetAllMyDayGroups();

    assert.equal(ctx.isCabinetAllGroupCollapsed('later'), true);
    assert.equal(ctx.isCabinetAllGroupCollapsed('no_date'), true);
    assert.doesNotMatch(html, /data-cabinet-all-group=/);
    assert.doesNotMatch(html, /cabinet-list-mode-toggle/);
    assert.match(groupsHtml, /data-cabinet-all-group="today"[\s\S]*?aria-expanded="true"[\s\S]*?<span>1<\/span>/);
    assert.match(groupsHtml, /cabinet-task-section[\s\S]*?is-collapsed[\s\S]*?data-cabinet-all-group="later"[\s\S]*?data-cabinet-all-group-toggle="later"[\s\S]*?aria-expanded="false"[\s\S]*?hidden><\/div>/);
    assert.match(groupsHtml, /data-cabinet-all-group="no_date"[\s\S]*?data-cabinet-all-group-toggle="no_date"[\s\S]*?aria-expanded="false"[\s\S]*?<span>1<\/span>/);
    assert.match(html, /Visible today all task/);
    assert.doesNotMatch(html, /Hidden later all task/);
    assert.doesNotMatch(html, /Hidden no date all task/);

    ctx.setCabinetAllGroupCollapsed('later', false);
    html = ctx.renderCabinetAllMyDayGroups();

    assert.match(html, /data-cabinet-all-group-toggle="later"[\s\S]*?aria-expanded="true"/);
    assert.match(html, /Hidden later all task/);
    assert.equal(ctx.toggleCabinetAllGroup('later'), true);
    assert.equal(ctx.isCabinetAllGroupCollapsed('later'), true);
});

test('profile My Day all-mode merge helper stays available without driving the fixed workspace', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();
    const tomorrow = addDaysToDateKey(today, 1);
    const later = addDaysToDateKey(today, 4);
    vm.runInContext(`
        myCabinetData = {
            all: [
                { id: 41, title: 'Legacy duplicate title', date: '${tomorrow}' },
                { id: 42, title: 'Legacy later task', date: '${later}' }
            ],
            planning: {
                all: [
                    { id: 41, title: 'Planning tomorrow task', date: '${tomorrow}' },
                    { id: 43, title: 'Planning no date task' }
                ],
                tomorrow: [
                    { id: 41, title: 'Planning tomorrow task', date: '${tomorrow}' }
                ],
                noDate: [
                    { id: 43, title: 'Planning no date task' }
                ]
            },
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: [],
            stats: { taskQuick: { completedToday: 0, activeMyDay: 3 } }
        };
        cabinetTaskComposerExpanded = false;
        cabinetMyDayListMode = 'all';
        cabinetCreateDuePreset = 'tomorrow';
    `, ctx);
    ctx.setCabinetAllGroupCollapsed('later', false);
    ctx.setCabinetAllGroupCollapsed('no_date', false);

    const helperHtml = ctx.renderCabinetAllMyDayGroups();
    const html = ctx.renderMyDayTab();

    assert.match(helperHtml, /Planning tomorrow task/);
    assert.match(helperHtml, /Planning no date task/);
    assert.match(helperHtml, /Legacy later task/);
    assert.doesNotMatch(helperHtml, /Legacy duplicate title/);
    assert.doesNotMatch(html, /Planning tomorrow task/);
    assert.doesNotMatch(html, /Planning no date task/);
    assert.doesNotMatch(html, /Legacy later task/);
});

test('profile My Day custom date projection requests focusDate without sending invalid dates', async () => {
    const ctx = loadProfileTaskerContext();
    const requested = [];
    const controls = new Map([
        ['cabinetTaskDate', { value: '2026-09-15' }]
    ]);
    ctx.document = {
        addEventListener() {},
        getElementById(id) {
            return controls.get(id) || null;
        },
        querySelectorAll() {
            return [];
        }
    };
    ctx.apiGet = async url => {
        requested.push(url);
        return {
            all: [],
            planning: { all: [{ id: 91, title: 'Future custom task', date: '2026-09-15' }] },
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            private: [],
            completedHistory: []
        };
    };
    vm.runInContext(`cabinetCreateDuePreset = 'custom';`, ctx);

    await ctx.loadMyCabinetProjection();

    assert.equal(requested.at(-1), '/tasks/my-cabinet?focusDate=2026-09-15');

    controls.get('cabinetTaskDate').value = 'not-a-date';
    await ctx.loadMyCabinetProjection();

    assert.equal(requested.at(-1), '/tasks/my-cabinet');
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

    assert.doesNotMatch(myDayHtml, /cabinet-quick-cluster/);
    assert.doesNotMatch(myDayHtml, /cabinet-day-command-bar/);
    assert.match(myDayHtml, /cabinet-task-composer/);
    assert.doesNotMatch(myDayHtml, /cabinet-list-mode-toggle/);
    assert.doesNotMatch(myDayHtml, /data-cabinet-list-mode="focused"/);
    assert.doesNotMatch(myDayHtml, /data-cabinet-list-mode="all"/);
    assert.match(myDayHtml, /data-cabinet-my-day-layout="today-overdue"/);
    assert.doesNotMatch(myDayHtml, /data-cabinet-due-preset="all"/);
    assert.match(myDayHtml, /data-cabinet-task-drop-target="today"/);
    assert.doesNotMatch(myTasksHtml, /cabinet-quick-cluster/);
    assert.doesNotMatch(myTasksHtml, /cabinet-day-command-bar/);
    assert.match(myTasksHtml, /cabinet-task-composer/);
    assert.match(myTasksHtml, /data-cabinet-my-day-layout="today-overdue"/);
    assert.match(source, /function normalizeProfileTaskTab/);
    assert.match(source, /return tab === 'mytasks' \? 'myday' : tab;/);
    assert.match(source, /function syncProfileTabToUrl/);
    assert.match(source, /params\.set\('tab', normalized\)/);
    assert.match(source, /addEventListener\('popstate'/);
    assert.doesNotMatch(source, /cabinet-shell--mytasks/);
    assert.doesNotMatch(source, /href="\/profile\?tab=mytasks"/);
});

test('profile My Day keeps existing projection and shows a non-sensitive load notice on refresh failure', async () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext(`
        myCabinetData = {
            all: [{ id: 81, title: 'Sensitive existing task title', date: cabinetDateKeyOffset(0) }],
            today: [],
            overdue: [],
            waiting: [],
            private: [],
            completedHistory: [],
            stats: { taskQuick: { completedToday: 0, activeMyDay: 1 } }
        };
        myCabinetLoadError = '';
        cabinetTaskComposerExpanded = false;
        cabinetMyDayListMode = 'focused';
        cabinetCreateDuePreset = 'today';
        apiGet = async function() { return null; };
        refreshCabinetPulseCounts = async function() {};
    `, ctx);

    const result = await ctx.refreshMyCabinetTab({ silent: true, keepExistingOnError: true });
    const state = vm.runInContext('({ data: myCabinetData, error: myCabinetLoadError })', ctx);
    const html = ctx.renderMyDayTab();
    const noticeHtml = html.match(/<div class="cabinet-load-notice"[\s\S]*?<\/div>/)?.[0] || '';

    assert.equal(result, null);
    assert.equal(state.data.all[0].title, 'Sensitive existing task title');
    assert.match(state.error, /Не вдалося завантажити задачі/);
    assert.match(noticeHtml, /data-cabinet-refresh/);
    assert.doesNotMatch(noticeHtml, /Sensitive existing task title/);
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

test('profile My Day compact cards keep critical badges and progress in a bounded shell', () => {
    const ctx = loadProfileTaskerContext();
    const task = {
        id: 44,
        title: 'Long decomposed task with enough metadata to force compact scanning',
        deadline: '2000-01-01T09:00:00.000Z',
        priority: 'high',
        ownerUserId: 7,
        createdByUserId: 9,
        taskMode: 'work',
        taskKind: 'action',
        scheduleStatus: 'proposal',
        reportRequired: true,
        subtask_count: 2,
        subtask_done_count: 1,
        subtasks: [
            { id: 1, title: 'First', is_done: true },
            { id: 2, title: 'Second', is_done: false }
        ],
        controlMeta: { canReschedule: true }
    };

    vm.runInContext(`activeTab = 'myday';`, ctx);
    const html = ctx.renderCabinetTaskCard(task, false, { surface: 'myday', activeInlineTaskId: 44 });
    const visibleBadgeCount = (html.match(/data-cabinet-visible-badge=/g) || []).length;

    assert.match(html, /is-my-day-compact-card/);
    assert.ok(visibleBadgeCount <= 5, `expected max 5 visible badges, got ${visibleBadgeCount}`);
    assert.match(html, /data-cabinet-visible-badge="due"/);
    assert.match(html, /data-cabinet-visible-badge="priority"/);
    assert.match(html, /data-cabinet-visible-badge="report"/);
    assert.match(html, /data-task-priority="high"/);
    assert.match(html, /data-task-due-state="overdue"/);
    assert.match(html, /cabinet-subtask-progress/);
    assert.match(html, /data-cabinet-task-action="done"/);
    assert.match(html, /data-cabinet-task-action="more"/);
});

test('profile My Day shows one active checklist slice and keeps the full checklist behind the toggle', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();

    vm.runInContext(`
        activeTab = 'myday';
        cabinetMyDaySegment = 'today';
        cabinetMyDayListMode = 'focused';
        cabinetCreateDuePreset = 'today';
        activeCabinetInlineTaskId = null;
        expandedCabinetSubtaskIds.clear();
        collapsedCabinetSubtaskIds.clear();
        myCabinetData = {
            all: [
                {
                    id: 44,
                    title: 'First decomposed task',
                    date: '${today}',
                    subtask_count: 3,
                    subtask_done_count: 1,
                    subtasks: [
                        { id: 1, title: 'First done', is_done: true },
                        { id: 2, title: 'Second next', is_done: false },
                        { id: 3, title: 'Third later', is_done: false }
                    ]
                },
                {
                    id: 45,
                    title: 'Second decomposed task',
                    date: '${today}',
                    subtask_count: 2,
                    subtask_done_count: 0,
                    subtasks: [
                        { id: 4, title: 'Other next', is_done: false },
                        { id: 5, title: 'Other later', is_done: false }
                    ]
                }
            ],
            today: [],
            next: [],
            overdue: [],
            waiting: [],
            deferred: [],
            private: [],
            completedHistory: []
        };
    `, ctx);

    let html = ctx.renderMyDayTab();
    assert.equal((html.match(/data-cabinet-active-subtask-slice=/g) || []).length, 1);
    assert.match(html, /data-cabinet-active-subtask-slice="44"/);
    assert.doesNotMatch(html, /data-cabinet-active-subtask-slice="45"/);
    assert.match(html, /Second next/);
    assert.match(html, /data-cabinet-subtasks-panel="44" hidden/);
    assert.match(html, /data-cabinet-subtask-done/);
    assert.equal((html.match(/data-cabinet-subtask-summary=/g) || []).length, 2);
    assert.equal((html.match(/class="cabinet-subtask-progress"/g) || []).length, 2);
    assert.match(html, /data-task-id="45"[\s\S]*data-cabinet-subtask-summary="45"/);
    assert.doesNotMatch(html, /cabinet-subtask-compact-summary/);
    assert.doesNotMatch(html, /cabinet-subtask-inline-head/);

    vm.runInContext(`setCabinetActiveInlineTask(44, { expanded: true });`, ctx);
    html = ctx.renderMyDayTab();
    assert.equal((html.match(/data-cabinet-active-subtask-slice=/g) || []).length, 0);
    assert.match(html, /is-subtasks-expanded/);
    assert.doesNotMatch(html, /data-cabinet-subtasks-panel="44" hidden/);
    assert.match(html, /data-cabinet-subtask-summary="44"[\s\S]*aria-expanded="true"/);
    assert.doesNotMatch(html, /cabinet-subtask-inline-head/);
    assert.ok((html.match(/data-cabinet-inline-subtask/g) || []).length >= 3);

    vm.runInContext(`setCabinetActiveInlineTask(45, { expanded: false });`, ctx);
    html = ctx.renderMyDayTab();
    assert.equal((html.match(/data-cabinet-active-subtask-slice=/g) || []).length, 1);
    assert.match(html, /data-cabinet-active-subtask-slice="45"/);
    assert.match(html, /Other next/);
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
    const source = fs.readFileSync(path.join(ROOT, 'services', 'taskReschedule.js'), 'utf8');
    const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');

    assert.match(source, /patch\.scheduled_start_at = newStart\.toISOString\(\)/);
    assert.match(source, /patch\.scheduled_end_at = oldEnd/);
    assert.match(source, /oldEnd\.getTime\(\) - oldStart\.getTime\(\)/);
    assert.match(source, /patch\.schedule_status = 'scheduled'/);
    assert.match(source, /profile_my_cabinet_overdue_to_today_drop/);
    assert.match(source, /profile_my_cabinet_move_to_today_drop/);
    assert.match(routeSource, /profile_my_cabinet_overdue_to_today_drop/);
    assert.match(routeSource, /profile_my_cabinet_move_to_today_drop/);
});

test('My Day renders interactive postponement levels 1 / 2 / 3+', () => {
    const ctx = loadProfileTaskerContext();
    assert.equal(ctx.renderCabinetPostponementBadge({ id: 10, postponementCount: 0 }), '');

    const first = ctx.renderCabinetPostponementBadge({ id: 11, postponementCount: 1, attentionLevel: 1 });
    const second = ctx.renderCabinetPostponementBadge({ id: 12, postponementCount: 2, attentionLevel: 2 });
    const critical = ctx.renderCabinetPostponementBadge({ id: 13, postponementCount: 5, attentionLevel: 3 });

    assert.match(first, /^<button type="button"/);
    assert.match(first, />Перенесено 1 раз<\/button>/);
    assert.match(first, /level-1/);
    assert.match(first, /data-cabinet-task-action="postponement-explanation"/);
    assert.match(first, /aria-haspopup="dialog"/);
    assert.match(first, /aria-expanded="false"/);
    assert.match(first, /aria-controls="taskUiActionSurface"/);
    assert.match(second, />Перенесено 2 рази · Пріоритет підвищено<\/button>/);
    assert.match(second, /level-2/);
    assert.match(critical, />Перенесено 5 разів · Потребує рішення<\/button>/);
    assert.match(critical, /level-3/);
    assert.match(critical, /aria-label=/);

    const profileSource = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    const taskUiSource = fs.readFileSync(path.join(ROOT, 'js', 'task-ui.js'), 'utf8');
    const cabinetCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-cabinet.css'), 'utf8');
    assert.match(profileSource, /data-task-attention-level/);
    assert.match(profileSource, /attentionLevel \? 'attention-level-' \+ attentionLevel/);
    assert.match(profileSource, /renderCabinetPostponementBadge\(task\)/);
    assert.match(profileSource, /openCabinetPostponementExplanation\(button\)/);
    assert.match(taskUiSource, /menuLastFocus\.setAttribute\('aria-expanded', 'true'\)/);
    assert.match(taskUiSource, /menuLastFocus\.setAttribute\('aria-expanded', 'false'\)/);
    assert.match(taskUiSource, /root\.addEventListener\('keydown', handleActionMenuKeydown\)/);
    assert.match(taskUiSource, /event\.key === 'Escape'/);
    assert.match(taskUiSource, /event\.key !== 'Tab'/);
    assert.match(cabinetCss, /cabinet-task-card\.attention-level-1/);
    assert.match(cabinetCss, /cabinet-task-card\.attention-level-2/);
    assert.match(cabinetCss, /cabinet-task-card\.attention-level-3/);
    assert.match(cabinetCss, /task-ui-action-surface--postponement\.is-popover/);
    assert.match(cabinetCss, /body\.dark-mode \.cabinet-postponement-priority/);
    assert.match(cabinetCss, /html\[data-theme="dark"\] \.cabinet-postponement-fact dd/);
    assert.match(cabinetCss, /@media \(max-width: 768px\)[\s\S]*?\.cabinet-postponement-fact/);
});

test('My Day postponement popover renders safe human facts and omits raw metadata', () => {
    const ctx = loadProfileTaskerContext();
    const html = ctx.renderCabinetPostponementExplanation({
        id: 77,
        postponementCount: 2,
        lastPostponedAt: '2026-07-29T08:30:00.000Z',
        postponementExplanation: {
            count: 2,
            attentionLevel: 2,
            lastPostponedAt: '2026-07-29T08:30:00.000Z',
            actorType: 'manual',
            actorName: 'Олена',
            sourceSurface: 'my_day',
            reason: 'move_to_today',
            oldDue: '2026-07-28',
            newDue: '2026-07-29',
            priorityBefore: 'normal',
            priorityAfter: 'high',
            priorityEscalated: true
        }
    });

    assert.match(html, /Задачу було перенесено після прострочення 2 рази/);
    assert.match(html, /Пріоритет автоматично змінено з Звичайний на Високий/);
    assert.match(html, /28\.07\.2026/);
    assert.match(html, /29\.07\.2026/);
    assert.match(html, /Олена/);
    assert.match(html, /Прострочену задачу перенесено на сьогодні/);
    assert.match(html, /Переглянути всю історію/);
    assert.match(html, /\/tasks\?view=my&amp;open=77/);
    assert.doesNotMatch(html, /move_to_today|my_day|mutationKind|sourceSurface|undefined|null/);

    const partial = ctx.renderCabinetPostponementExplanation({
        id: 78,
        postponementCount: 3,
        postponementExplanation: {
            count: 3,
            attentionLevel: 3,
            reason: 'internal_route_name',
            sourceSurface: 'profile_my_cabinet_internal'
        }
    });
    assert.match(partial, /Задачу було перенесено після прострочення 3 рази/);
    assert.match(partial, /Переглянути всю історію/);
    assert.doesNotMatch(partial, /internal_route_name|profile_my_cabinet_internal|undefined|null/);
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
    const source = fs.readFileSync(path.join(ROOT, 'services', 'taskCabinetProjection.js'), 'utf8');
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
    assert.match(source, /SELECT COUNT\(\*\)::int AS open_count/);
    assert.match(source, /const openTaskCount = Number\(openCountResult\.rows\[0\]\?\.open_count \|\| activeSourceRows\.length\);/);
    assert.match(source, /sidebarOpenWorkload:\s*openTaskCount/);
    assert.match(source, /scope:\s*'completed_units_today_and_active_my_day_or_undated'/);
    assert.match(source, /scheduled_start_at/);
    assert.match(source, /snoozed_until/);
    assert.match(source, /taskPriorityOrderSql/);
    assert.match(source, /dueDate && dueDate < today/);
    assert.match(source, /dueDate === today \|\| !dueDate/);
    assert.match(source, /COALESCE\(subtask_rows\.subtasks, '\[\]'::json\) AS subtasks/);
    assert.match(authSource, /Completed work units \(parent tasks \+ completed subtasks\)/);
    assert.match(authSource, /tasks\.completedUnits = parentDoneTotal \+ subtaskDoneTotal/);
    assert.match(authSource, /tasks\.done = tasks\.completedUnits/);
    assert.match(authSource, /subtasksDoneToday/);
    assert.doesNotMatch(source, /const openTaskCount = rows\.length;/);
    assert.doesNotMatch(sidebarSource, /Number\(tasks\.assigned \|\| 0\) \+ Number\(tasks\.in_progress \|\| 0\)/);
});

test('my cabinet projection exposes additive planning calendar contract', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'taskCabinetProjection.js'), 'utf8');
    const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const profileSource = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');

    assert.match(routeSource, /router\.get\('\/my-cabinet'/);
    assert.match(routeSource, /const businessScope = requireTaskReadScope\(req, res\);/);
    assert.match(routeSource, /buildTaskCabinetProjection\(\{\s*pool,\s*user: req\.user,\s*businessScope/s);
    assert.match(routeSource, /focusDate: normalizeTaskCabinetFocusDate\(req\.query\.focusDate \|\| req\.query\.focus_date\)/);
    assert.match(source, /function buildTaskCabinetPlanningProjection/);
    assert.match(source, /function normalizeTaskCabinetFocusDate/);
    assert.match(source, /const dayAfterTomorrow = addDays\(today, 2\);/);
    assert.match(source, /const plusThreeDays = addDays\(today, 3\);/);
    assert.match(source, /const monthEnd = monthEndDate\(today\);/);
    assert.match(source, /const planningEnd = monthEnd > plusThreeDays \? monthEnd : plusThreeDays;/);
    assert.match(source, /const focusDate = normalizeTaskCabinetFocusDate\(options\.focusDate\);/);
    assert.match(source, /const DEFAULT_TASK_CABINET_PLANNING_ROW_LIMIT = 260;/);
    assert.match(source, /function normalizeTaskCabinetPlanningLimit/);
    assert.match(source, /const planningFetchLimit = planningRowLimit \+ 1;/);
    assert.match(source, /focusDate: focusDate \|\| null/);
    assert.match(source, /OR \$\{planningDateSql\} = \$\$\{planningFocusParam\}::date/);
    assert.match(source, /LIMIT \$\$\{planningLimitParam\}/);
    assert.match(source, /planningResultRows\.length > planningRowLimit/);
    assert.match(source, /planningWindow:\s*'overdue_undated_through_planning_end'/);
    assert.match(source, /planning,\s*\n\s*preferences:/);
    assert.match(source, /calendar,\s*\n\s*postponementExplanationContract:\s*'postponement_explanation_v1',\s*\n\s*planning:\s*planningMeta,\s*\n\s*privacyRule:/);
    assert.match(source, /planning:\s*planningMeta/);
    assert.match(source, /planningDateSql\} IS NULL/);
    assert.match(source, /planningDateSql\} BETWEEN/);
    assert.match(profileSource, /function cabinetPlanningList/);
    assert.match(profileSource, /cabinetPlanningList\('all'\)/);
    assert.match(profileSource, /CABINET_PLANNING_TASK_BUCKETS/);
    assert.match(profileSource, /forEachCabinetProjectionTaskList/);
    assert.match(profileSource, /function loadMyCabinetProjection/);
    assert.match(profileSource, /focusDate=\$\{encodeURIComponent\(focusDate\)\}/);
    assert.match(profileSource, /refreshMyCabinetTab\(\{ silent: false, keepExistingOnError: true \}\)/);
    assert.doesNotMatch(profileSource, /apiGet\('\/tasks'\)/);
});

test('my cabinet planning projection includes a valid custom focus date beyond month end', async () => {
    const {
        buildTaskCabinetProjection,
        normalizeTaskCabinetFocusDate
    } = require('../services/taskCabinetProjection');
    const calls = [];
    const focusTask = {
        id: 915,
        title: 'September custom focus',
        date: '2026-09-15',
        status: 'todo'
    };
    const pool = {
        async query(text, params = []) {
            calls.push({ text, params });
            if (/SELECT COUNT\(\*\)::int AS open_count/.test(text)) {
                return { rows: [{ open_count: 1 }] };
            }
            if (/done_total/.test(text)) {
                return {
                    rows: [{
                        done_total: 0,
                        done_today: 0,
                        parent_done_today: 0,
                        subtask_done_today: 0,
                        subtask_done_total: 0,
                        remaining_today: 0,
                        overdue_carryover: 0,
                        active_my_day: 1
                    }]
                };
            }
            if (/SELECT t\.\*/.test(text) && /BETWEEN/.test(text) && /= \$\d+::date/.test(text)) {
                return { rows: [focusTask] };
            }
            return { rows: [] };
        }
    };

    assert.equal(normalizeTaskCabinetFocusDate('2026-09-15'), '2026-09-15');
    assert.equal(normalizeTaskCabinetFocusDate('2026-02-30'), '');
    assert.equal(normalizeTaskCabinetFocusDate('2026-9-15'), '');

    const projection = await buildTaskCabinetProjection({
        pool,
        user: {
            id: 7,
            username: 'serhiy',
            name: 'Serhiy',
            role: 'creator'
        },
        businessScope: {
            mode: 'single',
            activeContext: 'event_genix',
            selectedContexts: ['event_genix']
        },
        ensurePreferences: false,
        focusDate: '2026-09-15',
        now: new Date('2026-07-02T10:00:00.000Z')
    });

    const planningCall = calls.find(call => /SELECT t\.\*/.test(call.text)
        && /BETWEEN/.test(call.text)
        && /= \$\d+::date/.test(call.text));

    assert.equal(projection.meta.calendar.focusDate, '2026-09-15');
    assert.equal(projection.planning.all[0].id, 915);
    assert.ok(planningCall, 'planning query should include custom focus date');
    assert.deepEqual(planningCall.params, ['serhiy', 'Serhiy', 7, 'event_genix', '2026-07-02', '2026-07-31', '2026-09-15', 261]);
});

test('my cabinet planning projection limits rows and exposes partial meta', async () => {
    const { buildTaskCabinetProjection } = require('../services/taskCabinetProjection');
    const calls = [];
    const planningRows = [
        { id: 201, title: 'Limited today task', date: '2026-07-02', status: 'todo' },
        { id: 202, title: 'Limited tomorrow task', date: '2026-07-03', status: 'todo' },
        { id: 203, title: 'Overflow no date task', status: 'todo' }
    ];
    const pool = {
        async query(text, params = []) {
            calls.push({ text, params });
            if (/SELECT COUNT\(\*\)::int AS open_count/.test(text)) {
                return { rows: [{ open_count: 25 }] };
            }
            if (/done_total/.test(text)) {
                return {
                    rows: [{
                        done_total: 0,
                        done_today: 0,
                        parent_done_today: 0,
                        subtask_done_today: 0,
                        subtask_done_total: 0,
                        remaining_today: 1,
                        overdue_carryover: 0,
                        active_my_day: 2
                    }]
                };
            }
            if (/SELECT t\.\*/.test(text) && /BETWEEN/.test(text) && /LIMIT \$\d+/.test(text)) {
                return { rows: planningRows };
            }
            return { rows: [] };
        }
    };

    const projection = await buildTaskCabinetProjection({
        pool,
        user: {
            id: 7,
            username: 'serhiy',
            name: 'Serhiy',
            role: 'creator'
        },
        businessScope: {
            mode: 'single',
            activeContext: 'event_genix',
            selectedContexts: ['event_genix']
        },
        ensurePreferences: false,
        planningRowLimit: 2,
        now: new Date('2026-07-02T10:00:00.000Z')
    });

    const planningCall = calls.find(call => /SELECT t\.\*/.test(call.text)
        && /BETWEEN/.test(call.text)
        && /LIMIT \$\d+/.test(call.text));

    assert.ok(planningCall, 'planning query should be limited');
    assert.match(planningCall.text, /ORDER BY[\s\S]*LIMIT \$\d+/);
    assert.deepEqual(planningCall.params, ['serhiy', 'Serhiy', 7, 'event_genix', '2026-07-02', '2026-07-31', 3]);
    assert.deepEqual(projection.planning.all.map(task => task.id), [201, 202]);
    assert.deepEqual(projection.planning.today.map(task => task.id), [201]);
    assert.deepEqual(projection.planning.tomorrow.map(task => task.id), [202]);
    assert.equal(projection.planning.noDate.length, 0);
    assert.deepEqual(projection.meta.planning.visibleCounts, {
        all: 2,
        overdue: 0,
        today: 1,
        tomorrow: 1,
        dayAfterTomorrow: 0,
        plusThreeDays: 0,
        monthEnd: 0,
        noDate: 0
    });
    assert.equal(projection.meta.planning.rowLimit, 2);
    assert.equal(projection.meta.planning.returnedRows, 2);
    assert.equal(projection.meta.planning.fetchedRows, 3);
    assert.equal(projection.meta.planning.isPartial, true);
    assert.equal(projection.meta.planning.hasMore, true);
    assert.equal(projection.meta.planning.overflowRowsSampled, 1);
});

test('my cabinet planning projection keeps owner and business scope guards', async () => {
    const { buildTaskCabinetProjection } = require('../services/taskCabinetProjection');
    const calls = [];
    const pool = {
        async query(text, params = []) {
            calls.push({ text, params });
            if (/SELECT COUNT\(\*\)::int AS open_count/.test(text)) {
                return { rows: [{ open_count: 0 }] };
            }
            if (/done_total/.test(text)) {
                return {
                    rows: [{
                        done_total: 0,
                        done_today: 0,
                        parent_done_today: 0,
                        subtask_done_today: 0,
                        subtask_done_total: 0,
                        remaining_today: 0,
                        overdue_carryover: 0,
                        active_my_day: 0
                    }]
                };
            }
            return { rows: [] };
        }
    };

    await buildTaskCabinetProjection({
        pool,
        user: {
            id: 7,
            username: 'serhiy',
            name: 'Serhiy',
            role: 'creator'
        },
        businessScope: {
            mode: 'single',
            activeContext: 'event_genix',
            selectedContexts: ['event_genix']
        },
        ensurePreferences: false,
        now: new Date('2026-07-02T10:00:00.000Z')
    });

    const planningCall = calls.find(call => /SELECT t\.\*/.test(call.text)
        && /BETWEEN/.test(call.text)
        && /COALESCE\(t\.status, 'todo'\) NOT IN/.test(call.text));

    assert.ok(planningCall, 'planning query should be executed');
    assert.match(planningCall.text, /t\.owner_user_id = \$\d+/);
    assert.match(planningCall.text, /t\.assigned_to IN \(\$\d+,\$\d+\)/);
    assert.match(planningCall.text, /t\.owner IN \(\$\d+,\$\d+\)/);
    assert.match(planningCall.text, /COALESCE\(t\.business_context, 'event_genix'\) = \$\d+/);
    assert.match(planningCall.text, /COALESCE\(t\.status, 'todo'\) NOT IN \('done','cancelled','archived'\)/);
    assert.deepEqual(planningCall.params, ['serhiy', 'Serhiy', 7, 'event_genix', '2026-07-02', '2026-07-31', 261]);
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
    assert.match(tasksSource, /router\.patch\('\/:id\/priority'/);
    assert.match(tasksSource, /router\.patch\('\/:id\/commitment'/);
    assert.match(tasksSource, /commitment:\s*'time_required'/);
    assert.match(dashboardSource, /TASK_ACTION_TYPES\.URGENT_COMMITMENT_SET/);
    assert.match(dashboardSource, /NOT EXISTS/);
    assert.match(dashboardSource, /commitmentQuestion/);
    assert.match(alertsSource, /startsWith\('urgent_task_'\)/);
    assert.match(alertsSource, /\/api\/tasks\/\$\{taskId\}\/commitment/);
    assert.match(alertsSource, /commitmentAt/);
});

test('task create post steps degrade to warnings after the row is created', () => {
    const source = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');

    assert.match(source, /const postCreateWarnings = \[\]/);
    assert.match(source, /recordPostCreateWarning\('schedule'/);
    assert.match(source, /recordPostCreateWarning\('subtasks'/);
    assert.match(source, /postCreateWarnings,/);
    assert.match(source, /postCreateWarningCount: postCreateWarnings\.length/);
});

test('my cabinet and tasks expose explicit deferred task bucket', () => {
    const tasksSource = fs.readFileSync(path.join(ROOT, 'services', 'taskCabinetProjection.js'), 'utf8');
    const profileSource = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    const tasksPageSource = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
    const tasksHtml = fs.readFileSync(path.join(ROOT, 'tasks.html'), 'utf8');

    assert.match(tasksSource, /deferred: \[\]/);
    assert.match(tasksSource, /isTaskDeferred\(task, now\)/);
    assert.match(tasksSource, /deferred: buckets\.deferred/);
    assert.match(tasksSource, /deferredCount: buckets\.deferred\.length/);
    assert.match(profileSource, /const deferred = cabinetList\('deferred'\)/);
    assert.match(profileSource, /renderCabinetSection\('Відкладено'/);
    assert.match(tasksPageSource, /function isDeferredTask/);
    assert.match(tasksPageSource, /case 'deferred'/);
    assert.match(tasksHtml, /data-view="deferred"/);
    assert.match(tasksHtml, /id="countDeferred"/);
});

test('task sounds use task scoped preferences and controls, not chat settings', () => {
    const soundSource = fs.readFileSync(path.join(ROOT, 'js', 'sound-engine.js'), 'utf8');
    const profileSource = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    const tasksPageSource = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
    const tasksRouteSource = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');

    assert.match(soundSource, /task_sound_settings/);
    assert.match(soundSource, /playTask: function/);
    assert.match(soundSource, /_taskSoftChime/);
    assert.match(soundSource, /chat_sound_settings/);
    assert.match(profileSource, /renderCabinetTaskSoundControls/);
    assert.match(profileSource, /playTask\?\.\('task-complete'\)/);
    assert.match(profileSource, /data-cabinet-task-sound-theme/);
    assert.match(tasksPageSource, /renderTaskSoundControls/);
    assert.match(tasksPageSource, /SoundEngine\?\.playTask\?\.\('task-complete'\)/);
    assert.match(tasksRouteSource, /task_sound_enabled/);
    assert.match(tasksRouteSource, /task_sound_volume/);
    assert.match(tasksRouteSource, /task_sound_theme/);
});

test('task priority quick controls and migration indexes are present', () => {
    const profileSource = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    const tasksPageSource = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '243_tasks_urgent_deferred_preferences.sql'), 'utf8');

    assert.match(profileSource, /data-cabinet-task-priority-select/);
    assert.match(profileSource, /\/tasks\/\$\{taskId\}\/priority/);
    assert.match(tasksPageSource, /data-task-priority-select/);
    assert.match(tasksPageSource, /\/tasks\/\$\{id\}\/priority/);
    assert.match(migration, /MIGRATION_KIND: schema/);
    assert.match(migration, /idx_tasks_business_urgent_due/);
    assert.match(migration, /idx_tasks_business_owner_snoozed_active/);
    assert.match(migration, /idx_tasks_business_owner_workload_active/);
});
