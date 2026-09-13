'use strict';

// No business queries through the operator connection. Grants only after explicit approval.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('pg');
const TABLES = Object.freeze(['organizations', 'businesses', 'organization_memberships', 'business_memberships']);
const EXPECTED_TARGET = '6fb86cf6959f026d7c55b6c65edffc3499e5bb581d51840a730f915fef0e9cfd';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ident = value => '"' + String(value).replace(/"/g, '""') + '"';
const target = value => { const u = new URL(value); return hash(`${u.hostname}:${u.port}${u.pathname}`); };

async function plan(client, role) {
    const flags = (await client.query(`SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls
        FROM pg_roles WHERE rolname=$1`, [role])).rows;
    if (flags.length !== 1 || Object.values(flags[0]).some(Boolean)) throw Error('UNSAFE_AUDIT_ROLE');
    const memberships = (await client.query(`SELECT count(*)::int AS n FROM pg_roles
        WHERE rolname<>$1 AND pg_has_role($1,oid,'MEMBER')`, [role])).rows[0].n;
    if (memberships !== 0) throw Error('INHERITED_ROLE_NOT_ALLOWED');
    const rows = (await client.query(`SELECT c.relname AS name, c.oid::text AS oid,
        coalesce(c.relacl,acldefault('r',c.relowner))::text AS acl, c.relowner::text AS owner,
        has_table_privilege($1,c.oid,'SELECT') AS readable,
        has_any_column_privilege($1,c.oid,'SELECT') AS column_readable,
        has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') AS writable
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY($2::text[]) ORDER BY c.relname`, [role, TABLES])).rows;
    if (rows.length !== TABLES.length || rows.some(row => row.writable || (!row.readable && row.column_readable))) {
        throw Error('GRANT_SCOPE_UNSAFE_OR_MISSING');
    }
    return { roleHash: hash(role), rows, fingerprint: hash(JSON.stringify(rows)),
        added: rows.filter(row => !row.readable).map(row => row.name) };
}

async function apply(client, role, expected, persist) {
    await client.query('BEGIN');
    try {
        await client.query("SET LOCAL lock_timeout='2s'");
        await client.query("SET LOCAL statement_timeout='10s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('sys-mb-audit-read-lease'))");
        const current = await plan(client, role);
        if (current.fingerprint !== expected.fingerprint || current.roleHash !== expected.roleHash) throw Error('GRANT_STATE_DRIFT');
        // Persist the planned retirement set before COMMIT, including a crash-recovery receipt.
        persist({ ...current, state: 'PREPARED', createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 60000).toISOString() });
        for (const table of current.added) await client.query(`GRANT SELECT ON TABLE public.${ident(table)} TO ${ident(role)}`);
        const after = await plan(client, role);
        const receipt = { ...current, state: 'COMMIT_PENDING', afterFingerprint: after.fingerprint,
            afterRows: after.rows, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60000).toISOString() };
        persist(receipt);
        await client.query('COMMIT');
        return receipt;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}

async function retire(client, role, receipt) {
    if (hash(role) !== receipt.roleHash || receipt.added.some(name => !TABLES.includes(name))) throw Error('INVALID_RECEIPT');
    await client.query('BEGIN');
    try {
        await client.query("SET LOCAL lock_timeout='2s'");
        await client.query("SET LOCAL statement_timeout='10s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('sys-mb-audit-read-lease'))");
        const current = await plan(client, role);
        if (current.fingerprint === receipt.fingerprint) { await client.query('ROLLBACK'); return 'ALREADY_RETIRED'; }
        if (current.fingerprint !== receipt.afterFingerprint) throw Error('RETIREMENT_ACL_DRIFT_MANUAL_REVIEW');
        for (const table of receipt.added) await client.query(`REVOKE SELECT ON TABLE public.${ident(table)} FROM ${ident(role)}`);
        const restored = await plan(client, role);
        // PostgreSQL may serialize a former NULL ACL as explicit owner defaults after REVOKE.
        if (restored.rows.some(row => row.readable !== receipt.rows.find(before => before.name === row.name).readable)) {
            throw Error('RETIREMENT_PRIVILEGE_MISMATCH');
        }
        await client.query('COMMIT');
        return 'RETIRED';
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}

async function main() {
    const mode = process.argv[2] || 'plan';
    if (!['plan', 'apply', 'retire'].includes(mode)) throw Error('INVALID_MODE');
    const source = process.env.TASK_AI_ROLLOUT_DATABASE_URL;
    const operator = process.env.TRUSTED_QA_OPERATOR_DATABASE_URL;
    if (!source || !operator || target(source) !== EXPECTED_TARGET || target(operator) !== EXPECTED_TARGET) throw Error('WRONG_TARGET');
    const role = decodeURIComponent(new URL(source).username);
    const receiptPath = process.env.SYS_MB_AUDIT_LEASE_RECEIPT;
    if (mode !== 'plan' && (!process.env.SYS_MB_AUDIT_GRANT_APPROVAL_REF || !receiptPath
        || process.env.SYS_MB_PRIVATE_ACL_VERIFIED !== '1')) throw Error('EXPLICIT_APPROVAL_AND_PRIVATE_RECEIPT_REQUIRED');
    const client = new Client({ connectionString: mode === 'plan' ? source : operator,
        connectionTimeoutMillis: 8000, query_timeout: 15000, statement_timeout: 10000 });
    try {
        await client.connect();
        if (mode === 'plan') {
            await client.query('BEGIN READ ONLY');
            const draft = await plan(client, role);
            await client.query('ROLLBACK');
            console.log(JSON.stringify({ mode, targetHash: EXPECTED_TARGET, roleHash: draft.roleHash,
                fingerprint: draft.fingerprint, tables: draft.added, ttlMinutes: 30, productionWrites: 0 }));
        } else if (mode === 'apply') {
            if (fs.existsSync(receiptPath)) throw Error('EXISTING_RECEIPT_REVIEW_REQUIRED');
            const expected = await plan(client, role);
            if (expected.fingerprint !== process.env.SYS_MB_AUDIT_EXPECTED_FINGERPRINT
                || expected.roleHash !== process.env.SYS_MB_AUDIT_EXPECTED_ROLE_HASH) throw Error('APPROVED_PLAN_DRIFT');
            await apply(client, role, expected, receipt => fs.writeFileSync(receiptPath,
                JSON.stringify({ ...receipt, targetHash: EXPECTED_TARGET,
                    approvalRef: process.env.SYS_MB_AUDIT_GRANT_APPROVAL_REF }, null, 2), { mode: 0o600 }));
            console.log('READ_LEASE_APPLIED_RETIRE_WITHIN_30_MINUTES');
        } else {
            const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
            if (receipt.targetHash !== EXPECTED_TARGET) throw Error('RECEIPT_TARGET_MISMATCH');
            console.log(await retire(client, role, receipt));
        }
    } finally { await client.end().catch(() => {}); }
}
module.exports = { plan, apply, retire, TABLES, target };
if (require.main === module) main().catch(error => {
    const safe = ['GRANT_STATE_DRIFT', 'APPROVED_PLAN_DRIFT', 'EXISTING_RECEIPT_REVIEW_REQUIRED',
        'RETIREMENT_ACL_DRIFT_MANUAL_REVIEW', 'EXPLICIT_APPROVAL_AND_PRIVATE_RECEIPT_REQUIRED', 'WRONG_TARGET'];
    console.error(safe.includes(error.message) ? error.message : 'READ_LEASE_FAILED_NO_SENSITIVE_DETAILS'); process.exitCode = 1;
});
