'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
    DAR_CATALOG_CONTRACT,
    DAR_CATALOG_CONTRACT_SHA256,
    EXPECTED_COUNTS,
    GLOBAL_GATE_NAMES,
    ParkDarProductionPlanError,
    REQUIRED_MIGRATIONS,
    databasePoolConfig,
    databaseFingerprint,
    fetchProductionAttestation,
    loadMigrationDigests,
    migrationDigestMap,
    planExactState,
    proveReadOnly,
    requiredDatabaseUrl,
    runReadOnlyPlan,
    sha256,
    sslConfig,
    unexpectedProtectedMigrations,
    validateAttestation,
    validateManifest
} = require('../services/payments/parkDarProductionConfigPlanner');
const {
    PRODUCTION_ATTESTATION_AUDIENCE,
    PRODUCTION_ATTESTATION_SOURCE,
    PRODUCTION_ORIGIN,
    PRODUCTION_RUNTIME_IDENTITY_SHA256,
    buildProductionAttestation
} = require('../services/payments/parkDarProductionAttestation');
const { assertProtectedInputFiles, parseArgs } = require('../scripts/plan-park-dar-production-config');

const LIVE_SHA = 'a'.repeat(40);
const PINNED_DAR_CONTRACT_SHA256 = 'd4a05529430266361727008c9429226706f368054ada35d75f39861b8971d3e8';
const SCHEMA_CONTRACT_SHA256 = 'e'.repeat(64);
const MIGRATION_DIGESTS = migrationDigestMap(loadMigrationDigests());
const TEST_NOW = Date.now();

function attestationFixture(overrides = {}) {
    return {
        schemaVersion: 2,
        source: PRODUCTION_ATTESTATION_SOURCE,
        audience: PRODUCTION_ATTESTATION_AUDIENCE,
        origin: PRODUCTION_ORIGIN,
        blockId: 'PARK-DAR-PRODUCTION-CONFIG-PLAN',
        nonce: '123e4567-e89b-42d3-a456-426614174000',
        manifestSha256: 'b'.repeat(64),
        observedAt: new Date(TEST_NOW - 60_000).toISOString(),
        expiresAt: new Date(TEST_NOW + 4 * 60_000).toISOString(),
        liveSha: LIVE_SHA,
        branch: 'codex/eventgenix-production',
        project: 'fortunate-appreciation',
        environment: 'production',
        service: '8223324090',
        runtimeIdentitySha256: PRODUCTION_RUNTIME_IDENTITY_SHA256,
        databaseFingerprintSha256: 'd'.repeat(64),
        globalGates: Object.fromEntries(GLOBAL_GATE_NAMES.map(name => [name, false])),
        ...overrides
    };
}

function productionRuntimeEnv(overrides = {}) {
    return {
        NODE_ENV: 'production',
        RAILWAY_PROJECT_ID: 'bc28b46c-d4bc-491c-893a-d8401c633668',
        RAILWAY_PROJECT_NAME: 'fortunate-appreciation',
        RAILWAY_ENVIRONMENT_ID: 'd9f9b984-d54d-4620-a8bf-c48882ad5158',
        RAILWAY_ENVIRONMENT_NAME: 'production',
        RAILWAY_SERVICE_ID: '3fb62d4c-2dc2-4701-8e2b-09ce16e188ee',
        RAILWAY_SERVICE_NAME: '8223324090',
        RAILWAY_PUBLIC_DOMAIN: '8223324090-production.up.railway.app',
        ...overrides
    };
}

async function authenticatedEnvelope({ manifest, attestation, manifestSha256, now = TEST_NOW }) {
    return fetchProductionAttestation({
        manifest,
        manifestSha256,
        nonce: attestation.nonce,
        now,
        async fetchImpl(url) {
            return {
                ok: true,
                status: 200,
                redirected: false,
                url: String(url),
                headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
                async text() { return JSON.stringify(attestation); }
            };
        }
    });
}

function protectedFileHash(value) {
    return sha256(Buffer.from(JSON.stringify(value)));
}

