#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, '.codex-temp', '_preserved-artifacts', 'task29-postgres-temp-privileges');
const READONLY_URL_ENV = 'TASK_AI_ROLLOUT_DATABASE_URL';
const APPLY_URL_ENV = 'TASK_AUDIT_TEMP_PRIVILEGE_DATABASE_URL';
const APPLY_CONFIRMATION = 'TASK29_REVOKE_PUBLIC_TEMP';
const ROLE_REDACTION_SALT = 'task29-postgres-temp-privileges-v1';

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        mode: 'audit',
        outputDir: DEFAULT_OUTPUT_ROOT,
        allowTempRoles: [],
        expectedPublicTemp: null,
        confirm: '',
        useDatabaseUrlForApply: false
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = () => argv[++i];
        if (arg === 'audit' || arg === 'dry-run' || arg === 'apply') options.mode = arg;
        else if (arg === '--audit') options.mode = 'audit';
        else if (arg === '--dry-run') options.mode = 'dry-run';
        else if (arg === '--apply') options.mode = 'apply';
        else if (arg === '--out-dir') options.outputDir = path.resolve(next());
        else if (arg.startsWith('--out-dir=')) options.outputDir = path.resolve(arg.slice('--out-dir='.length));
        else if (arg === '--allow-temp-role') options.allowTempRoles.push(next());
        else if (arg.startsWith('--allow-temp-role=')) options.allowTempRoles.push(arg.slice('--allow-temp-role='.length));
        else if (arg === '--expected-public-temp') options.expectedPublicTemp = parseBoolean(next(), '--expected-public-temp');
        else if (arg.startsWith('--expected-public-temp=')) options.expectedPublicTemp = parseBoolean(arg.slice('--expected-public-temp='.length), '--expected-public-temp');
        else if (arg === '--confirm') options.confirm = next();
        else if (arg.startsWith('--confirm=')) options.confirm = arg.slice('--confirm='.length);
        else if (arg === '--use-database-url-for-apply') options.useDatabaseUrlForApply = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }

    if (!['audit', 'dry-run', 'apply'].includes(options.mode)) throw new Error(`Unsupported mode: ${options.mode}`);
    options.allowTempRoles = options.allowTempRoles
        .flatMap(value => String(value || '').split(','))
        .map(value => value.trim())
        .filter(Boolean);
    return options;
}

function parseBoolean(value, label) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error(`${label} must be true or false`);
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function roleFingerprint(roleName) {
    return `role_${sha256(`${ROLE_REDACTION_SALT}:${roleName || ''}`).slice(0, 16)}`;
}

function databaseFingerprint(databaseName) {
    return `db_${sha256(`${ROLE_REDACTION_SALT}:${databaseName || ''}`).slice(0, 16)}`;
}

function quoteIdent(identifier) {
    const value = String(identifier || '');
    if (!value) throw new Error('identifier is required');
    return `"${value.replace(/"/g, '""')}"`;
}

function connectionStringForMode(options) {
    if (options.mode === 'apply') {
        const dedicated = process.env[APPLY_URL_ENV];
        if (dedicated) return dedicated;
        if (options.useDatabaseUrlForApply && process.env.DATABASE_URL) return process.env.DATABASE_URL;
        throw new Error(`${APPLY_URL_ENV} is required for apply mode unless --use-database-url-for-apply is set with process-local DATABASE_URL`);
    }
    const readonly = process.env[READONLY_URL_ENV] || process.env.DATABASE_URL;
    if (!readonly) throw new Error(`${READONLY_URL_ENV} or process-local DATABASE_URL is required for audit/dry-run`);
    return readonly;
}

