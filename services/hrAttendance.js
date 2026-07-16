const {
    HR_SHIFT_BREAK_POLICY,
    hydrateHrShiftDayPlans,
    loadHrShiftDayPlan
} = require('./hrShiftSegments');
const { loadPrimaryStaffShiftPreference } = require('./professions');
const { isAttendanceRecordOpen } = require('../js/hr-attendance-state');

const MINUTES_PER_DAY = 24 * 60;
const KYIV_TIME_ZONE = 'Europe/Kyiv';
const HR_ATTENDANCE_GRACE_MINUTES = Object.freeze({
    late: 5,
    earlyLeave: 15,
    overtime: 15
});
const HR_ATTENDANCE_PLAN_SOURCES = Object.freeze({
    HR_SHIFT: 'hr_shift',
    PROFESSION_CARD: 'profession_card',
    UNSCHEDULED: 'unscheduled'
});
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

function normalizeAttendancePlanDate(value) {
    if (typeof value === 'string') {
        const raw = value.trim();
        const exactDate = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
        if (exactDate) return exactDate[1];
    }
    return kyivDateTimeParts(value)?.date || null;
}

function attendanceDayType(value) {
    const date = normalizeAttendancePlanDate(value);
    const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    if (utcDate.getUTCFullYear() !== year
        || utcDate.getUTCMonth() !== month - 1
        || utcDate.getUTCDate() !== day) return null;
    return [0, 6].includes(utcDate.getUTCDay()) ? 'weekend' : 'weekday';
}

function attendancePlanPayload({ plannedStart = null, plannedEnd = null, professionKey = null, segments = [], source }) {
    return {
        plannedStart,
        plannedEnd,
        professionKey: professionKey || null,
        segments: Array.isArray(segments) ? segments : [],
        source
    };
}

async function resolveAttendancePlan(db, staffId, date) {
    if (!db || typeof db.query !== 'function') {
        throw new TypeError('resolveAttendancePlan requires a database client');
    }
    const id = Number(staffId);
    const shiftDate = normalizeAttendancePlanDate(date);
    const dayType = attendanceDayType(shiftDate);
    if (!Number.isInteger(id) || id <= 0) {
        throw new TypeError('resolveAttendancePlan requires a valid staffId');
    }
    if (!shiftDate || !dayType) {
        throw new TypeError('resolveAttendancePlan requires a valid date');
    }

    const loadedShift = await loadHrShiftDayPlan(db, { staffId: id, shiftDate });
    if (loadedShift?.shift && loadedShift?.plan) {
        return attendancePlanPayload({
            plannedStart: loadedShift.plan.plannedStart || loadedShift.shift.planned_start || null,
            plannedEnd: loadedShift.plan.plannedEnd || loadedShift.shift.planned_end || null,
            professionKey: loadedShift.plan.primaryProfessionKey || loadedShift.shift.profession_key || null,
            segments: loadedShift.plan.segments || [],
            source: HR_ATTENDANCE_PLAN_SOURCES.HR_SHIFT
        });
    }

    const preference = await loadPrimaryStaffShiftPreference(db, id, dayType);
    if (preference?.isActive && preference.startTime && preference.endTime) {
        return attendancePlanPayload({
            plannedStart: preference.startTime,
            plannedEnd: preference.endTime,
            professionKey: preference.professionKey,
            segments: [{
                id: null,
                professionKey: preference.professionKey,
                shiftStart: preference.startTime,
                shiftEnd: preference.endTime,
                breakMinutes: 0,
                note: null,
                additionalProfessionKeys: []
            }],
            source: HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD
        });
    }

    return attendancePlanPayload({
        professionKey: preference?.professionKey || null,
        source: HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED
    });
}

