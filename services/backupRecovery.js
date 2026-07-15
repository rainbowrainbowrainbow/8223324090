'use strict';

const packageJson = require('../package.json');
const { lockAttendanceWriteMaintenance } = require('./attendanceWriteLock');
const {
    lockBackupSchemaSnapshot,
    lockBackupSchemaSnapshotSession,
    unlockBackupSchemaSnapshotSession
} = require('./backupSchemaLock');
const {
    canonicalJsonHash,
    decryptRecoveryBundle,
    encryptRecoveryBundle,
    parseRecoveryBundle
} = require('./backupArtifact');
const {
    configureBackupSession,
    loadBackupCatalog,
    quoteIdentifier,
    quotePublicRelation,
    readMigrationState,
    readTableRows,
    sha256
} = require('./backupCatalog');
const {
    BACKUP_EXCLUDED_TABLES,
    BACKUP_RESTORE_CONFIRMATION_HEADER,
    FULL_RESTORE_SUPPORTED,
    LEGACY_SQL_RESTORE_SUPPORTED,
    RESTORE_SETS
} = require('../config/backupRestorePolicy');

const MAX_INSERT_PARAMETERS = 50_000;
const MAX_INSERT_ROWS_PER_BATCH = 250;
const DEFAULT_RESTORE_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_RESTORE_STATEMENT_TIMEOUT_MS = 240_000;
const MAX_POSTGRES_TIMEOUT_MS = 2_147_483_647;
const ATTENDANCE_TABLES = new Set(['staff_checkins', 'hr_time_records']);

class BackupRecoveryError extends Error {
    constructor(code, message, statusCode = 400, details = undefined) {
        super(message);
        this.name = 'BackupRecoveryError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function recoveryError(code, message, statusCode = 400, details = undefined) {
    return new BackupRecoveryError(code, message, statusCode, details);
}

function excludedTableNames() {
    return new Set(Object.keys(BACKUP_EXCLUDED_TABLES || {}));
}

function ensureArray(value, code, label) {
    if (!Array.isArray(value)) throw recoveryError(code, `${label} must be an array`);
    return value;
}

function ensureSafeName(value, label) {
    const name = String(value || '');
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
        throw recoveryError('BACKUP_ARTIFACT_INVENTORY_MISMATCH', `${label} contains an unsafe name`);
    }
    return name;
}

function uniqueNames(values, label) {
    const names = ensureArray(values, 'BACKUP_ARTIFACT_INVENTORY_MISMATCH', label)
        .map(value => ensureSafeName(value, label));
    if (new Set(names).size !== names.length) {
        throw recoveryError('BACKUP_ARTIFACT_INVENTORY_MISMATCH', `${label} contains duplicates`);
    }
    return names;
}

function parseArtifactInput(input) {
    if (input && typeof input === 'object' && !Buffer.isBuffer(input) && 'sql' in input) {
        throw recoveryError('BACKUP_RAW_SQL_FORBIDDEN', 'Legacy raw SQL restore is disabled');
    }
    try {
        if (typeof input === 'string') {
            const parsed = JSON.parse(input);
            if (parsed && typeof parsed === 'object' && 'sql' in parsed) {
                throw recoveryError('BACKUP_RAW_SQL_FORBIDDEN', 'Legacy raw SQL restore is disabled');
            }
            return { rawArtifact: parsed, ...parseRecoveryBundle(parsed) };
        }
        return { rawArtifact: input, ...parseRecoveryBundle(input) };
    } catch (error) {
        if (error instanceof BackupRecoveryError) throw error;
        throw recoveryError(
            error?.code || 'BACKUP_ARTIFACT_INVALID',
            'Recovery artifact validation failed',
            400
        );
    }
}

