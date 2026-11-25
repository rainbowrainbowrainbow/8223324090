const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function assertPersonalQueryParameters(call, scheduleParameters) {
    const owner = /t\.owner_user_id = \$(\d+)/.exec(call.text);
    const author = /t\.created_by_user_id = \$(\d+)/.exec(call.text);
    const observer = /task_observer_scope\.user_id = \$(\d+)/.exec(call.text);
    const business = /COALESCE\(t\.business_context, 'event_genix'\) = \$(\d+)/.exec(call.text);
    for (const reference of [owner, author, observer]) {
        assert.ok(reference, 'personal scope includes the role');
        assert.equal(call.params[Number(reference[1]) - 1], 7);
    }
    assert.ok(business);
    assert.equal(call.params[Number(business[1]) - 1], 'event_genix');
    assert.deepEqual(call.params.slice(Number(business[1])), scheduleParameters);
}

function loadProfileTaskerContext({ legacyGames = false } = {}) {
    const localState = new Map();
    const sandbox = {
        console,
        TaskLinks: require('../js/task-links'),
        addEventListener() {},
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
            if (target.includes('/api/tasks/my-cabinet') && typeof sandbox.apiGet === 'function') {
                const scopedPath = target.replace(/^.*\/api/, '');
                return {
                    ok: true,
                    status: 200,
                    json: async () => sandbox.apiGet(scopedPath)
                };
            }
            throw new Error(`Unexpected profile tasker fetch in test harness: ${target}`);
        },
        getAuthHeaders: () => ({}),
        handleAuthError: () => false,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        document: { addEventListener() {} },
        localStorage: {
            getItem(key) { return localState.has(key) ? localState.get(key) : null; },
            setItem(key, value) { localState.set(key, String(value)); },
            removeItem(key) { localState.delete(key); }
        },
        sessionStorage: (() => {
            const state = new Map();
            return {
                getItem(key) { return state.has(key) ? state.get(key) : null; },
                setItem(key, value) { state.set(key, String(value)); },
                removeItem(key) { state.delete(key); }
            };
        })(),
        crypto: {
            randomUUID: (() => {
                let next = 1;
                return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
            })()
        },
        navigator: {},
        window: null
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'profile-my-day.js'), 'utf8'), sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8'), sandbox);
    if (legacyGames) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'profile-game-legacy.js'), 'utf8'), sandbox);
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

test('legacy profile auto rewards run once per page lifecycle instead of after partial renders', async () => {
    const ctx = loadProfileTaskerContext({ legacyGames: true });
    const calls = [];
    ctx.apiPost = async path => {
        calls.push(path);
        return path === '/achievements/check' ? { awarded: [], count: 0 } : { newTitles: [] };
    };
    vm.runInContext('isOwnProfile = true;', ctx);

    await ctx.checkProfileAutoRewards();
    await ctx.checkProfileAutoRewards();

    assert.deepEqual(calls, ['/achievements/check', '/quests/check-titles']);

    await ctx.checkProfileAutoRewards({ force: true });
    assert.deepEqual(calls, [
        '/achievements/check',
        '/quests/check-titles',
        '/achievements/check',
        '/quests/check-titles'
    ], 'an explicit manual refresh may run one additional check pair');

    const source = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    const attachStart = source.indexOf('function attachProfileListeners()');
    const attachEnd = source.indexOf('\nasync function claimQuest(', attachStart);
    assert.ok(attachStart >= 0 && attachEnd > attachStart);
    assert.doesNotMatch(
        source.slice(attachStart, attachEnd),
        /checkProfileAutoRewards\(/,
        'partial-render listener binding must not own reward mutations'
    );
});

test('legacy profile auto rewards retry after failure and complete only after both checks succeed', async () => {
    const ctx = loadProfileTaskerContext({ legacyGames: true });
    const calls = [];
    let failAchievements = true;
    ctx.apiPost = async path => {
        calls.push(path);
        if (path === '/achievements/check' && failAchievements) {
            failAchievements = false;
            throw new Error('temporary failure');
        }
        return path === '/achievements/check' ? { awarded: [], count: 0 } : { newTitles: [] };
    };
    vm.runInContext("isOwnProfile = true; currentUserId = 42; AppState = { currentUser: { id: 42, username: 'first' } };", ctx);

    assert.equal((await ctx.checkProfileAutoRewards()).success, false);
    assert.equal((await ctx.checkProfileAutoRewards()).success, true);
    await ctx.checkProfileAutoRewards();

    assert.deepEqual(calls, [
        '/achievements/check',
        '/achievements/check',
        '/quests/check-titles'
    ]);
});

test('legacy profile auto rewards are scoped to account and auth session generation', async () => {
    const ctx = loadProfileTaskerContext({ legacyGames: true });
    const calls = [];
    ctx.apiPost = async path => {
        calls.push(path);
        return path === '/achievements/check' ? { awarded: [], count: 0 } : { newTitles: [] };
    };
    vm.runInContext("isOwnProfile = true; currentUserId = 42; AppState = { currentUser: { id: 42, username: 'first' } };", ctx);
    ctx.localStorage.setItem('pzp_auth_session_generation', 'generation-1');

    await ctx.checkProfileAutoRewards();
    await ctx.checkProfileAutoRewards();
    ctx.localStorage.setItem('pzp_auth_session_generation', 'generation-2');
    await ctx.checkProfileAutoRewards();
    vm.runInContext("currentUserId = 77; AppState.currentUser = { id: 77, username: 'second' };", ctx);
    await ctx.checkProfileAutoRewards();

    assert.deepEqual(calls, [
        '/achievements/check', '/quests/check-titles',
        '/achievements/check', '/quests/check-titles',
        '/achievements/check', '/quests/check-titles'
    ]);
});

test('profile my day orders tasks by recency regardless of historical checklist rows', () => {
    const ctx = loadProfileTaskerContext();
    const tasks = [
        { id: 1, title: 'older plain', date: '2026-05-23', createdAt: '2026-05-23T08:00:00.000Z' },
        { id: 2, title: 'newer plain', date: '2026-05-23', createdAt: '2026-05-23T10:00:00.000Z' },
        { id: 3, title: 'older decomposed', date: '2026-05-23', createdAt: '2026-05-23T07:00:00.000Z', subtask_count: 2 },
        { id: 4, title: 'newer decomposed', date: '2026-05-23', createdAt: '2026-05-23T09:00:00.000Z', subtask_count: 1 }
    ];

    assert.deepEqual(Array.from(ctx.sortCabinetTasksForDisplay(tasks).map(task => task.id)), [2, 4, 1, 3]);
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

test('park profile separates planning periods and shows waiting in its date group', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();
    const overdue = addDaysToDateKey(today, -1);
    vm.runInContext(`
        activeTab = 'myday';
        myCabinetData = {
            all: [
                { id: 101, title: 'Today segment task', date: '${today}' },
                { id: 102, title: 'Overdue segment task', date: '${overdue}' }
            ],
            today: [],
            next: [],
            overdue: [],
            waiting: [{ id: 103, title: 'Waiting segment task', workflowState: 'waiting' }],
            planning: { noDate: [{ id: 103, title: 'Waiting segment task', workflowState: 'waiting' }] },
            deferred: [],
            private: [{ id: 104, title: 'Private segment task', visibility: 'private', taskMode: 'private' }],
            completedHistory: [
                { id: 105, title: 'Completed segment task', status: 'done', completedAt: '${today}T10:00:00.000Z' },
                { id: 106, title: 'Completed second task', status: 'done', completedAt: '${today}T11:00:00.000Z' }
            ],
            completedTodayTasks: [
                {
                    id: 107,
                    title: 'Dashboard completed task',
                    status: 'done',
                    completedAt: '${today}T12:00:00.000Z',
                    actualSeconds: 1800,
                    completedSubtasksToday: 2,
                    subtasks: [
                        { id: 701, title: 'Step one', isDone: true, completedAt: '${today}T12:10:00.000Z' },
                        { id: 702, title: 'Step two', isDone: true, completedAt: '${today}T12:20:00.000Z' }
                    ],
                    myDay: {
                        impacts: [{ id: 9, name: 'CRM', color: '#0EA5E9', icon: 'C' }]
                    }
                }
            ],
            stats: { taskQuick: { completedParentTotal: 2, completedUnitsTotal: 4, completedTotal: 4, completedToday: 3, activeMyDay: 4 } }
        };
        cabinetTaskComposerExpanded = false;
        cabinetCreateDuePreset = 'today';
        completedDashboardExpanded = false;
        completedDashboardShowAll = false;
        completedDashboardTab = 'today';
    `, ctx);

    let html = ctx.renderMyDayTab();
    assert.match(html, /data-park-task-group="today"/);
    assert.match(html, /data-park-task-group="noDate"/);
    assert.match(html, /Today segment task/);
    assert.match(html, /Waiting segment task/);
    assert.match(html, /Overdue segment task/);
    assert.deepEqual([...html.matchAll(/data-park-period="([^"]+)"/g)].map(match => match[1]), ['today', 'overdue', 'future']);
    assert.match(html, /park-completion-board[\s\S]*Dashboard completed task/);
    assert.equal((html.match(/data-cabinet-completion-pulse/g) || []).length, 1);
    html = ctx.renderMyDayTab();
    assert.match(html, /data-park-task-group="overdue"/);
    assert.match(html, /Overdue segment task/);
    assert.deepEqual([...html.matchAll(/data-park-period="([^"]+)"/g)].map(match => match[1]), ['today', 'overdue', 'future']);
    assert.match(html, /Today segment task/);
    vm.runInContext('completedDashboardExpanded = true; completedDashboardTab = "history";', ctx);
    html = ctx.renderMyDayTab();
    assert.match(html, /Completed segment task/);
    assert.match(html, /Відновити/);
});

test('profile completion pulse is compact by default and limits expanded rows', () => {
    const ctx = loadProfileTaskerContext();
    const today = '2026-08-14';
    const iconKeys = ['system', 'processes', 'learning', 'network'];
    const completedTasks = Array.from({ length: 15 }, (_, index) => ({
        id: 900 + index,
        title: `Completed ${String(index + 1).padStart(2, '0')}`,
        status: 'done',
        completedAt: `${today}T12:${String(index).padStart(2, '0')}:00.000Z`,
        actualSeconds: index === 0 ? 60 : 0,
        myDay: {
            impacts: index >= 11 ? [{ id: 9 + index, name: `Impact ${index}`, color: '#0EA5E9', icon: iconKeys[(index - 11) % iconKeys.length] }] : []
        }
    }));

    vm.runInContext(`
        myCabinetData = {
            meta: { calendar: { today: '${today}' } },
            completedTodayTasks: ${JSON.stringify(completedTasks)}
        };
        completedDashboardExpanded = false;
        completedDashboardShowAll = false;
        completedDashboardTab = 'today';
        completedDashboardVisibleCount = 5;
    `, ctx);

    let html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /cabinet-completion-summary/);
    assert.match(html, /data-cabinet-completion-toggle/);
    assert.match(html, /aria-controls="cabinetCompletionDetails"/);
    assert.match(html, /Виконано сьогодні/);
    assert.doesNotMatch(html, /cabinet-completion-impact|Без впливу|Impact \d/);
    assert.doesNotMatch(html, />system</);
    assert.doesNotMatch(html, />processes</);
    assert.doesNotMatch(html, />learning</);
    assert.doesNotMatch(html, />network</);
    assert.doesNotMatch(html, /data-cabinet-completion-details/);
    assert.doesNotMatch(html, /Completed 01/);
    assert.doesNotMatch(html, /data-cabinet-task-action="open"/);
    assert.equal(vm.runInContext('completedDashboardExpanded', ctx), false);
    assert.equal(vm.runInContext('completedDashboardShowAll', ctx), false);

    vm.runInContext('completedDashboardExpanded = true;', ctx);
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /data-cabinet-completion-details/);
    assert.match(html, /Completed 01/);
    assert.match(html, /Completed 05/);
    assert.doesNotMatch(html, /Completed 06/);
    assert.match(html, /data-cabinet-completion-all/);
    assert.match(html, /\+10/);
    assert.match(html, /Задача виконана/);
    assert.doesNotMatch(html, /cabinet-completion-impact|Без впливу|Impact \d/);
    vm.runInContext('completedDashboardVisibleCount = 10; completedDashboardShowAll = false;', ctx);
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /Completed 10/);
    assert.doesNotMatch(html, /Completed 11/);
    assert.match(html, /\+5/);

    vm.runInContext('completedDashboardShowAll = true;', ctx);
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /Completed 15/);
    assert.doesNotMatch(html, /data-cabinet-completion-all/);

    vm.runInContext(`
        myCabinetData = { meta: { calendar: { today: '${today}' } }, completedTodayTasks: [] };
        completedDashboardExpanded = false;
        completedDashboardShowAll = false;
        completedDashboardVisibleCount = 5;
    `, ctx);
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /is-empty/);
    assert.match(html, /Ще немає виконань/);
    assert.doesNotMatch(html, /data-cabinet-task-action="open"/);
});

