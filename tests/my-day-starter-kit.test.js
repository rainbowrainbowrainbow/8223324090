'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    STARTER_KIT,
    applyMyDayStarterKit,
    normalizeNameKey,
    publicStarterKit
} = require('../services/myDayStarterKit');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const STARTER_DIRECTIONS = ['EventGenix CRM', 'Парк Закревського', 'Дженікс / події', 'Особисте життя'];
const STARTER_IMPACTS = ['Дохід і клієнти', 'Якість сервісу', 'Системність', "Здоров'я", 'Фізична форма', 'Відновлення', 'Побут і комфорт', 'Навчання'];
const STARTER_HABITS = ['Ранкова зарядка', 'Планування дня', 'Відновлення без екранів'];

function makeFakeDb(initial = {}) {
    const state = {
        directions: (initial.directions || []).map(row => ({ ...row })),
        impacts: (initial.impacts || []).map(row => ({ ...row })),
        habits: (initial.habits || []).map(row => ({ ...row })),
        habitImpacts: (initial.habitImpacts || []).map(row => ({ ...row })),
        calls: [],
        nextId: 100
    };

    const findByName = (rows, userId, name) => rows.find(row => Number(row.user_id) === Number(userId) && normalizeNameKey(row.name) === normalizeNameKey(name));
    const insertCatalog = (rows, params) => {
        const [userId, name, color, icon, sortOrder] = params;
        const row = { id: state.nextId++, user_id: userId, name, color, icon, sort_order: sortOrder, is_active: true };
        rows.push(row);
        return row;
    };

    return {
        state,
        async query(sql, params = []) {
            state.calls.push({ sql, params });
            if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
            if (/FROM my_day_directions/.test(sql)) return { rows: findByName(state.directions, params[0], params[1]) ? [findByName(state.directions, params[0], params[1])] : [] };
            if (/INSERT INTO my_day_directions/.test(sql)) {
                const row = insertCatalog(state.directions, params);
                return { rows: [{ id: row.id, name: row.name, is_active: row.is_active }] };
            }
            if (/FROM my_day_impacts/.test(sql)) return { rows: findByName(state.impacts, params[0], params[1]) ? [findByName(state.impacts, params[0], params[1])] : [] };
            if (/INSERT INTO my_day_impacts/.test(sql)) {
                const row = insertCatalog(state.impacts, params);
                return { rows: [{ id: row.id, name: row.name, is_active: row.is_active }] };
            }
            if (/FROM my_day_habits/.test(sql)) return { rows: findByName(state.habits, params[0], params[1]) ? [findByName(state.habits, params[0], params[1])] : [] };
            if (/INSERT INTO my_day_habits\s/.test(sql)) {
                const [userId, name, color, icon, directionId, metric, targetValue, cadence, sortOrder] = params;
                const row = {
                    id: state.nextId++,
                    user_id: userId,
                    name,
                    color,
                    icon,
                    direction_id: directionId,
                    metric,
                    target_value: targetValue,
                    cadence,
                    selected_weekdays: [],
                    times_per_week: null,
                    is_paused: false,
                    is_archived: false,
                    sort_order: sortOrder
                };
                state.habits.push(row);
                return { rows: [{ id: row.id, name: row.name }] };
            }
            if (/INSERT INTO my_day_habit_impacts/.test(sql)) {
                const [habitId, userId, impactIds] = params;
                for (const impactId of impactIds) state.habitImpacts.push({ habit_id: habitId, user_id: userId, impact_id: impactId });
                return { rows: [] };
            }
            throw new Error('Unexpected SQL in fake starter kit DB: ' + sql);
        }
    };
}

test('starter kit exposes the exact canonical caller-owned payload', () => {
    assert.deepEqual(publicStarterKit().directions, STARTER_DIRECTIONS);
    assert.deepEqual(publicStarterKit().impacts, STARTER_IMPACTS);
    assert.deepEqual(publicStarterKit().habits.map(habit => habit.name), STARTER_HABITS);
    assert.equal(STARTER_KIT.habits[0].metric, 'minutes');
    assert.equal(STARTER_KIT.habits[0].targetValue, 10);
    assert.equal(STARTER_KIT.habits[1].metric, 'boolean');
    assert.equal(STARTER_KIT.habits[1].targetValue, 1);
    assert.equal(STARTER_KIT.habits[2].cadence, 'daily');
});