function validateBackupArtifact(input) {
    const parsed = parseArtifactInput(input);
    const { manifest, payload } = parsed;
    if (manifest?.complete !== true) {
        throw recoveryError('BACKUP_ARTIFACT_INCOMPLETE', 'Recovery artifact is not complete');
    }
    if (manifest.applicationVersion !== packageJson.version) {
        throw recoveryError(
            'BACKUP_ARTIFACT_VERSION_MISMATCH',
            'Recovery artifact belongs to a different Event Genix release',
            409,
            { expected: packageJson.version, actual: manifest.applicationVersion || null }
        );
    }
    if (typeof manifest.schemaFingerprint !== 'string'
        || !/^[a-f0-9]{64}$/.test(manifest.schemaFingerprint)
        || typeof manifest.migrationFingerprint !== 'string'
        || !/^[a-f0-9]{64}$/.test(manifest.migrationFingerprint)) {
        throw recoveryError(
            'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
            'Recovery artifact schema metadata is invalid'
        );
    }

    const manifestTables = ensureArray(
        manifest.tables,
        'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
        'Manifest tables'
    );
    const payloadTables = ensureArray(
        payload?.tables,
        'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
        'Payload tables'
    );
    if (manifest.tableCount !== manifestTables.length
        || payloadTables.length !== manifestTables.length) {
        throw recoveryError(
            'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
            'Recovery artifact table count does not match its inventory'
        );
    }

    const manifestNames = uniqueNames(manifestTables.map(table => table?.name), 'Manifest tables');
    const payloadNames = uniqueNames(payloadTables.map(table => table?.name), 'Payload tables');
    if (manifestNames.slice().sort().join('\n') !== payloadNames.slice().sort().join('\n')) {
        throw recoveryError(
            'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
            'Manifest and payload table inventories differ'
        );
    }
    const restoreOrder = uniqueNames(manifest.restoreOrder, 'Restore order');
    if (restoreOrder.slice().sort().join('\n') !== manifestNames.slice().sort().join('\n')) {
        throw recoveryError(
            'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
            'Restore order does not cover the complete table inventory'
        );
    }

    const expectedExclusions = [...excludedTableNames()].sort();
    const artifactExclusions = uniqueNames(manifest.excludedTables, 'Excluded tables').sort();
    if (expectedExclusions.join('\n') !== artifactExclusions.join('\n')) {
        throw recoveryError(
            'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
            'Recovery artifact exclusion policy does not match this release'
        );
    }

    const manifestMap = new Map();
    for (const table of manifestTables) {
        const name = ensureSafeName(table.name, 'Manifest table');
        const columns = uniqueNames(table.columns, `${name} columns`);
        const primaryKey = uniqueNames(table.primaryKey || [], `${name} primary key`);
        if (primaryKey.some(column => !columns.includes(column))) {
            throw recoveryError(
                'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
                `Primary key metadata is invalid for ${name}`
            );
        }
        if (!Number.isSafeInteger(table.rowCount) || table.rowCount < 0
            || typeof table.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(table.checksum)) {
            throw recoveryError(
                'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
                `Row metadata is invalid for ${name}`
            );
        }
        manifestMap.set(name, { ...table, columns, primaryKey });
    }

    const payloadMap = new Map();
    for (const table of payloadTables) {
        const name = ensureSafeName(table.name, 'Payload table');
        const manifestTable = manifestMap.get(name);
        const columns = uniqueNames(table.columns, `${name} payload columns`);
        const rows = ensureArray(
            table.rows,
            'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
            `${name} rows`
        );
        if (columns.join('\n') !== manifestTable.columns.join('\n')
            || table.rowCount !== rows.length
            || table.rowCount !== manifestTable.rowCount
            || table.checksum !== manifestTable.checksum
            || sha256(JSON.stringify(rows)) !== table.checksum) {
            throw recoveryError(
                'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
                `Payload metadata does not match the manifest for ${name}`
            );
        }
        for (const row of rows) {
            if (!Array.isArray(row) || row.length !== columns.length
                || row.some(value => value !== null && typeof value !== 'string')) {
                throw recoveryError(
                    'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
                    `Typed row data is invalid for ${name}`
                );
            }
        }
        payloadMap.set(name, { ...table, columns, rows });
    }

    const deferredForeignKeys = ensureArray(
        manifest.deferredForeignKeys || [],
        'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
        'Deferred foreign keys'
    ).map(foreignKey => {
        const table = ensureSafeName(foreignKey?.table, 'Deferred foreign key table');
        const referencedTable = ensureSafeName(
            foreignKey?.referencedTable,
            'Deferred foreign key referenced table'
        );
        const tableManifest = manifestMap.get(table);
        if (!tableManifest || !manifestMap.has(referencedTable)) {
            throw recoveryError(
                'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
                'Deferred foreign key references an unknown table'
            );
        }
        const breakColumns = uniqueNames(
            foreignKey.breakColumns,
            'Deferred foreign key break columns'
        );
        const primaryKey = uniqueNames(
            foreignKey.primaryKey,
            'Deferred foreign key primary key'
        );
        if (breakColumns.some(column => !tableManifest.columns.includes(column))
            || primaryKey.length === 0
            || primaryKey.some(column => !tableManifest.primaryKey.includes(column))) {
            throw recoveryError(
                'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
                'Deferred foreign key metadata is invalid'
            );
        }
        return { ...foreignKey, table, referencedTable, breakColumns, primaryKey };
    });

    const sequences = ensureArray(
        payload?.sequences,
        'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
        'Payload sequences'
    ).map(sequence => {
        const name = ensureSafeName(sequence?.name, 'Sequence');
        const ownedTable = sequence.ownedTable === null
            ? null
            : ensureSafeName(sequence.ownedTable, 'Sequence owner table');
        const ownedColumn = sequence.ownedColumn === null
            ? null
            : ensureSafeName(sequence.ownedColumn, 'Sequence owner column');
        if ((ownedTable === null) !== (ownedColumn === null)
            || (ownedTable && (!manifestMap.has(ownedTable)
            || !manifestMap.get(ownedTable).columns.includes(ownedColumn)))) {
            throw recoveryError(
                'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
                `Sequence ownership metadata is invalid for ${name}`
            );
        }
        const integerFields = [
            'lastValue', 'startValue', 'incrementBy', 'minValue', 'maxValue', 'cacheSize'
        ];
        if (integerFields.some(field => !/^-?\d+$/.test(String(sequence[field])))
            || !['smallint', 'integer', 'bigint'].includes(sequence.dataType)
            || BigInt(sequence.incrementBy) === 0n
            || typeof sequence.isCalled !== 'boolean'
            || typeof sequence.cycles !== 'boolean') {
            throw recoveryError(
                'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
                `Sequence state is invalid for ${name}`
            );
        }
        return { ...sequence, name, ownedTable, ownedColumn };
    });
    const sequenceNames = sequences.map(sequence => sequence.name);
    if (new Set(sequenceNames).size !== sequenceNames.length
        || !Number.isSafeInteger(manifest.sequenceCount)
        || manifest.sequenceCount !== sequences.length
        || typeof manifest.sequenceChecksum !== 'string'
        || !/^[a-f0-9]{64}$/.test(manifest.sequenceChecksum)
        || canonicalJsonHash(sequences) !== manifest.sequenceChecksum) {
        throw recoveryError(
            'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
            'Recovery artifact sequence inventory is incomplete or inconsistent'
        );
    }

    return {
        artifact: parsed.rawArtifact,
        artifactId: canonicalJsonHash(parsed.rawArtifact),
        manifest: {
            ...manifest,
            tables: [...manifestMap.values()],
            restoreOrder,
            deferredForeignKeys
        },
        payload: {
            tables: [...payloadMap.values()],
            sequences
        },
        manifestMap,
        payloadMap
    };
}

