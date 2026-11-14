'use strict';
const c = require('./staffSubstitutionContract');
const { loadHrShiftDayPlan } = require('./hrShiftSegments');
const { addScheduleCalendarDays, upsertScheduleMirrorFromPlan, reconcileAnimatorRosterDates } = require('./staffScheduleMutations');
const taskExecution = require('./taskExecution');
const { requireRole } = require('../middleware/auth');
const { resolveCapability } = require('./accountAccessPolicy');
const partialShift = require('./staffSubstitutionShift');
const { localInstant } = require('./staffSubstitutionContext');
const bookingSubstitution = require('./staffSubstitutionBooking');

const education = require('./staffSubstitutionEducation');
const onboarding = require('./staffSubstitutionOnboarding');
const inbox = require('./staffSubstitutionInbox');
const reply = require('./staffSubstitutionReply');
const chatTask = require('./staffSubstitutionChat');
const meeting = require('./staffSubstitutionMeeting');

function requireSourceRole(actor, roles) {
    requireRole(...roles)({ user: actor }, { status() { return this; }, json() {
        c.fail('SUBSTITUTION_SOURCE_FORBIDDEN', 'Немає чинного права передавати призначення цього процесу', 403);
    } }, () => {});
}

async function leadHasTaskClaim(db, business, leadId) {
    const result = await db.query(`SELECT 1 FROM staff_substitutions ss JOIN tasks t ON t.id::text=ss.source_id
        WHERE ss.business_context=$1 AND ss.source_type='task' AND ss.state<>'cancelled'
          AND COALESCE(t.business_context,'event_genix')=$1
          AND ((t.source_type='lead' AND t.source_id=$2) OR (t.source_entity_type='lead' AND t.source_entity_id=$2))
        LIMIT 1`, [business,leadId]);
    return result.rowCount > 0;
}

async function taskHasLeadClaim(db, business, task) {
    const leadIds = [task.source_type === 'lead' ? task.source_id : null,
        task.source_entity_type === 'lead' ? task.source_entity_id : null].filter(Boolean);
    if (!leadIds.length) return false;
    const result = await db.query(`SELECT 1 FROM staff_substitutions WHERE business_context=$1
        AND source_type='lead' AND source_id=ANY($2::text[]) AND state<>'cancelled' LIMIT 1`, [business,leadIds]);
    return result.rowCount > 0;
}

async function loadOfficeScope(db, business, actor, input, current) {
    c.choice(input.slotKey,['primary'],'основний слот');
    const procurement = input.sourceType === 'procurement';
    requireSourceRole(actor, procurement ? ['creator','director','vice_director','senior_manager','manager','admin'] : ['manager','marketer']);
    if (procurement) {
        const availability = await require('./legacyBusinessSurface').loadLegacyBusinessSurfaceAccess(db,business,'contractors_procurement');
        if (!availability.available) c.fail(availability.code,availability.message,availability.status);
    }
    const table = procurement ? 'procurement_lists' : 'leads';
    const found = await db.query(`SELECT id,assigned_to,status,updated_at FROM ${table} WHERE id=$1${procurement ? '' : " AND COALESCE(business_context,'event_genix')=$2"}`,
        procurement ? [input.sourceId] : [input.sourceId,business]);
    const record = found.rows[0];
    if (!record) c.fail('SUBSTITUTION_SOURCE_NOT_FOUND','Призначення не знайдено',404);
    const replacementOwner = procurement ? input.staffId : await accountForStaff(db,input.staffId);
    const originalOwner = procurement ? input.originalStaffId : input.originalStaffId ? await accountForStaff(db,input.originalStaffId) : null;
    if (Number(record.assigned_to) !== Number(current ? replacementOwner : originalOwner)) c.fail('SUBSTITUTION_SOURCE_STALE','Відповідального вже змінено',409);
    const blockers = [];
    if (!procurement && !current && await leadHasTaskClaim(db, business, input.sourceId)) {
        blockers.push({ code: 'SUBSTITUTION_LEAD_ALIAS_CLAIMED', message: 'Для задачі цього ліда вже оформлено підміну.' });
    }
    if (input.originalTreatment === 'transfer_unworked_scope') blockers.push({ code:'SUBSTITUTION_BASE_SOURCE_REQUIRED', message:'Передача відповідального не визначає звичайну зарплату. Для цього процесу збережіть оплату заміненого працівника.' });
    return { type:input.sourceType,record,replacementOwner,originalOwner,blockers };
}

