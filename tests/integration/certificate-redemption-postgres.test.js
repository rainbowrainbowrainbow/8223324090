'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');

// No production connection fallback. Each run owns and removes a new database.
const fixtureUrl = process.env.CERTIFICATE_TEST_DATABASE_URL;
const localSocket = process.env.CERTIFICATE_LOCAL_POSTGRES_TEST === '1';
test('certificate redemption against real PostgreSQL and authenticated HTTP routes', {
    skip: !fixtureUrl && !localSocket, timeout: 90000
}, async t => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.ok(!process.env.RAILWAY_PROJECT_ID && !process.env.RAILWAY_ENVIRONMENT);
    let connection;
    if (localSocket) {
        assert.equal(process.platform, 'linux');
        connection = { host: '/var/run/postgresql', user: 'postgres', database: 'postgres', connectionTimeoutMillis: 5000 };
    } else {
        const url = new URL(fixtureUrl);
        assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
        assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
        assert.match(url.pathname, /(?:^|[_-])(test|testing|ci|disposable)(?:[_-]|$)/i);
        assert.doesNotMatch(url.pathname, /(?:^|[_-])(prod|production|live)(?:[_-]|$)/i);
        assert.notEqual(fixtureUrl, process.env.DATABASE_URL);
        connection = { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
            user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
            database: decodeURIComponent(url.pathname.slice(1)), ssl: false, connectionTimeoutMillis: 5000 };
    }
    const database = 'eventgenix_certificate_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_certificate_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1 });
    const savedCache = new Map(Object.entries(require.cache));
    let pool, server, auth, created = false;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 8 });
        await pool.query(`
            CREATE TABLE users (
                id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'animator', extra_roles TEXT[] NOT NULL DEFAULT '{}',
                page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
                action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
                business_contexts TEXT[] NOT NULL DEFAULT '{event_genix}', default_business_context TEXT,
                telegram_chat_id TEXT, is_active BOOLEAN NOT NULL DEFAULT true,
                session_revoked_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ
            );
            CREATE TABLE employee_profiles (user_id INT, staff_id INT, is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);
            CREATE TABLE certificates (
                id SERIAL PRIMARY KEY, cert_code TEXT UNIQUE NOT NULL, type_text TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active', valid_until DATE NOT NULL,
                used_at TIMESTAMP, updated_at TIMESTAMP, invalidated_at TIMESTAMP, invalid_reason TEXT
            );
            CREATE TABLE history (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL, action TEXT NOT NULL, username TEXT NOT NULL, data JSONB NOT NULL);
            CREATE TABLE certificate_booking_probe (id TEXT PRIMARY KEY, certificate_id INT NOT NULL REFERENCES certificates(id));
        `);
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/357_organizations_business_memberships.sql'), 'utf8'));
        await pool.query(`INSERT INTO organizations (id, slug, name) VALUES (1, 'certificate-fixture', 'Certificate Fixture');
            INSERT INTO businesses (id, organization_id, context_key, label, short_label, access_mode) VALUES
            (1, 1, 'event_genix', 'Fixture Park', 'Park', 'membership'), (2, 1, 'dar', 'Fixture Dar', 'Dar', 'membership');`);
        const dbModule = require.resolve('../../db');
        require.cache[dbModule] = { id: dbModule, filename: dbModule, loaded: true, exports: { pool } };
        auth = require('../../middleware/auth');
        const { redeemCertificateInTransaction } = require('../../services/certificateRedemption');
        const { loadMembershipAccess, applyMembershipAccess } = require('../../services/businessMembership');
        const app = express();
        app.use(express.json());
        app.use('/api/certificates', require('../../routes/certificates'));
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        const base = `http://127.0.0.1:${server.address().port}/api/certificates`;

        async function account(role = 'reception') {
            const user = (await pool.query(`INSERT INTO users (username, name, role, business_contexts, default_business_context)
                VALUES ($1, 'Certificate Fixture', $2, '{event_genix,dar}', 'event_genix') RETURNING *`, ['fixture_' + crypto.randomUUID(), role])).rows[0];
            await pool.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (1, $1, 'member')", [user.id]);
            await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
                VALUES (1, 1, $1, $2, true), (2, 1, $1, $2, false)`, [user.id, role]);
            const token = jwt.sign({ ...auth.buildAuthUserPayload(user), sessionIssuedAt: Date.now() }, auth.JWT_SECRET, { expiresIn: '5m' });
            const actor = applyMembershipAccess(user, await loadMembershipAccess(pool, user, 'event_genix'));
            return { user, token, req: { user: actor, headers: { 'x-business-context': 'event_genix' }, query: {}, body: {} } };
        }
        async function certificate({ status = 'active', days = 0, type = 'на одноразовий вхід' } = {}) {
            return (await pool.query(`INSERT INTO certificates (cert_code, type_text, status, valid_until)
                VALUES ($1, $2, $3, (clock_timestamp() AT TIME ZONE 'Europe/Kyiv')::date + $4::int) RETURNING *`,
            ['CERT-' + crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(), type, status, days])).rows[0];
        }
        async function request(actor, endpoint, method = 'POST', body = {}, context = 'event_genix') {
            const response = await fetch(base + endpoint, { method,
                headers: { Authorization: 'Bearer ' + actor.token, 'Content-Type': 'application/json', 'x-business-context': context },
                ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json() };
        }
        async function persisted(cert) {
            return (await pool.query(`SELECT c.*, (SELECT COUNT(*)::int FROM history WHERE data->>'certificateId' = c.id::text) AS audits
                FROM certificates c WHERE c.id = $1`, [cert.id])).rows[0];
        }
        async function transact(actor, cert, finish = async () => {}) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const result = await redeemCertificateInTransaction(client, actor.req, { code: cert.cert_code, bookingId: 'fixture-booking' });
                await finish(client, result);
                await client.query('COMMIT');
                return result;
            } catch (err) { await client.query('ROLLBACK'); throw err; }
            finally { client.release(); }
        }

        await t.test('two simultaneous HTTP requests produce one success, one conflict and one audit', async () => {
            const actor = await account();
            const cert = await certificate();
            const lookup = await request(actor, '/code/' + cert.cert_code, 'GET');
            assert.equal(lookup.status, 200);
            assert.equal(lookup.body.canRedeem, true);
            assert.equal((await persisted(cert)).audits, 0);
            const outcomes = await Promise.all([request(actor, `/${cert.id}/redeem`), request(actor, `/${cert.id}/redeem`)]);
            assert.deepEqual(outcomes.map(item => item.status).sort(), [200, 409]);
            const row = await persisted(cert);
            assert.equal(row.status, 'used');
            assert.ok(row.used_at);
            assert.equal(row.audits, 1);
            const audit = (await pool.query("SELECT data FROM history WHERE data->>'certificateId' = $1", [String(cert.id)])).rows[0].data;
            assert.equal(audit.actorUserId, actor.user.id);
            assert.equal(audit.actorRole, 'reception');
            assert.equal(audit.businessId, 1);
            assert.equal(audit.oldStatus, 'active');
            assert.equal(audit.newStatus, 'used');
            assert.equal((await request(actor, `/${cert.id}/redeem`)).status, 409);
        });
        await t.test('exact mutation role list; security and animator remain verification-only', async () => {
            for (const role of ['reception', 'admin', 'manager', 'senior_manager', 'vice_director', 'director', 'creator', 'security', 'animator']) {
                const actor = await account(role);
                const cert = await certificate();
                const allowed = !['security', 'animator'].includes(role);
                assert.equal((await request(actor, '/code/' + cert.cert_code, 'GET')).body.canRedeem, allowed, role);
                const result = await request(actor, `/${cert.id}/redeem`);
                assert.equal(result.status, allowed ? 200 : 403, `${role}: ${JSON.stringify(result.body)}`);
                assert.equal((await persisted(cert)).audits, allowed ? 1 : 0);
            }
        });
        await t.test('revoked membership, current role, other business and aggregate scope deny writes', async () => {
            const actor = await account();
            const cert = await certificate();
            for (const context of ['dar', 'all']) assert.equal((await request(actor, `/${cert.id}/redeem`, 'POST', {}, context)).status, 403);
            await pool.query("UPDATE business_memberships SET role = 'security' WHERE user_id = $1 AND business_id = 1", [actor.user.id]);
            await assert.rejects(transact(actor, cert), err => err.code === 'certificate_redemption_denied');
            await pool.query('UPDATE business_memberships SET is_active = false WHERE user_id = $1 AND business_id = 1', [actor.user.id]);
            assert.equal((await request(actor, `/${cert.id}/redeem`)).status, 403);
            await assert.rejects(transact(actor, cert), err => err.code === 'certificate_redemption_denied');
            assert.equal((await persisted(cert)).audits, 0);
        });
        await t.test('expired, blocked, revoked, used and subscription certificates cannot be redeemed', async () => {
            const actor = await account();
            for (const options of [{ days: -1 }, { status: 'blocked' }, { status: 'revoked' }, { status: 'used' }, { status: 'expired' }, { type: 'Абонемент на 10 входів' }]) {
                const cert = await certificate(options);
                assert.equal((await request(actor, `/${cert.id}/redeem`)).status, 409);
                assert.equal((await persisted(cert)).audits, 0);
            }
            assert.equal((await request(actor, '/999999/redeem')).status, 404);
        });
        await t.test('audit failure rolls back consumption', async () => {
            const actor = await account();
            const cert = await certificate();
            await pool.query("ALTER TABLE history ADD CONSTRAINT fixture_reject_audit CHECK (action <> 'certificate_used') NOT VALID");
            try { assert.equal((await request(actor, `/${cert.id}/redeem`)).status, 500); }
            finally { await pool.query('ALTER TABLE history DROP CONSTRAINT fixture_reject_audit'); }
            const row = await persisted(cert);
            assert.equal(row.status, 'active');
            assert.equal(row.used_at, null);
            assert.equal(row.audits, 0);
        });
        await t.test('booking transaction failure rolls back both consumption and audit; successful booking commits both', async () => {
            const actor = await account();
            const cert = await certificate();
            await assert.rejects(transact(actor, cert, client => client.query('INSERT INTO certificate_booking_probe (id, certificate_id) VALUES (NULL, $1)', [cert.id])), err => err.code === '23502');
            assert.equal((await persisted(cert)).status, 'active');
            assert.equal((await persisted(cert)).audits, 0);
            await transact(actor, cert, client => client.query("INSERT INTO certificate_booking_probe (id, certificate_id) VALUES ('fixture-booking', $1)", [cert.id]));
            assert.equal((await persisted(cert)).status, 'used');
            assert.equal((await persisted(cert)).audits, 1);
        });
        await t.test('a status request waiting on redemption cannot reactivate a used certificate', async () => {
            const actor = await account('admin');
            const cert = await certificate();
            const client = await pool.connect();
            let pending;
            try {
                await client.query('BEGIN');
                await redeemCertificateInTransaction(client, actor.req, { id: cert.id });
                pending = request(actor, `/${cert.id}/status`, 'PATCH', { status: 'active' });
                // Observe a real PostgreSQL lock wait, without timing-dependent sleeps.
                let blocked = false;
                const deadline = Date.now() + 5000;
                while (Date.now() < deadline) {
                    const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT * FROM certificates WHERE id = $1%' LIMIT 1");
                    if (result.rowCount) { blocked = true; break; }
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
                assert.ok(blocked, 'PATCH must wait on the certificate row lock');
                await client.query('COMMIT');
                assert.equal((await pending).status, 409);
                assert.equal((await persisted(cert)).status, 'used');
                assert.equal((await persisted(cert)).audits, 1);
            } finally { await client.query('ROLLBACK'); client.release(); if (pending) await pending; }
        });
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (auth?.authenticateToken._activityCleanup) clearInterval(auth.authenticateToken._activityCleanup);
        for (const key of Object.keys(require.cache)) if (!savedCache.has(key)) delete require.cache[key];
        for (const [key, value] of savedCache) require.cache[key] = value;
        if (pool) await pool.end();
        try { if (created) await admin.query(`DROP DATABASE "${database}"`); }
        finally { await admin.end(); }
    }
});
