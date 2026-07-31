#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const {
    READ_ONLY_CONNECTION_ENV_KEY,
    runAudit
} = require('./audit-legacy-task-data-read-only');

const ADMIN_CONNECTION_ENV_KEY = 'DATABASE_URL';
const ROLE_NAME = 'eventgenix_audit_ro';
const ROLE_IDENTIFIER = '"eventgenix_audit_ro"';
const USER_ENVIRONMENT_SCOPE = 'User';

function usage() {
    return [
        'Usage:',
        '  railway run --service <app-service> -- node scripts/provision-task-audit-readonly-role.js --preflight',
        '  railway run --service <app-service> -- node scripts/provision-task-audit-readonly-role.js --provision --persist-user-env',
        '',
        'Safety:',
        `  --provision creates only ${ROLE_NAME} with CONNECT, USAGE, and SELECT privileges.`,
        `  --persist-user-env stores ${READ_ONLY_CONNECTION_ENV_KEY} in the current Windows user environment without printing it.`
    ].join('\n');
}

function safeErrorCode(error) {
    return error?.code && /^TASK_AUDIT_ROLE_[A-Z_]+$/.test(error.code)
        ? error.code
        : error?.code && /^(?:[0-9A-Z]{5}|E[A-Z_]+)$/.test(error.code)
            ? `TASK_AUDIT_ROLE_DATABASE_${error.code}`
            : 'TASK_AUDIT_ROLE_PROVISION_FAILED';
}

function taskError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function parseArgs(argv = []) {
    let mode = 'help';
    let persistUserEnvironment = false;
    let recoverExistingRole = false;
    for (const arg of argv) {
        if (arg === '--help' || arg === '-h') continue;
        if (arg === '--preflight') {
            if (mode !== 'help') throw taskError('TASK_AUDIT_ROLE_ARGUMENT_INVALID', 'Choose one mode');
            mode = 'preflight';
            continue;
        }
        if (arg === '--provision') {
            if (mode !== 'help') throw taskError('TASK_AUDIT_ROLE_ARGUMENT_INVALID', 'Choose one mode');
            mode = 'provision';
            continue;
        }
        if (arg === '--persist-user-env') {
            persistUserEnvironment = true;
            continue;
        }
        if (arg === '--recover-existing-role') {
            recoverExistingRole = true;
            continue;
        }
        throw taskError('TASK_AUDIT_ROLE_ARGUMENT_INVALID', `Unsupported option: ${arg}`);
    }
    if ((persistUserEnvironment || recoverExistingRole) && mode !== 'provision') {
        throw taskError('TASK_AUDIT_ROLE_ARGUMENT_INVALID', 'Recovery and persistence require --provision');
    }
    return { mode, persistUserEnvironment, recoverExistingRole };
}

function resolveAdminConnectionString(env = process.env) {
    const connectionString = String(env[ADMIN_CONNECTION_ENV_KEY] || '').trim();
    if (!connectionString) {
        throw taskError('TASK_AUDIT_ROLE_ADMIN_DATABASE_REQUIRED', `${ADMIN_CONNECTION_ENV_KEY} is required`);
    }
    return connectionString;
}

function buildReadOnlyConnectionString(adminConnectionString, password) {
    const url = new URL(adminConnectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        throw taskError('TASK_AUDIT_ROLE_ADMIN_DATABASE_INVALID', 'Admin database URL must use PostgreSQL');
    }
    url.username = ROLE_NAME;
    url.password = password;
    return url.toString();
}

function buildProvisioningStatements(databaseIdentifier, passwordLiteral) {
    return [
        `CREATE ROLE ${ROLE_IDENTIFIER} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD ${passwordLiteral}`,
        `REVOKE ALL PRIVILEGES ON DATABASE ${databaseIdentifier} FROM ${ROLE_IDENTIFIER}`,
        `GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${ROLE_IDENTIFIER}`,
        `REVOKE CREATE ON SCHEMA public FROM ${ROLE_IDENTIFIER}`,
        `GRANT USAGE ON SCHEMA public TO ${ROLE_IDENTIFIER}`,
        `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${ROLE_IDENTIFIER}`,
        `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE_IDENTIFIER}`,
        `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE_IDENTIFIER}`
    ];
}

