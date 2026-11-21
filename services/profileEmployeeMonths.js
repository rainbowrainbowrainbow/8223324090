'use strict';

const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { loadPayrollPeriodLock } = require('./hrPayrollPeriod');
const { getEmployeePayrollPreview } = require('./payroll');
const { loadPayrollSettlementReadModels } = require('./payrollSettlement');
const { taskWorkloadDateSql } = require('./taskCabinetProjection');
const { TASK_ACTION_TYPES } = require('./taskActionConstants');
const { taskKpiCompletionJoinSql, taskKpiPrimaryOwnerSql, taskKpiEligibleSql, taskKpiCompletedSql } = require('./taskPerformancePolicy');

const kyivDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' });

function employeeMonthRange(month) {
    if (typeof month !== 'string' || !/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) return null;
    const [year, index] = month.split('-').map(Number);
    const dateAt = offset => new Date(Date.UTC(year, index - 1 + offset, 1)).toISOString().slice(0, 10);
    return { month, from: dateAt(0), to: dateAt(1), previousFrom: dateAt(-1) };
}

async function loadEmployeeAttendance(db, staffId, { from, to }) {
    const { rows } = await db.query(
        `SELECT record_date::text AS date, planned_start::text AS planned, clock_in AS actual,
                late_minutes AS "lateMinutes", total_worked_minutes AS "workedMinutes", status
         FROM hr_time_records
         WHERE staff_id = $1 AND record_date >= $2::date AND record_date < $3::date
           AND business_context = $4
         ORDER BY record_date`,
        [staffId, from, to, DEFAULT_BUSINESS_CONTEXT]
    );
    return rows;
}

function amount(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
        ? Number(value) : null;
}

function projectPayrollDetail(data = {}) {
    return {
        lines: Array.isArray(data.lines) ? data.lines.map(line => ({
            label: line.label,
            kind: line.lineType || line.line_type,
            amount: amount(line.amount),
            quantity: amount(line.quantity),
            rate: amount(line.rate)
        })) : null,
        rates: Array.isArray(data.professionRateSummary) ? data.professionRateSummary.map(rate => ({
            profession: rate.profession_key || rate.professionKey,
            date: rate.work_date || rate.workDate || null,
            effectiveFrom: rate.effectiveFrom || null,
            effectiveTo: rate.effectiveTo || null,
            unit: rate.rate_unit || rate.rateUnit,
            rate: amount(rate.rate),
            minutes: amount(rate.actual_minutes),
            days: amount(rate.days),
            amount: amount(rate.amount),
            kind: rate.kind
        })) : null,
        shifts: amount(data.metrics?.daysWorked ?? data.daysWorked),
        physicalHours: amount(data.transparency?.physicalHours ?? data.physicalHours),
        baseRoleHours: amount(data.transparency?.baseRoleHours ?? data.baseRoleHours),
        additionalRoleHours: amount(data.transparency?.additionalRoleHours ?? data.additionalRoleHours),
        effectiveFrom: data.scheme?.effectiveFrom || data.schemeEffectiveFrom || null,
        effectiveTo: data.scheme?.effectiveTo || data.schemeEffectiveTo || null,
        hasBlockingIssues: Boolean(data.payrollBlockingIssues?.length)
    };
}

