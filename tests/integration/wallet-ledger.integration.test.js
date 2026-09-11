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
        const failures = [];
        try {
            for (const variant of ['migrated', 'deployed']) {
                process.env.WALLET_SCHEMA_VARIANT = variant;
                try { await runSuite(target, 'tests/integration/wallet-ledger.integration.test.js', 'wallet-ledger'); }
                catch { failures.push(variant); }
            }
        } finally { delete process.env.WALLET_SCHEMA_VARIANT; await lock.release(); }
        if (failures.length) throw new Error(`Wallet schema variants failed: ${failures.join(', ')}`);
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
        const variant = process.env.WALLET_SCHEMA_VARIANT;
        assert.ok(['migrated', 'deployed'].includes(variant));
        const deployed = variant === 'deployed';
        const evidence = { scope: 'Disposable loopback app, actual auth/Wallet routes/PostgreSQL', timezone, variant, checks: [], blockers: [] };
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
        const ledger = async user => (await db.query(`SELECT ct.user_id, ${deployed ? 'u.username' : 'ct.username'}, ct.amount, ct.type, ct.reference_id FROM coin_transactions ct JOIN users u ON u.id=ct.user_id WHERE ct.user_id = $1 ORDER BY ct.id`, [user.id])).rows;
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
            if (deployed) {
                // Reproduce verified live contracts only in the runner-owned disposable DB.
                await db.query('ALTER TABLE coin_transactions DROP COLUMN username');
                await db.query('ALTER TABLE shop_items ADD COLUMN is_available BOOLEAN DEFAULT true');
                await db.query('ALTER TABLE user_inventory RENAME TO qa_wallet_migrated_inventory');
                await db.query(`CREATE TABLE user_inventory (
                    id SERIAL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    item_id INTEGER NOT NULL REFERENCES shop_items(id), quantity INTEGER DEFAULT 1,
                    is_equipped BOOLEAN DEFAULT false, obtained_from VARCHAR(50), obtained_at TIMESTAMP DEFAULT NOW(),
                    username VARCHAR(50), CONSTRAINT qa_wallet_inventory_pk PRIMARY KEY(id),
                    CONSTRAINT qa_wallet_inventory_owner_item UNIQUE(user_id,item_id))`);
            }
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
                    await db.query(`INSERT INTO coin_transactions (user_id, ${deployed ? '' : 'username,'} amount, type, created_at)
                        SELECT $1, ${deployed ? '' : '$2::text,'} 10, 'daily_login', (($3::date + $4::int + $5::time) AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone') FROM users WHERE id=$1 AND username=$2::text`, [user.id, user.username, today, dayOffset, time]);
                    const result = await request(user, 'wallet/daily-login', {});
                    assert.equal(result.alreadyClaimed, claimed);
                    assert.equal((await balance(user)).coins, claimed ? 100 : 110);
                });
            }
            await db.query('UPDATE shop_items SET equip_slot=NULL');
            const character = (await db.query("INSERT INTO character_items(name,type) VALUES ('QA day seven','hat') RETURNING id")).rows[0];
            const item = (await db.query(`INSERT INTO shop_items(id,item_id,name,rarity,equip_slot,code) SELECT COALESCE(MAX(id),0)+10000,$1,'QA day seven','common','hat','qa_wallet_day7' FROM shop_items RETURNING id,name`, [character.id])).rows[0];
            assert.notEqual(item.id, character.id, 'Shop ID and character ID must not be interchangeable');
            const inventory = async user => (await db.query(`SELECT * FROM user_inventory WHERE ${deployed ? 'user_id' : 'username'}=$1`, [deployed ? user.id : user.username])).rows;
            const daySevenUser = async () => {
                const user = await fixture(100);
                await db.query("UPDATE game_wallets SET last_login_reward=$2::date-1,login_streak=6 WHERE user_id=$1", [user.id,new Date().toISOString().slice(0,10)]);
                return user;
            };
            await check('day 7 concurrent claims award one item and 50 coins; day 8 wraps to 10', async () => {
                const user = await daySevenUser();
                const results = await Promise.all([request(user,'wallet/daily-login',{}),request(user,'wallet/daily-login',{})]);
                assert.equal(results.filter(result => result.reward===50 && result.bonusItem===item.name).length,1);
                assert.equal(results.filter(result => result.alreadyClaimed).length,1);
                assert.equal((await balance(user)).coins,150);
                const owned = await inventory(user);
                assert.equal(owned.length,1);
                assert.equal(owned[0].item_id,deployed ? item.id : character.id);
                assert.equal(owned[0].username,user.username);
                assert.equal(deployed ? owned[0].obtained_from : owned[0].acquired_via,'daily_login');
                assert.equal((await ledger(user)).length,1);
                await db.query("UPDATE game_wallets SET last_login_reward=$2::date-1 WHERE user_id=$1",[user.id,new Date().toISOString().slice(0,10)]);
                await db.query("UPDATE coin_transactions SET created_at=created_at-INTERVAL '1 day' WHERE user_id=$1",[user.id]);
                const next = await request(user,'wallet/daily-login',{});
                assert.equal(next.reward,10);
                assert.equal(next.loginStreak,8);
                assert.equal((await inventory(user)).length,1);
            });
            await check('day 7 repeat item preserves the supported inventory ownership model', async () => {
                const user = await daySevenUser();
                await request(user,'wallet/daily-login',{});
                await db.query("UPDATE game_wallets SET last_login_reward=$2::date-1,login_streak=13 WHERE user_id=$1",[user.id,new Date().toISOString().slice(0,10)]);
                await db.query("UPDATE coin_transactions SET created_at=created_at-INTERVAL '1 day' WHERE user_id=$1",[user.id]);
                const reward = await request(user,'wallet/daily-login',{});
                assert.equal(reward.reward,50);
                const owned = await inventory(user);
                assert.equal(owned.length,1);
                if (deployed) { assert.equal(owned[0].quantity,2); assert.equal(reward.bonusItem,item.name); }
                else assert.equal(reward.bonusItem,null);
                assert.equal((await balance(user)).coins,200);
            });
            await check('day 7 unavailable or non-equippable catalog awards coins without an item', async () => {
                for (const unavailable of [true,false]) {
                    const user = await daySevenUser();
                    await db.query(`UPDATE shop_items SET ${deployed ? 'is_available' : 'is_active'}=$1,equip_slot=$2 WHERE id=$3`,[!unavailable,unavailable?'hat':null,item.id]);
                    const reward = await request(user,'wallet/daily-login',{});
                    assert.equal(reward.reward,50);
                    assert.equal(reward.bonusItem,null);
                    assert.deepEqual(await inventory(user),[]);
                }
                await db.query(`UPDATE shop_items SET ${deployed ? 'is_available' : 'is_active'}=true,equip_slot='hat' WHERE id=$1`,[item.id]);
            });
            await check('day 7 inventory insert failure rolls back coins, date, streak and ledger', async () => {
                const user = await daySevenUser();
                const before = await balance(user);
                await db.query(`ALTER TABLE user_inventory ADD CONSTRAINT qa_wallet_inventory_failure CHECK(item_id<>${deployed ? item.id : character.id}) NOT VALID`);
                try { await request(user,'wallet/daily-login',{},500); }
                finally { await db.query('ALTER TABLE user_inventory DROP CONSTRAINT qa_wallet_inventory_failure'); }
                assert.deepEqual(await balance(user),before);
                assert.deepEqual(await ledger(user),[]);
                assert.deepEqual(await inventory(user),[]);
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
            fs.writeFileSync(path.join(out, `results-${variant}-${timezone.replace(/[^a-z0-9_-]/gi, '_')}.json`), JSON.stringify(evidence, null, 2));
        }
    });
}
