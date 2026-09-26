'use strict';

const { spawnSync } = require('node:child_process');
const { getCertificateTestDatabase } = require('../tests/helpers/certificate-test-database');

const database = getCertificateTestDatabase();
if (!database) throw new Error('Certificate PostgreSQL tests require CERTIFICATE_TEST_DATABASE_URL');

const env = { ...process.env, REQUIRE_CERTIFICATE_POSTGRES_TESTS: '1' };
const files = [
    'tests/integration/certificate-redemption-postgres.test.js',
    'tests/integration/certificate-booking-app-postgres.test.js'
];
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true
});

if (result.error) throw result.error;
if (result.signal || !Number.isInteger(result.status)) throw new Error('Certificate PostgreSQL test process did not complete');
process.exitCode = result.status;
