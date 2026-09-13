'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { linkBusinessContext, positiveRecordId, assertLeadReference, withLeadSavepoint } = require('../services/leadReferenceIntegrity');

test('relationship context and identifiers cannot silently coerce malformed input into an existing business or record', () => {
    assert.equal(linkBusinessContext(), 'event_genix');
    assert.equal(linkBusinessContext('park'), 'event_genix');
    assert.equal(linkBusinessContext('fixture_studio'), 'fixture_studio');
    for (const value of ['', null, false, [], '../../dar']) assert.throws(() => linkBusinessContext(value), { code: 'business_context_invalid' });
    for (const value of [[], [12], {}, true, 1.5, -1, '12junk', '1e2', Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(positiveRecordId(value), null);
    }
    assert.equal(positiveRecordId('12'), 12);
});

test('invalid related IDs or unregistered SQL tables are rejected before database work', async () => {
    const client = { async query() { assert.fail('Unexpected query'); } };
    await assert.rejects(assertLeadReference(client, 'customers', '12junk', 'dar'), { code: 'invalid_lead_reference' });
    await assert.rejects(assertLeadReference(client, 'bookings', 'x'.repeat(121), 'dar'), { code: 'invalid_lead_reference' });
    await assert.rejects(assertLeadReference(client, 'users', 12, 'dar'), TypeError);
});

test('relationship service does not begin or commit a caller transaction and preserves the operation error after cleanup', async () => {
    const statements = [];
    const client = { async query(sql) { statements.push(sql); return { rows: [] }; } };
    const failure = new Error('fixture operation failed');
    await assert.rejects(withLeadSavepoint(client, 'lead_booking_attach', async () => { throw failure; }), error => error === failure);
    assert.deepEqual(statements, ['SAVEPOINT lead_booking_attach', 'ROLLBACK TO SAVEPOINT lead_booking_attach', 'RELEASE SAVEPOINT lead_booking_attach']);
});

test('savepoint creation outside an active transaction fails before calling the operation', async () => {
    const client = { async query() { throw Object.assign(new Error('no transaction'), { code: '25P01' }); } };
    await assert.rejects(withLeadSavepoint(client, 'lead_booking_ensure', async () => assert.fail('Operation must not run')),
        { code: 'lead_transaction_required', statusCode: 500 });
});

test('failed rollback or release cannot be mistaken for a clean optional handoff', async () => {
    for (const failing of ['ROLLBACK TO SAVEPOINT', 'RELEASE SAVEPOINT']) {
        const client = { async query(sql) {
            if (sql.startsWith(failing)) throw new Error('fixture cleanup failure');
            return { rows: [] };
        } };
        await assert.rejects(withLeadSavepoint(client, 'lead_stage_transition', async () => { throw new Error('fixture operation failure'); }),
            { code: 'lead_savepoint_cleanup_failed', statusCode: 500 });
    }
});

test('a recovered deadlock reports a retryable conflict without retrying inside the caller transaction', async () => {
    const statements = [];
    const client = { async query(sql) { statements.push(sql); return { rows: [] }; } };
    const failure = Object.assign(new Error('fixture PostgreSQL deadlock'), { code: '40P01' });
    let attempts = 0;
    await assert.rejects(withLeadSavepoint(client, 'lead_booking_attach', async () => {
        attempts++;
        throw failure;
    }), error => error.code === 'lead_transaction_conflict' && error.statusCode === 409 && error.cause === failure);
    assert.equal(attempts, 1);
    assert.deepEqual(statements, ['SAVEPOINT lead_booking_attach', 'ROLLBACK TO SAVEPOINT lead_booking_attach', 'RELEASE SAVEPOINT lead_booking_attach']);
});
