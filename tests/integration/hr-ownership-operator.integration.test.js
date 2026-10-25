'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Pool, Client } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { freezeInventory, preparePlan, digest, TABLES } = require('../../scripts/prepare-park-hr-ownership-backfill.cjs');
const operator = require('../../scripts/park-hr-ownership-operator.cjs');
const { createNoApplyRecoveryProof } = require('../../services/releaseMaintenance');
const { createRailwayStoppedVerifier } = require('../../scripts/park-hr-maintenance-proof.cjs');
const enabled = process.env.REQUIRE_ISOLATED_TEST_TARGET === 'true' && process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER === 'true';
const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/' + operator.VERSION + '.sql'), 'utf8');
let pool, target;
async function fixture(t) {
    const owner = (await pool.query("SELECT id,organization_id FROM public.businesses WHERE context_key='event_genix'")).rows[0];
    const key = 'qa_operator_' + crypto.randomBytes(7).toString('hex');
    const legacy = new Client({ connectionString: target.url.toString(), ssl: false });
    let row, closed = false;
    try { await legacy.connect(); row = (await legacy.query('INSERT INTO public.hr_professions(key,title) VALUES($1,$1) RETURNING id', [key])).rows[0]; }
    finally { await legacy.end(); closed = true; }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-hr-operator-integration-'));
    t.after(async () => { await pool.query('DELETE FROM public.hr_professions WHERE key=$1', [key]); for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); });
    const plan = preparePlan(await freezeInventory(pool), { businessId: owner.id, organizationId: owner.organization_id });
    const reference = await pool.connect(); let foundationFingerprint;
    try { await reference.query('BEGIN'); await reference.query('SET LOCAL search_path=public'); await reference.query(migration); foundationFingerprint = await operator.foundationFingerprint(reference); }
    finally { await reference.query('ROLLBACK'); reference.release(); }
    const context = { databaseFingerprint: await operator.databaseFingerprint(pool), foundationFingerprint, auditProofHash: 'a'.repeat(64), planHash: digest(operator.normalizePlan(plan)), migrationHash: operator.migrationHash,
        liveSha: 'a'.repeat(40), releaseSha: 'b'.repeat(40), approvalRef: 'LOCAL_DISPOSABLE_REHEARSAL', issuedAtUtc: new Date(Date.now() - 1000).toISOString(), expiresAtUtc: new Date(Date.now() + 300000).toISOString(),
        // Railway state is synthetic in this fixture. The real verifier has separate positive/negative tests.
        assertWritersStopped: async () => { assert.ok(closed, 'the real legacy fixture connection is closed before handoff'); return { mode: 'SERVICE_STOPPED', allWritersStopped: true, liveSha: 'a'.repeat(40), evidenceHash: 'b'.repeat(64), observedAtUtc: new Date().toISOString(), otherWritableSessions: 0 }; } };
    return { row, key, plan, context, store: name => operator.createPrivateReceiptStore(path.join(directory, name + '.json')) };
}
async function recover(receipt) {
    const db = await pool.connect();
    try { await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); return await operator.recoverReceipt(db, receipt); }
    finally { await db.query('ROLLBACK'); db.release(); }
}
function proxyPool(intercept) {
    return { async connect() { const db = await pool.connect(); return { query: (sql, params) => intercept(db, sql, params), release: () => db.release() }; } };
}
async function ownerOf(id) { return (await pool.query('SELECT business_id FROM public.hr_professions WHERE id=$1', [id])).rows[0].business_id; }
describe('HR ownership operator on disposable PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    before(() => { target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env); assert.equal(target.isLocal, true); pool = new Pool({ connectionString: target.url.toString(), ssl: false, max: 1 }); });
    after(async () => { if (pool) await pool.end(); });
    it('proves no attribution only through a real audit-role repeatable-read read-only connection', async t => {
        const f = await fixture(t);
        const present = (await pool.query('SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version=$1) AS present', [operator.VERSION])).rows[0].present;
        const exists = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='eventgenix_audit_ro') AS present")).rows[0].present;
        assert.equal(exists, false, 'this disposable fixture requires its own audit role');
        const password = crypto.randomUUID();
        await pool.query("CREATE ROLE eventgenix_audit_ro LOGIN PASSWORD '" + password + "'");
        await pool.query('GRANT USAGE ON SCHEMA public TO eventgenix_audit_ro');
        await pool.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO eventgenix_audit_ro');
        t.after(async () => { if (!exists) { await pool.query('REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM eventgenix_audit_ro'); await pool.query('REVOKE USAGE ON SCHEMA public FROM eventgenix_audit_ro'); await pool.query('DROP ROLE eventgenix_audit_ro'); } });
        const readOnlyTarget = new URL(target.url); readOnlyTarget.username = 'eventgenix_audit_ro'; readOnlyTarget.password = password;
        const db = new Client({ connectionString: readOnlyTarget.toString(), ssl: false });
        try {
            await db.connect(); await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            const manifest = { approvalRef: f.context.approvalRef, baseline: { sha: f.context.liveSha }, release: { sha: f.context.releaseSha }, proofs: Object.fromEntries(['migrationHash','auditProofHash','planHash','databaseFingerprint','foundationFingerprint'].map(k => [k,f.context[k]])) };
            const invoke = () => createNoApplyRecoveryProof(db, f.plan, manifest, f.context.assertWritersStopped);
            if (present) await assert.rejects(invoke(), /NO_APPLY_STATE_NOT_PROVEN/);
            else { const proof = await invoke(); assert.equal(proof.state, 'VERIFIED_NOT_COMMITTED'); assert.equal(proof.operation, 'READ_ONLY_RECOVERY'); assert.equal((await db.query("SELECT current_setting('transaction_read_only') AS value")).rows[0].value, 'on'); }
        } finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
    });
    it('detects a real idle writable connection and refreshes session statistics after it closes', async () => {
        const source = { repo: null, image: null };
        const deployment = { id: 'synthetic-maintenance', status: 'REMOVED', deploymentStopped: true, meta: { imageDigest: 'sha256:' + 'd'.repeat(64) } };
        const snapshot = { id: 'bc28b46c-d4bc-491c-893a-d8401c633668', name: 'fortunate-appreciation', environments: { edges: [{ node: { id: 'd9f9b984-d54d-4620-a8bf-c48882ad5158', name: 'production', serviceInstances: { edges: [{ node: { serviceId: '3fb62d4c-2dc2-4701-8e2b-09ce16e188ee', serviceName: '8223324090', environmentId: 'd9f9b984-d54d-4620-a8bf-c48882ad5158', source, activeDeployments: [], latestDeployment: deployment } }] } } }] } };
        const sourceFingerprint = crypto.createHash('sha256').update(JSON.stringify({ ...source, branch: null, imageDigest: deployment.meta.imageDigest })).digest('hex');
        const verify = createRailwayStoppedVerifier({ deploymentId: deployment.id, liveSha: 'a'.repeat(40), sourceBranch: 'codex/eventgenix-production', sourceFingerprint }, { fetchStatus: async () => snapshot });
        const reader = await pool.connect(); const writer = new Client({ connectionString: target.url.toString(), ssl: false });
        try {
            await reader.query('BEGIN'); await writer.connect();
            await assert.rejects(verify(reader), /OTHER_OWNERSHIP_WRITERS_CONNECTED/);
            await writer.end();
            assert.equal((await verify(reader)).otherWritableSessions, 0);
        } finally { await writer.end().catch(() => {}); await reader.query('ROLLBACK'); reader.release(); }
    });
    it('atomically installs only the approved foundation, applies owners and rolls back exact changed rows', async t => {
        const f = await fixture(t);
        const before = (await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) AND column_name IN ('business_id','organization_id')", [TABLES])).rows[0].n;
        const badStore = f.store('bad-foundation');
        await assert.rejects(operator.applyOwnership(pool, f.plan, { ...f.context, foundationFingerprint: '0'.repeat(64) }, badStore), e => e.code === 'FOUNDATION_DEFINITION_DRIFT' && e.commitState === 'ROLLED_BACK');
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) AND column_name IN ('business_id','organization_id')", [TABLES])).rows[0].n, before, 'DDL and migration bookkeeping are in the same atomic unit');
        const store = f.store('apply'); const receipt = await operator.applyOwnership(pool, f.plan, f.context, store);
        assert.equal(receipt.state, 'COMMITTED'); assert.equal(operator.readPrivateReceipt(store.file).state, 'COMMITTED');
        assert.equal(Number(await ownerOf(f.row.id)), f.plan.owner.businessId);
        assert.equal((await pool.query('SELECT id FROM hr_owned.hr_professions WHERE id=$1', [f.row.id])).rowCount, 1);
        assert.equal(await recover(receipt), 'COMMITTED');
        const rollback = await operator.rollbackOwnership(pool, receipt, { ...f.context, applyReceiptHash: digest(receipt) }, f.store('rollback'));
        assert.equal(rollback.operation, 'ROLLBACK'); assert.equal(await ownerOf(f.row.id), null);
        assert.equal(await recover(rollback), 'COMMITTED');
        assert.equal((await pool.query('SELECT version FROM public.schema_migrations WHERE version=$1', [operator.VERSION])).rowCount, 1, 'rollback leaves additive schema and its ledger entry intact');
    });
    it('rolls back real ownership writes on a mid-operation SQL failure', async t => {
        const f = await fixture(t); let injected = false;
        const failing = proxyPool(async (db, sql, params) => { const result = await db.query(sql, params); if (!injected && /^UPDATE public\./.test(sql)) { injected = true; throw Object.assign(new Error('SYNTHETIC_WRITE_FAILURE'), { code: 'SYNTHETIC_WRITE_FAILURE' }); } return result; });
        const store = f.store('mid-write');
        await assert.rejects(operator.applyOwnership(failing, f.plan, f.context, store), e => e.code === 'SYNTHETIC_WRITE_FAILURE' && e.commitState === 'ROLLED_BACK');
        assert.ok(injected); assert.equal(await ownerOf(f.row.id), null); assert.equal(await recover(operator.readPrivateReceipt(store.file)), 'NOT_COMMITTED');
    });
    it('refuses to change ownership if durable receipt storage fails', async t => {
        const f = await fixture(t);
        await assert.rejects(operator.applyOwnership(pool, f.plan, f.context, { write() { throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }); } }), e => e.code === 'ENOSPC' && e.commitState === 'ROLLED_BACK');
        assert.equal(await ownerOf(f.row.id), null);
    });
    it('recovers a lost COMMIT acknowledgement without reapplying writes', async t => {
        const f = await fixture(t); const store = f.store('lost-ack'); let commits = 0;
        const lostAck = proxyPool(async (db, sql, params) => { const result = await db.query(sql, params); if (sql === 'COMMIT') { commits++; throw Object.assign(new Error('synthetic lost ack'), { code: 'ECONNRESET' }); } return result; });
        await assert.rejects(operator.applyOwnership(lostAck, f.plan, f.context, store), e => e.code === 'ECONNRESET' && e.commitState === 'UNKNOWN');
        assert.equal(commits, 1); assert.equal(Number(await ownerOf(f.row.id)), f.plan.owner.businessId);
        const pending = operator.readPrivateReceipt(store.file); assert.equal(pending.state, 'COMMIT_PENDING'); assert.equal(await recover(pending), 'COMMITTED');
    });
    it('retains pre-COMMIT recovery evidence when the final receipt acknowledgement cannot be written', async t => {
        const f = await fixture(t); const store = f.store('receipt-final-write');
        await assert.rejects(operator.applyOwnership(pool, f.plan, f.context, { write(receipt) { if (receipt.state === 'COMMITTED') throw Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }); store.write(receipt); } }), e => e.code === 'ENOSPC' && e.commitState === 'COMMITTED');
        assert.equal(operator.readPrivateReceipt(store.file).state, 'COMMIT_PENDING'); assert.equal(await recover(operator.readPrivateReceipt(store.file)), 'COMMITTED');
    });
    it('rejects rollback after a nonstructural edit or an unreviewed receipt', async t => {
        const f = await fixture(t); const receipt = await operator.applyOwnership(pool, f.plan, f.context, f.store('before-edit'));
        await assert.rejects(operator.rollbackOwnership(pool, receipt, f.context, f.store('wrong-receipt')), /REVIEWED_APPLY_RECEIPT_HASH_REQUIRED/);
        await pool.query('UPDATE public.hr_professions SET short_info=$1 WHERE id=$2', ['Synthetic later edit', f.row.id]);
        await assert.rejects(operator.rollbackOwnership(pool, receipt, { ...f.context, applyReceiptHash: digest(receipt) }, f.store('after-edit')), /POST_CUTOVER_ROW_VERSION_DRIFT/);
        assert.equal(Number(await ownerOf(f.row.id)), f.plan.owner.businessId); assert.equal(await recover(receipt), 'HOLD_ROW_VERSION_DRIFT');
    });
    it('rejects new-row inventory drift without clearing any owner', async t => {
        const f = await fixture(t); const receipt = await operator.applyOwnership(pool, f.plan, f.context, f.store('before-new-row'));
        const key = f.key + '_late';
        try {
            await pool.query('INSERT INTO public.hr_professions(key,title,business_id,organization_id) VALUES($1,$1,$2,$3)', [key, f.plan.owner.businessId, f.plan.owner.organizationId]);
            await assert.rejects(operator.rollbackOwnership(pool, receipt, { ...f.context, applyReceiptHash: digest(receipt) }, f.store('after-new-row')), /HR_OWNER_INVENTORY_DRIFT/);
            assert.equal(Number(await ownerOf(f.row.id)), f.plan.owner.businessId);
        } finally { await pool.query('DELETE FROM public.hr_professions WHERE key=$1', [key]); }
    });
    it('aborts if a writer resumes between the initial check and COMMIT', async t => {
        const f = await fixture(t); let checks = 0; const original = f.context.assertWritersStopped;
        const context = { ...f.context, assertWritersStopped: async db => { checks++; const proof = await original(db); return { ...proof, allWritersStopped: checks < 3 }; } };
        await assert.rejects(operator.applyOwnership(pool, f.plan, context, f.store('resumed-writer')), e => e.code === 'WRITER_HANDOFF_NOT_CONFIRMED' && e.commitState === 'ROLLED_BACK');
        assert.equal(checks, 3); assert.equal(await ownerOf(f.row.id), null);
    });
    it('rejects a different database identity and any unrelated pending migration', async t => {
        const f = await fixture(t);
        await assert.rejects(operator.applyOwnership(pool, f.plan, { ...f.context, databaseFingerprint: '0'.repeat(64) }, f.store('wrong-db')), /OPERATOR_DATABASE_MISMATCH/);
        const version = '001_initial_schema'; const saved = (await pool.query('DELETE FROM public.schema_migrations WHERE version=$1 RETURNING *', [version])).rows[0]; assert.ok(saved);
        try { await assert.rejects(operator.applyOwnership(pool, f.plan, f.context, f.store('unreviewed-migration')), /UNREVIEWED_PENDING_MIGRATIONS/); }
        finally { await pool.query('INSERT INTO public.schema_migrations(version,applied_at) VALUES($1,$2)', [saved.version, saved.applied_at]); }
        assert.equal(await ownerOf(f.row.id), null);
    });
    it('refuses RLS or unreviewed trigger side effects', async t => {
        const f = await fixture(t);
        await pool.query('ALTER TABLE public.hr_professions ENABLE ROW LEVEL SECURITY');
        try { await assert.rejects(operator.applyOwnership(pool, f.plan, f.context, f.store('rls')), /UNREVIEWED_TRIGGER_OR_RLS/); }
        finally { await pool.query('ALTER TABLE public.hr_professions DISABLE ROW LEVEL SECURITY'); }
        assert.equal(await ownerOf(f.row.id), null);
    });
    it('does not mislabel an idempotent no-op as a proved COMMIT after a lost acknowledgement', async t => {
        const f = await fixture(t); await operator.applyOwnership(pool, f.plan, f.context, f.store('initial'));
        const noop = await operator.applyOwnership(pool, f.plan, f.context, f.store('noop'));
        assert.ok(Object.values(noop.changedIds).every(ids => ids.length === 0)); assert.equal(await recover(noop), 'NO_OP_STATE_MATCH');
    });
    it('requires a repeatable-read read-only transaction for recovery', async t => {
        const f = await fixture(t); const receipt = await operator.applyOwnership(pool, f.plan, f.context, f.store('recovery-mode'));
        await assert.rejects(operator.recoverReceipt(pool, receipt), /RECOVERY_REQUIRES_REPEATABLE_READ_ONLY/);
    });
});