#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { assertNonSecretConfig } = require('./configure-checkbox-park-pilot');
const {
    acceptanceDisabled,
    localTarget,
    parseArgs,
    verifyDatabase
} = require('./prepare-checkbox-single-register-qa');
const { loadCheckboxRuntimeConfig } = require('../services/checkbox/config');
const { createProviderFromConfig } = require('../services/checkbox/provider');

class SingleRegisterPreflightError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'SingleRegisterPreflightError';
        this.code = code;
    }
}

function loadConfig(filePath, businessContext) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new SingleRegisterPreflightError('single_register_preflight_config_missing', 'Local non-secret config is required');
    const config = JSON.parse(fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, ''));
    assertNonSecretConfig(config);
    const expectedScope = businessContext === 'event_genix'
        ? ['event_genix', 'park', 'middle']
        : ['dar', 'dar', 'dar'];
    if (config.crmProfileKey !== expectedScope[0]
        || config.locationAlias !== expectedScope[1]
        || config.registerAlias !== expectedScope[2]
        || config.expectedIsTest !== true) {
        throw new SingleRegisterPreflightError('single_register_preflight_scope_mismatch', 'Config does not match the exact requested test scope');
    }
    const options = {
        providerOrganizationId: String(config.providerOrganizationId || '').trim(),
        providerRegisterId: String(config.providerRegisterId || '').trim(),
        providerCashierId: String(config.providerCashierId || '').trim(),
        providerLicenseRef: String(config.registerCredentialRef || '').trim(),
        cashierLoginRef: String(config.cashierCredentialRef || '').trim()
    };
    if (Object.values(options).some(value => !value)) {
        throw new SingleRegisterPreflightError('single_register_preflight_identity_incomplete', 'Exact identity and credential references are required');
    }
    return { config, options };
}

function safeProviderResult(diagnostics = {}) {
    const checks = Array.isArray(diagnostics.checks) ? diagnostics.checks : [];
    const byCode = Object.fromEntries(checks.map(check => [check.code, {
        status: check.status,
        ready: check.ready === true,
        ...(check.code === 'current_shift' ? {
            shiftState: String(check.details?.shiftStatus || 'unknown').toLowerCase()
        } : {})
    }]));
    return {
        ready: diagnostics.ready === true,
        mutations: false,
        checks: byCode
    };
}

async function run({ argv = process.argv.slice(2), env = process.env } = {}) {
    const parsed = parseArgs(['verify', ...argv]);
    if (!acceptanceDisabled(env)) throw new SingleRegisterPreflightError('single_register_preflight_acceptance_enabled', 'Acceptance must remain false');
    if (String(env.CHECKBOX_EXPECT_IS_TEST || '').trim().toLowerCase() !== 'true') {
        throw new SingleRegisterPreflightError('single_register_preflight_test_mode_required', 'CHECKBOX_EXPECT_IS_TEST=true is required');
    }
    if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production'
        || Object.entries(env).some(([key, value]) => key.startsWith('RAILWAY_') && String(value || '').trim())) {
        throw new SingleRegisterPreflightError('single_register_preflight_production_forbidden', 'Production and Railway environments are forbidden');
    }
    const target = localTarget(env);
    const local = loadConfig(parsed.configFile, parsed.businessContext);
    const dbPool = new Pool({ connectionString: target.url.toString(), ssl: false, max: 2 });
    let localResult;
    try {
        const client = await dbPool.connect();
        try {
            await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
            localResult = await verifyDatabase(client, local.config, parsed.businessContext);
            await client.query('ROLLBACK');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    } finally {
        await dbPool.end();
    }
    if (!localResult.ready) throw new SingleRegisterPreflightError('single_register_preflight_local_not_ready', 'Local disposable mapping/binding state is not ready');

    const runtimeConfig = loadCheckboxRuntimeConfig({
        env,
        credentialRef: local.options.cashierLoginRef,
        licenseRef: local.options.providerLicenseRef,
        deviceRef: local.options.cashierLoginRef,
        allowLocalMockHost: false
    });
    if (runtimeConfig.expectedIsTest !== true) {
        throw new SingleRegisterPreflightError('single_register_preflight_runtime_test_required', 'Runtime credentials must require test mode');
    }
    const runtimeUrl = new URL(runtimeConfig.baseUrl);
    if (runtimeUrl.protocol !== 'https:' || !['api.checkbox.in.ua', 'api.checkbox.ua'].includes(runtimeUrl.hostname.toLowerCase())) {
        throw new SingleRegisterPreflightError('single_register_preflight_official_host_required', 'Only the official Checkbox HTTPS API is allowed');
    }
    const provider = createProviderFromConfig(runtimeConfig);
    try {
        const diagnostics = await provider.collectReadinessDiagnostics({
            expectedOrganizationId: local.options.providerOrganizationId,
            expectedRegisterId: local.options.providerRegisterId,
            expectedCashierId: local.options.providerCashierId,
            expectedIsTest: true
        }, {
            expectedTaxIds: [],
            requireSalesPermission: true,
            allowUnreportedPaymentPermissions: false
        });
        return {
            ready: localResult.ready && diagnostics.ready === true,
            businessContext: parsed.businessContext,
            scope: localResult.scope,
            acceptanceEnabled: false,
            local: localResult,
            checkbox: safeProviderResult(diagnostics)
        };
    } finally {
        provider.clearCachedToken();
    }
}

if (require.main === module) {
    run().then(result => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }).catch(error => {
        process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'single_register_preflight_failed', message: error.message })}\n`);
        process.exitCode = 1;
    });
}

module.exports = { SingleRegisterPreflightError, loadConfig, run, safeProviderResult };
