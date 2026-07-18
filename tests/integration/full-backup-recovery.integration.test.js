/**
 * Full Event Genix database recovery proof.
 *
 * The isolated runner starts the source CRM on a disposable PostgreSQL
 * database. This test creates a second disposable database in the same test
 * cluster, starts a second CRM process to build the matching fresh schema, and
 * restores plain and encrypted v2 artifacts through the real HTTP endpoints.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const {
    decryptRecoveryBundle,
    parseRecoveryBundle
} = require('../../services/backupArtifact');
const {
    configureBackupSession,
    loadBackupCatalog,
    quoteIdentifier,
    quotePublicRelation,
    readTableRows
} = require('../../services/backupCatalog');
const {
    lockBackupSchemaSnapshot,
    lockBackupSchemaSnapshotSession,
    lockSchemaMigrations,
    unlockBackupSchemaSnapshotSession,
    unlockSchemaMigrations
} = require('../../services/backupSchemaLock');
const { BASE_URL, getToken } = require('../helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const enabled = process.env.RUN_FULL_BACKUP_RECOVERY_INTEGRATION === 'true';
const TARGET_STARTUP_TIMEOUT_MS = 180_000;
const TARGET_SHUTDOWN_TIMEOUT_MS = 20_000;

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_FULL_BACKUP_RECOVERY_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required');
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function createPool(testDb, databaseName = testDb.databaseName) {
    const url = new URL(testDb.url.toString());
    url.pathname = `/${databaseName}`;
    return new Pool({
        connectionString: url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 4,
        connectionTimeoutMillis: 10_000
    });
}

function quoteDatabaseName(name) {
    assert.match(name, /^[a-z][a-z0-9_]{0,62}$/);
    return `"${name}"`;
}

function withTimeout(promise, timeoutMs, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(
            () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
            timeoutMs
        ))
    ]);
}

async function assertPromiseBlocked(promise, label) {
    const outcome = await Promise.race([
        promise.then(() => 'settled', () => 'rejected'),
        new Promise(resolve => setTimeout(() => resolve('blocked'), 75))
    ]);
    assert.equal(outcome, 'blocked', `${label} must remain blocked until the holder releases`);
}

async function assertSchemaMaintenanceFence(pool) {
    const sharedClient = await pool.connect();
    const exclusiveClient = await pool.connect();
    let sharedTransaction = false;
    let sharedSessionHeld = false;
    let exclusiveHeld = false;
    let markerCreated = false;
    try {
        await lockBackupSchemaSnapshotSession(sharedClient);
        sharedSessionHeld = true;
        await sharedClient.query('BEGIN');
        sharedTransaction = true;
        await lockBackupSchemaSnapshot(sharedClient);
        await unlockBackupSchemaSnapshotSession(sharedClient);
        sharedSessionHeld = false;
        const exclusivePending = lockSchemaMigrations(exclusiveClient).then(() => {
            exclusiveHeld = true;
        });
        await assertPromiseBlocked(exclusivePending, 'migration lock behind backup snapshot');
        await sharedClient.query('COMMIT');
        sharedTransaction = false;
        await withTimeout(exclusivePending, 2_000, 'migration lock acquisition');
        await unlockSchemaMigrations(exclusiveClient);
        exclusiveHeld = false;

        await lockSchemaMigrations(exclusiveClient);
        exclusiveHeld = true;
        await exclusiveClient.query(
            'CREATE TABLE public.backup_schema_fence_probe (id integer PRIMARY KEY)'
        );
        markerCreated = true;
        const sharedPending = lockBackupSchemaSnapshotSession(sharedClient, {
            lockTimeoutMs: 2_000
        }).then(() => {
            sharedSessionHeld = true;
        });
        await assertPromiseBlocked(sharedPending, 'backup/restore session lock behind migration');
        await unlockSchemaMigrations(exclusiveClient);
        exclusiveHeld = false;
        await withTimeout(sharedPending, 3_000, 'backup/restore session lock acquisition');
        await sharedClient.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        sharedTransaction = true;
        await lockBackupSchemaSnapshot(sharedClient);
        await unlockBackupSchemaSnapshotSession(sharedClient);
        sharedSessionHeld = false;
        const marker = await sharedClient.query(
            "SELECT to_regclass('public.backup_schema_fence_probe')::text AS relation"
        );
        assert.equal(marker.rows[0]?.relation, 'backup_schema_fence_probe');
        await sharedClient.query('COMMIT');
        sharedTransaction = false;

        await lockSchemaMigrations(exclusiveClient);
        exclusiveHeld = true;
        await assert.rejects(
            () => withTimeout(
                lockBackupSchemaSnapshotSession(sharedClient, { lockTimeoutMs: 100 }),
                2_000,
                'bounded restore lock timeout'
            ),
            error => error?.code === '55P03'
        );
        await unlockSchemaMigrations(exclusiveClient);
        exclusiveHeld = false;
    } finally {
        if (sharedTransaction) await sharedClient.query('ROLLBACK').catch(() => {});
        if (sharedSessionHeld) {
            await unlockBackupSchemaSnapshotSession(sharedClient).catch(() => {});
        }
        if (exclusiveHeld) await unlockSchemaMigrations(exclusiveClient).catch(() => {});
        if (markerCreated) {
            let cleanupLockHeld = false;
            try {
                await lockSchemaMigrations(exclusiveClient);
                cleanupLockHeld = true;
                await exclusiveClient.query('DROP TABLE IF EXISTS public.backup_schema_fence_probe');
            } finally {
                if (cleanupLockHeld) await unlockSchemaMigrations(exclusiveClient).catch(() => {});
            }
        }
        sharedClient.release();
        exclusiveClient.release();
    }
}

async function readIndependentPublicInventory(pool, excludedTables) {
    const tables = await pool.query(
        `SELECT c.relname AS name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND NOT (c.relname = ANY($1::text[]))
         ORDER BY c.relname`,
        [excludedTables]
    );
    const sequences = await pool.query(
        `SELECT sequence_row.relname AS name
         FROM pg_class sequence_row
         JOIN pg_namespace n ON n.oid = sequence_row.relnamespace
         LEFT JOIN pg_depend dependency
           ON dependency.classid = 'pg_class'::regclass
          AND dependency.objid = sequence_row.oid
          AND dependency.refclassid = 'pg_class'::regclass
          AND dependency.deptype IN ('a', 'i')
         LEFT JOIN pg_class owned_table ON owned_table.oid = dependency.refobjid
         WHERE n.nspname = 'public'
           AND sequence_row.relkind = 'S'
           AND (owned_table.relname IS NULL OR NOT (owned_table.relname = ANY($1::text[])))
         ORDER BY sequence_row.relname`,
        [excludedTables]
    );
    return {
        tables: tables.rows.map(row => row.name),
        sequences: sequences.rows.map(row => row.name)
    };
}

async function selectFirstUserTrigger(pool) {
    const result = await pool.query(`
        SELECT table_row.relname AS table_name, trigger_row.tgname AS trigger_name
        FROM pg_trigger trigger_row
        JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
        JOIN pg_namespace n ON n.oid = table_row.relnamespace
        WHERE n.nspname = 'public' AND NOT trigger_row.tgisinternal
        ORDER BY table_row.relname, trigger_row.tgname
        LIMIT 1
    `);
    assert.equal(result.rowCount, 1, 'fixture schema must expose a user trigger');
    return result.rows[0];
}

async function setTriggerMode(pool, trigger, command) {
    assert.ok(['ENABLE', 'ENABLE REPLICA', 'ENABLE ALWAYS', 'DISABLE'].includes(command));
    await pool.query(
        `ALTER TABLE ${quotePublicRelation(trigger.table_name)} ${command} `
        + `TRIGGER ${quoteIdentifier(trigger.trigger_name)}`
    );
}

async function readTriggerMode(pool, trigger) {
    const result = await pool.query(
        `SELECT trigger_row.tgenabled AS enabled
         FROM pg_trigger trigger_row
         JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
         JOIN pg_namespace n ON n.oid = table_row.relnamespace
         WHERE n.nspname = 'public'
           AND table_row.relname = $1
           AND trigger_row.tgname = $2`,
        [trigger.table_name, trigger.trigger_name]
    );
    assert.equal(result.rowCount, 1);
    return result.rows[0].enabled;
}

function summarizeTableDrift(table, expected, actual) {
    const primaryKeyIndexes = table.primaryKey
        .map(column => expected.columns.indexOf(column))
        .filter(index => index >= 0);
    if (primaryKeyIndexes.length === 0) return 'no primary key diagnostic available';

    const keyFor = row => JSON.stringify(primaryKeyIndexes.map(index => row[index]));
    const expectedRows = new Map(expected.rows.map(row => [keyFor(row), row]));
    const actualRows = new Map(actual.rows.map(row => [keyFor(row), row]));
    const changedColumns = new Set();
    let added = 0;
    let removed = 0;

    for (const [key, row] of actualRows) {
        const baseline = expectedRows.get(key);
        if (!baseline) {
            added += 1;
            continue;
        }
        row.forEach((value, index) => {
            if (value !== baseline[index]) changedColumns.add(expected.columns[index]);
        });
    }
    for (const key of expectedRows.keys()) {
        if (!actualRows.has(key)) removed += 1;
    }
    return `added=${added}, removed=${removed}, changedColumns=${[
        ...changedColumns
    ].sort().join(',') || 'none'}`;
}

async function assertOnlyAuditDeltas(pool, parsedArtifact) {
    const expectedByName = new Map(parsedArtifact.payload.tables.map(table => [table.name, table]));
    const allowedAuditTables = new Set(['admin_audit_log', 'user_action_log']);
    const deadline = Date.now() + 2_000;
    let auditDeltasObserved = false;

    while (Date.now() < deadline && !auditDeltasObserved) {
        const counts = await Promise.all([...allowedAuditTables].map(async name => {
            const result = await pool.query(`SELECT COUNT(*)::integer AS count FROM ${quotePublicRelation(name)}`);
            return Number(result.rows[0].count) - expectedByName.get(name).rowCount;
        }));
        auditDeltasObserved = counts.every(delta => delta >= 1);
        if (!auditDeltasObserved) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(auditDeltasObserved, true, 'restore and API audit receipts must be appended');

    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await configureBackupSession(client);
        const catalog = await loadBackupCatalog(client, { excludedTables: new Set(['schema_migrations']) });
        for (const table of catalog.tables) {
            if (allowedAuditTables.has(table.name)) continue;
            const actual = await readTableRows(client, table);
            const expected = expectedByName.get(table.name);
            assert.equal(actual.rowCount, expected.rowCount, `${table.name} row count drifted after response`);
            assert.equal(
                actual.checksum,
                expected.checksum,
                `${table.name} checksum drifted after response (${summarizeTableDrift(
                    table,
                    expected,
                    actual
                )})`
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function reservePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

function appendOutput(output, chunk) {
    const lines = `${output.text}${String(chunk)}`.split(/\r?\n/);
    output.text = lines.slice(-60).join('\n');
}

async function waitForHealth(baseUrl, child, output) {
    const deadline = Date.now() + TARGET_STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Recovery target exited during startup (${child.exitCode})\n${output.text}`);
        }
        try {
            const response = await fetch(`${baseUrl}/api/health`, {
                signal: AbortSignal.timeout(2_000)
            });
            if (response.ok) return;
        } catch {
            // Fresh target is still initializing and applying migrations.
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Recovery target did not become healthy\n${output.text}`);
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timeout = new Promise(resolve => setTimeout(
        () => resolve('timeout'),
        TARGET_SHUTDOWN_TIMEOUT_MS
    ));
    if (await Promise.race([exited, timeout]) === 'timeout' && child.exitCode === null) {
        child.kill('SIGKILL');
        await exited;
    }
}

function buildTargetEnvironment(testDb, databaseName, port, credentials) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith('RAILWAY_')
            || /(TOKEN|SECRET|API[_-]?KEY|WEBHOOK|SMTP|SENDGRID|TWILIO|STRIPE|OPENAI|ANTHROPIC|GEMINI|PINATA|CLOUDINARY|S3_|AWS_|OMNI|TELEGRAM|REPORT_BOT|KLESHNYA)/i.test(key)) {
            delete env[key];
        }
    }
    Object.assign(env, {
        NODE_ENV: 'test',
        PORT: String(port),
        LOG_LEVEL: 'warn',
        JWT_SECRET: crypto.randomBytes(64).toString('hex'),
        BOOTSTRAP_CREATOR_USERNAME: credentials.username,
        BOOTSTRAP_CREATOR_PASSWORD: credentials.password,
        BOOTSTRAP_CREATOR_NAME: 'Disposable Recovery Target Creator',
        BACKUP_FULL_RESTORE_ENABLED: 'true',
        BACKUP_RECOVERY_MODE: 'true',
        BACKUP_OUTBOUND_HOLD: 'true',
        TELEGRAM_BOT_TOKEN: '',
        TELEGRAM_DEFAULT_CHAT_ID: '',
        REPORT_BOT_TOKEN: '',
        KLESHNYA_WEBHOOK_SECRET: '',
        RAILWAY_PUBLIC_DOMAIN: '',
        RAILWAY_ENVIRONMENT: '',
        RAILWAY_PROJECT_ID: '',
        RAILWAY_SERVICE_ID: ''
    });
    if (testDb.isLocal) {
        env.DATABASE_URL = '';
        env.PGHOST = testDb.hostname;
        env.PGPORT = testDb.url.port || '5432';
        env.PGDATABASE = databaseName;
        env.PGUSER = decodeURIComponent(testDb.url.username || '');
        env.PGPASSWORD = decodeURIComponent(testDb.url.password || '');
        env.PGSSLMODE = 'disable';
    } else {
        const url = new URL(testDb.url.toString());
        url.pathname = `/${databaseName}`;
        env.DATABASE_URL = url.toString();
        delete env.PGHOST;
        delete env.PGPORT;
        delete env.PGDATABASE;
        delete env.PGUSER;
        delete env.PGPASSWORD;
    }
    return env;
}

async function startTargetServer(testDb, databaseName) {
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const credentials = {
        username: `recovery_target_${process.pid}_${crypto.randomBytes(3).toString('hex')}`,
        password: crypto.randomBytes(24).toString('base64url')
    };
    const output = { text: '' };
    const child = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: buildTargetEnvironment(testDb, databaseName, port, credentials),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    child.stdout.on('data', chunk => appendOutput(output, chunk));
    child.stderr.on('data', chunk => appendOutput(output, chunk));
    await waitForHealth(baseUrl, child, output);
    return { child, baseUrl, credentials, output };
}

async function login(baseUrl, username, password) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(10_000)
    });
    const data = await response.json().catch(() => null);
    assert.equal(response.status, 200, `target login failed: ${JSON.stringify(data)}`);
    assert.ok(data?.token, 'target login must return a token');
    return data.token;
}

async function downloadSourceArtifact(pathname, extraHeaders = {}) {
    const token = await getToken();
    const response = await fetch(`${BASE_URL}${pathname}`, {
        headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
        signal: AbortSignal.timeout(120_000)
    });
    assert.equal(response.status, 200, `${pathname} returned HTTP ${response.status}`);
    return response.json();
}

async function restoreTarget(baseUrl, token, pathname, body, extraHeaders = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Backup-Restore-Confirmed': 'true',
            ...extraHeaders
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000)
    });
    return {
        status: response.status,
        data: await response.json().catch(() => null)
    };
}

async function readTargetBackupTables(baseUrl, token) {
    return fetch(`${baseUrl}/api/backup/tables`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000)
    });
}

async function createSourceFixtures(pool, suffix) {
    const staffResult = await pool.query(
        `INSERT INTO staff (
             name, department, position, created_at, skills, secondary_professions,
             hourly_rate, notes
         ) VALUES (
             $1, 'qa_recovery', 'Recovery Tester',
             '2099-07-15 07:00:00.123456'::timestamp,
             $2::text[], $3::jsonb, 123.4567, $4
         ) RETURNING id`,
        [
            `Full Recovery Staff ${suffix}`,
            ['skill,comma', 'quote"value', 'brace{}'],
            JSON.stringify([{ profession: 'animator', level: 'senior' }]),
            "typed fixture; -- apostrophe ' preserved"
        ]
    );
    const staffId = Number(staffResult.rows[0].id);

    const firstTask = await pool.query(
        `INSERT INTO tasks (title, dependency_ids, control_policy, created_at)
         VALUES ($1, '{}'::integer[], $2::jsonb, '2099-07-15 08:00:00.111222'::timestamp)
         RETURNING id`,
        [`Recovery Task A ${suffix}`, JSON.stringify({ nested: ['a', 2, true] })]
    );
    const firstTaskId = Number(firstTask.rows[0].id);
    const secondTask = await pool.query(
        `INSERT INTO tasks (title, dependency_ids)
         VALUES ($1, $2::integer[]) RETURNING id`,
        [`Recovery Task B ${suffix}`, [firstTaskId]]
    );

    const recurring = await pool.query(
        `INSERT INTO recurring_templates (
             pattern, days_of_week, start_date, time_start, time_end, notes, extra_data
         ) VALUES (
             'weekly', $1::integer[], '2099-07-15', '08:15:30', '17:45:00', $2, $3::jsonb
         ) RETURNING id`,
        [[1, 3, 5], `Recovery recurring ${suffix}`, JSON.stringify({ exact: 'json value' })]
    );

    const blobName = `recovery-${suffix}.bin`;
    const blobBytes = Buffer.from([0, 1, 2, 39, 59, 127, 128, 255]);
    await pool.query(
        `INSERT INTO catalog_image_blobs (
             filename, content_type, data, size_bytes, source_url, metadata,
             created_at, updated_at
         ) VALUES (
             $1, 'image/png', $2, $3, $4, $5::jsonb,
             '2099-07-15T06:01:02.123456+00:00'::timestamptz,
             '2099-07-15T06:01:02.654321+00:00'::timestamptz
         )`,
        [blobName, blobBytes, blobBytes.length, `https://invalid.example/${suffix}`, JSON.stringify({ fixture: true })]
    );

    const lead = await pool.query(
        `INSERT INTO leads (
             client_name, telegram_id, external_id, raw_payload, milestone_tags,
             event_date, business_context
         ) VALUES ($1, $2::bigint, $3, $4::jsonb, $5::text[], '2099-07-15', 'event_genix')
         RETURNING id`,
        [
            `Recovery Lead ${suffix}`,
            '9007199254740993',
            `recovery-lead-${suffix}`,
            JSON.stringify({ unicode: 'Плющкіт', exact: 123456789 }),
            ['one', 'two,comma']
        ]
    );
    const leadId = Number(lead.rows[0].id);
    const customer = await pool.query(
        `INSERT INTO customers (name, lead_id, social_identities, notes)
         VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
        [
            `Recovery Customer ${suffix}`,
            leadId,
            JSON.stringify([{ type: 'qa', value: suffix }]),
            'cycle fixture'
        ]
    );
    const customerId = Number(customer.rows[0].id);
    const bookingId = `recovery-booking-${suffix}`;
    await pool.query(
        `INSERT INTO bookings (
             id, date, time, line_id, label, notes, customer_id, extra_data, business_context
         ) VALUES ($1, '2099-07-15', '10:00', 'qa-line', $2, $3, $4, $5::jsonb, 'event_genix')`,
        [
            bookingId,
            `Recovery Booking ${suffix}`,
            "cycle; -- quote ' fixture",
            customerId,
            JSON.stringify({ fixture: true })
        ]
    );
    await pool.query('UPDATE leads SET booking_id = $1 WHERE id = $2', [bookingId, leadId]);

    const conversation = await pool.query(
        `INSERT INTO conversations (
             channel, external_id, customer_id, customer_name, reply_expected, business_context
         ) VALUES ('telegram', $1, $2, $3, true, 'event_genix') RETURNING id`,
        [`recovery-conversation-${suffix}`, customerId, `Recovery Conversation ${suffix}`]
    );
    const conversationId = Number(conversation.rows[0].id);
    const message = await pool.query(
        `INSERT INTO conversation_messages (
             conversation_id, direction, content, meta, created_at
         ) VALUES ($1, 'inbound', $2, $3::jsonb, '2099-07-15 09:10:11.222333'::timestamp)
         RETURNING id`,
        [conversationId, `Recovery message ${suffix}`, JSON.stringify({ semicolon: ';' })]
    );
    const messageId = Number(message.rows[0].id);
    await pool.query(
        'UPDATE conversations SET reply_expected_message_id = $1 WHERE id = $2',
        [messageId, conversationId]
    );

    return {
        staffId,
        staffName: `Full Recovery Staff ${suffix}`,
        firstTaskId,
        secondTaskId: Number(secondTask.rows[0].id),
        recurringId: Number(recurring.rows[0].id),
        blobName,
        blobHex: blobBytes.toString('hex'),
        leadId,
        customerId,
        bookingId,
        conversationId,
        messageId
    };
}

async function assertFixturesRestored(pool, fixture) {
    const staff = await pool.query(
        `SELECT name, skills::text AS skills, secondary_professions::text AS secondary_professions,
                hourly_rate::text AS hourly_rate,
                to_char(created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS created_at
         FROM staff WHERE id = $1`,
        [fixture.staffId]
    );
    assert.equal(staff.rows[0]?.name, fixture.staffName);
    assert.equal(staff.rows[0]?.skills, '{"skill,comma","quote\\"value","brace{}"}');
    assert.equal(staff.rows[0]?.secondary_professions, '[{"level": "senior", "profession": "animator"}]');
    assert.equal(staff.rows[0]?.hourly_rate, '123.46');
    assert.equal(staff.rows[0]?.created_at, '2099-07-15 07:00:00.123456');

    const task = await pool.query(
        'SELECT dependency_ids::text AS dependency_ids FROM tasks WHERE id = $1',
        [fixture.secondTaskId]
    );
    assert.equal(task.rows[0]?.dependency_ids, `{${fixture.firstTaskId}}`);

    const recurring = await pool.query(
        `SELECT days_of_week::text AS days_of_week, time_start::text AS time_start
         FROM recurring_templates WHERE id = $1`,
        [fixture.recurringId]
    );
    assert.equal(recurring.rows[0]?.days_of_week, '{1,3,5}');
    assert.equal(recurring.rows[0]?.time_start, '08:15:30');

    const blob = await pool.query(
        `SELECT encode(data, 'hex') AS data_hex, metadata::text AS metadata,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS created_at
         FROM catalog_image_blobs WHERE filename = $1`,
        [fixture.blobName]
    );
    assert.equal(blob.rows[0]?.data_hex, fixture.blobHex);
    assert.equal(blob.rows[0]?.metadata, '{"fixture": true}');
    assert.equal(blob.rows[0]?.created_at, '2099-07-15 06:01:02.123456');

    const cycle = await pool.query(
        `SELECT l.telegram_id::text AS telegram_id, l.booking_id,
                c.lead_id, b.customer_id
         FROM leads l
         JOIN customers c ON c.id = $2
         JOIN bookings b ON b.id = $3
         WHERE l.id = $1`,
        [fixture.leadId, fixture.customerId, fixture.bookingId]
    );
    assert.equal(cycle.rows[0]?.telegram_id, '9007199254740993');
    assert.equal(cycle.rows[0]?.booking_id, fixture.bookingId);
    assert.equal(Number(cycle.rows[0]?.lead_id), fixture.leadId);
    assert.equal(Number(cycle.rows[0]?.customer_id), fixture.customerId);

    const conversationCycle = await pool.query(
        `SELECT c.reply_expected_message_id, m.conversation_id
         FROM conversations c
         JOIN conversation_messages m ON m.id = $2
         WHERE c.id = $1`,
        [fixture.conversationId, fixture.messageId]
    );
    assert.equal(Number(conversationCycle.rows[0]?.reply_expected_message_id), fixture.messageId);
    assert.equal(Number(conversationCycle.rows[0]?.conversation_id), fixture.conversationId);
}

test(
    'full v2 recovery round-trips all tables into a separate clean PostgreSQL database',
    { skip: !enabled, timeout: 480_000 },
    async () => {
        const testDb = requireIsolatedDatabase();
        const adminPool = createPool(testDb);
        const sourcePool = createPool(testDb);
        const suffix = `${process.pid}-${Date.now()}`;
        const baseName = testDb.databaseName.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
        const targetName = `${baseName.slice(0, 36)}_recovery_${process.pid}`.slice(0, 63);
        const passphrase = `disposable-recovery-key-${suffix}`;
        let targetServer;
        let targetPool;
        let targetCreated = false;

        try {
            await assertSchemaMaintenanceFence(sourcePool);
            await adminPool.query(`DROP DATABASE IF EXISTS ${quoteDatabaseName(targetName)} WITH (FORCE)`);
            await adminPool.query(`CREATE DATABASE ${quoteDatabaseName(targetName)}`);
            targetCreated = true;

            const fixture = await createSourceFixtures(sourcePool, suffix);
            const trigger = await selectFirstUserTrigger(sourcePool);
            await setTriggerMode(sourcePool, trigger, 'ENABLE REPLICA');
            assert.equal(await readTriggerMode(sourcePool, trigger), 'R');
            const artifact = await downloadSourceArtifact('/api/backup/download');
            const envelope = await downloadSourceArtifact('/api/backup/download-encrypted', {
                'X-Backup-Encryption-Key': passphrase
            });
            assert.equal(artifact.format, 'eventgenix.backup');
            assert.equal(artifact.version, 2);
            assert.equal(envelope.cipher, 'aes-256-gcm');
            const parsedArtifact = parseRecoveryBundle(artifact);
            const encryptedArtifact = decryptRecoveryBundle(envelope, passphrase);
            const parsedEncryptedArtifact = parseRecoveryBundle(encryptedArtifact);
            assert.match(artifact.manifest.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
            const independentInventory = await readIndependentPublicInventory(
                sourcePool,
                artifact.manifest.excludedTables
            );
            assert.deepEqual(
                artifact.manifest.tables.map(table => table.name).sort(),
                independentInventory.tables
            );
            assert.deepEqual(
                parsedArtifact.payload.tables.map(table => table.name).sort(),
                independentInventory.tables
            );
            assert.deepEqual(
                parsedArtifact.payload.sequences.map(sequence => sequence.name).sort(),
                independentInventory.sequences
            );
            assert.equal(artifact.manifest.sequenceCount, independentInventory.sequences.length);
            const admissionTables = new Map(
                parsedArtifact.payload.tables
                    .filter(table => table.name.startsWith('admission_ticket_'))
                    .map(table => [table.name, table])
            );
            assert.equal(
                admissionTables.get('admission_ticket_types')?.rowCount,
                6,
                'structured backup must contain the six seeded admission ticket types'
            );
            assert.equal(
                admissionTables.get('admission_ticket_tariff_versions')?.rowCount,
                24,
                'structured backup must contain the complete seeded tariff matrix'
            );
            assert.ok(
                Number(admissionTables.get('admission_ticket_tariff_audit')?.rowCount || 0) >= 24,
                'structured backup must contain admission tariff audit history'
            );
            assert.equal(
                parsedArtifact.payload.tables.some(table => table.name === 'schema_migrations'),
                false,
                'schema_migrations must remain excluded from structured backup'
            );

            targetServer = await startTargetServer(testDb, targetName);
            targetPool = createPool(testDb, targetName);
            await setTriggerMode(targetPool, trigger, 'ENABLE REPLICA');
            assert.equal(await readTriggerMode(targetPool, trigger), 'R');
            const bootstrapToken = await login(
                targetServer.baseUrl,
                targetServer.credentials.username,
                targetServer.credentials.password
            );
            const plainRestore = await restoreTarget(
                targetServer.baseUrl,
                bootstrapToken,
                '/api/backup/restore',
                { artifact, mode: 'full' }
            );
            assert.equal(
                plainRestore.status,
                200,
                `plain full restore failed: ${JSON.stringify(plainRestore.data)}`
            );
            assert.equal(plainRestore.data?.success, true);
            assert.equal(plainRestore.data?.verified, true);
            assert.equal(plainRestore.data?.tablesRestored?.length, artifact.manifest.tableCount);
            assert.equal(
                plainRestore.data?.sequencesRestored,
                parsedArtifact.payload.sequences.length
            );
            await assertFixturesRestored(targetPool, fixture);
            assert.equal(await readTriggerMode(targetPool, trigger), 'R');
            const staleBootstrapResponse = await readTargetBackupTables(
                targetServer.baseUrl,
                bootstrapToken
            );
            assert.equal(
                staleBootstrapResponse.status,
                403,
                'pre-restore bootstrap JWT must be invalid after users are restored'
            );
            await assertOnlyAuditDeltas(targetPool, parsedArtifact);

            const sequenceProbe = await targetPool.query(
                `INSERT INTO staff (name, department, position)
                 VALUES ($1, 'qa_recovery', 'Sequence Probe') RETURNING id`,
                [`Recovery Sequence Probe ${suffix}`]
            );
            assert.ok(Number(sequenceProbe.rows[0].id) > fixture.staffId);

            await targetPool.query(
                `UPDATE staff SET name = 'tamper sentinel' WHERE id = $1`,
                [fixture.staffId]
            );
            const sourceToken = await login(
                targetServer.baseUrl,
                process.env.TEST_USER,
                process.env.TEST_PASS
            );
            const recoveryStateResponse = await readTargetBackupTables(
                targetServer.baseUrl,
                sourceToken
            );
            assert.equal(recoveryStateResponse.status, 200);
            const recoveryState = await recoveryStateResponse.json();
            assert.equal(recoveryState.recoveryMode, true);
            assert.equal(recoveryState.outboundHold, true);
            assert.equal(recoveryState.outboundSideEffectsSuppressed, true);
            const tamperedEnvelope = {
                ...envelope,
                tag: `${envelope.tag.slice(0, -2)}AA`
            };
            const rejected = await restoreTarget(
                targetServer.baseUrl,
                sourceToken,
                '/api/backup/restore-encrypted',
                { envelope: tamperedEnvelope, mode: 'full' },
                { 'X-Backup-Encryption-Key': passphrase }
            );
            assert.equal(rejected.status, 400);
            assert.equal(rejected.data?.error, 'BACKUP_ARTIFACT_AUTH_FAILED');
            const sentinel = await targetPool.query('SELECT name FROM staff WHERE id = $1', [fixture.staffId]);
            assert.equal(sentinel.rows[0]?.name, 'tamper sentinel');

            const encryptedRestore = await restoreTarget(
                targetServer.baseUrl,
                sourceToken,
                '/api/backup/restore-encrypted',
                { envelope, mode: 'full' },
                { 'X-Backup-Encryption-Key': passphrase }
            );
            assert.equal(
                encryptedRestore.status,
                200,
                `encrypted full restore failed: ${JSON.stringify(encryptedRestore.data)}`
            );
            assert.equal(encryptedRestore.data?.success, true);
            assert.equal(encryptedRestore.data?.verified, true);
            await assertFixturesRestored(targetPool, fixture);
            assert.equal(await readTriggerMode(targetPool, trigger), 'R');
            await assertOnlyAuditDeltas(targetPool, parsedEncryptedArtifact);
        } finally {
            if (targetPool) await targetPool.end().catch(() => {});
            await stopServer(targetServer?.child).catch(() => {});
            if (targetCreated) {
                await adminPool.query(
                    `SELECT pg_terminate_backend(pid)
                     FROM pg_stat_activity
                     WHERE datname = $1 AND pid <> pg_backend_pid()`,
                    [targetName]
                ).catch(() => {});
                await adminPool.query(`DROP DATABASE IF EXISTS ${quoteDatabaseName(targetName)} WITH (FORCE)`);
            }
            await sourcePool.end().catch(() => {});
            await adminPool.end().catch(() => {});
        }
    }
);
