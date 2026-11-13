'use strict';
const c = require('./staffSubstitutionContract');
const { validateStaffScheduleabilityCardForDate } = require('./staffOperationalFilters');
const { resolveCapability } = require('./accountAccessPolicy');

function localInstant(date, time, nextDay = false) {
    const localDate = nextDay ? new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10) : date;
    const candidates = ['+02:00', '+03:00'].map(offset => `${localDate}T${String(time).slice(0, 5)}:00${offset}`)
        .filter(value => c.kyivParts(value).date === localDate && c.kyivParts(value).time === String(time).slice(0, 5));
    if (candidates.length !== 1) return null;
    return new Date(candidates[0]).toISOString();
}

async function loadContext(db, business, actor, input, source, current = null) {
    const blockers = [...(source.blockers || [])];
    const staff = (await db.query('SELECT * FROM staff WHERE id=$1', [input.staffId])).rows[0];
    const eligibility = validateStaffScheduleabilityCardForDate(staff, input.workDate);
    if (!eligibility.ok) blockers.push({ code: eligibility.code, message: eligibility.error });
    const profession = (await db.query('SELECT * FROM hr_professions WHERE key=$1 AND is_active=true', [input.professionKey])).rows[0];
    if (!profession) blockers.push({ code: 'SUBSTITUTION_PROFESSION_UNAVAILABLE', message: 'Професію не знайдено або вона неактивна' });
    const admission = (await db.query('SELECT * FROM staff_role_assignments WHERE staff_id=$1 AND profession_key=$2', [input.staffId, input.professionKey])).rows[0];
    const existingAdmission = staff?.role_type === input.professionKey || admission?.status === 'active' && admission?.admission_status === 'approved';
    if (!existingAdmission && !(input.temporaryAdmission && resolveCapability(actor, 'hr.staff.manage', { type: 'action' }).allowed)) {
        blockers.push({ code: 'SUBSTITUTION_ADMISSION_REQUIRED', message: 'Потрібен погоджений допуск або явний разовий допуск керівника HR' });
    }
    if (admission && admission.admission_status !== 'approved' && input.temporaryAdmission) {
        blockers.push({ code: 'SUBSTITUTION_ADMISSION_PENDING', message: 'Існуючий непогоджений допуск потрібно вирішити в картці професії' });
    }
    let standardRate = null;
    if (staff) {
        const payroll = require('./payroll');
        const profiles = await payroll.loadPayrollProfileContext([input.staffId], { from: input.workDate, to: input.workDate }, db);
        if (profiles.enabled === false) c.fail('SUBSTITUTION_RATE_UNAVAILABLE', 'Не вдалося завантажити умови оплати', 503);
        const rates = await payroll.loadProfessionRateMap([input.staffId], db);
        const resolved = payroll.resolveEffectivePayrollProfile({ ...staff, hourly_rate: 0, hourlyRate: 0 }, input.professionKey, input.workDate,
            { payrollProfileContext: profiles, professionRateMap: rates });
        if (resolved.rate > 0 && !resolved.warnings?.length && ['hour', 'day'].includes(resolved.rateUnit)) {
            standardRate = { rateMinor: c.decimalUnits(String(resolved.rate), 2, 'стандартна ставка'),
                payUnit: resolved.rateUnit === 'day' ? 'shift' : 'hour', source: resolved.rateSource,
                profileId: resolved.profileId, profileVersionId: resolved.profileVersionId,
                assignmentId: resolved.assignmentId, title: resolved.profileTitle, appliedRule: resolved.appliedRule };
        }
    }
    const commitments = [];
    const shifts = (await db.query(`SELECT hs.id,hs.shift_date::text AS date,hs.updated_at,seg.id AS segment_id,
        COALESCE(seg.planned_start,hs.planned_start)::text AS start_time,
        COALESCE(seg.planned_end,hs.planned_end)::text AS end_time
        FROM hr_shifts hs LEFT JOIN hr_shift_segments seg ON seg.hr_shift_id=hs.id
        WHERE hs.staff_id=$1 AND hs.shift_date BETWEEN $2::date-1 AND $2::date+1 ORDER BY hs.id,seg.id`, [input.staffId,input.workDate])).rows;
    for (const shift of shifts) {
        if (source.ownedShiftId && Number(shift.id) === Number(source.ownedShiftId)) continue;
        const startsAt = localInstant(shift.date, shift.start_time);
        const endsAt = localInstant(shift.date, shift.end_time, shift.end_time <= shift.start_time);
        if (!startsAt || !endsAt) blockers.push({ code: 'SUBSTITUTION_SCHEDULE_TIME_AMBIGUOUS', message: 'Час існуючої зміни неоднозначний через переведення годинника' });
        else commitments.push({ id: shift.segment_id || shift.id, source: 'hr_shift', startsAt, endsAt,
            simultaneousAllowed: input.payMode === 'additional' });
    }
    const others = (await db.query(`SELECT id,input_json,state,version FROM staff_substitutions
        WHERE staff_id=$1 AND state <> 'cancelled' AND work_date BETWEEN $2::date-1 AND $2::date+1
        AND ($3::bigint IS NULL OR id<>$3) ORDER BY id`, [input.staffId,input.workDate,current?.id || null])).rows;
    for (const item of others) commitments.push({ id: String(item.id), source: 'substitution', ...item.input_json, simultaneousAllowed: false });
    const tasks = (await db.query(`SELECT t.id,t.version,t.scheduled_start_at,t.scheduled_end_at
        FROM tasks t JOIN employee_profiles ep ON ep.user_id=t.owner_user_id
        WHERE ep.staff_id=$1 AND t.scheduled_start_at < ($2::date+2)::timestamptz
        AND t.scheduled_end_at > ($2::date-1)::timestamptz AND t.status NOT IN ('done','cancelled','archived') ORDER BY t.id`, [input.staffId,input.workDate])).rows;
    for (const task of tasks) {
        if (input.sourceType === 'task' && String(task.id) === input.sourceId) continue;
        commitments.push({ id: task.id, source: 'task', startsAt: new Date(task.scheduled_start_at).toISOString(), endsAt: new Date(task.scheduled_end_at).toISOString() });
    }
    // Read the canonical dated roster; never infer a booking line from a worker name.
    const { getAnimatorTimelineLines } = require('./booking');
    const { birthdaySlotsForEvents } = require('./afishaBirthdaySlots');
    const calendarEvidence = [];
    for (const offset of [-1,0,1]) {
        const date = new Date(Date.parse(input.workDate) + offset * 86400000).toISOString().slice(0,10);
        const lines = (await getAnimatorTimelineLines(date,db)).filter(line => Number(line.staffId) === input.staffId).map(line => String(line.id));
        const bookings = (await db.query(`SELECT id,time::text,duration FROM bookings
            WHERE date=$1 AND LOWER(COALESCE(NULLIF(BTRIM(status),''),'confirmed')) <> 'cancelled'
            AND ((COALESCE(business_context,'event_genix')='event_genix' AND line_id=ANY($2::text[]))
                OR COALESCE(extra_data->'educationLesson'->>'teacherId',extra_data->'education_lesson'->>'teacherId',extra_data->'bookingWorkspace'->'lesson'->>'teacherId')=$3)
            ORDER BY id`,[date,lines,String(input.staffId)])).rows;
        const events = lines.length ? await birthdaySlotsForEvents(db,(await db.query('SELECT * FROM afisha WHERE date=$1 ORDER BY id',[date])).rows) : [];
        const slots = [...bookings.map(row => ({...row,source:'booking'})), ...events.filter(row =>
            (lines.includes(String(row.line_id)) || lines.includes(String(row.second_line_id)))
            && !(input.sourceType==='afisha' && String(row.id)===input.sourceId))
            .flatMap(row => (row.birthday_slots?.length ? row.birthday_slots : [{time:row.time,duration:row.duration || 60}])
                .map(slot => ({id:row.id,time:slot.time,duration:slot.duration,source:'afisha'})))];
        for (const slot of slots) {
            const startsAt = localInstant(date,slot.time);
            if (!startsAt || !(Number(slot.duration)>0)) { blockers.push({code:'SUBSTITUTION_SOURCE_TIME_INVALID',message:'У календарі є робота з невизначеним часом; спочатку перевірте її'}); continue; }
            const item={id:slot.id,source:slot.source,startsAt,endsAt:new Date(Date.parse(startsAt)+Number(slot.duration)*60000).toISOString()};
            commitments.push(item);
            calendarEvidence.push(item);
        }
    }
    const duplicate = (await db.query(`SELECT id FROM staff_substitutions WHERE business_context=$1 AND source_type=$2 AND source_id=$3
        AND slot_key=$4 AND work_date=$5 AND state <> 'cancelled' AND ($6::bigint IS NULL OR id<>$6)`,
        [business,input.sourceType,input.sourceId,input.slotKey,input.workDate,current?.id || null])).rows;
    if (duplicate.length) blockers.push({ code: 'SUBSTITUTION_DUPLICATE', message: 'Ця робота вже має активну підміну' });
    const records = (await db.query(`SELECT id,staff_id,clock_in,clock_out,compensation_snapshot,updated_at FROM hr_time_records
        WHERE staff_id=ANY($1::int[]) AND record_date=$2 ORDER BY staff_id`, [[input.staffId,input.originalStaffId].filter(Boolean),input.workDate])).rows;
    if (records.some(row => Number(row.staff_id) === input.originalStaffId && row.clock_in)
        && input.originalTreatment === 'transfer_unworked_scope') blockers.push({ code: 'SUBSTITUTION_ORIGINAL_STARTED', message: 'Замінений працівник уже почав роботу; перенесення потребує окремого коригування обліку' });
    if (current && records.some(row => row.clock_in)) blockers.push({ code: 'SUBSTITUTION_WORK_STARTED', message: 'Після початку роботи погоджені умови не редагуються' });
    return { blockers, commitments, standardRate,
        evidence: { staff: staff ? { id: staff.id, isActive: staff.is_active, role: staff.role_type, terminationDate: staff.termination_date } : null,
            profession: profession ? { key: profession.key, title: profession.title } : null, admission: admission || null,
            source, shifts, otherVersions: others.map(row => [String(row.id),row.version,row.state]), tasks, calendarEvidence,
            records: records.map(row => ({ id: row.id, staffId: row.staff_id, clockIn: row.clock_in, clockOut: row.clock_out, updatedAt: row.updated_at })) } };
}

module.exports = { loadContext, localInstant };
