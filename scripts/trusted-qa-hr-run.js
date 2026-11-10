#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { parseArgs } = require('node:util');
const { Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('./test-db-safety');
const { preflightHrFixtureQaPlan, createHrFixtureQaRun, finishHrFixtureQaRun } = require('../services/hrFixtureQa');

const LIVE_URL = 'https://8223324090-production.up.railway.app';
const PRODUCTION_TARGET_HASH = '6fb86cf6959f026d7c55b6c65edffc3499e5bb581d51840a730f915fef0e9cfd';

function connectionString(local, mode, env) {
    if (local) {
        if (env.TEST_DATABASE_RESET_CONFIRM !== 'RESET_DISPOSABLE_TEST_DATABASE') throw new Error('Disposable database confirmation required.');
        const db = assertSafeTestDatabaseUrl(env.TEST_DATABASE_URL, env);
        if (!db.isLocal) throw new Error('The local HR QA command requires a loopback database.');
        return db.url.toString();
    }
    const value = mode === 'plan' ? env.PRODUCTION_READONLY_DATABASE_URL : env.TRUSTED_QA_OPERATOR_DATABASE_URL;
    if (!value) throw new Error('The exact process-local HR QA database credential is required.');
    const url = new URL(value);
    const target = createHash('sha256').update(`${url.hostname}:${url.port}${url.pathname}`).digest('hex');
    if (target !== PRODUCTION_TARGET_HASH) throw new Error('The HR QA database target does not match production.');
    return value;
}

function resolveTokenFile(file) {
    if (!path.isAbsolute(file || '')) throw new Error('An absolute private --token-file is required.');
    const parent = fs.realpathSync(path.dirname(file));
    const repository = fs.realpathSync(path.resolve(__dirname, '..'));
    const relative = path.relative(repository, parent);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
        throw new Error('The token file must be outside the repository.');
    }
    if (process.platform !== 'win32' && (fs.statSync(parent).mode & 0o077)) {
        throw new Error('The token directory must be private.');
    }
    return path.join(parent, path.basename(file));
}

async function main(argv = process.argv.slice(2), env = process.env) {
    const { values } = parseArgs({ args: argv, options: {
        mode: { type: 'string', default: 'plan' }, 'plan-file': { type: 'string' },
        confirm: { type: 'string' }, 'approved-hash': { type: 'string' },
        'token-file': { type: 'string' }, local: { type: 'boolean' }
    } });
    const mode = values.mode;
    if (!['plan', 'create', 'finish'].includes(mode) || !path.isAbsolute(values['plan-file'] || '')) {
        throw new Error('An exact mode and an absolute --plan-file are required.');
    }
    if (mode !== 'plan' && (values.confirm !== 'EXECUTE_EXACT_HR_FIXTURE_QA'
        || !/^[a-f0-9]{64}$/.test(values['approved-hash'] || ''))) {
        throw new Error('An exact reviewed plan hash and HR QA confirmation are required.');
    }
    const plan = JSON.parse(fs.readFileSync(values['plan-file'], 'utf8'));
    const url = connectionString(values.local, mode, env);
    if (!values.local && mode !== 'finish') {
        const live = await fetch(LIVE_URL + '/api/version', { redirect: 'error', signal: AbortSignal.timeout(8000) });
        const release = await live.json();
        if (!live.ok || release.commitSha !== plan.releaseSha || release.sourceBranch !== 'codex/eventgenix-production'
            || release.deploymentMetadata?.complete !== true) throw new Error('Live release identity does not match the exact HR QA plan.');
    }
    const tokenFile = mode === 'create' ? resolveTokenFile(values['token-file']) : null;
    const db = new Client({ connectionString: url, connectionTimeoutMillis: 8000, statement_timeout: 15000,
        ...(values.local ? { ssl: false } : {}) });
    await db.connect();
    try {
        await db.query(mode === 'plan' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
        if (mode === 'plan') {
            const result = await preflightHrFixtureQaPlan(db, plan);
            await db.query('ROLLBACK');
            return { planHash: result.planHash, runId: result.plan.runId, ready: true };
        }
        if (mode === 'finish') {
            const result = await finishHrFixtureQaRun(db, plan, values['approved-hash']);
            await db.query('COMMIT');
            return result;
        }
        const created = await createHrFixtureQaRun(db, plan, values['approved-hash']);
        fs.writeFileSync(tokenFile, created.token, { flag: 'wx', mode: 0o600 });
        await db.query('COMMIT');
        return { runId: created.run.run_id, expiresAt: created.run.expires_at, tokenFile };
    } catch (error) {
        await db.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await db.end();
    }
}

if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.code || 'HR_QA_OPERATOR_COMMAND_FAILED');
    process.exitCode = 1;
});

module.exports = { main };
