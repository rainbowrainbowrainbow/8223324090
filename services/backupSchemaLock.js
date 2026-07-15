'use strict';

// Stable two-int PostgreSQL advisory-lock namespace for Event Genix schema
// snapshots and the migration runner. Keep these values unchanged across
// releases so old and new application instances coordinate during deploys.
const SCHEMA_LOCK_CLASS_ID = 1_162_958_408;
const SCHEMA_LOCK_OBJECT_ID = 2;
const DEFAULT_SCHEMA_LOCK_TIMEOUT_MS = 15_000;
const MAX_POSTGRES_TIMEOUT_MS = 2_147_483_647;

function normalizeSchemaLockTimeout(value) {
    const timeout = value === undefined ? DEFAULT_SCHEMA_LOCK_TIMEOUT_MS : value;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_POSTGRES_TIMEOUT_MS) {
        const error = new Error('Schema lock timeout must be a positive integer in milliseconds');
        error.code = 'BACKUP_SCHEMA_LOCK_TIMEOUT_INVALID';
        throw error;
    }
    return `${timeout}ms`;
}

async function lockBackupSchemaSnapshotSession(client, { lockTimeoutMs } = {}) {
    const timeout = normalizeSchemaLockTimeout(lockTimeoutMs);
    let operationError = null;
    let acquired = false;
    await client.query("SELECT set_config('lock_timeout', $1, false)", [timeout]);
    try {
        await client.query(
            'SELECT pg_advisory_lock_shared($1::integer, $2::integer)',
            [SCHEMA_LOCK_CLASS_ID, SCHEMA_LOCK_OBJECT_ID]
        );
        acquired = true;
    } catch (error) {
        operationError = error;
        throw error;
    } finally {
        try {
            await client.query("SELECT set_config('lock_timeout', '0', false)");
        } catch (resetError) {
            if (acquired) {
                try {
                    await unlockBackupSchemaSnapshotSession(client);
                    acquired = false;
                } catch {
                    resetError.destroyClient = true;
                }
            }
            if (operationError) operationError.destroyClient = true;
            else throw resetError;
        }
    }
}

async function unlockBackupSchemaSnapshotSession(client) {
    const result = await client.query(
        'SELECT pg_advisory_unlock_shared($1::integer, $2::integer) AS unlocked',
        [SCHEMA_LOCK_CLASS_ID, SCHEMA_LOCK_OBJECT_ID]
    );
    if (result.rows[0]?.unlocked !== true) {
        const error = new Error('Schema snapshot advisory lock was not held by this session');
        error.code = 'BACKUP_SCHEMA_LOCK_NOT_HELD';
        throw error;
    }
}

async function lockBackupSchemaSnapshot(client) {
    await client.query(
        'SELECT pg_advisory_xact_lock_shared($1::integer, $2::integer)',
        [SCHEMA_LOCK_CLASS_ID, SCHEMA_LOCK_OBJECT_ID]
    );
}

async function lockSchemaMigrations(client) {
    await client.query(
        'SELECT pg_advisory_lock($1::integer, $2::integer)',
        [SCHEMA_LOCK_CLASS_ID, SCHEMA_LOCK_OBJECT_ID]
    );
}

async function unlockSchemaMigrations(client) {
    const result = await client.query(
        'SELECT pg_advisory_unlock($1::integer, $2::integer) AS unlocked',
        [SCHEMA_LOCK_CLASS_ID, SCHEMA_LOCK_OBJECT_ID]
    );
    if (result.rows[0]?.unlocked !== true) {
        const error = new Error('Schema migration advisory lock was not held by this session');
        error.code = 'BACKUP_SCHEMA_LOCK_NOT_HELD';
        throw error;
    }
}

module.exports = {
    DEFAULT_SCHEMA_LOCK_TIMEOUT_MS,
    lockBackupSchemaSnapshot,
    lockBackupSchemaSnapshotSession,
    lockSchemaMigrations,
    unlockBackupSchemaSnapshotSession,
    unlockSchemaMigrations
};
