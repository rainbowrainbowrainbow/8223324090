#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const AUDIT_SCRIPT = path.join(ROOT, 'scripts', 'audit-attendance-historical-impact.js');
const ADMIN_URL_VARIABLE = 'ATTENDANCE_AUDIT_ADMIN_DATABASE_URL';
const ROLE_PREFIX = 'eg_attendance_audit_';
const GENERATED_ROLE_PATTERN = /^eg_attendance_audit_\d{8}t\d{6}z_[a-f0-9]{10}$/;
const DEFAULT_TTL_MINUTES = 15;
const MAX_TTL_MINUTES = 60;
const STATEMENT_TIMEOUT_MS = 30_000;
const LOCK_TIMEOUT_MS = 2_000;
const REQUIRED_TABLES = Object.freeze([
    'hr_time_records',
    'hr_audit_log',
    'payroll_reports',
    'payroll_period_locks',
    'payroll_entries',
    'salary_adjustments',
    'finance_transactions'
]);
const CHILD_DATABASE_VARIABLES = Object.freeze([
    ADMIN_URL_VARIABLE,
    'ATTENDANCE_AUDIT_DATABASE_URL',
    'PRODUCTION_READONLY_DATABASE_URL',
    'ATTENDANCE_DATA_FIX_DATABASE_URL',
    'DATABASE_URL'
]);
const SAFE_AUDIT_CATEGORIES = Object.freeze([
    'late-grace',
    'overtime-grace',
    'legacy-status-conflict',
    'null-zero-negative-late',
    'missing-plan-source'
]);

function usage() {
    return [
        'Usage:',
        '  node scripts/with-temporary-attendance-audit-role.js [--ttl-minutes 1-60] <attendance audit arguments>',
        '  node scripts/with-temporary-attendance-audit-role.js --recover-role <exact-generated-role-name>',
        '',
        'Admin connection:',
        `  Set ${ADMIN_URL_VARIABLE} only in the current secure operator process.`,
        '',
        'Examples:',
        '  node scripts/with-temporary-attendance-audit-role.js --from 2026-07-01 --to 2026-07-31 --business-context event_genix --categories late-grace,overtime-grace --format markdown',
        `  node scripts/with-temporary-attendance-audit-role.js --recover-role ${ROLE_PREFIX}20260719t120000z_0123456789`,
        '',
        'Safety:',
        '  The generated password is never printed or written to disk.',
        '  Runtime startup, API routes, schedulers, migrations, and persistent secrets are not used.'
    ].join('\n');
}

function readValue(argv, index, name) {
    const value = argv[index + 1];
    if (!value || String(value).startsWith('--')) throw new Error(`${name} requires a value`);
    return String(value).trim();
}

function parseArgs(argv) {
    const options = {
        help: false,
        ttlMinutes: DEFAULT_TTL_MINUTES,
        recoverRole: '',
        auditArgs: []
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = String(argv[index]);
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--ttl-minutes') {
            options.ttlMinutes = Number(readValue(argv, index, arg));
            index += 1;
        } else if (arg === '--recover-role') {
            options.recoverRole = readValue(argv, index, arg);
            index += 1;
        } else if (arg === '--') {
            options.auditArgs.push(...argv.slice(index + 1).map(String));
            break;
        } else {
            options.auditArgs.push(arg);
        }
    }
    if (!Number.isInteger(options.ttlMinutes)
        || options.ttlMinutes < 1
        || options.ttlMinutes > MAX_TTL_MINUTES) {
        throw new Error(`--ttl-minutes must be an integer from 1 to ${MAX_TTL_MINUTES}`);
    }
    if (options.recoverRole) {
        assertGeneratedRoleName(options.recoverRole);
        if (options.auditArgs.length) throw new Error('--recover-role cannot be combined with attendance audit arguments');
    } else if (!options.help && !options.auditArgs.length) {
        throw new Error('Attendance audit arguments are required; use --help for an example');
    }
    return options;
}

