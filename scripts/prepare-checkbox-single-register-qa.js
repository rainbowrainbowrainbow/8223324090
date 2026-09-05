#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { RESET_CONFIRMATION, assertSafeTestDatabaseUrl } = require('./test-db-safety');
const {
    APPLY_CONFIRM_ENV,
    applyCatalogSaleMappings,
    buildSafeDryRun,
    planCatalogSaleMappings
} = require('../services/payments/catalogSaleMappingConfigurator');

const SETUP_CONFIRM_ENV = 'EVENTGENIX_ALLOW_SINGLE_REGISTER_QA_SETUP';
const OWNER = 'PARK-DAR-SINGLE-TEST-REGISTER-LOCAL';
const ALLOWED_CONTEXTS = new Set(['event_genix', 'dar']);
const SENSITIVE_KEY = /(?:password|pin|secret|access[_-]?key|license[_-]?key|device[_-]?credential)/i;

class SingleRegisterQaError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'SingleRegisterQaError';
        this.code = code;
    }
}

function parseArgs(argv = process.argv.slice(2)) {
    const result = { mode: 'verify', businessContext: '', configFile: '', outputConfigFile: '' };
    for (const arg of argv) {
        if (['apply', 'verify'].includes(arg)) result.mode = arg;
        else if (arg.startsWith('--business-context=')) result.businessContext = arg.slice('--business-context='.length).trim();
        else if (arg.startsWith('--config-file=')) result.configFile = path.resolve(arg.slice('--config-file='.length).trim());
        else if (arg.startsWith('--output-config-file=')) result.outputConfigFile = path.resolve(arg.slice('--output-config-file='.length).trim());
        else throw new SingleRegisterQaError('single_register_cli_invalid', 'Use apply|verify with --business-context and --config-file');
    }
    if (!ALLOWED_CONTEXTS.has(result.businessContext)) {
        throw new SingleRegisterQaError('single_register_context_invalid', 'Business context must be event_genix or dar');
    }
    if (!result.configFile) throw new SingleRegisterQaError('single_register_config_required', '--config-file is required');
    return result;
}

function assertSecretFree(value, trail = []) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertSecretFree(item, [...trail, String(index)]));
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
        if (SENSITIVE_KEY.test(key) && !/(?:ref|reference)$/i.test(key)) {
            throw new SingleRegisterQaError('single_register_secret_key_forbidden', `Secret-bearing config key is forbidden at ${[...trail, key].join('.')}`);
        }
        assertSecretFree(nested, [...trail, key]);
    }
}

function requiredText(value, code) {
    const text = String(value || '').trim();
    if (!text) throw new SingleRegisterQaError(code, `${code} is required`);
    return text;
}

function parseJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function deriveConfig(base, businessContext) {
    assertSecretFree(base);
    if (base.expectedIsTest !== true) {
        throw new SingleRegisterQaError('single_register_test_identity_required', 'Config must declare expectedIsTest=true');
    }
    for (const [value, code] of [
        [base.providerOrganizationId, 'provider_organization_identity_required'],
        [base.providerRegisterId, 'provider_register_identity_required'],
        [base.providerCashierId, 'provider_cashier_identity_required'],
        [base.registerCredentialRef, 'register_credential_reference_required'],
        [base.cashierCredentialRef, 'cashier_credential_reference_required']
    ]) requiredText(value, code);

    if (businessContext === 'event_genix') {
        if (base.crmProfileKey !== 'event_genix' || base.locationAlias !== 'park' || base.registerAlias !== 'middle') {
            throw new SingleRegisterQaError('single_register_park_scope_mismatch', 'PARK config scope must be event_genix / park / middle');
        }
        if (!Array.isArray(base.items) || base.items.length !== 6) {
            throw new SingleRegisterQaError('single_register_admission_mapping_count', 'PARK config must contain exactly six admission-ticket mappings');
        }
        return { ...base, qaOwner: OWNER, sequentialBusinessContext: businessContext };
    }

    return {
        ...base,
        crmProfileKey: 'dar',
        locationAlias: 'dar',
        registerAlias: 'dar',
        registerDisplayName: 'Каса ДАР',
        priceSource: 'products_price_rules',
        items: [],
        qaOwner: OWNER,
        sequentialBusinessContext: businessContext,
        identityVerification: {
            status: 'confirmed',
            source: 'read_only_checkbox_preflight',
            reuseMode: 'single_physical_test_register_sequential_only'
        }
    };
}

