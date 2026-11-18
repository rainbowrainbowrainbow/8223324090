#!/usr/bin/env node
'use strict';

// Read-only by construction. No application bootstrap, migrations or writes.
const { Client } = require('pg');
const { loadMembershipAccess } = require('../services/businessMembership');
const { auditAccount } = require('../services/baselineAccessAudit');

async function main() {
    const connectionString = process.env.ACCESS_AUDIT_DATABASE_URL;
    if (!connectionString) throw new Error('Set the dedicated ACCESS_AUDIT_DATABASE_URL locally; never pass credentials as CLI arguments.');
    const db = new Client({ connectionString });
    await db.connect();
    try {
        await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await db.query("SET LOCAL statement_timeout = '30s'");
        const users = await db.query(`SELECT id, role, is_active, extra_roles, page_allowlist, page_denylist,
            action_allowlist, action_denylist, business_contexts, default_business_context
            FROM users WHERE is_active IS TRUE ORDER BY id`);
        const profiles = await db.query(`SELECT ep.id AS profile_id, ep.user_id, ep.staff_id, s.role_type AS profession,
                s.is_active AS staff_active, s.company_structure_node_id
            FROM employee_profiles ep JOIN staff s ON s.id = ep.staff_id
            WHERE ep.is_active IS TRUE AND s.is_active IS TRUE ORDER BY ep.id`);
        const reports = [];
        for (const user of users.rows) {
            const access = await loadMembershipAccess(db, user, 'event_genix');
            reports.push(auditAccount({ user, access, profiles: profiles.rows.filter(row => row.user_id === user.id) }));
        }
        await db.query('ROLLBACK');
        process.stdout.write(JSON.stringify({ readOnly: true, baselineSha: '571a57acb80118cc6cc0e5a923c5a5bba9c09d86',
            context: 'event_genix', accounts: reports }, null, 2) + '\n');
    } finally {
        await db.query('ROLLBACK').catch(() => {});
        await db.end();
    }
}

if (require.main === module) main().catch(() => {
    // Do not echo driver errors, connection details or environment values.
    console.error('Read-only access audit failed. Check the local dedicated connection and schema; no changes were applied.');
    process.exitCode = 1;
});

module.exports = { main };
