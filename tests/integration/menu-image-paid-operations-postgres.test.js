'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { reserveMenuImageOperation: reserve, transitionMenuImageOperation: transition } = require('../../services/menuImagePaidOperations');
const { executeMenuImagePaid, pollMenuImagePaid } = require('../../services/menuImagePaidExecutor');
const { pollMenuImageWithKie } = require('../../services/menuPhotoGeneration');

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
            saveDraft: async value => { assert.equal(value.image, 'fixture'); return true; } });
        assert.equal(successful.status, 'succeeded');
        const kie = await executeMenuImagePaid({ ...opts, productId: 'kie-execution', provider: 'kie',
            start: async () => { calls++; return { taskId: 'fixture-kie-task' }; } });
        assert.equal(kie.status, 'provider_pending');
        await assert.rejects(claim('while-kie-pending'), { code: 'MENU_PAID_OPERATION_BUDGET_FULL' });
        const read = { pool, operationId: kie.operationId, businessContext: 'fixture', productId: 'kie-execution',
            poll: async () => ({ status: 'ready' }), saveDraft: async () => true };
        await assert.rejects(pollMenuImagePaid({ ...read, businessContext: 'other' }), { code: 'MENU_PAID_OPERATION_NOT_FOUND' });
        await assert.rejects(pollMenuImagePaid({ ...read, poll: async () => ({ status: 'failed' }) }), { code: 'MENU_PAID_RESULT_UNCERTAIN' });
        await assert.rejects(pollMenuImagePaid({ ...read, saveDraft: async () => { throw new Error('synthetic storage failure'); } }));
        assert.equal((await pool.query('SELECT status FROM menu_image_paid_operations WHERE operation_id=$1', [kie.operationId])).rows[0].status, 'provider_pending');
        let finishPoll;
        let signalStarted;
        const started = new Promise(resolve => { signalStarted = resolve; });
        const inFlight = pollMenuImagePaid({ ...read, poll: async taskId => {
            assert.equal(taskId, 'fixture-kie-task');
            signalStarted();
            return new Promise(resolve => { finishPoll = resolve; });
        } });
        await started;
        await assert.rejects(pollMenuImagePaid(read), { code: 'MENU_PAID_POLL_BUSY' });
        finishPoll({ status: 'ready' });
        assert.equal((await inFlight).status, 'succeeded');
        assert.equal((await pollMenuImagePaid(read)).providerCalled, false);
        const failedKie = await executeMenuImagePaid({ ...opts, productId: 'kie-failed', provider: 'kie',
            start: async () => ({ taskId: 'fixture-failed-task' }) });
        const failedRead = { ...read, operationId: failedKie.operationId, productId: 'kie-failed', poll: pollMenuImageWithKie };
        const originalFetch = global.fetch;
        const originalKey = process.env.KIE_API_KEY;
        try {
            process.env.KIE_API_KEY = 'synthetic-test-key';
            global.fetch = async () => new Response(JSON.stringify({ code: 200,
                data: { state: 'success', resultJson: 'malformed' } }), { status: 200 });
            await assert.rejects(pollMenuImagePaid(failedRead), { code: 'MENU_PAID_RESULT_UNCERTAIN' });
            global.fetch = async () => new Response(JSON.stringify({ code: 200,
                data: { state: 'fail', failCode: 'INPUT_IMAGE_FAILED' } }), { status: 200 });
            assert.equal((await pollMenuImagePaid(failedRead)).status, 'failed');
            assert.equal((await pollMenuImagePaid(failedRead)).providerCalled, false);
        } finally {
            global.fetch = originalFetch;
            if (originalKey === undefined) delete process.env.KIE_API_KEY;
            else process.env.KIE_API_KEY = originalKey;
        }
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

for (const failure of ['image-storage', 'database-after-provider']) test(`paid provider ${failure} failure cannot cause a second charge`, {
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
        pool = new Pool({ ...common, options: `-c search_path=${schema}`, max: 5 });
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/387_menu_image_paid_operations.sql'), 'utf8'));
        // Reservations still use the real pool; simulate loss of DB access only
        // for status updates after the provider has already returned.
        const failingPool = failure === 'database-after-provider' ? {
            connect: (...args) => pool.connect(...args),
            query: async () => { throw new Error('synthetic database outage'); }
        } : pool;
        let calls = 0;
        const request = { pool: failingPool, businessContext: 'fixture', productId: 'dish', provider: 'openai', actor: 'fixture',
            start: async () => { calls++; return { image: 'fixture' }; },
            saveDraft: async () => { if (failure === 'image-storage') throw new Error('synthetic storage failure'); return true; } };
        await assert.rejects(executeMenuImagePaid(request), { code: 'MENU_PAID_OUTCOME_REQUIRES_REVIEW', retryable: false });
        const record = (await pool.query('SELECT status FROM menu_image_paid_operations WHERE product_id=$1', ['dish'])).rows[0];
        assert.equal(record.status, failure === 'image-storage' ? 'unknown' : 'reserved');
        await assert.rejects(executeMenuImagePaid({ ...request, pool }), { code: 'MENU_PAID_OPERATION_REQUIRES_REVIEW' });
        assert.equal(calls, 1);
    } finally {
        if (pool) await pool.end();
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    }
});

test('process killed after provider start leaves reservation blocking another paid request', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 30000
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(target.isLocal, true);
    const schema = `menu_paid_test_${randomBytes(8).toString('hex')}`;
    const common = { connectionString: target.url.toString(), ssl: false };
    const admin = new Pool(common);
    let pool, worker, created = false;
    try {
        await admin.query(`CREATE SCHEMA ${schema}`); created = true;
        pool = new Pool({ ...common, options: `-c search_path=${schema}` });
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/387_menu_image_paid_operations.sql'), 'utf8'));
        worker = fork(path.join(__dirname, '../fixtures/menu-paid-kill-worker.cjs'), [], {
            env: { ...process.env, MENU_PAID_FIXTURE_SCHEMA: schema }, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Synthetic provider was not started')), 10000);
            worker.once('message', msg => { clearTimeout(timeout); msg?.state === 'provider-started' ? resolve() : reject(new Error('Unexpected worker message')); });
            worker.once('error', err => { clearTimeout(timeout); reject(err); });
            worker.once('exit', () => { clearTimeout(timeout); reject(new Error('Worker exited before provider start')); });
        });
        const exited = new Promise(resolve => worker.once('exit', resolve));
        worker.kill();
        await exited;
        worker = null;
        const record = await pool.query('SELECT status FROM menu_image_paid_operations WHERE product_id=$1', ['interrupted']);
        assert.equal(record.rows[0].status, 'reserved');
        let duplicateCalls = 0;
        await assert.rejects(executeMenuImagePaid({ pool, businessContext: 'fixture', productId: 'interrupted', provider: 'openai',
            actor: 'fixture', start: async () => { duplicateCalls++; }, saveDraft: async () => true }),
        { code: 'MENU_PAID_OPERATION_REQUIRES_REVIEW' });
        assert.equal(duplicateCalls, 0);
    } finally {
        if (worker && worker.exitCode === null) worker.kill();
        if (pool) await pool.end();
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    }
});