async function loadAfishaScope(db, business, actor, input, current) {
    if (!require('./timelineContext').canUseTimelineAction(actor,business,'edit') || !resolveCapability(actor,'edit_booking',{type:'action'}).allowed) {
        c.fail('SUBSTITUTION_SOURCE_FORBIDDEN','Немає права змінювати призначення Афіші',403);
    }
    const [first, second] = input.slotKey.split(':');
    const occurrence = second ? first : null;
    const animatorRole = second || first;
    const event = (await db.query('SELECT * FROM afisha WHERE id=$1',[input.sourceId])).rows[0];
    if (!event) c.fail('SUBSTITUTION_SOURCE_NOT_FOUND','Захід не знайдено',404);
    const date = event.date instanceof Date ? event.date.toISOString().slice(0,10) : String(event.date).slice(0,10);
    if (date !== input.workDate) c.fail('SUBSTITUTION_SOURCE_STALE','Дата заходу змінилася',409);
    const lines = await require('./booking').getAnimatorTimelineLines(date,db);
    const replacement = lines.find(line => Number(line.staffId)===input.staffId && line.assignmentAllowed && !line.isUnavailable);
    const originalLineId = current ? current.source_snapshot.originalLineId
        : lines.find(line => Number(line.staffId)===input.originalStaffId)?.id;
    const field = animatorRole==='second' ? 'second_line_id' : 'line_id';
    const expectedLine = occurrence || !current ? originalLineId : current.source_snapshot.replacementLineId;
    if (!originalLineId || String(event[field]) !== String(expectedLine)) c.fail('SUBSTITUTION_SOURCE_STALE','Працівник не відповідає канонічній лінії заходу',409);
    const blockers=[];
    const birthdaySlots = require('./afishaBirthdaySlots');
    const greeting = birthdaySlots.isGreetingEvent(event);
    let slot;
    if (greeting) {
        const day = (await db.query('SELECT * FROM afisha WHERE date=$1 ORDER BY id',[date])).rows;
        const assignment = occurrence && replacement && !current
            ? { afisha_id:event.id, occurrence, role:animatorRole, line_id:String(replacement.id) } : null;
        const projected = await birthdaySlots.birthdaySlotsForEvents(db,day,{ assignment });
        slot = projected.find(row => row.id === event.id)?.birthday_slots?.find(item => item.key === (occurrence || 'single'));
        if ((!occurrence && (!current || event.type === 'birthday' || slot?.mode !== 'manual')) || !slot || slot.conflict) {
            blockers.push({ code:'SUBSTITUTION_GREETING_TIME_REQUIRED', message:'Оберіть конкретний слот вітання з доступним часом.' });
        }
    } else if (occurrence) {
        blockers.push({ code:'SUBSTITUTION_OCCURRENCE_REQUIRED', message:'Такий слот існує лише для вітання.' });
    }
    const time = slot?.time || String(event.time).slice(0,5);
    const duration = greeting ? birthdaySlots.DURATION : Number(event.duration || 60);
    const startsAt = localInstant(date, time);
    if (input.professionKey !== 'animator') blockers.push({ code:'SUBSTITUTION_ROSTER_REQUIRED', message:'Оберіть роль аніматора.' });
    if (input.originalTreatment === 'transfer_unworked_scope') blockers.push({ code:'SUBSTITUTION_BASE_SOURCE_REQUIRED',message:'Афіша не визначає базову зарплату. Для цього призначення збережіть оплату заміненого працівника.' });
    if (!startsAt || input.startsAt !== startsAt || !input.endsAt || input.breakMinutes
        || (Date.parse(input.endsAt)-Date.parse(input.startsAt))/60000 !== duration) {
        blockers.push({code:'SUBSTITUTION_EVENT_TIME_REQUIRED',message:'Час підміни має точно відповідати початку та тривалості заходу Афіші'});
    }
    if (!replacement) blockers.push({code:'SUBSTITUTION_ROSTER_REQUIRED',message:'Спочатку додайте погоджену зміну аніматора в графік працівника'});
    if (replacement && (occurrence ? slot?.line_ids.filter(id => id === String(replacement.id)).length > 1
        : String(event[field==='line_id' ? 'second_line_id' : 'line_id'])===String(replacement.id))) blockers.push({code:'SUBSTITUTION_DUPLICATE_SLOT',message:'Працівник уже займає інший слот цього заходу'});
    if (replacement && !require('./booking').isBookingWithinAvailabilityWindows(time,duration,replacement.availabilityWindows)) {
        blockers.push({ code:'SUBSTITUTION_ROSTER_REQUIRED', message:'Виконавець не має робочого вікна на повний час заходу.' });
    }
    return {type:'afisha',event:{id:event.id,date,type:event.type},field,originalLineId:String(originalLineId),
        replacementLineId:replacement ? String(replacement.id) : null,time,duration,occurrence,animatorRole,mode:slot?.mode,blockers};
}

