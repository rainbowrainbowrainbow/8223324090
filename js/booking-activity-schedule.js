(function bookingActivityScheduleModule(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.BookingActivitySchedule = Object.assign(root.BookingActivitySchedule || {}, api);
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function bookingActivityScheduleFactory() {
    const SELECTED_ACTIVITY_SCHEDULE_STEP_MINUTES = 15;
    const DEFAULT_SELECTED_ACTIVITY_SCHEDULE_WORKDAY = Object.freeze({
        weekdayStart: '12:00',
        weekdayEnd: '20:00',
        weekendStart: '10:00',
        weekendEnd: '20:00'
    });

    function normalizeSelectedActivityScheduleTime(value) {
        const raw = String(value || '').trim();
        const match = raw.match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return '';
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (!Number.isInteger(hours)
            || !Number.isInteger(minutes)
            || hours < 0
            || hours > 23
            || minutes < 0
            || minutes > 59) {
            return '';
        }
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    function normalizeSelectedActivityScheduleStep(value) {
        const step = Number(value);
        if (!Number.isFinite(step) || step <= 0) return SELECTED_ACTIVITY_SCHEDULE_STEP_MINUTES;
        return Math.max(1, Math.trunc(step));
    }

    function scheduleTimeToMinutes(value) {
        const time = normalizeSelectedActivityScheduleTime(value);
        if (!time) return null;
        const [hours, minutes] = time.split(':').map(Number);
        return (hours * 60) + minutes;
    }

    function scheduleMinutesToTime(value) {
        const total = Number(value);
        if (!Number.isFinite(total)) return '';
        const minutes = ((Math.trunc(total) % 1440) + 1440) % 1440;
        return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    }

    function scheduleHourToTime(value) {
        if (Number.isFinite(Number(value)) && String(value).trim() !== '') {
            const hour = Math.trunc(Number(value));
            if (hour >= 0 && hour <= 23) return `${String(hour).padStart(2, '0')}:00`;
        }
        return normalizeSelectedActivityScheduleTime(value);
    }

    function normalizeSelectedActivityScheduleDate(value) {
        if (value instanceof Date && Number.isFinite(value.getTime())) return value;
        if (!value) return null;
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }

    function resolveSelectedActivityScheduleWorkday(options = {}) {
        const timeline = options.timelineConfig || {};
        const date = normalizeSelectedActivityScheduleDate(options.date);
        const isWeekend = options.isWeekend !== undefined
            ? Boolean(options.isWeekend)
            : (date ? [0, 6].includes(date.getDay()) : false);
        const startSource = isWeekend ? timeline.WEEKEND_START : timeline.WEEKDAY_START;
        const endSource = isWeekend ? timeline.WEEKEND_END : timeline.WEEKDAY_END;
        const fallbackStart = isWeekend
            ? DEFAULT_SELECTED_ACTIVITY_SCHEDULE_WORKDAY.weekendStart
            : DEFAULT_SELECTED_ACTIVITY_SCHEDULE_WORKDAY.weekdayStart;
        const fallbackEnd = isWeekend
            ? DEFAULT_SELECTED_ACTIVITY_SCHEDULE_WORKDAY.weekendEnd
            : DEFAULT_SELECTED_ACTIVITY_SCHEDULE_WORKDAY.weekdayEnd;
        const start = scheduleHourToTime(startSource) || fallbackStart;
        const end = scheduleHourToTime(endSource) || fallbackEnd;
        const startMinutes = scheduleTimeToMinutes(start);
        const endMinutes = scheduleTimeToMinutes(end);
        if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
            return resolveSelectedActivityScheduleWorkday({
                ...options,
                timelineConfig: {},
                isWeekend
            });
        }
        return {
            isWeekend,
            start,
            end,
            startMinutes,
            endMinutes,
            stepMinutes: normalizeSelectedActivityScheduleStep(options.stepMinutes)
        };
    }

    function alignSelectedActivityScheduleMinutes(value, options = {}) {
        const minutes = Number(value);
        if (!Number.isFinite(minutes)) return null;
        const workday = resolveSelectedActivityScheduleWorkday(options);
        const step = workday.stepMinutes;
        const mode = options.mode || 'ceil';
        const delta = minutes - workday.startMinutes;
        const ratio = delta / step;
        let steps;
        if (mode === 'floor') steps = Math.floor(ratio);
        else if (mode === 'nearest') steps = Math.round(ratio);
        else steps = Math.ceil(ratio);
        return workday.startMinutes + (steps * step);
    }

    function snapSelectedActivityScheduleTime(value, options = {}) {
        const minutes = scheduleTimeToMinutes(value);
        if (minutes === null) return '';
        const aligned = alignSelectedActivityScheduleMinutes(minutes, options);
        return aligned === null ? '' : scheduleMinutesToTime(aligned);
    }

    function buildSelectedActivityScheduleTimeOptions(options = {}) {
        const workday = resolveSelectedActivityScheduleWorkday(options);
        const latestStart = Number.isFinite(Number(options.latestStartMinutes))
            ? Math.min(workday.endMinutes, Math.trunc(Number(options.latestStartMinutes)))
            : workday.endMinutes;
        const slots = [];
        for (let minutes = workday.startMinutes; minutes <= latestStart; minutes += workday.stepMinutes) {
            slots.push(scheduleMinutesToTime(minutes));
        }
        return slots;
    }

    function isSelectedActivityScheduleSlotTime(value, options = {}) {
        const time = normalizeSelectedActivityScheduleTime(value);
        if (!time) return false;
        const minutes = scheduleTimeToMinutes(time);
        if (minutes === null) return false;
        const workday = resolveSelectedActivityScheduleWorkday(options);
        const latestStart = Number.isFinite(Number(options.latestStartMinutes))
            ? Math.min(workday.endMinutes, Math.trunc(Number(options.latestStartMinutes)))
            : workday.endMinutes;
        if (minutes < workday.startMinutes || minutes > latestStart) return false;
        return (minutes - workday.startMinutes) % workday.stepMinutes === 0;
    }

    function buildSelectedActivityScheduleRows(programs = [], options = {}) {
        const scheduleTimes = options.scheduleTimes || {};
        const alignOptions = { ...options, mode: 'ceil' };
        const slotTimesOnly = options.slotTimesOnly !== false;
        const allowInvalidManualTimes = options.allowInvalidManualTimes === true;
        let nextTime = normalizeSelectedActivityScheduleTime(options.baseTime || '');
        if (nextTime && slotTimesOnly) nextTime = snapSelectedActivityScheduleTime(nextTime, alignOptions);
        return (programs || []).filter(Boolean).map((program, index) => {
            const programId = String(program.id);
            const rawManualTime = normalizeSelectedActivityScheduleTime(scheduleTimes[programId]);
            const manualTime = rawManualTime && (allowInvalidManualTimes || !slotTimesOnly || isSelectedActivityScheduleSlotTime(rawManualTime, options))
                ? rawManualTime
                : '';
            const time = manualTime || nextTime || '';
            const resolvedDuration = typeof options.durationForProgram === 'function'
                ? options.durationForProgram(program, index)
                : program.duration;
            const duration = Number(resolvedDuration || 0) || 0;
            const startMinutes = time ? scheduleTimeToMinutes(time) : null;
            const endMinutes = startMinutes !== null ? startMinutes + duration : null;
            const endTime = endMinutes !== null ? scheduleMinutesToTime(endMinutes) : '';
            if (time) {
                const nextMinutes = slotTimesOnly
                    ? alignSelectedActivityScheduleMinutes((startMinutes || 0) + duration, alignOptions)
                    : (startMinutes || 0) + duration;
                nextTime = scheduleMinutesToTime(nextMinutes);
            }
            return {
                index,
                program,
                programId,
                time,
                duration,
                endTime,
                startMinutes,
                endMinutes,
                manual: Boolean(manualTime)
            };
        });
    }

    function selectedActivityScheduleExtra(rows = []) {
        return rows.map(row => ({
            index: row.index + 1,
            programId: row.programId,
            startTime: row.time || null,
            endTime: row.endTime || null,
            duration: row.duration || 0,
            manual: Boolean(row.manual)
        }));
    }

    function selectedActivityScheduleRange(row = {}) {
        if (Number.isFinite(row.startMinutes) && Number.isFinite(row.endMinutes)) {
            return { start: row.startMinutes, end: row.endMinutes };
        }
        const start = scheduleTimeToMinutes(row.time || '');
        const duration = Number(row.duration || 0) || 0;
        if (start === null || duration <= 0) return null;
        return { start, end: start + duration };
    }

    function selectedActivityScheduleOverlaps(first = {}, second = {}) {
        const a = selectedActivityScheduleRange(first);
        const b = selectedActivityScheduleRange(second);
        if (!a || !b) return false;
        return a.start < b.end && a.end > b.start;
    }

    return {
        normalizeSelectedActivityScheduleTime,
        scheduleTimeToMinutes,
        scheduleMinutesToTime,
        normalizeSelectedActivityScheduleStep,
        resolveSelectedActivityScheduleWorkday,
        snapSelectedActivityScheduleTime,
        buildSelectedActivityScheduleTimeOptions,
        isSelectedActivityScheduleSlotTime,
        buildSelectedActivityScheduleRows,
        selectedActivityScheduleExtra,
        selectedActivityScheduleRange,
        selectedActivityScheduleOverlaps
    };
});