async function loadPreflight(client) {
    const result = await client.query(`
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists,
               EXISTS (
                   SELECT 1
                   FROM pg_roles
                   WHERE rolname = current_user
                     AND (rolsuper OR rolcreaterole)
               ) AS can_create_role,
               EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') AS public_schema_exists,
               COUNT(*) FILTER (WHERE n.nspname = 'public')::int AS public_table_count,
               MAX(quote_ident(current_database())) AS database_identifier
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    `, [ROLE_NAME]);
    const row = result.rows[0] || {};
    return {
        roleExists: row.role_exists === true,
        canCreateRole: row.can_create_role === true,
        publicSchemaExists: row.public_schema_exists === true,
        publicTableCount: Number(row.public_table_count || 0),
        databaseIdentifier: row.database_identifier
    };
}

async function verifyRolePolicy(client) {
    const result = await client.query(`
        WITH role_attributes AS (
            SELECT r.oid,
                   r.rolcanlogin AS can_login,
                   r.rolsuper AS is_superuser,
                   r.rolcreaterole AS can_create_role,
                   r.rolcreatedb AS can_create_database,
                   r.rolreplication AS can_replicate,
                   r.rolbypassrls AS bypasses_rls
            FROM pg_roles r
            WHERE r.rolname = $1
        ),
        public_table_policy AS (
            SELECT COUNT(*)::int AS public_table_count,
                   COUNT(*) FILTER (
                       WHERE has_table_privilege($1, c.oid, 'SELECT')
                   )::int AS selectable_public_table_count,
                   COUNT(*) FILTER (
                       WHERE has_table_privilege($1, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                   )::int AS writable_public_table_count
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        )
        SELECT r.can_login,
               r.is_superuser,
               r.can_create_role,
               r.can_create_database,
               r.can_replicate,
               r.bypasses_rls,
               NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS has_no_memberships,
               has_database_privilege($1, current_database(), 'CONNECT') AS can_connect,
               has_schema_privilege($1, 'public', 'USAGE') AS can_use_public_schema,
               has_schema_privilege($1, 'public', 'CREATE') AS can_create_in_public_schema,
               p.public_table_count,
               p.selectable_public_table_count,
               p.writable_public_table_count
        FROM role_attributes r
        CROSS JOIN public_table_policy p
    `, [ROLE_NAME])
    const row = result.rows[0]
    if (!row) throw taskError('TASK_AUDIT_ROLE_VALIDATION_FAILED', 'Role was not found after provisioning')
    const policy = {
        canLogin: row.can_login === true,
        isSuperuser: row.is_superuser === true,
        canCreateRole: row.can_create_role === true,
        canCreateDatabase: row.can_create_database === true,
        canReplicate: row.can_replicate === true,
        bypassesRls: row.bypasses_rls === true,
        hasNoMemberships: row.has_no_memberships === true,
        canConnect: row.can_connect === true,
        canUsePublicSchema: row.can_use_public_schema === true,
        canCreateInPublicSchema: row.can_create_in_public_schema === true,
        publicTableCount: Number(row.public_table_count || 0),
        selectablePublicTableCount: Number(row.selectable_public_table_count || 0),
        writablePublicTableCount: Number(row.writable_public_table_count || 0)
    }
    const valid = policy.canLogin
        && !policy.isSuperuser
        && !policy.canCreateRole
        && !policy.canCreateDatabase
        && !policy.canReplicate
        && !policy.bypassesRls
        && policy.hasNoMemberships
        && policy.canConnect
        && policy.canUsePublicSchema
        && !policy.canCreateInPublicSchema
        && policy.selectablePublicTableCount === policy.publicTableCount
        && policy.writablePublicTableCount === 0
    if (!valid) throw taskError('TASK_AUDIT_ROLE_VALIDATION_FAILED', 'Read-only role policy validation failed')
    return policy
}

async function verifyReadOnlyTransaction(connectionString, PoolCtor = Pool) {
    const pool = new PoolCtor({
        connectionString,
        ssl: { rejectUnauthorized: false },
        application_name: 'task_audit_role_verification'
    });
    let client;
    let transactionOpen = false;
    try {
        client = await pool.connect();
        await client.query('BEGIN READ ONLY');
        transactionOpen = true;
        const result = await client.query('SHOW transaction_read_only');
        if (result.rows[0]?.transaction_read_only !== 'on') {
            throw taskError('TASK_AUDIT_ROLE_READ_ONLY_VALIDATION_FAILED', 'Read-only transaction was not enabled');
        }
    } finally {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        client?.release();
        await pool.end();
    }
}

