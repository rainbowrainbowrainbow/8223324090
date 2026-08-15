'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const time = require('../services/myDayTimeTracking');

test('task totals are user-scoped and preserve seconds without changing planned effort', async () => {
    const calls = [];
    const totals = await time.loadTaskTimeTotals({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [{ task_id: 41, actual_seconds: 3661 }] };
        }
    }, 7, [41, 41, 0]);
    assert.equal(totals.get(41), 3661);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /WHERE user_id = \$1 AND task_id = ANY/);
    assert.deepEqual(calls[0].params, [7, [41]]);
});

test('task day totals clip entries to the Kyiv-day boundaries', async () => {
    const calls = [];
    const totals = await time.loadTaskTimeTotalsForDate({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [{ task_id: 41, actual_seconds_today: 1800 }] };
        }
    }, 7, [41, 41, 0], '2026-08-14');
    assert.equal(totals.get(41), 1800);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /WITH bounds AS/);
    assert.match(calls[0].sql, /AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(calls[0].sql, /LEAST\(COALESCE\(e\.ended_at, NOW\(\)\), bounds\.day_end\)/);
    assert.match(calls[0].sql, /GREATEST\(e\.started_at, bounds\.day_start\)/);
    assert.deepEqual(calls[0].params, [7, [41], '2026-08-14']);
});

test('manual time uses PostgreSQL Europe/Kyiv conversion and rejects overlap server-side', async () => {
    const calls = [];
    const interval = await time.manualInterval({
        query: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [{ started_at: '2026-03-29T01:30:00.000Z', ended_at: '2026-03-29T02:00:00.000Z' }] };
        }
    }, { localDate: '2026-03-29', startTime: '03:30', durationMinutes: 30 });
    assert.equal(interval.durationMinutes, 30);
    assert.match(calls[0].sql, /AT TIME ZONE 'Europe\/Kyiv'/);
    await assert.rejects(
        () => time.createManualEntry({ query: async sql => {
            if (/AT TIME ZONE/.test(sql)) return { rows: [{ started_at: '2026-01-01T08:00:00Z', ended_at: '2026-01-01T09:00:00Z' }] };
            if (/SELECT id/.test(sql)) return { rows: [{ id: 1 }] };
            return { rows: [] };
        } }, { userId: 1, taskId: 2, localDate: '2026-01-01', startTime: '10:00', durationMinutes: 60 }),
        error => error.code === 'MY_DAY_TIME_OVERLAP'
    );
});

