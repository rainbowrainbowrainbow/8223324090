'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packageJson = require('../package.json');
const { isBackupRestoreRequestPath } = require('../config/backupRestorePolicy');
const { canonicalJsonHash, createRecoveryBundle } = require('../services/backupArtifact');
const { sha256 } = require('../services/backupCatalog');
const {
    assertRestoreConfirmation,
    configureRestoreTimeouts,
    createRestorePlan,
    decryptBackupArtifact,
    encryptBackupArtifact,
    executeRestorePlan,
    validateBackupArtifact
} = require('../services/backupRecovery');

const ROOT = path.resolve(__dirname, '..');

function read(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function backupRouteHandler(router, routePath) {
    const layer = router.stack.find(item => (
        item.route?.path === routePath && item.route.methods.get
    ));
    assert.ok(layer, `GET ${routePath} handler exists`);
    return layer.route.stack.at(-1).handle;
}

function backupResponseCapture() {
    return {
        statusCode: 200,
        headers: {},
        body: undefined,
        jsonCalls: 0,
        sendCalls: 0,
        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.jsonCalls += 1;
            this.body = body;
            return this;
        },
        send(body) {
            this.sendCalls += 1;
            this.body = body;
            return this;
        }
    };
}

function loadBackupAuditRouter({
    generateBackupArtifact,
    logAdminAction,
    logAdminActionStrict = logAdminAction,
    validateBackupArtifact = () => ({ artifactId: 'a'.repeat(64) }),
    encryptBackupArtifact = () => ({
        format: 'eventgenix.backup.encrypted',
        version: 2,
        ciphertext: 'encrypted-secret-payload'
    })
}) {
    const mockEntries = new Map([
        ['../db', { pool: {} }],
        ['../services/backup', {
            generateBackupArtifact,
            sendBackupToTelegram: async () => ({ success: true })
        }],
        ['../services/booking', { getKyivDateStr: () => '2099-07-15' }],
        ['../utils/logger', {
            createLogger: () => ({ info() {}, warn() {}, error() {} })
        }],
        ['../services/adminAudit', { logAdminAction, logAdminActionStrict }],
        ['../middleware/auth', {
            requireRole: () => (_req, _res, next) => next()
        }],
        ['../services/backupCatalog', { loadBackupCatalog: async () => ({ tables: [] }) }],
        ['../services/backupArtifact', {
            isValidRecoveryPassphrase: value => Buffer.byteLength(String(value || ''), 'utf8') >= 16
        }],
        ['../services/backupRecovery', {
            assertRestoreConfirmation: () => true,
            createRestorePlan: () => ({}),
            decryptBackupArtifact: value => value,
            encryptBackupArtifact,
            executeRestorePlan: async () => ({}),
            validateBackupArtifact
        }]
    ]);
    const routePath = require.resolve('../routes/backup');
    const previousRoute = require.cache[routePath];
    const previous = [];

    for (const [modulePath, exports] of mockEntries) {
        const id = require.resolve(modulePath);
        previous.push([id, require.cache[id]]);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    delete require.cache[routePath];
    const router = require('../routes/backup');

    return {
        router,
        cleanup() {
            delete require.cache[routePath];
            if (previousRoute) require.cache[routePath] = previousRoute;
            for (const [id, entry] of previous) {
                if (entry) require.cache[id] = entry;
                else delete require.cache[id];
            }
        }
    };
}

function backupAuditRequest(headers = {}) {
    return {
        headers,
        ip: '127.0.0.1',
        user: { username: 'recovery-operator', role: 'creator' }
    };
}

function fixtureArtifact(overrides = {}) {
    const tableRows = {
        staff: [['701', 'Fictional Recovery Person']],
        staff_checkins: [['903', '701', '2099-07-15', "qa'); DROP TABLE users; --"]],
        hr_time_records: [['904', '701', '2099-07-15', 'present']]
    };
    const columns = {
        staff: ['id', 'name'],
        staff_checkins: ['id', 'staff_id', 'date', 'method'],
        hr_time_records: ['id', 'staff_id', 'record_date', 'status']
    };
    const names = Object.keys(tableRows);
    const tables = names.map(name => ({
        name,
        columns: columns[name],
        rows: tableRows[name],
        rowCount: tableRows[name].length,
        checksum: sha256(JSON.stringify(tableRows[name]))
    }));
    const manifestTables = tables.map(table => ({
        name: table.name,
        columns: table.columns,
        primaryKey: ['id'],
        rowCount: table.rowCount,
        checksum: table.checksum
    }));
    const sequences = overrides.sequences || [];
    const manifest = {
        complete: true,
        generatedAt: '2026-07-15T12:00:00.000000Z',
        applicationVersion: packageJson.version,
        releaseLabel: packageJson.eventGenix.releaseLabel,
        scope: { kind: 'database', id: 'eventgenix-public-v2' },
        schemaFingerprint: 'a'.repeat(64),
        migrationFingerprint: 'b'.repeat(64),
        migrationHead: '316_fixture',
        excludedTables: ['schema_migrations'],
        tableCount: manifestTables.length,
        totalRows: tables.length,
        sequenceCount: sequences.length,
        sequenceChecksum: canonicalJsonHash(sequences),
        tables: manifestTables,
        restoreOrder: names,
        deferredForeignKeys: []
    };
    return createRecoveryBundle({
        manifest: { ...manifest, ...(overrides.manifest || {}) },
        payload: {
            tables: overrides.tables || tables,
            sequences
        }
    });
}

async function expectCode(run, code) {
    await assert.rejects(async () => run(), error => error?.code === code);
}

test('structured artifact validates complete typed inventory and forbids raw SQL', async () => {
    const artifact = fixtureArtifact();
    const validated = validateBackupArtifact(artifact);
    assert.equal(validated.manifest.complete, true);
    assert.deepEqual(validated.manifest.restoreOrder, [
        'staff',
        'staff_checkins',
        'hr_time_records'
    ]);
    assert.ok(validated.artifactId.match(/^[a-f0-9]{64}$/));

    await expectCode(
        () => validateBackupArtifact({ sql: 'DELETE FROM users;' }),
        'BACKUP_RAW_SQL_FORBIDDEN'
    );
});

test('full plan covers the artifact and selective mode only accepts attendance-v1', async () => {
    const artifact = fixtureArtifact();
    const full = createRestorePlan(artifact, { mode: 'full' });
    assert.equal(full.mode, 'full');
    assert.deepEqual(full.selectedTables, full.manifest.restoreOrder);

    const attendance = createRestorePlan(artifact, { restoreSet: 'attendance-v1' });
    assert.equal(attendance.mode, 'selective');
    assert.deepEqual(attendance.selectedTables, ['staff_checkins', 'hr_time_records']);
    assert.ok(attendance.operations.every(operation => (
        ['delete', 'insert', 'sequence'].includes(operation.type)
        && !('sql' in operation)
        && !('statement' in operation)
    )));

    await expectCode(
        () => createRestorePlan(artifact, { mode: 'selective', tables: ['staff_checkins'] }),
        'BACKUP_RESTORE_SET_REQUIRED'
    );
    await expectCode(
        () => createRestorePlan(artifact, { restoreSet: 'attendance-v1', tables: ['staff_checkins'] }),
        'BACKUP_ARBITRARY_TABLE_SELECTION_FORBIDDEN'
    );
});

test('incomplete and internally inconsistent bundles fail before a restore plan exists', async () => {
    await expectCode(
        () => createRestorePlan(fixtureArtifact({ manifest: { complete: false } }), { mode: 'full' }),
        'BACKUP_ARTIFACT_INCOMPLETE'
    );
    await expectCode(
        () => createRestorePlan(fixtureArtifact({ manifest: { tableCount: 99 } }), { mode: 'full' }),
        'BACKUP_ARTIFACT_INVENTORY_MISMATCH'
    );
    await expectCode(
        () => createRestorePlan(fixtureArtifact({ manifest: { sequenceCount: 1 } }), { mode: 'full' }),
        'BACKUP_ARTIFACT_INVENTORY_MISMATCH'
    );
    const sequence = {
        name: 'staff_id_seq',
        ownedTable: 'staff',
        ownedColumn: 'id',
        dataType: 'integer',
        startValue: '1',
        incrementBy: '1',
        minValue: '1',
        maxValue: '2147483647',
        cacheSize: '1',
        cycles: false,
        lastValue: '701',
        isCalled: true
    };
    await expectCode(
        () => createRestorePlan(fixtureArtifact({ sequences: [sequence, sequence] }), { mode: 'full' }),
        'BACKUP_ARTIFACT_INVENTORY_MISMATCH'
    );
});

test('restore confirmation is explicit', async () => {
    await expectCode(
        () => assertRestoreConfirmation({}),
        'BACKUP_RESTORE_CONFIRMATION_REQUIRED'
    );
    await expectCode(
        () => assertRestoreConfirmation({ 'x-backup-restore-confirmed': 'yes' }),
        'BACKUP_RESTORE_CONFIRMATION_REQUIRED'
    );
    assert.equal(assertRestoreConfirmation({ 'x-backup-restore-confirmed': 'true' }), true);
});

test('restore configures bounded transaction-local PostgreSQL timeouts', async () => {
    const calls = [];
    const client = {
        async query(text, values) {
            calls.push({ text, values });
            return { rows: [] };
        }
    };

    await configureRestoreTimeouts(client);
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /set_config\('lock_timeout', \$1, true\)/);
    assert.match(calls[0].text, /set_config\('statement_timeout', \$2, true\)/);
    assert.deepEqual(calls[0].values, ['15000ms', '240000ms']);

    await configureRestoreTimeouts(client, {
        lockTimeoutMs: 125,
        statementTimeoutMs: 500
    });
    assert.deepEqual(calls[1].values, ['125ms', '500ms']);
    await expectCode(
        () => configureRestoreTimeouts(client, { lockTimeoutMs: 0 }),
        'BACKUP_RESTORE_TIMEOUT_INVALID'
    );
});

