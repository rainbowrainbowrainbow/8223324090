'use strict';

const c = require('./staffSubstitutionContract');
const { requireRole } = require('../middleware/auth');
const { requireInbox } = require('./staffSubstitutionInbox');
const { listOmniOperators } = require('./omni-inbox');
const { findActiveReplyOwnerUser, reassignReplyExpectationOwner, notifyCRM } = require('./omni-hub');
const { logReplyActionEvent, REPLY_ACTION_TYPES } = require('./replyActionHistory');

const activeReply = `c.reply_expected IS TRUE AND c.awaiting_reply_since IS NOT NULL
    AND c.status IN ('open','pending') AND (c.last_inbound_at IS NULL OR c.last_inbound_at<=c.awaiting_reply_since)
    AND m.direction='outbound' AND COALESCE(m.delivery_status,'') NOT IN ('failed','later_failed')`;
const activeTask = "COALESCE(t.status,'todo') NOT IN ('done','cancelled','archived')";

function requireAccess(actor,business) {
    requireInbox(actor,business);
    requireRole('manager')({ user:actor }, { status() { return this; }, json() {
        c.fail('SUBSTITUTION_SOURCE_FORBIDDEN','Потрібен доступ керівника до черги відповідей.',403);
    } }, () => {});
}

async function lookup(db,business,id) {
    return (await db.query(`SELECT m.id AS message_id,c.id AS conversation_id,c.reply_owner_user_id,c.reply_owner,
        (c.reply_expected_message_id=m.id AND ${activeReply}) AS active,t.id AS task_id,t.owner_user_id,t.status AS task_status
        FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
        JOIN tasks t ON t.source_type='conversation_reply' AND t.source_id=m.id::text
          AND COALESCE(t.business_context,'event_genix')=$2
        WHERE m.id=$1 AND COALESCE(c.business_context,'event_genix')=$2 AND m.direction='outbound'`,[id,business])).rows[0];
}

async function lockScope(db,input,business) {
    await db.query(`SELECT c.id FROM conversations c JOIN conversation_messages m ON m.conversation_id=c.id
        WHERE m.id=$1 AND COALESCE(c.business_context,'event_genix')=$2 FOR UPDATE OF c`,[input.sourceId,business]);
    await db.query(`SELECT id FROM tasks WHERE source_type='conversation_reply' AND source_id=$1
        AND COALESCE(business_context,'event_genix')=$2 FOR UPDATE`,[input.sourceId,business]);
}

async function loadScope(db,business,actor,input,current,accountForStaff,{ completedCycle = false } = {}) {
    requireAccess(actor,business);
    if (!input.originalStaffId) c.fail('SUBSTITUTION_ACCOUNT_REQUIRED','Оберіть поточного відповідального за відповідь.');
    const record = await lookup(db,business,input.sourceId);
    const expected = current?.source_snapshot;
    const original = expected?.original ?? await accountForStaff(db,input.originalStaffId);
    const replacement = expected?.replacement ?? await accountForStaff(db,input.staffId);
    const owner = current ? replacement : original;
    if (!record || expected && (record.conversation_id !== expected.conversationId || record.task_id !== expected.taskId)
        || record.owner_user_id !== owner
        || (record.active ? record.reply_owner_user_id !== owner
            : !completedCycle || !['done','cancelled','archived'].includes(record.task_status))
        || !completedCycle && ['done','cancelled','archived'].includes(record.task_status)) {
        c.fail('SUBSTITUTION_SOURCE_STALE','Повідомлення, відповідальний або задача ескалації вже змінилися.',409);
    }
    const blockers = [];
    if (!completedCycle) {
        const candidate = await findActiveReplyOwnerUser(replacement,db);
        if (!(await listOmniOperators(business,db)).some(item => item.username === candidate.username)) {
            blockers.push({code:'SUBSTITUTION_INBOX_OPERATOR_REQUIRED',message:'Виконавцю потрібен чинний доступ до inbox.'});
        }
    }
    if (!current && (await db.query(`SELECT 1 FROM staff_substitutions WHERE business_context=$1 AND state<>'cancelled'
        AND ((source_type='task' AND source_id=$2) OR (source_type='inbox' AND source_id=$3 AND state='active')) LIMIT 1`,
    [business,String(record.task_id),String(record.conversation_id)])).rowCount) {
        blockers.push({code:'SUBSTITUTION_USE_REPLY_SOURCE',message:'Для ескалації або розмови вже погоджено підміну.'});
    }
    if (input.originalTreatment !== 'retain' || input.payMode !== 'additional') {
        blockers.push({code:'SUBSTITUTION_BASE_SOURCE_REQUIRED',message:'Для очікуваної відповіді доступна лише додаткова оплата.'});
    }
    return { type:'inbox_reply', conversationId:record.conversation_id, taskId:record.task_id, original,replacement,
        previousLabel:record.active ? record.reply_owner : null, blockers };
}

async function changeAssignment(db,business,actor,row,scope,restore = false) {
    const to = restore ? scope.original : scope.replacement;
    if (restore) {
        const candidate = await findActiveReplyOwnerUser(to,db);
        if (!(await listOmniOperators(business,db)).some(item => item.username === candidate.username)) {
            c.fail('SUBSTITUTION_INBOX_OPERATOR_REQUIRED','Попередній відповідальний більше не має доступу до inbox.',409);
        }
    }
    const from = restore ? scope.replacement : scope.original;
    const result = await reassignReplyExpectationOwner(scope.conversationId,to,{
        client:db,businessContext:business,messageId:row.source_id,currentOwnerId:from,taskId:scope.taskId
    });
    await logReplyActionEvent({
        conversationId:scope.conversationId,replyExpectedMessageId:row.source_id,
        actionType:REPLY_ACTION_TYPES.OWNER_REASSIGNED,actor,sourceSurface:'staff_substitution',
        oldValue:{replyOwnerUserId:from,replyOwner:scope.previousLabel},
        newValue:{replyOwnerUserId:to,replyOwner:result.owner.label},
        meta:{substitutionId:String(row.id),escalationTaskId:scope.taskId,restore}
    },{pool:db});
    return () => { void notifyCRM('omni:conversation',{conversation:result.conversation}); };
}

async function listScopes(db,business,actor,owner) {
    requireAccess(actor,business);
    const rows = (await db.query(`SELECT m.id,c.id AS conversation_id FROM conversations c
        JOIN conversation_messages m ON m.id=c.reply_expected_message_id AND m.conversation_id=c.id
        JOIN tasks t ON t.source_type='conversation_reply' AND t.source_id=m.id::text AND COALESCE(t.business_context,'event_genix')=$1
        WHERE COALESCE(c.business_context,'event_genix')=$1 AND c.reply_owner_user_id=$2 AND t.owner_user_id=$2
        AND ${activeReply} AND ${activeTask} ORDER BY m.id DESC LIMIT 100`,[business,owner])).rows;
    return rows.map(row => ({id:String(row.id),title:`Розмова №${row.conversation_id} · відповідь на повідомлення №${row.id}`}));
}

module.exports = { loadScope, lockScope, listScopes, changeAssignment };
