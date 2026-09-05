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
const ISOLATED_DATABASE_LOCK_NAMESPACE = 'eventgenix-isolated-postgres-runner-v1';
const MODES = {
    api: ['tests/api.test.js'],
    attendance: [
        'tests/integration/attendance-lock-concurrency.integration.test.js',
        'tests/integration/hr-scheduler-jobs.integration.test.js',
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
    'catalog-sale': [
        'tests/integration/catalog-sale-migrations.integration.test.js'
    ],
    'catalog-sale-local-qa': [
        'tests/integration/catalog-sale-local-provider.integration.test.js'
    ],
    'my-day': [
        'tests/integration/my-day-postgres.integration.test.js'
    ],
    'my-day-browser': [
        'tests/browser/my-day-actual-app-browser-smoke.js'
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
    'checkbox-ui-testmode-preflight': [
        'tests/browser/checkbox-cashier-real-testmode-browser-smoke.js'
    ],
    'checkbox-ui-testmode': [
        'tests/browser/checkbox-cashier-real-testmode-browser-smoke.js'
    ],
    'checkbox-ui-testmode-card-recovery': [
        'tests/browser/checkbox-cashier-real-testmode-browser-smoke.js'
    ],
    'checkbox-ui-testmode-final-card-close': [
        'tests/browser/checkbox-cashier-real-testmode-browser-smoke.js'
    ],
    onboarding: [
        'tests/integration/fresh-db-startup.integration.test.js',
        'tests/integration/hr-onboarding-hire.integration.test.js',
        'tests/integration/account-onboarding.integration.test.js'
    ],
    backfill: ['tests/integration/hr-legacy-hire-backfill.integration.test.js'],
    'upload-backfill': ['tests/integration/legacy-upload-backfill.integration.test.js'],
    fullstack: ['tests/browser/hr-onboarding-fullstack-browser-smoke.js'],
    qa: [
        'tests/integration/live-multi-segment-qa.integration.test.js',
        'tests/integration/live-multi-segment-runner.integration.test.js'
    ]
};

function usage() {
    return 'Usage: node scripts/run-isolated-postgres-tests.js <api|attendance|attendance-datafix|recovery|banquet-recovery|hr|permissions|payroll|payroll-fullstack|admission|catalog-sale|catalog-sale-local-qa|my-day|my-day-browser|cashier-smoke|checkbox-config|checkbox-ui-real|checkbox-ui-testmode-preflight|checkbox-ui-testmode|checkbox-ui-testmode-card-recovery|checkbox-ui-testmode-final-card-close|onboarding|backfill|upload-backfill|fullstack|qa|all>';
}

function isCheckboxPaymentAcceptanceEnabledForParent(value) {
    return /^(1|true)$/i.test(String(value || '').trim());
}

function createPool(testDb) {
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 4,
        connectionTimeoutMillis: 10_000
    });
}

