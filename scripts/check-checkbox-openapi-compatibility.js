#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PINNED = require('../config/checkboxOpenApiContract');

const ROOT = path.resolve(__dirname, '..');
const VERIFY_OFFICIAL = process.argv.includes('--official');
const failures = [];

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function fail(message) {
    failures.push(message);
}

function assertCondition(condition, message) {
    if (!condition) fail(message);
}

function assertIncludes(source, needle, label) {
    assertCondition(source.includes(needle), `${label} must include ${needle}`);
}

function assertMatches(source, pattern, label) {
    assertCondition(pattern.test(source), `${label} must match ${pattern}`);
}

function assertNotMatches(source, pattern, label) {
    assertCondition(!pattern.test(source), `${label} must not match ${pattern}`);
}

function sortedStrings(values) {
    return [...new Set((values || []).map(String))].sort();
}

function sameStringSet(actual, expected) {
    return JSON.stringify(sortedStrings(actual)) === JSON.stringify(sortedStrings(expected));
}

function refName(schema) {
    const ref = schema?.$ref;
    return typeof ref === 'string' && ref.startsWith('#/components/schemas/')
        ? ref.slice('#/components/schemas/'.length)
        : null;
}

function successCode(operationContract) {
    return operationContract.responses.find(code => /^2\d\d$/.test(code)) || null;
}

function responseSchema(operation, code) {
    const content = operation?.responses?.[code]?.content || {};
    return content['application/json']?.schema
        || content['text/html']?.schema
        || Object.values(content)[0]?.schema
        || null;
}

function resolveSchema(openApi, name) {
    return openApi?.components?.schemas?.[name] || null;
}

function validatePinnedManifest() {
    assertCondition(PINNED.sourceUrl === 'https://api.checkbox.in.ua/api/openapi.json', 'pinned source URL must be the official Checkbox HTTPS OpenAPI URL');
    assertCondition(/^\d{4}-\d{2}-\d{2}$/.test(PINNED.observedAt || ''), 'pinned contract must include observedAt');
    assertCondition(Boolean(PINNED.observedVersion), 'pinned contract must include observedVersion');
    const keys = PINNED.operations.map(operation => `${operation.method.toUpperCase()} ${operation.path}`);
    assertCondition(keys.length === new Set(keys).size, 'pinned operations must be unique');
    assertCondition(PINNED.units.quantityScale === 1000, 'pinned quantity scale must be 1000');
    assertCondition(PINNED.units.maximumTaxIdsPerGood === 2, 'pinned tax limit must be two IDs per good');
}

function validateOperation(openApi, operationContract) {
    const pathItem = openApi?.paths?.[operationContract.path];
    const operation = pathItem?.[operationContract.method];
    const label = `${operationContract.method.toUpperCase()} ${operationContract.path}`;
    if (!operation) {
        fail(`official OpenAPI is missing ${label}`);
        return;
    }

    const actualResponses = Object.keys(operation.responses || {});
    assertCondition(
        sameStringSet(actualResponses, operationContract.responses),
        `${label} response codes drifted: expected ${operationContract.responses.join(',')}, got ${actualResponses.join(',')}`
    );

    if (operationContract.requestSchema) {
        const request = operation.requestBody?.content?.['application/json']?.schema;
        assertCondition(refName(request) === operationContract.requestSchema, `${label} request schema must remain ${operationContract.requestSchema}`);
    }

    const code = successCode(operationContract);
    const schema = responseSchema(operation, code);
    if (operationContract.successSchema) {
        assertCondition(refName(schema) === operationContract.successSchema, `${label} ${code} schema must remain ${operationContract.successSchema}`);
    }
    if (operationContract.successArrayItemSchema) {
        assertCondition(schema?.type === 'array', `${label} ${code} response must remain an array`);
        assertCondition(refName(schema?.items) === operationContract.successArrayItemSchema, `${label} ${code} item schema must remain ${operationContract.successArrayItemSchema}`);
    }
    if (operationContract.successAdditionalPropertiesType) {
        assertCondition(
            schema?.type === 'object' && schema?.additionalProperties?.type === operationContract.successAdditionalPropertiesType,
            `${label} ${code} must remain object<${operationContract.successAdditionalPropertiesType}>`
        );
    }

    const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])];
    for (const headerName of operationContract.requiredHeaders || []) {
        const header = parameters.find(parameter => parameter.in === 'header' && String(parameter.name).toLowerCase() === headerName.toLowerCase());
        assertCondition(Boolean(header), `${label} must expose ${headerName}`);
        assertCondition(header?.required === true, `${label} ${headerName} must remain required`);
    }
}