async function loadEmployeeSalary(db, staffId, range) {
    const ownership = await db.query(
        `SELECT EXISTS (SELECT 1 FROM hr_time_records
          WHERE staff_id = $1 AND record_date >= $2::date AND record_date < $3::date
            AND business_context IS DISTINCT FROM $4) AS conflict`,
        [staffId, range.from, range.to, DEFAULT_BUSINESS_CONTEXT]
    );
    if (ownership.rows[0]?.conflict !== false) return { state: 'unavailable', month: range.month };

    const [reportResult, lock, attendance, adjustmentResult] = await Promise.all([
        db.query(`SELECT gross_amount, deductions_amount, advances_amount, net_amount, status,
                         breakdown_json, generated_at, updated_at
                  FROM payroll_reports WHERE staff_id = $1 AND period_month = $2`, [staffId, range.month]),
        loadPayrollPeriodLock(range.month, db),
        loadEmployeeAttendance(db, staffId, range),
        db.query(`SELECT COALESCE(violation_date::text, created_at::date::text) AS date,
                         violation_date::text AS "violationDate", type, amount, reason,
                         COALESCE(status, 'applied') AS status, rule_code AS "ruleCode"
                  FROM salary_adjustments WHERE staff_id = $1 AND month = $2
                  ORDER BY COALESCE(violation_date, created_at::date), id`, [staffId, range.month])
    ]);
    const report = reportResult.rows[0];
    const currentMonth = kyivDate.format(new Date()).slice(0, 7);
    const useSnapshot = lock.is_locked || range.month < currentMonth
        || (report && report.status !== 'draft');
    const calculated = !useSnapshot && range.month === currentMonth
        ? await getEmployeePayrollPreview(staffId, range.month, db)
        : null;
    const preview = calculated && (attendance.length || adjustmentResult.rows.some(row => row.status === 'applied')
        || calculated.lines.some(line => Number(line.amount) !== 0)) ? calculated : null;
    const snapshot = useSnapshot ? report : null;
    const settlement = report ? (await loadPayrollSettlementReadModels(range.month, db, staffId)).reports[0] : null;
    if (settlement?.installments?.some(item => item.businessContext !== DEFAULT_BUSINESS_CONTEXT)) {
        return { state: 'unavailable', month: range.month };
    }
    const totals = settlement?.mode === 'installments' ? settlement.totals : null;
    const paid = totals?.paidAmount ?? (settlement?.mode === 'incomplete' && settlement.installments.length
        ? settlement.totals?.paidAmount : null);
    const late = attendance.filter(row => Number(row.lateMinutes) > 0).map(row => ({
        date: row.date,
        planned: row.planned,
        actual: row.actual,
        minutes: row.lateMinutes,
        adjustments: adjustmentResult.rows
            .filter(item => item.violationDate === row.date && /^DP-0[1-3]$/.test(item.ruleCode || ''))
            .map(item => ({ amount: amount(item.amount), status: item.status }))
    }));
    const detail = projectPayrollDetail(snapshot?.breakdown_json || preview || {});
    return {
        month: range.month,
        state: snapshot || preview ? 'ready' : 'empty',
        status: snapshot?.status || (preview ? 'preview' : null),
        locked: lock.is_locked,
        updatedAt: snapshot?.generated_at || snapshot?.updated_at || (preview ? new Date().toISOString() : null),
        gross: amount(snapshot?.gross_amount ?? preview?.grossAmount),
        deductions: amount(snapshot?.deductions_amount ?? preview?.deductionsAmount),
        advances: amount(snapshot?.advances_amount ?? preview?.advancesAmount),
        net: amount(snapshot?.net_amount ?? preview?.netAmount),
        paid: amount(paid),
        balance: amount(totals?.outstandingAmount),
        legacyAccounted: settlement?.legacy?.legacyAccounted === true,
        detail,
        adjustments: adjustmentResult.rows.map(({ date, type, amount: value, reason, status }) =>
            ({ date, type, amount: amount(value), reason, status })),
        late,
        installments: (settlement?.installments || []).map(item => ({
            kind: item.kind,
            status: item.workflowStatus,
            scheduled: item.scheduledPaymentDate,
            calculated: item.calculatedAmount,
            approved: item.lockedAmount,
            movements: item.movements.map(movement => ({
                kind: movement.movementType,
                date: movement.actualPaymentDate,
                amount: movement.amount
            }))
        }))
    };
}

