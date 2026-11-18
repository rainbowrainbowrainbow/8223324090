'use strict';

const { resolveCapability } = require('./accountAccessPolicy');

async function loadStaffScheduleScope(db, user) {
    if (!resolveCapability(user, 'hr.schedule.manage').allowed) return { scope: 'read', editableStaffIds: [] };
    if (resolveCapability(user, 'hr.schedule.scope.business').allowed) return { scope: 'business', editableStaffIds: null };
    const membership = user?.activeBusinessMembership;
    if (membership?.businessContext !== 'event_genix' || user?.businessMembershipAccess?.invalid) {
        return { scope: 'team', editableStaffIds: [] };
    }
    const result = await db.query(`SELECT target.id
        FROM staff target
        WHERE target.is_active IS TRUE AND target.company_structure_node_id IS NOT NULL
          AND target.company_structure_node_id = (
              SELECT MIN(actor_staff.company_structure_node_id)
              FROM employee_profiles ep JOIN staff actor_staff ON actor_staff.id = ep.staff_id
              WHERE ep.user_id = $1 AND ep.is_active IS TRUE AND actor_staff.is_active IS TRUE
              HAVING COUNT(*) = 1
          ) ORDER BY target.id`, [user.id]);
    return { scope: 'team', editableStaffIds: result.rows.map(row => Number(row.id)) };
}

async function assertStaffScheduleTarget(db, user, staffId) {
    const scope = await loadStaffScheduleScope(db, user);
    return scope.scope === 'business' || scope.editableStaffIds.includes(Number(staffId));
}

function createStaffScheduleScopeGuard(db) {
    return async (req, res, next) => {
        const path = String(req.path || '/').replace(/\/$/, '') || '/';
        const read = ['GET', 'HEAD'].includes(req.method);
        const isSchedule = path === '/schedule' || path.startsWith('/schedule/') || /^\/\d+\/shift-preferences$/.test(path);
        if (!(isSchedule || (read && path === '/'))) return next();
        try {
            const scope = await loadStaffScheduleScope(db, req.user);
            req.staffScheduleScope = scope;
            if (path === '/schedule/export-xlsx' && scope.scope !== 'business') return res.status(403).json({ success: false,
                code: 'schedule_export_scope_required', error: 'Експорт повного графіка потребує окремого доступу до всього бізнесу.' });
            if (read || scope.scope === 'business') return next();
            if (scope.scope === 'read') return res.status(403).json({ success: false, code: 'schedule_write_forbidden' });
            let ids = [];
            if (path === '/schedule') ids = [req.body?.staffId ?? req.body?.staff_id];
            else if (path === '/schedule/bulk') ids = (req.body?.entries || []).map(row => row.staffId ?? row.staff_id);
            else if (path === '/schedule/copy-week') ids = req.body?.staffIds || req.body?.staff_ids || [];
            else if (/^\/\d+\/shift-preferences$/.test(path)) ids = [path.split('/')[1]];
            else {
                const match = path.match(/^\/schedule\/(\d+)\/(replace|replacement-clear)$/);
                if (match) {
                    const result = await db.query(`SELECT ss.staff_id, hs.original_staff_id
                        FROM staff_schedule ss LEFT JOIN hr_shifts hs
                          ON hs.staff_id = ss.staff_id AND hs.shift_date::text = LEFT(ss.date::text, 10)
                        WHERE ss.id = $1`, [match[1]]);
                    ids = result.rows.flatMap(row => [row.staff_id, row.original_staff_id].filter(Boolean));
                    if (match[2] === 'replace') ids.push(req.body?.replacement_staff_id ?? req.body?.replacementStaffId);
                }
            }
            if (!Array.isArray(ids) || !ids.length || ids.some(id => !scope.editableStaffIds.includes(Number(id)))) {
                return res.status(403).json({ success: false, code: 'schedule_team_scope_required',
                    error: 'Зміна графіка дозволена лише для працівників вашого підрозділу з підтвердженим зв’язком у структурі.' });
            }
            return next();
        } catch (error) { return next(error); }
    };
}

module.exports = { loadStaffScheduleScope, assertStaffScheduleTarget, createStaffScheduleScopeGuard };