test('time ledger contract has one active timer, atomic switch, completion stop, and My Day routes', () => {
    const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '314_my_day_time_entries.sql'), 'utf8');
    const service = fs.readFileSync(path.join(root, 'services', 'myDayTimeTracking.js'), 'utf8');
    const route = fs.readFileSync(path.join(root, 'routes', 'my-day.js'), 'utf8');
    const execution = fs.readFileSync(path.join(root, 'services', 'taskExecution.js'), 'utf8');
    const projection = fs.readFileSync(path.join(root, 'services', 'taskCabinetProjection.js'), 'utf8');
    assert.match(migration, /uq_my_day_time_entries_one_active_per_user/);
    assert.match(migration, /ended_at IS NULL/);
    assert.match(migration, /ended_at > started_at/);
    assert.match(service, /existing\?\.taskId === taskId/);
    assert.match(service, /stopActiveTimerForUser\(queryable, userId\)/);
    assert.match(service, /MAX_MANUAL_DURATION_MINUTES/);
    assert.match(service, new RegExp("::timestamp AT TIME ZONE 'Europe/Kyiv'"));
    assert.match(route, /router\.post\('\/timer\/start'/);
    assert.match(route, /router\.post\('\/timer\/stop'/);
    assert.match(route, /router\.get\('\/time-entries'/);
    assert.match(route, /router\.patch\('\/time-entries\/:id'/);
    assert.match(execution, /stopActiveTimerForUser\(query, normalizeUserId\(actor\), \{ taskId: task\.id \}\)/);
    assert.match(projection, /actualSeconds: taskTimeTotalsByTaskId\.get\(taskId\) \|\| 0/);
});

test('My Day UI keeps an icon trigger in the header and plan/fact in details', () => {
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-time-tracking.js'), 'utf8');
    assert.doesNotMatch(profile, /renderActiveTimerStrip/);
    assert.match(profile, /renderTaskTrigger/);
    assert.match(profile, /renderTaskSummary/);
    assert.match(profile, /myDayTimeTracking\.load\(\)/);
    assert.match(profile, /myDayTimeTracking\.bind\?\.\(document\)/);
    assert.match(ui, /effortMinutes/);
    assert.match(ui, /actualSeconds/);
    assert.doesNotMatch(ui, /data-my-day-active-timer-elapsed/);
    assert.doesNotMatch(ui, /data-my-day-time-strip/);
    assert.match(ui, /data-my-day-time-task-actual/);
    assert.match(ui, /timer-start/);
    assert.match(ui, /timer-stop/);
    assert.match(ui, /time-entries/);
    assert.match(ui, /data-my-day-time-edit/);
    assert.match(ui, /data-my-day-time-delete/);
    assert.doesNotMatch(ui, /Рџ|Рќ|Рў|Р¤|Р—|вЂ/);
});

test('My Day time controls use CRM classes instead of raw browser-default buttons', () => {
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-time-tracking.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css', 'pages-profile.css'), 'utf8');
    const taskUi = fs.readFileSync(path.join(root, 'js', 'task-ui.js'), 'utf8');

    assert.doesNotMatch(ui, /my-day-active-timer/);
    assert.match(ui, /my-day-time-summary/);
    assert.match(ui, /my-day-time-disclosure/);
    assert.match(ui, /cabinet-task-action-timer/);
    assert.match(ui, /Відкрити час задачі/);
    assert.match(ui, /aria-haspopup="dialog"/);
    assert.match(ui, /my-day-time-button--primary/);
    assert.match(ui, /my-day-time-button--stop/);
    assert.match(ui, /my-day-time-popover/);
    assert.match(ui, />Редагувати</);
    assert.match(ui, />Видалити</);
    assert.doesNotMatch(ui, />Ред\.</);
    assert.match(css, /\.my-day-time-button\s*\{/);
    assert.match(css, /min-height:\s*36px/);
    assert.match(css, /\.my-day-time-disclosure\s*\{/);
    assert.match(css, /min-height:\s*34px/);
    assert.match(css, /flex-wrap:\s*wrap/);
    assert.match(css, /\.my-day-time-popover\.is-popover \.task-ui-action-panel/);
    assert.match(css, /\.my-day-time-menu-actions\s*\{[\s\S]*display:\s*grid/);
    assert.match(css, /\.my-day-time-menu-primary\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
    assert.match(css, /body\.dark-mode \.my-day-time-popover \.my-day-time-button--primary/);
    assert.match(css, /body\.dark-mode \.my-day-time-popover \.my-day-time-button--stop/);
    assert.doesNotMatch(css, /\.my-day-active-timer/);
    assert.match(css, /html\[data-theme="dark"\] body \.profile-page\.profile-work-mode \.my-day-time-disclosure/);
    assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.my-day-time-task--disclosure/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.my-day-time-disclosure/);
    assert.match(taskUi, /event\.key === 'Escape'[\s\S]*closeActionMenu\(\)/);
    assert.match(taskUi, /data-task-ui-close/);
});
function loadTimeTrackingUi(overrides = {}) {
    const uiCode = fs.readFileSync(path.join(root, 'js', 'my-day-time-tracking.js'), 'utf8');
    const intervals = [];
    const cleared = [];
    const context = {
        console,
        Date: overrides.Date || Date,
        Intl,
        fetch: overrides.fetch || (async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })),
        setInterval: callback => { intervals.push(callback); return intervals.length; },
        clearInterval: id => { cleared.push(id); },
        document: overrides.document || { querySelector: () => null, querySelectorAll: () => [] },
        window: {
            TaskUI: { escapeHtml: value => String(value), ...(overrides.taskUi || {}) },
            getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
            promptModal: async () => null,
            showNotification: () => {},
            ...(overrides.window || {})
        }
    };
    vm.createContext(context);
    vm.runInContext(uiCode, context);
    return { api: context.window.MyDayTimeTracking, intervals, cleared, context };
}

test('My Day timer UI derives live elapsed seconds from client clock without duplicate intervals', () => {
    let now = 1_800_000_000_000;
    class TestDate extends Date {
        static now() { return now; }
    }
    const actualNode = {
        dataset: {
            myDayTimeTaskActual: '41',
            myDayTimeActualBase: '30',
            myDayTimeSyncedAt: String(now)
        },
        textContent: '0:30'
    };
    const { api, intervals, cleared } = loadTimeTrackingUi({
        Date: TestDate,
        document: {
            querySelector: () => null,
            querySelectorAll: selector => selector === '[data-my-day-time-task-actual]' ? [actualNode] : []
        }
    });
    const timer = api.normalizeTimer({ taskId: 41, durationSeconds: 30, isActive: true, task: { title: 'Live task' } });
    timer.clientSyncedAt = now - 65_000;
    api.state.timer = timer;

    assert.equal(api.secondsLabel(30), '0:00', 'settled summaries keep minute precision');
    assert.equal(api.liveSecondsLabel(30), '0:30', 'active timer shows seconds before the first minute');
    assert.equal(api.liveSecondsLabel(95), '1:35', 'active timer keeps seconds after one minute');
    assert.ok(api.currentTimerDurationSeconds() >= 95);
    const trigger = api.renderTaskTrigger({ id: 41, actualSeconds: 30 });
    assert.match(trigger, /my-day-time-disclosure/);
    assert.match(trigger, /cabinet-task-action-timer/);
    assert.match(trigger, /aria-label="Таймер працює — відкрити час задачі"/);
    assert.match(trigger, /aria-haspopup="dialog"/);
    assert.match(trigger, /my-day-time-running-dot/);
    assert.doesNotMatch(trigger, /data-my-day-time-task-actual|>0:30<\/span>/, 'header trigger stays icon-only');

    const summary = api.renderTaskSummary({ id: 41, actualSeconds: 30 });
    assert.match(summary, /data-my-day-time-task-actual="41"/);
    assert.match(summary, />0:30<\/span>/, 'detailed summary renders live seconds');
    assert.doesNotMatch(trigger, /data-cabinet-task-action="timer-start"/, 'collapsed card does not render a large start button inline');
    assert.doesNotMatch(trigger, /data-cabinet-task-action="time-entry"/, 'collapsed card keeps manual time behind the popover');

    now += 1_000;
    api.updateTimerDom();
    assert.equal(actualNode.textContent, '0:31', 'live DOM advances one second instead of dropping to minute precision');

    assert.equal(api.syncTicker(true), true);
    assert.equal(api.syncTicker(true), true);
    assert.equal(intervals.length, 1, 'ticker starts only one interval');
    assert.equal(api.syncTicker(false), false);
    assert.deepEqual(cleared, [1], 'ticker clears the active interval');
});

test('My Day timer hydration deduplicates concurrent requests and resolves fresh state', async () => {
    let fetchCount = 0;
    let releaseFetch;
    const responsePromise = new Promise(resolve => { releaseFetch = resolve; });
    const { api } = loadTimeTrackingUi({
        fetch: async () => {
            fetchCount += 1;
            return responsePromise;
        }
    });

    const first = api.load();
    const second = api.load();
    assert.equal(fetchCount, 1, 'concurrent hydration shares one request');
    releaseFetch({
        ok: true,
        status: 200,
        json: async () => ({ success: true, timer: { taskId: 55, durationSeconds: 9, isActive: true } })
    });
    const [firstTimer, secondTimer] = await Promise.all([first, second]);

    assert.equal(firstTimer.taskId, 55);
    assert.equal(secondTimer.taskId, 55);
    assert.equal(api.state.timer.taskId, 55);
    assert.equal(api.state.loaded, true);
    assert.equal(api.state.loading, false);
});

test('My Day timer UI hydrates active timer from API and clears ticker on stop action', async () => {
    const fetchCalls = [];
    const { api, intervals, cleared } = loadTimeTrackingUi({
        fetch: async (url, options = {}) => {
            fetchCalls.push({ url, method: options.method || 'GET' });
            if (String(url).endsWith('/timer')) {
                return { ok: true, status: 200, json: async () => ({ success: true, timer: { taskId: 77, durationSeconds: 12, isActive: true, task: { title: 'Hydrated' } } }) };
            }
            if (String(url).endsWith('/timer/stop')) {
                return { ok: true, status: 200, json: async () => ({ success: true, timer: { taskId: 77, durationSeconds: 18, endedAt: '2026-08-04T10:00:00Z', isActive: false } }) };
            }
            return { ok: true, status: 200, json: async () => ({ success: true }) };
        }
    });

    const timer = await api.load();
    assert.equal(timer.taskId, 77);
    assert.equal(api.state.loaded, true);
    assert.equal(intervals.length, 0, 'load hydrates state without starting a detached ticker');
    api.bind({ querySelector: () => ({}), querySelectorAll: () => [] });
    assert.equal(intervals.length, 1, 'bind starts ticker when the My Day timer surface exists');

    let changed = 0;
    await api.handleAction('timer-stop', 77, async () => { changed += 1; });
    assert.equal(api.state.timer, null);
    assert.equal(changed, 1, 'stop requests a UI refresh callback');
    assert.deepEqual(cleared, [1], 'stop clears live ticker');
    assert.deepEqual(fetchCalls.map(call => `${call.method} ${call.url}`), ['GET /api/my-day/timer', 'POST /api/my-day/timer/stop']);
});

test('My Day timer Start and Stop notify the global timer immediately', async () => {
    const notifications = [];
    const fetchCalls = [];
    const { api } = loadTimeTrackingUi({
        window: {
            GlobalTaskTimer: { notifyLocalChange: action => notifications.push(action) }
        },
        fetch: async (url, options = {}) => {
            fetchCalls.push(`${options.method || 'GET'} ${url}`);
            if (String(url).endsWith('/timer/start')) {
                return { ok: true, status: 200, json: async () => ({ success: true, timer: { taskId: 9, durationSeconds: 0, isActive: true } }) };
            }
            return { ok: true, status: 200, json: async () => ({ success: true, timer: null }) };
        }
    });

    let changed = 0;
    await api.handleAction('timer-start', 9, async () => { changed += 1; });
    assert.equal(api.state.timer.taskId, 9);
    await api.handleAction('timer-stop', 9, async () => { changed += 1; });

    assert.equal(api.state.timer, null);
    assert.equal(changed, 2);
    assert.deepEqual(notifications, ['start', 'stop']);
    assert.deepEqual(fetchCalls, ['POST /api/my-day/timer/start', 'POST /api/my-day/timer/stop']);
});

test('My Day time disclosure reuses current timer state before opening the TaskUI popover', async () => {
    const opened = {};
    const fetchCalls = [];
    const fakeRoot = { querySelectorAll: () => [] };
    const { api } = loadTimeTrackingUi({
        fetch: async (url, options = {}) => {
            fetchCalls.push(`${options.method || 'GET'} ${url}`);
            return { ok: true, status: 200, json: async () => ({ success: true, timer: null }) };
        },
        taskUi: {
            openActionMenu: (button, html, options) => {
                opened.button = button;
                opened.html = html;
                opened.options = options;
                return fakeRoot;
            }
        }
    });

    const controls = api.renderTaskControls({ id: 9, effortMinutes: 30, actualSeconds: 60 }, { detailed: false });
    assert.match(controls, /my-day-time-disclosure/);
    assert.doesNotMatch(controls, /data-cabinet-task-action="timer-start"/);
    assert.doesNotMatch(controls, /data-cabinet-task-action="time-entry"/);

    api.state.loaded = true;
    api.state.timer = api.normalizeTimer({ taskId: 9, durationSeconds: 8, isActive: true });
    const trigger = {
        id: 'time-trigger',
        disabled: false,
        classList: { add: () => {}, remove: () => {} },
        setAttribute: () => {},
        removeAttribute: () => {}
    };
    await api.handleAction('time-menu', 9, async () => {}, trigger, { id: 9, effortMinutes: 30, actualSeconds: 60 });

    assert.deepEqual(fetchCalls, [], 'opening reuses current timer state when it is already hydrated');
    assert.equal(trigger.disabled, false, 'trigger busy state is restored');
    assert.equal(opened.options.title, 'Час задачі');
    assert.equal(opened.options.surfaceClassName, 'my-day-time-popover my-day-time-menu-popover');
    assert.match(opened.html, /data-my-day-time-menu-action="timer-stop"/);
    assert.doesNotMatch(opened.html, /data-my-day-time-menu-action="timer-start"/);
    assert.match(opened.html, /data-my-day-time-menu-action="time-entry"/);
    assert.match(opened.html, /data-my-day-time-menu-action="time-entries"/);
    assert.match(opened.html, />План</);
    assert.match(opened.html, />Факт</);
});

test('opening the time menu preserves live fact accumulated after the card snapshot', async () => {
    let now = 1_800_000_000_000;
    class TestDate extends Date {
        static now() { return now; }
    }
    const opened = {};
    const { api } = loadTimeTrackingUi({
        Date: TestDate,
        fetch: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ success: true, timer: { id: 7, taskId: 9, startedAt: '2026-08-13T10:00:00Z', durationSeconds: 150, isActive: true } })
        }),
        taskUi: {
            openActionMenu: (_button, html) => {
                opened.html = html;
                return { querySelectorAll: () => [] };
            }
        }
    });
    api.state.timer = api.normalizeTimer({ id: 7, taskId: 9, startedAt: '2026-08-13T10:00:00Z', durationSeconds: 30, isActive: true });
    api.state.loaded = true;
    api.renderTaskTrigger({ id: 9, actualSeconds: 130 });

    now += 120_000;
    await api.handleAction('time-menu', 9, async () => {}, null, { id: 9, actualSeconds: 130 });

    assert.match(opened.html, /data-my-day-time-actual-base="250"/);
    assert.match(opened.html, />4:10<\/span>/, 'menu fact keeps the 120 seconds accumulated since the card snapshot');
});

