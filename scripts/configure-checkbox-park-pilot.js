#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { pool } = require('../db');
const { BUSINESS_CONTEXTS } = require('../services/businessContext');
const { resolveCapability } = require('../services/accountAccessPolicy');
const { createActionPinHash, sanitizePin } = require('../services/payments/fiscalApprovals');

const CRM_PROFILE_KEY = 'event_genix';
const LOCATION_ALIAS = 'park';
const REGISTER_ALIAS = 'middle';
const PROVIDER = 'checkbox';
const SOURCE_TYPE = 'admission_ticket';
const ITEM_TYPE = 'admission_ticket';
const APPLY_CONFIRM_ENV = 'EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY';
const APPLY_CONFIRM_VALUE = 'true';
const ACTION_PIN_ENV = 'CHECKBOX_PILOT_ACTION_PIN';
const ACTION_PIN_USER_ENV_PREFIX = 'CHECKBOX_PILOT_ACTION_PIN_USER_';
const CONFIG_FILE_ENV = 'CHECKBOX_PILOT_CONFIG_FILE';
const NPM_CONFIG_FILE_ENV = 'npm_config_config_file';
const NPM_LIFECYCLE_EVENT = 'configure:checkbox:park';
const QA_TEST_USER_ID = 47;

const MODES = Object.freeze([
    'dry-run',
    'preflight',
    'create',
    'apply',
    'status',
    'diff',
    'enable-register',
    'disable-register',
    'rotate-binding',
    'replace-tax-mapping',
    'change-owner'
]);

const DEFAULT_CAPABILITIES = Object.freeze([
    'payments.view',
    'payments.create',
    'payments.confirm_received',
    'fiscal.shift.open'
]);

const INTEGRATION_OWNER_CAPABILITIES = Object.freeze([
    'fiscal.shift.close'
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

function isHelpRequest(argv = []) {
    return argv.includes('--help') || argv.includes('-h');
}

function cliUsage() {
    return [
        'Configure the Checkbox park + middle pilot mapping (dry-run by default).',
        '',
        'Usage:',
        '  node scripts/configure-checkbox-park-pilot.js --config-file <path>',
        '  node scripts/configure-checkbox-park-pilot.js preflight --config-file <path>',
        '  npm run configure:checkbox:park -- --config-file="C:\\Users\\Plotva\\.eventgenix\\checkbox-park-test.config.json"',
        '  npm run configure:checkbox:park -- preflight --config-file="C:\\Users\\Plotva\\.eventgenix\\checkbox-park-test.config.json"',
        '',
        'Windows/npm 10 note:',
        '  With npm, keep --config-file=<path> as one argument. A separated',
        '  --config-file <path> can be consumed by npm before the script starts.',
        '',
        'Alternative:',
        '  Set CHECKBOX_PILOT_CONFIG_FILE to the local JSON path, then run the command without --config-file.',
        '',
        'Mutation modes additionally require an authorized actor, a reason, and the explicit apply safety environment gate.',
        'Never put passwords, PINs, license keys, access keys, tokens, webhook secrets, or price overrides in the JSON file or CLI arguments.'
    ].join('\n');
}

function configFilePathFromEnvironment(env = {}) {
    const explicitPath = optionalText(env[CONFIG_FILE_ENV]);
    if (explicitPath) return explicitPath;
    if (env.npm_lifecycle_event !== NPM_LIFECYCLE_EVENT) return null;
    return optionalText(env[NPM_CONFIG_FILE_ENV]);
}

function parseArgs(argv = process.argv.slice(2), env = {}) {
    const configFilePath = configFilePathFromArgs(argv) || configFilePathFromEnvironment(env);
    const options = {
        mode: 'dry-run',
        crmProfileKey: CRM_PROFILE_KEY,
        locationAlias: LOCATION_ALIAS,
        registerAlias: REGISTER_ALIAS,
        cashierUserIds: [],
        items: [],
        capabilities: [...DEFAULT_CAPABILITIES],
        actorLabel: 'codex-checkbox-config-cli'
    };
    if (configFilePath) {
        Object.assign(options, optionsFromConfigFile(configFilePath), { configFilePath });
    }
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
        if (arg === '--create') {
            options.mode = 'create';
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
        if (arg === '--diff') {
            options.mode = 'diff';
            continue;
        }
        if (arg === '--rotate-binding') {
            options.mode = 'rotate-binding';
            continue;
        }
        if (arg === '--replace-tax-mapping') {
            options.mode = 'replace-tax-mapping';
            continue;
        }
        if (arg === '--change-owner') {
            options.mode = 'change-owner';
            continue;
        }
        if (!arg.startsWith('--')) {
            throw new PilotConfigError('pilot_config_arg_invalid', `Unexpected argument: ${arg}`);
        }
        const name = arg.slice(2);
        if (name === 'config-file') {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) {
                throw new PilotConfigError('pilot_config_arg_value_missing', `Value is required for ${arg}`);
            }
            i += 1;
            continue;
        }
        if (name.startsWith('config-file=')) continue;
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
            case 'actor-user-id':
                options.actorUserId = Number(value);
                break;
            case 'actor-label':
                options.actorLabel = value;
                break;
            case 'reason':
                options.reason = value;
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
            case 'expected-is-test':
                options.expectedIsTest = value;
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

function configFilePathFromArgs(argv = []) {
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--config-file') {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) {
                throw new PilotConfigError('pilot_config_arg_value_missing', 'Value is required for --config-file');
            }
            return value;
        }
        if (argv[index].startsWith('--config-file=')) {
            const value = argv[index].slice('--config-file='.length);
            if (!value) {
                throw new PilotConfigError('pilot_config_arg_value_missing', 'Value is required for --config-file');
            }
            return value;
        }
    }
    return null;
}

