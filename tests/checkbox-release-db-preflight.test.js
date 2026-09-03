const test = require('node:test');
const assert = require('node:assert/strict');

const {
    CheckboxReleaseDbPreflightError,
    inspectCheckboxMigrationReadiness,
    requiredDatabaseUrl,
    sslConfig
} = require('../scripts/checkbox-release-db-preflight');

test('Checkbox release DB preflight requires a task-specific URL and explicit SSL mode', () => {
    assert.throws(
        () => requiredDatabaseUrl({ DATABASE_URL: 'postgres://must-not-be-used' }),
        error => error instanceof CheckboxReleaseDbPreflightError
            && error.code === 'checkbox_release_preflight_database_url_required'
    );
    assert.throws(
        () => sslConfig({}),
        error => error.code === 'checkbox_release_preflight_database_ssl_required'
    );
    assert.equal(sslConfig({ CHECKBOX_RELEASE_PREFLIGHT_DATABASE_SSL: 'false' }), false);
    assert.deepEqual(sslConfig({ CHECKBOX_RELEASE_PREFLIGHT_DATABASE_SSL: 'true' }), { rejectUnauthorized: false });
});

test('Checkbox release DB preflight is read-only and reports every migration blocker count', async () => {
    const queries = [];
    const client = {
        async query(sql) {
            queries.push(sql.replace(/\s+/g, ' ').trim());
            if (String(sql).includes('SELECT COUNT')) {
                return {
                    rows: [{
                        shift_lifecycle_mismatches: 2,
                        orphan_shift_operations: 0,
                        shift_operation_scope_mismatches: 1,
                        duplicate_shift_operations: 0,
                        duplicate_unresolved_shift_lifecycles: 0,
                        invalid_open_operation_links: 0,
                        invalid_close_operation_links: 0
                    }]
                };
            }
            return { rows: [] };
        },
        release() {}
    };
    const result = await inspectCheckboxMigrationReadiness({ async connect() { return client; } });
    assert.equal(result.ok, false);
    assert.deepEqual(result.blockers, [
        { code: 'shift_lifecycle_mismatches', count: 2 },
        { code: 'shift_operation_scope_mismatches', count: 1 }
    ]);
    assert.deepEqual(queries.slice(0, 2), ['BEGIN', 'SET TRANSACTION READ ONLY']);
    assert.equal(queries.at(-1), 'COMMIT');
    const inspectionSql = queries.find(query => query.startsWith('SELECT (SELECT COUNT'));
    assert.match(inspectionSql, /FROM fiscal_shifts WHERE NOT \( \(/);
    assert.match(inspectionSql, /status IN \('unknown', 'failed', 'blocked'\) AND lifecycle_stage IN \('CREATED', 'OPENING', 'OPENED', 'CLOSING'\)/);
    assert.match(inspectionSql, /lifecycle_stage IN \('CREATED', 'OPENING'\) OR provider_shift_id IS NOT NULL/);
    assert.match(inspectionSql, /HAVING COUNT\(\*\) > 1/);
    assert.match(inspectionSql, /invalid_close_operation_links/);
    assert.doesNotMatch(inspectionSql, /INSERT|UPDATE|DELETE|ALTER|DROP/);
});

test('Checkbox release DB preflight passes only when every blocker count is zero', async () => {
    const client = {
        async query(sql) {
            if (String(sql).includes('SELECT COUNT')) {
                return {
                    rows: [{
                        shift_lifecycle_mismatches: 0,
                        orphan_shift_operations: 0,
                        shift_operation_scope_mismatches: 0,
                        duplicate_shift_operations: 0,
                        duplicate_unresolved_shift_lifecycles: 0,
                        invalid_open_operation_links: 0,
                        invalid_close_operation_links: 0
                    }]
                };
            }
            return { rows: [] };
        },
        release() {}
    };
    const result = await inspectCheckboxMigrationReadiness({ async connect() { return client; } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.blockers, []);
});
