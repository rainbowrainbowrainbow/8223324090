#!/usr/bin/env node
'use strict';

// Operator library only. No connection, credential lookup or apply CLI is provided.
// A separately reviewed maintenance adapter and exact human authorization are required.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TABLES, ORDER, preparePlan, verifyInventory, digest } = require('./prepare-park-hr-ownership-backfill.cjs');
// Same stable namespace as backupSchemaLock; a focused test guards this mirror.
const SCHEMA_LOCK_CLASS_ID = 1_162_958_408;
const SCHEMA_LOCK_OBJECT_ID = 2;
const VERSION = '387_hr_park_tenant_ownership_foundation';
const migrationSql = fs.readFileSync(path.join(__dirname, '../db/migrations/' + VERSION + '.sql'), 'utf8');
const migrationHash = crypto.createHash('sha256').update(migrationSql).digest('hex');
const id = name => '"' + name + '"'; // callers use only the fixed TABLES/ORDER constants
function requireValue(value, code) { if (!value) { const error = new Error(code); error.code = code; throw error; } }
function normalizePlan(input) {
    const plan = preparePlan({ atUtc: input.inventoryAtUtc, tables: input.tables }, input.owner);
    const allowed = new Set(['id', 'key', 'profession_id', 'profession_key', 'staff_id', 'checklist_item_id', 'template_id', 'structure_node_id', 'is_active']);
    for (const entry of Object.values(plan.tables)) requireValue(entry.columns.every(c => allowed.has(c)) && new Set(entry.columns).size === entry.columns.length, 'STRUCTURAL_PLAN_REQUIRED');
    return plan;
}
function validateContext(plan, context) {
    requireValue(context && /^[a-f0-9]{64}$/.test(context.databaseFingerprint || ''), 'DATABASE_FINGERPRINT_REQUIRED');
    requireValue(context.planHash === digest(plan) && context.migrationHash === migrationHash, 'REVIEWED_MANIFEST_MISMATCH');
    requireValue(/^[a-f0-9]{64}$/.test(context.foundationFingerprint || '') && /^[a-f0-9]{64}$/.test(context.auditProofHash || ''), 'SCHEMA_AND_AUDIT_PROOF_REQUIRED');
    requireValue(/^[a-f0-9]{40}$/.test(context.liveSha || '') && /^[a-f0-9]{40}$/.test(context.releaseSha || ''), 'RELEASE_IDENTITY_REQUIRED');
    requireValue(typeof context.approvalRef === 'string' && context.approvalRef.length > 0 && context.approvalRef.length < 160, 'EXPLICIT_APPROVAL_REQUIRED');
    const issued = Date.parse(context.issuedAtUtc), expires = Date.parse(context.expiresAtUtc);
    requireValue(Number.isFinite(issued) && issued <= Date.now() && expires > Date.now() && expires - issued <= 6 * 3600000, 'AUTHORIZATION_EXPIRED_OR_UNBOUNDED');
    requireValue(typeof context.assertWritersStopped === 'function', 'VERIFIED_WRITER_HANDOFF_REQUIRED');
}
async function assertStopped(context, db) {
    requireValue(Date.now() < Date.parse(context.expiresAtUtc), 'AUTHORIZATION_EXPIRED_OR_UNBOUNDED');
    let timer;
    try {
        const proof = await Promise.race([context.assertWritersStopped(db), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('WRITER_CHECK_TIMEOUT'), { code: 'WRITER_CHECK_TIMEOUT' })), 18000); })]);
        requireValue(proof && proof.mode === 'SERVICE_STOPPED' && proof.allWritersStopped === true && proof.liveSha === context.liveSha && /^[a-f0-9]{64}$/.test(proof.evidenceHash || ''), 'WRITER_HANDOFF_NOT_CONFIRMED');
        if (db) requireValue(proof.otherWritableSessions === 0, 'OTHER_OWNERSHIP_WRITERS_CONNECTED');
        const observed = Date.parse(proof.observedAtUtc);
        requireValue(Number.isFinite(observed) && observed <= Date.now() && Date.now() - observed <= 60000, 'WRITER_PROOF_STALE');
        return { evidenceHash: proof.evidenceHash, observedAtUtc: proof.observedAtUtc, mode: proof.mode };
    } finally { clearTimeout(timer); }
}
async function databaseFingerprint(db) {
    const row = (await db.query('SELECT current_database() AS name,inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0];
    return digest(row);
}
async function foundationState(db) {
    const recorded = (await db.query('SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version=$1) AS recorded', [VERSION])).rows[0].recorded;
    const count = (await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) AND column_name IN ('business_id','organization_id')", [TABLES])).rows[0].n;
    requireValue((recorded && count === 12) || (!recorded && count === 0), 'FOUNDATION_LEDGER_MISMATCH');
    return { recorded, ownerColumns: count };
}
async function foundationFingerprint(db) {
    const rows = (await db.query(`SELECT kind,name,definition FROM (
        SELECT 'constraint' AS kind,c.relname||'.'||k.conname AS name,pg_get_constraintdef(k.oid,true) AS definition
        FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND (k.conname LIKE 'hr_owner_%' OR k.conname LIKE 'fk_hr_%_owner')
        UNION ALL SELECT 'index',i.relname,pg_get_indexdef(i.oid)||':'||x.indisvalid::text||':'||x.indisready::text FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=ANY($1::text[]) AND (i.relname LIKE 'idx_hr_owner_%' OR i.relname IN ('uq_hr_professions_id_owner','uq_hr_professions_key_owner','uq_hr_checklist_item_owner','uq_hr_onboarding_template_owner'))
        UNION ALL SELECT 'column',c.relname||'.'||a.attname,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND a.attname IN ('business_id','organization_id') AND NOT a.attisdropped
        UNION ALL SELECT 'view',c.relname,pg_get_viewdef(c.oid,true) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hr_owned' AND c.relname=ANY($1::text[]) AND c.relkind='v'
        UNION ALL SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('eventgenix_hr_validate_owner','eventgenix_hr_park_business_id','eventgenix_hr_park_organization_id')
        UNION ALL SELECT 'trigger',c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid,true) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND t.tgname='hr_validate_owner'
    ) objects ORDER BY kind,name,definition`, [TABLES])).rows;
    requireValue(rows.filter(r => r.kind === 'column').length === 12 && rows.filter(r => r.kind === 'index').length === 10 && rows.filter(r => r.kind === 'view').length === 6 && rows.filter(r => r.kind === 'function').length === 3 && rows.filter(r => r.kind === 'trigger').length === 6, 'FOUNDATION_OBJECTS_MISSING');
    return digest(rows);
}
async function snapshot(db) {
    const result = {};
    for (const name of TABLES) result[name] = (await db.query('SELECT id::text AS id,business_id::text AS business_id,organization_id::text AS organization_id,xmin::text AS version FROM public.' + id(name) + ' ORDER BY id')).rows;
    return result;
}
async function checkTarget(db, plan) {
    const rows = (await db.query("SELECT b.id FROM public.businesses b JOIN public.organizations o ON o.id=b.organization_id WHERE b.id=$1 AND b.organization_id=$2 AND b.context_key='event_genix' AND b.status='active' AND o.status='active'", [plan.owner.businessId, plan.owner.organizationId])).rows;
    requireValue(rows.length === 1, 'HR_OWNER_REGISTRY_MISMATCH');
}
function validateReceipt(receipt) {
    const plan = normalizePlan(receipt.plan);
    requireValue(receipt.version === 1 && receipt.planHash === digest(plan) && receipt.migrationHash === migrationHash, 'RECEIPT_MANIFEST_MISMATCH');
    requireValue(receipt.before && receipt.after && receipt.databaseFingerprint && receipt.changedIds, 'RECEIPT_IMAGES_REQUIRED');
    for (const name of TABLES) {
        const ids = new Set(plan.tables[name].ids);
        for (const image of [receipt.before[name], receipt.after[name]]) requireValue(Array.isArray(image) && image.length === ids.size && new Set(image.map(r => r.id)).size === ids.size && image.every(r => ids.has(r.id) && /^\d+$/.test(r.version)), 'RECEIPT_IMAGE_KEYS_MISMATCH');
        requireValue(Array.isArray(receipt.changedIds[name]) && new Set(receipt.changedIds[name]).size === receipt.changedIds[name].length && receipt.changedIds[name].every(key => ids.has(key)), 'RECEIPT_CHANGED_KEYS_MISMATCH');
        if (receipt.operation === 'APPLY') {
            const changed = receipt.before[name].filter(r => r.business_id === null && r.organization_id === null).map(r => r.id);
            requireValue(JSON.stringify(changed) === JSON.stringify(receipt.changedIds[name]), 'RECEIPT_CHANGED_KEYS_MISMATCH');
            requireValue(receipt.after[name].every(r => r.business_id === String(plan.owner.businessId) && r.organization_id === String(plan.owner.organizationId)), 'RECEIPT_OWNER_MISMATCH');
        }
    }
    return plan;
}
async function operate(pool, input, context, store, original) {
    const plan = normalizePlan(input); validateContext(plan, context);
    requireValue(store && typeof store.write === 'function', 'PRIVATE_RECEIPT_STORE_REQUIRED');
    await assertStopped(context);
    const db = await pool.connect(); let commitSent = false, committed = false;
    try {
        await db.query('BEGIN'); await db.query("SET LOCAL search_path=public");
        await db.query("SET LOCAL lock_timeout='5s'"); await db.query("SET LOCAL statement_timeout='30s'"); await db.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
        requireValue(await databaseFingerprint(db) === context.databaseFingerprint, 'OPERATOR_DATABASE_MISMATCH');
        await assertStopped(context, db);
        await db.query('SELECT pg_advisory_xact_lock($1::integer,$2::integer)', [SCHEMA_LOCK_CLASS_ID, SCHEMA_LOCK_OBJECT_ID]);
        await db.query("SELECT pg_advisory_xact_lock(hashtext('park-hr-ownership-v1'))");
        await db.query('LOCK TABLE ' + TABLES.map(n => 'public.' + id(n)).join(',') + ' IN SHARE ROW EXCLUSIVE MODE');
        await checkTarget(db, plan); await verifyInventory(db, plan);
        const boundary = (await db.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND (c.relrowsecurity OR c.relforcerowsecurity OR EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND t.tgenabled<>'D' AND t.tgname<>'hr_validate_owner'))", [TABLES])).rows[0].n;
        requireValue(boundary === 0, 'UNREVIEWED_TRIGGER_OR_RLS');
        const foundationBefore = await foundationState(db);
        const files = fs.readdirSync(path.join(__dirname, '../db/migrations')).filter(n => n.endsWith('.sql')).map(n => n.slice(0, -4));
        const applied = new Set((await db.query('SELECT version FROM public.schema_migrations')).rows.map(r => r.version));
        requireValue(JSON.stringify(files.filter(n => !applied.has(n)).sort()) === JSON.stringify(foundationBefore.recorded ? [] : [VERSION]), 'UNREVIEWED_PENDING_MIGRATIONS');
        if (!foundationBefore.recorded) {
            requireValue(!original, 'ROLLBACK_FOUNDATION_MISSING');
            await db.query(migrationSql);
            await db.query('INSERT INTO public.schema_migrations(version) VALUES ($1)', [VERSION]);
        }
        requireValue(await foundationFingerprint(db) === context.foundationFingerprint, 'FOUNDATION_DEFINITION_DRIFT');
        const before = await snapshot(db); const changedIds = {};
        if (original) {
            validateReceipt(original);
            requireValue(context.applyReceiptHash === digest(original), 'REVIEWED_APPLY_RECEIPT_HASH_REQUIRED');
            requireValue(original.operation === 'APPLY' && original.state === 'COMMITTED' && original.databaseFingerprint === context.databaseFingerprint && original.planHash === digest(plan), 'APPLY_RECEIPT_REQUIRED');
            requireValue(digest(before) === digest(original.after), 'POST_CUTOVER_ROW_VERSION_DRIFT');
        }
        for (const name of TABLES) {
            requireValue(before[name].every(r => (r.business_id === null && r.organization_id === null) || (r.business_id === String(plan.owner.businessId) && r.organization_id === String(plan.owner.organizationId))), 'HR_OWNER_FOREIGN_OR_AMBIGUOUS_ROW');
            changedIds[name] = original ? original.changedIds[name] : before[name].filter(r => r.business_id === null).map(r => r.id);
        }
        let receipt = { version: 1, operation: original ? 'ROLLBACK' : 'APPLY', state: 'PREPARED', plan, planHash: digest(plan), migrationHash, databaseFingerprint: context.databaseFingerprint, foundationBefore, foundationFingerprint: context.foundationFingerprint, approvalRef: context.approvalRef, liveSha: context.liveSha, releaseSha: context.releaseSha, auditProofHash: context.auditProofHash, before, changedIds, createdAtUtc: new Date().toISOString() };
        await store.write(receipt); // must be durable before any ownership update
        for (const name of original ? [...ORDER].reverse() : ORDER) {
            const ids = changedIds[name]; if (!ids.length) continue;
            const sql = original
                ? 'UPDATE public.' + id(name) + ' SET business_id=NULL,organization_id=NULL WHERE id=ANY($1::bigint[]) AND business_id=$2 AND organization_id=$3'
                : 'UPDATE public.' + id(name) + ' SET business_id=$2,organization_id=$3 WHERE id=ANY($1::bigint[]) AND business_id IS NULL AND organization_id IS NULL';
            const result = await db.query(sql, [ids, plan.owner.businessId, plan.owner.organizationId]);
            requireValue(result.rowCount === ids.length, 'HR_OWNER_UPDATE_COUNT_MISMATCH');
        }
        receipt = { ...receipt, state: 'COMMIT_PENDING', after: await snapshot(db) };
        if (!original) validateReceipt(receipt);
        receipt.writerProof = await assertStopped(context, db);
        await store.write(receipt); // after-images and handoff proof persist before COMMIT
        requireValue(Date.now() < Date.parse(context.expiresAtUtc), 'AUTHORIZATION_EXPIRED_OR_UNBOUNDED');
        commitSent = true; await db.query('COMMIT'); committed = true;
        receipt = { ...receipt, state: 'COMMITTED', committedAtUtc: new Date().toISOString() };
        await store.write(receipt); return receipt;
    } catch (error) {
        if (!committed) await db.query('ROLLBACK').catch(() => {});
        error.commitState = committed ? 'COMMITTED' : commitSent ? 'UNKNOWN' : 'ROLLED_BACK';
        throw error;
    } finally { db.release(); }
}
const applyOwnership = (pool, plan, context, store) => operate(pool, plan, context, store);
const rollbackOwnership = (pool, receipt, context, store) => operate(pool, receipt.plan, context, store, receipt);
async function recoverReceipt(db, receipt) {
    const mode = (await db.query("SELECT current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation")).rows[0];
    requireValue(mode.readonly === 'on' && mode.isolation === 'repeatable read', 'RECOVERY_REQUIRES_REPEATABLE_READ_ONLY');
    await db.query('SET LOCAL search_path=public');
    requireValue(receipt && receipt.plan, 'PRIVATE_RECEIPT_REQUIRED');
    const plan = normalizePlan(receipt.plan);
    requireValue(receipt.planHash === digest(plan) && receipt.migrationHash === migrationHash && await databaseFingerprint(db) === receipt.databaseFingerprint, 'RECEIPT_MANIFEST_MISMATCH');
    const state = await foundationState(db); await verifyInventory(db, plan);
    if (!state.recorded) { requireValue(receipt.foundationBefore && !receipt.foundationBefore.recorded, 'RECOVERY_FOUNDATION_DRIFT'); return 'NOT_COMMITTED'; }
    requireValue(await foundationFingerprint(db) === receipt.foundationFingerprint, 'FOUNDATION_DEFINITION_DRIFT');
    const current = await snapshot(db);
    if (receipt.after && receipt.before && digest(receipt.before) === digest(receipt.after) && digest(current) === digest(receipt.after) && receipt.foundationBefore.recorded === state.recorded) return 'NO_OP_STATE_MATCH';
    if (receipt.after && digest(current) === digest(receipt.after)) return 'COMMITTED';
    if (receipt.before && digest(current) === digest(receipt.before)) return 'NOT_COMMITTED';
    return 'HOLD_ROW_VERSION_DRIFT'; // never retry an uncertain commit by applying ownership again
}
function createPrivateReceiptStore(requested) {
    const file = path.join(fs.realpathSync(path.dirname(path.resolve(requested))), path.basename(requested));
    const relative = path.relative(fs.realpathSync(path.resolve(__dirname, '..')), file);
    requireValue(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'PRIVATE_RECEIPT_MUST_STAY_OUTSIDE_GIT');
    const initial = fs.openSync(file, 'wx', 0o600); try { fs.writeFileSync(initial, JSON.stringify({ state: 'RESERVED' })); fs.fsyncSync(initial); } finally { fs.closeSync(initial); }
    return { file, write(receipt) {
        const body = JSON.stringify(receipt); const envelope = JSON.stringify({ sha256: crypto.createHash('sha256').update(body).digest('hex'), body });
        const temporary = file + '.' + crypto.randomUUID() + '.next';
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try { fs.writeFileSync(fd, envelope); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, file);
    } };
}
function readPrivateReceipt(file) {
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
    requireValue(typeof envelope.body === 'string' && crypto.createHash('sha256').update(envelope.body).digest('hex') === envelope.sha256, 'PRIVATE_RECEIPT_CORRUPTED');
    return JSON.parse(envelope.body);
}
module.exports = { applyOwnership, rollbackOwnership, recoverReceipt, createPrivateReceiptStore, readPrivateReceipt, databaseFingerprint, foundationFingerprint, normalizePlan, validateContext, migrationHash, VERSION };
if (require.main === module) { console.error('LIBRARY_ONLY_SEPARATELY_REVIEWED_AUTHORIZED_OPERATOR_REQUIRED'); process.exitCode = 1; }