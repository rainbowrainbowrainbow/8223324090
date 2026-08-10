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
    attendance: [
        'tests/integration/attendance-lock-concurrency.integration.test.js',
        'tests/integration/hr-attendance-compensation-snapshot.integration.test.js',
        'tests/integration/hr-attendance-document-automation-concurrency.integration.test.js',
        'tests/integration/attendance-historical-grace-datafix.integration.test.js',
        'tests/integration/attendance-backup-roundtrip.integration.test.js',
        'tests/integration/full-backup-recovery.integration.test.js'
    ],
    'attendance-datafix': [
        'tests/integration/attendance-historical-grace-datafix.integration.test.js'
    ],
    recovery: ['tests/integration/full-backup-recovery.integration.test.js'],
    'banquet-recovery': ['tests/integration/banquet-production-recovery.integration.test.js'],
    hr: ['tests/integration/hr-disposable.integration.test.js'],
    permissions: ['tests/integration/permission-capabilities.integration.test.js'],
    payroll: [
        'tests/integration/payroll-profiles.integration.test.js',
        'tests/integration/payroll-simultaneous-additional.integration.test.js',
        'tests/integration/zrs-payroll-period-lock.integration.test.js',
        'tests/integration/payroll-installments.integration.test.js',
        'tests/integration/payroll-fullstack-settlement.integration.test.js'
    ],
    'payroll-fullstack': [
        'tests/integration/payroll-fullstack-settlement.integration.test.js'
    ],
    admission: [
        'tests/integration/admission-tickets.integration.test.js'
    ],
    'my-day': [
        'tests/integration/my-day-postgres.integration.test.js'
    ],
    'cashier-smoke': [
        'tests/integration/checkbox-park-cashier-smoke.integration.test.js'
    ],
    'checkbox-config': [
        'tests/integration/checkbox-park-config.integration.test.js'
    ],
    'checkbox-ui-real': [
        'tests/browser/checkbox-cashier-real-routes-browser-smoke.js'
    ],
    onboarding: [
        'tests/integration/fresh-db-startup.integration.test.js',
        'tests/integration/hr-onboarding-hire.integration.test.js',
        'tests/integration/account-onboarding.integration.test.js'
    ],
    backfill: ['tests/integration/hr-legacy-hire-backfill.integration.test.js'],
    fullstack: ['tests/browser/hr-onboarding-fullstack-browser-smoke.js'],
    qa: [
        'tests/integration/live-multi-segment-qa.integration.test.js',
        'tests/integration/live-multi-segment-runner.integration.test.js'
    ]
};

