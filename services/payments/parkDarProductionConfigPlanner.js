'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { classifyCatalogRows } = require('./catalogSaleMappingConfigurator');
const { resolveCapability } = require('../accountAccessPolicy');
const {
    ATTESTATION_TTL_MS,
    GLOBAL_GATE_NAMES,
    PRODUCTION_ATTESTATION_AUDIENCE,
    PRODUCTION_ATTESTATION_MARKER_PARAM,
    PRODUCTION_ATTESTATION_PATH,
    PRODUCTION_ATTESTATION_SOURCE,
    PRODUCTION_ORIGIN,
    PRODUCTION_RUNTIME_IDENTITY_SHA256,
    RELEASE_TARGET,
    databaseFingerprint: databaseTargetFingerprint
} = require('./parkDarProductionAttestation');

const READONLY_DATABASE_ENV = 'PARK_DAR_PRODUCTION_READONLY_DATABASE_URL';
const READONLY_SSL_ENV = 'PARK_DAR_PRODUCTION_DATABASE_SSL';
const READONLY_SSL_CA_FILE_ENV = 'PARK_DAR_PRODUCTION_DATABASE_SSL_CA_FILE';
const REQUIRED_MIGRATIONS = Object.freeze([
    '346_catalog_sale_foundation',
    '347_dar_catalog_2026_2027',
    '348_fiscal_cashier_admin_metadata',
    '349_payment_order_selected_fiscal_cashier_binding',
    '350_fiscal_register_route_acceptance',
    '351_fiscal_sale_routes'
]);
const REQUIRED_CREDENTIAL_REFS = Object.freeze({
    park_production: Object.freeze({ register: 'PARK_MIDDLE_PROD', cashier: 'PARK_MIDDLE_CASHIER_PROD' }),
    dar_production: Object.freeze({ register: 'DAR_DAR_PROD', cashier: 'DAR_DAR_CASHIER_PROD' }),
    shared_test: Object.freeze({ register: 'SHARED_TEST_REGISTER', cashier: 'SHARED_TEST_CASHIER' })
});
const EXPECTED_COUNTS = Object.freeze({
    profiles: 2,
    locations: 3,
    registers: 3,
    bindings: 3,
    routes: 4,
    catalogMappings: 322,
    admissionMappings: 12
});
const REQUIRED_BINDING_CAPABILITIES = Object.freeze([
    'fiscal.shift.close',
    'fiscal.shift.open',
    'payments.confirm_received',
    'payments.create',
    'payments.view'
]);
const FORBIDDEN_MANIFEST_KEY = /(?:^|_)(?:password|passcode|pin(?:_?code)?|license_?key|access_?key|device_?id|token|secret|database_?url)(?:$|_)/i;
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SAFE_KEY_RE = /^[a-z0-9_]+$/;
const AUTHENTICATED_ATTESTATION = Symbol('authenticated-production-attestation');
const MAX_ATTESTATION_BYTES = 32 * 1024;
const ATTESTATION_TIMEOUT_MS = 5_000;
const ATTESTATION_CLOCK_SKEW_MS = 30_000;

class ParkDarProductionPlanError extends Error {
    constructor(code, message = code) {
        super(message);
        this.name = 'ParkDarProductionPlanError';
        this.code = code;
    }
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    const payload = Buffer.isBuffer(value) || typeof value === 'string' ? value : stableJson(value);
    return crypto.createHash('sha256').update(payload).digest('hex');
}

const DAR_CATALOG_OWNER = 'migration_347_dar_catalog';
const DAR_PRICE_RULE_DESCRIPTION = 'Approved DAR 2026–2027 catalog price';
const DAR_CATALOG_SEED = [
    ['dar_daycare_month', 'D001', 'ДМіс', 'Денний догляд 09:00–13:00, місяць', 7200, 'місяць', 'Денний догляд', null, 1000],
    ['dar_daycare_single_day', 'D002', 'День', 'Денний догляд, разовий день', 650, 'день', 'Денний догляд', null, 1000],
    ['dar_school_prep_8', 'D003', 'ПШ8', 'Підготовка до школи — абонемент на 8 занять', 1750, 'абонемент', 'Гуртки', 'school_prep', 1000],
    ['dar_logic_8', 'D004', 'Лог8', 'Логіка — абонемент на 8 занять', 1750, 'абонемент', 'Гуртки', 'logic', 1000],
    ['dar_early_development_8', 'D005', 'РР8', 'Ранній розвиток — абонемент на 8 занять', 1750, 'абонемент', 'Гуртки', 'early_development', 1000],
    ['dar_english_8', 'D006', 'Анг8', 'Англійська мова — абонемент на 8 занять', 1750, 'абонемент', 'Гуртки', 'english', 1000],
    ['dar_choreography_8', 'D007', 'Хор8', 'Хореографія — абонемент на 8 занять', 1750, 'абонемент', 'Гуртки', 'choreography', 1000],
    ['dar_painting_8', 'D008', 'Жив8', 'Живопис — абонемент на 8 занять', 1750, 'абонемент', 'Гуртки', 'painting', 1000],
    ['dar_sculpting_creativity_8', 'D009', 'Ліп8', 'Ліплення та творчість — абонемент на 8 занять', 1750, 'абонемент', 'Гуртки', 'sculpting_creativity', 1000],
    ['dar_art_therapy_8', 'D010', 'Арт8', 'Арт-терапія — абонемент на 8 занять', 1750, 'абонемент', 'Гуртки', 'art_therapy', 1000],
    ['dar_school_prep_single', 'D011', 'ПШ1', 'Підготовка до школи — разове заняття', 300, 'заняття', 'Гуртки', 'school_prep', 1000],
    ['dar_logic_single', 'D012', 'Лог1', 'Логіка — разове заняття', 300, 'заняття', 'Гуртки', 'logic', 1000],
    ['dar_early_development_single', 'D013', 'РР1', 'Ранній розвиток — разове заняття', 300, 'заняття', 'Гуртки', 'early_development', 1000],
    ['dar_english_single', 'D014', 'Анг1', 'Англійська мова — разове заняття', 300, 'заняття', 'Гуртки', 'english', 1000],
    ['dar_choreography_single', 'D015', 'Хор1', 'Хореографія — разове заняття', 300, 'заняття', 'Гуртки', 'choreography', 1000],
    ['dar_painting_single', 'D016', 'Жив1', 'Живопис — разове заняття', 300, 'заняття', 'Гуртки', 'painting', 1000],
    ['dar_sculpting_creativity_single', 'D017', 'Ліп1', 'Ліплення та творчість — разове заняття', 300, 'заняття', 'Гуртки', 'sculpting_creativity', 1000],
    ['dar_art_therapy_single', 'D018', 'Арт1', 'Арт-терапія — разове заняття', 300, 'заняття', 'Гуртки', 'art_therapy', 1000],
    ['dar_speech_therapy_individual', 'D019', 'Логоп', 'Логопед — індивідуальне заняття', 500, 'заняття', 'Логопед', null, 1000],
    ['dar_hourly_care_weekday', 'D020', 'ГодБ', 'Погодинний догляд — будні', 200, 'година', 'Погодинний догляд', null, 1000],
    ['dar_hourly_care_weekend', 'D021', 'ГодВ', 'Погодинний догляд — вихідні', 350, 'година', 'Погодинний догляд', null, 2000]
];

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

const DAR_CATALOG_CONTRACT = deepFreeze(DAR_CATALOG_SEED.map(([
    id, code, timelineCode, name, price, servingUnit, category, clubDirection, minimumQuantityMillis
]) => {
    const saleConfig = {
        quantity_step_millis: 1000,
        minimum_quantity_millis: minimumQuantityMillis
    };
    if (clubDirection) saleConfig.club_direction = clubDirection;
    return {
        product: {
            id,
            businessContext: 'dar',
            code,
            timelineCode,
            label: name,
            name,
            category,
            duration: 0,
            price,
            domain: 'program',
            servingUnit,
            isActive: true,
            availabilityStatus: 'active',
            saleConfig,
            updatedBy: DAR_CATALOG_OWNER
        },
        priceRules: [{
            code: id,
            name,
            value: price,
            unit: servingUnit,
            category,
            description: DAR_PRICE_RULE_DESCRIPTION,
            productId: id,
            updatedBy: DAR_CATALOG_OWNER
        }]
    };
}).sort((left, right) => left.product.id.localeCompare(right.product.id)));
const DAR_CATALOG_CONTRACT_SHA256 = 'd4a05529430266361727008c9429226706f368054ada35d75f39861b8971d3e8';
if (sha256(DAR_CATALOG_CONTRACT) !== DAR_CATALOG_CONTRACT_SHA256) {
    throw new ParkDarProductionPlanError('park_dar_pinned_catalog_contract_digest_invalid');
}

function text(value) {
    return String(value == null ? '' : value).trim();
}

function requiredText(value, code) {
    const result = text(value);
    if (!result) throw new ParkDarProductionPlanError(code);
    return result;
}

function assertStrictKeys(value, allowed, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ParkDarProductionPlanError(code);
    }
    const unknown = Object.keys(value).filter(key => !allowed.includes(key));
    if (unknown.length) throw new ParkDarProductionPlanError(`${code}_unknown_field`);
}

function assertNoSecretFields(value) {
    if (Array.isArray(value)) {
        value.forEach(assertNoSecretFields);
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
        const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^a-z0-9_]/gi, '_');
        if (FORBIDDEN_MANIFEST_KEY.test(normalizedKey) && !/(?:ref|reference)$/i.test(key)) {
            throw new ParkDarProductionPlanError('park_dar_manifest_secret_field_forbidden');
        }
        assertNoSecretFields(nested);
    }
}

function assertUnique(values, code) {
    if (new Set(values).size !== values.length) throw new ParkDarProductionPlanError(code);
}

