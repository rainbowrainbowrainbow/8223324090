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

test('My Day UI keeps plan and fact separate and restores active timer', () => {
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-time-tracking.js'), 'utf8');
    assert.match(profile, /renderActiveTimerStrip/);
    assert.match(profile, /renderTaskControls/);
    assert.match(profile, /myDayTimeTracking\.load\(\)/);
    assert.match(profile, /myDayTimeTracking\.bind\?\.\(document\)/);
    assert.match(ui, /effortMinutes/);
    assert.match(ui, /actualSeconds/);
    assert.match(ui, /data-my-day-active-timer-elapsed/);
    assert.match(ui, /data-my-day-time-task-actual/);
    assert.match(ui, /timer-start/);
    assert.match(ui, /timer-stop/);
    assert.match(ui, /time-entries/);
    assert.match(ui, /data-my-day-time-edit/);
    assert.match(ui, /data-my-day-time-delete/);
    assert.match(ui, /aria-live/);
    assert.doesNotMatch(ui, /Рџ|Рќ|Рў|Р¤|Р—|вЂ/);
});

test('My Day time controls use CRM classes instead of raw browser-default buttons', () => {
    const ui = fs.readFileSync(path.join(root, 'js', 'my-day-time-tracking.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css', 'pages-profile.css'), 'utf8');
    const taskUi = fs.readFileSync(path.join(root, 'js', 'task-ui.js'), 'utf8');

    assert.match(ui, /my-day-active-timer/);
    assert.match(ui, /my-day-time-summary/);
    assert.match(ui, /my-day-time-actions/);
    assert.match(ui, /my-day-time-button--primary/);
    assert.match(ui, /my-day-time-button--stop/);
    assert.match(ui, /my-day-time-popover/);
    assert.match(ui, /my-day-time-disclosure/);
    assert.doesNotMatch(ui, /my-day-time-button--icon/);
    assert.match(ui, />Редагувати</);
    assert.match(ui, />Видалити</);
    assert.doesNotMatch(ui, />Ред\.</);
    assert.match(css, /\.my-day-time-button\s*\{/);
    assert.match(css, /\.my-day-time-disclosure\s*\{/);
    assert.match(css, /\.my-day-time-menu-popover\.is-popover \.task-ui-action-panel/);
    assert.match(css, /\.my-day-time-menu-popover\.is-sheet \.task-ui-action-panel/);
    assert.match(css, /body\.dark-mode \.profile-page\.profile-work-mode \.my-day-time-disclosure/);
    assert.match(css, /body\.dark-mode \.my-day-time-popover \.task-ui-action-panel/);
    assert.match(css, /\.my-day-time-button\.is-busy/);
    assert.doesNotMatch(css, /\.my-day-time-button--icon/);
    assert.match(css, /min-height:\s*40px/);
    assert.match(css, /\.my-day-time-actions\s*\{/);
    assert.match(css, /flex-wrap:\s*wrap/);
    assert.match(css, /\.my-day-time-popover\.is-popover \.task-ui-action-panel/);
    assert.match(css, /body\.dark-mode \.profile-page\.profile-work-mode \.my-day-active-timer/);
    assert.match(css, /html\[data-theme="dark"\] body \.profile-page\.profile-work-mode \.my-day-time-button--ghost/);
    assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.my-day-time-actions/);
    assert.match(taskUi, /event\.key === 'Escape'[\s\S]*closeActionMenu\(\)/);
    assert.match(taskUi, /data-task-ui-close/);
});
function loadTimeTrackingUi(overrides = {}) {
    const uiCode = fs.readFileSync(path.join(root, 'js', 'my-day-time-tracking.js'), 'utf8');
    const intervals = [];
    const cleared = [];
    const context = {
        console,
        Date,
        Intl,
        fetch: overrides.fetch || (async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })),
        setInterval: callback => { intervals.push(callback); return intervals.length; },
        clearInterval: id => { cleared.push(id); },
        document: overrides.document || { querySelector: () => null, querySelectorAll: () => [] },
        window: {
            TaskUI: { escapeHtml: value => String(value), ...(overrides.taskUi || {}) },
            getAuthHeaders: () => ({ Authorization: 'Bearer test-token' }),
            promptModal: async () => null,
            showNotification: () => {}
        }
    };
    vm.createContext(context);
    vm.runInContext(uiCode, context);
    return { api: context.window.MyDayTimeTracking, intervals, cleared, context };
}

test('My Day timer UI derives live elapsed seconds from client clock without duplicate intervals', () => {
    const { api, intervals, cleared } = loadTimeTrackingUi();
    const timer = api.normalizeTimer({ taskId: 41, durationSeconds: 30, isActive: true, task: { title: 'Live task' } });
    timer.clientSyncedAt = Date.now() - 65_000;
    api.state.timer = timer;

    assert.equal(api.secondsLabel(30), '0:00', 'settled summaries keep minute precision');
    assert.equal(api.liveSecondsLabel(30), '0:30', 'active timer shows seconds before the first minute');
    assert.equal(api.liveSecondsLabel(95), '1:35', 'active timer keeps seconds after one minute');
    assert.ok(api.currentTimerDurationSeconds() >= 95);
    assert.match(api.renderActiveTimerStrip(), /data-my-day-active-timer-elapsed[^>]*>1:3\d</, 'active timer strip renders seconds-precision elapsed time');
    assert.match(api.renderTaskControls({ id: 41, actualSeconds: 120 }), /data-my-day-time-task-actual="41"/);
    assert.match(api.renderTaskControls({ id: 41, actualSeconds: 30 }), />0:30<\/span>/, 'active task fact renders seconds while timer is running');

    assert.equal(api.syncTicker(true), true);
    assert.equal(api.syncTicker(true), true);
    assert.equal(intervals.length, 1, 'ticker starts only one interval');
    assert.equal(api.syncTicker(false), false);
    assert.deepEqual(cleared, [1], 'ticker clears the active interval');
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
