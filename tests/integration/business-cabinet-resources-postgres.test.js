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

test('business cabinet resources and graduation use actual HTTP auth and PostgreSQL partition/module boundaries', {
    skip: !localSocket && !fixtureUrl, timeout: 180000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_cabinet_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_cabinet_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const dbId = require.resolve('../../db');
    const originalDb = require.cache[dbId];
    let pool, server, auth;
    let created = false;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 8, connectionTimeoutMillis: 5000 });
        await pool.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY, username TEXT UNIQUE, name TEXT, role TEXT DEFAULT 'creator',
                extra_roles TEXT[] DEFAULT '{}', page_allowlist TEXT[] DEFAULT '{}', page_denylist TEXT[] DEFAULT '{}',
                action_allowlist TEXT[] DEFAULT '{}', action_denylist TEXT[] DEFAULT '{}',
                business_contexts TEXT[] DEFAULT '{event_genix,dar}', default_business_context TEXT DEFAULT 'fixture_studio',
                telegram_chat_id TEXT, telegram_username TEXT, is_active BOOLEAN DEFAULT true,
                session_revoked_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ);
            CREATE TABLE employee_profiles (user_id INT, staff_id INT, is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);
            CREATE TABLE staff (id SERIAL PRIMARY KEY, name TEXT, telegram_username TEXT, telegram_id TEXT, is_active BOOLEAN DEFAULT true);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE lines_by_date (business_context TEXT, line_id TEXT, name TEXT, color TEXT);
            CREATE TABLE admin_audit_log (id SERIAL PRIMARY KEY, action TEXT, category TEXT,
                username TEXT, target TEXT, details JSONB, ip_address TEXT, request_id TEXT);
            CREATE TABLE graduation_services (id SERIAL PRIMARY KEY, business_context TEXT, is_active BOOLEAN, sort_order INT);
            CREATE TABLE graduation_packages (id SERIAL PRIMARY KEY, business_context TEXT, is_active BOOLEAN);
            CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, business_context TEXT, domain TEXT,
                category TEXT, menu_section TEXT, sort_order INT, is_active BOOLEAN, price NUMERIC);
            CREATE TABLE price_rules (id SERIAL PRIMARY KEY, product_id TEXT, code TEXT, name TEXT, value NUMERIC,
                unit TEXT, category TEXT, effective_from DATE, updated_at TIMESTAMPTZ, updated_by TEXT);
            CREATE TABLE product_stock_requirements (product_id TEXT, stock_id INT);
        `);
        for (const migration of ['239_timeline_resource_multi_cabinet_engine.sql', '357_organizations_business_memberships.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', migration), 'utf8'));
        }
        require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
        auth = require('../../middleware/auth');
        const resources = require('../../services/timelineResources');
        const app = express();
        app.use(express.json());
        app.use('/api', require('../../middleware/apiAuthBoundary').apiAuthBoundary(auth.authenticateToken));
        app.use('/api', require('../../middleware/businessScopeGuard').businessScopeWriteGuard);
        app.use('/api/timeline', require('../../routes/timeline-resources'));
        app.use('/api/graduation', require('../../routes/graduation'));
        app.use('/api/products', require('../../routes/products'));
        let productQueries = 0;
        let graduationQueries = 0;
        const originalQuery = pool.query.bind(pool);
        pool.query = function trackedQuery(sql, ...args) {
            if (/FROM products p\b/i.test(typeof sql === 'string' ? sql : sql?.text || '')) productQueries += 1;
            if (/FROM graduation_packages\b/i.test(typeof sql === 'string' ? sql : sql?.text || '')) graduationQueries += 1;
            return originalQuery(sql, ...args);
        };
        server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        async function reset() {
            await pool.query(`TRUNCATE timeline_resources, admin_audit_log, employee_profiles, staff,
                graduation_services, graduation_packages, products, price_rules, product_stock_requirements,
                business_memberships, organization_memberships, businesses, organizations, users RESTART IDENTITY CASCADE;
                INSERT INTO organizations (id, slug, name) VALUES (1, 'cabinet-a', 'Cabinet A'), (2, 'cabinet-b', 'Cabinet B');
                INSERT INTO businesses (id, organization_id, context_key, label, short_label, access_mode, modules) VALUES
                    (1,1,'event_genix','Registry Park','Park','membership','["timeline","graduation"]'),
                    (2,1,'dar','Registry Dar','Dar','membership','["timeline"]'),
                    (3,1,'fixture_studio','Registry Studio','Studio','membership','["timeline"]'),
                    (4,2,'fixture_other','Other Studio','Other','membership','["timeline"]');
                INSERT INTO users (id,username,name) VALUES (1,'cabinet_fixture','Cabinet Fixture');
                INSERT INTO organization_memberships (organization_id,user_id,role) VALUES (1,1,'owner');
                INSERT INTO business_memberships (business_id,organization_id,user_id,role,is_default) VALUES
                    (1,1,1,'director',false),(2,1,1,'director',false),(3,1,1,'director',true);`);
            auth.authenticateToken._activityCache?.clear();
            const user = (await pool.query('SELECT * FROM users WHERE id=1')).rows[0];
            return jwt.sign({ ...auth.buildAuthUserPayload(user), sessionIssuedAt: Date.now() }, auth.JWT_SECRET, { expiresIn: '5m' });
        }
        async function request(token, route, method = 'GET', body) {
            const response = await fetch(base + route, { method,
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                ...(body ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json() };
        }
        async function init(context, commit = true) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await resources.initializeTimelineResources(client, context);
                await client.query(commit ? 'COMMIT' : 'ROLLBACK');
                return result;
            } catch (error) { await client.query('ROLLBACK'); throw error; }
            finally { client.release(); }
        }
        async function rows() { return (await pool.query('SELECT * FROM timeline_resources ORDER BY id')).rows; }

        await t.test('GET resources, availability and mode lines leave empty businesses unchanged', async () => {
            const token = await reset();
            for (const context of ['fixture_studio', 'dar', 'event_genix']) {
                const list = await request(token, `/api/timeline/resources?type=cabinet&businessContext=${context}`);
                assert.equal(list.status, 200);
                assert.deepEqual(list.body.resources, []);
                const availability = await request(token, `/api/timeline/resources/availability?date=2026-09-12&time=10:00&businessContext=${context}`);
                assert.equal(availability.status, 200);
                assert.equal(availability.body.total, 0);
                assert.deepEqual(await resources.timelineResourceLinesForMode(pool, context, 'education'), []);
            }
            assert.deepEqual(await rows(), []);
        });

        await t.test('custom resource writes and omitted-context reads stay in that business partition', async () => {
            const token = await reset();
            const saved = await request(token, '/api/timeline/resources', 'POST', { type: 'cabinet', resourceId: 'fixture-room', name: 'Studio Room' });
            assert.equal(saved.status, 201);
            assert.equal(saved.body.resource.businessContext, 'fixture_studio');
            const list = await request(token, '/api/timeline/resources?type=cabinet');
            assert.equal(list.status, 200);
            assert.equal(list.body.resources[0].name, 'Studio Room');
            assert.equal((await request(token, '/api/timeline/resources?type=cabinet&businessContext=event_genix')).body.resources.length, 0);
            assert.equal((await request(token, '/api/timeline/resources?businessContext=fixture_other')).status, 403);
            assert.deepEqual((await rows()).map(row => row.business_context), ['fixture_studio']);
        });

        await t.test('same JWT immediately loses timeline module, role and membership permissions', async () => {
            const token = await reset();
            await pool.query("UPDATE businesses SET modules='[]' WHERE id=3");
            assert.equal((await request(token, '/api/timeline/resources')).status, 403);
            assert.equal((await request(token, '/api/timeline/resources', 'POST', { name: 'Denied' })).status, 403);
            await pool.query("UPDATE businesses SET modules='[\"timeline\"]' WHERE id=3; UPDATE business_memberships SET role='animator' WHERE business_id=3");
            assert.equal((await request(token, '/api/timeline/resources', 'POST', { name: 'Denied' })).status, 403);
            await pool.query('UPDATE business_memberships SET is_active=false WHERE business_id=3');
            assert.equal((await request(token, '/api/timeline/resources?businessContext=fixture_studio')).status, 403);
            assert.deepEqual(await rows(), []);
        });

        await t.test('explicit initializer is idempotent and preserves edited/inactive resources', async () => {
            await reset();
            assert.equal((await init('dar')).created, 4);
            await pool.query("UPDATE timeline_resources SET name='Owner Name', is_active=false WHERE business_context='dar' AND resource_id='edu-cabinet-1'");
            const before = await rows();
            assert.equal((await init('dar')).created, 0);
            assert.deepEqual(await rows(), before);
            assert.ok(before.every(row => row.business_context === 'dar'));
        });

        await t.test('concurrent initialization serializes and rollback leaves no partial defaults', async () => {
            await reset();
            const results = await Promise.all([init('dar'), init('dar')]);
            assert.equal(results.reduce((sum, result) => sum + result.created, 0), 4);
            assert.equal((await rows()).length, 4);
            assert.equal((await init('event_genix', false)).created, 4);
            assert.ok((await rows()).every(row => row.business_context === 'dar'));
        });

        await t.test('custom initializer has no guessed names, capacities or Park seed', async () => {
            await reset();
            const result = await init('fixture_studio');
            assert.equal(result.created, 0);
            assert.ok(result.resourceTypes.every(item => item.status === 'no_defaults'));
            assert.deepEqual(await rows(), []);
        });

        await t.test('custom graduation is consistently unavailable with explicit/omitted context and configured unsupported module', async () => {
            const token = await reset();
            for (const modules of ['["timeline"]', '["graduation"]']) {
                await pool.query('UPDATE businesses SET modules=$1::jsonb WHERE id=3', [modules]);
                for (const suffix of ['', '?businessContext=fixture_studio']) {
                    const result = await request(token, '/api/graduation/services' + suffix);
                    assert.equal(result.status, 403);
                    assert.equal(result.body.code, 'graduation_business_context_unavailable');
                    assert.equal(result.body.businessContext, 'fixture_studio');
                }
            }
        });

        await t.test('Park graduation reads its own services and immediate disable denies the same JWT', async () => {
            const token = await reset();
            await pool.query("INSERT INTO graduation_services (business_context,is_active,sort_order) VALUES ('event_genix',true,1),('dar',true,1)");
            const allowed = await request(token, '/api/graduation/services?businessContext=event_genix');
            assert.equal(allowed.status, 200);
            assert.equal(allowed.body.length, 1);
            assert.equal(allowed.body[0].businessContext, 'event_genix');
            await pool.query("UPDATE businesses SET modules='[]' WHERE id=1");
            assert.equal((await request(token, '/api/graduation/services?businessContext=event_genix')).status, 403);
        });

        await t.test('actual products handler uses the fresh module registry and disables the same JWT before domain SQL', async () => {
            const token = await reset();
            await pool.query(`UPDATE businesses SET modules='["timeline","programs"]' WHERE id IN (1,2,3);
                INSERT INTO products (id,name,business_context,category,is_active,sort_order) VALUES
                    ('park-product','Park Product','event_genix','custom',true,1),
                    ('studio-product','Studio Product','fixture_studio','custom',true,1),
                    ('other-product','Other Product','fixture_other','custom',true,1)`);
            const allowed = await request(token, '/api/products');
            assert.equal(allowed.status, 200);
            assert.deepEqual(allowed.body.map(item => item.id), ['studio-product']);
            await pool.query("UPDATE businesses SET modules='[]' WHERE id=3");
            productQueries = 0;
            for (const url of ['/api/products', '/api/products?businessContext=fixture_studio', '/api/PRODUCTS']) {
                const blocked = await request(token, url);
                assert.equal(blocked.status, 403);
                assert.equal(blocked.body.code, 'business_module_disabled');
                assert.equal(blocked.body.module, 'programs');
            }
            assert.equal(productQueries, 0);
            await pool.query("UPDATE businesses SET modules='[\"programs\"]' WHERE id=3");
            assert.equal((await request(token, '/api/products')).status, 200);
        });

        await t.test('product catalog graduation projection follows its own module without leaking disabled counts', async () => {
            const token = await reset();
            await pool.query(`UPDATE businesses SET modules='["programs","graduation"]' WHERE id IN (1,3);
                INSERT INTO graduation_packages (business_context,is_active) VALUES
                    ('event_genix',true),('event_genix',false),('dar',true),('fixture_studio',true)`);
            const allowed = await request(token, '/api/products/catalogs?businessContext=event_genix');
            assert.equal(allowed.status, 200);
            assert.equal(allowed.body.catalogs[0].id, 'graduation');
            assert.equal(allowed.body.catalogs[0].pageCount, 1);
            assert.equal(allowed.body.legacyCatalogs.available, false);
            for (const modules of ['["programs"]', '[]']) {
                await pool.query('UPDATE businesses SET modules=$1::jsonb WHERE id=1', [modules]);
                graduationQueries = 0;
                const disabled = await request(token, '/api/products/catalogs?businessContext=event_genix');
                assert.equal(disabled.status, modules === '[]' ? 403 : 200);
                if (disabled.status === 200) assert.deepEqual(disabled.body.catalogs, []);
                assert.equal(graduationQueries, 0);
            }
            graduationQueries = 0;
            const unsupported = await request(token, '/api/products/catalogs');
            assert.equal(unsupported.status, 200);
            assert.deepEqual(unsupported.body.catalogs, []);
            assert.equal(graduationQueries, 0);
        });

        await t.test('aggregate products require every selected module in one organization; foreign organization and writes deny before SQL', async () => {
            const token = await reset();
            await pool.query(`UPDATE businesses SET modules='["programs"]';
                INSERT INTO organization_memberships (organization_id,user_id,role) VALUES (2,1,'owner');
                INSERT INTO business_memberships (business_id,organization_id,user_id,role) VALUES (4,2,1,'director');
                INSERT INTO products (id,name,business_context,category,is_active,sort_order) VALUES
                    ('park-product','Park Product','event_genix','custom',true,1),
                    ('studio-product','Studio Product','fixture_studio','custom',true,1),
                    ('other-product','Other Product','fixture_other','custom',true,1)`);
            const missingActive = await request(token, '/api/products?businessScope=multi&businessContexts=event_genix,fixture_studio');
            assert.equal(missingActive.status, 403);
            assert.equal(missingActive.body.code, 'business_context_required');
            const sameOrg = '/api/products?businessContext=fixture_studio&businessScope=multi&businessContexts=event_genix,fixture_studio';
            const allowed = await request(token, sameOrg);
            assert.equal(allowed.status, 200);
            assert.deepEqual(allowed.body.map(item => item.id).sort(), ['park-product', 'studio-product']);
            productQueries = 0;
            assert.equal((await request(token, '/api/products?businessContext=fixture_studio&businessScope=multi&businessContexts=fixture_studio,fixture_other')).status, 403);
            assert.equal((await request(token, sameOrg, 'POST', { name: 'Denied Aggregate' })).status, 403);
            assert.equal(productQueries, 0);
            await pool.query("UPDATE businesses SET modules='[]' WHERE id=1");
            const disabled = await request(token, sameOrg);
            assert.equal(disabled.status, 403);
            assert.equal(disabled.body.code, 'business_module_disabled');
            assert.equal(disabled.body.businessContext, 'event_genix');
            assert.equal(productQueries, 0);
            const otherOwnBusiness = await request(token, '/api/products?businessContext=fixture_other');
            assert.equal(otherOwnBusiness.status, 200);
            assert.deepEqual(otherOwnBusiness.body.map(item => item.id), ['other-product']);
        });
    } finally {
        if (server) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        if (auth?.authenticateToken._activityCleanup) clearInterval(auth.authenticateToken._activityCleanup);
        if (originalDb) require.cache[dbId] = originalDb;
        else delete require.cache[dbId];
        if (pool) await pool.end();
        try {
            if (created) {
                await admin.query(`DROP DATABASE "${database}"`);
                assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
            }
        } finally { await admin.end(); }
    }
});
