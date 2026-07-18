const {
    HR_SHIFT_BREAK_POLICY,
    hydrateHrShiftDayPlans,
    loadHrShiftDayPlan,
    loadPaidRoleValidationContext
} = require('./hrShiftSegments');
const { loadPrimaryStaffShiftPreference } = require('./professions');
const { normalizeBusinessContext } = require('./businessContext');
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
    UNSCHEDULED: 'unscheduled',
    ATTENDANCE_SNAPSHOT: 'attendance_snapshot'
});
const HR_ATTENDANCE_INITIAL_PLAN_SOURCE_VALUES = new Set([
    HR_ATTENDANCE_PLAN_SOURCES.HR_SHIFT,
    HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD,
    HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED
]);
const HR_ATTENDANCE_RESPONSE_PLAN_SOURCE_VALUES = new Set([
    ...HR_ATTENDANCE_INITIAL_PLAN_SOURCE_VALUES,
    HR_ATTENDANCE_PLAN_SOURCES.ATTENDANCE_SNAPSHOT
]);
// MVP policy: a segment's break is deducted only when the actual interval touches
// that segment, and never by more than the touched minutes. Exact break windows
// require a separate protected schema decision.
const HR_ATTENDANCE_BREAK_POLICY = HR_SHIFT_BREAK_POLICY;
const HR_ATTENDANCE_COMPENSATION_SNAPSHOT_VERSION = 1;
const HR_ATTENDANCE_COMPENSATION_RATE_SOURCE = 'staff_profession_rates.hourly_rate';
const HR_ATTENDANCE_BASE_RATE_SOURCE = 'base_payroll_contract';
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

function normalizeAttendancePlanSource(value, { allowSnapshot = false } = {}) {
    const source = String(value || '').trim();
    const allowed = allowSnapshot
        ? HR_ATTENDANCE_RESPONSE_PLAN_SOURCE_VALUES
        : HR_ATTENDANCE_INITIAL_PLAN_SOURCE_VALUES;
    return allowed.has(source) ? source : null;
}

function optionalNonNegativeMinutes(value) {
    if (value === undefined || value === null || value === '') return null;
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return null;
    return normalizeNonNegativeMinutes(minutes);
}

function attendanceFactMinutes(record = {}) {
    const facts = record.attendance_facts || record.attendanceFacts || {};
    const lateMinutes = normalizeNonNegativeMinutes(
        facts.lateMinutes ?? facts.late_minutes ?? record.late_minutes ?? record.lateMinutes
    );
    const earlyLeaveMinutes = normalizeNonNegativeMinutes(
        facts.earlyLeaveMinutes ?? facts.early_leave_minutes ?? record.early_leave_minutes ?? record.earlyLeaveMinutes
    );
    const overtimeMinutes = normalizeNonNegativeMinutes(
        facts.overtimeMinutes ?? facts.overtime_minutes ?? record.overtime_minutes ?? record.overtimeMinutes
    );
    return {
        lateMinutes: lateMinutes > HR_ATTENDANCE_GRACE_MINUTES.late ? lateMinutes : 0,
        earlyLeaveMinutes,
        overtimeMinutes: overtimeMinutes > HR_ATTENDANCE_GRACE_MINUTES.overtime ? overtimeMinutes : 0
    };
}