function assertRestoreConfirmation(headers = {}) {
    const value = headers[BACKUP_RESTORE_CONFIRMATION_HEADER]
        ?? headers[BACKUP_RESTORE_CONFIRMATION_HEADER.toLowerCase()];
    if (String(value || '').trim().toLowerCase() !== 'true') {
        throw recoveryError(
            'BACKUP_RESTORE_CONFIRMATION_REQUIRED',
            'Explicit backup restore confirmation is required',
            400
        );
    }
    return true;
}

function validateRestoreSetName(value) {
    const name = String(value || '').trim();
    if (!Object.prototype.hasOwnProperty.call(RESTORE_SETS, name)) {
        throw recoveryError(
            'BACKUP_RESTORE_SET_UNSUPPORTED',
            'Only a registered recovery set may be restored selectively'
        );
    }
    return name;
}

function createRestorePlan(artifactInput, options = {}) {
    if ('sql' in (options || {}) || (!LEGACY_SQL_RESTORE_SUPPORTED && options.mode === 'legacy')) {
        throw recoveryError('BACKUP_RAW_SQL_FORBIDDEN', 'Legacy raw SQL restore is disabled');
    }
    const validated = validateBackupArtifact(artifactInput);
    const restoreSetName = options.restoreSet ? validateRestoreSetName(options.restoreSet) : null;
    const mode = restoreSetName ? 'selective' : String(options.mode || 'full').toLowerCase();
    if (!['full', 'selective'].includes(mode)) {
        throw recoveryError('BACKUP_RESTORE_MODE_INVALID', 'Recovery mode is invalid');
    }
    if (mode === 'selective' && !restoreSetName) {
        throw recoveryError(
            'BACKUP_RESTORE_SET_REQUIRED',
            'Selective restore requires a registered restoreSet'
        );
    }
    if (mode === 'full' && !FULL_RESTORE_SUPPORTED) {
        throw recoveryError('BACKUP_FULL_RESTORE_DISABLED', 'Full structured restore is disabled');
    }
    if (options.tables !== undefined) {
        throw recoveryError(
            'BACKUP_ARBITRARY_TABLE_SELECTION_FORBIDDEN',
            'Arbitrary selective table lists are disabled'
        );
    }

    const selectedTables = mode === 'full'
        ? validated.manifest.restoreOrder.slice()
        : RESTORE_SETS[restoreSetName].tables.slice();
    for (const table of selectedTables) {
        if (!validated.payloadMap.has(table)) {
            throw recoveryError(
                'BACKUP_ARTIFACT_INVENTORY_MISMATCH',
                `Recovery set table is missing from the artifact: ${table}`
            );
        }
    }

    const selectedSet = new Set(selectedTables);
    const sequenceStates = validated.payload.sequences.filter(sequence => (
        mode === 'full' || (sequence.ownedTable && selectedSet.has(sequence.ownedTable))
    ));
    const operations = [
        ...selectedTables.slice().reverse().map(table => ({ type: 'delete', table })),
        ...selectedTables.map(table => ({
            type: 'insert',
            table,
            columns: validated.payloadMap.get(table).columns,
            rows: validated.payloadMap.get(table).rows
        })),
        ...sequenceStates.map(sequence => ({ type: 'sequence', sequence }))
    ];

    return {
        mode,
        restoreSet: restoreSetName,
        selectedTables,
        selectedSet,
        sequenceStates,
        operations,
        ...validated
    };
}

