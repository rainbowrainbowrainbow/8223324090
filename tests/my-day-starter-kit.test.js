'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
    STARTER_KIT,
    applyMyDayStarterKit,
    normalizeNameKey,
    publicStarterKit,
    syncMyDayImpactCatalog
} = require('../services/myDayStarterKit');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const STARTER_IMPACTS = [
    'Робота: Парк', 'Робота: CRM', 'Робота: Hermes',
    'Операційка / процеси', 'Автоматизація / AI', 'Продукт / розробка', 'Аналітика / рішення',
    'Контент / медіа', 'Маркетинг / залучення', 'Команда / делегування', 'Стратегія / пріоритети',
    'Люди / HR', 'Документи / право', 'Закупівлі / постачання', 'Партнерства / нетворкінг',
    'Продажі / клієнти', 'Фінанси / облік', 'Якість сервісу', 'Системність',
    'Швидкість / ефективність', 'Бренд / репутація', 'Ризики / безпека',
    'Здоровʼя', 'Фізична форма', 'Відновлення', 'Побут / комфорт', 'Навчання / розвиток', 'Близькі / стосунки',
    'Творчість / самовираження', 'Подорожі / враження', 'Спільнота / внесок', 'Баланс / сенси'
];
const STARTER_HABITS = ['Ранкова зарядка', 'Планування дня', 'Відновлення без екранів', 'Навчання 20 хв', 'Побутовий порядок'];