test('restore rolls back and sanitizes PostgreSQL lock and statement timeouts', async () => {
    const cases = [
        ['55P03', 'BACKUP_RESTORE_LOCK_TIMEOUT'],
        ['57014', 'BACKUP_RESTORE_STATEMENT_TIMEOUT']
    ];

    for (const [postgresCode, expectedCode] of cases) {
        const calls = [];
        const client = {
            async query(text, values) {
                calls.push({ text, values });
                const isSessionLock = text.includes('pg_advisory_lock_shared');
                const isTransactionLock = text.includes('pg_advisory_xact_lock_shared');
                if ((postgresCode === '55P03' && isSessionLock)
                    || (postgresCode === '57014' && isTransactionLock)) {
                    const error = new Error('sensitive PostgreSQL diagnostic');
                    error.code = postgresCode;
                    throw error;
                }
                if (text.includes('pg_advisory_unlock_shared')) {
                    return { rows: [{ unlocked: true }] };
                }
                return { rows: [] };
            }
        };

        await assert.rejects(
            () => executeRestorePlan(client, { mode: 'selective' }),
            error => {
                assert.equal(error.code, expectedCode);
                assert.equal(error.statusCode, 503);
                assert.doesNotMatch(error.message, /sensitive|PostgreSQL diagnostic/);
                return true;
            }
        );
        const labels = calls.map(call => {
            if (call.text.includes("set_config('lock_timeout', $1, false)")) {
                return 'SESSION_TIMEOUT';
            }
            if (call.text.includes("set_config('lock_timeout', '0', false)")) {
                return 'SESSION_TIMEOUT_RESET';
            }
            if (call.text.includes('pg_advisory_unlock_shared')) return 'SESSION_UNLOCK';
            if (call.text.includes('pg_advisory_xact_lock_shared')) return 'XACT_LOCK';
            if (call.text.includes('pg_advisory_lock_shared')) return 'SESSION_LOCK';
            if (call.text.includes('set_config')) return 'TIMEOUTS';
            return call.text;
        });
        assert.deepEqual(
            labels,
            postgresCode === '55P03'
                ? ['SESSION_TIMEOUT', 'SESSION_LOCK', 'SESSION_TIMEOUT_RESET']
                : [
                    'SESSION_TIMEOUT', 'SESSION_LOCK', 'SESSION_TIMEOUT_RESET',
                    'BEGIN', 'TIMEOUTS', 'XACT_LOCK', 'ROLLBACK', 'SESSION_UNLOCK'
                ]
        );
    }
});

