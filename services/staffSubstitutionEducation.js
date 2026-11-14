'use strict';

const c = require('./staffSubstitutionContract');
const { canViewTimelineBooking, canEditBooking } = require('./bookingVisibility');
const { canUseTimelineAction } = require('./timelineContext');
const { resolveCapability } = require('./accountAccessPolicy');
const { listTeachers, assertLessonTeacher } = require('./educationGroups');
const { lockBookingConflictResources } = require('./booking');
const { readLesson, findTeacherConflict, TEACHER_ID_SQL, ACTIVE_BOOKING_SQL } = require('./educationLessonBooking');
const { normalizeAttendanceWriteDate } = require('./attendanceWriteLock');
const { insertHistory } = require('./historyLog');

const log = require('../utils/logger').createLogger('StaffSubstitutionEducation');

const DAR = 'dar';
const TYPE = 'education_lesson';
const teacherKeys = ['teacherId', 'teacherName'];
const paths = [['educationLesson'], ['education_lesson'], ['bookingWorkspace', 'lesson']];

function requireEdit(actor) {
    if (!canUseTimelineAction(actor, DAR, 'edit') || !resolveCapability(actor, 'edit_booking', { type: 'action' }).allowed) {
        c.fail('SUBSTITUTION_SOURCE_FORBIDDEN', 'Немає права змінювати призначення викладачів Дару', 403);
    }
}

function atPath(value, path) {
    return path.reduce((entry, key) => entry?.[key], value);
}

function teacherFields(extra) {
    return paths.flatMap(path => {
        const entry = atPath(extra, path);
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        return [{ path, fields: Object.fromEntries(teacherKeys.filter(key => Object.hasOwn(entry, key)).map(key => [key, entry[key]])) }];
    });
}

function facts(booking, lesson) {
    return { date: booking.date, time: booking.time.slice(0, 5), duration: Number(booking.duration),
        groupId: lesson.groupId ?? null, seriesId: lesson.seriesId ?? null };
}

async function readBooking(db, actor, input) {
    requireEdit(actor);
    const booking = (await db.query(`SELECT *,date::text AS date,time::text AS time FROM bookings
        WHERE id=$1 AND business_context=$2 AND COALESCE(linked_to,'')='' AND ${ACTIVE_BOOKING_SQL}`, [input.sourceId,DAR])).rows[0];
    const lesson = readLesson(booking?.extra_data);
    if (!lesson || !canViewTimelineBooking(actor, booking) || !canEditBooking(actor, booking)) {
        c.fail('SUBSTITUTION_SOURCE_NOT_FOUND', 'Заняття не знайдено', 404);
    }
    return { booking, lesson };
}

async function hasJournal(db, id) {
    return (await db.query('SELECT 1 FROM education_attendance WHERE business_context=$1 AND booking_id=$2 LIMIT 1', [DAR,id])).rowCount > 0;
}

async function lockScope(db, input) {
    const booking = (await db.query('SELECT *,date::text AS date FROM bookings WHERE id=$1 AND business_context=$2 FOR UPDATE',
        [input.sourceId,DAR])).rows[0];
    if (!booking) return;
    const teachers = (await db.query('SELECT id,name FROM staff WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE',
        [[input.originalStaffId,input.staffId].filter(Boolean)])).rows;
    await db.query('SELECT staff_id FROM education_teacher_memberships WHERE business_context=$1 AND staff_id=ANY($2::int[]) ORDER BY staff_id FOR SHARE',
        [DAR,teachers.map(teacher => teacher.id)]);
    await lockRate(db, input.staffId);
    await lockBookingConflictResources(db, [booking, ...teachers.map(teacher => ({
        date: booking.date, extraData: { educationLesson: { teacherId: String(teacher.id), teacherName: teacher.name } }
    }))], DAR);
}

