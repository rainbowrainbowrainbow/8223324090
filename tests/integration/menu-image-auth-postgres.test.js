'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const express = require('express');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

test('real JWT middleware and fresh role protect menu reconciliation', {
    skip: process.env.RUN_MENU_AUTH_POSTGRES !== 'true', timeout: 30000
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(target.isLocal, true);
    if (process.env.JWT_SECRET !== 'synthetic-menu-auth-only') throw Error('Synthetic JWT secret required');
    const schema = `menu_auth_test_${randomBytes(8).toString('hex')}`;
    const common = { connectionString: target.url.toString(), ssl: false };
    const admin = new Pool(common);
    const db = require('../../db');
    const originalQuery = db.pool.query, originalConnect = db.pool.connect;
    const originalFlag = process.env.CRM_MENU_RECONCILIATION_ENABLED;
    const originalRecoveryFlag = process.env.CRM_MENU_RECOVERY_ENABLED;
    let pool, server, created = false;
    const userIds = [];
    try {
        await admin.query(`CREATE SCHEMA ${schema}`); created = true;
        pool = new Pool({ ...common, options: `-c search_path=${schema},public`, max: 10 });
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/387_menu_image_paid_operations.sql'), 'utf8'));
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/388_menu_image_recovery_results.sql'), 'utf8'));
        await pool.query(`CREATE TABLE products (id text PRIMARY KEY, business_context text, domain text, kitchen_type text,
            name text, icon_url text, is_active boolean, ai_card_draft jsonb, updated_at timestamptz, updated_by text)`);
        const id = randomUUID();
        await pool.query('INSERT INTO products VALUES ($1,$2,$3,$4,$5,$6,true,$7,now(),$8)',
            ['fixture', 'event_genix', 'kitchen', 'menu', 'Synthetic dish', '/current.png',
                JSON.stringify({ imageStudio: { status: 'generating', operationId: id } }), 'fixture']);
        await pool.query(`INSERT INTO menu_image_paid_operations (operation_id,business_context,product_id,provider,status,created_by,created_at)
            VALUES ($1,'event_genix','fixture','openai','unknown','fixture',now()-interval '11 minutes')`, [id]);
        const suffix = randomBytes(6).toString('hex');
        for (const role of ['creator', 'manager', 'animator']) {
            const row = await admin.query(`INSERT INTO public.users (username,password_hash,role,name)
                VALUES ($1,'synthetic-no-login',$2,'Synthetic menu auth test') RETURNING id,username,role`, [`menu_auth_${role}_${suffix}`, role]);
            userIds.push(row.rows[0]);
        }
        db.pool.connect = (...args) => pool.connect(...args);
        db.pool.query = async (sql, params) => {
            if (sql.includes('WHERE p.id = $1')) return pool.query('SELECT * FROM products WHERE id=$1 AND business_context=$2', params.slice(0, 2));
            return pool.query(sql, params);
        };
        process.env.CRM_MENU_RECONCILIATION_ENABLED = 'true';
        process.env.CRM_MENU_RECOVERY_ENABLED = 'true';
        const router = require('../../routes/products');
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use('/api/products', router);
        server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
        const url = `http://127.0.0.1:${server.address().port}/api/products/fixture/menu-image/operation/reconcile`;
        const body = { businessContext: 'event_genix', operationId: id, reviewNote: 'Checked provider account and reviewed the uncertain charge',
            providerReviewed: true, acceptsPossibleCharge: true };
        const post = async (token, payload = body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
        assert.equal((await post(null)).status, 401);
        const manager = userIds.find(x => x.role === 'manager');
        const forged = jwt.sign({ id: manager.id, username: manager.username, role: 'creator' }, process.env.JWT_SECRET);
        assert.equal((await post(forged)).status, 403);
        await admin.query("UPDATE public.users SET extra_roles=ARRAY['creator']::text[] WHERE id=$1", [manager.id]);
        assert.equal((await post(forged)).status, 403);
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM menu_image_paid_operation_reviews')).rows[0].count, 0);
        const creator = userIds.find(x => x.role === 'creator');
        const token = jwt.sign({ id: creator.id, username: creator.username, role: 'creator' }, process.env.JWT_SECRET);
        assert.notEqual((await post(token, { ...body, businessContext: 'dar' })).status, 200);
        await admin.query('UPDATE public.users SET is_active=false WHERE id=$1', [creator.id]);
        assert.equal((await post(token)).status, 401);
        await admin.query('UPDATE public.users SET is_active=true WHERE id=$1', [creator.id]);
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM menu_image_paid_operation_reviews')).rows[0].count, 0);
        const accepted = await post(token);
        assert.equal(accepted.status, 200);
        assert.equal((await accepted.json()).operation.status, 'reviewed_unknown');
        const audit = (await pool.query('SELECT reviewed_by FROM menu_image_paid_operation_reviews WHERE operation_id=$1', [id])).rows[0];
        assert.equal(audit.reviewed_by, creator.username);
        assert.equal((await post(token)).status, 409);
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM menu_image_paid_operation_reviews')).rows[0].count, 1);
        const recoveredId = randomUUID();
        await pool.query(`INSERT INTO menu_image_paid_operations (operation_id,business_context,product_id,provider,status,created_by)
            VALUES ($1,'event_genix','fixture','kie','succeeded','fixture')`, [recoveredId]);
        await pool.query(`INSERT INTO menu_image_paid_recovery (operation_id,request_studio,result_studio)
            VALUES ($1,'{}'::jsonb,$2::jsonb)`, [recoveredId, JSON.stringify({ status: 'ready', imageUrl: '/generated.png' })]);
        const recoveredUrl = `http://127.0.0.1:${server.address().port}/api/products/fixture/menu-image/recovered?businessContext=event_genix`;
        const get = tokenValue => fetch(recoveredUrl, { headers: tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {} });
        assert.equal((await get(null)).status, 401);
        const animator = userIds.find(x => x.role === 'animator');
        const animatorToken = jwt.sign({ id: animator.id, username: animator.username }, process.env.JWT_SECRET);
        assert.equal((await get(animatorToken)).status, 403);
        const managerToken = jwt.sign({ id: manager.id, username: manager.username }, process.env.JWT_SECRET);
        const recovered = await get(managerToken); assert.equal(recovered.status, 200);
        const recoveredBody = await recovered.json(); assert.equal(recoveredBody.results[0].operationId, recoveredId);
        const useUrl = `http://127.0.0.1:${server.address().port}/api/products/fixture/menu-image/operation/${recoveredId}/use-recovered`;
        const use = tokenValue => fetch(useUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '127.0.0.2',
            ...(tokenValue ? { Authorization: `Bearer ${tokenValue}` } : {}) }, body: JSON.stringify({
                businessContext: 'event_genix', confirmed: true, draftRevision: recoveredBody.draftRevision }) });
        assert.equal((await use(null)).status, 401);
        assert.equal((await use(animatorToken)).status, 403);
        assert.equal((await use(managerToken)).status, 200);
        const finalProduct = (await pool.query("SELECT icon_url, ai_card_draft FROM products WHERE id='fixture'")).rows[0];
        assert.equal(finalProduct.icon_url, '/current.png');
        assert.equal(finalProduct.ai_card_draft.imageStudio.imageUrl, '/generated.png');
    } finally {
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        db.pool.query = originalQuery; db.pool.connect = originalConnect;
        if (originalFlag === undefined) delete process.env.CRM_MENU_RECONCILIATION_ENABLED; else process.env.CRM_MENU_RECONCILIATION_ENABLED = originalFlag;
        if (originalRecoveryFlag === undefined) delete process.env.CRM_MENU_RECOVERY_ENABLED; else process.env.CRM_MENU_RECOVERY_ENABLED = originalRecoveryFlag;
        if (pool) await pool.end();
        if (userIds.length) await admin.query('DELETE FROM public.users WHERE id=ANY($1::int[])', [userIds.map(x => x.id)]);
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end(); await db.pool.end();
    }
});
