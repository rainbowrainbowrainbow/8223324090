'use strict';

const { Client } = require('pg');
const { loadParkHrMonthlyReport } = require('../services/parkHrMonthlyReportRead');

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
            SELECT
                (SELECT COUNT(*)::int FROM staff) AS staff_total,
                (SELECT COUNT(*)::int FROM hr_shifts hs LEFT JOIN staff s ON s.id = hs.staff_id
                    WHERE s.id IS NULL) AS shift_orphans,
                (SELECT COUNT(*)::int FROM hr_time_records tr LEFT JOIN staff s ON s.id = tr.staff_id
                    WHERE s.id IS NULL) AS time_orphans,
                (SELECT COUNT(*)::int FROM tasks t WHERE t.owner_user_id IS NOT NULL
                    AND t.business_context = 'event_genix') AS park_tasks,
                (SELECT COUNT(*)::int FROM tasks t WHERE t.owner_user_id IS NOT NULL
                    AND t.business_context IS DISTINCT FROM 'event_genix') AS excluded_other_or_unknown_tasks,
                (SELECT COUNT(*)::int FROM tasks t WHERE t.business_context = 'event_genix'
                    AND t.owner_user_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM employee_profiles ep WHERE ep.user_id = t.owner_user_id
                            AND ep.is_active IS TRUE AND ep.staff_id IS NOT NULL
                    )) AS park_tasks_without_active_staff_profile,
                (SELECT COUNT(*)::int FROM tasks t
                    JOIN employee_profiles ep ON ep.user_id = t.owner_user_id AND ep.is_active IS TRUE
                    LEFT JOIN staff s ON s.id = ep.staff_id
                    WHERE t.business_context = 'event_genix' AND t.owner_user_id IS NOT NULL
                        AND ep.staff_id IS NOT NULL AND s.id IS NULL) AS park_tasks_orphan_staff,
                (SELECT COUNT(*)::int FROM (
                    SELECT ep.user_id FROM employee_profiles ep
                    WHERE ep.is_active IS TRUE AND ep.staff_id IS NOT NULL
                    GROUP BY ep.user_id HAVING COUNT(DISTINCT ep.staff_id) > 1
                ) duplicate) AS active_profile_ambiguous_owners
        `)).rows[0];
        const reportQueries = [];
        await loadParkHrMonthlyReport({ query: async (sql, params = []) => {
            reportQueries.push({ sql, params });
            return { rows: reportQueries.length === 1 ? [{ id: 1, name: 'Synthetic' }] : [] };
        } }, { dateFrom: '2026-09-01', dateTo: '2026-09-30' });
        for (const { sql, params } of reportQueries) await db.query(`EXPLAIN ${sql}`, params);
        process.stdout.write(JSON.stringify({ audit: 'EG-HR-18', role: identity.role,
            readOnly: true, atUtc: new Date().toISOString(), validatedSqlQueries: reportQueries.length, aggregates }) + '\n');
    } finally {
        await db.query('ROLLBACK').catch(() => {});
        await db.end();
    }
}

main().catch(error => {
    process.stderr.write(`Audit unavailable: ${error.code || error.message}\n`);
    process.exitCode = 1;
});
