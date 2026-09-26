'use strict';

const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

const REQUIRED_MARKER = /(?:^|[_-])(test|testing|ci|disposable)(?:[_-]|$)/i;
const FORBIDDEN_MARKER = /(?:^|[._-])(prod|production|live)(?:[._-]|$)/i;

function getCertificateTestDatabase() {
    const fixtureUrl = String(process.env.CERTIFICATE_TEST_DATABASE_URL || '').trim();
    const required = process.env.CI === 'true' || process.env.REQUIRE_CERTIFICATE_POSTGRES_TESTS === '1';
    if (!fixtureUrl) {
        if (required) throw new Error('CERTIFICATE_TEST_DATABASE_URL is required for certificate PostgreSQL CI tests');
        return null;
    }

    const target = assertSafeTestDatabaseUrl(fixtureUrl, process.env);
    if (!target.isLocal) throw new Error('Certificate integration tests require a loopback disposable PostgreSQL target');
    if (!REQUIRED_MARKER.test(target.databaseName) || FORBIDDEN_MARKER.test(target.databaseName)) {
        throw new Error('Certificate integration tests require an explicitly disposable database name');
    }

    return {
        url: target.url,
        connection: {
            host: target.hostname,
            port: Number(target.url.port || 5432),
            user: decodeURIComponent(target.url.username),
            password: decodeURIComponent(target.url.password),
            ssl: false,
            connectionTimeoutMillis: 5_000
        }
    };
}

module.exports = { getCertificateTestDatabase };