async function accountForStaff(db, staffId) {
    const result = await db.query(`SELECT ep.user_id FROM employee_profiles ep JOIN users u ON u.id=ep.user_id
        WHERE ep.staff_id=$1 AND COALESCE(u.is_active,true)=true ORDER BY ep.user_id`, [staffId]);
    if (result.rows.length !== 1) c.fail('SUBSTITUTION_ACCOUNT_REQUIRED', 'Для задачі потрібен один чинний зв’язок працівника з CRM-користувачем', 409);
    return Number(result.rows[0].user_id);
}

async function assertNoWork(db, input) {
    const result = await db.query(`SELECT id FROM hr_time_records WHERE staff_id=ANY($1::int[]) AND record_date BETWEEN $2 AND $3
        AND (clock_in IS NOT NULL OR clock_out IS NOT NULL OR total_worked_minutes>0) LIMIT 1`,
    [[input.staffId,input.originalStaffId].filter(Boolean),input.workDate,input.endsAt ? c.kyivParts(input.endsAt).date : input.workDate]);
    if (result.rows.length) c.fail('SUBSTITUTION_WORK_STARTED', 'Облік роботи вже розпочато; зміну призначення потрібно погодити окремо', 409);
}

async function loadScope(db, business, actor, input, current) {
    if (business === education.DAR && input.sourceType === education.TYPE) return education.loadScope(db, actor, input, current);
    if (business !== 'event_genix' || input.sourceType === education.TYPE) {
        c.fail('SUBSTITUTION_BUSINESS_UNSUPPORTED', 'Цей вид підміни недоступний у вибраному кабінеті', 403);
    }
    if (input.sourceType === 'meeting_action') return meeting.loadScope(db,business,actor,input,current,accountForStaff);
    if (input.sourceType === 'chat_task') return chatTask.loadScope(db,business,actor,input,current,accountForStaff);
    if (input.sourceType === 'inbox_reply') return reply.loadScope(db,business,actor,input,current,accountForStaff);
    if (input.sourceType === 'inbox') return inbox.loadScope(db, business, actor, input, current, accountForStaff);
    if (input.sourceType === 'onboarding') return onboarding.loadScope(db, actor, input, current, accountForStaff);
    if (['lead','procurement'].includes(input.sourceType)) return loadOfficeScope(db,business,actor,input,current);
    if (input.sourceType==='afisha') return loadAfishaScope(db,business,actor,input,current);
    if (input.sourceType === 'booking') return bookingSubstitution.loadBookingScope(db, actor, input, current);
    if (input.sourceType === 'hr_shift' && input.slotKey === 'partial') return partialShift.loadPartialShiftScope(db, input, current);
    c.choice(input.slotKey,['primary'],'основний слот');
    if (input.sourceType === 'standalone') {
        const blockers = input.originalTreatment === 'transfer_unworked_scope'
            ? [{ code: 'SUBSTITUTION_SOURCE_REQUIRED', message: 'Для перенесення звичайної роботи оберіть існуюче призначення' }] : [];
        return { type: 'standalone', blockers };
    }
    if (input.sourceType === 'hr_shift') {
        const loaded = await loadHrShiftDayPlan(db, { hrShiftId: input.sourceId });
        if (!loaded) c.fail('SUBSTITUTION_SOURCE_NOT_FOUND', 'Зміну не знайдено', 404);
        const owner = current ? input.staffId : input.originalStaffId;
        if (Number(loaded.shift.staff_id) !== owner) c.fail('SUBSTITUTION_SOURCE_STALE', 'Власника зміни вже змінено', 409);
        const date = loaded.shift.shift_date instanceof Date ? loaded.shift.shift_date.toISOString().slice(0,10) : String(loaded.shift.shift_date).slice(0,10);
        if (date !== input.workDate) c.fail('SUBSTITUTION_SOURCE_STALE', 'Дата підміни не відповідає зміні', 409);
        const blockers = [];
        if (loaded.plan.segments.some(segment => segment.workMode === 'freelance')) {
            blockers.push({ code: 'SUBSTITUTION_FREELANCE_SHIFT_UNSUPPORTED',
                message: 'Фріланс-блок потребує окремого призначення та погодження оплати.' });
        }
        if (!input.startsAt || !input.endsAt || loaded.plan.segments.length !== 1 || loaded.plan.segments[0].professionKey !== input.professionKey
            || loaded.plan.segments.some(segment => segment.additionalRoles?.length || segment.additionalProfessionKeys?.length)
            || input.startsAt !== localInstant(input.workDate, loaded.plan.plannedStart)
            || input.endsAt !== localInstant(input.workDate, loaded.plan.plannedEnd,
                loaded.plan.plannedEnd <= loaded.plan.plannedStart)
            || input.breakMinutes !== loaded.plan.breakMinutes) {
            blockers.push({ code: 'SUBSTITUTION_SHIFT_SCOPE_REQUIRED', message: 'Для перенесення зміни оберіть її повний час, перерву та професію; складений план потребує поділу на окремі призначення' });
        }
        if (!current && input.professionKey === 'animator' && await partialShift.conflictsWithAnimatorAssignments(
            db, input.workDate, input.originalStaffId, null)) {
            blockers.push({ code: 'SUBSTITUTION_ANIMATOR_ASSIGNMENT_OUTSIDE_SHIFT',
                message: 'У заміненого аніматора є призначення. Спершу погодьте їх окрему передачу.' });
        }
        const existing = (await db.query('SELECT id FROM hr_shifts WHERE staff_id=$1 AND shift_date=$2 AND id<>$3', [input.staffId,input.workDate,input.sourceId])).rows;
        if (!current && (await db.query('SELECT id FROM staff_schedule WHERE staff_id=$1 AND date=$2',
            [input.staffId, input.workDate])).rowCount) {
            blockers.push({ code: 'SUBSTITUTION_SHIFT_MERGE_REQUIRED', message: 'У виконавця є окремий запис графіка на цю дату.' });
        }
        if (existing.length) blockers.push({ code: 'SUBSTITUTION_SHIFT_MERGE_REQUIRED', message: 'Працівник уже має денний план; спочатку погодьте об’єднання часових сегментів' });
        if (!current && await partialShift.hasHrSubstitutionClaim(db, input, { partialOnly: true })) {
            blockers.push({ code: 'SUBSTITUTION_SHIFT_ALREADY_CLAIMED', message: 'На цей день один із денних планів уже має погоджену часткову підміну.' });
        }
        return { type: 'hr_shift', ownedShiftId: current ? loaded.shift.id : null, shift: loaded.shift, plan: loaded.plan, blockers };
    }
    const task = await taskExecution.getVisibleTask(input.sourceId, actor, { pool: db, businessContext: business });
    const replacementUserId = await accountForStaff(db, input.staffId);
    const originalUserId = input.originalStaffId ? await accountForStaff(db, input.originalStaffId) : null;
    if (Number(task.owner_user_id) !== (current ? replacementUserId : originalUserId)) c.fail('SUBSTITUTION_SOURCE_STALE', 'Власник задачі не відповідає обраній підміні', 409);
    if (!current && task.source_type === 'conversation_reply') {
        c.fail('SUBSTITUTION_USE_REPLY_SOURCE','Оформіть підміну через очікувану відповідь Omni.',409);
    }
    if (!current && onboarding.isGeneratedTask(task)) {
        c.fail('SUBSTITUTION_USE_ONBOARDING_SOURCE', 'Оформіть підміну через призначення наставника.', 409);
    }
    await taskExecution.getAssignableTaskOwner(replacementUserId, { pool: db, actor, businessContext: business });
    const blockers = [];
    if (!current && await meeting.taskHasActionClaim(db,business,task.id)) {
        blockers.push({code:'SUBSTITUTION_MEETING_ALIAS_CLAIMED',message:'Для доручення цієї наради вже оформлено підміну.'});
    }
    if (!current && (task.source_type === 'booking' || task.source_entity_type === 'booking')) {
        blockers.push({ code: 'SUBSTITUTION_USE_BOOKING_SOURCE', message: 'Ця задача пов’язана з бронюванням. Оформіть підміну у джерелі «Бронювання Park».' });
    }
    if (input.originalTreatment === 'transfer_unworked_scope') blockers.push({code:'SUBSTITUTION_BASE_SOURCE_REQUIRED',message:'Передача задачі не визначає звичайну зарплату. Для цього призначення збережіть оплату заміненого працівника.'});
    if (!current && await taskHasLeadClaim(db, business, task)) {
        blockers.push({ code: 'SUBSTITUTION_LEAD_ALIAS_CLAIMED', message: 'Для пов’язаного ліда вже оформлено підміну.' });
    }
    if (task.scheduled_start_at && task.scheduled_end_at && (Date.parse(input.startsAt)!==Date.parse(task.scheduled_start_at)
        || Date.parse(input.endsAt)!==Date.parse(task.scheduled_end_at))) blockers.push({code:'SUBSTITUTION_TASK_TIME_REQUIRED',message:'Час підміни має збігатися з погодженим інтервалом задачі'});
    if (!current && ['done','cancelled','archived'].includes(task.status)) blockers.push({ code: 'SUBSTITUTION_TASK_FINISHED', message: 'Завершену задачу не можна передати' });
    if (task.visibility === 'private' || task.visibility === 'me_only') blockers.push({ code: 'SUBSTITUTION_PRIVATE_TASK', message: 'Спершу погодьте передачу приватної задачі через її власний діалог' });
    return { type: 'task', task: { id: task.id, ownerUserId: task.owner_user_id, version: task.version, status: task.status,
        date:task.date,startsAt:task.scheduled_start_at,endsAt:task.scheduled_end_at }, replacementUserId, originalUserId, blockers };
}

