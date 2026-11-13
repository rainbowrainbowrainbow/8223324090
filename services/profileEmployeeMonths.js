'use strict';

const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { loadPayrollPeriodLock } = require('./hrPayrollPeriod');
const { getEmployeePayrollPreview } = require('./payroll');
const { loadPayrollSettlementReadModels } = require('./payrollSettlement');

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
    const [attendance, tasks, checklists, ratings, training] = await Promise.all([
        loadEmployeeAttendance(db, staffId, range),
        db.query(
            `SELECT COUNT(*) FILTER (WHERE t.status = 'done' AND ${within(completed)})::int AS completed,
                    COUNT(*) FILTER (WHERE ${within(deadline)} AND ${deadline} < NOW()
                       AND (t.status <> 'done' OR ${completed} > ${deadline}))::int AS overdue
             FROM tasks t WHERE t.owner_user_id = $1 AND t.business_context = $4
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
            `SELECT created_at AS date, details->>'score' AS score, details->>'comment' AS explanation
             FROM hr_audit_log WHERE staff_id = $1 AND action = 'rating_add'
               AND ${within('created_at')} ORDER BY created_at DESC, id DESC`, params
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
        ratings: ratings.rows,
        coursesCompleted: training.rows
    };
}

async function loadEmployeeResults(db, employee, userId, scope, range) {
    const [current, previous] = await Promise.all([
        loadResultPeriod(db, employee.id, userId, scope, range),
        loadResultPeriod(db, employee.id, userId, scope, {
            month: range.previousFrom.slice(0, 7), from: range.previousFrom, to: range.from
        })
    ]);
    return { state: 'ready', month: range.month, current, previous,
        currentAssignments: employee.profession_assignments || [] };
}

module.exports = { employeeMonthRange, loadEmployeeSalary, loadEmployeeResults };
