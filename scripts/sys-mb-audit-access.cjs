'use strict';

// Read catalog metadata only. Never query operational rows through these URLs.
const { Client } = require('pg');
const crypto = require('node:crypto');
const SOURCES = ['MULTIBUSINESS_AUDIT_DATABASE_URL', 'TASK_AI_ROLLOUT_DATABASE_URL', 'TRUSTED_QA_OPERATOR_DATABASE_URL'];

async function inspect(client) {
    await client.query('BEGIN READ ONLY');
    try {
        await client.query("SET LOCAL statement_timeout='8s'");
        await client.query("SET LOCAL lock_timeout='1s'");
        const role = (await client.query(`SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls,
          (SELECT count(*)::int FROM pg_roles r WHERE r.oid<>me.oid AND pg_has_role(me.oid,r.oid,'MEMBER')) AS memberships,
          has_database_privilege(current_database(),'CREATE') AS database_create,
          has_database_privilege(current_database(),'TEMP') AS database_temp,
          has_schema_privilege('public','CREATE') AS schema_create
          FROM pg_roles me WHERE rolname=current_user`)).rows[0];
        const relations = (await client.query(`SELECT count(*)::int AS tables,
          count(*) FILTER (WHERE has_table_privilege(c.oid,'SELECT'))::int AS readable,
          count(*) FILTER (WHERE has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES')
            OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES'))::int AS writable,
          count(*) FILTER (WHERE pg_has_role(c.relowner,'USAGE'))::int AS owned,
          count(*) FILTER (WHERE c.relrowsecurity)::int AS rls
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')`)).rows[0];
        const functions = (await client.query(`SELECT count(*)::int AS executable_user_functions,
          count(*) FILTER (WHERE p.prosecdef)::int AS security_definer,
          count(*) FILTER (WHERE p.provolatile='v')::int AS volatile
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND has_function_privilege(p.oid,'EXECUTE')`)).rows[0];
        return { role, relations, functions,
            candidateForReview: !role.rolsuper && !role.rolcreaterole && !role.rolcreatedb
                && !role.rolreplication && !role.rolbypassrls && !role.database_create && !role.schema_create
                && relations.writable === 0 && relations.owned === 0 && functions.security_definer === 0,
            operationalRowsRead: 0, productionWrites: 0 };
    } finally { await client.query('ROLLBACK'); }
}

async function main() {
    for (const source of SOURCES) {
        const connectionString = process.env[source];
        if (!connectionString) { console.log(JSON.stringify({ source, present: false })); continue; }
        let client;
        try {
            const url = new URL(connectionString);
            const endpointHash = crypto.createHash('sha256').update(`${url.hostname}:${url.port}${url.pathname}`).digest('hex');
            client = new Client({ connectionString, connectionTimeoutMillis: 8000,
                statement_timeout: 8000, query_timeout: 10000, application_name: 'sys-mb-access-metadata-probe' });
            await client.connect();
            console.log(JSON.stringify({ source, present: true, endpointHash, ...await inspect(client) }));
        } catch (error) {
            console.log(JSON.stringify({ source, present: true, status: 'PROBE_FAILED',
                code: /^[A-Z0-9_]{3,40}$/.test(error.code || '') ? error.code : 'CONNECTION_OR_QUERY_FAILED' }));
        } finally { await client?.end().catch(() => {}); }
    }
}

module.exports = { inspect };
if (require.main === module) main().catch(() => { console.error('ACCESS_PROBE_FAILED'); process.exitCode = 1; });