function validateManifest(input) {
    assertNoSecretFields(input);
    assertStrictKeys(input, [
        'schemaVersion', 'release', 'legalEntity', 'providerOrganizationId', 'profiles',
        'locations', 'registers', 'bindings', 'routes', 'catalogMembership', 'admissionMappings',
        'migrationDigests', 'schemaContractSha256'
    ], 'park_dar_manifest');
    if (input.schemaVersion !== 1) throw new ParkDarProductionPlanError('park_dar_manifest_version_invalid');

    assertStrictKeys(input.release, [
        'blockId', 'expectedLiveSha', 'branch', 'project', 'environment', 'service'
    ], 'park_dar_manifest_release');
    const release = {
        blockId: requiredText(input.release.blockId, 'park_dar_manifest_block_id_required'),
        expectedLiveSha: requiredText(input.release.expectedLiveSha, 'park_dar_manifest_live_sha_required').toLowerCase(),
        branch: requiredText(input.release.branch, 'park_dar_manifest_branch_required'),
        project: requiredText(input.release.project, 'park_dar_manifest_project_required'),
        environment: requiredText(input.release.environment, 'park_dar_manifest_environment_required'),
        service: requiredText(input.release.service, 'park_dar_manifest_service_required')
    };
    if (!SHA_RE.test(release.expectedLiveSha)) throw new ParkDarProductionPlanError('park_dar_manifest_live_sha_invalid');
    for (const key of ['branch', 'project', 'environment', 'service']) {
        if (release[key] !== RELEASE_TARGET[key]) throw new ParkDarProductionPlanError('park_dar_manifest_release_target_mismatch');
    }

    assertStrictKeys(input.legalEntity, ['key', 'name', 'taxIdentifier'], 'park_dar_manifest_legal_entity');
    const legalEntity = {
        key: requiredText(input.legalEntity.key, 'park_dar_manifest_legal_entity_key_required'),
        name: requiredText(input.legalEntity.name, 'park_dar_manifest_legal_entity_name_required'),
        taxIdentifier: text(input.legalEntity.taxIdentifier) || null
    };
    if (!SAFE_KEY_RE.test(legalEntity.key)) throw new ParkDarProductionPlanError('park_dar_manifest_legal_entity_key_invalid');
    const providerOrganizationId = requiredText(input.providerOrganizationId, 'park_dar_manifest_provider_organization_required');
    const schemaContractSha256 = requiredText(
        input.schemaContractSha256,
        'park_dar_manifest_schema_contract_digest_required'
    ).toLowerCase();
    if (!HASH_RE.test(schemaContractSha256)) {
        throw new ParkDarProductionPlanError('park_dar_manifest_schema_contract_digest_invalid');
    }

    if (!Array.isArray(input.profiles) || input.profiles.length !== EXPECTED_COUNTS.profiles) {
        throw new ParkDarProductionPlanError('park_dar_manifest_profile_count_invalid');
    }
    const profiles = input.profiles.map(item => {
        assertStrictKeys(item, ['key'], 'park_dar_manifest_profile');
        return { key: requiredText(item.key, 'park_dar_manifest_profile_key_required') };
    });
    assertUnique(profiles.map(item => item.key), 'park_dar_manifest_profile_duplicate');
    if (stableJson(profiles.map(item => item.key).sort()) !== stableJson(['dar', 'event_genix'])) {
        throw new ParkDarProductionPlanError('park_dar_manifest_profile_set_invalid');
    }

    if (!Array.isArray(input.locations) || input.locations.length !== EXPECTED_COUNTS.locations) {
        throw new ParkDarProductionPlanError('park_dar_manifest_location_count_invalid');
    }
    const locations = input.locations.map(item => {
        assertStrictKeys(item, ['key', 'profileKey', 'alias', 'displayName', 'providerOutletId'], 'park_dar_manifest_location');
        const normalized = {
            key: requiredText(item.key, 'park_dar_manifest_location_key_required'),
            profileKey: requiredText(item.profileKey, 'park_dar_manifest_location_profile_required'),
            alias: requiredText(item.alias, 'park_dar_manifest_location_alias_required'),
            displayName: requiredText(item.displayName, 'park_dar_manifest_location_name_required'),
            providerOutletId: text(item.providerOutletId) || null
        };
        if (![normalized.key, normalized.profileKey, normalized.alias].every(value => SAFE_KEY_RE.test(value))) {
            throw new ParkDarProductionPlanError('park_dar_manifest_location_key_invalid');
        }
        return normalized;
    });
    assertUnique(locations.map(item => item.key), 'park_dar_manifest_location_duplicate');
    assertUnique(locations.map(item => `${item.profileKey}:${item.alias}`), 'park_dar_manifest_location_scope_duplicate');
    const locationByKey = new Map(locations.map(item => [item.key, item]));
    for (const expected of [
        ['park_production', 'event_genix', 'park'],
        ['dar_production', 'dar', 'dar']
    ]) {
        const location = locationByKey.get(expected[0]);
        if (!location || location.profileKey !== expected[1] || location.alias !== expected[2]) {
            throw new ParkDarProductionPlanError('park_dar_manifest_location_scope_invalid');
        }
    }
    const sharedLocation = locationByKey.get('shared_test');
    if (!sharedLocation || sharedLocation.profileKey !== 'event_genix') {
        throw new ParkDarProductionPlanError('park_dar_manifest_shared_location_invalid');
    }

    if (!Array.isArray(input.registers) || input.registers.length !== EXPECTED_COUNTS.registers) {
        throw new ParkDarProductionPlanError('park_dar_manifest_register_count_invalid');
    }
    const registers = input.registers.map(item => {
        assertStrictKeys(item, [
            'key', 'profileKey', 'locationKey', 'alias', 'displayName', 'providerRegisterId',
            'credentialRef', 'expectedIsTest', 'integrationOwnerUserId'
        ], 'park_dar_manifest_register');
        const normalized = {
            key: requiredText(item.key, 'park_dar_manifest_register_key_required'),
            profileKey: requiredText(item.profileKey, 'park_dar_manifest_register_profile_required'),
            locationKey: requiredText(item.locationKey, 'park_dar_manifest_register_location_required'),
            alias: requiredText(item.alias, 'park_dar_manifest_register_alias_required'),
            displayName: requiredText(item.displayName, 'park_dar_manifest_register_name_required'),
            providerRegisterId: requiredText(item.providerRegisterId, 'park_dar_manifest_provider_register_required'),
            credentialRef: requiredText(item.credentialRef, 'park_dar_manifest_register_credential_ref_required'),
            expectedIsTest: item.expectedIsTest,
            integrationOwnerUserId: Number(item.integrationOwnerUserId)
        };
        if (![normalized.key, normalized.profileKey, normalized.alias].every(value => SAFE_KEY_RE.test(value))) {
            throw new ParkDarProductionPlanError('park_dar_manifest_register_key_invalid');
        }
        if (typeof normalized.expectedIsTest !== 'boolean') throw new ParkDarProductionPlanError('park_dar_manifest_register_mode_required');
        if (!Number.isSafeInteger(normalized.integrationOwnerUserId) || normalized.integrationOwnerUserId <= 0) {
            throw new ParkDarProductionPlanError('park_dar_manifest_register_integration_owner_invalid');
        }
        return normalized;
    });
    assertUnique(registers.map(item => item.key), 'park_dar_manifest_register_duplicate');
    assertUnique(registers.map(item => item.providerRegisterId), 'park_dar_manifest_provider_register_duplicate');
    assertUnique(registers.map(item => `${item.profileKey}:${item.alias}`), 'park_dar_manifest_register_scope_duplicate');
    const registerByKey = new Map(registers.map(item => [item.key, item]));
    const expectedRegisters = {
        park_production: ['event_genix', 'park_production', 'middle', false],
        dar_production: ['dar', 'dar_production', 'dar', false],
        shared_test: ['event_genix', 'shared_test', null, true]
    };
    for (const [key, expected] of Object.entries(expectedRegisters)) {
        const register = registerByKey.get(key);
        if (!register || register.profileKey !== expected[0] || register.locationKey !== expected[1]
            || (expected[2] && register.alias !== expected[2]) || register.expectedIsTest !== expected[3]) {
            throw new ParkDarProductionPlanError('park_dar_manifest_register_scope_invalid');
        }
        if (register.credentialRef !== REQUIRED_CREDENTIAL_REFS[key].register) {
            throw new ParkDarProductionPlanError('park_dar_manifest_register_credential_ref_invalid');
        }
    }

    if (!Array.isArray(input.bindings) || input.bindings.length !== EXPECTED_COUNTS.bindings) {
        throw new ParkDarProductionPlanError('park_dar_manifest_binding_count_invalid');
    }
    const bindings = input.bindings.map(item => {
        assertStrictKeys(item, [
            'key', 'registerKey', 'userId', 'providerCashierId', 'credentialRef',
            'displayName', 'cashierLogin', 'capabilities'
        ], 'park_dar_manifest_binding');
        if (!Number.isSafeInteger(Number(item.userId)) || Number(item.userId) <= 0) {
            throw new ParkDarProductionPlanError('park_dar_manifest_binding_user_invalid');
        }
        if (!Array.isArray(item.capabilities) || !item.capabilities.length || item.capabilities.some(value => !SAFE_KEY_RE.test(text(value).replace(/\./g, '_')))) {
            throw new ParkDarProductionPlanError('park_dar_manifest_binding_capabilities_invalid');
        }
        assertUnique(item.capabilities.map(text), 'park_dar_manifest_binding_capability_duplicate');
        return {
            key: requiredText(item.key, 'park_dar_manifest_binding_key_required'),
            registerKey: requiredText(item.registerKey, 'park_dar_manifest_binding_register_required'),
            userId: Number(item.userId),
            providerCashierId: requiredText(item.providerCashierId, 'park_dar_manifest_provider_cashier_required'),
            credentialRef: requiredText(item.credentialRef, 'park_dar_manifest_cashier_credential_ref_required'),
            displayName: requiredText(item.displayName, 'park_dar_manifest_cashier_name_required'),
            cashierLogin: requiredText(item.cashierLogin, 'park_dar_manifest_cashier_login_required'),
            capabilities: [...new Set(item.capabilities.map(text))].sort()
        };
    });
    assertUnique(bindings.map(item => item.key), 'park_dar_manifest_binding_duplicate');
    assertUnique(bindings.map(item => item.providerCashierId), 'park_dar_manifest_provider_cashier_duplicate');
    for (const key of ['park_production', 'dar_production', 'shared_test']) {
        const binding = bindings.find(item => item.key === key);
        const register = registerByKey.get(key);
        if (!binding || binding.registerKey !== key || binding.credentialRef !== REQUIRED_CREDENTIAL_REFS[key].cashier
            || binding.userId !== register?.integrationOwnerUserId) {
            throw new ParkDarProductionPlanError('park_dar_manifest_binding_scope_invalid');
        }
        if (stableJson(binding.capabilities) !== stableJson(REQUIRED_BINDING_CAPABILITIES)) {
            throw new ParkDarProductionPlanError('park_dar_manifest_binding_capability_set_invalid');
        }
    }

    if (!Array.isArray(input.routes) || input.routes.length !== EXPECTED_COUNTS.routes) {
        throw new ParkDarProductionPlanError('park_dar_manifest_route_count_invalid');
    }
    const routes = input.routes.map(item => {
        assertStrictKeys(item, ['optionId', 'businessContext', 'registerKey', 'mode', 'expectedIsTest', 'sharedRegisterGroup'], 'park_dar_manifest_route');
        return {
            optionId: requiredText(item.optionId, 'park_dar_manifest_route_id_required'),
            businessContext: requiredText(item.businessContext, 'park_dar_manifest_route_business_required'),
            registerKey: requiredText(item.registerKey, 'park_dar_manifest_route_register_required'),
            mode: requiredText(item.mode, 'park_dar_manifest_route_mode_required'),
            expectedIsTest: item.expectedIsTest,
            sharedRegisterGroup: text(item.sharedRegisterGroup) || null
        };
    });
    assertUnique(routes.map(item => item.optionId), 'park_dar_manifest_route_duplicate');
    const expectedRoutes = {
        park_production: ['event_genix', 'park_production', 'production', false, null],
        dar_production: ['dar', 'dar_production', 'production', false, null],
        park_test: ['event_genix', 'shared_test', 'test', true, 'checkbox_single_test_register'],
        dar_test: ['dar', 'shared_test', 'test', true, 'checkbox_single_test_register']
    };
    for (const [optionId, expected] of Object.entries(expectedRoutes)) {
        const route = routes.find(item => item.optionId === optionId);
        if (!route || stableJson([
            route.businessContext, route.registerKey, route.mode, route.expectedIsTest, route.sharedRegisterGroup
        ]) !== stableJson(expected)) {
            throw new ParkDarProductionPlanError('park_dar_manifest_route_scope_invalid');
        }
    }

    assertStrictKeys(input.catalogMembership, ['event_genix', 'dar'], 'park_dar_manifest_catalog_membership');
    const catalogMembership = {};
    for (const [businessContext, expectedCount] of [['event_genix', 140], ['dar', 21]]) {
        const item = input.catalogMembership[businessContext];
        const allowedKeys = businessContext === 'dar'
            ? ['expectedCount', 'itemCodesSha256', 'productPriceContractSha256']
            : ['expectedCount', 'itemCodesSha256'];
        assertStrictKeys(item, allowedKeys, 'park_dar_manifest_catalog');
        if (Number(item.expectedCount) !== expectedCount || !HASH_RE.test(text(item.itemCodesSha256))) {
            throw new ParkDarProductionPlanError('park_dar_manifest_catalog_membership_invalid');
        }
        catalogMembership[businessContext] = {
            expectedCount,
            itemCodesSha256: text(item.itemCodesSha256)
        };
        if (businessContext === 'dar') {
            const contractDigest = text(item.productPriceContractSha256);
            if (!HASH_RE.test(contractDigest)) {
                throw new ParkDarProductionPlanError('park_dar_manifest_dar_product_price_contract_digest_invalid');
            }
            if (contractDigest !== DAR_CATALOG_CONTRACT_SHA256) {
                throw new ParkDarProductionPlanError('park_dar_manifest_dar_product_price_contract_digest_mismatch');
            }
            catalogMembership.dar.productPriceContractSha256 = contractDigest;
        }
    }

    if (!Array.isArray(input.admissionMappings) || input.admissionMappings.length !== 6) {
        throw new ParkDarProductionPlanError('park_dar_manifest_admission_count_invalid');
    }
    const admissionMappings = input.admissionMappings.map(item => {
        assertStrictKeys(item, ['itemCode', 'fiscalItemName'], 'park_dar_manifest_admission');
        return {
            itemCode: requiredText(item.itemCode, 'park_dar_manifest_admission_code_required'),
            fiscalItemName: requiredText(item.fiscalItemName, 'park_dar_manifest_admission_name_required')
        };
    }).sort((left, right) => left.itemCode.localeCompare(right.itemCode));
    assertUnique(admissionMappings.map(item => item.itemCode), 'park_dar_manifest_admission_duplicate');

    assertStrictKeys(input.migrationDigests, REQUIRED_MIGRATIONS, 'park_dar_manifest_migration_digests');
    const migrationDigests = {};
    for (const version of REQUIRED_MIGRATIONS) {
        const digest = text(input.migrationDigests[version]).toLowerCase();
        if (!HASH_RE.test(digest)) throw new ParkDarProductionPlanError('park_dar_manifest_migration_digest_invalid');
        migrationDigests[version] = digest;
    }

    return {
        schemaVersion: 1,
        release,
        legalEntity,
        providerOrganizationId,
        profiles: profiles.sort((left, right) => left.key.localeCompare(right.key)),
        locations: locations.sort((left, right) => left.key.localeCompare(right.key)),
        registers: registers.sort((left, right) => left.key.localeCompare(right.key)),
        bindings: bindings.sort((left, right) => left.key.localeCompare(right.key)),
        routes: routes.sort((left, right) => left.optionId.localeCompare(right.optionId)),
        catalogMembership,
        admissionMappings,
        migrationDigests,
        schemaContractSha256
    };
}

