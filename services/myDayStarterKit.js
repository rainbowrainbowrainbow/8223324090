'use strict';

const { myDayError } = require('./myDayTaxonomy');
const { positiveInteger } = require('./myDayHabits');

const STARTER_DIRECTIONS = Object.freeze([
    {
        name: "EventGenix CRM",
        color: "#2563EB",
        icon: "💼",
        sortOrder: 10
    },
    {
        name: "Парк Закревського",
        color: "#10B981",
        icon: "🌳",
        sortOrder: 20
    },
    {
        name: "Дженікс / події",
        color: "#F59E0B",
        icon: "🎉",
        sortOrder: 30
    },
    {
        name: "Особисте життя",
        color: "#8B5CF6",
        icon: "🏠",
        sortOrder: 40
    },
    {
        name: "Побут / комфорт",
        color: "#A855F7",
        icon: "🛋️",
        sortOrder: 50
    },
    {
        name: "Здоровʼя і форма",
        color: "#F97316",
        icon: "💪",
        sortOrder: 60
    },
    {
        name: "Фінанси",
        color: "#22C55E",
        icon: "💰",
        sortOrder: 70
    },
    {
        name: "Навчання і розвиток",
        color: "#3B82F6",
        icon: "🧠",
        sortOrder: 80
    },
    {
        name: "Контент / бренд",
        color: "#EC4899",
        icon: "📣",
        sortOrder: 90
    },
    {
        name: "Адмінка і системність",
        color: "#6366F1",
        icon: "⚙️",
        sortOrder: 100
    }
]);

const STARTER_IMPACTS = Object.freeze([
    {
        name: "Дохід і клієнти",
        color: "#22C55E",
        icon: "📈",
        sortOrder: 10
    },
    {
        name: "Якість сервісу",
        color: "#0EA5E9",
        icon: "⭐",
        sortOrder: 20
    },
    {
        name: "Системність",
        color: "#6366F1",
        icon: "⚙️",
        sortOrder: 30
    },
    {
        name: "Швидкість роботи",
        color: "#F59E0B",
        icon: "⚡",
        sortOrder: 40
    },
    {
        name: "Здоровʼя",
        color: "#EF4444",
        icon: "❤️",
        sortOrder: 50
    },
    {
        name: "Фізична форма",
        color: "#F97316",
        icon: "💪",
        sortOrder: 60
    },
    {
        name: "Відновлення",
        color: "#14B8A6",
        icon: "🌿",
        sortOrder: 70
    },
    {
        name: "Побут і комфорт",
        color: "#A855F7",
        icon: "🛋️",
        sortOrder: 80
    },
    {
        name: "Навчання",
        color: "#3B82F6",
        icon: "🧠",
        sortOrder: 90
    },
    {
        name: "Репутація / бренд",
        color: "#EC4899",
        icon: "📣",
        sortOrder: 100
    },
    {
        name: "Команда і делегування",
        color: "#06B6D4",
        icon: "🤝",
        sortOrder: 110
    },
    {
        name: "Ризики і безпека",
        color: "#64748B",
        icon: "🛡️",
        sortOrder: 120
    }
]);

const STARTER_HABITS = Object.freeze([
    {
        name: "Ранкова зарядка",
        color: "#F97316",
        icon: "💪",
        metric: "minutes",
        targetValue: 10,
        cadence: "daily",
        selectedWeekdays: [],
        timesPerWeek: null,
        direction: "Здоровʼя і форма",
        impacts: [
            "Здоровʼя",
            "Фізична форма"
        ],
        sortOrder: 10
    },
    {
        name: "Планування дня",
        color: "#6366F1",
        icon: "🗓️",
        metric: "boolean",
        targetValue: 1,
        cadence: "daily",
        selectedWeekdays: [],
        timesPerWeek: null,
        direction: "Адмінка і системність",
        impacts: [
            "Системність",
            "Швидкість роботи"
        ],
        sortOrder: 20
    },
    {
        name: "Відновлення без екранів",
        color: "#14B8A6",
        icon: "🌿",
        metric: "minutes",
        targetValue: 30,
        cadence: "daily",
        selectedWeekdays: [],
        timesPerWeek: null,
        direction: "Особисте життя",
        impacts: [
            "Відновлення",
            "Здоровʼя"
        ],
        sortOrder: 30
    },
    {
        name: "Навчання 20 хв",
        color: "#3B82F6",
        icon: "🧠",
        metric: "minutes",
        targetValue: 20,
        cadence: "selected_weekdays",
        selectedWeekdays: [
            1,
            2,
            3,
            4,
            5
        ],
        timesPerWeek: null,
        direction: "Навчання і розвиток",
        impacts: [
            "Навчання",
            "Системність"
        ],
        sortOrder: 40
    },
    {
        name: "Побутовий порядок",
        color: "#A855F7",
        icon: "🛋️",
        metric: "boolean",
        targetValue: 1,
        cadence: "times_per_week",
        selectedWeekdays: [],
        timesPerWeek: 3,
        direction: "Побут / комфорт",
        impacts: [
            "Побут і комфорт",
            "Відновлення"
        ],
        sortOrder: 50
    }
]);

const STARTER_KIT = Object.freeze({
    directions: STARTER_DIRECTIONS,
    impacts: STARTER_IMPACTS,
    habits: STARTER_HABITS
});

const CATALOG_TABLES = Object.freeze({
    directions: 'my_day_directions',
    impacts: 'my_day_impacts'
});

function normalizeNameKey(value) {
    return String(value || '').trim().replace(/[\u02BC\u2019\u2018\u0060\u00B4]/g, "'").replace(/\s+/g, ' ').toLowerCase();
}

function summaryBucket() {
    return { created: 0, skipped: 0, items: [] };
}