async function acquireIsolatedDatabaseLock(testDb, {
    poolFactory = createPool,
    write = message => process.stdout.write(message)
} = {}) {
    const lockPool = poolFactory(testDb);
    let lockClient = null;
    const lockParams = [ISOLATED_DATABASE_LOCK_NAMESPACE];
    const acquireSql = 'SELECT pg_advisory_lock(hashtext($1), hashtext(current_database()))';
    const releaseSql = 'SELECT pg_advisory_unlock(hashtext($1), hashtext(current_database()))';
    const safeTarget = `${testDb.hostname}/${testDb.databaseName}`;

    try {
        lockClient = await lockPool.connect();
        write(`[isolated-db] Waiting for exclusive disposable database lock: ${safeTarget}\n`);
        await lockClient.query(acquireSql, lockParams);
        write(`[isolated-db] Acquired exclusive disposable database lock: ${safeTarget}\n`);
    } catch (error) {
        if (lockClient) lockClient.release();
        await lockPool.end().catch(() => {});
        throw error;
    }

    let released = false;
    return {
        async release() {
            if (released) return;
            released = true;
            try {
                await lockClient.query(releaseSql, lockParams);
            } finally {
                lockClient.release();
                await lockPool.end();
            }
        }
    };
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

async function assertNoPreservedCheckboxMutationState(testDb, {
    poolFactory = createPool
} = {}) {
    const tableNames = [
        'payment_orders',
        'fiscal_operations',
        'payment_outbox_jobs',
        'fiscal_shifts'
    ];
    const pool = poolFactory(testDb);
    try {
        const preserved = [];
        for (const tableName of tableNames) {
            const exists = await pool.query('SELECT to_regclass($1)::text AS table_name', [`public.${tableName}`]);
            if (!exists.rows[0]?.table_name) continue;
            const count = await pool.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
            if (count.rows[0].count > 0) preserved.push({ tableName, count: count.rows[0].count });
        }
        if (preserved.length) {
            const summary = preserved.map(item => `${item.tableName}=${item.count}`).join(', ');
            throw new Error(
                `Preserved Checkbox mutation state exists (${summary}). `
                + 'Automatic reset/retry is forbidden; inspect and recover the existing UUIDs first.'
            );
        }
    } finally {
        await pool.end();
    }
}

async function assertExactCheckboxFinalDraftState(testDb) {
    const pool = createPool(testDb);
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*)::int FROM payment_orders) AS orders,
                (SELECT COUNT(*)::int FROM payment_orders
                  WHERE status = 'draft' AND payment_status = 'unpaid'
                    AND payment_method = 'card_terminal'
                    AND sealed_at IS NULL AND cancelled_at IS NULL) AS resumable_drafts,
                (SELECT COUNT(*)::int FROM payment_attempts) AS attempts,
                (SELECT COUNT(*)::int FROM payment_allocations) AS allocations,
                (SELECT COUNT(*)::int FROM fiscal_operations) AS operations,
                (SELECT COUNT(*)::int FROM fiscal_receipts) AS receipts,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs) AS jobs,
                (SELECT COUNT(*)::int FROM fiscal_shifts) AS shifts
        `);
        const expected = {
            orders: 1,
            resumable_drafts: 1,
            attempts: 0,
            allocations: 0,
            operations: 0,
            receipts: 0,
            jobs: 0,
            shifts: 0
        };
        if (JSON.stringify(result.rows[0]) !== JSON.stringify(expected)) {
            throw new Error('Disposable PostgreSQL is not in the exact one-card-draft pre-mutation state');
        }
    } finally {
        await pool.end();
    }
}

async function assertExactCheckboxCardRecoveryState(testDb) {
    const pool = createPool(testDb);
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*)::int FROM payment_orders) AS orders,
                (SELECT COUNT(*)::int FROM payment_orders WHERE payment_method = 'cash') AS cash_orders,
                (SELECT COUNT(*)::int FROM payment_orders WHERE payment_method = 'card_terminal') AS card_orders,
                (SELECT COUNT(*)::int FROM payment_orders
                  WHERE status = 'payment_recorded' AND payment_status = 'confirmed'
                    AND fiscal_status = 'fiscalized' AND sealed_at IS NOT NULL) AS completed_orders,
                (SELECT COUNT(*)::int FROM fiscal_operations) AS operations,
                (SELECT COUNT(*)::int FROM fiscal_operations WHERE operation_type = 'sale') AS sale_operations,
                (SELECT COUNT(*)::int FROM fiscal_operations WHERE operation_type = 'shift_open') AS shift_open_operations,
                (SELECT COUNT(*)::int FROM fiscal_operations WHERE operation_type = 'shift_close') AS shift_close_operations,
                (SELECT COUNT(*)::int FROM fiscal_receipts) AS receipts,
                (SELECT COUNT(*)::int FROM fiscal_receipts
                  WHERE receipt_type = 'sale' AND status = 'fiscalized') AS fiscalized_sale_receipts,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs) AS jobs,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs WHERE status = 'succeeded') AS succeeded_jobs,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs WHERE job_type = 'receipt_sell') AS sell_jobs,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs WHERE job_type = 'shift_open') AS shift_open_jobs,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs WHERE job_type = 'shift_close') AS shift_close_jobs,
                (SELECT COUNT(*)::int FROM payment_attempts) AS attempts,
                (SELECT COUNT(*)::int FROM payment_allocations) AS allocations,
                (SELECT COUNT(*)::int FROM payment_refunds) AS refunds,
                (SELECT COUNT(*)::int FROM fiscal_shifts) AS shifts,
                (SELECT COUNT(*)::int FROM fiscal_shifts
                  WHERE status = 'closed' AND lifecycle_stage = 'CLOSED'
                    AND provider_shift_id IS NOT NULL) AS closed_shifts,
                (SELECT COUNT(*)::int FROM payment_orders
                  WHERE payment_status = 'confirmed' AND fiscal_status <> 'fiscalized') AS unresolved_orders,
                (SELECT COUNT(*)::int FROM payment_outbox_jobs WHERE status <> 'succeeded') AS unresolved_jobs
        `);
        const expected = {
            orders: 1,
            cash_orders: 1,
            card_orders: 0,
            completed_orders: 1,
            operations: 2,
            sale_operations: 1,
            shift_open_operations: 1,
            shift_close_operations: 0,
            receipts: 1,
            fiscalized_sale_receipts: 1,
            jobs: 2,
            succeeded_jobs: 2,
            sell_jobs: 1,
            shift_open_jobs: 1,
            shift_close_jobs: 0,
            attempts: 1,
            allocations: 1,
            refunds: 0,
            shifts: 1,
            closed_shifts: 1,
            unresolved_orders: 0,
            unresolved_jobs: 0
        };
        if (JSON.stringify(result.rows[0]) !== JSON.stringify(expected)) {
            throw new Error('Disposable PostgreSQL does not match the exact one-cash/closed-shift card-recovery baseline');
        }
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
        || testFile.includes('checkbox-park-config.integration')
        || testFile.includes('legacy-upload-backfill.integration');
}

