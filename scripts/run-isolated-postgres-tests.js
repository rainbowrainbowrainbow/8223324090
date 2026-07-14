#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const {
    assertSafeTestDatabaseUrl,
    assertSafeIsolatedTestUrl
} = require('./test-db-safety');

const ROOT = path.resolve(__dirname, '..');
const STARTUP_TIMEOUT_MS = 180_000;
const SHUTDOWN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = Number(process.env.ISOLATED_TEST_TIMEOUT_MS) || 15 * 60_000;
const POLL_INTERVAL_MS = 500;
const MODES = {
    api: ['tests/api.test.js'],
    hr: ['tests/integration/hr-disposable.integration.test.js'],
    qa: [
        'tests/integration/live-multi-segment-qa.integration.test.js',
        'tests/integration/live-multi-segment-runner.integration.test.js'
    ]
};

function usage() {
    return 'Usage: node scripts/run-isolated-postgres-tests.js <api|hr|qa|all>';
}

function createPool(testDb) {
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 4,
        connectionTimeoutMillis: 10_000
    });
}

async function resetPublicSchema(testDb) {
    const pool = createPool(testDb);
    try {
        await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
        await pool.query('CREATE SCHEMA public');
        await pool.query('GRANT ALL ON SCHEMA public TO PUBLIC');
    } finally {
        await pool.end();
    }
}

async function verifyAllMigrationsApplied(testDb) {
    const expected = fs.readdirSync(path.join(ROOT, 'db', 'migrations'))
        .filter(file => file.endsWith('.sql'))
        .map(file => file.slice(0, -4));
    const pool = createPool(testDb);
    try {
        const result = await pool.query('SELECT version FROM schema_migrations');
        const applied = new Set(result.rows.map(row => row.version));
        const missing = expected.filter(version => !applied.has(version));
        return missing;
    } finally {
        await pool.end();
    }
}

async function reservePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

function buildServerEnvironment(testDb, port, credentials) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key.startsWith('RAILWAY_')) delete env[key];
    }

    Object.assign(env, {
        NODE_ENV: 'test',
        PORT: String(port),
        LOG_LEVEL: 'warn',
        JWT_SECRET: crypto.randomBytes(64).toString('hex'),
        BOOTSTRAP_CREATOR_USERNAME: credentials.username,
        BOOTSTRAP_CREATOR_PASSWORD: credentials.password,
        BOOTSTRAP_CREATOR_NAME: 'Isolated DB Test Creator',
        RAILWAY_PUBLIC_DOMAIN: '',
        RAILWAY_ENVIRONMENT: '',
        RAILWAY_PROJECT_ID: '',
        RAILWAY_SERVICE_ID: '',
        TELEGRAM_BOT_TOKEN: '',
        TELEGRAM_DEFAULT_CHAT_ID: '',
        REPORT_BOT_TOKEN: '',
        KLESHNYA_WEBHOOK_SECRET: '',
        RATE_LIMIT_MAX: '10000',
        LOGIN_RATE_LIMIT_MAX: '1000'
    });

    if (testDb.isLocal) {
        env.DATABASE_URL = '';
        env.PGHOST = testDb.hostname;
        env.PGPORT = testDb.url.port || '5432';
        env.PGDATABASE = testDb.databaseName;
        env.PGUSER = decodeURIComponent(testDb.url.username || '');
        env.PGPASSWORD = decodeURIComponent(testDb.url.password || '');
        env.PGSSLMODE = 'disable';
    } else {
        env.DATABASE_URL = testDb.url.toString();
        delete env.PGHOST;
        delete env.PGPORT;
        delete env.PGDATABASE;
        delete env.PGUSER;
        delete env.PGPASSWORD;
    }
    return env;
}

function appendOutput(buffer, chunk) {
    const lines = `${buffer.text}${chunk}`.split(/\r?\n/);
    buffer.text = lines.slice(-80).join('\n');
}

async function waitForServer(baseUrl, child, output, getSpawnError) {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const spawnError = getSpawnError?.();
        if (spawnError) throw new Error(`Could not start isolated server: ${spawnError.message}`);
        if (child.exitCode !== null) {
            throw new Error(`Isolated server exited during startup (${child.exitCode})\n${output.text}`);
        }
        try {
            const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
            if (response.ok) return;
        } catch {
            // Server is still applying initialization/migrations.
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(`Isolated server did not become healthy in ${STARTUP_TIMEOUT_MS}ms\n${output.text}`);
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS));
    if (await Promise.race([exited, timeout]) === 'timeout' && child.exitCode === null) {
        child.kill('SIGKILL');
        await exited;
    }
}

