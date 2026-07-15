'use strict';

const crypto = require('node:crypto');

class BackupCatalogError extends Error {
    constructor(code, message, details = undefined) {
        super(message);
        this.name = 'BackupCatalogError';
        this.code = code;
        this.details = details;
    }
}

function quoteIdentifier(identifier) {
    const value = String(identifier || '');
    if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) {
        throw new BackupCatalogError(
            'BACKUP_UNSAFE_IDENTIFIER',
            `Unsafe PostgreSQL identifier: ${value}`
        );
    }
    return `"${value.replace(/"/g, '""')}"`;
}

function quotePublicRelation(identifier) {
    return `${quoteIdentifier('public')}.${quoteIdentifier(identifier)}`;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => (
        `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
}

function compareBackupRows(left, right) {
    return Buffer.compare(
        Buffer.from(JSON.stringify(left), 'utf8'),
        Buffer.from(JSON.stringify(right), 'utf8')
    );
}

function mapConstraintColumns(columnByNumber, numbers) {
    return (numbers || []).map(number => {
        const column = columnByNumber.get(Number(number));
        if (!column) {
            throw new BackupCatalogError(
                'BACKUP_CATALOG_COLUMN_MISSING',
                `Constraint references missing column number ${number}`
            );
        }
        return column.name;
    });
}

function buildRestoreOrder(tables, foreignKeys) {
    const tableNames = tables.map(table => table.name).sort();
    const tableMap = new Map(tables.map(table => [table.name, table]));
    const activeForeignKeys = new Set(foreignKeys.map(foreignKey => foreignKey.key));
    const deferredForeignKeys = [];

    function edgeParticipatesInCycle(candidate) {
        if (candidate.table === candidate.referencedTable) return true;
        const stack = [candidate.referencedTable];
        const visited = new Set();
        while (stack.length > 0) {
            const table = stack.pop();
            if (table === candidate.table) return true;
            if (visited.has(table)) continue;
            visited.add(table);
            for (const foreignKey of foreignKeys) {
                if (!activeForeignKeys.has(foreignKey.key)) continue;
                if (foreignKey.table === table) stack.push(foreignKey.referencedTable);
            }
        }
        return false;
    }

    function topologicalPass() {
        const dependencies = new Map(tableNames.map(name => [name, new Set()]));
        for (const foreignKey of foreignKeys) {
            if (!activeForeignKeys.has(foreignKey.key)) continue;
            dependencies.get(foreignKey.table).add(foreignKey.referencedTable);
        }

        const order = [];
        const remaining = new Set(tableNames);
        while (remaining.size > 0) {
            const ready = [...remaining]
                .filter(name => [...dependencies.get(name)].every(parent => !remaining.has(parent)))
                .sort();
            if (ready.length === 0) break;
            for (const name of ready) {
                remaining.delete(name);
                order.push(name);
            }
        }
        return { order, remaining };
    }

    while (true) {
        const pass = topologicalPass();
        if (pass.remaining.size === 0) {
            return { order: pass.order, deferredForeignKeys };
        }

        const breakable = foreignKeys
            .filter(foreignKey => (
                activeForeignKeys.has(foreignKey.key)
                && pass.remaining.has(foreignKey.table)
                && pass.remaining.has(foreignKey.referencedTable)
                && edgeParticipatesInCycle(foreignKey)
            ))
            .map(foreignKey => {
                const table = tableMap.get(foreignKey.table);
                const columns = foreignKey.columns.map(name => table.columnMap.get(name));
                const nullableColumns = columns.filter(column => !column.notNull).map(column => column.name);
                const breakColumns = foreignKey.matchType === 'f'
                    ? (nullableColumns.length === columns.length ? nullableColumns : [])
                    : nullableColumns;
                return { foreignKey, breakColumns, table };
            })
            .filter(candidate => candidate.breakColumns.length > 0 && candidate.table.primaryKey.length > 0)
            .sort((left, right) => left.foreignKey.key.localeCompare(right.foreignKey.key));

        if (breakable.length === 0) {
            throw new BackupCatalogError(
                'BACKUP_NON_BREAKABLE_FK_CYCLE',
                `Cannot create a safe restore order for: ${[...pass.remaining].sort().join(', ')}`,
                { tables: [...pass.remaining].sort() }
            );
        }

        // Remove every nullable edge inside the unresolved component. This is
        // deterministic and keeps restore simple; original values are applied
        // with parameterized UPDATE statements after all rows exist.
        for (const candidate of breakable) {
            if (!activeForeignKeys.delete(candidate.foreignKey.key)) continue;
            deferredForeignKeys.push({
                table: candidate.foreignKey.table,
                constraint: candidate.foreignKey.name,
                columns: candidate.foreignKey.columns,
                breakColumns: candidate.breakColumns,
                referencedTable: candidate.foreignKey.referencedTable,
                primaryKey: candidate.table.primaryKey
            });
        }
    }
}

async function runCatalogQueriesSequentially(queryFactories) {
    const results = [];
    for (const query of queryFactories) results.push(await query());
    return results;
}

async function loadBackupCatalog(client, { excludedTables = new Set(['schema_migrations']) } = {}) {
    const excluded = excludedTables instanceof Set
        ? new Set(excludedTables)
        : new Set(excludedTables || []);

    const [
        tableResult,
        columnResult,
        constraintResult,
        indexResult,
        sequenceResult,
        triggerResult,
        policyResult
    ] = await runCatalogQueriesSequentially([
        () => client.query(`
            SELECT
                c.oid::integer AS table_oid,
                c.relname AS table_name,
                c.relrowsecurity AS row_security,
                c.relforcerowsecurity AS force_row_security
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            ORDER BY c.relname
        `),
        () => client.query(`
            SELECT
                c.oid::integer AS table_oid,
                c.relname AS table_name,
                a.attnum::integer AS column_number,
                a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                a.attnotnull AS not_null,
                COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS default_expression,
                a.attidentity AS identity_kind,
                a.attgenerated AS generated_kind
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY c.relname, a.attnum
        `),
        () => client.query(`
            SELECT
                child.relname AS table_name,
                constraint_row.conname AS constraint_name,
                constraint_row.contype AS constraint_type,
                parent.relname AS referenced_table,
                constraint_row.conkey::integer[] AS column_numbers,
                constraint_row.confkey::integer[] AS referenced_column_numbers,
                constraint_row.condeferrable AS deferrable,
                constraint_row.condeferred AS initially_deferred,
                constraint_row.confdeltype AS delete_action,
                constraint_row.confmatchtype AS match_type,
                pg_get_constraintdef(constraint_row.oid, true) AS definition
            FROM pg_constraint constraint_row
            JOIN pg_class child ON child.oid = constraint_row.conrelid
            JOIN pg_namespace n ON n.oid = child.relnamespace
            LEFT JOIN pg_class parent ON parent.oid = constraint_row.confrelid
            WHERE n.nspname = 'public'
              AND constraint_row.contype IN ('p', 'u', 'f', 'c', 'x')
            ORDER BY child.relname, constraint_row.conname
        `),
        () => client.query(`
            SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
            FROM pg_indexes
            WHERE schemaname = 'public'
            ORDER BY tablename, indexname
        `),
        () => client.query(`
            SELECT
                sequence_row.oid::integer AS sequence_oid,
                sequence_row.relname AS sequence_name,
                owned_table.relname AS owned_table,
                owned_column.attname AS owned_column,
                format_type(sequence_config.seqtypid, NULL) AS data_type,
                sequence_config.seqstart::text AS start_value,
                sequence_config.seqincrement::text AS increment_by,
                sequence_config.seqmin::text AS min_value,
                sequence_config.seqmax::text AS max_value,
                sequence_config.seqcache::text AS cache_size,
                sequence_config.seqcycle AS cycles
            FROM pg_class sequence_row
            JOIN pg_namespace n ON n.oid = sequence_row.relnamespace
            JOIN pg_sequence sequence_config ON sequence_config.seqrelid = sequence_row.oid
            LEFT JOIN pg_depend dependency
              ON dependency.classid = 'pg_class'::regclass
             AND dependency.objid = sequence_row.oid
             AND dependency.refclassid = 'pg_class'::regclass
             AND dependency.deptype IN ('a', 'i')
            LEFT JOIN pg_class owned_table ON owned_table.oid = dependency.refobjid
            LEFT JOIN pg_attribute owned_column
              ON owned_column.attrelid = dependency.refobjid
             AND owned_column.attnum = dependency.refobjsubid
            WHERE n.nspname = 'public' AND sequence_row.relkind = 'S'
            ORDER BY sequence_row.relname
        `),
        () => client.query(`
            SELECT
                table_row.relname AS table_name,
                trigger_row.tgname AS trigger_name,
                trigger_row.tgenabled AS enabled,
                pg_get_triggerdef(trigger_row.oid, true) AS definition
            FROM pg_trigger trigger_row
            JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
            JOIN pg_namespace n ON n.oid = table_row.relnamespace
            WHERE n.nspname = 'public'
              AND table_row.relkind = 'r'
              AND NOT trigger_row.tgisinternal
            ORDER BY table_row.relname, trigger_row.tgname
        `),
        () => client.query(`
            SELECT
                tablename AS table_name,
                policyname AS policy_name,
                permissive,
                roles::text AS role_names,
                cmd AS command,
                COALESCE(qual, '') AS qualification,
                COALESCE(with_check, '') AS check_expression
            FROM pg_policies
            WHERE schemaname = 'public'
            ORDER BY tablename, policyname
        `)
    ]);

    const discoveredNames = new Set(tableResult.rows.map(row => row.table_name));
    for (const excludedName of excluded) {
        if (!discoveredNames.has(excludedName)) {
            throw new BackupCatalogError(
                'BACKUP_EXCLUSION_NOT_FOUND',
                `Excluded table is missing from the current schema: ${excludedName}`
            );
        }
    }

    const tableRows = tableResult.rows.filter(row => !excluded.has(row.table_name));
    const tableMap = new Map(tableRows.map(row => [row.table_name, {
        name: row.table_name,
        oid: Number(row.table_oid),
        rowSecurity: Boolean(row.row_security),
        forceRowSecurity: Boolean(row.force_row_security),
        columns: [],
        columnMap: new Map(),
        constraints: [],
        indexes: [],
        triggers: [],
        policies: [],
        primaryKey: []
    }]));

    for (const row of columnResult.rows) {
        const table = tableMap.get(row.table_name);
        if (!table) continue;
        const column = {
            name: row.column_name,
            number: Number(row.column_number),
            dataType: row.data_type,
            notNull: Boolean(row.not_null),
            defaultExpression: row.default_expression || '',
            identityKind: row.identity_kind || '',
            generatedKind: row.generated_kind || ''
        };
        table.columns.push(column);
        table.columnMap.set(column.name, column);
    }

    const allColumnsByTable = new Map();
    for (const row of columnResult.rows) {
        if (!allColumnsByTable.has(row.table_name)) allColumnsByTable.set(row.table_name, new Map());
        allColumnsByTable.get(row.table_name).set(Number(row.column_number), row.column_name);
    }

    const foreignKeys = [];
    for (const row of constraintResult.rows) {
        const table = tableMap.get(row.table_name);
        const referencedTableExcluded = row.referenced_table && excluded.has(row.referenced_table);
        if (!table) {
            if (row.referenced_table && tableMap.has(row.referenced_table)) {
                throw new BackupCatalogError(
                    'BACKUP_EXCLUDED_TABLE_DEPENDENCY',
                    `Excluded table ${row.table_name} references included table ${row.referenced_table}`
                );
            }
            continue;
        }
        if (referencedTableExcluded) {
            throw new BackupCatalogError(
                'BACKUP_EXCLUDED_TABLE_DEPENDENCY',
                `Included table ${row.table_name} references excluded table ${row.referenced_table}`
            );
        }

        const columnByNumber = new Map(table.columns.map(column => [column.number, column]));
        const constraint = {
            name: row.constraint_name,
            type: row.constraint_type,
            definition: row.definition
        };
        table.constraints.push(constraint);
        if (row.constraint_type === 'p') {
            table.primaryKey = mapConstraintColumns(columnByNumber, row.column_numbers);
        }
        if (row.constraint_type === 'f') {
            const referencedColumns = allColumnsByTable.get(row.referenced_table) || new Map();
            const foreignKey = {
                key: `${row.table_name}:${row.constraint_name}`,
                name: row.constraint_name,
                table: row.table_name,
                columns: mapConstraintColumns(columnByNumber, row.column_numbers),
                referencedTable: row.referenced_table,
                referencedColumns: (row.referenced_column_numbers || []).map(number => (
                    referencedColumns.get(Number(number))
                )),
                deferrable: Boolean(row.deferrable),
                initiallyDeferred: Boolean(row.initially_deferred),
                deleteAction: row.delete_action,
                matchType: row.match_type,
                definition: row.definition
            };
            foreignKeys.push(foreignKey);
        }
    }

    for (const row of indexResult.rows) {
        const table = tableMap.get(row.table_name);
        if (!table) continue;
        table.indexes.push({ name: row.index_name, definition: row.definition });
    }

    for (const row of triggerResult.rows) {
        const table = tableMap.get(row.table_name);
        if (!table) continue;
        if (!['O', 'D', 'R', 'A'].includes(row.enabled)) {
            throw new BackupCatalogError(
                'BACKUP_UNSUPPORTED_TRIGGER_MODE',
                `Unsupported trigger mode on ${row.table_name}`
            );
        }
        table.triggers.push({
            name: row.trigger_name,
            enabled: row.enabled,
            definition: row.definition
        });
    }

    for (const row of policyResult.rows) {
        const table = tableMap.get(row.table_name);
        if (!table) continue;
        table.policies.push({
            name: row.policy_name,
            permissive: row.permissive,
            roles: row.role_names,
            command: row.command,
            qualification: row.qualification,
            checkExpression: row.check_expression
        });
    }

    const sequences = sequenceResult.rows
        .filter(row => !row.owned_table || !excluded.has(row.owned_table))
        .map(row => ({
            name: row.sequence_name,
            ownedTable: row.owned_table || null,
            ownedColumn: row.owned_column || null,
            dataType: row.data_type,
            startValue: row.start_value,
            incrementBy: row.increment_by,
            minValue: row.min_value,
            maxValue: row.max_value,
            cacheSize: row.cache_size,
            cycles: Boolean(row.cycles)
        }));
    const tables = [...tableMap.values()].sort((left, right) => left.name.localeCompare(right.name));
    const { order, deferredForeignKeys } = buildRestoreOrder(tables, foreignKeys);

    const schemaDescriptor = {
        excludedTables: [...excluded].sort(),
        tables: tables.map(table => ({
            name: table.name,
            rowSecurity: table.rowSecurity,
            forceRowSecurity: table.forceRowSecurity,
            columns: table.columns.map(column => ({
                name: column.name,
                dataType: column.dataType,
                notNull: column.notNull,
                defaultExpression: column.defaultExpression,
                identityKind: column.identityKind,
                generatedKind: column.generatedKind
            })),
            constraints: table.constraints
                .map(constraint => ({ ...constraint }))
                .sort((left, right) => left.name.localeCompare(right.name)),
            indexes: table.indexes
                .map(index => ({ ...index }))
                .sort((left, right) => left.name.localeCompare(right.name)),
            triggers: table.triggers
                .map(trigger => ({ ...trigger }))
                .sort((left, right) => left.name.localeCompare(right.name)),
            policies: table.policies
                .map(policy => ({ ...policy }))
                .sort((left, right) => left.name.localeCompare(right.name))
        })),
        sequences: sequences.slice().sort((left, right) => left.name.localeCompare(right.name))
    };

    return {
        tables,
        tableMap,
        foreignKeys,
        sequences,
        restoreOrder: order,
        deferredForeignKeys,
        excludedTables: [...excluded].sort(),
        schemaDescriptor,
        schemaFingerprint: sha256(stableJson(schemaDescriptor))
    };
}

async function configureBackupSession(client) {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL datestyle = 'ISO, YMD'");
    await client.query("SET LOCAL intervalstyle = 'postgres'");
    await client.query('SET LOCAL row_security = off');
}

function parseNonNegativeBigInt(value, label) {
    const normalized = String(value ?? '');
    if (!/^\d+$/.test(normalized)) {
        throw new BackupCatalogError(
            'BACKUP_SIZE_PREFLIGHT_INVALID',
            `PostgreSQL returned an invalid ${label}`
        );
    }
    return BigInt(normalized);
}

/**
 * Measure the encoded row footprint without returning any business rows to
 * Node.js. PostgreSQL's JSON text includes at least the bytes emitted by
 * JSON.stringify for the exported text array; pg_column_size adds the datum
 * header, while octet_length protects the estimate from TOAST compression.
 */
async function readTableBackupFootprint(client, table) {
    const columns = table.columns.filter(column => !column.generatedKind);
    const rowArray = columns.length > 0
        ? `ARRAY[${columns.map(column => (
            `CASE WHEN ${quoteIdentifier(column.name)} IS NULL THEN NULL `
            + `ELSE ${quoteIdentifier(column.name)}::text END`
        )).join(', ')}]`
        : 'ARRAY[]::text[]';
    const result = await client.query(`
        SELECT
            count(*)::text AS row_count,
            COALESCE(
                sum(GREATEST(
                    pg_column_size(encoded.row_json),
                    octet_length(encoded.row_json)
                )),
                0
            )::text AS encoded_row_bytes
        FROM ${quotePublicRelation(table.name)} source_row
        CROSS JOIN LATERAL (
            SELECT to_jsonb(${rowArray})::text AS row_json
        ) encoded
    `);
    if (result.rowCount !== 1) {
        throw new BackupCatalogError(
            'BACKUP_SIZE_PREFLIGHT_INVALID',
            'PostgreSQL did not return one backup size preflight row'
        );
    }
    return {
        rowCount: parseNonNegativeBigInt(result.rows[0].row_count, 'row count'),
        encodedRowBytes: parseNonNegativeBigInt(
            result.rows[0].encoded_row_bytes,
            'encoded row byte count'
        )
    };
}

async function readTableRows(client, table) {
    const columns = table.columns.filter(column => !column.generatedKind);
    const selectList = columns.length > 0
        ? columns.map((column, index) => (
            `CASE WHEN ${quoteIdentifier(column.name)} IS NULL THEN NULL `
            + `ELSE ${quoteIdentifier(column.name)}::text END AS ${quoteIdentifier(`c${index}`)}`
        )).join(', ')
        : `ARRAY[]::text[] AS ${quoteIdentifier('__empty_row')}`;
    const result = await client.query(
        `SELECT ${selectList} FROM ${quotePublicRelation(table.name)}`
    );
    const rows = result.rows.map(row => columns.map((column, index) => row[`c${index}`]));
    const encodedRowBytes = rows.reduce((total, row) => (
        total + Buffer.byteLength(JSON.stringify(row), 'utf8')
    ), 0);
    rows.sort(compareBackupRows);
    return {
        columns: columns.map(column => column.name),
        rows,
        rowCount: rows.length,
        encodedRowBytes,
        checksum: sha256(JSON.stringify(rows))
    };
}

async function readSequenceStates(client, sequences) {
    const states = [];
    for (const sequence of sequences) {
        const result = await client.query(
            `SELECT last_value::text AS last_value, is_called FROM ${quotePublicRelation(sequence.name)}`
        );
        if (result.rowCount !== 1) {
            throw new BackupCatalogError(
                'BACKUP_SEQUENCE_STATE_MISSING',
                `Could not read sequence state for ${sequence.name}`
            );
        }
        states.push({
            ...sequence,
            lastValue: result.rows[0].last_value,
            isCalled: Boolean(result.rows[0].is_called)
        });
    }
    return states;
}

async function readMigrationState(client) {
    const result = await client.query(
        `SELECT version FROM ${quotePublicRelation('schema_migrations')} ORDER BY version`
    );
    const versions = result.rows.map(row => row.version);
    return {
        versions,
        fingerprint: sha256(stableJson(versions)),
        head: versions.at(-1) || null
    };
}

module.exports = {
    BackupCatalogError,
    buildRestoreOrder,
    compareBackupRows,
    configureBackupSession,
    loadBackupCatalog,
    quoteIdentifier,
    quotePublicRelation,
    readMigrationState,
    readSequenceStates,
    readTableBackupFootprint,
    readTableRows,
    sha256,
    stableJson
};