async function collectPrivilegeMatrix(client) {
    const identity = (await client.query(`
        SELECT current_user AS current_user,
               current_database() AS database_name,
               current_setting('transaction_read_only') AS transaction_read_only,
               current_setting('default_transaction_read_only', true) AS default_transaction_read_only
    `)).rows[0];

    const databaseAcl = (await client.query(`
        WITH db AS (
            SELECT oid, datname, datacl, datdba
            FROM pg_database
            WHERE datname = current_database()
        ),
        acl AS (
            SELECT CASE WHEN entry.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END AS grantee,
                   entry.privilege_type,
                   entry.is_grantable
            FROM db
            CROSS JOIN LATERAL aclexplode(COALESCE(db.datacl, acldefault('d', db.datdba))) AS entry
            LEFT JOIN pg_roles grantee_role ON grantee_role.oid = entry.grantee
        )
        SELECT grantee, privilege_type, bool_or(is_grantable) AS is_grantable
        FROM acl
        GROUP BY grantee, privilege_type
        ORDER BY grantee, privilege_type
    `)).rows;

    const dbPrivilege = (await client.query(`
        SELECT has_database_privilege(current_user, current_database(), 'CONNECT') AS connect,
               has_database_privilege(current_user, current_database(), 'CREATE') AS create,
               has_database_privilege(current_user, current_database(), 'TEMPORARY') AS temporary
    `)).rows[0];

    const publicTemp = databaseAcl.some(row => row.grantee === 'PUBLIC' && row.privilege_type === 'TEMPORARY');
    const directTemp = databaseAcl.some(row => row.grantee === identity.current_user && row.privilege_type === 'TEMPORARY');

    const schemaRows = (await client.query(`
        SELECT n.nspname AS schema_name,
               has_schema_privilege(current_user, n.oid, 'USAGE') AS usage,
               has_schema_privilege(current_user, n.oid, 'CREATE') AS create
        FROM pg_namespace n
        WHERE n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
        ORDER BY n.nspname
    `)).rows;

    const tableCounts = (await client.query(`
        SELECT COUNT(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'SELECT'))::int AS select_count,
               COUNT(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'INSERT'))::int AS insert_count,
               COUNT(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'UPDATE'))::int AS update_count,
               COUNT(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'DELETE'))::int AS delete_count,
               COUNT(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'TRUNCATE'))::int AS truncate_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
          AND c.relkind IN ('r','p','v','m','f')
    `)).rows[0];

    const sequenceCounts = (await client.query(`
        SELECT COUNT(*) FILTER (WHERE has_sequence_privilege(current_user, c.oid, 'USAGE'))::int AS usage_count,
               COUNT(*) FILTER (WHERE has_sequence_privilege(current_user, c.oid, 'UPDATE'))::int AS update_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
          AND c.relkind = 'S'
    `)).rows[0];

    const functionCounts = (await client.query(`
        SELECT COUNT(*) FILTER (WHERE has_function_privilege(current_user, p.oid, 'EXECUTE'))::int AS execute_count
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
    `)).rows[0];

    const memberships = (await client.query(`
        SELECT parent.rolname AS parent_role,
               child.rolname AS member_role,
               m.inherit_option,
               m.set_option
        FROM pg_auth_members m
        JOIN pg_roles parent ON parent.oid = m.roleid
        JOIN pg_roles child ON child.oid = m.member
        WHERE child.rolname = current_user
           OR parent.rolname = current_user
        ORDER BY parent.rolname, child.rolname
    `)).rows;

    return {
        identity,
        databaseAcl,
        dbPrivilege,
        publicTemp,
        directTemp,
        schemaRows,
        tableCounts,
        sequenceCounts,
        functionCounts,
        memberships
    };
}

