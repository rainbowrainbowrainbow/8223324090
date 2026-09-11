'use strict';

// Real HTTP/auth/routes/PostgreSQL. The existing runner owns the disposable DB.
// TEST_DATABASE_URL + TEST_DATABASE_RESET_CONFIRM are required; no production fallback.
// node tests/integration/wallet-ledger.integration.test.js --isolated
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const { acquireIsolatedDatabaseLock, runSuite } = require('../../scripts/run-isolated-postgres-tests');

if (process.argv.includes('--isolated')) {
    (async () => {
        const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
        assert.equal(target.isLocal, true, 'Wallet QA requires loopback PostgreSQL');
        const lock = await acquireIsolatedDatabaseLock(target);
        try { await runSuite(target, 'tests/integration/wallet-ledger.integration.test.js', 'wallet-ledger'); }
        finally { await lock.release(); }
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
} else {
    test('Wallet ledger: real routes and transaction ownership', {
        skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 120000
    }, async t => {
        assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
        const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
        assert.equal(target.isLocal, true);
        assertSafeIsolatedTestUrl(process.env.TEST_URL);
        const db = new Pool({ connectionString: target.url.toString(), max: 2, ssl: false });
        const base = new URL(process.env.TEST_URL).origin;
        const timezone = (await db.query('SHOW TimeZone')).rows[0].TimeZone;
        const evidence = { scope: 'Disposable loopback app, actual auth/Wallet routes/PostgreSQL', timezone, checks: [], blockers: [] };
        const request = async (user, endpoint, body, expected = 200) => {
            const response = await fetch(`${base}/api/${endpoint}`, {
                method: body ? 'POST' : 'GET',
                headers: { 'Content-Type': 'application/json', ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) },
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(15000)
            });
            assert.equal(response.status, expected, `${body ? 'POST' : 'GET'} ${endpoint}`);
            return response.json();
        };
        const fixture = async (coins = null) => {
            const username = `qa_wallet_${crypto.randomBytes(6).toString('hex')}`;
            const password = crypto.randomBytes(24).toString('base64url');
            const result = await db.query('INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
                [username, await bcrypt.hash(password, 4), 'QA Wallet Synthetic', 'animator']);
            const id = result.rows[0].id;
            if (coins !== null) await db.query('INSERT INTO game_wallets (user_id, coins, total_earned) VALUES ($1, $2, $2)', [id, coins]);
            const session = await request(null, 'auth/login', { username, password });
            const token = session.accessToken || session.token;
            assert.ok(token, 'Authenticated synthetic user');
            return { id, username, token };
        };
        const balance = async user => (await db.query('SELECT coins, total_earned, total_spent, login_streak, last_login_reward FROM game_wallets WHERE user_id = $1', [user.id])).rows[0];
        const ledger = async user => (await db.query('SELECT user_id, username, amount, type, reference_id FROM coin_transactions WHERE user_id = $1 ORDER BY id', [user.id])).rows;
        const check = async (name, fn) => t.test(name, async () => { await fn(); evidence.checks.push({ name, status: 'PASS' }); });
        const rejectLedger = async (user, type, fn) => {
            assert.ok(Number.isSafeInteger(user.id));
            assert.ok(['starter_bonus', 'daily_login', 'gift'].includes(type));
            const name = `qa_wallet_fail_${user.id}`;
            // Test-only fault injection, restricted to the runner-owned DB and this fixture.
            await db.query(`ALTER TABLE coin_transactions ADD CONSTRAINT ${name} CHECK (NOT (user_id = ${user.id} AND type = '${type}')) NOT VALID`);
            try { await fn(); } finally { await db.query(`ALTER TABLE coin_transactions DROP CONSTRAINT ${name}`); }
        };
        try {
            await check('concurrent first wallet reads create exactly one starter ledger entry', async () => {
                const user = await fixture();
                const blocker = await db.connect();
                let requests;
                try {
                    await blocker.query('BEGIN');
                    await blocker.query('LOCK TABLE game_wallets IN SHARE MODE');
                    requests = Promise.allSettled([request(user, 'wallet'), request(user, 'wallet')]);
                    const deadline = Date.now() + 5000;
                    let waiting = 0;
                    while (Date.now() < deadline) {
                        const result = await db.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'INSERT INTO game_wallets%'");
                        waiting = result.rows[0].count;
                        if (waiting >= 2) break;
                        await new Promise(resolve => setTimeout(resolve, 25));
                    }
                    assert.equal(waiting, 2, 'Both requests observed the missing wallet before INSERT');
                } finally {
                    await blocker.query('ROLLBACK');
                    blocker.release();
                    if (requests) {
                        const responses = await requests;
                        assert.ok(responses.every(result => result.status === 'fulfilled' && result.value.coins === 500));
                    }
                }
                assert.equal((await ledger(user)).length, 1);
                assert.equal((await balance(user)).coins, 500);
            });
            await check('string self-transfer is rejected without inflating earned/spent totals', async () => {
                const user = await fixture(100);
                const before = await balance(user);
                await request(user, 'wallet/transfer', { to_user_id: String(user.id), amount: '10' }, 400);
                assert.deepEqual(await balance(user), before);
                assert.deepEqual(await ledger(user), []);
            });
            for (const value of [true, [1], {}, 'abc', '1.5', 1.5, 2147483648, -1, 0]) {
                await check(`transfer rejects invalid numeric fields ${JSON.stringify(value)}`, async () => {
                    const sender = await fixture(100);
                    const recipient = await fixture(0);
                    const before = await balance(sender);
                    await request(sender, 'wallet/transfer', { to_user_id: recipient.id, amount: value }, 400);
                    await request(sender, 'wallet/transfer', { to_user_id: value, amount: 1 }, 400);
                    assert.deepEqual(await balance(sender), before);
                    assert.equal((await balance(recipient)).coins, 0);
                    assert.deepEqual(await ledger(sender), []);
                });
            }
            await check('canonical numeric strings remain accepted for valid transfers', async () => {
                const sender = await fixture(100);
                const recipient = await fixture(0);
                await request(sender, 'wallet/transfer', { to_user_id: String(recipient.id), amount: '15' });
                assert.equal((await balance(sender)).coins, 85);
                assert.equal((await balance(recipient)).coins, 15);
            });
            for (const [daysAgo, previousStreak, expectedReward, expectedStreak] of [[0, 3, 0, 3], [1, 3, 25, 4], [2, 3, 10, 1], [1, 7, 10, 8]]) {
                await check(`DATE reward continuity: ${daysAgo} days ago, previous streak ${previousStreak}`, async () => {
                    const user = await fixture(100);
                    const today = new Date().toISOString().slice(0, 10);
                    await db.query('UPDATE game_wallets SET last_login_reward = $2::date - $3::int, login_streak = $4 WHERE user_id = $1', [user.id, today, daysAgo, previousStreak]);
                    const result = await request(user, 'wallet/daily-login', {});
                    assert.equal(result.reward, expectedReward);
                    assert.equal(result.loginStreak, expectedStreak);
                    assert.equal((await balance(user)).coins, 100 + expectedReward);
                });
            }
            for (const [dayOffset, time, claimed] of [[-1, '23:59:59', false], [0, '00:00:00', true], [0, '23:59:59', true], [1, '00:00:00', false]]) {
                await check(`legacy ledger UTC boundary ${dayOffset}/${time}`, async () => {
                    const user = await fixture(100);
                    const today = new Date().toISOString().slice(0, 10);
                    await db.query(`INSERT INTO coin_transactions (user_id, username, amount, type, created_at)
                        VALUES ($1, $2, 10, 'daily_login', (($3::date + $4::int + $5::time) AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))`, [user.id, user.username, today, dayOffset, time]);
                    const result = await request(user, 'wallet/daily-login', {});
                    assert.equal(result.alreadyClaimed, claimed);
                    assert.equal((await balance(user)).coins, claimed ? 100 : 110);
                });
            }
            await check('day 7 inventory schema failure preserves wallet and ledger atomically', async () => {
                const user = await fixture(100);
                const today = new Date().toISOString().slice(0, 10);
                await db.query('UPDATE game_wallets SET last_login_reward = $2::date - 1, login_streak = 6 WHERE user_id = $1', [user.id, today]);
                const before = await balance(user);
                const columns = (await db.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('shop_items', 'user_inventory')")).rows;
                assert.ok(!columns.some(row => row.table_name === 'shop_items' && row.column_name === 'is_available'), 'Canonical schema reproduces the known catalog mismatch');
                await request(user, 'wallet/daily-login', {}, 500);
                assert.deepEqual(await balance(user), before);
                assert.deepEqual(await ledger(user), []);
                // This is rollback evidence, not successful day-seven product verification.
                evidence.blockers.push({ id: 'WALLET-INVENTORY-03', status: 'BLOCKED', scenario: 'Day 7 reward returns 500: catalog/inventory contract requires a separate approved repair; Wallet release must remain on hold.' });
            });
            await check('starter bonus records canonical username once on sequential reads', async () => {
                const user = await fixture();
                assert.equal((await request(user, 'wallet')).coins, 500);
                assert.equal((await request(user, 'wallet')).coins, 500);
                assert.deepEqual(await ledger(user), [{ user_id: user.id, username: user.username, amount: 500, type: 'starter_bonus', reference_id: null }]);
                assert.equal((await balance(user)).total_earned, 500);
            });
            await check('daily reward records owner and repeated/concurrent claims do not duplicate it', async () => {
                const user = await fixture(100);
                const reward = await request(user, 'wallet/daily-login', {});
                assert.equal(reward.reward, 10);
                assert.equal(reward.alreadyClaimed, false);
                const repeats = await Promise.all([request(user, 'wallet/daily-login', {}), request(user, 'wallet/daily-login', {})]);
                assert.ok(repeats.every(result => result.alreadyClaimed === true && result.reward === 0));
                assert.deepEqual(await ledger(user), [{ user_id: user.id, username: user.username, amount: 10, type: 'daily_login', reference_id: null }]);
                const row = await balance(user);
                assert.equal(row.coins, 110);
                assert.equal(row.total_earned, 110);
                assert.equal(row.login_streak, 1);
            });
            for (const recipientCoins of [25, null]) {
                await check(`transfer preserves both ledger owners; recipient initial balance ${recipientCoins}`, async () => {
                    const sender = await fixture(100);
                    const recipient = await fixture(recipientCoins);
                    await request(sender, 'wallet/transfer', { to_user_id: recipient.id, amount: 15 });
                    assert.deepEqual(await ledger(sender), [{ user_id: sender.id, username: sender.username, amount: -15, type: 'gift', reference_id: recipient.id }]);
                    assert.deepEqual(await ledger(recipient), [{ user_id: recipient.id, username: recipient.username, amount: 15, type: 'gift', reference_id: sender.id }]);
                    assert.equal((await balance(sender)).coins, 85);
                    assert.equal((await balance(sender)).total_spent, 15);
                    assert.equal((await balance(recipient)).coins, (recipientCoins || 0) + 15);
                    assert.equal((await balance(recipient)).total_earned, (recipientCoins || 0) + 15);
                    const history = await request(recipient, 'wallet/history');
                    assert.equal(history.total, 1);
                    assert.equal(history.transactions[0].referenceId, sender.id);
                });
            }
            await check('failed starter ledger rolls back wallet creation', async () => {
                const user = await fixture();
                await rejectLedger(user, 'starter_bonus', () => request(user, 'wallet', undefined, 500));
                assert.equal(await balance(user), undefined);
                assert.deepEqual(await ledger(user), []);
            });
            await check('failed daily ledger rolls back coins, earned total, streak and date', async () => {
                const user = await fixture(100);
                const before = await balance(user);
                await rejectLedger(user, 'daily_login', () => request(user, 'wallet/daily-login', {}, 500));
                assert.deepEqual(await balance(user), before);
                assert.deepEqual(await ledger(user), []);
            });
            for (const rejectedOwner of ['sender', 'recipient']) {
                await check(`failed ${rejectedOwner} gift ledger rolls back both wallets and all entries`, async () => {
                    const sender = await fixture(100);
                    const recipient = await fixture();
                    const before = await balance(sender);
                    await rejectLedger(rejectedOwner === 'sender' ? sender : recipient, 'gift', () => request(sender, 'wallet/transfer', { to_user_id: recipient.id, amount: 15 }, 500));
                    assert.deepEqual(await balance(sender), before);
                    assert.equal(await balance(recipient), undefined);
                    assert.deepEqual(await ledger(sender), []);
                    assert.deepEqual(await ledger(recipient), []);
                });
            }
            await check('rejected insufficient funds and numeric self-transfer do not create ledger entries', async () => {
                const sender = await fixture(5);
                const recipient = await fixture(0);
                await request(sender, 'wallet/transfer', { to_user_id: recipient.id, amount: 15 }, 400);
                await request(sender, 'wallet/transfer', { to_user_id: sender.id, amount: 1 }, 400);
                assert.equal((await balance(sender)).coins, 5);
                assert.equal((await balance(recipient)).coins, 0);
                assert.deepEqual(await ledger(sender), []);
                assert.deepEqual(await ledger(recipient), []);
            });
        } finally {
            await db.end();
            const out = path.resolve(__dirname, '../../output/wallet-ledger');
            fs.mkdirSync(out, { recursive: true });
            fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(evidence, null, 2));
            fs.writeFileSync(path.join(out, `results-${timezone.replace(/[^a-z0-9_-]/gi, '_')}.json`), JSON.stringify(evidence, null, 2));
        }
    });
}
