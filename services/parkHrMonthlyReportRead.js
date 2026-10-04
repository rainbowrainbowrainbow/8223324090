'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { reportAttendanceByStaff } = require('./hrMonthlyReportDetails');
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

const PARK_ATTENDANCE_DETAIL_FIELDS = [
    'date', 'shift_id', 'record_id', 'planned_start', 'planned_end',
    'profession_key', 'shift_type', 'plan_source', 'status', 'clock_in', 'clock_out',
    'late_minutes', 'early_leave_minutes', 'overtime_minutes', 'worked_minutes'
];
const PARK_ATTENDANCE_DETAIL_TYPES = [
    'scheduled', 'planned_worked', 'unplanned_worked', 'worked', 'late',
    'early_leave', 'absent', 'overtime', 'plan_warning'
];
const PARK_TASK_DETAIL_FIELDS = [
    'id', 'title', 'status', 'source_type', 'created_at', 'deadline', 'completed_at'
];

function projectParkReportDetails(value, keys, fields) {
    return Object.fromEntries(keys.map(key => [key,
        Array.isArray(value?.[key]) ? value[key].map(item => pick(item, fields)) : []]));
}

function projectParkHrMonthlyReport(payload) {
    if (payload?.success !== true) return payload;
    const fields = [
        'staff_id', 'staff_name', 'days_scheduled', 'days_worked', 'days_late',
        'days_early_leave', 'days_absent', 'days_sick', 'days_vacation',
        'total_worked_hours', 'total_overtime_hours', 'late_count', 'avg_late_minutes',
        'profession_card_days', 'unscheduled_days', 'plan_warning_count',
        'attendance_rate', 'task_completion_rate', 'planned_worked_count',
        'unplanned_worked_count', 'task_data_status'
    ];
    return {
        success: true,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        data: Array.isArray(payload.data) ? payload.data.map(row => ({
            ...pick(row, fields),
            attendance_details: projectParkReportDetails(row?.attendance_details,
                PARK_ATTENDANCE_DETAIL_TYPES, PARK_ATTENDANCE_DETAIL_FIELDS),
            task_kpi: row?.task_kpi == null ? null : {
                ...pick(row.task_kpi, ['tasks_assigned', 'tasks_done', 'tasks_overdue']),
                ...projectParkReportDetails(row.task_kpi,
                    ['tasks_assigned_details', 'tasks_done_details', 'tasks_overdue_details'], PARK_TASK_DETAIL_FIELDS)
            }
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
    const taskDetailSql = `jsonb_build_object(
        'id', t.id, 'title', t.title, 'status', t.status,
        'source_type', t.source_type,
        'created_at', t.created_at, 'deadline', t.deadline, 'completed_at', t.completed_at)`;
    const taskOverdueSql = `${taskKpiEligibleSql('t')}
        AND COALESCE(t.status, 'todo') NOT IN ('done', 'completed', 'archived', 'cancelled')
        AND t.deadline IS NOT NULL AND t.deadline < NOW()`;
    const [shifts, records, tasks] = await Promise.all([
        pool.query(`SELECT id, staff_id, shift_date::text AS shift_date, planned_start,
                planned_end, profession_key, shift_type FROM hr_shifts
            WHERE shift_date BETWEEN $1::date AND $2::date AND staff_id = ANY($3::int[])`, params),
        pool.query(`SELECT tr.id, tr.staff_id, tr.record_date::text AS record_date,
                tr.clock_in, tr.clock_out, tr.status, tr.late_minutes,
                tr.early_leave_minutes, tr.overtime_minutes, tr.total_worked_minutes,
                tr.planned_start, tr.planned_end,
                CASE WHEN EXISTS (SELECT 1 FROM hr_shifts hs
                    WHERE hs.staff_id = tr.staff_id AND hs.shift_date = tr.record_date) THEN 'hr_shift'
                    WHEN tr.planned_start IS NOT NULL AND tr.planned_end IS NOT NULL THEN 'profession_card'
                    ELSE 'unscheduled' END AS plan_source
            FROM hr_time_records tr
            WHERE tr.record_date BETWEEN $1::date AND $2::date
                AND tr.business_context = 'event_genix' AND tr.staff_id = ANY($3::int[])`, params),
        pool.query(`SELECT ep.staff_id,
                COUNT(t.id) FILTER (WHERE ${taskKpiEligibleSql('t')})::int AS tasks_assigned,
                COUNT(t.id) FILTER (WHERE ${taskKpiEligibleSql('t')}
                    AND COALESCE(t.status, 'todo') IN ('done', 'completed'))::int AS tasks_done,
                COUNT(t.id) FILTER (WHERE ${taskOverdueSql})::int AS tasks_overdue,
                COALESCE(jsonb_agg(${taskDetailSql} ORDER BY t.id)
                    FILTER (WHERE ${taskKpiEligibleSql('t')}), '[]'::jsonb) AS tasks_assigned_details,
                COALESCE(jsonb_agg(${taskDetailSql} ORDER BY t.id)
                    FILTER (WHERE ${taskKpiEligibleSql('t')}
                        AND COALESCE(t.status, 'todo') IN ('done', 'completed')), '[]'::jsonb) AS tasks_done_details,
                COALESCE(jsonb_agg(${taskDetailSql} ORDER BY t.id)
                    FILTER (WHERE ${taskOverdueSql}), '[]'::jsonb) AS tasks_overdue_details
            FROM tasks t
            JOIN employee_profiles ep ON ep.user_id = t.owner_user_id AND ep.is_active IS TRUE
            WHERE t.business_context = 'event_genix' AND ep.staff_id = ANY($3::int[])
                AND (t.created_at::date BETWEEN $1::date AND $2::date
                    OR t.completed_at::date BETWEEN $1::date AND $2::date)
            GROUP BY ep.staff_id`, params)
    ]);

    const attendanceMap = reportAttendanceByStaff(staff.rows, shifts.rows, records.rows);
    const taskMap = new Map(tasks.rows.map(row => [Number(row.staff_id), {
        tasks_assigned: Number(row.tasks_assigned) || 0,
        tasks_done: Number(row.tasks_done) || 0,
        tasks_overdue: Number(row.tasks_overdue) || 0,
        tasks_assigned_details: row.tasks_assigned_details || [],
        tasks_done_details: row.tasks_done_details || [],
        tasks_overdue_details: row.tasks_overdue_details || []
    }]));
    return staff.rows.map(row => {
        const id = Number(row.id);
        const item = attendanceMap.get(id);
        const task = taskMap.get(id) || { tasks_assigned: 0, tasks_done: 0,
            tasks_overdue: 0, tasks_assigned_details: [], tasks_done_details: [], tasks_overdue_details: [] };
        return {
            staff_id: id, staff_name: row.name,
            days_scheduled: item.days_scheduled, days_worked: item.days_worked,
            planned_worked_count: item.planned_worked_count,
            unplanned_worked_count: item.unplanned_worked_count,
            attendance_details: item.attendance_details,
            days_late: item.days_late, days_early_leave: item.days_early_leave,
            days_absent: item.days_absent, days_sick: item.days_sick,
            days_vacation: item.days_vacation,
            total_worked_hours: item.total_worked_hours,
            total_overtime_hours: item.total_overtime_hours,
            late_count: item.late_count,
            avg_late_minutes: item.avg_late_minutes,
            profession_card_days: item.profession_card_days,
            unscheduled_days: item.unscheduled_days,
            plan_warning_count: item.plan_warning_count,
            attendance_rate: item.attendance_rate,
            task_kpi: task,
            task_data_status: 'ready',
            task_completion_rate: task.tasks_assigned
                ? Math.round(task.tasks_done / task.tasks_assigned * 100) : 0
        };
    });
}

module.exports = { isParkHrMonthlyReportRoute, canReadParkHrMonthlyReport,
    parkMonthlyPeriod, projectParkHrMonthlyReport, loadParkHrMonthlyReport };