function assertNotAborted(signal) {
    if (signal?.aborted) {
        throw recoveryError('BACKUP_RESTORE_ABORTED', 'Recovery request was aborted', 499);
    }
}

function normalizeRestoreTimeout(value, defaultValue, label) {
    const timeout = value === undefined ? defaultValue : value;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_POSTGRES_TIMEOUT_MS) {
        throw recoveryError(
            'BACKUP_RESTORE_TIMEOUT_INVALID',
            `${label} must be a positive PostgreSQL timeout in milliseconds`,
            500
        );
    }
    return `${timeout}ms`;
}

async function configureRestoreTimeouts(client, options = {}) {
    const lockTimeout = normalizeRestoreTimeout(
        options.lockTimeoutMs,
        DEFAULT_RESTORE_LOCK_TIMEOUT_MS,
        'Restore lock timeout'
    );
    const statementTimeout = normalizeRestoreTimeout(
        options.statementTimeoutMs,
        DEFAULT_RESTORE_STATEMENT_TIMEOUT_MS,
        'Restore statement timeout'
    );
    await client.query(
        "SELECT set_config('lock_timeout', $1, true), "
        + "set_config('statement_timeout', $2, true)",
        [lockTimeout, statementTimeout]
    );
}

function mapRestoreDatabaseError(error) {
    if (error instanceof BackupRecoveryError) return error;
    if (error?.code === '55P03') {
        return recoveryError(
            'BACKUP_RESTORE_LOCK_TIMEOUT',
            'Backup restore could not acquire its database locks within the allowed time',
            503
        );
    }
    if (error?.code === '57014') {
        return recoveryError(
            'BACKUP_RESTORE_STATEMENT_TIMEOUT',
            'Backup restore exceeded its database statement time limit',
            503
        );
    }
    return error;
}

