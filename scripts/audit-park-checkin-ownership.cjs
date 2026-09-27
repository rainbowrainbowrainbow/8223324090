'use strict';

const { Client } = require('pg');

async function main() {
    if (!process.env.PRODUCTION_READONLY_DATABASE_URL) throw new Error('Read-only audit connection is required');
    const db = new Client({ connectionString: process.env.PRODUCTION_READONLY_DATABASE_URL, statement_timeout: 10000 });
    try {
        await db.connect();
        await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const identity = (await db.query(
            "SELECT current_user AS role, current_setting('transaction_read_only') AS read_only"
        )).rows[0];
        if (identity.role !== 'eventgenix_audit_ro' || identity.read_only !== 'on') {
            throw new Error('Read-only audit role/transaction not verified');
        }
        const aggregates = (await db.query(`
            SELECT COUNT(*)::int AS checkins,
                COUNT(DISTINCT sc.staff_id)::int AS linked_staff,
                COUNT(*) FILTER (WHERE s.id IS NULL)::int AS orphan_checkins,
                COUNT(*) FILTER (WHERE sc.date IS NULL)::int AS missing_dates,
                COUNT(*) FILTER (WHERE sc.check_in IS NULL AND sc.check_out IS NULL)::int AS empty_time_rows
            FROM staff_checkins sc LEFT JOIN staff s ON s.id = sc.staff_id
        `)).rows[0];
        await db.query(`EXPLAIN SELECT sc.date::text AS date,
                sc.check_in AS check_in_time,
                sc.check_out AS check_out_time,
                CASE WHEN sc.check_out IS NOT NULL THEN 'checked_out'
                    WHEN sc.check_in IS NOT NULL THEN 'checked_in'
                    ELSE 'pending' END AS status,
                COALESCE(NULLIF(s.display_name, ''), s.name) AS staff_name
            FROM staff_checkins sc JOIN staff s ON s.id = sc.staff_id
            WHERE sc.date = $1::date ORDER BY sc.check_in NULLS LAST, staff_name`, ['2026-09-27']);
        process.stdout.write(JSON.stringify({ audit: 'EG-HR-19', role: identity.role,
            readOnly: true, sqlValidated: true, atUtc: new Date().toISOString(), aggregates }) + '\n');
    } finally {
        await db.query('ROLLBACK').catch(() => {});
        await db.end();
    }
}

main().catch(error => {
    process.stderr.write(`Audit unavailable: ${error.code || error.message}\n`);
    process.exitCode = 1;
});