async function runNodeTest(testFile, env) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const args = ['--test', '--test-concurrency=1'];
        if (env.ISOLATED_TEST_NAME_PATTERN) {
            args.push('--test-name-pattern', env.ISOLATED_TEST_NAME_PATTERN);
        }
        args.push(testFile);
        const child = spawn(process.execPath, args, {
            cwd: ROOT,
            env,
            stdio: 'inherit',
            windowsHide: true
        });
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill('SIGKILL');
            reject(new Error(`${testFile} exceeded isolated test timeout ${TEST_TIMEOUT_MS}ms`));
        }, TEST_TIMEOUT_MS);
        child.once('error', error => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
        });
        child.once('exit', (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (code === 0) return resolve();
            reject(new Error(`${testFile} failed (${signal || `exit ${code}`})`));
        });
    });
}

async function runSuite(testDb, testFile) {
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    assertSafeIsolatedTestUrl(baseUrl);
    const credentials = {
        username: `codex_db_test_${process.pid}_${crypto.randomBytes(3).toString('hex')}`,
        password: crypto.randomBytes(24).toString('base64url')
    };
    const serverEnv = buildServerEnvironment(testDb, port, credentials);
    const testEnv = {
        ...serverEnv,
        TEST_URL: baseUrl,
        TEST_USER: credentials.username,
        TEST_PASS: credentials.password,
        REQUIRE_ISOLATED_TEST_TARGET: 'true',
        ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true',
        RUN_HR_DISPOSABLE_INTEGRATION: testFile.includes('hr-disposable') ? 'true' : 'false',
        RUN_LIVE_MULTI_SEGMENT_QA_INTEGRATION: testFile.includes('live-multi-segment') ? 'true' : 'false'
    };
    const output = { text: '' };
    let server;
    let serverSpawnError = null;
    let primaryError = null;
    let cleanupError = null;

    try {
        await resetPublicSchema(testDb);
        let missingMigrations = [];
        for (let startupPass = 1; startupPass <= 2; startupPass++) {
            serverSpawnError = null;
            server = spawn(process.execPath, ['server.js'], {
                cwd: ROOT,
                env: serverEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });
            server.once('error', error => { serverSpawnError = error; });
            server.stdout.on('data', chunk => appendOutput(output, chunk));
            server.stderr.on('data', chunk => appendOutput(output, chunk));
            await waitForServer(baseUrl, server, output, () => serverSpawnError);
            missingMigrations = await verifyAllMigrationsApplied(testDb);
            if (!missingMigrations.length) break;
            if (startupPass === 1) {
                appendOutput(output, `\n[isolated-db] Repeating startup for ${missingMigrations.length} pending legacy data migration(s)\n`);
                await stopServer(server);
                server = null;
            }
        }
        if (missingMigrations.length) {
            throw new Error(
                `Server started without applying ${missingMigrations.length} migration(s): ${missingMigrations.slice(0, 5).join(', ')}\n`
                + `Isolated server startup tail:\n${output.text}`
            );
        }
        await runNodeTest(testFile, testEnv);
    } catch (error) {
        primaryError = new Error(`${error.message}\nIsolated server tail:\n${output.text}`);
    } finally {
        try {
            await stopServer(server);
            await resetPublicSchema(testDb);
        } catch (error) {
            cleanupError = error;
        }
    }

    if (cleanupError) {
        const detail = primaryError ? `; original failure: ${primaryError.message}` : '';
        throw new Error(`Isolated DB cleanup failed: ${cleanupError.message}${detail}`);
    }
    if (primaryError) throw primaryError;
}

async function main() {
    const mode = String(process.argv[2] || '').toLowerCase();
    if (!['api', 'hr', 'qa', 'all'].includes(mode)) throw new Error(usage());
    const testDb = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    const files = mode === 'all' ? [...MODES.api, ...MODES.hr] : MODES[mode];

    for (const testFile of files) {
        process.stdout.write(`\n[isolated-db] Running ${testFile} against ${testDb.hostname}/${testDb.databaseName}\n`);
        await runSuite(testDb, testFile);
    }
}

main().catch(error => {
    process.stderr.write(`[isolated-db] ${error.message}\n`);
    process.exitCode = 1;
});
