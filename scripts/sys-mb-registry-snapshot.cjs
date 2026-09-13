'use strict';

// Read-only companion to the separately approved, hash-bound SELECT lease.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { inspect } = require('./sys-mb-audit-access.cjs');
const { livePolicy, collect } = require('./sys-mb-recovery-draft.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function snapshot(client) {
    const projections = {
        organizations: 'id,slug,name,status,created_by_user_id,created_at,updated_at',
        businesses: 'id,organization_id,context_key,label,short_label,status,access_mode,modules,created_by_user_id,created_at,updated_at',
        organization_memberships: 'organization_id,user_id,role,is_active,created_by_user_id,created_at,updated_at',
        business_memberships: 'business_id,organization_id,user_id,role,extra_roles,page_allowlist,page_denylist,action_allowlist,action_denylist,is_default,is_active,created_by_user_id,created_at,updated_at'
    };
    const result = { generatedAt: new Date().toISOString(), readOnly: true };
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
        await client.query("SET LOCAL statement_timeout='10s'");
        await client.query("SET LOCAL lock_timeout='1s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
        for (const [table, columns] of Object.entries(projections)) {
            const rows = (await client.query(`SELECT ${columns} FROM public.${table} LIMIT 10001`)).rows;
            if (rows.length > 10000 || Buffer.byteLength(JSON.stringify(rows)) > 8388608) throw Error('SNAPSHOT_BUDGET_EXCEEDED');
            result[table] = rows;
        }
        const ids = [...new Set([...result.organization_memberships, ...result.business_memberships].map(row => row.user_id))];
        result.users = (await client.query(`SELECT id,name,role,extra_roles,page_allowlist,page_denylist,
            action_allowlist,action_denylist,business_contexts,default_business_context,is_active
            FROM public.users WHERE id=ANY($1::int[]) ORDER BY id LIMIT 10001`, [ids])).rows;
        if (result.users.length > 10000 || Buffer.byteLength(JSON.stringify(result.users)) > 8388608) throw Error('USER_BUDGET_EXCEEDED');
        // Settings values and public URLs may carry credentials; collect keys/types only.
        result.settings = (await client.query(`SELECT key,jsonb_typeof(to_jsonb(value)) AS value_type
            FROM public.settings WHERE key ~ '^(business_cabinet:|timeline_display:|timeline_resources:)'
            ORDER BY key LIMIT 1001`)).rows;
        if (result.settings.length > 1000) throw Error('SETTINGS_BUDGET_EXCEEDED');
        return result;
    } finally { await client.query('ROLLBACK'); }
}

async function main() {
    const dir = process.env.SYS_MB_PRIVATE_DIRECTORY;
    const base = path.resolve(process.env.USERPROFILE || '', '.eventgenix');
    if (!dir || !path.resolve(dir).startsWith(base + path.sep) || fs.lstatSync(dir).isSymbolicLink()
        || process.env.SYS_MB_PRIVATE_ACL_VERIFIED !== '1') throw Error('PRIVATE_DIRECTORY_REQUIRED');
    const connectionString = process.env.MULTIBUSINESS_AUDIT_DATABASE_URL;
    if (!connectionString) throw Error('AUDIT_SOURCE_REQUIRED');
    const client = new Client({ connectionString, connectionTimeoutMillis: 8000, statement_timeout: 10000, query_timeout: 15000 });
    try {
        await client.connect();
        const privileges = await inspect(client);
        if (!privileges.candidateForReview) throw Error('READ_ONLY_ROLE_REQUIRED');
        const registry = await snapshot(client);
        const { policy, hash: policyHash } = livePolicy(process.env.SYS_MB_SOURCE_COMMIT);
        const draft = await collect(client, policy, process.env.SYS_MB_SOURCE_COMMIT, policyHash);
        const data = { ...registry, sourceCommit: process.env.SYS_MB_SOURCE_COMMIT, privileges, draft };
        const serialized = JSON.stringify(data, null, 2) + '\n';
        fs.writeFileSync(path.join(dir, 'registry-snapshot.json'), serialized, { flag: 'wx', mode: 0o600 });
        console.log(JSON.stringify({ status: 'COLLECTED_READ_ONLY', generatedAt: registry.generatedAt,
            sourceCommit: data.sourceCommit, snapshotHash: hash(serialized),
            counts: Object.fromEntries(Object.keys(projectionsForSummary()).map(key => [key,registry[key].length])),
            settings: registry.settings.length, writableTables: privileges.relations.writable }));
    } finally { await client.end().catch(() => {}); }
}
function projectionsForSummary() { return { organizations: 1, businesses: 1, organization_memberships: 1, business_memberships: 1, users: 1 }; }
module.exports = { snapshot };
if (require.main === module) main().catch(error => { console.error(JSON.stringify({ status: 'REGISTRY_SNAPSHOT_FAILED', code: /^[0-9A-Z_]+$/.test(error.code || '') ? error.code : 'COLLECTION_FAILED' })); process.exitCode = 1; });
