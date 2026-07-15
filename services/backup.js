/**
 * Database recovery bundle generation and Telegram delivery.
 *
 * The v2 format is a typed, manifest-backed artifact. It intentionally does
 * not emit executable SQL: restore is performed with server-owned,
 * parameterized statements only.
 */
'use strict';

const https = require('node:https');
const { pool } = require('../db');
const packageJson = require('../package.json');
const { TELEGRAM_BOT_TOKEN, getConfiguredChatId, getConfiguredThreadId } = require('./telegram');
const { getKyivDateStr } = require('./booking');
const { createLogger } = require('../utils/logger');
const {
    configureBackupSession,
    loadBackupCatalog,
    readMigrationState,
    readSequenceStates,
    readTableBackupFootprint,
    readTableRows
} = require('./backupCatalog');
const {
    canonicalJson,
    canonicalJsonHash,
    createRecoveryBundle,
    encryptRecoveryBundle,
    isValidRecoveryPassphrase
} = require('./backupArtifact');
const { validateBackupArtifact } = require('./backupRecovery');
const {
    lockBackupSchemaSnapshot,
    lockBackupSchemaSnapshotSession,
    unlockBackupSchemaSnapshotSession
} = require('./backupSchemaLock');
const {
    BACKUP_EXCLUDED_TABLES,
    BACKUP_MAX_ENVELOPE_BYTES,
    BACKUP_MAX_PAYLOAD_BYTES
} = require('../config/backupRestorePolicy');

const log = createLogger('Backup');
const MAX_TELEGRAM_BACKUP_BYTES = BACKUP_MAX_ENVELOPE_BYTES;
const BACKUP_GENERATION_ERROR_CODES = Object.freeze({
    SIZE_LIMIT_EXCEEDED: 'BACKUP_GENERATION_SIZE_LIMIT_EXCEEDED',
    PREFLIGHT_INVALID: 'BACKUP_GENERATION_PREFLIGHT_INVALID'
});

function excludedTableNames() {
    if (BACKUP_EXCLUDED_TABLES instanceof Map) {
        return new Set(BACKUP_EXCLUDED_TABLES.keys());
    }
    return new Set(Object.keys(BACKUP_EXCLUDED_TABLES || {}));
}

function backupGenerationError(code, message, statusCode = 500) {
    const error = new Error(message);
    error.name = 'BackupGenerationError';
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function assertPayloadByteLimit(bytes, maxPayloadBytes) {
    if (bytes > BigInt(maxPayloadBytes)) {
        throw backupGenerationError(
            BACKUP_GENERATION_ERROR_CODES.SIZE_LIMIT_EXCEEDED,
            'Backup payload exceeds the configured generation size limit',
            413
        );
    }
}

function rowPayloadDelta(rowCount, encodedRowBytes) {
    return rowCount === 0n ? 0n : encodedRowBytes + rowCount - 1n;
}

/**
 * Scan only aggregate size metadata first. This deliberately completes before
 * readTableRows() is called for any table, so an oversized database cannot
 * make Node.js retain a partial multi-table snapshot and fail only at gzip.
 */
async function preflightBackupPayload(
    client,
    catalog,
    sequences,
    { maxPayloadBytes = BACKUP_MAX_PAYLOAD_BYTES } = {}
) {
    if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes <= 0) {
        throw backupGenerationError(
            BACKUP_GENERATION_ERROR_CODES.PREFLIGHT_INVALID,
            'Backup generation size limit is invalid'
        );
    }

    const tableStats = [];
    let estimatedRowsDelta = 0n;

    for (const table of catalog.tables) {
        const footprint = await readTableBackupFootprint(client, table);
        const tableRowsDelta = rowPayloadDelta(
            footprint.rowCount,
            footprint.encodedRowBytes
        );
        estimatedRowsDelta += tableRowsDelta;
        // Row bytes alone are a lower bound for the complete canonical payload.
        // Stop scanning as soon as they already exceed the hard output budget.
        assertPayloadByteLimit(estimatedRowsDelta, maxPayloadBytes);
        if (footprint.rowCount > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw backupGenerationError(
                BACKUP_GENERATION_ERROR_CODES.SIZE_LIMIT_EXCEEDED,
                'Backup payload exceeds the configured generation size limit',
                413
            );
        }
        tableStats.push({
            name: table.name,
            rowCount: Number(footprint.rowCount),
            encodedRowBytes: footprint.encodedRowBytes,
            rowsDelta: tableRowsDelta
        });
    }

    // `rows: []` contributes its two bracket bytes already. Replacing it with
    // real rows adds the measured row JSON plus N-1 commas per non-empty table.
    // A 64-character placeholder exactly matches every SHA-256 checksum.
    const skeleton = {
        tables: tableStats.map(stat => {
            const table = catalog.tableMap.get(stat.name);
            return {
                name: stat.name,
                columns: table.columns
                    .filter(column => !column.generatedKind)
                    .map(column => column.name),
                rows: [],
                rowCount: stat.rowCount,
                checksum: '0'.repeat(64)
            };
        }),
        sequences
    };
    const skeletonBytes = BigInt(Buffer.byteLength(canonicalJson(skeleton), 'utf8'));
    const estimatedPayloadBytes = skeletonBytes + estimatedRowsDelta;
    assertPayloadByteLimit(estimatedPayloadBytes, maxPayloadBytes);

    return {
        skeletonBytes,
        estimatedRowsDelta,
        estimatedPayloadBytes,
        tableStats,
        tableStatsByName: new Map(tableStats.map(stat => [stat.name, stat]))
    };
}

