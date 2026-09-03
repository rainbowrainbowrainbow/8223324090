#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { pool } = require('../../db');
const {
    DEFAULT_CAPABILITIES,
    assertNonSecretConfig,
    optionsFromConfigFile,
    run: runPilotConfig
} = require('../../scripts/configure-checkbox-park-pilot');
const {
    assertSafeIsolatedTestUrl,
    assertSafeTestDatabaseUrl
} = require('../../scripts/test-db-safety');
const { closeOwnedSandboxShift } = require('../../scripts/checkbox-sandbox-smoke');
const {
    isCheckboxIntegrationEnabled,
    isCheckboxPaymentAcceptanceEnabled,
    isCheckboxWebhookEnabled,
    isCashierProEnabled,
    loadCheckboxRuntimeConfig
} = require('../../services/checkbox/config');
const { createProviderFromConfig } = require('../../services/checkbox/provider');
const { processPaymentOutboxJobs } = require('../../services/payments/paymentOutboxWorker');
const { probeCheckboxReadiness } = require('../../services/payments/paymentReadinessService');

const ROOT = path.resolve(__dirname, '..', '..');
const CRM_PROFILE_KEY = 'event_genix';
const REGISTER_ALIAS = 'middle';
const STAGES = new Set(['preflight', 'mutations', 'card_recovery', 'final_card_close']);
const MUTATION_STAGES = new Set(['mutations', 'card_recovery', 'final_card_close']);
const MUTATION_CONFIRMATION = 'sandbox';
const CARD_RECOVERY_CONFIRMATION = 'card-only-after-fiscalized-cash';
const FINAL_CARD_CLOSE_CONFIRMATION = 'one-card-canonical-close';
const FINAL_DRAFT_RESUME_CONFIRMATION = 'resume-one-local-unpaid-draft';
const CLOSE_CONFIRMATION = 'true';
const MUTATION_RUN_ID_ENV = 'CHECKBOX_FULLSTACK_TESTMODE_RUN_ID';
const MUTATION_RUN_LEDGER_DIR_ENV = 'CHECKBOX_FULLSTACK_TESTMODE_RUN_LEDGER_DIR';
const MAX_DRAIN_MS = 3 * 60 * 1000;

class FullstackTestModeError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'FullstackTestModeError';
        this.code = code;
    }
}

function bool(value) {
    return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function isPathWithin(candidate, parent) {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function loadLocalTestConfig(configFile) {
    const resolved = path.resolve(String(configFile || '').trim());
    if (!resolved || !fs.existsSync(resolved)) {
        throw new FullstackTestModeError('checkbox_fullstack_config_missing', 'Local Checkbox test config file is required');
    }
    if (isPathWithin(resolved, ROOT)) {
        throw new FullstackTestModeError('checkbox_fullstack_config_must_be_local_only', 'Real test-mode config must stay outside the repository');
    }
    let config;
    try {
        config = JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
        throw new FullstackTestModeError('checkbox_fullstack_config_invalid', 'Local Checkbox test config must be valid JSON');
    }
    assertNonSecretConfig(config);
    return { resolved, config, options: optionsFromConfigFile(resolved) };
}

function assertFullstackTestModeInputs(env = process.env) {
    const stage = String(env.CHECKBOX_FULLSTACK_TESTMODE_STAGE || 'preflight').trim().toLowerCase();
    if (!STAGES.has(stage)) {
        throw new FullstackTestModeError('checkbox_fullstack_stage_invalid', 'Stage must be preflight, mutations, card_recovery, or final_card_close');
    }
    if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production'
        || Object.entries(env).some(([key, value]) => key.startsWith('RAILWAY_') && String(value || '').trim())) {
        throw new FullstackTestModeError('checkbox_fullstack_production_environment_forbidden', 'Real Checkbox test-mode harness cannot run in a production or Railway environment');
    }
    if (String(env.REQUIRE_ISOLATED_TEST_TARGET || '').trim().toLowerCase() !== 'true'
        || String(env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER || '').trim().toLowerCase() !== 'true') {
        throw new FullstackTestModeError(
            'checkbox_fullstack_runner_attestation_required',
            'Real Checkbox test-mode harness must run through the verified isolated PostgreSQL runner'
        );
    }
    if (String(env.DATABASE_URL || '').trim()) {
        throw new FullstackTestModeError('checkbox_fullstack_database_url_forbidden', 'Use only TEST_DATABASE_URL with a disposable local PostgreSQL database');
    }
    const testDb = assertSafeTestDatabaseUrl(env.TEST_DATABASE_URL, { ...env, DATABASE_URL: '' });
    if (!testDb.isLocal) {
        throw new FullstackTestModeError('checkbox_fullstack_local_database_required', 'Real Checkbox test-mode harness requires loopback PostgreSQL');
    }
    const baseUrl = String(env.TEST_URL || '').trim();
    assertSafeIsolatedTestUrl(baseUrl);

    const local = loadLocalTestConfig(env.CHECKBOX_FULLSTACK_TESTMODE_CONFIG_FILE || env.CHECKBOX_PILOT_CONFIG_FILE);
    const requiredConfig = [
        ['providerOrganizationId', local.options.providerOrganizationId],
        ['providerRegisterId', local.options.providerRegisterId],
        ['providerCashierId', local.options.providerCashierId],
        ['providerLicenseRef', local.options.providerLicenseRef],
        ['cashierLoginRef', local.options.cashierLoginRef]
    ];
    const missing = requiredConfig.filter(([, value]) => !String(value || '').trim()).map(([name]) => name);
    if (missing.length) {
        throw new FullstackTestModeError('checkbox_fullstack_identity_config_incomplete', `Local test config is missing ${missing.join(', ')}`);
    }
    if (local.options.expectedIsTest !== true || String(env.CHECKBOX_EXPECT_IS_TEST || '').trim().toLowerCase() !== 'true') {
        throw new FullstackTestModeError('checkbox_fullstack_test_identity_required', 'Both local mapping and runtime must explicitly require is_test=true');
    }

    const runtimeConfig = loadCheckboxRuntimeConfig({
        env,
        credentialRef: local.options.cashierLoginRef,
        licenseRef: local.options.providerLicenseRef,
        deviceRef: local.options.cashierLoginRef,
        allowLocalMockHost: false
    });
    if (runtimeConfig.expectedIsTest !== true) {
        throw new FullstackTestModeError('checkbox_fullstack_runtime_test_identity_required', 'Runtime Checkbox identity must explicitly require is_test=true');
    }
    if (!String(runtimeConfig.deviceId || '').trim()) {
        throw new FullstackTestModeError('checkbox_fullstack_stable_device_required', 'Exact stable Checkbox test device ID is required; automatic device generation is forbidden');
    }
    const runtimeUrl = new URL(runtimeConfig.baseUrl);
    if (runtimeUrl.protocol !== 'https:' || !['api.checkbox.in.ua', 'api.checkbox.ua'].includes(runtimeUrl.hostname.toLowerCase())) {
        throw new FullstackTestModeError('checkbox_fullstack_official_host_required', 'Only the exact official Checkbox HTTPS API hosts are allowed');
    }
    if (!isCheckboxIntegrationEnabled(env)) {
        throw new FullstackTestModeError('checkbox_fullstack_integration_gate_required', 'The isolated child process must explicitly enable the Checkbox provider gate');
    }
    if (isCheckboxWebhookEnabled(env) || isCashierProEnabled(env)) {
        throw new FullstackTestModeError('checkbox_fullstack_phase2_forbidden', 'Webhook and Cashier PRO must remain disabled during the Phase-1 proof');
    }
    const acceptanceEnabled = isCheckboxPaymentAcceptanceEnabled(env);
    if (MUTATION_STAGES.has(stage) !== acceptanceEnabled) {
        throw new FullstackTestModeError('checkbox_fullstack_acceptance_stage_mismatch', 'Payment acceptance must be false for preflight and true only for the explicitly confirmed mutation stage');
    }
    if (MUTATION_STAGES.has(stage)) {
        if (String(env.CHECKBOX_FULLSTACK_TESTMODE_CONFIRM_MUTATIONS || '').trim().toLowerCase() !== MUTATION_CONFIRMATION) {
            throw new FullstackTestModeError('checkbox_fullstack_mutation_confirmation_required', 'Explicit sandbox mutation confirmation is required');
        }
        if (stage === 'card_recovery'
            && String(env.CHECKBOX_FULLSTACK_TESTMODE_RECOVERY_CONFIRM || '').trim().toLowerCase() !== CARD_RECOVERY_CONFIRMATION) {
            throw new FullstackTestModeError(
                'checkbox_fullstack_card_recovery_confirmation_required',
                'Card-only recovery requires its exact additional confirmation'
            );
        }
        if (stage === 'final_card_close'
            && String(env.CHECKBOX_FULLSTACK_TESTMODE_FINAL_CLOSE_CONFIRM || '').trim().toLowerCase() !== FINAL_CARD_CLOSE_CONFIRMATION) {
            throw new FullstackTestModeError(
                'checkbox_fullstack_final_card_close_confirmation_required',
                'Final one-card canonical-close proof requires its exact additional confirmation'
            );
        }
        if (stage === 'final_card_close'
            && String(env.CHECKBOX_FULLSTACK_TESTMODE_RESUME_DRAFT_CONFIRM || '').trim()
            && String(env.CHECKBOX_FULLSTACK_TESTMODE_RESUME_DRAFT_CONFIRM || '').trim().toLowerCase() !== FINAL_DRAFT_RESUME_CONFIRMATION) {
            throw new FullstackTestModeError(
                'checkbox_fullstack_final_draft_resume_confirmation_invalid',
                'Final draft resume confirmation is invalid'
            );
        }
        if (String(env.CHECKBOX_FULLSTACK_TESTMODE_CLOSE_SHIFT || '').trim().toLowerCase() !== CLOSE_CONFIRMATION) {
            throw new FullstackTestModeError('checkbox_fullstack_shift_cleanup_required', 'The mutation proof must close only its own test shift');
        }
        const runId = String(env[MUTATION_RUN_ID_ENV] || '').trim();
        const ledgerDir = path.resolve(String(env[MUTATION_RUN_LEDGER_DIR_ENV] || '').trim());
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
            throw new FullstackTestModeError('checkbox_fullstack_run_id_required', 'Mutation proof requires one explicit UUID run ID');
        }
        if (!String(env[MUTATION_RUN_LEDGER_DIR_ENV] || '').trim() || isPathWithin(ledgerDir, ROOT)) {
            throw new FullstackTestModeError('checkbox_fullstack_run_ledger_required', 'Mutation run ledger must be an explicit local-only directory outside the repository');
        }
    }
    return {
        stage,
        baseUrl,
        testDb,
        local,
        runtimeConfig,
        resumeFinalDraft: stage === 'final_card_close'
            && String(env.CHECKBOX_FULLSTACK_TESTMODE_RESUME_DRAFT_CONFIRM || '').trim().toLowerCase() === FINAL_DRAFT_RESUME_CONFIRMATION,
        mutationRunId: MUTATION_STAGES.has(stage) ? String(env[MUTATION_RUN_ID_ENV]).trim() : null,
        mutationRunLedgerDir: MUTATION_STAGES.has(stage) ? path.resolve(String(env[MUTATION_RUN_LEDGER_DIR_ENV]).trim()) : null
    };
}