async function loadResultPeriod(db, staffId, userId, scope, range) {
    const taskParams = [userId, range.from, range.to, scope.activeContext];
    const params = [staffId, range.from, range.to];
    const bounds = [
        "($2::date::timestamp AT TIME ZONE 'Europe/Kyiv')",
        "($3::date::timestamp AT TIME ZONE 'Europe/Kyiv')"
    ];
    const within = column => `${column} >= ${bounds[0]} AND ${column} < ${bounds[1]}`;
    const completed = "(t.completed_at AT TIME ZONE 'UTC')";
    const deadline = "COALESCE(t.scheduled_end_at, t.deadline AT TIME ZONE 'UTC')";
    const [attendance, tasks, checklists, training] = await Promise.all([
        loadEmployeeAttendance(db, staffId, range),
        db.query(
            `SELECT COUNT(*) FILTER (WHERE ${taskKpiCompletedSql()} AND ${within(completed)}
                       AND ${taskKpiPrimaryOwnerSql()} = $1)::int AS completed,
                    COUNT(*) FILTER (WHERE ${taskKpiCompletedSql()} AND ${within(completed)}
                       AND completion.actor_user_id = $1)::int AS "actuallyCompleted",
                    COUNT(*) FILTER (WHERE ${within(deadline)} AND ${deadline} < NOW()
                       AND ${taskKpiPrimaryOwnerSql()} = $1
                       AND (NOT ${taskKpiCompletedSql()} OR ${completed} > ${deadline}))::int AS overdue
             FROM tasks t ${taskKpiCompletionJoinSql()}
             WHERE COALESCE(t.business_context, 'event_genix') = $4
                AND ${taskKpiEligibleSql()}
                AND COALESCE(t.task_mode, 'work') = 'work'
                AND COALESCE(t.visibility, 'team') = 'team'
                AND COALESCE(t.workflow_state, '') NOT IN ('archived', 'cancelled')
                AND COALESCE(t.status, '') NOT IN ('archived', 'cancelled')
                AND ((${within(completed)}) OR (${within(deadline)}))`, taskParams
        ),
        db.query(
            `SELECT COUNT(*)::int AS completed
             FROM hr_staff_profession_checklist_progress
             WHERE staff_id = $1 AND ${within('completed_at')}`, params
        ),
        db.query(
            `SELECT course.title, enrollment.completed_at AS date, course.profession_key AS profession
             FROM training_course_enrollment enrollment
             JOIN training_courses course ON course.id = enrollment.course_id
             WHERE enrollment.staff_id = $1 AND ${within('enrollment.completed_at')}
             ORDER BY enrollment.completed_at DESC`, params
        )
    ]);
    const arrivals = attendance.filter(row => row.actual && row.planned && row.lateMinutes != null);
    const late = arrivals.filter(row => Number(row.lateMinutes) > 0);
    return {
        month: range.month,
        from: range.from,
        through: employeeDateOffset(range.to, -1),
        attendance: {
            daysRecorded: attendance.length,
            present: attendance.filter(row => row.actual).length,
            absent: attendance.filter(row => ['absent', 'no_show'].includes(row.status)).length,
            measuredArrivals: arrivals.length,
            onTime: arrivals.length - late.length,
            late: late.length,
            lateMinutes: late.reduce((sum, row) => sum + Number(row.lateMinutes), 0)
        },
        tasks: tasks.rows[0],
        checklistCompleted: checklists.rows[0].completed,
        coursesCompleted: training.rows
    };
}

function employeeDateOffset(date, days) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

function employeeComparisonRanges(range, today) {
    let current = range;
    let previousTo = range.from;
    if (today >= range.from && today < range.to) {
        const comparableDays = Math.min(Number(today.slice(-2)), Number(employeeDateOffset(range.from, -1).slice(-2)));
        current = { ...range, to: employeeDateOffset(range.from, comparableDays) };
        previousTo = employeeDateOffset(range.previousFrom, comparableDays);
    }
    return [current, { month: range.previousFrom.slice(0, 7), from: range.previousFrom, to: previousTo }];
}

