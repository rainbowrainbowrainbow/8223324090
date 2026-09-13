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

test('actual booking and timeline HTTP routes preserve membership context with PostgreSQL', {
    skip: !localSocket && !fixtureUrl,
    timeout: 180000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const dbId = require.resolve('../../db');
    const originalDb = require.cache[dbId];
    let pool;
    let server;
    let auth;
    let created = false;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 8, connectionTimeoutMillis: 5000 });
        await pool.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'animator', extra_roles TEXT[] NOT NULL DEFAULT '{}',
                page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
                action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
                business_contexts TEXT[] NOT NULL DEFAULT '{event_genix,dar}', default_business_context TEXT DEFAULT 'dar',
                telegram_chat_id TEXT, telegram_username TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
                session_revoked_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ
            );
            CREATE TABLE employee_profiles (user_id INT REFERENCES users(id), staff_id INT,
                is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);
            CREATE TABLE staff (id SERIAL PRIMARY KEY, name TEXT, telegram_username TEXT, telegram_id TEXT,
                is_active BOOLEAN DEFAULT true);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE bookings (
                id VARCHAR(50) PRIMARY KEY, business_context TEXT NOT NULL, date TEXT, time TEXT, line_id TEXT,
                program_id TEXT, program_code TEXT, label TEXT, program_name TEXT, category TEXT,
                duration INT, price NUMERIC, hosts INT, second_animator TEXT, pinata_filler TEXT, pinata_mode TEXT,
                pinata_number TEXT, pinata_filler_number TEXT, client_pinata_service_price NUMERIC,
                client_pinata_service_note TEXT, costume TEXT, room TEXT, room_resource_id TEXT, notes TEXT,
                created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
                linked_to TEXT, status TEXT DEFAULT 'confirmed', kids_count INT, group_name TEXT, extra_data JSONB,
                skip_notification BOOLEAN, customer_id INT, payment_method TEXT, certificate_id INT,
                confirmed_at TIMESTAMPTZ, confirmed_by INT, confirmation_note TEXT, confirmation_source TEXT,
                banquet_guests INT, banquet_adults INT, banquet_tables INT, banquet_menu JSONB
            );
            CREATE TABLE products (id TEXT PRIMARY KEY, business_context TEXT, timeline_code TEXT);
            CREATE TABLE booking_banquet_links (id SERIAL PRIMARY KEY, business_context TEXT,
                booking_a_id TEXT, booking_b_id TEXT, relation_type TEXT, label TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(), created_by TEXT);
            CREATE TABLE lines_by_date (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL,
                date TEXT, line_id TEXT, name TEXT, color TEXT, from_sheet BOOLEAN);
            CREATE TABLE admin_audit_log (id SERIAL PRIMARY KEY, action TEXT, category TEXT,
                username TEXT, target TEXT, details JSONB, ip_address TEXT, request_id TEXT);
        `);
        for (const migration of ['239_timeline_resource_multi_cabinet_engine.sql', '357_organizations_business_memberships.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', migration), 'utf8'));
        }
        require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
        auth = require('../../middleware/auth');
        const { apiAuthBoundary } = require('../../middleware/apiAuthBoundary');
        const { businessScopeWriteGuard } = require('../../middleware/businessScopeGuard');
        const app = express();
        app.use(express.json());
        // Match the real server's authentication and aggregate-write boundary order.
        app.use('/api', apiAuthBoundary(auth.authenticateToken));
        app.use('/api', businessScopeWriteGuard);
        app.use('/api/bookings', require('../../routes/bookings'));
        app.use('/api/lines', require('../../routes/lines'));
        app.use('/api/timeline', require('../../routes/timeline-resources'));
        server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        async function request(actor, method, route, body, headers = {}) {
            const response = await fetch(base + route, { method,
                headers: { Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json', ...headers },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            return { status: response.status, body: await response.json() };
        }
        async function reset({ parkRole = 'animator', darRole = 'director', darOnly = false } = {}) {
            await pool.query(`TRUNCATE bookings, products, booking_banquet_links, timeline_resources,
                lines_by_date, admin_audit_log, employee_profiles, staff, business_memberships,
                organization_memberships, businesses, organizations, users RESTART IDENTITY CASCADE;
                INSERT INTO organizations (id, slug, name) VALUES (1, 'timeline-a', 'Timeline A'), (2, 'timeline-b', 'Timeline B');
                INSERT INTO businesses (id, organization_id, context_key, label, short_label, access_mode, modules) VALUES
                (1, 1, 'event_genix', 'Fixture Park', 'Park', 'membership', '["timeline"]'),
                (2, 1, 'dar', 'Fixture Dar', 'Dar', 'membership', '["timeline"]'),
                (3, 2, 'fixture_other', 'Fixture Other', 'Other', 'membership', '["timeline"]');
                INSERT INTO bookings (id, business_context, date, time, line_id, label, created_by, duration, price, hosts) VALUES
                ('park-private', 'event_genix', '2026-09-12', '12:00', '999', 'Park private', 'other', 60, 0, 1),
                ('dar-private', 'dar', '2026-09-12', '12:00', '999', 'Dar private', 'other', 60, 0, 1),
                ('other-private', 'fixture_other', '2026-09-12', '12:00', '999', 'Other private', 'other', 60, 0, 1);
                INSERT INTO timeline_resources (business_context, resource_id, type, name) VALUES
                ('event_genix', 'shared-resource', 'cabinet', 'Park resource'),
                ('dar', 'shared-resource', 'cabinet', 'Dar resource');`);
            auth.authenticateToken._activityCache?.clear();
            const actor = (await pool.query("INSERT INTO users (username, name, role) VALUES ($1, 'Timeline fixture', 'creator') RETURNING *",
                ['timeline_' + crypto.randomUUID().replaceAll('-', '')])).rows[0];
            await pool.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (1, $1, 'member')", [actor.id]);
            if (!darOnly) await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role)
                VALUES (1, 1, $1, $2)`, [actor.id, parkRole]);
            await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
                VALUES (2, 1, $1, $2, true)`, [actor.id, darRole]);
            actor.token = jwt.sign({ ...auth.buildAuthUserPayload(actor), sessionIssuedAt: Date.now() },
                auth.JWT_SECRET, { expiresIn: '5m' });
            return actor;
        }
        async function dataSnapshot() {
            return (await pool.query(`SELECT
                (SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY id), '[]') FROM bookings b) AS bookings,
                (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id), '[]') FROM timeline_resources r) AS resources,
                (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM lines_by_date l) AS lines`)).rows[0];
        }

        await t.test('default Dar detail and day reads use its membership without Park role lending', async () => {
            const actor = await reset();
            const detail = await request(actor, 'GET', '/api/bookings/detail/dar-private');
            assert.equal(detail.status, 200);
            assert.equal(detail.body.booking.businessContext, 'dar');
            assert.equal((await request(actor, 'GET', '/api/bookings/detail/park-private')).status, 404);
            assert.equal((await request(actor, 'GET', '/api/bookings/detail/park-private?businessContext=event_genix')).status, 404);
            const day = await request(actor, 'GET', '/api/bookings/2026-09-12');
            assert.equal(day.status, 200);
            assert.deepEqual(day.body.map(row => row.id), ['dar-private']);
        });

        await t.test('Dar-only account has timeline resources and lines without an implicit Park grant', async () => {
            const actor = await reset({ darOnly: true });
            const resources = await request(actor, 'GET', '/api/timeline/resources');
            assert.equal(resources.status, 200);
            assert.equal(resources.body.context, 'dar');
            assert.deepEqual(resources.body.resources.map(row => row.name), ['Dar resource']);
            const lines = await request(actor, 'GET', '/api/lines/2026-09-12');
            assert.equal(lines.status, 200);
            assert.ok(lines.body.every(row => row.businessContext === 'dar'));
            assert.equal((await request(actor, 'GET', '/api/bookings/detail/park-private?businessContext=park')).status, 403);
        });

        await t.test('Park aliases resolve the Park membership and same-role foreign business IDs remain hidden', async () => {
            const actor = await reset({ parkRole: 'director' });
            for (const alias of ['event_genix', 'park', 'park_zakrevsky', 'pzp']) {
                const detail = await request(actor, 'GET', '/api/bookings/detail/park-private?businessContext=' + alias);
                assert.equal(detail.status, 200);
                assert.equal(detail.body.booking.businessContext, 'event_genix');
            }
            assert.equal((await request(actor, 'GET', '/api/bookings/detail/other-private?businessContext=dar')).status, 404);
            assert.equal((await request(actor, 'GET', '/api/bookings/detail/other-private?businessContext=fixture_other')).status, 403);
            const link = await request(actor, 'POST', '/api/bookings/park-private/banquet-links?businessContext=park', { targetId: 'dar-private' });
            assert.equal(link.status, 404);
            assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM booking_banquet_links')).rows[0].count, 0);
        });

        await t.test('timeline resource and line settings require the current membership capability', async () => {
            const actor = await reset();
            const updated = await request(actor, 'PUT', '/api/timeline/resources/shared-resource', { name: 'Dar changed', type: 'cabinet' });
            assert.equal(updated.status, 200);
            assert.equal(updated.body.context, 'dar');
            const before = await dataSnapshot();
            for (const [method, route, body] of [
                ['POST', '/api/timeline/resources?businessContext=park', { name: 'Forbidden', type: 'cabinet' }],
                ['PUT', '/api/timeline/resources/shared-resource?businessContext=park', { name: 'Forbidden', type: 'cabinet' }],
                ['DELETE', '/api/timeline/resources/shared-resource?businessContext=park', undefined],
                ['POST', '/api/lines/2026-09-12?businessContext=park', []]
            ]) assert.equal((await request(actor, method, route, body)).status, 403);
            assert.deepEqual(await dataSnapshot(), before);
            await pool.query("UPDATE business_memberships SET role = 'animator' WHERE user_id = $1 AND business_id = 2", [actor.id]);
            assert.equal((await request(actor, 'PUT', '/api/timeline/resources/shared-resource', { name: 'Revoked change' })).status, 403);
            assert.deepEqual(await dataSnapshot(), before);
        });

        await t.test('production aggregate middleware blocks all and multi mutations before domain writes', async () => {
            const actor = await reset({ parkRole: 'director' });
            const before = await dataSnapshot();
            for (const scope of ['businessScope=all', 'businessScope=multi&businessContexts=event_genix,dar']) {
                const suffix = '?businessContext=dar&' + scope;
                for (const [method, route, body] of [
                    ['POST', '/api/bookings', {}], ['PUT', '/api/bookings/dar-private', { notes: 'Forbidden' }],
                    ['PATCH', '/api/bookings/dar-private/payment', { paymentMethod: 'cash' }],
                    ['DELETE', '/api/bookings/dar-private', undefined],
                    ['POST', '/api/lines/2026-09-12', []],
                    ['PUT', '/api/timeline/resources/shared-resource', { name: 'Forbidden' }]
                ]) {
                    const denied = await request(actor, method, route + suffix, body);
                    assert.equal(denied.status, 403);
                    assert.equal(denied.body.code, 'business_scope_read_only');
                }
            }
            assert.deepEqual(await dataSnapshot(), before);
        });

        await t.test('ticket quote uses Dar by default and rejects conflicting membership context before pricing', async () => {
            const actor = await reset();
            const foreign = await request(actor, 'POST', '/api/bookings/ticket-quote', { bookingId: 'park-private' });
            assert.equal(foreign.status, 404);
            assert.equal(foreign.body.code, 'TICKET_BOOKING_NOT_FOUND');
            for (const contextSource of ['header', 'query']) {
                const mismatch = await request(actor, 'POST', '/api/bookings/ticket-quote' + (contextSource === 'query' ? '?businessContext=park' : ''),
                    { bookingId: 'park-private', businessContext: 'dar' }, contextSource === 'header' ? { 'X-Business-Context': 'park' } : {});
                assert.equal(mismatch.status, 403);
                assert.equal(mismatch.body.code, 'business_context_unavailable');
            }
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
                assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname = $1', [database])).rowCount, 0);
            }
        } finally { await admin.end(); }
    }
});