function acquireMutationRunRecord(guard) {
    if (!MUTATION_STAGES.has(guard.stage)) return null;
    fs.mkdirSync(guard.mutationRunLedgerDir, { recursive: true });
    const recordPath = path.join(guard.mutationRunLedgerDir, `${guard.mutationRunId}.json`);
    const startedAt = new Date().toISOString();
    let fd;
    try {
        fd = fs.openSync(recordPath, 'wx');
    } catch (error) {
        if (error?.code === 'EEXIST') {
            throw new FullstackTestModeError(
                'checkbox_fullstack_run_already_used',
                'This mutation run ID already exists; automatic retry is forbidden until explicit recovery review'
            );
        }
        throw error;
    }
    const write = state => {
        const payload = JSON.stringify({
            runId: guard.mutationRunId,
            state,
            startedAt,
            updatedAt: new Date().toISOString()
        });
        if (fd !== null) {
            fs.writeFileSync(fd, payload, 'utf8');
            fs.closeSync(fd);
            fd = null;
            return;
        }
        fs.writeFileSync(recordPath, payload, 'utf8');
    };
    write('started');
    return { recordPath, update: write };
}

function requirePlaywright() {
    try { return require('playwright'); }
    catch (error) {
        const entries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of entries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function exactUserIds(config = {}) {
    const eventUsers = config.eventGenixUsers && typeof config.eventGenixUsers === 'object'
        ? config.eventGenixUsers
        : {};
    return [...new Set([
        ...(Array.isArray(config.cashierUserIds) ? config.cashierUserIds : []),
        ...(Array.isArray(eventUsers.cashierUserIds) ? eventUsers.cashierUserIds : []),
        ...(Array.isArray(eventUsers.integrationOwnerUserIds) ? eventUsers.integrationOwnerUserIds : []),
        config.integrationOwnerUserId,
        eventUsers.primaryTestCashierUserId
    ].map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
}

async function seedExactUsers(local) {
    const eventUsers = local.config.eventGenixUsers && typeof local.config.eventGenixUsers === 'object'
        ? local.config.eventGenixUsers
        : {};
    const primaryUserId = Number(eventUsers.primaryTestCashierUserId || local.config.primaryTestCashierUserId || 0);
    const ownerUserId = Number(local.config.integrationOwnerUserId || eventUsers.integrationOwnerUserIds?.[0] || 0);
    const ids = exactUserIds(local.config);
    if (!Number.isSafeInteger(primaryUserId) || !ids.includes(primaryUserId)) {
        throw new FullstackTestModeError('checkbox_fullstack_primary_user_missing', 'Local test config must identify the exact EventGenix test cashier user');
    }
    if (!Number.isSafeInteger(ownerUserId) || !ids.includes(ownerUserId)) {
        throw new FullstackTestModeError('checkbox_fullstack_owner_user_missing', 'Local test config must identify the exact EventGenix integration owner');
    }

    const password = crypto.randomBytes(24).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 10);
    const capabilities = [...new Set([...DEFAULT_CAPABILITIES, 'fiscal.shift.close'])];
    const primaryName = String(eventUsers.primaryTestCashierName || local.config.primaryTestCashierName || 'Test CRM cashier').trim();
    let primaryUsername = null;
    let ownerUsername = null;
    for (const userId of ids) {
        const isPrimary = userId === primaryUserId;
        const username = `checkbox_testmode_${userId}_${crypto.randomBytes(3).toString('hex')}`;
        await pool.query(
            `INSERT INTO users (
                 id, username, password_hash, name, role, is_active,
                 page_allowlist, action_allowlist, business_contexts, default_business_context
             )
             VALUES ($1, $2, $3, $4, $5, true, $6::text[], $7::text[], $8::text[], $9)
             ON CONFLICT (id) DO UPDATE
                 SET username = EXCLUDED.username,
                     password_hash = EXCLUDED.password_hash,
                     name = EXCLUDED.name,
                     role = EXCLUDED.role,
                     is_active = true,
                     page_allowlist = EXCLUDED.page_allowlist,
                     action_allowlist = EXCLUDED.action_allowlist,
                     action_denylist = '{}'::text[],
                     business_contexts = EXCLUDED.business_contexts,
                     default_business_context = EXCLUDED.default_business_context`,
            [
                userId,
                username,
                passwordHash,
                isPrimary ? primaryName : `Isolated Checkbox test user ${userId}`,
                userId === ownerUserId ? 'creator' : 'reception',
                ['/cashier-payments'],
                capabilities,
                [CRM_PROFILE_KEY],
                CRM_PROFILE_KEY
            ]
        );
        if (isPrimary) primaryUsername = username;
        if (userId === ownerUserId) ownerUsername = username;
    }
    await pool.query(`SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1), true)`);
    if (!ownerUsername) {
        throw new FullstackTestModeError('checkbox_fullstack_owner_login_missing', 'Disposable integration owner login was not created');
    }
    return { id: primaryUserId, username: primaryUsername, password, ownerUserId, ownerUsername, capabilities };
}

async function withHarnessConfig(local, cashier, callback) {
    const filePath = path.join(os.tmpdir(), `eventgenix-checkbox-testmode-${process.pid}-${crypto.randomUUID()}.json`);
    const config = {
        ...local.config,
        capabilities: cashier.capabilities,
        cashierUserIds: exactUserIds(local.config)
    };
    fs.writeFileSync(filePath, JSON.stringify(config), 'utf8');
    try {
        return await callback(filePath);
    } finally {
        fs.rmSync(filePath, { force: true });
    }
}

async function configureDisposableScope(local, cashier) {
    return withHarnessConfig(local, cashier, async configFile => {
        const env = { ...process.env, EVENTGENIX_ALLOW_PILOT_CONFIG_APPLY: 'true' };
        const preflight = await runPilotConfig(['preflight', '--config-file', configFile], { env, dbPool: pool });
        if (preflight.ok !== true) {
            throw new FullstackTestModeError('checkbox_fullstack_config_preflight_failed', 'Disposable park + middle configuration preflight failed');
        }
        const applied = await runPilotConfig([
            'apply', '--config-file', configFile,
            '--actor-user-id', String(cashier.ownerUserId),
            '--reason', 'isolated Checkbox real test-mode full-stack proof'
        ], { env, dbPool: pool });
        if (applied.applied !== true) {
            throw new FullstackTestModeError('checkbox_fullstack_config_apply_failed', 'Disposable park + middle configuration was not applied');
        }
        const enabled = await runPilotConfig([
            'enable-register', '--config-file', configFile,
            '--actor-user-id', String(cashier.ownerUserId),
            '--reason', 'enable isolated Checkbox real test-mode register'
        ], { env, dbPool: pool });
        if (enabled.featureEnabled !== true) {
            throw new FullstackTestModeError('checkbox_fullstack_register_enable_failed', 'Disposable park + middle register did not enable');
        }
        return {
            fiscalProfileId: Number(applied.fiscalProfileId),
            fiscalLocationId: Number(applied.fiscalLocationId),
            fiscalRegisterId: Number(applied.fiscalRegisterId)
        };
    });
}

async function loadCardRecoveryAggregate(scope) {
    const result = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM payment_orders
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2) AS orders,
            (SELECT COUNT(*)::int FROM payment_orders
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND status = 'payment_recorded' AND payment_status = 'confirmed'
                AND fiscal_status = 'fiscalized' AND sealed_at IS NOT NULL) AS completed_orders,
            (SELECT COUNT(*)::int FROM payment_orders
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND payment_method = 'cash') AS cash_orders,
            (SELECT COUNT(*)::int FROM payment_orders
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND payment_method = 'card_terminal') AS card_orders,
            (SELECT COUNT(*)::int FROM payment_orders
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND payment_status = 'confirmed' AND fiscal_status <> 'fiscalized') AS unresolved_orders,
            (SELECT COUNT(*)::int FROM fiscal_operations
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2) AS operations,
            (SELECT COUNT(*)::int FROM fiscal_operations
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND operation_type = 'sale') AS sales,
            (SELECT COUNT(*)::int FROM fiscal_operations
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND operation_type = 'sale' AND status = 'fiscalized'
                AND external_stage = 'complete' AND provider_operation_id IS NOT NULL) AS completed_sales,
            (SELECT COUNT(DISTINCT provider_operation_id)::int FROM fiscal_operations
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND operation_type = 'sale') AS sale_uuids,
            (SELECT COUNT(*)::int FROM fiscal_operations
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND operation_type = 'shift_open') AS shift_open_operations,
            (SELECT COUNT(*)::int FROM fiscal_operations
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND operation_type = 'shift_open' AND status = 'fiscalized') AS completed_shift_open_operations,
            (SELECT COUNT(*)::int FROM fiscal_operations
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND operation_type = 'shift_close') AS shift_close_operations,
            (SELECT COUNT(*)::int FROM fiscal_operations
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND operation_type = 'shift_close' AND status = 'fiscalized') AS completed_shift_close_operations,
            (SELECT COUNT(*)::int
               FROM fiscal_receipts receipt
               JOIN fiscal_operations operation
                 ON operation.id = receipt.fiscal_operation_id
                AND operation.fiscal_profile_id = receipt.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2) AS receipts,
            (SELECT COUNT(*)::int
               FROM fiscal_receipts receipt
               JOIN fiscal_operations operation
                 ON operation.id = receipt.fiscal_operation_id
                AND operation.fiscal_profile_id = receipt.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND receipt.receipt_type = 'sale' AND receipt.status = 'fiscalized'
                AND provider_receipt_id IS NOT NULL) AS completed_receipts,
            (SELECT COUNT(DISTINCT receipt.provider_receipt_id)::int
               FROM fiscal_receipts receipt
               JOIN fiscal_operations operation
                 ON operation.id = receipt.fiscal_operation_id
                AND operation.fiscal_profile_id = receipt.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND receipt.receipt_type = 'sale') AS receipt_uuids,
            (SELECT COUNT(*)::int
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2) AS jobs,
            (SELECT COUNT(*)::int
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND job.job_type = 'receipt_sell') AS sell_jobs,
            (SELECT COUNT(*)::int
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND job.job_type = 'receipt_sell'
                AND job.status = 'succeeded' AND job.external_stage = 'complete') AS completed_sell_jobs,
            (SELECT COUNT(*)::int
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND job.job_type = 'shift_open') AS shift_open_jobs,
            (SELECT COUNT(*)::int
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND job.job_type = 'shift_open' AND job.status = 'succeeded') AS completed_shift_open_jobs,
            (SELECT COUNT(*)::int
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND job.job_type = 'shift_close') AS shift_close_jobs,
            (SELECT COUNT(*)::int
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND job.job_type = 'shift_close' AND job.status = 'succeeded') AS completed_shift_close_jobs,
            (SELECT COUNT(*)::int
               FROM payment_outbox_jobs job
               JOIN fiscal_operations operation
                 ON operation.id = job.fiscal_operation_id
                AND operation.fiscal_profile_id = job.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND job.status <> 'succeeded') AS unresolved_jobs,
            (SELECT COUNT(*)::int FROM payment_attempts attempt
               JOIN payment_orders payment_order
                 ON payment_order.id = attempt.payment_order_id
                AND payment_order.fiscal_profile_id = attempt.fiscal_profile_id
              WHERE payment_order.fiscal_profile_id = $1
                AND payment_order.fiscal_register_id = $2) AS attempts,
            (SELECT COUNT(*)::int FROM payment_allocations allocation
               JOIN payment_orders payment_order
                 ON payment_order.id = allocation.payment_order_id
                AND payment_order.fiscal_profile_id = allocation.fiscal_profile_id
              WHERE payment_order.fiscal_profile_id = $1
                AND payment_order.fiscal_register_id = $2) AS allocations,
            (SELECT COUNT(*)::int FROM payment_refunds
              WHERE fiscal_profile_id = $1) AS refunds,
            (SELECT COUNT(*)::int FROM fiscal_shifts
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2) AS shifts,
            (SELECT COUNT(*)::int FROM fiscal_shifts
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND status = 'closed' AND lifecycle_stage = 'CLOSED'
                AND provider_shift_id IS NOT NULL) AS closed_shifts,
            (SELECT COUNT(DISTINCT provider_shift_id)::int FROM fiscal_shifts
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2) AS shift_uuids,
            (SELECT COUNT(*)::int
               FROM fiscal_operations operation
               JOIN fiscal_receipts receipt
                 ON receipt.fiscal_operation_id = operation.id
                AND receipt.fiscal_profile_id = operation.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND operation.operation_type = 'sale'
                AND operation.provider_operation_id = receipt.provider_receipt_id) AS matched_receipt_uuids
    `, [scope.fiscalProfileId, scope.fiscalRegisterId]);
    return result.rows[0];
}

function assertCardRecoveryAggregate(actual, expected, code) {
    try {
        assert.deepEqual(actual, expected);
    } catch {
        throw new FullstackTestModeError(code, 'Card-only recovery ledger does not match the exact fail-closed contract');
    }
}

async function loadCashProofFingerprint(orderId, scope, cashierUserId) {
    const result = await pool.query(
        `SELECT jsonb_build_object(
                    'order', jsonb_build_object(
                        'id', po.id,
                        'status', po.status,
                        'payment_status', po.payment_status,
                        'fiscal_status', po.fiscal_status,
                        'payment_method', po.payment_method,
                        'total_amount_minor', po.total_amount_minor,
                        'received_amount_minor', po.received_amount_minor,
                        'change_amount_minor', po.change_amount_minor,
                        'source_snapshot', po.source_snapshot,
                        'confirmation_snapshot', po.confirmation_snapshot,
                        'seal_fingerprint', po.seal_fingerprint
                    ),
                    'items', COALESCE((
                        SELECT jsonb_agg(to_jsonb(item) ORDER BY item.id)
                          FROM payment_order_items item
                         WHERE item.payment_order_id = po.id
                    ), '[]'::jsonb),
                    'operation', jsonb_build_object(
                        'id', operation.id,
                        'provider_operation_id', operation.provider_operation_id,
                        'provider_organization_id', operation.provider_organization_id,
                        'provider_register_id', operation.provider_register_id,
                        'provider_cashier_id', operation.provider_cashier_id,
                        'register_credential_ref', operation.register_credential_ref,
                        'cashier_credential_ref', operation.cashier_credential_ref,
                        'expected_is_test', operation.expected_is_test,
                        'fiscal_configuration_hash', operation.fiscal_configuration_hash,
                        'status', operation.status,
                        'external_stage', operation.external_stage,
                        'request_snapshot', operation.request_snapshot
                    ),
                    'receipt', jsonb_build_object(
                        'id', receipt.id,
                        'provider_receipt_id', receipt.provider_receipt_id,
                        'status', receipt.status,
                        'receipt_type', receipt.receipt_type,
                        'total_amount_minor', receipt.total_amount_minor,
                        'provider_fiscal_code', receipt.provider_fiscal_code,
                        'provider_serial', receipt.provider_serial
                    ),
                    'shift', jsonb_build_object(
                        'id', shift.id,
                        'provider_shift_id', shift.provider_shift_id,
                        'status', shift.status,
                        'lifecycle_stage', shift.lifecycle_stage
                    ),
                    'attempts', COALESCE((
                        SELECT jsonb_agg(to_jsonb(attempt) ORDER BY attempt.id)
                          FROM payment_attempts attempt
                         WHERE attempt.payment_order_id = po.id
                           AND attempt.fiscal_profile_id = po.fiscal_profile_id
                    ), '[]'::jsonb),
                    'allocations', COALESCE((
                        SELECT jsonb_agg(to_jsonb(allocation) ORDER BY allocation.id)
                          FROM payment_allocations allocation
                         WHERE allocation.payment_order_id = po.id
                           AND allocation.fiscal_profile_id = po.fiscal_profile_id
                    ), '[]'::jsonb),
                    'jobs', COALESCE((
                        SELECT jsonb_agg(to_jsonb(job) ORDER BY job.id)
                          FROM payment_outbox_jobs job
                         WHERE job.payment_order_id = po.id
                           AND job.fiscal_profile_id = po.fiscal_profile_id
                    ), '[]'::jsonb)
                ) AS proof,
                shift.id AS baseline_shift_id
           FROM payment_orders po
           JOIN fiscal_operations operation
             ON operation.payment_order_id = po.id
            AND operation.operation_type = 'sale'
           JOIN fiscal_receipts receipt ON receipt.fiscal_operation_id = operation.id
           JOIN fiscal_shifts shift ON shift.id = operation.fiscal_shift_id
          WHERE po.id = $1
            AND po.fiscal_profile_id = $2
            AND po.fiscal_register_id = $3
            AND po.cashier_user_id = $4`,
        [orderId, scope.fiscalProfileId, scope.fiscalRegisterId, cashierUserId]
    );
    if (result.rows.length !== 1) {
        throw new FullstackTestModeError('checkbox_fullstack_card_recovery_cash_proof_missing', 'Exact original cash proof is missing or ambiguous');
    }
    return {
        baselineShiftId: Number(result.rows[0].baseline_shift_id),
        fingerprint: crypto.createHash('sha256').update(JSON.stringify(result.rows[0].proof)).digest('hex')
    };
}

async function loadCardRecoveryBaseline(local) {
    const eventUsers = local.config.eventGenixUsers && typeof local.config.eventGenixUsers === 'object'
        ? local.config.eventGenixUsers
        : {};
    const primaryUserId = Number(eventUsers.primaryTestCashierUserId || local.config.primaryTestCashierUserId || 0);
    const scopeResult = await pool.query(
        `SELECT fp.id AS fiscal_profile_id,
                fl.id AS fiscal_location_id,
                fr.id AS fiscal_register_id,
                fp.provider_organization_id,
                fr.provider_register_id,
                fr.provider_license_ref,
                fr.status AS register_status,
                fr.feature_enabled,
                fr.metadata->>'expected_is_test' AS expected_is_test,
                fcb.provider_cashier_id,
                fcb.provider_cashier_login_ref,
                fcb.status AS binding_status
           FROM fiscal_profiles fp
           JOIN fiscal_locations fl
             ON fl.fiscal_profile_id = fp.id
            AND fl.crm_profile_key = fp.crm_profile_key
           JOIN fiscal_registers fr
             ON fr.fiscal_profile_id = fp.id
            AND fr.fiscal_location_id = fl.id
            AND fr.crm_profile_key = fp.crm_profile_key
           JOIN fiscal_cashier_bindings fcb
             ON fcb.fiscal_profile_id = fp.id
            AND fcb.fiscal_location_id = fl.id
            AND fcb.fiscal_register_id = fr.id
            AND fcb.crm_profile_key = fp.crm_profile_key
          WHERE fp.crm_profile_key = $1
            AND fl.location_alias = $2
            AND fr.register_alias = $3
            AND fcb.user_id = $4`,
        [CRM_PROFILE_KEY, String(local.config.locationAlias || 'park'), REGISTER_ALIAS, primaryUserId]
    );
    if (scopeResult.rows.length !== 1) {
        throw new FullstackTestModeError('checkbox_fullstack_card_recovery_scope_ambiguous', 'Existing card-recovery profile/register/user binding is missing or ambiguous');
    }
    const row = scopeResult.rows[0];
    const exact = [
        [row.provider_organization_id, local.options.providerOrganizationId],
        [row.provider_register_id, local.options.providerRegisterId],
        [row.provider_cashier_id, local.options.providerCashierId],
        [row.provider_license_ref, local.options.providerLicenseRef],
        [row.provider_cashier_login_ref, local.options.cashierLoginRef]
    ].every(([actual, expected]) => String(actual || '') === String(expected || ''));
    if (!exact
        || row.register_status !== 'active'
        || row.binding_status !== 'active'
        || row.feature_enabled !== true
        || String(row.expected_is_test || '').toLowerCase() !== 'true') {
        throw new FullstackTestModeError('checkbox_fullstack_card_recovery_identity_drift', 'Existing disposable mapping drifted from the exact test identity');
    }
    const scope = {
        fiscalProfileId: Number(row.fiscal_profile_id),
        fiscalLocationId: Number(row.fiscal_location_id),
        fiscalRegisterId: Number(row.fiscal_register_id)
    };
    const aggregate = await loadCardRecoveryAggregate(scope);
    assertCardRecoveryAggregate(aggregate, {
        orders: 1,
        completed_orders: 1,
        cash_orders: 1,
        card_orders: 0,
        unresolved_orders: 0,
        operations: 2,
        sales: 1,
        completed_sales: 1,
        sale_uuids: 1,
        shift_open_operations: 1,
        completed_shift_open_operations: 1,
        shift_close_operations: 0,
        completed_shift_close_operations: 0,
        receipts: 1,
        completed_receipts: 1,
        receipt_uuids: 1,
        jobs: 2,
        sell_jobs: 1,
        completed_sell_jobs: 1,
        shift_open_jobs: 1,
        completed_shift_open_jobs: 1,
        shift_close_jobs: 0,
        completed_shift_close_jobs: 0,
        unresolved_jobs: 0,
        attempts: 1,
        allocations: 1,
        refunds: 0,
        shifts: 1,
        closed_shifts: 1,
        shift_uuids: 1,
        matched_receipt_uuids: 1
    }, 'checkbox_fullstack_card_recovery_baseline_invalid');
    const cashOrder = await pool.query(
        `SELECT payment_order.id
           FROM payment_orders payment_order
           JOIN fiscal_operations operation
             ON operation.payment_order_id = payment_order.id
            AND operation.fiscal_profile_id = payment_order.fiscal_profile_id
            AND operation.operation_type = 'sale'
          WHERE payment_order.fiscal_profile_id = $1
            AND payment_order.fiscal_register_id = $2
            AND payment_order.cashier_user_id = $3
            AND payment_order.payment_method = 'cash'
            AND operation.provider_organization_id = $4
            AND operation.provider_register_id = $5
            AND operation.provider_cashier_id = $6
            AND operation.register_credential_ref = $7
            AND operation.cashier_credential_ref = $8
            AND operation.expected_is_test = TRUE
            AND NULLIF(BTRIM(operation.fiscal_configuration_hash), '') IS NOT NULL
          ORDER BY payment_order.id`,
        [
            scope.fiscalProfileId,
            scope.fiscalRegisterId,
            primaryUserId,
            local.options.providerOrganizationId,
            local.options.providerRegisterId,
            local.options.providerCashierId,
            local.options.providerLicenseRef,
            local.options.cashierLoginRef
        ]
    );
    if (cashOrder.rows.length !== 1) {
        throw new FullstackTestModeError('checkbox_fullstack_card_recovery_cash_order_ambiguous', 'Card recovery requires exactly one original cash order');
    }
    const proof = await loadCashProofFingerprint(Number(cashOrder.rows[0].id), scope, primaryUserId);
    return {
        ...scope,
        cashierUserId: primaryUserId,
        cashOrderId: Number(cashOrder.rows[0].id),
        baselineShiftId: proof.baselineShiftId,
        cashProofFingerprint: proof.fingerprint
    };
}

async function verifyExistingCardRecoveryScope(local, cashier, baseline) {
    return withHarnessConfig(local, cashier, async configFile => {
        const preflight = await runPilotConfig(['preflight', '--config-file', configFile], {
            env: process.env,
            dbPool: pool
        });
        if (preflight.ok !== true) {
            throw new FullstackTestModeError('checkbox_fullstack_card_recovery_preflight_failed', 'Existing disposable mapping no longer passes configuration preflight');
        }
        return baseline;
    });
}

async function authenticateEventGenixUser(page, baseUrl, credentials, errorPrefix) {
    const response = await page.request.post(`${baseUrl}/api/auth/login`, {
        data: { username: credentials.username, password: credentials.password }
    });
    if (!response.ok()) throw new FullstackTestModeError(`${errorPrefix}_login_failed`, 'Disposable EventGenix user login failed');
    const payload = await response.json();
    if (!payload.token) throw new FullstackTestModeError(`${errorPrefix}_token_missing`, 'Disposable EventGenix login did not return a token');
    return payload.token;
}

async function login(page, baseUrl, cashier) {
    const token = await authenticateEventGenixUser(page, baseUrl, cashier, 'checkbox_fullstack_cashier');
    await page.addInitScript(token => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_dark_mode', 'false');
    }, token);
    return token;
}

async function forceProviderReadiness(page) {
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/payments/readiness/probe'));
    await page.click('#refreshReadinessBtn');
    const response = await responsePromise;
    if (!response.ok()) {
        const payload = await response.json().catch(() => ({}));
        throw new FullstackTestModeError(payload.code || 'checkbox_fullstack_readiness_failed', 'Provider readiness did not pass the exact test identity/device gate');
    }
    await page.waitForFunction(() => {
        const pageState = window.CashierPaymentsPage?.state;
        const readinessCode = pageState?.registerState?.readinessCode;
        return pageState?.readinessInFlight === false
            && Boolean(readinessCode)
            && readinessCode !== 'readiness_missing';
    });
    return page.evaluate(() => {
        const state = window.CashierPaymentsPage.state.registerState || {};
        const readiness = state.readiness || {};
        const snapshot = state.readinessSnapshot || readiness.readinessSnapshot || {};
        const providerError = snapshot.result?.error || readiness.result?.error || {};
        return {
            readinessCode: state.readinessCode,
            providerErrorCode: providerError.code || null,
            providerErrorStatus: Number(providerError.status || 0) || null,
            providerErrorRetryable: providerError.retryable === true,
            integrationReady: state.integrationReady === true,
            providerReady: state.providerReady === true || readiness.providerReady === true,
            providerIdentityVerified: state.providerIdentityVerified === true || readiness.providerIdentityVerified === true,
            signatureCertificateReady: state.signatureCertificateReady === true || readiness.signatureCertificateReady === true,
            taxMappingReady: state.taxMappingReady === true || readiness.taxMappingReady === true,
            shiftState: state.shiftState || readiness.shiftState || null
        };
    });
}

async function assertNoLocalFiscalMutations() {
    const result = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM payment_orders) AS payment_orders,
            (SELECT COUNT(*)::int FROM fiscal_operations) AS fiscal_operations,
            (SELECT COUNT(*)::int FROM payment_outbox_jobs) AS outbox_jobs,
            (SELECT COUNT(*)::int FROM fiscal_shifts) AS fiscal_shifts
    `);
    assert.deepEqual(result.rows[0], {
        payment_orders: 0,
        fiscal_operations: 0,
        outbox_jobs: 0,
        fiscal_shifts: 0
    });
}

function minorToInput(value) {
    const amount = BigInt(String(value));
    return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}

async function createAndConfirmOrder(page, tender) {
    if (await page.locator('#startNextOrderBtn:not(.hidden)').count()) {
        await page.click('#startNextOrderBtn');
    }
    try {
        await page.waitForSelector('#createPaymentOrderBtn:not([disabled])');
    } catch (error) {
        const state = await page.evaluate(() => {
            const pageState = window.CashierPaymentsPage?.state || {};
            return {
                readinessCode: pageState.registerState?.readinessCode || null,
                integrationReady: pageState.registerState?.integrationReady === true,
                providerReady: pageState.registerState?.providerReady === true
                    || pageState.registerState?.readiness?.providerReady === true,
                readinessInFlight: pageState.readinessInFlight === true,
                unresolvedQueueState: pageState.unresolvedQueueState || null,
                unresolvedLastErrorCode: pageState.unresolvedLastError?.code || null,
                hasCurrentOrder: Boolean(pageState.orderDetails?.order?.id)
            };
        });
        throw new FullstackTestModeError(
            'checkbox_fullstack_create_not_ready',
            `Cashier UI did not reach a safe create-ready state: ${JSON.stringify(state)}`,
            { cause: error }
        );
    }
    await page.check(`input[name="paymentTender"][value="${tender}"]`);
    await page.fill('#paymentKidsCount', '1');
    await page.fill('#paymentAdultsCount', '0');
    const createResponsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'POST'
            && url.pathname === '/api/payments/admission-ticket/orders';
    });
    await page.click('#createPaymentOrderBtn');
    const createResponse = await createResponsePromise;
    const createPayload = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok() || !createPayload.order?.id) {
        throw new FullstackTestModeError(
            createPayload.code || 'checkbox_fullstack_order_create_failed',
            'EventGenix did not create the exact local draft order'
        );
    }
    await page.evaluate(orderId => window.CashierPaymentsPage.loadPaymentOrder(orderId), createPayload.order.id);
    await page.waitForFunction(orderId => {
        const order = window.CashierPaymentsPage?.state?.orderDetails?.order;
        return Number(order?.id) === Number(orderId) && String(order?.status || '').toLowerCase() === 'draft';
    }, createPayload.order.id);
    const order = await page.evaluate(() => window.CashierPaymentsPage.state.orderDetails.order);
    if (!order?.id || !order.totalAmountMinor) {
        throw new FullstackTestModeError('checkbox_fullstack_order_snapshot_missing', 'EventGenix did not create an immutable payment order snapshot');
    }
    if (tender === 'cash') {
        await page.fill('#cashReceivedAmount', minorToInput(order.totalAmountMinor));
    } else {
        await page.check('#terminalSuccessCheckbox');
    }
    const confirmButton = tender === 'cash' ? '#confirmCashBtn' : '#confirmCardBtn';
    await page.waitForSelector(`${confirmButton}:not([disabled])`);
    const confirmResponsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'POST'
            && url.pathname === `/api/payments/orders/${order.id}/confirm`;
    });
    await page.click(confirmButton);
    const confirmResponse = await confirmResponsePromise;
    const confirmPayload = await confirmResponse.json().catch(() => ({}));
    if (!confirmResponse.ok()) {
        throw new FullstackTestModeError(
            confirmPayload.code || 'checkbox_fullstack_order_confirm_failed',
            'EventGenix refused payment confirmation before any safe fiscal mutation'
        );
    }
    await page.evaluate(orderId => window.CashierPaymentsPage.loadPaymentOrder(orderId), order.id);
    await page.waitForFunction(orderId => {
        const current = window.CashierPaymentsPage?.state?.orderDetails?.order;
        return Number(current?.id) === Number(orderId) && String(current?.paymentStatus || '').toLowerCase() === 'confirmed';
    }, order.id);
    return Number(order.id);
}