test('profile completion details toggle is local and does not reload projection', () => {
    const ctx = loadProfileTaskerContext();
    const today = '2026-08-14';
    vm.runInContext(`
        myCabinetData = {
            meta: { calendar: { today: '${today}' } },
            completedTodayTasks: [{
                id: 990,
                title: 'Toggle completed task',
                status: 'done',
                completedAt: '${today}T12:00:00.000Z',
                actualSeconds: 120,
                subtask_count: 2,
                subtask_done_count: 1,
                subtasks: [{ id: 1, title: 'Step', status: 'done', completedAt: '${today}T11:59:00.000Z' }],
                myDay: { impacts: [{ id: 9, name: 'CRM', color: '#0EA5E9', icon: 'C' }] }
            }]
        };
        completedDashboardExpanded = false;
        completedDashboardShowAll = false;
        completedDashboardTab = 'today';
        let projectionReloads = 0;
        loadMyCabinetProjection = async () => { projectionReloads += 1; };
        const initialHtml = renderCabinetCompletionPulse();
        let renderedHtml = initialHtml;
        let queryCalls = 0;
        const currentNode = {
            get outerHTML() { return renderedHtml; },
            set outerHTML(value) { renderedHtml = value; }
        };
        const nextNode = { querySelectorAll: () => [] };
        document = {
            addEventListener() {},
            querySelector(selector) {
                if (selector !== '[data-cabinet-completion-pulse]') return null;
                queryCalls += 1;
                return queryCalls === 1 ? currentNode : nextNode;
            }
        };
        toggleCabinetCompletionDetails();
        window.__COMPLETED_TOGGLE_RESULT__ = {
            expanded: completedDashboardExpanded,
            showAll: completedDashboardShowAll,
            projectionReloads,
            initialHtml,
            renderedHtml
        };
    `, ctx);
    assert.match(ctx.__COMPLETED_TOGGLE_RESULT__.initialHtml, /Виконано сьогодні/);
    assert.doesNotMatch(ctx.__COMPLETED_TOGGLE_RESULT__.initialHtml, /Toggle completed task/);
    assert.doesNotMatch(ctx.__COMPLETED_TOGGLE_RESULT__.initialHtml, /data-cabinet-task-action="open"/);
    assert.equal(ctx.__COMPLETED_TOGGLE_RESULT__.expanded, true);
    assert.equal(ctx.__COMPLETED_TOGGLE_RESULT__.showAll, false);
    assert.equal(ctx.__COMPLETED_TOGGLE_RESULT__.projectionReloads, 0);
    assert.match(ctx.__COMPLETED_TOGGLE_RESULT__.renderedHtml, /data-cabinet-completion-details/);
    assert.match(ctx.__COMPLETED_TOGGLE_RESULT__.renderedHtml, /data-cabinet-task-action="open" data-task-id="990"/);
    assert.doesNotMatch(ctx.__COMPLETED_TOGGLE_RESULT__.renderedHtml, /1\/2 пунктів/);
});

