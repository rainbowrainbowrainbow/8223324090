#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { pool } = require('../db');
const { BUSINESS_CONTEXTS } = require('../services/businessContext');
const { resolveCapability } = require('../services/accountAccessPolicy');

const CRM_PROFILE_KEY = 'event_genix';
const LOCATION_ALIAS = 'park';
const REGISTER_ALIAS = 'middle';
const PROVIDER = 'checkbox';
const SOURCE_TYPE = 'admission_ticket';
const ITEM_TYPE = 'admission_ticket';
const APPLY_CONFIRM_ENV = 'EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY';
const APPLY_CONFIRM_VALUE = 'true';
const ACTION_PIN_ENV = 'CHECKBOX_PILOT_ACTION_PIN';

const MODES = Object.freeze([
    'dry-run',
    'preflight',
    'apply',
    'status',
    'enable-register',
    'disable-register'
]);

const DEFAULT_CAPABILITIES = Object.freeze([
    'payments.view',
    'payments.create',
    'payments.confirm_received',
    'fiscal.shift.open'
]);

const PIN_REQUIRED_CAPABILITIES = Object.freeze([
    'fiscal.service_out.approve',
    'fiscal.refund',
    'fiscal.reconcile',
    'fiscal.configure'
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
        mode: 'dry-run',
        crmProfileKey: CRM_PROFILE_KEY,
        locationAlias: LOCATION_ALIAS,
        registerAlias: REGISTER_ALIAS,
        cashierUserIds: [],
        items: [],
        capabilities: [...DEFAULT_CAPABILITIES]
    };
    const forbidden = /password|secret|pin|token|access[-_]?key|license[-_]?key/i;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (MODES.includes(arg)) {
            options.mode = arg;
            continue;
        }
        if (arg === '--apply') {
            options.mode = 'apply';
            continue;
        }
        if (arg === '--dry-run') {
            options.mode = 'dry-run';
            continue;
        }
        if (arg === '--preflight') {
            options.mode = 'preflight';
            continue;
        }
        if (arg === '--status') {
            options.mode = 'status';
            continue;
        }
        if (arg === '--enable-register') {
            options.mode = 'enable-register';
            continue;
        }
        if (arg === '--disable-register') {
            options.mode = 'disable-register';
            continue;
        }
        if (!arg.startsWith('--')) {
            throw new PilotConfigError('pilot_config_arg_invalid', `Unexpected argument: ${arg}`);
        }
        const name = arg.slice(2);
        if (forbidden.test(name) && !['provider-license-ref', 'cashier-login-ref'].includes(name)) {
            throw new PilotConfigError('pilot_config_secret_arg_forbidden', `Raw secret-like argument is forbidden: ${arg}`);
        }
        const value = argv[i + 1];
        if (!value || value.startsWith('--')) {
            throw new PilotConfigError('pilot_config_arg_value_missing', `Value is required for ${arg}`);
        }
        i += 1;
        switch (name) {
            case 'mode':
                options.mode = value;
                break;
            case 'crm-profile':
                options.crmProfileKey = value;
                break;
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
            case 'register-credential-ref':
                options.providerLicenseRef = value;
                break;
            case 'cashier-user-id':
                options.cashierUserIds.push(Number(value));
                break;
            case 'provider-cashier-id':
                options.providerCashierId = value;
                break;
            case 'cashier-login-ref':
            case 'cashier-credential-ref':
                options.cashierLoginRef = value;
                break;
            case 'integration-owner':
                options.integrationOwner = value;
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

function optionalText(value) {
    const text = String(value || '').trim();
    return text || null;
}

function needsFullPlan(mode) {
    return ['dry-run', 'preflight', 'apply', 'enable-register'].includes(mode);
}

function normalizeRef(value, code) {
    const ref = requireText(value, code);
    if (!/^[A-Za-z0-9_:-]+$/.test(ref)) {
        throw new PilotConfigError('pilot_config_credential_ref_invalid', `${code} must contain only letters, digits, underscore, colon or dash`);
    }
    return ref;
}

function normalizePlan(options) {
    if (!MODES.includes(options.mode)) {
        throw new PilotConfigError('pilot_config_mode_invalid', `Mode must be one of: ${MODES.join(', ')}`);
    }
    if (options.crmProfileKey !== CRM_PROFILE_KEY) {
        throw new PilotConfigError('pilot_config_profile_forbidden', 'Only event_genix park profile can be configured by this pilot tool');
    }
    if (options.locationAlias !== LOCATION_ALIAS) {
        throw new PilotConfigError('pilot_config_location_forbidden', 'Only park location can be configured by this pilot tool');
    }
    if (options.registerAlias !== REGISTER_ALIAS) {
        throw new PilotConfigError('pilot_config_register_forbidden', 'Only middle register can be configured by this pilot tool');
    }
    const cashierUserIds = [...new Set(options.cashierUserIds)];
    for (const id of cashierUserIds) {
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new PilotConfigError('pilot_config_cashier_user_invalid', 'cashier-user-id must be a positive integer');
        }
    }
    const capabilities = [...new Set(options.capabilities)];
    if (!capabilities.length) throw new PilotConfigError('pilot_config_capabilities_required', 'At least one capability is required');

    const full = needsFullPlan(options.mode);
    const plan = {
        mode: options.mode,
        apply: options.mode === 'apply',
        crmProfileKey: CRM_PROFILE_KEY,
        legalEntityKey: requireText(options.legalEntityKey, 'legal_entity_key'),
        locationAlias: LOCATION_ALIAS,
        registerAlias: REGISTER_ALIAS,
        cashierUserIds,
        capabilities
    };
    if (!full) return plan;
    if (!cashierUserIds.length) {
        throw new PilotConfigError('pilot_config_cashier_users_required', 'At least one exact cashier-user-id is required');
    }
    if (!options.items.length) {
        throw new PilotConfigError('pilot_config_items_required', 'At least one fiscal item mapping is required');
    }
    return {
        ...plan,
        legalEntityName: requireText(options.legalEntityName, 'legal_entity_name'),
        taxIdentifier: requireText(options.taxIdentifier, 'tax_identifier'),
        providerOrganizationId: requireText(options.providerOrganizationId, 'provider_organization_id'),
        locationName: requireText(options.locationName, 'location_name'),
        providerOutletId: requireText(options.providerOutletId, 'provider_outlet_id'),
        registerName: requireText(options.registerName, 'register_name'),
        providerRegisterId: requireText(options.providerRegisterId, 'provider_register_id'),
        providerLicenseRef: normalizeRef(options.providerLicenseRef, 'provider_license_ref'),
        providerCashierId: requireText(options.providerCashierId, 'provider_cashier_id'),
        cashierLoginRef: normalizeRef(options.cashierLoginRef, 'cashier_login_ref'),
        integrationOwner: requireText(options.integrationOwner, 'integration_owner'),
        items: options.items
    };
}

function requiresActionPin(capabilities = []) {
    return capabilities.some(capability => PIN_REQUIRED_CAPABILITIES.includes(capability));
}

function actionPinHash(env, capabilities) {
    if (!requiresActionPin(capabilities)) return null;
    const rawPin = String(env[ACTION_PIN_ENV] || '');
    if (!rawPin.trim()) {
        throw new PilotConfigError('pilot_config_action_pin_env_missing', `${ACTION_PIN_ENV} is required only for future approval/PRO bindings`);
    }
    const salt = crypto.randomBytes(16).toString('base64url');
    const hash = crypto.scryptSync(rawPin, salt, 64).toString('base64url');
    return `scrypt$${salt}$${hash}`;
}

function publicPlan(plan) {
    return {
        mode: plan.mode,
        crmProfileKey: plan.crmProfileKey,
        legalEntityKey: plan.legalEntityKey,
        legalEntityName: plan.legalEntityName || null,
        taxIdentifierConfigured: Boolean(plan.taxIdentifier),
        locationAlias: plan.locationAlias,
        registerAlias: plan.registerAlias,
        providerOrganizationId: plan.providerOrganizationId || null,
        providerOutletId: plan.providerOutletId || null,
        providerRegisterId: plan.providerRegisterId || null,
        providerLicenseRef: plan.providerLicenseRef || null,
        providerCashierId: plan.providerCashierId || null,
        cashierUserIds: plan.cashierUserIds,
        cashierLoginRef: plan.cashierLoginRef || null,
        integrationOwner: plan.integrationOwner || null,
        capabilities: plan.capabilities,
        actionPinRequired: requiresActionPin(plan.capabilities),
        itemMappings: (plan.items || []).map(item => ({
            sourceType: SOURCE_TYPE,
            itemType: ITEM_TYPE,
            itemCode: item.itemCode,
            fiscalItemName: item.fiscalItemName,
            providerTaxId: item.providerTaxId,
            taxCode: item.taxCode,
            taxRateBps: item.taxRateBps
        })),
        featureEnabled: false
    };
}

function collectCheck(checks, code, ok, message, details = null) {
    checks.push({ code, ok: Boolean(ok), message, details });
}

function failedChecks(checks) {
    return checks.filter(check => !check.ok);
}

async function loadExistingTarget(client, plan) {
    const result = await client.query(
        `SELECT fp.id AS fiscal_profile_id,
                fp.crm_profile_key,
                fp.legal_entity_key,
                fp.legal_entity_name,
                fp.tax_identifier,
                fp.provider_organization_id,
                fl.id AS fiscal_location_id,
                fl.location_alias,
                fl.display_name AS location_name,
                fl.provider_outlet_id,
                fr.id AS fiscal_register_id,
                fr.register_alias,
                fr.display_name AS register_name,
                fr.provider_register_id,
                fr.provider_license_ref,
                fr.feature_enabled,
                fr.status AS register_status,
                fr.metadata
           FROM fiscal_profiles fp
           LEFT JOIN fiscal_locations fl
             ON fl.fiscal_profile_id = fp.id
            AND fl.location_alias = $3
           LEFT JOIN fiscal_registers fr
             ON fr.fiscal_profile_id = fp.id
            AND fr.register_alias = $4
          WHERE fp.crm_profile_key = $1
            AND fp.legal_entity_key = $2
          LIMIT 1`,
        [plan.crmProfileKey, plan.legalEntityKey, plan.locationAlias, plan.registerAlias]
    );
    return result.rows[0] || null;
}

async function assertNoExistingConflicts(client, plan) {
    const existing = await loadExistingTarget(client, plan);
    if (existing?.fiscal_register_id) {
        const comparisons = [
            ['legalEntityName', existing.legal_entity_name, plan.legalEntityName],
            ['taxIdentifier', existing.tax_identifier, plan.taxIdentifier],
            ['providerOrganizationId', existing.provider_organization_id, plan.providerOrganizationId],
            ['providerOutletId', existing.provider_outlet_id, plan.providerOutletId],
            ['providerRegisterId', existing.provider_register_id, plan.providerRegisterId],
            ['providerLicenseRef', existing.provider_license_ref, plan.providerLicenseRef],
            ['integrationOwner', existing.metadata?.integration_owner || null, plan.integrationOwner]
        ];
        const changed = comparisons
            .filter(([, current, desired]) => String(current || '') !== String(desired || ''))
            .map(([field]) => field);
        if (changed.length) {
            throw new PilotConfigError('pilot_config_existing_target_conflict', 'Existing active target differs from requested plan; refusing silent FOP/register/ref change', { details: { changed } });
        }
    }

    const other = await client.query(
        `SELECT fp.legal_entity_key, fr.id AS fiscal_register_id
           FROM fiscal_registers fr
           JOIN fiscal_profiles fp ON fp.id = fr.fiscal_profile_id
          WHERE fr.crm_profile_key = $1
            AND fr.register_alias = $2
            AND fr.status = 'active'
            AND fp.legal_entity_key <> $3
          LIMIT 5`,
        [plan.crmProfileKey, plan.registerAlias, plan.legalEntityKey]
    );
    if (other.rows.length) {
        throw new PilotConfigError('pilot_config_other_fop_register_conflict', 'Another active FOP already owns the park middle register alias', {
            details: { legalEntityKeys: other.rows.map(row => row.legal_entity_key) }
        });
    }
}

async function activeAdmissionTicketCodes(client, crmProfileKey) {
    const result = await client.query(
        `SELECT code
           FROM admission_ticket_types
          WHERE business_context = $1
            AND is_active = TRUE
          ORDER BY code`,
        [crmProfileKey]
    );
    return result.rows.map(row => row.code);
}

async function existingActiveMappingCodes(client, plan) {
    const result = await client.query(
        `SELECT fim.item_code, COUNT(*)::integer AS count
           FROM fiscal_profiles fp
           JOIN fiscal_registers fr
             ON fr.fiscal_profile_id = fp.id
            AND fr.register_alias = $3
           JOIN fiscal_item_mappings fim
             ON fim.fiscal_profile_id = fp.id
            AND fim.fiscal_register_id = fr.id
            AND fim.source_type = $4
            AND fim.item_type = $5
            AND fim.provider = $6
            AND fim.status = 'active'
          WHERE fp.crm_profile_key = $1
            AND fp.legal_entity_key = $2
          GROUP BY fim.item_code
          ORDER BY fim.item_code`,
        [plan.crmProfileKey, plan.legalEntityKey, plan.registerAlias, SOURCE_TYPE, ITEM_TYPE, PROVIDER]
    );
    return result.rows;
}

async function preflightPlan(client, plan, { useStoredMappings = false } = {}) {
    const checks = [];
    collectCheck(checks, 'crm_profile_known', Boolean(BUSINESS_CONTEXTS[CRM_PROFILE_KEY]), 'CRM profile event_genix exists in canonical business context registry');
    collectCheck(checks, 'preschool_not_in_scope', plan.crmProfileKey === CRM_PROFILE_KEY, 'Preschool/day-care profile is not created or activated');
    collectCheck(checks, 'register_alias_middle', plan.registerAlias === REGISTER_ALIAS, 'Register alias is exactly middle');

    await assertNoExistingConflicts(client, plan);

    const users = await client.query(
        `SELECT id, username, name, role, extra_roles, action_allowlist, action_denylist, is_active
           FROM users
          WHERE id = ANY($1::int[])
          ORDER BY id`,
        [plan.cashierUserIds]
    );
    const userById = new Map(users.rows.map(row => [Number(row.id), row]));
    const missingUsers = plan.cashierUserIds.filter(id => !userById.has(id));
    collectCheck(checks, 'users_exist', missingUsers.length === 0, 'All exact CRM user IDs exist', missingUsers.length ? { missingUsers } : null);
    const inactiveUsers = users.rows.filter(row => row.is_active !== true).map(row => Number(row.id));
    collectCheck(checks, 'users_active', inactiveUsers.length === 0, 'All exact CRM users are active', inactiveUsers.length ? { inactiveUsers } : null);
    const deniedCapabilities = [];
    for (const user of users.rows) {
        for (const capability of plan.capabilities) {
            const decision = resolveCapability(user, capability);
            if (!decision.allowed) deniedCapabilities.push({ userId: Number(user.id), capability, reason: decision.reason });
        }
    }
    collectCheck(checks, 'users_have_capabilities', deniedCapabilities.length === 0, 'Users have all requested canonical capabilities', deniedCapabilities.length ? { deniedCapabilities } : null);

    const activeCodes = await activeAdmissionTicketCodes(client, plan.crmProfileKey);
    const inputMappings = new Map((plan.items || []).map(item => [item.itemCode, item]));
    const storedMappings = useStoredMappings ? await existingActiveMappingCodes(client, plan) : [];
    const storedByCode = new Map(storedMappings.map(row => [row.item_code, row]));
    const missingMappings = activeCodes.filter(code => useStoredMappings ? !storedByCode.has(code) : !inputMappings.has(code));
    const duplicateStoredMappings = storedMappings.filter(row => Number(row.count) !== 1).map(row => row.item_code);
    const duplicateInputMappings = (plan.items || [])
        .map(item => item.itemCode)
        .filter((code, index, list) => list.indexOf(code) !== index);
    collectCheck(checks, 'admission_ticket_codes_present', activeCodes.length > 0, 'Active EventGenix admission ticket codes exist');
    collectCheck(checks, 'item_mappings_complete', missingMappings.length === 0, 'All active admission ticket codes have explicit fiscal item mapping', missingMappings.length ? { missingMappings } : null);
    collectCheck(checks, 'item_mappings_unambiguous', duplicateInputMappings.length === 0 && duplicateStoredMappings.length === 0, 'Fiscal item mappings are unambiguous', (duplicateInputMappings.length || duplicateStoredMappings.length) ? { duplicateInputMappings, duplicateStoredMappings } : null);

    return { ok: failedChecks(checks).length === 0, checks };
}

async function applyPlan(client, plan, env = process.env) {
    await assertNoExistingConflicts(client, plan);
    const pinHash = actionPinHash(env, plan.capabilities);
    const profile = await client.query(
        `INSERT INTO fiscal_profiles (
             crm_profile_key, legal_entity_key, legal_entity_name, tax_identifier,
             provider, provider_organization_id, currency, status, settings
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'UAH', 'active', '{}'::jsonb)
         ON CONFLICT (crm_profile_key, legal_entity_key) DO UPDATE
             SET legal_entity_name = EXCLUDED.legal_entity_name,
                 tax_identifier = EXCLUDED.tax_identifier,
                 provider_organization_id = EXCLUDED.provider_organization_id,
                 status = 'active',
                 updated_at = NOW()
         RETURNING *`,
        [plan.crmProfileKey, plan.legalEntityKey, plan.legalEntityName, plan.taxIdentifier, PROVIDER, plan.providerOrganizationId]
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
    const fiscalLocationId = location.rows[0].id;

    const register = await client.query(
        `INSERT INTO fiscal_registers (
             fiscal_profile_id, fiscal_location_id, crm_profile_key, register_alias,
             display_name, provider, provider_register_id, provider_license_ref, status, feature_enabled, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', FALSE, $9::jsonb)
         ON CONFLICT (fiscal_profile_id, register_alias) DO UPDATE
             SET fiscal_location_id = EXCLUDED.fiscal_location_id,
                 display_name = EXCLUDED.display_name,
                 provider_register_id = EXCLUDED.provider_register_id,
                 provider_license_ref = EXCLUDED.provider_license_ref,
                 status = 'active',
                 feature_enabled = FALSE,
                 metadata = EXCLUDED.metadata,
                 updated_at = NOW()
         RETURNING *`,
        [
            fiscalProfileId,
            fiscalLocationId,
            plan.crmProfileKey,
            plan.registerAlias,
            plan.registerName,
            PROVIDER,
            plan.providerRegisterId,
            plan.providerLicenseRef,
            JSON.stringify({ integration_owner: plan.integrationOwner })
        ]
    );
    const fiscalRegisterId = register.rows[0].id;

    for (const userId of plan.cashierUserIds) {
        await client.query(
            `INSERT INTO fiscal_cashier_bindings (
                 fiscal_profile_id, fiscal_register_id, fiscal_location_id, crm_profile_key,
                 user_id, provider, provider_cashier_id, provider_cashier_login_ref,
                 capability_scope, action_pin_hash, action_pin_set_at, action_pin_updated_by_user_id, status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::varchar(255), CASE WHEN $10::varchar(255) IS NULL THEN NULL ELSE NOW() END, $11::integer, 'active')
             ON CONFLICT (fiscal_profile_id, fiscal_register_id, user_id) DO UPDATE
                 SET fiscal_location_id = EXCLUDED.fiscal_location_id,
                     crm_profile_key = EXCLUDED.crm_profile_key,
                     provider_cashier_id = EXCLUDED.provider_cashier_id,
                     provider_cashier_login_ref = EXCLUDED.provider_cashier_login_ref,
                     capability_scope = EXCLUDED.capability_scope,
                     action_pin_hash = COALESCE(EXCLUDED.action_pin_hash, fiscal_cashier_bindings.action_pin_hash),
                     action_pin_set_at = CASE WHEN EXCLUDED.action_pin_hash IS NULL THEN fiscal_cashier_bindings.action_pin_set_at ELSE EXCLUDED.action_pin_set_at END,
                     action_pin_updated_by_user_id = CASE WHEN EXCLUDED.action_pin_hash IS NULL THEN fiscal_cashier_bindings.action_pin_updated_by_user_id ELSE EXCLUDED.action_pin_updated_by_user_id END,
                     status = 'active',
                     updated_at = NOW()`,
            [
                fiscalProfileId,
                fiscalRegisterId,
                fiscalLocationId,
                plan.crmProfileKey,
                userId,
                PROVIDER,
                plan.providerCashierId,
                plan.cashierLoginRef,
                plan.capabilities,
                pinHash,
                pinHash ? userId : null
            ]
        );
    }

    for (const item of plan.items) {
        await client.query(
            `INSERT INTO fiscal_item_mappings (
                 fiscal_profile_id, fiscal_register_id, crm_profile_key, source_type, item_type,
                 item_code, fiscal_item_name, provider, provider_tax_id, tax_code, tax_rate_bps, status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')
             ON CONFLICT (fiscal_profile_id, fiscal_register_id, source_type, item_type, item_code, provider) DO UPDATE
                 SET fiscal_item_name = EXCLUDED.fiscal_item_name,
                     provider_tax_id = EXCLUDED.provider_tax_id,
                     tax_code = EXCLUDED.tax_code,
                     tax_rate_bps = EXCLUDED.tax_rate_bps,
                     status = 'active',
                     updated_at = NOW()`,
            [fiscalProfileId, fiscalRegisterId, plan.crmProfileKey, SOURCE_TYPE, ITEM_TYPE, item.itemCode, item.fiscalItemName, PROVIDER, item.providerTaxId, item.taxCode, item.taxRateBps]
        );
    }

    return { fiscalProfileId: Number(fiscalProfileId), fiscalLocationId: Number(fiscalLocationId), fiscalRegisterId: Number(fiscalRegisterId), featureEnabled: false };
}

async function statusPlan(client, plan) {
    const target = await loadExistingTarget(client, plan);
    if (!target) return { found: false, crmProfileKey: plan.crmProfileKey, legalEntityKey: plan.legalEntityKey, registerAlias: plan.registerAlias };
    const bindings = await client.query(
        `SELECT user_id, provider_cashier_id, provider_cashier_login_ref, capability_scope, status,
                action_pin_hash IS NOT NULL AS has_action_pin
           FROM fiscal_cashier_bindings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
          ORDER BY user_id`,
        [target.fiscal_profile_id, target.fiscal_register_id]
    );
    const mappings = await existingActiveMappingCodes(client, plan);
    return {
        found: true,
        crmProfileKey: target.crm_profile_key,
        legalEntityKey: target.legal_entity_key,
        fiscalProfileId: Number(target.fiscal_profile_id),
        fiscalLocationId: target.fiscal_location_id ? Number(target.fiscal_location_id) : null,
        fiscalRegisterId: target.fiscal_register_id ? Number(target.fiscal_register_id) : null,
        registerAlias: target.register_alias,
        registerStatus: target.register_status,
        featureEnabled: target.feature_enabled === true,
        integrationOwner: target.metadata?.integration_owner || null,
        bindings: bindings.rows.map(row => ({
            userId: Number(row.user_id),
            providerCashierId: row.provider_cashier_id || null,
            cashierLoginRef: row.provider_cashier_login_ref || null,
            capabilityScope: row.capability_scope || [],
            status: row.status,
            hasActionPin: row.has_action_pin === true
        })),
        activeItemMappings: mappings.map(row => ({ itemCode: row.item_code, count: Number(row.count) }))
    };
}

async function setRegisterEnabled(client, plan, enabled) {
    const target = await loadExistingTarget(client, plan);
    if (!target?.fiscal_register_id) {
        throw new PilotConfigError('pilot_config_register_missing', 'Configured park middle register does not exist');
    }
    const result = await client.query(
        `UPDATE fiscal_registers
            SET feature_enabled = $1,
                updated_at = NOW()
          WHERE id = $2
            AND fiscal_profile_id = $3
            AND register_alias = $4
          RETURNING id, feature_enabled`,
        [enabled, target.fiscal_register_id, target.fiscal_profile_id, plan.registerAlias]
    );
    return { fiscalRegisterId: Number(result.rows[0].id), featureEnabled: result.rows[0].feature_enabled === true };
}

function assertMutationAllowed(env) {
    if (String(env[APPLY_CONFIRM_ENV] || '').toLowerCase() !== APPLY_CONFIRM_VALUE) {
        throw new PilotConfigError('pilot_config_apply_not_allowed', `Set ${APPLY_CONFIRM_ENV}=true to mutate pilot configuration`);
    }
}

async function run(argv = process.argv.slice(2), { env = process.env, dbPool = pool } = {}) {
    const plan = parseArgs(argv);
    if (plan.mode === 'dry-run') return { applied: false, plan: publicPlan(plan) };
    const client = await dbPool.connect();
    try {
        if (plan.mode === 'status') {
            return { mode: plan.mode, status: await statusPlan(client, plan) };
        }
        if (plan.mode === 'preflight') {
            const preflight = await preflightPlan(client, plan);
            return { mode: plan.mode, ok: preflight.ok, preflight, plan: publicPlan(plan) };
        }
        assertMutationAllowed(env);
        await client.query('BEGIN');
        if (plan.mode === 'apply') {
            const preflightBefore = await preflightPlan(client, plan);
            if (!preflightBefore.ok) {
                throw new PilotConfigError('pilot_config_preflight_failed', 'Preflight failed; refusing apply', { details: preflightBefore });
            }
            const result = await applyPlan(client, plan, env);
            const preflightAfter = await preflightPlan(client, plan, { useStoredMappings: true });
            if (!preflightAfter.ok) {
                throw new PilotConfigError('pilot_config_post_apply_preflight_failed', 'Post-apply preflight failed; rolling back', { details: preflightAfter });
            }
            await client.query('COMMIT');
            return { applied: true, ...result, preflight: preflightAfter, plan: publicPlan(plan) };
        }
        if (plan.mode === 'enable-register') {
            const preflight = await preflightPlan(client, plan, { useStoredMappings: true });
            if (!preflight.ok) {
                throw new PilotConfigError('pilot_config_preflight_failed', 'Preflight failed; refusing enable-register', { details: preflight });
            }
            const result = await setRegisterEnabled(client, plan, true);
            await client.query('COMMIT');
            return { mode: plan.mode, enabled: true, ...result, preflight };
        }
        if (plan.mode === 'disable-register') {
            const result = await setRegisterEnabled(client, plan, false);
            await client.query('COMMIT');
            return { mode: plan.mode, enabled: false, ...result };
        }
        throw new PilotConfigError('pilot_config_mode_invalid', `Unsupported mode: ${plan.mode}`);
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
            console.error(JSON.stringify({
                success: false,
                code: error.code || 'pilot_config_failed',
                error: error.message,
                details: error.details || null
            }, null, 2));
            await pool.end().catch(() => {});
            process.exit(error.status || 1);
        });
}

module.exports = {
    ACTION_PIN_ENV,
    APPLY_CONFIRM_ENV,
    DEFAULT_CAPABILITIES,
    PIN_REQUIRED_CAPABILITIES,
    PilotConfigError,
    activeAdmissionTicketCodes,
    applyPlan,
    normalizePlan,
    parseArgs,
    parseItem,
    preflightPlan,
    publicPlan,
    requiresActionPin,
    run,
    statusPlan
};
