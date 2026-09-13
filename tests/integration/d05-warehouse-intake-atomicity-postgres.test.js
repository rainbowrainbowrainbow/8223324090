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

test('D05 legacy intake receipt atomicity on disposable PostgreSQL; no tenant certification', {
    skip: !localSocket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const ids = ['../../db', '../../services/telegram', '../../services/warehousePhotoIntake'].map(require.resolve);
    const previous = new Map(ids.map(id => [id, require.cache[id]]));
    const originalFetch = global.fetch;
    const forbiddenProvider = () => { throw new Error('External provider access is forbidden in this fixture'); };
    global.fetch = forbiddenProvider;
    let pool;
    let created = false;
    let afterLocationRead;
    const serviceQueries = [];
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 4, connectionTimeoutMillis: 5000,
            statement_timeout: 15000, idle_in_transaction_session_timeout: 20000 });
        // Relevant stock/location/history columns with real FK behavior; intake tables use migration 221 exactly.
        await pool.query(`
            CREATE TABLE organizations (id INT PRIMARY KEY, status TEXT NOT NULL);
            CREATE TABLE businesses (id INT PRIMARY KEY, organization_id INT REFERENCES organizations(id),
                context_key TEXT UNIQUE NOT NULL, access_mode TEXT NOT NULL, status TEXT NOT NULL);
            INSERT INTO organizations VALUES (1,'active');
            INSERT INTO businesses VALUES (1,1,'event_genix','compatibility','active');
            CREATE TABLE warehouse_locations (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL, is_active BOOLEAN DEFAULT true);
            CREATE TABLE warehouse_stock (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL DEFAULT 'fixture_wrong_default',
                name TEXT, category TEXT, quantity INT DEFAULT 0, min_quantity INT DEFAULT 0, unit TEXT,
                notes TEXT, updated_at TIMESTAMP DEFAULT NOW(), updated_by TEXT, owner TEXT,
                location_id INT REFERENCES warehouse_locations(id), sku TEXT, purchase_unit_price NUMERIC,
                is_procured_externally BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true);
            CREATE TABLE warehouse_history (id SERIAL PRIMARY KEY, stock_id INT REFERENCES warehouse_stock(id),
                change INT, reason TEXT, created_by TEXT, business_context TEXT NOT NULL DEFAULT 'fixture_wrong_default');
            CREATE TABLE warehouse_stock_movements (id SERIAL PRIMARY KEY, warehouse_stock_id INT REFERENCES warehouse_stock(id),
                movement_type TEXT, from_location_id INT REFERENCES warehouse_locations(id), to_location_id INT REFERENCES warehouse_locations(id),
                quantity INT, reason TEXT, created_by TEXT, business_context TEXT NOT NULL DEFAULT 'fixture_wrong_default');
        `);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/221_warehouse_photo_intake.sql'), 'utf8'));
        const servicePool = {
            query: (...args) => { serviceQueries.push(String(args[0])); return pool.query(...args); },
            async connect() {
                const client = await pool.connect();
                return { async query(sql, params) {
                    serviceQueries.push(String(sql));
                    const result = await client.query(sql, params);
                    if (afterLocationRead && /SELECT id FROM warehouse_locations/.test(sql)) await afterLocationRead();
                    return result;
                }, release: () => client.release() };
            }
        };
        const install = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports }; };
        install(ids[0], { pool: servicePool });
        install(ids[1], { downloadTelegramFileById: forbiddenProvider, getTelegramBotConfigStatus: forbiddenProvider });
        delete require.cache[ids[2]];
        const intake = require(ids[2]);
        await pool.query("INSERT INTO warehouse_locations (id,business_context) VALUES (11,'event_genix'),(12,'dar')");
        await pool.query("INSERT INTO warehouse_stock (id,business_context,name,category,unit,quantity,location_id) VALUES (11,'event_genix','Fixture stock','craft','шт',10,11),(12,'dar','Foreign stock','craft','шт',20,12)");
        async function draft(extra = {}) {
            return (await pool.query(`INSERT INTO warehouse_photo_intakes (dedupe_key,draft)
                VALUES ($1,$2) RETURNING id`, [crypto.randomUUID(),
                { name: 'Fixture intake', category: 'craft', unit: 'шт', quantity: 3, ...extra }])).rows[0].id;
        }
        async function snapshot(id) {
            const result = {};
            for (const table of ['warehouse_stock', 'warehouse_history', 'warehouse_stock_movements']) {
                result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
            }
            result.intake = (await pool.query('SELECT * FROM warehouse_photo_intakes WHERE id=$1', [id])).rows;
            return result;
        }
        await t.test('suppressed final receipt rolls back new stock and existing stock changes', async () => {
            await pool.query(`CREATE FUNCTION suppress_intake_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.status = 'confirmed' THEN RETURN NULL; END IF; RETURN NEW; END $$;
                CREATE TRIGGER suppress_intake_receipt BEFORE UPDATE ON warehouse_photo_intakes
                FOR EACH ROW EXECUTE FUNCTION suppress_intake_receipt()`);
            try {
                for (const warehouseStockId of [null, 11]) {
                    const id = await draft({ locationId: 11 });
                    const before = await snapshot(id);
                    const result = await intake.confirmIntake(id, { actor: 'fixture', businessContext: 'event_genix', warehouseStockId });
                    assert.deepEqual(result, { success: false, status: 409, error: 'intake_parent_update_failed' });
                    assert.deepEqual(await snapshot(id), before);
                }
            } finally { await pool.query('DROP TRIGGER suppress_intake_receipt ON warehouse_photo_intakes'); }
        });
        await t.test('a completed receipt links all writes and replay makes no additional changes', async () => {
            const id = await draft({ locationId: 11 });
            const result = await intake.confirmIntake(id, { actor: 'fixture', businessContext: 'event_genix' });
            assert.equal(result.success, true);
            assert.equal(result.intake.id, id);
            assert.equal(result.intake.status, 'confirmed');
            assert.equal(result.intake.confirmedStockId, result.stockId);
            assert.equal(result.intake.confirmedHistoryId, result.historyId);
            assert.equal(result.intake.confirmedMovementId, result.movementId);
            const beforeReplay = await snapshot(id);
            assert.deepEqual(await intake.confirmIntake(id, { actor: 'fixture', businessContext: 'event_genix' }),
                { success: false, status: 409, error: 'intake_already_closed' });
            assert.deepEqual(await snapshot(id), beforeReplay);
        });
        await t.test('concurrent confirmation writes exactly once', async () => {
            const id = await draft();
            const beforeQuantity = (await pool.query('SELECT quantity FROM warehouse_stock WHERE id=11')).rows[0].quantity;
            const results = await Promise.all([1, 2].map(() => intake.confirmIntake(id,
                { actor: 'fixture', businessContext: 'event_genix', warehouseStockId: 11 })));
            assert.equal(results.filter(result => result.success).length, 1);
            assert.equal(results.filter(result => result.error === 'intake_already_closed').length, 1);
            assert.equal((await pool.query('SELECT quantity FROM warehouse_stock WHERE id=11')).rows[0].quantity, beforeQuantity + 3);
        });
        await t.test('location owner and activation cannot change between validation and receipt commit', async () => {
            for (const mutation of ["business_context = 'dar'", 'is_active = false']) {
                const id = await draft({ locationId: 11 });
                let reach;
                const reached = new Promise(resolve => { reach = resolve; });
                let resume;
                const paused = new Promise(resolve => { resume = resolve; });
                afterLocationRead = async () => { afterLocationRead = null; reach(); await paused; };
                const confirmation = intake.confirmIntake(id, { actor: 'fixture', businessContext: 'event_genix' });
                const competitor = await pool.connect();
                let timer;
                let result;
                let conflict;
                try {
                    await Promise.race([reached, new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error('Confirmation did not reach the location barrier')), 5000);
                    })]);
                    clearTimeout(timer);
                    await competitor.query('BEGIN');
                    await competitor.query("SET LOCAL lock_timeout = '500ms'");
                    try { await competitor.query(`UPDATE warehouse_locations SET ${mutation} WHERE id=11`); }
                    catch (error) { conflict = error.code; }
                    await competitor.query('ROLLBACK');
                } finally {
                    clearTimeout(timer);
                    resume();
                    result = await confirmation;
                    afterLocationRead = null;
                    competitor.release();
                }
                assert.equal(conflict, '55P03', 'A real concurrent location UPDATE must wait for the intake transaction');
                assert.equal(result.success, true);
                assert.deepEqual((await pool.query('SELECT business_context,is_active FROM warehouse_locations WHERE id=11')).rows[0],
                    { business_context: 'event_genix', is_active: true });
            }
        });
        await t.test('legacy matching only reads explicit Park stock; foreign and malformed NULL owners are excluded', async () => {
            // Migration227 enforces NOT NULL. This temporary fixture also probes an older/corrupt imported state.
            await pool.query('ALTER TABLE warehouse_stock ALTER COLUMN business_context DROP NOT NULL');
            await pool.query("INSERT INTO warehouse_stock (id,business_context,name,category,unit) VALUES (99,NULL,'Fixture stock','craft','шт')");
            try {
                const matches = await intake.findMatchCandidates({ name: 'Fixture stock', category: 'craft' }, { businessContext: 'event_genix' });
                assert.ok(matches.some(row => row.stockId === 11));
                assert.ok(matches.every(row => row.stockId !== 12 && row.stockId !== 99));
                const owners = await pool.query('SELECT business_context FROM warehouse_stock WHERE id=ANY($1::int[])', [matches.map(row => row.stockId)]);
                assert.ok(owners.rows.every(row => row.business_context === 'event_genix'));
            } finally {
                await pool.query('DELETE FROM warehouse_stock WHERE id=99');
                await pool.query('ALTER TABLE warehouse_stock ALTER COLUMN business_context SET NOT NULL');
            }
        });
        await t.test('duplicate replay and all existing draft operations recheck real registry cutover before reading draft data', async () => {
            const id = await draft();
            await pool.query("UPDATE warehouse_photo_intakes SET dedupe_key='telegram:91:1' WHERE id=$1", [id]);
            const message = { chat: { id: 91 }, message_id: 1, photo: [{ file_id: 'synthetic_file' }] };
            const options = { businessContext: 'event_genix' };
            const duplicate = await intake.createTelegramPhotoIntake(message, options);
            assert.equal(duplicate.ok, true);
            assert.equal(duplicate.duplicate, true);
            assert.equal(duplicate.intake.id, id);
            assert.equal((await intake.getIntake(id, options)).id, id);
            assert.ok((await intake.listIntakes(options)).some(row => row.id === id));
            const before = await snapshot(id);
            await pool.query("UPDATE businesses SET access_mode='membership' WHERE id=1");
            serviceQueries.length = 0;
            try {
                for (const operation of [() => intake.findMatchCandidates({ name: 'Fixture' }, options),
                    () => intake.getIntake(id, options), () => intake.listIntakes(options), () => intake.getIntakeStatus(options)]) {
                    await assert.rejects(operation, error => error.code === 'warehouse_photo_intake_not_migrated' && error.status === 403);
                }
                for (const operation of [() => intake.confirmIntake(id, options), () => intake.cancelIntake(id, options)]) {
                    assert.deepEqual(await operation(), { success: false, status: 403, error: 'warehouse_photo_intake_not_migrated' });
                }
                assert.deepEqual(await intake.createTelegramPhotoIntake(message, options),
                    { ok: false, status: 403, reason: 'warehouse_photo_intake_not_migrated' });
                assert.ok(serviceQueries.every(sql => /FROM businesses/.test(sql)));
                assert.deepEqual(await snapshot(id), before);
            } finally { await pool.query("UPDATE businesses SET access_mode='compatibility' WHERE id=1"); }
        });
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