test('recovery encryption uses authenticated GCM and rejects tampering', async () => {
    const artifact = fixtureArtifact();
    const passphrase = 'disposable recovery test passphrase';
    const envelope = encryptBackupArtifact(artifact, passphrase);
    assert.equal(envelope.cipher, 'aes-256-gcm');
    assert.deepEqual(decryptBackupArtifact(envelope, passphrase), artifact);

    const bytes = Buffer.from(envelope.ciphertext, 'base64');
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    await expectCode(
        () => decryptBackupArtifact({
            ...envelope,
            ciphertext: bytes.toString('base64')
        }, passphrase),
        'BACKUP_ARTIFACT_AUTH_FAILED'
    );
});

test('executor owns transaction, typed parameters, trigger control and pre-commit abort checks', () => {
    const source = read('services', 'backupRecovery.js');
    assert.ok(
        source.indexOf('lockBackupSchemaSnapshotSession(client')
            < source.indexOf("await client.query('BEGIN')"),
        'session schema fence must be acquired before the restore transaction starts'
    );
    assert.match(source, /await client\.query\('BEGIN'\)/);
    assert.match(source, /configureRestoreTimeouts\(client, \{ lockTimeoutMs, statementTimeoutMs \}\)/);
    assert.match(source, /lockAttendanceWriteMaintenance\(client\)/);
    assert.match(source, /LOCK TABLE \$\{ordered\.map\(quotePublicRelation\)\.join/);
    assert.match(source, /DISABLE TRIGGER USER/);
    assert.match(source, /restoreTriggerModes\(client, targetCatalog, plan\.selectedTables\)/);
    assert.match(source, /closingCatalog\.schemaFingerprint !== plan\.manifest\.schemaFingerprint/);
    assert.match(source, /values\.push\(breakColumns\?\.has\(column\) \? null : value\)/);
    assert.match(source, /verifyRestoredTables/);
    assert.match(source, /assertNotAborted\(signal\);\s*await client\.query\('COMMIT'\)/);
    assert.match(source, /await client\.query\('ROLLBACK'\)/);
    assert.doesNotMatch(source, /client\.query\(statement\)/);
});

test('backup snapshot is schema-fenced, RLS fail-closed and timestamped in SQL UTC', () => {
    const generator = read('services', 'backup.js');
    const catalog = read('services', 'backupCatalog.js');
    const migrationRunner = read('db', 'migrate.js');

    assert.match(generator, /lockBackupSchemaSnapshot\(client\)/);
    assert.ok(
        generator.indexOf('lockBackupSchemaSnapshotSession(client)')
            < generator.indexOf('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'),
        'session schema fence must be acquired before the backup transaction starts'
    );
    assert.match(generator, /unlockBackupSchemaSnapshotSession\(client\)/);
    assert.match(generator, /to_char\([\s\S]*transaction_timestamp\(\) AT TIME ZONE 'UTC'/);
    assert.match(catalog, /SET LOCAL row_security = off/);
    assert.match(catalog, /pg_get_triggerdef/);
    assert.match(catalog, /FROM pg_policies/);
    assert.match(migrationRunner, /lockSchemaMigrations\(client\)/);
});

test('routes remove CBC, URL keys and raw statement execution', () => {
    const source = read('routes', 'backup.js');
    assert.doesNotMatch(source, /aes-256-cbc/i);
    assert.doesNotMatch(source, /req\.query\.key/);
    assert.doesNotMatch(source, /client\.query\(statement\)/);
    assert.match(source, /assertRestoreConfirmation\(req\.headers\)/);
    assert.match(source, /x-backup-encryption-key/);
    assert.match(source, /await logAdminAction\('backup_restore'/);
    assert.match(source, /await logAdminAction\('backup_create'/);
});

test('Telegram backup delivery is encrypted and fails closed without a key', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'backup.js'), 'utf8');
    const delivery = source.slice(source.indexOf('async function sendBackupToTelegram'));

    assert.match(delivery, /BACKUP_ENCRYPTION_KEY_REQUIRED/);
    assert.match(delivery, /encryptRecoveryBundle\(artifact, passphrase\)/);
    assert.match(delivery, /\.egbackup\.enc\.json/);
    assert.match(delivery, /application\/vnd\.eventgenix\.backup\.encrypted\+json/);
    assert.doesNotMatch(delivery, /filename=.*\.egbackup\.json/);
    assert.ok(
        delivery.indexOf('BACKUP_ENCRYPTION_KEY_REQUIRED')
            < delivery.indexOf('generateBackupArtifact()'),
        'encryption key must be required before the database artifact is generated'
    );
});

test('large restore parser runs after auth and the creator/director role gate', () => {
    const source = read('server.js');
    const auth = source.indexOf("app.use('/api', apiAuthBoundary(authenticateToken))");
    const role = source.indexOf('const backupRestorePreParserGuard', auth);
    const parser = source.indexOf('express.json({ limit: BACKUP_RESTORE_JSON_LIMIT })', role);
    assert.ok(auth >= 0 && role > auth && parser > role);
    assert.match(source, /const requestPath = String\(req\.originalUrl \|\| req\.url \|\| req\.path \|\| ''\)/);
    assert.match(source, /if \(isBackupRestoreRequest\(req\)\) return next\(\)/);
    assert.equal(isBackupRestoreRequestPath('/api/backup/restore'), true);
    assert.equal(isBackupRestoreRequestPath('/api/backup/restore/'), true);
    assert.equal(isBackupRestoreRequestPath('/API/BACKUP/RESTORE/'), true);
    assert.equal(isBackupRestoreRequestPath('/api/v1/backup/restore-encrypted?request=1'), true);
    assert.equal(isBackupRestoreRequestPath('/api/v1/backup/restore-encrypted/?request=1'), true);
    assert.equal(isBackupRestoreRequestPath('/API/V1/BACKUP/RESTORE-ENCRYPTED/'), true);
    assert.equal(isBackupRestoreRequestPath('/backup/restore'), false);
});

test('restore path detection survives real Express mount, case, slash and query semantics', async t => {
    const app = express();
    app.use((req, _res, next) => {
        const requestPath = String(req.originalUrl || req.url || req.path || '').split('?')[0];
        req.backupRestoreDetected = isBackupRestoreRequestPath(requestPath);
        next();
    });
    app.post([
        '/api/backup/restore',
        '/api/v1/backup/restore-encrypted'
    ], (req, res) => res.json({ detected: req.backupRestoreDetected }));

    const server = await new Promise((resolve, reject) => {
        const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
        candidate.once('error', reject);
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const { port } = server.address();
    const paths = [
        '/api/backup/restore',
        '/api/backup/restore/',
        '/API/BACKUP/RESTORE/?request=1',
        '/api/v1/backup/restore-encrypted',
        '/api/v1/backup/restore-encrypted/?request=1',
        '/API/V1/BACKUP/RESTORE-ENCRYPTED/'
    ];

    for (const requestPath of paths) {
        const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {
            method: 'POST'
        });
        assert.equal(response.status, 200, requestPath);
        assert.deepEqual(await response.json(), { detected: true }, requestPath);
    }
});

test('recovery authentication is fresh, identity-bound and free of activity writes', () => {
    const auth = read('middleware', 'auth.js');
    const server = read('server.js');

    assert.match(auth, /const recoveryMode = process\.env\.BACKUP_RECOVERY_MODE === 'true'/);
    assert.match(auth, /requireFresh: recoveryMode/);
    assert.match(auth, /requireIdentityMatch: recoveryMode/);
    assert.match(auth, /tokenUsername !== freshUsername/);
    assert.match(auth, /if \(user\.id && !recoveryMode\)/);
    assert.match(server, /const BACKUP_OUTBOUND_HOLD = process\.env\.BACKUP_OUTBOUND_HOLD === 'true'/);
    assert.match(server, /if \(BACKUP_OUTBOUND_HOLD\) \{[\s\S]*background and provider side effects remain disabled[\s\S]*return;/);
});

test('plain and encrypted backup downloads await sanitized success audit receipts', async () => {
    const artifact = {
        format: 'eventgenix.backup',
        version: 2,
        payload: 'plain-secret-payload'
    };
    const auditGate = deferred();
    const auditCalls = [];
    const harness = loadBackupAuditRouter({
        generateBackupArtifact: async () => artifact,
        logAdminAction: async (...args) => {
            auditCalls.push(args);
            if (auditCalls.length === 1) await auditGate.promise;
        }
    });

    try {
        const plainResponse = backupResponseCapture();
        const plainRun = backupRouteHandler(harness.router, '/download')(
            backupAuditRequest({ 'x-request-id': 'audit-plain-1' }),
            plainResponse
        );
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(plainResponse.body, undefined, 'download waits for its durable audit insert');
        assert.equal(auditCalls.length, 1);
        auditGate.resolve();
        await plainRun;

        const plainDetails = auditCalls[0][2].details;
        assert.equal(auditCalls[0][0], 'backup_download');
        assert.equal(auditCalls[0][1], 'backup');
        assert.deepEqual(plainDetails, {
            success: true,
            encrypted: false,
            formatVersion: 2,
            artifactId: 'a'.repeat(64),
            sizeBytes: Buffer.byteLength(JSON.stringify(artifact), 'utf8')
        });
        assert.doesNotMatch(JSON.stringify(auditCalls[0]), /plain-secret-payload/);

        const encryptedResponse = backupResponseCapture();
        await backupRouteHandler(harness.router, '/download-encrypted')(
            backupAuditRequest({
                'x-request-id': 'audit-encrypted-1',
                'x-backup-encryption-key': 'disposable-audit-passphrase'
            }),
            encryptedResponse
        );
        assert.equal(auditCalls.length, 2);
        assert.equal(auditCalls[1][2].details.success, true);
        assert.equal(auditCalls[1][2].details.encrypted, true);
        assert.equal(auditCalls[1][2].details.artifactId, 'a'.repeat(64));
        assert.equal(typeof auditCalls[1][2].details.sizeBytes, 'number');
        assert.doesNotMatch(JSON.stringify(auditCalls[1]), /encrypted-secret-payload|passphrase/);
    } finally {
        harness.cleanup();
    }
});

test('backup downloads fail closed without a durable success audit receipt', async () => {
    const artifact = {
        format: 'eventgenix.backup',
        version: 2,
        payload: 'plain-secret-payload'
    };
    const strictCalls = [];
    const failureCalls = [];
    const harness = loadBackupAuditRouter({
        generateBackupArtifact: async () => artifact,
        logAdminActionStrict: async (...args) => {
            strictCalls.push(args);
            throw Object.assign(new Error('postgres://secret@production.invalid/audit'), {
                code: '42P01'
            });
        },
        logAdminAction: async (...args) => { failureCalls.push(args); }
    });

    try {
        const plainResponse = backupResponseCapture();
        await backupRouteHandler(harness.router, '/download')(
            backupAuditRequest({ 'x-request-id': 'audit-plain-required' }),
            plainResponse
        );
        assert.equal(plainResponse.statusCode, 503);
        assert.deepEqual(plainResponse.body, {
            error: 'BACKUP_DOWNLOAD_AUDIT_REQUIRED',
            requestId: 'audit-plain-required'
        });
        assert.equal(plainResponse.sendCalls, 0);
        assert.equal(plainResponse.headers['content-disposition'], undefined);

        const encryptedResponse = backupResponseCapture();
        await backupRouteHandler(harness.router, '/download-encrypted')(
            backupAuditRequest({
                'x-request-id': 'audit-encrypted-required',
                'x-backup-encryption-key': 'disposable-audit-passphrase'
            }),
            encryptedResponse
        );
        assert.equal(encryptedResponse.statusCode, 503);
        assert.deepEqual(encryptedResponse.body, {
            error: 'BACKUP_DOWNLOAD_AUDIT_REQUIRED',
            requestId: 'audit-encrypted-required'
        });
        assert.equal(encryptedResponse.sendCalls, 0);
        assert.equal(encryptedResponse.headers['content-disposition'], undefined);

        assert.equal(strictCalls.length, 2);
        assert.equal(failureCalls.length, 2);
        for (const call of failureCalls) {
            assert.equal(call[2].details.success, false);
            assert.equal(call[2].details.errorCode, 'BACKUP_DOWNLOAD_AUDIT_REQUIRED');
        }
        assert.doesNotMatch(
            JSON.stringify([...strictCalls, ...failureCalls, plainResponse.body, encryptedResponse.body]),
            /plain-secret-payload|encrypted-secret-payload|secret@production|passphrase/
        );
    } finally {
        harness.cleanup();
    }
});

test('backup download failures audit only stable codes and never raw diagnostics', async () => {
    const auditCalls = [];
    const sensitiveError = Object.assign(
        new Error('postgres://secret-user:secret-password@production.invalid/database'),
        { code: 'unsafe diagnostic with spaces', statusCode: 503 }
    );
    const harness = loadBackupAuditRouter({
        generateBackupArtifact: async () => { throw sensitiveError; },
        logAdminAction: async (...args) => { auditCalls.push(args); }
    });

    try {
        const plainResponse = backupResponseCapture();
        await backupRouteHandler(harness.router, '/download')(
            backupAuditRequest({ 'x-request-id': 'audit-plain-failure' }),
            plainResponse
        );
        assert.equal(plainResponse.statusCode, 503);
        assert.equal(plainResponse.body.error, 'BACKUP_RECOVERY_FAILED');
        assert.deepEqual(auditCalls[0][2].details, {
            success: false,
            encrypted: false,
            formatVersion: 2,
            errorCode: 'BACKUP_DOWNLOAD_FAILED'
        });

        const encryptedResponse = backupResponseCapture();
        await backupRouteHandler(harness.router, '/download-encrypted')(
            backupAuditRequest({
                'x-request-id': 'audit-encrypted-failure',
                'x-backup-encryption-key': 'disposable-audit-passphrase'
            }),
            encryptedResponse
        );
        assert.equal(encryptedResponse.statusCode, 503);
        assert.equal(encryptedResponse.body.error, 'BACKUP_RECOVERY_FAILED');
        assert.equal(auditCalls[1][2].details.errorCode, 'BACKUP_ENCRYPTED_DOWNLOAD_FAILED');
        assert.equal(auditCalls[1][2].details.encrypted, true);

        const missingKeyResponse = backupResponseCapture();
        await backupRouteHandler(harness.router, '/download-encrypted')(
            backupAuditRequest({ 'x-request-id': 'audit-missing-key' }),
            missingKeyResponse
        );
        assert.equal(missingKeyResponse.statusCode, 400);
        assert.equal(missingKeyResponse.body.error, 'BACKUP_ENCRYPTION_KEY_REQUIRED');
        assert.equal(auditCalls[2][2].details.errorCode, 'BACKUP_ENCRYPTION_KEY_REQUIRED');
        assert.doesNotMatch(
            JSON.stringify(auditCalls),
            /secret-user|secret-password|production\.invalid|unsafe diagnostic/
        );
    } finally {
        harness.cleanup();
    }
});