test('profile completion pulse covers 0, 1, 15+ today and 36-row history contracts', () => {
    const ctx = loadProfileTaskerContext();
    const today = '2026-08-14';
    const makeTask = index => ({
        id: 7000 + index,
        title: `Completion case ${index}`,
        status: 'done',
        completedAt: `${today}T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
        completedParentToday: true,
        actualSecondsToday: index * 60,
        myDay: { impacts: index % 2 ? [{ id: 20 + index, name: 'Системність', color: '#6366F1', icon: 'system' }] : [] }
    });

    vm.runInContext(`
        myCabinetData = { meta: { calendar: { today: '${today}' } }, completedTodayTasks: [] };
        completedDashboardExpanded = false;
        completedDashboardShowAll = false;
        completedDashboardTab = 'today';
        completedDashboardVisibleCount = 5;
    `, ctx);
    let html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /Ще немає виконань/);
    assert.doesNotMatch(html, /data-cabinet-completion-details/);

    vm.runInContext(`
        myCabinetData = { meta: { calendar: { today: '${today}' } }, completedTodayTasks: [${JSON.stringify(makeTask(1))}] };
        completedDashboardExpanded = true;
        completedDashboardTab = 'today';
        completedDashboardVisibleCount = 5;
    `, ctx);
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /Виконано сьогодні/);
    assert.match(html, /Completion case 1/);
    assert.doesNotMatch(html, /data-cabinet-completion-all/);

    vm.runInContext(`
        myCabinetData = { meta: { calendar: { today: '${today}' } }, completedTodayTasks: ${JSON.stringify(Array.from({ length: 15 }, (_, index) => makeTask(index + 1)))} };
        completedDashboardExpanded = true;
        completedDashboardTab = 'today';
        completedDashboardShowAll = false;
        completedDashboardVisibleCount = 5;
    `, ctx);
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /Виконано сьогодні/);
    assert.match(html, /Completion case 5/);
    assert.doesNotMatch(html, /Completion case 6/);
    assert.match(html, /Показати ще · \+10/);

    vm.runInContext(`
        myCabinetData = {
            meta: {
                calendar: { today: '${today}' },
                completedHistory: {
                    type: 'cursor',
                    limit: 36,
                    returned: 36,
                    hasMore: true,
                    nextCursor: 'history-page-2'
                }
            },
            completedTodayTasks: [],
            completedHistory: ${JSON.stringify(Array.from({ length: 36 }, (_, index) => ({
                id: 8000 + index,
                title: `History case ${index + 1}`,
                status: 'done',
                completedAt: `2026-08-${String(14 - Math.floor(index / 12)).padStart(2, '0')}T10:00:00.000Z`
            })))},
            stats: { taskQuick: { completedParentTotal: 50, completedHistoryShown: 36, completedHistoryOverflow: 14 } }
        };
        completedDashboardExpanded = true;
        completedDashboardTab = 'history';
        completedDashboardShowAll = false;
        completedDashboardVisibleCount = 5;
    `, ctx);
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /Історія/);
    assert.match(html, /Завантажено 36 із 50/);
    assert.match(html, /History case 1/);
    assert.match(html, /History case 5/);
    assert.doesNotMatch(html, /History case 6/);
    assert.match(html, /Показати ще · \+31/);
    assert.match(html, /50 за весь час/);
    assert.match(html, /останні 36 задач/);
});

test('profile completion History tab paginates from the projection first page', async () => {
    const ctx = loadProfileTaskerContext();
    const today = '2026-08-14';
    const makeHistoryTask = index => ({
        id: 8100 + index,
        title: `History cursor ${index}`,
        status: 'done',
        completedAt: `2026-08-${String(14 - Math.floor(index / 12)).padStart(2, '0')}T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
        myDay: { impacts: index % 2 ? [{ id: 30, name: 'Системність', color: '#6366F1', icon: 'system' }] : [] }
    });
    vm.runInContext(`
        myCabinetData = {
            meta: {
                calendar: { today: '${today}' },
                businessScope: { mode: 'single', activeContext: 'event_genix' },
                completedHistory: {
                    type: 'cursor',
                    limit: 36,
                    returned: 36,
                    hasMore: true,
                    nextCursor: 'cursor-page-2'
                }
            },
            completedTodayTasks: [],
            completedHistory: ${JSON.stringify(Array.from({ length: 36 }, (_, index) => makeHistoryTask(index + 1)))},
            stats: { taskQuick: { completedParentTotal: 73, completedHistoryShown: 36, completedHistoryOverflow: 37 } }
        };
        completedDashboardExpanded = true;
        completedDashboardTab = 'history';
        completedDashboardShowAll = false;
        completedDashboardVisibleCount = 5;
        completedDashboardHistoryVisibleCount = 5;
        window.CrmBusinessContext = { apiUrl(path) { return path + (path.includes('?') ? '&' : '?') + 'businessContext=event_genix'; } };
        let fetchCalls = [];
        let fetchMode = 'success';
        fetch = async function(url) {
            fetchCalls.push(String(url));
            if (fetchMode === 'fail') {
                return { ok: false, status: 503, json: async () => ({ success: false, error: 'History API down' }) };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    period: 'history',
                    items: [
                        ${JSON.stringify(makeHistoryTask(1))},
                        ...${JSON.stringify(Array.from({ length: 36 }, (_, index) => makeHistoryTask(37 + index)))}
                    ],
                    pagination: {
                        type: 'cursor',
                        limit: 36,
                        returned: 36,
                        hasMore: true,
                        nextCursor: 'cursor-page-3'
                    },
                    totals: { completedParentTotal: 73 }
                })
            };
        };
        window.fetch = fetch;
        window.__FETCH_CALLS__ = fetchCalls;
        window.__SET_FETCH_MODE__ = value => { fetchMode = value; };
        document = {
            querySelector() { return null; }
        };
        syncCabinetCompletionHistoryStateFromProjection(myCabinetData);
    `, ctx);

    let html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /Завантажено 36 із 73/);
    assert.match(html, /History cursor 5/);
    assert.doesNotMatch(html, /History cursor 6/);

    for (let index = 0; index < 7; index += 1) {
        await ctx.showMoreCabinetCompletionDetails();
    }
    assert.equal(ctx.window.__FETCH_CALLS__.length, 0, 'local rows should expand before calling the cursor endpoint');
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /History cursor 36/);
    assert.doesNotMatch(html, /History cursor 37/);
    assert.match(html, /Завантажити ще/);
    const beforeFetchState = vm.runInContext('({ visible: completedDashboardHistoryVisibleCount, loaded: completedDashboardHistoryState.items.length, hasMore: completedDashboardHistoryState.hasMore, nextCursor: completedDashboardHistoryState.nextCursor, loading: completedDashboardHistoryState.loading, tab: completedDashboardTab })', ctx);
    assert.equal(beforeFetchState.visible, 36);
    assert.equal(beforeFetchState.loaded, 36);
    assert.equal(beforeFetchState.hasMore, true);
    assert.equal(beforeFetchState.nextCursor, 'cursor-page-2');
    assert.equal(beforeFetchState.loading, false);
    assert.equal(beforeFetchState.tab, 'history');

    await ctx.showMoreCabinetCompletionDetails();
    const afterFetchAttempt = vm.runInContext('({ calls: window.__FETCH_CALLS__.length, visible: completedDashboardHistoryVisibleCount, loaded: completedDashboardHistoryState.items.length, hasMore: completedDashboardHistoryState.hasMore, nextCursor: completedDashboardHistoryState.nextCursor, loading: completedDashboardHistoryState.loading, error: completedDashboardHistoryState.error, requestSeq: completedDashboardHistoryState.requestSeq })', ctx);
    assert.equal(afterFetchAttempt.error, '', JSON.stringify(afterFetchAttempt));
    assert.equal(ctx.window.__FETCH_CALLS__.length, 1);
    assert.match(ctx.window.__FETCH_CALLS__[0], /\/api\/tasks\/my-cabinet\/completions\?/);
    assert.match(ctx.window.__FETCH_CALLS__[0], /period=history/);
    assert.match(ctx.window.__FETCH_CALLS__[0], /limit=36/);
    assert.match(ctx.window.__FETCH_CALLS__[0], /cursor=cursor-page-2/);
    assert.match(ctx.window.__FETCH_CALLS__[0], /businessContext=event_genix/);
    const stateAfterLoad = vm.runInContext('completedDashboardHistoryState', ctx);
    assert.equal(stateAfterLoad.items.length, 72, 'duplicate task id from page 2 should be deduped');
    assert.equal(new Set(stateAfterLoad.items.map(item => item.id)).size, 72);
    assert.equal(stateAfterLoad.nextCursor, 'cursor-page-3');
    assert.equal(stateAfterLoad.hasMore, true);
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /Завантажено 72 із 73/);
    assert.match(html, /History cursor 41/);
    assert.doesNotMatch(html, /History cursor 42/);

    vm.runInContext('window.__SET_FETCH_MODE__("fail"); completedDashboardHistoryVisibleCount = completedDashboardHistoryState.items.length;', ctx);
    await ctx.showMoreCabinetCompletionDetails();
    const failedState = vm.runInContext('completedDashboardHistoryState', ctx);
    assert.equal(failedState.items.length, 72, 'retry error must not clear loaded history');
    assert.match(failedState.error, /History API down/);
    html = ctx.renderCabinetCompletionPulse();
    assert.match(html, /History API down/);
    assert.match(html, /Повторити/);
});

test('park overdue period uses the same actions and card as today', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const cabinetCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-cabinet.css'), 'utf8');
    const taskCss = fs.readFileSync(path.join(ROOT, 'css', 'pages-tasks.css'), 'utf8');
    const today = taskCreateCtx.TaskCreate.todayStr();
    const overdue = addDaysToDateKey(today, -2);

    vm.runInContext(`
        activeTab = 'myday';
        cabinetCreateDuePreset = 'today';
        MyDayClassification = { renderTaskBadges: myDay => myDay?.impacts?.length ? '<span class="my-day-task-impact-chips">CRM + Hermes</span>' : '' };
        MyDayDependencies = { renderTaskBlocker: task => '<button type="button" class="cabinet-task-dependency-action" data-cabinet-task-action="dependencies" data-task-id="' + task.id + '">Потрібно спочатку</button>' };
        MyDayTimeTracking = {
            renderTaskTrigger: task => '<button type="button" class="cabinet-task-action-btn cabinet-task-action-timer" data-my-day-time-task="' + task.id + '" data-cabinet-task-action="time-menu" data-task-id="' + task.id + '" aria-label="Відкрити час задачі">⏱</button>',
            renderTaskSummary: task => '<span class="my-day-time-summary" data-render-time-summary="' + task.id + '">План / Факт</span>'
        };
        myCabinetData = {
            all: [
                {
                    id: 201,
                    title: 'Overdue triage task',
                    date: '${overdue}',
                    priority: 'urgent',
                    subtask_count: 2,
                    subtask_done_count: 1,
                    myDay: { impacts: [{ id: 1, name: 'CRM' }, { id: 2, name: 'Hermes' }] },
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
    assert.match(html, /data-park-task-group="overdue"/);
    assert.match(html, /Показано 1 із 1/);
    assert.match(html, /data-cabinet-task-action="open"/);
    assert.match(html, /data-cabinet-task-action="reschedule-date"/);
        assert.match(html, /data-cabinet-task-action="edit"/);
        assert.doesNotMatch(html, /data-cabinet-task-action="more"/);
    assert.match(html, /data-cabinet-task-action="done"/);
    assert.doesNotMatch(html, /time-menu|timer-start|ai-classification|data-cabinet-task-action="dependencies"/);
});

test('profile My Day hides sound shortcut after command bar cleanup while preserving settings helpers', () => {
    const ctx = loadProfileTaskerContext();
    const profileSource = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');

    vm.runInContext(`
        activeTab = 'myday';
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

test('profile My Day completion pulse exposes history as an expanded tab', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();

    vm.runInContext(`
        activeTab = 'myday';
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
            stats: { taskQuick: { completedParentTotal: 1, completedUnitsTotal: 1, completedTotal: 1, completedToday: 0, activeMyDay: 0 } }
        };
        completedDashboardExpanded = true;
        completedDashboardTab = 'history';
        completedDashboardShowAll = false;
    `, ctx);

    const html = ctx.renderMyDayTab();
    assert.match(html, /data-cabinet-completion-pulse/);
    assert.match(html, /data-cabinet-completion-tab="history"/);
    assert.match(html, /Історія/);
    assert.match(html, /Завантажено 1 із 1/);
    assert.match(html, /Closed payload task/);
    assert.match(html, /data-cabinet-task-action="open" data-task-id="301"/);
    assert.doesNotMatch(html, /cabinet-completed-strip/);
    assert.doesNotMatch(html, /cabinet-completed-tile/);
});

test('profile task composer keeps one date on the quick row and one priority in additional options', () => {
    const ctx = loadProfileTaskerContext();
    const collapsed = ctx.renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' });

    assert.match(collapsed, /data-cabinet-composer-state="collapsed"/);
    assert.match(collapsed, /<textarea id="cabinetTaskTitle"[^>]*aria-required="true"/);
    assert.match(collapsed, /<input id="cabinetTaskDate"[^>]*type="date" value="\d{4}-\d{2}-\d{2}"/);
    assert.match(collapsed, /data-cabinet-assignment>\s*<summary>Кому · Я/);
    assert.match(collapsed, /data-cabinet-create-action="plain"[^>]*>Додати задачу/);
    assert.match(collapsed, /data-cabinet-composer-toggle[^>]*aria-expanded="false"[^>]*>Більше параметрів/);
    assert.match(collapsed, /id="cabinetTaskAiFillBtn"[^>]*data-task-ai-draft-preview/);
    assert.match(collapsed, /id="cabinetTaskComposerStatus"[^>]*role="status"/);
    assert.match(collapsed, /id="cabinetTaskComposerAdvanced"[^>]*hidden[\s\S]*id="cabinetTaskDetails"[\s\S]*id="cabinetTaskPriority"/);
    assert.equal((collapsed.match(/id="cabinetTaskDate"/g) || []).length, 1);
    assert.equal((collapsed.match(/id="cabinetTaskPriority"/g) || []).length, 1);
    assert.doesNotMatch(collapsed, /cabinet-(due|priority)-preset|data-my-day-composer-impact/);

    vm.runInContext("cabinetTaskComposerExpanded = true; cabinetCreateDuePreset = 'no_date';", ctx);
    const expanded = ctx.renderCabinetTaskComposer({ segment: 'personal', mode: 'personal' });
    assert.match(expanded, /data-cabinet-composer-state="expanded"/);
    assert.match(expanded, /<input id="cabinetTaskDate"[^>]*value="">/);
    assert.doesNotMatch(expanded, /data-cabinet-no-date/);
    assert.match(expanded, /data-cabinet-composer-toggle[^>]*aria-expanded="true"[^>]*>Згорнути/);
    assert.doesNotMatch(expanded, /id="cabinetTaskComposerAdvanced"[^>]*hidden/);
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

test('shared TaskCreate direct create sends Idempotency-Key header without mutating payload contract', async () => {
    const calls = [];
    const ctx = {
        console,
        API_BASE: '/api',
        getAuthHeaders: () => ({ 'Content-Type': 'application/json' }),
        handleAuthError: () => false,
        apiFetchWithAuthRetry: async (url, options = {}) => {
            calls.push({ url, options });
            return {
                ok: true,
                status: 200,
                json: async () => ({ success: true, task: { id: 701, title: 'Header task' } })
            };
        },
        window: null
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'task-create.js'), 'utf8'), ctx);

    const result = await ctx.TaskCreate.createTask({ title: 'Header task' }, { idempotencyKey: 'direct_test_key_123' });

    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers['Idempotency-Key'], 'direct_test_key_123');
    assert.equal(JSON.parse(calls[0].options.body).idempotencyKey, undefined);
});

