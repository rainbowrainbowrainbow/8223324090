'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const localSocket = process.env.BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST === '1';
const fixtureUrl = process.env.BUSINESS_MEMBERSHIP_TEST_DATABASE_URL;

function localConnection() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    if (localSocket) {
        assert.equal(process.platform, 'linux');
        return { host: '/var/run/postgresql', user: 'postgres', database: 'postgres' };
    }
    const url = new URL(fixtureUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.match(url.pathname, /(?:^|[_-])(test|testing|ci|disposable)(?:[_-]|$)/i);
    assert.doesNotMatch(url.pathname, /(?:^|[_-])(prod|production|live)(?:[_-]|$)/i);
    assert.notEqual(fixtureUrl, process.env.DATABASE_URL);
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)), ssl: false };
}

function tableDdl(file, table) {
    const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations', file), 'utf8');
    const match = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));
    assert.ok(match, `Actual table definition missing: ${table}`);
    return match[0];
}

test('D05 income notification ownership and durable queue convergence on disposable PostgreSQL', {
    skip: !localSocket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const ids = ['../../db', '../../utils/logger', '../../services/telegram', '../../services/eventBus',
        '../../services/financeIncomeNotification', '../../services/legacyBusinessSurface'].map(require.resolve);
    const previous = new Map(ids.map(id => [id, require.cache[id]]));
    const originalFetch = global.fetch;
    global.fetch = () => { throw new Error('External provider access is forbidden in this fixture'); };
    let pool;
    let created = false;
    const queries = [];
    const actions = [];
    let providerCalls = 0;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 4, connectionTimeoutMillis: 5000,
            statement_timeout: 15000, idle_in_transaction_session_timeout: 20000 });
        // Queue/rule definitions come from existing migrations; no unrelated startup seeds run.
        for (const table of ['event_queue', 'event_dead_letter', 'rule_definitions', 'rule_execution_log']) {
            await pool.query(tableDdl('015_v19_core_modules.sql', table));
        }
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/167_guardian_delivery_convergence.sql'), 'utf8'));
        await pool.query('ALTER TABLE rule_execution_log ADD COLUMN trusted_qa_run_public_id VARCHAR(100)');
        // Only columns read by the ownership guard are projected here; this is not a finance schema migration test.
        await pool.query(`CREATE TABLE organizations (id SERIAL PRIMARY KEY, status TEXT NOT NULL);
            CREATE TABLE businesses (id SERIAL PRIMARY KEY, organization_id INT REFERENCES organizations(id),
                context_key VARCHAR(64) UNIQUE NOT NULL, access_mode TEXT NOT NULL, status TEXT NOT NULL);
            CREATE TABLE finance_transactions (id SERIAL PRIMARY KEY, business_context TEXT, type TEXT NOT NULL DEFAULT 'income');
            INSERT INTO organizations (id,status) VALUES (1,'active'),(2,'active');
            INSERT INTO businesses (id,organization_id,context_key,access_mode,status) VALUES
                (1,1,'event_genix','compatibility','active'),(2,1,'dar','membership','active'),
                (3,2,'custom_business','membership','active');
            INSERT INTO finance_transactions (id,business_context) VALUES
                (41,'event_genix'),(42,'dar'),(43,NULL),(44,'custom_business');
            INSERT INTO rule_definitions (code,name,trigger_event,actions) VALUES
                ('fixture_income','Synthetic income rule','finance.income','[{"type":"log","message":"D05_ACTION_SENTINEL"}]');`);
        const servicePool = {
            async query(sql, params) {
                queries.push(String(sql).replace(/\s+/g, ' ').trim());
                return pool.query(sql, params);
            },
            connect() { throw new Error('Income fixture must not reach chat/operational action transactions'); }
        };
        const log = { info(value) { if (String(value).includes('D05_ACTION_SENTINEL')) actions.push(value); },
            warn() {}, error() {}, debug() {} };
        const install = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports }; };
        install(ids[0], { pool: servicePool });
        install(ids[1], { createLogger: () => log });
        install(ids[2], { sendTelegramMessage() { providerCalls++; throw new Error('No provider calls allowed'); },
            getConfiguredChatId() { providerCalls++; throw new Error('No destination lookup allowed'); } });
        for (const id of ids.slice(3)) delete require.cache[id];
        const bus = require(ids[3]);
        async function queue(payload) {
            return (await pool.query(`INSERT INTO event_queue (event_type,payload,idempotency_key)
                VALUES ('finance.income',$1,$2) RETURNING *`, [payload, crypto.randomUUID()])).rows[0];
        }
        async function state(id) { return (await pool.query('SELECT * FROM event_queue WHERE id=$1', [id])).rows[0]; }
        function clearObservation() { queries.length = 0; actions.length = 0; }
        async function assertDenied(event, retryable = false) {
            const row = await state(event.id);
            assert.equal(row.status, retryable ? 'failed' : 'terminal_failed');
            assert.equal(row.convergence_status, retryable ? 'retryable_failed' : 'terminal_failed');
            assert.equal(row.failure_class, retryable ? 'finance_notification_scope_unavailable' : 'finance_notifications_not_migrated');
            assert.equal(row.attempts, 1);
            assert.equal(Boolean(row.terminal_at), !retryable);
            assert.equal(queries.some(sql => /rule_definitions|rule_execution_log|chat_channels|chat_messages|FROM users/.test(sql)), false);
            assert.equal(actions.length, 0);
            assert.equal(providerCalls, 0);
            assert.doesNotMatch(row.last_error, /relation .* does not exist|finance_transactions_unavailable|businesses_unavailable/i);
        }
        async function resetRegistry() {
            await pool.query("UPDATE businesses SET access_mode='compatibility',status='active' WHERE id=1");
            await pool.query("UPDATE organizations SET status='active'");
        }
        await t.test('unowned, malformed, missing and foreign transaction references deny before rules or destinations', async () => {
            for (const payload of [{}, { transactionId: 41 }, { businessContext: 'event_genix' },
                { transactionId: '41x', businessContext: 'event_genix' },
                { transactionId: 9999, businessContext: 'event_genix' },
                { transactionId: 42, businessContext: 'event_genix' },
                { transactionId: 43, businessContext: 'event_genix' },
                { transactionId: 44, businessContext: 'event_genix' }]) {
                const event = await queue(payload);
                clearObservation();
                assert.equal(await bus.processEventRules(event), 0);
                await assertDenied(event);
            }
        });
        await t.test('matching Dar and foreign-organization sources still cannot enter global rules', async () => {
            for (const [transactionId, businessContext] of [[42, 'dar'], [44, 'custom_business']]) {
                const event = await queue({ transactionId, businessContext });
                clearObservation();
                await bus.processEventRules(event);
                await assertDenied(event);
            }
        });
        await t.test('a real expense source does not authorize income rules in pre-cutover Park', async () => {
            await pool.query("INSERT INTO finance_transactions (id,business_context,type) VALUES (45,'event_genix','expense')");
            const event = await queue({ transactionId: 45, businessContext: 'event_genix' });
            clearObservation();
            await bus.processEventRules(event);
            await assertDenied(event);
        });
        await t.test('membership cutover, disabled business and disabled organization deny explicit Park events', async () => {
            for (const sql of ["UPDATE businesses SET access_mode='membership' WHERE id=1",
                "UPDATE businesses SET status='inactive' WHERE id=1", "UPDATE organizations SET status='inactive' WHERE id=1"]) {
                await resetRegistry();
                await pool.query(sql);
                const event = await queue({ transactionId: 41, businessContext: 'event_genix' });
                clearObservation();
                await bus.processEventRules(event);
                await assertDenied(event);
            }
            await resetRegistry();
        });
        await t.test('explicit pre-cutover source processes normally; the same persisted payload is denied after cutover', async () => {
            const event = await queue({ transactionId: 41, businessContext: 'event_genix' });
            clearObservation();
            assert.equal(await bus.processEventRules(event), 1);
            assert.equal((await state(event.id)).status, 'processed');
            assert.equal(actions.length, 1);
            const executions = Number((await pool.query('SELECT COUNT(*) FROM rule_execution_log')).rows[0].count);
            await pool.query("UPDATE businesses SET access_mode='membership' WHERE id=1");
            clearObservation();
            await bus.processEventRules(await state(event.id));
            await assertDenied(event);
            assert.equal(Number((await pool.query('SELECT COUNT(*) FROM rule_execution_log')).rows[0].count), executions);
            await resetRegistry();
        });
        await t.test('stored ownership is read again on replay instead of trusting the old event payload', async () => {
            const event = await queue({ transactionId: 41, businessContext: 'event_genix' });
            await pool.query("UPDATE finance_transactions SET business_context='dar' WHERE id=41");
            clearObservation();
            await bus.processEventRules(event);
            await assertDenied(event);
            await pool.query("UPDATE finance_transactions SET business_context='event_genix' WHERE id=41");
        });
        await t.test('real source and registry read failures persist retryable state and disclose no driver details', async () => {
            for (const table of ['finance_transactions', 'businesses']) {
                const event = await queue({ transactionId: 41, businessContext: 'event_genix' });
                await pool.query(`ALTER TABLE ${table} RENAME TO ${table}_unavailable`);
                try {
                    clearObservation();
                    await bus.processEventRules(event);
                    await assertDenied(event, true);
                } finally { await pool.query(`ALTER TABLE ${table}_unavailable RENAME TO ${table}`); }
                // Re-run the same stored queue row through the actual rule processor after source recovery.
                clearObservation();
                await bus.processEventRules(await state(event.id));
                const recovered = await state(event.id);
                assert.equal(recovered.status, 'processed');
                assert.equal(recovered.failure_class, null);
                assert.equal(recovered.last_error, null);
                assert.equal(actions.length, 1);
            }
        });
        await t.test('retry worker rechecks cutover and terminal events converge to dead letter without actions', async () => {
            // Other tests created terminal events intentionally; move them through the real worker first.
            await bus.processFailedEvents();
            const event = await queue({ transactionId: 41, businessContext: 'event_genix' });
            await pool.query('ALTER TABLE finance_transactions RENAME TO finance_transactions_unavailable');
            try { await bus.processEventRules(event); }
            finally { await pool.query('ALTER TABLE finance_transactions_unavailable RENAME TO finance_transactions'); }
            assert.equal((await state(event.id)).status, 'failed');
            await pool.query("UPDATE businesses SET access_mode='membership' WHERE id=1");
            clearObservation();
            await bus.processFailedEvents();
            const deadline = Date.now() + 5000;
            let queued;
            let dead;
            do {
                queued = await state(event.id);
                dead = (await pool.query('SELECT * FROM event_dead_letter WHERE original_event_id=$1', [event.id])).rows[0];
                if (queued?.status === 'terminal_failed' || dead) break;
                await new Promise(resolve => setTimeout(resolve, 10));
            } while (Date.now() < deadline);
            assert.ok(queued?.status === 'terminal_failed' || dead, 'The fire-and-forget worker must settle before fixture cleanup');
            assert.equal((queued || dead).failure_class, 'finance_notifications_not_migrated');
            assert.equal((queued || dead).attempts, 2);
            assert.equal(queries.some(sql => /rule_definitions|rule_execution_log|chat_channels|chat_messages|FROM users/.test(sql)), false);
            assert.equal(actions.length, 0);
            assert.equal(providerCalls, 0);
            if (!dead) await bus.processFailedEvents();
            assert.equal(await state(event.id), undefined);
            dead = (await pool.query('SELECT * FROM event_dead_letter WHERE original_event_id=$1', [event.id])).rows[0];
            assert.equal(dead.failure_class, 'finance_notifications_not_migrated');
            assert.equal(dead.idempotency_key, event.idempotency_key);
            assert.deepEqual(dead.payload, event.payload);
            await resetRegistry();
        });
        assert.equal(providerCalls, 0);
    } finally {
        global.fetch = originalFetch;
        for (const [id, entry] of previous) {
            if (entry) require.cache[id] = entry;
            else delete require.cache[id];
        }
        if (pool) await pool.end();
        try {
            if (created) {
                assert.equal((await admin.query('SELECT pid FROM pg_stat_activity WHERE datname=$1', [database])).rowCount, 0);
                await admin.query(`DROP DATABASE "${database}"`);
                assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
            }
        } finally { await admin.end(); }
    }
});
