'use strict';

const c = require('./staffSubstitutionContract');
const { canAccessBusinessContext } = require('./businessContext');
const { businessUserAccessSql } = require('./businessUserAccess');
const { insertHistory } = require('./historyLog');

const scopedAction = `JOIN meeting_notes m ON m.id=a.meeting_id AND m.created_by=$3
    JOIN chat_channels ch ON ch.id=m.channel_id AND ch.is_archived IS NOT TRUE AND ch.is_dm IS NOT TRUE
    JOIN bookings b ON b.id=ch.linked_booking_id AND COALESCE(b.business_context,'event_genix')=$2
    JOIN chat_channel_members actor ON actor.channel_id=ch.id AND actor.user_id=$3`;
const pending = "COALESCE(a.status,'pending')='pending' AND a.task_id IS NULL";
const existingTask = "EXISTS (SELECT 1 FROM tasks WHERE source_type='meeting_action' AND source_id=a.id::text)";

function actorId(business, actor) {
    if (!canAccessBusinessContext(actor, business)) {
        c.fail('SUBSTITUTION_SOURCE_FORBIDDEN', 'Потрібен доступ до бізнесу наради.', 403);
    }
    return c.integer(actor?.id || actor?.userId, 'користувач', 1);
}

async function canReceiveAction(db, business, actor, channelId, userId) {
    const params = [channelId, userId];
    const access = businessUserAccessSql(actor, params, 'u', business);
    const result = await db.query(`SELECT u.id FROM users u JOIN chat_channel_members member ON member.user_id=u.id
        WHERE member.channel_id=$1 AND u.id=$2 AND COALESCE(u.is_active,true) ${access.condition}
        FOR SHARE OF member,u`, params);
    return result.rowCount > 0;
}

async function loadScope(db, business, actor, input, current, accountForStaff, { completedCycle = false } = {}) {
    const user = actorId(business, actor);
    const record = (await db.query(`SELECT a.id,a.meeting_id,a.assigned_to,a.status,a.due_date,a.task_id,ch.id AS channel_id,b.id AS booking_id,
        ${existingTask} AS has_task FROM meeting_action_items a ${scopedAction} WHERE a.id=$1`, [input.sourceId, business, user])).rows[0];
    if (!record) c.fail('SUBSTITUTION_SOURCE_NOT_FOUND', 'Доручення цієї наради недоступне.', 404);
    const snapshot = current?.source_snapshot;
    const original = snapshot?.original ?? await accountForStaff(db, input.originalStaffId);
    const replacement = snapshot?.replacement ?? await accountForStaff(db, input.staffId);
    if (record.assigned_to !== (current ? replacement : original) || snapshot && (
        record.meeting_id !== snapshot.record.meeting_id || record.channel_id !== snapshot.record.channel_id ||
        record.booking_id !== snapshot.record.booking_id || c.fingerprint(record.due_date) !== c.fingerprint(snapshot.record.due_date))) {
        c.fail('SUBSTITUTION_SOURCE_STALE', 'Строк, призначення або нарада вже змінилися.', 409);
    }
    const blockers = [];
    if (record.task_id || record.has_task || ![null,'pending',...(completedCycle ? ['done'] : [])].includes(record.status)) {
        blockers.push({ code:'SUBSTITUTION_USE_TASK_SOURCE', message:'Для створеної задачі використайте її призначення.' });
    }
    if (!completedCycle && !await canReceiveAction(db, business, actor, record.channel_id, replacement)) {
        blockers.push({ code:'SUBSTITUTION_MEETING_MEMBER_REQUIRED', message:'Виконавцю потрібен чинний доступ до бізнесу й каналу наради.' });
    }
    if (input.originalTreatment !== 'retain' || input.payMode !== 'additional') {
        blockers.push({ code:'SUBSTITUTION_BASE_SOURCE_REQUIRED', message:'Для доручення доступна лише додаткова оплата.' });
    }
    return { type:'meeting_action', record, original, replacement, blockers };
}

async function lockScope(db, input, business, actor) {
    await db.query(`SELECT a.id FROM meeting_action_items a ${scopedAction} WHERE a.id=$1
        FOR UPDATE OF a FOR SHARE OF m,ch,b,actor`, [input.sourceId, business, actorId(business, actor)]);
}

async function changeAssignment(db, business, actor, row, scope, restore = false) {
    const to = restore ? scope.original : scope.replacement;
    const from = restore ? scope.replacement : scope.original;
    if (!await canReceiveAction(db, business, actor, scope.record.channel_id, to)) {
        c.fail('SUBSTITUTION_MEETING_MEMBER_REQUIRED', 'Виконавцю потрібен чинний доступ до бізнесу й каналу наради.', 409);
    }
    const updated = await db.query(`UPDATE meeting_action_items a SET assigned_to=$2
        WHERE a.id=$1 AND a.assigned_to=$3 AND ${pending} AND NOT ${existingTask} RETURNING a.id`, [row.source_id, to, from]);
    if (!updated.rowCount) c.fail('SUBSTITUTION_SOURCE_STALE', 'Доручення наради вже змінилося.', 409);
    await insertHistory(db, { businessContext:business, username:actor.username,
        action:restore ? 'meeting_action_substitution_restored' : 'meeting_action_substitution_assigned',
        data:{ meetingId:scope.record.meeting_id, actionId:scope.record.id, substitutionId:String(row.id), fromUserId:from, toUserId:to } });
}

async function listScopes(db, business, actor, owner) {
    const rows = (await db.query(`SELECT a.id, m.id AS meeting_id
        FROM meeting_action_items a ${scopedAction} WHERE a.assigned_to=$1 AND ${pending} AND NOT ${existingTask}
        ORDER BY a.id DESC LIMIT 100`, [owner, business, actorId(business, actor)])).rows;
    return rows.map(row => ({ id:String(row.id), title:`Нарада №${row.meeting_id} · доручення №${row.id}` }));
}

async function taskHasActionClaim(db, business, taskId) {
    const result = await db.query(`SELECT 1 FROM tasks t JOIN meeting_action_items a
        ON a.task_id=t.id OR (t.source_type='meeting_action' AND t.source_id=a.id::text)
        JOIN staff_substitutions ss ON ss.source_type='meeting_action' AND ss.source_id=a.id::text
        WHERE t.id=$1 AND ss.business_context=$2 AND ss.state<>'cancelled' LIMIT 1`, [taskId, business]);
    return result.rowCount > 0;
}

async function completeAction(db, row) {
    const result = await db.query(`UPDATE meeting_action_items a SET status='done'
        WHERE a.id=$1 AND a.assigned_to=$2 AND a.task_id IS NULL AND COALESCE(a.status,'pending') IN ('pending','done')`,
        [row.source_id,row.source_snapshot.replacement]);
    if (!result.rowCount) c.fail('SUBSTITUTION_SOURCE_STALE','Доручення наради вже змінилося.',409);
}

module.exports = { loadScope, lockScope, listScopes, changeAssignment, completeAction, taskHasActionClaim };