async function changeAfisha(db, actor, row, source, restore=false) {
    const event=(await db.query('SELECT * FROM afisha WHERE id=$1 FOR UPDATE',[row.source_id])).rows[0];
    if (source.occurrence) {
        if (restore) await require('./afishaBirthdaySlots').assertGreetingRestore(db,row,source);
        return;
    }
    const {lineIdsOf,updateTimelineAfisha}=require('./afishaTimeline');
    const lineId = restore ? source.originalLineId : source.replacementLineId;
    const next={...event,[source.field]:lineId};
    const { getAnimatorTimelineLines, isBookingWithinAvailabilityWindows } = require('./booking');
    const roster = await getAnimatorTimelineLines(row.input_json.workDate, db);
    const line = roster.find(item => item.id === lineId && item.assignmentAllowed && !item.isUnavailable);
    const time = source.time ?? String(event.time).slice(0,5);
    const duration = source.duration ?? Number(event.duration || 60);
    if (lineIdsOf(next).length !== new Set(lineIdsOf(next)).size || !line
        || !isBookingWithinAvailabilityWindows(time,duration,line.availabilityWindows)) {
        c.fail('SUBSTITUTION_ROSTER_REQUIRED','Аніматор недоступний у погоджений час заходу.',409);
    }
    await updateTimelineAfisha(null,row.source_id,{lineIds:lineIdsOf(next),expectedLineIds:lineIdsOf(event),
        promotionId:event.promotion_id ?? null,expectedPromotionId:event.promotion_id ?? null},actor.username,{client:db});
}

