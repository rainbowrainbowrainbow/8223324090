'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    cleanTelemetry,
    descriptor,
    prepareReservedCutover,
    recordCompatibilityTelemetry,
    sha256
} = require('../services/businessCutover');

const HASH = 'a'.repeat(64);
const SHA = 'b'.repeat(40);

function preparedClient(options = {}) {
    const calls = [];
    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (/SELECT id, status FROM organizations/.test(sql)) return { rows: [{ id: 7, status: 'active' }] };
            if (/SELECT role, is_active FROM users/.test(sql)) return { rows: [{ role: 'creator', is_active: true }] };
            if (/SELECT id, organization_id, access_mode FROM businesses/.test(sql)) return { rows: options.business ? [options.business] : [] };
            if (/SELECT \* FROM business_cutover_journal/.test(sql)) return { rows: options.journal ? [options.journal] : [] };
            return { rows: [] };
        },
        release() {}
    };
}

function database(client) {
    return { async connect() { return client; } };
}

function input(extra = {}) {
    return { contextKey: 'crm', organizationId: 7, sourceSnapshotSha256: HASH, mappingSha256: HASH, sourceDeploymentSha: SHA, ...extra };
}

test('cutover descriptor accepts only reserved contexts and exact review fingerprints', () => {
    assert.deepEqual(descriptor(input()), {
        contextKey: 'crm', organizationId: 7, sourceSnapshotSha256: HASH, mappingSha256: HASH, sourceDeploymentSha: SHA
    });
    assert.throws(() => descriptor(input({ contextKey: 'event_genix' })), { code: 'cutover_context_invalid' });
    assert.throws(() => descriptor(input({ mappingSha256: 'short' })), { code: 'cutover_invalid' });
});

test('cutover preparation creates journal evidence only and never claims a reserved business', async () => {
    const client = preparedClient();
    const result = await prepareReservedCutover(database(client), { id: 3, platformRole: 'creator' }, input());
    assert.deepEqual(result, { contextKey: 'crm', organizationId: 7, businessId: null, state: 'prepared', replay: false });
    assert.equal(client.calls.some(call => /INSERT INTO businesses/.test(call.sql)), false);
    assert.equal(client.calls.some(call => /INSERT INTO business_cutover_journal/.test(call.sql)), true);
    assert.equal(client.calls.some(call => /^COMMIT$/.test(call.sql)), true);
});

test('cutover preparation rejects a context claimed by another organization and rolls back', async () => {
    const client = preparedClient({ business: { id: 19, organization_id: 8, access_mode: 'compatibility' } });
    await assert.rejects(
        prepareReservedCutover(database(client), { id: 3, platformRole: 'creator' }, input()),
        { code: 'cutover_context_claimed' }
    );
    assert.equal(client.calls.some(call => /^ROLLBACK$/.test(call.sql)), true);
});

test('cutover journal replay is idempotent only for the exact reviewed source', async () => {
    const journal = { organization_id: 7, source_snapshot_sha256: HASH, mapping_sha256: HASH, source_deployment_sha: SHA, state: 'prepared' };
    const client = preparedClient({ journal });
    const replay = await prepareReservedCutover(database(client), { id: 3, platformRole: 'creator' }, input());
    assert.equal(replay.replay, true);
    assert.equal(client.calls.some(call => /INSERT INTO business_cutover_journal/.test(call.sql)), false);
    const drifting = preparedClient({ journal });
    await assert.rejects(
        prepareReservedCutover(database(drifting), { id: 3, platformRole: 'creator' }, input({ mappingSha256: 'c'.repeat(64) })),
        { code: 'cutover_journal_drift' }
    );
});

test('telemetry has bounded labels, no actor fields, and aggregates through one conflict key', async () => {
    assert.equal(cleanTelemetry({ businessContext: 'crm', entryFamily: 'http', authoritySource: 'membership', outcome: 'allowed', deploymentSha: SHA }).businessContext, 'crm');
    assert.equal(cleanTelemetry({ businessContext: 'crm', entryFamily: 'anything', authoritySource: 'membership', outcome: 'allowed', deploymentSha: SHA }), null);
    const calls = [];
    await recordCompatibilityTelemetry({ query: async (sql, params) => calls.push({ sql, params }) },
        { businessContext: 'crm', entryFamily: 'http', authoritySource: 'membership', outcome: 'allowed', deploymentSha: SHA });
    assert.match(calls[0].sql, /ON CONFLICT/);
    assert.equal(calls[0].params.includes(3), false);
    assert.deepEqual(calls[0].params, ['crm', 'http', 'membership', 'allowed', SHA]);
});

test('canonical mapping hash is independent of input object key order', () => {
    assert.equal(sha256({ b: ['x'], a: { c: 1 } }), sha256({ a: { c: 1 }, b: ['x'] }));
});
