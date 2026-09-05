#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const { RESET_CONFIRMATION, assertSafeTestDatabaseUrl } = require('./test-db-safety');
const {
    APPLY_CONFIRM_ENV,
    CatalogSaleMappingConfigError,
    applyCatalogSaleMappings,
    buildSafeDryRun,
    planCatalogSaleMappings
} = require('../services/payments/catalogSaleMappingConfigurator');

function parseOptions(argv = process.argv.slice(2)) {
    if (argv.some(arg => /database|url|password|secret|token|license|credential/i.test(arg))) {
        throw new CatalogSaleMappingConfigError('catalog_mapping_cli_secret_forbidden', 'Database URLs and secret-like values are forbidden in CLI arguments');
    }
    const modes = argv.filter(arg => ['dry-run', 'apply'].includes(arg));
    const contextArgs = argv.filter(arg => arg.startsWith('--business-context='));
    const includeTestRoutes = argv.includes('--include-test-routes');
    const unknown = argv.filter(arg => !['dry-run', 'apply', '--include-test-routes'].includes(arg) && !arg.startsWith('--business-context='));
    if (unknown.length || modes.length > 1) {
        throw new CatalogSaleMappingConfigError('catalog_mapping_cli_invalid', 'Usage: configure-checkbox-catalog-sale.js [dry-run|apply] [--business-context=event_genix|dar] [--include-test-routes]');
    }
    if (contextArgs.length > 1) {
        throw new CatalogSaleMappingConfigError('catalog_mapping_cli_invalid', 'Only one --business-context value is allowed');
    }
    const businessContext = contextArgs[0] ? contextArgs[0].split('=', 2)[1] : '';
    if (businessContext && !['event_genix', 'dar'].includes(businessContext)) {
        throw new CatalogSaleMappingConfigError('catalog_mapping_business_context_invalid', 'Business context must be event_genix or dar');
    }
    return {
        mode: modes[0] || 'dry-run',
        mappingOptions: {
            ...(businessContext ? { businessContexts: [businessContext] } : {}),
            ...(includeTestRoutes ? { includeTestRoutes: true } : {})
        }
    };
}

function parseMode(argv = process.argv.slice(2)) {
    return parseOptions(argv).mode;
}

function localTarget(env = process.env) {
    const target = assertSafeTestDatabaseUrl(env.TEST_DATABASE_URL, {
        ...env,
        TEST_DATABASE_RESET_CONFIRM: RESET_CONFIRMATION
    });
    if (!target.isLocal) {
        throw new CatalogSaleMappingConfigError('catalog_mapping_local_database_required', 'Catalog mapping configuration requires a loopback disposable test database');
    }
    return target;
}

async function run({ argv = process.argv.slice(2), env = process.env, poolFactory = options => new Pool(options) } = {}) {
    const { mode, mappingOptions } = parseOptions(argv);
    const target = localTarget(env);
    const dbPool = poolFactory({ connectionString: target.url.toString(), ssl: false, max: 2 });
    const client = await dbPool.connect();
    try {
        if (mode === 'apply') return await applyCatalogSaleMappings(client, env, mappingOptions);
        return buildSafeDryRun(await planCatalogSaleMappings(client, mappingOptions));
    } finally {
        client.release();
        await dbPool.end();
    }
}

if (require.main === module) {
    run()
        .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
        .catch(error => {
            const code = error?.code || 'catalog_mapping_failed';
            process.stderr.write(`${JSON.stringify({ ok: false, code, message: error.message })}\n`);
            process.exitCode = 1;
        });
}

module.exports = { localTarget, parseMode, parseOptions, run, APPLY_CONFIRM_ENV };