function calculateAttendanceClockIn(plan, clockIn, recordDate) {
    const source = plan?.source || HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED;
    const plannedStart = plan?.plannedStart || null;
    const plannedEnd = plan?.plannedEnd || null;
    if (source === HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED || !plannedStart || !plannedEnd) {
        return {
            clockIn,
            plannedStart: null,
            plannedEnd: null,
            lateMinutes: 0,
            status: 'unscheduled'
        };
    }

    const actualStart = timestampToTimelineMinutes(clockIn, recordDate);
    const scheduledStart = timeToMinutes(plannedStart);
    if (actualStart === null || scheduledStart === null) {
        throw new TypeError('calculateAttendanceClockIn requires valid clock-in and planned start values');
    }
    const arrivalDelayMinutes = Math.max(0, actualStart - scheduledStart);
    const isLate = arrivalDelayMinutes > HR_ATTENDANCE_GRACE_MINUTES.late;
    return {
        clockIn,
        plannedStart,
        plannedEnd,
        lateMinutes: isLate ? arrivalDelayMinutes : 0,
        status: isLate ? 'late' : 'present'
    };
}

function attendancePlanForDecoration(plan = {}) {
    return {
        shift: {
            profession_key: plan.professionKey || null,
            planned_start: plan.plannedStart || null,
            planned_end: plan.plannedEnd || null,
            break_minutes: 0
        },
        plan: {
            primaryProfessionKey: plan.professionKey || null,
            plannedStart: plan.plannedStart || null,
            plannedEnd: plan.plannedEnd || null,
            segments: plan.segments || []
        }
    };
}

