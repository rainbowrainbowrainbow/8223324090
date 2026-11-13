'use strict';
const c = require('./staffSubstitutionContract');
const { loadHrShiftDayPlan } = require('./hrShiftSegments');
const { upsertScheduleMirrorFromPlan, reconcileAnimatorRosterDates } = require('./staffScheduleMutations');
const taskExecution = require('./taskExecution');
const { requireRole } = require('../middleware/auth');
const { resolveCapability } = require('./accountAccessPolicy');

const unavailable = {
    booking: 'Потрібне окреме погодження інтеграції захищеного призначення бронювання.',
    education_lesson: 'Зарплатна належність освітнього бізнесу ще не розмежована; чинна політика забороняє запис у спільну зарплату Park.'
};

function requireSourceRole(actor, roles) {
    requireRole(...roles)({ user: actor }, { status() { return this; }, json() {
        c.fail('SUBSTITUTION_SOURCE_FORBIDDEN', 'Немає чинного права передавати призначення цього процесу', 403);
    } }, () => {});
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
    if (input.originalTreatment === 'transfer_unworked_scope') blockers.push({ code:'SUBSTITUTION_BASE_SOURCE_REQUIRED', message:'Передача відповідального не визначає звичайну зарплату. Для цього процесу збережіть оплату заміненого працівника.' });
    return { type:input.sourceType,record,replacementOwner,originalOwner,blockers };
}

async function loadAfishaScope(db, business, actor, input, current) {
    if (!require('./timelineContext').canUseTimelineAction(actor,business,'edit') || !resolveCapability(actor,'edit_booking',{type:'action'}).allowed) {
        c.fail('SUBSTITUTION_SOURCE_FORBIDDEN','Немає права змінювати призначення Афіші',403);
    }
    c.choice(input.slotKey,['primary','second'],'слот аніматора');
    const event = (await db.query('SELECT * FROM afisha WHERE id=$1',[input.sourceId])).rows[0];
    if (!event) c.fail('SUBSTITUTION_SOURCE_NOT_FOUND','Захід не знайдено',404);
    const date = event.date instanceof Date ? event.date.toISOString().slice(0,10) : String(event.date).slice(0,10);
    if (date !== input.workDate) c.fail('SUBSTITUTION_SOURCE_STALE','Дата заходу змінилася',409);
    const lines = await require('./booking').getAnimatorTimelineLines(date,db);
    const replacement = lines.find(line => Number(line.staffId)===input.staffId && line.assignmentAllowed && !line.isUnavailable);
    const originalLineId = current ? current.source_snapshot.originalLineId
        : lines.find(line => Number(line.staffId)===input.originalStaffId)?.id;
    const field = input.slotKey==='second' ? 'second_line_id' : 'line_id';
    if (!originalLineId || String(event[field]) !== String(current ? replacement?.id : originalLineId)) c.fail('SUBSTITUTION_SOURCE_STALE','Працівник не відповідає канонічній лінії заходу',409);
    const blockers=[];
    if (input.originalTreatment === 'transfer_unworked_scope') blockers.push({ code:'SUBSTITUTION_BASE_SOURCE_REQUIRED',message:'Афіша не визначає базову зарплату. Для цього призначення збережіть оплату заміненого працівника.' });
    if (!input.startsAt || !input.endsAt || c.kyivParts(input.startsAt).time !== String(event.time).slice(0,5)
        || (Date.parse(input.endsAt)-Date.parse(input.startsAt))/60000 !== Number(event.duration || 60)) {
        blockers.push({code:'SUBSTITUTION_EVENT_TIME_REQUIRED',message:'Час підміни має точно відповідати початку та тривалості заходу Афіші'});
    }
    if (!replacement) blockers.push({code:'SUBSTITUTION_ROSTER_REQUIRED',message:'Спочатку додайте погоджену зміну аніматора в графік працівника'});
    if (event.type==='birthday' || require('./afishaBirthdaySlots').isGreetingEvent(event)) blockers.push({code:'SUBSTITUTION_OCCURRENCE_REQUIRED',message:'Для привітання потрібен конкретний часовий слот, а не весь запис Афіші'});
    if (replacement && String(event[field==='line_id' ? 'second_line_id' : 'line_id'])===String(replacement.id)) blockers.push({code:'SUBSTITUTION_DUPLICATE_SLOT',message:'Працівник уже займає інший слот цього заходу'});
    return {type:'afisha',event,field,originalLineId:String(originalLineId),replacementLineId:replacement ? String(replacement.id) : null,blockers};
}

