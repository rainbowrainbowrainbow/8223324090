'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    FullstackTestModeError,
    acquireMutationRunRecord,
    assertFullstackTestModeInputs,
    isFiscalizedOrderState
} = require('./browser/checkbox-cashier-real-testmode-browser-smoke');

function writeConfig(overrides = {}) {
    const { __withBom = false, ...configOverrides } = overrides;
    const filePath = path.join(os.tmpdir(), `checkbox-fullstack-guard-${crypto.randomUUID()}.json`);
    const ticketCodes = [
        'regular_child',
        'under_3_child',
        'discounted_child',
        'birthday_child',
        'adult_companion',
        'adult_game'
    ];
    const config = {
        crmProfileKey: 'event_genix',
        locationAlias: 'park',
        registerAlias: 'middle',
        legalEntityKey: 'test-fop',
        legalEntityName: 'Test FOP',
        taxIdentifier: 'test-tax-id',
        providerOrganizationId: 'test-org-id',
        providerRegisterId: 'test-register-id',
        providerCashierId: 'test-cashier-id',
        credentialRef: 'park-middle-test',
        expectedIsTest: true,
        integrationOwnerUserId: 4,
        cashierUserIds: [3, 4],
        eventGenixUsers: {
            primaryTestCashierUserId: 3,
            primaryTestCashierName: 'Natalia test cashier',
            cashierUserIds: [3, 4],
            integrationOwnerUserIds: [4]
        },
        priceSource: 'EventGenix admission tariff immutable snapshot',
        items: ticketCodes.map(itemCode => ({ itemCode, fiscalItemName: `Test ${itemCode}`, taxMode: 'untaxed' })),
        ...configOverrides
    };
    fs.writeFileSync(filePath, `${__withBom ? '\uFEFF' : ''}${JSON.stringify(config)}`, 'utf8');
    return filePath;
}

function baseEnv(configFile, overrides = {}) {
    return {
        NODE_ENV: 'test',
        TEST_DATABASE_URL: 'postgres://test_user:test_pass@127.0.0.1:5432/eventgenix_checkbox_test',
        TEST_DATABASE_RESET_CONFIRM: 'RESET_DISPOSABLE_TEST_DATABASE',
        DATABASE_URL: '',
        TEST_URL: 'http://127.0.0.1:31415',
        REQUIRE_ISOLATED_TEST_TARGET: 'true',
        ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true',
        CHECKBOX_FULLSTACK_TESTMODE_STAGE: 'preflight',
        CHECKBOX_FULLSTACK_TESTMODE_CONFIG_FILE: configFile,
        CHECKBOX_INTEGRATION_ENABLED: 'true',
        CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'false',
        CHECKBOX_WEBHOOK_ENABLED: 'false',
        EVENTGENIX_CASHIER_PRO_ENABLED: 'false',
        CHECKBOX_EXPECT_IS_TEST: 'true',
        CHECKBOX_PARK_MIDDLE_TEST_BASE_URL: 'https://api.checkbox.in.ua',
        CHECKBOX_PARK_MIDDLE_TEST_AUTH_MODE: 'password',
        CHECKBOX_PARK_MIDDLE_TEST_LOGIN: 'mock-login',
        CHECKBOX_PARK_MIDDLE_TEST_PASSWORD: 'mock-password',
        CHECKBOX_PARK_MIDDLE_TEST_LICENSE_KEY: 'mock-license',
        CHECKBOX_PARK_MIDDLE_TEST_DEVICE_ID: 'stable-explicit-test-device',
        CHECKBOX_FULLSTACK_TESTMODE_RUN_ID: crypto.randomUUID(),
        CHECKBOX_FULLSTACK_TESTMODE_RUN_LEDGER_DIR: os.tmpdir(),
        ...overrides
    };
}

test('full-stack preflight accepts only local DB, official host, exact test identity and stable device', t => {
    const configFile = writeConfig({ __withBom: true });
    t.after(() => fs.rmSync(configFile, { force: true }));
    const guard = assertFullstackTestModeInputs(baseEnv(configFile));
    assert.equal(guard.stage, 'preflight');
    assert.equal(guard.testDb.isLocal, true);
    assert.equal(guard.runtimeConfig.expectedIsTest, true);
    assert.equal(guard.runtimeConfig.deviceId, 'stable-explicit-test-device');
});