async function loadExactResumableCardDraft(scope, cashier) {
    const aggregate = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM payment_orders) AS orders,
            (SELECT COUNT(*)::int FROM payment_orders
              WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
                AND cashier_user_id = $3 AND status = 'draft'
                AND payment_status = 'unpaid' AND payment_method = 'card_terminal'
                AND sealed_at IS NULL AND cancelled_at IS NULL) AS resumable_drafts,
            (SELECT COUNT(*)::int FROM payment_attempts) AS attempts,
            (SELECT COUNT(*)::int FROM payment_allocations) AS allocations,
            (SELECT COUNT(*)::int FROM fiscal_operations) AS operations,
            (SELECT COUNT(*)::int FROM fiscal_receipts) AS receipts,
            (SELECT COUNT(*)::int FROM payment_outbox_jobs) AS jobs,
            (SELECT COUNT(*)::int FROM fiscal_shifts) AS shifts
    `, [scope.fiscalProfileId, scope.fiscalRegisterId, cashier.id]);
    const row = aggregate.rows[0];
    const valid = row.orders === 1
        && row.resumable_drafts === 1
        && row.attempts === 0
        && row.allocations === 0
        && row.operations === 0
        && row.receipts === 0
        && row.jobs === 0
        && row.shifts === 0;
    if (!valid) {
        throw new FullstackTestModeError(
            'checkbox_fullstack_final_draft_resume_state_invalid',
            'Local disposable DB is not in the exact one-unpaid-draft pre-mutation state'
        );
    }
    const result = await pool.query(
        `SELECT id FROM payment_orders
          WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
            AND cashier_user_id = $3 AND status = 'draft'
            AND payment_status = 'unpaid' AND payment_method = 'card_terminal'
            AND sealed_at IS NULL AND cancelled_at IS NULL`,
        [scope.fiscalProfileId, scope.fiscalRegisterId, cashier.id]
    );
    return Number(result.rows[0].id);
}

async function confirmExistingCardDraft(page, orderId) {
    await page.evaluate(id => window.CashierPaymentsPage.loadPaymentOrder(id), orderId);
    await page.waitForFunction(id => {
        const order = window.CashierPaymentsPage?.state?.orderDetails?.order;
        return Number(order?.id) === Number(id)
            && String(order?.status || '').toLowerCase() === 'draft'
            && String(order?.paymentStatus || '').toLowerCase() === 'unpaid';
    }, orderId);
    await page.check('input[name="paymentTender"][value="card_terminal_manual"]');
    await page.check('#terminalSuccessCheckbox');
    await page.waitForSelector('#confirmCardBtn:not([disabled])');
    const confirmResponsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'POST'
            && url.pathname === `/api/payments/orders/${orderId}/confirm`;
    });
    await page.click('#confirmCardBtn');
    const confirmResponse = await confirmResponsePromise;
    const payload = await confirmResponse.json().catch(() => ({}));
    if (!confirmResponse.ok()) {
        throw new FullstackTestModeError(
            payload.code || 'checkbox_fullstack_resumed_order_confirm_failed',
            'EventGenix refused the exact resumed draft before any safe fiscal mutation'
        );
    }
    await page.evaluate(id => window.CashierPaymentsPage.loadPaymentOrder(id), orderId);
    await page.waitForFunction(id => {
        const order = window.CashierPaymentsPage?.state?.orderDetails?.order;
        return Number(order?.id) === Number(id)
            && String(order?.paymentStatus || '').toLowerCase() === 'confirmed';
    }, orderId);
    return Number(orderId);
}

async function loadOrderState(orderId) {
    const result = await pool.query(
        `SELECT po.id, po.payment_status, po.fiscal_status,
                COUNT(DISTINCT fo.id)::int AS operation_count,
                COUNT(DISTINCT fr.id)::int AS receipt_count,
                COUNT(DISTINCT job.id)::int AS job_count,
                BOOL_AND(COALESCE(fr.status = 'fiscalized', false)) FILTER (WHERE fr.id IS NOT NULL) AS receipts_fiscalized,
                BOOL_OR(job.status = 'dead') AS has_dead_job
           FROM payment_orders po
      LEFT JOIN fiscal_operations fo ON fo.payment_order_id = po.id AND fo.operation_type = 'sale'
      LEFT JOIN fiscal_receipts fr ON fr.fiscal_operation_id = fo.id
      LEFT JOIN payment_outbox_jobs job ON job.fiscal_operation_id = fo.id
          WHERE po.id = $1
          GROUP BY po.id`,
        [orderId]
    );
    return result.rows[0] || null;
}

function isFiscalizedOrderState(state) {
    return state?.payment_status === 'confirmed'
        && state.fiscal_status === 'fiscalized'
        && state.operation_count === 1
        && state.receipt_count === 1
        && state.job_count === 1
        && state.receipts_fiscalized === true;
}

async function drainUntil({ predicate, timeoutMs = MAX_DRAIN_MS, label }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        const unsafe = await pool.query(
            `SELECT job_type
               FROM payment_outbox_jobs
              WHERE status IN ('queued', 'retry', 'unknown', 'claimed', 'running')
                AND job_type NOT IN ('shift_open', 'receipt_sell', 'receipt_status_lookup', 'shift_close')
              LIMIT 1`
        );
        if (unsafe.rows.length) {
            throw new FullstackTestModeError('checkbox_fullstack_phase2_job_forbidden', 'Phase-2 outbox jobs are forbidden in the test-mode proof');
        }
        await processPaymentOutboxJobs({
            dbPool: pool,
            batchSize: 1,
            lockedBy: `checkbox-fullstack-testmode-${process.pid}`,
            lockExpiryMs: 30_000
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new FullstackTestModeError('checkbox_fullstack_drain_timeout', `${label} did not converge within the bounded deadline`);
}

async function waitForFiscalizedOrder(page, baseUrl, orderId) {
    await drainUntil({
        label: 'Receipt fiscalization',
        predicate: async () => {
            const state = await loadOrderState(orderId);
            if (state?.has_dead_job) {
                throw new FullstackTestModeError('checkbox_fullstack_receipt_dead', 'Real test-mode receipt reached a dead job');
            }
            return isFiscalizedOrderState(state);
        }
    });
    await page.goto(`${baseUrl}/cashier-payments?orderId=${orderId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(id => Number(window.CashierPaymentsPage?.state?.orderDetails?.order?.id) === Number(id), orderId);
    await page.waitForSelector('#providerReceiptLinks:not(.hidden)', { timeout: 30_000 });
    const hrefs = await page.evaluate(() => ['providerTaxUrl', 'providerPdfUrl', 'providerQrUrl']
        .map(id => document.getElementById(id))
        .filter(element => element && !element.classList.contains('hidden'))
        .map(element => element.getAttribute('href'))
        .filter(Boolean));
    if (!hrefs.length || hrefs.some(href => !/^https:\/\/api\.checkbox\.(?:ua|in\.ua)\//i.test(href))) {
        throw new FullstackTestModeError('checkbox_fullstack_trusted_receipt_artifact_missing', 'Fiscalized test receipt did not expose a trusted Checkbox HTTPS artifact');
    }
}

async function localOwnedShift(scope, cashier, { shiftId = null, excludeShiftId = null } = {}) {
    const params = [scope.fiscalProfileId, scope.fiscalRegisterId, cashier.id];
    const filters = [];
    if (shiftId !== null) {
        params.push(Number(shiftId));
        filters.push(`AND id = $${params.length}`);
    }
    if (excludeShiftId !== null) {
        params.push(Number(excludeShiftId));
        filters.push(`AND id <> $${params.length}`);
    }
    const result = await pool.query(
        `SELECT id, provider_shift_id, status, lifecycle_stage
           FROM fiscal_shifts
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND opened_by_user_id = $3
            ${filters.join('\n            ')}
          ORDER BY id`,
        params
    );
    if (result.rows.length > 1) {
        throw new FullstackTestModeError('checkbox_fullstack_multiple_shifts', 'Exact smoke-owned shift scope is ambiguous');
    }
    return result.rows[0] || null;
}

async function loadExactSaleShift(scope, cashier, orderId, baselineShiftId = null) {
    const result = await pool.query(
        `SELECT shift.id, shift.provider_shift_id, shift.status, shift.lifecycle_stage
           FROM fiscal_operations operation
           JOIN fiscal_shifts shift
             ON shift.id = operation.fiscal_shift_id
            AND shift.fiscal_profile_id = operation.fiscal_profile_id
          WHERE operation.fiscal_profile_id = $1
            AND operation.fiscal_register_id = $2
            AND operation.payment_order_id = $3
            AND operation.operation_type = 'sale'
            AND shift.opened_by_user_id = $4`,
        [scope.fiscalProfileId, scope.fiscalRegisterId, orderId, cashier.id]
    );
    if (result.rows.length !== 1) {
        throw new FullstackTestModeError('checkbox_fullstack_sale_shift_ambiguous', 'Card sale does not reference exactly one smoke-owned shift');
    }
    const shift = result.rows[0];
    if (baselineShiftId !== null && Number(shift.id) === Number(baselineShiftId)) {
        throw new FullstackTestModeError('checkbox_fullstack_card_reused_baseline_shift', 'Card recovery reused the already closed baseline shift');
    }
    return shift;
}

async function closeOwnedShiftThroughEventGenix(page, token, scope, cashier, { shiftId = null } = {}) {
    const shift = await localOwnedShift(scope, cashier, { shiftId });
    if (!shift?.id || !shift.provider_shift_id || String(shift.lifecycle_stage).toUpperCase() !== 'OPENED') {
        throw new FullstackTestModeError('checkbox_fullstack_owned_shift_not_opened', 'Exact smoke-owned provider shift is not OPENED locally');
    }
    const unresolved = await pool.query(
        `SELECT COUNT(*)::int AS count
           FROM payment_orders
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND payment_status = 'confirmed'
            AND fiscal_status <> 'fiscalized'`,
        [scope.fiscalProfileId, scope.fiscalRegisterId]
    );
    if (unresolved.rows[0].count !== 0) {
        throw new FullstackTestModeError('checkbox_fullstack_close_blocked_by_unresolved', 'Owned shift cannot close while paid receipts are unresolved');
    }
    const response = await page.request.post(`${process.env.TEST_URL}/api/payments/shifts/${shift.id}/phase1-close`, {
        headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `checkbox-fullstack-close-${shift.id}` },
        data: {}
    });
    if (!response.ok()) {
        const payload = await response.json().catch(() => ({}));
        throw new FullstackTestModeError(payload.code || 'checkbox_fullstack_close_request_failed', 'EventGenix Phase-1 close request failed');
    }
    await drainUntil({
        label: 'Owned shift close',
        predicate: async () => {
            const current = await localOwnedShift(scope, cashier, { shiftId: shift.id });
            return current && String(current.lifecycle_stage).toUpperCase() === 'CLOSED';
        }
    });
}

