'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { BASE_URL, getToken } = require('../helpers');

test('manual money movements use a real migrated disposable PostgreSQL journal and HTTP API', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true',
    timeout: 180000
}, async t => {
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL,
        { ...process.env, DATABASE_URL: '' });
    assert.equal(database.isLocal, true, 'money fixtures require loopback PostgreSQL');
    const pool = new Pool({ connectionString: database.url.toString(), ssl: false, max: 8 });
    try {
        const { createFinanceMoneyService } = require('../../services/financeMoneyMovements');
        const service = createFinanceMoneyService(pool);
        const actor = (await pool.query(`UPDATE users
            SET business_contexts = ARRAY['event_genix', 'dar'], default_business_context = 'event_genix'
            WHERE username = $1 RETURNING id, username`, [process.env.TEST_USER])).rows[0];
        assert.ok(actor, 'runner-created synthetic user exists');
        const token = await getToken();
        let sequence = 0;
        const name = prefix => `Manual QA ${prefix} ${++sequence}`;
        async function api(method, path, body, context = 'event_genix') {
            const response = await fetch(`${BASE_URL}/api/finance${path}`, {
                method, signal: AbortSignal.timeout(20000),
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
                    'X-Business-Context': context, Connection: 'close' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
            return { status: response.status, body: await response.json() };
        }
        function payload(command, fields = {}) {
            return { command, idempotencyKey: randomUUID(), ...fields };
        }
        async function command(commandName, fields = {}, context = 'event_genix') {
            return api('POST', '/manual-money/commands', payload(commandName, fields), context);
        }
        function successful(response) {
            assert.ok([200, 201].includes(response.status), JSON.stringify(response));
            assert.equal(response.body.success, true);
            assert.equal(typeof response.body.operationId, 'string');
            return response.body;
        }
        async function workspace(context = 'event_genix') {
            const response = await api('GET', '/manual-money', undefined, context);
            assert.equal(response.status, 200, JSON.stringify(response.body));
            assert.equal(response.body.available, true);
            assert.equal(response.body.currency, 'UAH');
            assert.equal(response.body.coverage, 'manual-only');
            return response.body;
        }
        async function accountState(accountId, context = 'event_genix') {
            const result = (await workspace(context)).accounts.find(row => row.id === accountId);
            assert.ok(result, `account ${accountId} remains visible in ${context}`);
            return result;
        }
        async function account(type = 'cash', context = 'event_genix', options = {}) {
            return (await pool.query(`INSERT INTO finance_accounts
                (name, type, business_context, is_active, is_personal, created_by)
                VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [name(type), type, context, options.active !== false, options.personal === true, actor.username])).rows[0].id;
        }
        async function category(type, context = 'event_genix', active = true) {
            return (await pool.query(`INSERT INTO finance_categories
                (name, type, business_context, is_active) VALUES ($1, $2, $3, $4) RETURNING id`,
            [name(type), type, context, active])).rows[0].id;
        }
        async function booking(context = 'event_genix', price = 10000) {
            const id = `manual-${randomUUID().slice(0, 20)}`;
            await pool.query(`INSERT INTO bookings
                (id, date, time, line_id, status, price, business_context, room, room_resource_id)
                VALUES ($1, '2099-06-15', '10:00', 'manual-qa', 'confirmed', $2, $3,
                        'Manual QA room', 'manual-qa-room')`, [id, price, context]);
            return id;
        }
        async function enroll(accountId, openingMinor = '0', context = 'event_genix') {
            return successful(await command('enroll', { accountId, openingMinor,
                reason: 'Disposable QA counted opening balance' }, context));
        }
        async function open(accountId, context = 'event_genix') {
            return successful(await command('open_shift', { accountId }, context));
        }
        async function readyCash(openingMinor = '0', context = 'event_genix') {
            const accountId = await account('cash', context);
            await enroll(accountId, openingMinor, context);
            const shift = await open(accountId, context);
            return { accountId, shiftId: shift.shiftId };
        }
        async function summary(bookingId, context = 'event_genix') {
            const response = await api('GET', `/manual-money/bookings/${bookingId}`, undefined, context);
            assert.equal(response.status, 200, JSON.stringify(response.body));
            return response.body;
        }
        async function financialSnapshot() {
            return (await pool.query(`SELECT
                (SELECT COUNT(*)::integer FROM finance_transactions) AS legacy_count,
                (SELECT COALESCE(SUM(amount), 0)::text FROM finance_transactions) AS legacy_sum,
                (SELECT COUNT(*)::integer FROM payment_orders) AS payment_orders,
                (SELECT COUNT(*)::integer FROM payment_outbox_jobs) AS payment_outbox_jobs,
                (SELECT COUNT(*)::integer FROM fiscal_operations) AS fiscal_operations,
                (SELECT COUNT(*)::integer FROM payroll_payment_movements) AS payroll_movements`)).rows[0];
        }
        const incomeCategory = await category('income');
        const expenseCategory = await category('expense');
        const bookingCategory = (await pool.query(`SELECT id FROM finance_categories WHERE name='Бронювання'
            AND type='income' AND is_system=true AND business_context='event_genix' LIMIT 1`)).rows[0]?.id
            || (await pool.query(`INSERT INTO finance_categories(name,type,business_context,is_active,is_system)
                VALUES ('Бронювання','income','event_genix',true,true) RETURNING id`)).rows[0].id;

        await t.test('counted opening, kopecks and independent shifts survive close and reopen without replaying the opening', async () => {
            const first = await readyCash('500000');
            const second = await readyCash('120000');
            const initial = await accountState(first.accountId);
            assert.equal(initial.balanceMinor, '500000');
            assert.equal(initial.openShift.openingMinor, '500000');
            successful(await command('expense', { accountId: first.accountId, categoryId: expenseCategory,
                amountMinor: '80025', description: 'Supplies counted in kopecks' }));
            assert.equal((await accountState(first.accountId)).balanceMinor, '419975');
            assert.equal((await accountState(second.accountId)).balanceMinor, '120000');
            successful(await command('close_shift', { ...first, actualMinor: '419975' }));
            assert.equal((await accountState(first.accountId)).openShift, null);
            assert.equal((await accountState(second.accountId)).openShift.id, second.shiftId);
            const reopened = await open(first.accountId);
            assert.notEqual(reopened.shiftId, first.shiftId);
            assert.equal((await accountState(first.accountId)).openShift.openingMinor, '419975');
            assert.equal((await accountState(first.accountId)).balanceMinor, '419975');
            assert.equal((await command('enroll', { accountId: first.accountId, openingMinor: '500000',
                reason: 'Must not reset a counted account' })).status, 409);
            assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM finance_manual_accounts WHERE account_id=$1',
                [first.accountId])).rows[0].n, 1);
        });

        await t.test('two simultaneous opens create exactly one shift for that account', async () => {
            const accountId = await account();
            await enroll(accountId, '100');
            const results = await Promise.all([command('open_shift', { accountId }), command('open_shift', { accountId })]);
            assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
            assert.equal((await pool.query(`SELECT COUNT(*)::integer AS n FROM cash_register_shifts
                WHERE account_id=$1 AND status='open'`, [accountId])).rows[0].n, 1);
        });

        await t.test('concurrent exact retries return one persisted result and changed-payload replay conflicts', async () => {
            const { accountId } = await readyCash('10000');
            const request = payload('income', { accountId, categoryId: incomeCategory, amountMinor: '12345',
                description: 'One income submitted three times' });
            const responses = await Promise.all(Array.from({ length: 3 }, () =>
                api('POST', '/manual-money/commands', request)));
            responses.forEach(successful);
            assert.equal(new Set(responses.map(row => row.body.operationId)).size, 1);
            assert.equal(responses.filter(row => row.body.replayed === false).length, 1);
            assert.equal(responses.filter(row => row.body.replayed === true).length, 2);
            assert.equal((await accountState(accountId)).balanceMinor, '22345');
            const changed = await api('POST', '/manual-money/commands', { ...request, amountMinor: '12346' });
            assert.equal(changed.status, 409, JSON.stringify(changed.body));
            assert.equal((await accountState(accountId)).balanceMinor, '22345');
            const persisted = (await pool.query(`SELECT COUNT(*)::integer AS n FROM finance_manual_operations
                WHERE business_context='event_genix' AND actor_user_id=$1 AND command='income' AND idempotency_key=$2`,
            [actor.id, request.idempotencyKey])).rows[0];
            assert.equal(persisted.n, 1);
        });

        await t.test('split cash and bank booking receipts settle remaining due without duplicating legacy revenue or writing legacy paid flags', async () => {
            const { accountId } = await readyCash();
            const bankId = await account('bank');
            await enroll(bankId);
            const bookingId = await booking();
            await pool.query(`INSERT INTO finance_transactions
                (business_context,type,category_id,amount,date,booking_id,source)
                VALUES ('event_genix','income',$1,10000,'2099-06-15',$2,'booking')`, [bookingCategory, bookingId]);
            const before = await financialSnapshot();
            const legacyBefore = (await pool.query('SELECT paid_amount,payment_status FROM bookings WHERE id=$1', [bookingId])).rows[0];
            assert.equal((await summary(bookingId)).remainingMinor, '1000000');
            successful(await command('booking_receipt', { accountId, bookingId, amountMinor: '300000' }));
            let paymentSummary = await summary(bookingId);
            assert.equal(paymentSummary.paidMinor, '300000');
            assert.equal(paymentSummary.remainingMinor, '700000');
            successful(await command('booking_receipt', { accountId: bankId, bookingId, amountMinor: '700000' }));
            paymentSummary = await summary(bookingId);
            assert.equal(paymentSummary.totalMinor, '1000000');
            assert.equal(paymentSummary.paidMinor, '1000000');
            assert.equal(paymentSummary.remainingMinor, '0');
            assert.equal(paymentSummary.enrolled, true);
            assert.equal((await accountState(accountId)).balanceMinor, '300000');
            assert.equal((await accountState(bankId)).balanceMinor, '700000');
            assert.equal((await accountState(bankId)).openShift, null);
            assert.deepEqual(await financialSnapshot(), before);
            assert.deepEqual((await pool.query('SELECT paid_amount,payment_status FROM bookings WHERE id=$1', [bookingId])).rows[0], legacyBefore);
            assert.equal((await api('POST', `/debts/${bookingId}/mark-paid`, {})).status, 409);
            assert.equal((await command('booking_receipt', { accountId, bookingId, amountMinor: '1' })).status, 409);
        });

        await t.test('service locking serializes competing receipts and refunds against the same booking and original payment', async () => {
            const receiptAccounts = [await readyCash(), await readyCash()];
            const bookingId = await booking();
            const execute = body => service.execute({ businessContext: 'event_genix', actor }, body);
            const receipts = await Promise.allSettled(receiptAccounts.map(cash => execute(payload('booking_receipt', {
                accountId: cash.accountId, bookingId, amountMinor: '700000'
            }))));
            assert.equal(receipts.filter(row => row.status === 'fulfilled').length, 1);
            assert.equal(receipts.find(row => row.status === 'rejected').reason.status, 409);
            const receipt = receipts.find(row => row.status === 'fulfilled').value;
            const accountId = receiptAccounts[receipts.findIndex(row => row.status === 'fulfilled')].accountId;
            assert.equal((await summary(bookingId)).remainingMinor, '300000');
            const refunds = await Promise.allSettled([1, 2].map(() => execute(payload('refund', {
                originalId: receipt.operationId, amountMinor: '500000', reason: 'Customer refund QA'
            }))));
            assert.equal(refunds.filter(row => row.status === 'fulfilled').length, 1);
            assert.equal(refunds.find(row => row.status === 'rejected').reason.status, 409);
            assert.equal((await accountState(accountId)).balanceMinor, '200000');
            assert.equal((await summary(bookingId)).paidMinor, '200000');
            assert.equal((await summary(bookingId)).remainingMinor, '800000');
            const evidence = (await pool.query(`SELECT amount_minor::text,command FROM finance_manual_operations WHERE id=$1`,
                [receipt.operationId])).rows[0];
            assert.deepEqual(evidence, { amount_minor: '700000', command: 'booking_receipt' });
        });

        await t.test('cash transfer has two neutral atomic legs and insufficient funds cannot leave a partial transfer', async () => {
            const source = await readyCash('500000');
            const target = await readyCash('100000');
            const before = await financialSnapshot();
            const transfer = successful(await command('transfer', { accountId: source.accountId,
                toAccountId: target.accountId, amountMinor: '200000', reason: 'Move counted notes' }));
            assert.equal((await accountState(source.accountId)).balanceMinor, '300000');
            assert.equal((await accountState(target.accountId)).balanceMinor, '300000');
            const legs = (await pool.query(`SELECT account_id,amount_minor::text,shift_id FROM finance_manual_legs
                WHERE operation_id=$1 ORDER BY account_id`, [transfer.operationId])).rows;
            assert.deepEqual(legs, [
                { account_id: source.accountId, amount_minor: '-200000', shift_id: source.shiftId },
                { account_id: target.accountId, amount_minor: '200000', shift_id: target.shiftId }
            ]);
            const rejected = payload('transfer', { accountId: source.accountId, toAccountId: target.accountId,
                amountMinor: '1000000', reason: 'Insufficient funds must be atomic' });
            assert.equal((await api('POST', '/manual-money/commands', rejected)).status, 409);
            assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM finance_manual_operations WHERE idempotency_key=$1',
                [rejected.idempotencyKey])).rows[0].n, 0);
            assert.equal((await accountState(source.accountId)).balanceMinor, '300000');
            assert.equal((await accountState(target.accountId)).balanceMinor, '300000');
            assert.deepEqual(await financialSnapshot(), before);
        });

        await t.test('opposite-direction concurrent transfers complete without deadlock and conserve cash', async () => {
            const first = await readyCash('500000');
            const second = await readyCash('500000');
            const results = await Promise.all([
                command('transfer', { accountId: first.accountId, toAccountId: second.accountId,
                    amountMinor: '70000', reason: 'Concurrent A to B' }),
                command('transfer', { accountId: second.accountId, toAccountId: first.accountId,
                    amountMinor: '20000', reason: 'Concurrent B to A' })
            ]);
            results.forEach(successful);
            assert.equal((await accountState(first.accountId)).balanceMinor, '450000');
            assert.equal((await accountState(second.accountId)).balanceMinor, '550000');
        });

        await t.test('a posting racing shift close either belongs to that close or is rejected in full', async () => {
            const cash = await readyCash('100000');
            const expense = payload('expense', { accountId: cash.accountId, categoryId: expenseCategory,
                amountMinor: '10000', description: 'Posting at shift close' });
            const [posting, closing] = await Promise.all([
                api('POST', '/manual-money/commands', expense),
                command('close_shift', { ...cash, actualMinor: '100000', reason: 'QA count closes concurrently' })
            ]);
            successful(closing);
            assert.ok([201, 409].includes(posting.status), JSON.stringify(posting));
            const state = await accountState(cash.accountId);
            assert.equal(state.openShift, null);
            assert.equal(state.balanceMinor, posting.status === 201 ? '90000' : '100000');
            const row = (await pool.query(`SELECT status,expected_minor::text,difference_minor::text
                FROM cash_register_shifts WHERE id=$1`, [cash.shiftId])).rows[0];
            assert.deepEqual(row, { status: 'closed', expected_minor: state.balanceMinor,
                difference_minor: posting.status === 201 ? '10000' : '0' });
            const legs = (await pool.query(`SELECT l.shift_id FROM finance_manual_legs l
                JOIN finance_manual_operations o ON o.id=l.operation_id WHERE o.idempotency_key=$1`,
            [expense.idempotencyKey])).rows;
            assert.deepEqual(legs, posting.status === 201 ? [{ shift_id: cash.shiftId }] : []);
            assert.equal((await command('expense', { accountId: cash.accountId, categoryId: expenseCategory,
                amountMinor: '1', description: 'Closed shift cannot receive a new posting' })).status, 409);
        });

        await t.test('linked reversal in a later shift preserves the closed shift and the original immutable evidence', async () => {
            const cash = await readyCash('100000');
            const original = successful(await command('expense', { accountId: cash.accountId, categoryId: expenseCategory,
                amountMinor: '12025', description: 'Expense later corrected' }));
            successful(await command('close_shift', { ...cash, actualMinor: '87975' }));
            const closedBefore = (await pool.query('SELECT * FROM cash_register_shifts WHERE id=$1', [cash.shiftId])).rows[0];
            const next = await open(cash.accountId);
            assert.equal((await command('reverse', { originalId: original.operationId })).status, 400);
            const reversal = successful(await command('reverse', { originalId: original.operationId,
                reason: 'Wrong expense, reverse in current shift' }));
            assert.equal((await accountState(cash.accountId)).balanceMinor, '100000');
            const linked = (await pool.query(`SELECT o.original_id::text,l.amount_minor::text,l.shift_id
                FROM finance_manual_operations o JOIN finance_manual_legs l ON l.operation_id=o.id WHERE o.id=$1`,
            [reversal.operationId])).rows[0];
            assert.deepEqual(linked, { original_id: original.operationId, amount_minor: '12025', shift_id: next.shiftId });
            assert.deepEqual((await pool.query('SELECT * FROM cash_register_shifts WHERE id=$1', [cash.shiftId])).rows[0], closedBefore);
            assert.equal((await command('reverse', { originalId: original.operationId, reason: 'Duplicate reversal' })).status, 409);
            await assert.rejects(pool.query('UPDATE finance_manual_operations SET amount_minor=1 WHERE id=$1',
                [original.operationId]), error => error.code === '23514');
            await assert.rejects(pool.query('DELETE FROM finance_manual_legs WHERE operation_id=$1',
                [original.operationId]), error => error.code === '23514');
        });

        await t.test('manual enrollment closes alternate legacy finance and account-state writers', async () => {
            const cash = await readyCash('1000');
            const before = await financialSnapshot();
            const legacyWrite = await api('POST', '/transactions', { type: 'income', categoryId: incomeCategory,
                accountId: cash.accountId, amount: 1, date: '2026-10-07', description: 'Blocked alternate writer' });
            assert.equal(legacyWrite.status, 409, JSON.stringify(legacyWrite.body));
            assert.equal((await api('PATCH', `/accounts/${cash.accountId}`, { isActive: false })).status, 409);
            assert.equal((await api('PATCH', `/accounts/${cash.accountId}`, { isPersonal: true })).status, 409);
            assert.equal((await api('DELETE', `/accounts/${cash.accountId}`)).status, 409);
            const accountRow = (await pool.query('SELECT is_active,is_personal FROM finance_accounts WHERE id=$1', [cash.accountId])).rows[0];
            assert.deepEqual(accountRow, { is_active: true, is_personal: false });
            assert.deepEqual(await financialSnapshot(), before);
        });

        await t.test('system categories cannot be archived by the generic category route', async () => {
            const protectedCategory = (await pool.query(`INSERT INTO finance_categories
                (name,type,business_context,is_active,is_system) VALUES ($1,'income','event_genix',true,true)
                RETURNING id`, [name('system category')])).rows[0].id;
            assert.equal((await api('DELETE', `/categories/${protectedCategory}`)).status, 400);
            assert.equal((await pool.query('SELECT is_active FROM finance_categories WHERE id=$1',
                [protectedCategory])).rows[0].is_active, true);
        });

        await t.test('business ownership isolates reads, receipts, categories, transfers and enrollment', async () => {
            const own = await readyCash('100000');
            const foreign = await readyCash('90000', 'dar');
            const foreignBooking = await booking('dar');
            const foreignCategory = await category('expense', 'dar');
            assert.ok(!(await workspace()).accounts.some(row => row.id === foreign.accountId));
            assert.ok(!(await workspace('dar')).accounts.some(row => row.id === own.accountId));
            assert.equal((await api('GET', `/manual-money/bookings/${foreignBooking}`)).status, 404);
            assert.equal((await command('booking_receipt', { accountId: own.accountId,
                bookingId: foreignBooking, amountMinor: '1000' })).status, 404);
            assert.equal((await command('transfer', { accountId: own.accountId,
                toAccountId: foreign.accountId, amountMinor: '1000', reason: 'Cross-business denied' })).status, 404);
            assert.equal((await command('expense', { accountId: own.accountId,
                categoryId: foreignCategory, amountMinor: '1000', description: 'Foreign category denied' })).status, 404);
            assert.equal((await command('enroll', { accountId: foreign.accountId,
                openingMinor: '0', reason: 'Foreign account denied' })).status, 404);
            assert.equal((await accountState(own.accountId)).balanceMinor, '100000');
            assert.equal((await accountState(foreign.accountId, 'dar')).balanceMinor, '90000');
            const sharedRetryKey = randomUUID();
            const foreignIncome = await category('income', 'dar');
            const scopedResults = await Promise.all([
                command('income', { accountId: own.accountId, categoryId: incomeCategory,
                    amountMinor: '100', description: 'Own business retry scope', idempotencyKey: sharedRetryKey }),
                command('income', { accountId: foreign.accountId, categoryId: foreignIncome,
                    amountMinor: '200', description: 'Foreign business retry scope', idempotencyKey: sharedRetryKey }, 'dar')
            ]);
            scopedResults.forEach(successful);
            assert.notEqual(scopedResults[0].body.operationId, scopedResults[1].body.operationId);
            assert.equal((await accountState(own.accountId)).balanceMinor, '100100');
            assert.equal((await accountState(foreign.accountId, 'dar')).balanceMinor, '90200');
        });

        await t.test('inactive or personal accounts, inactive categories and category-type mismatch fail before money changes', async () => {
            const inactive = await account('cash', 'event_genix', { active: false });
            const personal = await account('cash', 'event_genix', { personal: true });
            for (const accountId of [inactive, personal]) {
                assert.equal((await command('enroll', { accountId, openingMinor: '0', reason: 'Ineligible account' })).status, 409);
            }
            const cash = await readyCash('100000');
            const inactiveCategory = await category('expense', 'event_genix', false);
            assert.equal((await command('expense', { accountId: cash.accountId, categoryId: inactiveCategory,
                amountMinor: '100', description: 'Inactive category' })).status, 409);
            assert.equal((await command('expense', { accountId: cash.accountId, categoryId: incomeCategory,
                amountMinor: '100', description: 'Wrong category type' })).status, 400);
            assert.equal((await accountState(cash.accountId)).balanceMinor, '100000');
        });

        await t.test('strict money and command fields reject fractional, unsafe and implicit-date input without journal rows', async () => {
            const cash = await readyCash('100000');
            for (const amountMinor of ['1.25', '-1', '0', '1e3', '9223372036854775808', 100, null]) {
                assert.equal((await command('income', { accountId: cash.accountId, categoryId: incomeCategory,
                    amountMinor, description: 'Invalid wire money' })).status, 400, String(amountMinor));
            }
            for (const extra of [{ effectiveAt: '2026-10-07T10:00:00' }, { effectiveAt: '2099-01-01T00:00:00Z' },
                { provider: 'checkbox' }, { businessContext: 'dar' }, { currency: 'USD' }]) {
                assert.equal((await command('income', { accountId: cash.accountId, categoryId: incomeCategory,
                    amountMinor: '100', description: 'Invalid extra or time', ...extra })).status, 400);
            }
            assert.equal((await command('income', { accountId: cash.accountId, amountMinor: '100',
                description: 'Missing category' })).status, 400);
            assert.equal((await accountState(cash.accountId)).balanceMinor, '100000');
        });

        await t.test('bank and card allow manual movements without cash shifts and cannot impersonate cash transfer endpoints', async () => {
            const bankId = await account('bank');
            const cardId = await account('card');
            const cash = await readyCash('1000');
            for (const accountId of [bankId, cardId]) {
                await enroll(accountId);
                successful(await command('income', { accountId, categoryId: incomeCategory,
                    amountMinor: '1025', description: 'Manually confirmed bank or card receipt' }));
                assert.equal((await accountState(accountId)).balanceMinor, '1025');
                assert.equal((await accountState(accountId)).openShift, null);
                const rejectedOpen = await command('open_shift', { accountId });
                assert.equal(rejectedOpen.status, 409, JSON.stringify({ rejectedOpen,
                    clock: (await pool.query(`SELECT clock_timestamp() AS now,cutoff_at FROM finance_manual_accounts
                        WHERE account_id=$1`, [accountId])).rows[0] }));
                assert.equal((await command('transfer', { accountId: cash.accountId, toAccountId: accountId,
                    amountMinor: '100', reason: 'Cash-only transfer boundary' })).status, 409);
            }
        });

        await t.test('legacy paid, linked, banquet, certificate and fiscal bookings remain outside manual receipt ownership', async () => {
            const cash = await readyCash();
            const legacy = await booking();
            await pool.query("UPDATE bookings SET paid_amount=100,payment_status='partial' WHERE id=$1", [legacy]);
            const parent = await booking();
            const child = await booking();
            await pool.query('UPDATE bookings SET linked_to=$1 WHERE id=$2', [parent, child]);
            const banquet = await booking();
            await pool.query(`INSERT INTO banquet_deposits(primary_booking_id,business_context,amount)
                VALUES ($1,'event_genix',500)`, [banquet]);
            const certificateBooking = await booking();
            const certificate = (await pool.query(`INSERT INTO certificates(cert_code,display_value,valid_until)
                VALUES ($1,'Disposable manual money certificate','2099-12-31') RETURNING id`,
            [`MQ${randomUUID().slice(0, 15)}`])).rows[0].id;
            await pool.query('UPDATE bookings SET certificate_id=$1 WHERE id=$2', [certificate, certificateBooking]);
            const fiscalBooking = await booking();
            const profile = (await pool.query(`INSERT INTO fiscal_profiles(crm_profile_key,legal_entity_key,legal_entity_name)
                VALUES ('event_genix','manual_money_qa','Disposable manual money QA') RETURNING id`)).rows[0].id;
            const location = (await pool.query(`INSERT INTO fiscal_locations(fiscal_profile_id,crm_profile_key,location_alias,display_name)
                VALUES ($1,'event_genix','manual_money_qa','Disposable manual money QA') RETURNING id`, [profile])).rows[0].id;
            const register = (await pool.query(`INSERT INTO fiscal_registers(fiscal_profile_id,fiscal_location_id,crm_profile_key,register_alias,display_name)
                VALUES ($1,$2,'event_genix','manual_money_qa','Disposable manual money QA') RETURNING id`, [profile, location])).rows[0].id;
            await pool.query(`INSERT INTO payment_orders(fiscal_profile_id,fiscal_register_id,source_type,source_id,
                order_key,idempotency_key,payment_method,total_amount_minor)
                VALUES ($1,$2,'booking',$3,$4,$5,'cash',1000000)`,
            [profile, register, fiscalBooking, `manual-qa:${fiscalBooking}`, randomUUID()]);
            const fiscalSnapshotBooking = await booking();
            await pool.query(`INSERT INTO payment_orders(fiscal_profile_id,fiscal_register_id,source_type,source_id,
                order_key,idempotency_key,payment_method,total_amount_minor,source_snapshot)
                VALUES ($1,$2,'catalog_sale','manual-qa-catalog-source',$3,$4,'cash',1000000,$5::jsonb)`,
            [profile, register, `manual-qa:${fiscalSnapshotBooking}`, randomUUID(), JSON.stringify({ bookingId: fiscalSnapshotBooking })]);
            const before = await financialSnapshot();
            for (const bookingId of [legacy, parent, child, banquet, certificateBooking, fiscalBooking, fiscalSnapshotBooking]) {
                const state = await summary(bookingId);
                assert.equal(state.eligible, false, bookingId);
                assert.ok(state.blockedReason, bookingId);
                assert.equal((await command('booking_receipt', { accountId: cash.accountId,
                    bookingId, amountMinor: '100' })).status, 409, bookingId);
                assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM finance_manual_booking_scopes WHERE booking_id=$1',
                    [bookingId])).rows[0].n, 0);
            }
            assert.equal((await accountState(cash.accountId)).balanceMinor, '0');
            assert.deepEqual(await financialSnapshot(), before);
        });

        await t.test('accounts already carrying legacy payroll or manual evidence cannot be enrolled into a second balance owner', async () => {
            const payrollAccount = await account();
            const legacyAccount = await account();
            await pool.query(`INSERT INTO finance_transactions
                (business_context,type,category_id,amount,date,account_id,source,payment_method,recognition_date)
                VALUES ('event_genix','expense',$1,100,'2099-06-15',$2,'payroll','cash','2099-06-15'),
                       ('event_genix','income',$3,100,'2099-06-15',$4,'manual','cash',NULL)`,
            [expenseCategory, payrollAccount, incomeCategory, legacyAccount]);
            const before = await financialSnapshot();
            for (const accountId of [payrollAccount, legacyAccount]) {
                const state = await accountState(accountId);
                assert.equal(state.eligible, false);
                assert.ok(state.blockedReason);
                assert.equal((await command('enroll', { accountId, openingMinor: '10000',
                    reason: 'Existing writer cannot be silently replaced' })).status, 409);
                assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM finance_manual_accounts WHERE account_id=$1',
                    [accountId])).rows[0].n, 0);
            }
            assert.deepEqual(await financialSnapshot(), before);
        });

        await t.test('cash and bank bigint balances reject overflow atomically without losing a kopeck', async () => {
            const limit = '9223372036854775807';
            for (const type of ['cash', 'bank']) {
                const accountId = await account(type);
                await enroll(accountId, limit);
                if (type === 'cash') await open(accountId);
                const request = payload('income', { accountId, categoryId: incomeCategory, amountMinor: '1',
                    description: 'One kopeck beyond the supported balance' });
                const overflow = await api('POST', '/manual-money/commands', request);
                assert.equal(overflow.status, 409, JSON.stringify(overflow.body));
                assert.equal(overflow.body.code, 'BALANCE_LIMIT');
                assert.equal((await accountState(accountId)).balanceMinor, limit);
                assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM finance_manual_operations WHERE idempotency_key=$1',
                    [request.idempotencyKey])).rows[0].n, 0);
                successful(await command('expense', { accountId, categoryId: expenseCategory, amountMinor: '1',
                    description: 'Exact bigint kopeck debit' }));
                assert.equal((await accountState(accountId)).balanceMinor, '9223372036854775806');
            }
        });

        await t.test('database clock regression fails closed while explicit backdating keeps its distinct input error', async () => {
            const accountId = await account('bank');
            // A fresh synthetic enrollment in the future simulates a clock rollback;
            // never UPDATE existing immutable evidence to manufacture this condition.
            await pool.query(`INSERT INTO finance_manual_accounts
                (account_id,business_context,opening_minor,cutoff_at,enrolled_by,reason)
                VALUES ($1,'event_genix',1000,clock_timestamp()+INTERVAL '1 minute',$2,'Synthetic clock regression')`,
            [accountId, actor.id]);
            const defaultTime = payload('income', { accountId, categoryId: incomeCategory,
                amountMinor: '25', description: 'Default clock must not rewrite a prior boundary' });
            const defaultResult = await api('POST', '/manual-money/commands', defaultTime);
            assert.equal(defaultResult.status, 409, JSON.stringify(defaultResult.body));
            assert.equal(defaultResult.body.code, 'MANUAL_CLOCK_REGRESSION');
            const explicitTime = payload('income', { accountId, categoryId: incomeCategory,
                amountMinor: '25', description: 'Explicit time before the enrollment',
                effectiveAt: (await pool.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString() });
            const explicitResult = await api('POST', '/manual-money/commands', explicitTime);
            assert.equal(explicitResult.status, 400, JSON.stringify(explicitResult.body));
            assert.equal(explicitResult.body.code, 'EFFECTIVE_TIME_BEFORE_CUTOFF');
            assert.equal((await pool.query(`SELECT COUNT(*)::integer AS n FROM finance_manual_operations
                WHERE idempotency_key=ANY($1::text[])`, [[defaultTime.idempotencyKey, explicitTime.idempotencyKey]])).rows[0].n, 0);
            assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM finance_manual_legs WHERE account_id=$1',
                [accountId])).rows[0].n, 0);
            assert.equal((await accountState(accountId)).balanceMinor, '1000');
        });

        await t.test('explicit Kyiv offset is the same instant and cutoff or closed-period backdating is rejected', async () => {
            const accountId = await account();
            const beforeEnrollment = new Date(Date.now() - 60000).toISOString();
            successful(await command('enroll', { accountId, openingMinor: '1000', effectiveAt: beforeEnrollment,
                reason: 'Disposable counted balance one minute before shift' }));
            await open(accountId);
            const openedAt = (await accountState(accountId)).openShift.openedAt;
            const kyivOffset = new Date(Date.parse(openedAt) + 3 * 60 * 60 * 1000).toISOString().replace('Z', '+03:00');
            const accepted = successful(await command('income', { accountId, categoryId: incomeCategory,
                amountMinor: '25', description: 'Same instant in Kyiv offset', effectiveAt: kyivOffset }));
            assert.equal((await pool.query('SELECT effective_at FROM finance_manual_operations WHERE id=$1',
                [accepted.operationId])).rows[0].effective_at.toISOString(), openedAt);
            const beforeCutoff = await command('expense', { accountId, categoryId: expenseCategory,
                amountMinor: '1', description: 'Before counted baseline',
                effectiveAt: new Date(Date.parse(beforeEnrollment) - 1000).toISOString() });
            assert.equal(beforeCutoff.status, 400);
            assert.equal(beforeCutoff.body.code, 'EFFECTIVE_TIME_BEFORE_CUTOFF');
            const beforeShift = await command('expense', { accountId, categoryId: expenseCategory,
                amountMinor: '1', description: 'Before the open shift',
                effectiveAt: new Date(Date.parse(beforeEnrollment) + 1000).toISOString() });
            assert.equal(beforeShift.status, 400);
            assert.equal(beforeShift.body.code, 'EFFECTIVE_TIME_BEFORE_SHIFT');
            assert.equal((await accountState(accountId)).balanceMinor, '1025');
        });

        await t.test('cancellation or return to preliminary preserves confirmed money and permits a linked refund', async () => {
            for (const status of ['cancelled', 'preliminary']) {
                const cash = await readyCash();
                const bookingId = await booking('event_genix', 1000);
                const receipt = successful(await command('booking_receipt', { accountId: cash.accountId,
                    bookingId, amountMinor: '60000' }));
                const before = await financialSnapshot();
                // Change only this disposable fixture; protected booking APIs are not modified.
                await pool.query('UPDATE bookings SET status=$1 WHERE id=$2', [status, bookingId]);
                const afterStatus = await summary(bookingId);
                assert.equal(afterStatus.status, status);
                assert.equal(afterStatus.paidMinor, '60000');
                assert.equal(afterStatus.eligible, false);
                assert.equal((await accountState(cash.accountId)).balanceMinor, '60000');
                assert.equal((await command('booking_receipt', { accountId: cash.accountId,
                    bookingId, amountMinor: '100' })).status, 409);
                successful(await command('refund', { originalId: receipt.operationId,
                    amountMinor: '60000', reason: `Refund after disposable booking became ${status}` }));
                assert.equal((await summary(bookingId)).paidMinor, '0');
                assert.equal((await accountState(cash.accountId)).balanceMinor, '0');
                assert.deepEqual(await financialSnapshot(), before);
                assert.equal((await pool.query('SELECT amount_minor::text FROM finance_manual_operations WHERE id=$1',
                    [receipt.operationId])).rows[0].amount_minor, '60000');
            }
        });

        await t.test('migration 381 rerun preserves concurrent manual shifts and the separate one-open legacy guard', async () => {
            const first = await readyCash('10000');
            const second = await readyCash('20000');
            const legacy = (await pool.query(`INSERT INTO cash_register_shifts
                (business_context,opened_by,opening_cash,status) VALUES ('event_genix',$1,30,'open') RETURNING id`,
            [actor.id])).rows[0].id;
            const shiftIds = [first.shiftId, second.shiftId, legacy];
            const before = (await pool.query('SELECT * FROM cash_register_shifts WHERE id=ANY($1::integer[]) ORDER BY id',
                [shiftIds])).rows;
            assert.equal(before.length, 3);
            await pool.query(readFileSync(path.resolve(__dirname, '../../db/migrations/381_finance_manual_money.sql'), 'utf8'));
            assert.deepEqual((await pool.query('SELECT * FROM cash_register_shifts WHERE id=ANY($1::integer[]) ORDER BY id',
                [shiftIds])).rows, before);
            for (const accountId of [first.accountId, second.accountId]) {
                await assert.rejects(pool.query(`INSERT INTO cash_register_shifts
                    (business_context,account_id,opened_by,opening_cash,opening_minor,status)
                    VALUES ('event_genix',$1,$2,0,0,'open')`, [accountId, actor.id]),
                error => error.code === '23505' && error.constraint === 'idx_cash_shifts_one_open_account_v381');
            }
            await assert.rejects(pool.query(`INSERT INTO cash_register_shifts
                (business_context,opened_by,opening_cash,status) VALUES ('event_genix',$1,0,'open')`, [actor.id]),
            error => error.code === '23505' && error.constraint === 'idx_cash_shifts_one_open_legacy_v381');
            assert.equal((await accountState(first.accountId)).balanceMinor, '10000');
            assert.equal((await accountState(second.accountId)).balanceMinor, '20000');
        });
    } finally {
        // The runner destroys the entire owned disposable database. Immutable money
        // evidence must not acquire a test-only DELETE escape hatch.
        await pool.end();
    }
});