function redactMatrix(raw) {
    const currentRole = raw.identity.current_user;
    return {
        roleFingerprint: roleFingerprint(currentRole),
        databaseFingerprint: databaseFingerprint(raw.identity.database_name),
        transactionReadOnly: raw.identity.transaction_read_only,
        defaultTransactionReadOnly: raw.identity.default_transaction_read_only,
        databasePrivileges: {
            currentRole: {
                connect: Boolean(raw.dbPrivilege.connect),
                create: Boolean(raw.dbPrivilege.create),
                temporary: Boolean(raw.dbPrivilege.temporary)
            },
            publicTemporaryGrant: raw.publicTemp,
            directCurrentRoleTemporaryGrant: raw.directTemp,
            temporarySource: raw.publicTemp && raw.dbPrivilege.temporary
                ? 'PUBLIC_DATABASE_TEMPORARY'
                : (raw.directTemp ? 'DIRECT_DATABASE_TEMPORARY' : (raw.dbPrivilege.temporary ? 'INHERITED_OR_OWNER_TEMPORARY' : 'NONE'))
        },
        schemaPrivileges: {
            schemasVisible: raw.schemaRows.length,
            createSchemas: raw.schemaRows.filter(row => row.create).length,
            usageSchemas: raw.schemaRows.filter(row => row.usage).length
        },
        tablePrivileges: {
            select: Number(raw.tableCounts.select_count || 0),
            insert: Number(raw.tableCounts.insert_count || 0),
            update: Number(raw.tableCounts.update_count || 0),
            delete: Number(raw.tableCounts.delete_count || 0),
            truncate: Number(raw.tableCounts.truncate_count || 0)
        },
        sequencePrivileges: {
            usage: Number(raw.sequenceCounts.usage_count || 0),
            update: Number(raw.sequenceCounts.update_count || 0)
        },
        functionPrivileges: {
            execute: Number(raw.functionCounts.execute_count || 0)
        },
        membership: raw.memberships.map(row => ({
            parentRoleFingerprint: roleFingerprint(row.parent_role),
            memberRoleFingerprint: roleFingerprint(row.member_role),
            inherit: Boolean(row.inherit_option),
            set: Boolean(row.set_option)
        }))
    };
}

function buildRollbackSql(databaseName, allowTempRoles = []) {
    const db = quoteIdent(databaseName);
    const roleRevokes = allowTempRoles.map(role => `REVOKE TEMPORARY ON DATABASE ${db} FROM ${quoteIdent(role)};`);
    return [
        'BEGIN;',
        ...roleRevokes,
        `GRANT TEMPORARY ON DATABASE ${db} TO PUBLIC;`,
        'COMMIT;'
    ].join('\n');
}

function buildApplySql(databaseName, allowTempRoles = []) {
    const db = quoteIdent(databaseName);
    const grants = allowTempRoles.map(role => `GRANT TEMPORARY ON DATABASE ${db} TO ${quoteIdent(role)};`);
    return [
        'BEGIN;',
        `REVOKE TEMPORARY ON DATABASE ${db} FROM PUBLIC;`,
        ...grants,
        'COMMIT;'
    ].join('\n');
}