function persistReadOnlyConnectionForCurrentUser(connectionString, dependencies = {}) {
    const spawn = dependencies.spawnSync || spawnSync;
    if (process.platform !== 'win32') {
        throw taskError('TASK_AUDIT_ROLE_USER_ENVIRONMENT_UNSUPPORTED', 'Persisting the local read-only URL requires Windows');
    }
    const result = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Environment]::SetEnvironmentVariable('${READ_ONLY_CONNECTION_ENV_KEY}', [Console]::In.ReadToEnd(), '${USER_ENVIRONMENT_SCOPE}')`
    ], {
        input: connectionString,
        encoding: 'utf8',
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true
    });
    if (result.error || result.status !== 0) {
        throw taskError('TASK_AUDIT_ROLE_USER_ENVIRONMENT_FAILED', 'Could not persist the local read-only connection');
    }
}

async function provision(options, dependencies = {}) {
    const PoolCtor = dependencies.Pool || Pool;
    const randomBytes = dependencies.randomBytes || crypto.randomBytes;
    const env = dependencies.env || process.env;
    const adminConnectionString = resolveAdminConnectionString(env);
    const pool = new PoolCtor({
        connectionString: adminConnectionString,
        ssl: { rejectUnauthorized: false },
        application_name: 'task_audit_role_provisioning'
    });
    let client;
    let transactionOpen = false;
    let readOnlyConnectionString;
    try {
        client = await pool.connect();
        const preflight = await loadPreflight(client);
        if (preflight.roleExists && !options.recoverExistingRole) {
            throw taskError('TASK_AUDIT_ROLE_ALREADY_EXISTS', 'Read-only role already exists; password rotation is intentionally not automatic');
        }
        if (!preflight.canCreateRole) throw taskError('TASK_AUDIT_ROLE_CREATE_PRIVILEGE_REQUIRED', 'Current role cannot create PostgreSQL roles');
        if (!preflight.publicSchemaExists || !preflight.databaseIdentifier) throw taskError('TASK_AUDIT_ROLE_PUBLIC_SCHEMA_REQUIRED', 'Public schema is required');
        if (preflight.roleExists) await verifyRolePolicy(client);

        const password = randomBytes(32).toString('base64url');
        readOnlyConnectionString = buildReadOnlyConnectionString(adminConnectionString, password);
        const passwordResult = await client.query('SELECT quote_literal($1) AS password_literal', [password]);
        const passwordLiteral = passwordResult.rows[0]?.password_literal;
        if (!passwordLiteral) throw taskError('TASK_AUDIT_ROLE_PASSWORD_LITERAL_FAILED', 'Could not prepare password safely');

        await client.query('BEGIN');
        transactionOpen = true;
        if (preflight.roleExists) {
            await client.query(`ALTER ROLE ${ROLE_IDENTIFIER} PASSWORD ${passwordLiteral}`);
        } else {
            for (const statement of buildProvisioningStatements(preflight.databaseIdentifier, passwordLiteral)) {
                await client.query(statement);
            }
        }
        await client.query('COMMIT');
        transactionOpen = false;

        const policy = await verifyRolePolicy(client);
        await verifyReadOnlyTransaction(readOnlyConnectionString, PoolCtor);
        if (options.persistUserEnvironment) persistReadOnlyConnectionForCurrentUser(readOnlyConnectionString, dependencies);
        const auditRules = await runAudit({}, {
            Pool: PoolCtor,
            env: { ...env, [READ_ONLY_CONNECTION_ENV_KEY]: readOnlyConnectionString }
        });
        return {
            role: ROLE_NAME,
            recoveredExistingRole: preflight.roleExists,
            persistedUserEnvironment: options.persistUserEnvironment,
            policy,
            auditRules
        };
    } finally {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        client?.release();
        await pool.end();
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.mode === 'help') {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    if (options.mode === 'preflight') {
        const pool = new Pool({
            connectionString: resolveAdminConnectionString(),
            ssl: { rejectUnauthorized: false },
            application_name: 'task_audit_role_preflight'
        });
        try {
            const client = await pool.connect();
            try {
                const preflight = await loadPreflight(client);
                process.stdout.write(`${JSON.stringify({
                    roleExists: preflight.roleExists,
                    canCreateRole: preflight.canCreateRole,
                    publicSchemaExists: preflight.publicSchemaExists,
                    publicTableCount: preflight.publicTableCount
                })}\n`);
            } finally {
                client.release();
            }
        } finally {
            await pool.end();
        }
        return;
    }
    const result = await provision(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Task audit role provisioning failed: ${safeErrorCode(error)}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    ADMIN_CONNECTION_ENV_KEY,
    READ_ONLY_CONNECTION_ENV_KEY,
    ROLE_NAME,
    buildProvisioningStatements,
    buildReadOnlyConnectionString,
    parseArgs,
    persistReadOnlyConnectionForCurrentUser,
    provision,
    resolveAdminConnectionString,
    safeErrorCode,
    verifyReadOnlyTransaction
};
