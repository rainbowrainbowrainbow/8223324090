'use strict';

const { timeToMinutes } = require('./booking');

const TEACHER_ID_SQL = "COALESCE(extra_data->'educationLesson'->>'teacherId', extra_data->'education_lesson'->>'teacherId', extra_data->'bookingWorkspace'->'lesson'->>'teacherId')";
const TEACHER_NAME_SQL = "COALESCE(extra_data->'educationLesson'->>'teacherName', extra_data->'education_lesson'->>'teacherName', extra_data->'bookingWorkspace'->'lesson'->>'teacherName', '')";
const ACTIVE_BOOKING_SQL = "LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) <> 'cancelled'";

function readLesson(extra, payload = {}) {
    const lesson = extra?.educationLesson || extra?.education_lesson || extra?.bookingWorkspace?.lesson;
    if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) return null;
    const teacherId = String(lesson.teacherId || '').trim();
    const teacherName = String(lesson.teacherName || '').trim();
    const title = String(lesson.title || payload.programName || payload.label || '').trim();
    const groupName = String(lesson.groupName || payload.groupName || '').trim();
    const courseCode = String(lesson.courseCode || '').trim();
    if (!teacherId && !teacherName && !title && !groupName && !courseCode && lesson.mode !== 'education_lesson') return null;
    return { ...lesson, teacherId, teacherName, title: title || 'Заняття' };
}

function overlapsBookingTime(candidate, other) {
    const start = timeToMinutes(candidate.time);
    const end = start + (parseInt(candidate.duration, 10) || 0);
    const otherStart = timeToMinutes(other.time);
    const otherEnd = otherStart + (parseInt(other.duration, 10) || 0);
    return start < otherEnd && end > otherStart;
}

async function findTeacherConflict(db, payload, lesson, businessContext, excludeIds = []) {
    if (!lesson || !payload?.date || !payload?.time || !(parseInt(payload.duration, 10) > 0)) return null;
    const filters = [];
    const params = [payload.date, businessContext, excludeIds.map(String)];
    if (lesson.teacherId) {
        params.push(lesson.teacherId);
        filters.push(`${TEACHER_ID_SQL} = $${params.length}`);
    }
    if (lesson.teacherName) {
        params.push(lesson.teacherName.toLowerCase());
        const legacyOnly = lesson.teacherId ? `NULLIF(BTRIM(${TEACHER_ID_SQL}), '') IS NULL AND ` : '';
        filters.push(`(${legacyOnly}LOWER(${TEACHER_NAME_SQL}) = $${params.length})`);
    }
    if (!filters.length) return null;
    const result = await db.query(
        `SELECT id, time, duration, label, program_code, program_name, room, extra_data FROM bookings
         WHERE date = $1 AND COALESCE(business_context, 'event_genix') = $2 AND ${ACTIVE_BOOKING_SQL}
           AND id != ALL($3::text[]) AND (${filters.join(' OR ')})`, params);
    return result.rows.find(row => overlapsBookingTime(payload, row)) || null;
}

module.exports = { TEACHER_ID_SQL, ACTIVE_BOOKING_SQL, readLesson, overlapsBookingTime, findTeacherConflict };
