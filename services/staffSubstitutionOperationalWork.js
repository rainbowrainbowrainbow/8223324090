'use strict';

const c = require('./staffSubstitutionContract');
const { normalizeAttendanceWriteDate } = require('./attendanceWriteLock');
const { resolveCapability } = require('./accountAccessPolicy');
const { legacyBusinessSurfaceAccess } = require('./legacyBusinessSurface');
const { getAssignableTaskOwner, getVisibleTask } = require('./taskExecution');

const PARK = 'event_genix';
const TASK_SOURCE = 'operational_substitution';
const REPORT_ROLES = ['creator','director','vice_director','senior_manager','accountant'];
const SOURCES = Object.freeze({
    support_ticket: {
        title:'Робота з тікетом підтримки', description:'Супровід звернення',
        sql:`SELECT s.id FROM support_tickets s JOIN customers scoped ON scoped.id=s.customer_id
            WHERE s.id=$1 AND scoped.business_context=$2 AND s.status IN ('open','in_progress','waiting')`
    },
    content_item: {
        title:'Підготовка матеріалу', description:'Підготовка контенту', page:'/art',
        sql:`SELECT s.id FROM content_items s WHERE s.id=$1 AND s.status IN ('draft','rejected') AND $2='event_genix'`
    },
    training_delivery: {
        title:'Проведення заняття для команди', description:'Проведення запланованого заняття', page:'/training',
        sql:`SELECT s.id FROM training_course_lectures s JOIN training_courses course ON course.id=s.course_id
            WHERE s.id=$1 AND s.scheduled_date=$3 AND course.is_active
              AND course.source='hr_profession_seed' AND $2='event_genix'`
    },
    report_preparation: {
        title:'Підготовка матеріалів звіту', description:'Збір даних і підготовка матеріалів для звіту', page:'/reports',
        sql:`SELECT s.id FROM reports s WHERE s.id=$1 AND COALESCE(s.business_context,'event_genix')=$2
            AND COALESCE(s.report_lifecycle_status,'open')='open' AND s.approval_task_id IS NULL
            AND COALESCE(s.raw_data->'reportTableTemplate'->'lifecycle'->>'status','open') <> 'closed'
            AND COALESCE(s.status,'pending') NOT IN ('done','rejected')`
    }
});

function hasProcessAccess(actor, sourceType) {
    const page = SOURCES[sourceType].page;
    return (!page || resolveCapability(actor,page,{type:'page'}).allowed)
        && (sourceType !== 'report_preparation' || REPORT_ROLES.includes(actor?.role));
}

function canRegister(req, sourceType) {
    return hasProcessAccess(req.user,sourceType)
        && (sourceType !== 'content_item' || legacyBusinessSurfaceAccess(req,'art').available)
        && (sourceType !== 'training_delivery' || resolveCapability(req.user,'training.manage',{type:'action'}).allowed);
}

async function readSource(db, sourceType, sourceId, workDate, { lock = false } = {}) {
    const params = [sourceId,PARK];
    if (sourceType === 'training_delivery') params.push(workDate);
    return (await db.query(SOURCES[sourceType].sql + (lock ? ' FOR SHARE OF s' : ''),params)).rows[0] || null;
}

