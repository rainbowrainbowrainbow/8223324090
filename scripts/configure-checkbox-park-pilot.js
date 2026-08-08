#!/usr/bin/env node
'use strict';

const { pool } = require('../db');

const DEFAULT_CAPABILITIES = Object.freeze([
    'payments.view',
    'payments.create',
    'payments.confirm_received',
    'fiscal.shift.open'
]);

class PilotConfigError extends Error {
    constructor(code, message, { status = 2, details = null } = {}) {
        super(message || code);
        this.name = 'PilotConfigError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        apply: false,
        crmProfileKey: 'event_genix',
        locationAlias: 'park',
        registerAlias: 'middle',
        cashierUserIds: [],
        items: [],
        capabilities: [...DEFAULT_CAPABILITIES]
    };
    const forbidden = /password|secret|pin|token|access[-_]?key|license[-_]?key/i;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--apply') {
            options.apply = true;
            continue;
        }
        if (arg === '--dry-run') {
            options.apply = false;
            continue;
        }
        if (!arg.startsWith('--')) {
            throw new PilotConfigError('pilot_config_arg_invalid', `Unexpected argument: ${arg}`);
        }
        const name = arg.slice(2);
        if (forbidden.test(name) && !['provider-license-ref'].includes(name)) {
            throw new PilotConfigError('pilot_config_secret_arg_forbidden', `Raw secret-like argument is forbidden: ${arg}`);
        }
        const value = argv[i + 1];
        if (!value || value.startsWith('--')) {
            throw new PilotConfigError('pilot_config_arg_value_missing', `Value is required for ${arg}`);
        }
        i += 1;
        switch (name) {
            case 'legal-entity-key':
                options.legalEntityKey = value;
                break;
            case 'legal-entity-name':
                options.legalEntityName = value;
                break;
            case 'tax-identifier':
                options.taxIdentifier = value;
                break;
            case 'provider-organization-id':
                options.providerOrganizationId = value;
                break;
            case 'location-name':
                options.locationName = value;
                break;
            case 'provider-outlet-id':
                options.providerOutletId = value;
                break;
            case 'register-name':
                options.registerName = value;
                break;
            case 'provider-register-id':
                options.providerRegisterId = value;
                break;
            case 'provider-license-ref':
                options.providerLicenseRef = value;
                break;
            case 'cashier-user-id':
                options.cashierUserIds.push(Number(value));
                break;
            case 'cashier-login-ref':
                options.cashierLoginRef = value;
                break;
            case 'capabilities':
                options.capabilities = value.split(',').map(item => item.trim()).filter(Boolean);
                break;
            case 'item':
                options.items.push(parseItem(value));
                break;
            default:
                throw new PilotConfigError('pilot_config_arg_unknown', `Unknown argument: ${arg}`);
        }
    }
    return normalizePlan(options);
}

function parseItem(value) {
    const [itemCode, fiscalItemName, providerTaxId, taxCode = '', taxRateBps = ''] = String(value || '').split('|').map(item => item.trim());
    if (!itemCode || !fiscalItemName || !providerTaxId) {
        throw new PilotConfigError('pilot_config_item_invalid', 'Item mapping must be itemCode|fiscalItemName|providerTaxId|taxCode|taxRateBps');
    }
    const numericTaxCode = taxCode === '' ? null : Number(taxCode);
    const numericTaxRateBps = taxRateBps === '' ? null : Number(taxRateBps);
    if ((numericTaxCode !== null && !Number.isInteger(numericTaxCode)) || (numericTaxRateBps !== null && !Number.isInteger(numericTaxRateBps))) {
        throw new PilotConfigError('pilot_config_item_tax_invalid', 'Item taxCode and taxRateBps must be integer values when provided');
    }
    if (numericTaxRateBps !== null && (numericTaxRateBps < 0 || numericTaxRateBps > 10000)) {
        throw new PilotConfigError('pilot_config_item_tax_rate_invalid', 'Item taxRateBps must be between 0 and 10000');
    }
    return {
        itemCode,
        fiscalItemName,
        providerTaxId,
        taxCode: numericTaxCode,
        taxRateBps: numericTaxRateBps
    };
}

function requireText(value, code) {
    const text = String(value || '').trim();
    if (!text) throw new PilotConfigError(code, `${code} is required`);
    return text;
}

