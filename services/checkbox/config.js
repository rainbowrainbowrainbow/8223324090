'use strict';

const { CheckboxClientError, redactCheckboxDiagnostics } = require('./errors');

const DEFAULT_OPENAPI_URL = 'https://api.checkbox.in.ua/api/openapi.json';
const DEFAULT_CLIENT_NAME = 'EventGenix Checkbox Sandbox QA';
const DEFAULT_CLIENT_VERSION = 'eventgenix-checkbox-sandbox-smoke';
const DEFAULT_RUNTIME_CLIENT_NAME = 'EventGenix Checkbox Runtime';
const DEFAULT_RUNTIME_CLIENT_VERSION = 'eventgenix-checkbox-runtime';
const OFFICIAL_CHECKBOX_API_HOSTS = Object.freeze([
    'api.checkbox.in.ua',
    'api.checkbox.ua'
]);

function boolEnv(value) {
    return /^(1|true|yes|on|sandbox)$/i.test(String(value || '').trim());
}

function parseRequiredBooleanEnv(env, name) {
    const raw = String(env[name] || '').trim().toLowerCase();
    if (!raw) {
        throw new CheckboxClientError('checkbox_expected_is_test_required', `${name} must be explicitly true or false when Checkbox integration is enabled`, {
            status: 503,
            retryable: false
        });
    }
    if (['true', '1', 'yes', 'on'].includes(raw)) return true;
    if (['false', '0', 'no', 'off'].includes(raw)) return false;
    throw new CheckboxClientError('checkbox_expected_is_test_invalid', `${name} must be true or false`, {
        status: 503,
        retryable: false,
        details: { name }
    });
}

function isCheckboxIntegrationEnabled(env = process.env) {
    return boolEnv(env.CHECKBOX_INTEGRATION_ENABLED);
}

function isCheckboxPaymentAcceptanceEnabled(env = process.env) {
    return boolEnv(env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED);
}

function isCheckboxWebhookEnabled(env = process.env) {
    return boolEnv(env.CHECKBOX_WEBHOOK_ENABLED);
}

function isCashierProEnabled(env = process.env) {
    return boolEnv(env.EVENTGENIX_CASHIER_PRO_ENABLED);
}

function normalizeCredentialRef(value) {
    const ref = String(value || '').trim();
    if (!ref || !/^[A-Za-z0-9_:-]+$/.test(ref)) return '';
    return ref;
}

function credentialEnvPrefix(ref) {
    const safe = normalizeCredentialRef(ref)
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
    return safe ? `CHECKBOX_${safe}` : '';
}

function readRefEnv(env, ref, suffix) {
    const prefix = credentialEnvPrefix(ref);
    if (!prefix) return '';
    return String(env[`${prefix}_${suffix}`] || '').trim();
}

function assertNoCredentialRefCollisions(refs = []) {
    const byPrefix = new Map();
    for (const ref of refs.map(normalizeCredentialRef).filter(Boolean)) {
        const prefix = credentialEnvPrefix(ref);
        if (!prefix) continue;
        const existing = byPrefix.get(prefix);
        if (existing && existing !== ref) {
            throw new CheckboxClientError('checkbox_credential_ref_collision', 'Checkbox credential references resolve to the same environment prefix', {
                status: 503,
                retryable: false,
                details: { refs: [existing, ref], prefix }
            });
        }
        byPrefix.set(prefix, ref);
    }
}

function assertRuntimeBaseUrl(baseUrl, { allowLocalMockHost = false } = {}) {
    let parsed;
    try { parsed = new URL(baseUrl); }
    catch {
        throw new CheckboxClientError('checkbox_runtime_base_url_invalid', 'Checkbox runtime base URL must be a valid URL', { status: 503, retryable: false });
    }
    const host = parsed.hostname.toLowerCase();
    const isLocalHttp = allowLocalMockHost === true && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(host);
    const isOfficialHttps = parsed.protocol === 'https:' && OFFICIAL_CHECKBOX_API_HOSTS.includes(host);
    if (!isLocalHttp && !isOfficialHttps) {
        throw new CheckboxClientError('checkbox_runtime_base_url_not_allowed', 'Checkbox runtime base URL must be an official HTTPS Checkbox host; local HTTP is allowed only through explicit test injection', {
            status: 503,
            retryable: false,
            details: { host, protocol: parsed.protocol }
        });
    }
    return parsed.origin;
}

