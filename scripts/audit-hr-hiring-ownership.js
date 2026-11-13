'use strict';

const { Client } = require('pg');

async function main() {
    const connectionString = process.env.HR_HIRING_AUDIT_DATABASE_URL;
    if (!connectionString) throw new Error('HR_HIRING_AUDIT_DATABASE_URL is required for the read-only hiring audit');
    const client = new Client({ connectionString, application_name: 'hr-hiring-readonly-audit' });
    try {
        await client.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '15s'");
        const columns = await client.query(`SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='job_vacancies' AND column_name='business_context'`);
        const summary = await client.query(`SELECT count(*)::int AS vacancies,
            (SELECT count(*)::int FROM job_applications) AS applications,
            (SELECT count(*)::int FROM job_application_resume_files) AS resume_files,
            (SELECT count(*)::int FROM job_applications WHERE status='hired') AS hired_applications,
            ${columns.rows.length ? 'count(*) FILTER (WHERE business_context IS NULL)' : 'count(*)'}::int AS unassigned_vacancies
            FROM job_vacancies`);
        await client.query('COMMIT');
        console.log(JSON.stringify({ ownershipColumnPresent: columns.rows.length > 0, ...summary.rows[0] }));
    } finally {
        await client.end();
    }
}

main().catch(() => {
    console.error('Read-only hiring audit unavailable. Verify the local audit connection and database access.');
    process.exitCode = 1;
});
