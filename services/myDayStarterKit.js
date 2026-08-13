'use strict';

const { myDayError } = require('./myDayTaxonomy');
const { positiveInteger } = require('./myDayHabits');
const { CANONICAL_MY_DAY_IMPACTS, normalizeImpactCatalogName } = require('./myDayImpactCatalog');

const STARTER_IMPACTS = CANONICAL_MY_DAY_IMPACTS;

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
        impacts: [
            "Системність",
            "Швидкість / ефективність"
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
        impacts: [
            "Навчання / розвиток",
            "Системність"
        ],
        sortOrder: 40
    },
    {
        name: "Побутовий порядок",
        color: "#A855F7",
        icon: "🏠",
        metric: "boolean",
        targetValue: 1,
        cadence: "times_per_week",
        selectedWeekdays: [],
        timesPerWeek: 3,
        impacts: [
            "Побут / комфорт",
            "Відновлення"
        ],
        sortOrder: 50
    }
]);

const STARTER_KIT = Object.freeze({
    impacts: STARTER_IMPACTS,
    habits: STARTER_HABITS
});

const CATALOG_TABLES = Object.freeze({
    impacts: 'my_day_impacts'
});

function normalizeNameKey(value) {
    return normalizeImpactCatalogName(value);
}

function summaryBucket() {
    return { created: 0, skipped: 0, items: [] };
}

function publicStarterKit() {
    return {
        impacts: STARTER_IMPACTS.map(({ name }) => name),
        habits: STARTER_HABITS.map(({ name, metric, targetValue, cadence, selectedWeekdays, timesPerWeek, impacts }) => ({
            name,
            metric,
            targetValue,
            cadence,
            selectedWeekdays: [...(selectedWeekdays || [])],
            timesPerWeek: timesPerWeek ?? null,
            impacts: [...impacts]
        }))
    };
}

async function lockStarterKit(queryable, userId) {
    await queryable.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`my_day_starter_kit:${positiveInteger(userId, 'user')}`]);
}

function catalogMatchNames(item) {
    return [...new Set([item.name, ...(item.legacyNames || [])]
        .map(value => String(value || '').trim().toLocaleLowerCase('uk-UA'))
        .filter(Boolean))];
}

function chooseCatalogTarget(rows, canonicalName) {
    const canonicalKey = normalizeNameKey(canonicalName);
    return [...rows].sort((left, right) => {
        const referenceDiff = Number(right.reference_count || 0) - Number(left.reference_count || 0);
        if (referenceDiff) return referenceDiff;
        const activeDiff = Number(right.is_active !== false) - Number(left.is_active !== false);
        if (activeDiff) return activeDiff;
        const canonicalDiff = Number(normalizeNameKey(right.name) === canonicalKey) - Number(normalizeNameKey(left.name) === canonicalKey);
        if (canonicalDiff) return canonicalDiff;
        return Number(left.id) - Number(right.id);
    })[0];
}

function archivedDuplicateName(item, duplicateId) {
    const suffix = ` [merged #${duplicateId}]`;
    return `${String(item.name || '').slice(0, Math.max(1, 100 - suffix.length))}${suffix}`;
}