function productCodes(prefix, count) {
    return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`);
}

function productRows(businessContext, codes) {
    if (businessContext === 'dar') {
        const requestedCodes = new Set(codes);
        return DAR_CATALOG_CONTRACT
            .filter(item => requestedCodes.has(item.product.id))
            .map(item => ({
                id: item.product.id,
                business_context: item.product.businessContext,
                code: item.product.code,
                timeline_code: item.product.timelineCode,
                label: item.product.label,
                name: item.product.name,
                category: item.product.category,
                duration: item.product.duration,
                price: item.product.price,
                domain: item.product.domain,
                serving_unit: item.product.servingUnit,
                is_active: item.product.isActive,
                availability_status: item.product.availabilityStatus,
                sale_config: { ...item.product.saleConfig },
                updated_by: item.product.updatedBy,
                price_rule_count: item.priceRules.length,
                positive_price_rule_count: item.priceRules.filter(rule => rule.value > 0).length,
                owned_price_rule_count: item.priceRules.filter(rule => rule.updatedBy === 'migration_347_dar_catalog').length,
                price_rules: item.priceRules.map(rule => ({ ...rule }))
            }));
    }
    return codes.map(code => ({
        id: code,
        name: `${businessContext} ${code}`,
        business_context: businessContext,
        is_active: true,
        availability_status: 'active',
        updated_by: businessContext === 'dar' ? 'migration_347_dar_catalog' : 'price_center',
        price_rule_count: 1,
        positive_price_rule_count: 1,
        owned_price_rule_count: businessContext === 'dar' ? 1 : 0
    }));
}

function manifestFixture(overrides = {}) {
    const parkCodes = productCodes('park-item', 140);
    const darCodes = DAR_CATALOG_CONTRACT.map(item => item.product.id);
    const base = {
        schemaVersion: 1,
        release: {
            blockId: 'PARK-DAR-PRODUCTION-CONFIG-PLAN',
            expectedLiveSha: LIVE_SHA,
            branch: 'codex/eventgenix-production',
            project: 'fortunate-appreciation',
            environment: 'production',
            service: '8223324090'
        },
        legalEntity: {
            key: 'synthetic_legal_entity',
            name: 'Synthetic legal entity',
            taxIdentifier: 'synthetic-tax-identity'
        },
        providerOrganizationId: 'org-test-production-plan',
        schemaContractSha256: SCHEMA_CONTRACT_SHA256,
        profiles: [{ key: 'event_genix' }, { key: 'dar' }],
        locations: [
            { key: 'park_production', profileKey: 'event_genix', alias: 'park', displayName: 'PARK', providerOutletId: 'outlet-test-park' },
            { key: 'dar_production', profileKey: 'dar', alias: 'dar', displayName: 'DAR', providerOutletId: 'outlet-test-dar' },
            { key: 'shared_test', profileKey: 'event_genix', alias: 'shared_test', displayName: 'Test register', providerOutletId: 'outlet-test-shared' }
        ],
        registers: [
            { key: 'park_production', profileKey: 'event_genix', locationKey: 'park_production', alias: 'middle', displayName: 'Middle register', providerRegisterId: 'register-test-park', credentialRef: 'PARK_MIDDLE_PROD', expectedIsTest: false, integrationOwnerUserId: 101 },
            { key: 'dar_production', profileKey: 'dar', locationKey: 'dar_production', alias: 'dar', displayName: 'Studio register', providerRegisterId: 'register-test-dar', credentialRef: 'DAR_DAR_PROD', expectedIsTest: false, integrationOwnerUserId: 102 },
            { key: 'shared_test', profileKey: 'event_genix', locationKey: 'shared_test', alias: 'shared_test', displayName: 'Test register', providerRegisterId: 'register-test-shared', credentialRef: 'SHARED_TEST_REGISTER', expectedIsTest: true, integrationOwnerUserId: 103 }
        ],
        bindings: [
            { key: 'park_production', registerKey: 'park_production', userId: 101, providerCashierId: 'cashier-test-park', credentialRef: 'PARK_MIDDLE_CASHIER_PROD', displayName: 'PARK cashier', cashierLogin: 'mock-login-park', capabilities: ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open', 'fiscal.shift.close'] },
            { key: 'dar_production', registerKey: 'dar_production', userId: 102, providerCashierId: 'cashier-test-dar', credentialRef: 'DAR_DAR_CASHIER_PROD', displayName: 'DAR cashier', cashierLogin: 'mock-login-dar', capabilities: ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open', 'fiscal.shift.close'] },
            { key: 'shared_test', registerKey: 'shared_test', userId: 103, providerCashierId: 'cashier-test-shared', credentialRef: 'SHARED_TEST_CASHIER', displayName: 'Test cashier', cashierLogin: 'mock-login-shared', capabilities: ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open', 'fiscal.shift.close'] }
        ],
        routes: [
            { optionId: 'park_production', businessContext: 'event_genix', registerKey: 'park_production', mode: 'production', expectedIsTest: false, sharedRegisterGroup: null },
            { optionId: 'dar_production', businessContext: 'dar', registerKey: 'dar_production', mode: 'production', expectedIsTest: false, sharedRegisterGroup: null },
            { optionId: 'park_test', businessContext: 'event_genix', registerKey: 'shared_test', mode: 'test', expectedIsTest: true, sharedRegisterGroup: 'checkbox_single_test_register' },
            { optionId: 'dar_test', businessContext: 'dar', registerKey: 'shared_test', mode: 'test', expectedIsTest: true, sharedRegisterGroup: 'checkbox_single_test_register' }
        ],
        catalogMembership: {
            event_genix: { expectedCount: 140, itemCodesSha256: sha256(parkCodes) },
            dar: {
                expectedCount: 21,
                itemCodesSha256: sha256(darCodes),
                productPriceContractSha256: PINNED_DAR_CONTRACT_SHA256
            }
        },
        admissionMappings: Array.from({ length: 6 }, (_, index) => ({
            itemCode: `ticket-${index + 1}`,
            fiscalItemName: `Ticket ${index + 1}`
        })),
        migrationDigests: { ...MIGRATION_DIGESTS }
    };
    return { ...base, ...overrides, __parkCodes: parkCodes, __darCodes: darCodes };
}

function validatedFixture(overrides = {}) {
    const fixture = manifestFixture(overrides);
    const parkCodes = fixture.__parkCodes;
    const darCodes = fixture.__darCodes;
    delete fixture.__parkCodes;
    delete fixture.__darCodes;
    return { manifest: validateManifest(fixture), parkCodes, darCodes };
}

function emptyCurrentState(parkCodes, darCodes) {
    return {
        migrations: [...REQUIRED_MIGRATIONS],
        schemaContractSha256: SCHEMA_CONTRACT_SHA256,
        profiles: [],
        locations: [],
        registers: [],
        bindings: [],
        users: [101, 102, 103].map(id => ({
            id,
            role: 'creator',
            extra_roles: [],
            action_allowlist: [],
            action_denylist: [],
            is_active: true
        })),
        routes: [],
        mappings: [],
        products: [
            ...productRows('event_genix', parkCodes),
            ...productRows('dar', darCodes)
        ],
        discounts: [
            { business_context: 'dar', code: 'dar_second_club_direction_10', rate_bps: 1000, eligibility_mode: 'second_club_direction', is_active: true },
            { business_context: 'dar', code: 'dar_ubd_20', rate_bps: 2000, eligibility_mode: 'explicit', is_active: true }
        ],
        lifecycle: {
            openShifts: 0,
            queued: 0,
            failed: 0,
            dead: 0,
            unscopableJobs: 0,
            unknownOrders: 0,
            unknownOperations: 0,
            unresolvedReceipts: 0,
            unknownPaymentAttempts: 0,
            unknownRefunds: 0,
            unscopableUnknownRefunds: 0,
            inconsistentRefundRegisterRefs: 0
        }
    };
}

test('production planner accepts only the exact two-profile, three-register, four-route topology', () => {
    const { manifest } = validatedFixture();
    assert.equal(manifest.profiles.length, 2);
    assert.equal(manifest.registers.length, 3);
    assert.equal(manifest.bindings.length, 3);
    assert.equal(manifest.routes.length, 4);
    assert.equal(manifest.routes.filter(item => item.registerKey === 'shared_test').length, 2);
});

test('DAR product and price contract digest is pinned to all stable fields', () => {
    assert.equal(DAR_CATALOG_CONTRACT.length, 21);
    assert.equal(DAR_CATALOG_CONTRACT_SHA256, PINNED_DAR_CONTRACT_SHA256);
    assert.equal(sha256(DAR_CATALOG_CONTRACT), PINNED_DAR_CONTRACT_SHA256);
    assert.deepEqual(Object.keys(DAR_CATALOG_CONTRACT[0].product).sort(), [
        'availabilityStatus', 'businessContext', 'category', 'code', 'domain', 'duration', 'id',
        'isActive', 'label', 'name', 'price', 'saleConfig', 'servingUnit', 'timelineCode', 'updatedBy'
    ]);
    assert.deepEqual(Object.keys(DAR_CATALOG_CONTRACT[0].priceRules[0]).sort(), [
        'category', 'code', 'description', 'name', 'productId', 'unit', 'updatedBy', 'value'
    ]);
    const weekend = DAR_CATALOG_CONTRACT.find(item => item.product.id === 'dar_hourly_care_weekend');
    assert.equal(weekend.product.price, 350);
    assert.equal(weekend.product.saleConfig.quantity_step_millis, 1000);
    assert.equal(weekend.product.saleConfig.minimum_quantity_millis, 2000);
    assert.deepEqual(weekend.priceRules[0], {
        code: 'dar_hourly_care_weekend',
        name: 'Погодинний догляд — вихідні',
        value: 350,
        unit: 'година',
        category: 'Погодинний догляд',
        description: 'Approved DAR 2026–2027 catalog price',
        productId: 'dar_hourly_care_weekend',
        updatedBy: 'migration_347_dar_catalog'
    });
});

test('production manifest requires the exact pinned DAR product and price contract digest', () => {
    const missing = manifestFixture();
    delete missing.catalogMembership.dar.productPriceContractSha256;
    delete missing.__parkCodes;
    delete missing.__darCodes;
    assert.throws(
        () => validateManifest(missing),
        error => error.code === 'park_dar_manifest_dar_product_price_contract_digest_invalid'
    );

    const drift = manifestFixture();
    drift.catalogMembership.dar.productPriceContractSha256 = '0'.repeat(64);
    delete drift.__parkCodes;
    delete drift.__darCodes;
    assert.throws(
        () => validateManifest(drift),
        error => error.code === 'park_dar_manifest_dar_product_price_contract_digest_mismatch'
    );
});

test('production planner rejects secret fields, provider register duplication and release target drift', () => {
    const secret = manifestFixture();
    secret.password = 'password';
    assert.throws(
        () => validateManifest(secret),
        error => error instanceof ParkDarProductionPlanError && error.code === 'park_dar_manifest_secret_field_forbidden'
    );

    const duplicate = manifestFixture();
    duplicate.registers[1].providerRegisterId = duplicate.registers[0].providerRegisterId;
    delete duplicate.__parkCodes;
    delete duplicate.__darCodes;
    assert.throws(() => validateManifest(duplicate), error => error.code === 'park_dar_manifest_provider_register_duplicate');

    const targetDrift = manifestFixture();
    targetDrift.release.service = 'different-service';
    delete targetDrift.__parkCodes;
    delete targetDrift.__darCodes;
    assert.throws(() => validateManifest(targetDrift), error => error.code === 'park_dar_manifest_release_target_mismatch');
});

test('production planner requires the exact bounded cashier capability set', () => {
    for (const capabilities of [
        ['payments.view'],
        ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open', 'fiscal.shift.close', 'fiscal.configure']
    ]) {
        const fixture = manifestFixture();
        fixture.bindings[0].capabilities = capabilities;
        delete fixture.__parkCodes;
        delete fixture.__darCodes;
        assert.throws(
            () => validateManifest(fixture),
            error => error.code === 'park_dar_manifest_binding_capability_set_invalid'
        );
    }
});

test('production attestation is short-lived, target-bound and requires all global gates false', () => {
    assert.equal(validateAttestation(attestationFixture(), { now: TEST_NOW }).liveSha, LIVE_SHA);
    assert.throws(
        () => validateAttestation(attestationFixture({ expiresAt: new Date(TEST_NOW - 1).toISOString() }), { now: TEST_NOW }),
        error => error.code === 'park_dar_attestation_expired_or_invalid'
    );
    const enabled = attestationFixture();
    enabled.globalGates.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = true;
    assert.throws(
        () => validateAttestation(enabled, { now: TEST_NOW }),
        error => error.code === 'park_dar_attestation_global_gate_enabled'
    );
    assert.throws(
        () => validateAttestation(attestationFixture({ nonce: 'not-a-uuid' }), { now: TEST_NOW }),
        error => error.code === 'park_dar_attestation_identity_invalid'
    );
    assert.equal(
        validateAttestation(attestationFixture({ observedAt: new Date(TEST_NOW + 30_000).toISOString() }), { now: TEST_NOW }).liveSha,
        LIVE_SHA
    );
    assert.throws(
        () => validateAttestation(attestationFixture({ observedAt: new Date(TEST_NOW + 30_001).toISOString() }), { now: TEST_NOW }),
        error => error.code === 'park_dar_attestation_expired_or_invalid'
    );
});

test('production attestation producer is exact-runtime, read-only and sanitized', async () => {
    const statements = [];
    const client = {
        async query(sql) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            statements.push(normalized);
            if (normalized.includes('FROM pg_catalog.pg_database database_record')) {
                return { rows: [{
                    transaction_read_only: 'on',
                    database_name: 'hidden_database_name',
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
    const result = await buildProductionAttestation({
        challenge: {
            blockId: 'PARK-DAR-PRODUCTION-CONFIG-PLAN',
            manifestSha256: 'b'.repeat(64),
            nonce: '123e4567-e89b-42d3-a456-426614174000'
        },
        env: productionRuntimeEnv(),
        dbPool: { async connect() { return client; } },
        release: {
            commitSha: LIVE_SHA,
            sourceBranch: 'codex/eventgenix-production',
            deploymentMetadata: { complete: true, status: 'manifest' }
        },
        now: TEST_NOW
    });
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.origin, PRODUCTION_ORIGIN);
    assert.equal(result.databaseFingerprintSha256.length, 64);
    assert.equal(statements[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(statements[1], 'SET LOCAL search_path = pg_catalog, public');
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.doesNotMatch(JSON.stringify(result), /hidden_database_name/);

    await assert.rejects(
        () => buildProductionAttestation({
            challenge: {
                blockId: 'PARK-DAR-PRODUCTION-CONFIG-PLAN',
                manifestSha256: 'b'.repeat(64),
                nonce: '123e4567-e89b-42d3-a456-426614174000'
            },
            env: productionRuntimeEnv({ CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true' }),
            dbPool: { async connect() { throw new Error('must not connect'); } },
            release: {
                commitSha: LIVE_SHA,
                sourceBranch: 'codex/eventgenix-production',
                deploymentMetadata: { complete: true, status: 'manifest' }
            }
        }),
        error => error.code === 'park_dar_attestation_global_gate_not_disabled'
    );

    for (const status of ['manual', 'partial', 'unavailable', 'conflict']) {
        await assert.rejects(
            () => buildProductionAttestation({
                challenge: {
                    blockId: 'PARK-DAR-PRODUCTION-CONFIG-PLAN',
                    manifestSha256: 'b'.repeat(64),
                    nonce: '123e4567-e89b-42d3-a456-426614174000'
                },
                env: productionRuntimeEnv(),
                dbPool: { async connect() { throw new Error('must not connect'); } },
                release: {
                    commitSha: LIVE_SHA,
                    sourceBranch: 'codex/eventgenix-production',
                    deploymentMetadata: { complete: status === 'manifest', status }
                }
            }),
            error => error.code === 'park_dar_attestation_release_identity_unverified'
        );
    }

    await assert.rejects(
        () => buildProductionAttestation({
            challenge: {
                blockId: 'PARK-DAR-PRODUCTION-CONFIG-PLAN',
                manifestSha256: 'b'.repeat(64),
                nonce: '123e4567-e89b-42d3-a456-426614174000'
            },
            env: productionRuntimeEnv({ TEST_MODE: 'TRUE' }),
            dbPool: { async connect() { throw new Error('must not connect'); } },
            release: {
                commitSha: LIVE_SHA,
                sourceBranch: 'codex/eventgenix-production',
                deploymentMetadata: { complete: true, status: 'railway' }
            }
        }),
        error => error.code === 'park_dar_attestation_release_identity_unverified'
    );
});

test('planner accepts attestation only from a direct exact-origin HTTPS challenge', async () => {
    const rawManifest = manifestFixture();
    delete rawManifest.__parkCodes;
    delete rawManifest.__darCodes;
    const manifestSha256 = protectedFileHash(rawManifest);
    const attestation = attestationFixture({ manifestSha256 });
    await authenticatedEnvelope({ manifest: rawManifest, attestation, manifestSha256 });

    await assert.rejects(
        () => runReadOnlyPlan({
            dbPool: { async connect() { throw new Error('must not connect'); } },
            manifest: rawManifest,
            attestationEnvelope: { value: attestation },
            manifestFileSha256: manifestSha256,
            expectedManifestSha256: manifestSha256,
            env: {}
        }),
        error => error.code === 'park_dar_attestation_transport_untrusted'
    );

    await assert.rejects(
        () => fetchProductionAttestation({
            manifest: rawManifest,
            manifestSha256,
            nonce: attestation.nonce,
            now: TEST_NOW,
            async fetchImpl(url) {
                return {
                    ok: true,
                    redirected: true,
                    url: String(url),
                    headers: { get: () => 'application/json' },
                    async text() { return JSON.stringify(attestation); }
                };
            }
        }),
        error => error.code === 'park_dar_attestation_https_response_invalid'
    );

    await assert.rejects(
        () => fetchProductionAttestation({
            manifest: rawManifest,
            manifestSha256,
            nonce: attestation.nonce,
            now: TEST_NOW,
            env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
            async fetchImpl() {
                throw new Error('must not fetch');
            }
        }),
        error => error.code === 'park_dar_attestation_insecure_tls_runtime'
    );
});

test('authenticated production attestation payload is immutable after transport validation', async () => {
    const rawManifest = manifestFixture();
    delete rawManifest.__parkCodes;
    delete rawManifest.__darCodes;
    const manifestSha256 = protectedFileHash(rawManifest);
    const attestation = attestationFixture({ manifestSha256 });
    const envelope = await authenticatedEnvelope({ manifest: rawManifest, attestation, manifestSha256 });

    assert.ok(Object.isFrozen(envelope));
    assert.ok(Object.isFrozen(envelope.value));
    assert.ok(Object.isFrozen(envelope.value.globalGates));
    assert.throws(() => { envelope.value.liveSha = 'f'.repeat(40); }, TypeError);
    assert.throws(() => { envelope.value.globalGates.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = true; }, TypeError);
    assert.equal(envelope.value.liveSha, LIVE_SHA);
    assert.equal(envelope.value.globalGates.CHECKBOX_ACCEPT_PAYMENTS_ENABLED, false);
});

test('production attestation validates against response time and uses an explicit namespaced challenge marker', async () => {
    const rawManifest = manifestFixture();
    delete rawManifest.__parkCodes;
    delete rawManifest.__darCodes;
    const manifestSha256 = protectedFileHash(rawManifest);
    const responseNow = TEST_NOW + 1_000;
    const attestation = attestationFixture({
        manifestSha256,
        observedAt: new Date(TEST_NOW + 500).toISOString(),
        expiresAt: new Date(TEST_NOW + 4 * 60_000).toISOString()
    });
    let requestedUrl;
    await fetchProductionAttestation({
        manifest: rawManifest,
        manifestSha256,
        nonce: attestation.nonce,
        clock: () => responseNow,
        async fetchImpl(url) {
            requestedUrl = new URL(String(url));
            return {
                ok: true,
                redirected: false,
                url: String(url),
                headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
                async text() { return JSON.stringify(attestation); }
            };
        }
    });
    assert.equal(requestedUrl.searchParams.get('parkDarProductionAttestation'), '1');
});

test('attestation reuses the existing public version boundary without changing auth permissions', () => {
    const settingsSource = fs.readFileSync(require.resolve('../routes/settings'), 'utf8');
    const versionRoute = settingsSource.indexOf("router.get('/version'");
    const authWall = settingsSource.indexOf('router.use(authenticateToken)');
    assert.ok(versionRoute >= 0 && authWall > versionRoute);
    assert.match(settingsSource.slice(versionRoute, authWall), /buildProductionAttestation/);
    assert.match(settingsSource.slice(versionRoute, authWall), /PRODUCTION_ATTESTATION_MARKER_PARAM/);
    assert.match(settingsSource, /parkDarProductionAttestationLimiter/);
    assert.doesNotMatch(settingsSource.slice(versionRoute, authWall), /attestationKeys\.some/);
    assert.doesNotMatch(settingsSource, /router\.get\('\/production-preflight\/park-dar-attestation'/);

    const authBoundary = require('../config/authBoundary');
    const versionContract = authBoundary.PUBLIC_API_ROUTES.find(item => item.method === 'GET' && item.path === '/version');
    assert.ok(versionContract);
});

test('production planner never falls back to DATABASE_URL and requires explicit SSL', () => {
    assert.throws(
        () => requiredDatabaseUrl({ DATABASE_URL: 'postgres://must-not-be-used' }),
        error => error.code === 'park_dar_production_readonly_database_url_required'
    );
    const localUrl = 'postgresql://readonly@127.0.0.1:5432/disposable';
    const remoteUrl = 'postgresql://readonly@db.example.test:5432/production?sslmode=verify-full';
    assert.throws(() => sslConfig({}, localUrl), error => error.code === 'park_dar_production_database_ssl_required');
    assert.equal(sslConfig({ PARK_DAR_PRODUCTION_DATABASE_SSL: 'false' }, localUrl), false);
    assert.deepEqual(sslConfig({ PARK_DAR_PRODUCTION_DATABASE_SSL: 'true' }, remoteUrl), { rejectUnauthorized: true });
    assert.throws(
        () => sslConfig({ PARK_DAR_PRODUCTION_DATABASE_SSL: 'false' }, remoteUrl),
        error => error.code === 'park_dar_production_database_ssl_required_for_remote'
    );
    assert.throws(
        () => sslConfig(
            { PARK_DAR_PRODUCTION_DATABASE_SSL: 'true' },
            'postgresql://readonly@db.example.test:5432/production?sslmode=require'
        ),
        error => error.code === 'park_dar_production_database_sslmode_unsafe'
    );
    assert.throws(
        () => sslConfig(
            { PARK_DAR_PRODUCTION_DATABASE_SSL: 'true' },
            'postgresql://readonly@db.example.test:5432/production?sslmode=verify-full&options=-csearch_path%3Devil'
        ),
        error => error.code === 'park_dar_production_database_url_options_forbidden'
    );
    assert.throws(
        () => sslConfig(
            { PARK_DAR_PRODUCTION_DATABASE_SSL: 'true' },
            'postgresql://readonly@db.example.test:5432/production?sslmode=verify-full&sslmode=disable'
        ),
        error => error.code === 'park_dar_production_database_sslmode_unsafe'
    );
    for (const override of [
        'host=example.invalid',
        'ssl=0',
        'ssl=no-verify',
        'sslkey=local-file'
    ]) {
        assert.throws(
            () => databasePoolConfig(
                { PARK_DAR_PRODUCTION_DATABASE_SSL: 'false' },
                `postgresql://readonly@127.0.0.1:5432/disposable?${override}`
            ),
            error => error.code === 'park_dar_production_database_url_parameter_forbidden'
        );
    }
    assert.deepEqual(
        databasePoolConfig(
            { PARK_DAR_PRODUCTION_DATABASE_SSL: 'true' },
            remoteUrl
        ),
        {
            host: 'db.example.test',
            port: 5432,
            database: 'production',
            user: 'readonly',
            password: '',
            ssl: { rejectUnauthorized: true }
        }
    );
    const cliSource = fs.readFileSync(require.resolve('../scripts/plan-park-dar-production-config'), 'utf8');
    assert.doesNotMatch(cliSource, /connectionString\s*:/);
    assert.match(cliSource, /databasePoolConfig\(env, databaseUrl\)/);
});