function normalizePlan(options) {
    if (options.crmProfileKey !== 'event_genix') {
        throw new PilotConfigError('pilot_config_profile_forbidden', 'Only event_genix park profile can be configured by this pilot tool');
    }
    if (options.registerAlias !== 'middle') {
        throw new PilotConfigError('pilot_config_register_forbidden', 'Only middle register can be configured by this pilot tool');
    }
    for (const id of options.cashierUserIds) {
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new PilotConfigError('pilot_config_cashier_user_invalid', 'cashier-user-id must be a positive integer');
        }
    }
    if (!options.items.length) {
        throw new PilotConfigError('pilot_config_items_required', 'At least one fiscal item mapping is required');
    }
    return {
        apply: Boolean(options.apply),
        crmProfileKey: 'event_genix',
        legalEntityKey: requireText(options.legalEntityKey, 'legal_entity_key'),
        legalEntityName: requireText(options.legalEntityName, 'legal_entity_name'),
        taxIdentifier: options.taxIdentifier || null,
        providerOrganizationId: options.providerOrganizationId || null,
        locationAlias: 'park',
        locationName: requireText(options.locationName, 'location_name'),
        providerOutletId: options.providerOutletId || null,
        registerAlias: 'middle',
        registerName: requireText(options.registerName, 'register_name'),
        providerRegisterId: requireText(options.providerRegisterId, 'provider_register_id'),
        providerLicenseRef: requireText(options.providerLicenseRef, 'provider_license_ref'),
        cashierUserIds: [...new Set(options.cashierUserIds)],
        cashierLoginRef: requireText(options.cashierLoginRef, 'cashier_login_ref'),
        capabilities: [...new Set(options.capabilities)],
        items: options.items
    };
}

function publicPlan(plan) {
    return {
        mode: plan.apply ? 'apply' : 'dry-run',
        crmProfileKey: plan.crmProfileKey,
        legalEntityKey: plan.legalEntityKey,
        legalEntityName: plan.legalEntityName,
        locationAlias: plan.locationAlias,
        registerAlias: plan.registerAlias,
        providerOrganizationId: plan.providerOrganizationId,
        providerOutletId: plan.providerOutletId,
        providerRegisterId: plan.providerRegisterId,
        providerLicenseRef: plan.providerLicenseRef,
        cashierUserIds: plan.cashierUserIds,
        cashierLoginRef: plan.cashierLoginRef,
        capabilities: plan.capabilities,
        itemMappings: plan.items.map(item => ({
            sourceType: 'admission_ticket',
            itemType: 'admission_ticket',
            itemCode: item.itemCode,
            fiscalItemName: item.fiscalItemName,
            providerTaxId: item.providerTaxId,
            taxCode: item.taxCode,
            taxRateBps: item.taxRateBps
        })),
        featureEnabled: false
    };
}

