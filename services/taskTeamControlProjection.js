'use strict';

const { addDays, dateOnly, todayKyivDate } = require('./taskScheduling');
const { normalizeTaskPriority } = require('./taskPostponementPolicy');

const DUE_SOON_DAYS = 3;

function isActive(task = {}) {
    return !['done', 'archived', 'cancelled'].includes(String(task.status || 'todo'));
}

function workloadDate(task = {}) {
    return dateOnly(
        task.scheduledStartAt || task.scheduled_start_at || task.snoozedUntil || task.snoozed_until
        || task.date || task.deadline || task.remindAt || task.remind_at
    );
}

function scheduledDate(task = {}) {
    return dateOnly(task.scheduledStartAt || task.scheduled_start_at);
}

function ownerKey(task = {}) {
    const id = Number(task.ownerUserId || task.owner_user_id || 0);
    return Number.isInteger(id) && id > 0 ? String(id) : 'unassigned';
}

function ownerLabel(task = {}) {
    return task.ownerLabel || task.owner_name || task.owner_username || task.assigned_to || task.owner || 'Не призначено';
}

function taskEffort(task = {}) {
    const value = Number(task.effortMinutes ?? task.effort_minutes ?? task.schedule?.durationMinutes);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function dayDifference(left, right) {
    if (!left || !right) return null;
    const from = new Date(`${left}T12:00:00Z`);
    const to = new Date(`${right}T12:00:00Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function taskFacts(task, today) {
    const due = workloadDate(task);
    const openDependencies = Number(task.openDependencyCount ?? task.open_dependency_count ?? 0);
    const relativeDays = due ? dayDifference(today, due) : null;
    return {
        due,
        scheduled: scheduledDate(task),
        effortMinutes: taskEffort(task),
        overdue: Boolean(due && due < today),
        urgent: normalizeTaskPriority(task.priority) === 'urgent',
        blocked: openDependencies > 0,
        dueSoon: Number.isFinite(relativeDays) && relativeDays >= 0 && relativeDays <= DUE_SOON_DAYS,
        noDate: !due
    };
}

function emptyMetrics() {
    return {
        active: 0,
        overdue: 0,
        urgent: 0,
        blocked: 0,
        dueSoon: 0,
        noDate: 0,
        knownEffortMinutes: 0,
        unknownEffortTasks: 0,
        scheduledEffortMinutes: 0,
        unscheduledTasks: 0
    };
}

function addTaskToMetrics(metrics, facts) {
    metrics.active += 1;
    if (facts.overdue) metrics.overdue += 1;
    if (facts.urgent) metrics.urgent += 1;
    if (facts.blocked) metrics.blocked += 1;
    if (facts.dueSoon) metrics.dueSoon += 1;
    if (facts.noDate) metrics.noDate += 1;
    if (facts.effortMinutes === null) metrics.unknownEffortTasks += 1;
    else metrics.knownEffortMinutes += facts.effortMinutes;
    if (facts.scheduled) {
        metrics.scheduledEffortMinutes += facts.effortMinutes || 0;
    } else {
        metrics.unscheduledTasks += 1;
    }
}

function capacityByOwnerDate(rows = []) {
    const map = new Map();
    for (const row of rows) {
        const ownerUserId = Number(row.ownerUserId ?? row.owner_user_id ?? 0);
        const date = dateOnly(row.date);
        if (!ownerUserId || !date) continue;
        map.set(`${ownerUserId}:${date}`, {
            status: row.status === 'available' ? 'available' : 'unavailable',
            minutes: row.status === 'available' && Number.isFinite(Number(row.capacityMinutes ?? row.capacity_minutes))
                ? Math.max(0, Math.round(Number(row.capacityMinutes ?? row.capacity_minutes)))
                : null
        });
    }
    return map;
}

function planningDates(from, to) {
    const dates = [];
    let cursor = from;
    while (cursor && cursor <= to && dates.length < 31) {
        dates.push(cursor);
        cursor = addDays(cursor, 1);
    }
    return dates;
}

function buildTaskTeamControlProjection(tasks = [], options = {}) {
    const today = options.today || todayKyivDate(options.now || new Date());
    const from = options.from || today;
    const to = options.to || addDays(from, 6);
    const dates = planningDates(from, to);
    const capacity = capacityByOwnerDate(options.capacityRows || []);
    const owners = new Map();
    const unassigned = [];

    for (const task of tasks.filter(isActive)) {
        const key = ownerKey(task);
        const facts = taskFacts(task, today);
        if (!owners.has(key)) {
            owners.set(key, {
                ownerUserId: key === 'unassigned' ? null : Number(key),
                ownerLabel: ownerLabel(task),
                department: task.ownerDepartment || task.owner_department || null,
                metrics: emptyMetrics(),
                tasks: [],
                days: Object.fromEntries(dates.map(date => [date, {
                    date,
                    scheduledEffortMinutes: 0,
                    scheduledTasks: [],
                    capacity: { status: 'unavailable', minutes: null },
                    overloadMinutes: null
                }]))
            });
        }
        const owner = owners.get(key);
        addTaskToMetrics(owner.metrics, facts);
        owner.tasks.push({ task, facts });
        if (facts.scheduled && owner.days[facts.scheduled]) {
            const day = owner.days[facts.scheduled];
            day.scheduledTasks.push({ task, facts });
            day.scheduledEffortMinutes += facts.effortMinutes || 0;
        }
        if (key === 'unassigned') unassigned.push({ task, facts });
    }

    const ownerRows = [...owners.values()].map(owner => {
        Object.values(owner.days).forEach(day => {
            const record = owner.ownerUserId ? capacity.get(`${owner.ownerUserId}:${day.date}`) : null;
            if (record) day.capacity = record;
            day.overloadMinutes = day.capacity.status === 'available'
                ? Math.max(0, day.scheduledEffortMinutes - day.capacity.minutes)
                : null;
        });
        return {
            ...owner,
            days: dates.map(date => owner.days[date]),
            overloadDays: Object.values(owner.days).filter(day => Number(day.overloadMinutes) > 0).length
        };
    }).sort((left, right) => {
        if (left.ownerUserId === null) return 1;
        if (right.ownerUserId === null) return -1;
        return left.ownerLabel.localeCompare(right.ownerLabel, 'uk');
    });

    const unscheduled = ownerRows.flatMap(owner => owner.tasks
        .filter(item => !item.facts.scheduled)
        .map(item => ({ ...item, ownerUserId: owner.ownerUserId, ownerLabel: owner.ownerLabel })));

    return {
        dates,
        owners: ownerRows,
        unscheduled,
        unassigned,
        meta: {
            today,
            from,
            to,
            capacityAvailable: options.capacityAvailable === true,
            capacitySource: options.capacityAvailable === true ? 'staff_schedule_read_model' : 'unavailable_by_permission',
            dueSoonDays: DUE_SOON_DAYS
        }
    };
}

module.exports = {
    DUE_SOON_DAYS,
    buildTaskTeamControlProjection,
    capacityByOwnerDate,
    taskFacts,
    workloadDate
};