test('production planner CLI has no apply/write or caller-supplied attestation mode', () => {
    assert.deepEqual(parseArgs([
        '--manifest-file=C:\\protected\\park-dar.json',
        `--expected-manifest-sha256=${'b'.repeat(64)}`
    ]), {
        manifestFile: 'C:\\protected\\park-dar.json',
        expectedManifestSha256: 'b'.repeat(64)
    });
    for (const arg of ['--apply', '--write', '--execute', '--database-url=hidden', '--attestation-file=C:\\untrusted.json', `--attested-live-sha=${LIVE_SHA}`]) {
        assert.throws(() => parseArgs([arg]), error => error.code === 'park_dar_production_plan_cli_forbidden');
    }
    assert.throws(
        () => assertProtectedInputFiles({
            manifestFile: __filename
        }),
        error => error.code === 'park_dar_protected_input_inside_repository'
    );
});

test('exact desired plan contains 322 catalog and 12 admission mappings', () => {
    const { manifest, parkCodes, darCodes } = validatedFixture();
    const plan = planExactState(manifest, emptyCurrentState(parkCodes, darCodes), []);
    assert.equal(plan.ready, true);
    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.counts.profiles, { insert: 2, update: 0, noOp: 0, conflict: 0 });
    assert.deepEqual(plan.counts.registers, { insert: 3, update: 0, noOp: 0, conflict: 0 });
    assert.deepEqual(plan.counts.bindings, { insert: 3, update: 0, noOp: 0, conflict: 0 });
    assert.deepEqual(plan.counts.routes, { insert: 4, update: 0, noOp: 0, conflict: 0 });
    assert.deepEqual(plan.counts.catalogMappings, { insert: EXPECTED_COUNTS.catalogMappings, update: 0, noOp: 0, conflict: 0 });
    assert.deepEqual(plan.counts.admissionMappings, { insert: EXPECTED_COUNTS.admissionMappings, update: 0, noOp: 0, conflict: 0 });
    assert.deepEqual(plan.catalog, { eventGenix: 140, dar: 21 });
});