test('My Day time menu explains an active timer on another task and keeps Start as the switch action', async () => {
    const opened = {};
    const { api } = loadTimeTrackingUi({
        fetch: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ success: true, timer: { taskId: 88, durationSeconds: 12, isActive: true } })
        }),
        taskUi: {
            openActionMenu: (_button, html) => {
                opened.html = html;
                return { querySelectorAll: () => [] };
            }
        }
    });

    await api.handleAction('time-menu', 9, async () => {}, null, { id: 9, effortMinutes: 30, actualSeconds: 0 });

    assert.match(opened.html, /Таймер працює для іншої задачі\. Старт перемкне його сюди\./);
    assert.match(opened.html, /data-my-day-time-menu-action="timer-start"/);
    assert.match(opened.html, />Старт<\/button>/);
});

test('cancelling manual time from the menu keeps it open and skips refresh', async () => {
    let menuHandler = null;
    let closeCount = 0;
    let changed = 0;
    const manualButton = {
        dataset: { myDayTimeMenuAction: 'time-entry' },
        disabled: false,
        isConnected: true,
        addEventListener: (_event, handler) => { menuHandler = handler; }
    };
    const { api } = loadTimeTrackingUi({
        window: { promptModal: async () => null },
        taskUi: {
            openActionMenu: () => ({ querySelectorAll: selector => selector === '[data-my-day-time-menu-action]' ? [manualButton] : [] }),
            closeActionMenu: () => { closeCount += 1; }
        }
    });

    await api.handleAction('time-menu', 9, async () => { changed += 1; }, null, { id: 9 });
    assert.equal(typeof menuHandler, 'function');
    await menuHandler({ preventDefault: () => {}, stopPropagation: () => {} });

    assert.equal(closeCount, 0);
    assert.equal(changed, 0);
    assert.equal(manualButton.disabled, false);
});