function validateAttestation(input, { now = Date.now() } = {}) {
    assertNoSecretFields(input);
    assertStrictKeys(input, [
        'schemaVersion', 'source', 'audience', 'origin', 'blockId', 'nonce', 'manifestSha256',
        'observedAt', 'expiresAt', 'liveSha', 'branch', 'project', 'environment',
        'service', 'runtimeIdentitySha256', 'databaseFingerprintSha256', 'globalGates'
    ], 'park_dar_attestation');
    if (input.schemaVersion !== 2
        || input.source !== PRODUCTION_ATTESTATION_SOURCE
        || input.audience !== PRODUCTION_ATTESTATION_AUDIENCE
        || input.origin !== PRODUCTION_ORIGIN) {
        throw new ParkDarProductionPlanError('park_dar_attestation_source_invalid');
    }
    const observedAt = Date.parse(input.observedAt);
    const expiresAt = Date.parse(input.expiresAt);
    if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt)
        || observedAt > now + ATTESTATION_CLOCK_SKEW_MS || expiresAt < now || expiresAt <= observedAt
        || expiresAt - observedAt > ATTESTATION_TTL_MS) {
        throw new ParkDarProductionPlanError('park_dar_attestation_expired_or_invalid');
    }
    const result = {
        schemaVersion: 2,
        source: input.source,
        audience: input.audience,
        origin: input.origin,
        blockId: requiredText(input.blockId, 'park_dar_attestation_block_id_required'),
        nonce: requiredText(input.nonce, 'park_dar_attestation_nonce_required').toLowerCase(),
        manifestSha256: requiredText(input.manifestSha256, 'park_dar_attestation_manifest_hash_required').toLowerCase(),
        observedAt: new Date(observedAt).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        liveSha: requiredText(input.liveSha, 'park_dar_attestation_live_sha_required').toLowerCase(),
        branch: requiredText(input.branch, 'park_dar_attestation_branch_required'),
        project: requiredText(input.project, 'park_dar_attestation_project_required'),
        environment: requiredText(input.environment, 'park_dar_attestation_environment_required'),
        service: requiredText(input.service, 'park_dar_attestation_service_required'),
        runtimeIdentitySha256: requiredText(input.runtimeIdentitySha256, 'park_dar_attestation_runtime_identity_required').toLowerCase(),
        databaseFingerprintSha256: requiredText(input.databaseFingerprintSha256, 'park_dar_attestation_database_fingerprint_required').toLowerCase(),
        globalGates: {}
    };
    if (!SHA_RE.test(result.liveSha) || !HASH_RE.test(result.runtimeIdentitySha256)
        || result.runtimeIdentitySha256 !== PRODUCTION_RUNTIME_IDENTITY_SHA256
        || !HASH_RE.test(result.databaseFingerprintSha256)
        || !HASH_RE.test(result.manifestSha256) || !UUID_RE.test(result.nonce)) {
        throw new ParkDarProductionPlanError('park_dar_attestation_identity_invalid');
    }
    for (const key of ['branch', 'project', 'environment', 'service']) {
        if (result[key] !== RELEASE_TARGET[key]) throw new ParkDarProductionPlanError('park_dar_attestation_release_target_mismatch');
    }
    assertStrictKeys(input.globalGates, GLOBAL_GATE_NAMES, 'park_dar_attestation_global_gates');
    for (const name of GLOBAL_GATE_NAMES) {
        if (input.globalGates[name] !== false) throw new ParkDarProductionPlanError('park_dar_attestation_global_gate_enabled');
        result.globalGates[name] = false;
    }
    return result;
}

function authenticatedAttestationFromEnvelope(envelope) {
    if (!envelope || envelope[AUTHENTICATED_ATTESTATION] !== true) {
        throw new ParkDarProductionPlanError('park_dar_attestation_transport_untrusted');
    }
    return envelope.value;
}

async function fetchProductionAttestation({
    manifest: input,
    manifestSha256,
    fetchImpl = globalThis.fetch,
    nonce = crypto.randomUUID(),
    now,
    clock = Date.now,
    env = process.env
} = {}) {
    const manifest = validateManifest(input);
    const manifestHash = text(manifestSha256).toLowerCase();
    const normalizedNonce = text(nonce).toLowerCase();
    if (!HASH_RE.test(manifestHash) || !UUID_RE.test(normalizedNonce)) {
        throw new ParkDarProductionPlanError('park_dar_attestation_challenge_invalid');
    }
    if (typeof fetchImpl !== 'function') {
        throw new ParkDarProductionPlanError('park_dar_attestation_fetch_unavailable');
    }
    if (text(env.NODE_TLS_REJECT_UNAUTHORIZED) === '0') {
        throw new ParkDarProductionPlanError('park_dar_attestation_insecure_tls_runtime');
    }
    const target = new URL(PRODUCTION_ATTESTATION_PATH, PRODUCTION_ORIGIN);
    target.searchParams.set(PRODUCTION_ATTESTATION_MARKER_PARAM, '1');
    target.searchParams.set('blockId', manifest.release.blockId);
    target.searchParams.set('manifestSha256', manifestHash);
    target.searchParams.set('nonce', normalizedNonce);
    let response;
    try {
        response = await fetchImpl(target, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.timeout(ATTESTATION_TIMEOUT_MS)
        });
    } catch {
        throw new ParkDarProductionPlanError('park_dar_attestation_https_fetch_failed');
    }
    if (!response?.ok || response.redirected === true || text(response.url) !== target.href) {
        throw new ParkDarProductionPlanError('park_dar_attestation_https_response_invalid');
    }
    const contentType = text(response.headers?.get?.('content-type')).toLowerCase();
    if (!contentType.startsWith('application/json')) {
        throw new ParkDarProductionPlanError('park_dar_attestation_content_type_invalid');
    }
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_ATTESTATION_BYTES) {
        throw new ParkDarProductionPlanError('park_dar_attestation_body_too_large');
    }
    let raw;
    try {
        raw = await response.text();
    } catch {
        throw new ParkDarProductionPlanError('park_dar_attestation_body_invalid');
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_ATTESTATION_BYTES) {
        throw new ParkDarProductionPlanError('park_dar_attestation_body_too_large');
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new ParkDarProductionPlanError('park_dar_attestation_body_invalid');
    }
    const validationNow = Number.isFinite(now) ? now : Number(clock());
    if (!Number.isFinite(validationNow)) {
        throw new ParkDarProductionPlanError('park_dar_attestation_clock_invalid');
    }
    const attestation = validateAttestation(parsed, { now: validationNow });
    if (attestation.blockId !== manifest.release.blockId
        || attestation.manifestSha256 !== manifestHash
        || attestation.nonce !== normalizedNonce) {
        throw new ParkDarProductionPlanError('park_dar_attestation_challenge_mismatch');
    }
    const authenticatedValue = Object.freeze({
        ...attestation,
        globalGates: Object.freeze({ ...attestation.globalGates })
    });
    return Object.freeze({
        value: authenticatedValue,
        origin: PRODUCTION_ORIGIN,
        [AUTHENTICATED_ATTESTATION]: true
    });
}