function assertNonSecretConfig(value, path = 'config') {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNonSecretConfig(item, `${path}[${index}]`));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (
            normalized.includes('password')
            || normalized === 'pin'
            || normalized === 'pincode'
            || normalized.includes('licensekey')
            || normalized.includes('accesskey')
            || normalized.includes('token')
            || normalized.includes('webhooksecret')
            || normalized === 'secret'
            || normalized.endsWith('secret')
        ) {
            throw new PilotConfigError('pilot_config_secret_field_forbidden', `Secret-like field is forbidden in config file: ${path}.${key}`);
        }
        if (['price', 'priceoverride', 'unitprice', 'unitpriceuah', 'unitpriceminor', 'amount', 'amountminor', 'total', 'totalamount', 'totalamountminor'].includes(normalized)) {
            throw new PilotConfigError('pilot_config_price_override_forbidden', `Price override field is forbidden in config file: ${path}.${key}`);
        }
        assertNonSecretConfig(child, `${path}.${key}`);
    }
}

function loadPilotConfigFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    let data;
    try {
        data = JSON.parse(raw);
    } catch (error) {
        throw new PilotConfigError('pilot_config_file_json_invalid', `Config file is not valid JSON: ${error.message}`);
    }
    assertNonSecretConfig(data);
    return data;
}

function stringOrNull(value) {
    const text = optionalText(value);
    return text || null;
}

function numberArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => Number(item)).filter(item => Number.isSafeInteger(item) && item > 0);
}

function itemFromConfig(item) {
    if (!item || typeof item !== 'object') {
        throw new PilotConfigError('pilot_config_item_invalid', 'Config item mapping must be an object');
    }
    return parseItem([
        item.itemCode,
        item.fiscalItemName,
        item.taxMode || 'taxed',
        item.providerTaxId || '',
        item.taxCode ?? '',
        item.taxRateBps ?? ''
    ].join('|'));
}

function optionsFromConfigFile(filePath) {
    const config = loadPilotConfigFile(filePath);
    if (optionalText(config.provider) && optionalText(config.provider) !== PROVIDER) {
        throw new PilotConfigError('pilot_config_provider_forbidden', 'Only Checkbox provider can be configured by this pilot tool');
    }
    const eventGenixUsers = config.eventGenixUsers && typeof config.eventGenixUsers === 'object' ? config.eventGenixUsers : {};
    const cashierUserIds = numberArray(config.cashierUserIds).length
        ? numberArray(config.cashierUserIds)
        : numberArray(eventGenixUsers.cashierUserIds);
    const credentialRef = stringOrNull(config.credentialRef);
    const primaryTestCashierUserId = Number(eventGenixUsers.primaryTestCashierUserId || config.primaryTestCashierUserId || 0) || null;
    const integrationOwnerUserId = stringOrNull(config.integrationOwnerUserId)
        || stringOrNull(config.integrationOwner)
        || stringOrNull(numberArray(eventGenixUsers.integrationOwnerUserIds)[0]);
    const options = {
        crmProfileKey: stringOrNull(config.crmProfileKey) || CRM_PROFILE_KEY,
        locationAlias: stringOrNull(config.locationAlias) || LOCATION_ALIAS,
        registerAlias: stringOrNull(config.registerAlias) || REGISTER_ALIAS,
        legalEntityKey: stringOrNull(config.legalEntityKey),
        legalEntityName: stringOrNull(config.legalEntityName),
        taxIdentifier: stringOrNull(config.taxIdentifier),
        providerOrganizationId: stringOrNull(config.providerOrganizationId),
        locationName: stringOrNull(config.locationName) || stringOrNull(config.locationDisplayName) || stringOrNull(config.locationAlias) || 'Park',
        providerOutletId: stringOrNull(config.providerOutletId),
        registerName: stringOrNull(config.registerName) || stringOrNull(config.registerDisplayName) || stringOrNull(config.registerAlias) || 'Middle',
        providerRegisterId: stringOrNull(config.providerRegisterId),
        providerLicenseRef: stringOrNull(config.providerLicenseRef) || stringOrNull(config.registerCredentialRef) || credentialRef,
        cashierUserIds,
        providerCashierId: stringOrNull(config.providerCashierId),
        cashierLoginRef: stringOrNull(config.cashierLoginRef) || stringOrNull(config.cashierCredentialRef) || credentialRef,
        integrationOwner: integrationOwnerUserId,
        expectedIsTest: config.expectedIsTest,
        capabilities: Array.isArray(config.capabilities) ? config.capabilities.map(item => String(item).trim()).filter(Boolean) : [...DEFAULT_CAPABILITIES],
        items: Array.isArray(config.items) ? config.items.map(itemFromConfig) : [],
        configFilePath: filePath,
        primaryTestCashierUserId,
        primaryTestCashierName: stringOrNull(eventGenixUsers.primaryTestCashierName || config.primaryTestCashierName)
    };
    if (optionalText(config.priceSource) && optionalText(config.priceSource) !== 'EventGenix admission tariff immutable snapshot') {
        throw new PilotConfigError('pilot_config_price_source_invalid', 'CRM tariff must remain the only source of price');
    }
    return options;
}

function parseItem(value) {
    const parts = String(value || '').split('|').map(item => item.trim());
    const [itemCode, fiscalItemName] = parts;
    let taxMode = 'taxed';
    let providerTaxId;
    let taxCode = '';
    let taxRateBps = '';
    if (['taxed', 'untaxed'].includes(String(parts[2] || '').toLowerCase())) {
        taxMode = String(parts[2]).toLowerCase();
        providerTaxId = parts[3] || '';
        taxCode = parts[4] || '';
        taxRateBps = parts[5] || '';
    } else {
        providerTaxId = parts[2] || '';
        taxCode = parts[3] || '';
        taxRateBps = parts[4] || '';
    }
    if (!itemCode || !fiscalItemName) {
        throw new PilotConfigError('pilot_config_item_invalid', 'Item mapping must be itemCode|fiscalItemName|taxMode|providerTaxId|taxCode|taxRateBps');
    }
    if (taxMode === 'taxed' && !providerTaxId) {
        throw new PilotConfigError('pilot_config_item_tax_required', 'Taxed item mapping requires providerTaxId');
    }
    if (taxMode === 'untaxed' && providerTaxId) {
        throw new PilotConfigError('pilot_config_item_tax_forbidden', 'Untaxed item mapping must not include providerTaxId');
    }
    if (/^admission_tariff:/i.test(providerTaxId)) {
        throw new PilotConfigError('pilot_config_item_tax_invalid', 'Internal admission_tariff reference must never be used as Checkbox provider tax id');
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
        taxMode,
        providerTaxId: providerTaxId || null,
        taxCode: numericTaxCode,
        taxRateBps: numericTaxRateBps
    };
}

