'use strict';

const BODY_FIELDS = new Set(['primary_role', 'primaryRole', 'assignments', 'data']);
const ROLE_FIELDS = new Set(['profession_key', 'professionKey', 'key', 'is_primary', 'isPrimary',
    'status', 'admission_status', 'admissionStatus', 'internship_status', 'internshipStatus']);

// Any financial or unknown field stays behind the existing payroll rules guard,
// including explicitly supplied null values. Never silently discard such input.
function isProfessionOnlyRoleAssignmentBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || !Object.keys(body).every(key => BODY_FIELDS.has(key))) return false;
    const rows = body.assignments ?? body.data;
    return Array.isArray(rows) && rows.length > 0 && rows.length <= 100
        && rows.every(row => row && typeof row === 'object' && !Array.isArray(row)
            && Object.keys(row).every(key => ROLE_FIELDS.has(key)));
}

async function saveStaffProfessionAssignments(db, staffId, rows, actor) {
    const keys = rows.map(row => row.profession_key);
    // Retained assignments keep their IDs, rates, payroll schemes and notes.
    await db.query('UPDATE staff_role_assignments SET is_primary = false WHERE staff_id = $1', [staffId]);
    await db.query('DELETE FROM staff_role_assignments WHERE staff_id = $1 AND NOT (profession_key = ANY($2::text[]))', [staffId, keys]);
    const saved = [];
    for (const row of rows) {
        const result = await db.query(`INSERT INTO staff_role_assignments
            (staff_id, profession_key, is_primary, status, admission_status, internship_status, created_by, updated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
            ON CONFLICT (staff_id, profession_key) DO UPDATE SET
                is_primary = EXCLUDED.is_primary, status = EXCLUDED.status,
                admission_status = EXCLUDED.admission_status, internship_status = EXCLUDED.internship_status,
                updated_by = EXCLUDED.updated_by, updated_at = now()
            RETURNING profession_key, is_primary, status, admission_status, internship_status`,
        [staffId, row.profession_key, row.is_primary, row.status, row.admission_status, row.internship_status, actor]);
        saved.push(result.rows[0]);
    }
    return saved;
}

module.exports = { isProfessionOnlyRoleAssignmentBody, saveStaffProfessionAssignments };