async function loadDailyTaskResults(db, userId, scope, today) {
    const start = employeeDateOffset(today, -6);
    const completedAt = "(t.completed_at AT TIME ZONE 'UTC')";
    const completedDate = `(${completedAt} AT TIME ZONE 'Europe/Kyiv')::date`;
    const from = "($3::date::timestamp AT TIME ZONE 'Europe/Kyiv')";
    const through = "(($4::date + 1)::timestamp AT TIME ZONE 'Europe/Kyiv')";
    const { rows } = await db.query(
        `WITH days AS (
             SELECT $3::date + i AS date FROM generate_series(0, 6) AS series(i)
         ), completed AS (
             SELECT ${completedDate} AS date,
                    COUNT(*) FILTER (WHERE classified.personal)::int AS personal,
                    COUNT(*) FILTER (WHERE NOT classified.personal)::int AS work
             FROM tasks t
             CROSS JOIN LATERAL (SELECT (
                 COALESCE(t.task_mode, 'work') IN ('personal', 'private')
                 OR COALESCE(t.visibility, 'team') = 'me_only'
                 OR COALESCE(t.category, '') = 'personal'
             ) AS personal) classified
             LEFT JOIN LATERAL (
                 SELECT h.actor_user_id FROM task_action_history h
                 WHERE h.task_id = t.id AND h.action_type = $5
                 ORDER BY h.created_at DESC, h.id DESC LIMIT 1
             ) completion ON true
             WHERE t.owner_user_id = $1 AND t.business_context = $2
               AND t.status = 'done'
               AND ${completedAt} >= ${from} AND ${completedAt} < ${through}
               AND COALESCE(completion.actor_user_id, t.owner_user_id) = $1
             GROUP BY 1
         ), overdue AS (
             SELECT COUNT(*)::int AS count
             FROM tasks t
             WHERE t.owner_user_id = $1 AND t.business_context = $2
               AND COALESCE(t.status, 'todo') NOT IN ('done', 'archived', 'cancelled')
               AND COALESCE(t.workflow_state, '') NOT IN ('done', 'archived', 'cancelled')
               AND ${taskWorkloadDateSql()} < $4::date
         )
         SELECT days.date::text AS date, COALESCE(completed.work, 0)::int AS work,
                COALESCE(completed.personal, 0)::int AS personal, overdue.count AS overdue
         FROM days CROSS JOIN overdue LEFT JOIN completed ON completed.date = days.date
         ORDER BY days.date`,
        [userId, scope.activeContext, start, today, TASK_ACTION_TYPES.COMPLETED]
    );
    return {
        days: rows.map(({ date, work, personal }) => ({ date, work, personal })),
        overdue: rows[0]?.overdue || 0
    };
}

async function loadEmployeeResults(db, employee, userId, scope, range, options = {}) {
    const today = kyivDate.format(options.now || new Date());
    const [currentRange, previousRange] = employeeComparisonRanges(range, today);
    const [current, previous, dailyTasks, substitutions] = await Promise.all([
        loadResultPeriod(db, employee.id, userId, scope, currentRange),
        loadResultPeriod(db, employee.id, userId, scope, previousRange),
        loadDailyTaskResults(db, userId, scope, today),
        scope.activeContext === DEFAULT_BUSINESS_CONTEXT ? db.query(
            `SELECT id::text AS id, work_date::text AS date, state,
                    CASE WHEN staff_id = $1 THEN 'replacement' ELSE 'original' END AS role,
                    (source_type = 'hr_shift' AND slot_key = 'partial') AS partial,
                    input_json->>'professionKey' AS "professionKey",
                    ARRAY(
                        SELECT role.value->>'professionKey'
                        FROM jsonb_array_elements(CASE
                            WHEN source_type = 'hr_shift' AND slot_key = 'partial'
                              AND jsonb_typeof(source_snapshot->'simultaneousRoles') = 'array'
                            THEN source_snapshot->'simultaneousRoles' ELSE '[]'::jsonb END
                        ) WITH ORDINALITY AS role(value, position)
                        WHERE jsonb_typeof(role.value->'professionKey') = 'string'
                        ORDER BY role.position
                    ) AS "simultaneousProfessionKeys"
             FROM staff_substitutions
             WHERE business_context = $4 AND (staff_id = $1 OR original_staff_id = $1)
               AND work_date >= $2::date AND work_date < $3::date
             ORDER BY work_date DESC, staff_substitutions.id DESC`,
            [employee.id, range.from, range.to, DEFAULT_BUSINESS_CONTEXT]
        ) : null
    ]);
    return { state: 'ready', month: range.month, current, previous, dailyTasks,
        currentAssignments: employee.profession_assignments || [],
        ...(substitutions ? { substitutions: substitutions.rows } : {}) };
}

module.exports = { employeeMonthRange, loadEmployeeSalary, loadEmployeeResults, employeeComparisonRanges };