function parseExpectedIsTest(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'off'].includes(text)) return false;
    throw new PilotConfigError('pilot_config_expected_is_test_required', 'expected-is-test must be true or false');
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
    return ['dry-run', 'preflight', 'create', 'apply', 'diff', 'enable-register', 'rotate-binding', 'replace-tax-mapping', 'change-owner'].includes(mode);
}

function isMutationMode(mode) {
    return ['create', 'apply', 'enable-register', 'disable-register', 'rotate-binding', 'replace-tax-mapping', 'change-owner'].includes(mode);
}

function normalizeRef(value, code) {
    const ref = requireText(value, code);
    if (!/^[A-Za-z0-9_:-]+$/.test(ref)) {
        throw new PilotConfigError('pilot_config_credential_ref_invalid', `${code} must contain only letters, digits, underscore, colon or dash`);
    }
    return ref;
}

function credentialEnvPrefix(ref) {
    const safe = normalizeRef(ref, 'credential_ref')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
    return safe ? `CHECKBOX_${safe}` : '';
}

function assertNoCredentialRefCollisions(refs = []) {
    const byPrefix = new Map();
    for (const ref of refs.filter(Boolean)) {
        const prefix = credentialEnvPrefix(ref);
        const existing = byPrefix.get(prefix);
        if (existing && existing !== ref) {
            throw new PilotConfigError('pilot_config_credential_ref_collision', 'Credential refs resolve to the same CHECKBOX_<REF> environment prefix', {
                details: { refs: [existing, ref], prefix }
            });
        }
        byPrefix.set(prefix, ref);
    }
}

async function assertNoStoredCredentialRefCollisions(client, plan) {
    const suppliedRefs = [plan.providerLicenseRef, plan.cashierLoginRef].filter(Boolean);
    if (!suppliedRefs.length) return;
    const existing = await client.query(
        `SELECT provider_license_ref AS credential_ref
           FROM fiscal_registers
          WHERE provider_license_ref IS NOT NULL
         UNION ALL
         SELECT provider_cashier_login_ref AS credential_ref
           FROM fiscal_cashier_bindings
          WHERE provider_cashier_login_ref IS NOT NULL`
    );
    const refs = [...suppliedRefs, ...existing.rows.map(row => row.credential_ref).filter(Boolean)];
    assertNoCredentialRefCollisions(refs);
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
        apply: options.mode === 'apply' || options.mode === 'create',
        crmProfileKey: CRM_PROFILE_KEY,
        legalEntityKey: requireText(options.legalEntityKey, 'legal_entity_key'),
        locationAlias: LOCATION_ALIAS,
        registerAlias: REGISTER_ALIAS,
        cashierUserIds,
        capabilities,
        actorUserId: options.actorUserId == null ? null : Number(options.actorUserId),
        actorLabel: optionalText(options.actorLabel),
        reason: optionalText(options.reason),
        configFilePath: optionalText(options.configFilePath),
        primaryTestCashierUserId: options.primaryTestCashierUserId == null ? null : Number(options.primaryTestCashierUserId),
        primaryTestCashierName: optionalText(options.primaryTestCashierName)
    };
    if (plan.primaryTestCashierUserId != null && (!Number.isSafeInteger(plan.primaryTestCashierUserId) || plan.primaryTestCashierUserId <= 0)) {
        throw new PilotConfigError('pilot_config_primary_cashier_invalid', 'primaryTestCashierUserId must be a positive integer when provided');
    }
    if (plan.actorUserId != null && (!Number.isSafeInteger(plan.actorUserId) || plan.actorUserId <= 0)) {
        throw new PilotConfigError('pilot_config_actor_user_invalid', 'actor-user-id must be a positive integer when provided');
    }
    if (isMutationMode(plan.mode)) {
        if (!plan.actorUserId) {
            throw new PilotConfigError('pilot_config_actor_user_required', 'Mutating configuration commands require exact --actor-user-id');
        }
        if (!plan.reason) {
            throw new PilotConfigError('pilot_config_reason_required', 'Mutating configuration commands require non-empty --reason');
        }
    }
    if (!full) return plan;
    if (!cashierUserIds.length) {
        throw new PilotConfigError('pilot_config_cashier_users_required', 'At least one exact cashier-user-id is required');
    }
    if (!options.items.length) {
        throw new PilotConfigError('pilot_config_items_required', 'At least one fiscal item mapping is required');
    }
    const duplicateItems = options.items
        .map(item => item.itemCode)
        .filter((code, index, list) => list.indexOf(code) !== index);
    if (duplicateItems.length) {
        throw new PilotConfigError('pilot_config_item_duplicate', 'Each fiscal item mapping itemCode must be unique', {
            details: { duplicateItems: [...new Set(duplicateItems)] }
        });
    }
    const fullPlan = {
        ...plan,
        legalEntityName: requireText(options.legalEntityName, 'legal_entity_name'),
        taxIdentifier: requireText(options.taxIdentifier, 'tax_identifier'),
        providerOrganizationId: requireText(options.providerOrganizationId, 'provider_organization_id'),
        locationName: requireText(options.locationName, 'location_name'),
        // The current official Checkbox cashier/register responses do not expose an
        // outlet identifier. Keep it as optional operator metadata and never invent it.
        providerOutletId: optionalText(options.providerOutletId),
        registerName: requireText(options.registerName, 'register_name'),
        providerRegisterId: requireText(options.providerRegisterId, 'provider_register_id'),
        providerLicenseRef: normalizeRef(options.providerLicenseRef, 'provider_license_ref'),
        providerCashierId: requireText(options.providerCashierId, 'provider_cashier_id'),
        cashierLoginRef: normalizeRef(options.cashierLoginRef, 'cashier_login_ref'),
        integrationOwner: Number(requireText(options.integrationOwner, 'integration_owner')),
        expectedIsTest: parseExpectedIsTest(options.expectedIsTest),
        items: options.items
    };
    if (!Number.isSafeInteger(fullPlan.integrationOwner) || fullPlan.integrationOwner <= 0) {
        throw new PilotConfigError('pilot_config_integration_owner_invalid', 'integration owner must be an exact positive EventGenix user id');
    }
    if (!fullPlan.cashierUserIds.includes(fullPlan.integrationOwner)) {
        throw new PilotConfigError('pilot_config_integration_owner_binding_required', 'Integration owner must have an exact cashier binding in this config');
    }
    if (fullPlan.primaryTestCashierUserId && !fullPlan.cashierUserIds.includes(fullPlan.primaryTestCashierUserId)) {
        throw new PilotConfigError('pilot_config_primary_cashier_missing', 'Primary test cashier user must be included in cashier bindings');
    }
    if (fullPlan.cashierUserIds.includes(QA_TEST_USER_ID) && fullPlan.expectedIsTest !== true) {
        throw new PilotConfigError('pilot_config_qa_user_test_only', 'QA user 47 is allowed only for explicit test-mode configuration');
    }
    assertNoCredentialRefCollisions([fullPlan.providerLicenseRef, fullPlan.cashierLoginRef]);
    return fullPlan;
}