async function accountForStaff(db, staffId) {
    const result = await db.query(`SELECT ep.user_id FROM employee_profiles ep JOIN users u ON u.id=ep.user_id
        WHERE ep.staff_id=$1 AND COALESCE(u.is_active,true)=true ORDER BY ep.user_id`, [staffId]);
    if (result.rows.length !== 1) c.fail('SUBSTITUTION_ACCOUNT_REQUIRED', 'Для задачі потрібен один чинний зв’язок працівника з CRM-користувачем', 409);
    return Number(result.rows[0].user_id);
}

async function assertNoWork(db, input) {
    const result = await db.query(`SELECT id FROM hr_time_records WHERE staff_id=ANY($1::int[]) AND record_date=$2
        AND (clock_in IS NOT NULL OR clock_out IS NOT NULL OR total_worked_minutes>0) LIMIT 1`,
    [[input.staffId,input.originalStaffId].filter(Boolean),input.workDate]);
    if (result.rows.length) c.fail('SUBSTITUTION_WORK_STARTED', 'Облік роботи вже розпочато; зміну призначення потрібно погодити окремо', 409);
}

async function loadScope(db, business, actor, input, current) {
    if (business !== 'event_genix') c.fail('SUBSTITUTION_BUSINESS_UNSUPPORTED', 'Зарплатна належність цього бізнесу ще не розмежована', 409);
    if (unavailable[input.sourceType]) return { type: input.sourceType, blockers: [{ code: 'SUBSTITUTION_SOURCE_APPROVAL_REQUIRED', message: unavailable[input.sourceType] }] };
    if (['lead','procurement'].includes(input.sourceType)) return loadOfficeScope(db,business,actor,input,current);
    if (input.sourceType==='afisha') return loadAfishaScope(db,business,actor,input,current);
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
            || c.kyivParts(input.startsAt).time !== loaded.plan.plannedStart?.slice(0,5)
            || c.kyivParts(input.endsAt).time !== loaded.plan.plannedEnd?.slice(0,5)
            || input.breakMinutes !== loaded.plan.breakMinutes) {
            blockers.push({ code: 'SUBSTITUTION_SHIFT_SCOPE_REQUIRED', message: 'Для перенесення зміни оберіть її повний час, перерву та професію; складений план потребує поділу на окремі призначення' });
        }
        const existing = (await db.query('SELECT id FROM hr_shifts WHERE staff_id=$1 AND shift_date=$2 AND id<>$3', [input.staffId,input.workDate,input.sourceId])).rows;
        if (existing.length) blockers.push({ code: 'SUBSTITUTION_SHIFT_MERGE_REQUIRED', message: 'Працівник уже має денний план; спочатку погодьте об’єднання часових сегментів' });
        if (input.payMode === 'additional') blockers.push({ code: 'SUBSTITUTION_SHIFT_BASE_REQUIRED', message: 'Передана основна зміна оплачується як заміна основної оплати; для суміщення оберіть окрему роботу' });
        if (input.originalTreatment !== 'transfer_unworked_scope') blockers.push({ code:'SUBSTITUTION_SHIFT_RETAIN_UNSUPPORTED', message:'Перенесення зміни змінює планову основу оплати. Збереження оплати заміненого працівника потребує окремого розподілу; цю дію заблоковано.' });
        return { type: 'hr_shift', ownedShiftId: current ? loaded.shift.id : null, shift: loaded.shift, plan: loaded.plan, blockers };
    }
    const task = await taskExecution.getVisibleTask(input.sourceId, actor, { pool: db, businessContext: business });
    const replacementUserId = await accountForStaff(db, input.staffId);
    const originalUserId = input.originalStaffId ? await accountForStaff(db, input.originalStaffId) : null;
    if (Number(task.owner_user_id) !== (current ? replacementUserId : originalUserId)) c.fail('SUBSTITUTION_SOURCE_STALE', 'Власник задачі не відповідає обраній підміні', 409);
    await taskExecution.getAssignableTaskOwner(replacementUserId, { pool: db, actor, businessContext: business });
    const blockers = [];
    if (input.originalTreatment === 'transfer_unworked_scope') blockers.push({code:'SUBSTITUTION_BASE_SOURCE_REQUIRED',message:'Передача задачі не визначає звичайну зарплату. Для цього призначення збережіть оплату заміненого працівника.'});
    if (task.scheduled_start_at && task.scheduled_end_at && (Date.parse(input.startsAt)!==Date.parse(task.scheduled_start_at)
        || Date.parse(input.endsAt)!==Date.parse(task.scheduled_end_at))) blockers.push({code:'SUBSTITUTION_TASK_TIME_REQUIRED',message:'Час підміни має збігатися з погодженим інтервалом задачі'});
    if (!current && ['done','cancelled','archived'].includes(task.status)) blockers.push({ code: 'SUBSTITUTION_TASK_FINISHED', message: 'Завершену задачу не можна передати' });
    if (task.visibility === 'private' || task.visibility === 'me_only') blockers.push({ code: 'SUBSTITUTION_PRIVATE_TASK', message: 'Спершу погодьте передачу приватної задачі через її власний діалог' });
    return { type: 'task', task: { id: task.id, ownerUserId: task.owner_user_id, version: task.version, status: task.status,
        date:task.date,startsAt:task.scheduled_start_at,endsAt:task.scheduled_end_at }, replacementUserId, originalUserId, blockers };
}

