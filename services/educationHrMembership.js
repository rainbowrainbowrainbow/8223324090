'use strict';
const { pool } = require('../db');
const { EducationGroupError } = require('./educationGroups');
const { businessContextCatalog, allowedBusinessContextsForUser, resolveBusinessScope, requireWritableBusinessScope } = require('./businessContext');
const { canAccessTimelineContext, canUseTimelineAction } = require('./timelineContext');
const { resolveCapability } = require('./accountAccessPolicy');
const { loadMembershipAccess, applyMembershipAccess } = require('./businessMembership');
const { hasCurrentParkScheduleMembership } = require('./parkStaffScheduleAccess');
const { getBusinessCabinetSettings } = require('./businessCabinet');

// This narrow HR workflow assigns ownership explicitly. It never infers staff ownership.
async function requireSourceManager(req, res) {
    if (!resolveCapability(req.user, 'hr.staff.manage', { type: 'action' }).allowed) {
        res.status(403).json({ success: false, error: 'Потрібен доступ до керування HR-працівниками.' }); return false;
    }
    const scope = resolveBusinessScope(req);
    if (scope.invalid || scope.activeContext !== 'event_genix' || scope.mode !== 'single'
        || !requireWritableBusinessScope(req, res, scope)) {
        if (!res.headersSent) res.status(403).json({ success: false, error: 'Відкрийте картку працівника в HR Park.' });
        return false;
    }
    if (!hasCurrentParkScheduleMembership(req)) {
        res.status(403).json({ success: false, error: 'Немає чинного HR-доступу Park.' }); return false;
    }
    return true;
}
async function rawActor(user) {
    const { loadAuthenticatedUserAccess } = require('../middleware/auth');
    return loadAuthenticatedUserAccess(user, { requireFresh: true });
}
async function targetActor(actor, context, db = pool) {
    const access = await loadMembershipAccess(db, actor, context);
    const user = applyMembershipAccess(actor, access);
    if (!canAccessTimelineContext(user, context) || !canUseTimelineAction(user, context, 'create')
        || !resolveCapability(user, 'create_booking', { type: 'action' }).allowed) {
        throw new EducationGroupError('Немає права призначати викладача в цьому навчальному бізнесі.', 403);
    }
    const cabinet = await getBusinessCabinetSettings(db, context);
    if (cabinet.timelineMode !== 'education') throw new EducationGroupError('Оберіть навчальний бізнес.', 409);
    return user;
}
async function listTargets(user, staffId) {
    const id = Number(staffId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new EducationGroupError('Некоректний ID працівника.');
    const person = (await pool.query('SELECT id,name,is_active FROM staff WHERE id=$1', [id])).rows[0];
    if (!person) throw new EducationGroupError('Працівника не знайдено.', 404);
    const actor = await rawActor(user);
    const access = await loadMembershipAccess(pool, actor);
    const contexts = [...new Set([...allowedBusinessContextsForUser(actor), ...(access.memberships || []).map(m => m.businessContext)])];
    const catalog = businessContextCatalog();
    const targets = [];
    for (const context of contexts) {
        try { await targetActor(actor, context); }
        catch (error) { if ([403,409].includes(error.status)) continue; throw error; }
        const membership = (await pool.query('SELECT is_active FROM education_teacher_memberships WHERE business_context=$1 AND staff_id=$2', [context,id])).rows[0];
        targets.push({ context, label: catalog.find(b => b.key === context)?.label || context, linked: Boolean(membership), isActive: membership?.is_active === true });
    }
    return { staff: person, targets };
}
async function assign(user, staffId, input, ipAddress) {
    const id = Number(staffId), context = String(input.educationBusinessContext || '').trim();
    if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-z][a-z0-9_]{2,63}$/.test(context)) throw new EducationGroupError('Оберіть працівника й навчальний бізнес.');
    if (input.confirmAssignment !== true) throw new EducationGroupError('Підтвердьте явне призначення працівника викладачем.');
    const actor = await rawActor(user), db = await pool.connect();
    try {
        await db.query('BEGIN');
        await targetActor(actor, context, db);
        const person = (await db.query('SELECT id,name,is_active FROM staff WHERE id=$1 FOR UPDATE',[id])).rows[0];
        if (!person) throw new EducationGroupError('Працівника не знайдено.',404);
        if (person.is_active !== true) throw new EducationGroupError('Нові призначення неактивного працівника заборонені.',409);
        const previous = (await db.query('SELECT * FROM education_teacher_memberships WHERE business_context=$1 AND staff_id=$2 FOR UPDATE',[context,id])).rows[0];
        if (previous && previous.is_active !== true) throw new EducationGroupError('Призначення деактивовано. Відновіть його явно в довіднику викладачів.',409);
        if (!previous) {
            await db.query('INSERT INTO education_teacher_memberships(business_context,staff_id,created_by,updated_by) VALUES ($1,$2,$3,$3)',[context,id,actor.id]);
            await db.query('INSERT INTO hr_audit_log(action,staff_id,performed_by,details,ip_address) VALUES ($1,$2,$3,$4,$5)',
                ['education_teacher_assign',id,actor.username,JSON.stringify({ businessContext: context, staffId: id, actorId: actor.id, policy: 'explicit_hr_manager_assignment' }),ipAddress]);
        }
        await db.query('COMMIT');
        return { id: person.id, name: person.name, businessContext: context, alreadyAssigned: Boolean(previous) };
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
}
module.exports = { requireSourceManager, listTargets, assign };