function capabilitiesForUser(plan, userId) {
    const normalizedUserId = Number(userId);
    const ownerUserId = Number(plan?.integrationOwner);
    const ownerOnly = new Set(INTEGRATION_OWNER_CAPABILITIES);
    const capabilities = (plan?.capabilities || []).filter(capability => !ownerOnly.has(capability));
    if (Number.isSafeInteger(ownerUserId) && ownerUserId > 0 && normalizedUserId === ownerUserId) {
        capabilities.push(...INTEGRATION_OWNER_CAPABILITIES);
    }
    return [...new Set(capabilities)];
}

function requiresActionPin(capabilities = []) {
    return capabilities.some(capability => PIN_REQUIRED_CAPABILITIES.includes(capability));
}

function actionPinEnvNameForUser(userId) {
    return `${ACTION_PIN_USER_ENV_PREFIX}${Number(userId)}`;
}

function resolveActionPinsByUser(env, capabilities, userIds = []) {
    if (!requiresActionPin(capabilities)) return new Map();
    const ids = [...new Set((userIds || []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
    if (!ids.length) {
        throw new PilotConfigError('pilot_config_action_pin_user_required', 'Action PIN bootstrap requires exact user ids');
    }
    const pins = new Map();
    if (ids.length === 1) {
        const userEnvName = actionPinEnvNameForUser(ids[0]);
        const rawPin = String(env[userEnvName] || env[ACTION_PIN_ENV] || '');
        if (!rawPin.trim()) {
            throw new PilotConfigError('pilot_config_action_pin_env_missing', `${userEnvName} or ${ACTION_PIN_ENV} is required only for future approval/PRO bindings`);
        }
        pins.set(ids[0], sanitizePin(rawPin));
        return pins;
    }
    if (String(env[ACTION_PIN_ENV] || '').trim()) {
        throw new PilotConfigError('pilot_config_shared_action_pin_forbidden', `${ACTION_PIN_ENV} is forbidden for multiple PRO users; use ${ACTION_PIN_USER_ENV_PREFIX}<userId> per user`);
    }
    const used = new Map();
    for (const userId of ids) {
        const envName = actionPinEnvNameForUser(userId);
        const rawPin = String(env[envName] || '');
        if (!rawPin.trim()) {
            throw new PilotConfigError('pilot_config_action_pin_env_missing', `${envName} is required for future approval/PRO binding user ${userId}`);
        }
        const pin = sanitizePin(rawPin);
        const otherUserId = used.get(pin);
        if (otherUserId && otherUserId !== userId) {
            throw new PilotConfigError('pilot_config_shared_action_pin_forbidden', 'Future approval/PRO bindings require distinct per-user action PIN values');
        }
        used.set(pin, userId);
        pins.set(userId, pin);
    }
    return pins;
}

async function actionPinHashesByUser(env, capabilities, userIds = []) {
    const pins = resolveActionPinsByUser(env, capabilities, userIds);
    const hashes = new Map();
    for (const [userId, pin] of pins.entries()) {
        hashes.set(userId, await createActionPinHash(pin));
    }
    return hashes;
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
        providerOrganizationIdConfigured: Boolean(plan.providerOrganizationId),
        providerOutletIdConfigured: Boolean(plan.providerOutletId),
        providerRegisterIdConfigured: Boolean(plan.providerRegisterId),
        providerLicenseRef: plan.providerLicenseRef || null,
        providerCashierIdConfigured: Boolean(plan.providerCashierId),
        cashierUserIds: plan.cashierUserIds,
        cashierLoginRef: plan.cashierLoginRef || null,
        integrationOwner: plan.integrationOwner || null,
        expectedIsTest: plan.expectedIsTest,
        capabilities: plan.capabilities,
        bindings: (plan.cashierUserIds || []).map(userId => ({
            userId,
            capabilityScope: capabilitiesForUser(plan, userId).sort()
        })),
        actionPinRequired: requiresActionPin(plan.capabilities),
        primaryTestCashierUserId: plan.primaryTestCashierUserId || null,
        itemMappings: (plan.items || []).map(item => ({
            sourceType: SOURCE_TYPE,
            itemType: ITEM_TYPE,
            itemCode: item.itemCode,
            fiscalItemName: item.fiscalItemName,
            taxMode: item.taxMode,
            providerTaxId: item.providerTaxId,
            taxCode: item.taxCode,
            taxRateBps: item.taxRateBps
        })),
        featureEnabled: false
    };
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function configHash(snapshot) {
    return crypto.createHash('sha256').update(stableJson(snapshot || {})).digest('hex');
}

function desiredSnapshot(plan) {
    return {
        crmProfileKey: plan.crmProfileKey,
        legalEntityKey: plan.legalEntityKey,
        legalEntityName: plan.legalEntityName || null,
        taxIdentifier: plan.taxIdentifier || null,
        providerOrganizationId: plan.providerOrganizationId || null,
        locationAlias: plan.locationAlias,
        locationName: plan.locationName || null,
        providerOutletId: plan.providerOutletId || null,
        registerAlias: plan.registerAlias,
        registerName: plan.registerName || null,
        providerRegisterId: plan.providerRegisterId || null,
        providerLicenseRef: plan.providerLicenseRef || null,
        integrationOwner: plan.integrationOwner || null,
        expectedIsTest: plan.expectedIsTest,
        bindings: [...(plan.cashierUserIds || [])].sort((a, b) => a - b).map(userId => ({
            userId,
            providerCashierId: plan.providerCashierId || null,
            cashierLoginRef: plan.cashierLoginRef || null,
            capabilityScope: capabilitiesForUser(plan, userId).sort()
        })),
        itemMappings: [...(plan.items || [])]
            .sort((a, b) => a.itemCode.localeCompare(b.itemCode))
            .map(item => ({
                itemCode: item.itemCode,
                fiscalItemName: item.fiscalItemName,
                taxMode: item.taxMode || 'taxed',
                providerTaxId: item.providerTaxId || null,
                taxCode: item.taxCode,
                taxRateBps: item.taxRateBps
            }))
    };
}

function diffSnapshots(before = {}, after = {}, prefix = '') {
    const changes = [];
    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort();
    for (const key of keys) {
        const path = prefix ? `${prefix}.${key}` : key;
        const left = before?.[key];
        const right = after?.[key];
        if (Array.isArray(left) || Array.isArray(right)) {
            if (stableJson(left || []) !== stableJson(right || [])) changes.push({ field: path, before: left || [], after: right || [] });
            continue;
        }
        if (left && typeof left === 'object' && right && typeof right === 'object') {
            changes.push(...diffSnapshots(left, right, path));
            continue;
        }
        if (String(left ?? '') !== String(right ?? '')) changes.push({ field: path, before: left ?? null, after: right ?? null });
    }
    return changes;
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
    await assertNoStoredCredentialRefCollisions(client, plan);
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
        `SELECT fim.item_code,
                MIN(fim.fiscal_item_name) AS fiscal_item_name,
                MIN(COALESCE(fim.tax_mode, 'taxed')) AS tax_mode,
                MIN(fim.provider_tax_id) AS provider_tax_id,
                MIN(fim.tax_code)::integer AS tax_code,
                MIN(fim.tax_rate_bps)::integer AS tax_rate_bps,
                COUNT(*)::integer AS count
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
    collectCheck(checks, 'expected_test_identity_declared', typeof plan.expectedIsTest === 'boolean', 'Checkbox expected is_test identity is explicitly declared');

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
    if (plan.primaryTestCashierUserId) {
        const primary = userById.get(plan.primaryTestCashierUserId);
        const nameText = `${primary?.name || ''} ${primary?.username || ''}`.toLowerCase();
        const expectedName = String(plan.primaryTestCashierName || '').toLowerCase();
        const primaryNameOk = !primary
            ? false
            : !expectedName
                ? true
                : expectedName.includes('наталія') || expectedName.includes('natalia')
                    ? (nameText.includes('наталі') || nameText.includes('natal'))
                    : true;
        collectCheck(checks, 'primary_test_cashier_confirmed', primaryNameOk, 'Primary test cashier user identity matches the local test config expectation', primaryNameOk ? null : { userId: plan.primaryTestCashierUserId });
    }
    const deniedCapabilities = [];
    for (const user of users.rows) {
        for (const capability of capabilitiesForUser(plan, Number(user.id))) {
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
    const invalidTaxMappings = (useStoredMappings ? storedMappings.map(row => ({
        itemCode: row.item_code,
        taxMode: row.tax_mode || 'taxed',
        providerTaxId: row.provider_tax_id || null
    })) : (plan.items || []).map(item => ({
        itemCode: item.itemCode,
        taxMode: item.taxMode || 'taxed',
        providerTaxId: item.providerTaxId || null
    }))).filter(item => item.taxMode === 'taxed' ? !item.providerTaxId : Boolean(item.providerTaxId));
    collectCheck(checks, 'admission_ticket_codes_present', activeCodes.length > 0, 'Active EventGenix admission ticket codes exist');
    collectCheck(checks, 'item_mappings_complete', missingMappings.length === 0, 'All active admission ticket codes have explicit fiscal item mapping', missingMappings.length ? { missingMappings } : null);
    collectCheck(checks, 'item_mappings_unambiguous', duplicateInputMappings.length === 0 && duplicateStoredMappings.length === 0, 'Fiscal item mappings are unambiguous', (duplicateInputMappings.length || duplicateStoredMappings.length) ? { duplicateInputMappings, duplicateStoredMappings } : null);
    collectCheck(checks, 'item_tax_mode_valid', invalidTaxMappings.length === 0, 'Taxed mappings have provider tax id and untaxed mappings do not', invalidTaxMappings.length ? { invalidTaxMappings } : null);

    return { ok: failedChecks(checks).length === 0, checks };
}

async function applyPlan(client, plan, env = process.env) {
    const existingStatus = await statusPlan(client, plan);
    const desired = desiredSnapshot(plan);
    if (existingStatus.found) {
        const changes = diffSnapshots(existingStatus.configSnapshot, desired);
        if (!changes.length) {
            return {
                fiscalProfileId: existingStatus.fiscalProfileId,
                fiscalLocationId: existingStatus.fiscalLocationId,
                fiscalRegisterId: existingStatus.fiscalRegisterId,
                featureEnabled: existingStatus.featureEnabled,
                noChange: true
            };
        }
        throw new PilotConfigError('pilot_config_drift_requires_explicit_command', 'Existing pilot configuration differs from requested plan; use diff and an explicit change command', {
            details: {
                beforeHash: existingStatus.configHash,
                afterHash: configHash(desired),
                changes
            }
        });
    }
    await assertNoExistingConflicts(client, plan);
    const beforeSnapshot = {};
    const pinHashes = await actionPinHashesByUser(env, plan.capabilities, plan.cashierUserIds);
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
            JSON.stringify({ integration_owner: plan.integrationOwner, expected_is_test: plan.expectedIsTest })
        ]
    );
    const fiscalRegisterId = register.rows[0].id;

    for (const userId of plan.cashierUserIds) {
        const pinHash = pinHashes.get(userId) || null;
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
                capabilitiesForUser(plan, userId),
                pinHash,
                pinHash ? userId : null
            ]
        );
    }

    for (const item of plan.items) {
        await client.query(
            `INSERT INTO fiscal_item_mappings (
                 fiscal_profile_id, fiscal_register_id, crm_profile_key, source_type, item_type,
                 item_code, fiscal_item_name, provider, provider_tax_id, tax_code, tax_rate_bps, tax_mode, status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
             ON CONFLICT (fiscal_profile_id, fiscal_register_id, source_type, item_type, item_code, provider) DO UPDATE
                 SET fiscal_item_name = EXCLUDED.fiscal_item_name,
                     provider_tax_id = EXCLUDED.provider_tax_id,
                     tax_code = EXCLUDED.tax_code,
                     tax_rate_bps = EXCLUDED.tax_rate_bps,
                     tax_mode = EXCLUDED.tax_mode,
                     status = 'active',
                     updated_at = NOW()`,
            [fiscalProfileId, fiscalRegisterId, plan.crmProfileKey, SOURCE_TYPE, ITEM_TYPE, item.itemCode, item.fiscalItemName, PROVIDER, item.providerTaxId, item.taxCode, item.taxRateBps, item.taxMode || 'taxed']
        );
    }

    const afterStatus = await statusPlan(client, plan);
    await writeConfigAudit(client, plan, {
        command: plan.mode,
        fiscalProfileId,
        fiscalRegisterId,
        beforeSnapshot,
        afterSnapshot: afterStatus.configSnapshot
    });

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
            AND status = 'active'
          ORDER BY user_id`,
        [target.fiscal_profile_id, target.fiscal_register_id]
    );
    const mappings = await existingActiveMappingCodes(client, plan);
    const activeItemMappings = mappings.map(row => ({
        itemCode: row.item_code,
        fiscalItemName: row.fiscal_item_name || null,
        taxMode: row.tax_mode || 'taxed',
        providerTaxId: row.provider_tax_id || null,
        taxCode: row.tax_code == null ? null : Number(row.tax_code),
        taxRateBps: row.tax_rate_bps == null ? null : Number(row.tax_rate_bps),
        count: Number(row.count)
    }));
    const bindingsSnapshot = bindings.rows.map(row => ({
        userId: Number(row.user_id),
        providerCashierId: row.provider_cashier_id || null,
        cashierLoginRef: row.provider_cashier_login_ref || null,
        capabilityScope: [...(row.capability_scope || [])].sort()
    }));
    const metadata = target.metadata || {};
    const configSnapshot = {
        crmProfileKey: target.crm_profile_key,
        legalEntityKey: target.legal_entity_key,
        legalEntityName: target.legal_entity_name || null,
        taxIdentifier: target.tax_identifier || null,
        providerOrganizationId: target.provider_organization_id || null,
        locationAlias: target.location_alias || plan.locationAlias,
        locationName: target.location_name || null,
        providerOutletId: target.provider_outlet_id || null,
        registerAlias: target.register_alias || plan.registerAlias,
        registerName: target.register_name || null,
        providerRegisterId: target.provider_register_id || null,
        providerLicenseRef: target.provider_license_ref || null,
        integrationOwner: metadata.integration_owner || null,
        expectedIsTest: typeof metadata.expected_is_test === 'boolean' ? metadata.expected_is_test : null,
        bindings: bindingsSnapshot,
        itemMappings: activeItemMappings
            .map(({ count, ...item }) => item)
            .sort((a, b) => a.itemCode.localeCompare(b.itemCode))
    };
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
        integrationOwner: metadata.integration_owner || null,
        expectedIsTest: typeof metadata.expected_is_test === 'boolean' ? metadata.expected_is_test : null,
        bindings: bindings.rows.map(row => ({
            userId: Number(row.user_id),
            providerCashierId: row.provider_cashier_id || null,
            cashierLoginRef: row.provider_cashier_login_ref || null,
            capabilityScope: row.capability_scope || [],
            status: row.status,
            hasActionPin: row.has_action_pin === true
        })),
        activeItemMappings,
        configSnapshot,
        configHash: configHash(configSnapshot)
    };
}

async function writeConfigAudit(client, plan, { command, fiscalProfileId = null, fiscalRegisterId = null, beforeSnapshot = {}, afterSnapshot = {} }) {
    const reason = optionalText(plan.reason);
    if (!reason) {
        throw new PilotConfigError('pilot_config_reason_required', 'A non-empty --reason is required for configuration mutations');
    }
    await client.query(
        `INSERT INTO fiscal_configuration_audit (
             fiscal_profile_id, fiscal_register_id, actor_user_id, actor_label,
             command, reason, before_hash, after_hash, before_snapshot, after_snapshot
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
        [
            fiscalProfileId,
            fiscalRegisterId,
            plan.actorUserId,
            plan.actorLabel,
            command,
            reason,
            configHash(beforeSnapshot),
            configHash(afterSnapshot),
            JSON.stringify(beforeSnapshot),
            JSON.stringify(afterSnapshot)
        ]
    );
}

async function diffPlan(client, plan) {
    const status = await statusPlan(client, plan);
    const desired = desiredSnapshot(plan);
    const before = status.found ? status.configSnapshot : {};
    return {
        found: status.found,
        beforeHash: status.found ? status.configHash : configHash({}),
        afterHash: configHash(desired),
        changes: diffSnapshots(before, desired)
    };
}

async function replaceTaxMappings(client, plan) {
    const beforeStatus = await statusPlan(client, plan);
    if (!beforeStatus.found || !beforeStatus.fiscalRegisterId) {
        throw new PilotConfigError('pilot_config_register_missing', 'Configured park middle register does not exist');
    }
    for (const item of plan.items) {
        await client.query(
            `INSERT INTO fiscal_item_mappings (
                 fiscal_profile_id, fiscal_register_id, crm_profile_key, source_type, item_type,
                 item_code, fiscal_item_name, provider, provider_tax_id, tax_code, tax_rate_bps, tax_mode, status
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
             ON CONFLICT (fiscal_profile_id, fiscal_register_id, source_type, item_type, item_code, provider) DO UPDATE
                 SET fiscal_item_name = EXCLUDED.fiscal_item_name,
                     provider_tax_id = EXCLUDED.provider_tax_id,
                     tax_code = EXCLUDED.tax_code,
                     tax_rate_bps = EXCLUDED.tax_rate_bps,
                     tax_mode = EXCLUDED.tax_mode,
                     status = 'active',
                     updated_at = NOW()`,
            [
                beforeStatus.fiscalProfileId,
                beforeStatus.fiscalRegisterId,
                plan.crmProfileKey,
                SOURCE_TYPE,
                ITEM_TYPE,
                item.itemCode,
                item.fiscalItemName,
                PROVIDER,
                item.providerTaxId,
                item.taxCode,
                item.taxRateBps,
                item.taxMode || 'taxed'
            ]
        );
    }
    const requestedCodes = plan.items.map(item => item.itemCode);
    await client.query(
        `UPDATE fiscal_item_mappings
            SET status = 'archived',
                updated_at = NOW()
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND source_type = $3
            AND item_type = $4
            AND provider = $5
            AND status = 'active'
            AND NOT (item_code = ANY($6::text[]))`,
        [beforeStatus.fiscalProfileId, beforeStatus.fiscalRegisterId, SOURCE_TYPE, ITEM_TYPE, PROVIDER, requestedCodes]
    );
    const afterStatus = await statusPlan(client, plan);
    await writeConfigAudit(client, plan, {
        command: plan.mode,
        fiscalProfileId: beforeStatus.fiscalProfileId,
        fiscalRegisterId: beforeStatus.fiscalRegisterId,
        beforeSnapshot: beforeStatus.configSnapshot,
        afterSnapshot: afterStatus.configSnapshot
    });
    return { mode: plan.mode, fiscalProfileId: beforeStatus.fiscalProfileId, fiscalRegisterId: beforeStatus.fiscalRegisterId, diff: diffSnapshots(beforeStatus.configSnapshot, afterStatus.configSnapshot) };
}

async function rotateBinding(client, plan, env = process.env) {
    const beforeStatus = await statusPlan(client, plan);
    if (!beforeStatus.found || !beforeStatus.fiscalRegisterId || !beforeStatus.fiscalLocationId) {
        throw new PilotConfigError('pilot_config_register_missing', 'Configured park middle register does not exist');
    }
    const pinHashes = await actionPinHashesByUser(env, plan.capabilities, plan.cashierUserIds);
    await client.query(
        `UPDATE fiscal_cashier_bindings
            SET status = 'suspended',
                updated_at = NOW()
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND status = 'active'`,
        [beforeStatus.fiscalProfileId, beforeStatus.fiscalRegisterId]
    );
    for (const userId of plan.cashierUserIds) {
        const pinHash = pinHashes.get(userId) || null;
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
                beforeStatus.fiscalProfileId,
                beforeStatus.fiscalRegisterId,
                beforeStatus.fiscalLocationId,
                plan.crmProfileKey,
                userId,
                PROVIDER,
                plan.providerCashierId,
                plan.cashierLoginRef,
                capabilitiesForUser(plan, userId),
                pinHash,
                pinHash ? userId : null
            ]
        );
    }
    const afterStatus = await statusPlan(client, plan);
    await writeConfigAudit(client, plan, {
        command: plan.mode,
        fiscalProfileId: beforeStatus.fiscalProfileId,
        fiscalRegisterId: beforeStatus.fiscalRegisterId,
        beforeSnapshot: beforeStatus.configSnapshot,
        afterSnapshot: afterStatus.configSnapshot
    });
    return { mode: plan.mode, fiscalProfileId: beforeStatus.fiscalProfileId, fiscalRegisterId: beforeStatus.fiscalRegisterId, diff: diffSnapshots(beforeStatus.configSnapshot, afterStatus.configSnapshot) };
}

async function changeOwner(client, plan) {
    const beforeStatus = await statusPlan(client, plan);
    if (!beforeStatus.found || !beforeStatus.fiscalRegisterId) {
        throw new PilotConfigError('pilot_config_register_missing', 'Configured park middle register does not exist');
    }
    const ownerBinding = await client.query(
        `SELECT id
           FROM fiscal_cashier_bindings
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND user_id = $3
            AND status = 'active'
          FOR UPDATE`,
        [beforeStatus.fiscalProfileId, beforeStatus.fiscalRegisterId, plan.integrationOwner]
    );
    if (ownerBinding.rows.length !== 1) {
        throw new PilotConfigError('pilot_config_integration_owner_binding_required', 'Integration owner must have one active exact binding before owner rotation');
    }
    await client.query(
        `UPDATE fiscal_registers
            SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{integration_owner}', to_jsonb($1::integer), true),
                updated_at = NOW()
          WHERE id = $2
            AND fiscal_profile_id = $3
            AND register_alias = $4`,
        [plan.integrationOwner, beforeStatus.fiscalRegisterId, beforeStatus.fiscalProfileId, plan.registerAlias]
    );
    await client.query(
        `UPDATE fiscal_cashier_bindings
            SET capability_scope = CASE
                    WHEN user_id = $3
                    THEN ARRAY(
                        SELECT DISTINCT capability
                          FROM unnest(capability_scope || ARRAY['fiscal.shift.close']::text[]) AS capability
                    )
                    ELSE ARRAY(
                        SELECT capability
                          FROM unnest(capability_scope) AS capability
                         WHERE capability <> 'fiscal.shift.close'
                    )
                END,
                updated_at = NOW()
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND status = 'active'`,
        [beforeStatus.fiscalProfileId, beforeStatus.fiscalRegisterId, plan.integrationOwner]
    );
    const afterStatus = await statusPlan(client, plan);
    await writeConfigAudit(client, plan, {
        command: plan.mode,
        fiscalProfileId: beforeStatus.fiscalProfileId,
        fiscalRegisterId: beforeStatus.fiscalRegisterId,
        beforeSnapshot: beforeStatus.configSnapshot,
        afterSnapshot: afterStatus.configSnapshot
    });
    return { mode: plan.mode, fiscalProfileId: beforeStatus.fiscalProfileId, fiscalRegisterId: beforeStatus.fiscalRegisterId, diff: diffSnapshots(beforeStatus.configSnapshot, afterStatus.configSnapshot) };
}

async function setRegisterEnabled(client, plan, enabled) {
    const beforeStatus = await statusPlan(client, plan);
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
    const afterStatus = await statusPlan(client, plan);
    await writeConfigAudit(client, plan, {
        command: plan.mode,
        fiscalProfileId: beforeStatus.fiscalProfileId,
        fiscalRegisterId: beforeStatus.fiscalRegisterId,
        beforeSnapshot: beforeStatus.configSnapshot || {},
        afterSnapshot: afterStatus.configSnapshot || {}
    });
    return { fiscalRegisterId: Number(result.rows[0].id), featureEnabled: result.rows[0].feature_enabled === true };
}

function assertMutationAllowed(env) {
    if (String(env[APPLY_CONFIRM_ENV] || '').toLowerCase() !== APPLY_CONFIRM_VALUE) {
        throw new PilotConfigError('pilot_config_apply_not_allowed', `Set ${APPLY_CONFIRM_ENV}=true to mutate pilot configuration`);
    }
}

async function assertMutationActorAuthorized(client, plan) {
    if (!isMutationMode(plan.mode)) return null;
    if (!plan.actorUserId) {
        throw new PilotConfigError('pilot_config_actor_user_required', 'Mutating configuration commands require exact --actor-user-id');
    }
    const result = await client.query(
        `SELECT id, username, name, role, extra_roles, action_allowlist, action_denylist, is_active
           FROM users
          WHERE id = $1
          LIMIT 1
          FOR UPDATE`,
        [plan.actorUserId]
    );
    const actor = result.rows[0] || null;
    if (!actor) {
        throw new PilotConfigError('pilot_config_actor_user_not_found', 'Configuration actor user was not found');
    }
    if (actor.is_active !== true) {
        throw new PilotConfigError('pilot_config_actor_user_inactive', 'Configuration actor user is not active');
    }
    const decision = resolveCapability(actor, 'fiscal.configure');
    if (!decision.allowed) {
        throw new PilotConfigError('pilot_config_actor_forbidden', 'Configuration actor lacks non-delegable fiscal.configure capability', {
            details: { reason: decision.reason || null }
        });
    }
    return actor;
}

async function run(argv = process.argv.slice(2), { env = process.env, dbPool = pool } = {}) {
    if (isHelpRequest(argv)) return { help: true, usage: cliUsage() };
    const plan = parseArgs(argv, env);
    if (plan.mode === 'dry-run') return { applied: false, plan: publicPlan(plan) };
    const client = await dbPool.connect();
    try {
        if (plan.mode === 'status') {
            return { mode: plan.mode, status: await statusPlan(client, plan) };
        }
        if (plan.mode === 'diff') {
            return { mode: plan.mode, diff: await diffPlan(client, plan), plan: publicPlan(plan) };
        }
        if (plan.mode === 'preflight') {
            const preflight = await preflightPlan(client, plan);
            return { mode: plan.mode, ok: preflight.ok, preflight, plan: publicPlan(plan) };
        }
        assertMutationAllowed(env);
        await client.query('BEGIN');
        await assertMutationActorAuthorized(client, plan);
        if (plan.mode === 'apply' || plan.mode === 'create') {
            const statusBefore = await statusPlan(client, plan);
            let preflightBefore = null;
            if (!statusBefore.found) {
                preflightBefore = await preflightPlan(client, plan);
                if (!preflightBefore.ok) {
                    throw new PilotConfigError('pilot_config_preflight_failed', `Preflight failed; refusing ${plan.mode}`, { details: preflightBefore });
                }
            }
            const result = await applyPlan(client, plan, env);
            const preflightAfter = await preflightPlan(client, plan, { useStoredMappings: true });
            if (!preflightAfter.ok) {
                throw new PilotConfigError('pilot_config_post_apply_preflight_failed', 'Post-apply preflight failed; rolling back', { details: preflightAfter });
            }
            await client.query('COMMIT');
            return { applied: true, ...result, preflight: preflightAfter, plan: publicPlan(plan) };
        }
        if (plan.mode === 'replace-tax-mapping') {
            const result = await replaceTaxMappings(client, plan);
            const preflightAfter = await preflightPlan(client, plan, { useStoredMappings: true });
            if (!preflightAfter.ok) {
                throw new PilotConfigError('pilot_config_post_tax_mapping_preflight_failed', 'Post-replace preflight failed; rolling back', { details: preflightAfter });
            }
            await client.query('COMMIT');
            return { mode: plan.mode, applied: true, ...result, preflight: preflightAfter };
        }
        if (plan.mode === 'rotate-binding') {
            const preflightBefore = await preflightPlan(client, plan, { useStoredMappings: true });
            if (!preflightBefore.ok) {
                throw new PilotConfigError('pilot_config_preflight_failed', 'Preflight failed; refusing rotate-binding', { details: preflightBefore });
            }
            const result = await rotateBinding(client, plan, env);
            await client.query('COMMIT');
            return { mode: plan.mode, applied: true, ...result };
        }
        if (plan.mode === 'change-owner') {
            const result = await changeOwner(client, plan);
            await client.query('COMMIT');
            return { mode: plan.mode, applied: true, ...result };
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
    const argv = process.argv.slice(2);
    run(argv)
        .then(result => {
            console.log(result.help ? result.usage : JSON.stringify(result, null, 2));
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
    ACTION_PIN_USER_ENV_PREFIX,
    APPLY_CONFIRM_ENV,
    CONFIG_FILE_ENV,
    NPM_CONFIG_FILE_ENV,
    DEFAULT_CAPABILITIES,
    INTEGRATION_OWNER_CAPABILITIES,
    PIN_REQUIRED_CAPABILITIES,
    PilotConfigError,
    assertNonSecretConfig,
    actionPinEnvNameForUser,
    actionPinHashesByUser,
    activeAdmissionTicketCodes,
    applyPlan,
    capabilitiesForUser,
    configHash,
    cliUsage,
    desiredSnapshot,
    diffPlan,
    diffSnapshots,
    normalizePlan,
    optionsFromConfigFile,
    parseArgs,
    parseItem,
    preflightPlan,
    publicPlan,
    replaceTaxMappings,
    requiresActionPin,
    run,
    setRegisterEnabled,
    statusPlan
};
