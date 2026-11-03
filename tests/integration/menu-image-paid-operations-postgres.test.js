'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { reserveMenuImageOperation: reserve, transitionMenuImageOperation: transition } = require('../../services/menuImagePaidOperations');
const { executeMenuImagePaid } = require('../../services/menuImagePaidExecutor');

test('paid menu operations survive a pool restart and serialize concurrent budget claims', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 30000
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(target.isLocal, true);
    const schema = `menu_paid_test_${randomBytes(8).toString('hex')}`;
    const common = { connectionString: target.url.toString(), ssl: false };
    const admin = new Pool(common);
    let pool;
    let created = false;
    try {
        await admin.query(`CREATE SCHEMA ${schema}`);
        created = true;
        pool = new Pool({ ...common, options: `-c search_path=${schema}`, max: 10 });
        const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/387_menu_image_paid_operations.sql'), 'utf8');
        await pool.query(migration);
        await pool.query(migration);
        const claim = id => reserve(pool, { businessContext: 'fixture', productId: id,
            provider: 'kie', actor: 'fixture', maxOutstanding: 100 });
        const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => claim(`item-${i}`)));
        const accepted = attempts.filter(r => r.status === 'fulfilled').map(r => r.value);
        assert.equal(accepted.length, 2);
        assert.equal(attempts.filter(r => r.status === 'rejected' && r.reason.code === 'MENU_PAID_OPERATION_BUDGET_FULL').length, 6);
        const existing = await pool.query('SELECT product_id FROM menu_image_paid_operations WHERE operation_id=$1', [accepted[0]]);
        await assert.rejects(claim(existing.rows[0].product_id), { code: 'MENU_PAID_OPERATION_REQUIRES_REVIEW' });
        await transition(pool, { id: accepted[0], businessContext: 'fixture', from: 'reserved', to: 'unknown' });
        await pool.end();
        pool = new Pool({ ...common, options: `-c search_path=${schema}`, max: 10 });
        await assert.rejects(claim('new-item'), { code: 'MENU_PAID_OPERATION_BUDGET_FULL' });
        await assert.rejects(transition(pool, { id: accepted[0], businessContext: 'fixture', from: 'unknown', to: 'failed' }),
            { code: 'MENU_PAID_OPERATION_INVALID' });
        await assert.rejects(transition(pool, { id: accepted[1], businessContext: 'other', from: 'reserved', to: 'failed' }),
            { code: 'MENU_PAID_OPERATION_CHANGED' });
        await transition(pool, { id: accepted[1], businessContext: 'fixture', from: 'reserved', to: 'provider_pending', providerTaskId: 'fixture-task' });
        await assert.rejects(transition(pool, { id: accepted[1], businessContext: 'fixture', from: 'provider_pending',
            to: 'succeeded', providerTaskId: 'different-task' }), { code: 'MENU_PAID_OPERATION_CHANGED' });
        await transition(pool, { id: accepted[1], businessContext: 'fixture', from: 'provider_pending', to: 'succeeded' });
        const newId = await claim('new-item');
        assert.equal((await pool.query('SELECT status FROM menu_image_paid_operations WHERE operation_id=$1', [accepted[0]])).rows[0].status, 'unknown');
        await transition(pool, { id: newId, businessContext: 'fixture', from: 'reserved', to: 'failed' });
        let calls = 0;
        const opts = { pool, businessContext: 'fixture', productId: 'execution', actor: 'fixture' };
        const successful = await executeMenuImagePaid({ ...opts, provider: 'openai',
            start: async () => { calls++; return { image: 'fixture' }; },
            saveDraft: async value => { assert.equal(value.image, 'fixture'); } });
        assert.equal(successful.status, 'succeeded');
        const kie = await executeMenuImagePaid({ ...opts, productId: 'kie-execution', provider: 'kie',
            start: async () => { calls++; return { taskId: 'fixture-kie-task' }; } });
        assert.equal(kie.status, 'provider_pending');
        await assert.rejects(claim('while-kie-pending'), { code: 'MENU_PAID_OPERATION_BUDGET_FULL' });
        await transition(pool, { id: kie.operationId, businessContext: 'fixture', from: 'provider_pending', to: 'succeeded' });
        await assert.rejects(executeMenuImagePaid({ ...opts, productId: 'uncertain', provider: 'openai',
            start: async () => { calls++; throw new Error('synthetic timeout'); }, saveDraft: async () => {} }),
            { code: 'MENU_PAID_OUTCOME_REQUIRES_REVIEW', retryable: false });
        await assert.rejects(executeMenuImagePaid({ ...opts, productId: 'uncertain', provider: 'openai',
            start: async () => { calls++; }, saveDraft: async () => {} }),
            { code: 'MENU_PAID_OPERATION_REQUIRES_REVIEW' });
        assert.equal(calls, 3, 'duplicate request must not call a paid provider');
    } finally {
        if (pool) await pool.end();
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    }
});