async function applyAssignment(db, business, actor, row, source) {
    if (source.type === 'meeting_action') return meeting.changeAssignment(db,business,actor,row,source);
    if (source.type === 'chat_task') return chatTask.changeAssignment(db,business,actor,row,source);
    if (source.type === 'inbox_reply') return reply.changeAssignment(db,business,actor,row,source);
    if (source.type === 'inbox') return inbox.changeAssignment(db, business, actor, row, source);
    if (source.type === 'onboarding') return onboarding.changeAssignment(db, actor, row, source);
    if (source.type === education.TYPE) return education.changeAssignment(db, actor, row);
    if (source.type === 'standalone') return;
    if (source.type === 'booking') return bookingSubstitution.changeBookingAssignment(db, actor, row);
    if (source.type === 'afisha') return changeAfisha(db,actor,row,source);
    if (['lead','procurement'].includes(source.type)) {
        const table=source.type==='lead' ? 'leads' : 'procurement_lists';
        await db.query(`UPDATE ${table} SET assigned_to=$1,updated_at=NOW() WHERE id=$2`,[source.replacementOwner,row.source_id]);
        return;
    }
    await assertNoWork(db, row.input_json);
    if (source.partial) return partialShift.applyPartialShift(db, actor, row, source);
    if (source.type === 'task') {
        await taskExecution.reassignTaskOwner(row.source_id, source.replacementUserId, actor, { pool: db, businessContext: business, sourceSurface: 'staff_substitution' });
        return;
    }
    const updated = (await db.query(`UPDATE hr_shifts SET staff_id=$1,original_staff_id=COALESCE(original_staff_id,staff_id),
        replacement_reason=$2,replaced_by=$3,replaced_at=NOW(),updated_at=NOW() WHERE id=$4 RETURNING *`,
    [row.staff_id,row.input_json.reason,actor.username,row.source_id])).rows[0];
    await db.query('DELETE FROM staff_schedule WHERE staff_id=$1 AND date=$2', [row.original_staff_id,row.work_date]);
    await upsertScheduleMirrorFromPlan(db, { staffId: row.staff_id, date: row.input_json.workDate, note: `Підміна #${row.id}: ${row.input_json.reason}` }, source.plan);
    await reconcileAnimatorRosterDates(db, [row.input_json.workDate]);
    return updated;
}

function fingerprintShiftPlan(plan) {
    return c.fingerprint({
        ...plan,
        segments: plan.segments.map(({ workMode, ...segment }) => workMode === 'freelance' ? { ...segment, workMode } : segment)
    });
}