function requiredDatabaseUrl(env = process.env) {
    const value = text(env[READONLY_DATABASE_ENV]);
    if (!value) {
        throw new ParkDarProductionPlanError('park_dar_production_readonly_database_url_required');
    }
    return value;
}

function isLoopbackHost(hostname) {
    const normalized = text(hostname).toLowerCase().replace(/^\[|\]$/g, '');
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function parseDatabaseUrl(databaseUrl) {
    try {
        const parsed = new URL(databaseUrl);
        if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
        if (parsed.hash) {
            throw new ParkDarProductionPlanError('park_dar_production_database_url_fragment_forbidden');
        }
        for (const key of parsed.searchParams.keys()) {
            if (key !== 'sslmode') {
                throw new ParkDarProductionPlanError(
                    key === 'options'
                        ? 'park_dar_production_database_url_options_forbidden'
                        : 'park_dar_production_database_url_parameter_forbidden'
                );
            }
        }
        const sslModes = parsed.searchParams.getAll('sslmode');
        if (sslModes.length > 1) {
            throw new ParkDarProductionPlanError('park_dar_production_database_sslmode_unsafe');
        }
        const sslMode = text(sslModes[0]).toLowerCase();
        if (sslMode && sslMode !== 'verify-full') {
            throw new ParkDarProductionPlanError('park_dar_production_database_sslmode_unsafe');
        }
        return parsed;
    } catch (error) {
        if (error instanceof ParkDarProductionPlanError) throw error;
        throw new ParkDarProductionPlanError('park_dar_production_readonly_database_url_invalid');
    }
}

function decodeDatabaseUrlComponent(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        throw new ParkDarProductionPlanError('park_dar_production_readonly_database_url_invalid');
    }
}

function databasePoolConfig(env = process.env, databaseUrl = requiredDatabaseUrl(env)) {
    const parsed = parseDatabaseUrl(databaseUrl);
    const database = decodeDatabaseUrlComponent(parsed.pathname.replace(/^\/+/, ''));
    const host = text(parsed.hostname).replace(/^\[|\]$/g, '');
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : 5432;
    if (!host || !database || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ParkDarProductionPlanError('park_dar_production_readonly_database_url_invalid');
    }
    return {
        host,
        port,
        database,
        user: decodeDatabaseUrlComponent(parsed.username),
        password: decodeDatabaseUrlComponent(parsed.password),
        ssl: sslConfig(env, databaseUrl)
    };
}

function sslConfig(env = process.env, databaseUrl = requiredDatabaseUrl(env)) {
    const value = text(env[READONLY_SSL_ENV]).toLowerCase();
    if (!['true', 'false'].includes(value)) {
        throw new ParkDarProductionPlanError('park_dar_production_database_ssl_required');
    }
    const parsed = parseDatabaseUrl(databaseUrl);
    const loopback = isLoopbackHost(parsed.hostname);
    if (value === 'false') {
        if (!loopback) throw new ParkDarProductionPlanError('park_dar_production_database_ssl_required_for_remote');
        return false;
    }
    const result = { rejectUnauthorized: true };
    const caFile = text(env[READONLY_SSL_CA_FILE_ENV]);
    if (caFile) {
        if (!fs.existsSync(caFile)) throw new ParkDarProductionPlanError('park_dar_production_database_ssl_ca_missing');
        result.ca = fs.readFileSync(caFile, 'utf8');
    }
    return result;
}

function loadMigrationDigests(root = path.resolve(__dirname, '..', '..')) {
    return REQUIRED_MIGRATIONS.map(version => {
        const filePath = path.join(root, 'db', 'migrations', `${version}.sql`);
        if (!fs.existsSync(filePath)) throw new ParkDarProductionPlanError('park_dar_required_migration_file_missing');
        return { version, sha256: sha256(fs.readFileSync(filePath)) };
    });
}

function migrationDigestMap(entries) {
    return Object.fromEntries(entries.map(item => [item.version, item.sha256]));
}

function numericMigrationHead(versions = []) {
    const numeric = versions
        .map(version => Number.parseInt(text(version).split('_', 1)[0], 10))
        .filter(Number.isSafeInteger);
    return numeric.length ? Math.max(...numeric) : null;
}

function unexpectedProtectedMigrations(versions = []) {
    return versions.filter(version => {
        const normalized = text(version);
        const match = normalized.match(/^(\d+)(?:_|$)/);
        if (!match) return false;
        const number = Number.parseInt(match[1], 10);
        return number >= 346 && number <= 351 && !REQUIRED_MIGRATIONS.includes(normalized);
    });
}

function databaseFingerprint(row = {}) {
    try {
        return databaseTargetFingerprint(row);
    } catch {
        throw new ParkDarProductionPlanError('park_dar_database_identity_incomplete');
    }
}

async function loadSchemaContract(client) {
    const result = await client.query(`
        WITH target_columns(table_name, column_name) AS (
            VALUES
                ('products', 'sale_config'),
                ('fiscal_cashier_bindings', 'cashier_name'),
                ('fiscal_cashier_bindings', 'cashier_login'),
                ('payment_orders', 'selected_fiscal_cashier_binding_id'),
                ('fiscal_registers', 'acceptance_enabled'),
                ('fiscal_shifts', 'business_context'),
                ('fiscal_item_mappings', 'business_context'),
                ('payment_orders', 'fiscal_sale_route_option_id'),
                ('payment_orders', 'business_context')
        ), column_contract AS (
            SELECT 'column'::text AS kind,
                   columns.table_name || '.' || columns.column_name AS name,
                   jsonb_build_object(
                       'data_type', columns.data_type,
                       'udt_name', columns.udt_name,
                       'is_nullable', columns.is_nullable,
                       'column_default', columns.column_default
                   )::text AS definition
              FROM information_schema.columns columns
             WHERE columns.table_schema = 'public'
               AND (
                    columns.table_name IN ('sales_discount_rules', 'fiscal_sale_routes')
                    OR (columns.table_name, columns.column_name) IN (
                        SELECT target_columns.table_name, target_columns.column_name FROM target_columns
                    )
               )
        ), constraint_contract AS (
            SELECT 'constraint'::text AS kind,
                   constraint_record.conname::text AS name,
                   pg_catalog.pg_get_constraintdef(constraint_record.oid, TRUE) AS definition
              FROM pg_catalog.pg_constraint constraint_record
              JOIN pg_catalog.pg_class relation ON relation.oid = constraint_record.conrelid
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname = 'public'
               AND constraint_record.conname ~ '_v(346|348|349|350|351)$'
        ), index_contract AS (
            SELECT 'index'::text AS kind, index_record.indexname::text AS name,
                   index_record.indexdef::text AS definition
              FROM pg_catalog.pg_indexes index_record
             WHERE index_record.schemaname = 'public'
               AND index_record.indexname IN (
                   'uq_fiscal_cashier_bindings_exact_order_scope_v349',
                   'idx_fiscal_sale_routes_register_v351'
               )
        ), trigger_contract AS (
            SELECT 'trigger'::text AS kind, trigger_record.tgname::text AS name,
                   pg_catalog.pg_get_triggerdef(trigger_record.oid, TRUE) AS definition
              FROM pg_catalog.pg_trigger trigger_record
              JOIN pg_catalog.pg_class relation ON relation.oid = trigger_record.tgrelid
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname = 'public'
               AND NOT trigger_record.tgisinternal
               AND trigger_record.tgname IN (
                   'trg_payment_order_selected_cashier_binding_update_v349',
                   'trg_payment_order_fiscal_sale_route_update_v351'
               )
        ), function_contract AS (
            SELECT 'function'::text AS kind, procedure_record.proname::text AS name,
                   pg_catalog.pg_get_functiondef(procedure_record.oid) AS definition
              FROM pg_catalog.pg_proc procedure_record
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure_record.pronamespace
             WHERE namespace.nspname = 'public'
               AND procedure_record.proname IN (
                   'prevent_payment_order_selected_cashier_binding_update_v349',
                   'prevent_payment_order_fiscal_sale_route_update_v351'
               )
        )
        SELECT kind, name, definition FROM column_contract
        UNION ALL SELECT kind, name, definition FROM constraint_contract
        UNION ALL SELECT kind, name, definition FROM index_contract
        UNION ALL SELECT kind, name, definition FROM trigger_contract
        UNION ALL SELECT kind, name, definition FROM function_contract
        ORDER BY kind, name, definition
    `);
    return result.rows.map(row => ({
        kind: text(row.kind),
        name: text(row.name),
        definition: text(row.definition)
    }));
}

function assertProcessGlobalGatesDisabled(env = process.env) {
    for (const name of GLOBAL_GATE_NAMES) {
        const value = text(env[name]).toLowerCase();
        if (value && value !== 'false') {
            throw new ParkDarProductionPlanError('park_dar_process_global_gate_enabled');
        }
    }
    return true;
}

function countActions(items = []) {
    const result = { insert: 0, update: 0, noOp: 0, conflict: 0 };
    for (const item of items) result[item.action] += 1;
    return result;
}