function assertGeneratedRoleName(roleName) {
    if (!GENERATED_ROLE_PATTERN.test(String(roleName || ''))) {
        throw new Error(`Role name must exactly match ${ROLE_PREFIX}<UTC timestamp>_<10 hex characters>`);
    }
    return roleName;
}

function quoteIdentifier(identifier) {
    return `"${String(identifier).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function generateRoleName(now = new Date(), randomBytes = crypto.randomBytes) {
    const timestamp = now.toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'z')
        .toLowerCase();
    return `${ROLE_PREFIX}${timestamp}_${randomBytes(5).toString('hex')}`;
}

function generatePassword(randomBytes = crypto.randomBytes) {
    return randomBytes(32).toString('base64url');
}

function buildScramVerifier(password, {
    salt = crypto.randomBytes(16),
    iterations = 4096
} = {}) {
    const saltedPassword = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
    const storedKey = crypto.createHash('sha256').update(clientKey).digest();
    const serverKey = crypto.createHmac('sha256', saltedPassword).update('Server Key').digest();
    return [
        `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}`,
        `${storedKey.toString('base64')}:${serverKey.toString('base64')}`
    ].join('$');
}

function isLocalDatabaseUrl(connectionString) {
    const url = new URL(connectionString);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
        || url.searchParams.get('sslmode') === 'disable';
}

function poolConfig(connectionString, applicationName) {
    if (!connectionString) throw new Error(`${ADMIN_URL_VARIABLE} is required`);
    return {
        connectionString,
        ssl: isLocalDatabaseUrl(connectionString) ? false : { rejectUnauthorized: false },
        application_name: applicationName,
        max: 2,
        connectionTimeoutMillis: 10_000
    };
}

function loadAdminUrl(env = process.env) {
    const value = String(env[ADMIN_URL_VARIABLE] || '').trim();
    if (!value) throw new Error(`${ADMIN_URL_VARIABLE} is required`);
    const parsed = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
        throw new Error(`${ADMIN_URL_VARIABLE} must be a PostgreSQL connection URL`);
    }
    return value;
}

function redactOperatorError(error, env = process.env) {
    let message = String(error?.message || error || 'unknown error');
    const adminUrl = String(env[ADMIN_URL_VARIABLE] || '');
    const secrets = [adminUrl];
    try {
        const parsed = new URL(adminUrl);
        secrets.push(parsed.password, decodeURIComponent(parsed.password || ''));
    } catch {
        // Invalid URLs are reported without echoing the supplied value.
    }
    for (const secret of secrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
        message = message.split(secret).join('[REDACTED]');
    }
    return message;
}

function buildRoleConnectionString(adminUrl, roleName, password) {
    const url = new URL(adminUrl);
    url.username = roleName;
    url.password = password;
    url.searchParams.set('application_name', 'attendance_anomaly_readonly_audit');
    return url.toString();
}

async function assertRequiredTables(client) {
    const result = await client.query(
        `SELECT requested.table_name,
                to_regclass(format('public.%I', requested.table_name)) IS NOT NULL AS exists
           FROM unnest($1::text[]) AS requested(table_name)
          ORDER BY requested.table_name`,
        [REQUIRED_TABLES]
    );
    const missing = result.rows.filter(row => row.exists !== true).map(row => row.table_name);
    if (missing.length) throw new Error(`Required attendance audit tables are missing: ${missing.join(', ')}`);
}

async function provisionTemporaryRole(adminPool, {
    roleName,
    password,
    ttlMinutes = DEFAULT_TTL_MINUTES
}) {
    assertGeneratedRoleName(roleName);
    const client = await adminPool.connect();
    const role = quoteIdentifier(roleName);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const scramVerifier = buildScramVerifier(password);
    let databaseName = '';
    try {
        await client.query('BEGIN');
        await assertRequiredTables(client);
        const database = await client.query('SELECT current_database() AS database_name');
        databaseName = String(database.rows[0]?.database_name || '');
        if (!databaseName) throw new Error('Could not determine current PostgreSQL database');

        await client.query(
            `CREATE ROLE ${role}
             WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
                  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1
                  PASSWORD ${quoteLiteral(scramVerifier)}
                  VALID UNTIL ${quoteLiteral(expiresAt.toISOString())}`
        );
        await client.query(`ALTER ROLE ${role} SET default_transaction_read_only = 'on'`);
        await client.query(`ALTER ROLE ${role} SET statement_timeout = ${quoteLiteral(`${STATEMENT_TIMEOUT_MS}ms`)}`);
        await client.query(`ALTER ROLE ${role} SET lock_timeout = ${quoteLiteral(`${LOCK_TIMEOUT_MS}ms`)}`);
        await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${role}`);
        await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        await client.query(
            `GRANT SELECT ON TABLE ${REQUIRED_TABLES.map(table => `public.${quoteIdentifier(table)}`).join(', ')}
             TO ${role}`
        );
        await client.query('COMMIT');
        return {
            roleName,
            expiresAt: expiresAt.toISOString(),
            databaseName
        };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function assertRoleAccessReport(report) {
    if (report.defaultTransactionReadOnly !== 'on') {
        throw new Error('Temporary audit role does not default to read-only');
    }
    if (report.transactionReadOnly !== 'on') {
        throw new Error('Temporary audit verification transaction is not read-only');
    }
    if (report.statementTimeoutMs !== STATEMENT_TIMEOUT_MS) {
        throw new Error(`Temporary audit statement_timeout must be ${STATEMENT_TIMEOUT_MS}ms`);
    }
    if (report.lockTimeoutMs !== LOCK_TIMEOUT_MS) {
        throw new Error(`Temporary audit lock_timeout must be ${LOCK_TIMEOUT_MS}ms`);
    }
    if (report.roleAttributes.superuser
        || report.roleAttributes.createDb
        || report.roleAttributes.createRole
        || report.roleAttributes.replication
        || report.roleAttributes.bypassRls
        || report.roleAttributes.inherit
        || !report.roleAttributes.canLogin
        || report.roleAttributes.connectionLimit !== 1
        || report.roleAttributes.memberships !== 0) {
        throw new Error('Temporary audit role has unsafe PostgreSQL role attributes or memberships');
    }
    const validUntil = Date.parse(report.roleAttributes.validUntil);
    if (!Number.isFinite(validUntil)
        || validUntil <= Date.now()
        || validUntil > Date.now() + (MAX_TTL_MINUTES + 1) * 60_000) {
        throw new Error('Temporary audit role has missing or unsafe VALID UNTIL');
    }
    if (!report.databaseConnect || report.databaseCreate || !report.schemaUsage || report.schemaCreate) {
        throw new Error('Temporary audit role has unexpected database/schema privileges');
    }
    const invalidTables = report.tables.filter(table => (
        !table.canSelect
        || table.canInsert
        || table.canUpdate
        || table.canDelete
        || table.canTruncate
        || table.selectGrantable
    ));
    if (invalidTables.length) {
        throw new Error(`Temporary audit role has invalid table privileges: ${invalidTables.map(row => row.tableName).join(', ')}`);
    }
    if (report.extraSelectableTables !== 0) {
        throw new Error(`Temporary audit role can select ${report.extraSelectableTables} non-approved public tables`);
    }
}