async function changeAfisha(db, actor, row, source, restore=false) {
    const event=(await db.query('SELECT * FROM afisha WHERE id=$1 FOR UPDATE',[row.source_id])).rows[0];
    const {lineIdsOf,updateTimelineAfisha}=require('./afishaTimeline');
    const next={...event,[source.field]:restore ? source.originalLineId : source.replacementLineId};
    await updateTimelineAfisha(null,row.source_id,{lineIds:lineIdsOf(next),expectedLineIds:lineIdsOf(event),
        promotionId:event.promotion_id ?? null,expectedPromotionId:event.promotion_id ?? null},actor.username,{client:db});
}

async function applyAssignment(db, business, actor, row, source) {
    if (source.type === 'standalone') return;
    if (source.type === 'afisha') return changeAfisha(db,actor,row,source);
    if (['lead','procurement'].includes(source.type)) {
        const table=source.type==='lead' ? 'leads' : 'procurement_lists';
        await db.query(`UPDATE ${table} SET assigned_to=$1,updated_at=NOW() WHERE id=$2`,[source.replacementOwner,row.source_id]);
        return;
    }
    await assertNoWork(db, row.input_json);
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

async function assertCurrent(db, business, actor, row) {
    if (row.source_type === 'standalone') return;
    const source = await loadScope(db, business, actor, row.input_json, row);
    if (source.type === 'hr_shift' && fingerprintShiftPlan(source.plan) !== fingerprintShiftPlan(row.source_snapshot.plan)) c.fail('SUBSTITUTION_SOURCE_STALE', 'Часовий план підміни змінено', 409);
    if (source.type === 'task' && c.fingerprint([source.task.date,source.task.startsAt,source.task.endsAt])
        !== c.fingerprint([row.source_snapshot.task.date,row.source_snapshot.task.startsAt,row.source_snapshot.task.endsAt])) c.fail('SUBSTITUTION_SOURCE_STALE', 'Час задачі змінено після передачі; перевірте її історію', 409);
}

async function reviseAssignment(db, business, actor, row, input) {
    await assertNoWork(db, input);
    await assertCurrent(db, business, actor, row);
    if (input.startsAt !== row.input_json.startsAt || input.endsAt !== row.input_json.endsAt) c.fail('SUBSTITUTION_SCOPE_CHANGED', 'Для іншого часу скасуйте підміну й створіть нову', 409);
}

async function restoreAssignment(db, business, actor, row) {
    await assertNoWork(db, row.input_json);
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
    const conflict = (await db.query('SELECT id FROM hr_shifts WHERE staff_id=$1 AND shift_date=$2 AND id<>$3', [row.original_staff_id,row.work_date,row.source_id])).rows;
    if (conflict.length) c.fail('SUBSTITUTION_RESTORE_CONFLICT', 'У заміненого працівника вже є інша зміна', 409);
    await db.query(`UPDATE hr_shifts SET staff_id=$1,original_staff_id=$2,replacement_reason=$3,replaced_by=$4,replaced_at=$5,updated_at=NOW() WHERE id=$6`,
        [prior.staff_id,prior.original_staff_id,prior.replacement_reason,prior.replaced_by,prior.replaced_at,row.source_id]);
    await db.query('DELETE FROM staff_schedule WHERE staff_id=$1 AND date=$2', [row.staff_id,row.work_date]);
    await upsertScheduleMirrorFromPlan(db, { staffId: prior.staff_id, date: row.input_json.workDate, note: prior.notes }, row.source_snapshot.plan);
    await reconcileAnimatorRosterDates(db, [row.input_json.workDate]);
}

async function lockScope(db, input) {
    const table = {hr_shift:'hr_shifts',task:'tasks',afisha:'afisha',lead:'leads',procurement:'procurement_lists'}[input.sourceType];
    if (table) await db.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`,[input.sourceId]);
}

async function listScopes(db, business, actor, query) {
    const type=c.choice(query.sourceType,['hr_shift','task','afisha','lead','procurement'],'процес');
    const date=require('./attendanceWriteLock').normalizeAttendanceWriteDate(query.workDate);
    const original=c.integer(query.originalStaffId,'кого замінюють',1);
    if (type==='hr_shift') return (await db.query(`SELECT id,planned_start::text,planned_end::text,break_minutes,
        profession_key FROM hr_shifts WHERE staff_id=$1 AND shift_date=$2 ORDER BY id LIMIT 100`,[original,date])).rows
        .map(row=>({id:String(row.id),title:`Зміна ${row.planned_start.slice(0,5)}–${row.planned_end.slice(0,5)}`,startTime:row.planned_start.slice(0,5),endTime:row.planned_end.slice(0,5),breakMinutes:row.break_minutes}));
    if (type==='task') {
        const owner=await accountForStaff(db,original);
        const candidates=(await db.query(`SELECT id FROM tasks WHERE owner_user_id=$1 AND COALESCE(business_context,'event_genix')=$2
            AND status NOT IN ('done','cancelled','archived') ORDER BY id DESC LIMIT 100`,[owner,business])).rows;
        const result=[];
        for (const candidate of candidates) {
            try {
                const task=await taskExecution.getVisibleTask(candidate.id,actor,{pool:db,businessContext:business});
                if (!['private','me_only'].includes(task.visibility)) result.push({id:String(task.id),title:task.title || `Задача №${task.id}`});
            } catch(error) { if (![403,404].includes(error.statusCode || error.status)) throw error; }
        }
        return result;
    }
    if (type==='afisha') {
        if (!require('./timelineContext').canUseTimelineAction(actor,business,'edit') || !resolveCapability(actor,'edit_booking',{type:'action'}).allowed)
            c.fail('SUBSTITUTION_SOURCE_FORBIDDEN','Немає права змінювати Афішу',403);
        const lines=(await require('./booking').getAnimatorTimelineLines(date,db)).filter(line=>Number(line.staffId)===original).map(line=>String(line.id));
        return (await db.query(`SELECT id,title,time::text,duration FROM afisha WHERE date=$1 AND (line_id=ANY($2::text[]) OR second_line_id=ANY($2::text[])) ORDER BY time,id LIMIT 100`,[date,lines])).rows
            .map(row=>({id:String(row.id),title:`${row.time.slice(0,5)} · ${row.title}`,startTime:row.time.slice(0,5)}));
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

module.exports = { loadScope, applyAssignment, reviseAssignment, restoreAssignment, assertCurrent, accountForStaff, unavailable, lockScope, listScopes };