test('profile My Day due changes keep the draft composer DOM intact', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const title = { value: 'Перевірити чернетку без створення' };
    const date = { value: '' };
    const chips = ['today', 'tomorrow', 'custom'].map(value => ({
        dataset: { cabinetDuePreset: value },
        classList: { toggle() {} },
        setAttribute() {}
    }));
    let renderCalls = 0;

    ctx.TaskCreate = taskCreateCtx.TaskCreate;
    ctx.document = {
        addEventListener() {},
        getElementById(id) {
            if (id === 'cabinetTaskTitle') return title;
            if (id === 'cabinetTaskDate') return date;
            return null;
        },
        querySelectorAll() {
            return chips;
        }
    };
    ctx.renderCabinetActiveTab = () => {
        renderCalls += 1;
        title.value = '';
    };

    ctx.setCabinetDuePreset('tomorrow', { source: 'chip', rerender: true });
    assert.equal(title.value, 'Перевірити чернетку без створення');
    assert.equal(renderCalls, 0);

    date.value = '2099-05-31';
    ctx.setCabinetDuePreset('custom', { source: 'date-input', rerender: true });
    assert.equal(title.value, 'Перевірити чернетку без створення');
    assert.equal(date.value, '2099-05-31');
    assert.equal(renderCalls, 0);
});
test('profile My Day composer due presets leave the three planning periods intact', () => {
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
        cabinetCreateDuePreset = 'tomorrow';
    `, ctx);

    for (const preset of ['tomorrow', 'no_date', 'day_after_tomorrow', 'plus_3_days', 'month_end']) {
        ctx.setCabinetDuePreset(preset);
        const html = ctx.renderMyDayTab();
        assert.deepEqual([...html.matchAll(/data-park-period="([^"]+)"/g)].map(match => match[1]), ['today', 'overdue', 'future']);
        assert.match(html, /data-park-task-group="today"[\s\S]*Today focus task/);
        assert.match(html, /data-park-task-group="noDate"[\s\S]*No date focus task/);
        assert.match(html, /data-park-task-group="overdue"[\s\S]*Overdue focus task/);
        assert.match(html, /data-park-task-group="future"[\s\S]*Tomorrow focus task/);
        assert.doesNotMatch(html, /Deferred tomorrow task|data-park-task-group="focusDate"/);
    }
});

test('profile My Day custom date retains future groups', () => {
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
        cabinetCreateDuePreset = 'custom';
    `, ctx);

    const html = ctx.renderMyDayTab();
    assert.match(html, /data-park-task-group="future"/);
    assert.match(html, /Custom date focus task/);
    assert.match(html, /Other date focus task/);
});

test('profile My Day ignores an invalid composer date and still renders the board', () => {
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
        cabinetCreateDuePreset = 'custom';
    `, ctx);

    const html = ctx.renderMyDayTab();
    assert.equal(ctx.cabinetSelectedDueDate(), '');
    assert.match(html, /data-park-task-group="future"/);
    assert.match(html, /Invalid custom date task/);
});

test('profile My Day shows tasks present only in the planning projection', () => {
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
        cabinetCreateDuePreset = 'month_end';
    `, ctx);

    const html = ctx.renderMyDayTab();

    assert.match(html, /data-park-task-group="future"/);
    assert.match(html, /Planning month end task/);
});

test('profile My Day shows three periods without the legacy all-mode controls', () => {
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
        cabinetCreateDuePreset = 'tomorrow';
    `, ctx);

    const html = ctx.renderMyDayTab();

    assert.match(html, /data-park-task-group="future"/);
    assert.doesNotMatch(html, /cabinet-list-mode-toggle/);
    assert.doesNotMatch(html, /data-cabinet-list-mode="all"/);
    assert.doesNotMatch(html, /data-cabinet-all-group=/);
    assert.match(html, /All overdue task/);
    assert.match(html, /All tomorrow task/);
    assert.match(html, /All today task/);
    assert.match(html, /All later early task/);
    assert.match(html, /All later late task/);
    assert.match(html, /All no date task/);
    assert.doesNotMatch(html, /All today duplicate task/);
    assert.doesNotMatch(html, /All done task/);
    assert.doesNotMatch(html, /All deferred task/);
});

test('profile My Day uses authoritative planning groups with the cabinet fallback', () => {
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
        cabinetCreateDuePreset = 'tomorrow';
    `, ctx);

    const html = ctx.renderMyDayTab();

    assert.match(html, /Planning tomorrow task/);
    assert.match(html, /Planning no date task/);
    assert.match(html, /Legacy later task/);
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

    assert.equal(requested.at(-1), '/tasks/my-cabinet?planningView=my-day&focusDate=2026-09-15');

    controls.get('cabinetTaskDate').value = 'not-a-date';
    await ctx.loadMyCabinetProjection();

    assert.equal(requested.at(-1), '/tasks/my-cabinet?planningView=my-day');
});

test('TaskCreate buildPayload keeps the full My Day due contract for every preset', () => {
    const ctx = loadTaskCreateContext();
    const today = ctx.TaskCreate.todayStr();
    const dueCases = {
        today,
        tomorrow: addDaysToDateKey(today, 1),
        day_after_tomorrow: addDaysToDateKey(today, 2),
        plus_3_days: addDaysToDateKey(today, 3),
        month_end: monthEndDateKey(today),
        custom: '2099-05-31',
        no_date: ''
    };

    for (const [duePreset, expectedDate] of Object.entries(dueCases)) {
        const payload = ctx.TaskCreate.buildPayload({
            title: `Due contract ${duePreset}`,
            duePreset,
            scheduleDate: '2099-05-31',
            mode: 'personal',
            kind: 'action',
            category: 'personal',
            priority: 'high',
            visibility: 'me_only',
            durationMinutes: 45,
            scheduleSlot: 'afternoon'
        });

        if (!expectedDate) {
            assert.equal(Object.hasOwn(payload, 'date'), false, `${duePreset} omits date`);
            assert.equal(Object.hasOwn(payload, 'schedule'), false, `${duePreset} omits schedule`);
            assert.equal(Object.hasOwn(payload, 'effort_minutes'), false, `${duePreset} omits scheduled effort`);
            continue;
        }

        assert.equal(payload.date, expectedDate, `${duePreset} uses the canonical date`);
        assert.equal(payload.schedule.date, expectedDate, `${duePreset} keeps the canonical schedule date`);
        assert.equal(payload.schedule.slot, 'afternoon', `${duePreset} keeps the canonical schedule slot`);
        assert.equal(payload.schedule.durationMinutes, 45, `${duePreset} keeps the canonical schedule duration`);
        assert.equal(payload.effort_minutes, 45, `${duePreset} keeps effort with the date`);
    }
});

