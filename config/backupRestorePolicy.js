'use strict';

const BACKUP_ARTIFACT_FORMAT_VERSION = 2;
const BACKUP_RESTORE_CONFIRMATION_HEADER = 'x-backup-restore-confirmed';
const FULL_RESTORE_SUPPORTED = true;
const LEGACY_SQL_RESTORE_SUPPORTED = false;
const BACKUP_MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
const BACKUP_MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const BACKUP_MAX_ENVELOPE_BYTES = 45 * 1024 * 1024;
const BACKUP_HTTP_BODY_LIMIT = '50mb';
const BACKUP_RESTORE_HTTP_PATHS = Object.freeze([
    '/api/backup/restore',
    '/api/backup/restore-encrypted',
    '/api/v1/backup/restore',
    '/api/v1/backup/restore-encrypted'
]);

function isBackupRestoreRequestPath(value) {
    const rawPath = String(value || '').split('?')[0];
    const normalizedPath = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
    const requestPath = normalizedPath.toLowerCase();
    return BACKUP_RESTORE_HTTP_PATHS.includes(requestPath);
}

const BACKUP_ARTIFACT_FORMAT = Object.freeze({
    name: 'eventgenix.backup',
    version: BACKUP_ARTIFACT_FORMAT_VERSION,
    kind: 'structured',
    scope: 'database-only'
});

const BACKUP_EXCLUDED_TABLES = Object.freeze({
    schema_migrations: Object.freeze({
        owner: 'migration-runner',
        reason: 'Deployment state belongs to the target application version. A target schema must be created by the matching migration runner before data restore.'
    })
});

const RESTORE_SETS = Object.freeze({
    'attendance-v1': Object.freeze({
        name: 'attendance-v1',
        version: 1,
        mode: 'selective',
        tables: Object.freeze([
            'staff_checkins',
            'hr_time_records'
        ]),
        requiresExistingParents: Object.freeze(['staff']),
        reason: 'Restore attendance facts without replacing the staff roster or schedule state.'
    })
});

const BACKUP_RESTORE_SETS = RESTORE_SETS;

const BACKUP_RESTORE_POLICY = Object.freeze({
    formatVersion: BACKUP_ARTIFACT_FORMAT_VERSION,
    artifact: BACKUP_ARTIFACT_FORMAT,
    excludedTables: BACKUP_EXCLUDED_TABLES,
    restoreSets: RESTORE_SETS,
    confirmationHeader: BACKUP_RESTORE_CONFIRMATION_HEADER,
    limits: Object.freeze({
        maxPayloadBytes: BACKUP_MAX_PAYLOAD_BYTES,
        maxArtifactBytes: BACKUP_MAX_ARTIFACT_BYTES,
        maxEncryptedEnvelopeBytes: BACKUP_MAX_ENVELOPE_BYTES,
        httpRestoreBodyLimit: BACKUP_HTTP_BODY_LIMIT
    }),
    fullRestore: Object.freeze({
        supported: FULL_RESTORE_SUPPORTED,
        structuredArtifactRequired: true,
        supportedArtifactName: BACKUP_ARTIFACT_FORMAT.name,
        supportedArtifactVersion: BACKUP_ARTIFACT_FORMAT.version,
        targetSchema: 'fresh-schema-from-matching-application-migrations',
        recoveryModeRequired: true
    }),
    legacyRawSqlRestore: Object.freeze({
        enabled: LEGACY_SQL_RESTORE_SUPPORTED,
        reason: 'Raw SQL has no complete structured manifest, version contract, or artifact integrity proof.'
    }),
    limitations: Object.freeze({
        databaseOnly: true,
        externalAssetsIncluded: false,
        externalAssetExamples: Object.freeze([
            'uploads and mounted-volume files',
            'object-storage blobs',
            'Telegram-hosted files',
            'external provider data'
        ]),
        reason: 'Database restore can recover rows and asset references only. External assets require a separate backup and recovery process.'
    }),
    operations: Object.freeze({
        liveSmokeRestoreAllowed: false,
        disposableRestoreDrillRequired: true,
        readOnlyLiveVerificationOnly: true
    })
});

module.exports = {
    BACKUP_ARTIFACT_FORMAT,
    BACKUP_ARTIFACT_FORMAT_VERSION,
    BACKUP_EXCLUDED_TABLES,
    BACKUP_HTTP_BODY_LIMIT,
    BACKUP_RESTORE_HTTP_PATHS,
    BACKUP_MAX_ARTIFACT_BYTES,
    BACKUP_MAX_ENVELOPE_BYTES,
    BACKUP_MAX_PAYLOAD_BYTES,
    BACKUP_RESTORE_CONFIRMATION_HEADER,
    BACKUP_RESTORE_POLICY,
    BACKUP_RESTORE_SETS,
    FULL_RESTORE_SUPPORTED,
    LEGACY_SQL_RESTORE_SUPPORTED,
    RESTORE_SETS,
    isBackupRestoreRequestPath
};