function usage() {
    return 'Usage: node scripts/run-isolated-postgres-tests.js <api|attendance|attendance-datafix|recovery|banquet-recovery|hr|permissions|payroll|payroll-fullstack|admission|my-day|cashier-smoke|checkbox-config|checkbox-ui-real|onboarding|backfill|fullstack|qa|all>';
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

async function loadMigrationLedger(testDb) {
    const pool = createPool(testDb);
    try {
        const result = await pool.query(
            `SELECT version, applied_at::text AS applied_at
             FROM schema_migrations
             ORDER BY version`
        );
        return result.rows;
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
        if (key.startsWith('RAILWAY_')
            || /(TOKEN|SECRET|API[_-]?KEY|WEBHOOK|SMTP|SENDGRID|TWILIO|STRIPE|OPENAI|ANTHROPIC|GEMINI|PINATA|CLOUDINARY|S3_|AWS_|OMNI|TELEGRAM|REPORT_BOT|KLESHNYA)/i.test(key)) {
            delete env[key];
        }
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
    const rendered = String(chunk);
    const dbErrors = rendered.split(/\r?\n/).filter(line => (
        /\[Migrate\] Migration failed:/.test(line)
        || /column "updated_at" of relation "leads" does not exist/.test(line)
        || /relation "procurement_(?:items|lists)" does not exist/.test(line)
    ));
    buffer.dbErrors.push(...dbErrors);
    const lines = `${buffer.text}${rendered}`.split(/\r?\n/);
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
    if (!child) return;
    if (child.exitCode !== null) return;
    // `close` is emitted after the process exits and its stdio streams close.
    // Waiting for it keeps a restarted suite from mixing late output from the
    // previous server process into the next startup diagnostics.
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGTERM');
    let timeoutId;
    const timeout = new Promise(resolve => {
        timeoutId = setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS);
    });
    const outcome = await Promise.race([closed, timeout]);
    clearTimeout(timeoutId);
    if (outcome === 'timeout' && child.exitCode === null) {
        child.kill('SIGKILL');
        await closed;
    }
}

async function runNodeProcess(testFile, args, env) {
    return new Promise((resolve, reject) => {
        let settled = false;
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

async function runNodeTest(testFile, env) {
    const args = ['--test', '--test-concurrency=1'];
    if (env.ISOLATED_TEST_NAME_PATTERN) {
        args.push('--test-name-pattern', env.ISOLATED_TEST_NAME_PATTERN);
    }
    args.push(testFile);
    return runNodeProcess(testFile, args, env);
}

async function runBrowserScript(testFile, env) {
    return runNodeProcess(testFile, [testFile], env);
}

function runsAgainstDatabaseOnly(testFile) {
    return testFile.includes('checkbox-park-cashier-smoke.integration')
        || testFile.includes('checkbox-park-config.integration');
}

async function runSuite(testDb, testFile) {
    const port = await reservePort();
    const checkboxBrowserMockPort = testFile.includes('checkbox-cashier-real-routes-browser-smoke') ? await reservePort() : null;
    const myDayOpenAiMockPort = testFile.includes('my-day-postgres.integration') ? await reservePort() : null;
    const baseUrl = `http://127.0.0.1:${port}`;
    assertSafeIsolatedTestUrl(baseUrl);
    const credentials = {
        username: `codex_db_test_${process.pid}_${crypto.randomBytes(3).toString('hex')}`,
        password: crypto.randomBytes(24).toString('base64url')
    };
    const serverEnv = buildServerEnvironment(testDb, port, credentials);
    delete serverEnv.PAYROLL_INSTALLMENTS_ACTIVATION_MONTH;
    if (testFile.includes('payroll-')) {
        serverEnv.PAYROLL_INSTALLMENTS_ACTIVATION_MONTH = '2000-01';
    }
    if (testFile.includes('payroll-fullstack-settlement.integration')) {
        serverEnv.PAYROLL_FULLSTACK_TEST_NOW = '2026-09-15T12:00:00.000Z';
        serverEnv.NODE_OPTIONS = [
            serverEnv.NODE_OPTIONS || '',
            '--require=./tests/helpers/payroll-fullstack-test-clock.js'
        ].filter(Boolean).join(' ');
    }
    if (myDayOpenAiMockPort) {
        serverEnv.OPENAI_API_KEY = 'isolated-my-day-openai-mock-key';
        serverEnv.OPENAI_API_BASE_URL = `http://127.0.0.1:${myDayOpenAiMockPort}/v1`;
        serverEnv.MY_DAY_OPENAI_MOCK_PORT = String(myDayOpenAiMockPort);
        serverEnv.MY_DAY_CLASSIFICATION_TIMEOUT_MS = '250';
    }
    if (checkboxBrowserMockPort) {
        const ref = 'PARK_MIDDLE_BROWSER';
        serverEnv.CHECKBOX_INTEGRATION_ENABLED = 'true';
        serverEnv.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = 'true';
        serverEnv.EVENTGENIX_CASHIER_PRO_ENABLED = 'false';
        serverEnv.CHECKBOX_EXPECT_IS_TEST = 'true';
        serverEnv.CHECKBOX_BROWSER_MOCK_PORT = String(checkboxBrowserMockPort);
        serverEnv.PAYMENT_OUTBOX_WAKEUP_DISABLED = 'true';
        serverEnv[`CHECKBOX_${ref}_BASE_URL`] = `http://127.0.0.1:${checkboxBrowserMockPort}`;
        serverEnv[`CHECKBOX_${ref}_LOGIN`] = 'mock-login';
        serverEnv[`CHECKBOX_${ref}_PASSWORD`] = 'mock-password';
        serverEnv[`CHECKBOX_${ref}_LICENSE_KEY`] = 'mock-license';
        serverEnv[`CHECKBOX_${ref}_ACCESS_KEY`] = 'mock-access';
        serverEnv[`CHECKBOX_${ref}_DEVICE_ID`] = 'eventgenix-browser-smoke-device';
    }
    const testEnv = {
        ...serverEnv,
        TEST_URL: baseUrl,
        TEST_USER: credentials.username,
        TEST_PASS: credentials.password,
        REQUIRE_ISOLATED_TEST_TARGET: 'true',
        ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true',
        RUN_HR_DISPOSABLE_INTEGRATION: testFile.includes('hr-disposable') ? 'true' : 'false',
        RUN_PERMISSION_CAPABILITIES_INTEGRATION: testFile.includes('permission-capabilities') ? 'true' : 'false',
        RUN_ATTENDANCE_LOCK_INTEGRATION: testFile.includes('attendance-lock-concurrency') ? 'true' : 'false',
        RUN_ATTENDANCE_DATAFIX_INTEGRATION: testFile.includes('attendance-historical-grace-datafix') ? 'true' : 'false',
        RUN_HR_ATTENDANCE_COMPENSATION_INTEGRATION: testFile.includes('hr-attendance-compensation-snapshot') ? 'true' : 'false',
        RUN_HR_ATTENDANCE_DOCUMENT_AUTOMATION_INTEGRATION: testFile.includes('hr-attendance-document-automation-concurrency') ? 'true' : 'false',
        RUN_ATTENDANCE_BACKUP_INTEGRATION: testFile.includes('attendance-backup-roundtrip') ? 'true' : 'false',
        RUN_FULL_BACKUP_RECOVERY_INTEGRATION: testFile.includes('full-backup-recovery') ? 'true' : 'false',
        RUN_BANQUET_PRODUCTION_RECOVERY_INTEGRATION: testFile.includes('banquet-production-recovery.integration') ? 'true' : 'false',
        RUN_PAYROLL_PROFILES_INTEGRATION: testFile.includes('payroll-profiles') ? 'true' : 'false',
        RUN_PAYROLL_SIMULTANEOUS_ADDITIONAL_INTEGRATION: testFile.includes('payroll-simultaneous-additional') ? 'true' : 'false',
        RUN_ZRS_PAYROLL_PERIOD_LOCK_INTEGRATION: testFile.includes('zrs-payroll-period-lock') ? 'true' : 'false',
        RUN_PAYROLL_INSTALLMENTS_INTEGRATION: testFile.includes('payroll-installments') ? 'true' : 'false',
        RUN_PAYROLL_FULLSTACK_SETTLEMENT_INTEGRATION: testFile.includes('payroll-fullstack-settlement') ? 'true' : 'false',
        RUN_ADMISSION_TICKETS_INTEGRATION: testFile.includes('admission-tickets') ? 'true' : 'false',
        RUN_MY_DAY_POSTGRES_INTEGRATION: testFile.includes('my-day-postgres.integration') ? 'true' : 'false',
        RUN_CHECKBOX_PARK_CASHIER_SMOKE_INTEGRATION: testFile.includes('checkbox-park-cashier-smoke') ? 'true' : 'false',
        RUN_CHECKBOX_PARK_CONFIG_INTEGRATION: testFile.includes('checkbox-park-config') ? 'true' : 'false',
        RUN_HR_ONBOARDING_INTEGRATION: testFile.includes('hr-onboarding-hire') ? 'true' : 'false',
        RUN_ACCOUNT_ONBOARDING_INTEGRATION: testFile.includes('account-onboarding.integration') ? 'true' : 'false',
        RUN_HR_LEGACY_BACKFILL_INTEGRATION: testFile.includes('hr-legacy-hire-backfill') ? 'true' : 'false',
        RUN_HR_ONBOARDING_FULLSTACK_BROWSER: testFile.includes('hr-onboarding-fullstack-browser-smoke') ? 'true' : 'false',
        RUN_FRESH_DB_STARTUP_INTEGRATION: testFile.includes('fresh-db-startup') ? 'true' : 'false',
        RUN_LIVE_MULTI_SEGMENT_QA_INTEGRATION: testFile.includes('live-multi-segment') ? 'true' : 'false'
    };
    const output = { text: '', dbErrors: [] };
    let server;
    let serverSpawnError = null;
    let primaryError = null;
    let cleanupError = null;

    const launchServerOnce = async () => {
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

        const missingMigrations = await verifyAllMigrationsApplied(testDb);
        if (missingMigrations.length) {
            throw new Error(
                `Single fresh startup left ${missingMigrations.length} migration(s) pending: ${missingMigrations.slice(0, 5).join(', ')}`
            );
        }
        if (output.dbErrors.length) {
            throw new Error(`PostgreSQL startup errors detected:\n${output.dbErrors.join('\n')}`);
        }
    };

    try {
        await resetPublicSchema(testDb);
        await launchServerOnce();

        const verifyInitializedDatabaseRestart = testFile.includes('fresh-db-startup')
            || testFile.includes('payroll-installments.integration');
        if (verifyInitializedDatabaseRestart) {
            const firstLedger = await loadMigrationLedger(testDb);
            await stopServer(server);
            server = null;
            output.text = '';
            output.dbErrors = [];
            await launchServerOnce();
            const secondLedger = await loadMigrationLedger(testDb);
            if (JSON.stringify(secondLedger) !== JSON.stringify(firstLedger)) {
                throw new Error('Migration ledger changed during idempotent initialized-DB restart');
            }
        }
        if (runsAgainstDatabaseOnly(testFile)) {
            await stopServer(server);
            server = null;
            output.text = '';
            output.dbErrors = [];
        }
        if (testFile.startsWith('tests/browser/')) await runBrowserScript(testFile, testEnv);
        else await runNodeTest(testFile, testEnv);
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
    if (!['api', 'attendance', 'attendance-datafix', 'recovery', 'banquet-recovery', 'hr', 'permissions', 'payroll', 'payroll-fullstack', 'admission', 'my-day', 'cashier-smoke', 'checkbox-config', 'checkbox-ui-real', 'onboarding', 'backfill', 'fullstack', 'qa', 'all'].includes(mode)) throw new Error(usage());
    const testDb = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    const files = mode === 'all'
        ? [...MODES.api, ...MODES.attendance, ...MODES.hr, ...MODES.permissions, ...MODES.payroll, ...MODES.admission, ...MODES['my-day'], ...MODES['cashier-smoke'], ...MODES['checkbox-config'], ...MODES['checkbox-ui-real'], ...MODES.onboarding, ...MODES.backfill]
        : MODES[mode];

    for (const testFile of files) {
        process.stdout.write(`\n[isolated-db] Running ${testFile} against ${testDb.hostname}/${testDb.databaseName}\n`);
        await runSuite(testDb, testFile);
    }
}

main().catch(error => {
    process.stderr.write(`[isolated-db] ${error.message}\n`);
    process.exitCode = 1;
});
