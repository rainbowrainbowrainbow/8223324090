'use strict';

const { Pool } = require('pg');

// The caller supplies an authorized read-only connection. Keep names and
// usernames out of the output; account IDs can be reviewed in HR.
async function main() {
    if (!process.env.HR_ROLE_AUDIT_DATABASE_URL) throw new Error('HR_ROLE_AUDIT_DATABASE_URL is required');
    const pool = new Pool({ connectionString: process.env.HR_ROLE_AUDIT_DATABASE_URL });
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN READ ONLY');
            await client.query("SET LOCAL statement_timeout = '10s'");
            const result = await client.query(`
                SELECT u.id AS account_id, s.id AS staff_id, b.context_key AS business_context,
                       u.role AS account_role, bm.role AS membership_role,
                       s.role_type AS primary_profession,
                       EXISTS (
                           SELECT 1 FROM staff_role_assignments a
                           WHERE a.staff_id = s.id AND a.profession_key = 'animator' AND a.status = 'active'
                       ) OR COALESCE(s.secondary_professions, '[]'::jsonb) ? 'animator' AS animation_evidence
                FROM employee_profiles ep
                JOIN users u ON u.id = ep.user_id AND u.is_active IS TRUE
                JOIN staff s ON s.id = ep.staff_id AND s.is_active IS TRUE
                LEFT JOIN business_memberships bm ON bm.user_id = u.id AND bm.is_active IS TRUE
                LEFT JOIN businesses b ON b.id = bm.business_id AND b.status = 'active'
                WHERE ep.is_active IS TRUE AND s.role_type = 'trampoline_instructor'
                  AND ('animator' = u.role OR 'animator' = ANY(u.extra_roles)
                    OR 'animator' = bm.role OR 'animator' = ANY(bm.extra_roles))
                ORDER BY u.id, b.context_key`);
            process.stdout.write(JSON.stringify(result.rows, null, 2) + '\n');
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    process.stderr.write(`HR role audit failed (${error.code || 'configuration'}).\n`);
    process.exitCode = 1;
});