function writeArtifacts(outputDir, payload, rollbackSql) {
    fs.mkdirSync(outputDir, { recursive: true });
    const stamp = payload.generatedAt.replace(/[:.]/g, '-');
    const evidencePath = path.join(outputDir, `task29-postgres-temp-privileges-${stamp}.json`);
    const rollbackPath = path.join(outputDir, `task29-postgres-temp-privileges-rollback-${stamp}.sql`);
    fs.writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`);
    fs.writeFileSync(rollbackPath, `${rollbackSql}\n`);
    return { evidencePath, rollbackPath };
}

async function runRollbackOnlyProbe(client, name, statements) {
    try {
        await client.query('BEGIN');
        for (const statement of statements) {
            await client.query(statement);
        }
        await client.query('ROLLBACK');
        return { name, allowed: true };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        return {
            name,
            allowed: false,
            sqlState: error.code || 'UNKNOWN',
            errorClass: error.code
                ? `SQLSTATE_${String(error.code).slice(0, 2)}`
                : 'UNKNOWN'
        };
    }
}

async function collectRollbackOnlyProbes(client) {
    return {
        createTemporaryTable: await runRollbackOnlyProbe(client, 'createTemporaryTable', [
            'SET TRANSACTION READ WRITE',
            'CREATE TEMP TABLE task29_temp_privilege_probe (id integer)',
            'DROP TABLE task29_temp_privilege_probe'
        ]),
        createPersistentPublicTable: await runRollbackOnlyProbe(client, 'createPersistentPublicTable', [
            'SET TRANSACTION READ WRITE',
            'CREATE TABLE public.task29_persistent_ddl_probe (id integer)'
        ])
    };
}

async function run(options = parseArgs()) {
    const generatedAt = new Date().toISOString();
    const connectionString = connectionStringForMode(options);
    const pool = new Pool({ connectionString, application_name: 'task29_postgres_temp_privileges' });
    const client = await pool.connect();

    try {
        await client.query(options.mode === 'apply' ? 'BEGIN' : 'BEGIN READ ONLY');

        const before = await collectPrivilegeMatrix(client);
        const allowTempRoles = options.allowTempRoles.length ? options.allowTempRoles : [before.identity.current_user];
        const rollbackSql = buildRollbackSql(before.identity.database_name, allowTempRoles);
        const applySql = buildApplySql(before.identity.database_name, allowTempRoles);

        if (options.mode === 'apply') {
            if (options.confirm !== APPLY_CONFIRMATION) throw new Error(`--confirm ${APPLY_CONFIRMATION} is required for apply`);
            if (options.expectedPublicTemp !== true) throw new Error('--expected-public-temp=true is required for apply');
            if (!before.publicTemp) throw new Error('PUBLIC TEMPORARY grant is not present; refusing apply');
            await client.query(`REVOKE TEMPORARY ON DATABASE ${quoteIdent(before.identity.database_name)} FROM PUBLIC`);
            for (const role of allowTempRoles) {
                await client.query(`GRANT TEMPORARY ON DATABASE ${quoteIdent(before.identity.database_name)} TO ${quoteIdent(role)}`);
            }
        }

        const after = options.mode === 'apply' ? await collectPrivilegeMatrix(client) : before;
        const redactedBefore = redactMatrix(before);
        const redactedAfter = redactMatrix(after);
        const basePayload = {
            generatedAt,
            mode: options.mode,
            applyConfirmationRequired: APPLY_CONFIRMATION,
            allowTempRoleFingerprints: allowTempRoles.map(roleFingerprint),
            before: redactedBefore,
            after: redactedAfter,
            proposedChange: {
                revokePublicTemporary: true,
                grantTemporaryToAllowlistOnly: allowTempRoles.length,
                applySqlSha256: sha256(applySql),
                rollbackSqlSha256: sha256(rollbackSql)
            },
            verdict: redactedBefore.databasePrivileges.publicTemporaryGrant
                ? 'PUBLIC_TEMPORARY_PRESENT'
                : 'PUBLIC_TEMPORARY_ALREADY_ABSENT'
        };

        let payload;
        let artifactPaths;
        if (options.mode === 'apply') {
            payload = { ...basePayload, rollbackOnlyProbes: null };
            artifactPaths = writeArtifacts(options.outputDir, payload, rollbackSql);
            await client.query('COMMIT');
        } else {
            await client.query('ROLLBACK');
            payload = { ...basePayload, rollbackOnlyProbes: await collectRollbackOnlyProbes(client) };
            artifactPaths = writeArtifacts(options.outputDir, payload, rollbackSql);
        }

        return { ...payload, artifactPaths };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    run()
        .then(result => {
            console.log(JSON.stringify({
                generatedAt: result.generatedAt,
                mode: result.mode,
                before: result.before,
                after: result.after,
                proposedChange: result.proposedChange,
                rollbackOnlyProbes: result.rollbackOnlyProbes,
                verdict: result.verdict,
                artifactPaths: result.artifactPaths
            }, null, 2));
        })
        .catch(error => {
            console.error(`[audit-postgres-temp-privileges] ${error.message}`);
            process.exit(1);
        });
}

module.exports = {
    APPLY_CONFIRMATION,
    APPLY_URL_ENV,
    READONLY_URL_ENV,
    buildApplySql,
    buildRollbackSql,
    databaseFingerprint,
    parseArgs,
    quoteIdent,
    redactMatrix,
    roleFingerprint,
    collectRollbackOnlyProbes,
    run
};