test('same-count catalog membership drift is blocked by exact item-code hash', () => {
    const { manifest, parkCodes, darCodes } = validatedFixture();
    const swapped = [...parkCodes.slice(0, -1), 'park-item-replacement'];
    const plan = planExactState(manifest, emptyCurrentState(swapped, darCodes), []);
    assert.equal(plan.ready, false);
    assert.ok(plan.blockers.includes('event_genix_catalog_membership_mismatch'));
    assert.equal(plan.catalog.eventGenix, 140);
});

test('same DAR IDs fail closed on product, price, ownership or sale-config drift', () => {
    const { manifest, parkCodes, darCodes } = validatedFixture();
    const cases = [
        ['product code', state => { state.products.find(item => item.id === 'dar_daycare_month').code = 'D999'; }],
        ['product price', state => { state.products.find(item => item.id === 'dar_daycare_month').price = 7199; }],
        ['price rule code', state => { state.products.find(item => item.id === 'dar_daycare_month').price_rules[0].code = 'dar_wrong'; }],
        ['price rule value', state => { state.products.find(item => item.id === 'dar_daycare_month').price_rules[0].value = 7199; }],
        ['price rule unit', state => { state.products.find(item => item.id === 'dar_daycare_month').price_rules[0].unit = 'грн'; }],
        ['price rule category', state => { state.products.find(item => item.id === 'dar_daycare_month').price_rules[0].category = 'Гуртки'; }],
        ['price rule ownership', state => { state.products.find(item => item.id === 'dar_daycare_month').price_rules[0].updatedBy = 'operator_edit'; }],
        ['weekend minimum quantity', state => {
            state.products.find(item => item.id === 'dar_hourly_care_weekend').sale_config.minimum_quantity_millis = 1000;
        }]
    ];
    for (const [label, mutate] of cases) {
        const current = emptyCurrentState(parkCodes, darCodes);
        mutate(current);
        const plan = planExactState(manifest, current, []);
        assert.equal(plan.ready, false, label);
        assert.ok(plan.blockers.includes('dar_product_price_contract_mismatch'), label);
    }

    const reorderedJson = emptyCurrentState(parkCodes, darCodes);
    const weekend = reorderedJson.products.find(item => item.id === 'dar_hourly_care_weekend');
    weekend.sale_config = { minimum_quantity_millis: 2000, quantity_step_millis: 1000 };
    assert.equal(planExactState(manifest, reorderedJson, []).ready, true);
});

