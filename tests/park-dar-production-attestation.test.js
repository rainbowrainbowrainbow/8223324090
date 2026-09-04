'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    GLOBAL_GATE_NAMES,
    PRODUCTION_ATTESTATION_SOURCE,
    PRODUCTION_ORIGIN,
    PRODUCTION_RUNTIME_IDENTITY_SHA256,
    ParkDarProductionAttestationError,
    buildProductionAttestation
} = require('../services/payments/parkDarProductionAttestation');

const LIVE_SHA = 'a'.repeat(40);
const CHALLENGE = Object.freeze({
    blockId: 'PARK-DAR-PRODUCTION-CONFIG-PLAN',
    manifestSha256: 'b'.repeat(64),
    nonce: '123e4567-e89b-42d3-a456-426614174000'
});

function productionEnv(overrides = {}) {
    return {
        NODE_ENV: 'production',
        TEST_MODE: 'false',
        RAILWAY_PROJECT_ID: 'bc28b46c-d4bc-491c-893a-d8401c633668',
        RAILWAY_PROJECT_NAME: 'fortunate-appreciation',
        RAILWAY_ENVIRONMENT_ID: 'd9f9b984-d54d-4620-a8bf-c48882ad5158',
        RAILWAY_ENVIRONMENT_NAME: 'production',
        RAILWAY_SERVICE_ID: '3fb62d4c-2dc2-4701-8e2b-09ce16e188ee',
        RAILWAY_SERVICE_NAME: '8223324090',
        RAILWAY_PUBLIC_DOMAIN: '8223324090-production.up.railway.app',
        ...Object.fromEntries(GLOBAL_GATE_NAMES.map(name => [name, 'false'])),
        ...overrides
    };
}

function release(status = 'manifest') {
    return {
        commitSha: LIVE_SHA,
        sourceBranch: 'codex/eventgenix-production',
        testMode: false,
        deploymentMetadata: {
            complete: ['manifest', 'railway'].includes(status),
            status
        }
    };
}

function databasePool({ failFingerprint = false } = {}) {
    const statements = [];
    const client = {
        async query(sql) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            statements.push(normalized);
            if (normalized.includes('FROM pg_catalog.pg_database database_record')) {
                if (failFingerprint) throw new Error('synthetic read failure');
                return { rows: [{
                    transaction_read_only: 'on',
                    database_name: 'redacted_database',
                    database_oid: '9876',
                    system_identifier: '7681708227381576429',
                    database_owner_oid: '10',
                    database_encoding: 'UTF8',
                    database_collate: 'C',
                    database_ctype: 'C',
                    server_version_num: '160000'
                }] };
            }
            return { rows: [] };
        },
        release() {}
    };
    return {
        statements,
        pool: { async connect() { return client; } }
    };
}

test('production attestation is exact-runtime, read-only, short-lived and sanitized', async () => {
    const db = databasePool();
    const now = Date.parse('2026-09-04T12:00:00.000Z');
    const result = await buildProductionAttestation({
        challenge: CHALLENGE,
        env: productionEnv(),
        dbPool: db.pool,
        release: release('manifest'),
        now
    });

    assert.equal(result.schemaVersion, 2);
    assert.equal(result.source, PRODUCTION_ATTESTATION_SOURCE);
    assert.equal(result.origin, PRODUCTION_ORIGIN);
    assert.equal(result.runtimeIdentitySha256, PRODUCTION_RUNTIME_IDENTITY_SHA256);
    assert.equal(result.liveSha, LIVE_SHA);
    assert.equal(result.branch, 'codex/eventgenix-production');
    assert.equal(result.observedAt, '2026-09-04T12:00:00.000Z');
    assert.equal(result.expiresAt, '2026-09-04T12:05:00.000Z');
    assert.deepEqual(result.globalGates, Object.fromEntries(GLOBAL_GATE_NAMES.map(name => [name, false])));
    assert.equal(db.statements[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(db.statements[1], 'SET LOCAL search_path = pg_catalog, public');
    assert.equal(db.statements.at(-1), 'ROLLBACK');
    assert.doesNotMatch(JSON.stringify(result), /redacted_database/);
});

test('producer accepts only canonical Railway or clean release-manifest metadata', async () => {
    for (const status of ['railway', 'manifest']) {
        const db = databasePool();
        const result = await buildProductionAttestation({
            challenge: CHALLENGE,
            env: productionEnv(),
            dbPool: db.pool,
            release: release(status)
        });
        assert.equal(result.liveSha, LIVE_SHA);
    }

    for (const status of ['manual', 'partial', 'unavailable', 'conflict']) {
        await assert.rejects(
            () => buildProductionAttestation({
                challenge: CHALLENGE,
                env: productionEnv(),
                dbPool: { async connect() { throw new Error('must not connect'); } },
                release: release(status)
            }),
            error => error instanceof ParkDarProductionAttestationError
                && error.code === 'park_dar_attestation_release_identity_unverified'
        );
    }
});

test('producer fails closed before database access for runtime, mode or gate drift', async () => {
    const cases = [
        productionEnv({ NODE_ENV: 'development' }),
        productionEnv({ RAILWAY_SERVICE_NAME: 'wrong-service' }),
        productionEnv({ TEST_MODE: 'TRUE' }),
        productionEnv({ CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true' }),
        productionEnv({ CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS: '1' })
    ];
    for (const env of cases) {
        await assert.rejects(
            () => buildProductionAttestation({
                challenge: CHALLENGE,
                env,
                dbPool: { async connect() { throw new Error('must not connect'); } },
                release: release('manifest')
            }),
            error => error instanceof ParkDarProductionAttestationError
        );
    }
});

test('producer always rolls back a failed read-only database observation', async () => {
    const db = databasePool({ failFingerprint: true });
    await assert.rejects(() => buildProductionAttestation({
        challenge: CHALLENGE,
        env: productionEnv(),
        dbPool: db.pool,
        release: release('manifest')
    }), /synthetic read failure/);
    assert.equal(db.statements.at(-1), 'ROLLBACK');
});
