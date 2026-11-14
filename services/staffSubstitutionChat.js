'use strict';

const c = require('./staffSubstitutionContract');
const { canManageAllChatTasks, isMember } = require('./chatService');
const { canAccessBusinessContext } = require('./businessContext');
const { businessUserAccessSql } = require('./businessUserAccess');
const { resolveCapability } = require('./accountAccessPolicy');
const { insertHistory } = require('./historyLog');

const scopedTask = `JOIN chat_channels ch ON ch.id=t.channel_id AND ch.is_archived IS NOT TRUE AND ch.is_dm IS NOT TRUE
    JOIN bookings b ON b.id=ch.linked_booking_id AND COALESCE(b.business_context,'event_genix')=$2
    WHERE t.message_id IS NULL`;

function actorId(actor,business) {
    if (!canAccessBusinessContext(actor,business) || !resolveCapability(actor,'/chat',{type:'page'}).allowed) {
        c.fail('SUBSTITUTION_SOURCE_FORBIDDEN','Потрібен доступ до чату цього бізнесу.',403);
    }
    return c.integer(actor?.id || actor?.userId,'користувач',1);
}

async function canReceiveTask(db,business,actor,channelId,userId) {
    const params = [channelId,userId];
    const access = businessUserAccessSql(actor,params,'u',business);
    const result = await db.query(`SELECT m.user_id FROM chat_channel_members m JOIN users u ON u.id=m.user_id
        WHERE m.channel_id=$1 AND m.user_id=$2 AND COALESCE(u.is_active,true) ${access.condition}
        FOR SHARE OF m,u`,params);
    return result.rowCount > 0;
}

async function loadScope(db,business,actor,input,current,accountForStaff,{ completedCycle = false } = {}) {
    const user = actorId(actor,business);
    const record = (await db.query(`SELECT t.id,t.assigned_to,t.assigned_by,t.status,t.deadline,t.channel_id,b.id AS booking_id
        FROM chat_tasks t ${scopedTask} AND t.id=$1`,[input.sourceId,business])).rows[0];
    if (!record || !await isMember(record.channel_id,user,db) ||
        !canManageAllChatTasks(actor.role) && record.assigned_by !== user) {
        c.fail('SUBSTITUTION_SOURCE_NOT_FOUND','Задачу чату не знайдено.',404);
    }
    const original = current?.source_snapshot.original ?? await accountForStaff(db,input.originalStaffId);
    const replacement = current?.source_snapshot.replacement ?? await accountForStaff(db,input.staffId);
    if (record.assigned_to !== (current ? replacement : original)
        || current && (current.source_snapshot.record.channel_id !== record.channel_id
            || current.source_snapshot.record.booking_id !== record.booking_id
            || c.fingerprint(current.source_snapshot.record.deadline) !== c.fingerprint(record.deadline))) {
        c.fail('SUBSTITUTION_SOURCE_STALE','Призначення, канал або строк задачі чату змінилися.',409);
    }
    const blockers = [];
    if (!completedCycle && !['open','in_progress'].includes(record.status)) {
        blockers.push({code:'SUBSTITUTION_TASK_FINISHED',message:'Задача чату вже завершена.'});
    }
    if (!completedCycle && !await canReceiveTask(db,business,actor,record.channel_id,replacement)) {
        blockers.push({code:'SUBSTITUTION_CHAT_MEMBER_REQUIRED',message:'Виконавцю потрібен чинний доступ до бізнесу й цього каналу.'});
    }
    if (input.originalTreatment !== 'retain' || input.payMode !== 'additional') {
        blockers.push({code:'SUBSTITUTION_BASE_SOURCE_REQUIRED',message:'Для задачі чату доступна лише додаткова оплата.'});
    }
    return {type:'chat_task',record,original,replacement,blockers};
}

async function lockScope(db,input,business) {
    await db.query(`SELECT t.id FROM chat_tasks t ${scopedTask} AND t.id=$1 FOR UPDATE OF t FOR SHARE OF ch,b`,[input.sourceId,business]);
}

async function changeAssignment(db,business,actor,row,scope,restore = false) {
    const to = restore ? scope.original : scope.replacement;
    const from = restore ? scope.replacement : scope.original;
    if (!await canReceiveTask(db,business,actor,scope.record.channel_id,to)) c.fail('SUBSTITUTION_CHAT_MEMBER_REQUIRED','Виконавцю потрібне членство в каналі.',409);
    const updated = await db.query(`UPDATE chat_tasks SET assigned_to=$2 WHERE id=$1 AND assigned_to=$3 AND status IN ('open','in_progress') RETURNING id`,
        [row.source_id,to,from]);
    if (!updated.rowCount) c.fail('SUBSTITUTION_SOURCE_STALE','Задача чату вже змінилася.',409);
    await insertHistory(db,{businessContext:business,username:actor.username,
        action:restore ? 'chat_task_substitution_restored' : 'chat_task_substitution_assigned',
        data:{chatTaskId:scope.record.id,substitutionId:String(row.id),fromUserId:from,toUserId:to}});
}

async function listScopes(db,business,actor,owner) {
    const user=actorId(actor,business);
    const rows=(await db.query(`SELECT t.id FROM chat_tasks t ${scopedTask}
        AND t.assigned_to=$1 AND t.status IN ('open','in_progress') AND ($3 OR t.assigned_by=$4)
        AND EXISTS (SELECT 1 FROM chat_channel_members m WHERE m.channel_id=t.channel_id AND m.user_id=$4)
        ORDER BY t.id DESC LIMIT 100`,[owner,business,canManageAllChatTasks(actor.role),user])).rows;
    return rows.map(row=>({id:String(row.id),title:`Задача чату №${row.id}`}));
}

module.exports = { loadScope, lockScope, listScopes, changeAssignment };
