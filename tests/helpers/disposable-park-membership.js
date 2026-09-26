'use strict';

const assert = require('node:assert/strict');

async function ensureDisposableParkMembership(db, userId, role) {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(Number(userId) > 0);
    assert.ok(role);
    const organization = await db.query(
        `INSERT INTO organizations (slug, name, status)
         VALUES ('hr-browser-park-fixture', 'Disposable Park HR browser fixture', 'active')
         ON CONFLICT (slug) DO UPDATE SET status = 'active' RETURNING id`
    );
    const business = await db.query(
        `INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules, status)
         VALUES ($1, 'event_genix', 'Fixture Park', 'Park', 'membership', '[]'::jsonb, 'active')
         ON CONFLICT (context_key) DO UPDATE SET organization_id = EXCLUDED.organization_id,
            access_mode = 'membership', status = 'active'
         RETURNING id, organization_id`,
        [organization.rows[0].id]
    );
    const { id: businessId, organization_id: organizationId } = business.rows[0];
    await db.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, is_active)
         VALUES ($1, $2, 'member', true)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET is_active = true`,
        [organizationId, userId]
    );
    await db.query(
        `INSERT INTO business_memberships
            (business_id, organization_id, user_id, role, action_denylist, is_default, is_active)
         VALUES ($1, $2, $3, $4, ARRAY[]::text[], true, true)
         ON CONFLICT (business_id, user_id) DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            role = EXCLUDED.role, is_default = true, is_active = true`,
        [businessId, organizationId, userId, role]
    );
}

module.exports = { ensureDisposableParkMembership };
