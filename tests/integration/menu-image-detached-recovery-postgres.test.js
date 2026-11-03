'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { reserveMenuImageOperation, transitionMenuImageOperation } = require('../../services/menuImagePaidOperations');
const { saveRecoveryRequest, recoverDetachedMenuImage } = require('../../services/menuImageDetachedRecovery');
const { pollMenuImagePaid } = require('../../services/menuImagePaidExecutor');
const { storeCatalogImageBlob } = require('../../services/imageStorage');

test('detached KIE result remains reviewable without modifying manual draft or resubmission', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 30000
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(target.isLocal, true);
    const schema = `menu_recovery_${randomBytes(8).toString('hex')}`;
    const common = { connectionString: target.url.toString(), ssl: false };
    const admin = new Pool(common); let pool, created = false;
    try {
        await admin.query(`CREATE SCHEMA ${schema}`); created = true;
        pool = new Pool({ ...common, options: `-c search_path=${schema}`, max: 6 });
        for (const migration of ['387_menu_image_paid_operations.sql', '388_menu_image_recovery_results.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', migration), 'utf8'));
        }
        await pool.query('CREATE TABLE products (id text PRIMARY KEY, ai_card_draft jsonb)');
        await pool.query(`CREATE TABLE catalog_image_blobs (filename text PRIMARY KEY, content_type text, data bytea,
            size_bytes integer, source_url text, metadata jsonb, updated_at timestamptz DEFAULT now())`);
        const manual = { imageStudio: { status: 'ready', imageUrl: '/manual.png' } };
        await pool.query('INSERT INTO products VALUES ($1,$2::jsonb)', ['dish', JSON.stringify(manual)]);
        const base = { businessContext: 'fixture', productId: 'dish' };
        const id = await reserveMenuImageOperation(pool, { ...base, provider: 'kie', actor: 'fixture' });
        await saveRecoveryRequest(pool, { ...base, operationId: id, studio: { model: 'fake', size: '1024x1024' } });
        await assert.rejects(saveRecoveryRequest(pool, { ...base, operationId: id, studio: {} }), { code: 'MENU_RECOVERY_CHANGED' });
        await transitionMenuImageOperation(pool, { id, businessContext: base.businessContext,
            from: 'reserved', to: 'provider_pending', providerTaskId: 'fake-task' });
        let polls = 0, stores = 0;
        const options = { pool, ...base, operationId: id, poll: async task => {
            assert.equal(task, 'fake-task'); polls++; return { status: 'ready', sourceUrl: 'https://fake.invalid/image' };
        }, store: async (_outcome, request) => {
            stores++; assert.equal(request.model, 'fake'); return { status: 'ready', imageUrl: '/generated.png' };
        } };
        await assert.rejects(recoverDetachedMenuImage({ ...options, businessContext: 'other' }), { code: 'MENU_RECOVERY_NOT_FOUND' });
        assert.equal(polls, 0);
        await assert.rejects(recoverDetachedMenuImage({ ...options, poll: async () => { throw new Error('timeout'); } }));
        assert.equal((await pool.query('SELECT status FROM menu_image_paid_operations WHERE operation_id=$1', [id])).rows[0].status, 'provider_pending');
        const pending = await recoverDetachedMenuImage({ ...options, poll: async () => ({ status: 'generating' }) });
        assert.equal(pending.status, 'provider_pending');
        let started, release;
        const entered = new Promise(resolve => { started = resolve; });
        const held = recoverDetachedMenuImage({ ...options, poll: async () => {
            started(); return new Promise(resolve => { release = resolve; });
        } });
        await entered;
        await assert.rejects(recoverDetachedMenuImage(options), { code: 'MENU_PAID_POLL_BUSY' });
        release({ status: 'generating' });
        assert.equal((await held).status, 'provider_pending');
        await assert.rejects(recoverDetachedMenuImage({ ...options, store: async () => { throw new Error('storage failure'); } }));
        assert.equal((await pool.query('SELECT status FROM menu_image_paid_operations WHERE operation_id=$1', [id])).rows[0].status, 'provider_pending');
        await pool.query(`CREATE FUNCTION fail_synthetic_recovery_transition() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.status='succeeded' THEN RAISE EXCEPTION 'synthetic transition failure'; END IF; RETURN NEW; END $$`);
        await pool.query(`CREATE TRIGGER fail_synthetic_recovery_transition BEFORE UPDATE ON menu_image_paid_operations
            FOR EACH ROW EXECUTE FUNCTION fail_synthetic_recovery_transition()`);
        await assert.rejects(recoverDetachedMenuImage(options), /synthetic transition failure/);
        const rolledBack = await pool.query(`SELECT o.status, r.result_studio FROM menu_image_paid_operations o
            JOIN menu_image_paid_recovery r USING (operation_id) WHERE o.operation_id=$1`, [id]);
        assert.equal(rolledBack.rows[0].status, 'provider_pending');
        assert.equal(rolledBack.rows[0].result_studio, null);
        await pool.query('DROP TRIGGER fail_synthetic_recovery_transition ON menu_image_paid_operations');
        const result = await recoverDetachedMenuImage(options);
        assert.equal(result.studio.imageUrl, '/generated.png');
        assert.deepEqual((await pool.query('SELECT ai_card_draft FROM products WHERE id=$1', ['dish'])).rows[0].ai_card_draft, manual);
        await pool.end();
        pool = new Pool({ ...common, options: `-c search_path=${schema}`, max: 6 });
        const replay = await recoverDetachedMenuImage({ ...options, pool });
        assert.equal(replay.providerCalled, false);
        assert.equal(replay.studio.imageUrl, '/generated.png');
        assert.equal(polls, 3); assert.equal(stores, 2);
        assert.equal((await pool.query('SELECT status FROM menu_image_paid_operations WHERE operation_id=$1', [id])).rows[0].status, 'succeeded');
        await pool.end();
        pool = new Pool({ ...common, options: `-c search_path=${schema}`, max: 1, connectionTimeoutMillis: 1000 });
        const single = { businessContext: 'fixture', productId: 'single-connection' };
        const singleId = await reserveMenuImageOperation(pool, { ...single, provider: 'kie', actor: 'fixture' });
        await saveRecoveryRequest(pool, { ...single, operationId: singleId, studio: { model: 'fake' } });
        await transitionMenuImageOperation(pool, { id: singleId, businessContext: single.businessContext,
            from: 'reserved', to: 'provider_pending', providerTaskId: 'single-task' });
        const singleResult = await recoverDetachedMenuImage({ pool, ...single, operationId: singleId,
            poll: async () => ({ status: 'ready' }), store: async (_outcome, _request, client) => {
                const stored = await storeCatalogImageBlob(client, { filename: 'single.png', contentType: 'image/png', data: Buffer.from([1, 2, 3]) });
                return { status: 'ready', imageUrl: stored.publicUrl };
            } });
        assert.equal(singleResult.studio.imageUrl, '/uploads/catalog-images/items/single.png');
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM catalog_image_blobs')).rows[0].count, 1);
        const current = { businessContext: 'fixture', productId: 'current-connection' };
        const currentId = await reserveMenuImageOperation(pool, { ...current, provider: 'kie', actor: 'fixture' });
        await transitionMenuImageOperation(pool, { id: currentId, businessContext: current.businessContext,
            from: 'reserved', to: 'provider_pending', providerTaskId: 'current-task' });
        const currentResult = await pollMenuImagePaid({ pool, ...current, operationId: currentId,
            poll: async () => ({ status: 'ready' }), saveDraft: async (_outcome, _id, client) => {
                assert.equal((await client.query('SELECT 1 AS value')).rows[0].value, 1); return true;
            } });
        assert.equal(currentResult.status, 'succeeded');
    } finally {
        if (pool) await pool.end();
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    }
});