function compareRecord(desired, current, key, identityFields, mutableFields) {
    if (!current) return { entityKey: key, action: 'insert', desired };
    const identityMismatch = identityFields.some(field => stableJson(current[field] ?? null) !== stableJson(desired[field] ?? null));
    if (identityMismatch) return { entityKey: key, action: 'conflict', desired, current };
    const mutableMismatch = mutableFields.some(field => stableJson(current[field] ?? null) !== stableJson(desired[field] ?? null));
    return { entityKey: key, action: mutableMismatch ? 'update' : 'noOp', desired, current };
}

function classifyRecords(desired, current, keyFn, identityFields, mutableFields) {
    const currentByKey = new Map();
    const results = [];
    for (const item of current) {
        const key = keyFn(item);
        if (currentByKey.has(key)) results.push({ entityKey: key, action: 'conflict', reason: 'duplicate_current_identity' });
        else currentByKey.set(key, item);
    }
    for (const item of desired) {
        const key = keyFn(item);
        results.push(compareRecord(item, currentByKey.get(key), key, identityFields, mutableFields));
        currentByKey.delete(key);
    }
    for (const key of currentByKey.keys()) results.push({ entityKey: key, action: 'conflict', reason: 'stale_current_record' });
    return results;
}

function registerKeyByScope(manifest, profileKey, locationAlias, registerAlias) {
    const location = manifest.locations.find(item => item.profileKey === profileKey && item.alias === locationAlias);
    return manifest.registers.find(item => item.profileKey === profileKey && item.locationKey === location?.key && item.alias === registerAlias)?.key || null;
}

function buildDesiredState(manifest, eligibleByBusiness) {
    const profiles = manifest.profiles.map(item => ({
        key: item.key,
        legalEntityKey: manifest.legalEntity.key,
        legalEntityName: manifest.legalEntity.name,
        taxIdentifier: manifest.legalEntity.taxIdentifier,
        providerOrganizationId: manifest.providerOrganizationId,
        provider: 'checkbox',
        currency: 'UAH',
        status: 'active'
    }));
    const locations = manifest.locations.map(item => ({
        ...item,
        status: 'active'
    }));
    const registers = manifest.registers.map(item => ({
        ...item,
        provider: 'checkbox',
        status: 'active',
        featureEnabled: true,
        acceptanceEnabled: false
    }));
    const bindings = manifest.bindings.map(item => ({
        ...item,
        status: 'active'
    }));
    const routes = manifest.routes.map(item => ({
        ...item,
        status: 'active',
        featureEnabled: true,
        acceptanceEnabled: false
    }));

    const catalogMappings = [];
    for (const route of routes) {
        const register = registers.find(item => item.key === route.registerKey);
        for (const product of eligibleByBusiness[route.businessContext]) {
            catalogMappings.push({
                registerKey: route.registerKey,
                physicalProfileKey: register.profileKey,
                businessContext: route.businessContext,
                sourceType: 'catalog_sale',
                itemType: 'catalog_sale',
                itemCode: product.itemCode,
                fiscalItemName: product.fiscalItemName,
                provider: 'checkbox',
                providerTaxId: null,
                taxCode: null,
                taxRateBps: null,
                taxMode: 'untaxed',
                status: 'active'
            });
        }
    }
    const admissionMappings = [];
    for (const registerKey of ['park_production', 'shared_test']) {
        const register = registers.find(item => item.key === registerKey);
        for (const item of manifest.admissionMappings) {
            admissionMappings.push({
                registerKey,
                physicalProfileKey: register.profileKey,
                businessContext: 'event_genix',
                sourceType: 'admission_ticket',
                itemType: 'admission_ticket',
                itemCode: item.itemCode,
                fiscalItemName: item.fiscalItemName,
                provider: 'checkbox',
                providerTaxId: null,
                taxCode: null,
                taxRateBps: null,
                taxMode: 'untaxed',
                status: 'active'
            });
        }
    }
    return { profiles, locations, registers, bindings, routes, catalogMappings, admissionMappings };
}

