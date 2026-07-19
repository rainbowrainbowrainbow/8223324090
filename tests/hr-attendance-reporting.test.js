const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    HR_ATTENDANCE_GRACE_MINUTES,
    attendanceCsvRow,
    attendanceFactMinutes,
    attendancePlanWarningMessage,
    attendanceReportingFacts,
    calculateHrClockOutPayroll,
    decorateAttendanceRecord
} = require('../services/hrAttendance');

const ROOT = path.join(__dirname, '..');
const HR_ROUTE = fs.readFileSync(path.join(ROOT, 'routes', 'hr.js'), 'utf8');

function sourceBlock(source, startToken, endToken) {
    const start = source.indexOf(startToken);
    assert.notEqual(start, -1, `missing ${startToken}`);
    const end = source.indexOf(endToken, start);
    assert.notEqual(end, -1, `missing ${endToken}`);
    return source.slice(start, end);
}

test('HR KPI snapshot normalizes attendance overtime grace instead of raw historical minutes', () => {
    const grace = HR_ATTENDANCE_GRACE_MINUTES.overtime;
    const helperBlock = sourceBlock(HR_ROUTE, 'function attendanceKpiOvertimeMinutesSql', 'function redactPayrollAuditValue');
    const kpiBlock = sourceBlock(HR_ROUTE, 'async function loadKpiSnapshot', 'function normalizeAuditValue');
    const normalizeKpiOvertime = minutes => (minutes > grace ? minutes : 0);

    assert.match(helperBlock, /HR_ATTENDANCE_GRACE_MINUTES\.overtime/);
    assert.match(kpiBlock, /SUM\(\$\{attendanceKpiOvertimeMinutesSql\('tr'\)\}\)/);
    assert.doesNotMatch(kpiBlock, /SUM\(tr\.overtime_minutes\)/);
    assert.equal(normalizeKpiOvertime(0), 0);
    assert.equal(normalizeKpiOvertime(15), 0);
    assert.equal(normalizeKpiOvertime(16), 16);
    assert.equal([15, 16].reduce((sum, minutes) => sum + normalizeKpiOvertime(minutes), 0), 16);
    assert.equal([16].reduce((sum, minutes) => sum + normalizeKpiOvertime(minutes), 0), 16);
    assert.equal([16, 0].reduce((sum, minutes) => sum + normalizeKpiOvertime(minutes), 0), 16);
});

test('attendance reporting keeps late, early leave, and overtime as independent facts', () => {
    const facts = attendanceReportingFacts({
        status: 'left_early',
        late_minutes: 6,
        early_leave_minutes: 25,
        overtime_minutes: 20,
        planned_start: '09:00',
        planned_end: '18:00',
        plan_source: 'hr_shift'
    });

    assert.equal(facts.isLate, true);
    assert.equal(facts.isEarlyLeave, true);
    assert.equal(facts.hasOvertime, true);
    assert.equal(facts.lateMinutes, 6);
    assert.equal(facts.earlyLeaveMinutes, 25);
    assert.equal(facts.overtimeMinutes, 20);
    assert.equal(facts.planSource, 'hr_shift');
    assert.equal(facts.planWarning, null);
});

test('attendance reporting ignores one-to-fifteen minute overtime values', () => {
    const withinGrace = attendanceReportingFacts({
        overtime_minutes: 15,
        planned_start: '09:00',
        planned_end: '18:00'
    });
    const overGrace = attendanceReportingFacts({
        overtime_minutes: 16,
        planned_start: '09:00',
        planned_end: '18:00'
    });

    assert.equal(attendanceFactMinutes({ overtime_minutes: 15 }).overtimeMinutes, 0);
    assert.equal(withinGrace.hasOvertime, false);
    assert.equal(withinGrace.overtimeMinutes, 0);
    assert.equal(overGrace.hasOvertime, true);
    assert.equal(overGrace.overtimeMinutes, 16);
});

test('attendance reporting does not count the five-minute grace period as late', () => {
    const decorated = decorateAttendanceRecord({
        record_date: '2026-07-16',
        status: 'late',
        late_minutes: 5,
        early_leave_minutes: 30,
        overtime_minutes: 0,
        planned_start: '09:00',
        planned_end: '18:00',
        plan_source: 'profession_card'
    });

    assert.equal(decorated.is_late, false);
    assert.equal(decorated.is_early_leave, true);
    assert.equal(decorated.attendance_facts.lateMinutes, 0);
    assert.equal(decorated.attendance_facts.earlyLeaveMinutes, 30);
    assert.equal(decorated.plan_source, 'profession_card');
    assert.equal(decorated.plan_warning.code, 'PROFESSION_CARD_FALLBACK');
});

