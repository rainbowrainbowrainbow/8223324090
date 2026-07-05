(function bookingActivityScheduleModule(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.BookingActivitySchedule = Object.assign(root.BookingActivitySchedule || {}, api);
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function bookingActivityScheduleFactory() {
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

    function buildSelectedActivityScheduleRows(programs = [], options = {}) {
        const scheduleTimes = options.scheduleTimes || {};
        let nextTime = normalizeSelectedActivityScheduleTime(options.baseTime || '');
        return (programs || []).filter(Boolean).map((program, index) => {
            const programId = String(program.id);
            const manualTime = normalizeSelectedActivityScheduleTime(scheduleTimes[programId]);
            const time = manualTime || nextTime || '';
            const duration = Number(program.duration || 0) || 0;
            const startMinutes = time ? scheduleTimeToMinutes(time) : null;
            const endMinutes = startMinutes !== null ? startMinutes + duration : null;
            const endTime = endMinutes !== null ? scheduleMinutesToTime(endMinutes) : '';
            if (time) nextTime = scheduleMinutesToTime((startMinutes || 0) + duration);
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
        buildSelectedActivityScheduleRows,
        selectedActivityScheduleExtra,
        selectedActivityScheduleRange,
        selectedActivityScheduleOverlaps
    };
});
