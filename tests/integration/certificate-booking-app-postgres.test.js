'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
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

        // A trusted run is the only way to suppress certificate side effects.
        // The test uses the actual app and the same disposable PostgreSQL database.
        const qaUsername = 'qa_certificate_' + crypto.randomBytes(4).toString('hex');
        const qaPassword = crypto.randomBytes(24).toString('base64url');
        const qaAccount = (await pool.query(
            `INSERT INTO users (username, name, role, password_hash, is_active)
             VALUES ($1, 'QA Certificate Fixture', 'admin', $2, true) RETURNING id`,
            [qaUsername, await bcrypt.hash(qaPassword, 10)]
        )).rows[0];
        await pool.query(`INSERT INTO organization_memberships (organization_id, user_id, role)
            VALUES ($1, $2, 'member')`, [organizationId, qaAccount.id]);
        await pool.query(`INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
            VALUES ($1, $2, $3, 'admin', true)`, [businessId, organizationId, qaAccount.id]);
        const qaLogin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: qaUsername, password: qaPassword }) });
        assert.equal(qaLogin.status, 200);
        const qaLoginBody = await qaLogin.json();
        const qaAccessToken = qaLoginBody.accessToken || qaLoginBody.token;
        assert.ok(qaAccessToken);
        const { createTrustedQaRun, cleanupTrustedQaRun } = require('../../services/trustedQaRuns');
        const runId = 'qa-certificate-' + crypto.randomBytes(6).toString('hex');
        const marker = `${runId}:certificate:disposable`;
        const qaRun = await createTrustedQaRun(pool, {
            runId, source: 'trusted_qa', businessContext: 'event_genix',
            operatorUserId: qaAccount.id, requiredOperatorUserId: qaAccount.id,
            requiredUserId: qaAccount.id, testCustomerMarker: marker,
            allowedEndpoints: ['POST /api/certificates'], maxEntityCount: 1, ttlMinutes: 30
        });
        const qaBody = { displayMode: 'fio', displayValue: marker, typeText: 'на одноразовий вхід',
            typeCode: 'one_time_admission', validUntil: '2099-12-31' };
        async function qaRequest(method, route, body, options = {}) {
            const response = await fetch(base + route, { method, headers: {
                Authorization: 'Bearer ' + (options.accessToken || qaAccessToken),
                'Content-Type': 'application/json',
                'x-business-context': options.businessContext || 'event_genix',
                ...(options.qaToken ? { 'X-Disposable-QA-Token': options.qaToken, 'X-QA-Run-Request-Id': options.requestId || crypto.randomUUID() } : {})
            }, ...(body ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json().catch(() => ({})) };
        }
        assert.notEqual((await qaRequest('POST', '/api/certificates', { ...qaBody, disposableQa: true })).status, 201);
        assert.notEqual((await qaRequest('POST', '/api/certificates', qaBody, { qaToken: 'forged' })).status, 201);
        assert.notEqual((await qaRequest('POST', '/api/certificates', qaBody, { qaToken: qaRun.token, accessToken: token })).status, 201);
        assert.notEqual((await qaRequest('POST', '/api/certificates', qaBody, { qaToken: qaRun.token, businessContext: 'dar' })).status, 201);
        const expiredRunId = 'qa-expired-' + crypto.randomBytes(6).toString('hex');
        const expiredRun = await createTrustedQaRun(pool, {
            runId: expiredRunId, source: 'trusted_qa', businessContext: 'event_genix',
            operatorUserId: qaAccount.id, requiredOperatorUserId: qaAccount.id,
            requiredUserId: qaAccount.id, testCustomerMarker: `${expiredRunId}:certificate:disposable`,
            allowedEndpoints: ['POST /api/certificates'], maxEntityCount: 1, ttlMinutes: 1
        });
        await pool.query("UPDATE trusted_qa_runs SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [expiredRun.run.id]);
        assert.notEqual((await qaRequest('POST', '/api/certificates',
            { ...qaBody, displayValue: `${expiredRunId}:certificate:disposable` },
            { qaToken: expiredRun.token })).status, 201);
        const issued = await qaRequest('POST', '/api/certificates', qaBody, { qaToken: qaRun.token, requestId: 'qa-issue-1' });
        assert.equal(issued.status, 201, JSON.stringify(issued.body));
        const qaCertificate = issued.body;
        assert.ok(qaCertificate.id);
        assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM trusted_qa_run_entities
            WHERE run_id=$1 AND entity_type='certificate' AND entity_id=$2`, [qaRun.run.id, String(qaCertificate.id)])).rows[0].n, 1);
        assert.notEqual((await qaRequest('POST', '/api/certificates', qaBody,
            { qaToken: qaRun.token, requestId: 'qa-issue-2' })).status, 201);
        await assert.rejects(
            require('../../services/trustedQaRuns').registerQaEntity(pool, { trusted: true, run: qaRun.run }, 'certificate', '999999'),
            { code: 'QA_RUN_ENTITY_LIMIT_EXCEEDED' }
        );
        const list = await qaRequest('GET', '/api/certificates');
        assert.equal(list.status, 200);
        assert.ok(!list.body.items.some(item => item.id === qaCertificate.id));
        assert.ok(list.body.items.some(item => item.id === failedCert.id), 'ordinary certificates remain visible');
        const validation = await qaRequest('GET', '/api/certificates/validate/' + qaCertificate.certCode);
        assert.equal(validation.body.canRedeem, false);
        assert.equal(validation.body.redemptionReason, 'qa_booking_unavailable');
        assert.equal((await qaRequest('GET', '/api/certificates/code/' + qaCertificate.certCode)).status, 200);
        assert.equal((await qaRequest('POST', `/api/certificates/${qaCertificate.id}/send-image`, { imageBase64: 'YQ==' })).status, 409);
        assert.equal((await qaRequest('POST', '/api/print/jobs', { certificate_id: qaCertificate.id, data: {} })).status, 409);
        assert.equal((await qaRequest('POST', '/api/bookings', { ...booking({ cert_code: qaCertificate.certCode }), time: '17:00' })).status, 409);
        const redeemed = await qaRequest('POST', `/api/certificates/${qaCertificate.id}/redeem`, {});
        assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
        assert.equal((await qaRequest('POST', `/api/certificates/${qaCertificate.id}/redeem`, {})).status, 409);
        assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM event_queue
            WHERE event_type='certificate.created' AND payload->>'cert_id'=$1`, [String(qaCertificate.id)])).rows[0].n, 0);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM finance_transactions WHERE certificate_id=$1', [qaCertificate.id])).rows[0].n, 0);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM print_jobs WHERE certificate_id=$1', [qaCertificate.id])).rows[0].n, 0);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM notification_outbox WHERE trusted_qa_run_public_id=$1', [runId])).rows[0].n, 0);
        const cleanup = await cleanupTrustedQaRun(pool, qaRun.run.id);
        assert.equal(cleanup.state, 'cleaned');
        assert.equal((await state({ id: qaCertificate.id })).status, 'used');
        const unusedRunId = 'qa-unused-' + crypto.randomBytes(6).toString('hex');
        const unusedMarker = `${unusedRunId}:certificate:disposable`;
        const unusedRun = await createTrustedQaRun(pool, {
            runId: unusedRunId, source: 'trusted_qa', businessContext: 'event_genix',
            operatorUserId: qaAccount.id, requiredOperatorUserId: qaAccount.id,
            requiredUserId: qaAccount.id, testCustomerMarker: unusedMarker,
            allowedEndpoints: ['POST /api/certificates'], maxEntityCount: 1, ttlMinutes: 30
        });
        const unusedIssue = await qaRequest('POST', '/api/certificates', { ...qaBody, displayValue: unusedMarker },
            { qaToken: unusedRun.token, requestId: 'qa-unused-issue' });
        assert.equal(unusedIssue.status, 201, JSON.stringify(unusedIssue.body));
        assert.equal((await cleanupTrustedQaRun(pool, unusedRun.run.id)).state, 'cleaned');
        assert.equal((await state({ id: unusedIssue.body.id })).status, 'revoked');
        assert.equal((await qaRequest('POST', `/api/certificates/${unusedIssue.body.id}/redeem`, {})).status, 409);
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
