'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    acceptanceDisabled,
    assertSecretFree,
    deriveConfig,
    parseArgs
} = require('../scripts/prepare-checkbox-single-register-qa');
const { safeProviderResult } = require('../scripts/checkbox-single-register-readonly-preflight');

function baseConfig() {
    return {
        crmProfileKey: 'event_genix',
        locationAlias: 'park',
        registerAlias: 'middle',
        registerDisplayName: 'Середня каса',
        legalEntityKey: 'test_legal_entity',
        legalEntityName: 'Test legal entity',
        taxIdentifier: 'test-tax-id',
        expectedIsTest: true,
        providerOrganizationId: 'organization-id',
        providerOutletId: null,
        providerRegisterId: 'register-id',
        providerCashierId: 'cashier-id',
        registerCredentialRef: 'test_register',
        cashierCredentialRef: 'test_cashier',
        items: Array.from({ length: 6 }, (_, index) => ({
            itemCode: `admission_${index + 1}`,
            fiscalItemName: `Admission ${index + 1}`,
            taxMode: 'untaxed',
            providerTaxId: null,
            taxCode: null,
            taxRateBps: null
        }))
    };
}

test('DAR derives the same physical test identity for sequential use without credentials', () => {
    const base = baseConfig();
    const config = deriveConfig(base, 'dar');
    assert.equal(config.crmProfileKey, 'dar');
    assert.equal(config.locationAlias, 'dar');
    assert.equal(config.registerAlias, 'dar');
    assert.equal(config.providerOrganizationId, base.providerOrganizationId);
    assert.equal(config.providerRegisterId, base.providerRegisterId);
    assert.equal(config.providerCashierId, base.providerCashierId);
    assert.deepEqual(config.items, []);
    assert.equal(config.identityVerification.reuseMode, 'single_physical_test_register_sequential_only');
    assert.doesNotMatch(JSON.stringify(config), /password|licenseKey|accessKey|deviceCredential/i);
});

test('setup rejects non-test identity, secret-bearing config and enabled acceptance', () => {
    assert.throws(() => deriveConfig({ ...baseConfig(), expectedIsTest: false }, 'dar'), /expectedIsTest=true/);
    assert.throws(() => assertSecretFree({ password: 'forbidden' }), /Secret-bearing config key/);
    assert.equal(acceptanceDisabled({ CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'false' }), true);
    assert.equal(acceptanceDisabled({ CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true' }), false);
});

test('CLI requires an explicit single business context and config path', () => {
    const parsed = parseArgs(['apply', '--business-context=event_genix', '--config-file=fixture.json']);
    assert.equal(parsed.mode, 'apply');
    assert.equal(parsed.businessContext, 'event_genix');
    assert.match(parsed.configFile, /fixture\.json$/);
    assert.throws(() => parseArgs(['apply', '--business-context=both', '--config-file=fixture.json']), /event_genix or dar/);
});

test('read-only preflight provider output exposes statuses but no identities or credentials', () => {
    const safe = safeProviderResult({
        ready: true,
        checks: [
            { code: 'auth', status: 'ready', ready: true, details: { credentialRef: 'never-return-this' } },
            { code: 'register_identity', status: 'ready', ready: true, details: { registerId: 'never-return-this' } },
            { code: 'current_shift', status: 'not_applicable', ready: true, details: { shiftStatus: 'none', shiftId: 'never-return-this' } }
        ]
    });
    const serialized = JSON.stringify(safe);
    assert.equal(safe.mutations, false);
    assert.equal(safe.checks.current_shift.shiftState, 'none');
    assert.doesNotMatch(serialized, /never-return-this|credentialRef|registerId|shiftId/);
});