async function loadDatabaseState(client, manifest) {
    let queryTail = Promise.resolve();
    const serialQuery = (...args) => {
        const result = queryTail.then(() => client.query(...args));
        queryTail = result.then(() => undefined, () => undefined);
        return result;
    };
    const [profiles, locations, registers, users, bindings, routes, mappings, products, discounts, migrations, lifecycle] = await Promise.all([
        serialQuery(`SELECT crm_profile_key AS key, legal_entity_key AS "legalEntityKey", legal_entity_name AS "legalEntityName",
                             tax_identifier AS "taxIdentifier", provider_organization_id AS "providerOrganizationId",
                             provider, currency, status
                        FROM public.fiscal_profiles
                       WHERE crm_profile_key = ANY($1::text[])
                       ORDER BY crm_profile_key, id`, [manifest.profiles.map(item => item.key)]),
        serialQuery(`SELECT fp.crm_profile_key AS "profileKey", fl.location_alias AS alias,
                             fl.display_name AS "displayName", fl.provider_outlet_id AS "providerOutletId", fl.status
                        FROM public.fiscal_locations fl
                        JOIN public.fiscal_profiles fp ON fp.id=fl.fiscal_profile_id
                       WHERE fp.crm_profile_key = ANY($1::text[])
                       ORDER BY fp.crm_profile_key, fl.location_alias, fl.id`, [manifest.profiles.map(item => item.key)]),
        serialQuery(`SELECT fp.crm_profile_key AS "profileKey", fl.location_alias AS "locationAlias",
                             fr.register_alias AS alias, fr.display_name AS "displayName", fr.provider,
                             fr.provider_register_id AS "providerRegisterId", fr.provider_license_ref AS "credentialRef",
                             COALESCE(NULLIF(BTRIM(fr.metadata->>'expected_is_test'), '')::boolean,
                                      NULLIF(BTRIM(fr.metadata->>'expectedIsTest'), '')::boolean, FALSE) AS "expectedIsTest",
                             NULLIF(BTRIM(fr.metadata->>'integration_owner'), '')::bigint AS "integrationOwnerUserId",
                             fr.status, fr.feature_enabled AS "featureEnabled", fr.acceptance_enabled AS "acceptanceEnabled"
                        FROM public.fiscal_registers fr
                        JOIN public.fiscal_profiles fp ON fp.id=fr.fiscal_profile_id
                        JOIN public.fiscal_locations fl ON fl.id=fr.fiscal_location_id AND fl.fiscal_profile_id=fp.id
                       WHERE fp.crm_profile_key = ANY($1::text[])
                          OR fr.provider_register_id = ANY($2::text[])
                       ORDER BY fp.crm_profile_key, fl.location_alias, fr.register_alias, fr.id`, [
            manifest.profiles.map(item => item.key), manifest.registers.map(item => item.providerRegisterId)
        ]),
        serialQuery(`SELECT id, role, extra_roles, action_allowlist, action_denylist, is_active
                        FROM public.users
                       WHERE id = ANY($1::int[])
                       ORDER BY id`, [manifest.bindings.map(item => item.userId)]),
        serialQuery(`SELECT fp.crm_profile_key AS "profileKey", fl.location_alias AS "locationAlias",
                             fr.register_alias AS "registerAlias", fcb.user_id AS "userId",
                             fcb.provider_cashier_id AS "providerCashierId",
                             fcb.provider_cashier_login_ref AS "credentialRef", fcb.cashier_name AS "displayName",
                             fcb.cashier_login AS "cashierLogin", fcb.capability_scope AS capabilities, fcb.status
                        FROM public.fiscal_cashier_bindings fcb
                        JOIN public.fiscal_profiles fp ON fp.id=fcb.fiscal_profile_id
                        JOIN public.fiscal_registers fr ON fr.id=fcb.fiscal_register_id AND fr.fiscal_profile_id=fp.id
                        JOIN public.fiscal_locations fl ON fl.id=fr.fiscal_location_id AND fl.fiscal_profile_id=fp.id
                       WHERE fp.crm_profile_key = ANY($1::text[])
                          OR fcb.provider_cashier_id = ANY($2::text[])
                       ORDER BY fp.crm_profile_key, fr.register_alias, fcb.user_id, fcb.id`, [
            manifest.profiles.map(item => item.key), manifest.bindings.map(item => item.providerCashierId)
        ]),
        serialQuery(`SELECT fsr.route_option_id AS "optionId", fsr.business_context AS "businessContext",
                             fp.crm_profile_key AS "profileKey", fl.location_alias AS "locationAlias",
                             fr.register_alias AS "registerAlias", fsr.mode, fsr.expected_is_test AS "expectedIsTest",
                             fsr.shared_register_group AS "sharedRegisterGroup", fsr.status,
                             fsr.feature_enabled AS "featureEnabled", fsr.acceptance_enabled AS "acceptanceEnabled"
                        FROM public.fiscal_sale_routes fsr
                        JOIN public.fiscal_profiles fp ON fp.id=fsr.fiscal_profile_id
                        JOIN public.fiscal_locations fl ON fl.id=fsr.fiscal_location_id AND fl.fiscal_profile_id=fp.id
                        JOIN public.fiscal_registers fr ON fr.id=fsr.fiscal_register_id AND fr.fiscal_profile_id=fp.id
                       WHERE fsr.route_option_id = ANY($1::text[])
                          OR fp.crm_profile_key = ANY($2::text[])
                       ORDER BY fsr.route_option_id`, [
            manifest.routes.map(item => item.optionId), manifest.profiles.map(item => item.key)
        ]),
        serialQuery(`SELECT fp.crm_profile_key AS "profileKey", fl.location_alias AS "locationAlias",
                             fr.register_alias AS "registerAlias", COALESCE(fim.business_context, fim.crm_profile_key) AS "businessContext",
                             fim.source_type AS "sourceType", fim.item_type AS "itemType", fim.item_code AS "itemCode",
                             fim.fiscal_item_name AS "fiscalItemName", fim.provider, fim.provider_tax_id AS "providerTaxId",
                             fim.tax_code AS "taxCode", fim.tax_rate_bps AS "taxRateBps", fim.tax_mode AS "taxMode", fim.status
                        FROM public.fiscal_item_mappings fim
                        JOIN public.fiscal_profiles fp ON fp.id=fim.fiscal_profile_id
                        JOIN public.fiscal_registers fr ON fr.id=fim.fiscal_register_id AND fr.fiscal_profile_id=fp.id
                        JOIN public.fiscal_locations fl ON fl.id=fr.fiscal_location_id AND fl.fiscal_profile_id=fp.id
                       WHERE (fim.source_type, fim.item_type) IN (('catalog_sale','catalog_sale'),('admission_ticket','admission_ticket'))
                         AND fp.crm_profile_key = ANY($1::text[])
                       ORDER BY fp.crm_profile_key, fr.register_alias, fim.source_type, fim.item_code, fim.id`, [manifest.profiles.map(item => item.key)]),
        serialQuery(`SELECT p.id, p.business_context, p.code, p.timeline_code, p.label, p.name,
                             p.category, p.duration, p.price, p.domain, p.serving_unit, p.is_active,
                             p.availability_status, p.sale_config, p.updated_by,
                             COUNT(pr.id)::integer AS price_rule_count,
                             COUNT(pr.id) FILTER (WHERE pr.value > 0)::integer AS positive_price_rule_count,
                             COUNT(pr.id) FILTER (WHERE pr.updated_by = 'migration_347_dar_catalog')::integer AS owned_price_rule_count,
                             COALESCE(
                                 jsonb_agg(
                                     jsonb_build_object(
                                         'code', pr.code,
                                         'name', pr.name,
                                         'value', pr.value,
                                         'unit', pr.unit,
                                         'category', pr.category,
                                         'description', pr.description,
                                         'productId', pr.product_id,
                                         'updatedBy', pr.updated_by
                                     ) ORDER BY pr.id
                                 ) FILTER (WHERE pr.id IS NOT NULL),
                                 '[]'::jsonb
                             ) AS price_rules
                        FROM public.products p
                        LEFT JOIN public.price_rules pr ON pr.product_id=p.id
                       WHERE p.business_context IN ('event_genix','dar')
                       GROUP BY p.id
                       ORDER BY p.business_context, p.id`),
        serialQuery(`SELECT business_context, code, rate_bps, eligibility_mode, is_active
                        FROM public.sales_discount_rules
                       WHERE business_context = 'dar'
                          OR code = ANY($1::text[])
                       ORDER BY business_context, code`, [[
            'dar_ubd_20', 'dar_second_club_direction_10'
        ]]),
        serialQuery(`SELECT version FROM public.schema_migrations ORDER BY version`),
        serialQuery(`WITH target_registers AS (
                          SELECT id, fiscal_profile_id
                            FROM public.fiscal_registers
                           WHERE provider = 'checkbox'
                             AND provider_register_id = ANY($1::text[])
                      ), target_profiles AS (
                          SELECT DISTINCT fiscal_profile_id
                            FROM target_registers
                      ), target_jobs_resolved AS (
                          SELECT job.status,
                                 COALESCE(
                                     payment_order.fiscal_register_id,
                                     operation.fiscal_register_id,
                                     refund.fiscal_register_id,
                                     refund_order.fiscal_register_id
                                 ) AS fiscal_register_id
                            FROM public.payment_outbox_jobs job
                            LEFT JOIN public.payment_orders payment_order
                              ON payment_order.id = job.payment_order_id
                             AND payment_order.fiscal_profile_id = job.fiscal_profile_id
                            LEFT JOIN public.fiscal_operations operation
                              ON operation.id = job.fiscal_operation_id
                             AND operation.fiscal_profile_id = job.fiscal_profile_id
                            LEFT JOIN public.payment_refunds refund
                              ON refund.id = job.payment_refund_id
                             AND refund.fiscal_profile_id = job.fiscal_profile_id
                            LEFT JOIN public.payment_orders refund_order
                              ON refund_order.id = refund.payment_order_id
                             AND refund_order.fiscal_profile_id = refund.fiscal_profile_id
                           WHERE job.fiscal_profile_id IN (SELECT fiscal_profile_id FROM target_profiles)
                      ), target_jobs AS (
                          SELECT status
                            FROM target_jobs_resolved
                           WHERE fiscal_register_id IN (SELECT id FROM target_registers)
                      ), target_refunds_resolved AS (
                          SELECT refund.status,
                                 refund.money_refund_status,
                                 refund.fiscal_refund_status,
                                 refund.fiscal_register_id AS direct_register_id,
                                 original_order.fiscal_register_id AS order_register_id,
                                 refund_operation.fiscal_register_id AS operation_register_id
                            FROM public.payment_refunds refund
                            LEFT JOIN public.payment_orders original_order
                              ON original_order.id = refund.payment_order_id
                             AND original_order.fiscal_profile_id = refund.fiscal_profile_id
                            LEFT JOIN public.fiscal_operations refund_operation
                              ON refund_operation.id = refund.fiscal_operation_id
                             AND refund_operation.fiscal_profile_id = refund.fiscal_profile_id
                           WHERE refund.fiscal_profile_id IN (SELECT fiscal_profile_id FROM target_profiles)
                      ), unknown_refunds_resolved AS (
                          SELECT *
                            FROM target_refunds_resolved
                           WHERE status IN ('money_refund_unknown', 'fiscal_return_unknown')
                              OR money_refund_status = 'unknown'
                              OR fiscal_refund_status = 'unknown'
                      )
                      SELECT
                          (SELECT COUNT(*)::integer
                             FROM public.fiscal_shifts
                            WHERE fiscal_register_id IN (SELECT id FROM target_registers)
                              AND NOT (status = 'closed' AND lifecycle_stage = 'CLOSED')) AS "openShifts",
                          (SELECT COUNT(*)::integer FROM target_jobs WHERE status IN ('queued', 'claimed', 'running')) AS queued,
                          (SELECT COUNT(*)::integer FROM target_jobs WHERE status = 'failed') AS failed,
                          (SELECT COUNT(*)::integer FROM target_jobs WHERE status = 'dead') AS dead,
                          (SELECT COUNT(*)::integer
                             FROM target_jobs_resolved
                            WHERE fiscal_register_id IS NULL
                              AND status <> 'succeeded') AS "unscopableJobs",
                          (SELECT COUNT(*)::integer
                             FROM public.payment_orders
                            WHERE fiscal_register_id IN (SELECT id FROM target_registers)
                              AND (payment_status = 'unknown' OR fiscal_status = 'unknown')) AS "unknownOrders",
                          (SELECT COUNT(*)::integer
                             FROM public.fiscal_operations
                            WHERE fiscal_register_id IN (SELECT id FROM target_registers)
                              AND status = 'unknown') AS "unknownOperations",
                          (SELECT COUNT(*)::integer
                             FROM public.fiscal_receipts receipt
                             JOIN public.fiscal_operations operation
                               ON operation.id = receipt.fiscal_operation_id
                              AND operation.fiscal_profile_id = receipt.fiscal_profile_id
                            WHERE operation.fiscal_register_id IN (SELECT id FROM target_registers)
                              AND receipt.status IN ('pending', 'failed', 'unknown')) AS "unresolvedReceipts",
                          (SELECT COUNT(*)::integer
                             FROM public.payment_attempts attempt
                             JOIN public.payment_orders payment_order
                               ON payment_order.id = attempt.payment_order_id
                              AND payment_order.fiscal_profile_id = attempt.fiscal_profile_id
                            WHERE payment_order.fiscal_register_id IN (SELECT id FROM target_registers)
                              AND attempt.status = 'unknown') AS "unknownPaymentAttempts",
                          (SELECT COUNT(*)::integer
                             FROM unknown_refunds_resolved refund
                            WHERE refund.direct_register_id IN (SELECT id FROM target_registers)
                               OR refund.order_register_id IN (SELECT id FROM target_registers)
                               OR refund.operation_register_id IN (SELECT id FROM target_registers)) AS "unknownRefunds",
                          (SELECT COUNT(*)::integer
                             FROM unknown_refunds_resolved refund
                            WHERE refund.direct_register_id IS NULL
                              AND refund.order_register_id IS NULL
                              AND refund.operation_register_id IS NULL) AS "unscopableUnknownRefunds",
                          (SELECT COUNT(*)::integer
                             FROM unknown_refunds_resolved refund
                            WHERE (
                                      refund.direct_register_id IN (SELECT id FROM target_registers)
                                   OR refund.order_register_id IN (SELECT id FROM target_registers)
                                   OR refund.operation_register_id IN (SELECT id FROM target_registers)
                                  )
                              AND (
                                      (refund.direct_register_id IS NOT NULL AND refund.order_register_id IS NOT NULL
                                       AND refund.direct_register_id <> refund.order_register_id)
                                   OR (refund.direct_register_id IS NOT NULL AND refund.operation_register_id IS NOT NULL
                                       AND refund.direct_register_id <> refund.operation_register_id)
                                   OR (refund.order_register_id IS NOT NULL AND refund.operation_register_id IS NOT NULL
                                       AND refund.order_register_id <> refund.operation_register_id)
                                  )) AS "inconsistentRefundRegisterRefs"`, [manifest.registers.map(item => item.providerRegisterId)])
    ]);
    return {
        profiles: profiles.rows,
        locations: locations.rows,
        registers: registers.rows,
        bindings: bindings.rows,
        users: users.rows,
        routes: routes.rows,
        mappings: mappings.rows,
        products: products.rows,
        discounts: discounts.rows,
        migrations: migrations.rows.map(item => text(item.version)),
        lifecycle: Object.fromEntries(Object.entries(lifecycle.rows[0] || {}).map(([key, value]) => [key, Number(value || 0)]))
    };
}

function normalizeCurrentState(state, manifest) {
    const locations = state.locations.map(item => ({
        ...item,
        key: manifest.locations.find(candidate => candidate.profileKey === item.profileKey && candidate.alias === item.alias)?.key || `unmanaged:${item.profileKey}:${item.alias}`
    }));
    const registers = state.registers.map(item => ({
        ...item,
        key: registerKeyByScope(manifest, item.profileKey, item.locationAlias, item.alias) || `unmanaged:${item.profileKey}:${item.locationAlias}:${item.alias}`,
        locationKey: manifest.locations.find(candidate => candidate.profileKey === item.profileKey && candidate.alias === item.locationAlias)?.key || null,
        integrationOwnerUserId: Number(item.integrationOwnerUserId) || null
    }));
    const bindings = state.bindings.map(item => ({
        ...item,
        key: registerKeyByScope(manifest, item.profileKey, item.locationAlias, item.registerAlias) || `unmanaged:${item.profileKey}:${item.locationAlias}:${item.registerAlias}`,
        registerKey: registerKeyByScope(manifest, item.profileKey, item.locationAlias, item.registerAlias) || null,
        capabilities: [...(item.capabilities || [])].sort()
    }));
    const routes = state.routes.map(item => ({
        ...item,
        registerKey: registerKeyByScope(manifest, item.profileKey, item.locationAlias, item.registerAlias) || `unmanaged:${item.profileKey}:${item.locationAlias}:${item.registerAlias}`
    }));
    const mappings = state.mappings.map(item => ({
        ...item,
        registerKey: registerKeyByScope(manifest, item.profileKey, item.locationAlias, item.registerAlias) || `unmanaged:${item.profileKey}:${item.locationAlias}:${item.registerAlias}`,
        physicalProfileKey: item.profileKey
    }));
    return { ...state, locations, registers, bindings, routes, mappings };
}

