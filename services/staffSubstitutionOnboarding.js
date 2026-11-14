'use strict';

const contract = require('./staffSubstitutionContract');
const { resolveCapability } = require('./accountAccessPolicy');
const { getAssignableTaskOwner } = require('./taskExecution');
const { assignOnboardingResponsible, ONBOARDING_TASK_SOURCE_TYPE } = require('./hrOnboarding');
const log = require('../utils/logger').createLogger('StaffSubstitutionOnboarding');
const PARK = 'event_genix';

function requireManage(actor) {
    if (!resolveCapability(actor, 'hr.staff.manage', { type: 'action' }).allowed) {
        contract.fail('SUBSTITUTION_SOURCE_FORBIDDEN', 'Потрібен доступ до керування наставниками.', 403);
    }
}

function isGeneratedTask(task) {
    return task.source_type === ONBOARDING_TASK_SOURCE_TYPE || task.source_module === 'hr_onboarding';
}

async function loadScope(db, actor, input, current, accountForStaff) {
    requireManage(actor);
    if (!input.originalStaffId) contract.fail('SUBSTITUTION_ACCOUNT_REQUIRED', 'Оберіть поточного наставника.');
    const progress = (await db.query(`SELECT p.id,p.staff_id,p.profession_key,p.responsible_user_id,p.status,p.started_at
        FROM onboarding_progress p WHERE p.id=$1 AND NOT EXISTS (
            SELECT 1 FROM onboarding_progress newer WHERE newer.staff_id=p.staff_id
              AND newer.profession_key IS NOT DISTINCT FROM p.profession_key
              AND (newer.started_at,newer.id)>(p.started_at,p.id)
              AND (p.profession_key IS NOT NULL OR newer.status<>'completed')
        )`, [input.sourceId])).rows[0];
    if (!progress || (!current && progress.status === 'completed')) {
        contract.fail('SUBSTITUTION_SOURCE_NOT_FOUND', 'Активний процес наставництва не знайдено.', 404);
    }
    const original = await accountForStaff(db,input.originalStaffId);
    const replacement = await accountForStaff(db,input.staffId);
    if (Number(progress.responsible_user_id) !== (current ? replacement : original)
        || current && (original !== current.source_snapshot.original || replacement !== current.source_snapshot.replacement)) {
        contract.fail('SUBSTITUTION_SOURCE_STALE', 'Призначення або обліковий запис наставника вже змінилися.', 409);
    }
    await getAssignableTaskOwner(replacement, { pool:db, actor, businessContext:PARK });
    const blockers = [];
    if (input.originalTreatment !== 'retain' || input.payMode !== 'additional') {
        blockers.push({ code:'SUBSTITUTION_BASE_SOURCE_REQUIRED', message:'Для наставництва доступна додаткова оплата зі збереженням звичайної зарплати.' });
    }
    const claims = await db.query(`SELECT 1 FROM staff_substitutions s JOIN tasks t ON t.id::text=s.source_id
        WHERE s.business_context=$1 AND s.source_type='task' AND s.state<>'cancelled'
          AND COALESCE(t.business_context,'event_genix')=$1
          AND ((t.source_type='onboarding' AND split_part(t.source_id,':',1)=$2)
            OR (t.source_module='hr_onboarding' AND t.related_entity_type='onboarding_progress' AND t.related_entity_id=$2))
        LIMIT 1`, [PARK,input.sourceId]);
    if (claims.rowCount) blockers.push({ code:'SUBSTITUTION_USE_ONBOARDING_SOURCE', message:'Пов’язана задача вже має погоджену підміну.' });
    return { type:'onboarding', progress, original, replacement, blockers };
}

async function changeAssignment(db, actor, row, source, restore = false) {
    const callbacks = [];
    await assignOnboardingResponsible(source.progress.staff_id, restore ? source.original : source.replacement, actor, {
        db, afterCommit: callbacks, professionKey: source.progress.profession_key,
        expectedProgressId: row.source_id, expectedResponsibleUserId: restore ? source.replacement : source.original
    });
    return () => {
        for (const callback of callbacks) {
            Promise.resolve().then(callback).catch(error => log.warn('Task assignment notification failed', error.message));
        }
    };
}

async function listScopes(db, actor, owner) {
    requireManage(actor);
    const result = await db.query(`SELECT p.id,p.profession_key FROM onboarding_progress p
        WHERE p.responsible_user_id=$1 AND p.status<>'completed' AND NOT EXISTS (
            SELECT 1 FROM onboarding_progress newer WHERE newer.staff_id=p.staff_id
              AND newer.profession_key IS NOT DISTINCT FROM p.profession_key AND (newer.started_at,newer.id)>(p.started_at,p.id)
              AND (p.profession_key IS NOT NULL OR newer.status<>'completed')
        ) ORDER BY p.id DESC LIMIT 100`, [owner]);
    return result.rows.map(row => ({ id:String(row.id),
        title:`Наставництво №${row.id}${row.profession_key ? ` · ${row.profession_key}` : ''}` }));
}

module.exports = { isGeneratedTask, loadScope, changeAssignment, listScopes };
