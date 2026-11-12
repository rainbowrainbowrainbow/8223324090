'use strict';

const { Client } = require('pg');

function parseAccountId(args) {
    if (!args.length) return null;
    if (args.length === 2 && args[0] === '--account-id' && /^[1-9]\d*$/.test(args[1])) {
        const id = Number(args[1]);
        if (Number.isSafeInteger(id) && id <= 2147483647) return id;
    }
    throw new Error('USAGE_AUDIT_ACCOUNT_BUSINESS_ACCESS');
}

async function auditAccountBusinessAccess(client, accountId = null) {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        const { rows } = await client.query(
            `WITH creation AS (
                SELECT DISTINCT ON (target_user_id) target_user_id, event_type, reason, details
                FROM account_security_events
                WHERE target_user_id IS NOT NULL
                  AND ($1::int IS NULL OR target_user_id = $1)
                  AND event_type IN ('account_onboarding_created', 'account_created')
                ORDER BY target_user_id, created_at DESC, id DESC
            ), candidates AS (
                SELECT u.id AS account_id,
                       COALESCE(c.reason, c.event_type, 'unverified') AS source,
                       CASE
                           WHEN c.event_type = 'account_onboarding_created' OR c.reason = 'staff_bulk_create'
                               THEN NULLIF(c.details->>'defaultBusinessContext', '')
                           WHEN c.reason = 'account_management'
                               AND c.details->'businessContexts' = jsonb_build_array(u.default_business_context)
                               THEN u.default_business_context
                       END AS expected_business
                FROM users u
                LEFT JOIN creation c ON c.target_user_id = u.id
                WHERE u.is_active IS TRUE
                  AND ($1::int IS NULL OR u.id = $1)
                  AND (c.target_user_id IS NOT NULL OR EXISTS (
                      SELECT 1 FROM employee_profiles ep
                      WHERE ep.user_id = u.id AND ep.staff_id IS NOT NULL AND ep.is_active IS TRUE
                  ))
            )
            SELECT a.account_id, a.source, a.expected_business,
                   CASE
                       WHEN b.id IS NULL OR o.status IS DISTINCT FROM 'active'
                           OR b.status IS DISTINCT FROM 'active' OR b.access_mode IS DISTINCT FROM 'membership'
                           OR (bm.business_id IS NOT NULL AND bm.organization_id IS DISTINCT FROM b.organization_id)
                           THEN 'unconfirmed'
                       WHEN bm.is_active IS FALSE OR om.is_active IS FALSE THEN 'revoked'
                       WHEN bm.business_id IS NULL OR om.organization_id IS NULL THEN 'missing'
                       WHEN bm.role = 'creator' AND u.role IS DISTINCT FROM 'creator' THEN 'unconfirmed'
                       ELSE 'active'
                   END AS status
            FROM candidates a
            JOIN users u ON u.id = a.account_id
            LEFT JOIN businesses b ON b.context_key = a.expected_business
            LEFT JOIN organizations o ON o.id = b.organization_id
            LEFT JOIN business_memberships bm ON bm.business_id = b.id AND bm.user_id = a.account_id
            LEFT JOIN organization_memberships om ON om.organization_id = o.id AND om.user_id = a.account_id
            ORDER BY a.account_id`,
            [accountId]
        );
        const counts = { active: 0, missing: 0, revoked: 0, unconfirmed: 0 };
        for (const row of rows) counts[row.status]++;
        return { counts, ...(accountId === null ? {} : { accounts: rows }) };
    } finally {
        await client.query('ROLLBACK');
    }
}

async function main() {
    const accountId = parseAccountId(process.argv.slice(2));
    const connectionString = process.env.PRODUCTION_READONLY_DATABASE_URL;
    if (!connectionString) throw new Error('PRODUCTION_READONLY_DATABASE_URL_REQUIRED');
    const client = new Client({
        connectionString,
        connectionTimeoutMillis: 10000,
        query_timeout: 15000,
        options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000',
        application_name: 'account-business-access-audit'
    });
    try {
        await client.connect();
        console.log(JSON.stringify(await auditAccountBusinessAccess(client, accountId), null, 2));
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        const safe = /^[A-Z_]+$/.test(error.message) ? error.message : 'ACCOUNT_BUSINESS_ACCESS_AUDIT_FAILED';
        console.error(safe);
        process.exitCode = 1;
    });
}

module.exports = { auditAccountBusinessAccess };
