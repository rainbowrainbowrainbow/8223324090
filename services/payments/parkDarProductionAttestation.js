'use strict';

const crypto = require('node:crypto');

const { getReleaseMetadata } = require('../release');

const PRODUCTION_ORIGIN = 'https://8223324090-production.up.railway.app';
const PRODUCTION_HOSTNAME = new URL(PRODUCTION_ORIGIN).hostname;
const PRODUCTION_ATTESTATION_PATH = '/api/version';
const PRODUCTION_ATTESTATION_MARKER_PARAM = 'parkDarProductionAttestation';
const PRODUCTION_ATTESTATION_SOURCE = 'eventgenix_production_https_readonly_preflight';
const PRODUCTION_ATTESTATION_AUDIENCE = 'park_dar_production_config_planner';
const RELEASE_TARGET = Object.freeze({
    branch: 'codex/eventgenix-production',
    project: 'fortunate-appreciation',
    environment: 'production',
    service: '8223324090'
});
const RAILWAY_TARGET = Object.freeze({
    projectId: 'bc28b46c-d4bc-491c-893a-d8401c633668',
    environmentId: 'd9f9b984-d54d-4620-a8bf-c48882ad5158',
    serviceId: '3fb62d4c-2dc2-4701-8e2b-09ce16e188ee',
    serviceName: RELEASE_TARGET.service
});
const GLOBAL_GATE_NAMES = Object.freeze([
    'CHECKBOX_INTEGRATION_ENABLED',
    'CHECKBOX_ACCEPT_PAYMENTS_ENABLED',
    'CHECKBOX_WEBHOOK_ENABLED',
    'CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS',
    'EVENTGENIX_CASHIER_PRO_ENABLED'
]);
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BLOCK_ID_RE = /^[A-Z0-9][A-Z0-9_-]{7,127}$/;
const ATTESTATION_TTL_MS = 5 * 60 * 1000;

class ParkDarProductionAttestationError extends Error {
    constructor(code, status = 503) {
        super(code);
        this.name = 'ParkDarProductionAttestationError';
        this.code = code;
        this.status = status;
    }
}

function text(value) {
    return String(value == null ? '' : value).trim();
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

const PRODUCTION_RUNTIME_IDENTITY_SHA256 = sha256(JSON.stringify([
    RAILWAY_TARGET.projectId,
    RELEASE_TARGET.project,
    RAILWAY_TARGET.environmentId,
    RELEASE_TARGET.environment,
    RAILWAY_TARGET.serviceId,
    RAILWAY_TARGET.serviceName,
    PRODUCTION_HOSTNAME
]));

function assertExactObjectKeys(value, expectedKeys, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ParkDarProductionAttestationError(code, 400);
    }
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new ParkDarProductionAttestationError(code, 400);
    }
}

function normalizeChallenge(input = {}) {
    assertExactObjectKeys(input, ['blockId', 'manifestSha256', 'nonce'], 'park_dar_attestation_challenge_invalid');
    const blockId = text(input.blockId);
    const manifestSha256 = text(input.manifestSha256).toLowerCase();
    const nonce = text(input.nonce).toLowerCase();
    if (!BLOCK_ID_RE.test(blockId) || !HASH_RE.test(manifestSha256) || !UUID_RE.test(nonce)) {
        throw new ParkDarProductionAttestationError('park_dar_attestation_challenge_invalid', 400);
    }
    return { blockId, manifestSha256, nonce };
}

function globalGateSnapshot(env = process.env) {
    const snapshot = {};
    for (const name of GLOBAL_GATE_NAMES) {
        const raw = text(env[name]).toLowerCase();
        if (raw && raw !== 'false') {
            throw new ParkDarProductionAttestationError('park_dar_attestation_global_gate_not_disabled');
        }
        snapshot[name] = false;
    }
    return snapshot;
}

function databaseFingerprint(row = {}) {
    const fields = [
        text(row.database_name),
        text(row.database_oid),
        text(row.system_identifier),
        text(row.database_owner_oid),
        text(row.database_encoding),
        text(row.database_collate),
        text(row.database_ctype),
        text(row.server_version_num)
    ];
    if (fields.some(value => !value)) {
        throw new ParkDarProductionAttestationError('park_dar_attestation_database_identity_incomplete');
    }
    return sha256(JSON.stringify(fields));
}