async function mergeCatalogDuplicate(queryable, userId, targetId, duplicate, item) {
    await queryable.query(
        `INSERT INTO my_day_task_impacts (user_id, task_id, impact_id, created_at)
         SELECT user_id, task_id, $3, created_at
         FROM my_day_task_impacts
         WHERE user_id = $1 AND impact_id = $2
         ON CONFLICT (user_id, task_id, impact_id) DO NOTHING`,
        [userId, duplicate.id, targetId]
    );
    await queryable.query(
        `INSERT INTO my_day_habit_impacts (habit_id, user_id, impact_id, created_at)
         SELECT habit_id, user_id, $3, created_at
         FROM my_day_habit_impacts
         WHERE user_id = $1 AND impact_id = $2
         ON CONFLICT (habit_id, impact_id) DO NOTHING`,
        [userId, duplicate.id, targetId]
    );
    await queryable.query('DELETE FROM my_day_task_impacts WHERE user_id = $1 AND impact_id = $2', [userId, duplicate.id]);
    await queryable.query('DELETE FROM my_day_habit_impacts WHERE user_id = $1 AND impact_id = $2', [userId, duplicate.id]);
    await queryable.query(
        `UPDATE my_day_impacts
         SET name = $3,
             is_active = FALSE,
             archived_at = COALESCE(archived_at, NOW()),
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [duplicate.id, userId, archivedDuplicateName(item, duplicate.id)]
    );
}

async function createOrFindCatalog(queryable, userId, kind, item) {
    const table = CATALOG_TABLES[kind];
    if (!table) throw new Error('Unsupported starter taxonomy kind: ' + kind);
    const existing = await queryable.query(
        `SELECT i.id, i.name, i.color, i.icon, i.sort_order, i.is_active,
                ((SELECT COUNT(*) FROM my_day_task_impacts ti WHERE ti.user_id = i.user_id AND ti.impact_id = i.id)
                 + (SELECT COUNT(*) FROM my_day_habit_impacts hi WHERE hi.user_id = i.user_id AND hi.impact_id = i.id))::int AS reference_count
         FROM ${table} i
         WHERE i.user_id = $1 AND LOWER(BTRIM(i.name)) = ANY($2::text[])
         ORDER BY i.id
         FOR UPDATE`,
        [userId, catalogMatchNames(item)]
    );
    const rows = existing.rows || [];
    if (rows.length) {
        const target = chooseCatalogTarget(rows, item.name);
        const duplicates = rows.filter(row => Number(row.id) !== Number(target.id));
        for (const duplicate of duplicates) {
            await mergeCatalogDuplicate(queryable, userId, target.id, duplicate, item);
        }
        const normalized = await queryable.query(
            `UPDATE ${table}
             SET name = $3,
                 color = $4,
                 icon = $5,
                 sort_order = $6,
                 updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING id, name, color, icon, sort_order, is_active`,
            [target.id, userId, item.name, item.color, item.icon, item.sortOrder]
        );
        const row = normalized.rows[0];
        return {
            status: 'skipped',
            id: Number(row.id),
            name: row.name,
            isActive: row.is_active !== false,
            normalizedFrom: target.name !== row.name ? target.name : undefined,
            mergedIds: duplicates.map(duplicate => Number(duplicate.id)),
            metadataUpdated: target.color !== row.color
                || target.icon !== row.icon
                || Number(target.sort_order) !== Number(row.sort_order)
        };
    }

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

async function createOrFindHabit(queryable, userId, habit, impactIds) {
    const existing = await findExistingHabit(queryable, userId, habit.name);
    if (existing) return { status: 'skipped', id: Number(existing.id), name: existing.name, reason: 'exists' };

    const linkedImpactIds = habit.impacts.map(name => impactIds.get(normalizeNameKey(name))).filter(Number.isInteger);
    if (linkedImpactIds.length !== habit.impacts.length) {
        return { status: 'skipped', id: null, name: habit.name, reason: 'taxonomy_unavailable' };
    }

    const result = await queryable.query(
        `INSERT INTO my_day_habits
            (user_id, name, color, icon, metric, target_value, cadence, selected_weekdays, times_per_week, is_paused, is_archived, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::smallint[], $9, FALSE, FALSE, $10)
         RETURNING id, name`,
        [userId, habit.name, habit.color, habit.icon, habit.metric, habit.targetValue, habit.cadence, habit.selectedWeekdays || [], habit.timesPerWeek ?? null, habit.sortOrder]
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
        impacts: summaryBucket(),
        habits: summaryBucket()
    };

    try {
        await lockStarterKit(queryable, ownerId);

        summary.impacts = await syncMyDayImpactCatalog(queryable, ownerId, { lock: false });

        const impactIds = indexActiveRecords(summary.impacts.items);
        for (const habit of STARTER_HABITS) {
            pushOutcome(summary.habits, await createOrFindHabit(queryable, ownerId, habit, impactIds));
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
            impacts: summary.impacts.created,
            habits: summary.habits.created
        },
        skipped: {
            impacts: summary.impacts.skipped,
            habits: summary.habits.skipped
        },
        details: summary
    };
}

async function syncMyDayImpactCatalog(queryable, userId, options = {}) {
    const ownerId = positiveInteger(userId, 'user');
    const impacts = summaryBucket();
    if (options.lock !== false) await lockStarterKit(queryable, ownerId);
    for (const item of STARTER_IMPACTS) {
        pushOutcome(impacts, await createOrFindCatalog(queryable, ownerId, 'impacts', item));
    }
    return impacts;
}

module.exports = {
    STARTER_KIT,
    applyMyDayStarterKit,
    normalizeNameKey,
    publicStarterKit,
    syncMyDayImpactCatalog
};