async function cleanupOwnedShiftIfNeeded({ guard, scope, cashier, targetShiftId = null, baselineShiftId = null }) {
    if (!scope || !cashier || !MUTATION_STAGES.has(guard.stage)) return { attempted: false, closed: false };
    const shift = await localOwnedShift(scope, cashier, targetShiftId !== null
        ? { shiftId: targetShiftId }
        : { excludeShiftId: baselineShiftId });
    if (!shift?.provider_shift_id || String(shift.lifecycle_stage).toUpperCase() === 'CLOSED') {
        return { attempted: false, closed: String(shift?.lifecycle_stage || '').toUpperCase() === 'CLOSED' };
    }
    const unresolved = await pool.query(
        `SELECT COUNT(*)::int AS count
           FROM payment_orders
          WHERE fiscal_profile_id = $1
            AND fiscal_register_id = $2
            AND payment_status = 'confirmed'
            AND fiscal_status <> 'fiscalized'`,
        [scope.fiscalProfileId, scope.fiscalRegisterId]
    );
    if (unresolved.rows[0].count > 0) {
        return {
            attempted: false,
            closed: false,
            code: 'checkbox_fullstack_cleanup_blocked_by_unresolved'
        };
    }
    const provider = createProviderFromConfig(guard.runtimeConfig);
    await provider.authenticate();
    try {
        const result = await closeOwnedSandboxShift({
            client: provider.client,
            config: {
                ...guard.runtimeConfig,
                closeShift: true,
                expectedOrganizationId: guard.local.options.providerOrganizationId,
                expectedRegisterId: guard.local.options.providerRegisterId,
                expectedCashierId: guard.local.options.providerCashierId,
                expectedIsTest: true
            },
            shift: { id: shift.provider_shift_id },
            openedBySmoke: true,
            force: true
        });
        if (result.closed === true) {
            const authUserResult = await pool.query(
                `SELECT * FROM users WHERE id = $1 AND is_active = TRUE`,
                [cashier.id]
            );
            if (authUserResult.rows.length !== 1) {
                throw new FullstackTestModeError(
                    'checkbox_fullstack_cleanup_auth_user_missing',
                    'Provider shift closed, but the exact active EventGenix user is unavailable for local reconciliation'
                );
            }
            await probeCheckboxReadiness({
                dbPool: pool,
                user: authUserResult.rows[0],
                crmProfileKey: CRM_PROFILE_KEY,
                registerAlias: REGISTER_ALIAS,
                env: process.env,
                force: true
            });
            const reconciled = await localOwnedShift(scope, cashier, { shiftId: shift.id });
            if (String(reconciled?.lifecycle_stage || '').toUpperCase() !== 'CLOSED') {
                throw new FullstackTestModeError(
                    'checkbox_fullstack_cleanup_reconciliation_failed',
                    'Provider shift closed, but exact local shift reconciliation did not converge to CLOSED'
                );
            }
        }
        return result;
    } finally {
        await provider.client.signOut().catch(() => {});
    }
}