function assertRuntimeRestoreEnabled(plan) {
    if (plan.mode === 'full' && (
        process.env.BACKUP_FULL_RESTORE_ENABLED !== 'true'
        || process.env.BACKUP_RECOVERY_MODE !== 'true'
    )) {
        throw recoveryError(
            'BACKUP_FULL_RESTORE_RUNTIME_DISABLED',
            'Full database restore requires explicit recovery-only runtime enablement',
            403
        );
    }
}

async function lockRestoreTables(client, selectedTables) {
    const ordered = selectedTables.slice().sort();
    await client.query(
        `LOCK TABLE ${ordered.map(quotePublicRelation).join(', ')} IN ACCESS EXCLUSIVE MODE`
    );
}

async function restoreTriggerModes(client, catalog, selectedTables) {
    const commands = {
        O: 'ENABLE',
        D: 'DISABLE',
        R: 'ENABLE REPLICA',
        A: 'ENABLE ALWAYS'
    };
    for (const tableName of selectedTables.slice().sort()) {
        const table = catalog.tableMap.get(tableName);
        for (const trigger of table.triggers) {
            const command = commands[trigger.enabled];
            if (!command) {
                throw recoveryError(
                    'BACKUP_TARGET_SCHEMA_MISMATCH',
                    `Unsupported trigger mode on ${tableName}`,
                    409
                );
            }
            await client.query(
                `ALTER TABLE ${quotePublicRelation(tableName)} ${command} `
                + `TRIGGER ${quoteIdentifier(trigger.name)}`
            );
        }
    }
}

function deferredBreakColumns(plan) {
    const result = new Map();
    const activeForeignKeys = plan.manifest.deferredForeignKeys.filter(foreignKey => (
        plan.selectedSet.has(foreignKey.table)
        && plan.selectedSet.has(foreignKey.referencedTable)
    ));
    for (const foreignKey of activeForeignKeys) {
        if (!result.has(foreignKey.table)) result.set(foreignKey.table, new Set());
        for (const column of foreignKey.breakColumns) result.get(foreignKey.table).add(column);
    }
    return result;
}

async function insertTableRows(client, catalogTable, payloadTable, breakColumns, signal) {
    const targetColumns = catalogTable.columns
        .filter(column => !column.generatedKind)
        .map(column => column.name);
    if (targetColumns.join('\n') !== payloadTable.columns.join('\n')) {
        throw recoveryError(
            'BACKUP_TARGET_SCHEMA_MISMATCH',
            `Target columns do not match the artifact for ${catalogTable.name}`,
            409
        );
    }
    if (payloadTable.rows.length === 0) return 0;

    const batchSize = Math.max(1, Math.min(
        MAX_INSERT_ROWS_PER_BATCH,
        Math.floor(MAX_INSERT_PARAMETERS / Math.max(targetColumns.length, 1))
    ));
    const overriding = catalogTable.columns.some(column => column.identityKind === 'a')
        ? ' OVERRIDING SYSTEM VALUE'
        : '';
    let inserted = 0;

    for (let offset = 0; offset < payloadTable.rows.length; offset += batchSize) {
        assertNotAborted(signal);
        const rows = payloadTable.rows.slice(offset, offset + batchSize);
        const values = [];
        const tuples = rows.map(row => {
            const placeholders = row.map((value, index) => {
                const column = targetColumns[index];
                values.push(breakColumns?.has(column) ? null : value);
                return `$${values.length}`;
            });
            return `(${placeholders.join(', ')})`;
        });
        await client.query(
            `INSERT INTO ${quotePublicRelation(catalogTable.name)} `
            + `(${targetColumns.map(quoteIdentifier).join(', ')})${overriding} VALUES ${tuples.join(', ')}`,
            values
        );
        inserted += rows.length;
    }
    return inserted;
}