test('unexpected migration head, DAR ownership drift and unresolved lifecycle fail closed', () => {
    const { manifest, parkCodes, darCodes } = validatedFixture();

    const future = emptyCurrentState(parkCodes, darCodes);
    future.migrations.push('352_unapproved_future_change');
    const futurePlan = planExactState(manifest, future, []);
    assert.equal(futurePlan.ready, false);
    assert.ok(futurePlan.blockers.includes('unexpected_migration_head'));
    assert.equal(futurePlan.migrationHead, 352);

    const protectedDrift = emptyCurrentState(parkCodes, darCodes);
    protectedDrift.migrations.push('350_unapproved_shadow');
    assert.deepEqual(unexpectedProtectedMigrations(protectedDrift.migrations), ['350_unapproved_shadow']);
    const protectedDriftPlan = planExactState(manifest, protectedDrift, []);
    assert.equal(protectedDriftPlan.ready, false);
    assert.ok(protectedDriftPlan.blockers.includes('unexpected_protected_migration_version'));

    const ownership = emptyCurrentState(parkCodes, darCodes);
    ownership.products.find(item => item.business_context === 'dar').updated_by = 'operator_edit';
    const ownershipPlan = planExactState(manifest, ownership, []);
    assert.equal(ownershipPlan.ready, false);
    assert.ok(ownershipPlan.blockers.includes('dar_catalog_ownership_drift'));
    assert.ok(ownershipPlan.blockers.includes('dar_catalog_seed_row_count_mismatch'));

    const lifecycle = emptyCurrentState(parkCodes, darCodes);
    lifecycle.lifecycle.queued = 1;
    lifecycle.lifecycle.unscopableJobs = 1;
    lifecycle.lifecycle.unknownOperations = 1;
    lifecycle.lifecycle.unknownRefunds = 1;
    lifecycle.lifecycle.unscopableUnknownRefunds = 1;
    lifecycle.lifecycle.inconsistentRefundRegisterRefs = 1;
    const lifecyclePlan = planExactState(manifest, lifecycle, []);
    assert.equal(lifecyclePlan.ready, false);
    assert.ok(lifecyclePlan.blockers.includes('queued_outbox_jobs_present'));
    assert.ok(lifecyclePlan.blockers.includes('unscopable_outbox_jobs_present'));
    assert.ok(lifecyclePlan.blockers.includes('unknown_fiscal_operations_present'));
    assert.ok(lifecyclePlan.blockers.includes('unknown_refunds_present'));
    assert.ok(lifecyclePlan.blockers.includes('unscopable_unknown_refunds_present'));
    assert.ok(lifecyclePlan.blockers.includes('inconsistent_refund_register_refs_present'));
});

