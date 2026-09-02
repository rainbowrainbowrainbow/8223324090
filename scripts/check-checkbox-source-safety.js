#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCOPES = [
    '.github/workflows/ci.yml',
    'package.json',
    'config/checkboxOpenApiContract.js',
    'services/checkbox',
    'services/payments',
    'routes/payments.js',
    'scripts/checkbox-outbox-recovery.js',
    'scripts/check-checkbox-openapi-compatibility.js',
    'scripts/checkbox-readiness-status.js',
    'scripts/checkbox-sandbox-smoke.js',
    'scripts/configure-checkbox-park-pilot.js',
    'scripts/run-isolated-postgres-tests.js',
    'db/migrations/337_checkbox_shift_recovery_stage_constraints.sql',
    'docs/integrations/checkbox',
    'tests/helpers/checkbox-browser-fetch-shim.js',
    'tests/checkbox-provider-bridge.test.js',
    'tests/checkbox-openapi-contract.test.js',
    'tests/checkbox-sandbox-harness.test.js',
    'tests/checkbox-park-config.test.js',
    'tests/checkbox-fullstack-testmode-harness.test.js',
    'tests/checkbox-webhook-reconciliation.test.js',
    'tests/fiscal-cashier-operations.test.js',
    'tests/payment-workflow.test.js',
    'tests/payment-readiness.test.js',
    'tests/payment-fiscal-ledger-foundation.test.js',
    'tests/integration/checkbox-park-cashier-smoke.integration.test.js',
    'tests/integration/checkbox-park-config.integration.test.js',
    'tests/browser/checkbox-cashier-real-routes-browser-smoke.js',
    'tests/browser/checkbox-cashier-real-testmode-browser-smoke.js',
    'cashier-payments.html',
    'css/cashier-payments.css',
    'js/cashier-payments-page.js',
    'tests/browser/cashier-payments-browser-smoke.js',
    'tests/ui-check.js'
];

function walk(entry) {
    const absolute = path.join(ROOT, entry);
    if (!fs.existsSync(absolute)) return [];
    const stat = fs.statSync(absolute);
    if (stat.isFile()) return [absolute];
    const files = [];
    for (const child of fs.readdirSync(absolute)) {
        if (child === 'node_modules' || child === '.git') continue;
        files.push(...walk(path.join(entry, child)));
    }
    return files;
}

