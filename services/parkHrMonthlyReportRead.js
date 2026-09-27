'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { attendanceFactMinutes } = require('./hrAttendance');
const { hasCurrentParkScheduleMembership, parkStaffScheduleRoutePath } = require('./parkStaffScheduleAccess');
const { scheduleableStaffWhere } = require('./staffOperationalFilters');
const { taskKpiEligibleSql } = require('./taskPerformancePolicy');

function isParkHrMonthlyReportRoute(req) {
    return req.method === 'GET' && parkStaffScheduleRoutePath(req) === '/report/monthly';
}

function canReadParkHrMonthlyReport(req) {
    return isParkHrMonthlyReportRoute(req) && hasCurrentParkScheduleMembership(req)
        && resolveCapability(req.user, 'hr.reports.view', { type: 'action' }).allowed;
}

function parkMonthlyPeriod(query = {}, now = new Date()) {
    if (query.from !== undefined || query.to !== undefined) return null;
    const month = query.month === undefined
        ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        : String(query.month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const [year, number] = month.split('-').map(Number);
    return { dateFrom: `${month}-01`, dateTo: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
}

function pick(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
}

function projectParkHrMonthlyReport(payload) {
    if (payload?.success !== true) return payload;
    const fields = [
        'staff_id', 'staff_name', 'days_scheduled', 'days_worked', 'days_late',
        'days_early_leave', 'days_absent', 'days_sick', 'days_vacation',
        'total_worked_hours', 'total_overtime_hours', 'late_count', 'avg_late_minutes',
        'profession_card_days', 'unscheduled_days', 'plan_warning_count',
        'attendance_rate', 'task_completion_rate'
    ];
    return {
        success: true,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        data: Array.isArray(payload.data) ? payload.data.map(row => ({
            ...pick(row, fields),
            task_kpi: pick(row?.task_kpi, ['tasks_assigned', 'tasks_done', 'tasks_overdue'])
        })) : [],
        reportAccess: { readOnly: true, exportAllowed: false, businessContext: 'event_genix' }
    };
}

async function loadParkHrMonthlyReport(pool, { dateFrom, dateTo }) {
    const staff = await pool.query(
        `SELECT s.id, s.name FROM staff s WHERE ${scheduleableStaffWhere('s')} ORDER BY s.name`
    );
    const staffIds = staff.rows.map(row => Number(row.id));
    if (staffIds.length === 0) return [];
    const params = [dateFrom, dateTo, staffIds];
    const [shifts, records, tasks] = await Promise.all([
        pool.query(`SELECT staff_id, COUNT(*)::int AS days_scheduled FROM hr_shifts
            WHERE shift_date BETWEEN $1::date AND $2::date AND staff_id = ANY($3::int[])
            GROUP BY staff_id`, params),
        pool.query(`SELECT tr.staff_id, tr.clock_in, tr.status, tr.late_minutes,
                tr.early_leave_minutes, tr.overtime_minutes, tr.total_worked_minutes,
                CASE WHEN EXISTS (SELECT 1 FROM hr_shifts hs
                    WHERE hs.staff_id = tr.staff_id AND hs.shift_date = tr.record_date) THEN 'hr_shift'
                    WHEN tr.planned_start IS NOT NULL AND tr.planned_end IS NOT NULL THEN 'profession_card'
                    ELSE 'unscheduled' END AS plan_source
            FROM hr_time_records tr
            WHERE tr.record_date BETWEEN $1::date AND $2::date AND tr.staff_id = ANY($3::int[])`, params),
        pool.query(`SELECT ep.staff_id,
                COUNT(t.id) FILTER (WHERE ${taskKpiEligibleSql('t')})::int AS tasks_assigned,
                COUNT(t.id) FILTER (WHERE ${taskKpiEligibleSql('t')}
                    AND COALESCE(t.status, 'todo') IN ('done', 'completed'))::int AS tasks_done,
                COUNT(t.id) FILTER (WHERE ${taskKpiEligibleSql('t')}
                    AND COALESCE(t.status, 'todo') NOT IN ('done', 'completed', 'archived', 'cancelled')
                    AND t.deadline IS NOT NULL AND t.deadline < NOW())::int AS tasks_overdue
            FROM tasks t
            JOIN employee_profiles ep ON ep.user_id = t.owner_user_id AND ep.is_active IS TRUE
            WHERE t.business_context = 'event_genix' AND ep.staff_id = ANY($3::int[])
                AND (t.created_at::date BETWEEN $1::date AND $2::date
                    OR t.completed_at::date BETWEEN $1::date AND $2::date)
            GROUP BY ep.staff_id`, params)
    ]);

    const shiftMap = new Map(shifts.rows.map(row => [Number(row.staff_id), Number(row.days_scheduled) || 0]));
    const taskMap = new Map(tasks.rows.map(row => [Number(row.staff_id), {
        tasks_assigned: Number(row.tasks_assigned) || 0,
        tasks_done: Number(row.tasks_done) || 0,
        tasks_overdue: Number(row.tasks_overdue) || 0
    }]));
    const stats = new Map();
    for (const row of records.rows) {
        const id = Number(row.staff_id);
        if (!stats.has(id)) stats.set(id, { days_worked: 0, days_late: 0, days_early_leave: 0,
            days_absent: 0, days_sick: 0, days_vacation: 0, worked_minutes: 0,
            overtime_minutes: 0, late_count: 0, late_minutes: 0,
            profession_card_days: 0, unscheduled_days: 0 });
        const item = stats.get(id);
        const facts = attendanceFactMinutes(row);
        if (row.clock_in) {
            item.days_worked++;
            item.worked_minutes += Number(row.total_worked_minutes) || 0;
            item.overtime_minutes += facts.overtimeMinutes;
        }
        if (facts.lateMinutes > 0) { item.days_late++; item.late_count++; item.late_minutes += facts.lateMinutes; }
        if (facts.earlyLeaveMinutes > 0) item.days_early_leave++;
        if (row.plan_source === 'profession_card') item.profession_card_days++;
        if (row.plan_source === 'unscheduled') item.unscheduled_days++;
        if (row.status === 'absent' || row.status === 'no_show') item.days_absent++;
        if (row.status === 'sick') item.days_sick++;
        if (row.status === 'vacation') item.days_vacation++;
    }
    return staff.rows.map(row => {
        const id = Number(row.id);
        const item = stats.get(id) || {};
        const scheduled = shiftMap.get(id) || 0;
        const task = taskMap.get(id) || { tasks_assigned: 0, tasks_done: 0, tasks_overdue: 0 };
        return {
            staff_id: id, staff_name: row.name,
            days_scheduled: scheduled, days_worked: item.days_worked || 0,
            days_late: item.days_late || 0, days_early_leave: item.days_early_leave || 0,
            days_absent: item.days_absent || 0, days_sick: item.days_sick || 0,
            days_vacation: item.days_vacation || 0,
            total_worked_hours: Math.round((item.worked_minutes || 0) / 60 * 10) / 10,
            total_overtime_hours: Math.round((item.overtime_minutes || 0) / 60 * 10) / 10,
            late_count: item.late_count || 0,
            avg_late_minutes: item.late_count ? Math.round(item.late_minutes / item.late_count) : 0,
            profession_card_days: item.profession_card_days || 0,
            unscheduled_days: item.unscheduled_days || 0,
            plan_warning_count: (item.profession_card_days || 0) + (item.unscheduled_days || 0),
            attendance_rate: scheduled ? Math.round((item.days_worked || 0) / scheduled * 100) : 0,
            task_kpi: task,
            task_completion_rate: task.tasks_assigned
                ? Math.round(task.tasks_done / task.tasks_assigned * 100) : 0
        };
    });
}

module.exports = { isParkHrMonthlyReportRoute, canReadParkHrMonthlyReport,
    parkMonthlyPeriod, projectParkHrMonthlyReport, loadParkHrMonthlyReport };
