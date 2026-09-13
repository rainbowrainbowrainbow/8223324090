'use strict';

// Account deactivation and organization-role changes must acquire this lock
// immediately after BEGIN, before taking any account, staff or organization row
// locks. One shared lock also covers concurrent membership creation/discovery.
async function lockOrganizationOwnership(client) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eventgenix:organization-ownership'))");
}

async function assertCanDeactivateOrganizationOwners(client, userIds) {
    if (!Array.isArray(userIds) || userIds.some(id => !['number', 'string'].includes(typeof id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
        const error = new Error('A list of positive account IDs is required');
        Object.assign(error, { status: 400, statusCode: 400, code: 'organization_owner_target_invalid' });
        throw error;
    }
    const ids = [...new Set(userIds.map(Number))];
    if (!ids.length) return;
    // Reacquisition is safe within the same transaction. Entry points take this
    // lock before existing row locks; the guard also protects direct callers.
    await lockOrganizationOwnership(client);
    const orphaned = await client.query(
        `SELECT om.organization_id
         FROM organization_memberships om
         JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
         JOIN users u ON u.id = om.user_id AND u.is_active IS TRUE
         WHERE om.role = 'owner' AND om.is_active IS TRUE
         GROUP BY om.organization_id
         HAVING COUNT(*) FILTER (WHERE om.user_id = ANY($1::int[])) > 0
            AND COUNT(*) FILTER (WHERE NOT (om.user_id = ANY($1::int[]))) = 0
         ORDER BY om.organization_id`,
        [ids]
    );
    if (orphaned.rows.length) {
        const error = new Error('Cannot deactivate the last active owner of an organization');
        Object.assign(error, { status: 409, statusCode: 409, code: 'organization_last_owner' });
        throw error;
    }
}

module.exports = { lockOrganizationOwnership, assertCanDeactivateOrganizationOwners };