function assertRuntimeIdentity(env, release) {
    if (text(env.NODE_ENV).toLowerCase() !== 'production') {
        throw new ParkDarProductionAttestationError('park_dar_attestation_not_production_runtime', 404);
    }
    if (text(env.RAILWAY_PROJECT_NAME) !== RELEASE_TARGET.project
        || text(env.RAILWAY_PROJECT_ID).toLowerCase() !== RAILWAY_TARGET.projectId
        || text(env.RAILWAY_ENVIRONMENT_NAME).toLowerCase() !== RELEASE_TARGET.environment
        || text(env.RAILWAY_ENVIRONMENT_ID).toLowerCase() !== RAILWAY_TARGET.environmentId
        || text(env.RAILWAY_SERVICE_ID).toLowerCase() !== RAILWAY_TARGET.serviceId
        || text(env.RAILWAY_SERVICE_NAME) !== RAILWAY_TARGET.serviceName
        || text(env.RAILWAY_PUBLIC_DOMAIN).toLowerCase() !== PRODUCTION_HOSTNAME) {
        throw new ParkDarProductionAttestationError('park_dar_attestation_runtime_identity_mismatch', 404);
    }
    const rawTestMode = text(env.TEST_MODE).toLowerCase();
    const testModeEnabled = rawTestMode !== '' && !['0', 'false'].includes(rawTestMode);
    if (testModeEnabled
        || release?.testMode === true
        || !release?.deploymentMetadata?.complete
        || !['railway', 'manifest'].includes(release.deploymentMetadata.status)
        || !SHA_RE.test(text(release.commitSha).toLowerCase())
        || text(release.sourceBranch) !== RELEASE_TARGET.branch) {
        throw new ParkDarProductionAttestationError('park_dar_attestation_release_identity_unverified');
    }
}

async function readDatabaseFingerprint(dbPool) {
    const client = await dbPool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        transactionOpen = true;
        await client.query('SET LOCAL search_path = pg_catalog, public');
        const result = await client.query(`
            SELECT current_setting('transaction_read_only') AS transaction_read_only,
                   current_database() AS database_name,
                   database_record.oid::text AS database_oid,
                   control_record.system_identifier::text AS system_identifier,
                   database_record.datdba::text AS database_owner_oid,
                   pg_catalog.pg_encoding_to_char(database_record.encoding) AS database_encoding,
                   database_record.datcollate AS database_collate,
                   database_record.datctype AS database_ctype,
                   current_setting('server_version_num') AS server_version_num
              FROM pg_catalog.pg_database database_record
              CROSS JOIN pg_catalog.pg_control_system() control_record
             WHERE database_record.datname = current_database()
        `);
        const row = result.rows[0] || {};
        if (row.transaction_read_only !== 'on') {
            throw new ParkDarProductionAttestationError('park_dar_attestation_database_not_readonly');
        }
        const fingerprint = databaseFingerprint(row);
        await client.query('ROLLBACK');
        transactionOpen = false;
        return fingerprint;
    } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function buildProductionAttestation({
    challenge: challengeInput,
    env = process.env,
    dbPool,
    release = getReleaseMetadata(env),
    now = Date.now()
} = {}) {
    const challenge = normalizeChallenge(challengeInput);
    assertRuntimeIdentity(env, release);
    const globalGates = globalGateSnapshot(env);
    const databaseFingerprintSha256 = await readDatabaseFingerprint(dbPool);
    const observedAt = new Date(now);
    return {
        schemaVersion: 2,
        source: PRODUCTION_ATTESTATION_SOURCE,
        audience: PRODUCTION_ATTESTATION_AUDIENCE,
        origin: PRODUCTION_ORIGIN,
        blockId: challenge.blockId,
        nonce: challenge.nonce,
        manifestSha256: challenge.manifestSha256,
        observedAt: observedAt.toISOString(),
        expiresAt: new Date(observedAt.getTime() + ATTESTATION_TTL_MS).toISOString(),
        liveSha: text(release.commitSha).toLowerCase(),
        branch: RELEASE_TARGET.branch,
        project: RELEASE_TARGET.project,
        environment: RELEASE_TARGET.environment,
        service: RELEASE_TARGET.service,
        runtimeIdentitySha256: PRODUCTION_RUNTIME_IDENTITY_SHA256,
        databaseFingerprintSha256,
        globalGates
    };
}

module.exports = {
    ATTESTATION_TTL_MS,
    GLOBAL_GATE_NAMES,
    PRODUCTION_ATTESTATION_AUDIENCE,
    PRODUCTION_ATTESTATION_MARKER_PARAM,
    PRODUCTION_ATTESTATION_PATH,
    PRODUCTION_ATTESTATION_SOURCE,
    PRODUCTION_HOSTNAME,
    PRODUCTION_ORIGIN,
    PRODUCTION_RUNTIME_IDENTITY_SHA256,
    RAILWAY_TARGET,
    RELEASE_TARGET,
    ParkDarProductionAttestationError,
    buildProductionAttestation,
    databaseFingerprint,
    globalGateSnapshot,
    normalizeChallenge,
    readDatabaseFingerprint
};
