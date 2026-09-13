'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plan, apply, retire, TABLES, target } = require('../scripts/sys-mb-audit-read-lease.cjs');
const { draftUsers, livePolicy } = require('../scripts/sys-mb-recovery-draft.cjs');

function database({ unsafe = false, drift = false } = {}) {
    let reads = 0;
    const queries = [];
    const initial = TABLES.slice().sort().map((name, index) => ({ name, oid: String(index+1), acl: 'owner',
        owner: '1', readable: name === 'organizations', column_readable: name === 'organizations', writable: false }));
    let rows = structuredClone(initial), snapshot;
    return { queries, async query(sql, params) {
        queries.push(sql);
        if (sql === 'BEGIN') snapshot = structuredClone(rows);
        if (sql === 'ROLLBACK') rows = snapshot;
        if (sql.includes('rolsuper')) return { rows: [{ rolsuper: unsafe, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false }] };
        if (sql.includes('count(*)::int AS n')) return { rows: [{ n: 0 }] };
        if (sql.includes('FROM pg_class')) {
            reads++;
            const copy = structuredClone(rows);
            if (drift && reads > 1) copy[0].acl = 'other-admin';
            return { rows: copy };
        }
        for (const verb of ['GRANT', 'REVOKE']) {
            if (sql.startsWith(verb)) {
                const row = rows.find(r => sql.includes(`public."${r.name}"`));
                assert.ok(row);
                row.readable = verb === 'GRANT'; row.column_readable = row.readable;
                row.acl = row.readable ? 'owner,audit-select' : 'owner';
            }
        }
        return { rows: [] };
    } };
}
test('lease grants only missing SELECT, preserves previous read grant, and retires idempotently', async () => {
    const db = database();
    const before = await plan(db, 'audit');
    assert.equal(before.added.length, 3);
    const receipts = [];
    const receipt = await apply(db, 'audit', before, r => receipts.push(structuredClone(r)));
    assert.equal(receipts[0].state, 'PREPARED');
    assert.equal(receipts[1].state, 'COMMIT_PENDING');
    assert.equal((await plan(db, 'audit')).added.length, 0);
    assert.equal(await retire(db, 'audit', receipt), 'RETIRED');
    assert.equal(await retire(db, 'audit', receipt), 'ALREADY_RETIRED');
    assert.equal(db.queries.some(sql => sql.startsWith('REVOKE') && sql.includes('public."organizations"')), false);
});
test('grant drift, unsafe role, and failed receipt persistence fail before mutation', async () => {
    await assert.rejects(plan(database({ unsafe: true }), 'audit'), /UNSAFE_AUDIT_ROLE/);
    const db = database({ drift: true });
    const before = await plan(db, 'audit');
    await assert.rejects(apply(db, 'audit', before, () => {}), /GRANT_STATE_DRIFT/);
    assert.equal(db.queries.some(sql => sql.startsWith('GRANT')), false);
    const other = database();
    await assert.rejects(apply(other, 'audit', await plan(other, 'audit'), () => { throw Error('DISK_FULL'); }), /DISK_FULL/);
    assert.equal(other.queries.some(sql => sql.startsWith('GRANT')), false);
    assert.equal(other.queries.at(-1), 'ROLLBACK');
});
test('retirement refuses ACL drift and tampered table scope', async () => {
    const db = database();
    const receipt = await apply(db, 'audit', await plan(db, 'audit'), () => {});
    await assert.rejects(retire(db, 'audit', { ...receipt, added: ['users'] }), /INVALID_RECEIPT/);
    await assert.rejects(retire(db, 'audit', { ...receipt, afterFingerprint: 'bad' }), /RETIREMENT_ACL_DRIFT/);
    assert.equal(db.queries.some(sql => sql.startsWith('REVOKE')), false);
});
test('endpoint fingerprints do not depend on password or user, but distinguish databases', () => {
    assert.equal(target('postgresql://a:secret@localhost:5432/one'), target('postgresql://b:different@localhost:5432/one'));
    assert.notEqual(target('postgresql://a:secret@localhost:5432/one'), target('postgresql://a:secret@localhost:5432/two'));
});
test('draft does not turn assigned-but-denied into a grant or infer platform creator ownership', () => {
    const policy = { allowedBusinessContextsForUser: u => u.role === 'creator' ? ['crm','maysternya_doli'] : ['event_genix'],
        resolveBusinessContextPolicy: () => ({ defaultContext: 'event_genix' }) };
    const rows = draftUsers([
        { id: 1, name: 'Test creator', role: 'creator', business_contexts: ['crm'] },
        { id: 2, name: 'Test worker', role: 'animator', business_contexts: ['crm'] }
    ], policy);
    assert.equal(rows[0].proposals[0].membershipRole, null);
    assert.equal(rows[0].proposals[0].organizationRole, null);
    assert.equal(rows[1].proposals.find(p => p.businessContext === 'crm').action, 'DO_NOT_GRANT');
    assert.ok(rows.flatMap(row => row.proposals).every(row => row.approvalStatus === 'UNAPPROVED'));
    assert.throws(() => livePolicy('HEAD'), /EXACT_SOURCE_REQUIRED/);
});
