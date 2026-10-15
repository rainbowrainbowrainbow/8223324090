'use strict';

// Owner decision, 2026-10-15: existing professions, checklist templates and
// employee progress belong exclusively to Park. This lane never reads rates,
// training, conditions, account identities or the broader workspace catalog.
const { resolveCapability } = require('./accountAccessPolicy');
const { hasCurrentParkScheduleMembership } = require('./parkStaffScheduleAccess');
const { classifyChecklistProgress, normalizeDashboardFilters } = require('./professionChecklists');

function matchParkProfessionRead(req) {
    if (req.method !== 'GET') return null;
    const path = req.path;
    if (path === '/checklists/dashboard') return { kind: 'dashboard' };
    let match = /^\/professions\/workspace\/([^/]+)$/.exec(path);
    if (match) return { kind: 'workspace', identity: decodeURIComponent(match[1]) };
    match = /^\/professions\/([^/]+)\/checklist$/.exec(path);
    if (match) return { kind: 'template', key: decodeURIComponent(match[1]) };
    match = /^\/professions\/([^/]+)\/staff\/([1-9]\d*)\/checklist$/.exec(path);
    if (match) return { kind: 'progress', key: decodeURIComponent(match[1]), staffId: Number(match[2]) };
    match = /^\/staff\/([1-9]\d*)\/(onboarding-assignment|onboarding-processes)$/.exec(path);
    if (match) return { kind: match[2], staffId: Number(match[1]) };
    return null;
}
const pick = (row, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
const access = { readOnly: true, partial: true, excluded: ['payroll', 'conditions', 'training', 'account'] };
function missing() { return Object.assign(new Error('Запис не знайдено'), { status: 404 }); }

async function loadCatalog(db, { key = null, identity = null, staffId = null, kind = null } = {}) {
    const professions = (await db.query(`SELECT id, key, title, department, is_active FROM hr_professions
        WHERE ($1::text IS NULL OR key = $1)
          AND ($2::text IS NULL OR key = $2 OR id::text = $2)
          AND ($3::int IS NULL OR EXISTS (SELECT 1 FROM staff_role_assignments a
            WHERE a.profession_key = hr_professions.key AND a.staff_id = $3))
        ORDER BY title`, [key, identity, staffId])).rows
        .map(row => ({ ...pick(row, ['id', 'key', 'title', 'department', 'is_active']), isReadonly: true, source: 'db' }));
    if ((key || identity) && !professions.length) throw missing();
    const keys = professions.map(row => row.key);
    const items = (await db.query(`SELECT i.id, i.profession_id, i.item_key, i.title, i.sort_order, i.is_active
        FROM hr_profession_checklist_items i JOIN hr_professions p ON p.id = i.profession_id
        WHERE p.key = ANY($1::text[]) ORDER BY i.sort_order, i.id`, [keys])).rows
        .map(row => ({ ...pick(row, ['id', 'profession_id', 'item_key', 'title', 'sort_order', 'is_active']),
            itemKey: row.item_key, isActive: row.is_active }));
    if (kind === 'template') return { professions, items, assignments: [], progress: [] };
    const assignments = (await db.query(`SELECT a.id, a.staff_id, a.profession_key, a.status, a.is_primary,
        a.admission_status, a.internship_status, s.name, s.is_active, p.title AS profession_title, p.department
        FROM staff_role_assignments a JOIN staff s ON s.id = a.staff_id
        JOIN hr_professions p ON p.key = a.profession_key
        WHERE a.profession_key = ANY($1::text[]) AND ($2::int IS NULL OR s.id = $2)
        ORDER BY s.name, a.id`, [keys, staffId])).rows.map(row => pick(row,
        ['id', 'staff_id', 'profession_key', 'status', 'is_primary', 'admission_status', 'internship_status', 'name', 'is_active', 'profession_title', 'department']));
    const progress = (await db.query(`SELECT x.staff_id, x.profession_key, x.checklist_item_id, x.completed_at
        FROM hr_staff_profession_checklist_progress x
        JOIN hr_professions p ON p.key = x.profession_key
        JOIN hr_profession_checklist_items i ON i.id = x.checklist_item_id AND i.profession_id = p.id
        JOIN staff s ON s.id = x.staff_id
        WHERE x.profession_key = ANY($1::text[]) AND ($2::int IS NULL OR x.staff_id = $2)
          AND EXISTS (SELECT 1 FROM staff_role_assignments a
            WHERE a.staff_id = x.staff_id AND a.profession_key = x.profession_key)`, [keys, staffId])).rows
        .map(row => pick(row, ['staff_id', 'profession_key', 'checklist_item_id', 'completed_at']));
    return { professions, items, assignments, progress };
}
function template(catalog, profession) {
    const items = catalog.items.filter(item => item.profession_id === profession.id);
    const activeItems = items.filter(item => item.is_active !== false);
    const archivedItems = items.filter(item => item.is_active === false);
    return { profession, items, activeItems, archivedItems, checklist: activeItems.map(item => item.title),
        counts: { total: items.length, active: activeItems.length, archived: archivedItems.length }, source: 'hr_profession_checklist_items' };
}
function readiness(catalog, assignment) {
    const profession = catalog.professions.find(row => row.key === assignment.profession_key);
    const items = template(catalog, profession).activeItems.map(item => {
        const record = catalog.progress.find(row => row.staff_id === assignment.staff_id
            && row.profession_key === profession.key && row.checklist_item_id === item.id);
        return { ...item, progress: record ? { completed: Boolean(record.completed_at), completedAt: record.completed_at } : null };
    });
    return { staffId: assignment.staff_id, professionKey: profession.key, profession, items,
        summary: classifyChecklistProgress(items.length, items.filter(item => item.progress?.completed).length) };
}
function dashboard(catalog, query) {
    const filters = normalizeDashboardFilters(query);
    if (filters.statuses.some(status => ['archived', 'orphaned'].includes(status))) {
        throw Object.assign(new Error('Історія звірки недоступна у скороченому перегляді.'), { status: 403 });
    }
    const professionMatches = p => (!filters.professionKeys.length || filters.professionKeys.includes(p.key))
        && (!filters.departments.length || filters.departments.includes(p.department))
        && (filters.includeInactiveProfessions || p.is_active !== false);
    const professions = catalog.professions.filter(professionMatches).map(p => ({ ...p,
        professionKey: p.key, professionTitle: p.title, activeItems: template(catalog, p).activeItems.length }));
    const rows = catalog.assignments.filter(a => professions.some(p => p.key === a.profession_key)
        && (!filters.staffIds.length || filters.staffIds.includes(a.staff_id))
        && (filters.includeInactiveStaff || a.is_active !== false)
        && (!filters.assignmentStatuses.length ? a.status === 'active' : filters.assignmentStatuses.includes(a.status)))
        .map(a => ({ assignmentId: a.id, staffId: a.staff_id, staffName: a.name, staffIsActive: a.is_active,
            professionKey: a.profession_key, professionTitle: a.profession_title, department: a.department,
            ...readiness(catalog, a).summary }))
        .filter(row => !filters.search || `${row.staffName} ${row.professionTitle}`.toLowerCase().includes(filters.search.toLowerCase()));
    const summary = { without_template: professions.filter(p => !p.activeItems).length,
        not_started: 0, in_progress: 0, completed: 0, archived: null, orphaned: null };
    for (const row of rows) if (row.status !== 'without_template') summary[row.status]++;
    const selected = rows.filter(row => !filters.statuses.length || filters.statuses.includes(row.status));
    return { filters, summary, professions,
        professionsWithoutTemplate: filters.statuses.length && !filters.statuses.includes('without_template') ? [] : professions.filter(p => !p.activeItems),
        assignments: selected.slice(filters.offset, filters.offset + filters.limit),
        pagination: { assignments: { limit: filters.limit, offset: filters.offset, total: selected.length,
            returned: selected.slice(filters.offset, filters.offset + filters.limit).length } },
        access: { ...access, excluded: [...access.excluded, 'archived_history', 'orphaned_history'] } };
}
async function loadOnboarding(db, route, query) {
    const staff = (await db.query('SELECT id, name, department FROM staff WHERE id = $1', [route.staffId])).rows[0];
    if (!staff) throw missing();
    const catalog = await loadCatalog(db, { staffId: route.staffId });
    const assignments = catalog.assignments.map(a => pick(a,
        ['staff_id', 'profession_key', 'profession_title', 'status', 'is_primary', 'admission_status', 'internship_status']));
    const rows = (await db.query(`SELECT o.id, o.staff_id, o.profession_key, o.status, o.training_status,
        o.started_at, o.completed_at, o.items, o.completed_items, o.total_items, t.name AS template_name,
        (SELECT count(*)::int FROM tasks x WHERE x.source_type = 'onboarding'
            AND x.source_id LIKE o.id::text || ':%' AND x.business_context = 'event_genix') AS task_total,
        (SELECT count(*)::int FROM tasks x WHERE x.source_type = 'onboarding'
            AND x.source_id LIKE o.id::text || ':%' AND x.business_context = 'event_genix'
            AND COALESCE(x.status, 'todo') IN ('done', 'completed')) AS task_completed,
        (SELECT count(*)::int FROM tasks x WHERE x.source_type = 'onboarding'
            AND x.source_id LIKE o.id::text || ':%' AND x.business_context = 'event_genix'
            AND COALESCE(x.status, 'todo') NOT IN ('done', 'completed', 'archived', 'cancelled')) AS task_active
        FROM onboarding_progress o LEFT JOIN onboarding_templates t ON t.id = o.template_id
        WHERE o.staff_id = $1 AND (o.profession_key IS NULL OR EXISTS (
            SELECT 1 FROM staff_role_assignments a JOIN hr_professions p ON p.key = a.profession_key
            WHERE a.staff_id = o.staff_id AND a.profession_key = o.profession_key))
        ORDER BY o.started_at DESC, o.id DESC`, [route.staffId])).rows;
    const processes = rows.map(row => {
        const assignment = catalog.assignments.find(a => a.profession_key === row.profession_key);
        const progress = assignment ? readiness(catalog, assignment).summary : null;
        const items = Array.isArray(row.items) ? row.items.map(item => pick(item, ['id', 'key', 'title', 'done'])) : [];
        const total = progress ? progress.total : Number(row.total_items || items.length);
        const completed = progress ? progress.completed : Number(row.completed_items || 0);
        return { ...pick(row, ['id', 'staff_id', 'profession_key', 'status', 'training_status', 'started_at', 'completed_at', 'template_name']),
            scope: row.profession_key ? 'profession' : 'general', profession_title: assignment?.profession_title || null,
            total_items: total, completed_items: completed, percent: total ? Math.round(completed / total * 100) : 0,
            readiness: progress, items: progress ? [] : items, responsible_restricted: true,
            task_summary: { total: Number(row.task_total) || 0, active: Number(row.task_active) || 0, completed: Number(row.task_completed) || 0 } };
    });
    const data = route.kind === 'onboarding-assignment'
        ? processes.find(p => (p.profession_key || '') === (query.professionKey || query.profession_key || '') && p.status !== 'completed') || null
        : { general: processes.find(p => !p.profession_key && p.status !== 'completed') || null,
            professions: processes.filter(p => p.profession_key), history: processes.filter(p => !p.profession_key && p.status === 'completed') };
    return { success: true, staff: pick(staff, ['id', 'name', 'department']), data, assignments, onboardingAccess: access };
}
function requireParkProfessionReads(db) {
    return async (req, res, next) => {
        let route;
        try { route = matchParkProfessionRead(req); } catch { return res.status(400).json({ success: false, error: 'Некоректний шлях' }); }
        if (!route || req.user?.businessMembershipAccess?.membershipEnabled !== true) return next();
        if (!hasCurrentParkScheduleMembership(req) || !resolveCapability(req.user, 'hr.staff.view', { type: 'action' }).allowed) {
            return res.status(403).json({ success: false, code: 'PARK_HR_PROFESSION_ACCESS_DENIED', error: 'Перегляд недоступний для цього бізнесу або ролі.' });
        }
        // Preserve the separately authorized compensation workspace for payroll viewers.
        if (route.kind === 'workspace' && resolveCapability(req.user, 'hr.payroll.view', { type: 'action' }).allowed) return next();
        try {
            if (route.kind.startsWith('onboarding-')) return res.json(await loadOnboarding(db, route, req.query));
            const catalog = await loadCatalog(db, route);
            if (route.kind === 'dashboard') return res.json({ success: true, data: dashboard(catalog, req.query) });
            const profession = catalog.professions[0];
            const checklistTemplate = template(catalog, profession);
            let data = checklistTemplate;
            if (route.kind === 'progress') {
                const assignment = catalog.assignments.find(a => a.staff_id === route.staffId && a.profession_key === profession.key);
                if (!assignment) throw missing();
                data = readiness(catalog, assignment);
            }
            if (route.kind === 'workspace') {
                const people = catalog.assignments.filter(a => a.profession_key === profession.key && a.status === 'active' && a.is_active !== false)
                    .map(a => ({ id: a.staff_id, name: a.name, department: a.department, assignmentStatus: a.status,
                        admissionStatus: a.admission_status, internshipStatus: a.internship_status,
                        isActive: a.is_active, isPrimary: a.is_primary, readiness: readiness(catalog, a).summary }));
                const records = catalog.progress.filter(row => row.profession_key === profession.key);
                const activeItems = new Set(checklistTemplate.activeItems.map(item => item.id));
                const activeRecords = records.filter(row => activeItems.has(row.checklist_item_id));
                const checklistProgress = {
                    activeRecords: activeRecords.length, activeCompleted: activeRecords.filter(row => row.completed_at).length,
                    activeStaffWithProgress: new Set(activeRecords.map(row => row.staff_id)).size,
                    historicalRecords: records.length, historicalCompleted: records.filter(row => row.completed_at).length
                };
                data = { profession: { ...profession, staffCount: people.length }, people, checklistTemplate, checklistProgress,
                    checklist: checklistTemplate.checklist, access };
            }
            return res.json({ success: true, data, professionAccess: access });
        } catch (error) {
            return res.status(error.status || 500).json({ success: false,
                error: error.status === 403 ? 'Історія звірки недоступна у скороченому перегляді.'
                    : error.status === 404 ? 'Запис не знайдено' : 'Не вдалося завантажити дані. Повторіть спробу.' });
        }
    };
}
module.exports = { matchParkProfessionRead, requireParkProfessionReads, loadCatalog, loadOnboarding };
