'use strict';

const { resolveCapability } = require('./accountAccessPolicy');
const { resolveBusinessScope } = require('./businessContext');
const { hasCurrentParkScheduleMembership } = require('./parkStaffScheduleAccess');
const { professionSchedulePlacement } = require('./staffDisplayGroups');

async function loadParkProfessionDepartmentOverrides(db, organizationId, professionId = null) {
    const { rows } = await db.query(
        'SELECT profession_id, department FROM park_profession_departments WHERE organization_id = $1 AND ($2::integer IS NULL OR profession_id = $2)',
        [organizationId, professionId]
    );
    return new Map(rows.map(row => [Number(row.profession_id), row.department]));
}

function applyParkProfessionDepartment(profession, departments, displayGroupContext) {
    if (!departments.has(Number(profession.id))) return profession;
    const overridden = { ...profession, department: departments.get(Number(profession.id)) };
    return { ...overridden, schedulePlacement: professionSchedulePlacement(overridden, displayGroupContext) };
}

function parkProfessionDepartments(db) {
    return async (req, res, next) => {
        const edit = req.method === 'PATCH' && /^\/professions\/([1-9]\d*)\/department$/.exec(req.path);
        const catalog = req.method === 'GET' && req.path === '/professions';
        const workspace = req.method === 'GET' && /^\/professions\/workspace\/[^/]+$/.test(req.path);
        if (!edit && !catalog && !workspace) return next();
        if (!hasCurrentParkScheduleMembership(req)) {
            return edit ? res.status(403).json({ success: false, error: 'Редагування доступне лише в Парк.' }) : next();
        }
        const { organizationId, businessId } = req.user.activeBusinessMembership;
        const canEdit = resolveBusinessScope(req).canWrite === true
            && resolveCapability(req.user, 'hr.staff.manage', { type: 'action' }).allowed;
        try {
            if (edit) {
                if (!canEdit) return res.status(403).json({ success: false, error: 'Немає права змінювати відділ посади.' });
                const { department } = req.body || {};
                const id = Number(edit[1]);
                if (!Number.isSafeInteger(id) || id > 2147483647 || typeof department !== 'string'
                    || !department.trim() || department.trim().length > 50 || Object.keys(req.body).length !== 1) {
                    return res.status(400).json({ success: false, error: 'Вкажіть відділ до 50 символів.' });
                }
                const { rows } = await db.query(`WITH eligible AS (
                    SELECT bm.organization_id FROM business_memberships bm
                    JOIN organization_memberships om USING (organization_id, user_id)
                    JOIN businesses b ON b.id = bm.business_id AND b.organization_id = bm.organization_id
                    JOIN organizations o ON o.id = b.organization_id
                    WHERE bm.business_id = $1 AND bm.organization_id = $2 AND bm.user_id = $3
                      AND bm.is_active AND om.is_active AND b.status = 'active' AND o.status = 'active'
                      AND b.context_key = 'event_genix' AND b.access_mode = 'membership'
                    FOR SHARE OF bm, om, b, o
                ), profession AS (
                    SELECT id FROM hr_professions WHERE id = $4 AND is_active FOR NO KEY UPDATE
                )
                INSERT INTO park_profession_departments (organization_id, profession_id, department)
                SELECT eligible.organization_id, p.id, $5 FROM eligible
                CROSS JOIN profession p
                ON CONFLICT (organization_id, profession_id) DO UPDATE
                SET department = EXCLUDED.department, updated_at = clock_timestamp()
                RETURNING profession_id AS id, department`, [businessId, organizationId, req.user.id, id, department.trim()]);
                if (!rows.length) return res.status(409).json({ success: false, error: 'Посада або членство вже недоступні.' });
                return res.json({ success: true, data: rows[0] });
            }

            const send = res.json.bind(res);
            res.json = async payload => {
                if (!payload?.success || !(catalog && Array.isArray(payload.data) || workspace && payload.data?.profession)) {
                    return send(payload);
                }
                try {
                    const departments = await loadParkProfessionDepartmentOverrides(db, organizationId);
                    const withDepartment = row => departments.has(Number(row.id))
                        ? { ...row, department: departments.get(Number(row.id)) } : row;
                    if (catalog) {
                        const data = payload.data.map(row => applyParkProfessionDepartment(
                            row, departments, res.locals.professionDisplayGroupContext));
                        return send({ ...payload, data });
                    }
                    const profession = withDepartment(payload.data.profession);
                    return send({ ...payload, data: { ...payload.data, profession,
                        parkDepartmentEditable: canEdit && Boolean(profession.id)
                            && profession.is_active !== false && profession.isActive !== false } });
                } catch {
                    res.status(500);
                    return send({ success: false, error: 'Не вдалося завантажити відділ посади.' });
                }
            };
            return next();
        } catch {
            return res.status(500).json({ success: false, error: 'Не вдалося завантажити або зберегти відділ посади.' });
        }
    };
}

module.exports = { parkProfessionDepartments, loadParkProfessionDepartmentOverrides, applyParkProfessionDepartment };