async function assertCurrent(db, business, actor, row, options) {
    if (row.source_type === 'meeting_action') {
        const scope = await meeting.loadScope(db,business,actor,row.input_json,row,accountForStaff,options);
        if (scope.blockers.length) c.fail('SUBSTITUTION_BLOCKED',scope.blockers[0].message,409);
        return scope;
    }
    if (row.source_type === 'chat_task') {
        const scope = await chatTask.loadScope(db,business,actor,row.input_json,row,accountForStaff,options);
        if (scope.blockers.length) c.fail('SUBSTITUTION_BLOCKED',scope.blockers[0].message,409);
        return scope;
    }
    if (row.source_type === 'inbox_reply') {
        const scope = await reply.loadScope(db,business,actor,row.input_json,row,accountForStaff,options);
        if (scope.blockers.length) c.fail('SUBSTITUTION_BLOCKED',scope.blockers[0].message,409);
        return scope;
    }
    if (row.source_type === 'inbox') {
        const scope = await inbox.loadScope(db, business, actor, row.input_json, row, accountForStaff);
        if (scope.blockers.length) c.fail('SUBSTITUTION_BLOCKED', scope.blockers[0].message, 409);
        return scope;
    }
    if (row.source_type === 'onboarding') {
        const scope = await onboarding.loadScope(db, actor, row.input_json, row, accountForStaff);
        if (scope.blockers.length) c.fail('SUBSTITUTION_BLOCKED', scope.blockers[0].message, 409);
        return scope;
    }
    if (row.source_type === education.TYPE) return education.assertCurrent(db, actor, row);
    if (row.source_type === 'standalone') return;
    if (row.source_type === 'booking') return bookingSubstitution.assertBookingScopeCurrent(db, actor, row);
    if (row.source_type === 'hr_shift' && row.slot_key === 'partial') {
        await partialShift.assertCurrent(db, row.input_json, row.source_snapshot);
        return;
    }
    const source = await loadScope(db, business, actor, row.input_json, row);
    if (source.type === 'afisha' && row.source_snapshot.time && (source.time !== row.source_snapshot.time
        || source.duration !== row.source_snapshot.duration || source.event.type !== row.source_snapshot.event.type
        || source.blockers.some(item => item.code === 'SUBSTITUTION_GREETING_TIME_REQUIRED'))) {
        c.fail('SUBSTITUTION_SOURCE_STALE','Час або тип заходу змінився.',409);
    }
    if (source.type === 'hr_shift' && fingerprintShiftPlan(source.plan) !== fingerprintShiftPlan(row.source_snapshot.plan)) c.fail('SUBSTITUTION_SOURCE_STALE', 'Часовий план підміни змінено', 409);
    if (source.type === 'task' && c.fingerprint([source.task.date,source.task.startsAt,source.task.endsAt])
        !== c.fingerprint([row.source_snapshot.task.date,row.source_snapshot.task.startsAt,row.source_snapshot.task.endsAt])) c.fail('SUBSTITUTION_SOURCE_STALE', 'Час задачі змінено після передачі; перевірте її історію', 409);
}

async function reviseAssignment(db, business, actor, row, input) {
    if (row.source_type === education.TYPE) await education.assertNoWork(db, input);
    else await assertNoWork(db, input);
    await assertCurrent(db, business, actor, row);
    if (input.sourceType === 'hr_shift' && ['payMode','originalTreatment','professionKey','breakMinutes'].some(key => input[key] !== row.input_json[key])) {
        c.fail('SUBSTITUTION_SCOPE_CHANGED', 'Для зміни ролі, перерви або способу оплати скасуйте підміну й створіть нову', 409);
    }
    if (input.startsAt !== row.input_json.startsAt || input.endsAt !== row.input_json.endsAt) c.fail('SUBSTITUTION_SCOPE_CHANGED', 'Для іншого часу скасуйте підміну й створіть нову', 409);
}