async function applyDeferredForeignKeys(client, plan, breakColumnsByTable, signal) {
    let updated = 0;
    for (const [tableName, columnsSet] of breakColumnsByTable) {
        const columns = [...columnsSet].sort();
        const manifestTable = plan.manifestMap.get(tableName);
        const payloadTable = plan.payloadMap.get(tableName);
        const columnIndex = new Map(payloadTable.columns.map((column, index) => [column, index]));
        for (const row of payloadTable.rows) {
            assertNotAborted(signal);
            if (columns.every(column => row[columnIndex.get(column)] === null)) continue;
            const values = [];
            const setClause = columns.map(column => {
                values.push(row[columnIndex.get(column)]);
                return `${quoteIdentifier(column)} = $${values.length}`;
            });
            const whereClause = manifestTable.primaryKey.map(column => {
                values.push(row[columnIndex.get(column)]);
                return `${quoteIdentifier(column)} IS NOT DISTINCT FROM $${values.length}`;
            });
            const result = await client.query(
                `UPDATE ${quotePublicRelation(tableName)} SET ${setClause.join(', ')} `
                + `WHERE ${whereClause.join(' AND ')}`,
                values
            );
            if (result.rowCount !== 1) {
                throw recoveryError(
                    'BACKUP_DEFERRED_FK_UPDATE_FAILED',
                    `Could not restore deferred foreign key values for ${tableName}`
                );
            }
            updated++;
        }
    }
    return updated;
}

async function restoreSequenceStates(client, plan, targetCatalog, signal) {
    const targetSequences = new Map(targetCatalog.sequences.map(sequence => [sequence.name, sequence]));
    let restored = 0;
    for (const sequence of plan.sequenceStates) {
        assertNotAborted(signal);
        const target = targetSequences.get(sequence.name);
        const metadataFields = [
            'ownedTable', 'ownedColumn', 'dataType', 'startValue', 'incrementBy',
            'minValue', 'maxValue', 'cacheSize', 'cycles'
        ];
        if (!target || metadataFields.some(field => target[field] !== sequence[field])) {
            throw recoveryError(
                'BACKUP_TARGET_SCHEMA_MISMATCH',
                `Target sequence metadata differs for ${sequence.name}`,
                409
            );
        }

        let lastValue = BigInt(sequence.lastValue);
        let isCalled = sequence.isCalled;
        if (sequence.ownedTable && plan.selectedSet.has(sequence.ownedTable)) {
            const increment = BigInt(sequence.incrementBy);
            const aggregate = increment > 0n ? 'MAX' : 'MIN';
            const boundaryResult = await client.query(
                `SELECT ${aggregate}(${quoteIdentifier(sequence.ownedColumn)})::text AS boundary_value `
                + `FROM ${quotePublicRelation(sequence.ownedTable)}`
            );
            if (boundaryResult.rows[0].boundary_value !== null) {
                const boundaryValue = BigInt(boundaryResult.rows[0].boundary_value);
                if ((increment > 0n && boundaryValue > lastValue)
                    || (increment < 0n && boundaryValue < lastValue)) {
                    lastValue = boundaryValue;
                }
                isCalled = true;
            }
        }
        await client.query(
            'SELECT setval($1::regclass, $2::bigint, $3::boolean)',
            [quotePublicRelation(sequence.name), lastValue.toString(), isCalled]
        );
        restored++;
    }
    return restored;
}