test('My Day time entries popover uses CRM surface and accessible edit delete labels', async () => {
    const opened = {};
    const fakeRoot = { querySelectorAll: () => [] };
    const { api } = loadTimeTrackingUi({
        taskUi: {
            openActionMenu: (button, html, options) => {
                opened.button = button;
                opened.html = html;
                opened.options = options;
                return fakeRoot;
            },
            closeActionMenu: () => {}
        },
        fetch: async (url) => {
            assert.match(String(url), /\/api\/my-day\/time-entries\?/);
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    entries: [
                        { id: 1, taskId: 9, startedAt: '2026-08-04T08:52:00.000Z', durationSeconds: 60, source: 'timer' },
                        { id: 2, taskId: 9, startedAt: '2026-08-04T09:40:00.000Z', durationSeconds: 720, source: 'manual' }
                    ]
                })
            };
        }
    });

    await api.handleAction('time-entries', 9, async () => {}, { id: 'entries-button' });

    assert.equal(opened.options.title, 'Записи часу');
    assert.equal(opened.options.surfaceClassName, 'my-day-time-popover');
    assert.match(opened.html, /my-day-time-entry-list/);
    assert.match(opened.html, /class="my-day-time-button my-day-time-button--ghost my-day-time-entry-action"/);
    assert.match(opened.html, /class="my-day-time-button my-day-time-button--danger my-day-time-entry-action"/);
    assert.match(opened.html, />Редагувати</);
    assert.match(opened.html, />Видалити</);
    assert.doesNotMatch(opened.html, />Ред\.</);
});
