'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { requireParkProfessionReads } = require('../../services/parkHrProfessionRead');
const { applyMembershipAccess, loadMembershipAccess } = require('../../services/businessMembership');
const { createProfessionChecklistItem, toggleStaffProfessionChecklistProgress } = require('../../services/professionChecklists');
const { freezeInventory, preparePlan, applyDisposablePlan, rollbackDisposablePlan } = require('../../scripts/prepare-park-hr-ownership-backfill.cjs');
const enabled = process.env.REQUIRE_ISOLATED_TEST_TARGET === 'true' && process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER === 'true';
let pool;
const suffix = () => crypto.randomBytes(7).toString('hex');
async function transaction(work) {
    const db = await pool.connect();
    try { await db.query('BEGIN'); return await work(db); }
    finally { await db.query('ROLLBACK'); db.release(); }
}
async function sqlRejects(db, sql, params, codes = ['23503', '23514', '44000']) {
    await db.query('SAVEPOINT owner_negative');
    try { await assert.rejects(db.query(sql, params), error => codes.includes(error.code)); }
    finally { await db.query('ROLLBACK TO SAVEPOINT owner_negative'); await db.query('RELEASE SAVEPOINT owner_negative'); }
}
async function fixtures(db) {
    const tag = suffix();
    const park = (await db.query("SELECT id, organization_id FROM businesses WHERE context_key='event_genix'")).rows[0];
    assert.ok(park, 'disposable runner explicitly prepares Park ownership');
    await db.query("UPDATE businesses SET access_mode='membership' WHERE id=$1", [park.id]);
    const dar = (await db.query("INSERT INTO businesses (organization_id,context_key,label,short_label,access_mode) VALUES ($1,'dar','Synthetic Dar','Dar','membership') ON CONFLICT(context_key) DO UPDATE SET status='active' RETURNING id,organization_id", [park.organization_id])).rows[0];
    assert.equal(Number(dar.organization_id), Number(park.organization_id));
    const foreignOrg = (await db.query('INSERT INTO organizations (slug,name) VALUES ($1,$1) RETURNING id', ['qa-owner-' + tag])).rows[0];
    const foreignBusiness = (await db.query("INSERT INTO businesses (organization_id,context_key,label,short_label) VALUES ($1,$2,'Synthetic foreign','Foreign') RETURNING id,organization_id", [foreignOrg.id, 'qa_owner_' + tag])).rows[0];
    const staff = (await db.query("INSERT INTO staff(name,department,position,role_type,is_active) VALUES ('Synthetic owned worker','QA','Synthetic','animator',true),('FOREIGN_OWNER_MARKER','QA','Synthetic','animator',true) RETURNING id")).rows;
    const professions = [];
    for (const [index, owner] of [park, dar, foreignBusiness].entries()) {
        professions.push((await db.query('INSERT INTO hr_professions(key,title,department,business_id,organization_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            ['qa_owner_' + tag + '_' + index, index ? 'FOREIGN_OWNER_MARKER' : 'Synthetic owned profession', 'QA', owner.id, owner.organization_id])).rows[0]);
    }
    const unowned = (await db.query("INSERT INTO hr_professions(key,title) VALUES ($1,'UNOWNED_MARKER') RETURNING id,key", ['qa_unowned_' + tag])).rows[0];
    const items = [];
    for (const [index, owner] of [park, dar].entries()) {
        items.push((await db.query('INSERT INTO hr_profession_checklist_items(profession_id,item_key,title,business_id,organization_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [professions[index].id, 'intro_' + tag, index ? 'FOREIGN_OWNER_MARKER' : 'Synthetic checklist', owner.id, owner.organization_id])).rows[0]);
        await db.query('INSERT INTO staff_role_assignments(staff_id,profession_key,is_primary,admission_status,hourly_rate,notes,business_id,organization_id) VALUES ($1,$2,true,$3,8642,$4,$5,$6)',
            [staff[index].id, professions[index].key, 'approved', 'PRIVATE_OWNER_MARKER', owner.id, owner.organization_id]);
    }
    const template = (await db.query('INSERT INTO onboarding_templates(name,items,business_id,organization_id) VALUES ($1,$2,$3,$4) RETURNING id',
        ['Synthetic owned template', JSON.stringify([{ key: 'intro', title: 'Introduction', notes: 'PRIVATE_OWNER_MARKER' }]), park.id, park.organization_id])).rows[0];
    await db.query('INSERT INTO onboarding_progress(staff_id,template_id,profession_key,items,total_items,business_id,organization_id) VALUES ($1,$2,$3,$4,1,$5,$6)',
        [staff[0].id, template.id, professions[0].key, JSON.stringify([{ key: 'intro', title: 'Introduction', notes: 'PRIVATE_OWNER_MARKER' }]), park.id, park.organization_id]);
    const user = (await db.query("INSERT INTO users(username,password_hash,name,role,is_active,business_contexts,default_business_context) VALUES ($1,'unused-disposable-hash','Synthetic owner reader','waiter',true,ARRAY['event_genix','dar'],'event_genix') RETURNING *", ['qa_owner_' + tag])).rows[0];
    await db.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES ($1,$2,'member')", [park.organization_id, user.id]);
    for (const owner of [park, dar]) await db.query("INSERT INTO business_memberships(business_id,organization_id,user_id,role,action_allowlist,is_default) VALUES ($1,$2,$3,'waiter',ARRAY['hr.staff.view'],$4)",
        [owner.id, owner.organization_id, user.id, Number(owner.id) === Number(park.id)]);
    return { tag, park, dar, foreignOrg, foreignBusiness, staff, professions, unowned, items, template, user };
}
function noPrivateFields(value) {
    return !value || typeof value !== 'object' || Object.entries(value).every(([key, child]) =>
        !/^(hourly_rate|rate_unit|estimated_salary|profession_rate_summary|payroll_scheme_id|notes|username|medical|completed_by)$/i.test(key) && noPrivateFields(child));
}
async function withExpress(db, fixture, work) {
    let failReads = false;
    const calls = [];
    const reader = { query(sql, params) { calls.push(String(sql)); if (failReads) throw Error('Synthetic owner read failure'); return db.query(sql, params); } };
    const app = express();
    app.use('/api/hr', (req, res, next) => {
        const context = req.headers['x-business-context'] || 'event_genix';
        loadMembershipAccess(db, fixture.user, context).then(access => { req.user = applyMembershipAccess(fixture.user, access); next(); }).catch(next);
    }, requireParkProfessionReads(reader), (_req, res) => res.sendStatus(404));
    app.use((_error, _req, res, _next) => res.sendStatus(500));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    try {
        const request = async (route, context = 'event_genix', scope = 'single') => {
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/hr' + route,
                { headers: { 'X-Business-Context': context, 'X-Business-Scope': scope, 'X-Business-Contexts': 'event_genix,dar' } });
            const text = await response.text();
            return { status: response.status, body: text.startsWith('{') ? JSON.parse(text) : null, text };
        };
        await work({ request, calls, fault: value => { failReads = value; } });
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

describe('Park HR ownership on disposable PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    before(() => {
        const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
        assert.equal(target.isLocal, true);
        pool = new Pool({ connectionString: target.url.toString(), ssl: false, max: 3 });
    });
    after(async () => { if (pool) await pool.end(); });

    it('replays the additive migration without assigning legacy records or changing keys', async () => transaction(async db => {
        const before = (await db.query('SELECT count(*)::int n FROM hr_professions')).rows[0].n;
        const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/387_hr_park_tenant_ownership_foundation.sql'), 'utf8').replace(/^\uFEFF/, '');
        await db.query(migration); await db.query(migration);
        assert.equal((await db.query('SELECT count(*)::int n FROM hr_professions')).rows[0].n, before);
        assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('hr_professions','hr_profession_checklist_items','hr_staff_profession_checklist_progress','staff_role_assignments','onboarding_templates','onboarding_progress') AND column_name IN ('business_id','organization_id') AND is_nullable='YES'")).rows[0].n, 12);
    }));

    it('rejects wrong organization, foreign parents, half ownership and retained cross-tenant duplicate keys', async () => transaction(async db => {
        const f = await fixtures(db);
        await sqlRejects(db, 'INSERT INTO hr_professions(key,title,business_id,organization_id) VALUES ($1,$1,$2,$3)', ['bad_' + f.tag, f.park.id, f.foreignOrg.id]);
        await sqlRejects(db, 'INSERT INTO hr_professions(key,title,business_id) VALUES ($1,$1,$2)', ['half_' + f.tag, f.park.id]);
        await sqlRejects(db, 'INSERT INTO hr_profession_checklist_items(profession_id,item_key,title,business_id,organization_id) VALUES ($1,$2::text,$2::text,$3,$4)', [f.professions[1].id, 'bad_' + f.tag, f.park.id, f.park.organization_id]);
        await sqlRejects(db, 'INSERT INTO hr_staff_profession_checklist_progress(staff_id,profession_key,checklist_key,checklist_item_id,title,business_id,organization_id) VALUES ($1,$2,$3::text,$4,$3::text,$5,$6)', [f.staff[0].id, f.professions[0].key, 'bad_' + f.tag, f.items[1].id, f.park.id, f.park.organization_id]);
        await sqlRejects(db, 'INSERT INTO hr_professions(key,title,business_id,organization_id) VALUES ($1,$1,$2,$3)', [f.professions[0].key, f.dar.id, f.dar.organization_id], ['23505']);
        await sqlRejects(db, 'INSERT INTO hr_staff_profession_checklist_progress(staff_id,profession_key,checklist_key,title,business_id,organization_id) VALUES ($1,$2,$3::text,$3::text,$4,$5)', [f.staff[0].id, f.professions[1].key, 'bad_legacy_' + f.tag, f.park.id, f.park.organization_id]);
        await db.query('INSERT INTO hr_staff_profession_checklist_progress(staff_id,profession_key,checklist_key,title,business_id,organization_id) VALUES ($1,$2,$3::text,$3::text,$4,$5)', [f.staff[0].id, f.professions[0].key, 'owned_legacy_' + f.tag, f.park.id, f.park.organization_id]);
        assert.equal((await db.query('UPDATE hr_owned.hr_professions SET title=$1 WHERE id=$2', ['wrong', f.professions[1].id])).rowCount, 0);
        assert.equal((await db.query('DELETE FROM hr_owned.hr_professions WHERE id=$1', [f.professions[1].id])).rowCount, 0);
        await assert.rejects(createProfessionChecklistItem(db, { id: f.professions[1].id }, { title: 'Wrong parent' }), error => error.statusCode === 404);
    }));

    it('uses real Express, registry/membership SQL and all six reads without foreign or private fields', async () => transaction(async db => {
        const f = await fixtures(db);
        const key = f.professions[0].key, id = f.staff[0].id;
        const routes = ['/checklists/dashboard', '/professions/' + key + '/checklist', '/professions/' + key + '/staff/' + id + '/checklist', '/professions/workspace/' + key,
            '/staff/' + id + '/onboarding-assignment', '/staff/' + id + '/onboarding-processes'];
        await withExpress(db, f, async ({ request, calls, fault }) => {
            for (const route of routes) {
                const result = await request(route);
                assert.equal(result.status, 200, result.text);
                assert.ok(noPrivateFields(result.body));
                assert.doesNotMatch(result.text, /FOREIGN_OWNER_MARKER|UNOWNED_MARKER|PRIVATE_OWNER_MARKER/);
                for (const context of ['dar']) assert.equal((await request(route, context)).status, 403);
                for (const scope of ['multi', 'all']) assert.equal((await request(route, 'event_genix', scope)).status, 403);
            }
            for (const mutation of [
                ['UPDATE business_memberships SET action_allowlist=ARRAY[]::text[],action_denylist=ARRAY[\'hr.staff.view\'] WHERE user_id=$1 AND business_id=$2', [f.user.id, f.park.id]],
                ['UPDATE business_memberships SET is_active=false WHERE user_id=$1 AND business_id=$2', [f.user.id, f.park.id]],
                ['UPDATE organization_memberships SET is_active=false WHERE user_id=$1 AND organization_id=$2', [f.user.id, f.park.organization_id]],
                ["UPDATE businesses SET status='inactive' WHERE id=$1", [f.park.id]],
                ["UPDATE organizations SET status='inactive' WHERE id=$1", [f.park.organization_id]],
                ['UPDATE organization_memberships SET organization_id=$1 WHERE user_id=$2 AND organization_id=$3', [f.foreignOrg.id, f.user.id, f.park.organization_id]]
            ]) {
                await db.query('SAVEPOINT access_negative');
                try { await db.query(...mutation); for (const route of routes) { const result = await request(route); assert.equal(result.status, 403, result.text); assert.equal(result.body.success, false); } }
                finally { await db.query('ROLLBACK TO SAVEPOINT access_negative'); await db.query('RELEASE SAVEPOINT access_negative'); }
            }
            assert.equal((await request('/professions/' + f.professions[1].key + '/checklist')).status, 404);
            assert.equal((await request('/professions/' + f.unowned.key + '/checklist')).status, 404);
            for (const kind of ['onboarding-assignment', 'onboarding-processes']) assert.equal((await request('/staff/' + f.staff[1].id + '/' + kind)).status, 404);
            assert.equal((await request('/professions/' + key + '/staff/2147483647/checklist')).status, 404);
            fault(true); for (const route of routes) assert.equal((await request(route)).status, 500); fault(false);
            assert.ok(calls.every(sql => /^\s*(SELECT|WITH)\b/.test(sql)), 'bounded reads never issue writes');
        });
    }));

    it('does not adopt an unowned conflicting progress row', async () => transaction(async db => {
        const f = await fixtures(db);
        await db.query('INSERT INTO hr_staff_profession_checklist_progress(staff_id,profession_key,checklist_key,checklist_item_id,title) VALUES ($1,$2,$3::text,$4,$3::text)',
            [f.staff[0].id, f.professions[0].key, f.items[0].item_key, f.items[0].id]);
        await assert.rejects(toggleStaffProfessionChecklistProgress(db, { staffId: f.staff[0].id, professionKey: f.professions[0].key, itemKey: f.items[0].item_key, completed: true }), error => error.code === 'HR_OWNERSHIP_CONFLICT');
        const row = (await db.query('SELECT business_id,completed_at FROM hr_staff_profession_checklist_progress WHERE staff_id=$1 AND checklist_item_id=$2', [f.staff[0].id, f.items[0].id])).rows[0];
        assert.equal(row.business_id, null); assert.equal(row.completed_at, null);
    }));

    it('backfills only frozen disposable inventory, rolls back interrupted work and retries idempotently', async () => {
        const key = 'qa_backfill_' + suffix();
        const row = (await pool.query('INSERT INTO hr_professions(key,title) VALUES ($1,$1) RETURNING id', [key])).rows[0];
        try {
            const owner = (await pool.query("SELECT id,organization_id FROM businesses WHERE context_key='event_genix'")).rows[0];
            const inventory = await freezeInventory(pool);
            const plan = preparePlan(inventory, { businessId: owner.id, organizationId: owner.organization_id });
            await assert.rejects(applyDisposablePlan(pool, plan, process.env, { failAfterTable: 'hr_profession_checklist_items' }), /DISPOSABLE_INJECTED_BACKFILL_FAILURE/);
            assert.equal((await pool.query('SELECT business_id FROM hr_professions WHERE id=$1', [row.id])).rows[0].business_id, null);
            const receipt = await applyDisposablePlan(pool, plan, process.env);
            assert.equal(Number((await pool.query('SELECT business_id FROM hr_professions WHERE id=$1', [row.id])).rows[0].business_id), Number(owner.id));
            const again = await applyDisposablePlan(pool, plan, process.env);
            assert.ok(Object.values(again.changedIds).every(ids => ids.length === 0));
            await rollbackDisposablePlan(pool, receipt, process.env);
            assert.equal((await pool.query('SELECT business_id FROM hr_professions WHERE id=$1', [row.id])).rows[0].business_id, null);
            const drift = (await pool.query('INSERT INTO hr_professions(key,title) VALUES ($1,$1) RETURNING id', [key + '_drift'])).rows[0];
            try { await assert.rejects(applyDisposablePlan(pool, plan, process.env), /HR_OWNER_INVENTORY_DRIFT/); }
            finally { await pool.query('DELETE FROM hr_professions WHERE id=$1', [drift.id]); }
        } finally { await pool.query('DELETE FROM hr_professions WHERE id=$1', [row.id]); }
    });
});