test('planner inventory fixes search_path and resolves refund-chain outbox scope fail closed', () => {
    const source = fs.readFileSync(require.resolve('../services/payments/parkDarProductionConfigPlanner'), 'utf8');
    assert.match(source, /SET LOCAL search_path = pg_catalog, public/);
    assert.match(source, /LEFT JOIN public\.payment_refunds refund/);
    assert.match(source, /LEFT JOIN public\.payment_orders refund_order/);
    assert.match(source, /refund\.fiscal_register_id,[\s\S]*refund_order\.fiscal_register_id/);
    assert.match(source, /fiscal_register_id IS NULL[\s\S]*status <> 'succeeded'\) AS "unscopableJobs"/);
    assert.match(source, /status IN \('money_refund_unknown', 'fiscal_return_unknown'\)/);
    assert.match(source, /money_refund_status = 'unknown'/);
    assert.match(source, /fiscal_refund_status = 'unknown'/);
    assert.match(source, /direct_register_id IN[\s\S]*order_register_id IN[\s\S]*operation_register_id IN[\s\S]*AS "unknownRefunds"/);
    assert.doesNotMatch(source, /\b(?:FROM|JOIN) (?:fiscal_|payment_|products\b|price_rules\b|sales_discount_rules\b|schema_migrations\b|users\b)/);
});

