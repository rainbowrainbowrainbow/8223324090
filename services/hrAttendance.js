function normalizeNonNegativeMinutes(value) {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return 0;
    return Math.max(0, Math.round(minutes));
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
    const clockOut = options.clockOut || new Date().toISOString();
    const breakMinutes = normalizeNonNegativeMinutes(options.breakMinutes);
    const plannedStart = options.plannedStart || record.planned_start;
    const plannedEnd = options.plannedEnd || record.planned_end;
    const requestedSettlementMode = normalizeHrSettlementMode(options.settlementMode);
    const actualMinutes = actualWorkedMinutes(record.clock_in, clockOut, breakMinutes);
    const scheduledMinutes = plannedShiftWorkedMinutes(plannedStart, plannedEnd, breakMinutes);
    const useScheduled = requestedSettlementMode === 'scheduled_shift' && scheduledMinutes !== null;

    let earlyLeaveMinutes = 0;
    let overtimeMinutes = 0;
    let status = record.status || 'present';

    if (useScheduled) {
        status = normalizedClosedStatus(status);
    } else {
        const diff = plannedEndDeltaMinutes(plannedEnd, options.kyivNow || new Date());
        if (diff !== null) {
            if (diff > 15) {
                earlyLeaveMinutes = diff;
                status = 'early_leave';
            } else if (diff < -15) {
                overtimeMinutes = Math.abs(diff);
            }
        }

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
        status
    };
}

module.exports = {
    actualWorkedMinutes,
    calculateHrClockOutPayroll,
    normalizeHrSettlementMode,
    plannedShiftWorkedMinutes,
    timeToMinutes
};
