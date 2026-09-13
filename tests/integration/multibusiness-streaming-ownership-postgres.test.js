'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

const localSocket = process.env.BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST === '1';
const fixtureUrl = process.env.BUSINESS_MEMBERSHIP_TEST_DATABASE_URL;
const FIXTURE_DATE = '2026-09-12';

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

test('fresh streaming access and organization owner safety with actual sockets and PostgreSQL', {
    skip: !localSocket && !fixtureUrl,
    timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const adminPool = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const dbId = require.resolve('../../db');
    const originalDb = require.cache[dbId];
    let pool;
    let server;
    let wsService;
    let auth;
    let created = false;
    const sockets = new Set();
    try {
        await adminPool.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 12, connectionTimeoutMillis: 5000 });
        await pool.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'manager', extra_roles TEXT[] NOT NULL DEFAULT '{}',
                page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
                action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
                business_contexts TEXT[] NOT NULL DEFAULT '{event_genix,dar}',
                default_business_context TEXT DEFAULT 'event_genix', telegram_chat_id TEXT,
                is_active BOOLEAN NOT NULL DEFAULT true, last_seen_at TIMESTAMPTZ
            );
            CREATE TABLE employee_profiles (user_id INT REFERENCES users(id), staff_id INT,
                is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ, department TEXT);
            CREATE TABLE refresh_tokens (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id), revoked_at TIMESTAMPTZ);
            CREATE TABLE tasks (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL,
                owner_user_id INT REFERENCES users(id), assigned_to TEXT, owner TEXT, visibility TEXT DEFAULT 'team');
            CREATE TABLE task_observers (task_id INT REFERENCES tasks(id), user_id INT REFERENCES users(id),
                PRIMARY KEY (task_id, user_id));
            CREATE TABLE bookings (id VARCHAR(50) PRIMARY KEY, business_context TEXT NOT NULL,
                line_id TEXT, second_animator TEXT, created_by TEXT);
            CREATE TABLE chat_channels (id SERIAL PRIMARY KEY, type VARCHAR(20) DEFAULT 'general',
                is_archived BOOLEAN DEFAULT false, linked_booking_id VARCHAR(50),
                linked_entity_type VARCHAR(50), linked_entity_id INTEGER);
            CREATE TABLE chat_channel_members (channel_id INT REFERENCES chat_channels(id),
                user_id INT REFERENCES users(id), PRIMARY KEY (channel_id, user_id));
        `);
        for (const migration of ['204_account_security_personal_cabinet.sql', '357_organizations_business_memberships.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', migration), 'utf8'));
        }
        require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
        auth = require('../../middleware/auth');
        const { lockOrganizationOwnership, assertCanDeactivateOrganizationOwners } = require('../../services/organizationOwnership');
        const { businessScopeWriteGuard } = require('../../middleware/businessScopeGuard');
        const app = express();
        app.use(express.json());
        app.use('/api', auth.authenticateToken, businessScopeWriteGuard);
        app.use('/api/organizations', require('../../routes/organizations'));
        app.use('/api/users', require('../../routes/users'));
        app.use('/api/auth', require('../../routes/auth'));
        app.use((error, req, res, next) => res.status(500).json({ code: 'fixture_unhandled_error' }));
        server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        wsService = require('../../services/websocket');
        wsService.initWebSocket(server);
        const base = `http://127.0.0.1:${server.address().port}`;
        const socketUrl = `ws://127.0.0.1:${server.address().port}/ws`;

        async function request(actor, method, route, body) {
            const response = await fetch(base + route, { method,
                headers: { Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json', Connection: 'close' },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json() };
        }
        async function account(role = 'manager') {
            const user = (await pool.query(`INSERT INTO users (username, name, role)
                VALUES ($1, 'Streaming ownership fixture', $2) RETURNING *`, ['streaming_' + crypto.randomUUID().replaceAll('-', ''), role])).rows[0];
            return { ...user, token: jwt.sign({ ...auth.buildAuthUserPayload(user), sessionIssuedAt: Date.now() }, auth.JWT_SECRET, { expiresIn: '5m' }) };
        }
        async function member(user, { organizationId = 1, businessId = 1, organizationRole = 'member', role = 'manager', isDefault = true } = {}) {
            await pool.query(`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)
                ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [organizationId, user.id, organizationRole]);
            await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
                VALUES ($1, $2, $3, $4, $5)`, [businessId, organizationId, user.id, role, isDefault]);
        }
        async function closeSockets() {
            await Promise.all([...sockets].map(client => new Promise(resolve => {
                if (client.readyState === WebSocket.CLOSED) return resolve();
                client.once('close', resolve);
                client.terminate();
            })));
            for (const client of wsService.getWSS().clients) client.terminate();
            sockets.clear();
        }
        async function reset() {
            await closeSockets();
            await pool.query(`TRUNCATE account_security_events, business_memberships, organization_memberships,
                businesses, organizations, employee_profiles, refresh_tokens, task_observers, tasks,
                chat_channel_members, chat_channels, bookings, users RESTART IDENTITY CASCADE;
                INSERT INTO organizations (id, slug, name) VALUES (1, 'fixture-a', 'Fixture A'), (2, 'fixture-b', 'Fixture B');
                INSERT INTO businesses (id, organization_id, context_key, label, short_label, access_mode, modules) VALUES
                (1, 1, 'event_genix', 'Fixture Park', 'Park', 'membership', '["timeline"]'),
                (2, 1, 'dar', 'Fixture Dar', 'Dar', 'membership', '["timeline"]'),
                (3, 2, 'fixture_other', 'Fixture Other', 'Other', 'membership', '[]')`);
            auth.authenticateToken._activityCache?.clear();
        }
        function waitFor(client, predicate, { allowClosed = false, start = 0 } = {}) {
            const found = client.fixtureMessages.slice(start).find(predicate);
            if (found) return Promise.resolve(found);
            if (allowClosed && client.readyState === WebSocket.CLOSED) return Promise.resolve(null);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => finish(new Error('Timed out waiting for fixture WebSocket completion')), 5000);
                const onMessage = raw => {
                    const message = JSON.parse(raw.toString());
                    if (predicate(message)) finish(null, message);
                };
                const onClose = () => { if (allowClosed) finish(null, null); else finish(new Error('Fixture socket closed before expected message')); };
                function finish(error, value) {
                    clearTimeout(timer);
                    client.off('message', onMessage);
                    client.off('close', onClose);
                    if (error) reject(error); else resolve(value);
                }
                client.on('message', onMessage);
                client.on('close', onClose);
            });
        }
        async function barrier(client) {
            if (client.readyState === WebSocket.CLOSED) return;
            const start = client.fixtureMessages.length;
            const completed = waitFor(client, message => ['pong', 'error'].includes(message.type), { allowClosed: true, start });
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'ping' }));
            await completed;
        }
        async function openSocket(actor) {
            const client = new WebSocket(socketUrl);
            sockets.add(client);
            client.fixtureMessages = [];
            client.on('message', raw => client.fixtureMessages.push(JSON.parse(raw.toString())));
            await new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
            client.send(JSON.stringify({ type: 'auth', token: actor.token }));
            await waitFor(client, message => message.type === 'auth:success');
            client.send(JSON.stringify({ type: 'JOIN_DATE', date: FIXTURE_DATE }));
            await barrier(client);
            return client;
        }
        let eventId = 1000;
        async function booking(client, context, expected) {
            const id = ++eventId;
            const sent = await wsService.broadcastBookingEvent('booking:updated', {
                id, date: FIXTURE_DATE, businessContext: context,
                line_id: '999999', created_by: 'unrelated_fixture_author'
            });
            assert.equal(sent, expected ? 1 : 0, 'Dispatch count for ' + context);
            if (expected) await waitFor(client, message => message.type === 'booking:updated' && message.payload.id === id);
            else await barrier(client);
            const received = client.fixtureMessages.filter(message => message.type === 'booking:updated' && message.payload.id === id);
            assert.equal(received.length, expected ? 1 : 0, 'Wire delivery for ' + context);
            if (expected) assert.deepEqual(Object.keys(received[0].payload).sort(), ['businessContext', 'date', 'eventType', 'id', 'updatedAt']);
        }
        async function event(client, eventType, data, expected, dispatch) {
            const payload = { ...data, fixtureId: ++eventId };
            assert.equal(await dispatch(payload), expected ? 1 : 0, 'Dispatch count for ' + eventType);
            if (expected) await waitFor(client, message => message.type === eventType && message.payload?.fixtureId === payload.fixtureId);
            else await barrier(client);
            const received = client.fixtureMessages.filter(message => message.type === eventType && message.payload?.fixtureId === payload.fixtureId);
            assert.equal(received.length, expected ? 1 : 0, 'Wire delivery for ' + eventType);
            if (expected) assert.deepEqual(received[0].payload, payload);
        }
        async function joinChannel(client, channelId) {
            const start = client.fixtureMessages.length;
            client.send(JSON.stringify({ type: 'CHAT_JOIN', channelId }));
            const message = await waitFor(client, item => item.type === 'error'
                || (item.type === 'chat:joined' && item.payload?.channelId === channelId), { start });
            assert.equal(message.type, 'chat:joined', JSON.stringify(message));
            await barrier(client);
        }
        async function denyChannelCommand(client, channelId, type) {
            const start = client.fixtureMessages.length;
            client.send(JSON.stringify({ type, channelId, businessContext: 'event_genix' }));
            const message = await waitFor(client, item => item.type === 'error'
                || item.type === 'chat:joined' || item.type === 'chat:typing', { start });
            assert.equal(message.type, 'error', JSON.stringify(message));
            assert.equal(message.message, 'Channel access is no longer available');
            await barrier(client);
        }
        async function ownerFixture(twoOwners = false) {
            await reset();
            const creator = await account('creator');
            const first = await account();
            const second = await account();
            await member(creator, { role: 'creator' });
            await member(first, { organizationRole: 'owner' });
            await member(second, { organizationRole: twoOwners ? 'owner' : 'member' });
            return { creator, first, second };
        }
        async function activeOwners(organizationId = 1) {
            return (await pool.query(`SELECT om.user_id FROM organization_memberships om JOIN users u ON u.id = om.user_id
                WHERE om.organization_id = $1 AND om.role = 'owner' AND om.is_active AND u.is_active ORDER BY om.user_id`, [organizationId])).rows.map(row => row.user_id);
        }

        await t.test('an existing socket uses each event business role and immediately observes role changes', async () => {
            await reset();
            const actor = await account('director');
            await member(actor, { role: 'manager' });
            await member(actor, { businessId: 2, role: 'animator', isDefault: false });
            const client = await openSocket(actor);
            await booking(client, 'event_genix', true);
            await booking(client, 'dar', false);
            await pool.query("UPDATE business_memberships SET role = 'manager' WHERE user_id = $1 AND business_id = 2", [actor.id]);
            await booking(client, 'dar', true);
            await pool.query("UPDATE business_memberships SET role = 'animator', extra_roles = '{}' WHERE user_id = $1 AND business_id = 1", [actor.id]);
            await booking(client, 'event_genix', false);
            await booking(client, 'dar', true);
        });

        await t.test('revoked membership and inactive organization stop events on the old socket', async () => {
            await reset();
            const actor = await account();
            await member(actor);
            await member(actor, { businessId: 2, isDefault: false });
            const client = await openSocket(actor);
            await booking(client, 'event_genix', true);
            await pool.query('UPDATE business_memberships SET is_active = false WHERE user_id = $1 AND business_id = 1', [actor.id]);
            await booking(client, 'event_genix', false);
            await booking(client, 'dar', true);
            await pool.query("UPDATE organizations SET status = 'inactive' WHERE id = 1");
            await booking(client, 'dar', false);
        });

        await t.test('session revocation prevents both timeline and direct notifications on the existing connection', async () => {
            await reset();
            const actor = await account();
            await member(actor);
            const client = await openSocket(actor);
            await booking(client, 'event_genix', true);
            const eventType = 'kleshnya:reply';
            // Account transcripts are available only in explicit pre-cutover Park.
            await pool.query("UPDATE businesses SET access_mode = 'compatibility' WHERE id = 1");
            assert.equal(await wsService.sendToUsername(actor.username, eventType, { fixtureId: 'before-revocation', text: 'Fixture reply' }), 1);
            await waitFor(client, message => message.type === eventType && message.payload.fixtureId === 'before-revocation');
            const response = await request(actor, 'POST', '/api/auth/security/revoke-sessions', {});
            assert.equal(response.status, 200, JSON.stringify(response.body));
            await booking(client, 'event_genix', false);
            assert.equal(await wsService.sendToUsername(actor.username, eventType, { fixtureId: 'after-revocation', text: 'Fixture reply' }), 0);
            await barrier(client);
            assert.equal(client.fixtureMessages.some(message => message.type === eventType && message.payload.fixtureId === 'after-revocation'), false);
        });

        await t.test('membership SQL failure denies streaming instead of using the cached socket principal', async () => {
            await reset();
            const actor = await account();
            await member(actor);
            const client = await openSocket(actor);
            await booking(client, 'event_genix', true);
            await pool.query('ALTER TABLE businesses RENAME TO unavailable_businesses');
            try { await booking(client, 'event_genix', false); }
            finally { await pool.query('ALTER TABLE unavailable_businesses RENAME TO businesses'); }
        });

        await t.test('business-scoped Omni dispatch preserves its data envelope and enforces fresh page permission', async () => {
            await reset();
            const actor = await account('director');
            await member(actor, { role: 'manager' });
            await member(actor, { businessId: 2, role: 'animator', isDefault: false });
            const client = await openSocket(actor);
            const eventType = 'omni:conversation';
            const parkData = { fixtureId: ++eventId, businessContext: 'event_genix' };
            assert.equal(await wsService.broadcastBusinessEvent(eventType, parkData, { businessContext: 'event_genix', page: '/omni', envelope: 'data' }), 1);
            const message = await waitFor(client, item => item.type === eventType && item.data?.fixtureId === parkData.fixtureId);
            assert.deepEqual(message.data, parkData);
            assert.equal(Object.hasOwn(message, 'payload'), false);
            const deniedData = { fixtureId: ++eventId, businessContext: 'dar' };
            assert.equal(await wsService.broadcastBusinessEvent(eventType, deniedData, { businessContext: 'dar', page: '/omni', envelope: 'data' }), 0);
            await barrier(client);
            assert.equal(client.fixtureMessages.some(item => item.type === eventType && item.data?.fixtureId === deniedData.fixtureId), false);
            await pool.query("UPDATE business_memberships SET page_allowlist = '{/omni}' WHERE user_id = $1 AND business_id = 2", [actor.id]);
            const allowedData = { fixtureId: ++eventId, businessContext: 'dar' };
            assert.equal(await wsService.broadcastBusinessEvent(eventType, allowedData, { businessContext: 'dar', page: '/omni', envelope: 'data' }), 1);
            await waitFor(client, item => item.type === eventType && item.data?.fixtureId === allowedData.fixtureId);
        });

        await t.test('private task notifications follow current ownership and observer SQL on the existing socket', async () => {
            await reset();
            const actor = await account('director');
            const successor = await account();
            await member(actor, { role: 'animator' });
            await member(successor);
            const task = (await pool.query(`INSERT INTO tasks (business_context, owner_user_id, visibility)
                VALUES ('event_genix', $1, 'private') RETURNING id`, [actor.id])).rows[0];
            const client = await openSocket(actor);
            const send = payload => wsService.sendToUser(actor.id, 'task:assigned', payload);
            await event(client, 'task:assigned', { task: { id: task.id } }, true, send);
            await pool.query('UPDATE tasks SET owner_user_id = $1 WHERE id = $2', [successor.id, task.id]);
            await event(client, 'task:assigned', { task: { id: task.id } }, false, send);
            await pool.query('INSERT INTO task_observers (task_id, user_id) VALUES ($1, $2)', [task.id, actor.id]);
            await event(client, 'task:assigned', { task: { id: task.id } }, true, send);
            await pool.query('DELETE FROM task_observers WHERE task_id = $1 AND user_id = $2', [task.id, actor.id]);
            await event(client, 'task:assigned', { task: { id: task.id } }, false, send);
        });

        await t.test('schedule notifications resolve canonical task business without a client context hint', async () => {
            await reset();
            const actor = await account('director');
            await member(actor, { role: 'animator' });
            const task = (await pool.query(`INSERT INTO tasks (business_context, owner_user_id, visibility)
                VALUES ('dar', $1, 'private') RETURNING id`, [actor.id])).rows[0];
            const client = await openSocket(actor);
            const send = payload => wsService.sendToUser(actor.id, 'task:schedule_changed', payload);
            const data = { task: { id: task.id }, change: 'rescheduled' };
            await event(client, 'task:schedule_changed', data, false, send);
            await member(actor, { businessId: 2, role: 'animator', isDefault: false });
            await event(client, 'task:schedule_changed', data, true, send);
            await event(client, 'task:schedule_changed', { ...data, businessContext: 'event_genix' }, false, send);
            await pool.query('UPDATE business_memberships SET is_active = false WHERE business_id = 2 AND user_id = $1', [actor.id]);
            await event(client, 'task:schedule_changed', data, false, send);
        });

        await t.test('department task SQL uses the event membership role and current department with privacy intact', async () => {
            await reset();
            const actor = await account('director');
            const colleague = await account();
            await member(actor, { role: 'manager' });
            await member(colleague);
            await pool.query(`INSERT INTO employee_profiles (user_id, department)
                VALUES ($1, 'fixture-sales'), ($2, 'fixture-sales')`, [actor.id, colleague.id]);
            const task = (await pool.query(`INSERT INTO tasks (business_context, owner_user_id, visibility)
                VALUES ('event_genix', $1, 'team') RETURNING id`, [colleague.id])).rows[0];
            const client = await openSocket(actor);
            const send = payload => wsService.sendToUser(actor.id, 'task:slot_missed', payload);
            const data = { task: { id: task.id } };
            await event(client, 'task:slot_missed', data, true, send);
            await pool.query("UPDATE employee_profiles SET department = 'fixture-other' WHERE user_id = $1", [colleague.id]);
            await event(client, 'task:slot_missed', data, false, send);
            await pool.query("UPDATE employee_profiles SET department = 'fixture-sales' WHERE user_id = $1", [colleague.id]);
            await pool.query("UPDATE tasks SET visibility = 'private' WHERE id = $1", [task.id]);
            await event(client, 'task:slot_missed', data, false, send);
            await pool.query('INSERT INTO task_observers (task_id, user_id) VALUES ($1, $2)', [task.id, actor.id]);
            await event(client, 'task:slot_missed', data, true, send);
        });

        await t.test('channel delivery rechecks actual membership and archive state after a successful socket join', async () => {
            await reset();
            await pool.query("UPDATE businesses SET access_mode = 'compatibility' WHERE id = 1");
            const actor = await account();
            await member(actor);
            const channelId = (await pool.query("INSERT INTO chat_channels (type) VALUES ('general') RETURNING id")).rows[0].id;
            await pool.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2)', [channelId, actor.id]);
            const client = await openSocket(actor);
            await joinChannel(client, channelId);
            const send = payload => wsService.broadcastToChannel(channelId, 'chat:message', payload);
            const data = { channelId, message: { content: 'Disposable fixture message' } };
            await event(client, 'chat:message', data, true, send);
            await pool.query('DELETE FROM chat_channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, actor.id]);
            await event(client, 'chat:message', data, false, send);
            await pool.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2)', [channelId, actor.id]);
            await event(client, 'chat:message', data, true, send);
            await pool.query('UPDATE chat_channels SET is_archived = true WHERE id = $1', [channelId]);
            await event(client, 'chat:message', data, false, send);
        });

        await t.test('both booking channel link fields enforce the canonical booking business and role', async () => {
            await reset();
            const actor = await account('director');
            await member(actor, { role: 'manager' });
            await pool.query(`INSERT INTO bookings (id, business_context, line_id, created_by) VALUES
                ('1001', 'event_genix', '999999', 'unrelated_fixture_author'),
                ('1002', 'dar', '999999', 'unrelated_fixture_author');
                INSERT INTO chat_channels (id, type, linked_booking_id, linked_entity_type, linked_entity_id) VALUES
                (1, 'booking', '1001', NULL, NULL), (2, 'booking', NULL, 'booking', 1001)`);
            await pool.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES (1, $1), (2, $1)', [actor.id]);
            const client = await openSocket(actor);
            for (const channelId of [1, 2]) await joinChannel(client, channelId);
            async function delivery(expected) {
                for (const channelId of [1, 2]) {
                    await event(client, 'chat:message', { channelId, message: { content: 'Linked fixture message' } }, expected,
                        payload => wsService.broadcastToChannel(channelId, 'chat:message', payload));
                }
            }
            await delivery(true);
            await pool.query("UPDATE bookings SET business_context = 'dar' WHERE id = '1001'");
            await delivery(false);
            await member(actor, { businessId: 2, role: 'animator', isDefault: false });
            await delivery(false);
            await pool.query("UPDATE business_memberships SET role = 'manager' WHERE business_id = 2 AND user_id = $1", [actor.id]);
            await delivery(true);
            await pool.query("UPDATE chat_channels SET linked_entity_type = 'booking', linked_entity_id = 1002 WHERE id = 1");
            await event(client, 'chat:message', { channelId: 1 }, false,
                payload => wsService.broadcastToChannel(1, 'chat:message', payload));
            await pool.query('UPDATE chat_channels SET linked_entity_id = NULL WHERE id = 2');
            await event(client, 'chat:message', { channelId: 2 }, false,
                payload => wsService.broadcastToChannel(2, 'chat:message', payload));
        });

        await t.test('embedded booking previews cannot disclose another business through an accessible general channel', async () => {
            await reset();
            await pool.query("UPDATE businesses SET access_mode = 'compatibility' WHERE id = 1");
            const actor = await account();
            await member(actor);
            await pool.query(`INSERT INTO bookings (id, business_context, line_id, created_by) VALUES
                ('1001', 'event_genix', '999999', 'unrelated_fixture_author'),
                ('1002', 'dar', '999999', 'unrelated_fixture_author');
                INSERT INTO chat_channels (id, type) VALUES (1, 'general')`);
            await pool.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES (1, $1)', [actor.id]);
            const client = await openSocket(actor);
            await joinChannel(client, 1);
            const send = payload => wsService.broadcastToChannel(1, 'chat:booking-preview', payload);
            await event(client, 'chat:booking-preview', { channelId: 1, bookingPreview: { id: '1001' } }, true, send);
            await event(client, 'chat:booking-preview', { channelId: 1, bookingPreview: { id: '1002' } }, false, send);
            for (const metadata of [
                { bookingPreview: { id: '1002' } }, JSON.stringify({ bookingPreview: { id: '1002' } })
            ]) {
                await event(client, 'chat:booking-preview', { channelId: 1,
                    bookingPreview: { id: '1001' }, message: { metadata } }, false, send);
            }
            await event(client, 'chat:booking-preview', { channelId: 1,
                message: { metadata: JSON.stringify({ bookingPreview: { id: '1001' } }) } }, true, send);
        });

        await t.test('D05 a joined socket stops unowned broadcasts, mentions, typing and transcripts immediately after cutover', async () => {
            await reset();
            await pool.query("UPDATE businesses SET access_mode = 'compatibility' WHERE id = 1");
            const actor = await account('director');
            await member(actor, { role: 'manager' });
            await member(actor, { businessId: 2, role: 'animator', isDefault: false });
            await pool.query("INSERT INTO chat_channels (id, type) VALUES (1, 'general')");
            await pool.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES (1, $1)', [actor.id]);
            const client = await openSocket(actor);
            await joinChannel(client, 1);
            async function delivery(expected) {
                await event(client, 'chat:message', { channelId: 1, businessContext: 'event_genix' }, expected,
                    payload => wsService.broadcastToChannel(1, 'chat:message', payload));
                await event(client, 'chat:mention', { channelId: 1 }, expected,
                    payload => wsService.sendToUser(actor.id, 'chat:mention', payload));
                for (const eventType of ['kleshnya:thinking', 'kleshnya:reply', 'kleshnya:media']) {
                    await event(client, eventType, { text: 'Disposable fixture transcript', businessContext: 'event_genix' }, expected,
                        payload => wsService.sendToUsername(actor.username, eventType, payload));
                }
            }
            await delivery(true);
            await pool.query("UPDATE businesses SET access_mode = 'membership' WHERE id = 1");
            await delivery(false);
            await denyChannelCommand(client, 1, 'CHAT_JOIN');
            await denyChannelCommand(client, 1, 'CHAT_TYPING');
            await pool.query("UPDATE business_memberships SET role = 'director' WHERE business_id = 2 AND user_id = $1", [actor.id]);
            await delivery(false);
            await pool.query('UPDATE business_memberships SET is_active = false WHERE user_id = $1', [actor.id]);
            await delivery(false);
            await pool.query("UPDATE businesses SET access_mode = 'compatibility' WHERE id = 1");
            await pool.query("UPDATE organizations SET status = 'inactive' WHERE id = 1");
            await delivery(false);
            await pool.query("UPDATE organizations SET status = 'active' WHERE id = 1");
            await pool.query("UPDATE businesses SET status = 'inactive' WHERE id = 1");
            await delivery(false);
            assert.equal(client.readyState, WebSocket.OPEN, 'Same JWT connection remains authenticated; business availability alone denies delivery');
        });

        await t.test('D05 stored default, not normalized account fallback or event hints, controls unowned socket delivery', async () => {
            await reset();
            await pool.query("UPDATE businesses SET access_mode = 'compatibility' WHERE id = 1");
            const actor = await account('creator');
            await pool.query("UPDATE users SET business_contexts = '{event_genix}' WHERE id = $1", [actor.id]);
            await pool.query("INSERT INTO chat_channels (id, type) VALUES (1, 'general')");
            await pool.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES (1, $1)', [actor.id]);
            const client = await openSocket(actor);
            await joinChannel(client, 1);
            async function delivery(expected) {
                await event(client, 'chat:message', { channelId: 1, businessContext: 'event_genix' }, expected,
                    payload => wsService.broadcastToChannel(1, 'chat:message', payload));
                await event(client, 'kleshnya:reply', { text: 'Disposable fixture reply', businessContext: 'event_genix' }, expected,
                    payload => wsService.sendToUsername(actor.username, 'kleshnya:reply', payload));
            }
            await delivery(true);
            for (const context of [null, '', 'all', 'crm', 'maysternya_doli', 'dar', 'fixture_other']) {
                await pool.query('UPDATE users SET default_business_context = $1 WHERE id = $2', [context, actor.id]);
                await delivery(false);
                await denyChannelCommand(client, 1, 'CHAT_JOIN');
                await denyChannelCommand(client, 1, 'CHAT_TYPING');
            }
            await pool.query("UPDATE users SET default_business_context = 'event_genix' WHERE id = $1", [actor.id]);
            await delivery(true);
            await member(actor, { role: 'director' });
            await member(actor, { businessId: 2, role: 'animator', isDefault: false });
            await member(actor, { organizationId: 2, businessId: 3, role: 'manager', isDefault: false });
            await pool.query("UPDATE businesses SET access_mode = 'membership' WHERE id = 1");
            for (const context of ['event_genix', 'dar', 'fixture_other']) {
                await pool.query('UPDATE users SET default_business_context = $1 WHERE id = $2', [context, actor.id]);
                await delivery(false);
                await denyChannelCommand(client, 1, 'CHAT_JOIN');
                await denyChannelCommand(client, 1, 'CHAT_TYPING');
            }
            assert.equal(client.readyState, WebSocket.OPEN, 'Two-organization/custom denial does not need session expiry');
        });

        await t.test('presence dispatch requires current membership in a shared active organization', async () => {
            await reset();
            const actor = await account();
            const colleague = await account();
            const outsider = await account();
            await member(actor);
            await member(colleague);
            await member(outsider, { organizationId: 2, businessId: 3 });
            const client = await openSocket(actor);
            const send = payload => wsService.sendToUser(actor.id, 'user:status', payload);
            await event(client, 'user:status', { userId: colleague.id, status: 'online' }, true, send);
            await event(client, 'user:status', { userId: outsider.id, status: 'online' }, false, send);
            await pool.query('UPDATE organization_memberships SET is_active = false WHERE user_id = $1', [colleague.id]);
            await event(client, 'user:status', { userId: colleague.id, status: 'online' }, false, send);
            await pool.query('UPDATE organization_memberships SET is_active = true WHERE user_id = $1', [colleague.id]);
            await pool.query("UPDATE organizations SET status = 'inactive' WHERE id = 1");
            await event(client, 'user:status', { userId: colleague.id, status: 'online' }, false, send);
        });

        await t.test('account deactivation API cannot remove the last effective active organization owner', async () => {
            const { creator, first } = await ownerFixture();
            const denied = await request(creator, 'PATCH', `/api/users/${first.id}/active`, { isActive: false });
            assert.equal(denied.status, 409, JSON.stringify(denied.body));
            assert.equal(denied.body.code, 'organization_last_owner');
            assert.deepEqual(await activeOwners(), [first.id]);
            assert.equal((await pool.query('SELECT is_active FROM users WHERE id = $1', [first.id])).rows[0].is_active, true);
        });

        await t.test('an allowed account deactivation closes its old socket and preserves another owner', async () => {
            const { creator, first, second } = await ownerFixture(true);
            const client = await openSocket(first);
            await booking(client, 'event_genix', true);
            const deactivated = await request(creator, 'PATCH', `/api/users/${first.id}/active`, { isActive: false });
            assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));
            await booking(client, 'event_genix', false);
            await barrier(client);
            assert.equal(client.readyState, WebSocket.CLOSED);
            assert.deepEqual(await activeOwners(), [second.id]);
        });

        await t.test('account disable and owner demotion serialize against the same effective-owner invariant', async () => {
            const { creator, first, second } = await ownerFixture(true);
            const responses = await Promise.all([
                request(creator, 'PATCH', `/api/users/${first.id}/active`, { isActive: false }),
                request(creator, 'PUT', `/api/organizations/1/members/${second.id}`, { businessId: 1, organizationRole: 'member' })
            ]);
            assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
            assert.equal(responses.find(row => row.status === 409).body.code, 'organization_last_owner');
            assert.equal((await activeOwners()).length, 1);
        });

        await t.test('concurrent successor promotion and owner disable never commit an ownerless organization', async () => {
            const { creator, first, second } = await ownerFixture();
            const [disable, promote] = await Promise.all([
                request(creator, 'PATCH', `/api/users/${first.id}/active`, { isActive: false }),
                request(creator, 'PUT', `/api/organizations/1/members/${second.id}`, { businessId: 1, organizationRole: 'owner' })
            ]);
            assert.equal(promote.status, 200, JSON.stringify(promote.body));
            assert.ok([200, 409].includes(disable.status), JSON.stringify(disable.body));
            if (disable.status === 409) assert.equal(disable.body.code, 'organization_last_owner');
            assert.ok((await activeOwners()).includes(second.id));
        });

        await t.test('the canonical bulk deactivation guard rejects the entire owner batch before SQL updates', async () => {
            const { first, second } = await ownerFixture(true);
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await lockOrganizationOwnership(client);
                await assert.rejects(async () => {
                    await assertCanDeactivateOrganizationOwners(client, [first.id, second.id]);
                    await client.query('UPDATE users SET is_active = false WHERE id = ANY($1::int[])', [[first.id, second.id]]);
                }, error => error.code === 'organization_last_owner' && error.statusCode === 409);
                await client.query('ROLLBACK');
            } finally { client.release(); }
            assert.deepEqual(await activeOwners(), [first.id, second.id]);
        });

        await t.test('deactivating an owner shared by organizations checks every affected organization', async () => {
            const { first, second } = await ownerFixture(true);
            await member(first, { organizationId: 2, businessId: 3, organizationRole: 'owner' });
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await assert.rejects(assertCanDeactivateOrganizationOwners(client, [first.id]), error => error.code === 'organization_last_owner');
                await client.query('ROLLBACK');
                await member(second, { organizationId: 2, businessId: 3, organizationRole: 'owner' });
                await client.query('BEGIN');
                await lockOrganizationOwnership(client);
                await assertCanDeactivateOrganizationOwners(client, [first.id]);
                await client.query('UPDATE users SET is_active = false WHERE id = $1', [first.id]);
                await client.query('COMMIT');
            } finally { client.release(); }
            assert.deepEqual(await activeOwners(1), [second.id]);
            assert.deepEqual(await activeOwners(2), [second.id]);
        });
    } finally {
        for (const client of sockets) client.terminate();
        if (wsService?.getWSS()) {
            for (const client of wsService.getWSS().clients) client.terminate();
            await new Promise(resolve => wsService.getWSS().close(resolve));
        }
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
                await adminPool.query(`DROP DATABASE "${database}"`);
                assert.equal((await adminPool.query('SELECT datname FROM pg_database WHERE datname = $1', [database])).rowCount, 0);
            }
        } finally { await adminPool.end(); }
    }
});