async function assertFinalLedger(scope) {
    const result = await pool.query(
        `SELECT
            (SELECT COUNT(*)::int FROM payment_orders WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2) AS orders,
            (SELECT COUNT(*)::int FROM fiscal_operations WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2 AND operation_type = 'sale') AS sales,
            (SELECT COUNT(*)::int
               FROM fiscal_receipts receipt
               JOIN fiscal_operations operation
                 ON operation.id = receipt.fiscal_operation_id
                AND operation.fiscal_profile_id = receipt.fiscal_profile_id
              WHERE operation.fiscal_profile_id = $1
                AND operation.fiscal_register_id = $2
                AND receipt.receipt_type = 'sale') AS receipts,
            (SELECT COUNT(DISTINCT provider_operation_id)::int FROM fiscal_operations WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2 AND operation_type = 'sale') AS receipt_uuids,
            (SELECT COUNT(DISTINCT provider_shift_id)::int FROM fiscal_shifts WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2) AS shift_uuids,
            (SELECT COUNT(*)::int FROM payment_outbox_jobs job JOIN fiscal_operations operation ON operation.id = job.fiscal_operation_id WHERE operation.fiscal_profile_id = $1 AND operation.fiscal_register_id = $2 AND job.job_type = 'receipt_sell') AS sell_jobs,
            (SELECT COUNT(*)::int FROM payment_orders WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2 AND payment_method = 'cash') AS cash_orders,
            (SELECT COUNT(*)::int FROM payment_orders WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2 AND payment_method = 'card_terminal') AS card_orders`,
        [scope.fiscalProfileId, scope.fiscalRegisterId]
    );
    assert.deepEqual(result.rows[0], {
        orders: 2,
        sales: 2,
        receipts: 2,
        receipt_uuids: 2,
        shift_uuids: 1,
        sell_jobs: 2,
        cash_orders: 1,
        card_orders: 1
    });
}