async function recordAttendanceClockIn(db, input = {}) {
    if (!db || typeof db.query !== 'function') {
        throw new TypeError('recordAttendanceClockIn requires a database client');
    }
    const staffId = Number(input.staffId ?? input.staff_id);
    const recordDate = normalizeAttendancePlanDate(input.recordDate ?? input.record_date ?? input.date);
    if (!Number.isInteger(staffId) || staffId <= 0) {
        throw new TypeError('recordAttendanceClockIn requires a valid staffId');
    }
    if (!recordDate) {
        throw new TypeError('recordAttendanceClockIn requires a valid recordDate');
    }

    const existingResult = await db.query(
        'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2 FOR UPDATE',
        [staffId, recordDate]
    );
    const existing = existingResult.rows?.[0] || null;
    if (existing?.clock_in) {
        return {
            record: decorateAttendanceRecord(existing),
            plan: attendancePlanPayload({
                plannedStart: existing.planned_start || null,
                plannedEnd: existing.planned_end || null,
                source: 'attendance_snapshot'
            }),
            planSource: 'attendance_snapshot',
            alreadyClockedIn: true,
            auditWritten: false
        };
    }

    const plan = await resolveAttendancePlan(db, staffId, recordDate);
    const clockInDate = input.now === undefined ? new Date() : new Date(input.now);
    if (Number.isNaN(clockInDate.getTime())) {
        throw new TypeError('recordAttendanceClockIn requires a valid server time');
    }
    const fields = calculateAttendanceClockIn(plan, clockInDate, recordDate);
    const clockIn = clockInDate.toISOString();
    const businessContext = input.businessContext ?? input.business_context ?? null;
    let writeResult;
    if (existing) {
        writeResult = await db.query(
            `UPDATE hr_time_records SET
                clock_in = $1, planned_start = $2, planned_end = $3,
                late_minutes = $4, status = $5, ip_address = $6, user_agent = $7,
                business_context = COALESCE(business_context, $8), updated_at = NOW()
             WHERE id = $9 RETURNING *`,
            [
                clockIn,
                fields.plannedStart,
                fields.plannedEnd,
                fields.lateMinutes,
                fields.status,
                input.ip || null,
                input.userAgent || input.user_agent || null,
                businessContext,
                existing.id
            ]
        );
    } else {
        writeResult = await db.query(
            `INSERT INTO hr_time_records
                (business_context, staff_id, record_date, clock_in, planned_start, planned_end,
                 late_minutes, status, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                businessContext,
                staffId,
                recordDate,
                clockIn,
                fields.plannedStart,
                fields.plannedEnd,
                fields.lateMinutes,
                fields.status,
                input.ip || null,
                input.userAgent || input.user_agent || null
            ]
        );
    }

    const method = String(input.method || 'manual').trim() || 'manual';
    const source = String(input.source || 'hr_today').trim() || 'hr_today';
    const auditDetails = {
        clock_in: clockIn,
        planned_start: fields.plannedStart,
        planned_end: fields.plannedEnd,
        late_minutes: fields.lateMinutes,
        status: fields.status,
        method,
        source,
        plan_source: plan.source,
        profession_key: plan.professionKey || null
    };
    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ('clock_in', $1, $2, $3, $4)`,
        [
            staffId,
            input.performedBy || input.performed_by || method,
            JSON.stringify(auditDetails),
            input.ip || null
        ]
    );

    const record = writeResult.rows?.[0] || null;
    return {
        record: record ? decorateAttendanceRecord(record, attendancePlanForDecoration(plan)) : null,
        plan,
        planSource: plan.source,
        alreadyClockedIn: false,
        auditWritten: true
    };
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
    const reporting = attendanceReportingFacts(record, loadedShift);
    return {
        ...record,
        ...attendanceAllocationFields(allocation),
        planned_start: reporting.plannedStart,
        planned_end: reporting.plannedEnd,
        is_late: reporting.isLate,
        is_early_leave: reporting.isEarlyLeave,
        has_overtime: reporting.hasOvertime,
        plan_source: reporting.planSource,
        plan_warning: reporting.planWarning,
        attendance_facts: {
            isLate: reporting.isLate,
            isEarlyLeave: reporting.isEarlyLeave,
            hasOvertime: reporting.hasOvertime,
            lateMinutes: reporting.isLate ? reporting.lateMinutes : 0,
            earlyLeaveMinutes: reporting.earlyLeaveMinutes,
            overtimeMinutes: reporting.overtimeMinutes
        }
    };
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

function normalizedClosedStatus(status) {
    if (status === 'late') return 'late';
    if (status === 'present' || status === 'unscheduled' || status === 'clocked_in') return 'present';
    return status || 'present';
}

function attendanceTimelineBoundaries(plannedStart, plannedEnd) {
    const start = timeToMinutes(plannedStart);
    let end = timeToMinutes(plannedEnd);
    if (start === null || end === null) return null;
    if (end <= start) end += MINUTES_PER_DAY;
    return { start, end };
}

function attendanceStatusFromFacts(record = {}, facts = {}) {
    if (facts.lateMinutes > 0) return 'late';
    if (facts.earlyLeaveMinutes > 0) return 'early_leave';
    if (['late', 'early_leave', 'present', 'unscheduled', 'clocked_in'].includes(record.status)) {
        return 'present';
    }
    return normalizedClosedStatus(record.status);
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

    let lateMinutes = normalizeNonNegativeMinutes(record.late_minutes ?? record.lateMinutes);
    let earlyLeaveMinutes = 0;
    let overtimeMinutes = 0;
    const boundaries = attendanceTimelineBoundaries(plannedStart, plannedEnd);
    const recordDate = options.recordDate || record.record_date || normalizeAttendancePlanDate(clockIn);
    const actualStart = timestampToTimelineMinutes(clockIn, recordDate);
    const actualEnd = timestampToTimelineMinutes(clockOut, recordDate);

    if (boundaries && actualStart !== null) {
        const arrivalDelay = Math.max(0, actualStart - boundaries.start);
        lateMinutes = arrivalDelay > HR_ATTENDANCE_GRACE_MINUTES.late ? arrivalDelay : 0;
    }
    if (boundaries && actualEnd !== null) {
        const departureDelta = actualEnd - boundaries.end;
        const earlyDiff = Math.max(0, -departureDelta);
        const overtimeDiff = Math.max(0, departureDelta);
        earlyLeaveMinutes = earlyDiff > HR_ATTENDANCE_GRACE_MINUTES.earlyLeave ? earlyDiff : 0;
        overtimeMinutes = overtimeDiff > HR_ATTENDANCE_GRACE_MINUTES.overtime ? overtimeDiff : 0;
    }
    const status = attendanceStatusFromFacts(record, {
        lateMinutes,
        earlyLeaveMinutes,
        overtimeMinutes
    });

    return {
        clockOut,
        requestedSettlementMode,
        settlementMode: useScheduled ? 'scheduled_shift' : 'actual_time',
        actualWorkedMinutes: actualMinutes,
        scheduledWorkedMinutes: scheduledMinutes,
        totalWorkedMinutes: useScheduled ? scheduledMinutes : actualMinutes,
        lateMinutes,
        earlyLeaveMinutes,
        overtimeMinutes,
        status,
        allocation
    };
}

function attendanceReportingFacts(record = {}, loadedShift = null) {
    const lateMinutes = normalizeNonNegativeMinutes(record.late_minutes ?? record.lateMinutes);
    const earlyLeaveMinutes = normalizeNonNegativeMinutes(record.early_leave_minutes ?? record.earlyLeaveMinutes);
    const overtimeMinutes = normalizeNonNegativeMinutes(record.overtime_minutes ?? record.overtimeMinutes);
    const plannedStart = record.planned_start || record.plannedStart
        || loadedShift?.plan?.plannedStart || loadedShift?.shift?.planned_start || null;
    const plannedEnd = record.planned_end || record.plannedEnd
        || loadedShift?.plan?.plannedEnd || loadedShift?.shift?.planned_end || null;
    const explicitSource = String(record.plan_source || record.planSource || '').trim();
    const planSource = explicitSource
        || (loadedShift?.shift
            ? HR_ATTENDANCE_PLAN_SOURCES.HR_SHIFT
            : (plannedStart && plannedEnd
                ? HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD
                : HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED));
    const planWarning = planSource === HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD
        ? { code: 'PROFESSION_CARD_FALLBACK', message: 'План дня взято з картки основної професії' }
        : (planSource === HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED
            ? { code: 'ATTENDANCE_UNSCHEDULED', message: 'Для attendance немає планового часу' }
            : null);

    return {
        lateMinutes,
        earlyLeaveMinutes,
        overtimeMinutes,
        isLate: lateMinutes > HR_ATTENDANCE_GRACE_MINUTES.late,
        isEarlyLeave: earlyLeaveMinutes > 0,
        hasOvertime: overtimeMinutes > 0,
        plannedStart,
        plannedEnd,
        planSource,
        planWarning
    };
}

function attendanceMutationError(code, message, statusCode) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

async function recordAttendanceClockOut(db, input = {}) {
    if (!db || typeof db.query !== 'function') {
        throw new TypeError('recordAttendanceClockOut requires a database client');
    }
    const staffId = Number(input.staffId ?? input.staff_id);
    const recordDate = normalizeAttendancePlanDate(input.recordDate ?? input.record_date ?? input.date);
    if (!Number.isInteger(staffId) || staffId <= 0) {
        throw new TypeError('recordAttendanceClockOut requires a valid staffId');
    }
    if (!recordDate) {
        throw new TypeError('recordAttendanceClockOut requires a valid recordDate');
    }

    const existingResult = await db.query(
        'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2 FOR UPDATE',
        [staffId, recordDate]
    );
    const record = existingResult.rows?.[0] || null;
    if (!record?.clock_in) {
        throw attendanceMutationError(
            'ATTENDANCE_CLOCK_IN_REQUIRED',
            'Спочатку відмітьте прихід',
            400
        );
    }
    if (record.clock_out) {
        return {
            record: decorateAttendanceRecord(record),
            payroll: null,
            alreadyClockedOut: true,
            auditWritten: false
        };
    }

    const resolvedPlan = await resolveAttendancePlan(db, staffId, recordDate);
    const plannedStart = record.planned_start || resolvedPlan.plannedStart || null;
    const plannedEnd = record.planned_end || resolvedPlan.plannedEnd || null;
    const plan = {
        primaryProfessionKey: resolvedPlan.professionKey || null,
        plannedStart,
        plannedEnd,
        segments: resolvedPlan.source === HR_ATTENDANCE_PLAN_SOURCES.HR_SHIFT
            ? (resolvedPlan.segments || [])
            : []
    };
    const normalizedSegments = normalizeAttendanceSegments({
        segments: plan.segments,
        plannedStart,
        plannedEnd,
        primaryProfessionKey: plan.primaryProfessionKey
    });
    const scheduledWorkedMinutes = normalizedSegments.reduce(
        (total, segment) => total + segment.plannedMinutes,
        0
    );
    const clockOutDate = input.now === undefined ? new Date() : new Date(input.now);
    if (Number.isNaN(clockOutDate.getTime())) {
        throw new TypeError('recordAttendanceClockOut requires a valid server time');
    }
    const clockOut = clockOutDate.toISOString();
    const payroll = calculateHrClockOutPayroll(record, {
        clockOut,
        plannedStart,
        plannedEnd,
        scheduledWorkedMinutes,
        plan,
        primaryProfessionKey: plan.primaryProfessionKey,
        recordDate,
        settlementMode: input.settlementMode ?? input.settlement_mode
    });

    const writeResult = await db.query(
        `UPDATE hr_time_records SET
            clock_out = $1, total_worked_minutes = $2, late_minutes = $3,
            early_leave_minutes = $4, overtime_minutes = $5, status = $6, updated_at = NOW()
         WHERE id = $7 RETURNING *`,
        [
            clockOut,
            payroll.totalWorkedMinutes,
            payroll.lateMinutes,
            payroll.earlyLeaveMinutes,
            payroll.overtimeMinutes,
            payroll.status,
            record.id
        ]
    );
    const writtenRecord = writeResult.rows?.[0] || null;
    const method = String(input.method || 'manual').trim() || 'manual';
    const source = String(input.source || 'hr_today').trim() || 'hr_today';
    const auditDetails = {
        record_id: record.id,
        clock_out: clockOut,
        planned_start: plannedStart,
        planned_end: plannedEnd,
        late_minutes: payroll.lateMinutes,
        early_leave_minutes: payroll.earlyLeaveMinutes,
        overtime_minutes: payroll.overtimeMinutes,
        total_worked_minutes: payroll.totalWorkedMinutes,
        actual_worked_minutes: payroll.actualWorkedMinutes,
        scheduled_worked_minutes: payroll.scheduledWorkedMinutes,
        settlement_mode: payroll.settlementMode,
        requested_settlement_mode: payroll.requestedSettlementMode,
        allocation_source: payroll.allocation.allocationSource,
        segment_allocations: payroll.allocation.segmentAllocations,
        allocation_issues: payroll.allocation.allocationIssues,
        status: payroll.status,
        method,
        source
    };
    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ('clock_out', $1, $2, $3, $4)`,
        [
            staffId,
            input.performedBy || input.performed_by || method,
            JSON.stringify(auditDetails),
            input.ip || null
        ]
    );

    return {
        record: writtenRecord
            ? decorateAttendanceRecord(writtenRecord, attendancePlanForDecoration({
                professionKey: plan.primaryProfessionKey,
                plannedStart,
                plannedEnd,
                segments: plan.segments
            }))
            : null,
        payroll,
        alreadyClockedOut: false,
        auditWritten: true
    };
}

module.exports = {
    HR_ATTENDANCE_GRACE_MINUTES,
    HR_ATTENDANCE_BREAK_POLICY,
    HR_ATTENDANCE_PLAN_SOURCES,
    allocateAttendanceToSegments,
    actualWorkedMinutes,
    attendanceDayType,
    attendanceAllocationFields,
    attendanceReportingFacts,
    calculateAttendanceClockIn,
    calculateHrClockOutPayroll,
    decorateAttendanceRecord,
    hydrateAttendanceRecords,
    isAttendanceRecordOpen,
    normalizeHrSettlementMode,
    paidMinutesAfterSegmentBreak,
    plannedShiftWorkedMinutes,
    recordAttendanceClockIn,
    recordAttendanceClockOut,
    resolveAttendancePlan,
    timeToMinutes
};
