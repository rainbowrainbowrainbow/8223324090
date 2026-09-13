'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');

const dbId = require.resolve('../db');
const originalDb = require.cache[dbId];
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: {
    pool: { query() { throw new Error('An explicit lifecycle database is required'); } }
} };
const lifecycle = require('../services/organizationLifecycle');
after(() => {
    if (originalDb) require.cache[dbId] = originalDb;
    else delete require.cache[dbId];
});

const actor = { id: 1, role: 'manager', roles: ['manager'], platformRole: 'manager' };

test('configuration mutation rejects immutable identity and malformed labels before opening a transaction', async () => {
    let calls = 0;
    const db = { query() { calls++; throw new Error('Unexpected query'); }, connect() { calls++; throw new Error('Unexpected transaction'); } };
    for (const input of [{}, { contextKey: 'foreign' }, { organizationId: 2 }, { accessMode: 'compatibility' },
        { status: 'inactive' }, { label: ' ' }, { label: [] }, { shortLabel: 'x'.repeat(81) },
        { modules: 'timeline' }, { modules: ['timeline', 3] }]) {
        await assert.rejects(lifecycle.updateBusinessConfiguration(db, actor, 1, input), error => error.status === 400);
    }
    assert.equal(calls, 0);
});

test('creation refuses unsupported modules rather than silently enabling them', async () => {
    let connects = 0;
    const db = { connect() { connects++; throw new Error('Unexpected transaction'); } };
    for (const modules of [['payroll'], ['unregistered_module'], ['catalogs']]) {
        await assert.rejects(lifecycle.createBusiness(db, actor, 1, { contextKey: 'fixture_company', label: 'Fixture', modules }),
            error => error.status === 400 || error.status === 403);
    }
    assert.equal(connects, 0);
});

test('resource initialization validates its explicit body before any database work', async () => {
    const db = { query() { throw new Error('Unexpected query'); }, connect() { throw new Error('Unexpected transaction'); } };
    for (const input of [{ businessContext: 'dar' }, { types: [] }, { types: ['staff'] }, { types: 'room' }, null]) {
        await assert.rejects(lifecycle.initializeBusinessResources(db, actor, 1, input), error => error.status === 400);
    }
});

test('management read model scopes rows to current managed organizations and exposes separate capabilities', async () => {
    const calls = [];
    let organizationRole = 'owner';
    let active = true;
    const db = { async query(sql, params) {
        const text = sql.replace(/\s+/g, ' ').trim();
        calls.push({ text, params });
        assert.equal(/^(INSERT|UPDATE|DELETE|BEGIN)/.test(text), false);
        if (text.startsWith('SELECT id, role, is_active FROM users')) return { rows: [{ id: 1, role: 'manager', is_active: active }] };
        if (text.startsWith('SELECT o.id, o.name')) return { rows: [{ id: '7', name: 'Fixture', slug: 'fixture', organization_role: organizationRole }] };
        if (text.startsWith('SELECT id, organization_id, context_key')) {
            assert.deepEqual(params, [[7]]);
            return { rows: [
                { id: '8', organization_id: '7', context_key: 'fixture_company', label: 'Fixture', short_label: 'Fx', status: 'active', access_mode: 'membership', modules: ['timeline'] },
                { id: '9', organization_id: '7', context_key: 'fixture_empty', label: 'Empty', short_label: 'Empty', status: 'inactive', access_mode: 'membership', modules: [] }
            ] };
        }
        throw new Error('Unexpected query: ' + text);
    } };
    const owner = await lifecycle.getOrganizationManagement(db, actor);
    assert.equal(owner.organizations[0].canCreateBusiness, true);
    assert.equal(owner.organizations[0].businesses[0].canInitializeResources, true);
    assert.equal(owner.organizations[0].businesses[1].canInitializeResources, false);
    assert.deepEqual(owner.organizations[0].businesses[1].modules, []);
    assert.ok(owner.moduleRegistry.every(module => module.key && typeof module.canEnable === 'boolean'));
    organizationRole = 'admin';
    const admin = await lifecycle.getOrganizationManagement(db, actor);
    assert.equal(admin.organizations[0].canEditBusinesses, false);
    assert.equal(admin.organizations[0].businesses[0].canInitializeResources, false);
    active = false;
    const before = calls.length;
    await assert.rejects(lifecycle.getOrganizationManagement(db, actor), { status: 403, code: 'organization_management_denied' });
    assert.equal(calls.length, before + 1);
});
