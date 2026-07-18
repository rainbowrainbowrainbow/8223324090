'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    RESET_CONFIRMATION,
    REMOTE_CONFIRMATION,
    assertSafeTestDatabaseUrl,
    assertSafeIsolatedTestUrl
} = require('../scripts/test-db-safety');

function safeEnv(overrides = {}) {
    return {
        TEST_DATABASE_RESET_CONFIRM: RESET_CONFIRMATION,
        ...overrides
    };
}

describe('isolated PostgreSQL test flow safety', () => {
    it('accepts an explicitly confirmed local disposable database', () => {
        const result = assertSafeTestDatabaseUrl(
            'postgresql://tester:secret@127.0.0.1:5432/eventgenix_test',
            safeEnv()
        );
        assert.equal(result.isLocal, true);
        assert.equal(result.databaseName, 'eventgenix_test');
    });

    it('requires TEST_DATABASE_URL instead of falling back to DATABASE_URL', () => {
        assert.throws(
            () => assertSafeTestDatabaseUrl('', safeEnv({ DATABASE_URL: 'postgresql://local/eventgenix_test' })),
            /TEST_DATABASE_URL is required/
        );
    });

    it('rejects default or unmarked database names', () => {
        assert.throws(
            () => assertSafeTestDatabaseUrl('postgresql://tester:secret@localhost:5432/eventgenix', safeEnv()),
            /database name must contain/
        );
        assert.throws(
            () => assertSafeTestDatabaseUrl('postgresql://tester:secret@localhost:5432/postgres', safeEnv()),
            /database name must contain|cannot be reset/
        );
    });

    it('rejects Railway/production execution and matching live URLs', () => {
        const url = 'postgresql://tester:secret@localhost:5432/eventgenix_test';
        assert.throws(
            () => assertSafeTestDatabaseUrl(url, safeEnv({ RAILWAY_ENVIRONMENT: 'production' })),
            /blocked in production\/Railway/
        );
        assert.throws(
            () => assertSafeTestDatabaseUrl(url, safeEnv({ DATABASE_URL: url })),
            /must not match DATABASE_URL/
        );
        assert.throws(
            () => assertSafeTestDatabaseUrl(url, safeEnv({ DATABASE_URL: 'postgres://other-user:other-pass@localhost/eventgenix_test' })),
            /must not match DATABASE_URL/
        );
        assert.throws(
            () => assertSafeTestDatabaseUrl(
                'postgresql://tester:secret@primary.railway.internal:5432/eventgenix_test',
                safeEnv({ TEST_DATABASE_ALLOW_REMOTE: REMOTE_CONFIRMATION })
            ),
            /forbidden production\/Railway-like host/
        );
        assert.throws(
            () => assertSafeTestDatabaseUrl(
                'postgresql://tester:secret@db.example.test:5432/eventgenix_prod_test',
                safeEnv({ TEST_DATABASE_ALLOW_REMOTE: REMOTE_CONFIRMATION })
            ),
            /forbidden production\/Railway-like host/
        );
    });

    it('requires a second confirmation for remote disposable databases', () => {
        const url = 'postgresql://tester:secret@db.example.test:5432/eventgenix_ci';
        assert.throws(
            () => assertSafeTestDatabaseUrl(url, safeEnv()),
            /Remote disposable DB requires/
        );
        assert.equal(
            assertSafeTestDatabaseUrl(url, safeEnv({ TEST_DATABASE_ALLOW_REMOTE: REMOTE_CONFIRMATION })).isLocal,
            false
        );
    });

    it('allows isolated HTTP tests to target only an explicit local port', () => {
        assert.equal(assertSafeIsolatedTestUrl('http://127.0.0.1:32123').port, '32123');
        assert.throws(() => assertSafeIsolatedTestUrl('https://crm.example.com'), /only a local HTTP server/);
        assert.throws(() => assertSafeIsolatedTestUrl('http://localhost'), /must include the isolated server port/);
    });

    it('documents and guards the Windows disposable payroll PostgreSQL helper', () => {
        const root = path.resolve(__dirname, '..');
        const helper = fs.readFileSync(path.join(root, 'scripts', 'run-local-payroll-postgres-gate.ps1'), 'utf8');
        const docs = fs.readFileSync(path.join(root, 'docs', 'ISOLATED_POSTGRES_TESTING.md'), 'utf8');
        const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
        const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
        const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
        const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

        assert.equal(
            packageJson.scripts['test:integration:payroll-profiles:isolated'],
            'node scripts/run-isolated-postgres-tests.js payroll'
        );
        assert.match(helper, /Invoke-CheckedProcess[\s\S]+check:runtime/);
        assert.match(helper, /\$PostgresImage = 'postgres:16'/);
        assert.match(helper, /'--publish',\s*'127\.0\.0\.1::5432'/);
        assert.match(helper, /PostgreSQL port must be bound only to 127\.0\.0\.1/);
        assert.match(helper, /\$testDatabaseUrl = "postgresql:\/\/\$\{DatabaseUser\}:\$databasePassword@127\.0\.0\.1:\$hostPort\/\$DatabaseName"/);
        assert.match(helper, /TEST_DATABASE_RESET_CONFIRM = \$ResetConfirmation/);
        assert.match(helper, /'--label', \$DisposableLabel/);
        assert.match(helper, /'--label', \$PurposeLabel/);
        assert.match(helper, /com\.eventgenix\.disposable/);
        assert.match(helper, /local-payroll-postgres-gate/);
        assert.match(helper, /'--tmpfs',\s*'\/var\/lib\/postgresql\/data:rw'/);
        assert.doesNotMatch(helper, /'--volume'|\s-v\s/);
        assert.match(helper, /Remove-SensitiveEnvironment[\s\S]+DATABASE_URL/);
        assert.doesNotMatch(helper, /TEST_DATABASE_URL\s*=\s*\$env:DATABASE_URL/);
        assert.doesNotMatch(helper, /DROP SCHEMA IF EXISTS public CASCADE/);
        assert.match(helper, /npm run test:integration:payroll-profiles:isolated/);
        assert.match(helper, /-Arguments @\('run', 'test:integration:payroll-profiles:isolated'\)/);
        assert.match(helper, /finally\s*\{[\s\S]*Remove-CreatedContainer/);
        assert.match(helper, /\{\{json \.Config\.Labels\}\}/);
        assert.match(helper, /Get-DockerLabelValue[\s\S]+DockerPath rm --force --volumes/);

        assert.match(docs, /run-local-payroll-postgres-gate\.ps1/);
        assert.match(docs, /canonical payroll command: `npm run test:integration:payroll-profiles:isolated`/);
        assert.match(docs, /DROP SCHEMA public CASCADE/);
        assert.match(docs, /Manual Docker fallback/);
        assert.match(docs, /Docker daemon unavailable/);
        assert.match(docs, /does not install Docker, read production\/live secrets, print the password or connection URL, use `DATABASE_URL`/);
        assert.match(readme, /run-local-payroll-postgres-gate\.ps1/);
        assert.match(readme, /test:integration:payroll-profiles:isolated/);
        assert.match(readme, /HR and payroll PostgreSQL integration/);
        assert.match(readme, /payroll profiles and\s+simultaneous-additional payroll suite/);
        assert.match(agents, /HR and payroll PostgreSQL integration/);
        assert.match(agents, /payroll profile\/simultaneous-pay/);
        assert.match(workflow, /name: HR and payroll PostgreSQL integration/);
        assert.match(workflow, /Run payroll profession and reversal integration/);
        assert.match(workflow, /test:integration:payroll-profiles:isolated/);
    });
    it('keeps the runner and HR suite wired for migration verification and fixture cleanup', () => {
        const root = path.resolve(__dirname, '..');
        const runner = fs.readFileSync(path.join(root, 'scripts', 'run-isolated-postgres-tests.js'), 'utf8');
        const dbInit = fs.readFileSync(path.join(root, 'db', 'index.js'), 'utf8');
        const migrationRunner = fs.readFileSync(path.join(root, 'db', 'migrate.js'), 'utf8');
        const hrSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'hr-disposable.integration.test.js'), 'utf8');
        const freshDbSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'fresh-db-startup.integration.test.js'), 'utf8');
        const onboardingSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'hr-onboarding-hire.integration.test.js'), 'utf8');
        const accountOnboardingSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'account-onboarding.integration.test.js'), 'utf8');
        const legacyBackfillSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'hr-legacy-hire-backfill.integration.test.js'), 'utf8');
        const attendanceLockSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'attendance-lock-concurrency.integration.test.js'), 'utf8');
        const attendanceCompensationSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'hr-attendance-compensation-snapshot.integration.test.js'), 'utf8');
        const attendanceDocumentAutomationSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'hr-attendance-document-automation-concurrency.integration.test.js'), 'utf8');
        const attendanceBackupSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'attendance-backup-roundtrip.integration.test.js'), 'utf8');
        const fullBackupRecoverySuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'full-backup-recovery.integration.test.js'), 'utf8');
        const simultaneousAdditionalPayrollSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'payroll-simultaneous-additional.integration.test.js'), 'utf8');
        const onboardingBrowserSuite = fs.readFileSync(path.join(root, 'tests', 'browser', 'hr-onboarding-flow-browser-smoke.js'), 'utf8');
        const fullstackBrowserSuite = fs.readFileSync(path.join(root, 'tests', 'browser', 'hr-onboarding-fullstack-browser-smoke.js'), 'utf8');
        const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

        assert.match(runner, /DROP SCHEMA IF EXISTS public CASCADE/);
        assert.match(runner, /verifyAllMigrationsApplied/);
        assert.doesNotMatch(runner, /startupPass <= 2/);
        assert.doesNotMatch(runner, /pending legacy data migration/);
        assert.match(runner, /Single fresh startup left/);
        assert.match(runner, /Migration ledger changed during idempotent initialized-DB restart/);
        assert.match(runner, /PostgreSQL startup errors detected/);
        assert.match(runner, /--test-concurrency=1/);
        assert.match(runner, /ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true'/);
        assert.match(runner, /attendance:\s*\[\s*'tests\/integration\/attendance-lock-concurrency\.integration\.test\.js',\s*'tests\/integration\/hr-attendance-compensation-snapshot\.integration\.test\.js',\s*'tests\/integration\/hr-attendance-document-automation-concurrency\.integration\.test\.js',\s*'tests\/integration\/attendance-backup-roundtrip\.integration\.test\.js',\s*'tests\/integration\/full-backup-recovery\.integration\.test\.js'\s*\]/);
        assert.match(runner, /RUN_ATTENDANCE_LOCK_INTEGRATION/);
        assert.match(runner, /RUN_HR_ATTENDANCE_COMPENSATION_INTEGRATION/);
        assert.match(runner, /RUN_HR_ATTENDANCE_DOCUMENT_AUTOMATION_INTEGRATION/);
        assert.match(runner, /RUN_ATTENDANCE_BACKUP_INTEGRATION/);
        assert.match(runner, /RUN_FULL_BACKUP_RECOVERY_INTEGRATION/);
        assert.match(runner, /RUN_PAYROLL_SIMULTANEOUS_ADDITIONAL_INTEGRATION/);
        assert.match(runner, /payroll:\s*\[\s*'tests\/integration\/payroll-profiles\.integration\.test\.js',\s*'tests\/integration\/payroll-simultaneous-additional\.integration\.test\.js'\s*\]/);
        assert.match(simultaneousAdditionalPayrollSuite, /physicalMinutes, 540/);
        assert.match(simultaneousAdditionalPayrollSuite, /simultaneous_additional/);
        assert.match(simultaneousAdditionalPayrollSuite, /salary\/reverse/);
        assert.match(runner, /finally\s*\{/);
        assert.match(hrSuite, /POST', '\/api\/staff'/);
        assert.match(hrSuite, /DELETE', `\/api\/hr\/shifts\/\$\{shiftId\}`/);
        assert.match(hrSuite, /DELETE', `\/api\/staff\/\$\{staffId\}`/);
        assert.doesNotMatch(hrSuite, /HR_DISPOSABLE_STAFF_ID/);
        assert.doesNotMatch(hrSuite, /copied\.length, 2/);
        assert.match(runner, /onboarding:\s*\[\s*'tests\/integration\/fresh-db-startup\.integration\.test\.js',\s*'tests\/integration\/hr-onboarding-hire\.integration\.test\.js',\s*'tests\/integration\/account-onboarding\.integration\.test\.js'\s*\]/);
        assert.match(runner, /backfill:\s*\[\s*'tests\/integration\/hr-legacy-hire-backfill\.integration\.test\.js'\s*\]/);
        assert.match(runner, /fullstack:\s*\[\s*'tests\/browser\/hr-onboarding-fullstack-browser-smoke\.js'\s*\]/);
        assert.match(onboardingSuite, /RUN_HR_ONBOARDING_INTEGRATION/);
        assert.match(runner, /RUN_ACCOUNT_ONBOARDING_INTEGRATION/);
        assert.match(accountOnboardingSuite, /transactional account onboarding on isolated PostgreSQL/);
        assert.match(accountOnboardingSuite, /rolls the entire transaction back/);
        assert.match(onboardingSuite, /one corporate and three profession processes exist/);
        assert.match(onboardingSuite, /cook progress remains unchanged/);
        assert.match(workflow, /hr-payroll-postgres:/);
        assert.match(workflow, /name: HR and payroll PostgreSQL integration/);
        assert.match(workflow, /test:integration:attendance-lock:isolated/);
        assert.match(attendanceLockSuite, /pg_locks/);
        assert.match(attendanceLockSuite, /RUN_ATTENDANCE_LOCK_INTEGRATION/);
        assert.match(attendanceCompensationSuite, /RUN_HR_ATTENDANCE_COMPENSATION_INTEGRATION/);
        assert.match(attendanceCompensationSuite, /simultaneousAdditionalMinutes, 510/);
        assert.match(attendanceDocumentAutomationSuite, /RUN_HR_ATTENDANCE_DOCUMENT_AUTOMATION_INTEGRATION/);
        assert.match(attendanceDocumentAutomationSuite, /Promise\.all/);
        assert.match(attendanceDocumentAutomationSuite, /idempotency_key/);
        assert.match(attendanceBackupSuite, /RUN_ATTENDANCE_BACKUP_INTEGRATION/);
        assert.match(attendanceBackupSuite, /\/api\/backup\/restore-encrypted/);
        assert.match(fullBackupRecoverySuite, /RUN_FULL_BACKUP_RECOVERY_INTEGRATION/);
        assert.match(fullBackupRecoverySuite, /CREATE DATABASE/);
        assert.match(fullBackupRecoverySuite, /\/api\/backup\/restore/);
        assert.match(fullBackupRecoverySuite, /\/api\/backup\/restore-encrypted/);
        assert.match(fullBackupRecoverySuite, /assertFixturesRestored/);
        assert.match(workflow, /test:integration:hr-onboarding:isolated/);
        assert.match(workflow, /test:integration:hr-legacy-backfill:isolated/);
        assert.match(workflow, /test:browser:hr-onboarding:fullstack:isolated/);
        assert.match(legacyBackfillSuite, /RUN_HR_LEGACY_BACKFILL_INTEGRATION/);
        assert.match(legacyBackfillSuite, /client\.query\(migrationSql\)/);
        assert.match(legacyBackfillSuite, /unique_normalized_phone_and_assigned_profession/);
        assert.match(workflow, /test:browser:hr-onboarding/);
        assert.match(onboardingBrowserSuite, /HR onboarding cross-surface browser smoke passed/);
        assert.match(onboardingBrowserSuite, /staffScheduleShell/);
        assert.match(fullstackBrowserSuite, /RUN_HR_ONBOARDING_FULLSTACK_BROWSER/);
        assert.match(fullstackBrowserSuite, /HR onboarding full-stack browser smoke passed/);
        assert.match(fullstackBrowserSuite, /no unexpected API statuses/);
        assert.match(fullstackBrowserSuite, /verify both professions in real Schedule UI and API read-back/);
        assert.doesNotMatch(fullstackBrowserSuite, /page\.route\(['"`]\/api\//);
        assert.match(freshDbSuite, /RUN_FRESH_DB_STARTUP_INTEGRATION/);
        assert.match(freshDbSuite, /261_leads_customer_card_canonical_customers/);
        assert.match(freshDbSuite, /idx_procurement_items_stock/);
        assert.match(dbInit, /const procurementListsReady = await safeQuery/);
        assert.match(dbInit, /const procurementItemsReady = await safeQuery/);
        assert.doesNotMatch(dbInit, /Database init partial \(will retry after migrations\)/);
        assert.match(migrationRunner, /migrationPreflights = new Map/);
        assert.match(migrationRunner, /ALTER TABLE IF EXISTS leads/);
        assert.match(migrationRunner, /runMigrationPreflight\(client, version\)/);
        assert.doesNotMatch(migrationRunner, /Data migration .* failed .* Server continues/);
    });
});