function relative(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

const SCANNABLE_TEXT_FILE = /\.(?:js|cjs|mjs|sql|md|html|css|json|ya?ml|ps1|env|example)$/i;
const PRODUCTION_GATES = new Set([
    'CHECKBOX_INTEGRATION_ENABLED',
    'CHECKBOX_ACCEPT_PAYMENTS_ENABLED',
    'CHECKBOX_WEBHOOK_ENABLED',
    'EVENTGENIX_CASHIER_PRO_ENABLED'
]);
const SENSITIVE_ENV_KEY = /(?:^|_)(?:LOGIN|USERNAME|PASSWORD|PASSCODE|PIN(?:_CODE)?|LICENSE_KEY|ACCESS_KEY|WEBHOOK_SECRET|ACCESS_TOKEN|TOKEN|DEVICE_ID)$/i;
const pinPattern = /\b(?:pin|PIN|ПІН|пін)[^.\n]{0,40}\b1234\b|\b1234\b[^.\n]{0,40}(?:pin|PIN|ПІН|пін)/;
const QUOTED_CREDENTIAL_LITERAL = /\b((?:[A-Za-z0-9]+_)*(?:login|username|password|passcode|pin(?:_code)?|license_key|access_key|webhook_secret|access_token|token|device_id)|pinCode|licenseKey|accessKey|webhookSecret|accessToken|deviceId)\b["']?\s*[:=]\s*(["'`])([^"'`\r\n]*)\2/gi;
const YAML_CREDENTIAL_LITERAL = /^\s*["']?(login|username|password|passcode|pin(?:[_-]?code)?|license[_-]?key|access[_-]?key|webhook[_-]?secret|access[_-]?token|token|device[_-]?id)["']?\s*:\s*([^#\r\n]+?)\s*$/gim;
const SAFE_SYNTHETIC_TEST_CREDENTIALS = new Set([
    'abc123',
    'access-key',
    'access-secret',
    'cashier',
    'cashier-login',
    'cashier-password',
    'cashier-ref-device',
    'device',
    'eventgenix-browser-smoke-device',
    'eventgenix-explicit-test-device',
    'eventgenix-pin-device',
    'eventgenix-smoke-device',
    'eventgenix-test-device',
    'global-cashier',
    'global-license',
    'global-password',
    'inactive',
    'license',
    'license-key',
    'license-secret',
    'mock-password',
    'password',
    'password-secret',
    'pin-token',
    'provider-secret-token',
    'qwerty',
    'sandbox-token',
    'secret',
    'secret-password',
    'stable-explicit-test-device',
    'stable-test-device-identity',
    'token-1'
]);

function isScannableFile(file) {
    return SCANNABLE_TEXT_FILE.test(String(file || ''));
}

function normalizeAssignmentValue(value) {
    let normalized = String(value || '').trim().replace(/,\s*$/, '').trim();
    const quote = normalized[0];
    if ((quote === '"' || quote === "'") && normalized.endsWith(quote)) {
        normalized = normalized.slice(1, -1).trim();
    }
    return normalized;
}

function isEmptyOrExplicitPlaceholder(value) {
    const normalized = normalizeAssignmentValue(value);
    return !normalized || /^<[^>\r\n]+>$/.test(normalized) || normalized === '[redacted]';
}

function isApprovedSyntheticTestCredential(rel, value) {
    if (!/^tests\//.test(rel)) return false;
    const normalized = normalizeAssignmentValue(value);
    return SAFE_SYNTHETIC_TEST_CREDENTIALS.has(normalized)
        || /^mock-(?:login|password|license|access|device)(?:-[a-z0-9_-]+)?$/i.test(normalized)
        || /^mock-(?:pin-)?token-(?:[a-z0-9_-]+|\$\{[^}\r\n]+\})$/i.test(normalized)
        || /^token-(?:\d+|\$\{[A-Za-z][A-Za-z0-9]*\})$/i.test(normalized)
        || /^(?:actor|user)-\$\{[^}\r\n]+\}$/i.test(normalized)
        || /^checkbox_config_actor_\$\{[A-Za-z][A-Za-z0-9]*\}$/i.test(normalized)
        || /^(?:natalia|cashier)_http_smoke(?:_second)?_\$\{process\.pid\}$/i.test(normalized);
}

function parseEnvAssignment(line) {
    const match = String(line || '').match(
        /^\s*(?:export\s+|\$env:)?["']?(CHECKBOX_[A-Z0-9_<>-]+|EVENTGENIX_CASHIER_PRO_ENABLED)["']?\s*[:=]\s*(.*?)\s*(?:#.*)?$/i
    );
    if (!match) return null;
    return { name: match[1].toUpperCase(), value: normalizeAssignmentValue(match[2]) };
}

function isConfigurationSurface(rel) {
    return /^docs\/integrations\/checkbox\//.test(rel)
        || /^\.github\/workflows\//.test(rel)
        || /(?:^|\/)package\.json$/.test(rel);
}

function scanJsonConfiguration(rel, value, failures, pathParts = []) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => scanJsonConfiguration(rel, item, failures, [...pathParts, String(index)]));
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
        const name = key.toUpperCase();
        const itemPath = [...pathParts, key].join('.');
        if (PRODUCTION_GATES.has(name) && String(item).trim().toLowerCase() !== 'false') {
            failures.push(`${rel}: production fiscal gate ${itemPath} must remain literal false in repository configuration`);
        }
        if (SENSITIVE_ENV_KEY.test(name) && !isEmptyOrExplicitPlaceholder(item)) {
            failures.push(`${rel}: sensitive Checkbox JSON value ${itemPath} must be empty or an explicit placeholder`);
        }
        scanJsonConfiguration(rel, item, failures, [...pathParts, key]);
    }
}

function scanContent(rel, body) {
    const failures = [];
    if (pinPattern.test(body)) failures.push(`${rel}: hard-coded 1234 PIN-like value`);

    if (/\.json$/i.test(rel)) {
        try {
            scanJsonConfiguration(rel, JSON.parse(body), failures);
        } catch {
            failures.push(`${rel}: invalid JSON cannot be safety-scanned`);
        }
    }

    if (isConfigurationSurface(rel)) {
        for (const [index, line] of body.split(/\r?\n/).entries()) {
            const assignment = parseEnvAssignment(line);
            if (!assignment) continue;
            if (PRODUCTION_GATES.has(assignment.name) && assignment.value.toLowerCase() !== 'false') {
                failures.push(`${rel}:${index + 1}: production fiscal gate must remain literal false in repository configuration`);
            }
            if (SENSITIVE_ENV_KEY.test(assignment.name) && !isEmptyOrExplicitPlaceholder(assignment.value)) {
                failures.push(`${rel}:${index + 1}: sensitive Checkbox environment value must be empty or an explicit placeholder`);
            }
        }
    }

    for (const match of body.matchAll(QUOTED_CREDENTIAL_LITERAL)) {
        const value = match[3];
        if (isEmptyOrExplicitPlaceholder(value) || isApprovedSyntheticTestCredential(rel, value)) continue;
        failures.push(`${rel}: credential-like literal assigned to ${String(match[1]).toLowerCase()}`);
    }

    if (/\.ya?ml$/i.test(rel)) {
        for (const match of body.matchAll(YAML_CREDENTIAL_LITERAL)) {
            const value = normalizeAssignmentValue(match[2]);
            if (isEmptyOrExplicitPlaceholder(value) || isApprovedSyntheticTestCredential(rel, value)) continue;
            failures.push(`${rel}: credential-like YAML literal assigned to ${String(match[1]).toLowerCase()}`);
        }
    }
    return [...new Set(failures)];
}

function scanScopedFiles() {
    const files = [...new Set(SCOPES.flatMap(walk))].filter(isScannableFile);
    return files.flatMap(file => scanContent(relative(file), fs.readFileSync(file, 'utf8')));
}

function main() {
    const failures = scanScopedFiles();
    if (failures.length) {
        process.stderr.write(`[checkbox-safety] ${failures.length} issue(s) found:\n`);
        for (const failure of failures) process.stderr.write(`- ${failure}\n`);
        process.exitCode = 1;
        return;
    }
    process.stdout.write('[checkbox-safety] Checkbox source safety scan passed\n');
}

if (require.main === module) main();

module.exports = {
    isScannableFile,
    parseEnvAssignment,
    scanContent,
    scanScopedFiles
};
