'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    ADMIN_CONNECTION_ENV_KEY,
    READ_ONLY_CONNECTION_ENV_KEY,
    ROLE_NAME,
    buildProvisioningStatements,
    buildReadOnlyConnectionString,
    parseArgs,
    resolveAdminConnectionString,
    safeErrorCode
} = require('../scripts/provision-task-audit-readonly-role');

test('read-only task audit role provisioner is inert without explicit provision mode', () => {
    assert.deepEqual(parseArgs([]), { mode: 'help', persistUserEnvironment: false, recoverExistingRole: false });
    assert.deepEqual(parseArgs(['--preflight']), { mode: 'preflight', persistUserEnvironment: false, recoverExistingRole: false });
    assert.deepEqual(parseArgs(['--provision', '--persist-user-env']), {
        mode: 'provision',
        persistUserEnvironment: true,
        recoverExistingRole: false
    });
    assert.throws(
        () => parseArgs(['--persist-user-env']),
        error => error.code === 'TASK_AUDIT_ROLE_ARGUMENT_INVALID'
    );
    assert.deepEqual(parseArgs(['--provision', '--recover-existing-role']), {
        mode: 'provision',
        persistUserEnvironment: false,
        recoverExistingRole: true
    });
    assert.throws(
        () => parseArgs(['--recover-existing-role']),
        error => error.code === 'TASK_AUDIT_ROLE_ARGUMENT_INVALID'
    );
    assert.throws(
        () => parseArgs(['--provision', '--preflight']),
        error => error.code === 'TASK_AUDIT_ROLE_ARGUMENT_INVALID'
    );
});

test('provisioner accepts only Railway-injected admin database URL and produces a distinct audit URL', () => {
    assert.equal(ADMIN_CONNECTION_ENV_KEY, 'DATABASE_URL');
    assert.equal(READ_ONLY_CONNECTION_ENV_KEY, 'PRODUCTION_READONLY_DATABASE_URL');
    assert.throws(
        () => resolveAdminConnectionString({}),
        error => error.code === 'TASK_AUDIT_ROLE_ADMIN_DATABASE_REQUIRED'
    );
    const auditUrl = buildReadOnlyConnectionString(
        'postgresql://writer:writer-password@db.example.invalid:5432/eventgenix?sslmode=require',
        'safe-audit-password'
    );
    const parsed = new URL(auditUrl);
    assert.equal(parsed.username, ROLE_NAME);
    assert.equal(parsed.password, 'safe-audit-password');
    assert.equal(parsed.hostname, 'db.example.invalid');
    assert.equal(parsed.pathname, '/eventgenix');
    assert.equal(parsed.searchParams.get('sslmode'), 'require');
});

test('role statements grant only CONNECT, USAGE and SELECT while revoking write and DDL privileges', () => {
    const statements = buildProvisioningStatements('"eventgenix"', "'safe-password'");
    assert.match(statements[0], /^CREATE ROLE "eventgenix_audit_ro" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/);
    assert.ok(statements.some(statement => statement === 'GRANT CONNECT ON DATABASE "eventgenix" TO "eventgenix_audit_ro"'));
    assert.ok(statements.some(statement => statement === 'GRANT USAGE ON SCHEMA public TO "eventgenix_audit_ro"'));
    assert.ok(statements.some(statement => statement === 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO "eventgenix_audit_ro"'));
    assert.ok(statements.some(statement => statement === 'REVOKE CREATE ON SCHEMA public FROM "eventgenix_audit_ro"'));
    assert.ok(statements.some(statement => statement === 'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "eventgenix_audit_ro"'));
    assert.ok(statements.some(statement => statement === 'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "eventgenix_audit_ro"'));
    assert.equal(safeErrorCode({ code: 'TASK_AUDIT_ROLE_VALIDATION_FAILED' }), 'TASK_AUDIT_ROLE_VALIDATION_FAILED');
    assert.equal(safeErrorCode({ code: 'ENOTFOUND' }), 'TASK_AUDIT_ROLE_DATABASE_ENOTFOUND');
    assert.equal(safeErrorCode({ code: '42803' }), 'TASK_AUDIT_ROLE_DATABASE_42803');
    assert.equal(safeErrorCode({ code: 'ECONNREFUSED', message: 'postgres://secret.example.invalid' }), 'TASK_AUDIT_ROLE_DATABASE_ECONNREFUSED');
});
