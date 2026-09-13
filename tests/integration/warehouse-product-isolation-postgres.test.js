'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const express = require('express');
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

test('warehouse intake references and product fallback with actual disposable PostgreSQL', {
    skip: !localSocket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const ids = ['../../db', '../../services/telegram', '../../middleware/auth',
        '../../services/warehousePhotoIntake', '../../routes/products'].map(require.resolve);
    const previous = new Map(ids.map(id => [id, require.cache[id]]));
    let pool;
    let server;
    let created = false;
    const forbiddenProvider = () => { throw new Error('External provider access is forbidden in this fixture'); };
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        assert.equal(new URL(url).hostname, '127.0.0.1', 'Only the loopback fixture HTTP server may be accessed');
        return originalFetch(url, options);
    };
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 3, connectionTimeoutMillis: 5000 });
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
            CREATE TABLE catalog_definitions (id TEXT PRIMARY KEY, name TEXT, emoji TEXT, description TEXT, status TEXT,
                page_count INT, sort_order INT, is_active BOOLEAN DEFAULT true);
            CREATE TABLE catalog_pages (id SERIAL PRIMARY KEY, catalog_id TEXT, is_active BOOLEAN DEFAULT true);
            CREATE TABLE catalog_items (id SERIAL PRIMARY KEY, catalog_id TEXT, status TEXT);
            CREATE TABLE graduation_packages (id SERIAL PRIMARY KEY, business_context TEXT, is_active BOOLEAN DEFAULT true);
        `);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/221_warehouse_photo_intake.sql'), 'utf8'));
        const install = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports }; };
        install(ids[0], { pool });
        install(ids[1], { downloadTelegramFileById: forbiddenProvider, getTelegramBotConfigStatus: forbiddenProvider });
        install(ids[2], { authenticateToken: (req, res, next) => next(),
            requireRole: () => (req, res, next) => next(), requireAction: () => (req, res, next) => next() });
        delete require.cache[ids[3]];
        delete require.cache[ids[4]];
        const intake = require(ids[3]);
        const app = express();
        app.use((req, res, next) => {
            req.user = { id: 42, username: 'fixture_member', role: 'creator', business_contexts: ['event_genix'], default_business_context: 'event_genix' };
            next();
        });
        app.use('/api/products', require(ids[4]));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        await pool.query("INSERT INTO warehouse_locations (id,business_context) VALUES (11,'event_genix'),(12,'dar')");
        await pool.query("INSERT INTO warehouse_stock (id,business_context,name,category,unit,quantity,location_id) VALUES (11,'event_genix','Fixture Park','craft','шт',10,11),(12,'dar','Fixture Dar','craft','шт',20,12)");

        async function draft(extra = {}, candidates = []) {
            return (await pool.query(`INSERT INTO warehouse_photo_intakes (dedupe_key,draft,match_candidates)
                VALUES ($1,$2,$3) RETURNING id`, [crypto.randomUUID(),
                { name: 'Fixture intake', category: 'craft', unit: 'шт', quantity: 3, ...extra }, JSON.stringify(candidates)])).rows[0].id;
        }
        async function snapshot(id) {
            return { stocks: (await pool.query('SELECT id,business_context,quantity FROM warehouse_stock ORDER BY id')).rows,
                history: (await pool.query('SELECT * FROM warehouse_history ORDER BY id')).rows,
                movements: (await pool.query('SELECT * FROM warehouse_stock_movements ORDER BY id')).rows,
                intake: (await pool.query('SELECT * FROM warehouse_photo_intakes WHERE id=$1', [id])).rows };
        }
        await t.test('foreign explicit and cached-match stock IDs never mutate either business', async () => {
            for (const cached of [false, true]) {
                const id = await draft({}, cached ? [{ stockId: 12, score: 0.99 }] : []);
                const before = await snapshot(id);
                const result = await intake.confirmIntake(id, { actor: 'fixture', businessContext: 'event_genix', ...(cached ? {} : { warehouseStockId: 12 }) });
                assert.deepEqual(result, { success: false, status: 404, error: 'target_stock_not_found' });
                assert.deepEqual(await snapshot(id), before);
            }
        });
        await t.test('foreign draft location is rejected without creating or modifying stock', async () => {
            const id = await draft({ locationId: 12 });
            const before = await snapshot(id);
            assert.deepEqual(await intake.confirmIntake(id, { actor: 'fixture', businessContext: 'event_genix' }),
                { success: false, status: 404, error: 'target_location_not_found' });
            assert.deepEqual(await snapshot(id), before);
        });
        await t.test('corrupt same-business stock with foreign location is rejected before its quantity changes', async () => {
            await pool.query('UPDATE warehouse_stock SET location_id=12 WHERE id=11');
            const id = await draft();
            const before = await snapshot(id);
            assert.deepEqual(await intake.confirmIntake(id, { actor: 'fixture', businessContext: 'event_genix', warehouseStockId: 11 }),
                { success: false, status: 404, error: 'target_location_not_found' });
            assert.deepEqual(await snapshot(id), before);
            await pool.query('UPDATE warehouse_stock SET location_id=11 WHERE id=11');
        });
        await t.test('nonlegacy context cannot assign a globally owned intake to Dar', async () => {
            const id = await draft();
            const before = await snapshot(id);
            assert.deepEqual(await intake.confirmIntake(id, { actor: 'fixture', businessContext: 'dar', warehouseStockId: 12 }),
                { success: false, status: 403, error: 'warehouse_photo_intake_not_migrated' });
            assert.deepEqual(await snapshot(id), before);
        });
        await t.test('legacy Park restock records explicit ownership and preserves Dar quantity', async () => {
            const id = await draft();
            const result = await intake.confirmIntake(id, { actor: 'fixture', businessContext: 'event_genix', warehouseStockId: 11 });
            assert.equal(result.success, true);
            const after = await snapshot(id);
            assert.equal(after.stocks.find(row => row.id === 11).quantity, 13);
            assert.equal(after.stocks.find(row => row.id === 12).quantity, 20);
            assert.equal(after.history[0].business_context, 'event_genix');
            assert.equal(after.movements[0].business_context, 'event_genix');
            assert.equal(after.intake[0].status, 'confirmed');
        });
        await t.test('new legacy stock ignores database ownership defaults and scopes every durable write', async () => {
            const id = await draft({ locationId: 11 });
            const result = await intake.confirmIntake(id, { actor: 'fixture', businessContext: 'event_genix' });
            assert.equal(result.success, true);
            assert.equal((await pool.query('SELECT business_context FROM warehouse_stock WHERE id=$1', [result.stockId])).rows[0].business_context, 'event_genix');
            assert.equal((await pool.query('SELECT business_context FROM warehouse_history WHERE id=$1', [result.historyId])).rows[0].business_context, 'event_genix');
            assert.equal((await pool.query('SELECT business_context FROM warehouse_stock_movements WHERE id=$1', [result.movementId])).rows[0].business_context, 'event_genix');
        });
        await t.test('actual product catalog query excludes Dar and foreign-organization package counts', async () => {
            await pool.query("INSERT INTO graduation_packages (business_context,is_active) VALUES ('event_genix',true),('event_genix',false),('dar',true),('fixture_other_org',true)");
            const response = await fetch(base + '/api/products/catalogs');
            assert.equal(response.status, 200);
            const payload = await response.json();
            assert.equal(payload.catalogs[0].pageCount, 1);
            assert.equal(payload.catalogs[0].itemCount, 1);
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