function loadCheckboxRuntimeConfig({ env = process.env, credentialRef, licenseRef = credentialRef, deviceRef = credentialRef, allowLocalMockHost = false } = {}) {
    const cashierRef = normalizeCredentialRef(credentialRef);
    const registerRef = normalizeCredentialRef(licenseRef);
    const deviceRuntimeRef = normalizeCredentialRef(deviceRef);
    if (!cashierRef && !registerRef) {
        throw new CheckboxClientError('checkbox_credential_ref_missing', 'Checkbox credential reference is required', { status: 503, retryable: false });
    }
    assertNoCredentialRefCollisions([cashierRef, registerRef, deviceRuntimeRef]);
    const baseUrl = readRefEnv(env, registerRef || cashierRef, 'BASE_URL');
    const login = readRefEnv(env, cashierRef || registerRef, 'LOGIN');
    const password = readRefEnv(env, cashierRef || registerRef, 'PASSWORD');
    const licenseKey = readRefEnv(env, registerRef || cashierRef, 'LICENSE_KEY');
    const accessKey = readRefEnv(env, registerRef || cashierRef, 'ACCESS_KEY') || null;
    const deviceId = readRefEnv(env, deviceRuntimeRef || registerRef || cashierRef, 'DEVICE_ID') || null;
    const missing = [];
    if (!baseUrl) missing.push('BASE_URL');
    if (!login) missing.push('LOGIN');
    if (!password) missing.push('PASSWORD');
    if (!licenseKey) missing.push('LICENSE_KEY');
    if (missing.length) {
        throw new CheckboxClientError('checkbox_runtime_env_missing', `Checkbox runtime env is missing: ${missing.join(', ')}`, {
            status: 503,
            retryable: false,
            details: { credentialRef: cashierRef || null, licenseRef: registerRef || null, missing }
        });
    }
    return {
        baseUrl: assertRuntimeBaseUrl(baseUrl, { allowLocalMockHost }).replace(/\/+$/, ''),
        login,
        password,
        licenseKey,
        accessKey,
        deviceId,
        clientName: String(env.CHECKBOX_CLIENT_NAME || DEFAULT_RUNTIME_CLIENT_NAME).trim(),
        clientVersion: String(env.CHECKBOX_CLIENT_VERSION || DEFAULT_RUNTIME_CLIENT_VERSION).trim(),
        timeoutMs: Math.max(1000, Math.min(Number(env.CHECKBOX_TIMEOUT_MS || 15000), 60000)),
        credentialRef: cashierRef || null,
        licenseRef: registerRef || null,
        expectedIsTest: parseRequiredBooleanEnv(env, 'CHECKBOX_EXPECT_IS_TEST')
    };
}

function requireEnv(env, name) {
    const value = String(env[name] || '').trim();
    if (!value) {
        throw new CheckboxClientError('checkbox_sandbox_env_missing', `${name} is required for sandbox Checkbox QA`, { status: 2, retryable: false });
    }
    return value;
}

function assertSandboxBaseUrl(baseUrl) {
    let parsed;
    try { parsed = new URL(baseUrl); }
    catch {
        throw new CheckboxClientError('checkbox_sandbox_base_url_invalid', 'CHECKBOX_SANDBOX_BASE_URL must be a valid HTTPS URL', { status: 2 });
    }
    if (parsed.protocol !== 'https:') {
        throw new CheckboxClientError('checkbox_sandbox_base_url_not_https', 'CHECKBOX_SANDBOX_BASE_URL must use HTTPS', { status: 2 });
    }
    const host = parsed.hostname.toLowerCase();
    const isOfficial = OFFICIAL_CHECKBOX_API_HOSTS.includes(host);
    if (!isOfficial) {
        throw new CheckboxClientError('checkbox_sandbox_base_url_not_allowed', 'Refusing Checkbox QA because base URL host is not an exact official Checkbox HTTPS API host', {
            status: 2,
            details: { host }
        });
    }
    return parsed.origin;
}

