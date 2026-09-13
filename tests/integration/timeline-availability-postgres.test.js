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

test('actual availability HTTP routes hide private details while preserving busy slots with PostgreSQL', {
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
        app.use('/api', require('../../routes/settings'));
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

        await pool.query(`
            CREATE TABLE customers (id INT PRIMARY KEY, business_context TEXT, name TEXT);
            CREATE TABLE banquet_groups (id TEXT PRIMARY KEY, business_context TEXT, status TEXT,
                primary_booking_id TEXT, customer_id INT);
            CREATE TABLE banquet_group_bookings (booking_id TEXT, business_context TEXT, group_id TEXT, role TEXT);
        `);
        async function reset({ parkRole = 'animator', darRole = 'director', darOnly = false } = {}) {
            await pool.query(`TRUNCATE bookings, timeline_resources, settings, customers, banquet_groups,
                banquet_group_bookings, employee_profiles, staff, business_memberships,
                organization_memberships, businesses, organizations, users RESTART IDENTITY CASCADE;
                INSERT INTO organizations (id, slug, name) VALUES (1, 'availability-a', 'Availability A'), (2, 'availability-b', 'Availability B');
                INSERT INTO businesses (id, organization_id, context_key, label, short_label, access_mode, modules) VALUES
                (1, 1, 'event_genix', 'Fixture Park', 'Park', 'membership', '["timeline"]'),
                (2, 1, 'dar', 'Fixture Dar', 'Dar', 'membership', '["timeline"]'),
                (3, 2, 'fixture_other', 'Fixture Other', 'Other', 'membership', '["timeline"]');
                INSERT INTO settings (key, value) VALUES ('timeline_display:event_genix', '{"mode":"park"}'),
                ('timeline_display:dar', '{"mode":"park"}');
                INSERT INTO timeline_resources (business_context, resource_id, type, name, capacity) VALUES
                ('event_genix', 'shared-room', 'room', 'Park room', 8),
                ('dar', 'shared-room', 'room', 'Dar room', 8);
                INSERT INTO customers VALUES (11, 'event_genix', 'Private Park customer'), (12, 'dar', 'Private Dar customer');
                INSERT INTO bookings (id, business_context, date, time, line_id, room_resource_id, room,
                    label, program_name, customer_id, created_by, duration, kids_count) VALUES
                ('park-private', 'event_genix', '2026-09-12', '10:00', 'shared-room', 'shared-room', 'Park room',
                    'Private Park label', 'Private Park program', 11, 'unrelated', 60, 5),
                ('dar-private', 'dar', '2026-09-12', '10:00', 'shared-room', 'shared-room', 'Dar room',
                    'Private Dar label', 'Private Dar program', 12, 'unrelated', 60, 5),
                ('foreign-private', 'fixture_other', '2026-09-12', '10:00', 'shared-room', 'shared-room', 'Dar room',
                    'Private foreign label', 'Private foreign program', NULL, 'unrelated', 60, 5);
                INSERT INTO banquet_groups VALUES ('park-group', 'event_genix', 'active', 'park-private', 11),
                    ('dar-group', 'dar', 'active', 'dar-private', 12);
                INSERT INTO banquet_group_bookings VALUES ('park-private', 'event_genix', 'park-group', 'primary'),
                    ('dar-private', 'dar', 'dar-group', 'primary');`);
            auth.authenticateToken._activityCache?.clear();
            const actor = (await pool.query("INSERT INTO users (username, name, role) VALUES ($1, 'Availability fixture', 'creator') RETURNING *",
                ['availability_' + crypto.randomUUID().replaceAll('-', '')])).rows[0];
            await pool.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (1, $1, 'member')", [actor.id]);
            if (!darOnly) await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role)
                VALUES (1, 1, $1, $2)`, [actor.id, parkRole]);
            await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
                VALUES (2, 1, $1, $2, true)`, [actor.id, darRole]);
            actor.token = jwt.sign({ ...auth.buildAuthUserPayload(actor), sessionIssuedAt: Date.now() },
                auth.JWT_SECRET, { expiresIn: '5m' });
            return actor;
        }
        function availabilityPath(context = '', time = '10:30', settings = false, capacity = 1) {
            return (settings ? `/api/rooms/free/2026-09-12/${time}/30?` :
                `/api/timeline/resources/availability?type=room&date=2026-09-12&time=${time}&duration=30&`)
                + `capacity=${capacity}` + (context ? '&businessContext=' + context : '');
        }
        function resource(response, settings = false) {
            assert.equal(response.status, 200);
            return settings ? response.body.rooms[0] : response.body.resources[0];
        }
        function assertOpaque(entries, time = '10:00', duration = 60) {
            assert.deepEqual(entries, [{ time, duration, unavailable: true }]);
        }

        await t.test('both real HTTP consumers hide a Park booking yet preserve occupancy and capacity', async () => {
            const actor = await reset();
            for (const settings of [false, true]) {
                const response = await request(actor, 'GET', availabilityPath('event_genix', '10:30', settings, 9));
                const room = resource(response, settings);
                assert.equal(room.occupied, true);
                assert.equal(room.capacityAvailable, false);
                assert.deepEqual(response.body.free, []);
                assert.deepEqual(response.body.occupied, ['Park room']);
                assertOpaque(room.bookings);
                assertOpaque(room.dayBookings);
                assert.doesNotMatch(JSON.stringify(response.body), /park-private|Private|customerId|banquetGroup|kidsCount|resourceBlock/);
                if (settings) assertOpaque(response.body.dayBookingsByRoom['Park room']);
            }
        });

        await t.test('Dar default membership retains authorized details through both routes without Park or foreign rows', async () => {
            const actor = await reset({ darOnly: true });
            for (const settings of [false, true]) {
                const response = await request(actor, 'GET', availabilityPath('', '10:30', settings));
                const room = resource(response, settings);
                assert.equal(room.bookings[0].id, 'dar-private');
                assert.equal(room.dayBookings[0].customerName, 'Private Dar customer');
                assert.equal(room.dayBookings[0].banquetGroupId, 'dar-group');
                assert.equal(room.dayBookings[0].banquetGroupPrimaryBookingId, 'dar-private');
                assert.doesNotMatch(JSON.stringify(response.body), /Park|park-private|foreign-private/);
                assert.equal((await request(actor, 'GET', availabilityPath('event_genix', '10:30', settings))).status, 403);
            }
        });

        await t.test('non-room availability binds canonical visibility without an unused room-name parameter', async () => {
            const actor = await reset();
            await pool.query(`UPDATE timeline_resources SET type = 'cabinet' WHERE business_context = 'dar';
                UPDATE settings SET value = '{"mode":"education"}' WHERE key = 'timeline_display:dar';`);
            for (const settings of [false, true]) {
                const route = availabilityPath('dar', '10:30', settings).replace('type=room', 'type=cabinet');
                const visible = await request(actor, 'GET', route);
                assert.equal(resource(visible).bookings[0].id, 'dar-private');
            }
            await pool.query("UPDATE business_memberships SET role = 'animator' WHERE user_id = $1 AND business_id = 2", [actor.id]);
            for (const settings of [false, true]) {
                const route = availabilityPath('dar', '10:30', settings).replace('type=room', 'type=cabinet');
                assertOpaque(resource(await request(actor, 'GET', route)).bookings);
            }
        });

        await t.test('same JWT role downgrade, capability deny, and membership revocation apply before every read', async () => {
            const actor = await reset();
            assert.equal(resource(await request(actor, 'GET', availabilityPath('dar'))).bookings[0].id, 'dar-private');
            await pool.query("UPDATE business_memberships SET role = 'animator' WHERE user_id = $1 AND business_id = 2", [actor.id]);
            assertOpaque(resource(await request(actor, 'GET', availabilityPath('dar'))).bookings);
            await pool.query("UPDATE business_memberships SET role = 'director', action_denylist = '{view_all}' WHERE user_id = $1 AND business_id = 2", [actor.id]);
            assertOpaque(resource(await request(actor, 'GET', availabilityPath('dar', '10:30', true)), true).bookings);
            await pool.query("UPDATE business_memberships SET is_active = false WHERE user_id = $1 AND business_id = 2", [actor.id]);
            assert.equal((await request(actor, 'GET', availabilityPath('dar'))).status, 403);
            assert.equal((await request(actor, 'GET', availabilityPath('event_genix'))).status, 200);
        });

        await t.test('canonical created-by and durable staff assignment expose only the permitted row', async () => {
            const actor = await reset({ darRole: 'animator' });
            await pool.query("UPDATE bookings SET created_by = $1 WHERE id = 'dar-private'", [actor.username]);
            assert.equal(resource(await request(actor, 'GET', availabilityPath('dar'))).dayBookings[0].id, 'dar-private');
            await pool.query("UPDATE bookings SET created_by = 'unrelated', second_animator = '71' WHERE id = 'dar-private'");
            await pool.query("INSERT INTO employee_profiles (user_id, staff_id) VALUES ($1, 71)", [actor.id]);
            assert.equal(resource(await request(actor, 'GET', availabilityPath('dar'))).bookings[0].id, 'dar-private');
            assertOpaque(resource(await request(actor, 'GET', availabilityPath('event_genix'))).bookings);
            await pool.query('UPDATE employee_profiles SET is_active = false WHERE user_id = $1', [actor.id]);
            assertOpaque(resource(await request(actor, 'GET', availabilityPath('dar'))).bookings);
        });

        await t.test('hidden day summaries and linked children preserve exact interval collision boundaries', async () => {
            const actor = await reset({ darRole: 'animator' });
            await pool.query(`INSERT INTO bookings (id, business_context, date, time, duration, line_id, room_resource_id,
                room, label, created_by, linked_to) VALUES ('dar-child', 'dar', '2026-09-12', '12:00', 60,
                'shared-room', 'shared-room', 'Dar room', 'Private linked child', 'unrelated', 'dar-private');
                INSERT INTO bookings (id, business_context, date, time, duration, line_id, room_resource_id, status)
                VALUES ('dar-cancelled', 'dar', '2026-09-12', '11:00', 60, 'shared-room', 'shared-room', 'cancelled');`);
            const free = await request(actor, 'GET', availabilityPath('dar', '11:00'));
            assert.deepEqual(free.body.free, ['Dar room']);
            assertOpaque(resource(free).dayBookings);
            const child = await request(actor, 'GET', availabilityPath('dar', '12:00'));
            assert.equal(resource(child).occupied, true);
            assertOpaque(resource(child).bookings, '12:00');
            assertOpaque(resource(child).dayBookings);
            assert.deepEqual((await request(actor, 'GET', availabilityPath('dar', '13:00'))).body.free, ['Dar room']);
        });

        await t.test('poisoned historical foreign joins cannot expose customer labels or banquet details', async () => {
            const actor = await reset({ parkRole: 'director' });
            await pool.query(`UPDATE bookings SET customer_id = 12 WHERE id = 'park-private';
                UPDATE banquet_group_bookings SET group_id = 'dar-group' WHERE booking_id = 'park-private';`);
            const visible = resource(await request(actor, 'GET', availabilityPath('event_genix')));
            assert.equal(visible.dayBookings[0].id, 'park-private');
            assert.equal(visible.dayBookings[0].customerName, 'Private Park label');
            assert.equal(visible.dayBookings[0].banquetGroupId, null);
            assert.equal(visible.dayBookings[0].banquetGroupPrimaryBookingId, null);
            await pool.query("UPDATE business_memberships SET role = 'animator' WHERE user_id = $1 AND business_id = 1", [actor.id]);
            assertOpaque(resource(await request(actor, 'GET', availabilityPath('event_genix'))).dayBookings);
        });

        await t.test('missing actor and another active business never grant detail visibility in direct service calls', async () => {
            const actor = await reset();
            const { timelineResourceAvailability } = require('../../services/timelineResources');
            const { loadMembershipAccess, applyMembershipAccess } = require('../../services/businessMembership');
            const darActor = applyMembershipAccess(actor, await loadMembershipAccess(pool, actor, 'dar'));
            for (const serviceActor of [undefined, darActor]) {
                const result = await timelineResourceAvailability(pool, { actor: serviceActor, context: 'event_genix',
                    type: 'room', date: '2026-09-12', time: '10:30', duration: 30 });
                assertOpaque(result.resources[0].bookings);
                assert.equal(result.resources[0].occupied, true);
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
