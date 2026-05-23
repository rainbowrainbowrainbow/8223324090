const { buildTaskOwnerMatch, normalizeUserId } = require('./taskPolicy');

const DEFAULT_TIME_ZONE = 'Europe/Kyiv';
const FINAL_STATUSES = new Set(['cancelled', 'archived']);

function numberValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function lowerToken(value, fallback = '') {
    return String(value || fallback).trim().toLowerCase();
}

function asDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(value, timeZone = DEFAULT_TIME_ZONE) {
    const date = asDate(value);
    if (!date) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function addDays(dateText, amount) {
    const date = new Date(`${dateText}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
}

function buildDayRange(today, days) {
    const count = Math.max(1, numberValue(days, 1));
    return Array.from({ length: count }, (_, index) => addDays(today, index - count + 1));
}

function completionDate(row) {
    return row.completed_at || row.completedAt || null;
}

function createdDate(row) {
    return row.created_at || row.createdAt || null;
}

function dueDate(row) {
    return row.scheduled_end_at || row.scheduledEndAt
        || row.deadline
        || row.remind_at || row.remindAt
        || row.date
        || null;
}

function isDone(row) {
    return lowerToken(row.status, 'todo') === 'done';
}

function isActive(row) {
    const status = lowerToken(row.status, 'todo');
    return status !== 'done' && !FINAL_STATUSES.has(status);
}

function isCountable(row) {
    return !FINAL_STATUSES.has(lowerToken(row.status, 'todo'));
}

function taskSourceGroup(row = {}) {
    const total = numberValue(row.subtask_count ?? row.subtaskCount);
    if (total <= 0) return 'none';

    const ai = numberValue(row.subtask_ai_count ?? row.subtaskAiCount);
    const template = numberValue(row.subtask_template_count ?? row.subtaskTemplateCount);
    const manual = numberValue(row.subtask_manual_count ?? row.subtaskManualCount);
    const system = numberValue(row.subtask_system_count ?? row.subtaskSystemCount);

    if (ai > 0 && template > 0) return 'template_ai';
    if (ai > 0) return 'ai';
    if (template > 0) return 'template';
    if (manual > 0 && manual === total) return 'manual';
    if (system > 0 && system === total) return 'system';
    return 'mixed';
}

function percent(done, total) {
    const denominator = numberValue(total);
    if (denominator <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((numberValue(done) / denominator) * 100)));
}

function countByDate(rows, getter, days, today, timeZone) {
    const keys = buildDayRange(today, days);
    const byDate = new Map(keys.map(key => [key, 0]));
    rows.forEach(row => {
        const key = dateKey(getter(row), timeZone);
        if (byDate.has(key)) byDate.set(key, byDate.get(key) + 1);
    });
    return keys.map(key => ({ date: key, count: byDate.get(key) || 0 }));
}

function calculateCompletionStreak(completionDateKeys, today) {
    const unique = [...new Set(completionDateKeys.filter(Boolean))].sort();
    const set = new Set(unique);
    const activeToday = set.has(today);
    const start = activeToday ? today : addDays(today, -1);

    let current = 0;
    for (let key = start; set.has(key); key = addDays(key, -1)) {
        current += 1;
    }

    let longest = 0;
    let run = 0;
    let previous = null;
    unique.forEach(key => {
        if (previous && key === addDays(previous, 1)) {
            run += 1;
        } else {
            run = 1;
        }
        longest = Math.max(longest, run);
        previous = key;
    });

    return {
        current,
        longest,
        activeToday,
        lastActiveDate: unique.length ? unique[unique.length - 1] : null
    };
}

function achievement(id, title, description, progress, target) {
    const current = Math.max(0, numberValue(progress));
    const goal = Math.max(1, numberValue(target, 1));
    return {
        id,
        title,
        description,
        progress: current,
        target: goal,
        percent: percent(current, goal),
        unlocked: current >= goal,
        mode: 'derived'
    };
}

function buildProductivityAchievements(summary, decomposition, streak) {
    return [
        achievement(
            'productivity_tasks_10',
            'Перші 10 виконаних задач',
            'Виконати 10 персональних задач в основному списку.',
            summary.completedTasks,
            10
        ),
        achievement(
            'productivity_streak_7',
            '7-денний активний стрік',
            'Мати виконані задачі у 7 календарних днях поспіль.',
            streak.current,
            7
        ),
        achievement(
            'productivity_parent_5',
            '5 завершених задач із підзадачами',
            'Завершити 5 задач, які були розбиті на підзадачі.',
            summary.parentTasksCompleted,
            5
        ),
        achievement(
            'productivity_decomposition_5',
            '5 декомпозованих задач',
            'Створити або отримати 5 задач із підзадачами.',
            summary.decomposedTasksCount,
            5
        ),
        achievement(
            'productivity_ai_first_done',
            'Перша AI-декомпозиція виконана',
            'Завершити задачу, де є AI-sourced підзадачі.',
            decomposition.aiCompletedTasks,
            1
        ),
        achievement(
            'productivity_template_first_done',
            'Перший шаблон доведено до кінця',
            'Завершити задачу, де є підзадачі з шаблону.',
            decomposition.templateCompletedTasks,
            1
        )
    ];
}

function sourceCounts(rows) {
    const counts = {
        none: 0,
        manual: 0,
        template: 0,
        ai: 0,
        template_ai: 0,
        system: 0,
        mixed: 0
    };
    rows.filter(isCountable).forEach(row => {
        const key = taskSourceGroup(row);
        counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
}

function categoryCounts(rows) {
    const counts = new Map();
    rows.filter(isCountable).forEach(row => {
        const key = String(row.category || 'uncategorized').trim() || 'uncategorized';
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
        .slice(0, 7);
}

function buildTaskProductivity(rows = [], options = {}) {
    const timeZone = options.timeZone || DEFAULT_TIME_ZONE;
    const today = options.today || dateKey(options.now || new Date(), timeZone);
    const countableRows = rows.filter(isCountable);
    const activeRows = rows.filter(isActive);
    const doneRows = countableRows.filter(isDone);
    const datedDoneRows = doneRows.filter(row => completionDate(row));
    const completedDateKeys = datedDoneRows.map(row => dateKey(completionDate(row), timeZone)).filter(Boolean);
    const day7Start = addDays(today, -6);
    const day30Start = addDays(today, -29);

    const completedToday = completedDateKeys.filter(key => key === today).length;
    const completed7Days = completedDateKeys.filter(key => key >= day7Start && key <= today).length;
    const completed30Days = completedDateKeys.filter(key => key >= day30Start && key <= today).length;
    const decomposedRows = countableRows.filter(row => numberValue(row.subtask_count ?? row.subtaskCount) > 0);
    const plainRows = countableRows.filter(row => numberValue(row.subtask_count ?? row.subtaskCount) <= 0);
    const decomposedDoneRows = decomposedRows.filter(isDone);
    const plainDoneRows = plainRows.filter(isDone);

    const totalSubtasks = countableRows.reduce((sum, row) => sum + numberValue(row.subtask_count ?? row.subtaskCount), 0);
    const doneSubtasks = countableRows.reduce((sum, row) => sum + numberValue(row.subtask_done_count ?? row.subtaskDoneCount), 0);

    const overdueRows = activeRows.filter(row => {
        const key = dateKey(dueDate(row), timeZone);
        return key && key < today;
    });
    const inProgressRows = activeRows.filter(row => {
        const status = lowerToken(row.status);
        const workflow = lowerToken(row.workflow_state ?? row.workflowState);
        return status === 'in_progress' || workflow === 'in_progress';
    });

    const sourceBreakdown = sourceCounts(rows);
    const decomposition = {
        decomposedTasks: decomposedRows.length,
        nonDecomposedTasks: plainRows.length,
        completedDecomposedTasks: decomposedDoneRows.length,
        completedNonDecomposedTasks: plainDoneRows.length,
        decomposedCompletionRate: percent(decomposedDoneRows.length, decomposedRows.length),
        nonDecomposedCompletionRate: percent(plainDoneRows.length, plainRows.length),
        totalSubtasks,
        completedSubtasks: doneSubtasks,
        subtaskCompletionRate: percent(doneSubtasks, totalSubtasks),
        sourceBreakdown,
        aiTasks: countableRows.filter(row => numberValue(row.subtask_ai_count ?? row.subtaskAiCount) > 0).length,
        templateTasks: countableRows.filter(row => numberValue(row.subtask_template_count ?? row.subtaskTemplateCount) > 0).length,
        aiCompletedTasks: doneRows.filter(row => numberValue(row.subtask_ai_count ?? row.subtaskAiCount) > 0).length,
        templateCompletedTasks: doneRows.filter(row => numberValue(row.subtask_template_count ?? row.subtaskTemplateCount) > 0).length,
        templateAiTasks: sourceBreakdown.template_ai || 0,
        sourceTruth: 'derived_from_task_subtasks.source_type'
    };

    const summary = {
        totalTasks: countableRows.length,
        activeTasks: activeRows.length,
        completedTasks: doneRows.length,
        completedToday,
        completed7Days,
        completed30Days,
        completionRate: percent(doneRows.length, countableRows.length),
        overdueCount: overdueRows.length,
        inProgressCount: inProgressRows.length,
        parentTasksCompleted: decomposedDoneRows.length,
        decomposedTasksCount: decomposedRows.length,
        subtasksCompleted: doneSubtasks
    };

    const streak = calculateCompletionStreak(completedDateKeys, today);
    const charts = {
        completedByDay: countByDate(datedDoneRows, completionDate, 14, today, timeZone),
        createdVsCompleted: buildDayRange(today, 14).map(day => ({
            date: day,
            created: countableRows.filter(row => dateKey(createdDate(row), timeZone) === day).length,
            completed: datedDoneRows.filter(row => dateKey(completionDate(row), timeZone) === day).length
        })),
        decompositionSourceSplit: Object.entries(sourceBreakdown)
            .map(([source, count]) => ({ source, count }))
            .filter(item => item.count > 0),
        categoryDistribution: categoryCounts(rows)
    };

    return {
        summary,
        streak,
        achievements: buildProductivityAchievements(summary, decomposition, streak),
        charts,
        decomposition,
        meta: {
            scope: 'current_user',
            timeZone,
            today,
            completionDateSource: 'tasks.completed_at',
            decompositionSourceTruth: 'task_subtasks.source_type',
            templateAiSourceRule: 'derived_when_template_and_ai_subtasks_coexist',
            achievementMode: 'derived_idempotent_not_persisted'
        }
    };
}

async function getTaskProductivity(pool, user, options = {}) {
    const userId = normalizeUserId(user);
    if (!userId) {
        const err = new Error('Unauthenticated');
        err.statusCode = 401;
        throw err;
    }
    const params = [];
    const ownerMatch = buildTaskOwnerMatch(user, params, 't');
    const result = await pool.query(
        `SELECT t.id, t.title, t.status, t.workflow_state, t.category, t.task_mode, t.task_kind,
                t.created_at, t.updated_at, t.completed_at, t.deadline, t.date,
                t.remind_at, t.scheduled_start_at, t.scheduled_end_at,
                COALESCE(st.total, 0)::int AS subtask_count,
                COALESCE(st.done, 0)::int AS subtask_done_count,
                COALESCE(st.manual_count, 0)::int AS subtask_manual_count,
                COALESCE(st.template_count, 0)::int AS subtask_template_count,
                COALESCE(st.ai_count, 0)::int AS subtask_ai_count,
                COALESCE(st.system_count, 0)::int AS subtask_system_count
         FROM tasks t
         LEFT JOIN (
            SELECT task_id,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE is_done = true)::int AS done,
                   COUNT(*) FILTER (WHERE COALESCE(source_type, 'manual') = 'manual')::int AS manual_count,
                   COUNT(*) FILTER (WHERE COALESCE(source_type, 'manual') = 'template')::int AS template_count,
                   COUNT(*) FILTER (WHERE COALESCE(source_type, 'manual') = 'ai')::int AS ai_count,
                   COUNT(*) FILTER (WHERE COALESCE(source_type, 'manual') = 'system')::int AS system_count
            FROM task_subtasks
            GROUP BY task_id
         ) st ON st.task_id = t.id
         WHERE ${ownerMatch}`,
        params
    );
    return buildTaskProductivity(result.rows, options);
}

module.exports = {
    buildTaskProductivity,
    calculateCompletionStreak,
    dateKey,
    getTaskProductivity,
    taskSourceGroup
};
