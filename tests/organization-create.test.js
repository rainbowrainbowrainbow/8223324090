'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');

const dbId = require.resolve('../db');
const previousDb = require.cache[dbId];
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool: {} } };
const { createOrganization } = require('../services/organizationLifecycle');
after(() => { if (previousDb) require.cache[dbId] = previousDb; else delete require.cache[dbId]; });

function fixture({ owner = true, auditFails = false } = {}) {
    const calls = [];
    let committed = false;
    let released = false;
    const client = { async query(sql, params = []) {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ statement, params });
        if (statement.startsWith('SELECT o.id FROM organizations o')) return { rows: owner ? [{ id: 7 }] : [] };
        if (statement.startsWith('INSERT INTO organizations')) return { rows: [{ id: 8, slug: params[0], name: params[1], status: 'active' }] };
        if (statement.startsWith('INSERT INTO account_security_events') && auditFails) throw new Error('audit unavailable');
        if (statement === 'COMMIT') committed = true;
        return { rows: [] };
    }, release() { released = true; } };
    return { db: { async connect() { return client; } }, calls, get committed() { return committed; }, get released() { return released; } };
}

const actor = { id: 41, role: 'manager', platformRole: 'creator' };
const input = { sourceOrganizationId: 7, name: 'Second organization', slug: 'second-organization' };

test('fresh owner authority creates only organization and owner membership with strict audit', async () => {
    const f = fixture();
    const created = await createOrganization(f.db, actor, input);
    assert.deepEqual(created, { id: 8, slug: input.slug, name: input.name, status: 'active', role: 'owner', businesses: [] });
    const statements = f.calls.map(call => call.statement);
    assert.ok(statements.indexOf('BEGIN') < statements.findIndex(sql => sql.startsWith('SELECT o.id FROM organizations o')));
    assert.ok(statements.findIndex(sql => sql.startsWith('INSERT INTO account_security_events')) < statements.indexOf('COMMIT'));
    assert.equal(f.calls.find(call => call.statement.startsWith('INSERT INTO organization_memberships')).params[1], actor.id);
    assert.equal(statements.some(sql => /^(INSERT|UPDATE) (?:INTO )?(businesses|business_memberships|users)\b/.test(sql)), false);
    assert.equal(f.committed, true);
    assert.equal(f.released, true);
});

test('creator identity without fresh owner membership is denied before writes', async () => {
    const f = fixture({ owner: false });
    await assert.rejects(createOrganization(f.db, actor, input), { status: 403, code: 'organization_management_denied' });
    assert.equal(f.calls.some(call => call.statement.startsWith('INSERT')), false);
    assert.equal(f.calls.at(-1).statement, 'ROLLBACK');
    assert.equal(f.released, true);
});

test('audit failure rolls back owner creation and invalid body opens no transaction', async () => {
    const f = fixture({ auditFails: true });
    await assert.rejects(createOrganization(f.db, actor, input), /audit unavailable/);
    assert.equal(f.calls.at(-1).statement, 'ROLLBACK');
    assert.equal(f.committed, false);
    const invalid = { db: { async connect() { throw new Error('must not connect'); } } };
    await assert.rejects(createOrganization(invalid.db, actor, { ...input, role: 'creator' }), { status: 400, code: 'organization_invalid' });
});