function parsePgDurationMs(value) {
    const text = String(value || '').trim().toLowerCase();
    if (/^\d+$/.test(text)) return Number(text);
    const match = text.match(/^(\d+(?:\.\d+)?)\s*(ms|s|min)$/);
    if (!match) return Number.NaN;
    const multipliers = { ms: 1, s: 1000, min: 60_000 };
    return Math.round(Number(match[1]) * multipliers[match[2]]);
}

async function verifyTemporaryRole(connectionString) {
    const pool = new Pool(poolConfig(connectionString, 'attendance_audit_role_preflight'));
    const client = await pool.connect();
    try {
        await client.query('BEGIN READ ONLY');
        const transaction = await client.query('SHOW transaction_read_only');
        const defaultTransaction = await client.query('SHOW default_transaction_read_only');
        const statementTimeout = await client.query('SHOW statement_timeout');
        const lockTimeout = await client.query('SHOW lock_timeout');
        const database = await client.query(
            `SELECT has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
                    has_database_privilege(current_user, current_database(), 'CREATE') AS can_create`
        );
        const schema = await client.query(
            `SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS can_use,
                    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`
        );
        const attributes = await client.query(
            `SELECT rolcanlogin,
                    rolsuper,
                    rolcreatedb,
                    rolcreaterole,
                    rolinherit,
                    rolreplication,
                    rolbypassrls,
                    rolconnlimit,
                    rolvaliduntil::text AS rolvaliduntil,
                    (
                        SELECT COUNT(*)::int
                          FROM pg_auth_members memberships
                         WHERE memberships.member = roles.oid
                    ) AS memberships
               FROM pg_roles roles
              WHERE rolname = current_user`
        );
        const tables = await client.query(
            `SELECT requested.table_name,
                    has_table_privilege(current_user, format('public.%I', requested.table_name), 'SELECT') AS can_select,
                    has_table_privilege(current_user, format('public.%I', requested.table_name), 'INSERT') AS can_insert,
                    has_table_privilege(current_user, format('public.%I', requested.table_name), 'UPDATE') AS can_update,
                    has_table_privilege(current_user, format('public.%I', requested.table_name), 'DELETE') AS can_delete,
                    has_table_privilege(current_user, format('public.%I', requested.table_name), 'TRUNCATE') AS can_truncate,
                    EXISTS (
                        SELECT 1
                          FROM information_schema.role_table_grants grants
                         WHERE grants.grantee = current_user
                           AND grants.table_schema = 'public'
                           AND grants.table_name = requested.table_name
                           AND grants.privilege_type = 'SELECT'
                           AND grants.is_grantable = 'YES'
                    ) AS select_grantable
               FROM unnest($1::text[]) AS requested(table_name)
              ORDER BY requested.table_name`,
            [REQUIRED_TABLES]
        );
        const extraTables = await client.query(
            `SELECT COUNT(*)::int AS count
               FROM information_schema.tables visible
              WHERE visible.table_schema = 'public'
                AND NOT (visible.table_name = ANY($1::text[]))
                AND has_table_privilege(
                    current_user,
                    to_regclass(format('public.%I', visible.table_name)),
                    'SELECT'
                )`,
            [REQUIRED_TABLES]
        );
        const roleRow = attributes.rows[0] || {};
        const report = {
            transactionReadOnly: transaction.rows[0]?.transaction_read_only,
            defaultTransactionReadOnly: defaultTransaction.rows[0]?.default_transaction_read_only,
            statementTimeoutMs: parsePgDurationMs(statementTimeout.rows[0]?.statement_timeout),
            lockTimeoutMs: parsePgDurationMs(lockTimeout.rows[0]?.lock_timeout),
            databaseConnect: database.rows[0]?.can_connect === true,
            databaseCreate: database.rows[0]?.can_create === true,
            schemaUsage: schema.rows[0]?.can_use === true,
            schemaCreate: schema.rows[0]?.can_create === true,
            roleAttributes: {
                canLogin: roleRow.rolcanlogin === true,
                superuser: roleRow.rolsuper === true,
                createDb: roleRow.rolcreatedb === true,
                createRole: roleRow.rolcreaterole === true,
                inherit: roleRow.rolinherit === true,
                replication: roleRow.rolreplication === true,
                bypassRls: roleRow.rolbypassrls === true,
                connectionLimit: Number(roleRow.rolconnlimit),
                memberships: Number(roleRow.memberships || 0),
                validUntil: roleRow.rolvaliduntil || null
            },
            tables: tables.rows.map(row => ({
                tableName: row.table_name,
                canSelect: row.can_select === true,
                canInsert: row.can_insert === true,
                canUpdate: row.can_update === true,
                canDelete: row.can_delete === true,
                canTruncate: row.can_truncate === true,
                selectGrantable: row.select_grantable === true
            })),
            extraSelectableTables: Number(extraTables.rows[0]?.count || 0)
        };
        assertRoleAccessReport(report);
        await client.query('ROLLBACK');
        return report;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

async function countRole(adminPool, roleName) {
    const result = await adminPool.query(
        'SELECT COUNT(*)::int AS count FROM pg_roles WHERE rolname = $1',
        [roleName]
    );
    return Number(result.rows[0]?.count || 0);
}

async function cleanupTemporaryRole(adminPool, roleName) {
    assertGeneratedRoleName(roleName);
    if (await countRole(adminPool, roleName) === 0) {
        return { roleName, alreadyAbsent: true, remainingRoles: 0, terminatedSessions: 0 };
    }

    const role = quoteIdentifier(roleName);
    const client = await adminPool.connect();
    let terminatedSessions = 0;
    try {
        await client.query(`ALTER ROLE ${role} NOLOGIN`);
        const terminated = await client.query(
            `SELECT COUNT(*) FILTER (WHERE pg_terminate_backend(pid))::int AS terminated
               FROM pg_stat_activity
              WHERE usename = $1
                AND pid <> pg_backend_pid()`,
            [roleName]
        );
        terminatedSessions = Number(terminated.rows[0]?.terminated || 0);

        await client.query('BEGIN');
        await client.query(`DROP OWNED BY ${role} RESTRICT`);
        await client.query(`DROP ROLE ${role}`);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }

    const remainingRoles = await countRole(adminPool, roleName);
    if (remainingRoles !== 0) {
        throw new Error(`Temporary attendance audit role cleanup is incomplete: ${remainingRoles} role remains`);
    }
    return { roleName, alreadyAbsent: false, remainingRoles, terminatedSessions };
}

function combineLifecycleErrors(primaryError, cleanupError) {
    if (!cleanupError) return primaryError;
    if (!primaryError) return cleanupError;
    const combined = new Error(
        `Temporary attendance audit failed and role cleanup also failed: `
        + `${primaryError.message}; cleanup: ${cleanupError.message}`
    );
    combined.cause = cleanupError;
    combined.primaryError = primaryError;
    return combined;
}

async function withTemporaryAuditRole({
    adminUrl,
    ttlMinutes = DEFAULT_TTL_MINUTES,
    roleName = generateRoleName()
}, operation) {
    if (typeof operation !== 'function') throw new Error('Temporary audit role operation callback is required');
    assertGeneratedRoleName(roleName);
    const password = generatePassword();
    const adminPool = new Pool(poolConfig(adminUrl, 'attendance_audit_role_admin'));
    let primaryError = null;
    let cleanupError = null;
    let result;
    let context = null;
    try {
        const provisioned = await provisionTemporaryRole(adminPool, {
            roleName,
            password,
            ttlMinutes
        });
        context = {
            ...provisioned,
            connectionString: buildRoleConnectionString(adminUrl, roleName, password)
        };
        await verifyTemporaryRole(context.connectionString);
        result = await operation(context);
    } catch (error) {
        primaryError = error;
    } finally {
        if (context) context.connectionString = '';
        try {
            await cleanupTemporaryRole(adminPool, roleName);
        } catch (error) {
            cleanupError = error;
        }
        await adminPool.end().catch(error => {
            if (!cleanupError) cleanupError = error;
        });
    }
    const failure = combineLifecycleErrors(primaryError, cleanupError);
    if (failure) throw failure;
    return {
        result,
        lifecycle: {
            roleName,
            expiresAt: context?.expiresAt || null,
            cleanupConfirmed: true
        }
    };
}

function buildAuditChildEnvironment(connectionString, baseEnv = process.env) {
    const env = { ...baseEnv };
    for (const name of Object.keys(env)) {
        if (/^PG/i.test(name) || CHILD_DATABASE_VARIABLES.includes(name)) delete env[name];
    }
    env.ATTENDANCE_AUDIT_DATABASE_URL = connectionString;
    return env;
}

function normalizeAuditArgs(auditArgs) {
    const normalized = [...auditArgs.map(String)];
    let categoriesFound = false;
    for (let index = 0; index < normalized.length; index += 1) {
        const arg = normalized[index];
        let categoryValue = '';
        if (arg === '--category' || arg === '--categories') {
            categoriesFound = true;
            categoryValue = String(normalized[index + 1] || '');
            index += 1;
        } else if (arg.startsWith('--category=') || arg.startsWith('--categories=')) {
            categoriesFound = true;
            categoryValue = arg.slice(arg.indexOf('=') + 1);
        }
        if (/(^|,)(inferred-profession-card|profession-card-inference)(,|$)/i.test(categoryValue)) {
            throw new Error(
                'inferred-profession-card is outside the approved temporary-role table scope'
            );
        }
    }
    if (!categoriesFound) {
        normalized.push('--categories', SAFE_AUDIT_CATEGORIES.join(','));
    }
    return normalized;
}

function runAuditChild(auditArgs, connectionString, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('Attendance audit interrupted'));
    const safeAuditArgs = normalizeAuditArgs(auditArgs);
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(process.execPath, [AUDIT_SCRIPT, ...safeAuditArgs], {
            cwd: ROOT,
            env: buildAuditChildEnvironment(connectionString),
            stdio: 'inherit',
            windowsHide: true
        });
        const settle = error => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve();
        };
        const onAbort = () => {
            if (child.exitCode === null) child.kill('SIGTERM');
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        child.once('error', settle);
        child.once('exit', (code, exitSignal) => {
            if (signal?.aborted) {
                return settle(signal.reason || new Error('Attendance audit interrupted'));
            }
            if (code === 0) return settle();
            settle(new Error(`Attendance anomaly audit failed (${exitSignal || `exit ${code}`})`));
        });
    });
}