test('attendance decorator keeps attendance overtime separate from allocation overtime', () => {
    const decorated = decorateAttendanceRecord({
        record_date: '2026-07-13',
        clock_in: '2026-07-13T05:55:00.000Z', // 08:55 Europe/Kyiv
        clock_out: '2026-07-13T15:00:00.000Z', // 18:00 Europe/Kyiv
        status: 'present',
        late_minutes: 0,
        early_leave_minutes: 0,
        overtime_minutes: 0,
        planned_start: '09:00',
        planned_end: '18:00',
        plan_source: 'hr_shift'
    });

    assert.equal(decorated.overtime_minutes, 0);
    assert.equal(decorated.overtimeMinutes, 0);
    assert.equal(decorated.attendance_facts.overtimeMinutes, 0);
    assert.equal(decorated.has_overtime, false);
    assert.equal(decorated.allocation_overtime_minutes, 5);
    assert.equal(decorated.allocationOvertimeMinutes, 5);
    assert.deepEqual(decorated.overtime_allocation, {
        professionKey: null,
        actualMinutes: 5
    });
});

test('attendance surfaces report the same overtime facts while preserving allocation overtime', () => {
    const rawRows = [
        {
            staff_id: 1,
            record_date: '2026-07-13',
            clock_in: '2026-07-13T05:55:00.000Z',
            clock_out: '2026-07-13T15:00:00.000Z',
            planned_start: '09:00',
            planned_end: '18:00',
            late_minutes: 0,
            early_leave_minutes: 0,
            overtime_minutes: 0
        },
        {
            staff_id: 2,
            record_date: '2026-07-13',
            clock_in: '2026-07-13T06:00:00.000Z',
            clock_out: '2026-07-13T15:36:00.000Z',
            planned_start: '09:00',
            planned_end: '18:00',
            late_minutes: 0,
            early_leave_minutes: 0,
            overtime_minutes: 36
        },
        {
            staff_id: 3,
            record_date: '2026-07-13',
            clock_in: '2026-07-13T06:00:00.000Z',
            clock_out: '2026-07-13T15:15:00.000Z',
            planned_start: '09:00',
            planned_end: '18:00',
            late_minutes: 0,
            early_leave_minutes: 0,
            overtime_minutes: 15
        }
    ];
    const apiRows = rawRows.map(row => decorateAttendanceRecord(row));
    const metrics = rows => rows.reduce((acc, row) => {
        const facts = attendanceFactMinutes(row);
        if (facts.overtimeMinutes > 0) acc.count += 1;
        acc.minutes += facts.overtimeMinutes;
        return acc;
    }, { count: 0, minutes: 0 });
    const surfaces = {
        today: metrics(apiRows),
        daily: metrics(apiRows),
        staffAttendance: metrics(apiRows),
        monthly: metrics(rawRows),
        csv: metrics(rawRows)
    };

    assert.deepEqual(surfaces.today, { count: 1, minutes: 36 });
    assert.deepEqual(surfaces, {
        today: surfaces.today,
        daily: surfaces.today,
        staffAttendance: surfaces.today,
        monthly: surfaces.today,
        csv: surfaces.today
    });
    assert.equal(apiRows[0].overtime_minutes, 0);
    assert.equal(apiRows[0].allocation_overtime_minutes, 5);
    assert.equal(apiRows[2].overtime_minutes, 0);
    assert.equal(apiRows[2].allocation_overtime_minutes, 15);
});

test('attendance reporting explicitly warns when no plan exists', () => {
    const facts = attendanceReportingFacts({
        late_minutes: 0,
        early_leave_minutes: 0,
        overtime_minutes: 0
    });

    assert.equal(facts.planSource, 'unscheduled');
    assert.equal(facts.planWarning.code, 'ATTENDANCE_UNSCHEDULED');
    assert.equal(facts.planWarning.message, 'Для працівника не задано плановий час');
    assert.equal(facts.plannedStart, null);
    assert.equal(facts.plannedEnd, null);
});

function splitSemicolonCsvLine(line) {
    const cells = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === ';' && !quoted) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells;
}

