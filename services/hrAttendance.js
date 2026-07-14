const {
    HR_SHIFT_BREAK_POLICY,
    hydrateHrShiftDayPlans
} = require('./hrShiftSegments');

const MINUTES_PER_DAY = 24 * 60;
const KYIV_TIME_ZONE = 'Europe/Kyiv';
// MVP policy: a segment's break is deducted only when the actual interval touches
// that segment, and never by more than the touched minutes. Exact break windows
// require a separate protected schema decision.
const HR_ATTENDANCE_BREAK_POLICY = HR_SHIFT_BREAK_POLICY;
const kyivDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KYIV_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
});

function normalizeNonNegativeMinutes(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return 0;
    return Math.max(0, Math.round(minutes));
}

function optionalNonNegativeMinutes(value) {
    if (value === undefined || value === null || value === '') return null;
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return null;
    return normalizeNonNegativeMinutes(minutes);
}

function timeToMinutes(value) {
    if (!value) return null;
    const parts = String(value).split(':');
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function plannedShiftWorkedMinutes(plannedStart, plannedEnd, breakMinutes = 0) {
    const start = timeToMinutes(plannedStart);
    const end = timeToMinutes(plannedEnd);
    if (start === null || end === null) return null;

    let duration = end - start;
    if (duration < 0) duration += 24 * 60;

    return Math.max(0, duration - normalizeNonNegativeMinutes(breakMinutes));
}

function dateOnly(value) {
    if (typeof value === 'string') {
        const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];
    }
    const parts = kyivDateTimeParts(value);
    return parts ? parts.date : null;
}

function kyivDateTimeParts(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = Object.fromEntries(
        kyivDateTimeFormatter.formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
    );
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);
    if (![year, month, day, hour, minute].every(Number.isInteger)) return null;
    return {
        date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        year,
        month,
        day,
        hour,
        minute
    };
}

