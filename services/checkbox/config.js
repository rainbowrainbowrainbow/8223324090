'use strict';

const { CheckboxClientError, redactCheckboxDiagnostics } = require('./errors');

const DEFAULT_OPENAPI_URL = 'https://api.checkbox.in.ua/api/openapi.json';
const DEFAULT_CLIENT_NAME = 'EventGenix Checkbox Sandbox QA';
const DEFAULT_CLIENT_VERSION = 'eventgenix-checkbox-sandbox-smoke';
const DEFAULT_RUNTIME_CLIENT_NAME = 'EventGenix Checkbox Runtime';
const DEFAULT_RUNTIME_CLIENT_VERSION = 'eventgenix-checkbox-runtime';

function boolEnv(value) {
    return /^(1|true|yes|on|sandbox)$/i.test(String(value || '').trim());
}

function isCheckboxIntegrationEnabled(env = process.env) {
    return boolEnv(env.CHECKBOX_INTEGRATION_ENABLED);
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

function loadCheckboxRuntimeConfig({ env = process.env, credentialRef, licenseRef = credentialRef, deviceRef = credentialRef } = {}) {
    const cashierRef = normalizeCredentialRef(credentialRef);
    const registerRef = normalizeCredentialRef(licenseRef);
    if (!cashierRef && !registerRef) {
        throw new CheckboxClientError('checkbox_credential_ref_missing', 'Checkbox credential reference is required', { status: 503, retryable: false });
    }
    const baseUrl = readRefEnv(env, registerRef || cashierRef, 'BASE_URL') || String(env.CHECKBOX_BASE_URL || '').trim();
    const login = readRefEnv(env, cashierRef || registerRef, 'LOGIN') || String(env.CHECKBOX_LOGIN || '').trim();
    const password = readRefEnv(env, cashierRef || registerRef, 'PASSWORD') || String(env.CHECKBOX_PASSWORD || '').trim();
    const licenseKey = readRefEnv(env, registerRef || cashierRef, 'LICENSE_KEY') || String(env.CHECKBOX_LICENSE_KEY || '').trim();
    const accessKey = readRefEnv(env, registerRef || cashierRef, 'ACCESS_KEY') || String(env.CHECKBOX_ACCESS_KEY || '').trim() || null;
    const deviceId = readRefEnv(env, deviceRef || registerRef || cashierRef, 'DEVICE_ID') || String(env.CHECKBOX_DEVICE_ID || '').trim() || null;
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
        baseUrl: String(baseUrl).replace(/\/+$/, ''),
        login,
        password,
        licenseKey,
        accessKey,
        deviceId,
        clientName: String(env.CHECKBOX_CLIENT_NAME || DEFAULT_RUNTIME_CLIENT_NAME).trim(),
        clientVersion: String(env.CHECKBOX_CLIENT_VERSION || DEFAULT_RUNTIME_CLIENT_VERSION).trim(),
        timeoutMs: Math.max(1000, Math.min(Number(env.CHECKBOX_TIMEOUT_MS || 15000), 60000)),
        credentialRef: cashierRef || null,
        licenseRef: registerRef || null
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
    if (!/(sandbox|dev|test)/.test(host)) {
        throw new CheckboxClientError('checkbox_sandbox_base_url_not_sandbox', 'Refusing Checkbox QA because base URL host is not sandbox/dev/test', {
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
        returnAmountMinor: String(env.CHECKBOX_SANDBOX_RETURN_AMOUNT_MINOR || env.CHECKBOX_SANDBOX_AMOUNT_MINOR || '1000').trim()
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
        hasWebhookSecret: Boolean(config.webhookSecret),
        hasTaxCode: Boolean(config.taxCode)
    });
}

module.exports = {
    DEFAULT_OPENAPI_URL,
    DEFAULT_RUNTIME_CLIENT_NAME,
    DEFAULT_RUNTIME_CLIENT_VERSION,
    credentialEnvPrefix,
    isCashierProEnabled,
    isCheckboxIntegrationEnabled,
    isCheckboxWebhookEnabled,
    loadCheckboxSandboxConfig,
    loadCheckboxRuntimeConfig,
    normalizeCredentialRef,
    publicConfigSummary,
    assertSandboxBaseUrl
};
