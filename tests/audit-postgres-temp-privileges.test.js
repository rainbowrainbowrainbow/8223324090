const test = require('node:test');
const assert = require('node:assert/strict');

const {
    APPLY_CONFIRMATION,
    buildApplySql,
    buildRollbackSql,
    collectRollbackOnlyProbes,
    parseArgs,
    quoteIdent,
    redactMatrix,
    roleFingerprint
} = require('../scripts/audit-postgres-temp-privileges');

test('postgres TEMP privilege audit defaults to read-only audit mode', () => {
    const parsed = parseArgs([]);

    assert.equal(parsed.mode, 'audit');
    assert.deepEqual(parsed.allowTempRoles, []);
    assert.equal(parsed.expectedPublicTemp, null);
});

test('postgres TEMP privilege apply requires explicit bounded options', () => {
    const parsed = parseArgs([
        'apply',
        '--expected-public-temp=true',
        '--allow-temp-role=app_role',
        '--confirm',
        APPLY_CONFIRMATION
    ]);

    assert.equal(parsed.mode, 'apply');
    assert.equal(parsed.expectedPublicTemp, true);
    assert.deepEqual(parsed.allowTempRoles, ['app_role']);
    assert.equal(parsed.confirm, APPLY_CONFIRMATION);
});

test('postgres TEMP privilege SQL quotes identifiers and has an exact rollback path', () => {
    const applySql = buildApplySql('crm-db', ['app"role']);
    const rollbackSql = buildRollbackSql('crm-db', ['app"role']);

    assert.match(applySql, /REVOKE TEMPORARY ON DATABASE "crm-db" FROM PUBLIC/);
    assert.match(applySql, /GRANT TEMPORARY ON DATABASE "crm-db" TO "app""role"/);
    assert.match(rollbackSql, /REVOKE TEMPORARY ON DATABASE "crm-db" FROM "app""role"/);
    assert.match(rollbackSql, /GRANT TEMPORARY ON DATABASE "crm-db" TO PUBLIC/);
    assert.equal(quoteIdent('a"b'), '"a""b"');
});

test('postgres TEMP privilege matrix redacts database and role names', () => {
    const raw = {
        identity: {
            current_user: 'audit_user_should_not_leak',
            database_name: 'production_db_should_not_leak',
            transaction_read_only: 'on',
            default_transaction_read_only: 'on'
        },
        dbPrivilege: { connect: true, create: false, temporary: true },
        publicTemp: true,
        directTemp: false,
        schemaRows: [{ usage: true, create: false }],
        tableCounts: { select_count: 12, insert_count: 0, update_count: 0, delete_count: 0, truncate_count: 0 },
        sequenceCounts: { usage_count: 0, update_count: 0 },
        functionCounts: { execute_count: 3 },
        memberships: [{
            parent_role: 'parent_should_not_leak',
            member_role: 'audit_user_should_not_leak',
            inherit_option: true,
            set_option: false
        }]
    };

    const redacted = redactMatrix(raw);
    const encoded = JSON.stringify(redacted);

    assert.equal(redacted.databasePrivileges.temporarySource, 'PUBLIC_DATABASE_TEMPORARY');
    assert.equal(redacted.tablePrivileges.insert, 0);
    assert.match(redacted.roleFingerprint, /^role_[a-f0-9]{16}$/);
    assert.match(redacted.databaseFingerprint, /^db_[a-f0-9]{16}$/);
    assert.equal(roleFingerprint('same'), roleFingerprint('same'));
    assert.doesNotMatch(encoded, /should_not_leak/);
});

test('postgres TEMP privilege probes rollback successful temporary DDL', async () => {
    const calls = [];
    const fakeClient = {
        async query(sql) {
            calls.push(sql);
        }
    };

    const probes = await collectRollbackOnlyProbes(fakeClient);

    assert.equal(probes.createTemporaryTable.allowed, true);
    assert.equal(probes.createPersistentPublicTable.allowed, true);
    assert.ok(calls.includes('ROLLBACK'));
    assert.match(calls.join('\n'), /CREATE TEMP TABLE task29_temp_privilege_probe/);
    assert.match(calls.join('\n'), /CREATE TABLE public\.task29_persistent_ddl_probe/);
});

test('postgres TEMP privilege probes report denial without leaking object content', async () => {
    const fakeClient = {
        async query(sql) {
            if (/CREATE TEMP TABLE/.test(sql)) {
                const error = new Error('permission denied for database private_db_name');
                error.code = '42501';
                throw error;
            }
        }
    };

    const probes = await collectRollbackOnlyProbes(fakeClient);

    assert.equal(probes.createTemporaryTable.allowed, false);
    assert.equal(probes.createTemporaryTable.sqlState, '42501');
    assert.equal(probes.createTemporaryTable.errorClass, 'SQLSTATE_42');
    assert.doesNotMatch(JSON.stringify(probes), /private_db_name/);
});
