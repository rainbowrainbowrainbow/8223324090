'use strict';

// Read-only operator preflight. It intentionally does not bootstrap, backfill,
// or update access records.
const { pool } = require('../db');

const OWNED_TABLES = ['bookings', 'customers', 'leads', 'tasks', 'finance_transactions', 'warehouse_stock', 'graduation_quotes'];

async function main() {
    const summary = { generatedAt: new Date().toISOString(), users: [], organizations: 0, businesses: [], orphanedBusinessContextRows: {} };
    const users = await pool.query(
        `SELECT id, username, role, business_contexts, default_business_context
         FROM users WHERE is_active IS TRUE ORDER BY id`
    );
    summary.users = users.rows.map(row => ({
        id: row.id,
        username: row.username,
        role: row.role,
        businessContexts: row.business_contexts || [],
        defaultBusinessContext: row.default_business_context || null
    }));
    const organizationState = await pool.query(
        `SELECT (SELECT COUNT(*)::int FROM organizations) AS organizations,
                COALESCE((SELECT json_agg(row_to_json(b)) FROM (
                    SELECT id, organization_id, context_key, access_mode, status FROM businesses ORDER BY id
                ) b), '[]'::json) AS businesses`
    );
    summary.organizations = organizationState.rows[0].organizations;
    summary.businesses = organizationState.rows[0].businesses;

    for (const table of OWNED_TABLES) {
        const exists = await pool.query('SELECT to_regclass($1) AS relation', [`public.${table}`]);
        if (!exists.rows[0].relation) continue;
        const count = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE business_context IS NULL OR btrim(business_context) = ''`);
        summary.orphanedBusinessContextRows[table] = count.rows[0].count;
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
    process.stderr.write(`Multi-business readiness audit failed: ${error.message}\n`);
    process.exitCode = 1;
}).finally(() => pool.end());
