#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const {
    ROLE_NAME,
    parseArgs,
    provision,
    safeErrorCode
} = require('./provision-task-audit-readonly-role');

const REQUIRED_PROXY_ENVIRONMENT_KEYS = [
    'RAILWAY_TCP_PROXY_DOMAIN',
    'RAILWAY_TCP_PROXY_PORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD'
];

function taskError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function resolveRailwayProxyConnectionString(env = process.env) {
    for (const key of REQUIRED_PROXY_ENVIRONMENT_KEYS) {
        if (!String(env[key] || '').trim()) {
            throw taskError('TASK_AUDIT_ROLE_RAILWAY_PROXY_REQUIRED', `${key} is required`);
        }
    }
    const url = new URL('postgresql://railway-proxy.invalid');
    url.username = env.PGUSER;
    url.password = env.PGPASSWORD;
    url.hostname = env.RAILWAY_TCP_PROXY_DOMAIN;
    url.port = env.RAILWAY_TCP_PROXY_PORT;
    url.pathname = `/${encodeURIComponent(env.PGDATABASE)}`;
    return url.toString();
}

async function preflight(connectionString, PoolCtor = Pool) {
    const pool = new PoolCtor({
        connectionString,
        ssl: { rejectUnauthorized: false },
        application_name: 'task_audit_role_railway_proxy_preflight'
    });
    try {
        const result = await pool.query(`
            SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS role_exists,
                   EXISTS (
                       SELECT 1
                       FROM pg_roles
                       WHERE rolname = current_user
                         AND (rolsuper OR rolcreaterole)
                   ) AS can_create_role,
                   EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') AS public_schema_exists,
                   COUNT(*) FILTER (WHERE n.nspname = 'public')::int AS public_table_count
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
        `, [ROLE_NAME]);
        const row = result.rows[0] || {};
        return {
            roleExists: row.role_exists === true,
            canCreateRole: row.can_create_role === true,
            publicSchemaExists: row.public_schema_exists === true,
            publicTableCount: Number(row.public_table_count || 0)
        };
    } finally {
        await pool.end();
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.mode === 'help') {
        process.stdout.write('Usage: railway run --service Postgres -- node scripts/run-task-audit-readonly-role-via-railway-proxy.js --preflight|--provision [--recover-existing-role] --persist-user-env\n');
        return;
    }
    const connectionString = resolveRailwayProxyConnectionString();
    if (options.mode === 'preflight') {
        process.stdout.write(`${JSON.stringify(await preflight(connectionString))}\n`);
        return;
    }
    const result = await provision(options, {
        env: { ...process.env, DATABASE_URL: connectionString }
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Task audit role Railway proxy failed: ${safeErrorCode(error)}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    REQUIRED_PROXY_ENVIRONMENT_KEYS,
    preflight,
    resolveRailwayProxyConnectionString
};
