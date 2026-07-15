'use strict';

const ATTENDANCE_WRITE_LOCK_NAMESPACE = 'eventgenix:attendance-write:v1';
const ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY = 'eventgenix:attendance-write:maintenance:v1';

function attendanceLockError(message, details = undefined) {
    const error = new Error(message);
    error.code = 'ATTENDANCE_WRITE_LOCK_TARGET_INVALID';
    error.statusCode = 400;
    if (details !== undefined) error.details = details;
    return error;
}

function normalizeAttendanceWriteDate(value) {
    const text = value instanceof Date
        ? (Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10))
        : String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw attendanceLockError('Attendance write date must use YYYY-MM-DD', { date: text || null });
    }
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
        throw attendanceLockError('Attendance write date is invalid', { date: text });
    }
    return text;
}

function normalizeAttendanceWriteTarget(value = {}) {
    const staffId = Number(value.staffId ?? value.staff_id);
    if (!Number.isSafeInteger(staffId) || staffId <= 0 || staffId > 2147483647) {
        throw attendanceLockError('Attendance write staffId must be a positive integer', {
            staffId: value.staffId ?? value.staff_id ?? null
        });
    }
    return {
        staffId,
        date: normalizeAttendanceWriteDate(value.date ?? value.recordDate ?? value.record_date)
    };
}

function attendanceWriteLockKey(value) {
    const target = normalizeAttendanceWriteTarget(value);
    // hr_time_records and staff_checkins are both unique by staff/date, not by business context.
    return `${ATTENDANCE_WRITE_LOCK_NAMESPACE}:${target.staffId}:${target.date}`;
}

function normalizeAttendanceWriteTargets(values = []) {
    if (!Array.isArray(values)) {
        throw attendanceLockError('Attendance write lock targets must be an array');
    }
    const unique = new Map();
    for (const value of values) {
        const target = normalizeAttendanceWriteTarget(value);
        unique.set(`${target.staffId}:${target.date}`, target);
    }
    return [...unique.values()].sort((left, right) => (
        left.date.localeCompare(right.date) || left.staffId - right.staffId
    ));
}

async function lockAttendanceWriteTargets(db, values = []) {
    if (!db || typeof db.query !== 'function') {
        throw new TypeError('Attendance write locks require a queryable transaction client');
    }
    const targets = normalizeAttendanceWriteTargets(values);
    if (!targets.length) return targets;
    // Every caller must invoke this with a client after BEGIN. Outside an explicit transaction,
    // PostgreSQL releases pg_advisory_xact_lock at the end of this statement and it is ineffective.
    // The shared maintenance gate prevents a wholesale restore/cleanup from crossing a day write.
    await db.query(
        'SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))',
        [ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY]
    );
    for (const target of targets) {
        await db.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [attendanceWriteLockKey(target)]
        );
    }
    return targets;
}

async function lockAttendanceWriteTarget(db, value) {
    const [target] = await lockAttendanceWriteTargets(db, [value]);
    return target;
}

async function lockAttendanceWriteMaintenance(db) {
    if (!db || typeof db.query !== 'function') {
        throw new TypeError('Attendance maintenance lock requires a queryable transaction client');
    }
    // Maintenance callers take only this exclusive gate, immediately after BEGIN and before
    // any staff/schedule/attendance row lock. Never upgrade a shared gate inside one transaction.
    await db.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY]
    );
    return ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY;
}

module.exports = {
    ATTENDANCE_WRITE_MAINTENANCE_LOCK_KEY,
    ATTENDANCE_WRITE_LOCK_NAMESPACE,
    attendanceWriteLockKey,
    lockAttendanceWriteMaintenance,
    lockAttendanceWriteTarget,
    lockAttendanceWriteTargets,
    normalizeAttendanceWriteDate,
    normalizeAttendanceWriteTarget,
    normalizeAttendanceWriteTargets
};