test('starter kit creates only caller-scoped taxonomy and habits once', async () => {
    const fake = makeFakeDb();
    const first = await applyMyDayStarterKit(fake, 42);
    assert.deepEqual(first.created, { directions: 4, impacts: 8, habits: 3 });
    assert.deepEqual(first.skipped, { directions: 0, impacts: 0, habits: 0 });
    assert.equal(fake.state.directions.every(row => row.user_id === 42), true);
    assert.equal(fake.state.impacts.every(row => row.user_id === 42), true);
    assert.equal(fake.state.habits.every(row => row.user_id === 42), true);
    assert.equal(fake.state.habitImpacts.every(row => row.user_id === 42), true);

    const second = await applyMyDayStarterKit(fake, 42);
    assert.deepEqual(second.created, { directions: 0, impacts: 0, habits: 0 });
    assert.deepEqual(second.skipped, { directions: 4, impacts: 8, habits: 3 });
    assert.equal(fake.state.directions.length, 4);
    assert.equal(fake.state.impacts.length, 8);
    assert.equal(fake.state.habits.length, 3);
});

test('starter kit does not overwrite existing caller values or archive state', async () => {
    const fake = makeFakeDb({
        directions: [{ id: 7, user_id: 5, name: 'EventGenix CRM', color: '#000000', icon: 'X', sort_order: 777, is_active: true }],
        impacts: [{ id: 8, user_id: 5, name: 'Навчання', color: '#111111', icon: 'Y', sort_order: 888, is_active: false }]
    });
    await applyMyDayStarterKit(fake, 5);
    const existingDirection = fake.state.directions.find(row => row.id === 7);
    const existingImpact = fake.state.impacts.find(row => row.id === 8);
    assert.equal(existingDirection.color, '#000000');
    assert.equal(existingDirection.icon, 'X');
    assert.equal(existingDirection.sort_order, 777);
    assert.equal(existingDirection.is_active, true);
    assert.equal(existingImpact.color, '#111111');
    assert.equal(existingImpact.icon, 'Y');
    assert.equal(existingImpact.sort_order, 888);
    assert.equal(existingImpact.is_active, false);
});

test('starter kit route is authenticated, transactional, and not arbitrary-user writable', () => {
    const route = read('routes/my-day.js');
    assert.match(route, /router\.use\(authenticateToken\)/);
    assert.match(route, /router\.post\('\/starter-kit'/);
    assert.match(route, /withMyDayTransaction\(client => applyMyDayStarterKit\(client, currentUserId\(req\)\)\)/);
    assert.doesNotMatch(route, /starter-kit[\s\S]{0,400}req\.body\.userId/);
});

test('starter kit service has no hidden production seed or task/time/check-in writes', () => {
    const service = read('services/myDayStarterKit.js');
    assert.match(service, /pg_advisory_xact_lock/);
    assert.match(service, /FOR UPDATE/);
    assert.doesNotMatch(service, /INSERT INTO tasks|UPDATE tasks|task_dependencies|my_day_time_entries|my_day_habit_checkins|overdue|recurring/i);
    assert.doesNotMatch(service, /process\.env|BOOTSTRAP|ALLOW_DEV_USER_SEED|setInterval|startup/i);
});

test('starter kit UI is explicit, reloads canonical state, and has empty/non-empty surfaces', () => {
    const habitsUi = read('js/my-day-habits.js');
    const css = read('css/pages-profile.css');
    const spec = read('docs/MY_DAY_LIFE_SYSTEM_SPEC.md');
    assert.match(habitsUi, /STARTER_KIT_PREVIEW/);
    assert.ok(habitsUi.includes('Почати з базового набору'));
    assert.ok(habitsUi.includes('Додати базовий набір'));
    assert.ok(habitsUi.includes('Застосувати базовий набір'));
    assert.match(habitsUi, /fetch\('\/api\/my-day\/starter-kit'/);
    assert.match(habitsUi, /method: 'POST'/);
    assert.match(habitsUi, /data-my-day-apply-starter-kit/);
    assert.match(habitsUi, /state\.starterKit\.loading/);
    assert.match(habitsUi, /button\.disabled = true/);
    assert.match(habitsUi, /window\.MyDayClassification\?\.load\?\.\(true\)/);
    assert.match(habitsUi, /loadSettings\(true\)/);
    assert.match(habitsUi, /renderStarterKitCard\(\)/);
    assert.match(css, /\.my-day-starter-card/);
    assert.match(css, /html\[data-theme="dark"\] body \.profile-page\.profile-work-mode \.my-day-starter-card/);
    assert.match(css, /\.my-day-starter-preview/);
    assert.ok(spec.includes('Manual starter kit'));
    assert.ok(spec.includes('POST /api/my-day/starter-kit'));
});