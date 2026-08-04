'use strict';

const { CheckboxClientError, redactCheckboxDiagnostics } = require('./errors');

const DEFAULT_OPENAPI_URL = 'https://api.checkbox.in.ua/api/openapi.json';
const DEFAULT_CLIENT_NAME = 'EventGenix Checkbox Sandbox QA';
const DEFAULT_CLIENT_VERSION = 'eventgenix-checkbox-sandbox-smoke';

function boolEnv(value) {
    return /^(1|true|yes|on|sandbox)$/i.test(String(value || '').trim());
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
    loadCheckboxSandboxConfig,
    publicConfigSummary,
    assertSandboxBaseUrl
};