async function registerWork(pool, req, raw, accountForStaff) {
    if (req.substitutionBusiness !== PARK) c.fail('SUBSTITUTION_BUSINESS_UNSUPPORTED','Робота команди доступна у Park.',403);
    const sourceType = c.choice(raw.sourceType,Object.keys(SOURCES),'процес');
    if (!canRegister(req,sourceType)) c.fail('SUBSTITUTION_SOURCE_FORBIDDEN','Немає права призначати роботу в цьому процесі.',403);
    const sourceId = c.integer(raw.sourceId,'номер запису',1);
    const workDate = normalizeAttendanceWriteDate(raw.workDate);
    const staffId = c.integer(raw.staffId,'відповідальний працівник',1);
    const actorId = c.integer(req.user.id || req.user.userId,'автор призначення',1);
    const username = c.text(req.user.username,'автор призначення',100);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`park-work:${sourceType}:${sourceId}:${workDate}`]);
        const existing = (await client.query(`SELECT task_id,registered_staff_id FROM staff_substitution_operational_work
            WHERE source_type=$1 AND source_id=$2 AND work_date=$3`, [sourceType,sourceId,workDate])).rows[0];
        if (existing) {
            if (existing.registered_staff_id !== staffId) {
                c.fail('SUBSTITUTION_WORK_ALREADY_REGISTERED','Робота вже має відповідального. Для передачі відкрийте її задачу.',409);
            }
            await getVisibleTask(existing.task_id,req.user,{pool:client,businessContext:PARK});
            await client.query('COMMIT');
            return {taskId:existing.task_id,created:false};
        }
        if (!await readSource(client,sourceType,sourceId,workDate,{lock:true})) {
            c.fail('SUBSTITUTION_OPERATIONAL_SOURCE_NOT_FOUND','Запис недоступний для роботи Park на цю дату.',404);
        }
        const userId = await accountForStaff(client,staffId);
        const owner = await getAssignableTaskOwner(userId,{pool:client,actor:req.user,businessContext:PARK});
        if (!hasProcessAccess(owner,sourceType)) c.fail('SUBSTITUTION_SOURCE_FORBIDDEN','Працівнику потрібен доступ до цього процесу.',403);
        const config = SOURCES[sourceType];
        const task = await require('./kleshnya').createTask({ businessContext:PARK,title:`${config.title} №${sourceId}`,
            description:config.description,date:workDate,owner_user_id:userId,created_by:username,created_by_user_id:actorId,
            category:'operational',source_type:TASK_SOURCE,source_id:`${sourceType}:${sourceId}:${workDate}`,
            visibility:'team',duplicateMode:'reject'
        }, { pool:client,skipNotifications:true,skipHermesOutbox:true });
        await client.query(`INSERT INTO staff_substitution_operational_work(source_type,source_id,work_date,task_id,registered_staff_id,registered_by)
            VALUES($1,$2,$3,$4,$5,$6)`, [sourceType,sourceId,workDate,task.id,staffId,username]);
        await client.query('COMMIT');
        return {taskId:task.id,created:true};
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function readBinding(db, taskId) {
    return (await db.query(`SELECT source_type,source_id,work_date::text AS work_date
        FROM staff_substitution_operational_work WHERE task_id=$1`,[taskId])).rows[0] || null;
}

async function assertOperationalScope(db, task, actor, workDate, { current = false, replacement } = {}) {
    if (task.source_type !== TASK_SOURCE) return null;
    const binding = await readBinding(db,task.id);
    if (!binding || !hasProcessAccess(actor,binding.source_type)) {
        c.fail('SUBSTITUTION_SOURCE_NOT_FOUND','Призначення цього процесу недоступне.',404);
    }
    if (binding.work_date !== workDate || (!current && !await readSource(db,binding.source_type,binding.source_id,workDate,{lock:true}))) {
        c.fail('SUBSTITUTION_SOURCE_STALE','Дата або стан робочого запису змінилися.',409);
    }
    if (replacement && !hasProcessAccess(replacement,binding.source_type)) {
        c.fail('SUBSTITUTION_SOURCE_FORBIDDEN','Виконавцю потрібен чинний доступ до цього процесу.',403);
    }
    return binding;
}

async function isReportApprovalTask(db, task) {
    if (task.source_type === 'report' || task.control_meta?.reportApproval === true) return true;
    if (task.source_entity_type !== 'report' && task.related_entity_type !== 'report') return false;
    return (await db.query('SELECT 1 FROM reports WHERE approval_task_id=$1 LIMIT 1',[task.id])).rowCount > 0;
}

module.exports = { SOURCES, TASK_SOURCE, canRegister, registerWork, assertOperationalScope, isReportApprovalTask };
