'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');

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

test('finance account and transaction ownership with actual membership auth, HTTP and disposable PostgreSQL', {
    skip: !localSocket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const replaced = ['../../db', '../../services/eventBus', '../../services/payroll'].map(require.resolve);
    const previous = new Map(replaced.map(id => [id, require.cache[id]]));
    const events = [];
    const originalFetch = global.fetch;
    let pool;
    let server;
    let created = false;
    global.fetch = async (url, options) => {
        assert.equal(new URL(url).hostname, '127.0.0.1', 'External requests are forbidden in this fixture');
        return originalFetch(url, options);
    };
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 6, connectionTimeoutMillis: 5000 });
        await pool.query(`
            CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'animator', extra_roles TEXT[] NOT NULL DEFAULT '{}',
                page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
                action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
                business_contexts TEXT[] NOT NULL DEFAULT '{event_genix}', default_business_context TEXT,
                telegram_chat_id TEXT, is_active BOOLEAN NOT NULL DEFAULT true, session_revoked_at TIMESTAMPTZ,
                last_seen_at TIMESTAMPTZ);
            CREATE TABLE employee_profiles (user_id INT REFERENCES users(id), staff_id INT,
                is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE bookings (id TEXT PRIMARY KEY, business_context TEXT NOT NULL);
            CREATE TABLE staff (id INT PRIMARY KEY, name TEXT);
            CREATE TABLE certificates (id INT PRIMARY KEY, cert_code TEXT);
            CREATE TABLE finance_categories (id SERIAL PRIMARY KEY, name TEXT, type TEXT,
                is_active BOOLEAN DEFAULT true, business_context TEXT NOT NULL DEFAULT 'event_genix');
            CREATE TABLE finance_accounts (id SERIAL PRIMARY KEY, name TEXT NOT NULL, emoji TEXT, description TEXT,
                type TEXT DEFAULT 'cash', sort_order INT DEFAULT 0, is_personal BOOLEAN DEFAULT false,
                owner_username TEXT, crm_created_by TEXT, created_by TEXT, is_active BOOLEAN DEFAULT true,
                business_context TEXT NOT NULL DEFAULT 'fixture_wrong_default', created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE finance_transactions (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL DEFAULT 'event_genix',
                type TEXT, category_id INT REFERENCES finance_categories(id), amount INT, description TEXT, date TEXT,
                payment_method TEXT, booking_id TEXT, staff_id INT REFERENCES staff(id), certificate_id INT REFERENCES certificates(id),
                account_id INT REFERENCES finance_accounts(id), account_name TEXT, created_by TEXT, source TEXT DEFAULT 'manual',
                recognition_date DATE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE payroll_payment_movements (id SERIAL PRIMARY KEY, finance_transaction_id INT);
            CREATE TABLE payroll_reports (id SERIAL PRIMARY KEY, finance_transaction_id INT, reversal_transaction_id INT);
            CREATE TABLE fixture_account_insert_owners (account_id INT, business_context TEXT);
            CREATE FUNCTION fixture_account_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.name = 'fixture_reject_insert' THEN RAISE EXCEPTION 'fixture_insert_rejected'; END IF;
                INSERT INTO fixture_account_insert_owners VALUES (NEW.id, NEW.business_context);
                RETURN NEW;
            END $$;
            CREATE TRIGGER fixture_account_insert BEFORE INSERT ON finance_accounts FOR EACH ROW EXECUTE FUNCTION fixture_account_insert();
            CREATE FUNCTION fixture_account_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture_followup_account_update_forbidden'; END $$;
            CREATE TRIGGER fixture_account_update BEFORE UPDATE ON finance_accounts FOR EACH ROW EXECUTE FUNCTION fixture_account_update();
            CREATE FUNCTION fixture_transaction_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.description = 'fixture_reject_transaction' THEN RAISE EXCEPTION 'fixture_transaction_rejected'; END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER fixture_transaction_insert BEFORE INSERT ON finance_transactions FOR EACH ROW EXECUTE FUNCTION fixture_transaction_insert();
        `);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/357_organizations_business_memberships.sql'), 'utf8'));
        await pool.query(`
            INSERT INTO organizations(id,slug,name) VALUES (1,'fixture-finance-own','Fixture Own'),(2,'fixture-finance-other','Fixture Other');
            INSERT INTO businesses(id,organization_id,context_key,label,short_label,access_mode,modules) VALUES
                (1,1,'event_genix','Fixture Park','Park','membership','["finance"]'),(2,1,'dar','Fixture Dar','Dar','membership','["finance"]'),
                (3,2,'fixture_other','Fixture Other','Other','membership','["finance"]');
            INSERT INTO users(id,username,name,role,business_contexts,default_business_context) VALUES
                (1,'finance_actor','Actor','animator','{event_genix,dar}','dar'),
                (2,'finance_legacy','Legacy','director','{crm}','crm');
            INSERT INTO organization_memberships(organization_id,user_id,role) VALUES (1,1,'member');
            INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default) VALUES
                (1,1,1,'director',false),(2,1,1,'director',true);
            INSERT INTO bookings VALUES ('fixture_park','event_genix'),('fixture_dar','dar'),('fixture_other','fixture_other');
            INSERT INTO staff VALUES (1,'Fixture global staff');
            INSERT INTO certificates VALUES (1,'FIXTURE-ONLY');
            INSERT INTO finance_categories(id,name,type,business_context) VALUES
                (11,'Park expense','expense','event_genix'),(12,'Dar expense','expense','dar'),
                (13,'Other expense','expense','fixture_other'),(14,'Dar income','income','dar');
            INSERT INTO finance_accounts(id,name,business_context) VALUES
                (11,'Park account','event_genix'),(12,'Dar account','dar'),(13,'Other account','fixture_other');
            SELECT setval(pg_get_serial_sequence('finance_accounts','id'),100,true);
        `);
        require.cache[replaced[0]] = { id: replaced[0], filename: replaced[0], loaded: true, exports: { pool } };
        require.cache[replaced[1]] = { id: replaced[1], filename: replaced[1], loaded: true, exports: {
            publish: async (type, payload) => { events.push({ type, payload }); }
        } };
        require.cache[replaced[2]] = { id: replaced[2], filename: replaced[2], loaded: true, exports: {
            getSalaryReport: async () => { throw new Error('Payroll report is outside this fixture'); }
        } };
        const auth = require('../../middleware/auth');
        const { businessScopeWriteGuard } = require('../../middleware/businessScopeGuard');
        const app = express();
        app.use(express.json());
        app.use('/api/finance', auth.authenticateToken, businessScopeWriteGuard, require('../../routes/finance'));
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const tokens = {
            member: jwt.sign({ id: 1, username: 'finance_actor', role: 'creator' }, auth.JWT_SECRET, { expiresIn: '1h' }),
            legacy: jwt.sign({ id: 2, username: 'finance_legacy', role: 'director' }, auth.JWT_SECRET, { expiresIn: '1h' })
        };
        async function request(method, route, body, context = 'dar', actor = 'member') {
            const response = await fetch(base + '/api/finance' + route, { method,
                signal: AbortSignal.timeout(15000),
                headers: { Authorization: 'Bearer ' + tokens[actor], 'Content-Type': 'application/json',
                    'X-Business-Context': context, Connection: 'close' },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json() };
        }
        const transaction = extra => ({ type: 'expense', amount: 123, date: '2026-09-12', description: 'Synthetic finance fixture', ...extra });
        async function ledger() { return (await pool.query('SELECT * FROM finance_transactions ORDER BY id')).rows; }
        let darTransaction;

        await t.test('account INSERT has Dar ownership before triggers run and requires no followup UPDATE', async () => {
            const result = await request('POST', '/accounts', { name: 'Dar fixture account', type: 'cash', isPersonal: true });
            assert.equal(result.status, 200, JSON.stringify(result.body));
            assert.equal(result.body.account.business_context, 'dar');
            const id = result.body.account.id;
            assert.equal((await pool.query('SELECT business_context FROM finance_accounts WHERE id=$1', [id])).rows[0].business_context, 'dar');
            assert.equal((await pool.query('SELECT business_context FROM fixture_account_insert_owners WHERE account_id=$1', [id])).rows[0].business_context, 'dar');
            assert.equal(result.body.account.owner_username, 'finance_actor');
        });
        await t.test('injected account INSERT failure leaves neither account nor ownership-observation row', async () => {
            const before = (await pool.query('SELECT id FROM finance_accounts ORDER BY id')).rows;
            const observations = (await pool.query('SELECT * FROM fixture_account_insert_owners ORDER BY account_id')).rows;
            const result = await request('POST', '/accounts', { name: 'fixture_reject_insert' });
            assert.equal(result.status, 500);
            assert.deepEqual((await pool.query('SELECT id FROM finance_accounts ORDER BY id')).rows, before);
            assert.deepEqual((await pool.query('SELECT * FROM fixture_account_insert_owners ORDER BY account_id')).rows, observations);
        });
        await t.test('valid Park and Dar booking references preserve the selected business and amounts', async () => {
            for (const [context, bookingId, categoryId, accountId] of [
                ['event_genix', 'fixture_park', 11, 11], ['dar', 'fixture_dar', 12, 12]
            ]) {
                const result = await request('POST', '/transactions', transaction({ bookingId, categoryId, accountId }), context);
                assert.equal(result.status, 201, JSON.stringify(result.body));
                const row = (await pool.query('SELECT * FROM finance_transactions WHERE id=$1', [result.body.id])).rows[0];
                assert.equal(row.business_context, context);
                assert.equal(row.booking_id, bookingId);
                assert.equal(row.amount, 123);
                if (context === 'dar') darTransaction = row.id;
            }
        });
        await t.test('foreign or missing booking references deny before transaction writes and income events', async () => {
            const before = await ledger();
            const beforeEvents = events.length;
            for (const bookingId of ['fixture_park', 'fixture_other', 'fixture_missing']) {
                const result = await request('POST', '/transactions', transaction({ type: 'income', bookingId }));
                assert.equal(result.status, 400, JSON.stringify(result.body));
                assert.equal(result.body.code, 'finance_booking_not_found');
            }
            assert.deepEqual(await ledger(), before);
            assert.equal(events.length, beforeEvents);
        });
        await t.test('failed transaction INSERT rolls back without publishing income', async () => {
            const before = await ledger();
            const beforeEvents = events.length;
            const result = await request('POST', '/transactions', transaction({ type: 'income', bookingId: 'fixture_dar',
                description: 'fixture_reject_transaction' }));
            assert.equal(result.status, 500, JSON.stringify(result.body));
            assert.deepEqual(await ledger(), before);
            assert.equal(events.length, beforeEvents);
        });
        await t.test('unowned staff/certificate references are quarantined for membership but compatibility is preserved', async () => {
            const before = await ledger();
            const beforeEvents = events.length;
            for (const context of ['event_genix', 'dar']) {
                for (const reference of [{ staffId: 1 }, { certificateId: 1 }]) {
                    const result = await request('POST', '/transactions', transaction({ type: 'income', ...reference }), context);
                    assert.equal(result.status, 403, JSON.stringify(result.body));
                    assert.equal(result.body.code, 'finance_reference_not_migrated');
                }
            }
            assert.deepEqual(await ledger(), before);
            assert.equal(events.length, beforeEvents);
            const empty = await request('POST', '/transactions', transaction({ staffId: null, certificateId: '', bookingId: '' }));
            assert.equal(empty.status, 201, JSON.stringify(empty.body));
            const legacy = await request('POST', '/transactions', transaction({ staffId: 1, certificateId: 1 }), 'crm', 'legacy');
            assert.equal(legacy.status, 201, JSON.stringify(legacy.body));
            const row = (await pool.query('SELECT business_context,staff_id,certificate_id FROM finance_transactions WHERE id=$1', [legacy.body.id])).rows[0];
            assert.deepEqual(row, { business_context: 'crm', staff_id: 1, certificate_id: 1 });
        });
        await t.test('foreign categories/accounts and foreign transaction IDs reject without changing either ledger', async () => {
            const before = await ledger();
            for (const reference of [{ categoryId: 11 }, { categoryId: 13 }, { accountId: 11 }, { accountId: 13 }]) {
                assert.equal((await request('POST', '/transactions', transaction(reference))).status, 400);
                assert.equal((await request('PUT', '/transactions/' + darTransaction, { ...reference, amount: 555 })).status, 400);
            }
            assert.equal((await request('PUT', '/transactions/' + darTransaction, { amount: 777 }, 'event_genix')).status, 404);
            assert.deepEqual(await ledger(), before);
        });
        await t.test('metadata updates validate retained references without making booking or global references mutable', async () => {
            const positive = await request('PUT', '/transactions/' + darTransaction, { amount: 124, description: 'Synthetic edit',
                bookingId: 'fixture_park', staffId: 1, certificateId: 1 });
            assert.equal(positive.status, 200, JSON.stringify(positive.body));
            const edited = (await pool.query('SELECT amount,booking_id,staff_id,certificate_id FROM finance_transactions WHERE id=$1', [darTransaction])).rows[0];
            assert.deepEqual(edited, { amount: 124, booking_id: 'fixture_dar', staff_id: null, certificate_id: null });
            const fixtures = [
                ['booking_id', 'fixture_park', 400, 'finance_booking_not_found'],
                ['booking_id', 'fixture_other', 400, 'finance_booking_not_found'],
                ['staff_id', 1, 403, 'finance_reference_not_migrated'],
                ['certificate_id', 1, 403, 'finance_reference_not_migrated'],
                ['category_id', 11, 400, null],
                ['account_id', 11, 400, null]
            ];
            for (const [column, value, status, code] of fixtures) {
                assert.ok(['booking_id', 'staff_id', 'certificate_id', 'category_id', 'account_id'].includes(column));
                const id = (await pool.query(`INSERT INTO finance_transactions(business_context,type,amount,date,${column})
                    VALUES ('dar','expense',321,'2026-09-12',$1) RETURNING id`, [value])).rows[0].id;
                const before = await ledger();
                const updates = [{ amount: 999, description: 'Must not persist' }];
                if (column === 'category_id') updates.push({ amount: 999, categoryId: null });
                if (column === 'account_id') updates.push({ amount: 999, accountId: null });
                for (const update of updates) {
                    const result = await request('PUT', '/transactions/' + id, update);
                    assert.equal(result.status, status, JSON.stringify(result.body));
                    if (code) assert.equal(result.body.code, code);
                }
                assert.deepEqual(await ledger(), before);
            }
        });
        await t.test('payroll-managed transaction protection still rejects generic update and deletion', async () => {
            await pool.query('INSERT INTO payroll_payment_movements(finance_transaction_id) VALUES ($1)', [darTransaction]);
            await pool.query('UPDATE finance_transactions SET staff_id=1 WHERE id=$1', [darTransaction]);
            const before = await ledger();
            for (const method of ['PUT', 'DELETE']) {
                const result = await request(method, '/transactions/' + darTransaction, method === 'PUT' ? { amount: 999 } : undefined);
                assert.equal(result.status, 409, JSON.stringify(result.body));
                assert.equal(result.body.code, 'PAYROLL_PAYMENT_MANAGED');
            }
            assert.deepEqual(await ledger(), before);
        });
        async function waitForBookingLockWait() {
            const deadline = Date.now() + 5000;
            do {
                const waiting = await pool.query(`SELECT pid FROM pg_stat_activity
                    WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'
                        AND query ILIKE '%FROM bookings%' AND pid<>pg_backend_pid()`);
                if (waiting.rowCount) return;
                await new Promise(resolve => setTimeout(resolve, 20));
            } while (Date.now() < deadline);
            assert.fail('Finance request did not reach the observed booking row-lock barrier');
        }
        await t.test('booking-first lock order lets a competing writer finish before finance rereads its row', async () => {
            const id = (await pool.query(`INSERT INTO finance_transactions(business_context,type,amount,date,booking_id)
                VALUES ('event_genix','income',100,'2026-09-12','fixture_park') RETURNING id`)).rows[0].id;
            const writer = await pool.connect();
            let pending;
            try {
                // Model the canonical booking writer's booking -> finance row order with real SQL locks.
                await writer.query('BEGIN');
                await writer.query("SET LOCAL lock_timeout='1500ms'");
                await writer.query("SELECT id FROM bookings WHERE id='fixture_park' FOR UPDATE");
                pending = request('PUT', '/transactions/' + id, { amount: 200 }, 'event_genix');
                await waitForBookingLockWait();
                await writer.query('UPDATE finance_transactions SET amount=155 WHERE id=$1', [id]);
                await writer.query('COMMIT');
                const result = await pending;
                assert.equal(result.status, 200, JSON.stringify(result.body));
                assert.equal((await pool.query('SELECT amount FROM finance_transactions WHERE id=$1', [id])).rows[0].amount, 200);
            } finally {
                await writer.query('ROLLBACK');
                writer.release();
                if (pending) await pending;
            }
        });
        await t.test('concurrent booking-reference change returns conflict without updating the changed transaction', async () => {
            const id = (await pool.query(`INSERT INTO finance_transactions(business_context,type,amount,date,booking_id)
                VALUES ('event_genix','income',100,'2026-09-12','fixture_park') RETURNING id`)).rows[0].id;
            const writer = await pool.connect();
            let pending;
            try {
                await writer.query('BEGIN');
                await writer.query("SET LOCAL lock_timeout='1500ms'");
                await writer.query("SELECT id FROM bookings WHERE id='fixture_park' FOR UPDATE");
                pending = request('PUT', '/transactions/' + id, { amount: 999 }, 'event_genix');
                await waitForBookingLockWait();
                await writer.query("UPDATE finance_transactions SET booking_id='fixture_dar' WHERE id=$1", [id]);
                await writer.query('COMMIT');
                const result = await pending;
                assert.equal(result.status, 409, JSON.stringify(result.body));
                assert.equal(result.body.code, 'finance_transaction_changed');
                assert.deepEqual((await pool.query('SELECT amount,booking_id FROM finance_transactions WHERE id=$1', [id])).rows[0],
                    { amount: 100, booking_id: 'fixture_dar' });
            } finally {
                await writer.query('ROLLBACK');
                writer.release();
                if (pending) await pending;
            }
        });
        await t.test('same JWT immediately observes role revocation and aggregate writes stay read-only', async () => {
            const before = await ledger();
            assert.equal((await request('POST', '/transactions', transaction({}), 'all')).status, 403);
            assert.equal((await request('POST', '/transactions', transaction({}), 'fixture_other')).status, 403);
            await pool.query("UPDATE business_memberships SET role='animator' WHERE business_id=2 AND user_id=1");
            assert.equal((await request('POST', '/transactions', transaction({}))).status, 403);
            await pool.query("UPDATE business_memberships SET role='director',is_active=false WHERE business_id=2 AND user_id=1");
            assert.equal((await request('POST', '/transactions', transaction({}))).status, 403);
            assert.deepEqual(await ledger(), before);
        });
    } finally {
        global.fetch = originalFetch;
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
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
