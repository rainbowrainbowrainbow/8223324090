'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { TABLES, REQUIRED_COLUMNS, preparePlan, digest } = require('../scripts/prepare-park-hr-ownership-backfill.cjs');
const operator = require('../scripts/park-hr-ownership-operator.cjs');
const { verifyStoppedSnapshot, createRailwayStoppedVerifier, captureMaintenanceIdentity } = require('../scripts/park-hr-maintenance-proof.cjs');
function plan() {
    return preparePlan({ atUtc: '2026-10-25T00:00:00Z', tables: Object.fromEntries(TABLES.map(name => {
        const columns = [...REQUIRED_COLUMNS[name]];
        const rows = [Object.fromEntries(columns.map(column => [column, column === 'id' ? '1' : null]))];
        return [name, { primaryKey: ['id'], columns, count: 1, rows, fingerprint: digest(rows) }];
    })) }, { businessId: 2, organizationId: 3 });
}
function context(input) {
    return { databaseFingerprint: 'a'.repeat(64), foundationFingerprint: 'b'.repeat(64), auditProofHash: 'c'.repeat(64), planHash: digest(operator.normalizePlan(input)), migrationHash: operator.migrationHash,
        liveSha: 'a'.repeat(40), releaseSha: 'b'.repeat(40), approvalRef: 'LOCAL_DISPOSABLE_REHEARSAL', issuedAtUtc: new Date(Date.now() - 1000).toISOString(), expiresAtUtc: new Date(Date.now() + 60000).toISOString(),
        assertWritersStopped: async () => ({ mode: 'SERVICE_STOPPED', allWritersStopped: true, liveSha: 'a'.repeat(40), evidenceHash: 'd'.repeat(64), observedAtUtc: new Date().toISOString(), otherWritableSessions: 0 }) };
}
function expectedMaintenance() {
    const state = stoppedSnapshot(); const i = state.environments.edges[0].node.serviceInstances.edges[0].node;
    i.latestDeployment.status = 'SUCCESS'; i.latestDeployment.deploymentStopped = false; i.activeDeployments = [{ id: i.latestDeployment.id }];
    return captureMaintenanceIdentity(state, { commitSha: 'a'.repeat(40), sourceBranch: 'codex/eventgenix-production' }, 'a'.repeat(40));
}
function stoppedSnapshot() {
    const instance = { serviceId: '3fb62d4c-2dc2-4701-8e2b-09ce16e188ee', serviceName: '8223324090', environmentId: 'd9f9b984-d54d-4620-a8bf-c48882ad5158', source: { repo: null, image: null }, cronSchedule: null, nextCronRunAt: null, activeDeployments: [], latestDeployment: { id: 'synthetic-deployment', meta: { imageDigest: 'sha256:' + 'd'.repeat(64) }, status: 'REMOVED', deploymentStopped: true } };
    return { id: 'bc28b46c-d4bc-491c-893a-d8401c633668', name: 'fortunate-appreciation', environments: { edges: [{ node: { id: instance.environmentId, name: 'production', serviceInstances: { edges: [{ node: instance }] } } }] } };
}
test('operator rejects missing, stale or mismatched review boundaries before connecting', async () => {
    const input = plan(); let connected = false;
    const pool = { connect() { connected = true; throw Error('UNEXPECTED_CONNECT'); } };
    for (const change of [{ assertWritersStopped: undefined }, { planHash: '0'.repeat(64) }, { migrationHash: '0'.repeat(64) }, { approvalRef: '' }, { expiresAtUtc: '2000-01-01' }, { expiresAtUtc: new Date(Date.now() + 7 * 3600000).toISOString() }]) {
        await assert.rejects(operator.applyOwnership(pool, input, { ...context(input), ...change }, { write() {} }));
    }
    await assert.rejects(operator.applyOwnership(pool, input, { ...context(input), assertWritersStopped: async () => ({ mode: 'SERVICE_STOPPED', allWritersStopped: false }) }, { write() {} }), /WRITER_HANDOFF_NOT_CONFIRMED/);
    assert.equal(connected, false);
});
test('operator shares the existing schema-maintenance namespace without changing backup behavior', () => {
    const original = fs.readFileSync(path.join(__dirname, '../services/backupSchemaLock.js'), 'utf8');
    const current = fs.readFileSync(path.join(__dirname, '../scripts/park-hr-ownership-operator.cjs'), 'utf8');
    for (const name of ['SCHEMA_LOCK_CLASS_ID', 'SCHEMA_LOCK_OBJECT_ID']) {
        const pattern = new RegExp('const ' + name + ' = ([0-9_]+);');
        assert.equal(pattern.exec(current)[1], pattern.exec(original)[1]);
    }
    assert.doesNotMatch(current, /new (?:Client|Pool)\(|process\.env\.(?:DATABASE_URL|PRODUCTION_DATABASE_URL)/);
    const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/park-hr-ownership-operator.cjs'), '--apply'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /LIBRARY_ONLY_SEPARATELY_REVIEWED_AUTHORIZED_OPERATOR_REQUIRED/);
});
test('private receipt uses exclusive reservation, durable replacement and integrity validation', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-hr-operator-receipt-'));
    t.after(() => { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); });
    const file = path.join(directory, 'receipt.json'); const store = operator.createPrivateReceiptStore(file);
    assert.throws(() => operator.createPrivateReceiptStore(file), /EEXIST/);
    store.write({ state: 'PREPARED', synthetic: true }); assert.equal(operator.readPrivateReceipt(file).state, 'PREPARED');
    store.write({ state: 'COMMIT_PENDING', synthetic: true }); assert.equal(operator.readPrivateReceipt(file).state, 'COMMIT_PENDING');
    const envelope = JSON.parse(fs.readFileSync(file, 'utf8')); envelope.body += ' '; fs.writeFileSync(file, JSON.stringify(envelope));
    assert.throws(() => operator.readPrivateReceipt(file), /PRIVATE_RECEIPT_CORRUPTED/);
    assert.throws(() => operator.createPrivateReceiptStore(path.join(__dirname, '../must-not-create-receipt.json')), /PRIVATE_RECEIPT_MUST_STAY_OUTSIDE_GIT/);
});
test('maintenance evidence requires an exact removed deployment and an empty authoritative active set', () => {
    const expected = expectedMaintenance();
    assert.equal(verifyStoppedSnapshot(stoppedSnapshot(), expected).status, 'REMOVED');
    for (const mutate of [s => { s.id = 'foreign'; }, s => { s.environments.edges[0].node.serviceInstances.edges[0].node.latestDeployment.meta.imageDigest = 'sha256:' + 'e'.repeat(64); }, s => { s.environments.edges[0].node.serviceInstances.edges[0].node.activeDeployments = [{ id: 'still-running' }]; }, s => { s.environments.edges[0].node.serviceInstances.edges[0].node.latestDeployment.deploymentStopped = false; }, s => { s.environments.edges[0].node.serviceInstances.edges[0].node.latestDeployment.id = 'different'; }, s => { s.environments.edges[0].node.serviceInstances.edges[0].node.cronSchedule = '* * * * *'; }, s => { s.environments.edges[0].node.serviceInstances.edges[0].node.source.branch = 'foreign'; }]) {
        const state = stoppedSnapshot(); mutate(state); assert.throws(() => verifyStoppedSnapshot(state, expected));
    }
});
test('maintenance session probe fails closed for writable or unknown sessions', async () => {
    const verify = createRailwayStoppedVerifier(expectedMaintenance(), { fetchStatus: async () => stoppedSnapshot() });
    for (const n of [1, null, '0']) await assert.rejects(verify({ query: async () => ({ rows: [{ n }] }) }), /OTHER_OWNERSHIP_WRITERS_CONNECTED/);
    const result = await verify({ query: async sql => { if (sql === 'SELECT pg_stat_clear_snapshot()') return { rows: [] }; assert.match(sql, /backend_type IS NULL/); assert.match(sql, /has_table_privilege/); return { rows: [{ n: 0 }] }; } });
    assert.equal(result.otherWritableSessions, 0); assert.equal(result.allWritersStopped, true);
});