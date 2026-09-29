'use strict';

const { pool } = require('../db');

class EducationAttendanceError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function isoDate(value, label) {
    const date = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || !date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new EducationAttendanceError(`${label}: invalid date`);
    }
    return value;
}

function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new EducationAttendanceError(`${label}: invalid ID`);
    return id;
}

function bookingIdValue(value) {
    const id = String(value || '').trim();
    if (!id || id.length > 50) throw new EducationAttendanceError('Invalid booking ID');
    return id;
}

function lessonFromBooking(row) {
    const extra = row.extra_data && typeof row.extra_data === 'object' ? row.extra_data : {};
    const lesson = extra.educationLesson || extra.education_lesson || extra.bookingWorkspace?.lesson;
    if (!lesson || typeof lesson !== 'object') throw new EducationAttendanceError('Booking is not an education lesson', 404);
    if (lesson.groupId == null || lesson.groupId === '') throw new EducationAttendanceError('Lesson has no linked group', 409);
    return { ...lesson, groupId: positiveId(lesson.groupId, 'groupId') };
}

function cancelled(row) {
    return String(row.status || '').trim().toLowerCase() === 'cancelled';
}

async function scopedLesson(db, context, bookingId, lock = false) {
    const result = await db.query(
        `SELECT id, date, time, duration, status, program_name, extra_data
         FROM bookings WHERE id = $1 AND business_context = $2${lock ? ' FOR UPDATE' : ''}`,
        [bookingIdValue(bookingId), context]
    );
    if (!result.rowCount) throw new EducationAttendanceError('Lesson not found in this business', 404);
    const booking = result.rows[0];
    const lesson = lessonFromBooking(booking);
    const group = await db.query(
        `SELECT id, name FROM education_groups WHERE id = $1 AND business_context = $2${lock ? ' FOR SHARE' : ''}`,
        [lesson.groupId, context]
    );
    if (!group.rowCount) throw new EducationAttendanceError('Group not found in this business', 404);
    return { booking, lesson, group: group.rows[0] };
}

async function rosterAtDate(db, context, groupId, date) {
    const result = await db.query(
        `SELECT DISTINCT ON (cc.id) cc.id AS child_id, cc.name AS child_name,
                c.name AS parent_name
         FROM education_group_members m
         JOIN customer_children cc ON cc.id = m.child_id AND cc.business_context = m.business_context
         JOIN customers c ON c.id = cc.customer_id AND COALESCE(c.business_context, 'event_genix') = m.business_context
         WHERE m.business_context = $1 AND m.group_id = $2
           AND m.start_date <= $3::date AND (m.end_date IS NULL OR m.end_date >= $3::date)
         ORDER BY cc.id, m.start_date DESC, m.id DESC`,
        [context, groupId, isoDate(date, 'lesson date')]
    );
    return result.rows;
}

async function storedRows(db, context, bookingId, lock = false) {
    const result = await db.query(
        `SELECT id, child_id, child_name_snapshot AS child_name, parent_name_snapshot AS parent_name,
                status, marked_by, marked_at, snapshot_at, lesson_date::text AS lesson_date
         FROM education_attendance
         WHERE business_context = $1 AND booking_id = $2
         ORDER BY child_name_snapshot NULLS LAST, child_id${lock ? ' FOR UPDATE' : ''}`,
        [context, bookingId]
    );
    return result.rows;
}

async function historyForRows(db, context, rows) {
    if (!rows.length) return [];
    const result = await db.query(
        `SELECT id, attendance_id, previous_status, new_status, changed_by, changed_at
         FROM education_attendance_history
         WHERE business_context = $1 AND attendance_id = ANY($2::bigint[])
         ORDER BY changed_at, id`,
        [context, rows.map(row => row.id)]
    );
    return result.rows;
}

async function readJournal(context, bookingId) {
    const { booking, lesson, group } = await scopedLesson(pool, context, bookingId);
    const saved = await storedRows(pool, context, booking.id);
    const frozen = saved.length > 0;
    const preview = frozen ? [] : await rosterAtDate(pool, context, lesson.groupId, booking.date);
    const history = await historyForRows(pool, context, saved);
    const byAttendance = new Map();
    for (const event of history) {
        const key = String(event.attendance_id);
        if (!byAttendance.has(key)) byAttendance.set(key, []);
        byAttendance.get(key).push(event);
    }
    const members = frozen
        ? saved.map(row => ({ ...row, history: byAttendance.get(String(row.id)) || [] }))
        : preview.map(row => ({ ...row, status: null, marked_by: null, marked_at: null, history: [] }));
    return {
        booking: {
            id: booking.id, date: booking.date, time: booking.time, duration: booking.duration,
            status: booking.status, title: lesson.title || booking.program_name || 'Заняття',
            groupId: lesson.groupId, groupName: lesson.groupName || group.name
        },
        frozen, cancelled: cancelled(booking), members
    };
}

function normalizedMarks(input) {
    if (!Array.isArray(input)) throw new EducationAttendanceError('marks must be an array');
    if (input.length > 500) throw new EducationAttendanceError('Too many marks');
    const marks = new Map();
    for (const item of input) {
        const childId = positiveId(item?.childId, 'childId');
        if (marks.has(childId)) throw new EducationAttendanceError('Duplicate childId in marks');
        const status = item.status == null || item.status === '' ? null : String(item.status);
        if (status !== null && !['present', 'absent', 'excused'].includes(status)) {
            throw new EducationAttendanceError('Invalid attendance status');
        }
        marks.set(childId, status);
    }
    return marks;
}