test('attendance CSV escaping preserves column count and neutralizes formulas', () => {
    const cells = [
        '=HYPERLINK("http://bad")',
        '+SUM(1,2)',
        '-10',
        '@cmd',
        'name;with;semicolons',
        'quote "inside"',
        'line\nbreak',
        'normal'
    ];
    const line = attendanceCsvRow(cells);
    const parsed = splitSemicolonCsvLine(line);

    assert.equal(parsed.length, cells.length);
    assert.equal(parsed[0], '\'=HYPERLINK("http://bad")');
    assert.equal(parsed[1], "'+SUM(1,2)");
    assert.equal(parsed[2], "'-10");
    assert.equal(parsed[3], "'@cmd");
    assert.equal(parsed[4], 'name;with;semicolons');
    assert.equal(parsed[5], 'quote "inside"');
    assert.equal(parsed[6], 'line\nbreak');
});

test('attendance regression matrix keeps source, boundary, combo and report facts stable', () => {
    assert.equal(attendanceReportingFacts({}).planSource, 'unscheduled');
    assert.equal(attendancePlanWarningMessage('unscheduled'), 'Для працівника не задано плановий час');
    assert.equal(attendanceReportingFacts({
        planned_start: '09:00',
        planned_end: '18:00',
        plan_source: 'profession_card'
    }).planWarning.message, 'План дня взято з картки основної професії');
    assert.equal(attendanceReportingFacts({
        planned_start: '09:00',
        planned_end: '18:00',
        plan_source: 'hr_shift'
    }).planWarning, null);

    assert.equal(attendanceFactMinutes({ late_minutes: 5 }).lateMinutes, 0);
    assert.equal(attendanceFactMinutes({ late_minutes: 6 }).lateMinutes, 6);

    const base = {
        record_date: '2026-07-17',
        clock_in: '2026-07-17T06:00:00.000Z',
        planned_start: '09:00',
        planned_end: '18:00',
        late_minutes: 0,
        status: 'present'
    };
    assert.equal(calculateHrClockOutPayroll(base, {
        clockOut: '2026-07-17T14:45:00.000Z',
        recordDate: '2026-07-17'
    }).earlyLeaveMinutes, 0);
    assert.equal(calculateHrClockOutPayroll(base, {
        clockOut: '2026-07-17T14:44:00.000Z',
        recordDate: '2026-07-17'
    }).earlyLeaveMinutes, 16);
    assert.equal(calculateHrClockOutPayroll(base, {
        clockOut: '2026-07-17T15:15:00.000Z',
        recordDate: '2026-07-17'
    }).overtimeMinutes, 0);
    assert.equal(calculateHrClockOutPayroll(base, {
        clockOut: '2026-07-17T15:16:00.000Z',
        recordDate: '2026-07-17'
    }).overtimeMinutes, 16);

    const allocationOnly = decorateAttendanceRecord({
        ...base,
        clock_in: '2026-07-17T05:55:00.000Z',
        clock_out: '2026-07-17T15:00:00.000Z',
        overtime_minutes: 0
    });
    assert.equal(allocationOnly.overtime_minutes, 0);
    assert.equal(allocationOnly.allocation_overtime_minutes, 5);

    const lateAndEarly = calculateHrClockOutPayroll({
        ...base,
        clock_in: '2026-07-17T06:10:00.000Z',
        late_minutes: 10,
        status: 'late'
    }, {
        clockOut: '2026-07-17T14:44:00.000Z',
        recordDate: '2026-07-17'
    });
    assert.equal(lateAndEarly.lateMinutes, 10);
    assert.equal(lateAndEarly.earlyLeaveMinutes, 16);

    const lateAndOvertime = calculateHrClockOutPayroll({
        ...base,
        clock_in: '2026-07-17T06:10:00.000Z',
        late_minutes: 10,
        status: 'late'
    }, {
        clockOut: '2026-07-17T15:16:00.000Z',
        recordDate: '2026-07-17'
    });
    assert.equal(lateAndOvertime.lateMinutes, 10);
    assert.equal(lateAndOvertime.overtimeMinutes, 16);

    const overnight = calculateHrClockOutPayroll({
        record_date: '2026-07-17',
        clock_in: '2026-07-17T19:10:00.000Z',
        planned_start: '22:00',
        planned_end: '02:00',
        late_minutes: 10,
        status: 'late'
    }, {
        clockOut: '2026-07-17T22:30:00.000Z',
        recordDate: '2026-07-17',
        settlementMode: 'scheduled_shift'
    });
    assert.equal(overnight.lateMinutes, 10);
    assert.equal(overnight.earlyLeaveMinutes, 30);
    assert.equal(overnight.totalWorkedMinutes, 240);
});