async function runSuite(testDb, testFile, suiteMode) {
    const port = await reservePort();
    const catalogSaleLocalQa = testFile.includes('catalog-sale-local-provider.integration');
    const checkboxBrowserMockPort = (testFile.includes('checkbox-cashier-real-routes-browser-smoke') || catalogSaleLocalQa) ? await reservePort() : null;
    const myDayOpenAiMockPort = (testFile.includes('my-day-postgres.integration') || testFile.includes('my-day-actual-app-browser-smoke')) ? await reservePort() : null;
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
        serverEnv.TASK_AI_DRAFT_BUNDLE_ENABLED = 'true';
    }
    if (checkboxBrowserMockPort && !catalogSaleLocalQa) {
        const ref = 'PARK_MIDDLE_BROWSER';
        serverEnv.NODE_OPTIONS = [
            serverEnv.NODE_OPTIONS || '',
            '--require=./tests/helpers/checkbox-browser-fetch-shim.js'
        ].filter(Boolean).join(' ');
        serverEnv.REQUIRE_ISOLATED_TEST_TARGET = 'true';
        serverEnv.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER = 'true';
        serverEnv.CHECKBOX_INTEGRATION_ENABLED = 'true';
        serverEnv.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = 'true';
        serverEnv.EVENTGENIX_CASHIER_PRO_ENABLED = 'false';
        serverEnv.CHECKBOX_EXPECT_IS_TEST = 'true';
        serverEnv.CHECKBOX_BROWSER_MOCK_PORT = String(checkboxBrowserMockPort);
        serverEnv.PAYMENT_OUTBOX_WAKEUP_DISABLED = 'true';
        serverEnv[`CHECKBOX_${ref}_BASE_URL`] = 'https://api.checkbox.ua';
        serverEnv[`CHECKBOX_${ref}_LOGIN`] = 'mock-login';
        serverEnv[`CHECKBOX_${ref}_PASSWORD`] = 'mock-password';
        serverEnv[`CHECKBOX_${ref}_LICENSE_KEY`] = 'mock-license';
        serverEnv[`CHECKBOX_${ref}_ACCESS_KEY`] = 'mock-access';
        serverEnv[`CHECKBOX_${ref}_DEVICE_ID`] = 'eventgenix-browser-smoke-device';
    }
    if (catalogSaleLocalQa) {
        const sharedRef = 'SHARED_TEST_LOCAL_QA';
        serverEnv.NODE_OPTIONS = [
            String(serverEnv.NODE_OPTIONS || '').replace(/--require=\.\/tests\/helpers\/checkbox-browser-fetch-shim\.js/g, '').trim(),
            '--require=./tests/helpers/checkbox-loopback-only-fetch-shim.js'
        ].filter(Boolean).join(' ');
        serverEnv.REQUIRE_ISOLATED_TEST_TARGET = 'true';
        serverEnv.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER = 'true';
        serverEnv.CHECKBOX_LOCAL_QA_MOCK_PORT = String(checkboxBrowserMockPort);
        serverEnv.CHECKBOX_INTEGRATION_ENABLED = 'true';
        serverEnv.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = 'true';
        serverEnv.CHECKBOX_EXPECT_IS_TEST = 'true';
        serverEnv.CHECKBOX_WEBHOOK_ENABLED = 'false';
        serverEnv.EVENTGENIX_CASHIER_PRO_ENABLED = 'false';
        serverEnv.PAYMENT_OUTBOX_WAKEUP_DISABLED = 'true';
        serverEnv.BACKUP_OUTBOUND_HOLD = 'true';
        const prefix = `CHECKBOX_${sharedRef}`;
        serverEnv[`${prefix}_BASE_URL`] = 'https://api.checkbox.ua';
        serverEnv[`${prefix}_LOGIN`] = 'local-qa-shared';
        serverEnv[`${prefix}_PASSWORD`] = 'local-qa-shared-password';
        serverEnv[`${prefix}_LICENSE_KEY`] = 'local-qa-shared-license';
        serverEnv[`${prefix}_ACCESS_KEY`] = 'local-qa-shared-access';
        serverEnv[`${prefix}_DEVICE_ID`] = 'local-qa-shared-device';
    }
    const realCheckboxTestMode = testFile.includes('checkbox-cashier-real-testmode-browser-smoke');
    if (realCheckboxTestMode) {
        const stage = suiteMode === 'checkbox-ui-testmode'
            ? 'mutations'
            : suiteMode === 'checkbox-ui-testmode-card-recovery'
                ? 'card_recovery'
                : suiteMode === 'checkbox-ui-testmode-final-card-close'
                    ? 'final_card_close'
                : 'preflight';
        serverEnv.NODE_ENV = 'test';
        serverEnv.BACKUP_OUTBOUND_HOLD = 'true';
        serverEnv.REQUIRE_ISOLATED_TEST_TARGET = 'true';
        serverEnv.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER = 'true';
        serverEnv.CHECKBOX_INTEGRATION_ENABLED = 'true';
        serverEnv.CHECKBOX_ACCEPT_PAYMENTS_ENABLED = stage === 'preflight' ? 'false' : 'true';
        serverEnv.CHECKBOX_WEBHOOK_ENABLED = 'false';
        serverEnv.EVENTGENIX_CASHIER_PRO_ENABLED = 'false';
        serverEnv.PAYMENT_OUTBOX_WAKEUP_DISABLED = 'true';
        serverEnv.CHECKBOX_FULLSTACK_TESTMODE_STAGE = stage;
        serverEnv.CHECKBOX_FULLSTACK_TESTMODE_CONFIG_FILE = String(process.env.CHECKBOX_FULLSTACK_TESTMODE_CONFIG_FILE || process.env.CHECKBOX_PILOT_CONFIG_FILE || '').trim();
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
        RUN_HR_SCHEDULER_JOBS_INTEGRATION: testFile.includes('hr-scheduler-jobs') ? 'true' : 'false',
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
        RUN_CATALOG_SALE_MIGRATIONS_INTEGRATION: testFile.includes('catalog-sale-migrations') ? 'true' : 'false',
        RUN_CATALOG_SALE_LOCAL_QA_INTEGRATION: catalogSaleLocalQa ? 'true' : 'false',
        RUN_MY_DAY_POSTGRES_INTEGRATION: testFile.includes('my-day-postgres.integration') ? 'true' : 'false',
        RUN_MY_DAY_ACTUAL_APP_BROWSER_SMOKE: testFile.includes('my-day-actual-app-browser-smoke') ? 'true' : 'false',
        RUN_CHECKBOX_PARK_CASHIER_SMOKE_INTEGRATION: testFile.includes('checkbox-park-cashier-smoke') ? 'true' : 'false',
        RUN_CHECKBOX_PARK_CONFIG_INTEGRATION: testFile.includes('checkbox-park-config') ? 'true' : 'false',
        RUN_HR_ONBOARDING_INTEGRATION: testFile.includes('hr-onboarding-hire') ? 'true' : 'false',
        RUN_ACCOUNT_ONBOARDING_INTEGRATION: testFile.includes('account-onboarding.integration') ? 'true' : 'false',
        RUN_HR_LEGACY_BACKFILL_INTEGRATION: testFile.includes('hr-legacy-hire-backfill') ? 'true' : 'false',
        RUN_LEGACY_UPLOAD_BACKFILL_INTEGRATION: testFile.includes('legacy-upload-backfill.integration') ? 'true' : 'false',
        RUN_HR_ONBOARDING_FULLSTACK_BROWSER: testFile.includes('hr-onboarding-fullstack-browser-smoke') ? 'true' : 'false',
        RUN_FRESH_DB_STARTUP_INTEGRATION: testFile.includes('fresh-db-startup') ? 'true' : 'false',
        RUN_LIVE_MULTI_SEGMENT_QA_INTEGRATION: testFile.includes('live-multi-segment') ? 'true' : 'false'
    };
    const output = { text: '', dbErrors: [] };
    let server;
    let serverSpawnError = null;
    let primaryError = null;
    let cleanupError = null;
    const preserveFailedCheckboxMutationState = suiteMode === 'checkbox-ui-testmode'
        || suiteMode === 'checkbox-ui-testmode-final-card-close';
    const preserveCheckboxRecoveryState = suiteMode === 'checkbox-ui-testmode-card-recovery';
    const preserveCheckboxFinalProofState = suiteMode === 'checkbox-ui-testmode-final-card-close';
    const resumeCheckboxFinalDraft = preserveCheckboxFinalProofState
        && String(process.env.CHECKBOX_FULLSTACK_TESTMODE_RESUME_DRAFT_CONFIRM || '').trim().toLowerCase() === 'resume-one-local-unpaid-draft';
    let initialSchemaResetAuthorized = false;

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
        if (preserveCheckboxRecoveryState) {
            await assertExactCheckboxCardRecoveryState(testDb);
        } else if (resumeCheckboxFinalDraft) {
            await assertExactCheckboxFinalDraftState(testDb);
        } else {
            await assertNoPreservedCheckboxMutationState(testDb);
            initialSchemaResetAuthorized = true;
            await resetPublicSchema(testDb);
        }
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
            if (preserveCheckboxRecoveryState || preserveCheckboxFinalProofState) {
                process.stderr.write(
                    preserveCheckboxFinalProofState
                        ? '[isolated-db] Preserving disposable Checkbox final card-close proof for exact post-run inspection.\n'
                        : '[isolated-db] Preserving disposable Checkbox card-recovery proof for exact post-run inspection.\n'
                );
            } else if (!initialSchemaResetAuthorized) {
                process.stderr.write(
                    '[isolated-db] Initial schema reset was not authorized; preserved Checkbox state remains untouched.\n'
                );
            } else if (!primaryError || !preserveFailedCheckboxMutationState) {
                await resetPublicSchema(testDb);
            } else {
                process.stderr.write(
                    '[isolated-db] Preserving disposable Checkbox database after an ambiguous mutation-stage failure; automatic retry is blocked.\n'
                );
            }
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
    if (!['api', 'attendance', 'attendance-datafix', 'recovery', 'banquet-recovery', 'hr', 'permissions', 'payroll', 'payroll-fullstack', 'admission', 'catalog-sale', 'catalog-sale-local-qa', 'my-day', 'my-day-browser', 'cashier-smoke', 'checkbox-config', 'checkbox-ui-real', 'checkbox-ui-testmode-preflight', 'checkbox-ui-testmode', 'checkbox-ui-testmode-card-recovery', 'checkbox-ui-testmode-final-card-close', 'onboarding', 'backfill', 'upload-backfill', 'fullstack', 'qa', 'all'].includes(mode)) throw new Error(usage());
    const testDb = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    const checkboxTestMode = mode === 'checkbox-ui-testmode-preflight'
        || mode === 'checkbox-ui-testmode'
        || mode === 'checkbox-ui-testmode-card-recovery'
        || mode === 'checkbox-ui-testmode-final-card-close';
    const checkboxMutationMode = mode === 'checkbox-ui-testmode'
        || mode === 'checkbox-ui-testmode-card-recovery'
        || mode === 'checkbox-ui-testmode-final-card-close';
    if (mode === 'catalog-sale-local-qa') {
        if (!testDb.isLocal) throw new Error('Catalog-sale local QA requires loopback disposable PostgreSQL');
        if (isCheckboxPaymentAcceptanceEnabledForParent(process.env.CHECKBOX_ACCEPT_PAYMENTS_ENABLED)) {
            throw new Error('Catalog-sale local QA refuses a pre-enabled parent payment acceptance flag');
        }
    }
    if (checkboxTestMode) {
        if (!testDb.isLocal) throw new Error('Real Checkbox test-mode full-stack proof requires loopback disposable PostgreSQL');
        if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production'
            || Object.entries(process.env).some(([key, value]) => key.startsWith('RAILWAY_') && String(value || '').trim())) {
            throw new Error('Real Checkbox test-mode full-stack proof is forbidden in production or Railway');
        }
        if (String(process.env.CHECKBOX_EXPECT_IS_TEST || '').trim().toLowerCase() !== 'true') {
            throw new Error('CHECKBOX_EXPECT_IS_TEST=true is required before starting the isolated server');
        }
        if (!String(process.env.CHECKBOX_FULLSTACK_TESTMODE_CONFIG_FILE || process.env.CHECKBOX_PILOT_CONFIG_FILE || '').trim()) {
            throw new Error('CHECKBOX_FULLSTACK_TESTMODE_CONFIG_FILE is required before starting the isolated server');
        }
        if (checkboxMutationMode
            && String(process.env.CHECKBOX_FULLSTACK_TESTMODE_CONFIRM_MUTATIONS || '').trim().toLowerCase() !== 'sandbox') {
            throw new Error('Explicit CHECKBOX_FULLSTACK_TESTMODE_CONFIRM_MUTATIONS=sandbox is required before starting the mutation proof');
        }
        if (checkboxMutationMode
            && String(process.env.CHECKBOX_FULLSTACK_TESTMODE_CLOSE_SHIFT || '').trim().toLowerCase() !== 'true') {
            throw new Error('CHECKBOX_FULLSTACK_TESTMODE_CLOSE_SHIFT=true is required before starting the mutation proof');
        }
        if (checkboxMutationMode
            && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(process.env.CHECKBOX_FULLSTACK_TESTMODE_RUN_ID || '').trim())) {
            throw new Error('A single-use CHECKBOX_FULLSTACK_TESTMODE_RUN_ID UUID is required before starting the mutation proof');
        }
        if (checkboxMutationMode
            && !String(process.env.CHECKBOX_FULLSTACK_TESTMODE_RUN_LEDGER_DIR || '').trim()) {
            throw new Error('CHECKBOX_FULLSTACK_TESTMODE_RUN_LEDGER_DIR is required before starting the mutation proof');
        }
        if (mode === 'checkbox-ui-testmode-card-recovery'
            && String(process.env.CHECKBOX_FULLSTACK_TESTMODE_RECOVERY_CONFIRM || '').trim().toLowerCase() !== 'card-only-after-fiscalized-cash') {
            throw new Error('Exact card-only recovery confirmation is required before starting the recovery proof');
        }
        if (mode === 'checkbox-ui-testmode-final-card-close'
            && String(process.env.CHECKBOX_FULLSTACK_TESTMODE_FINAL_CLOSE_CONFIRM || '').trim().toLowerCase() !== 'one-card-canonical-close') {
            throw new Error('Exact one-card canonical-close confirmation is required before starting the final proof');
        }
        if (mode === 'checkbox-ui-testmode-final-card-close'
            && String(process.env.CHECKBOX_FULLSTACK_TESTMODE_RESUME_DRAFT_CONFIRM || '').trim()
            && String(process.env.CHECKBOX_FULLSTACK_TESTMODE_RESUME_DRAFT_CONFIRM || '').trim().toLowerCase() !== 'resume-one-local-unpaid-draft') {
            throw new Error('Exact one-card draft-resume confirmation is invalid');
        }
    }
    const files = mode === 'all'
        ? [...MODES.api, ...MODES.attendance, ...MODES.hr, ...MODES.permissions, ...MODES.payroll, ...MODES.admission, ...MODES['my-day'], ...MODES['my-day-browser'], ...MODES['cashier-smoke'], ...MODES['checkbox-config'], ...MODES['checkbox-ui-real'], ...MODES.onboarding, ...MODES.backfill, ...MODES['upload-backfill']]
        : MODES[mode];

    const databaseLock = await acquireIsolatedDatabaseLock(testDb);
    try {
        for (const testFile of files) {
            process.stdout.write(`\n[isolated-db] Running ${testFile} against ${testDb.hostname}/${testDb.databaseName}\n`);
            await runSuite(testDb, testFile, mode);
        }
    } finally {
        await databaseLock.release();
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`[isolated-db] ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    acquireIsolatedDatabaseLock,
    assertExactCheckboxCardRecoveryState,
    assertExactCheckboxFinalDraftState,
    assertNoPreservedCheckboxMutationState,
    runSuite
};