test('missing migrations and enabled acceptance fail closed', () => {
    const { manifest, parkCodes, darCodes } = validatedFixture();
    const missing = planExactState(manifest, { migrations: [] }, []);
    assert.equal(missing.ready, false);
    assert.deepEqual(missing.blockers, ['required_migrations_missing']);

    const current = emptyCurrentState(parkCodes, darCodes);
    current.registers.push({
        profileKey: 'event_genix',
        locationAlias: 'park',
        alias: 'middle',
        displayName: 'Middle register',
        provider: 'checkbox',
        providerRegisterId: 'register-test-park',
        credentialRef: 'PARK_MIDDLE_PROD',
        expectedIsTest: false,
        status: 'active',
        featureEnabled: true,
        acceptanceEnabled: true
    });
    const enabled = planExactState(manifest, current, []);
    assert.equal(enabled.ready, false);
    assert.ok(enabled.blockers.includes('database_acceptance_enabled'));
});

test('post-migration schema object drift fails closed even when migration names are present', () => {
    const { manifest, parkCodes, darCodes } = validatedFixture();
    const current = emptyCurrentState(parkCodes, darCodes);
    current.schemaContractSha256 = 'f'.repeat(64);
    const plan = planExactState(manifest, current, []);
    assert.equal(plan.ready, false);
    assert.ok(plan.blockers.includes('schema_contract_mismatch'));
});