function makeFakeDb(initial = {}) {
    const state = {
        impacts: (initial.impacts || []).map(row => ({ ...row })),
        habits: (initial.habits || []).map(row => ({ ...row })),
        taskImpacts: (initial.taskImpacts || []).map(row => ({ ...row })),
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
            if (/FROM my_day_impacts i/.test(sql)) {
                const matchNames = new Set((params[1] || []).map(normalizeNameKey));
                const rows = state.impacts
                    .filter(row => Number(row.user_id) === Number(params[0]) && matchNames.has(normalizeNameKey(row.name)))
                    .map(row => ({
                        ...row,
                        reference_count: state.taskImpacts.filter(link => Number(link.user_id) === Number(row.user_id) && Number(link.impact_id) === Number(row.id)).length
                            + state.habitImpacts.filter(link => Number(link.user_id) === Number(row.user_id) && Number(link.impact_id) === Number(row.id)).length
                    }));
                return { rows };
            }
            if (/UPDATE my_day_impacts/.test(sql)) {
                const row = state.impacts.find(item => Number(item.id) === Number(params[0]) && Number(item.user_id) === Number(params[1]));
                if (!row) return { rows: [] };
                row.name = params[2];
                if (/color = \$4/.test(sql)) {
                    row.color = params[3];
                    row.icon = params[4];
                    row.sort_order = params[5];
                }
                if (/is_active = FALSE/.test(sql)) row.is_active = false;
                return { rows: [{ id: row.id, name: row.name, color: row.color, icon: row.icon, sort_order: row.sort_order, is_active: row.is_active }] };
            }
            if (/INSERT INTO my_day_impacts/.test(sql)) {
                const row = insertCatalog(state.impacts, params);
                return { rows: [{ id: row.id, name: row.name, is_active: row.is_active }] };
            }
            if (/INSERT INTO my_day_task_impacts/.test(sql) && /SELECT user_id, task_id/.test(sql)) {
                const [userId, duplicateId, targetId] = params;
                for (const link of state.taskImpacts.filter(item => Number(item.user_id) === Number(userId) && Number(item.impact_id) === Number(duplicateId))) {
                    const exists = state.taskImpacts.some(item => Number(item.user_id) === Number(userId) && Number(item.task_id) === Number(link.task_id) && Number(item.impact_id) === Number(targetId));
                    if (!exists) state.taskImpacts.push({ ...link, impact_id: targetId });
                }
                return { rows: [] };
            }
            if (/INSERT INTO my_day_habit_impacts/.test(sql) && /SELECT habit_id, user_id/.test(sql)) {
                const [userId, duplicateId, targetId] = params;
                for (const link of state.habitImpacts.filter(item => Number(item.user_id) === Number(userId) && Number(item.impact_id) === Number(duplicateId))) {
                    const exists = state.habitImpacts.some(item => Number(item.habit_id) === Number(link.habit_id) && Number(item.impact_id) === Number(targetId));
                    if (!exists) state.habitImpacts.push({ ...link, impact_id: targetId });
                }
                return { rows: [] };
            }
            if (/DELETE FROM my_day_task_impacts/.test(sql)) {
                state.taskImpacts = state.taskImpacts.filter(item => Number(item.user_id) !== Number(params[0]) || Number(item.impact_id) !== Number(params[1]));
                return { rows: [] };
            }
            if (/DELETE FROM my_day_habit_impacts/.test(sql)) {
                state.habitImpacts = state.habitImpacts.filter(item => Number(item.user_id) !== Number(params[0]) || Number(item.impact_id) !== Number(params[1]));
                return { rows: [] };
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
    assert.deepEqual(first.created, { impacts: 32, habits: 5 });
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
    assert.deepEqual(second.skipped, { impacts: 32, habits: 5 });
    assert.equal(fake.state.impacts.length, 32);
    assert.equal(fake.state.habits.length, 5);
});

test('AI catalog sync adds and normalizes canonical impacts without creating habits', async () => {
    const fake = makeFakeDb({
        impacts: [{ id: 8, user_id: 42, name: 'CRM', color: '#111111', icon: '🗂️', sort_order: 888, is_active: true }]
    });

    const first = await syncMyDayImpactCatalog(fake, 42);
    assert.equal(first.created, 31);
    assert.equal(first.skipped, 1);
    assert.equal(fake.state.impacts.length, 32);
    assert.equal(fake.state.habits.length, 0);
    assert.equal(fake.state.impacts.find(row => row.id === 8).icon, 'crm');
    assert.equal(fake.state.impacts.every(row => typeof row.icon === 'string' && row.icon.length > 1), true);

    const second = await syncMyDayImpactCatalog(fake, 42);
    assert.equal(second.created, 0);
    assert.equal(second.skipped, 32);
    assert.equal(fake.state.impacts.length, 32);
    assert.equal(fake.state.habits.length, 0);
});

test('canonical impact catalog and browser SVG registry stay in exact icon parity', () => {
    const sandbox = { window: {} };
    vm.runInNewContext(read('js/my-day-impact-icons.js'), sandbox, { filename: 'js/my-day-impact-icons.js' });
    const registry = sandbox.window.MyDayImpactIcons;
    const choices = new Set(registry.choices());

    STARTER_KIT.impacts.forEach(impact => {
        assert.equal(registry.metaFor(impact).icon, impact.icon, `wrong icon mapping for ${impact.name}`);
        assert.equal(choices.has(impact.icon), true, `missing SVG icon choice: ${impact.icon}`);
        assert.match(registry.render(impact), new RegExp(`data-my-day-impact-icon="${impact.icon}"`));
    });
});

test('AI impact catalog loader commits sync before returning the catalog and always releases', () => {
    const source = read('services/myDayAiImpactCatalog.js');
    const begin = source.indexOf("client.query('BEGIN')");
    const sync = source.indexOf('syncMyDayImpactCatalog(client, userId)');
    const list = source.indexOf("listTaxonomy(client, userId, 'impacts')");
    const commit = source.indexOf("client.query('COMMIT')");
    assert.ok(begin >= 0 && begin < sync && sync < list && list < commit);
    assert.match(source, /client\.query\('ROLLBACK'\)/);
    assert.match(source, /finally \{[\s\S]*client\.release\(\)/);
});

test('starter kit normalizes canonical metadata but preserves existing archive state', async () => {
    const fake = makeFakeDb({
        impacts: [{ id: 8, user_id: 5, name: 'Навчання', color: '#111111', icon: 'Y', sort_order: 888, is_active: false }]
    });
    await applyMyDayStarterKit(fake, 5);
    const existingImpact = fake.state.impacts.find(row => row.id === 8);
    assert.equal(existingImpact.color, '#3B82F6');
    assert.equal(existingImpact.icon, 'learning');
    assert.equal(existingImpact.sort_order, 350);
    assert.equal(existingImpact.is_active, false);
});

test('starter kit safely normalizes the exact legacy team impact name and canonical metadata', async () => {
    const fake = makeFakeDb({
        impacts: [{ id: 9, user_id: 5, name: 'Команда і делегування', color: '#123456', icon: '🤝', sort_order: 777, is_active: false }]
    });
    const result = await applyMyDayStarterKit(fake, 5);
    const normalized = fake.state.impacts.find(row => row.id === 9);
    assert.equal(normalized.name, 'Команда / делегування');
    assert.equal(normalized.color, '#06B6D4');
    assert.equal(normalized.icon, 'team');
    assert.equal(normalized.sort_order, 170);
    assert.equal(normalized.is_active, false);
    assert.equal(result.details.impacts.items.find(item => item.id === 9).normalizedFrom, 'Команда і делегування');
    assert.equal(fake.state.impacts.some(row => row.name === 'Команда і делегування'), false);
});

test('starter kit merges apostrophe-normalized health duplicates and preserves all task and habit links', async () => {
    const fake = makeFakeDb({
        impacts: [
            { id: 13, user_id: 5, name: "Здоров'я", color: '#111111', icon: 'H1', sort_order: 40, is_active: true },
            { id: 26, user_id: 5, name: 'Здоровʼя', color: '#222222', icon: 'H2', sort_order: 50, is_active: true }
        ],
        taskImpacts: [
            { user_id: 5, task_id: 101, impact_id: 13 },
            { user_id: 5, task_id: 102, impact_id: 26 }
        ],
        habitImpacts: [
            { user_id: 5, habit_id: 201, impact_id: 13 },
            { user_id: 5, habit_id: 202, impact_id: 26 }
        ]
    });

    const result = await applyMyDayStarterKit(fake, 5);
    const canonical = fake.state.impacts.find(row => row.id === 13);
    const duplicate = fake.state.impacts.find(row => row.id === 26);
    assert.equal(canonical.name, 'Здоровʼя');
    assert.equal(canonical.icon, 'health');
    assert.equal(canonical.sort_order, 310);
    assert.equal(duplicate.is_active, false);
    assert.match(duplicate.name, /merged #26/);
    assert.deepEqual(fake.state.taskImpacts.map(link => [link.task_id, link.impact_id]).sort(), [[101, 13], [102, 13]]);
    assert.deepEqual(fake.state.habitImpacts
        .filter(link => [201, 202].includes(Number(link.habit_id)))
        .map(link => [link.habit_id, link.impact_id])
        .sort(), [[201, 13], [202, 13]]);
    const healthOutcome = result.details.impacts.items.find(item => item.id === 13);
    assert.deepEqual(healthOutcome.mergedIds, [26]);
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
    assert.deepEqual(result.created, { impacts: 32, habits: 5 });
    assert.equal(fake.state.impacts.filter(row => row.user_id === 99).length, 1);
    assert.equal(fake.state.habits.filter(row => row.user_id === 99).length, 1);
    assert.equal(fake.state.impacts.filter(row => row.user_id === 5).length, 32);
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