function readConfig(filePath, businessContext) {
    if (!fs.existsSync(filePath)) throw new SingleRegisterQaError('single_register_config_missing', 'Config file does not exist');
    const parsed = parseJsonFile(filePath);
    const source = parsed.crmProfileKey === 'dar' ? parsed : deriveConfig(parsed, businessContext);
    const config = businessContext === 'dar' && source.crmProfileKey !== 'dar'
        ? deriveConfig(source, businessContext)
        : source;
    assertSecretFree(config);
    if (config.expectedIsTest !== true) throw new SingleRegisterQaError('single_register_test_mode_required', 'Only confirmed test-mode config is allowed');
    return config;
}

function localTarget(env = process.env) {
    const disposableName = String(env.EVENTGENIX_DISPOSABLE_DB_NAME || '').trim();
    if (!env.TEST_DATABASE_URL && disposableName && !/^eventgenix_(?:park|dar)_single_register_test_\d{8}$/.test(disposableName)) {
        throw new SingleRegisterQaError('single_register_database_name_invalid', 'Disposable database name does not match the single-register QA ownership pattern');
    }
    const databaseUrl = env.TEST_DATABASE_URL || (disposableName
        ? `postgresql://postgres@127.0.0.1:${Number(env.EVENTGENIX_LOCAL_PG_PROXY_PORT || 55443)}/${disposableName}`
        : '');
    const target = assertSafeTestDatabaseUrl(databaseUrl, {
        ...env,
        TEST_DATABASE_RESET_CONFIRM: RESET_CONFIRMATION
    });
    if (!target.isLocal) throw new SingleRegisterQaError('single_register_local_database_required', 'A loopback disposable PostgreSQL database is required');
    return target;
}

function acceptanceDisabled(env = process.env) {
    return !['true', '1', 'yes', 'on'].includes(String(env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED || '').trim().toLowerCase());
}