function validateProperty(schemaName, propertyName, actual, expected) {
    const label = `${schemaName}.${propertyName}`;
    if (!actual) {
        fail(`official OpenAPI is missing ${label}`);
        return;
    }
    if (expected.type) assertCondition(actual.type === expected.type, `${label} type must remain ${expected.type}`);
    if (expected.format) assertCondition(actual.format === expected.format, `${label} format must remain ${expected.format}`);
    if (expected.ref) assertCondition(refName(actual) === expected.ref, `${label} ref must remain ${expected.ref}`);
    if (expected.itemRef) assertCondition(refName(actual.items) === expected.itemRef, `${label} item ref must remain ${expected.itemRef}`);
    if (expected.enum) assertCondition(sameStringSet(actual.enum, expected.enum), `${label} enum drifted`);
    if (expected.anyArrayItemTypes) {
        const actualTypes = (actual.anyOf || [])
            .filter(branch => branch?.type === 'array')
            .map(branch => branch?.items?.type)
            .filter(Boolean);
        assertCondition(sameStringSet(actualTypes, expected.anyArrayItemTypes), `${label} array item types drifted`);
        assertCondition((actual.anyOf || []).every(branch => branch?.type !== 'array' || branch.maxItems === PINNED.units.maximumTaxIdsPerGood), `${label} maxItems must remain ${PINNED.units.maximumTaxIdsPerGood}`);
    }
}

function validateSchema(openApi, schemaName, contract) {
    const schema = resolveSchema(openApi, schemaName);
    if (!schema) {
        fail(`official OpenAPI is missing schema ${schemaName}`);
        return;
    }
    if (contract.required) {
        assertCondition(
            sameStringSet(schema.required || [], contract.required),
            `${schemaName}.required drifted: expected ${contract.required.join(',')}, got ${(schema.required || []).join(',')}`
        );
    }
    for (const [propertyName, expected] of Object.entries(contract.properties || {})) {
        validateProperty(schemaName, propertyName, schema.properties?.[propertyName], expected);
    }
}

function validateEnum(openApi, schemaName, expectedValues) {
    const schema = resolveSchema(openApi, schemaName);
    assertCondition(Boolean(schema), `official OpenAPI is missing enum ${schemaName}`);
    if (schema) assertCondition(sameStringSet(schema.enum, expectedValues), `${schemaName} enum drifted`);
}

function validateUnits(openApi) {
    const quantity = resolveSchema(openApi, 'GoodItemPayload')?.properties?.quantity;
    const price = resolveSchema(openApi, 'GoodDetailsPayload')?.properties?.price;
    const cashValue = resolveSchema(openApi, 'CashPaymentPayload')?.properties?.value;
    const cardValue = resolveSchema(openApi, 'CardPaymentPayload')?.properties?.value;
    assertCondition(quantity?.type === 'integer' && /1000/.test(String(quantity?.title || quantity?.description || '')), 'GoodItemPayload.quantity must remain integer with scale 1000');
    assertCondition(price?.type === 'integer' && /1000/.test(String(price?.title || price?.description || '')), 'GoodDetailsPayload.price must remain integer minor units per quantity 1000');
    assertCondition(cashValue?.type === 'integer', 'CashPaymentPayload.value must remain integer minor units');
    assertCondition(cardValue?.type === 'integer', 'CardPaymentPayload.value must remain integer minor units');
    for (const totalField of ['total_sum', 'total_payment', 'total_rest']) {
        assertCondition(resolveSchema(openApi, 'ReceiptOperativeDTO')?.properties?.[totalField]?.type === 'integer', `ReceiptOperativeDTO.${totalField} must remain integer minor units`);
    }
}

function validateOfficialOpenApi(openApi) {
    const start = failures.length;
    assertCondition(/^3\./.test(String(openApi?.openapi || '')), 'official document must be OpenAPI 3.x');
    for (const operation of PINNED.operations) validateOperation(openApi, operation);
    for (const [schemaName, contract] of Object.entries(PINNED.schemas)) validateSchema(openApi, schemaName, contract);
    for (const [schemaName, expectedValues] of Object.entries(PINNED.enums)) validateEnum(openApi, schemaName, expectedValues);
    validateUnits(openApi);
    return failures.slice(start);
}

