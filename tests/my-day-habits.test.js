'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const habits = require('../services/myDayHabits');

const root = path.resolve(__dirname, '..');

test('habit payload validates all metrics, all cadences, weekdays, and max impacts', () => {
    assert.equal(habits.normalizeHabitPayload({ name: 'Stretch', metric: 'boolean', cadence: 'daily', targetValue: 1 }).metric, 'boolean');
    assert.deepEqual(habits.normalizeHabitPayload({ name: 'Pushups', metric: 'count', targetValue: 20, cadence: 'selected_weekdays', selectedWeekdays: [1, 3, 7] }).selectedWeekdays, [1, 3, 7]);
    assert.equal(habits.normalizeHabitPayload({ name: 'Walk', metric: 'minutes', targetValue: 30, cadence: 'times_per_week', timesPerWeek: 4 }).timesPerWeek, 4);
    assert.throws(() => habits.normalizeHabitPayload({ name: 'Bad', metric: 'boolean', targetValue: 2 }), { code: 'MY_DAY_HABIT_VALIDATION' });
    assert.throws(() => habits.normalizeHabitPayload({ name: 'Bad', cadence: 'selected_weekdays', selectedWeekdays: [1, 1] }), { code: 'MY_DAY_HABIT_VALIDATION' });
    assert.throws(() => habits.normalizeHabitPayload({ name: 'Bad', impactIds: [1, 2, 3, 4] }), { code: 'MY_DAY_IMPACT_LIMIT_EXCEEDED' });
    assert.equal(Object.hasOwn(habits.normalizeHabitPayload({ name: 'Legacy', directionId: 99 }), 'directionId'), false);
});

test('habit cadence due logic uses ISO Monday-Sunday and pauses/archive are not expected work', () => {
    const selected = { cadence: 'selected_weekdays', selected_weekdays: [1, 7], is_paused: false, is_archived: false };
    assert.equal(habits.isoWeekday('2026-08-03'), 1);
    assert.equal(habits.isoWeekday('2026-08-09'), 7);
    assert.equal(habits.isHabitDue(selected, '2026-08-03'), true);
    assert.equal(habits.isHabitDue(selected, '2026-08-04'), false);
    assert.equal(habits.isHabitDue({ cadence: 'daily', is_paused: true, is_archived: false }, '2026-08-03'), false);
    assert.equal(habits.isHabitDue({ cadence: 'times_per_week', is_paused: false, is_archived: true }, '2026-08-03'), false);
    assert.deepEqual(habits.weekRange('2026-08-09'), { from: '2026-08-03', to: '2026-08-09' });
});

test('check-in upsert is idempotent and count/minutes completion is threshold-based', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('FROM my_day_habits h')) {
                return { rows: [{ id: 5, user_id: 9, name: 'Read', metric: 'count', target_value: 10, cadence: 'daily', selected_weekdays: [], times_per_week: null, is_paused: false, is_archived: false, impact_ids: [] }] };
            }
            if (sql.includes('INSERT INTO my_day_habit_checkins')) {
                return { rows: [{ id: 22, habit_id: 5, user_id: 9, local_date: '2026-08-03', state: params[3], value: params[4] }] };
            }
            return { rows: [] };
        }
    };
    const partial = await habits.upsertCheckin(queryable, 9, 5, '2026-08-03', { state: 'done', value: 4 });
    assert.equal(partial.state, 'done');
    assert.equal(partial.completed, false);
    const complete = await habits.upsertCheckin(queryable, 9, 5, '2026-08-03', { state: 'done', value: 10 });
    assert.equal(complete.completed, true);
    assert.match(calls[1].sql, /ON CONFLICT \(habit_id, user_id, local_date\)/);
    assert.equal(calls.filter(call => /INSERT INTO my_day_habit_checkins/.test(call.sql)).length, 2);
});

test('skip, undo route, archive restore, and history retention contracts are explicit', () => {
    const route = fs.readFileSync(path.join(root, 'routes', 'my-day-habits.js'), 'utf8');
    const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '315_my_day_habits.sql'), 'utf8');
    assert.match(route, /router\.get\('\/'/);
    assert.match(route, /router\.post\('\/'/);
    assert.match(route, /router\.patch\('\/:id'/);
    assert.match(route, /router\.put\('\/:habitId\/check-ins\/:localDate'/);
    assert.match(route, /router\.delete\('\/:habitId\/check-ins\/:localDate'/);
    assert.match(route, /includeArchived/);
    for (const table of ['my_day_habits', 'my_day_habit_impacts', 'my_day_habit_checkins']) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(migration, /UNIQUE \(habit_id, user_id, local_date\)/);
    assert.match(migration, /FOREIGN KEY \(habit_id, user_id\) REFERENCES my_day_habits\(id, user_id\) ON DELETE CASCADE/);
    assert.doesNotMatch(route, /DELETE FROM my_day_habits/);
});

test('habit service is private to taxonomy and does not create tasks, dependencies, overdue, or task time', () => {
    const service = fs.readFileSync(path.join(root, 'services', 'myDayHabits.js'), 'utf8');
    assert.match(service, /my_day_directions/);
    assert.match(service, /my_day_impacts/);
    assert.match(service, /normalizeImpactIds/);
    assert.doesNotMatch(service, /INSERT INTO my_day_habits[\s\S]{0,220}direction_id/);
    assert.doesNotMatch(service, /SET name = \$3,[\s\S]{0,220}direction_id =/);
    assert.doesNotMatch(service, /my_day_time_entries/);
    assert.doesNotMatch(service, /task_dependencies/);
    assert.doesNotMatch(service, /INSERT INTO tasks|UPDATE tasks|overdue|recurring/i);
});

test('profile UI exposes Day and Habits modes, settings, ARIA, skip undo, and compact time entry manager', () => {
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const habitsUi = fs.readFileSync(path.join(root, 'js', 'my-day-habits.js'), 'utf8');
    const timeUi = fs.readFileSync(path.join(root, 'js', 'my-day-time-tracking.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'profile.html'), 'utf8');
    const profileCss = fs.readFileSync(path.join(root, 'css', 'pages-profile.css'), 'utf8');
    assert.match(profile, /MyDayHabits/);
    assert.match(habitsUi, /role="tablist"/);
    assert.match(habitsUi, /data-my-day-habit-skip/);
    assert.match(habitsUi, /data-my-day-habit-undo/);
    assert.match(habitsUi, /aria-busy/);
    assert.match(habitsUi, /loadSettings/);
    assert.match(timeUi, /data-cabinet-task-action="time-menu"/);
    assert.match(timeUi, /data-my-day-time-menu-action="time-entries"/);
    assert.match(timeUi, /data-my-day-time-edit/);
    assert.match(timeUi, /data-my-day-time-delete/);
    assert.match(html, /js\/my-day-habits\.js/);
    assert.match(profileCss, /my-day-life-tabs/);
});