async function initializeDatabase(target) {
    process.env.DATABASE_URL = '';
    process.env.PGHOST = target.url.hostname;
    process.env.PGPORT = target.url.port || '5432';
    process.env.PGDATABASE = target.url.pathname.replace(/^\//, '');
    process.env.PGUSER = decodeURIComponent(target.url.username || 'postgres');
    process.env.NODE_ENV = 'test';
    const { pool, initDatabase } = require('../db');
    const { runMigrations } = require('../db/migrate');
    await initDatabase();
    const first = await runMigrations(pool);
    await initDatabase();
    const second = await runMigrations(pool);
    return { pool, firstApplied: first, secondApplied: second };
}

function qaUserKey(context) {
    return context === 'event_genix' ? 'park_single_register_qa' : 'dar_single_register_qa';
}

async function upsertLocalTarget(client, config, businessContext) {
    const scope = businessContext === 'event_genix'
        ? { profile: 'event_genix', location: 'park', register: 'middle', displayName: 'Середня каса' }
        : { profile: 'dar', location: 'dar', register: 'dar', displayName: 'Каса ДАР' };
    const userKey = qaUserKey(businessContext);
    const userResult = await client.query(
        `INSERT INTO users (username, password_hash, role, name, is_active)
         VALUES ($1, 'DISABLED_LOCAL_QA_ACCOUNT', 'animator', $2, TRUE)
         ON CONFLICT (username) DO UPDATE SET is_active = TRUE
         RETURNING id`,
        [userKey, `Local ${businessContext === 'event_genix' ? 'PARK' : 'DAR'} QA cashier`]
    );
    const userId = Number(userResult.rows[0].id);
    const profileResult = await client.query(
        `INSERT INTO fiscal_profiles (
             crm_profile_key, legal_entity_key, legal_entity_name, tax_identifier,
             provider, provider_organization_id, currency, status, settings
         ) VALUES ($1,$2,$3,$4,'checkbox',$5,'UAH','active',$6::jsonb)
         ON CONFLICT (crm_profile_key, legal_entity_key) DO UPDATE SET
             provider_organization_id=EXCLUDED.provider_organization_id,
             status='active', settings=EXCLUDED.settings, updated_at=NOW()
         RETURNING id`,
        [scope.profile, config.legalEntityKey, config.legalEntityName, config.taxIdentifier || null,
            config.providerOrganizationId, JSON.stringify({ qa_owner: OWNER, expected_is_test: true })]
    );
    const profileId = Number(profileResult.rows[0].id);
    const locationResult = await client.query(
        `INSERT INTO fiscal_locations (
             fiscal_profile_id, crm_profile_key, location_alias, display_name, provider_outlet_id, status
         ) VALUES ($1,$2,$3,$4,$5,'active')
         ON CONFLICT (fiscal_profile_id, location_alias) DO UPDATE SET
             display_name=EXCLUDED.display_name, provider_outlet_id=EXCLUDED.provider_outlet_id,
             status='active', updated_at=NOW()
         RETURNING id`,
        [profileId, scope.profile, scope.location, scope.displayName, config.providerOutletId || null]
    );
    const locationId = Number(locationResult.rows[0].id);
    const registerResult = await client.query(
        `INSERT INTO fiscal_registers (
             fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias, display_name,
             provider, provider_register_id, provider_license_ref, status, feature_enabled, metadata
         ) VALUES ($1,$2,$3,$4,$5,'checkbox',$6,$7,'active',TRUE,$8::jsonb)
         ON CONFLICT (fiscal_profile_id, register_alias) DO UPDATE SET
             fiscal_location_id=EXCLUDED.fiscal_location_id,
             provider_register_id=EXCLUDED.provider_register_id,
             provider_license_ref=EXCLUDED.provider_license_ref,
             status='active', feature_enabled=TRUE, metadata=EXCLUDED.metadata, updated_at=NOW()
         RETURNING id`,
        [profileId, locationId, scope.profile, scope.register, scope.displayName,
            config.providerRegisterId, config.registerCredentialRef,
            JSON.stringify({ qa_owner: OWNER, expected_is_test: true, sequential_only: true })]
    );
    const registerId = Number(registerResult.rows[0].id);
    const routeOptionId = businessContext === 'event_genix' ? 'park_test' : 'dar_test';
    await client.query(
        `INSERT INTO fiscal_sale_routes (
             route_option_id, business_context, fiscal_profile_id, fiscal_location_id,
             fiscal_register_id, mode, expected_is_test, status, feature_enabled,
             acceptance_enabled, shared_register_group, metadata
         ) VALUES ($1,$2,$3,$4,$5,'test',TRUE,'active',TRUE,FALSE,'checkbox_single_test_register',$6::jsonb)
         ON CONFLICT (route_option_id) DO UPDATE SET
             business_context=EXCLUDED.business_context,
             fiscal_profile_id=EXCLUDED.fiscal_profile_id,
             fiscal_location_id=EXCLUDED.fiscal_location_id,
             fiscal_register_id=EXCLUDED.fiscal_register_id,
             mode='test', expected_is_test=TRUE, status='active', feature_enabled=TRUE,
             acceptance_enabled=FALSE,
             shared_register_group='checkbox_single_test_register',
             metadata=EXCLUDED.metadata, updated_at=NOW()`,
        [routeOptionId, businessContext, profileId, locationId, registerId, JSON.stringify({ qa_owner: OWNER })]
    );
    await client.query(
        `INSERT INTO fiscal_cashier_bindings (
             fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key, user_id,
             provider, provider_cashier_id, provider_cashier_login_ref, capability_scope,
             status, cashier_name, cashier_login
         ) VALUES ($1,$2,$3,$4,$5,'checkbox',$6,$7,$8::text[],'active',$9,NULL)
         ON CONFLICT (fiscal_profile_id, fiscal_register_id, user_id) DO UPDATE SET
             fiscal_location_id=EXCLUDED.fiscal_location_id,
             crm_profile_key=EXCLUDED.crm_profile_key,
             provider_cashier_id=EXCLUDED.provider_cashier_id,
             provider_cashier_login_ref=EXCLUDED.provider_cashier_login_ref,
             capability_scope=EXCLUDED.capability_scope,
             status='active', cashier_name=EXCLUDED.cashier_name, cashier_login=NULL, updated_at=NOW()`,
        [profileId, registerId, locationId, scope.profile, userId,
            config.providerCashierId, config.cashierCredentialRef,
            ['payments.view', 'payments.create', 'payments.confirm_received', 'fiscal.shift.open', 'fiscal.shift.close'],
            'Confirmed test cashier']
    );

    if (businessContext === 'event_genix') {
        for (const item of config.items) {
            if (item.taxMode !== 'untaxed' || item.providerTaxId != null || item.taxCode != null || item.taxRateBps != null) {
                throw new SingleRegisterQaError('single_register_admission_tax_mismatch', 'All PARK admission mappings must be untaxed with null provider tax fields');
            }
            await client.query(
                `INSERT INTO fiscal_item_mappings (
                     fiscal_profile_id, fiscal_register_id, crm_profile_key, business_context, source_type, item_type,
                     item_code, fiscal_item_name, provider, provider_tax_id, tax_code, tax_rate_bps, tax_mode, status
                 ) VALUES ($1,$2,$3,$3,'admission_ticket','admission_ticket',$4,$5,'checkbox',NULL,NULL,NULL,'untaxed','active')
                 ON CONFLICT (fiscal_profile_id, fiscal_register_id, source_type, item_type, item_code, provider)
                 DO UPDATE SET fiscal_item_name=EXCLUDED.fiscal_item_name, provider_tax_id=NULL,
                     tax_code=NULL, tax_rate_bps=NULL, tax_mode='untaxed', status='active', updated_at=NOW()`,
                [profileId, registerId, scope.profile, item.itemCode, item.fiscalItemName]
            );
        }
    }
}

async function verifyDatabase(client, config, businessContext, migrationRuns = null) {
    const mappingOptions = { routeOptionIds: [businessContext === 'event_genix' ? 'park_test' : 'dar_test'] };
    const mapping = buildSafeDryRun(await planCatalogSaleMappings(client, mappingOptions));
    const counts = await client.query(
        `SELECT
            COUNT(*) FILTER (WHERE fim.source_type='catalog_sale' AND fim.status='active')::integer AS catalog_count,
            COUNT(*) FILTER (WHERE fim.source_type='admission_ticket' AND fim.status='active')::integer AS admission_count,
            COUNT(*) FILTER (WHERE fim.status='active' AND (fim.tax_mode <> 'untaxed' OR fim.provider_tax_id IS NOT NULL OR fim.tax_code IS NOT NULL OR fim.tax_rate_bps IS NOT NULL))::integer AS tax_violations,
            COUNT(DISTINCT fr.id)::integer AS register_count,
            COUNT(DISTINCT fr.provider_register_id)::integer AS provider_register_count,
            COUNT(DISTINCT fcb.id) FILTER (WHERE fcb.status='active' AND NULLIF(BTRIM(fcb.provider_cashier_login_ref),'') IS NOT NULL)::integer AS binding_count
         FROM fiscal_profiles fp
         JOIN fiscal_registers fr ON fr.fiscal_profile_id=fp.id
         LEFT JOIN fiscal_item_mappings fim ON fim.fiscal_profile_id=fp.id AND fim.fiscal_register_id=fr.id
         LEFT JOIN fiscal_cashier_bindings fcb ON fcb.fiscal_profile_id=fp.id AND fcb.fiscal_register_id=fr.id
         WHERE fp.crm_profile_key=$1 AND fr.register_alias=$2`,
        [businessContext, businessContext === 'event_genix' ? 'middle' : 'dar']
    );
    const queue = await client.query(
        `SELECT
            COUNT(*) FILTER (WHERE status='queued')::integer AS queued,
            COUNT(*) FILTER (WHERE status='failed')::integer AS failed,
            COUNT(*) FILTER (WHERE status='dead')::integer AS dead
         FROM payment_outbox_jobs`
    );
    const unknown = await client.query(
        `SELECT
            (SELECT COUNT(*) FROM payment_orders WHERE payment_status='unknown' OR fiscal_status='unknown')::integer
            + (SELECT COUNT(*) FROM fiscal_operations WHERE status='unknown')::integer AS unknown`
    );
    const discounts = await client.query(
        `SELECT COUNT(*)::integer AS count FROM sales_discount_rules
          WHERE business_context=$1 AND is_active=TRUE`,
        [businessContext]
    );
    const row = counts.rows[0];
    const queueRow = queue.rows[0];
    const expectedCatalog = businessContext === 'event_genix' ? 140 : 21;
    const expectedAdmission = businessContext === 'event_genix' ? 6 : 0;
    const expectedDiscounts = businessContext === 'dar' ? 2 : 0;
    const ready = mapping.ready
        && Number(row.catalog_count) === expectedCatalog
        && Number(row.admission_count) === expectedAdmission
        && Number(row.tax_violations) === 0
        && Number(row.register_count) === 1
        && Number(row.provider_register_count) === 1
        && Number(row.binding_count) === 1
        && Number(discounts.rows[0].count) === expectedDiscounts
        && Object.values(queueRow).every(value => Number(value) === 0)
        && Number(unknown.rows[0].unknown) === 0
        && config.expectedIsTest === true;
    return {
        ready,
        businessContext,
        scope: businessContext === 'event_genix' ? 'event_genix / park / middle' : 'dar / dar / dar',
        physicalRegisterMode: 'single_test_register_sequential_only',
        acceptanceEnabled: false,
        shiftOpened: false,
        receiptsCreated: 0,
        migrations: migrationRuns ? {
            firstRunIncluded346To351: ['346_catalog_sale_foundation', '347_dar_catalog_2026_2027', '348_fiscal_cashier_admin_metadata', '349_payment_order_selected_fiscal_cashier_binding', '350_fiscal_register_route_acceptance', '351_fiscal_sale_routes']
                .every(version => migrationRuns.firstApplied.includes(version)),
            secondRunAppliedCount: migrationRuns.secondApplied.length
        } : undefined,
        mappings: {
            catalogSale: Number(row.catalog_count),
            admissionTicket: Number(row.admission_count),
            untaxedViolations: Number(row.tax_violations)
        },
        activeConfiguredBindings: Number(row.binding_count),
        activeDiscountRules: Number(discounts.rows[0].count),
        registerCollision: Number(row.register_count) !== 1 || Number(row.provider_register_count) !== 1,
        queues: { ...queueRow, unknown: Number(unknown.rows[0].unknown) }
    };
}

async function run({ argv = process.argv.slice(2), env = process.env } = {}) {
    const options = parseArgs(argv);
    if (!acceptanceDisabled(env)) throw new SingleRegisterQaError('single_register_acceptance_must_be_false', 'Checkbox payment acceptance must remain disabled');
    if (options.mode === 'apply' && String(env[SETUP_CONFIRM_ENV] || '').trim().toLowerCase() !== 'true') {
        throw new SingleRegisterQaError('single_register_apply_not_authorized', `Set ${SETUP_CONFIRM_ENV}=true only for this authorized local setup`);
    }
    const target = localTarget(env);
    const base = parseJsonFile(options.configFile);
    const config = deriveConfig(base, options.businessContext);
    if (options.outputConfigFile) {
        if (options.businessContext !== 'dar') throw new SingleRegisterQaError('single_register_output_config_dar_only', 'Derived config output is supported only for DAR');
        fs.writeFileSync(options.outputConfigFile, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }

    let pool;
    let migrationRuns = null;
    if (options.mode === 'apply') {
        const initialized = await initializeDatabase(target);
        pool = initialized.pool;
        migrationRuns = initialized;
    } else {
        pool = new Pool({ connectionString: target.url.toString(), ssl: false, max: 2 });
    }

    const client = await pool.connect();
    try {
        if (options.mode === 'apply') {
            await client.query('BEGIN');
            try {
                await upsertLocalTarget(client, config, options.businessContext);
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK').catch(() => {});
                throw error;
            }
            await applyCatalogSaleMappings(client, { ...env, [APPLY_CONFIRM_ENV]: 'true' }, {
                routeOptionIds: [options.businessContext === 'event_genix' ? 'park_test' : 'dar_test']
            });
        }
        return await verifyDatabase(client, config, options.businessContext, migrationRuns);
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    run().then(result => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }).catch(error => {
        process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'single_register_qa_failed', message: error.message })}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    OWNER,
    SETUP_CONFIRM_ENV,
    SingleRegisterQaError,
    acceptanceDisabled,
    assertSecretFree,
    deriveConfig,
    localTarget,
    parseArgs,
    run,
    verifyDatabase
};
