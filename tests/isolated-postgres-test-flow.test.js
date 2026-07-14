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

    it('keeps the runner and HR suite wired for migration verification and fixture cleanup', () => {
        const root = path.resolve(__dirname, '..');
        const runner = fs.readFileSync(path.join(root, 'scripts', 'run-isolated-postgres-tests.js'), 'utf8');
        const hrSuite = fs.readFileSync(path.join(root, 'tests', 'integration', 'hr-disposable.integration.test.js'), 'utf8');

        assert.match(runner, /DROP SCHEMA IF EXISTS public CASCADE/);
        assert.match(runner, /verifyAllMigrationsApplied/);
        assert.match(runner, /startupPass <= 2/);
        assert.match(runner, /pending legacy data migration/);
        assert.match(runner, /--test-concurrency=1/);
        assert.match(runner, /ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER: 'true'/);
        assert.match(runner, /finally\s*\{/);
        assert.match(hrSuite, /POST', '\/api\/staff'/);
        assert.match(hrSuite, /DELETE', `\/api\/hr\/shifts\/\$\{shiftId\}`/);
        assert.match(hrSuite, /DELETE', `\/api\/staff\/\$\{staffId\}`/);
        assert.doesNotMatch(hrSuite, /HR_DISPOSABLE_STAFF_ID/);
        assert.doesNotMatch(hrSuite, /copied\.length, 2/);
    });
});