function attendanceCsvCell(value) {
    const raw = value === null || value === undefined ? '' : String(value);
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const leadingWhitespace = normalized.match(/^\s*/)?.[0] || '';
    let safeValue = normalized;
    const firstMeaningfulChar = normalized.slice(leadingWhitespace.length, leadingWhitespace.length + 1);
    if (/^[=+\-@]$/.test(firstMeaningfulChar)) {
        safeValue = `${leadingWhitespace}'${normalized.slice(leadingWhitespace.length)}`;
    }
    const needsQuotes = /[;"\n\t]/.test(safeValue) || /^\s|\s$/.test(safeValue);
    const escaped = safeValue.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
}

function attendanceCsvRow(values = []) {
    return (Array.isArray(values) ? values : []).map(attendanceCsvCell).join(';');
}

function attendancePlanWarningMessage(planSource) {
    if (planSource === HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD) {
        return 'План дня взято з картки основної професії';
    }
    if (planSource === HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED) {
        return 'Для працівника не задано плановий час';
    }
    return '';
}

function summarizeHrTodayItems(items = []) {
    const rows = Array.isArray(items) ? items : [];
    return rows.reduce((summary, item = {}) => {
        const entry = item || {};
        const record = Object.prototype.hasOwnProperty.call(entry, 'record') ? entry.record : entry;
        const shift = entry.shift || null;
        summary.total_staff += 1;
        if (record) {
            const status = String(record.status || '').trim();
            const facts = attendanceFactMinutes(record);
            if (isAttendanceRecordOpen(record)) summary.present += 1;
            else if (status === 'vacation') summary.on_vacation += 1;
            else if (status === 'sick') summary.sick += 1;
            if (facts.lateMinutes > 0) summary.late += 1;
        } else if (shift) {
            summary.absent += 1;
        }
        return summary;
    }, { total_staff: 0, present: 0, late: 0, absent: 0, on_vacation: 0, sick: 0 });
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
        const additionalRoles = Array.isArray(segment.additionalRoles)
            ? segment.additionalRoles
            : (Array.isArray(segment.additional_roles) ? segment.additional_roles : []);
        return {
            id: segment.id ?? null,
            professionKey,
            shiftStart: String(shiftStart).slice(0, 5),
            shiftEnd: String(shiftEnd).slice(0, 5),
            breakMinutes,
            additionalRoles: additionalRoles.map(role => ({
                professionKey: role.professionKey ?? role.profession_key ?? null,
                compensationMode: role.compensationMode ?? role.compensation_mode ?? 'unpaid',
                payMultiplier: role.payMultiplier ?? role.pay_multiplier ?? null,
                policyVersion: role.policyVersion ?? role.policy_version ?? null
            })),
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

function assertNonOverlappingAttendanceSegments(segments = []) {
    for (let index = 1; index < segments.length; index += 1) {
        const previous = segments[index - 1];
        const current = segments[index];
        if (current.startMinutes >= previous.endMinutes) continue;
        const error = new Error('Фізичні сегменти attendance не можуть перетинатися');
        error.code = 'HR_SHIFT_PLAN_SEGMENTS_OVERLAP';
        error.statusCode = 400;
        error.details = {
            firstSegment: {
                id: previous.id ?? null,
                shiftStart: previous.shiftStart,
                shiftEnd: previous.shiftEnd
            },
            secondSegment: {
                id: current.id ?? null,
                shiftStart: current.shiftStart,
                shiftEnd: current.shiftEnd
            }
        };
        throw error;
    }
}

function parseAttendanceCompensationSnapshot(value) {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function publicAttendancePlanSegment(segment = {}) {
    return {
        id: segment.id ?? null,
        professionKey: segment.professionKey || null,
        shiftStart: segment.shiftStart || null,
        shiftEnd: segment.shiftEnd || null,
        breakMinutes: normalizeNonNegativeMinutes(segment.breakMinutes),
        plannedMinutes: normalizeNonNegativeMinutes(segment.plannedMinutes),
        additionalRoles: (segment.additionalRoles || []).map(role => ({
            professionKey: role.professionKey || null,
            compensationMode: role.compensationMode || 'unpaid',
            payMultiplier: role.payMultiplier === null || role.payMultiplier === undefined
                ? null
                : Number(role.payMultiplier),
            policyVersion: role.policyVersion || null
        })),
        additionalProfessionKeys: [...new Set((segment.additionalProfessionKeys || []).filter(Boolean))]
    };
}

function attendancePlanFromCompensationSnapshot(snapshotValue) {
    const snapshot = parseAttendanceCompensationSnapshot(snapshotValue);
    const plan = snapshot?.plan;
    if (!plan || !Array.isArray(plan.segments)) return null;
    return attendancePlanPayload({
        plannedStart: plan.plannedStart || null,
        plannedEnd: plan.plannedEnd || null,
        professionKey: plan.primaryProfessionKey || null,
        segments: plan.segments.map(segment => ({
            ...segment,
            additionalRoles: (segment.additionalRoles || []).map(role => ({ ...role })),
            additionalProfessionKeys: [...(segment.additionalProfessionKeys || [])]
        })),
        source: snapshot.planSource || plan.source || HR_ATTENDANCE_PLAN_SOURCES.ATTENDANCE_SNAPSHOT
    });
}

function attendanceCompensationIssue(code, message, details = {}, severity = 'warning') {
    return { code, message, severity, ...details };
}

function attendanceCompensationPlan(plan = {}) {
    const normalizedSegments = normalizeAttendanceSegments({
        segments: plan.segments,
        plannedStart: plan.plannedStart,
        plannedEnd: plan.plannedEnd,
        primaryProfessionKey: plan.professionKey || plan.primaryProfessionKey
    });
    return {
        primaryProfessionKey: plan.professionKey || plan.primaryProfessionKey || null,
        plannedStart: plan.plannedStart || null,
        plannedEnd: plan.plannedEnd || null,
        source: plan.source || HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED,
        segments: normalizedSegments.map(publicAttendancePlanSegment)
    };
}

function baseCompensationAllocation(segment, actualMinutes = 0, segmentIndex = null) {
    return {
        allocationType: 'base',
        segmentId: segment.id ?? null,
        segmentIndex: Number.isInteger(segmentIndex) ? segmentIndex : null,
        professionKey: segment.professionKey || null,
        plannedMinutes: normalizeNonNegativeMinutes(segment.plannedMinutes),
        actualMinutes: normalizeNonNegativeMinutes(actualMinutes),
        compensationMode: 'base',
        payMultiplier: 1,
        rate: null,
        rateUnit: null,
        rateSource: HR_ATTENDANCE_BASE_RATE_SOURCE,
        policyVersion: null,
        overtimeMinutes: 0
    };
}

function additionalCompensationAllocation(segment, role, rateSnapshot = {}, actualMinutes = 0, segmentIndex = null) {
    return {
        allocationType: 'simultaneous_additional',
        segmentId: segment.id ?? null,
        segmentIndex: Number.isInteger(segmentIndex) ? segmentIndex : null,
        professionKey: role.professionKey || null,
        plannedMinutes: normalizeNonNegativeMinutes(segment.plannedMinutes),
        actualMinutes: normalizeNonNegativeMinutes(actualMinutes),
        compensationMode: role.compensationMode || 'paid_hourly',
        payMultiplier: Number(role.payMultiplier),
        rate: rateSnapshot.rate ?? null,
        rateUnit: rateSnapshot.rateUnit || 'hour',
        rateSource: rateSnapshot.rateSource || null,
        policyVersion: role.policyVersion || null,
        overtimeMinutes: 0
    };
}

async function buildAttendanceCompensationPlanSnapshot(db, input = {}) {
    const staffId = Number(input.staffId ?? input.staff_id);
    const recordDate = normalizeAttendancePlanDate(input.recordDate ?? input.record_date);
    const plan = attendanceCompensationPlan(input.plan || {});
    const capturedAt = timestampAuditValue(input.capturedAt || input.captured_at || new Date());
    const paidRoles = plan.segments.flatMap(segment =>
        (segment.additionalRoles || [])
            .filter(role => role.compensationMode === 'paid_hourly')
            .map(role => ({ segment, role })));
    const context = paidRoles.length
        ? await loadPaidRoleValidationContext(db, [staffId])
        : { policies: [], professionRates: new Map() };
    const issues = [];
    const compensationAllocations = [];

    for (const [segmentIndex, segment] of plan.segments.entries()) {
        compensationAllocations.push(baseCompensationAllocation(segment, 0, segmentIndex));
        for (const role of segment.additionalRoles || []) {
            if (role.compensationMode !== 'paid_hourly') continue;
            const policy = (context.policies || []).find(item =>
                item.policyVersion === role.policyVersion
                && item.compensationMode === 'paid_hourly'
                && item.status === 'active'
                && item.effectiveFrom
                && item.effectiveFrom <= recordDate
                && Number(item.payMultiplier) === Number(role.payMultiplier));
            const rate = context.professionRates?.get(`${staffId}:${role.professionKey}`);
            if (!policy) {
                issues.push(attendanceCompensationIssue(
                    'ATTENDANCE_COMPENSATION_POLICY_REQUIRED',
                    'Не вдалося зафіксувати активну політику додаткової оплати',
                    { professionKey: role.professionKey, policyVersion: role.policyVersion || null },
                    'manual_review'
                ));
            }
            if (!Number.isFinite(Number(rate)) || Number(rate) <= 0) {
                issues.push(attendanceCompensationIssue(
                    'ATTENDANCE_COMPENSATION_RATE_REQUIRED',
                    'Не вдалося зафіксувати явну погодинну ставку додаткової професії',
                    { professionKey: role.professionKey, rateSource: HR_ATTENDANCE_COMPENSATION_RATE_SOURCE },
                    'manual_review'
                ));
            }
            compensationAllocations.push(additionalCompensationAllocation(segment, role, {
                rate: Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : null,
                rateUnit: 'hour',
                rateSource: Number.isFinite(Number(rate)) && Number(rate) > 0
                    ? HR_ATTENDANCE_COMPENSATION_RATE_SOURCE
                    : null
            }, 0, segmentIndex));
        }
    }

    return {
        schemaVersion: HR_ATTENDANCE_COMPENSATION_SNAPSHOT_VERSION,
        state: issues.some(issue => issue.severity === 'manual_review') ? 'manual_review' : 'planned',
        legacyBaseOnly: false,
        staffId,
        recordDate,
        capturedAt,
        finalizedAt: null,
        correctedAt: null,
        planSource: plan.source,
        plan,
        physicalAllocation: null,
        compensationAllocations,
        totals: {
            physicalMinutes: 0,
            baseMinutes: 0,
            simultaneousAdditionalMinutes: 0,
            compensationMinutes: 0
        },
        issues,
        manualReview: issues.some(issue => issue.severity === 'manual_review')
    };
}

function buildLegacyAttendanceCompensationSnapshot(input = {}) {
    const plan = attendanceCompensationPlan(input.plan || {});
    plan.segments = plan.segments.map(segment => ({
        ...segment,
        additionalRoles: (segment.additionalRoles || []).map(role => ({
            ...role,
            compensationMode: 'unpaid',
            payMultiplier: null,
            policyVersion: null
        }))
    }));
    return {
        schemaVersion: HR_ATTENDANCE_COMPENSATION_SNAPSHOT_VERSION,
        state: 'legacy_base_only',
        legacyBaseOnly: true,
        staffId: Number(input.staffId ?? input.staff_id) || null,
        recordDate: normalizeAttendancePlanDate(input.recordDate ?? input.record_date),
        capturedAt: timestampAuditValue(input.capturedAt || input.captured_at || new Date()),
        finalizedAt: null,
        correctedAt: null,
        planSource: input.planSource || input.plan_source || HR_ATTENDANCE_PLAN_SOURCES.ATTENDANCE_SNAPSHOT,
        plan,
        physicalAllocation: null,
        compensationAllocations: plan.segments.map((segment, segmentIndex) =>
            baseCompensationAllocation(segment, 0, segmentIndex)),
        totals: {
            physicalMinutes: 0,
            baseMinutes: 0,
            simultaneousAdditionalMinutes: 0,
            compensationMinutes: 0
        },
        issues: [attendanceCompensationIssue(
            'ATTENDANCE_COMPENSATION_LEGACY_BASE_ONLY',
            'Запис створено без compensation snapshot; додаткову оплату заднім числом не нараховано'
        )],
        manualReview: false
    };
}

function finalizeAttendanceCompensationSnapshot(snapshotValue, physicalAllocation, options = {}) {
    const source = parseAttendanceCompensationSnapshot(snapshotValue)
        || buildLegacyAttendanceCompensationSnapshot(options);
    const segmentAllocations = Array.isArray(physicalAllocation?.segmentAllocations)
        ? physicalAllocation.segmentAllocations
        : [];
    const compensationAllocations = (source.compensationAllocations || []).map(allocation => {
        const segmentIndex = source.plan?.segments?.findIndex(segment =>
            allocation.segmentId !== null && allocation.segmentId !== undefined
                ? String(segment.id) === String(allocation.segmentId)
                : false);
        const physical = segmentIndex >= 0
            ? segmentAllocations[segmentIndex]
            : segmentAllocations[Number(allocation.segmentIndex)];
        return {
            ...allocation,
            actualMinutes: normalizeNonNegativeMinutes(physical?.actualMinutes),
            overtimeMinutes: 0
        };
    });
    const overtimeMinutes = normalizeNonNegativeMinutes(physicalAllocation?.overtimeMinutes);
    if (overtimeMinutes > 0) {
        const primaryProfessionKey = source.plan?.primaryProfessionKey || null;
        let primaryBase = compensationAllocations.find(allocation =>
            allocation.allocationType === 'base'
            && allocation.professionKey === primaryProfessionKey);
        if (!primaryBase) {
            primaryBase = baseCompensationAllocation({
                id: null,
                professionKey: primaryProfessionKey,
                plannedMinutes: 0
            });
            compensationAllocations.push(primaryBase);
        }
        primaryBase.actualMinutes += overtimeMinutes;
        primaryBase.overtimeMinutes = overtimeMinutes;
    }
    const physicalMinutes = normalizeNonNegativeMinutes(physicalAllocation?.actualMinutes);
    const physicalAllocationMinutes = segmentAllocations.reduce(
        (sum, allocation) => sum + normalizeNonNegativeMinutes(allocation.actualMinutes),
        0
    ) + overtimeMinutes;
    const baseMinutes = compensationAllocations
        .filter(allocation => allocation.allocationType === 'base')
        .reduce((sum, allocation) => sum + normalizeNonNegativeMinutes(allocation.actualMinutes), 0);
    const simultaneousAdditionalMinutes = compensationAllocations
        .filter(allocation => allocation.allocationType === 'simultaneous_additional')
        .reduce((sum, allocation) => sum + normalizeNonNegativeMinutes(allocation.actualMinutes), 0);
    const issues = [...(source.issues || [])];
    if (physicalAllocationMinutes !== physicalMinutes) {
        issues.push(attendanceCompensationIssue(
            'ATTENDANCE_PHYSICAL_ALLOCATION_INVARIANT_FAILED',
            'Сума фізичних allocations не збігається з фактичними хвилинами',
            { physicalAllocationMinutes, physicalMinutes },
            'manual_review'
        ));
    }
    const manualReview = issues.some(issue => issue.severity === 'manual_review');
    return {
        ...source,
        state: manualReview ? 'manual_review' : 'final',
        finalizedAt: timestampAuditValue(options.finalizedAt || options.finalized_at || new Date()),
        correctedAt: options.correctedAt || options.corrected_at
            ? timestampAuditValue(options.correctedAt || options.corrected_at)
            : (source.correctedAt || null),
        physicalAllocation: {
            ...physicalAllocation,
            segmentAllocations: segmentAllocations.map(allocation => ({ ...allocation }))
        },
        compensationAllocations,
        totals: {
            physicalMinutes,
            physicalAllocationMinutes,
            baseMinutes,
            simultaneousAdditionalMinutes,
            compensationMinutes: baseMinutes + simultaneousAdditionalMinutes
        },
        issues,
        manualReview
    };
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
        source: normalizeAttendancePlanSource(source, { allowSnapshot: true }) || HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED
    };
}

function timestampAuditValue(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return String(value);
}

function planSourceFromAuditDetails(details) {
    const source = normalizeAttendancePlanSource(details?.plan_source ?? details?.planSource);
    return source || null;
}

async function loadInitialAttendancePlanSource(db, record = {}) {
    if (!record?.staff_id || !record?.clock_in) {
        return HR_ATTENDANCE_PLAN_SOURCES.ATTENDANCE_SNAPSHOT;
    }
    const recordId = record.id === undefined || record.id === null ? '' : String(record.id);
    const clockIn = timestampAuditValue(record.clock_in);
    const recordDate = normalizeAttendancePlanDate(record.record_date || record.date) || '';
    const result = await db.query(
        `SELECT details
         FROM hr_audit_log
         WHERE action = 'clock_in'
           AND staff_id = $1
           AND (
                details->>'record_id' = $2
                OR details->>'clock_in' = $3
                OR details->>'record_date' = $4
                OR details->>'date' = $4
           )
         ORDER BY created_at ASC, id ASC
         LIMIT 5`,
        [Number(record.staff_id), recordId, clockIn, recordDate]
    );
    const rows = Array.isArray(result.rows) ? result.rows : [];
    for (const row of rows) {
        const details = typeof row.details === 'string'
            ? (() => {
                try { return JSON.parse(row.details); } catch (_) { return null; }
            })()
            : row.details;
        const source = planSourceFromAuditDetails(details);
        if (source) return source;
    }
    return HR_ATTENDANCE_PLAN_SOURCES.ATTENDANCE_SNAPSHOT;
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
    const source = normalizeAttendancePlanSource(plan.source, { allowSnapshot: true }) || null;
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
            segments: plan.segments || [],
            source
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
        const planSource = await loadInitialAttendancePlanSource(db, existing);
        const plan = attendancePlanFromCompensationSnapshot(existing.compensation_snapshot)
            || attendancePlanPayload({
            plannedStart: existing.planned_start || null,
            plannedEnd: existing.planned_end || null,
            professionKey: existing.primary_profession_key || null,
            source: planSource
        });
        return {
            record: decorateAttendanceRecord(
                { ...existing, plan_source: planSource },
                attendancePlanForDecoration(plan)
            ),
            plan,
            planSource,
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
    const compensationSnapshot = await buildAttendanceCompensationPlanSnapshot(db, {
        staffId,
        recordDate,
        plan,
        capturedAt: clockIn
    });
    if (compensationSnapshot.manualReview) fields.status = 'manual_review';
    const businessContext = normalizeBusinessContext(
        input.businessContext ?? input.business_context
    );
    let writeResult;
    if (existing) {
        writeResult = await db.query(
            `UPDATE hr_time_records SET
                clock_in = $1, planned_start = $2, planned_end = $3,
                late_minutes = $4, status = $5, ip_address = $6, user_agent = $7,
                business_context = COALESCE(business_context, $8),
                compensation_snapshot = $9::jsonb,
                notes = COALESCE($10, notes),
                updated_at = NOW()
             WHERE id = $11 RETURNING *`,
            [
                clockIn,
                fields.plannedStart,
                fields.plannedEnd,
                fields.lateMinutes,
                fields.status,
                input.ip || null,
                input.userAgent || input.user_agent || null,
                businessContext,
                JSON.stringify(compensationSnapshot),
                input.notes ?? null,
                existing.id
            ]
        );
    } else {
        writeResult = await db.query(
            `INSERT INTO hr_time_records
                (business_context, staff_id, record_date, clock_in, planned_start, planned_end,
                 late_minutes, status, ip_address, user_agent, compensation_snapshot, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
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
                input.userAgent || input.user_agent || null,
                JSON.stringify(compensationSnapshot),
                input.notes ?? null
            ]
        );
    }

    const record = writeResult.rows?.[0] || null;
    const method = String(input.method || 'manual').trim() || 'manual';
    const source = String(input.source || 'hr_today').trim() || 'hr_today';
    const auditDetails = {
        record_id: record?.id ?? null,
        record_date: recordDate,
        clock_in: clockIn,
        planned_start: fields.plannedStart,
        planned_end: fields.plannedEnd,
        late_minutes: fields.lateMinutes,
        status: fields.status,
        method,
        source,
        plan_source: plan.source,
        profession_key: plan.professionKey || null,
        compensation_snapshot_state: compensationSnapshot.state,
        compensation_manual_review: compensationSnapshot.manualReview,
        compensation_issues: compensationSnapshot.issues
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
    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ('compensation_snapshot_created', $1, $2, $3, $4)`,
        [
            staffId,
            input.performedBy || input.performed_by || method,
            JSON.stringify({
                eventVersion: 1,
                recordId: record?.id ?? null,
                recordDate,
                source,
                trigger: 'clock_in',
                snapshotState: compensationSnapshot.state,
                snapshotSchemaVersion: compensationSnapshot.schemaVersion,
                planSource: compensationSnapshot.planSource,
                compensationSnapshot
            }),
            input.ip || null
        ]
    );

    return {
        record: record ? decorateAttendanceRecord(
            {
                ...record,
                compensation_snapshot: record.compensation_snapshot || compensationSnapshot,
                plan_source: plan.source
            },
            attendancePlanForDecoration(plan)
        ) : null,
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
        additionalRoles: segment.additionalRoles,
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
    assertNonOverlappingAttendanceSegments(segments);
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
    const allocationOvertimeMinutes = normalizeNonNegativeMinutes(allocation.overtimeMinutes);
    return {
        segmentAllocations: allocation.segmentAllocations,
        segment_allocations: allocation.segmentAllocations,
        plannedMinutes: allocation.plannedMinutes,
        planned_minutes: allocation.plannedMinutes,
        actualMinutes: allocation.actualMinutes,
        actual_minutes: allocation.actualMinutes,
        allocatedMinutes: allocation.allocatedMinutes,
        allocated_minutes: allocation.allocatedMinutes,
        allocationOvertimeMinutes,
        allocation_overtime_minutes: allocationOvertimeMinutes,
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
    const compensationSnapshot = parseAttendanceCompensationSnapshot(
        record.compensation_snapshot || record.compensationSnapshot
    );
    const snapshotPlan = attendancePlanFromCompensationSnapshot(compensationSnapshot);
    const plan = snapshotPlan || loadedShift?.plan || loadedShift || null;
    const shift = loadedShift?.shift || {};
    const allocation = compensationSnapshot?.physicalAllocation
        ? {
            ...compensationSnapshot.physicalAllocation,
            segmentAllocations: compensationSnapshot.physicalAllocation.segmentAllocations || [],
            allocationIssues: compensationSnapshot.physicalAllocation.allocationIssues || []
        }
        : allocateAttendanceToSegments({
            recordDate: record.record_date || record.date,
            clockIn: record.clock_in || record.checkin_at,
            clockOut: record.clock_out || record.checkout_at,
            totalWorkedMinutes: record.total_worked_minutes,
            segments: plan?.segments,
            primaryProfessionKey: plan?.professionKey || plan?.primaryProfessionKey
                || shift.profession_key || record.primary_profession_key,
            plannedStart: snapshotPlan?.plannedStart || record.planned_start || shift.planned_start,
            plannedEnd: snapshotPlan?.plannedEnd || record.planned_end || shift.planned_end,
            breakMinutes: shift.break_minutes || 0
        });
    const reporting = attendanceReportingFacts(record, loadedShift);
    const legacyCompensationWarning = compensationSnapshot
        ? null
        : attendanceCompensationIssue(
            'ATTENDANCE_COMPENSATION_LEGACY_BASE_ONLY',
            'Запис не має compensation snapshot; додаткова оплата не застосовується ретроактивно'
        );
    const compensationIssues = compensationSnapshot?.issues
        || (legacyCompensationWarning ? [legacyCompensationWarning] : []);
    return {
        ...record,
        ...attendanceAllocationFields(allocation),
        compensationSnapshot,
        compensation_snapshot: compensationSnapshot,
        compensationAllocations: compensationSnapshot?.compensationAllocations || [],
        compensation_allocations: compensationSnapshot?.compensationAllocations || [],
        compensationIssues,
        compensation_issues: compensationIssues,
        compensationManualReview: Boolean(compensationSnapshot?.manualReview),
        compensation_manual_review: Boolean(compensationSnapshot?.manualReview),
        overtimeMinutes: reporting.overtimeMinutes,
        overtime_minutes: reporting.overtimeMinutes,
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
    const { lateMinutes, earlyLeaveMinutes, overtimeMinutes } = attendanceFactMinutes(record);
    const plannedStart = record.planned_start || record.plannedStart
        || loadedShift?.plan?.plannedStart || loadedShift?.shift?.planned_start || null;
    const plannedEnd = record.planned_end || record.plannedEnd
        || loadedShift?.plan?.plannedEnd || loadedShift?.shift?.planned_end || null;
    const explicitSource = normalizeAttendancePlanSource(
        record.plan_source || record.planSource,
        { allowSnapshot: true }
    );
    const loadedPlanSource = normalizeAttendancePlanSource(
        loadedShift?.plan?.source || loadedShift?.source,
        { allowSnapshot: true }
    );
    const planSource = explicitSource || loadedPlanSource
        || (loadedShift?.shift
            ? HR_ATTENDANCE_PLAN_SOURCES.HR_SHIFT
            : (plannedStart && plannedEnd
                ? HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD
                : HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED));
    const planWarning = planSource === HR_ATTENDANCE_PLAN_SOURCES.PROFESSION_CARD
        ? { code: 'PROFESSION_CARD_FALLBACK', message: attendancePlanWarningMessage(planSource) }
        : (planSource === HR_ATTENDANCE_PLAN_SOURCES.UNSCHEDULED
            ? { code: 'ATTENDANCE_UNSCHEDULED', message: attendancePlanWarningMessage(planSource) }
            : null);

    return {
        lateMinutes,
        earlyLeaveMinutes,
        overtimeMinutes,
        isLate: lateMinutes > 0,
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

const TERMINAL_ATTENDANCE_STATUSES = new Set([
    'absent',
    'no_show',
    'sick',
    'vacation',
    'day_off'
]);

function zeroAttendancePhysicalAllocation(plan = {}) {
    return {
        actualMinutes: 0,
        overtimeMinutes: 0,
        segmentAllocations: (Array.isArray(plan.segments) ? plan.segments : []).map((segment, segmentIndex) => ({
            segmentId: segment.id ?? null,
            segmentIndex,
            professionKey: segment.professionKey || null,
            plannedMinutes: normalizeNonNegativeMinutes(segment.plannedMinutes),
            actualMinutes: 0
        }))
    };
}

async function recordAttendanceStatus(db, input = {}) {
    if (!db || typeof db.query !== 'function') {
        throw new TypeError('recordAttendanceStatus requires a database client');
    }
    const staffId = Number(input.staffId ?? input.staff_id);
    const recordDate = normalizeAttendancePlanDate(input.recordDate ?? input.record_date ?? input.date);
    const status = String(input.status || '').trim();
    if (!Number.isInteger(staffId) || staffId <= 0) {
        throw new TypeError('recordAttendanceStatus requires a valid staffId');
    }
    if (!recordDate) {
        throw new TypeError('recordAttendanceStatus requires a valid recordDate');
    }
    if (!TERMINAL_ATTENDANCE_STATUSES.has(status)) {
        throw new TypeError('recordAttendanceStatus requires a supported terminal status');
    }

    const existingResult = await db.query(
        'SELECT * FROM hr_time_records WHERE staff_id = $1 AND record_date = $2 FOR UPDATE',
        [staffId, recordDate]
    );
    const existing = existingResult.rows?.[0] || null;
    if (existing && (
        existing.clock_in
        || existing.clock_out
        || normalizeNonNegativeMinutes(existing.total_worked_minutes) > 0
    )) {
        throw attendanceMutationError(
            'ATTENDANCE_STATUS_CONFLICT',
            'Attendance status cannot replace an existing worked-time record',
            409
        );
    }

    const plan = await resolveAttendancePlan(db, staffId, recordDate);
    const capturedAt = input.now === undefined ? new Date() : new Date(input.now);
    if (Number.isNaN(capturedAt.getTime())) {
        throw new TypeError('recordAttendanceStatus requires a valid server time');
    }
    const plannedSnapshot = await buildAttendanceCompensationPlanSnapshot(db, {
        staffId,
        recordDate,
        plan,
        capturedAt
    });
    const compensationSnapshot = finalizeAttendanceCompensationSnapshot(
        plannedSnapshot,
        zeroAttendancePhysicalAllocation(plannedSnapshot.plan),
        { finalizedAt: capturedAt }
    );
    const businessContext = normalizeBusinessContext(
        input.businessContext ?? input.business_context
    );
    const writeResult = existing
        ? await db.query(
            `UPDATE hr_time_records SET
                status = $1,
                notes = COALESCE($2, notes),
                business_context = COALESCE(business_context, $3),
                planned_start = $4,
                planned_end = $5,
                compensation_snapshot = $6::jsonb,
                updated_at = NOW()
             WHERE id = $7
             RETURNING *`,
            [
                status,
                input.notes ?? null,
                businessContext,
                plan.plannedStart || null,
                plan.plannedEnd || null,
                JSON.stringify(compensationSnapshot),
                existing.id
            ]
        )
        : await db.query(
            `INSERT INTO hr_time_records (
                business_context, staff_id, record_date, status, notes,
                planned_start, planned_end, compensation_snapshot
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
             RETURNING *`,
            [
                businessContext,
                staffId,
                recordDate,
                status,
                input.notes ?? null,
                plan.plannedStart || null,
                plan.plannedEnd || null,
                JSON.stringify(compensationSnapshot)
            ]
        );
    const record = writeResult.rows?.[0] || null;
    const source = String(input.source || 'attendance_status').trim() || 'attendance_status';
    const performedBy = input.performedBy || input.performed_by || 'system';
    await db.query(
        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
         VALUES ('compensation_snapshot_created', $1, $2, $3, $4)`,
        [
            staffId,
            performedBy,
            JSON.stringify({
                eventVersion: 1,
                recordId: record?.id ?? null,
                recordDate,
                source,
                trigger: 'attendance_status',
                attendanceStatus: status,
                snapshotState: compensationSnapshot.state,
                snapshotSchemaVersion: compensationSnapshot.schemaVersion,
                planSource: compensationSnapshot.planSource,
                compensationSnapshot
            }),
            input.ip || null
        ]
    );

    return {
        record: record ? decorateAttendanceRecord(
            {
                ...record,
                compensation_snapshot: record.compensation_snapshot || compensationSnapshot,
                plan_source: plan.source
            },
            attendancePlanForDecoration(plan)
        ) : null,
        plan,
        planSource: plan.source,
        compensationSnapshot,
        auditWritten: true
    };
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
    const initialPlanSource = await loadInitialAttendancePlanSource(db, record);
    const storedCompensationSnapshot = parseAttendanceCompensationSnapshot(record.compensation_snapshot);
    const storedPlan = attendancePlanFromCompensationSnapshot(storedCompensationSnapshot);
    if (record.clock_out) {
        const plan = storedPlan || attendancePlanPayload({
            plannedStart: record.planned_start || null,
            plannedEnd: record.planned_end || null,
            professionKey: record.primary_profession_key || null,
            source: initialPlanSource
        });
        return {
            record: decorateAttendanceRecord(
                { ...record, plan_source: initialPlanSource },
                attendancePlanForDecoration(plan)
            ),
            plan,
            planSource: initialPlanSource,
            payroll: null,
            alreadyClockedOut: true,
            auditWritten: false
        };
    }

    const resolvedPlan = storedPlan || await resolveAttendancePlan(db, staffId, recordDate);
    const plannedStart = storedPlan?.plannedStart || record.planned_start || resolvedPlan.plannedStart || null;
    const plannedEnd = storedPlan?.plannedEnd || record.planned_end || resolvedPlan.plannedEnd || null;
    const plan = {
        primaryProfessionKey: resolvedPlan.professionKey || resolvedPlan.primaryProfessionKey || null,
        plannedStart,
        plannedEnd,
        segments: storedPlan
            ? (storedPlan.segments || [])
            : resolvedPlan.source === HR_ATTENDANCE_PLAN_SOURCES.HR_SHIFT
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
    const compensationBaseSnapshot = storedCompensationSnapshot
        || buildLegacyAttendanceCompensationSnapshot({
            staffId,
            recordDate,
            plan: {
                ...plan,
                professionKey: plan.primaryProfessionKey,
                source: initialPlanSource
            },
            planSource: initialPlanSource,
            capturedAt: record.clock_in
        });
    const compensationSnapshot = finalizeAttendanceCompensationSnapshot(
        compensationBaseSnapshot,
        payroll.allocation,
        {
            staffId,
            recordDate,
            finalizedAt: clockOut
        }
    );
    if (compensationSnapshot.manualReview) payroll.status = 'manual_review';

    const writeResult = await db.query(
        `UPDATE hr_time_records SET
            clock_out = $1, total_worked_minutes = $2, late_minutes = $3,
            early_leave_minutes = $4, overtime_minutes = $5, status = $6,
            compensation_snapshot = $7::jsonb, updated_at = NOW()
         WHERE id = $8 RETURNING *`,
        [
            clockOut,
            payroll.totalWorkedMinutes,
            payroll.lateMinutes,
            payroll.earlyLeaveMinutes,
            payroll.overtimeMinutes,
            payroll.status,
            JSON.stringify(compensationSnapshot),
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
        compensation_allocations: compensationSnapshot.compensationAllocations,
        compensation_totals: compensationSnapshot.totals,
        compensation_snapshot_state: compensationSnapshot.state,
        compensation_issues: compensationSnapshot.issues,
        allocation_issues: payroll.allocation.allocationIssues,
        status: payroll.status,
        method,
        source,
        plan_source: initialPlanSource
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
    if (!storedCompensationSnapshot) {
        await db.query(
            `INSERT INTO hr_audit_log (action, staff_id, performed_by, details, ip_address)
             VALUES ('compensation_snapshot_created', $1, $2, $3, $4)`,
            [
                staffId,
                input.performedBy || input.performed_by || method,
                JSON.stringify({
                    eventVersion: 1,
                    recordId: record.id,
                    recordDate,
                    source,
                    trigger: 'legacy_clock_out',
                    snapshotState: compensationSnapshot.state,
                    snapshotSchemaVersion: compensationSnapshot.schemaVersion,
                    planSource: compensationSnapshot.planSource,
                    compensationSnapshot
                }),
                input.ip || null
            ]
        );
    }

    return {
        record: writtenRecord
            ? decorateAttendanceRecord({
                ...writtenRecord,
                compensation_snapshot: writtenRecord.compensation_snapshot || compensationSnapshot,
                plan_source: initialPlanSource
            }, attendancePlanForDecoration({
                professionKey: plan.primaryProfessionKey,
                plannedStart,
                plannedEnd,
                segments: plan.segments,
                source: initialPlanSource
            }))
            : null,
        plan: attendancePlanPayload({
            plannedStart,
            plannedEnd,
            professionKey: plan.primaryProfessionKey,
            segments: plan.segments,
            source: initialPlanSource
        }),
        planSource: initialPlanSource,
        payroll,
        alreadyClockedOut: false,
        auditWritten: true
    };
}

module.exports = {
    HR_ATTENDANCE_GRACE_MINUTES,
    HR_ATTENDANCE_BREAK_POLICY,
    HR_ATTENDANCE_COMPENSATION_SNAPSHOT_VERSION,
    HR_ATTENDANCE_PLAN_SOURCES,
    allocateAttendanceToSegments,
    actualWorkedMinutes,
    attendanceDayType,
    attendanceAllocationFields,
    attendanceCsvCell,
    attendanceCsvRow,
    attendanceFactMinutes,
    attendancePlanWarningMessage,
    attendancePlanFromCompensationSnapshot,
    attendanceReportingFacts,
    buildAttendanceCompensationPlanSnapshot,
    buildLegacyAttendanceCompensationSnapshot,
    calculateAttendanceClockIn,
    calculateHrClockOutPayroll,
    decorateAttendanceRecord,
    finalizeAttendanceCompensationSnapshot,
    hydrateAttendanceRecords,
    isAttendanceRecordOpen,
    normalizeHrSettlementMode,
    parseAttendanceCompensationSnapshot,
    paidMinutesAfterSegmentBreak,
    plannedShiftWorkedMinutes,
    recordAttendanceClockIn,
    recordAttendanceClockOut,
    recordAttendanceStatus,
    resolveAttendancePlan,
    summarizeHrTodayItems,
    timeToMinutes
};
