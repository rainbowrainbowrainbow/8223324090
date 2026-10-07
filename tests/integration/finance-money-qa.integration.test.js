'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const qa = require('../../services/financeMoneyQa');
const { createFinanceMoneyService } = require('../../services/financeMoneyMovements');
const { registerQaEntity } = require('../../services/trustedQaRuns');
const { BASE_URL, getToken } = require('../helpers');

test('finance trusted QA uses durable ownership and exact isolated PostgreSQL writer fences', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 180000
}, async t => {
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
    assert.equal(database.isLocal, true);
    const pool = new Pool({ connectionString: database.url.toString(), ssl: false, max: 6 });
    const service = createFinanceMoneyService(pool);
    const actor = (await pool.query('SELECT id, username FROM users WHERE username=$1', [process.env.TEST_USER])).rows[0];
    assert.ok(actor, 'isolated runner created the QA operator');
    const authToken = await getToken();
    const productId = `qa-program-${randomUUID().slice(0, 12)}`;
    const roomId = `qa-room-${randomUUID().slice(0, 12)}`;
    const lineId = `qa-line-${randomUUID().slice(0, 12)}`;
    const fixture = { requestId: randomUUID(), programId: productId, lineId, roomResourceId: roomId,
        room: 'Finance QA Fixture Room', date: '2099-06-15', time: '13:00', duration: 60, status: 'confirmed',
        programCode: 'FIN-QA', programName: 'Finance QA Program', label: 'Finance QA', category: 'animation', hosts: 1, pinataMode: 'none' };
    await pool.query(`INSERT INTO products(id,code,label,name,category,duration,price,hosts,domain,business_context,is_active)
        VALUES($1,'FIN-QA','Finance QA','Finance QA Program','animation',60,100,1,'program','event_genix',true)`, [productId]);
    await pool.query(`INSERT INTO lines_by_date(business_context,date,line_id,name,color,from_sheet)
        VALUES('event_genix',$1,$2,'Finance QA Line','#6366f1',false)`, [fixture.date, lineId]);
    await pool.query(`INSERT INTO timeline_resources(business_context,resource_id,type,name,is_active)
        VALUES('event_genix',$1,'room',$2,true)`, [roomId, fixture.room]);
    const plan = { runId: `finance-${randomUUID()}`, testAccountId: actor.id, businessContext: 'event_genix', ttlMinutes: 15,
        bookingFixtures: [fixture] };
    const token = randomUUID();
    let scope;
    let first;
    let second;
    let income;
    let canonicalBookingId;
    async function transaction(callback) {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }
    async function access(client) {
        return qa.resolveFinanceQaAccess(client, { actor, businessContext: 'event_genix', token,
            endpoint: 'POST /api/finance/manual-money/commands', forUpdate: true });
    }
    async function command(commandName, fields = {}) {
        return service.execute({ businessContext: 'event_genix', actor, qaToken: token },
            { command: commandName, idempotencyKey: randomUUID(), ...fields });
    }
    try {
        await t.test('run creation is bound to a reviewed plan and existing actor capabilities', async () => {
            const result = await transaction(async client => {
                const readiness = await qa.preflightFinanceQaPlan(client, plan);
                assert.equal(readiness.readiness.schemaInstalled, true);
                return qa.createFinanceQaRun(client, plan, { approvedHash: readiness.planHash, token });
            });
            assert.equal(result.run.run_id, plan.runId);
            await assert.rejects(transaction(client => qa.createFinanceQaRun(client, { ...plan, runId: `${plan.runId}-2` },
                { approvedHash: qa.hashFinanceQaPlan(plan), token: randomUUID() })), { code: 'FINANCE_QA_RUN_ALREADY_OPEN' });
        });
        await t.test('scope creates only three bounded accounts and two categories', async () => {
            await transaction(async client => {
                scope = await access(client);
                first = await qa.createFinanceQaAccount(client, scope, { name: 'Cash A', type: 'cash' });
                second = await qa.createFinanceQaAccount(client, scope, { name: 'Cash B', type: 'cash' });
                await qa.createFinanceQaAccount(client, scope, { name: 'Bank', type: 'bank' });
                income = await qa.createFinanceQaCategory(client, scope, { name: 'Income', type: 'income' });
                await qa.createFinanceQaCategory(client, scope, { name: 'Expense', type: 'expense' });
            });
            await assert.rejects(transaction(async client => qa.createFinanceQaAccount(client, await access(client),
                { name: 'Fourth', type: 'cash' })), { code: 'FINANCE_QA_FIXTURE_LIMIT' });
            assert.equal(first.finance_qa_run_id, scope.runId);
        });
        await t.test('ordinary edits, deletions and legacy writers cannot use QA account ID or immutable name', async () => {
            for (const [sql, args] of [
                ['UPDATE finance_accounts SET is_active=false WHERE id=$1', [first.id]],
                ['UPDATE finance_accounts SET finance_qa_run_id=NULL WHERE id=$1', [first.id]],
                ['DELETE FROM finance_accounts WHERE id=$1', [first.id]],
                ["INSERT INTO finance_accounts(name,type,business_context) VALUES($1,'cash','event_genix')", [first.name]],
                ["INSERT INTO personal_account_transactions(account_id,type,amount) VALUES($1,'income',1)", [first.id]],
                ["INSERT INTO report_bot_submissions(account_name,amount) VALUES($1,1)", [first.name]],
                ["INSERT INTO finance_transactions(type,amount,date,account_id,business_context) VALUES('income',1,'2099-06-15',$1,'event_genix')", [first.id]]
            ]) await assert.rejects(transaction(client => client.query(sql, args)), { code: '23514' });
        });
        await t.test('per-command context rejects a different actor and mixed real/QA references', async () => {
            await assert.rejects(transaction(client => qa.resolveFinanceQaAccess(client, { actor: { id: actor.id + 1 },
                businessContext: 'event_genix', token, endpoint: 'POST /api/finance/manual-money/commands', forUpdate: true })),
            { code: 'FINANCE_QA_ACCESS_DENIED' });
            await assert.rejects(transaction(client => client.query(`INSERT INTO finance_manual_accounts
                (account_id,business_context,opening_minor,cutoff_at,enrolled_by,reason)
                VALUES($1,'event_genix',0,now(),$2,'Synthetic mixed scope')`, [first.id, actor.id])), { code: '23514' });
            await assert.rejects(transaction(async client => { await access(client);
                return client.query('UPDATE finance_accounts SET name=$2 WHERE id=$1', [first.id, 'Renamed QA']); }), { code: '23514' });
        });
        await t.test('manual commands create durable tagged evidence; cleanup blocks open shifts', async () => {
            await command('enroll', { accountId: first.id, openingMinor: '0', reason: 'Synthetic counted opening' });
            await command('enroll', { accountId: second.id, openingMinor: '0', reason: 'Synthetic counted opening' });
            const opened = await command('open_shift', { accountId: first.id });
            await command('income', { accountId: first.id, categoryId: income.id, amountMinor: '10000', description: 'Synthetic QA receipt' });
            await assert.rejects(transaction(client => qa.finishFinanceQaRun(client, plan.runId)), { code: 'FINANCE_QA_OPEN_SHIFT' });
            await command('close_shift', { accountId: first.id, shiftId: opened.shiftId, actualMinor: '10000' });
            const evidence = (await pool.query('SELECT COUNT(*)::int AS count FROM finance_manual_operations WHERE finance_qa_run_id=$1', [scope.runId])).rows[0];
            assert.equal(evidence.count, 5);
        });
        await t.test('registered booking references are permanently fenced from legacy and cross-domain writers', async () => {
            // Synthetic isolated SQL fixture tests the database fence independently of canonical HTTP creation.
            const bookingId = `finance-qa-${randomUUID().slice(0, 20)}`;
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const active = await access(client);
                await client.query(`INSERT INTO bookings(id,date,time,line_id,status,price,business_context,skip_notification,extra_data,room,room_resource_id)
                    VALUES($1,'2099-06-15','10:00','qa-fixture','confirmed',100,'event_genix',true,$2::jsonb,$3,$4)`,
                [bookingId, JSON.stringify({ disposableQa: { runId: plan.runId, source: 'trusted_qa',
                    testCustomerMarker: `${plan.runId}:finance:disposable`, kind: 'booking', createdAt: new Date().toISOString(), cleanupExpected: true } }), fixture.room, roomId]);
                await registerQaEntity(client, { trusted: true, run: active.run }, 'booking', bookingId, { businessContext: 'event_genix' });
                for (const [sql, args, message] of [
                    ['UPDATE bookings SET price=1 WHERE id=$1', [bookingId], 'Registered finance QA bookings are immutable outside exact finish cancellation'],
                    ["INSERT INTO bookings(id,date,time,line_id,status,price,business_context,linked_to,room,room_resource_id) VALUES($1,'2099-06-15','10:00','qa-fixture','confirmed',100,'event_genix',$2,$3,$4)", [`finance-child-${randomUUID().slice(0, 18)}`, bookingId, fixture.room, roomId], 'Foreign writers cannot reference finance QA bookings'],
                    ["INSERT INTO finance_transactions(type,amount,date,booking_id,business_context) VALUES('income',1,'2099-06-15',$1,'event_genix')", [bookingId], 'Foreign writers cannot reference finance QA bookings'],
                    ['DELETE FROM trusted_qa_run_entities WHERE run_id=$1 AND entity_id=$2', [scope.runId, bookingId], 'Finance QA registry ownership is permanent']
                ]) {
                    await client.query('SAVEPOINT forbidden_writer');
                    await assert.rejects(async () => { await client.query(sql, args); await client.query('SET CONSTRAINTS ALL IMMEDIATE'); }, { code: '23514', message });
                    await client.query('ROLLBACK TO SAVEPOINT forbidden_writer');
                }
            } finally { await client.query('ROLLBACK'); client.release(); }
        });
        await t.test('canonical booking API rejects customer attachment then permits exact receipt and refund fixtures', async () => {
            const { requestId, ...bookingBody } = fixture;
            async function createBooking(body) {
                const response = await fetch(`${BASE_URL}/api/bookings`, { method: 'POST', signal: AbortSignal.timeout(20000),
                    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json',
                        'X-Business-Context': 'event_genix', 'X-QA-Run-Token': token, 'X-QA-Run-Request-Id': requestId },
                    body: JSON.stringify(body) });
                return { status: response.status, body: await response.json() };
            }
            const forbidden = await createBooking({ ...bookingBody, customerId: 999999 });
            assert.equal(forbidden.status, 403, JSON.stringify(forbidden));
            assert.equal(forbidden.body.code, 'FINANCE_QA_CUSTOMER_DENIED');
            const created = await createBooking(bookingBody);
            assert.ok([200, 201].includes(created.status), JSON.stringify(created));
            canonicalBookingId = created.body.booking?.id || created.body.id;
            assert.ok(canonicalBookingId, JSON.stringify(created));
            const row = (await pool.query('SELECT customer_id,certificate_id,skip_notification,price FROM bookings WHERE id=$1', [canonicalBookingId])).rows[0];
            assert.equal(row.customer_id, null);
            assert.equal(row.certificate_id, null);
            assert.equal(row.skip_notification, true);
            assert.equal(Number(row.price), 100);
            const shift = await command('open_shift', { accountId: first.id });
            const receipt = await command('booking_receipt', { accountId: first.id, bookingId: canonicalBookingId, amountMinor: '5000' });
            await command('refund', { originalId: receipt.operationId, amountMinor: '1000', reason: 'Synthetic partial refund' });
            await command('close_shift', { accountId: first.id, shiftId: shift.shiftId, actualMinor: '14000' });
            assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM finance_transactions WHERE booking_id=$1', [canonicalBookingId])).rows[0].count, 0);
            await assert.rejects(transaction(client => client.query(`INSERT INTO bookings(id,date,time,line_id,status,price,business_context,linked_to,room,room_resource_id)
                VALUES($1,'2099-06-15','15:00',$2,'confirmed',100,'event_genix',$3,$4,$5)`,
            [`finance-child-${randomUUID().slice(0, 18)}`, lineId, canonicalBookingId, fixture.room, roomId])),
            { code: '23514', message: 'Foreign writers cannot reference finance QA bookings' });
        });
        await t.test('migration 382 reruns without losing ownership and finish preserves journal evidence', async () => {
            await pool.query(readFileSync(path.join(__dirname, '../../db/migrations/382_finance_trusted_qa.sql'), 'utf8'));
            const before = (await pool.query('SELECT COUNT(*)::int AS count FROM finance_manual_operations WHERE finance_qa_run_id=$1', [scope.runId])).rows[0].count;
            const finished = await transaction(client => qa.finishFinanceQaRun(client, plan.runId));
            assert.equal(finished.state, 'cleaned');
            assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1', [canonicalBookingId])).rows[0].status, 'cancelled');
            assert.equal((await pool.query('SELECT is_active FROM finance_accounts WHERE id=$1', [first.id])).rows[0].is_active, false);
            assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM finance_manual_operations WHERE finance_qa_run_id=$1', [scope.runId])).rows[0].count, before);
            await assert.rejects(transaction(client => access(client)), { code: 'FINANCE_QA_ACCESS_DENIED' });
            await assert.rejects(transaction(client => client.query("INSERT INTO report_bot_submissions(account_name,amount) VALUES($1,1)", [first.name])), { code: '23514' });
        });
        await t.test('a token that expires during a run-row lock wait cannot replay or establish a writable context', async () => {
            const expiringPlan = { ...plan, runId: `finance-${randomUUID()}`, bookingFixtures: [] };
            const expiringToken = randomUUID();
            const created = await transaction(client => qa.createFinanceQaRun(client, expiringPlan,
                { approvedHash: qa.hashFinanceQaPlan(expiringPlan), token: expiringToken }));
            await pool.query("UPDATE trusted_qa_runs SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1", [created.run.id]);
            const holder = await pool.connect();
            const waiter = await pool.connect();
            try {
                await holder.query('BEGIN');
                await holder.query('SELECT id FROM trusted_qa_runs WHERE id=$1 FOR UPDATE', [created.run.id]);
                await waiter.query('BEGIN');
                const blocked = qa.resolveFinanceQaAccess(waiter, { actor, businessContext: 'event_genix', token: expiringToken,
                    endpoint: 'POST /api/finance/manual-money/commands', forUpdate: true });
                const denied = assert.rejects(blocked, { code: 'FINANCE_QA_ACCESS_DENIED' });
                await holder.query('SELECT pg_sleep(0.65)');
                await holder.query('COMMIT');
                await denied;
                await waiter.query('ROLLBACK');
                const tag = (await waiter.query("SELECT NULLIF(current_setting('app.finance_qa_run_id',true),'') AS run_id")).rows[0];
                assert.equal(tag.run_id, null);
            } finally { await holder.query('ROLLBACK'); await waiter.query('ROLLBACK'); holder.release(); waiter.release(); }
            await transaction(client => qa.finishFinanceQaRun(client, expiringPlan.runId));
        });
    } finally { await pool.end(); }
});
