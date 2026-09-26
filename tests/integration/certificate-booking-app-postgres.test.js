'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const fixture = require('../helpers/certificate-test-database').getCertificateTestDatabase();

test('actual app booking and certificate redemption share one PostgreSQL transaction', {
    skip: !fixture,
    timeout: 240000
}, async () => {
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.equal(process.env.REQUIRE_CERTIFICATE_POSTGRES_TESTS, '1');
    assert.ok(!process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_PROJECT_ID && !process.env.RAILWAY_SERVICE_ID);
    const database = 'eventgenix_certificate_app_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_certificate_app_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...fixture.connection, database: decodeURIComponent(fixture.url.pathname.slice(1)), max: 1 });
    let pool, child, created = false;
    let childOutput = '';
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...fixture.connection, database, max: 4 });
        const port = await new Promise((resolve, reject) => {
            const socket = net.createServer();
            socket.once('error', reject);
            socket.listen(0, '127.0.0.1', () => {
                const port = socket.address().port;
                socket.close(error => error ? reject(error) : resolve(port));
            });
        });
        const username = 'certificate_fixture_' + crypto.randomBytes(5).toString('hex');
        const password = crypto.randomBytes(24).toString('base64url');
        const env = {
            PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: process.env.NODE_PATH,
            LANG: process.env.LANG || 'C.UTF-8', NODE_ENV: 'test', PORT: String(port),
            PGHOST: fixture.connection.host, PGPORT: String(fixture.connection.port),
            PGUSER: fixture.connection.user, PGPASSWORD: fixture.connection.password,
            PGDATABASE: database, PGSSLMODE: 'disable',
            JWT_SECRET: crypto.randomBytes(64).toString('hex'),
            BOOTSTRAP_CREATOR_USERNAME: username, BOOTSTRAP_CREATOR_PASSWORD: password,
            BOOTSTRAP_CREATOR_NAME: 'Certificate Test Creator',
            TELEGRAM_BOT_TOKEN: '', REPORT_BOT_TOKEN: '',
            BACKUP_OUTBOUND_HOLD: 'true', PAYMENT_OUTBOX_WAKEUP_DISABLED: 'true',
            RATE_LIMIT_MAX: '10000', LOGIN_RATE_LIMIT_MAX: '1000'
        };
        child = spawn(process.execPath, ['server.js'], { cwd: require('node:path').resolve(__dirname, '../..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { childOutput = (childOutput + String(chunk)).slice(-12000); });
        const base = `http://127.0.0.1:${port}`;
        let ready = false;
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline && child.exitCode === null) {
            try { if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } }
            catch {}
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        assert.ok(ready, `isolated app failed to start; final log lines: ${childOutput.split('\n').slice(-10).join('\n')}`);
        const creator = (await pool.query('SELECT id, username, role FROM users WHERE username = $1', [username])).rows[0];
        assert.ok(creator);
        const organizationId = (await pool.query(`INSERT INTO organizations (slug, name, status)
            VALUES ('certificate-test-park', 'Certificate Test Park', 'active') RETURNING id`)).rows[0].id;
        const businessId = (await pool.query(`INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules, status)
            VALUES ($1, 'event_genix', 'Certificate Park', 'Park', 'membership', '["timeline","center"]'::jsonb, 'active')
            ON CONFLICT (context_key) DO UPDATE SET organization_id=EXCLUDED.organization_id, access_mode='membership', status='active'
            RETURNING id`, [organizationId])).rows[0].id;
        await pool.query(`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'member')
            ON CONFLICT (organization_id, user_id) DO UPDATE SET is_active=true`, [organizationId, creator.id]);
        await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
            VALUES ($1, $2, $3, 'creator', true) ON CONFLICT (business_id, user_id)
            DO UPDATE SET role='creator', is_active=true, is_default=true`, [businessId, organizationId, creator.id]);
        const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }) });
        const loginBody = await login.json();
        assert.equal(login.status, 200, JSON.stringify(loginBody));
        const token = loginBody.accessToken || loginBody.token;
        assert.ok(token);
        const date = '2099-02-13';
        await pool.query(`INSERT INTO lines_by_date (business_context, date, line_id, name, color, from_sheet)
            VALUES ('event_genix', $1, 'certificate-fixture-line', 'Certificate Fixture Line', '#2563EB', false)`, [date]);
        await pool.query(`INSERT INTO timeline_resources (business_context, resource_id, type, name, is_active)
            VALUES ('event_genix', 'certificate-fixture-room', 'room', 'Certificate Fixture Room', true)`);
        async function certificate() {
            const code = 'CERT-' + crypto.randomBytes(6).toString('hex').toUpperCase();
            return (await pool.query(`INSERT INTO certificates (cert_code, display_mode, display_value, type_text, type_code, valid_until, status)
                VALUES ($1, 'fio', $2, 'на одноразовий вхід', 'one_time_admission', '2099-12-31', 'active') RETURNING id, cert_code`,
            [code, 'Synthetic Recipient ' + code])).rows[0];
        }
        async function request(method, route, body) {
            const response = await fetch(base + route, { method,
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-business-context': 'event_genix' },
                ...(body ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json().catch(() => ({})) };
        }
        async function state(cert) {
            return (await pool.query(`SELECT c.status, c.used_at, (SELECT COUNT(*)::int FROM history
                WHERE action='certificate_used' AND data->>'certificateId'=c.id::text) AS audits
                FROM certificates c WHERE c.id=$1`, [cert.id])).rows[0];
        }
        const booking = cert => ({ businessContext: 'event_genix', date, time: '13:00', duration: 60,
            lineId: 'certificate-fixture-line', room: 'Certificate Fixture Room', roomResourceId: 'certificate-fixture-room',
            label: 'Certificate Fixture Booking', programName: 'Fixture', category: 'custom',
            price: 0, status: 'confirmed', certificateCode: cert.cert_code });

        const cert = await certificate();
        const createdBooking = await request('POST', '/api/bookings', booking(cert));
        assert.equal(createdBooking.status, 200, JSON.stringify(createdBooking.body));
        assert.ok(createdBooking.body.booking?.id, 'the actual app must return the committed booking ID');
        assert.equal((await state(cert)).status, 'used');
        assert.equal((await state(cert)).audits, 1);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM bookings WHERE certificate_id=$1', [cert.id])).rows[0].n, 1);
        const reused = await request('POST', '/api/bookings', booking(cert));
        assert.equal(reused.status, 409, JSON.stringify(reused.body));
        assert.equal((await state(cert)).audits, 1);
        const cancelled = await request('DELETE', `/api/bookings/${encodeURIComponent(createdBooking.body.booking.id)}`);
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal((await pool.query('SELECT status FROM bookings WHERE id=$1', [createdBooking.body.booking.id])).rows[0].status, 'cancelled');
        assert.equal((await state(cert)).status, 'used', 'cancelling a booking must not reactivate its certificate');
        assert.equal((await state(cert)).audits, 1, 'cancelling must not create a second redemption audit');

        const failedCert = await certificate();
        await pool.query("ALTER TABLE bookings ADD CONSTRAINT fixture_reject_certificate_booking CHECK (label <> 'Fixture blocked after redemption') NOT VALID");
        const failedBooking = await request('POST', '/api/bookings', { ...booking(failedCert), time: '15:00', label: 'Fixture blocked after redemption' });
        assert.equal(failedBooking.status, 500, JSON.stringify(failedBooking.body));
        assert.equal((await state(failedCert)).status, 'active');
        assert.equal((await state(failedCert)).audits, 0);
    } finally {
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
            if (child.exitCode === null) child.kill('SIGKILL');
        }
        if (pool) await pool.end();
        try { if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); }
        finally { await admin.end(); }
    }
});