async function restoreAssignment(db, business, actor, row) {
    if (row.source_type === education.TYPE) return education.changeAssignment(db, actor, row, true);
    await assertNoWork(db, row.input_json);
    if (row.source_type === 'meeting_action') {
        return meeting.changeAssignment(db,business,actor,row,await assertCurrent(db,business,actor,row),true);
    }
    if (row.source_type === 'chat_task') {
        return chatTask.changeAssignment(db,business,actor,row,await assertCurrent(db,business,actor,row),true);
    }
    if (row.source_type === 'inbox_reply') {
        return reply.changeAssignment(db,business,actor,row,await assertCurrent(db,business,actor,row),true);
    }
    if (row.source_type === 'inbox') {
        const source = await assertCurrent(db, business, actor, row);
        return inbox.changeAssignment(db, business, actor, row, source, true);
    }
    if (row.source_type === 'onboarding') {
        const source = await assertCurrent(db, business, actor, row);
        return onboarding.changeAssignment(db, actor, row, source, true);
    }
    if (row.source_type === 'booking') {
        await bookingSubstitution.assertBookingScopeCurrent(db, actor, row);
        return bookingSubstitution.changeBookingAssignment(db, actor, row, true);
    }
    if (row.source_type === 'hr_shift' && row.slot_key === 'partial') return partialShift.restorePartialShift(db, actor, row);
    await assertCurrent(db, business, actor, row);
    if (row.source_type === 'standalone') return;
    if (row.source_type === 'afisha') return changeAfisha(db,actor,row,row.source_snapshot,true);
    if (['lead','procurement'].includes(row.source_type)) {
        const table=row.source_type==='lead' ? 'leads' : 'procurement_lists';
        await db.query(`UPDATE ${table} SET assigned_to=$1,updated_at=NOW() WHERE id=$2`,[row.source_snapshot.originalOwner,row.source_id]);
        return;
    }
    if (row.source_type === 'task') {
        await taskExecution.reassignTaskOwner(row.source_id, row.source_snapshot.originalUserId, actor, { pool: db, businessContext: business, sourceSurface: 'staff_substitution' });
        return;
    }
    const prior = row.source_snapshot.shift;
    if (row.input_json.professionKey === 'animator' && await partialShift.conflictsWithAnimatorAssignments(db, row.input_json.workDate, row.staff_id, null)) {
        c.fail('SUBSTITUTION_ANIMATOR_ASSIGNMENT_OUTSIDE_SHIFT',
            'Після скасування у виконавця залишиться бронювання або подія Афіші поза зміною.', 409);
    }
    const conflict = (await db.query('SELECT id FROM hr_shifts WHERE staff_id=$1 AND shift_date=$2 AND id<>$3', [row.original_staff_id,row.work_date,row.source_id])).rows;
    if (conflict.length) c.fail('SUBSTITUTION_RESTORE_CONFLICT', 'У заміненого працівника вже є інша зміна', 409);
    await db.query(`UPDATE hr_shifts SET staff_id=$1,original_staff_id=$2,replacement_reason=$3,replaced_by=$4,replaced_at=$5,updated_at=NOW() WHERE id=$6`,
        [prior.staff_id,prior.original_staff_id,prior.replacement_reason,prior.replaced_by,prior.replaced_at,row.source_id]);
    await db.query('DELETE FROM staff_schedule WHERE staff_id=$1 AND date=$2', [row.staff_id,row.work_date]);
    await upsertScheduleMirrorFromPlan(db, { staffId: prior.staff_id, date: row.input_json.workDate, note: prior.notes }, row.source_snapshot.plan);
    await reconcileAnimatorRosterDates(db, [row.input_json.workDate]);
}

