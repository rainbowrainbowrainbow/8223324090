'use strict';

const { Client } = require('pg');
const { applyMembershipAccess, loadMembershipAccess } = require('../services/businessMembership');
const { resolveBusinessContextPolicy } = require('../services/businessContext');
const { normalizeRoleList, resolveCapability } = require('../services/accountAccessPolicy');
const { canViewTimelinePage } = require('../services/timelineContext');

async function auditEffectiveRoles(db, candidate) {
    const access = await loadMembershipAccess(db, candidate);
    const contexts = new Set([
        ...resolveBusinessContextPolicy(applyMembershipAccess(candidate, access)).allowed,
        ...access.memberships.map(membership => membership.businessContext)
    ]);
    const results = [];
    for (const businessContext of contexts) {
        const scopedAccess = await loadMembershipAccess(db, candidate, businessContext);
        const user = applyMembershipAccess(candidate, scopedAccess);
        if (scopedAccess.invalid || !resolveBusinessContextPolicy(user).allowed.includes(businessContext)) continue;
        const roles = normalizeRoleList(user);
        if (!roles.includes('animator')) continue;
        const { id, staff_id, role_type, animation_evidence } = candidate;
        results.push({
            account_id: id,
            staff_id,
            business_context: businessContext,
            role_source: scopedAccess.membershipEnabled ? 'membership' : 'account',
            effective_roles: roles,
            primary_profession: role_type,
            animation_evidence,
            timeline_visible: canViewTimelinePage(user, businessContext),
            certificates_page_allowed: resolveCapability(user, '/certificates', { type: 'page' }).allowed
        });
    }
    return results;
}

// The caller supplies an authorized read-only connection. Keep names and
// usernames out of the output; account IDs can be reviewed in HR.
async function main() {
    const connectionString = process.env.HR_ROLE_AUDIT_DATABASE_URL || process.env.PRODUCTION_READONLY_DATABASE_URL;
    if (!connectionString) throw new Error('PRODUCTION_READONLY_DATABASE_URL_REQUIRED');
    const client = new Client({
        connectionString,
        connectionTimeoutMillis: 10000,
        query_timeout: 15000,
        options: '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000',
        application_name: 'hr-timeline-roles-audit'
    });
    await client.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try {
            const result = await client.query(`
                SELECT u.id, u.role, u.extra_roles, u.business_contexts, u.default_business_context,
                       u.page_allowlist, u.page_denylist, s.id AS staff_id, s.role_type,
                       EXISTS (
                           SELECT 1 FROM staff_role_assignments a
                           WHERE a.staff_id = s.id AND a.profession_key = 'animator' AND a.status = 'active'
                       ) OR COALESCE(s.secondary_professions, '[]'::jsonb) ? 'animator' AS animation_evidence
                FROM employee_profiles ep
                JOIN users u ON u.id = ep.user_id AND u.is_active IS TRUE
                JOIN staff s ON s.id = ep.staff_id AND s.is_active IS TRUE
                WHERE ep.is_active IS TRUE AND s.role_type = 'trampoline_instructor'
                  AND ('animator' = u.role OR 'animator' = ANY(u.extra_roles)
                    OR EXISTS (
                        SELECT 1 FROM business_memberships bm
                        WHERE bm.user_id = u.id AND bm.is_active IS TRUE
                          AND ('animator' = bm.role OR 'animator' = ANY(bm.extra_roles))
                    ))
                ORDER BY u.id`);
            const accounts = [];
            for (const candidate of result.rows) accounts.push(...await auditEffectiveRoles(client, candidate));
            const expiry = await client.query(`
                SELECT COALESCE(business_context, 'event_genix') AS business_context,
                       COUNT(*)::int AS pending_expiry
                FROM staff_certifications
                WHERE status = 'active' AND expires_at < (now() AT TIME ZONE 'Europe/Kyiv')::date
                GROUP BY 1 ORDER BY 1`);
            process.stdout.write(JSON.stringify({ auditedAt: new Date().toISOString(), accounts, expiry: expiry.rows }, null, 2) + '\n');
        } finally {
            await client.query('ROLLBACK');
        }
    } finally {
        await client.end();
    }
}

if (require.main === module) {
    main().catch(error => {
        const reason = error.message === 'PRODUCTION_READONLY_DATABASE_URL_REQUIRED'
            ? error.message : (/^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'READ_ONLY_AUDIT_FAILED');
        process.stderr.write(`HR role audit failed (${reason}).\n`);
        process.exitCode = 1;
    });
}

module.exports = { auditEffectiveRoles };