async function loadScope(db, actor, input, current) {
    const { booking, lesson } = await readBooking(db, actor, input);
    const scopeFacts = facts(booking, lesson);
    const expectedTeacher = current?.staff_id ?? input.originalStaffId;
    const aliases = teacherFields(booking.extra_data);
    if (!expectedTeacher || lesson.teacherId !== String(expectedTeacher) || scopeFacts.date !== input.workDate
        || aliases.some(({ fields }) => fields.teacherId && String(fields.teacherId).trim() !== lesson.teacherId)) {
        c.fail('SUBSTITUTION_SOURCE_STALE', 'Перевірте дату й поточного викладача заняття', 409);
    }
    const blockers = [];
    const block = (code, message) => blockers.push({ code, message });
    if (input.professionKey !== 'teacher' || input.payMode !== 'additional' || input.originalTreatment !== 'retain'
        || !['hour', 'fixed'].includes(input.payUnit) || input.temporaryAdmission || input.allowConcurrent) {
        block('DAR_SUBSTITUTION_TERMS', 'У Дарі підміна викладача має погодинну або фіксовану додаткову оплату.');
    }
    const replacement = (await listTeachers(DAR, db)).find(teacher => teacher.id === input.staffId);
    if (!replacement) block('DAR_TEACHER_REQUIRED', 'Оберіть чинного викладача з довідника Дару.');
    if (!input.startsAt || !input.endsAt || c.kyivParts(input.startsAt).time !== scopeFacts.time
        || (Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 60000 !== scopeFacts.duration || input.breakMinutes !== 0) {
        block('DAR_LESSON_TIME_REQUIRED', 'Укажіть точний початок і тривалість заняття без перерви.');
    }
    if (await hasJournal(db, booking.id)) block('SUBSTITUTION_WORK_STARTED', 'У заняття вже є записи в журналі відвідування.');
    if (replacement && await findTeacherConflict(db, booking,
        { teacherId: String(replacement.id), teacherName: replacement.name }, DAR, [booking.id])) {
        block('DAR_TEACHER_CONFLICT', 'У цей час викладач уже проводить інше заняття Дару.');
    }
    const claims = await db.query(`SELECT input_json,source_id,business_context,source_type FROM staff_substitutions
        WHERE state<>'cancelled' AND ($1::bigint IS NULL OR id<>$1)
        AND ((business_context=$2 AND source_type=$3 AND source_id=$4)
          OR (staff_id=$5 AND work_date BETWEEN $6::date-1 AND $6::date+1))`,
    [current?.id ?? null,DAR,TYPE,booking.id,input.staffId,input.workDate]);
    if (claims.rows.some(row => row.business_context === DAR && row.source_type === TYPE && row.source_id === booking.id)) {
        block('SUBSTITUTION_DUPLICATE', 'Це заняття вже має погоджену або завершену підміну.');
    }
    if (claims.rows.some(row => !(row.business_context === DAR && row.source_type === TYPE && row.source_id === booking.id)
        && c.overlap(input, row.input_json))) {
        block('SUBSTITUTION_OVERLAP', 'У цей час викладач уже має іншу погоджену підміну.');
    }
    const rate = input.rateMode === 'standard' ? (await db.query(`SELECT effective_from::text AS date,rate_minor FROM dar_teacher_substitution_rates
        WHERE staff_id=$1 AND pay_unit=$2 AND effective_from<=$3 ORDER BY effective_from DESC LIMIT 1`,
    [input.staffId,input.payUnit,input.workDate])).rows[0] : null;
    return { type: TYPE, facts: scopeFacts, originalFields: current?.source_snapshot.originalFields || aliases,
        replacement: replacement ? { id: replacement.id, name: replacement.name } : null, blockers,
        standardRate: rate ? { rateMinor: rate.rate_minor, payUnit: input.payUnit, effectiveFrom: rate.date,
            source: 'dar_teacher_rate', title: 'Ставка викладача Дару' } : null };
}

async function assertCurrent(db, actor, row) {
    const { booking, lesson } = await readBooking(db, actor, row.input_json);
    if (lesson.teacherId !== String(row.staff_id) || c.fingerprint(facts(booking, lesson)) !== c.fingerprint(row.source_snapshot.facts)
        || teacherFields(booking.extra_data).some(({ fields }) => String(fields.teacherId) !== String(row.staff_id))) {
        c.fail('SUBSTITUTION_SOURCE_STALE', 'Призначення або час заняття змінилися', 409);
    }
    return { booking, lesson };
}

async function assertNoWork(db, input) {
    if (await hasJournal(db, input.sourceId)) c.fail('SUBSTITUTION_WORK_STARTED', 'У заняття вже є записи в журналі відвідування', 409);
}

async function changeAssignment(db, actor, row, restore = false) {
    const { booking, lesson } = restore ? await assertCurrent(db, actor, row) : await readBooking(db, actor, row.input_json);
    await assertNoWork(db, row.input_json);
    const toId = restore ? row.original_staff_id : row.staff_id;
    const next = await assertLessonTeacher(db, DAR, { ...lesson, teacherId: String(toId) }, lesson);
    if (await findTeacherConflict(db, booking, next, DAR, [booking.id])) {
        c.fail('DAR_TEACHER_CONFLICT', 'У цей час викладач уже проводить інше заняття Дару', 409);
    }
    const extra = structuredClone(booking.extra_data);
    for (const { path, fields } of row.source_snapshot.originalFields) {
        const target = atPath(extra, path);
        for (const key of teacherKeys) delete target[key];
        Object.assign(target, restore ? fields : { teacherId: next.teacherId, teacherName: next.teacherName });
    }
    const after = (await db.query('UPDATE bookings SET extra_data=$2,updated_at=NOW() WHERE id=$1 AND business_context=$3 RETURNING *',
        [booking.id,extra,DAR])).rows[0];
    await insertHistory(db, { businessContext: DAR, username: actor.username,
        action: restore ? 'lesson_substitution_restored' : 'lesson_substitution_assigned',
        data: { bookingId: booking.id, substitutionId: String(row.id), fromTeacherId: lesson.teacherId, toTeacherId: next.teacherId } });
    return () => {
        const { broadcastBookingEvent } = require('./websocket');
        void broadcastBookingEvent('booking:updated', after, null, { businessContext: DAR, previousBooking: booking })
            .catch(error => log.warn('Lesson substitution broadcast failed', error.message));
    };
}

async function listScopes(db, actor, date, original) {
    requireEdit(actor);
    const result = await db.query(`SELECT *,time::text AS time,date::text AS date FROM bookings
        WHERE business_context=$1 AND date=$2 AND ${TEACHER_ID_SQL}=$3 AND ${ACTIVE_BOOKING_SQL} AND COALESCE(linked_to,'')=''
        AND duration > 0 ORDER BY bookings.time,bookings.id`, [DAR,date,String(original)]);
    return result.rows.filter(row => canViewTimelineBooking(actor,row) && canEditBooking(actor,row) && readLesson(row.extra_data))
        .map(row => {
            const startTime = row.time.slice(0, 5);
            const base = new Date(`${date}T${startTime}:00Z`).getTime();
            const end = new Date(base + Number(row.duration)*60000).toISOString();
            return { id: row.id, title: `${startTime} · ${readLesson(row.extra_data).title}`, startTime,
                endTime: end.slice(11,16), endDate: end.slice(0,10) };
        });
}

async function listRates(db, staffId) {
    const id = c.integer(staffId, 'викладач', 1);
    const result = await db.query(`SELECT effective_from::text AS "effectiveFrom",pay_unit AS "payUnit",rate_minor AS "rateMinor",reason
        FROM dar_teacher_substitution_rates WHERE staff_id=$1 ORDER BY effective_from DESC,pay_unit LIMIT 101`, [id]);
    if (result.rowCount > 100) c.fail('DAR_RATE_RANGE_LIMIT', 'Для перегляду понад 100 ставок потрібен окремий звіт.');
    return result.rows;
}

async function lockRate(db, staffId) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`dar-teacher-substitution-rate:${staffId}`]);
}