test('read-only proof rejects a role with protected table write privileges', async () => {
    await assert.rejects(
        () => proveReadOnly({
            async query() {
                return { rows: [{
                    transaction_read_only: 'on',
                    transaction_isolation: 'repeatable read',
                    database_create: false,
                    schema_create: false,
                    migration_insert: false,
                    ledger_insert: false,
                    protected_table_write: true
                }] };
            }
        }),
        error => error.code === 'park_dar_database_readonly_proof_failed'
    );
});

test('read-only planner rolls back and emits only sanitized hashes/counts/blocker codes', async () => {
    const rawFixture = manifestFixture();
    const hiddenOrganization = rawFixture.providerOrganizationId;
    const hiddenRegister = rawFixture.registers[0].providerRegisterId;
    const hiddenLogin = rawFixture.bindings[0].cashierLogin;
    delete rawFixture.__parkCodes;
    delete rawFixture.__darCodes;
    const proofIdentity = {
        database_name: 'synthetic_production',
        database_user: 'synthetic_readonly',
        server_address: '192.0.2.10',
        server_port: 5432,
        server_version_num: '160000',
        database_oid: '9876',
        system_identifier: '7681708227381576429',
        database_owner_oid: '10',
        database_encoding: 'UTF8',
        database_collate: 'C',
        database_ctype: 'C'
    };
    const finalManifestFileSha256 = protectedFileHash(rawFixture);
    const attestation = attestationFixture({
        databaseFingerprintSha256: databaseFingerprint(proofIdentity),
        manifestSha256: finalManifestFileSha256
    });
    const attestationEnvelope = await authenticatedEnvelope({
        manifest: rawFixture,
        attestation,
        manifestSha256: finalManifestFileSha256
    });
    const statements = [];
    const client = {
        async query(sql) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            statements.push(normalized);
            if (normalized.includes("current_setting('transaction_read_only')")) {
                return { rows: [{
                    transaction_read_only: 'on',
                    transaction_isolation: 'repeatable read',
                    database_create: false,
                    schema_create: false,
                    migration_insert: false,
                    ledger_insert: false,
                    protected_table_write: false,
                    ...proofIdentity
                }] };
            }
            if (normalized.startsWith('SELECT version FROM public.schema_migrations')) return { rows: [] };
            return { rows: [] };
        },
        release() {}
    };
    const result = await runReadOnlyPlan({
        dbPool: { async connect() { return client; } },
        manifest: rawFixture,
        attestationEnvelope,
        manifestFileSha256: finalManifestFileSha256,
        expectedManifestSha256: finalManifestFileSha256,
        env: {}
    });
    assert.equal(result.ready, false);
    assert.deepEqual(result.blockers, ['required_migrations_missing']);
    assert.equal(statements[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(statements[1], 'SET LOCAL search_path = pg_catalog, public');
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.equal(statements.some(sql => /^(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i.test(sql)), false);
    const output = JSON.stringify(result);
    for (const hidden of [hiddenOrganization, hiddenRegister, hiddenLogin]) assert.equal(output.includes(hidden), false);
    assert.match(result.planHash, /^[a-f0-9]{64}$/);
});

test('read-only planner rejects hash and database identity drift before planning', async () => {
    const rawFixture = manifestFixture();
    delete rawFixture.__parkCodes;
    delete rawFixture.__darCodes;
    const manifestFileSha256 = protectedFileHash(rawFixture);
    const attestation = attestationFixture({
        databaseFingerprintSha256: 'e'.repeat(64),
        manifestSha256: manifestFileSha256
    });
    const attestationEnvelope = await authenticatedEnvelope({
        manifest: rawFixture,
        attestation,
        manifestSha256: manifestFileSha256
    });
    await assert.rejects(
        () => runReadOnlyPlan({
            dbPool: { async connect() { throw new Error('must not connect on manifest hash drift'); } },
            manifest: rawFixture,
            attestationEnvelope,
            manifestFileSha256,
            expectedManifestSha256: 'f'.repeat(64),
            env: {}
        }),
        error => error.code === 'park_dar_manifest_hash_mismatch'
    );

    const statements = [];
    const client = {
        async query(sql) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            statements.push(normalized);
            if (normalized.includes("current_setting('transaction_read_only')")) {
                return { rows: [{
                    transaction_read_only: 'on',
                    transaction_isolation: 'repeatable read',
                    database_create: false,
                    schema_create: false,
                    migration_insert: false,
                    ledger_insert: false,
                    protected_table_write: false,
                    database_name: 'wrong_database',
                    database_user: 'synthetic_readonly',
                    server_address: '192.0.2.11',
                    server_port: 5432,
                    server_version_num: '160000',
                    database_oid: '12',
                    system_identifier: '7681708227381576430',
                    database_owner_oid: '10',
                    database_encoding: 'UTF8',
                    database_collate: 'C',
                    database_ctype: 'C'
                }] };
            }
            return { rows: [] };
        },
        release() {}
    };
    await assert.rejects(
        () => runReadOnlyPlan({
            dbPool: { async connect() { return client; } },
            manifest: rawFixture,
            attestationEnvelope,
            manifestFileSha256,
            expectedManifestSha256: manifestFileSha256,
            env: {}
        }),
        error => error.code === 'park_dar_database_fingerprint_mismatch'
    );
    assert.equal(statements.at(-1), 'ROLLBACK');
});