async function applyPlan(client, plan) {
    const profile = await client.query(
        `INSERT INTO fiscal_profiles (
             crm_profile_key, legal_entity_key, legal_entity_name, tax_identifier,
             provider, provider_organization_id, currency, status, settings
         )
         VALUES ($1, $2, $3, $4, 'checkbox', $5, 'UAH', 'active', '{}'::jsonb)
         ON CONFLICT (crm_profile_key, legal_entity_key) DO UPDATE
             SET legal_entity_name = EXCLUDED.legal_entity_name,
                 tax_identifier = EXCLUDED.tax_identifier,
                 provider_organization_id = EXCLUDED.provider_organization_id,
                 status = 'active',
                 updated_at = NOW()
         RETURNING *`,
        [plan.crmProfileKey, plan.legalEntityKey, plan.legalEntityName, plan.taxIdentifier, plan.providerOrganizationId]
    );
    const fiscalProfileId = profile.rows[0].id;

    const location = await client.query(
        `INSERT INTO fiscal_locations (
             fiscal_profile_id, crm_profile_key, location_alias, display_name, provider_outlet_id, status
         )
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (fiscal_profile_id, location_alias) DO UPDATE
             SET display_name = EXCLUDED.display_name,
                 provider_outlet_id = EXCLUDED.provider_outlet_id,
                 status = 'active',
                 updated_at = NOW()
         RETURNING *`,
        [fiscalProfileId, plan.crmProfileKey, plan.locationAlias, plan.locationName, plan.providerOutletId]
    );

    const register = await client.query(
        `INSERT INTO fiscal_registers (
             fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
             display_name, provider, provider_register_id, provider_license_ref, status, feature_enabled, metadata
         )
         VALUES ($1, $2, $3, $4, $5, 'checkbox', $6, $7, 'active', FALSE, '{}'::jsonb)
         ON CONFLICT (fiscal_profile_id, register_alias) DO UPDATE
             SET fiscal_location_id = EXCLUDED.fiscal_location_id,
                 display_name = EXCLUDED.display_name,
                 provider_register_id = EXCLUDED.provider_register_id,
                 provider_license_ref = EXCLUDED.provider_license_ref,
                 status = 'active',
                 feature_enabled = FALSE,
                 updated_at = NOW()
         RETURNING *`,
        [fiscalProfileId, location.rows[0].id, plan.crmProfileKey, plan.registerAlias, plan.registerName, plan.providerRegisterId, plan.providerLicenseRef]
    );
    const fiscalRegisterId = register.rows[0].id;

    for (const userId of plan.cashierUserIds) {
        await client.query(
            `INSERT INTO fiscal_cashier_bindings (
                 fiscal_profile_id, fiscal_register_id, fiscal_location_id, user_id,
                 provider, provider_cashier_login_ref, capability_scope, status
             )
             VALUES ($1, $2, $3, $4, 'checkbox', $5, $6::text[], 'active')
             ON CONFLICT (fiscal_profile_id, fiscal_register_id, user_id) DO UPDATE
                 SET fiscal_location_id = EXCLUDED.fiscal_location_id,
                     provider_cashier_login_ref = EXCLUDED.provider_cashier_login_ref,
                     capability_scope = EXCLUDED.capability_scope,
                     status = 'active',
                     updated_at = NOW()`,
            [fiscalProfileId, fiscalRegisterId, location.rows[0].id, userId, plan.cashierLoginRef, plan.capabilities]
        );
    }

    for (const item of plan.items) {
        await client.query(
            `INSERT INTO fiscal_item_mappings (
                 fiscal_profile_id, fiscal_register_id, crm_profile_key, source_type, item_type,
                 item_code, fiscal_item_name, provider, provider_tax_id, tax_code, tax_rate_bps, status
             )
             VALUES ($1, $2, $3, 'admission_ticket', 'admission_ticket', $4, $5, 'checkbox', $6, $7, $8, 'active')
             ON CONFLICT (fiscal_profile_id, fiscal_register_id, source_type, item_type, item_code, provider) DO UPDATE
                 SET fiscal_item_name = EXCLUDED.fiscal_item_name,
                     provider_tax_id = EXCLUDED.provider_tax_id,
                     tax_code = EXCLUDED.tax_code,
                     tax_rate_bps = EXCLUDED.tax_rate_bps,
                     status = 'active',
                     updated_at = NOW()`,
            [fiscalProfileId, fiscalRegisterId, plan.crmProfileKey, item.itemCode, item.fiscalItemName, item.providerTaxId, item.taxCode, item.taxRateBps]
        );
    }

    return { fiscalProfileId: Number(fiscalProfileId), fiscalRegisterId: Number(fiscalRegisterId), featureEnabled: false };
}

async function run(argv = process.argv.slice(2), { env = process.env, dbPool = pool } = {}) {
    const plan = parseArgs(argv);
    if (!plan.apply) return { applied: false, plan: publicPlan(plan) };
    if (String(env.EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY || '').toLowerCase() !== 'true') {
        throw new PilotConfigError('pilot_config_apply_not_allowed', 'Set EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY=true to apply pilot configuration');
    }
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        const result = await applyPlan(client, plan);
        await client.query('COMMIT');
        return { applied: true, ...result, plan: publicPlan(plan) };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    run()
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
            return pool.end();
        })
        .catch(async error => {
            console.error(JSON.stringify({ success: false, code: error.code || 'pilot_config_failed', error: error.message }, null, 2));
            await pool.end().catch(() => {});
            process.exit(error.status || 1);
        });
}

module.exports = {
    DEFAULT_CAPABILITIES,
    PilotConfigError,
    applyPlan,
    normalizePlan,
    parseArgs,
    parseItem,
    publicPlan,
    run
};
