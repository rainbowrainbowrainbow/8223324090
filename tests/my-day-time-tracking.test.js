'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
    assert.match(ui, /План:/);
    assert.match(ui, /Факт:/);
    assert.match(ui, /timer-start/);
    assert.match(ui, /timer-stop/);
    assert.match(ui, /aria-live/);
});