async function generateBackupArtifact() {
    const client = await pool.connect();
    let transactionOpen = false;
    let sessionSchemaLockHeld = false;
    let primaryError = null;
    try {
        await lockBackupSchemaSnapshotSession(client);
        sessionSchemaLockHeld = true;
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        transactionOpen = true;
        await lockBackupSchemaSnapshot(client);
        await unlockBackupSchemaSnapshotSession(client);
        sessionSchemaLockHeld = false;
        await configureBackupSession(client);

        const generatedAtResult = await client.query(
            `SELECT to_char(
                transaction_timestamp() AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) AS generated_at`
        );
        const catalog = await loadBackupCatalog(client, {
            excludedTables: excludedTableNames()
        });
        const migrationState = await readMigrationState(client);
        const sequences = await readSequenceStates(client, catalog.sequences);
        const preflight = await preflightBackupPayload(client, catalog, sequences);
        const tablePayload = [];
        let actualRowsDelta = 0n;
        let remainingEstimatedRowsDelta = preflight.estimatedRowsDelta;

        // Alphabetical export order makes the artifact deterministic. Restore
        // uses catalog.restoreOrder, which is separately FK-safe.
        for (const table of catalog.tables) {
            const expected = preflight.tableStatsByName.get(table.name);
            const data = await readTableRows(client, table);
            const actualEncodedRowBytes = BigInt(data.encodedRowBytes);
            if (!expected
                || data.rowCount !== expected.rowCount
                || actualEncodedRowBytes > expected.encodedRowBytes) {
                throw backupGenerationError(
                    BACKUP_GENERATION_ERROR_CODES.PREFLIGHT_INVALID,
                    'Backup generation size preflight did not match the snapshot'
                );
            }
            remainingEstimatedRowsDelta -= expected.rowsDelta;
            actualRowsDelta += rowPayloadDelta(
                BigInt(data.rowCount),
                actualEncodedRowBytes
            );
            assertPayloadByteLimit(
                preflight.skeletonBytes + actualRowsDelta + remainingEstimatedRowsDelta,
                BACKUP_MAX_PAYLOAD_BYTES
            );
            tablePayload.push({
                name: table.name,
                columns: data.columns,
                rows: data.rows,
                rowCount: data.rowCount,
                checksum: data.checksum
            });
        }

        assertPayloadByteLimit(
            preflight.skeletonBytes + actualRowsDelta,
            BACKUP_MAX_PAYLOAD_BYTES
        );
        await client.query('COMMIT');
        transactionOpen = false;

        const manifestTables = tablePayload.map(tableData => {
            const catalogTable = catalog.tableMap.get(tableData.name);
            return {
                name: tableData.name,
                columns: tableData.columns,
                primaryKey: catalogTable.primaryKey,
                rowCount: tableData.rowCount,
                checksum: tableData.checksum
            };
        });
        const totalRows = manifestTables.reduce((sum, table) => sum + table.rowCount, 0);
        const generatedAt = generatedAtResult.rows[0].generated_at;

        const artifact = createRecoveryBundle({
            manifest: {
                complete: true,
                generatedAt,
                applicationVersion: packageJson.version,
                releaseLabel: packageJson.eventGenix?.releaseLabel || null,
                scope: { kind: 'database', id: 'eventgenix-public-v2' },
                schemaFingerprint: catalog.schemaFingerprint,
                migrationFingerprint: migrationState.fingerprint,
                migrationHead: migrationState.head,
                excludedTables: catalog.excludedTables,
                tableCount: manifestTables.length,
                totalRows,
                sequenceCount: sequences.length,
                sequenceChecksum: canonicalJsonHash(sequences),
                tables: manifestTables,
                restoreOrder: catalog.restoreOrder,
                deferredForeignKeys: catalog.deferredForeignKeys
            },
            payload: {
                tables: tablePayload,
                sequences
            }
        });
        validateBackupArtifact(artifact);
        return artifact;
    } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        primaryError = error?.code === '55P03'
            ? backupGenerationError(
                'BACKUP_SCHEMA_LOCK_TIMEOUT',
                'Backup could not acquire the schema snapshot lock in time',
                503
            )
            : error;
        throw primaryError;
    } finally {
        let cleanupError = null;
        if (sessionSchemaLockHeld) {
            try {
                await unlockBackupSchemaSnapshotSession(client);
            } catch (error) {
                cleanupError = error;
            }
        }
        client.release(
            cleanupError || (primaryError?.destroyClient ? primaryError : undefined)
        );
        if (cleanupError && !primaryError) throw cleanupError;
    }
}