async function assertCardRecoveryFinal(scope, cashier, baseline, cardOrderId, newShiftId) {
    const aggregate = await loadCardRecoveryAggregate(scope);
    assertCardRecoveryAggregate(aggregate, {
        orders: 2,
        completed_orders: 2,
        cash_orders: 1,
        card_orders: 1,
        unresolved_orders: 0,
        operations: 5,
        sales: 2,
        completed_sales: 2,
        sale_uuids: 2,
        shift_open_operations: 2,
        completed_shift_open_operations: 2,
        shift_close_operations: 1,
        completed_shift_close_operations: 1,
        receipts: 2,
        completed_receipts: 2,
        receipt_uuids: 2,
        jobs: 5,
        sell_jobs: 2,
        completed_sell_jobs: 2,
        shift_open_jobs: 2,
        completed_shift_open_jobs: 2,
        shift_close_jobs: 1,
        completed_shift_close_jobs: 1,
        unresolved_jobs: 0,
        attempts: 2,
        allocations: 2,
        refunds: 0,
        shifts: 2,
        closed_shifts: 2,
        shift_uuids: 2,
        matched_receipt_uuids: 2
    }, 'checkbox_fullstack_card_recovery_final_invalid');

    const original = await loadCashProofFingerprint(
        baseline.cashOrderId,
        scope,
        baseline.cashierUserId
    );
    if (original.fingerprint !== baseline.cashProofFingerprint
        || Number(original.baselineShiftId) !== Number(baseline.baselineShiftId)) {
        throw new FullstackTestModeError(
            'checkbox_fullstack_card_recovery_cash_proof_changed',
            'Original fiscalized cash order or its original shift changed during card-only recovery'
        );
    }

    const baselineShift = await localOwnedShift(scope, cashier, { shiftId: baseline.baselineShiftId });
    const recoveryShift = await localOwnedShift(scope, cashier, { shiftId: newShiftId });
    if (!baselineShift || !recoveryShift
        || Number(baselineShift.id) === Number(recoveryShift.id)
        || String(baselineShift.status) !== 'closed'
        || String(baselineShift.lifecycle_stage).toUpperCase() !== 'CLOSED'
        || String(recoveryShift.status) !== 'closed'
        || String(recoveryShift.lifecycle_stage).toUpperCase() !== 'CLOSED'
        || !baselineShift.provider_shift_id
        || !recoveryShift.provider_shift_id
        || String(baselineShift.provider_shift_id) === String(recoveryShift.provider_shift_id)) {
        throw new FullstackTestModeError(
            'checkbox_fullstack_card_recovery_shift_proof_invalid',
            'Card-only recovery did not finish with two distinct exact CLOSED shifts'
        );
    }

    const card = await pool.query(
        `SELECT payment_order.id,
                payment_order.status,
                payment_order.payment_status,
                payment_order.fiscal_status,
                payment_order.payment_method,
                payment_order.total_amount_minor,
                payment_order.received_amount_minor,
                payment_order.change_amount_minor,
                payment_order.confirmation_snapshot->>'tender' AS confirmation_tender,
                operation.id AS operation_id,
                operation.status AS operation_status,
                operation.external_stage AS operation_stage,
                operation.provider_operation_id,
                operation.fiscal_shift_id,
                receipt.id AS receipt_id,
                receipt.status AS receipt_status,
                receipt.receipt_type,
                receipt.provider_receipt_id,
                receipt.total_amount_minor AS receipt_total_amount_minor,
                job.id AS sell_job_id,
                job.status AS sell_job_status,
                job.external_stage AS sell_job_stage,
                (SELECT COUNT(*)::int
                   FROM payment_attempts attempt
                  WHERE attempt.fiscal_profile_id = payment_order.fiscal_profile_id
                    AND attempt.payment_order_id = payment_order.id) AS attempt_count,
                (SELECT BOOL_AND(
                            attempt.attempt_type = 'card_terminal_confirmation'
                            AND attempt.status = 'confirmed'
                            AND attempt.provider = 'terminal'
                            AND attempt.amount_minor = payment_order.total_amount_minor
                        )
                   FROM payment_attempts attempt
                  WHERE attempt.fiscal_profile_id = payment_order.fiscal_profile_id
                    AND attempt.payment_order_id = payment_order.id) AS attempt_valid,
                (SELECT COUNT(*)::int
                   FROM payment_allocations allocation
                  WHERE allocation.fiscal_profile_id = payment_order.fiscal_profile_id
                    AND allocation.payment_order_id = payment_order.id) AS allocation_count,
                (SELECT BOOL_AND(
                            allocation.payment_method = 'card_terminal'
                            AND allocation.status = 'recorded'
                            AND allocation.amount_minor = payment_order.total_amount_minor
                        )
                   FROM payment_allocations allocation
                  WHERE allocation.fiscal_profile_id = payment_order.fiscal_profile_id
                    AND allocation.payment_order_id = payment_order.id) AS allocation_valid
           FROM payment_orders payment_order
           JOIN fiscal_operations operation
             ON operation.fiscal_profile_id = payment_order.fiscal_profile_id
            AND operation.payment_order_id = payment_order.id
            AND operation.operation_type = 'sale'
           JOIN fiscal_receipts receipt
             ON receipt.fiscal_profile_id = operation.fiscal_profile_id
            AND receipt.fiscal_operation_id = operation.id
            AND receipt.receipt_type = 'sale'
           JOIN payment_outbox_jobs job
             ON job.fiscal_profile_id = operation.fiscal_profile_id
            AND job.fiscal_operation_id = operation.id
            AND job.job_type = 'receipt_sell'
          WHERE payment_order.id = $1
            AND payment_order.fiscal_profile_id = $2
            AND payment_order.fiscal_register_id = $3
            AND payment_order.cashier_user_id = $4`,
        [cardOrderId, scope.fiscalProfileId, scope.fiscalRegisterId, cashier.id]
    );
    if (card.rows.length !== 1) {
        throw new FullstackTestModeError('checkbox_fullstack_card_recovery_card_ambiguous', 'Card recovery did not create exactly one scoped card sale proof');
    }
    const row = card.rows[0];
    const valid = row.status === 'payment_recorded'
        && row.payment_status === 'confirmed'
        && row.fiscal_status === 'fiscalized'
        && row.payment_method === 'card_terminal'
        && String(row.received_amount_minor) === String(row.total_amount_minor)
        && String(row.change_amount_minor) === '0'
        && row.confirmation_tender === 'card_terminal_manual'
        && row.operation_status === 'fiscalized'
        && row.operation_stage === 'complete'
        && Number(row.fiscal_shift_id) === Number(newShiftId)
        && row.receipt_status === 'fiscalized'
        && row.receipt_type === 'sale'
        && String(row.receipt_total_amount_minor) === String(row.total_amount_minor)
        && String(row.provider_operation_id) === String(row.provider_receipt_id)
        && row.sell_job_status === 'succeeded'
        && row.sell_job_stage === 'complete'
        && row.attempt_count === 1
        && row.attempt_valid === true
        && row.allocation_count === 1
        && row.allocation_valid === true;
    if (!valid) {
        throw new FullstackTestModeError('checkbox_fullstack_card_recovery_card_invalid', 'Card recovery ledger does not match the exact immutable card contract');
    }
}