test('full-stack harness resolves stable device from the cashier credential ref', t => {
    const configFile = writeConfig({
        credentialRef: 'park-register-test',
        registerCredentialRef: 'park-register-test',
        cashierCredentialRef: 'park-cashier-test'
    });
    t.after(() => fs.rmSync(configFile, { force: true }));
    const env = baseEnv(configFile, {
        CHECKBOX_PARK_MIDDLE_TEST_BASE_URL: undefined,
        CHECKBOX_PARK_MIDDLE_TEST_AUTH_MODE: undefined,
        CHECKBOX_PARK_MIDDLE_TEST_LOGIN: undefined,
        CHECKBOX_PARK_MIDDLE_TEST_PASSWORD: undefined,
        CHECKBOX_PARK_MIDDLE_TEST_LICENSE_KEY: undefined,
        CHECKBOX_PARK_MIDDLE_TEST_DEVICE_ID: undefined,
        CHECKBOX_PARK_REGISTER_TEST_BASE_URL: 'https://api.checkbox.in.ua',
        CHECKBOX_PARK_REGISTER_TEST_LICENSE_KEY: 'mock-license',
        CHECKBOX_PARK_CASHIER_TEST_AUTH_MODE: 'password',
        CHECKBOX_PARK_CASHIER_TEST_LOGIN: 'mock-login',
        CHECKBOX_PARK_CASHIER_TEST_PASSWORD: 'mock-password',
        CHECKBOX_PARK_CASHIER_TEST_DEVICE_ID: 'cashier-ref-device'
    });
    const guard = assertFullstackTestModeInputs(env);
    assert.equal(guard.runtimeConfig.credentialRef, 'park-cashier-test');
    assert.equal(guard.runtimeConfig.licenseRef, 'park-register-test');
    assert.equal(guard.runtimeConfig.deviceId, 'cashier-ref-device');
});

test('mutation stage requires separate payment acceptance, mutation and owned-shift confirmations', t => {
    const configFile = writeConfig();
    t.after(() => fs.rmSync(configFile, { force: true }));
    const mutationEnv = baseEnv(configFile, {
        CHECKBOX_FULLSTACK_TESTMODE_STAGE: 'mutations',
        CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true'
    });
    assert.throws(
        () => assertFullstackTestModeInputs(mutationEnv),
        error => error instanceof FullstackTestModeError && error.code === 'checkbox_fullstack_mutation_confirmation_required'
    );
    assert.throws(
        () => assertFullstackTestModeInputs({
            ...mutationEnv,
            CHECKBOX_FULLSTACK_TESTMODE_CONFIRM_MUTATIONS: 'sandbox'
        }),
        error => error instanceof FullstackTestModeError && error.code === 'checkbox_fullstack_shift_cleanup_required'
    );
    const guard = assertFullstackTestModeInputs({
        ...mutationEnv,
        CHECKBOX_FULLSTACK_TESTMODE_CONFIRM_MUTATIONS: 'sandbox',
        CHECKBOX_FULLSTACK_TESTMODE_CLOSE_SHIFT: 'true'
    });
    assert.equal(guard.stage, 'mutations');
});

test('card-only recovery requires its exact additional confirmation', t => {
    const configFile = writeConfig();
    t.after(() => fs.rmSync(configFile, { force: true }));
    const recoveryEnv = baseEnv(configFile, {
        CHECKBOX_FULLSTACK_TESTMODE_STAGE: 'card_recovery',
        CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true',
        CHECKBOX_FULLSTACK_TESTMODE_CONFIRM_MUTATIONS: 'sandbox',
        CHECKBOX_FULLSTACK_TESTMODE_CLOSE_SHIFT: 'true'
    });
    assert.throws(
        () => assertFullstackTestModeInputs(recoveryEnv),
        error => error instanceof FullstackTestModeError
            && error.code === 'checkbox_fullstack_card_recovery_confirmation_required'
    );
    const guard = assertFullstackTestModeInputs({
        ...recoveryEnv,
        CHECKBOX_FULLSTACK_TESTMODE_RECOVERY_CONFIRM: 'card-only-after-fiscalized-cash'
    });
    assert.equal(guard.stage, 'card_recovery');
});

