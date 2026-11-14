'use strict';

const contract = require('./staffSubstitutionContract');
const { resolveCapability } = require('./accountAccessPolicy');
const { canAccessBusinessContext } = require('./businessContext');
const { listOmniOperators } = require('./omni-inbox');
const { insertHistory } = require('./historyLog');
const log = require('../utils/logger').createLogger('StaffSubstitutionInbox');

function requireInbox(actor, business) {
    if (!canAccessBusinessContext(actor, business) || !resolveCapability(actor, '/omni', { type: 'page' }).allowed) {
        contract.fail('SUBSTITUTION_SOURCE_FORBIDDEN', 'Немає доступу до розмов цього кабінету.', 403);
    }
}

async function loadScope(db, business, actor, input, current, accountForStaff) {
    requireInbox(actor, business);
    if (!input.originalStaffId) contract.fail('SUBSTITUTION_ACCOUNT_REQUIRED', 'Оберіть поточного відповідального.');
    const record = (await db.query(`SELECT id,assigned_to,status,reply_expected FROM conversations
        WHERE id=$1 AND COALESCE(business_context,'event_genix')=$2`, [input.sourceId,business])).rows[0];
    if (!record) contract.fail('SUBSTITUTION_SOURCE_NOT_FOUND', 'Розмову не знайдено.', 404);
    const original = await accountForStaff(db,input.originalStaffId);
    const replacement = await accountForStaff(db,input.staffId);
    const users = (await db.query('SELECT id,username FROM users WHERE id=ANY($1::int[]) ORDER BY id',
        [[original,replacement]])).rows;
    const originalName = users.find(user => user.id === original)?.username;
    const replacementName = users.find(user => user.id === replacement)?.username;
    if (!originalName || !replacementName || record.assigned_to !== (current ? replacementName : originalName)
        || current && (original !== current.source_snapshot.original || replacement !== current.source_snapshot.replacement)) {
        contract.fail('SUBSTITUTION_SOURCE_STALE', 'Відповідального за розмову вже змінено.', 409);
    }
    const operators = await listOmniOperators(business, db);
    const blockers = [];
    if (!operators.some(operator => operator.username === replacementName)) {
        blockers.push({ code:'SUBSTITUTION_INBOX_OPERATOR_REQUIRED', message:'Виконавець повинен мати чинний доступ до цього inbox.' });
    }
    if (!current && (record.reply_expected || !['open','pending'].includes(record.status))) {
        blockers.push({ code:'SUBSTITUTION_INBOX_SCOPE_REQUIRED', message:'Оберіть відкриту розмову без окремого очікування відповіді.' });
    }
    if (input.originalTreatment !== 'retain' || input.payMode !== 'additional') {
        blockers.push({ code:'SUBSTITUTION_BASE_SOURCE_REQUIRED', message:'Передача розмови передбачає додаткову оплату зі збереженням звичайної зарплати.' });
    }
    return { type:'inbox', record, original, replacement, originalName, replacementName, blockers };
}

async function changeAssignment(db, business, actor, row, source, restore = false) {
    const assignedTo = restore ? source.originalName : source.replacementName;
    const expected = restore ? source.replacementName : source.originalName;
    if (restore && !(await listOmniOperators(business, db)).some(operator => operator.username === assignedTo)) {
        contract.fail('SUBSTITUTION_INBOX_OPERATOR_REQUIRED', 'Попередній відповідальний більше не має доступу до inbox.', 409);
    }
    const afterCommit = [];
    await require('./omni-hub').updateConversationStatus(row.source_id, undefined, assignedTo, undefined, {
        businessContext:business, client:db, afterCommit, expected:{ assigned_to:expected }
    });
    await insertHistory(db, { businessContext:business, action:restore ? 'inbox_substitution_restored' : 'inbox_substitution_assigned',
        username:actor.username, data:{ conversationId:source.record.id, substitutionId:String(row.id),
            originalUserId:source.original, replacementUserId:source.replacement } });
    return () => {
        for (const callback of afterCommit) Promise.resolve().then(callback).catch(error => log.warn('Inbox notification failed', error.message));
    };
}

async function listScopes(db, business, actor, owner) {
    requireInbox(actor, business);
    const result = await db.query(`SELECT c.id FROM conversations c JOIN users u ON u.username=c.assigned_to
        WHERE u.id=$1 AND COALESCE(c.business_context,'event_genix')=$2
          AND c.status IN ('open','pending') AND c.reply_expected IS NOT TRUE
        ORDER BY c.id DESC LIMIT 100`, [owner,business]);
    return result.rows.map(row => ({ id:String(row.id), title:`Розмова Omni №${row.id}` }));
}

module.exports = { requireInbox, loadScope, changeAssignment, listScopes };