async function assertFinalCardClose(scope, cashier, cardOrderId, shiftId) {
    const aggregate = await loadCardRecoveryAggregate(scope);
    try {
        assert.deepEqual(aggregate, {
            orders: 1,
            completed_orders: 1,
            cash_orders: 0,
            card_orders: 1,
            unresolved_orders: 0,
            operations: 3,
            sales: 1,
            completed_sales: 1,
            sale_uuids: 1,
            shift_open_operations: 1,
            completed_shift_open_operations: 1,
            shift_close_operations: 1,
            completed_shift_close_operations: 1,
            receipts: 1,
            completed_receipts: 1,
            receipt_uuids: 1,
            jobs: 3,
            sell_jobs: 1,
            completed_sell_jobs: 1,
            shift_open_jobs: 1,
            completed_shift_open_jobs: 1,
            shift_close_jobs: 1,
            completed_shift_close_jobs: 1,
            unresolved_jobs: 0,
            attempts: 1,
            allocations: 1,
            refunds: 0,
            shifts: 1,
            closed_shifts: 1,
            shift_uuids: 1,
            matched_receipt_uuids: 1
        });
    } catch {
        throw new FullstackTestModeError(
            'checkbox_fullstack_final_card_close_aggregate_invalid',
            'Final one-card proof does not match the exact fail-closed ledger contract'
        );
    }

    const shift = await localOwnedShift(scope, cashier, { shiftId });
    if (!shift?.provider_shift_id
        || String(shift.status) !== 'closed'
        || String(shift.lifecycle_stage).toUpperCase() !== 'CLOSED') {
        throw new FullstackTestModeError(
            'checkbox_fullstack_final_card_close_shift_invalid',
            'Final one-card proof did not close the exact smoke-owned provider shift'
        );
    }

    const result = await pool.query(
        `SELECT payment_order.status,
                payment_order.payment_status,
                payment_order.fiscal_status,
                payment_order.payment_method,
                payment_order.total_amount_minor,
                payment_order.received_amount_minor,
                payment_order.change_amount_minor,
                payment_order.confirmation_snapshot->>'tender' AS confirmation_tender,
                operation.status AS operation_status,
                operation.external_stage AS operation_stage,
                operation.provider_operation_id,
                operation.fiscal_shift_id,
                receipt.status AS receipt_status,
                receipt.receipt_type,
                receipt.provider_receipt_id,
                receipt.total_amount_minor AS receipt_total_amount_minor,
                job.status AS sell_job_status,
                job.external_stage AS sell_job_stage,
                (SELECT COUNT(*)::int FROM payment_attempts attempt
                  WHERE attempt.fiscal_profile_id = payment_order.fiscal_profile_id
                    AND attempt.payment_order_id = payment_order.id) AS attempt_count,
                (SELECT BOOL_AND(
                            attempt.attempt_type = 'card_terminal_confirmation'
                            AND attempt.status = 'confirmed'
                            AND attempt.provider = 'terminal'
                            AND attempt.amount_minor = payment_order.total_amount_minor
                        )
                   FROM payment_attempts attempt
                  WHERE attempt.fiscal_profile_id = payment_order.fiscal_profile_id
                    AND attempt.payment_order_id = payment_order.id) AS attempt_valid,
                (SELECT COUNT(*)::int FROM payment_allocations allocation
                  WHERE allocation.fiscal_profile_id = payment_order.fiscal_profile_id
                    AND allocation.payment_order_id = payment_order.id) AS allocation_count,
                (SELECT BOOL_AND(
                            allocation.payment_method = 'card_terminal'
                            AND allocation.status = 'recorded'
                            AND allocation.amount_minor = payment_order.total_amount_minor
                        )
                   FROM payment_allocations allocation
                  WHERE allocation.fiscal_profile_id = payment_order.fiscal_profile_id
                    AND allocation.payment_order_id = payment_order.id) AS allocation_valid
           FROM payment_orders payment_order
           JOIN fiscal_operations operation
             ON operation.fiscal_profile_id = payment_order.fiscal_profile_id
            AND operation.payment_order_id = payment_order.id
            AND operation.operation_type = 'sale'
           JOIN fiscal_receipts receipt
             ON receipt.fiscal_profile_id = operation.fiscal_profile_id
            AND receipt.fiscal_operation_id = operation.id
            AND receipt.receipt_type = 'sale'
           JOIN payment_outbox_jobs job
             ON job.fiscal_profile_id = operation.fiscal_profile_id
            AND job.fiscal_operation_id = operation.id
            AND job.job_type = 'receipt_sell'
          WHERE payment_order.id = $1
            AND payment_order.fiscal_profile_id = $2
            AND payment_order.fiscal_register_id = $3
            AND payment_order.cashier_user_id = $4`,
        [cardOrderId, scope.fiscalProfileId, scope.fiscalRegisterId, cashier.id]
    );
    if (result.rows.length !== 1) {
        throw new FullstackTestModeError(
            'checkbox_fullstack_final_card_close_card_ambiguous',
            'Final proof did not create exactly one scoped card sale'
        );
    }
    const row = result.rows[0];
    const valid = row.status === 'payment_recorded'
        && row.payment_status === 'confirmed'
        && row.fiscal_status === 'fiscalized'
        && row.payment_method === 'card_terminal'
        && String(row.received_amount_minor) === String(row.total_amount_minor)
        && String(row.change_amount_minor) === '0'
        && row.confirmation_tender === 'card_terminal_manual'
        && row.operation_status === 'fiscalized'
        && row.operation_stage === 'complete'
        && Number(row.fiscal_shift_id) === Number(shiftId)
        && row.receipt_status === 'fiscalized'
        && row.receipt_type === 'sale'
        && String(row.receipt_total_amount_minor) === String(row.total_amount_minor)
        && String(row.provider_operation_id) === String(row.provider_receipt_id)
        && row.sell_job_status === 'succeeded'
        && row.sell_job_stage === 'complete'
        && row.attempt_count === 1
        && row.attempt_valid === true
        && row.allocation_count === 1
        && row.allocation_valid === true;
    if (!valid) {
        throw new FullstackTestModeError(
            'checkbox_fullstack_final_card_close_card_invalid',
            'Final proof card sale does not match the immutable payment/fiscal contract'
        );
    }
}