test('profile My Day ignores an older custom-date projection response', async () => {
    const ctx = loadProfileTaskerContext();
    const controls = new Map([
        ['cabinetTaskDate', { value: '2099-05-30' }]
    ]);
    const pending = [];
    ctx.document = {
        addEventListener() {},
        getElementById(id) {
            return controls.get(id) || null;
        },
        querySelectorAll() {
            return [];
        }
    };
    ctx.apiGet = url => new Promise(resolve => pending.push({ url, resolve }));
    vm.runInContext("cabinetCreateDuePreset = 'custom'; myCabinetData = { marker: 'initial' }; myCabinetLoadError = '';", ctx);

    const olderRequest = ctx.loadMyCabinetProjection({ keepExistingOnError: true });
    controls.get('cabinetTaskDate').value = '2099-05-31';
    const newerRequest = ctx.loadMyCabinetProjection({ keepExistingOnError: true });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(pending[0].url, '/tasks/my-cabinet?planningView=my-day&focusDate=2099-05-30');
    assert.equal(pending[1].url, '/tasks/my-cabinet?planningView=my-day&focusDate=2099-05-31');

    pending[1].resolve({ marker: 'newest' });
    await newerRequest;
    pending[0].resolve(null);
    await olderRequest;

    const state = vm.runInContext('({ data: myCabinetData, error: myCabinetLoadError })', ctx);
    assert.equal(state.data.marker, 'newest');
    assert.equal(state.error, '');
});

test('profile My Day dedupes identical cabinet projection requests without invalidating the active response', async () => {
    const ctx = loadProfileTaskerContext();
    const pending = [];
    ctx.apiGet = url => new Promise(resolve => pending.push({ url, resolve }));

    const first = ctx.loadMyCabinetProjection({ keepExistingOnError: true });
    const second = ctx.loadMyCabinetProjection({ keepExistingOnError: true });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(pending.length, 1);
    assert.equal(pending[0].url, '/tasks/my-cabinet?planningView=my-day');
    pending[0].resolve({ marker: 'loaded-once', all: [], today: [], overdue: [], waiting: [], private: [], completedHistory: [] });
    await first;
    await second;

    const state = vm.runInContext('({ data: myCabinetData, error: myCabinetLoadError, loadState: myCabinetLoadState })', ctx);
    assert.equal(state.data.marker, 'loaded-once');
    assert.equal(state.error, '');
    assert.equal(state.loadState, 'loaded');
});

test('profile My Day renders immediate skeleton and partial bucket controls', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext(`
        myCabinetData = null;
        myCabinetLoadState = 'loading';
        cabinetTaskComposerExpanded = false;
        cabinetCreateDuePreset = 'today';
    `, ctx);

    const loadingHtml = ctx.renderMyDayTab();
    assert.match(loadingHtml, /cabinet-task-card--skeleton/);
    assert.match(loadingHtml, /Завантажую Мій день/);

    vm.runInContext(`
        myCabinetData = {
            all: [],
            today: [],
            overdue: [{ id: 91, title: 'Old debt', date: '2026-05-01', status: 'todo', priority: 'normal' }],
            waiting: [],
            private: [],
            completedHistory: [],
            meta: {
                buckets: {
                    overdue: { total: 140, returned: 80, hasMore: true, nextOffset: 80, limit: 80 }
                }
            }
        };
        myCabinetLoadState = 'loaded';
    `, ctx);
    const partialHtml = ctx.renderMyDayTab();
    assert.match(partialHtml, /data-cabinet-bucket-more="overdue"/);
    assert.match(partialHtml, /data-cabinet-bucket-offset="80"/);
    assert.match(partialHtml, /Показати ще/);
    assert.match(partialHtml, /Показано 1 із 140/);
});

test('profile My Day fallback payload leaves no_date unscheduled', async () => {
    const ctx = loadProfileTaskerContext();
    const elements = installCabinetCreateDom(ctx, 'Fallback no date task');
    const notices = [];
    let createdPayload = null;

    elements.get('cabinetTaskPriority').value = 'high';
    elements.get('cabinetTaskReportRequired').checked = true;
    elements.get('cabinetTaskAllowReschedule').checked = false;
    ctx.TaskCreate = undefined;
    ctx.AppState = { currentUser: { id: 17 } };
    ctx.showNotification = (message, type) => notices.push({ message, type });
    ctx.renderCabinetActiveTab = () => {};
    ctx.apiPost = async (url, payload) => {
        assert.equal(url, '/tasks');
        createdPayload = payload;
        return { success: true, task: { id: 930, title: payload.title } };
    };
    ctx.apiGet = async url => {
        if (url === '/tasks/my-cabinet?planningView=my-day') {
            return { all: [{ id: 930, title: 'Fallback no date task' }], today: [], overdue: [], waiting: [], private: [], completedHistory: [] };
        }
        return null;
    };
    vm.runInContext("cabinetCreateDuePreset = 'no_date';", ctx);

    await ctx.createCabinetTask({ preventDefault() {} }, 'personal');

    assert.equal(createdPayload.title, 'Fallback no date task');
    assert.equal(createdPayload.priority, 'high');
    assert.equal(createdPayload.reportRequired, undefined);
    assert.equal(createdPayload.controlMeta.reportRequired, undefined);
    assert.equal(createdPayload.allowReschedule, false);
    assert.equal(Object.hasOwn(createdPayload, 'date'), false);
    assert.equal(Object.hasOwn(createdPayload, 'schedule'), false);
    assert.equal(Object.hasOwn(createdPayload, 'effort_minutes'), false);
    assert.equal(elements.get('cabinetTaskTitle').value, '');
    assert.equal(notices.at(-1)?.type, 'success');
});

test('My Day leaves authored-only work to the separate profile view', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext(`
        activeTab = 'myday';
        myCabinetLoadState = 'loaded';
        myCabinetData = { planning: {
            today: [
                { id: 4208, title: 'Здати звіт за листопад', viewerRoles: ['author'], ownerLabel: 'Сергій' },
                { id: 4209, title: 'Перевірити сценарій', viewerRoles: ['executor', 'author'] }
            ], noDate: []
        }};
    `, ctx);
    const html = ctx.renderMyDayTab();
    assert.match(html, /<h4>Виконую<\/h4>/);
    assert.doesNotMatch(html, /Здати звіт за листопад|Виконує Сергій/);
    assert.equal((html.match(/<article[^>]*data-task-id="4209"/g) || []).length, 1);
    assert.doesNotMatch(html, /data-cabinet-task-action="done" data-task-id="4208"/);
    assert.match(html, /data-cabinet-task-action="done" data-task-id="4209"/);
});

test('a linked My Day task focuses the requested date without changing the creation form', () => {
    const ctx = loadProfileTaskerContext();
    vm.runInContext(`
        activeTab = 'myday';
        myCabinetLoadState = 'loaded';
        cabinetDateKeyOffset = () => '2026-11-15';
        cabinetCreateDuePreset = 'today';
        myDayLinkedDate = '2026-11-20';
        myCabinetData = {
            meta: { calendar: { focusDate: '2026-11-20' } },
            planning: {
                focusDate: [{ id: 4208, title: 'Звіт на 20 листопада', date: '2026-11-20', viewerRoles: ['executor'] }],
                future: [{ id: 4209, title: 'Звіт на іншу дату', date: '2026-11-22', viewerRoles: ['executor'] }]
            }
        };
    `, ctx);
    const html = ctx.renderMyDayTab();
    assert.match(html, /data-park-task-group="focusDate"/);
    assert.match(html, /Звіт на 20 листопада/);
    assert.doesNotMatch(html, /Звіт на іншу дату/);
    assert.equal(vm.runInContext('cabinetCreateDuePreset', ctx), 'today');
});