function civilDayNumber(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

function timestampToTimelineMinutes(value, recordDate) {
    const parts = kyivDateTimeParts(value);
    const baseDay = civilDayNumber(dateOnly(recordDate));
    const actualDay = parts ? civilDayNumber(parts.date) : null;
    if (!parts || baseDay === null || actualDay === null) return null;
    return ((actualDay - baseDay) * MINUTES_PER_DAY) + (parts.hour * 60) + parts.minute;
}

function normalizeAttendanceSegments(input = {}) {
    const source = Array.isArray(input.segments) ? input.segments : [];
    const segments = source.length ? source : (
        input.plannedStart && input.plannedEnd
            ? [{
                id: null,
                professionKey: input.primaryProfessionKey || null,
                shiftStart: input.plannedStart,
                shiftEnd: input.plannedEnd,
                breakMinutes: input.breakMinutes || 0,
                additionalProfessionKeys: []
            }]
            : []
    );

    return segments.map((segment, index) => {
        const shiftStart = segment.shiftStart || segment.shift_start || segment.planned_start;
        const shiftEnd = segment.shiftEnd || segment.shift_end || segment.planned_end;
        const startMinutes = timeToMinutes(shiftStart);
        const rawEndMinutes = timeToMinutes(shiftEnd);
        if (startMinutes === null || rawEndMinutes === null || rawEndMinutes === startMinutes) return null;
        const endMinutes = rawEndMinutes <= startMinutes ? rawEndMinutes + MINUTES_PER_DAY : rawEndMinutes;
        const breakMinutes = Math.min(
            endMinutes - startMinutes,
            normalizeNonNegativeMinutes(segment.breakMinutes ?? segment.break_minutes)
        );
        const professionKey = segment.professionKey || segment.profession_key || input.primaryProfessionKey || null;
        const additionalProfessionKeys = Array.isArray(segment.additionalProfessionKeys)
            ? segment.additionalProfessionKeys
            : (Array.isArray(segment.additional_profession_keys) ? segment.additional_profession_keys : []);
        return {
            id: segment.id ?? null,
            professionKey,
            shiftStart: String(shiftStart).slice(0, 5),
            shiftEnd: String(shiftEnd).slice(0, 5),
            breakMinutes,
            additionalProfessionKeys: [...new Set(additionalProfessionKeys.filter(Boolean))],
            startMinutes,
            endMinutes,
            durationMinutes: endMinutes - startMinutes,
            plannedMinutes: Math.max(0, (endMinutes - startMinutes) - breakMinutes),
            sortOrder: Number.isInteger(segment.sortOrder) ? segment.sortOrder : index
        };
    }).filter(Boolean).sort((left, right) => (
        left.startMinutes - right.startMinutes
        || left.endMinutes - right.endMinutes
        || left.sortOrder - right.sortOrder
    ));
}

function paidMinutesAfterSegmentBreak(overlapMinutes, breakMinutes) {
    const overlap = normalizeNonNegativeMinutes(overlapMinutes);
    const segmentBreak = normalizeNonNegativeMinutes(breakMinutes);
    return Math.max(0, overlap - Math.min(overlap, segmentBreak));
}

function allocateIntegerProportion(totalMinutes, segments) {
    const total = normalizeNonNegativeMinutes(totalMinutes);
    const weightTotal = segments.reduce((sum, segment) => sum + segment.plannedMinutes, 0);
    if (!total || !weightTotal) return segments.map(() => 0);
    const raw = segments.map(segment => (total * segment.plannedMinutes) / weightTotal);
    const allocated = raw.map(Math.floor);
    let remainder = total - allocated.reduce((sum, value) => sum + value, 0);
    const priority = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
        .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
    for (let index = 0; remainder > 0; index = (index + 1) % priority.length) {
        allocated[priority[index].index] += 1;
        remainder -= 1;
    }
    return allocated;
}

function attendanceIssue(code, message, details = {}) {
    return { code, message, severity: 'warning', ...details };
}

function segmentAllocationPayload(segment, actualMinutes, overlapMinutes = null) {
    return {
        segmentId: segment.id,
        professionKey: segment.professionKey,
        shiftStart: segment.shiftStart,
        shiftEnd: segment.shiftEnd,
        breakMinutes: segment.breakMinutes,
        plannedMinutes: segment.plannedMinutes,
        actualMinutes: normalizeNonNegativeMinutes(actualMinutes),
        overlapMinutes: overlapMinutes === null ? null : normalizeNonNegativeMinutes(overlapMinutes),
        additionalProfessionKeys: segment.additionalProfessionKeys
    };
}

function emptyAttendanceAllocation(segments, primaryProfessionKey, source = 'none') {
    const plannedMinutes = segments.reduce((sum, segment) => sum + segment.plannedMinutes, 0);
    return {
        segmentAllocations: segments.map(segment => segmentAllocationPayload(segment, 0)),
        plannedMinutes,
        actualMinutes: 0,
        allocatedMinutes: 0,
        overtimeMinutes: 0,
        unallocatedGapMinutes: 0,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        allocationSource: source,
        breakPolicy: HR_ATTENDANCE_BREAK_POLICY,
        allocationIssues: [],
        overtimeAllocation: null,
        primaryProfessionKey: primaryProfessionKey || null
    };
}

function allocateAttendanceToSegments(input = {}) {
    const primaryProfessionKey = input.primaryProfessionKey || input.primary_profession_key || null;
    const segments = normalizeAttendanceSegments({
        segments: input.segments,
        plannedStart: input.plannedStart || input.planned_start,
        plannedEnd: input.plannedEnd || input.planned_end,
        breakMinutes: input.breakMinutes ?? input.break_minutes,
        primaryProfessionKey
    });
    const plannedMinutes = segments.reduce((sum, segment) => sum + segment.plannedMinutes, 0);
    const base = emptyAttendanceAllocation(segments, primaryProfessionKey);
    const recordDate = dateOnly(input.recordDate || input.record_date);
    const clockIn = input.clockIn || input.clock_in;
    const clockOut = input.clockOut || input.clock_out;
    const clockInDate = clockIn ? new Date(clockIn) : null;
    const clockOutDate = clockOut ? new Date(clockOut) : null;
    const hasReliableInterval = Boolean(
        recordDate
        && clockInDate
        && clockOutDate
        && !Number.isNaN(clockInDate.getTime())
        && !Number.isNaN(clockOutDate.getTime())
        && clockOutDate.getTime() > clockInDate.getTime()
    );

    if (hasReliableInterval) {
        const actualStart = timestampToTimelineMinutes(clockInDate, recordDate);
        const actualEnd = timestampToTimelineMinutes(clockOutDate, recordDate);
        if (actualStart !== null && actualEnd !== null && actualEnd > actualStart) {
            const rawOverlaps = segments.map(segment => Math.max(
                0,
                Math.min(actualEnd, segment.endMinutes) - Math.max(actualStart, segment.startMinutes)
            ));
            const paidAllocations = rawOverlaps.map((overlap, index) => (
                paidMinutesAfterSegmentBreak(overlap, segments[index].breakMinutes)
            ));
            const allocatedMinutes = paidAllocations.reduce((sum, value) => sum + value, 0);
            const envelopeStart = segments[0]?.startMinutes ?? null;
            const envelopeEnd = segments.length
                ? Math.max(...segments.map(segment => segment.endMinutes))
                : null;
            let overtimeMinutes = 0;
            let unallocatedGapMinutes = 0;
            let lateMinutes = 0;
            let earlyLeaveMinutes = 0;
            if (envelopeStart === null || envelopeEnd === null) {
                overtimeMinutes = Math.max(0, actualEnd - actualStart);
            } else {
                const beforeEnvelope = Math.max(0, Math.min(actualEnd, envelopeStart) - actualStart);
                const afterEnvelope = Math.max(0, actualEnd - Math.max(actualStart, envelopeEnd));
                overtimeMinutes = beforeEnvelope + afterEnvelope;
                const insideEnvelope = Math.max(
                    0,
                    Math.min(actualEnd, envelopeEnd) - Math.max(actualStart, envelopeStart)
                );
                const rawSegmentMinutes = rawOverlaps.reduce((sum, value) => sum + value, 0);
                unallocatedGapMinutes = Math.max(0, insideEnvelope - rawSegmentMinutes);
                lateMinutes = actualStart > envelopeStart
                    ? Math.max(0, Math.min(actualStart, envelopeEnd) - envelopeStart)
                    : 0;
                earlyLeaveMinutes = actualEnd < envelopeEnd
                    ? Math.max(0, envelopeEnd - Math.max(actualEnd, envelopeStart))
                    : 0;
            }
            const allocationIssues = [];
            if (overtimeMinutes > 0) {
                allocationIssues.push(attendanceIssue(
                    'ACTUAL_TIME_OUTSIDE_PLANNED_SEGMENTS',
                    'Фактичний час поза межами плану віднесено до основної професії дня',
                    { overtimeMinutes, professionKey: primaryProfessionKey }
                ));
            }
            if (!segments.length && overtimeMinutes > 0) {
                allocationIssues.push(attendanceIssue(
                    'PLANNED_SEGMENTS_MISSING',
                    'Для attendance немає надійного плану сегментів; потрібна ручна перевірка'
                ));
            }
            return {
                segmentAllocations: segments.map((segment, index) => (
                    segmentAllocationPayload(segment, paidAllocations[index], rawOverlaps[index])
                )),
                plannedMinutes,
                actualMinutes: allocatedMinutes + overtimeMinutes,
                allocatedMinutes,
                overtimeMinutes,
                unallocatedGapMinutes,
                lateMinutes,
                earlyLeaveMinutes,
                allocationSource: 'clock_interval',
                breakPolicy: HR_ATTENDANCE_BREAK_POLICY,
                allocationIssues,
                overtimeAllocation: overtimeMinutes > 0 ? {
                    professionKey: primaryProfessionKey,
                    actualMinutes: overtimeMinutes
                } : null,
                primaryProfessionKey
            };
        }
    }

    const recordedTotalMinutes = optionalNonNegativeMinutes(
        input.totalWorkedMinutes ?? input.total_worked_minutes
    );
    if (recordedTotalMinutes !== null && recordedTotalMinutes > 0) {
        const allocatedTarget = Math.min(recordedTotalMinutes, plannedMinutes);
        const paidAllocations = allocateIntegerProportion(allocatedTarget, segments);
        const allocatedMinutes = paidAllocations.reduce((sum, value) => sum + value, 0);
        const overtimeMinutes = Math.max(0, recordedTotalMinutes - allocatedMinutes);
        const allocationIssues = [attendanceIssue(
            'ATTENDANCE_PROPORTIONAL_FALLBACK',
            'Фактичний інтервал ненадійний; години розподілено пропорційно до плану й потрібна звірка'
        )];
        if (!segments.length) {
            allocationIssues.push(attendanceIssue(
                'PLANNED_SEGMENTS_MISSING',
                'Немає сегментів для пропорційного розподілу; весь час потребує ручної перевірки'
            ));
        }
        return {
            segmentAllocations: segments.map((segment, index) => (
                segmentAllocationPayload(segment, paidAllocations[index] || 0)
            )),
            plannedMinutes,
            actualMinutes: recordedTotalMinutes,
            allocatedMinutes,
            overtimeMinutes,
            unallocatedGapMinutes: 0,
            lateMinutes: 0,
            earlyLeaveMinutes: 0,
            allocationSource: 'proportional_fallback',
            breakPolicy: HR_ATTENDANCE_BREAK_POLICY,
            allocationIssues,
            overtimeAllocation: overtimeMinutes > 0 ? {
                professionKey: primaryProfessionKey,
                actualMinutes: overtimeMinutes
            } : null,
            primaryProfessionKey
        };
    }

    return {
        ...base,
        allocationSource: clockIn && !clockOut ? 'pending_clock_out' : 'none'
    };
}

function attendanceAllocationFields(allocation) {
    return {
        segmentAllocations: allocation.segmentAllocations,
        segment_allocations: allocation.segmentAllocations,
        plannedMinutes: allocation.plannedMinutes,
        planned_minutes: allocation.plannedMinutes,
        actualMinutes: allocation.actualMinutes,
        actual_minutes: allocation.actualMinutes,
        allocatedMinutes: allocation.allocatedMinutes,
        allocated_minutes: allocation.allocatedMinutes,
        overtimeMinutes: allocation.overtimeMinutes,
        overtime_minutes: allocation.overtimeMinutes,
        unallocatedGapMinutes: allocation.unallocatedGapMinutes,
        unallocated_gap_minutes: allocation.unallocatedGapMinutes,
        allocationSource: allocation.allocationSource,
        allocation_source: allocation.allocationSource,
        breakPolicy: allocation.breakPolicy,
        break_policy: allocation.breakPolicy,
        allocationIssues: allocation.allocationIssues,
        allocation_issues: allocation.allocationIssues,
        overtimeAllocation: allocation.overtimeAllocation,
        overtime_allocation: allocation.overtimeAllocation
    };
}

function decorateAttendanceRecord(record = {}, loadedShift = null) {
    const plan = loadedShift?.plan || loadedShift || null;
    const shift = loadedShift?.shift || {};
    const allocation = allocateAttendanceToSegments({
        recordDate: record.record_date || record.date,
        clockIn: record.clock_in || record.checkin_at,
        clockOut: record.clock_out || record.checkout_at,
        totalWorkedMinutes: record.total_worked_minutes,
        segments: plan?.segments,
        primaryProfessionKey: plan?.primaryProfessionKey || shift.profession_key || record.primary_profession_key,
        plannedStart: record.planned_start || shift.planned_start,
        plannedEnd: record.planned_end || shift.planned_end,
        breakMinutes: shift.break_minutes || 0
    });
    return { ...record, ...attendanceAllocationFields(allocation) };
}

async function hydrateAttendanceRecords(db, rows = []) {
    const records = Array.isArray(rows) ? rows : [];
    if (!records.length) return [];
    const staffIds = [...new Set(records.map(row => Number(row.staff_id)).filter(Number.isInteger))];
    const dates = records.map(row => dateOnly(row.record_date || row.date)).filter(Boolean).sort();
    if (!staffIds.length || !dates.length) return records.map(row => decorateAttendanceRecord(row));
    const shifts = await db.query(
        `SELECT * FROM hr_shifts
         WHERE staff_id = ANY($1::int[])
           AND shift_date BETWEEN $2::date AND $3::date
         ORDER BY staff_id, shift_date, id`,
        [staffIds, dates[0], dates[dates.length - 1]]
    );
    const hydrated = await hydrateHrShiftDayPlans(db, shifts.rows);
    const byStaffDate = new Map(hydrated.map(snapshot => [
        `${Number(snapshot.shift.staff_id)}_${dateOnly(snapshot.shift.shift_date)}`,
        snapshot
    ]));
    return records.map(row => decorateAttendanceRecord(
        row,
        byStaffDate.get(`${Number(row.staff_id)}_${dateOnly(row.record_date || row.date)}`) || null
    ));
}

function actualWorkedMinutes(clockIn, clockOut, breakMinutes = 0) {
    const start = new Date(clockIn);
    const end = new Date(clockOut);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

    return Math.max(0, Math.round((end - start) / 60000) - normalizeNonNegativeMinutes(breakMinutes));
}

function normalizeHrSettlementMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (['scheduled', 'planned', 'planned_shift', 'scheduled_shift'].includes(mode)) {
        return 'scheduled_shift';
    }
    return 'actual_time';
}