async function saveRate(db, actor, values) {
    const staffId = c.integer(values.staffId, 'викладач', 1);
    const payUnit = c.choice(values.payUnit, ['hour','fixed'], 'одиницю оплати');
    const date = normalizeAttendanceWriteDate(values.effectiveFrom);
    const rateMinor = c.decimalUnits(values.rate, 2, 'ставка');
    c.integer(rateMinor, 'ставка', 1);
    const reason = c.text(values.reason, 'підстава ставки');
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await assertLessonTeacher(client, DAR, { teacherId: String(staffId) });
        await lockRate(client, staffId);
        const saved = await client.query(`INSERT INTO dar_teacher_substitution_rates
            (staff_id,pay_unit,effective_from,rate_minor,reason,created_by)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING staff_id`,
        [staffId,payUnit,date,rateMinor,reason,actor.username]);
        if (!saved.rowCount) {
            const existing = (await client.query(`SELECT rate_minor,reason,created_by FROM dar_teacher_substitution_rates
                WHERE staff_id=$1 AND pay_unit=$2 AND effective_from=$3`, [staffId,payUnit,date])).rows[0];
            if (existing?.rate_minor !== rateMinor || existing.reason !== reason || existing.created_by !== actor.username) {
                c.fail('DAR_RATE_EXISTS', 'Для цієї дати й одиниці ставка вже є. Укажіть нову дату дії.', 409);
            }
        }
        await client.query('COMMIT');
        return { staffId, payUnit, effectiveFrom: date, rateMinor };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { client.release(); }
}

module.exports = { DAR, TYPE, requireEdit, lockScope, loadScope, assertCurrent, assertNoWork, changeAssignment, listScopes, listRates, saveRate };