async function generateBackupBundleText() {
    return JSON.stringify(await generateBackupArtifact());
}

function sendTelegramDocument({ bodyBuffer, boundary }) {
    return new Promise((resolve, reject) => {
        const request = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': bodyBuffer.length
            }
        }, response => {
            let data = '';
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.on('error', reject);
        request.write(bodyBuffer);
        request.end();
    });
}

async function sendBackupToTelegram({ passphrase = process.env.BACKUP_ENCRYPTION_KEY } = {}) {
    try {
        if (!isValidRecoveryPassphrase(passphrase)) {
            log.warn('Encrypted backup delivery is disabled because no backup encryption key is configured');
            return { success: false, error: 'BACKUP_ENCRYPTION_KEY_REQUIRED' };
        }
        const backupChatResult = await pool.query(
            "SELECT value FROM settings WHERE key = 'backup_chat_id'"
        );
        const chatId = backupChatResult.rows[0]?.value || await getConfiguredChatId();
        if (!chatId || !TELEGRAM_BOT_TOKEN) {
            log.warn('No chat ID or bot token - skipping backup');
            return { success: false, reason: 'no_config' };
        }

        const artifact = await generateBackupArtifact();
        const envelope = encryptRecoveryBundle(artifact, passphrase);
        const artifactBuffer = Buffer.from(JSON.stringify(envelope), 'utf8');
        if (artifactBuffer.length > MAX_TELEGRAM_BACKUP_BYTES) {
            const error = new Error('Recovery bundle exceeds the safe Telegram upload limit');
            error.code = 'BACKUP_TELEGRAM_SIZE_LIMIT';
            throw error;
        }

        const dateStr = getKyivDateStr();
        const fileName = `eventgenix_${dateStr}.egbackup.enc.json`;
        const threadId = await getConfiguredThreadId();
        const boundary = `----EventGenixBackupBoundary${Date.now()}`;
        const parts = [
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n`,
            `Event Genix encrypted DB recovery bundle - ${dateStr}\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="disable_notification"\r\n\r\ntrue\r\n`
        ];
        if (threadId) {
            parts.push(
                `--${boundary}\r\nContent-Disposition: form-data; name="message_thread_id"\r\n\r\n${threadId}\r\n`
            );
        }
        parts.push(
            `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\n`,
            'Content-Type: application/vnd.eventgenix.backup.encrypted+json\r\n\r\n'
        );
        const bodyBuffer = Buffer.concat([
            Buffer.from(parts.join(''), 'utf8'),
            artifactBuffer,
            Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
        ]);
        const result = await sendTelegramDocument({ bodyBuffer, boundary });
        log.info(`Recovery bundle sent to configured chat: ${result?.ok ? 'OK' : 'FAIL'}`);
        return {
            success: Boolean(result?.ok),
            size: artifactBuffer.length,
            formatVersion: 2,
            encrypted: true,
            cipher: 'aes-256-gcm'
        };
    } catch (error) {
        log.error('Backup failed', { code: error?.code || 'BACKUP_GENERATION_FAILED' });
        return { success: false, error: error.code || 'BACKUP_GENERATION_FAILED' };
    }
}

module.exports = {
    BACKUP_GENERATION_ERROR_CODES,
    generateBackupArtifact,
    generateBackupBundleText,
    preflightBackupPayload,
    sendBackupToTelegram
};