function plannedEndDeltaMinutes(plannedEnd, kyivNow) {
    const end = timeToMinutes(plannedEnd);
    if (end === null || !(kyivNow instanceof Date) || Number.isNaN(kyivNow.getTime())) return null;

    const now = kyivNow.getHours() * 60 + kyivNow.getMinutes();
    let diff = end - now;
    if (diff > 12 * 60) diff -= 24 * 60;
    if (diff < -12 * 60) diff += 24 * 60;
    return diff;
}

function normalizedClosedStatus(status) {
    if (status === 'late') return 'late';
    if (status === 'present' || status === 'unscheduled' || status === 'clocked_in') return 'present';
    return status || 'present';
}

function calculateHrClockOutPayroll(record = {}, options = {}) {
    const clockIn = options.clockIn || record.clock_in;
    const clockOut = options.clockOut || new Date().toISOString();
    const breakMinutes = normalizeNonNegativeMinutes(options.breakMinutes);
    const plannedStart = options.plannedStart || record.planned_start;
    const plannedEnd = options.plannedEnd || record.planned_end;
    const requestedSettlementMode = normalizeHrSettlementMode(options.settlementMode);
    const allocation = allocateAttendanceToSegments({
        recordDate: options.recordDate || record.record_date,
        clockIn,
        clockOut,
        segments: options.plan?.segments || options.segments,
        primaryProfessionKey: options.plan?.primaryProfessionKey || options.primaryProfessionKey,
        plannedStart,
        plannedEnd,
        breakMinutes
    });
    const actualMinutes = allocation.allocationSource === 'clock_interval'
        ? allocation.actualMinutes
        : actualWorkedMinutes(clockIn, clockOut, breakMinutes);
    const scheduledMinutesOverride = optionalNonNegativeMinutes(
        options.scheduledWorkedMinutes ?? options.plannedMinutes
    );
    const scheduledMinutes = scheduledMinutesOverride
        ?? plannedShiftWorkedMinutes(plannedStart, plannedEnd, breakMinutes);
    const useScheduled = requestedSettlementMode === 'scheduled_shift' && scheduledMinutes !== null;

    let earlyLeaveMinutes = 0;
    let overtimeMinutes = 0;
    let status = record.status || 'present';

    if (useScheduled) {
        status = normalizedClosedStatus(status);
    } else {
        const diff = plannedEndDeltaMinutes(plannedEnd, options.kyivNow || new Date());
        const earlyDiff = allocation.allocationSource === 'clock_interval'
            ? allocation.earlyLeaveMinutes
            : diff;
        if (earlyDiff !== null) {
            if (earlyDiff > 15) {
                earlyLeaveMinutes = earlyDiff;
                status = 'early_leave';
            }
        }
        overtimeMinutes = allocation.allocationSource === 'clock_interval'
            ? allocation.overtimeMinutes
            : (diff !== null && diff < -15 ? Math.abs(diff) : 0);

        if (record.status === 'late' && status !== 'early_leave') status = 'late';
        status = normalizedClosedStatus(status);
    }

    return {
        clockOut,
        requestedSettlementMode,
        settlementMode: useScheduled ? 'scheduled_shift' : 'actual_time',
        actualWorkedMinutes: actualMinutes,
        scheduledWorkedMinutes: scheduledMinutes,
        totalWorkedMinutes: useScheduled ? scheduledMinutes : actualMinutes,
        earlyLeaveMinutes,
        overtimeMinutes,
        status,
        allocation
    };
}

module.exports = {
    HR_ATTENDANCE_BREAK_POLICY,
    allocateAttendanceToSegments,
    actualWorkedMinutes,
    attendanceAllocationFields,
    calculateHrClockOutPayroll,
    decorateAttendanceRecord,
    hydrateAttendanceRecords,
    normalizeHrSettlementMode,
    paidMinutesAfterSegmentBreak,
    plannedShiftWorkedMinutes,
    timeToMinutes
};
