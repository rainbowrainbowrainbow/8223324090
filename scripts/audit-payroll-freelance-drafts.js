#!/usr/bin/env node
'use strict';

const { Client } = require('pg');

const CONFIRMATION = 'READ_ONLY_PAYROLL_FREELANCE_DRAFT_AUDIT';
const month = String(process.argv[2] || '').trim();

if (process.env.PAYROLL_FREELANCE_DRAFT_AUDIT_CONFIRM !== CONFIRMATION) {
    console.error(`Set PAYROLL_FREELANCE_DRAFT_AUDIT_CONFIRM=${CONFIRMATION}`);
    process.exit(1);
}
if (!/^\d{4}-\d{2}$/.test(month)) {
    console.error('Usage: node scripts/audit-payroll-freelance-drafts.js YYYY-MM');
    process.exit(1);
}
if (!process.env.DATABASE_PUBLIC_URL && !process.env.DATABASE_URL) {
    console.error('DATABASE_PUBLIC_URL or DATABASE_URL is required');
    process.exit(1);
}

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
        ssl: /(?:localhost|127\.0\.0\.1)/.test(process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL)
            ? false
            : { rejectUnauthorized: false }
    });
    await client.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await client.query(
            `SELECT
                COUNT(*)::int AS stored_reports,
                COUNT(*) FILTER (WHERE pr.status = 'draft')::int AS stored_drafts,
                COUNT(*) FILTER (
                    WHERE pr.status = 'draft'
                      AND COALESCE(s.is_freelance, false)
                )::int AS freelance_drafts,
                COUNT(*) FILTER (
                    WHERE pr.status = 'draft'
                      AND s.id IS NOT NULL
                      AND NOT COALESCE(s.is_freelance, false)
                )::int AS regular_drafts,
                COUNT(*) FILTER (
                    WHERE pr.status = 'draft'
                      AND s.id IS NULL
                )::int AS missing_staff_drafts,
                COUNT(*) FILTER (
                    WHERE pr.status = 'draft'
                      AND jsonb_typeof(pr.breakdown_json->'payrollBlockingIssues') = 'array'
                      AND jsonb_array_length(pr.breakdown_json->'payrollBlockingIssues') > 0
                )::int AS drafts_with_blockers,
                COUNT(*) FILTER (
                    WHERE pr.status = 'draft'
                      AND EXISTS (
                          SELECT 1
                          FROM jsonb_array_elements(
                              CASE
                                  WHEN jsonb_typeof(pr.breakdown_json->'lines') = 'array'
                                  THEN pr.breakdown_json->'lines'
                                  ELSE '[]'::jsonb
                              END
                          ) AS line
                          WHERE COALESCE(line->>'lineType', line->>'line_type') = 'simultaneous_additional'
                      )
                )::int AS drafts_with_additional_lines,
                COUNT(*) FILTER (
                    WHERE pr.status = 'draft'
                      AND pr.breakdown_json IS NULL
                )::int AS drafts_without_breakdown
             FROM payroll_reports pr
             LEFT JOIN staff s ON s.id = pr.staff_id
             WHERE pr.period_month = $1
               AND pr.voided_at IS NULL`,
            [month]
        );
        const row = result.rows[0] || {};
        console.log(JSON.stringify({
            mode: 'repeatable_read_read_only',
            month,
            storedReports: Number(row.stored_reports || 0),
            storedDrafts: Number(row.stored_drafts || 0),
            regularDrafts: Number(row.regular_drafts || 0),
            freelanceDrafts: Number(row.freelance_drafts || 0),
            missingStaffDrafts: Number(row.missing_staff_drafts || 0),
            draftsWithBlockers: Number(row.drafts_with_blockers || 0),
            draftsWithAdditionalLines: Number(row.drafts_with_additional_lines || 0),
            draftsWithoutBreakdown: Number(row.drafts_without_breakdown || 0)
        }));
        await client.query('ROLLBACK');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await client.end();
    }
}

run().catch(error => {
    console.error(error.message);
    process.exit(1);
});