function mappingKey(item) {
    return [item.registerKey, item.businessContext, item.sourceType, item.itemType, item.itemCode, item.provider].join('|');
}

function finiteNumberOrNull(value) {
    if (value == null || text(value) === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function jsonValue(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function normalizeDarCatalogContract(rows) {
    return (Array.isArray(rows) ? rows : [])
        .filter(row => text(row.business_context ?? row.businessContext) === 'dar')
        .map(row => {
            const rawPriceRules = jsonValue(row.price_rules ?? row.priceRules);
            const priceRules = (Array.isArray(rawPriceRules) ? rawPriceRules : []).map(rule => ({
                code: text(rule.code),
                name: text(rule.name),
                value: finiteNumberOrNull(rule.value),
                unit: text(rule.unit),
                category: text(rule.category),
                description: text(rule.description),
                productId: text(rule.productId ?? rule.product_id),
                updatedBy: text(rule.updatedBy ?? rule.updated_by)
            })).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
            const rawSaleConfig = jsonValue(row.sale_config ?? row.saleConfig);
            const saleConfig = rawSaleConfig && typeof rawSaleConfig === 'object' && !Array.isArray(rawSaleConfig)
                ? rawSaleConfig
                : null;
            return {
                product: {
                    id: text(row.id),
                    businessContext: text(row.business_context ?? row.businessContext),
                    code: text(row.code),
                    timelineCode: text(row.timeline_code ?? row.timelineCode),
                    label: text(row.label),
                    name: text(row.name),
                    category: text(row.category),
                    duration: finiteNumberOrNull(row.duration),
                    price: finiteNumberOrNull(row.price),
                    domain: text(row.domain),
                    servingUnit: text(row.serving_unit ?? row.servingUnit),
                    isActive: row.is_active !== undefined ? row.is_active === true : row.isActive === true,
                    availabilityStatus: text(row.availability_status ?? row.availabilityStatus),
                    saleConfig,
                    updatedBy: text(row.updated_by ?? row.updatedBy)
                },
                priceRules
            };
        })
        .sort((left, right) => left.product.id.localeCompare(right.product.id));
}

function planExactState(manifest, currentRaw, migrationDigests) {
    const blockers = [];
    const missingMigrations = REQUIRED_MIGRATIONS.filter(version => !currentRaw.migrations.includes(version));
    if (missingMigrations.length) blockers.push('required_migrations_missing');
    if (unexpectedProtectedMigrations(currentRaw.migrations).length) {
        blockers.push('unexpected_protected_migration_version');
    }
    const migrationHead = numericMigrationHead(currentRaw.migrations);
    if (migrationHead != null && migrationHead > 351) blockers.push('unexpected_migration_head');
    if (missingMigrations.length) {
        const beforeStateHash = sha256({ migrations: currentRaw.migrations, migrationDigests });
        return {
            ready: false,
            blockers: [...new Set(blockers)].sort(),
            beforeStateHash,
            operationsHash: sha256([]),
            counts: Object.fromEntries(Object.keys(EXPECTED_COUNTS).map(key => [key, { insert: 0, update: 0, noOp: 0, conflict: 0 }])),
            acceptance: { allDatabaseGatesFalse: false },
            catalog: { eventGenix: 0, dar: 0 },
            lifecycle: currentRaw.lifecycle || null,
            migrationHead,
            operations: []
        };
    }
    if (!HASH_RE.test(text(currentRaw.schemaContractSha256).toLowerCase())
        || text(currentRaw.schemaContractSha256).toLowerCase() !== manifest.schemaContractSha256) {
        blockers.push('schema_contract_mismatch');
    }

    const current = normalizeCurrentState(currentRaw, manifest);
    const eligibleByBusiness = {};
    for (const businessContext of ['event_genix', 'dar']) {
        const scope = businessContext === 'event_genix'
            ? { crmProfileKey: 'event_genix', requiredUpdatedBy: null }
            : { crmProfileKey: 'dar', requiredUpdatedBy: 'migration_347_dar_catalog' };
        const classified = classifyCatalogRows(current.products.filter(item => item.business_context === businessContext), scope);
        eligibleByBusiness[businessContext] = classified.eligible;
        if (businessContext === 'dar' && classified.excluded.ownershipDrift.length) {
            blockers.push('dar_catalog_ownership_drift');
        }
        const membership = manifest.catalogMembership[businessContext];
        const itemCodes = classified.eligible.map(item => item.itemCode).sort();
        if (itemCodes.length !== membership.expectedCount || sha256(itemCodes) !== membership.itemCodesSha256) {
            blockers.push(`${businessContext}_catalog_membership_mismatch`);
        }
    }
    const darOwnedRows = current.products.filter(item => (
        item.business_context === 'dar' && text(item.updated_by) === 'migration_347_dar_catalog'
    ));
    if (darOwnedRows.length !== 21) blockers.push('dar_catalog_seed_row_count_mismatch');
    if (darOwnedRows.some(item => Number(item.owned_price_rule_count || 0) !== 1)) {
        blockers.push('dar_price_rule_ownership_drift');
    }
    const actualDarContractDigest = sha256(normalizeDarCatalogContract(current.products));
    if (actualDarContractDigest !== manifest.catalogMembership.dar.productPriceContractSha256) {
        blockers.push('dar_product_price_contract_mismatch');
    }
    const expectedDiscounts = [
        { business_context: 'dar', code: 'dar_second_club_direction_10', rate_bps: 1000, eligibility_mode: 'second_club_direction', is_active: true },
        { business_context: 'dar', code: 'dar_ubd_20', rate_bps: 2000, eligibility_mode: 'explicit', is_active: true }
    ];
    const actualDiscounts = (current.discounts || []).map(item => ({
        business_context: text(item.business_context),
        code: text(item.code),
        rate_bps: Number(item.rate_bps),
        eligibility_mode: text(item.eligibility_mode),
        is_active: item.is_active === true
    })).sort((left, right) => left.code.localeCompare(right.code));
    if (stableJson(actualDiscounts) !== stableJson(expectedDiscounts)) {
        blockers.push('dar_discount_rules_mismatch');
    }
    const desired = buildDesiredState(manifest, eligibleByBusiness);

    const usersById = new Map();
    for (const user of current.users || []) {
        const userId = Number(user.id);
        if (usersById.has(userId)) blockers.push('binding_user_identity_ambiguous');
        usersById.set(userId, user);
    }
    for (const binding of desired.bindings) {
        const user = usersById.get(binding.userId);
        if (!user || user.is_active !== true) {
            blockers.push('binding_user_missing_or_inactive');
            continue;
        }
        if (binding.capabilities.some(capability => !resolveCapability(user, capability).allowed)) {
            blockers.push('binding_user_capability_denied');
        }
    }

    const operations = {
        profiles: classifyRecords(desired.profiles, current.profiles, item => item.key,
            ['legalEntityKey', 'legalEntityName', 'taxIdentifier', 'providerOrganizationId', 'provider', 'currency'], ['status']),
        locations: classifyRecords(desired.locations, current.locations, item => item.key,
            ['profileKey', 'alias', 'providerOutletId'], ['displayName', 'status']),
        registers: classifyRecords(desired.registers, current.registers, item => item.key,
            ['profileKey', 'locationKey', 'alias', 'providerRegisterId', 'credentialRef', 'provider', 'expectedIsTest', 'integrationOwnerUserId'],
            ['displayName', 'status', 'featureEnabled', 'acceptanceEnabled']),
        bindings: classifyRecords(desired.bindings, current.bindings, item => item.key,
            ['registerKey', 'userId', 'providerCashierId', 'credentialRef', 'capabilities'], ['displayName', 'cashierLogin', 'status']),
        routes: classifyRecords(desired.routes, current.routes, item => item.optionId,
            ['businessContext', 'registerKey', 'mode', 'expectedIsTest', 'sharedRegisterGroup'], ['status', 'featureEnabled', 'acceptanceEnabled']),
        catalogMappings: classifyRecords(desired.catalogMappings, current.mappings.filter(item => item.sourceType === 'catalog_sale'), mappingKey,
            ['registerKey', 'physicalProfileKey', 'businessContext', 'sourceType', 'itemType', 'itemCode', 'provider'],
            ['fiscalItemName', 'providerTaxId', 'taxCode', 'taxRateBps', 'taxMode', 'status']),
        admissionMappings: classifyRecords(desired.admissionMappings, current.mappings.filter(item => item.sourceType === 'admission_ticket'), mappingKey,
            ['registerKey', 'physicalProfileKey', 'businessContext', 'sourceType', 'itemType', 'itemCode', 'provider'],
            ['fiscalItemName', 'providerTaxId', 'taxCode', 'taxRateBps', 'taxMode', 'status'])
    };

    if (current.registers.some(item => item.acceptanceEnabled === true) || current.routes.some(item => item.acceptanceEnabled === true)) {
        blockers.push('database_acceptance_enabled');
    }
    const lifecycle = current.lifecycle || {};
    if (Number(lifecycle.openShifts || 0) > 0) blockers.push('open_fiscal_shifts_present');
    if (Number(lifecycle.queued || 0) > 0) blockers.push('queued_outbox_jobs_present');
    if (Number(lifecycle.failed || 0) > 0) blockers.push('failed_outbox_jobs_present');
    if (Number(lifecycle.dead || 0) > 0) blockers.push('dead_outbox_jobs_present');
    if (Number(lifecycle.unscopableJobs || 0) > 0) blockers.push('unscopable_outbox_jobs_present');
    if (Number(lifecycle.unknownOrders || 0) > 0) blockers.push('unknown_payment_orders_present');
    if (Number(lifecycle.unknownOperations || 0) > 0) blockers.push('unknown_fiscal_operations_present');
    if (Number(lifecycle.unresolvedReceipts || 0) > 0) blockers.push('unresolved_fiscal_receipts_present');
    if (Number(lifecycle.unknownPaymentAttempts || 0) > 0) blockers.push('unknown_payment_attempts_present');
    if (Number(lifecycle.unknownRefunds || 0) > 0) blockers.push('unknown_refunds_present');
    if (Number(lifecycle.unscopableUnknownRefunds || 0) > 0) blockers.push('unscopable_unknown_refunds_present');
    if (Number(lifecycle.inconsistentRefundRegisterRefs || 0) > 0) blockers.push('inconsistent_refund_register_refs_present');
    for (const [entity, values] of Object.entries(operations)) {
        if (values.some(item => item.action === 'conflict')) blockers.push(`${entity}_conflict`);
    }
    const sharedRoutes = desired.routes.filter(item => item.sharedRegisterGroup === 'checkbox_single_test_register');
    if (sharedRoutes.length !== 2 || new Set(sharedRoutes.map(item => item.registerKey)).size !== 1) {
        blockers.push('shared_test_register_topology_invalid');
    }
    if (desired.catalogMappings.length !== EXPECTED_COUNTS.catalogMappings
        || desired.admissionMappings.length !== EXPECTED_COUNTS.admissionMappings) {
        blockers.push('fiscal_mapping_count_invalid');
    }
    const invalidTax = [...desired.catalogMappings, ...desired.admissionMappings].some(item => (
        item.taxMode !== 'untaxed' || item.providerTaxId != null || item.taxCode != null || item.taxRateBps != null
    ));
    if (invalidTax) blockers.push('fiscal_mapping_tax_invariant_invalid');

    const flatOperations = Object.entries(operations).flatMap(([entity, values]) => values.map(item => ({ entity, ...item })));
    return {
        ready: blockers.length === 0,
        blockers: [...new Set(blockers)].sort(),
        beforeStateHash: sha256(current),
        operationsHash: sha256(flatOperations),
        counts: Object.fromEntries(Object.entries(operations).map(([key, values]) => [key, countActions(values)])),
        acceptance: {
            allDatabaseGatesFalse: !current.registers.some(item => item.acceptanceEnabled === true)
                && !current.routes.some(item => item.acceptanceEnabled === true)
        },
        catalog: {
            eventGenix: eligibleByBusiness.event_genix.length,
            dar: eligibleByBusiness.dar.length
        },
        lifecycle: {
            openShifts: Number(lifecycle.openShifts || 0),
            queued: Number(lifecycle.queued || 0),
            failed: Number(lifecycle.failed || 0),
            dead: Number(lifecycle.dead || 0),
            unscopableJobs: Number(lifecycle.unscopableJobs || 0),
            unknownOrders: Number(lifecycle.unknownOrders || 0),
            unknownOperations: Number(lifecycle.unknownOperations || 0),
            unresolvedReceipts: Number(lifecycle.unresolvedReceipts || 0),
            unknownPaymentAttempts: Number(lifecycle.unknownPaymentAttempts || 0),
            unknownRefunds: Number(lifecycle.unknownRefunds || 0),
            unscopableUnknownRefunds: Number(lifecycle.unscopableUnknownRefunds || 0),
            inconsistentRefundRegisterRefs: Number(lifecycle.inconsistentRefundRegisterRefs || 0)
        },
        migrationHead,
        operations: flatOperations
    };
}

async function proveReadOnly(client) {
    const result = await client.query(
        `SELECT current_setting('transaction_read_only') AS transaction_read_only,
                current_setting('transaction_isolation') AS transaction_isolation,
                current_database() AS database_name,
                current_user AS database_user,
                inet_server_addr()::text AS server_address,
                inet_server_port() AS server_port,
                current_setting('server_version_num') AS server_version_num,
                (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_oid,
                (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
                (SELECT datdba::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_owner_oid,
                (SELECT pg_catalog.pg_encoding_to_char(encoding) FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_encoding,
                (SELECT datcollate FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_collate,
                (SELECT datctype FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_ctype,
                has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
                has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
                COALESCE(has_table_privilege(current_user, to_regclass('public.schema_migrations'), 'INSERT'), FALSE) AS migration_insert,
                COALESCE(has_table_privilege(current_user, to_regclass('public.payment_orders'), 'INSERT'), FALSE) AS ledger_insert,
                EXISTS (
                    SELECT 1
                      FROM unnest(ARRAY[
                          'users', 'schema_migrations', 'products', 'price_rules',
                          'sales_discount_rules',
                          'fiscal_profiles', 'fiscal_locations', 'fiscal_registers',
                          'fiscal_cashier_bindings', 'fiscal_sale_routes', 'fiscal_item_mappings',
                          'fiscal_configuration_audit', 'fiscal_audit_events',
                          'payment_orders', 'payment_order_items', 'payment_allocations',
                          'payment_attempts', 'payment_refunds', 'fiscal_operations',
                          'payment_outbox_jobs', 'fiscal_shifts', 'fiscal_receipts',
                          'checkbox_readiness_snapshots', 'provider_webhook_events'
                      ]) AS protected(table_name)
                      CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS privilege(name)
                     WHERE COALESCE(
                         has_table_privilege(
                             current_user,
                             to_regclass('public.' || protected.table_name),
                             privilege.name
                         ),
                         FALSE
                     )
                ) AS protected_table_write`
    );
    const row = result.rows[0] || {};
    const ok = row.transaction_read_only === 'on'
        && row.transaction_isolation === 'repeatable read'
        && row.database_create !== true
        && row.schema_create !== true
        && row.migration_insert !== true
        && row.ledger_insert !== true
        && row.protected_table_write !== true;
    if (!ok) throw new ParkDarProductionPlanError('park_dar_database_readonly_proof_failed');
    return {
        readOnly: true,
        databaseFingerprintSha256: databaseFingerprint(row)
    };
}

async function runReadOnlyPlan({
    dbPool,
    manifest: input,
    attestationEnvelope,
    manifestFileSha256,
    expectedManifestSha256,
    migrationRoot,
    env = process.env
} = {}) {
    assertProcessGlobalGatesDisabled(env);
    const manifest = validateManifest(input);
    const attestation = validateAttestation(authenticatedAttestationFromEnvelope(attestationEnvelope));
    const desiredManifestHash = text(manifestFileSha256).toLowerCase();
    const attestationHash = sha256(attestation);
    if (!HASH_RE.test(desiredManifestHash)) throw new ParkDarProductionPlanError('park_dar_protected_file_hash_required');
    if (!HASH_RE.test(text(expectedManifestSha256).toLowerCase())
        || text(expectedManifestSha256).toLowerCase() !== desiredManifestHash) {
        throw new ParkDarProductionPlanError('park_dar_manifest_hash_mismatch');
    }
    if (attestation.manifestSha256 !== desiredManifestHash
        || attestation.blockId !== manifest.release.blockId) {
        throw new ParkDarProductionPlanError('park_dar_attestation_manifest_binding_mismatch');
    }
    if (attestation.liveSha !== manifest.release.expectedLiveSha) {
        throw new ParkDarProductionPlanError('park_dar_live_sha_attestation_mismatch');
    }
    const migrationDigests = loadMigrationDigests(migrationRoot);
    const localMigrationDigestMap = migrationDigestMap(migrationDigests);
    if (stableJson(localMigrationDigestMap) !== stableJson(manifest.migrationDigests)) {
        throw new ParkDarProductionPlanError('park_dar_migration_digest_mismatch');
    }
    const client = await dbPool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        transactionOpen = true;
        await client.query('SET LOCAL search_path = pg_catalog, public');
        const readOnlyProof = await proveReadOnly(client);
        if (readOnlyProof.databaseFingerprintSha256 !== attestation.databaseFingerprintSha256) {
            throw new ParkDarProductionPlanError('park_dar_database_fingerprint_mismatch');
        }
        const migrationResult = await client.query(
            `SELECT version FROM public.schema_migrations ORDER BY version`
        );
        const migrations = migrationResult.rows.map(item => text(item.version));
        let current;
        if (REQUIRED_MIGRATIONS.some(version => !migrations.includes(version))) {
            current = { migrations, lifecycle: null };
        } else {
            current = await loadDatabaseState(client, manifest);
            current.schemaContractSha256 = sha256(await loadSchemaContract(client));
        }
        const exactPlan = planExactState(manifest, current, migrationDigests);
        await client.query('ROLLBACK');
        transactionOpen = false;
        validateAttestation(attestation);
        const planHash = sha256({
            desiredManifestHash,
            attestationHash,
            beforeStateHash: exactPlan.beforeStateHash,
            operationsHash: exactPlan.operationsHash
        });
        return {
            mode: 'read-only',
            status: exactPlan.ready ? 'READY_TO_PLAN' : 'BLOCKED',
            ready: exactPlan.ready,
            readOnlyProof: readOnlyProof.readOnly,
            expectedLiveShaMatched: true,
            attestationTransportVerified: true,
            attestationChallengeMatched: true,
            databaseFingerprintMatched: true,
            migrationDigestsMatched: true,
            globalGatesAttestedFalse: true,
            migrationHead: exactPlan.migrationHead,
            desiredManifestHash,
            canonicalManifestHash: sha256(manifest),
            attestationHash,
            beforeStateHash: exactPlan.beforeStateHash,
            operationsHash: exactPlan.operationsHash,
            planHash,
            counts: exactPlan.counts,
            acceptance: exactPlan.acceptance,
            catalog: exactPlan.catalog,
            lifecycle: exactPlan.lifecycle,
            blockers: exactPlan.blockers
        };
    } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    DAR_CATALOG_CONTRACT,
    DAR_CATALOG_CONTRACT_SHA256,
    EXPECTED_COUNTS,
    GLOBAL_GATE_NAMES,
    ParkDarProductionPlanError,
    READONLY_DATABASE_ENV,
    READONLY_SSL_ENV,
    READONLY_SSL_CA_FILE_ENV,
    RELEASE_TARGET,
    REQUIRED_BINDING_CAPABILITIES,
    REQUIRED_CREDENTIAL_REFS,
    REQUIRED_MIGRATIONS,
    assertProcessGlobalGatesDisabled,
    buildDesiredState,
    classifyRecords,
    databaseFingerprint,
    databasePoolConfig,
    fetchProductionAttestation,
    loadDatabaseState,
    loadMigrationDigests,
    loadSchemaContract,
    migrationDigestMap,
    normalizeDarCatalogContract,
    numericMigrationHead,
    planExactState,
    proveReadOnly,
    requiredDatabaseUrl,
    runReadOnlyPlan,
    sha256,
    sslConfig,
    stableJson,
    validateAttestation,
    validateManifest,
    unexpectedProtectedMigrations
};