test('final one-card proof requires its own exact confirmation', t => {
    const configFile = writeConfig();
    t.after(() => fs.rmSync(configFile, { force: true }));
    const finalEnv = baseEnv(configFile, {
        CHECKBOX_FULLSTACK_TESTMODE_STAGE: 'final_card_close',
        CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true',
        CHECKBOX_FULLSTACK_TESTMODE_CONFIRM_MUTATIONS: 'sandbox',
        CHECKBOX_FULLSTACK_TESTMODE_CLOSE_SHIFT: 'true'
    });
    assert.throws(
        () => assertFullstackTestModeInputs(finalEnv),
        error => error instanceof FullstackTestModeError
            && error.code === 'checkbox_fullstack_final_card_close_confirmation_required'
    );
    const guard = assertFullstackTestModeInputs({
        ...finalEnv,
        CHECKBOX_FULLSTACK_TESTMODE_FINAL_CLOSE_CONFIRM: 'one-card-canonical-close'
    });
    assert.equal(guard.stage, 'final_card_close');
    assert.equal(guard.resumeFinalDraft, false);
    const resumeGuard = assertFullstackTestModeInputs({
        ...finalEnv,
        CHECKBOX_FULLSTACK_TESTMODE_FINAL_CLOSE_CONFIRM: 'one-card-canonical-close',
        CHECKBOX_FULLSTACK_TESTMODE_RESUME_DRAFT_CONFIRM: 'resume-one-local-unpaid-draft'
    });
    assert.equal(resumeGuard.resumeFinalDraft, true);
    assert.throws(
        () => assertFullstackTestModeInputs({
            ...finalEnv,
            CHECKBOX_FULLSTACK_TESTMODE_FINAL_CLOSE_CONFIRM: 'one-card-canonical-close',
            CHECKBOX_FULLSTACK_TESTMODE_RESUME_DRAFT_CONFIRM: 'unsafe'
        }),
        error => error instanceof FullstackTestModeError
            && error.code === 'checkbox_fullstack_final_draft_resume_confirmation_invalid'
    );
});

test('full-stack proof fails closed for missing device, wrong mode, unsafe host or production context', t => {
    const configFile = writeConfig();
    t.after(() => fs.rmSync(configFile, { force: true }));
    const env = baseEnv(configFile);
    const { CHECKBOX_PARK_MIDDLE_TEST_DEVICE_ID, ...withoutDevice } = env;
    assert.throws(
        () => assertFullstackTestModeInputs(withoutDevice),
        error => error instanceof FullstackTestModeError && error.code === 'checkbox_fullstack_stable_device_required'
    );
    assert.throws(
        () => assertFullstackTestModeInputs({ ...env, CHECKBOX_EXPECT_IS_TEST: 'false' }),
        error => error instanceof FullstackTestModeError && error.code === 'checkbox_fullstack_test_identity_required'
    );
    assert.throws(
        () => assertFullstackTestModeInputs({ ...env, CHECKBOX_PARK_MIDDLE_TEST_BASE_URL: 'https://example.test' }),
        /official HTTPS Checkbox host/
    );
    assert.throws(
        () => assertFullstackTestModeInputs({ ...env, RAILWAY_ENVIRONMENT: 'production' }),
        error => error instanceof FullstackTestModeError && error.code === 'checkbox_fullstack_production_environment_forbidden'
    );
    assert.throws(
        () => assertFullstackTestModeInputs({ ...env, ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'false' }),
        error => error instanceof FullstackTestModeError && error.code === 'checkbox_fullstack_runner_attestation_required'
    );
});