async function saveJournal(context, bookingId, input, actor) {
    const marks = normalizedMarks(input?.marks);
    const changedBy = String(actor || '').trim();
    if (!changedBy || changedBy.length > 100) throw new EducationAttendanceError('Actor is required', 403);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { booking, lesson } = await scopedLesson(client, context, bookingId, true);
        if (cancelled(booking)) throw new EducationAttendanceError('Cancelled lesson cannot be marked', 409);
        let rows = await storedRows(client, context, booking.id, true);
        if (!rows.length) {
            const roster = await rosterAtDate(client, context, lesson.groupId, booking.date);
            if (!roster.length) throw new EducationAttendanceError('No group members on the lesson date', 409);
            for (const member of roster) {
                await client.query(
                    `INSERT INTO education_attendance
                     (business_context, booking_id, group_id, child_id, lesson_date, child_name_snapshot, parent_name_snapshot)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [context, booking.id, lesson.groupId, member.child_id, booking.date, member.child_name, member.parent_name]
                );
            }
            rows = await storedRows(client, context, booking.id, true);
        }
        const byChild = new Map(rows.map(row => [Number(row.child_id), row]));
        for (const childId of marks.keys()) {
            if (!byChild.has(childId)) throw new EducationAttendanceError('Child is not in this lesson journal', 404);
        }
        let changes = 0;
        for (const [childId, status] of marks) {
            const row = byChild.get(childId);
            if (row.status === status) continue;
            await client.query(
                `UPDATE education_attendance
                 SET status = $3::varchar(16), marked_by = $4,
                     marked_at = CASE WHEN $3::varchar(16) IS NULL THEN NULL ELSE NOW() END,
                     updated_at = NOW()
                 WHERE id = $1 AND business_context = $2`,
                [row.id, context, status, changedBy]
            );
            await client.query(
                `INSERT INTO education_attendance_history
                 (business_context, attendance_id, previous_status, new_status, changed_by)
                 VALUES ($1, $2, $3, $4, $5)`,
                [context, row.id, row.status, status, changedBy]
            );
            changes += 1;
        }
        await client.query('COMMIT');
        return { changes, journal: await readJournal(context, booking.id) };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function kyivClock(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function lessonPhase(booking, clock) {
    if (cancelled(booking)) return 'cancelled';
    const start = String(booking.time || '00:00').split(':').map(Number);
    const endMinutes = start[0] * 60 + start[1] + Math.max(0, Number(booking.duration) || 0);
    const date = String(booking.date).slice(0, 10);
    return date < clock.date || (date === clock.date && endMinutes <= clock.minutes) ? 'held' : 'scheduled';
}

async function report(context, options = {}) {
    const from = isoDate(options.from, 'from');
    const to = isoDate(options.to, 'to');
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    if (days < 0 || days > 366) throw new EducationAttendanceError('Report period must be 0–366 days');
    const groupId = options.groupId ? positiveId(options.groupId, 'groupId') : null;
    if (groupId) {
        const group = await pool.query('SELECT id FROM education_groups WHERE id = $1 AND business_context = $2', [groupId, context]);
        if (!group.rowCount) throw new EducationAttendanceError('Group not found in this business', 404);
    }
    const bookings = await pool.query(
        `SELECT id, date, time, duration, status, program_name, extra_data
         FROM bookings
         WHERE business_context = $1 AND date >= $2 AND date <= $3
           AND extra_data->'educationLesson'->>'groupId' IS NOT NULL
           AND ($4::text IS NULL OR extra_data->'educationLesson'->>'groupId' = $4::text)
         ORDER BY date, time, id LIMIT 5001`,
        [context, from, to, groupId == null ? null : String(groupId)]
    );
    if (bookings.rows.length > 5000) throw new EducationAttendanceError('Report has too many lessons; shorten the period', 413);
    const ids = bookings.rows.map(row => row.id);
    const attendance = ids.length ? await pool.query(
        `SELECT booking_id, status FROM education_attendance
         WHERE business_context = $1 AND booking_id = ANY($2::text[])`,
        [context, ids]
    ) : { rows: [] };
    const byBooking = new Map();
    for (const row of attendance.rows) {
        if (!byBooking.has(row.booking_id)) byBooking.set(row.booking_id, []);
        byBooking.get(row.booking_id).push(row);
    }
    const clock = kyivClock(options.now || new Date());
    const summary = {
        held: 0, cancelled: 0, scheduled: 0, journalsNotStarted: 0,
        present: 0, absent: 0, excused: 0, unmarked: 0
    };
    const lessons = bookings.rows.map(row => {
        const lesson = lessonFromBooking(row);
        const phase = lessonPhase(row, clock);
        const rows = byBooking.get(row.id) || [];
        const counts = { present: 0, absent: 0, excused: 0, unmarked: 0 };
        for (const item of rows) counts[item.status || 'unmarked'] += 1;
        summary[phase] += 1;
        if (phase === 'held') {
            if (!rows.length) summary.journalsNotStarted += 1;
            for (const key of Object.keys(counts)) summary[key] += counts[key];
        }
        return {
            bookingId: row.id, date: row.date, time: row.time,
            title: lesson.title || row.program_name || 'Заняття',
            groupId: lesson.groupId, groupName: lesson.groupName || '',
            phase, journalStarted: rows.length > 0, counts
        };
    });
    return { from, to, groupId, summary, lessons };
}

module.exports = {
    EducationAttendanceError, readJournal, saveJournal, report,
    isoDate, kyivClock, lessonPhase
};