function loadCheckboxSandboxConfig(env = process.env) {
    const baseUrl = assertSandboxBaseUrl(requireEnv(env, 'CHECKBOX_SANDBOX_BASE_URL'));
    const config = {
        baseUrl,
        login: requireEnv(env, 'CHECKBOX_SANDBOX_LOGIN'),
        password: requireEnv(env, 'CHECKBOX_SANDBOX_PASSWORD'),
        licenseKey: requireEnv(env, 'CHECKBOX_SANDBOX_LICENSE_KEY'),
        accessKey: String(env.CHECKBOX_SANDBOX_ACCESS_KEY || '').trim() || null,
        deviceId: String(env.CHECKBOX_SANDBOX_DEVICE_ID || '').trim() || `eventgenix-sandbox-${process.pid}`,
        clientName: String(env.CHECKBOX_SANDBOX_CLIENT_NAME || DEFAULT_CLIENT_NAME).trim(),
        clientVersion: String(env.CHECKBOX_SANDBOX_CLIENT_VERSION || DEFAULT_CLIENT_VERSION).trim(),
        openApiUrl: String(env.CHECKBOX_SANDBOX_OPENAPI_URL || DEFAULT_OPENAPI_URL).trim(),
        timeoutMs: Math.max(1000, Math.min(Number(env.CHECKBOX_SANDBOX_TIMEOUT_MS || 15000), 60000)),
        confirmMutations: String(env.CHECKBOX_SANDBOX_CONFIRM_MUTATIONS || '').trim() === 'sandbox',
        closeShift: boolEnv(env.CHECKBOX_SANDBOX_CLOSE_SHIFT),
        webhookSecret: String(env.CHECKBOX_SANDBOX_WEBHOOK_SECRET || '').trim() || null,
        taxCode: String(env.CHECKBOX_SANDBOX_TAX_CODE || '').trim() || null,
        amountMinor: String(env.CHECKBOX_SANDBOX_AMOUNT_MINOR || '1000').trim(),
        returnAmountMinor: String(env.CHECKBOX_SANDBOX_RETURN_AMOUNT_MINOR || env.CHECKBOX_SANDBOX_AMOUNT_MINOR || '1000').trim(),
        expectedOrganizationId: String(env.CHECKBOX_SANDBOX_EXPECT_ORGANIZATION_ID || '').trim() || null,
        expectedOutletId: String(env.CHECKBOX_SANDBOX_EXPECT_OUTLET_ID || '').trim() || null,
        expectedRegisterId: String(env.CHECKBOX_SANDBOX_EXPECT_REGISTER_ID || '').trim() || null,
        expectedCashierId: String(env.CHECKBOX_SANDBOX_EXPECT_CASHIER_ID || '').trim() || null,
        expectedIsTest: env.CHECKBOX_SANDBOX_EXPECT_IS_TEST == null ? true : boolEnv(env.CHECKBOX_SANDBOX_EXPECT_IS_TEST),
        includeProOperations: boolEnv(env.CHECKBOX_SANDBOX_INCLUDE_PRO)
    };
    return config;
}

function publicConfigSummary(config = {}) {
    return redactCheckboxDiagnostics({
        baseUrl: config.baseUrl,
        deviceId: config.deviceId,
        clientName: config.clientName,
        clientVersion: config.clientVersion,
        openApiUrl: config.openApiUrl,
        timeoutMs: config.timeoutMs,
        confirmMutations: config.confirmMutations,
        closeShift: config.closeShift,
        expectedOrganizationId: config.expectedOrganizationId,
        expectedOutletId: config.expectedOutletId,
        expectedRegisterId: config.expectedRegisterId,
        expectedCashierId: config.expectedCashierId,
        expectedIsTest: config.expectedIsTest,
        includeProOperations: config.includeProOperations,
        hasWebhookSecret: Boolean(config.webhookSecret),
        hasTaxCode: Boolean(config.taxCode)
    });
}

module.exports = {
    DEFAULT_OPENAPI_URL,
    DEFAULT_RUNTIME_CLIENT_NAME,
    DEFAULT_RUNTIME_CLIENT_VERSION,
    OFFICIAL_CHECKBOX_API_HOSTS,
    credentialEnvPrefix,
    assertNoCredentialRefCollisions,
    assertRuntimeBaseUrl,
    isCashierProEnabled,
    isCheckboxIntegrationEnabled,
    isCheckboxPaymentAcceptanceEnabled,
    isCheckboxWebhookEnabled,
    loadCheckboxSandboxConfig,
    loadCheckboxRuntimeConfig,
    normalizeCredentialRef,
    publicConfigSummary,
    assertSandboxBaseUrl,
    assertRuntimeBaseUrl
};
