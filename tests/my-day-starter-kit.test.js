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

const STARTER_IMPACTS = ['Робота: Парк', 'Робота: CRM', 'Робота: Hermes', 'Операційка / процеси', 'Автоматизація / AI', 'Контент / медіа', 'Аналітика / рішення', 'Команда / делегування', 'Дохід і клієнти', 'Якість сервісу', 'Системність', 'Швидкість роботи', 'Здоровʼя', 'Фізична форма', 'Відновлення', 'Побут і комфорт', 'Навчання', 'Репутація / бренд', 'Ризики і безпека'];
const STARTER_HABITS = ['Ранкова зарядка', 'Планування дня', 'Відновлення без екранів', 'Навчання 20 хв', 'Побутовий порядок'];

function makeFakeDb(initial = {}) {
    const state = {
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
            if (/FROM my_day_impacts/.test(sql)) {
                const canonical = findByName(state.impacts, params[0], params[1]);
                const legacyKeys = new Set(params[2] || []);
                const legacy = state.impacts.find(row => Number(row.user_id) === Number(params[0]) && legacyKeys.has(normalizeNameKey(row.name)));
                return { rows: canonical ? [canonical] : (legacy ? [legacy] : []) };
            }
            if (/UPDATE my_day_impacts/.test(sql)) {
                const row = state.impacts.find(item => Number(item.id) === Number(params[0]) && Number(item.user_id) === Number(params[1]));
                if (!row) return { rows: [] };
                row.name = params[2];
                return { rows: [{ id: row.id, name: row.name, is_active: row.is_active }] };
            }
            if (/INSERT INTO my_day_impacts/.test(sql)) {
                const row = insertCatalog(state.impacts, params);
                return { rows: [{ id: row.id, name: row.name, is_active: row.is_active }] };
            }
            if (/FROM my_day_habits/.test(sql)) return { rows: findByName(state.habits, params[0], params[1]) ? [findByName(state.habits, params[0], params[1])] : [] };
            if (/INSERT INTO my_day_habits\s/.test(sql)) {
                const [userId, name, color, icon, metric, targetValue, cadence, selectedWeekdays, timesPerWeek, sortOrder] = params;
                const row = {
                    id: state.nextId++,
                    user_id: userId,
                    name,
                    color,
                    icon,
                    direction_id: null,
                    metric,
                    target_value: targetValue,
                    cadence,
                    selected_weekdays: selectedWeekdays,
                    times_per_week: timesPerWeek,
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
    assert.equal(Object.hasOwn(publicStarterKit(), 'directions'), false);
    assert.deepEqual(publicStarterKit().impacts, STARTER_IMPACTS);
    assert.deepEqual(publicStarterKit().habits.map(habit => habit.name), STARTER_HABITS);
    assert.equal(STARTER_KIT.habits[0].metric, 'minutes');
    assert.equal(STARTER_KIT.habits[0].targetValue, 10);
    assert.equal(STARTER_KIT.habits[1].metric, 'boolean');
    assert.equal(STARTER_KIT.habits[1].targetValue, 1);
    assert.equal(STARTER_KIT.habits[2].cadence, 'daily');
    assert.equal(STARTER_KIT.habits[3].name, 'Навчання 20 хв');
    assert.equal(STARTER_KIT.habits[3].cadence, 'selected_weekdays');
    assert.deepEqual(STARTER_KIT.habits[3].selectedWeekdays, [1, 2, 3, 4, 5]);
    assert.equal(STARTER_KIT.habits[4].name, 'Побутовий порядок');
    assert.equal(STARTER_KIT.habits[4].cadence, 'times_per_week');
    assert.equal(STARTER_KIT.habits[4].timesPerWeek, 3);
    assert.deepEqual(publicStarterKit().habits[3].selectedWeekdays, [1, 2, 3, 4, 5]);
    assert.equal(publicStarterKit().habits[4].timesPerWeek, 3);
    assert.equal(normalizeNameKey('Здоровʼя'), normalizeNameKey("Здоров'я"));
});

test('starter kit creates only caller-scoped taxonomy and habits once', async () => {
    const fake = makeFakeDb();
    const first = await applyMyDayStarterKit(fake, 42);
    assert.deepEqual(first.created, { impacts: 19, habits: 5 });
    assert.deepEqual(first.skipped, { impacts: 0, habits: 0 });
    assert.equal(fake.state.impacts.every(row => row.user_id === 42), true);
    assert.equal(fake.state.habits.every(row => row.user_id === 42), true);
    assert.equal(fake.state.habitImpacts.every(row => row.user_id === 42), true);
    assert.equal(fake.state.habits.every(row => row.direction_id === null), true);
    const weekdayHabit = fake.state.habits.find(row => row.name === 'Навчання 20 хв');
    const weeklyHabit = fake.state.habits.find(row => row.name === 'Побутовий порядок');
    assert.deepEqual(weekdayHabit.selected_weekdays, [1, 2, 3, 4, 5]);
    assert.equal(weekdayHabit.times_per_week, null);
    assert.deepEqual(weeklyHabit.selected_weekdays, []);
    assert.equal(weeklyHabit.times_per_week, 3);

    const second = await applyMyDayStarterKit(fake, 42);
    assert.deepEqual(second.created, { impacts: 0, habits: 0 });
    assert.deepEqual(second.skipped, { impacts: 19, habits: 5 });
    assert.equal(fake.state.impacts.length, 19);
    assert.equal(fake.state.habits.length, 5);
});

test('starter kit does not overwrite existing caller values or archive state', async () => {
    const fake = makeFakeDb({
        impacts: [{ id: 8, user_id: 5, name: 'Навчання', color: '#111111', icon: 'Y', sort_order: 888, is_active: false }]
    });
    await applyMyDayStarterKit(fake, 5);
    const existingImpact = fake.state.impacts.find(row => row.id === 8);
    assert.equal(existingImpact.color, '#111111');
    assert.equal(existingImpact.icon, 'Y');
    assert.equal(existingImpact.sort_order, 888);
    assert.equal(existingImpact.is_active, false);
});

test('starter kit safely normalizes the exact legacy team impact name without changing its values', async () => {
    const fake = makeFakeDb({
        impacts: [{ id: 9, user_id: 5, name: 'Команда і делегування', color: '#123456', icon: '🤝', sort_order: 777, is_active: false }]
    });
    const result = await applyMyDayStarterKit(fake, 5);
    const normalized = fake.state.impacts.find(row => row.id === 9);
    assert.equal(normalized.name, 'Команда / делегування');
    assert.equal(normalized.color, '#123456');
    assert.equal(normalized.icon, '🤝');
    assert.equal(normalized.sort_order, 777);
    assert.equal(normalized.is_active, false);
    assert.equal(result.details.impacts.items.find(item => item.id === 9).normalizedFrom, 'Команда і делегування');
    assert.equal(fake.state.impacts.some(row => row.name === 'Команда і делегування'), false);
});


test('starter kit keeps existing caller habits unchanged', async () => {
    const fake = makeFakeDb({
        habits: [{
            id: 44,
            user_id: 5,
            name: 'Планування дня',
            color: '#000000',
            icon: 'X',
            direction_id: 999,
            metric: 'count',
            target_value: 99,
            cadence: 'times_per_week',
            selected_weekdays: [],
            times_per_week: 7,
            is_paused: true,
            is_archived: true,
            sort_order: 444
        }]
    });
    await applyMyDayStarterKit(fake, 5);
    const existingHabit = fake.state.habits.find(row => row.id === 44);
    assert.equal(existingHabit.color, '#000000');
    assert.equal(existingHabit.icon, 'X');
    assert.equal(existingHabit.direction_id, 999);
    assert.equal(existingHabit.metric, 'count');
    assert.equal(existingHabit.target_value, 99);
    assert.equal(existingHabit.cadence, 'times_per_week');
    assert.equal(existingHabit.times_per_week, 7);
    assert.equal(existingHabit.is_paused, true);
    assert.equal(existingHabit.is_archived, true);
    assert.equal(existingHabit.sort_order, 444);
});

test('starter kit idempotency is isolated per user', async () => {
    const fake = makeFakeDb({
        impacts: [{ id: 78, user_id: 99, name: 'Системність', color: '#000000', icon: 'Y', sort_order: 1, is_active: true }],
        habits: [{ id: 79, user_id: 99, name: 'Планування дня', color: '#000000', icon: 'Z', direction_id: 77, metric: 'boolean', target_value: 1, cadence: 'daily', selected_weekdays: [], times_per_week: null, is_paused: false, is_archived: false, sort_order: 1 }]
    });
    const result = await applyMyDayStarterKit(fake, 5);
    assert.deepEqual(result.created, { impacts: 19, habits: 5 });
    assert.equal(fake.state.impacts.filter(row => row.user_id === 99).length, 1);
    assert.equal(fake.state.habits.filter(row => row.user_id === 99).length, 1);
    assert.equal(fake.state.impacts.filter(row => row.user_id === 5).length, 19);
    assert.equal(fake.state.habits.filter(row => row.user_id === 5).length, 5);
});

test('starter kit route is authenticated, transactional, and not arbitrary-user writable', () => {
    const route = read('routes/my-day.js');
    assert.match(route, /router\.use\(authenticateToken\)/);
    assert.match(route, /router\.post\('\/starter-kit'/);
    assert.match(route, /withMyDayTransaction\(client => applyMyDayStarterKit\(client, currentUserId\(req\)\)\)/);
    assert.match(route, /catch \(error\) \{ try \{ await client\.query\('ROLLBACK'\); \} catch \{\} throw error; \}/);
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
    assert.doesNotMatch(habitsUi, /STARTER_KIT_PREVIEW[\s\S]{0,600}directions/);
    STARTER_IMPACTS.forEach(label => assert.ok(habitsUi.includes(label), 'missing impact preview: ' + label));
    STARTER_HABITS.forEach(label => assert.ok(habitsUi.includes(label), 'missing habit preview: ' + label));
    assert.ok(habitsUi.includes('20 хв Пн-Пт'));
    assert.ok(habitsUi.includes('3 рази/тиждень'));
    assert.ok(habitsUi.includes('ручний персональний starter kit'));
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
    assert.ok(spec.includes('impacts-only starter kit'));
    STARTER_IMPACTS.forEach(label => assert.ok(spec.includes(label), 'missing spec impact: ' + label));
    STARTER_HABITS.forEach(label => assert.ok(spec.includes(label), 'missing spec habit: ' + label));
    assert.ok(spec.includes('weekdays Monday-Friday'));
    assert.ok(spec.includes('weekly'));
    assert.ok(spec.includes('habit metric/cadence details'));
});
