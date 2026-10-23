'use strict';

// Disposable test data only. Runtime startup and production never import this helper.
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

async function prepareParkHrOwnershipFixture(databaseUrl, env = process.env) {
    assert.equal(env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(databaseUrl, env);
    assert.equal(target.isLocal, true, 'HR ownership fixtures require disposable loopback PostgreSQL');
    const db = new Client({ connectionString: target.url.toString(), ssl: false });
    try {
        await db.connect();
        await db.query('BEGIN');
        assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, target.databaseName);
        const existing = (await db.query("SELECT b.id, b.organization_id FROM businesses b JOIN organizations o ON o.id=b.organization_id WHERE b.context_key='event_genix' AND b.status='active' AND o.status='active' FOR UPDATE OF b")).rows[0];
        let owner = existing;
        if (!owner) {
            const organization = (await db.query("INSERT INTO organizations (slug, name) VALUES ('isolated-hr-park-owner', 'Disposable Park HR owner') RETURNING id")).rows[0];
            owner = (await db.query("INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode) VALUES ($1,'event_genix','Disposable Park','Park','compatibility') RETURNING id, organization_id", [organization.id])).rows[0];
        }
        const params = [owner.id, owner.organization_id];
        await db.query('UPDATE hr_professions SET business_id=$1, organization_id=$2 WHERE business_id IS NULL AND organization_id IS NULL', params);
        await db.query('UPDATE onboarding_templates SET business_id=$1, organization_id=$2 WHERE business_id IS NULL AND organization_id IS NULL', params);
        await db.query(`UPDATE hr_profession_checklist_items i SET business_id=$1, organization_id=$2 FROM hr_professions p
            WHERE i.profession_id=p.id AND p.business_id=$1 AND p.organization_id=$2 AND i.business_id IS NULL AND i.organization_id IS NULL`, params);
        await db.query(`UPDATE staff_role_assignments a SET business_id=$1, organization_id=$2 FROM hr_professions p
            WHERE a.profession_key=p.key AND p.business_id=$1 AND p.organization_id=$2 AND a.business_id IS NULL AND a.organization_id IS NULL`, params);
        await db.query(`UPDATE hr_staff_profession_checklist_progress x SET business_id=$1, organization_id=$2 FROM hr_professions p, hr_profession_checklist_items i
            WHERE x.profession_key=p.key AND x.checklist_item_id=i.id AND i.profession_id=p.id
              AND p.business_id=$1 AND p.organization_id=$2 AND i.business_id=$1 AND i.organization_id=$2
              AND x.business_id IS NULL AND x.organization_id IS NULL`, params);
        await db.query(`UPDATE onboarding_progress x SET business_id=$1, organization_id=$2
            WHERE x.business_id IS NULL AND x.organization_id IS NULL
              AND (x.profession_key IS NULL OR EXISTS (SELECT 1 FROM hr_professions p WHERE p.key=x.profession_key AND p.business_id=$1 AND p.organization_id=$2))
              AND (x.template_id IS NULL OR EXISTS (SELECT 1 FROM onboarding_templates t WHERE t.id=x.template_id AND t.business_id=$1 AND t.organization_id=$2))`, params);
        await db.query('COMMIT');
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    } finally { await db.end(); }
}
module.exports = { prepareParkHrOwnershipFixture };
