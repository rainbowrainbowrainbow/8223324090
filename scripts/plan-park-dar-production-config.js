#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const {
    ParkDarProductionPlanError,
    databasePoolConfig,
    fetchProductionAttestation,
    requiredDatabaseUrl,
    runReadOnlyPlan,
    sha256
} = require('../services/payments/parkDarProductionConfigPlanner');
const MAX_PROTECTED_JSON_BYTES = 1024 * 1024;

function parseArgs(argv = process.argv.slice(2)) {
    if (argv.some(arg => /(?:--apply|--write|--execute|--fix|--attest|database|url|password|secret|token|license|credential)/i.test(arg))) {
        throw new ParkDarProductionPlanError('park_dar_production_plan_cli_forbidden');
    }
    const prefixes = [
        '--manifest-file=',
        '--expected-manifest-sha256='
    ];
    const allowed = argv.filter(arg => prefixes.some(prefix => arg.startsWith(prefix)));
    if (allowed.length !== argv.length || allowed.length !== prefixes.length) {
        throw new ParkDarProductionPlanError('park_dar_production_plan_cli_invalid');
    }
    const values = Object.fromEntries(prefixes.map(prefix => {
        const matches = argv.filter(arg => arg.startsWith(prefix));
        if (matches.length !== 1) throw new ParkDarProductionPlanError('park_dar_production_plan_cli_invalid');
        return [prefix, matches[0].slice(prefix.length).trim()];
    }));
    if (Object.values(values).some(value => !value)) throw new ParkDarProductionPlanError('park_dar_production_plan_cli_invalid');
    if (!/^[a-f0-9]{64}$/i.test(values['--expected-manifest-sha256='])) {
        throw new ParkDarProductionPlanError('park_dar_production_plan_cli_hash_invalid');
    }
    return {
        manifestFile: path.resolve(values['--manifest-file=']),
        expectedManifestSha256: values['--expected-manifest-sha256='].toLowerCase()
    };
}

function readProtectedJson(filePath, {
    missingCode = 'park_dar_production_manifest_file_missing',
    invalidCode = 'park_dar_production_manifest_json_invalid'
} = {}) {
    if (!filePath || !fs.existsSync(filePath)) throw new ParkDarProductionPlanError(missingCode);
    try {
        if (fs.statSync(filePath).size > MAX_PROTECTED_JSON_BYTES) {
            throw new ParkDarProductionPlanError('park_dar_protected_input_too_large');
        }
        const raw = fs.readFileSync(filePath);
        return {
            value: JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')),
            sha256: sha256(raw)
        };
    } catch (error) {
        if (error instanceof ParkDarProductionPlanError) throw error;
        throw new ParkDarProductionPlanError(invalidCode);
    }
}

function readManifest(filePath) {
    return readProtectedJson(filePath).value;
}

function isInsideDirectory(candidatePath, directoryPath) {
    const relative = path.relative(path.resolve(directoryPath), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertProtectedInputFiles({ manifestFile }, {
    repositoryRoot = path.resolve(__dirname, '..')
} = {}) {
    const realRepositoryRoot = fs.realpathSync(repositoryRoot);
    for (const filePath of [manifestFile]) {
        if (isInsideDirectory(filePath, realRepositoryRoot)) {
            throw new ParkDarProductionPlanError('park_dar_protected_input_inside_repository');
        }
        if (fs.existsSync(filePath) && isInsideDirectory(fs.realpathSync(filePath), realRepositoryRoot)) {
            throw new ParkDarProductionPlanError('park_dar_protected_input_inside_repository');
        }
    }
    return true;
}

async function run({
    argv = process.argv.slice(2),
    env = process.env,
    poolFactory = options => new Pool(options),
    attestationFetcher = fetchProductionAttestation
} = {}) {
    const options = parseArgs(argv);
    assertProtectedInputFiles(options);
    const databaseUrl = requiredDatabaseUrl(env);
    const manifest = readProtectedJson(options.manifestFile);
    if (manifest.sha256 !== options.expectedManifestSha256) {
        throw new ParkDarProductionPlanError('park_dar_manifest_hash_mismatch');
    }
    const attestationEnvelope = await attestationFetcher({
        manifest: manifest.value,
        manifestSha256: manifest.sha256
    });
    const dbPool = poolFactory({
        ...databasePoolConfig(env, databaseUrl),
        max: 1,
        connectionTimeoutMillis: 5000,
        application_name: 'eventgenix-park-dar-production-readonly-plan'
    });
    try {
        return await runReadOnlyPlan({
            dbPool,
            manifest: manifest.value,
            attestationEnvelope,
            manifestFileSha256: manifest.sha256,
            expectedManifestSha256: options.expectedManifestSha256,
            env
        });
    } finally {
        await dbPool.end();
    }
}

if (require.main === module) {
    run()
        .then(result => {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            if (!result.ready) process.exitCode = 2;
        })
        .catch(error => {
            process.stderr.write(`${JSON.stringify({
                ok: false,
                code: error?.code || 'park_dar_production_plan_failed'
            })}\n`);
            process.exitCode = 2;
        });
}

module.exports = { assertProtectedInputFiles, parseArgs, readManifest, readProtectedJson, run };