async function run() {
    const guard = assertFullstackTestModeInputs(process.env);
    const mutationRun = acquireMutationRunRecord(guard);
    const isCardRecovery = guard.stage === 'card_recovery';
    const isFinalCardClose = guard.stage === 'final_card_close';
    let recoveryBaseline = null;
    let recoveryShiftId = null;
    let cashier = null;
    let scope = null;
    let browser = null;
    let completed = false;
    try {
        if (isCardRecovery) {
            recoveryBaseline = await loadCardRecoveryBaseline(guard.local);
        }
        cashier = await seedExactUsers(guard.local);
        scope = isCardRecovery
            ? await verifyExistingCardRecoveryScope(guard.local, cashier, recoveryBaseline)
            : await configureDisposableScope(guard.local, cashier);
        const { chromium } = requirePlaywright();
        browser = await chromium.launch({ headless: process.env.CASHIER_PAYMENTS_BROWSER_SMOKE_HEADLESS !== 'false' });
        const context = await browser.newContext();
        const page = await context.newPage();
        await login(page, guard.baseUrl, cashier);
        const integrationOwnerToken = MUTATION_STAGES.has(guard.stage)
            ? await authenticateEventGenixUser(page, guard.baseUrl, {
                username: cashier.ownerUsername,
                password: cashier.password
            }, 'checkbox_fullstack_owner')
            : null;
        await page.goto(`${guard.baseUrl}/cashier-payments`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#paymentOrderForm');
        await page.waitForFunction(() => window.CashierPaymentsPage?.state?.registerState);
        await page.waitForFunction(() => {
            const queueState = window.CashierPaymentsPage?.state?.unresolvedQueueState;
            return Boolean(queueState) && !['unknown', 'checking'].includes(queueState);
        });
        const readiness = await forceProviderReadiness(page);
        if (guard.stage === 'preflight') {
            if (readiness.providerReady !== true
                || readiness.providerIdentityVerified !== true
                || readiness.signatureCertificateReady !== true
                || readiness.taxMappingReady !== true
                || readiness.integrationReady !== false
                || readiness.readinessCode !== 'payment_acceptance_disabled') {
                throw new FullstackTestModeError(
                    'checkbox_fullstack_preflight_not_ready',
                    `Provider identity/device readiness did not reach the safe acceptance-disabled state: ${JSON.stringify(readiness)}`
                );
            }
            assert.equal(await page.isDisabled('#createPaymentOrderBtn'), true);
            await assertNoLocalFiscalMutations();
            completed = true;
            console.log(JSON.stringify({ ok: true, smoke: 'checkbox:testmode:fullstack', stage: 'preflight', mutations: false, providerReady: true }));
            await context.close();
            return;
        }

        if (readiness.integrationReady !== true || readiness.readinessCode !== 'ready') {
            throw new FullstackTestModeError('checkbox_fullstack_mutation_readiness_not_ready', 'Mutation proof is blocked until exact provider/device readiness is ready');
        }

        if (isFinalCardClose) {
            if (String(readiness.shiftState || '').toLowerCase() !== 'closed') {
                throw new FullstackTestModeError(
                    'checkbox_fullstack_final_card_close_provider_shift_not_closed',
                    'Final one-card proof requires exact provider readiness with no OPENED or unknown shift'
                );
            }
            const cardOrderId = guard.resumeFinalDraft
                ? await confirmExistingCardDraft(page, await loadExactResumableCardDraft(scope, cashier))
                : await (async () => {
                    await assertNoLocalFiscalMutations();
                    return createAndConfirmOrder(page, 'card_terminal_manual');
                })();
            await waitForFiscalizedOrder(page, guard.baseUrl, cardOrderId);
            const ownedShift = await loadExactSaleShift(scope, cashier, cardOrderId);
            recoveryShiftId = Number(ownedShift.id);
            await closeOwnedShiftThroughEventGenix(page, integrationOwnerToken, scope, cashier, { shiftId: recoveryShiftId });
            await assertFinalCardClose(scope, cashier, cardOrderId, recoveryShiftId);
            mutationRun?.update('completed');
            completed = true;
            console.log(JSON.stringify({
                ok: true,
                smoke: 'checkbox:testmode:fullstack',
                stage: 'final_card_close',
                receipts: { card: 'DONE' },
                cashCreated: false,
                resumedExistingDraft: guard.resumeFinalDraft,
                shift: 'CLOSED',
                closePath: 'eventgenix_phase1',
                duplicateFiscalMutations: false
            }));
            await context.close();
            return;
        }
        if (isCardRecovery) {
            if (String(readiness.shiftState || '').toLowerCase() !== 'closed') {
                throw new FullstackTestModeError(
                    'checkbox_fullstack_card_recovery_provider_shift_not_closed',
                    'Card-only recovery requires exact provider readiness with no OPENED or unknown shift'
                );
            }
            const repeatedBaseline = await loadCardRecoveryBaseline(guard.local);
            try {
                assert.deepEqual(repeatedBaseline, recoveryBaseline);
            } catch {
                throw new FullstackTestModeError(
                    'checkbox_fullstack_card_recovery_baseline_drift',
                    'Preserved cash proof or exact test mapping changed before card confirmation'
                );
            }
            const cardOrderId = await createAndConfirmOrder(page, 'card_terminal_manual');
            await waitForFiscalizedOrder(page, guard.baseUrl, cardOrderId);
            const recoveryShift = await loadExactSaleShift(
                scope,
                cashier,
                cardOrderId,
                recoveryBaseline.baselineShiftId
            );
            recoveryShiftId = Number(recoveryShift.id);
            await closeOwnedShiftThroughEventGenix(page, integrationOwnerToken, scope, cashier, { shiftId: recoveryShiftId });
            await assertCardRecoveryFinal(scope, cashier, recoveryBaseline, cardOrderId, recoveryShiftId);
            mutationRun?.update('completed');
            completed = true;
            console.log(JSON.stringify({
                ok: true,
                smoke: 'checkbox:testmode:fullstack',
                stage: 'card_recovery',
                receipts: { card: 'DONE' },
                cashRepeated: false,
                shift: 'CLOSED',
                duplicateFiscalMutations: false
            }));
            await context.close();
            return;
        }

        await assertNoLocalFiscalMutations();

        const cashOrderId = await createAndConfirmOrder(page, 'cash');
        await waitForFiscalizedOrder(page, guard.baseUrl, cashOrderId);
        const cardOrderId = await createAndConfirmOrder(page, 'card_terminal_manual');
        await waitForFiscalizedOrder(page, guard.baseUrl, cardOrderId);

        await closeOwnedShiftThroughEventGenix(page, integrationOwnerToken, scope, cashier);
        await assertFinalLedger(scope);
        mutationRun?.update('completed');
        completed = true;
        console.log(JSON.stringify({
            ok: true,
            smoke: 'checkbox:testmode:fullstack',
            stage: 'mutations',
            receipts: { cash: 'DONE', card: 'DONE' },
            shift: 'CLOSED',
            duplicateFiscalMutations: false
        }));
        await context.close();
    } finally {
        await browser?.close().catch(() => {});
        if (!completed) {
            try {
                mutationRun?.update('failed_requires_inspection');
            } catch (error) {
                process.stderr.write(`${JSON.stringify({
                    ok: false,
                    code: 'checkbox_fullstack_run_ledger_update_failed',
                    errorCode: error?.code || error?.name || 'ledger_write_failed'
                })}\n`);
            }
            const cleanup = await cleanupOwnedShiftIfNeeded({
                guard,
                scope,
                cashier,
                targetShiftId: recoveryShiftId,
                baselineShiftId: recoveryBaseline?.baselineShiftId ?? null
            }).catch(error => ({
                attempted: true,
                closed: false,
                code: error?.code || error?.name || 'checkbox_fullstack_cleanup_failed'
            }));
            if (cleanup.closed !== true && (cleanup.attempted || cleanup.code)) {
                process.stderr.write(`${JSON.stringify({ ok: false, code: 'checkbox_fullstack_owned_shift_cleanup_failed', cleanupCode: cleanup.code || null })}\n`);
            }
        }
        await pool.end().catch(() => {});
    }
}

function fail(error) {
    process.stderr.write(`${JSON.stringify({
        ok: false,
        code: error?.code || error?.name || 'checkbox_fullstack_testmode_failed',
        message: String(error?.message || 'Full-stack Checkbox test-mode smoke failed').slice(0, 240)
    })}\n`);
    process.exitCode = 1;
}

if (require.main === module) run().catch(fail);

module.exports = {
    FullstackTestModeError,
    acquireMutationRunRecord,
    assertCardRecoveryFinal,
    assertFinalCardClose,
    assertFullstackTestModeInputs,
    confirmExistingCardDraft,
    isFiscalizedOrderState,
    loadCardRecoveryAggregate,
    loadCardRecoveryBaseline,
    loadLocalTestConfig,
    run
};