async function verifyRestoredTables(client, plan, targetCatalog, signal) {
    const verified = [];
    for (const tableName of plan.selectedTables) {
        assertNotAborted(signal);
        const actual = await readTableRows(client, targetCatalog.tableMap.get(tableName));
        const expected = plan.payloadMap.get(tableName);
        if (actual.rowCount !== expected.rowCount || actual.checksum !== expected.checksum) {
            throw recoveryError(
                'BACKUP_RESTORE_VERIFICATION_FAILED',
                `Restored table verification failed for ${tableName}`,
                409,
                {
                    table: tableName,
                    expectedRows: expected.rowCount,
                    actualRows: actual.rowCount
                }
            );
        }
        verified.push(tableName);
    }
    return verified;
}

async function executeRestorePlan(client, plan, {
    signal,
    lockTimeoutMs,
    statementTimeoutMs
} = {}) {
    assertRuntimeRestoreEnabled(plan);
    assertNotAborted(signal);
    const effectiveLockTimeoutMs = lockTimeoutMs === undefined
        ? DEFAULT_RESTORE_LOCK_TIMEOUT_MS
        : lockTimeoutMs;
    normalizeRestoreTimeout(
        effectiveLockTimeoutMs,
        DEFAULT_RESTORE_LOCK_TIMEOUT_MS,
        'Restore lock timeout'
    );
    normalizeRestoreTimeout(
        statementTimeoutMs,
        DEFAULT_RESTORE_STATEMENT_TIMEOUT_MS,
        'Restore statement timeout'
    );
    let transactionOpen = false;
    let sessionSchemaLockHeld = false;
    let primaryError = null;
    try {
        await lockBackupSchemaSnapshotSession(client, {
            lockTimeoutMs: effectiveLockTimeoutMs
        });
        sessionSchemaLockHeld = true;
        await client.query('BEGIN');
        transactionOpen = true;
        await configureRestoreTimeouts(client, { lockTimeoutMs, statementTimeoutMs });
        await lockBackupSchemaSnapshot(client);
        await unlockBackupSchemaSnapshotSession(client);
        sessionSchemaLockHeld = false;
        await configureBackupSession(client);
        if (plan.selectedTables.some(table => ATTENDANCE_TABLES.has(table))) {
            await lockAttendanceWriteMaintenance(client);
        }

        const targetCatalog = await loadBackupCatalog(client, {
            excludedTables: excludedTableNames()
        });
        const migrationState = await readMigrationState(client);
        if (targetCatalog.schemaFingerprint !== plan.manifest.schemaFingerprint
            || migrationState.fingerprint !== plan.manifest.migrationFingerprint) {
            throw recoveryError(
                'BACKUP_TARGET_SCHEMA_MISMATCH',
                'Target schema does not match the recovery artifact',
                409
            );
        }
        const targetNames = targetCatalog.tables.map(table => table.name).sort();
        const artifactNames = plan.manifest.tables.map(table => table.name).sort();
        if (targetNames.join('\n') !== artifactNames.join('\n')) {
            throw recoveryError(
                'BACKUP_TARGET_SCHEMA_MISMATCH',
                'Target table inventory does not match the recovery artifact',
                409
            );
        }
        const targetSequenceNames = targetCatalog.sequences.map(sequence => sequence.name).sort();
        const artifactSequenceNames = plan.payload.sequences.map(sequence => sequence.name).sort();
        if (targetSequenceNames.join('\n') !== artifactSequenceNames.join('\n')) {
            throw recoveryError(
                'BACKUP_TARGET_SCHEMA_MISMATCH',
                'Target sequence inventory does not match the recovery artifact',
                409
            );
        }

        if (plan.mode === 'selective') {
            const unsafeDependencies = targetCatalog.foreignKeys.filter(foreignKey => (
                plan.selectedSet.has(foreignKey.referencedTable)
                && !plan.selectedSet.has(foreignKey.table)
            ));
            if (unsafeDependencies.length > 0) {
                throw recoveryError(
                    'BACKUP_RESTORE_SELECTION_NOT_CLOSED',
                    'Selective restore set has dependent tables outside the set',
                    409,
                    { constraints: unsafeDependencies.map(item => item.key).slice(0, 20) }
                );
            }
        }

        assertNotAborted(signal);
        await lockRestoreTables(client, plan.selectedTables);
        for (const tableName of plan.selectedTables.slice().sort()) {
            await client.query(`ALTER TABLE ${quotePublicRelation(tableName)} DISABLE TRIGGER USER`);
        }

        if (plan.mode === 'full') {
            await client.query(
                `TRUNCATE TABLE ${plan.selectedTables.map(quotePublicRelation).join(', ')} RESTART IDENTITY`
            );
        } else {
            for (const tableName of plan.selectedTables.slice().reverse()) {
                assertNotAborted(signal);
                await client.query(`DELETE FROM ${quotePublicRelation(tableName)}`);
            }
        }

        const breakColumnsByTable = deferredBreakColumns(plan);
        let insertedRows = 0;
        for (const tableName of plan.manifest.restoreOrder) {
            if (!plan.selectedSet.has(tableName)) continue;
            insertedRows += await insertTableRows(
                client,
                targetCatalog.tableMap.get(tableName),
                plan.payloadMap.get(tableName),
                breakColumnsByTable.get(tableName),
                signal
            );
        }
        const deferredUpdates = await applyDeferredForeignKeys(
            client,
            plan,
            breakColumnsByTable,
            signal
        );
        const sequencesRestored = await restoreSequenceStates(
            client,
            plan,
            targetCatalog,
            signal
        );
        const verifiedTables = await verifyRestoredTables(client, plan, targetCatalog, signal);

        await restoreTriggerModes(client, targetCatalog, plan.selectedTables);
        const closingCatalog = await loadBackupCatalog(client, {
            excludedTables: excludedTableNames()
        });
        if (closingCatalog.schemaFingerprint !== plan.manifest.schemaFingerprint) {
            throw recoveryError(
                'BACKUP_RESTORE_SCHEMA_VERIFICATION_FAILED',
                'Target schema changed during recovery',
                409
            );
        }
        assertNotAborted(signal);
        await client.query('COMMIT');
        transactionOpen = false;
        return {
            success: true,
            mode: plan.mode,
            restoreSet: plan.restoreSet,
            artifactId: plan.artifactId,
            tablesRestored: verifiedTables,
            insertedRows,
            deferredUpdates,
            sequencesRestored,
            verified: true
        };
    } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        if (signal?.aborted && error?.code !== 'BACKUP_RESTORE_ABORTED') {
            primaryError = recoveryError(
                'BACKUP_RESTORE_ABORTED',
                'Recovery request was aborted',
                499
            );
            throw primaryError;
        }
        primaryError = mapRestoreDatabaseError(error);
        if (error?.destroyClient) primaryError.destroyClient = true;
        throw primaryError;
    } finally {
        if (sessionSchemaLockHeld) {
            try {
                await unlockBackupSchemaSnapshotSession(client);
            } catch (cleanupError) {
                cleanupError.destroyClient = true;
                if (primaryError) primaryError.destroyClient = true;
                else throw cleanupError;
            }
        }
    }
}

function encryptBackupArtifact(artifact, passphrase) {
    validateBackupArtifact(artifact);
    return encryptRecoveryBundle(artifact, passphrase);
}

function decryptBackupArtifact(envelope, passphrase) {
    try {
        const artifact = decryptRecoveryBundle(envelope, passphrase);
        validateBackupArtifact(artifact);
        return artifact;
    } catch (error) {
        if (error instanceof BackupRecoveryError) throw error;
        throw recoveryError(
            'BACKUP_ARTIFACT_AUTH_FAILED',
            'Encrypted recovery artifact authentication failed',
            400
        );
    }
}

module.exports = {
    BackupRecoveryError,
    assertRestoreConfirmation,
    configureRestoreTimeouts,
    createRestorePlan,
    decryptBackupArtifact,
    encryptBackupArtifact,
    executeRestorePlan,
    validateBackupArtifact
};