async function recoverRole(adminUrl, roleName) {
    const adminPool = new Pool(poolConfig(adminUrl, 'attendance_audit_role_recovery'));
    try {
        return await cleanupTemporaryRole(adminPool, roleName);
    } finally {
        await adminPool.end();
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const adminUrl = loadAdminUrl();
    if (options.recoverRole) {
        const result = await recoverRole(adminUrl, options.recoverRole);
        process.stdout.write(JSON.stringify({
            mode: 'recovery',
            roleName: result.roleName,
            cleanupConfirmed: result.remainingRoles === 0,
            alreadyAbsent: result.alreadyAbsent
        }, null, 2));
        process.stdout.write('\n');
        return;
    }

    const controller = new AbortController();
    const signalHandlers = new Map();
    for (const signalName of ['SIGINT', 'SIGTERM']) {
        const handler = () => {
            if (!controller.signal.aborted) {
                controller.abort(new Error(`Attendance audit interrupted by ${signalName}; cleanup is running`));
            }
        };
        signalHandlers.set(signalName, handler);
        process.once(signalName, handler);
    }
    try {
        const completed = await withTemporaryAuditRole({
            adminUrl,
            ttlMinutes: options.ttlMinutes
        }, context => runAuditChild(options.auditArgs, context.connectionString, controller.signal));
        process.stderr.write(
            `Temporary attendance audit role lifecycle completed; cleanup confirmed for ${completed.lifecycle.roleName}\n`
        );
    } finally {
        for (const [signalName, handler] of signalHandlers) process.removeListener(signalName, handler);
    }
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`temporary attendance audit role failed: ${redactOperatorError(error)}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    ADMIN_URL_VARIABLE,
    DEFAULT_TTL_MINUTES,
    GENERATED_ROLE_PATTERN,
    LOCK_TIMEOUT_MS,
    MAX_TTL_MINUTES,
    REQUIRED_TABLES,
    ROLE_PREFIX,
    SAFE_AUDIT_CATEGORIES,
    STATEMENT_TIMEOUT_MS,
    assertGeneratedRoleName,
    assertRoleAccessReport,
    buildAuditChildEnvironment,
    buildRoleConnectionString,
    buildScramVerifier,
    cleanupTemporaryRole,
    combineLifecycleErrors,
    generatePassword,
    generateRoleName,
    loadAdminUrl,
    normalizeAuditArgs,
    parseArgs,
    poolConfig,
    provisionTemporaryRole,
    redactOperatorError,
    recoverRole,
    runAuditChild,
    usage,
    verifyTemporaryRole,
    withTemporaryAuditRole
};