async function lockScope(db, input, business, actor) {
    if (input.sourceType === 'meeting_action') return meeting.lockScope(db,input,business,actor);
    if (input.sourceType === 'chat_task') return chatTask.lockScope(db,input,business);
    if (input.sourceType === 'inbox_reply') return reply.lockScope(db,input,business);
    if (input.sourceType === education.TYPE) return education.lockScope(db, input);
    if (input.sourceType === 'booking') return bookingSubstitution.lockBookingScope(db, input);
    const table = {task:'tasks',afisha:'afisha',lead:'leads',procurement:'procurement_lists',inbox:'conversations'}[input.sourceType];
    if (input.sourceType === 'hr_shift') return partialShift.lockPartialShift(db, input);
    if (table) await db.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`,[input.sourceId]);
}

async function listScopes(db, business, actor, query) {
    const allowed = business === education.DAR ? [education.TYPE] : ['hr_shift','task','afisha','booking','lead','procurement','onboarding','inbox','inbox_reply','chat_task','meeting_action'];
    const type=c.choice(query.sourceType,allowed,'процес');
    const date=require('./attendanceWriteLock').normalizeAttendanceWriteDate(query.workDate);
    const original=c.integer(query.originalStaffId,'кого замінюють',1);
    if (type === 'meeting_action') return meeting.listScopes(db,business,actor,await accountForStaff(db,original));
    if (type === 'chat_task') return chatTask.listScopes(db,business,actor,await accountForStaff(db,original));
    if (type === 'inbox_reply') return reply.listScopes(db,business,actor,await accountForStaff(db,original));
    if (type === 'inbox') return inbox.listScopes(db, business, actor, await accountForStaff(db, original));
    if (type === 'onboarding') return onboarding.listScopes(db, actor, await accountForStaff(db, original));
    if (type === education.TYPE) return education.listScopes(db, actor, date, original);
    if (type === 'booking') return bookingSubstitution.listBookingScopes(db, actor, date, original,
        c.choice(query.slotKey || 'primary', ['primary', 'second'], 'слот аніматора'));
    if (type==='hr_shift') return (await db.query(`SELECT id,planned_start::text,planned_end::text,break_minutes,
        profession_key FROM hr_shifts WHERE staff_id=$1 AND shift_date=$2 ORDER BY id LIMIT 100`,[original,date])).rows
        .map(row=>({id:String(row.id),title:`Зміна ${row.planned_start.slice(0,5)}–${row.planned_end.slice(0,5)}`,startTime:row.planned_start.slice(0,5),endTime:row.planned_end.slice(0,5),
            endDate: row.planned_end <= row.planned_start ? addScheduleCalendarDays(date, 1) : date,
            breakMinutes:row.break_minutes}));
    if (type==='task') {
        const owner=await accountForStaff(db,original);
        const candidates=(await db.query(`SELECT id FROM tasks WHERE owner_user_id=$1 AND COALESCE(business_context,'event_genix')=$2
            AND status NOT IN ('done','cancelled','archived') ORDER BY id DESC LIMIT 100`,[owner,business])).rows;
        const result=[];
        for (const candidate of candidates) {
            try {
                const task=await taskExecution.getVisibleTask(candidate.id,actor,{pool:db,businessContext:business});
                if (!['private','me_only'].includes(task.visibility) && task.source_type !== 'booking' && task.source_entity_type !== 'booking' && task.source_type !== 'conversation_reply' && !onboarding.isGeneratedTask(task)) {
                    if (!await meeting.taskHasActionClaim(db,business,task.id)) {
                        result.push({id:String(task.id),title:task.title || `Задача №${task.id}`});
                    }
                }
            } catch(error) { if (![403,404].includes(error.statusCode || error.status)) throw error; }
        }
        return result;
    }
    if (type==='afisha') {
        if (!require('./timelineContext').canUseTimelineAction(actor,business,'edit') || !resolveCapability(actor,'edit_booking',{type:'action'}).allowed)
            c.fail('SUBSTITUTION_SOURCE_FORBIDDEN','Немає права змінювати Афішу',403);
        const slotKey = c.choice(query.slotKey || 'primary', ['primary', 'second'], 'слот аніматора');
        const ownerField = slotKey === 'second' ? 'second_line_id' : 'line_id';
        const lines=(await require('./booking').getAnimatorTimelineLines(date,db)).filter(line=>Number(line.staffId)===original).map(line=>String(line.id));
        const day = (await db.query('SELECT * FROM afisha WHERE date=$1 ORDER BY time,id',[date])).rows;
        const { birthdaySlotsForEvents } = require('./afishaBirthdaySlots');
        const claimed = (await db.query(`SELECT source_id,slot_key FROM staff_substitutions WHERE business_context='event_genix'
            AND source_type='afisha' AND work_date=$1 AND state<>'cancelled'`,[date])).rows;
        const claimKeys = new Set(claimed.map(row => `${row.source_id}:${row.slot_key}`));
        return (await birthdaySlotsForEvents(db,day)).filter(row => lines.includes(String(row[ownerField]))).flatMap(row => {
            const slots = row.birthday_slots || [{ time:row.time, duration:row.duration || 60 }];
            return slots.filter(slot => !slot.conflict && !claimKeys.has(`${row.id}:${slotKey}`)
                && !claimKeys.has(`${row.id}:${slot.key}:${slotKey}`)).map(slot => {
                const startTime = slot.time.slice(0,5);
                const start = localInstant(date,startTime);
                const end = start && c.kyivParts(new Date(Date.parse(start)+slot.duration*60000));
                const identity = slot.key ? { sourceId:String(row.id),slotKey:`${slot.key}:${slotKey}` } : {};
                const id = row.type === 'birthday' ? `${row.id}:${slot.key}` : String(row.id);
                return { id, ...identity, title:`${startTime} · ${row.title}`, startTime,endTime:end?.time,endDate:end?.date };
            });
        }).slice(0,100);
    }
    requireSourceRole(actor,type==='procurement' ? ['creator','director','vice_director','senior_manager','manager','admin'] : ['manager','marketer']);
    if (type==='procurement') {
        const access=await require('./legacyBusinessSurface').loadLegacyBusinessSurfaceAccess(db,business,'contractors_procurement');
        if (!access.available) c.fail(access.code,access.message,access.status);
        return (await db.query('SELECT id,title FROM procurement_lists WHERE assigned_to=$1 ORDER BY id DESC LIMIT 100',[original])).rows.map(row=>({id:String(row.id),title:row.title || `Закупівля №${row.id}`}));
    }
    const owner=await accountForStaff(db,original);
    return (await db.query(`SELECT id FROM leads WHERE assigned_to=$1 AND COALESCE(business_context,'event_genix')=$2 ORDER BY id DESC LIMIT 100`,[owner,business])).rows
        .map(row=>({id:String(row.id),title:`Робота з лідом №${row.id}`}));
}

module.exports = { loadScope, applyAssignment, reviseAssignment, restoreAssignment, assertCurrent, accountForStaff, lockScope, listScopes };