function publicStarterKit() {
    return {
        directions: STARTER_DIRECTIONS.map(({ name }) => name),
        impacts: STARTER_IMPACTS.map(({ name }) => name),
        habits: STARTER_HABITS.map(({ name, metric, targetValue, cadence, selectedWeekdays, timesPerWeek, direction, impacts }) => ({
            name,
            metric,
            targetValue,
            cadence,
            selectedWeekdays: [...(selectedWeekdays || [])],
            timesPerWeek: timesPerWeek ?? null,
            direction,
            impacts: [...impacts]
        }))
    };
}

async function lockStarterKit(queryable, userId) {
    await queryable.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`my_day_starter_kit:${positiveInteger(userId, 'user')}`]);
}

async function createOrFindCatalog(queryable, userId, kind, item) {
    const table = CATALOG_TABLES[kind];
    if (!table) throw new Error('Unsupported starter taxonomy kind: ' + kind);
    const existing = await queryable.query(
        `SELECT id, name, color, icon, sort_order, is_active
         FROM ${table}
         WHERE user_id = $1 AND LOWER(BTRIM(name)) = LOWER(BTRIM($2))
         LIMIT 1
         FOR UPDATE`,
        [userId, item.name]
    );
    const row = existing.rows?.[0];
    if (row) return { status: 'skipped', id: Number(row.id), name: row.name, isActive: row.is_active !== false };

    const inserted = await queryable.query(
        `INSERT INTO ${table} (user_id, name, color, icon, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, is_active`,
        [userId, item.name, item.color, item.icon, item.sortOrder]
    );
    return { status: 'created', id: Number(inserted.rows[0].id), name: inserted.rows[0].name, isActive: true };
}

async function findExistingHabit(queryable, userId, name) {
    const result = await queryable.query(
        `SELECT id, name, is_archived
         FROM my_day_habits
         WHERE user_id = $1 AND LOWER(BTRIM(name)) = LOWER(BTRIM($2))
         LIMIT 1
         FOR UPDATE`,
        [userId, name]
    );
    return result.rows?.[0] || null;
}

function indexActiveRecords(records) {
    const map = new Map();
    records.forEach(record => {
        if (record.isActive === true) map.set(normalizeNameKey(record.name), Number(record.id));
    });
    return map;
}

async function createOrFindHabit(queryable, userId, habit, directionIds, impactIds) {
    const existing = await findExistingHabit(queryable, userId, habit.name);
    if (existing) return { status: 'skipped', id: Number(existing.id), name: existing.name, reason: 'exists' };

    const directionId = directionIds.get(normalizeNameKey(habit.direction));
    const linkedImpactIds = habit.impacts.map(name => impactIds.get(normalizeNameKey(name))).filter(Number.isInteger);
    if (!directionId || linkedImpactIds.length !== habit.impacts.length) {
        return { status: 'skipped', id: null, name: habit.name, reason: 'taxonomy_unavailable' };
    }

    const result = await queryable.query(
        `INSERT INTO my_day_habits
            (user_id, name, color, icon, direction_id, metric, target_value, cadence, selected_weekdays, times_per_week, is_paused, is_archived, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::smallint[], $10, FALSE, FALSE, $11)
         RETURNING id, name`,
        [userId, habit.name, habit.color, habit.icon, directionId, habit.metric, habit.targetValue, habit.cadence, habit.selectedWeekdays || [], habit.timesPerWeek ?? null, habit.sortOrder]
    );
    const habitId = Number(result.rows[0].id);
    await queryable.query(
        `INSERT INTO my_day_habit_impacts (habit_id, user_id, impact_id)
         SELECT $1, $2, unnest($3::bigint[])
         ON CONFLICT (habit_id, impact_id) DO NOTHING`,
        [habitId, userId, linkedImpactIds]
    );
    return { status: 'created', id: habitId, name: result.rows[0].name };
}

function pushOutcome(bucket, outcome) {
    bucket[outcome.status === 'created' ? 'created' : 'skipped'] += 1;
    bucket.items.push(outcome);
}

async function applyMyDayStarterKit(queryable, userId) {
    const ownerId = positiveInteger(userId, 'user');
    const summary = {
        directions: summaryBucket(),
        impacts: summaryBucket(),
        habits: summaryBucket()
    };

    try {
        await lockStarterKit(queryable, ownerId);

        for (const item of STARTER_DIRECTIONS) {
            pushOutcome(summary.directions, await createOrFindCatalog(queryable, ownerId, 'directions', item));
        }
        for (const item of STARTER_IMPACTS) {
            pushOutcome(summary.impacts, await createOrFindCatalog(queryable, ownerId, 'impacts', item));
        }

        const directionIds = indexActiveRecords(summary.directions.items);
        const impactIds = indexActiveRecords(summary.impacts.items);
        for (const habit of STARTER_HABITS) {
            pushOutcome(summary.habits, await createOrFindHabit(queryable, ownerId, habit, directionIds, impactIds));
        }
    } catch (error) {
        if (error?.statusCode) throw error;
        if (error?.code === '23505') {
            throw myDayError('Базовий набір уже частково існує. Оновіть сторінку і спробуйте ще раз.', 409, 'MY_DAY_STARTER_CONFLICT');
        }
        throw error;
    }

    return {
        payload: publicStarterKit(),
        created: {
            directions: summary.directions.created,
            impacts: summary.impacts.created,
            habits: summary.habits.created
        },
        skipped: {
            directions: summary.directions.skipped,
            impacts: summary.impacts.skipped,
            habits: summary.habits.skipped
        },
        details: summary
    };
}

module.exports = {
    STARTER_KIT,
    applyMyDayStarterKit,
    normalizeNameKey,
    publicStarterKit
};