test('preflight cannot silently enable payment acceptance and mutation stage cannot silently disable it', t => {
    const configFile = writeConfig();
    t.after(() => fs.rmSync(configFile, { force: true }));
    assert.throws(
        () => assertFullstackTestModeInputs(baseEnv(configFile, { CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true' })),
        error => error instanceof FullstackTestModeError && error.code === 'checkbox_fullstack_acceptance_stage_mismatch'
    );
    assert.throws(
        () => assertFullstackTestModeInputs(baseEnv(configFile, {
            CHECKBOX_FULLSTACK_TESTMODE_STAGE: 'mutations',
            CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'false',
            CHECKBOX_FULLSTACK_TESTMODE_CONFIRM_MUTATIONS: 'sandbox',
            CHECKBOX_FULLSTACK_TESTMODE_CLOSE_SHIFT: 'true'
        })),
        error => error instanceof FullstackTestModeError && error.code === 'checkbox_fullstack_acceptance_stage_mismatch'
    );
});

test('mutation run ID is single-use and leaves a local-only non-secret recovery record', t => {
    const configFile = writeConfig();
    const ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkbox-fullstack-run-ledger-'));
    t.after(() => fs.rmSync(configFile, { force: true }));
    t.after(() => fs.rmSync(ledgerDir, { recursive: true, force: true }));
    const guard = assertFullstackTestModeInputs(baseEnv(configFile, {
        CHECKBOX_FULLSTACK_TESTMODE_STAGE: 'mutations',
        CHECKBOX_ACCEPT_PAYMENTS_ENABLED: 'true',
        CHECKBOX_FULLSTACK_TESTMODE_CONFIRM_MUTATIONS: 'sandbox',
        CHECKBOX_FULLSTACK_TESTMODE_CLOSE_SHIFT: 'true',
        CHECKBOX_FULLSTACK_TESTMODE_RUN_LEDGER_DIR: ledgerDir
    }));
    const record = acquireMutationRunRecord(guard);
    record.update('failed_requires_inspection');
    const stored = JSON.parse(fs.readFileSync(record.recordPath, 'utf8'));
    assert.deepEqual(Object.keys(stored).sort(), ['runId', 'startedAt', 'state', 'updatedAt'].sort());
    assert.equal(stored.state, 'failed_requires_inspection');
    assert.throws(
        () => acquireMutationRunRecord(guard),
        error => error instanceof FullstackTestModeError && error.code === 'checkbox_fullstack_run_already_used'
    );
});

test('full-stack drain recognizes the canonical fiscalized receipt state', () => {
    assert.equal(isFiscalizedOrderState({
        payment_status: 'confirmed',
        fiscal_status: 'fiscalized',
        operation_count: 1,
        receipt_count: 1,
        job_count: 1,
        receipts_fiscalized: true
    }), true);
    assert.equal(isFiscalizedOrderState({
        payment_status: 'confirmed',
        fiscal_status: 'fiscalized',
        operation_count: 1,
        receipt_count: 1,
        job_count: 1,
        receipts_fiscalized: false
    }), false);
    assert.equal(isFiscalizedOrderState({
        payment_status: 'draft',
        fiscal_status: 'fiscalized',
        operation_count: 1,
        receipt_count: 1,
        job_count: 1,
        receipts_fiscalized: true
    }), false);
    const harness = fs.readFileSync(
        path.join(__dirname, 'browser', 'checkbox-cashier-real-testmode-browser-smoke.js'),
        'utf8'
    );
    assert.match(harness, /fr\.status = 'fiscalized'[\s\S]*AS receipts_fiscalized/);
    assert.doesNotMatch(harness, /fr\.status = 'succeeded'/);
    assert.match(
        harness,
        /closeOwnedSandboxShift\([\s\S]*result\.closed === true[\s\S]*probeCheckboxReadiness\([\s\S]*lifecycle_stage[\s\S]*CLOSED/
    );
});

test('card recovery validates the preserved cash proof before mutation and can only create card', () => {
    const harness = fs.readFileSync(
        path.join(__dirname, 'browser', 'checkbox-cashier-real-testmode-browser-smoke.js'),
        'utf8'
    );
    const runBlock = harness.slice(harness.indexOf('async function run()'), harness.indexOf('function fail(error)'));
    assert.match(
        runBlock,
        /recoveryBaseline = await loadCardRecoveryBaseline\(guard\.local\);[\s\S]*cashier = await seedExactUsers/
    );
    assert.match(
        runBlock,
        /scope = isCardRecovery[\s\S]*verifyExistingCardRecoveryScope[\s\S]*configureDisposableScope/
    );
    const recoveryStart = runBlock.indexOf("if (isCardRecovery) {", runBlock.indexOf('readiness.integrationReady'));
    const recoveryBranch = runBlock.slice(
        recoveryStart,
        runBlock.indexOf('await assertNoLocalFiscalMutations();', recoveryStart)
    );
    assert.match(recoveryBranch, /createAndConfirmOrder\(page, 'card_terminal_manual'\)/);
    assert.doesNotMatch(recoveryBranch, /createAndConfirmOrder\(page, 'cash'\)/);
    assert.match(recoveryBranch, /loadExactSaleShift[\s\S]*baselineShiftId/);
    assert.match(recoveryBranch, /closeOwnedShiftThroughEventGenix[\s\S]*shiftId: recoveryShiftId/);
    assert.match(recoveryBranch, /assertCardRecoveryFinal/);
});

test('final proof starts empty, creates only card and closes through EventGenix Phase-1', () => {
    const harness = fs.readFileSync(
        path.join(__dirname, 'browser', 'checkbox-cashier-real-testmode-browser-smoke.js'),
        'utf8'
    );
    const runBlock = harness.slice(harness.indexOf('async function run()'), harness.indexOf('function fail(error)'));
    const finalStart = runBlock.indexOf('if (isFinalCardClose) {');
    const mutationReadinessGuard = runBlock.indexOf("if (readiness.integrationReady !== true || readiness.readinessCode !== 'ready')");
    assert.ok(mutationReadinessGuard > 0 && mutationReadinessGuard < finalStart, 'exact provider readiness must be checked before final-card mutation');
    const finalBranch = runBlock.slice(finalStart, runBlock.indexOf("await assertNoLocalFiscalMutations();\n\n        const cashOrderId", finalStart));
    assert.match(finalBranch, /assertNoLocalFiscalMutations\(\)/);
    assert.match(finalBranch, /createAndConfirmOrder\(page, 'card_terminal_manual'\)/);
    assert.match(finalBranch, /confirmExistingCardDraft[\s\S]*loadExactResumableCardDraft/);
    assert.doesNotMatch(finalBranch, /createAndConfirmOrder\(page, 'cash'\)/);
    assert.match(finalBranch, /closeOwnedShiftThroughEventGenix[\s\S]*shiftId: recoveryShiftId/);
    assert.match(finalBranch, /assertFinalCardClose/);
    assert.match(finalBranch, /closePath: 'eventgenix_phase1'/);
    assert.match(harness, /assertFinalCardClose[\s\S]*AS attempt_valid[\s\S]*AS allocation_valid/);
    assert.match(harness, /row\.attempt_count === 1[\s\S]*row\.attempt_valid === true[\s\S]*row\.allocation_count === 1[\s\S]*row\.allocation_valid === true/);
    assert.match(harness, /mutationRun\?\.update\('completed'\);\s*completed = true;/);
    assert.match(harness, /checkbox_fullstack_run_ledger_update_failed[\s\S]*cleanupOwnedShiftIfNeeded/);
});

test('card recovery runner preserves the exact disposable ledger and never resets it', () => {
    const runner = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'run-isolated-postgres-tests.js'),
        'utf8'
    );
    assert.match(runner, /checkbox-ui-testmode-card-recovery/);
    assert.match(
        runner,
        /preserveCheckboxRecoveryState[\s\S]*assertExactCheckboxCardRecoveryState\(testDb\)[\s\S]*else \{[\s\S]*resetPublicSchema\(testDb\)/
    );
    assert.match(
        runner,
        /if \(preserveCheckboxRecoveryState\) \{[\s\S]*Preserving disposable Checkbox card-recovery proof[\s\S]*else if/
    );
});

test('final one-card runner starts from an empty disposable DB and preserves proof state', () => {
    const runner = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'run-isolated-postgres-tests.js'),
        'utf8'
    );
    assert.match(runner, /checkbox-ui-testmode-final-card-close/);
    assert.match(
        runner,
        /preserveFailedCheckboxMutationState = suiteMode === 'checkbox-ui-testmode'[\s\S]*checkbox-ui-testmode-final-card-close/
    );
    assert.match(
        runner,
        /preserveCheckboxFinalProofState[\s\S]*assertNoPreservedCheckboxMutationState\(testDb\)[\s\S]*resetPublicSchema\(testDb\)/
    );
    assert.match(runner, /Preserving disposable Checkbox final card-close proof/);
    assert.match(
        runner,
        /resumeCheckboxFinalDraft[\s\S]*assertExactCheckboxFinalDraftState\(testDb\)[\s\S]*else \{[\s\S]*resetPublicSchema\(testDb\)/
    );
});

test('owned-shift close and cleanup support an exact recovery shift id', () => {
    const harness = fs.readFileSync(
        path.join(__dirname, 'browser', 'checkbox-cashier-real-testmode-browser-smoke.js'),
        'utf8'
    );
    assert.match(harness, /localOwnedShift\(scope, cashier, \{ shiftId = null, excludeShiftId = null \} = \{\}\)/);
    assert.match(harness, /cleanupOwnedShiftIfNeeded\([\s\S]*targetShiftId[\s\S]*baselineShiftId/);
    assert.doesNotMatch(harness, /fiscal_receipts\s+WHERE[^;]*fiscal_register_id/);
});
