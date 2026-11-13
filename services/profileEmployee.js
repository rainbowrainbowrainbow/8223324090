'use strict';

const { hasCurrentParkScheduleMembership } = require('./parkStaffScheduleAccess');
const { legacyBusinessSurfaceAccess } = require('./legacyBusinessSurface');

function hasProfileEmployeeScope(req) {
    return hasCurrentParkScheduleMembership(req)
        || legacyBusinessSurfaceAccess(req, 'staff').available;
}

async function loadProfileEmployee(db, req) {
    if (!hasProfileEmployeeScope(req)) return { rows: [] };
    const result = await db.query(
        `SELECT s.id, ep.id AS employee_profile_id, s.name, s.department, s.position,
                s.role_type, s.secondary_professions, s.phone,
                COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'key', a.profession_key,
                        'status', a.status,
                        'admissionStatus', a.admission_status,
                        'internshipStatus', a.internship_status
                    ) ORDER BY a.profession_key)
                    FROM staff_role_assignments a WHERE a.staff_id = s.id
                ), '[]'::jsonb) AS profession_assignments
         FROM employee_profiles ep
         JOIN staff s ON s.id = ep.staff_id
         WHERE ep.user_id = $1 AND ep.is_active = true
         LIMIT 2`,
        [req.user.id]
    );
    return result.rows.length === 1 ? result : { rows: [] };
}

module.exports = { hasProfileEmployeeScope, loadProfileEmployee };
