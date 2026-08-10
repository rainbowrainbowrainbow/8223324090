#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function fail(message) {
    process.stderr.write(`[checkbox-openapi] ${message}\n`);
    process.exitCode = 1;
}

function assertIncludes(source, needle, label) {
    if (!source.includes(needle)) fail(`${label} must include ${needle}`);
}

function assertMatches(source, pattern, label) {
    if (!pattern.test(source)) fail(`${label} must match ${pattern}`);
}

function assertNotMatches(source, pattern, label) {
    if (pattern.test(source)) fail(`${label} must not match ${pattern}`);
}

const client = read('services/checkbox/client.js');
const provider = read('services/checkbox/provider.js');
const webhook = read('services/checkbox/webhookAuth.js');
const sandbox = read('scripts/checkbox-sandbox-smoke.js');
const providerTests = read('tests/checkbox-provider-bridge.test.js');
const readinessTests = read('tests/payment-readiness.test.js');
const postgresSmoke = read('tests/integration/checkbox-park-cashier-smoke.integration.test.js');
const browserSmoke = read('tests/browser/checkbox-cashier-real-routes-browser-smoke.js');

for (const [needle, label] of [
    ['/api/v1/cashier/signin', 'cashier signin'],
    ['/api/v1/cashier/signinPinCode', 'cashier PIN signin'],
    ['/api/v1/cashier/me', 'cashier identity'],
    ['/api/v1/cash-registers/info', 'cash register info'],
    ['/api/v1/cashier/check-signature', 'cashier signature'],
    ['/api/v1/cashier/tax', 'cashier tax list'],
    ['/api/v1/cashier/shift', 'current shift'],
    ['/api/v1/shifts/', 'shift detail lookup'],
    ['/api/v1/receipts/validate', 'receipt validation'],
    ['/api/v1/receipts/sell', 'sale receipt'],
    ['/api/v1/receipts/', 'receipt lookup']
]) {
    assertIncludes(client, needle, `services/checkbox/client.js ${label}`);
}

assertMatches(client, /X-License-Key/i, 'client license header');
assertMatches(client, /pin_code/, 'client official CashierSignInPinCode payload');
assertMatches(client, /X-Access-Key/i, 'client access-key header');
assertMatches(webhook, /x-request-signature/i, 'webhook official signature header');
assertMatches(webhook, /digest\('base64'\)/, 'webhook bare Base64 HMAC-SHA256');

for (const officialField of ['organization_id', 'is_test', 'offline_mode', 'stay_offline', 'documents_state']) {
    assertIncludes(provider, officialField, `provider official CashRegisterDeviceModel field ${officialField}`);
}
assertNotMatches(
    provider,
    /cashRegister(?:Info)?\.(?:active|status)|register(?:Info)?\.(?:active|status)|\bactive\s*===\s*true/,
    'provider official cash-register readiness'
);
assertNotMatches(
    providerTests,
    /cashRegister(?:Info)?\.(?:active|status)|register(?:Info)?\.(?:active|status)|\bactive\s*===\s*true/,
    'provider tests official cash-register readiness'
);
assertNotMatches(
    postgresSmoke,
    /cash-registers\/info[\s\S]{0,700}\bactive\b/,
    'PostgreSQL local HTTP cash-register fixture'
);

assertMatches(readinessTests, /tax_mode = 'untaxed'/, 'readiness source contract for untaxed tax mode');
assertMatches(readinessTests, /tax_mode = 'taxed'/, 'readiness source contract for taxed tax mode');
assertMatches(postgresSmoke, /listUnresolvedPaymentOrders/, 'PostgreSQL unresolved queue regression');
assertMatches(postgresSmoke, /loadCheckboxSalesReport/, 'PostgreSQL sales report regression');
assertMatches(browserSmoke, /\/api\/payments\/unresolved-orders/, 'real-routes browser unresolved endpoint');
assertMatches(browserSmoke, /\/api\/payments\/checkbox-sales-report/, 'real-routes browser sales report endpoint');
assertMatches(browserSmoke, /provider_unavailable/, 'real-routes browser provider unavailable state');
assertMatches(browserSmoke, /keyboard/i, 'real-routes browser keyboard flow assertion');
assertMatches(sandbox, /is_test[\s\S]{0,200}true|expectedIsTest/, 'sandbox harness test-mode proof');

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write('[checkbox-openapi] Value-free Checkbox OpenAPI compatibility gate passed\n');
