'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { lockOrganizationOwnership, assertCanDeactivateOrganizationOwners } = require('../services/organizationOwnership');

function fixture(rows = []) {
    const calls = [];
    return {
        calls,
        client: {
            async query(sql, params = []) {
                calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
                if (String(sql).includes('pg_advisory_xact_lock')) return { rows: [] };
                return { rows };
            }
        }
    };
}

test('ownership lock is transaction-scoped and shared with account and organization mutations', async () => {
    const { client, calls } = fixture();
    await lockOrganizationOwnership(client);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sql, "SELECT pg_advisory_xact_lock(hashtext('eventgenix:organization-ownership'))");
});

test('guard excludes the whole exact account batch after taking the shared lock', async () => {
    const { client, calls } = fixture();
    await assertCanDeactivateOrganizationOwners(client, [41, '52', 41]);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /pg_advisory_xact_lock/);
    assert.deepEqual(calls[1].params, [[41, 52]]);
    assert.match(calls[1].sql, /o\.status = 'active'/);
    assert.match(calls[1].sql, /u\.is_active IS TRUE/);
    assert.match(calls[1].sql, /om\.role = 'owner' AND om\.is_active IS TRUE/);
    assert.match(calls[1].sql, /HAVING COUNT\(\*\) FILTER \(WHERE om\.user_id = ANY\(\$1::int\[\]\)\) > 0/);
    assert.match(calls[1].sql, /COUNT\(\*\) FILTER \(WHERE NOT \(om\.user_id = ANY\(\$1::int\[\]\)\)\) = 0/);
});

test('losing an active organization owner rejects the entire account operation with 409', async () => {
    const { client, calls } = fixture([{ organization_id: 7 }, { organization_id: 8 }]);
    await assert.rejects(assertCanDeactivateOrganizationOwners(client, [41, 52]), {
        status: 409, statusCode: 409, code: 'organization_last_owner'
    });
    assert.equal(calls.some(call => /^(UPDATE|DELETE|INSERT)/.test(call.sql)), false);
});

test('empty targets do not acquire a lock or inspect unrelated organizations', async () => {
    const { client, calls } = fixture();
    await assertCanDeactivateOrganizationOwners(client, []);
    assert.deepEqual(calls, []);
});

test('malformed account targets fail before querying or coercing a batch', async () => {
    for (const targets of [null, '41', [null], [true], [{}], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], [41, 'not-an-id']]) {
        const { client, calls } = fixture();
        await assert.rejects(assertCanDeactivateOrganizationOwners(client, targets), {
            status: 400, code: 'organization_owner_target_invalid'
        });
        assert.deepEqual(calls, [], JSON.stringify(targets));
    }
});

test('database or schema errors fail closed without bypassing the owner invariant', async () => {
    for (const code of ['42P01', '08006']) {
        const databaseError = Object.assign(new Error('Ownership fixture database failure'), { code });
        let queries = 0;
        const client = { async query() { queries += 1; if (queries > 1) throw databaseError; return { rows: [] }; } };
        await assert.rejects(assertCanDeactivateOrganizationOwners(client, [41]), error => error === databaseError);
        assert.equal(queries, 2);
    }
});

test('shared staff offboarding checks the entire allowed account batch before disabling users or sessions', async () => {
    const savedModules = new Map();
    const calls = [];
    let auditCalls = 0;
    function replaceModule(name, exports) {
        const id = require.resolve(name);
        savedModules.set(id, require.cache[id]);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    replaceModule('../services/booking', { reconcileScheduledAnimatorLines: async () => ({}) });
    replaceModule('../services/accountSecurity', { recordAccountSecurityEvent: async () => { auditCalls += 1; } });
    const lifecycleId = require.resolve('../services/staffLifecycle');
    savedModules.set(lifecycleId, require.cache[lifecycleId]);
    delete require.cache[lifecycleId];
    try {
        const { syncLinkedStaffAccountDeactivation } = require('../services/staffLifecycle');
        const client = {
            async query(sql, params = []) {
                const text = String(sql).replace(/\s+/g, ' ').trim();
                calls.push({ sql: text, params });
                if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
                if (text.startsWith('SELECT u.id, u.username')) return { rows: [{ id: 41, role: 'manager' }, { id: 52, role: 'manager' }] };
                if (text.startsWith('UPDATE employee_profiles')) return { rows: [], rowCount: 2 };
                if (text.startsWith('SELECT om.organization_id')) return { rows: [{ organization_id: 7 }] };
                throw new Error(`Unexpected offboarding ownership test query: ${text}`);
            }
        };
        await assert.rejects(syncLinkedStaffAccountDeactivation(client, 71, {
            actor: { id: 99 }, canDisableAccount: () => true
        }), { statusCode: 409, code: 'organization_last_owner' });
        assert.match(calls[0].sql, /pg_advisory_xact_lock/);
        assert.match(calls[1].sql, /FOR UPDATE OF ep, u/);
        assert.deepEqual(calls.at(-1).params, [[41, 52]]);
        assert.equal(calls.some(call => /UPDATE users|UPDATE refresh_tokens/.test(call.sql)), false);
        assert.equal(auditCalls, 0);
    } finally {
        for (const [id, previous] of savedModules) {
            if (previous) require.cache[id] = previous;
            else delete require.cache[id];
        }
    }
});
