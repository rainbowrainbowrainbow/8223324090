'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    buildRestoreOrder,
    compareBackupRows,
    readTableBackupFootprint
} = require('../services/backupCatalog');
const {
    BACKUP_GENERATION_ERROR_CODES,
    preflightBackupPayload
} = require('../services/backup');
const {
    BACKUP_EXCLUDED_TABLES,
    LEGACY_SQL_RESTORE_SUPPORTED,
    RESTORE_SETS
} = require('../config/backupRestorePolicy');

const ROOT = path.resolve(__dirname, '..');

function read(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function table(name, columns, primaryKey = ['id']) {
    const mapped = columns.map(column => ({
        name: column.name,
        notNull: Boolean(column.notNull)
    }));
    return {
        name,
        columns: mapped,
        columnMap: new Map(mapped.map(column => [column.name, column])),
        primaryKey
    };
}

function foreignKey(tableName, name, columns, referencedTable, matchType = 's') {
    return {
        key: `${tableName}:${name}`,
        table: tableName,
        name,
        columns,
        referencedTable,
        matchType
    };
}

test('backup policy classifies the migration ledger and only allows the attendance restore set', () => {
    assert.deepEqual(Object.keys(BACKUP_EXCLUDED_TABLES), ['schema_migrations']);
    assert.equal(LEGACY_SQL_RESTORE_SUPPORTED, false);
    assert.deepEqual(RESTORE_SETS['attendance-v1'].tables, [
        'staff_checkins',
        'hr_time_records'
    ]);
    assert.deepEqual(RESTORE_SETS['attendance-v1'].requiresExistingParents, ['staff']);
});

test('catalog restore order keeps staff before both attendance children', () => {
    const tables = [
        table('staff', [{ name: 'id', notNull: true }]),
        table('staff_checkins', [
            { name: 'id', notNull: true },
            { name: 'staff_id', notNull: true }
        ]),
        table('hr_time_records', [
            { name: 'id', notNull: true },
            { name: 'staff_id', notNull: true }
        ])
    ];
    const result = buildRestoreOrder(tables, [
        foreignKey('staff_checkins', 'staff_checkins_staff_id_fkey', ['staff_id'], 'staff'),
        foreignKey('hr_time_records', 'hr_time_records_staff_id_fkey', ['staff_id'], 'staff')
    ]);

    assert.ok(result.order.indexOf('staff') < result.order.indexOf('staff_checkins'));
    assert.ok(result.order.indexOf('staff') < result.order.indexOf('hr_time_records'));
    assert.deepEqual(result.deferredForeignKeys, []);
});

test('catalog breaks a real FK cycle only through a nullable edge', () => {
    const tables = [
        table('parent_a', [
            { name: 'id', notNull: true },
            { name: 'parent_b_id', notNull: false }
        ]),
        table('parent_b', [
            { name: 'id', notNull: true },
            { name: 'parent_a_id', notNull: true }
        ])
    ];
    const result = buildRestoreOrder(tables, [
        foreignKey('parent_a', 'a_to_b', ['parent_b_id'], 'parent_b'),
        foreignKey('parent_b', 'b_to_a', ['parent_a_id'], 'parent_a')
    ]);

    assert.deepEqual(result.order, ['parent_a', 'parent_b']);
    assert.deepEqual(result.deferredForeignKeys.map(item => item.constraint), ['a_to_b']);
    assert.deepEqual(result.deferredForeignKeys[0].breakColumns, ['parent_b_id']);
});

test('catalog fails closed for a non-breakable FK cycle', () => {
    const tables = [
        table('a', [
            { name: 'id', notNull: true },
            { name: 'b_id', notNull: true }
        ]),
        table('b', [
            { name: 'id', notNull: true },
            { name: 'a_id', notNull: true }
        ])
    ];
    assert.throws(
        () => buildRestoreOrder(tables, [
            foreignKey('a', 'a_to_b', ['b_id'], 'b'),
            foreignKey('b', 'b_to_a', ['a_id'], 'a')
        ]),
        error => error?.code === 'BACKUP_NON_BREAKABLE_FK_CYCLE'
    );
});

test('backup generation is one fail-closed repeatable-read catalog snapshot', () => {
    const source = read('services', 'backup.js');
    assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
    assert.match(source, /loadBackupCatalog\(client/);
    assert.match(source, /preflightBackupPayload\(client, catalog, sequences\)/);
    assert.match(source, /for \(const table of catalog\.tables\)/);
    assert.match(source, /readTableRows\(client, table\)/);
    assert.match(source, /readSequenceStates\(client, catalog\.sequences\)/);
    assert.match(source, /lockBackupSchemaSnapshot\(client\)/);
    assert.match(source, /validateBackupArtifact\(artifact\)/);
    assert.match(source, /createRecoveryBundle/);
    assert.doesNotMatch(source, /-- ERROR reading/);
    assert.doesNotMatch(source, /SAVEPOINT backup_table_read/);
    assert.doesNotMatch(source, /generateBackupSQL/);
    assert.ok(
        source.indexOf('preflightBackupPayload(client, catalog, sequences)')
            < source.indexOf('const data = await readTableRows(client, table)'),
        'size preflight must finish before the first table rows are loaded into JS memory'
    );
});

test('catalog metadata queries stay sequential on the transaction client', () => {
    const source = read('services', 'backupCatalog.js');
    const start = source.indexOf('async function loadBackupCatalog');
    const end = source.indexOf('async function configureBackupSession', start);
    const catalogLoader = source.slice(start, end);

    assert.match(source, /runCatalogQueriesSequentially/);
    assert.match(catalogLoader, /await runCatalogQueriesSequentially/);
    assert.doesNotMatch(catalogLoader, /Promise\.all/);
});

test('table size preflight stays in PostgreSQL and returns bigint counters only', async () => {
    let statement = '';
    const client = {
        async query(sql) {
            statement = sql;
            return {
                rowCount: 1,
                rows: [{ row_count: '7', encoded_row_bytes: '321' }]
            };
        }
    };
    const result = await readTableBackupFootprint(client, table('staff', [
        { name: 'id', notNull: true },
        { name: 'name', notNull: true }
    ]));

    assert.deepEqual(result, { rowCount: 7n, encodedRowBytes: 321n });
    assert.match(statement, /count\(\*\)::text AS row_count/);
    assert.match(statement, /pg_column_size\(encoded\.row_json\)/);
    assert.match(statement, /octet_length\(encoded\.row_json\)/);
    assert.match(statement, /to_jsonb\(ARRAY\[/);
    assert.doesNotMatch(statement, /SELECT \*/i);
});

test('oversized backup fails preflight before scanning later tables or loading rows', async () => {
    const tables = [
        table('large_table', [{ name: 'id', notNull: true }]),
        table('never_scanned', [{ name: 'id', notNull: true }])
    ];
    const catalog = {
        tables,
        tableMap: new Map(tables.map(item => [item.name, item]))
    };
    let queryCount = 0;
    const client = {
        async query() {
            queryCount += 1;
            return {
                rowCount: 1,
                rows: [{ row_count: '2', encoded_row_bytes: '4096' }]
            };
        }
    };

    await assert.rejects(
        preflightBackupPayload(client, catalog, [], { maxPayloadBytes: 1024 }),
        error => (
            error?.code === BACKUP_GENERATION_ERROR_CODES.SIZE_LIMIT_EXCEEDED
            && error?.statusCode === 413
        )
    );
    assert.equal(queryCount, 1, 'preflight must stop as soon as the lower bound exceeds the budget');
});

test('backup preflight includes payload metadata and row separators in its budget', async () => {
    const tables = [table('staff', [
        { name: 'id', notNull: true },
        { name: 'name', notNull: true }
    ])];
    const catalog = {
        tables,
        tableMap: new Map(tables.map(item => [item.name, item]))
    };
    const client = {
        async query() {
            return {
                rowCount: 1,
                rows: [{ row_count: '3', encoded_row_bytes: '90' }]
            };
        }
    };
    const result = await preflightBackupPayload(client, catalog, [], {
        maxPayloadBytes: 4096
    });

    assert.equal(result.tableStats[0].rowsDelta, 92n);
    assert.equal(
        result.estimatedPayloadBytes,
        result.skeletonBytes + 92n
    );
    assert.ok(result.estimatedPayloadBytes > 92n, 'table metadata must consume the same budget');
});

test('backup row order uses UTF-8 bytes instead of host collation', () => {
    const rows = [
        ['Їжак'],
        ['Єнот'],
        ['Івась'],
        ['їжак'],
        ['Zebra']
    ];
    const expected = rows.slice().sort((left, right) => Buffer.compare(
        Buffer.from(JSON.stringify(left), 'utf8'),
        Buffer.from(JSON.stringify(right), 'utf8')
    ));

    assert.deepEqual(rows.slice().sort(compareBackupRows), expected);
    assert.doesNotMatch(read('services', 'backupCatalog.js'), /localeCompare\(JSON\.stringify/);
});

test('restore endpoints use structured recovery and expose dynamic inventory policy', () => {
    const source = read('routes', 'backup.js');
    assert.match(source, /createRestorePlan/);
    assert.match(source, /executeRestorePlan/);
    assert.match(source, /assertRestoreConfirmation/);
    assert.match(source, /loadBackupCatalog/);
    assert.match(source, /legacyRawSqlRestoreSupported: LEGACY_SQL_RESTORE_SUPPORTED/);
    assert.match(source, /restoreSets: RESTORE_SETS/);
    assert.doesNotMatch(source, /aes-256-cbc/i);
    assert.doesNotMatch(source, /req\.query\.key/);
    assert.doesNotMatch(source, /client\.query\(statement\)/);
});