function validateLocalProjection() {
    const client = read('services/checkbox/client.js');
    const mapper = read('services/checkbox/mapper.js');
    const provider = read('services/checkbox/provider.js');
    const webhook = read('services/checkbox/webhookAuth.js');
    const sandbox = read('scripts/checkbox-sandbox-smoke.js');
    const providerTests = read('tests/checkbox-provider-bridge.test.js');
    const readinessTests = read('tests/payment-readiness.test.js');
    const postgresSmoke = read('tests/integration/checkbox-park-cashier-smoke.integration.test.js');
    const browserSmoke = read('tests/browser/checkbox-cashier-real-routes-browser-smoke.js');

    for (const operation of PINNED.operations) {
        const staticPrefix = operation.path.split('{')[0];
        assertIncludes(client, staticPrefix, `services/checkbox/client.js ${operation.method.toUpperCase()} ${operation.path}`);
    }

    assertMatches(client, /X-License-Key/i, 'client license header');
    assertMatches(client, /pin_code/, 'client official CashierSignInPinCode payload');
    assertMatches(client, /X-Access-Key/i, 'client access-key header');
    assertMatches(client, /X-Device-ID/i, 'client device header');
    assertMatches(client, /'pdf'[\s\S]{0,100}'qrcode'/, 'client official receipt artifact formats');
    assertMatches(webhook, /x-request-signature/i, 'separate official webhook documentation signature header');
    assertMatches(webhook, /digest\('base64'\)/, 'separate official webhook documentation bare Base64 HMAC-SHA256');

    for (const officialField of ['organization_id', 'is_test', 'offline_mode', 'stay_offline', 'has_shift', 'documents_state']) {
        assertIncludes(provider, officialField, `provider official CashRegisterDeviceModel field ${officialField}`);
    }
    assertMatches(providerTests, /cashRegisterInfo[\s\S]{0,700}\bhas_shift\s*:/, 'provider tests official CashRegisterDeviceModel has_shift field');
    assertMatches(postgresSmoke, /cash-registers\/info[\s\S]{0,700}\bhas_shift\s*:/, 'PostgreSQL local HTTP CashRegisterDeviceModel has_shift field');
    assertNotMatches(provider, /cashRegister(?:Info)?\.(?:active|status)|register(?:Info)?\.(?:active|status)|\bactive\s*===\s*true/, 'provider official cash-register readiness');
    assertNotMatches(providerTests, /cashRegister(?:Info)?\.(?:active|status)|register(?:Info)?\.(?:active|status)|\bactive\s*===\s*true/, 'provider tests official cash-register readiness');
    assertNotMatches(postgresSmoke, /cash-registers\/info[\s\S]{0,700}\bactive\b/, 'PostgreSQL local HTTP cash-register fixture');

    assertMatches(mapper, /quantityMillis[\s\S]{0,300}1000/, 'mapper quantity scale');
    assertMatches(mapper, /BigInt\(item\.quantity\)[\s\S]{0,80}\/\s*1000n/, 'mapper price per quantity 1000');
    assertMatches(mapper, /admission_tariff:/, 'mapper internal tax reference rejection');
    assertMatches(mapper, /taxIds\.length\s*>\s*2/, 'mapper official two-tax maximum');
    assertMatches(readinessTests, /tax_mode = 'untaxed'/, 'readiness source contract for untaxed tax mode');
    assertMatches(readinessTests, /tax_mode = 'taxed'/, 'readiness source contract for taxed tax mode');
    assertMatches(postgresSmoke, /listUnresolvedPaymentOrders/, 'PostgreSQL unresolved queue regression');
    assertMatches(postgresSmoke, /loadCheckboxSalesReport/, 'PostgreSQL sales report regression');
    assertMatches(browserSmoke, /\/api\/payments\/unresolved-orders/, 'real-routes browser unresolved endpoint');
    assertMatches(browserSmoke, /\/api\/payments\/checkbox-sales-report/, 'real-routes browser sales report endpoint');
    assertMatches(browserSmoke, /provider_unavailable/, 'real-routes browser provider unavailable state');
    assertMatches(browserSmoke, /keyboard/i, 'real-routes browser keyboard flow assertion');
    assertMatches(sandbox, /is_test[\s\S]{0,200}true|expectedIsTest/, 'sandbox harness test-mode proof');
}

async function loadOfficialOpenApi() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(PINNED.sourceUrl, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    validatePinnedManifest();
    validateLocalProjection();
    let officialVersion = null;
    if (VERIFY_OFFICIAL) {
        const official = await loadOfficialOpenApi();
        officialVersion = official?.info?.version || null;
        validateOfficialOpenApi(official);
    }

    if (failures.length) {
        for (const message of failures) process.stderr.write(`[checkbox-openapi] ${message}\n`);
        process.exitCode = 1;
        return;
    }

    const suffix = VERIFY_OFFICIAL
        ? `; official ${officialVersion || 'unknown'} is compatible with pinned ${PINNED.observedVersion}`
        : `; pinned official projection ${PINNED.observedVersion}`;
    process.stdout.write(`[checkbox-openapi] Value-free semantic Checkbox compatibility gate passed${suffix}\n`);
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`[checkbox-openapi] Official contract check failed: ${error?.message || error}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    refName,
    sameStringSet,
    validateOfficialOpenApi,
    validatePinnedManifest
};