function installCabinetCreateDom(ctx, title) {
    const elements = new Map();
    const addElement = (id, node) => elements.set(id, node);
    addElement('cabinetTaskTitle', {
        value: title,
        focused: false,
        attributes: {},
        focus() { this.focused = true; },
        setAttribute(name, value) { this.attributes[name] = String(value); }
    });
    addElement('cabinetTaskTitleGuidance', { textContent: '', className: '' });
    addElement('cabinetTaskDetails', { value: '' });
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
    addElement('cabinetTaskComposerStatus', { textContent: '', className: '' });
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

test('profile My Day empty create focuses the task field and keeps inline guidance until text is valid', async () => {
    const ctx = loadProfileTaskerContext();
    const elements = installCabinetCreateDom(ctx, '   ');
    let createCalls = 0;
    ctx.TaskCreate = {
        buildPayload: draft => draft,
        createTask: async () => {
            createCalls += 1;
            return { success: true, task: { id: 1 } };
        }
    };
    ctx.showNotification = () => {};

    await ctx.createCabinetTask({ preventDefault() {} }, 'personal');

    assert.equal(createCalls, 0);
    assert.equal(elements.get('cabinetTaskTitle').focused, true);
    assert.equal(elements.get('cabinetTaskTitle').attributes['aria-invalid'], 'true');
    assert.match(elements.get('cabinetTaskTitleGuidance').textContent, /Заповніть назву задачі/);
    assert.match(elements.get('cabinetTaskTitleGuidance').className, /error/);

    elements.get('cabinetTaskTitle').value = 'Підготувати кошторис';
    ctx.setCabinetTaskTitleGuidance('');
    assert.equal(elements.get('cabinetTaskTitle').attributes['aria-invalid'], 'false');
    assert.equal(elements.get('cabinetTaskTitleGuidance').textContent, '');
});

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
        if (url === '/tasks/my-cabinet?planningView=my-day') {
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

test('profile My Day plain create rejects long composer text without clearing it', async () => {
    const ctx = loadProfileTaskerContext();
    const title = 'Описати дуже довгу задачу '.repeat(12);
    const elements = installCabinetCreateDom(ctx, title);
    const notices = [];
    let createCalls = 0;

    ctx.AppState = { currentUser: { id: 7, username: 'serhiy' } };
    ctx.showNotification = (message, type) => notices.push({ message, type });
    ctx.TaskCreate = {
        buildPayload(draft) {
            return { ...draft, title: String(draft.title || '').trim() };
        },
        async createTask() {
            createCalls += 1;
            return { success: true, task: { id: 510, title } };
        }
    };

    await ctx.createCabinetTask({ preventDefault() {} }, 'personal');

    assert.equal(createCalls, 0);
    assert.equal(elements.get('cabinetTaskTitle').value, title);
    assert.match(elements.get('cabinetTaskTitleGuidance').textContent, /до 180 символів/);
    assert.deepEqual(notices, []);
});

test('profile My Day direct create reuses the same idempotency key after timeout and changes key for new text', async () => {
    const ctx = loadProfileTaskerContext();
    const title = 'створити після timeout без дубля';
    const elements = installCabinetCreateDom(ctx, title);
    const notices = [];
    let createCalls = 0;
    const idempotencyKeys = [];
    let lastTask = null;

    ctx.AppState = { currentUser: { id: 7, username: 'serhiy' } };
    ctx.showNotification = (message, type) => notices.push({ message, type });
    ctx.TaskCreate = {
        buildPayload(draft) {
            return { ...draft, title: String(draft.title || '').trim() };
        },
        async createTask(payload, options = {}) {
            createCalls += 1;
            idempotencyKeys.push(options.idempotencyKey);
            if (createCalls === 1) return { success: false, networkError: true, error: 'timeout' };
            lastTask = { id: 511 + createCalls, title: payload.title };
            return { success: true, task: lastTask };
        }
    };
    ctx.apiGet = async (url) => {
        if (url === '/tasks/my-cabinet?planningView=my-day') {
            return {
                all: [lastTask || { id: 513, title: elements.get('cabinetTaskTitle').value || title }],
                today: [lastTask || { id: 513, title: elements.get('cabinetTaskTitle').value || title }],
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
    await ctx.createCabinetTask({ preventDefault() {} }, 'personal');

    assert.equal(createCalls, 2);
    assert.match(idempotencyKeys[0], /^direct_/);
    assert.equal(idempotencyKeys[1], idempotencyKeys[0]);

    elements.get('cabinetTaskTitle').value = `${title} змінено`;
    await ctx.createCabinetTask({ preventDefault() {} }, 'personal');

    assert.equal(createCalls, 3);
    assert.notEqual(idempotencyKeys[2], idempotencyKeys[0]);
});

test('profile My Day direct create blocks real simultaneous double-click with one pending operation key', async () => {
    const ctx = loadProfileTaskerContext();
    const title = 'подвійний клік не створює дубль';
    installCabinetCreateDom(ctx, title);
    let releaseCreate;
    const calls = [];

    ctx.AppState = { currentUser: { id: 7, username: 'serhiy' } };
    ctx.showNotification = () => {};
    ctx.TaskCreate = {
        buildPayload(draft) {
            return { ...draft, title: String(draft.title || '').trim() };
        },
        async createTask(payload, options = {}) {
            calls.push({ payload, options });
            await new Promise(resolve => { releaseCreate = resolve; });
            return { success: true, task: { id: 530, title: payload.title } };
        }
    };
    ctx.apiGet = async (url) => {
        if (url === '/tasks/my-cabinet?planningView=my-day') {
            return {
                all: [{ id: 530, title }],
                today: [{ id: 530, title }],
                overdue: [],
                waiting: [],
                private: [],
                completedHistory: [],
                stats: { taskQuick: { completedToday: 0, activeMyDay: 1 } }
            };
        }
        return null;
    };

    const first = ctx.createCabinetTask({ preventDefault() {} }, 'personal');
    const second = ctx.createCabinetTask({ preventDefault() {} }, 'personal');
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.match(calls[0].options.idempotencyKey, /^direct_/);
    releaseCreate();
    await Promise.all([first, second]);
    assert.equal(calls.length, 1);
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
        if (url === '/tasks/my-cabinet?planningView=my-day') {
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
        if (url === '/tasks/my-cabinet?planningView=my-day') return { all: [], today: [], overdue: [], waiting: [], private: [], completedHistory: [] };
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
    const source = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');

    assert.doesNotMatch(myDayHtml, /cabinet-quick-cluster/);
    assert.doesNotMatch(myDayHtml, /cabinet-day-command-bar/);
    assert.match(myDayHtml, /cabinet-task-composer/);
    assert.doesNotMatch(myDayHtml, /cabinet-list-mode-toggle/);
    assert.doesNotMatch(myDayHtml, /data-cabinet-list-mode="focused"/);
    assert.doesNotMatch(myDayHtml, /data-cabinet-list-mode="all"/);
    assert.match(myDayHtml, /id="cabinetMyDaySegmentPanel"/);
    assert.doesNotMatch(myDayHtml, /data-cabinet-due-preset="all"/);
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
        cabinetCreateDuePreset = 'today';
        apiGet = async function() { return null; };
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

test('profile my day renders unified completion pulse without hover-only history dots', () => {
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
                    completedParentTotal: 4,
                    completedHistoryShown: 2,
                    completedHistoryOverflow: 2
                }
            }
        };
        cabinetTaskComposerExpanded = false;
        completedDashboardExpanded = true;
        completedDashboardTab = 'history';
        completedDashboardShowAll = false;
    `, ctx);

    const stripHtml = ctx.renderCabinetCompletionPulse();
    const myDayHtml = ctx.renderMyDayTab();

    assert.match(stripHtml, /data-cabinet-completion-pulse/);
    assert.match(stripHtml, /data-cabinet-completion-tab="today"/);
    assert.match(stripHtml, /data-cabinet-completion-tab="history"/);
    assert.match(stripHtml, /Історія/);
    assert.match(stripHtml, /Завантажено 2 із 4/);
    assert.match(stripHtml, /Закрити закупівлю/);
    assert.match(stripHtml, /Передати звіт/);
    assert.match(stripHtml, /cabinet-completion-day-divider/);
    assert.match(stripHtml, /data-cabinet-task-action="open" data-task-id="501"/);
    assert.match(stripHtml, /data-cabinet-task-action="open" data-task-id="502"/);
    assert.doesNotMatch(stripHtml, /cabinet-completed-tile|role="tooltip"|data-cabinet-completed-day-divider/);
    assert.match(stripHtml, /4 за весь час/);
    assert.match(stripHtml, /останні 2 задач/);
    assert.match(myDayHtml, /data-cabinet-completion-pulse/);
    assert.doesNotMatch(myDayHtml, /cabinet-completed-strip|Компактна історія виконаних задач/);
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

test('profile task cards expose overdue reschedule actions and omit legacy checklist controls', () => {
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
    assert.doesNotMatch(html, /data-cabinet-subtasks-panel|data-cabinet-inline-subtask|data-cabinet-subtask-done/);
});

test('park lets a task with legacy checklist data use normal completion', async () => {
    const ctx = loadProfileTaskerContext();
    const task = { id: 44, title: 'Legacy task', status: 'todo', subtasks: [{ id: 2, is_done: false }], reportRequired: true };
    const html = ctx.renderCabinetTaskCard(task, false, { surface: 'myday' });
    const done = html.match(/<button[^>]+data-cabinet-task-action="done"[^>]*>/)?.[0];
    assert.ok(done);
    assert.doesNotMatch(done, /\sdisabled(?:\s|>)/);
    assert.doesNotMatch(html, /потрібен звіт|Спочатку закрийте підпункти/i);
    const calls = [];
    ctx.apiPost = async (url, payload) => {
        calls.push([url, Object.keys(payload)]);
        return { success: true, task: { id: 44, status: 'done' } };
    };
    ctx.refreshMyCabinetTab = async () => {};
    ctx.document.getElementById = () => null;
    await ctx.setCabinetTaskStatus(44, 'done', { task, silent: true });
    assert.deepEqual(calls, [['/tasks/44/complete', ['sourceSurface']]]);
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

test('park card ignores legacy report requirements and opens the canonical task details', () => {
    const ctx = loadProfileTaskerContext();
    const task = {
        id: 44,
        title: 'Long decomposed task with enough metadata to force compact scanning',
        description: 'Read the customer brief',
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

    vm.runInContext(`
        activeTab = 'myday';
        MyDayTimeTracking = {
            renderTaskTrigger: task => '<button type="button" class="cabinet-task-action-btn cabinet-task-action-timer" data-my-day-time-task="' + task.id + '" data-cabinet-task-action="time-menu" data-task-id="' + task.id + '" aria-label="Відкрити час задачі">⏱</button>',
            renderTaskSummary: task => '<span class="my-day-time-summary" data-render-time-summary="' + task.id + '">План / Факт</span>'
        };
    `, ctx);
    const compact = ctx.renderCabinetTaskCard(task, false, { surface: 'myday' });
    const full = ctx.renderCabinetTaskCard(task, false, { surface: 'myday' });
    for (const html of [compact, full]) {
        assert.match(html, /park-task-card/);
        assert.match(html, /priority-high/);
        assert.doesNotMatch(html, /data-cabinet-task-priority-select/);
        assert.doesNotMatch(html, /потрібен звіт/i);
        assert.match(html, /data-task-due-state="overdue"/);
        assert.equal((html.match(/data-cabinet-task-action="open"/g) || []).length, 1);
        assert.match(html, /data-cabinet-task-action="done"/);
        assert.match(html, /data-cabinet-task-action="reschedule-date"/);
        assert.match(html, /data-cabinet-task-action="edit"/);
        assert.doesNotMatch(html, /data-cabinet-task-action="more"/);
        assert.doesNotMatch(html, /Read the customer brief|data-cabinet-inline-subtask|time-menu|toggle-my-day-details/);
    }
});

test('park keeps the task details path singular even with legacy checklists', () => {
    const ctx = loadProfileTaskerContext();
    const taskCreateCtx = loadTaskCreateContext();
    const today = taskCreateCtx.TaskCreate.todayStr();

    vm.runInContext(`
        activeTab = 'myday';
        cabinetCreateDuePreset = 'today';
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

    const compact = ctx.renderMyDayTab();
    const full = ctx.renderMyDayTab();
    for (const html of [compact, full]) {
        assert.doesNotMatch(html, /Чекліст|First done|Second next/i);
        assert.doesNotMatch(html, /data-cabinet-task-priority-select/);
        assert.match(html, /data-cabinet-task-action="open"/);
        assert.doesNotMatch(html, /data-cabinet-inline-subtask|toggle-my-day-details/);
    }
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
    assert.match(first, />1 перенесення<\/button>/);
    assert.match(first, /level-1/);
    assert.match(first, /data-cabinet-task-action="postponement-explanation"/);
    assert.match(first, /aria-haspopup="dialog"/);
    assert.match(first, /aria-expanded="false"/);
    assert.match(first, /aria-controls="taskUiActionSurface"/);
    assert.match(second, />2 перенесення<\/button>/);
    assert.match(second, /level-2/);
    assert.match(critical, />5 перенесень<\/button>/);
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

test('park game placeholders apply to every role', () => {
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

    assert.equal(ctx.profileCanOpenTab('inventory'), false);
    assert.equal(ctx.profileCanOpenTab('shop'), false);
    assert.equal(ctx.profileCanOpenTab('quests'), false);
    assert.match(ctx.renderProfilePrimaryTab('inventory', 'Інвентар', { ownOnly: true }), /is-soon/);
    assert.match(ctx.renderTabContent(), /Інвентар скоро/);
});

test('my cabinet task projection counts today, undated and overdue carry-over workload', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'taskCabinetProjection.js'), 'utf8');
    const completionHistorySource = fs.readFileSync(path.join(ROOT, 'services', 'taskCompletionHistory.js'), 'utf8');
    const authSource = fs.readFileSync(path.join(ROOT, 'routes', 'auth.js'), 'utf8');
    const sidebarSource = fs.readFileSync(path.join(ROOT, 'js', 'components', 'sidebar.js'), 'utf8');

    assert.match(source, /taskWorkloadDateSql, taskAutomaticOriginSql/);
    assert.match(source, /taskQuick/);
    assert.match(source, /COUNT\(\*\) FILTER \(WHERE t\.status = 'done'\)::int AS parent_done_total/);
    assert.match(source, /const completedParentTotal = Number\(quickStats\.parent_done_total \|\| 0\);/);
    assert.match(source, /const completedUnitsTotal = completedParentTotal/);
    assert.match(source, /completed:\s*completedUnitsToday/);
    assert.match(source, /completedToday:\s*completedUnitsToday/);
    assert.match(source, /completedTotal:\s*completedUnitsTotal/);
    assert.match(source, /completedUnitsTotal/);
    assert.match(source, /completedParentTotal/);
    assert.match(source, /completedParentToday/);
    assert.match(source, /completedMetricContract:\s*'completed_units = completed_tasks'/);
    assert.match(source, /completedHistoryContract:\s*'completed_history_contains_parent_tasks_only'/);
    assert.match(source, /completedTodayTasksContract:\s*'task_completed_today'/);
    assert.match(source, /completedHistoryOverflow:\s*Math\.max\(0, completedParentTotal - completedHistory\.length\)/);
    assert.match(source, /completedTodayTasks/);
    assert.match(source, /completedTodaySourceRows/);
    assert.match(source, /queryTaskCompletionHistoryPage\(queryable, \{/);
    assert.match(completionHistorySource, /loadTaskTimeTotalsForDate\(queryable, userId, taskIds, today\)/);
    assert.match(completionHistorySource, /actualSecondsToday: timeTotalsTodayByTaskId\.get\(taskId\) \|\| 0/);
    assert.match(completionHistorySource, /function queryTaskCompletionHistoryPage/);
    assert.match(completionHistorySource, /ORDER BY \$\{orderExpression\} DESC, t\.id DESC/);
    assert.match(completionHistorySource, /LIMIT \$\$\{limitParam\}/);
    assert.match(completionHistorySource, /nextCursor: hasMore \? encodeCompletionHistoryCursor/);
    assert.match(completionHistorySource, /completedTodayKind/);
    assert.match(source, /normalizeTaskCabinetRows\(queryable, user, userId, allSourceRowsRaw, today, options\.includeLegacyMetadata\)/);
    assert.match(source, /loadTaskTimeTotalsForDate\(queryable, userId, ids, today\)/);
    assert.match(source, /actualSecondsToday: taskTimeTotalsTodayByTaskId\.get\(taskId\) \|\| 0/);
    assert.match(source, /completedTodayKind/);
    assert.match(source, /\(t\.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe\/Kyiv'\)::date = \$\$\{completedTodayDatePlaceholder\}::date/);
    assert.match(source, /remaining_today/);
    assert.match(source, /overdue_carryover/);
    assert.match(source, /active_my_day/);
    assert.match(source, /remaining:\s*activeMyDay/);
    assert.match(source, /SELECT COUNT\(\*\)::int AS open_count/);
    assert.match(source, /const openTaskCount = Number\(openCountResult\.rows\[0\]\?\.open_count \?\? activeSourceRowsRaw\.length\);/);
    assert.match(source, /sidebarOpenWorkload:\s*openTaskCount/);
    assert.match(source, /scope:\s*'completed_units_today_and_active_my_day_or_undated'/);
    assert.match(source, /scheduled_start_at/);
    assert.match(source, /snoozed_until/);
    assert.match(source, /taskPriorityOrderSql/);
    assert.match(source, /dueDate && dueDate < today/);
    assert.match(source, /if \(dueDate === today\) buckets\.today\.push/);
    assert.doesNotMatch(completionHistorySource, /task_subtasks/);
    assert.match(source, /completedHistory:\s*\{\s*\n\s*\.\.\.completedHistoryPage\.pagination/);
    assert.doesNotMatch(source, /task_subtasks/);
    assert.match(source, /\.\.\.completedHistorySourceRowsRaw,\s*\.\.\.completedTodaySourceRowsRaw/);
    assert.doesNotMatch(authSource, /task_subtasks/);
    assert.match(authSource, /tasks\.completedUnits = parentDoneTotal/);
    assert.match(authSource, /tasks\.done = tasks\.completedUnits/);
    assert.doesNotMatch(source, /const openTaskCount = rows\.length;/);
    assert.doesNotMatch(sidebarSource, /Number\(tasks\.assigned \|\| 0\) \+ Number\(tasks\.in_progress \|\| 0\)/);
});

test('my cabinet projection exposes additive planning calendar contract', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'taskCabinetProjection.js'), 'utf8');
    const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const profileSource = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');

    assert.match(routeSource, /router\.get\('\/my-cabinet'/);
    assert.match(routeSource, /const businessScope = requireTaskReadScope\(req, res\);/);
    assert.match(routeSource, /const rawBucket = req\.query\.bucket \|\| req\.query\.pageBucket \|\| req\.query\.page_bucket/);
    assert.match(routeSource, /buildTaskCabinetBucketPage\(\{/);
    assert.match(routeSource, /Unsupported My Cabinet bucket/);
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
    assert.match(source, /calendar,\s*\n\s*buckets:\s*\{/);
    assert.match(source, /postponementExplanationContract:\s*'postponement_explanation_v1'/);
    assert.match(source, /planning:\s*planningMeta/);
    assert.match(source, /completedHistory:\s*\{\s*\n\s*\.\.\.completedHistoryPage\.pagination/);
    assert.match(source, /privacyRule:\s*'private\/me_only tasks are owner-only'/);
    assert.match(source, /planningDateSql\} IS NULL/);
    assert.match(source, /planningDateSql\} BETWEEN/);
    assert.match(profileSource, /function cabinetPlanningList/);
    assert.match(profileSource, /cabinetPlanningList\('all'\)/);
    assert.match(profileSource, /CABINET_PLANNING_TASK_BUCKETS/);
    assert.match(profileSource, /forEachCabinetProjectionTaskList/);
    assert.match(profileSource, /function loadMyCabinetProjection/);
    assert.match(profileSource, /params\.set\('focusDate', focusDate\)/);
    assert.match(profileSource, /refreshMyCabinetTab\(\{ force: true, silent: false, keepExistingOnError: true \}\)/);
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
    assertPersonalQueryParameters(planningCall, ['2026-07-02', '2026-07-31', '2026-09-15', 261]);
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
    assertPersonalQueryParameters(planningCall, ['2026-07-02', '2026-07-31', 3]);
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
        noDate: 0,
        future: 1,
        focusDate: 0
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
    assertPersonalQueryParameters(planningCall, ['2026-07-02', '2026-07-31', 261]);
});

test('my cabinet completed today dashboard bucket is exact and independent from 36-row history', async () => {
    const { buildTaskCabinetProjection } = require('../services/taskCabinetProjection');
    const calls = [];
    const historyRows = Array.from({ length: 36 }, (_, index) => ({
        id: 1000 + index,
        title: `History ${index + 1}`,
        status: 'done',
        completed_at: `2026-08-14T${String(8 + (index % 10)).padStart(2, '0')}:00:00.000Z`
    }));
    const completedTodayRow = {
        id: 500,
        title: 'Exact today completion outside history window',
        status: 'done',
        completed_at: '2026-08-14T13:30:00.000Z',
        completed_subtask_count_today: 2,
        latest_subtask_completed_at: '2026-08-14T13:45:00.000Z',
        subtasks: [
            { id: 1, title: 'Done step', is_done: true, completed_at: '2026-08-14T13:40:00.000Z' },
            { id: 2, title: 'Second step', is_done: true, completed_at: '2026-08-14T13:45:00.000Z' }
        ]
    };
    const pool = {
        async query(text, params = []) {
            calls.push({ text, params });
            if (/SELECT COUNT\(\*\)::int AS open_count/.test(text)) {
                return { rows: [{ open_count: 0 }] };
            }
            if (/completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe\/Kyiv'/.test(text) && /SELECT t\.\*/.test(text)) {
                return { rows: [completedTodayRow] };
            }
            if (/completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe\/Kyiv'/.test(text) && /SELECT COUNT\(\*\)::int AS total/.test(text)) {
                return { rows: [{ total: 1 }] };
            }
            if (/COALESCE\(t\.status, 'todo'\) = 'done'/.test(text) && /LIMIT \$\d+/.test(text)) {
                return { rows: historyRows };
            }
            if (/done_total/.test(text)) {
                return {
                    rows: [{
                        parent_done_total: 55,
                        done_total: 99,
                        done_today: 3,
                        parent_done_today: 1,
                        subtask_done_today: 2,
                        subtask_done_total: 44,
                        remaining_today: 0,
                        overdue_carryover: 0,
                        active_my_day: 0
                    }]
                };
            }
            if (/actual_seconds_today/.test(text)) {
                return { rows: [{ task_id: 500, actual_seconds_today: 600 }] };
            }
            if (/FROM unnest\(\$2::int\[\]\)/.test(text)) {
                return {
                    rows: [{
                        task_id: 500,
                        direction_id: null,
                        impacts: [{ id: 9, name: 'CRM', color: '#0EA5E9', icon: 'C', isActive: true }]
                    }]
                };
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
        now: new Date('2026-08-14T12:00:00.000Z')
    });

    const completedTodayCall = calls.find(call => /completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe\/Kyiv'/.test(call.text) && /SELECT t\.\*/.test(call.text));
    assert.ok(completedTodayCall, 'completedTodayTasks query should be executed separately');
    assert.doesNotMatch(completedTodayCall.text, /task_subtasks/);
    assertPersonalQueryParameters(completedTodayCall, ['2026-08-14', 121]);
    assert.equal(projection.completedHistory.length, 36);
    assert.equal(projection.completedTodayTasks.length, 1);
    assert.equal(projection.completedHistory.some(task => task.id === 500), false);
    assert.equal(projection.completedTodayTasks[0].id, 500);
    assert.equal(projection.completedTodayTasks[0].actualSeconds, 0);
    assert.equal(projection.completedTodayTasks[0].actualSecondsToday, 600);
    assert.equal(projection.completedTodayTasks[0].completedParentToday, true);
    assert.equal(projection.completedTodayTasks[0].completedTodayKind, 'task');
    assert.equal(projection.completedTodayTasks[0].myDay.impacts[0].name, 'CRM');
    assert.equal(projection.stats.taskQuick.completedParentTotal, 55);
    assert.equal(projection.stats.taskQuick.completedUnitsTotal, 55);
    assert.equal(projection.stats.taskQuick.completedTotal, 55);
    assert.equal(projection.stats.taskQuick.completedParentToday, 1);
    assert.equal(projection.stats.taskQuick.completedUnitsToday, 1);
    assert.equal(projection.stats.taskQuick.completedHistoryShown, 36);
    assert.equal(projection.stats.taskQuick.completedHistoryOverflow, 19);
    assert.equal(projection.stats.taskQuick.completedHistoryContract, 'completed_history_contains_parent_tasks_only');
    assert.equal(projection.stats.taskQuick.completedTodayTasksContract, 'task_completed_today');
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
    assert.match(source, /optionalCreateStep\('schedule'/);
    assert.match(source, /optionalCreateStep\('dependencies'/);
    assert.match(source, /ROLLBACK TO SAVEPOINT[\s\S]*recordPostCreateWarning\(name, error\)/);
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
    assert.match(tasksPageSource, /function isDeferredTask/);
    assert.match(tasksPageSource, /case 'deferred'/);
    assert.match(tasksHtml, /data-view="deferred"/);
    assert.match(tasksHtml, /<summary>Інші перегляди<\/summary>/);
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


test('My Day level 3 recommendation renders only permission-approved actions', () => {
    const ctx = loadProfileTaskerContext();
    const base = { id: 301, postponementCount: 3, actionPermissions: { canSplit: true, canReassign: true, canReschedule: true, canArchive: true } };
    const allActions = ctx.renderCabinetPostponementExplanation(base);
    assert.match(allActions, /Задачу переносять уже втретє/);
    assert.doesNotMatch(allActions, /Розбити на кроки/);
    assert.match(allActions, /Змінити виконавця/);
    assert.match(allActions, /Перепланувати/);
    assert.match(allActions, /Архівувати задачу/);

    const restricted = ctx.renderCabinetPostponementExplanation({
        ...base,
        actionPermissions: { canSplit: false, canReassign: false, canReschedule: true, canArchive: false }
    });
    assert.match(restricted, /Перепланувати/);
    assert.doesNotMatch(restricted, /Розбити на кроки|Змінити виконавця|Архівувати задачу/);

    const nonCritical = ctx.renderCabinetPostponementExplanation({ ...base, postponementCount: 2 });
    assert.doesNotMatch(nonCritical, /cabinet-postponement-decision|data-cabinet-postponement-action/);
});

test('My Day critical actions reuse the existing reassign endpoint', async () => {
    const ctx = loadProfileTaskerContext();
    const calls = [];
    ctx.formModal = async () => ({ ownerUserId: '44' });
    ctx.apiGet = async path => {
        assert.equal(path, '/tasks/owners');
        return { success: true, users: [{ id: 44, label: 'Олена', role: 'manager' }] };
    };
    ctx.apiPost = async (path, body) => {
        calls.push({ path, body });
        return { success: true };
    };
    ctx.TaskUiShared = {
        executePrivateTaskHandoff: async request => request(false)
    };

    await ctx.reassignCabinetPostponementTask(301, { ownerUserId: 7 });
    assert.deepEqual(calls.map(call => call.path), ['/tasks/301/reassign']);
    assert.equal(calls[0].body.ownerUserId, 44);
    assert.equal(calls[0].body.sourceSurface, 'profile_my_cabinet_postponement_action');
});

test('My Day reassign retries only after shared private handoff confirmation', async () => {
    const ctx = loadProfileTaskerContext();
    const calls = [];
    ctx.formModal = async () => ({ ownerUserId: '44' });
    ctx.apiGet = async () => ({ success: true, users: [{ id: 44, label: 'Receiver', role: 'manager' }] });
    ctx.TaskUiShared = {
        executePrivateTaskHandoff: async request => {
            const first = await request(false);
            assert.equal(first.success, false);
            assert.equal(first.code, 'TASK_PRIVATE_HANDOFF_CONFIRM_REQUIRED');
            return request(true);
        }
    };
    ctx.apiPost = async (path, body) => {
        calls.push({ path, body });
        if (calls.length === 1) {
            return {
                success: false,
                code: 'TASK_PRIVATE_HANDOFF_CONFIRM_REQUIRED',
                meta: { privateHandoff: { confirmationRequired: true, actorWillLoseAccess: true } }
            };
        }
        return { success: true };
    };

    await ctx.reassignCabinetPostponementTask(302, { ownerUserId: 7 });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].path, '/tasks/302/reassign');
    assert.equal(calls[0].body.confirmPrivateHandoff, undefined);
    assert.equal(calls[1].body.confirmPrivateHandoff, true);
});

test('My Day archive action requires confirmation and archives without DELETE', async () => {
    const ctx = loadProfileTaskerContext();
    const calls = [];
    let confirmation = '';
    ctx.confirmModal = async message => { confirmation = message; return true; };
    ctx.apiPost = async (path, body) => { calls.push({ path, body }); return { success: true, affected: 1 }; };
    ctx.apiDelete = async () => { throw new Error('DELETE must not be called'); };

    await ctx.archiveCabinetPostponementTask(302);
    assert.match(confirmation, /Архівувати задачу/);
    assert.match(confirmation, /можна буде відновити/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/tasks/bulk');
    assert.equal(calls[0].body.action, 'archive');
    assert.deepEqual(Array.from(calls[0].body.ids), [302]);

    ctx.confirmModal = async () => false;
    const cancelled = await ctx.archiveCabinetPostponementTask(303);
    assert.equal(cancelled.cancelled, true);
    assert.equal(calls.length, 1);

    const source = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    assert.match(source, /setCabinetPostponementActionState[\s\S]*disabled = busy/);
    assert.match(source, /await refreshMyCabinetTab\(\{ silent: true \}\)[\s\S]*renderCabinetActiveTab\(\)/);
    assert.doesNotMatch(source.slice(source.indexOf('async function archiveCabinetPostponementTask'), source.indexOf('async function runCabinetPostponementAction')), /apiDelete|method:\s*['"]DELETE/);
});


test('My Day custom reschedule cancellation does not mutate or report success', async () => {
    const ctx = loadProfileTaskerContext();
    let apiCalled = false;
    ctx.promptModal = async () => null;
    ctx.apiPost = async () => { apiCalled = true; return { success: true }; };

    const result = await ctx.rescheduleCabinetTask(304, 'custom', { refresh: false });
    assert.equal(result.cancelled, true);
    assert.equal(apiCalled, false);
});
