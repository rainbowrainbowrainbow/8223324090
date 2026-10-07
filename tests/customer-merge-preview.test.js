'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { CustomerMergeError, validateMergeInput, mergeIdentities, customerProfileConflicts,
    readMergeSchema, publicCustomerMergePlan, previewCustomerMerge } = require('../services/customerMerge');

test('merge preview rejects malformed pairs and business contexts before acquiring a client', async () => {
    let connects = 0;
    const pool = { connect() { connects++; throw new Error('Unexpected client'); } };
    for (const value of [null, undefined, '', '1e2', ' 2', true, {}, [], 0, -2, 1.2, 'NaN', 2147483648]) {
        await assert.rejects(previewCustomerMerge(pool, 1, value, 'event_genix'), error => error.code === 'CUSTOMER_MERGE_INVALID_PAIR');
    }
    for (const context of ['all', 'park', '..', '', null]) {
        await assert.rejects(previewCustomerMerge(pool, 1, 2, context), error => error.code === 'CUSTOMER_MERGE_INVALID_CONTEXT');
    }
    await assert.rejects(previewCustomerMerge(pool, 1, 1, 'event_genix'), CustomerMergeError);
    assert.equal(connects, 0);
    assert.equal(validateMergeInput(1, 2, 'future_business').businessContext, 'future_business');
    assert.deepEqual(validateMergeInput('1', '2', 'dar'), { primaryId: 1, duplicateId: 2, businessContext: 'dar' });
});

test('profile review preserves channel identity and blocks conflicting or unsupported information', () => {
    const a = { channel: 'whatsapp', handle: '+380000000001' };
    const b = { channel: 'instagram', handle: 'fixture' };
    assert.deepEqual(mergeIdentities([a], [a, b]), [a, b]);
    assert.throws(() => mergeIdentities([a], [{ ...a, verified: true }]), /різні дані/);
    assert.throws(() => mergeIdentities([], [{}]), /уточнення/);
    assert.throws(() => mergeIdentities({}, []), /уточнення/);
    assert.throws(() => mergeIdentities([], Array.from({ length: 13 }, (_, n) => ({ channel: 'email', handle: 'fixture' + n }))), /12/);
    assert.deepEqual(customerProfileConflicts({ phone: '+380 (00) 01', instagram: '@Fixture' }, { phone: '3800001', instagram: 'fixture' }), []);
    assert.ok(customerProfileConflicts({ phone: '100' }, { phone: '200' }).some(row => row.code === 'CUSTOMER_MERGE_CONTACT_CONFLICT'));
    assert.ok(customerProfileConflicts({}, { custom_note: 'Keep this' }).some(row => row.code === 'CUSTOMER_MERGE_PROFILE_FIELD_UNSUPPORTED'));
});

test('schema review recognizes typed references and refuses unknown or noncanonical foreign keys', async () => {
    const client = { async query(sql) {
        if (sql.includes('information_schema')) return { rows: [
            { table_name: 'unknown_jobs', columns: ['id', 'source_entity_type', 'source_entity_id'] },
            { table_name: 'view_customers', columns: ['id', 'customer_id'] }
        ] };
        if (sql.includes('pg_constraint')) return { rows: [
            { schema_name: 'public', table_name: 'bookings', columns: ['customer_id'], referenced_columns: ['id'] },
            { schema_name: 'public', table_name: 'customer_tags', columns: ['customer_id'], referenced_columns: ['legacy_id'] }
        ] };
        return { rows: [{ relkind: sql && arguments[1][0].includes('view') ? 'v' : 'r' }] };
    } };
    const schema = await readMergeSchema(client);
    assert.deepEqual(schema.unknown, ['customer_tags', 'unknown_jobs']);
    assert.deepEqual([...schema.customerForeignKeys], ['bookings']);
});

test('successful review is never exposed as permission to merge and hides financial values', () => {
    const plan = { primary: { id: 1, name: 'Fixture', total_spent: 987654 }, duplicate: { id: 2, name: 'Fixture', notes: 'private', total_spent: 123456 },
        input: { businessContext: 'dar' }, blockers: [], references: [
            { table: 'bookings', label: 'Бронювання', mode: 'transfer', duplicate_count: 2 },
            { table: 'certificates', label: 'Захищені записи', mode: 'protected', duplicate_count: 1 }
        ] };
    const result = publicCustomerMergePlan(plan);
    assert.equal(result.canMerge, false);
    assert.equal(result.changesPerformed, false);
    assert.equal(result.reviewPassed, true);
    assert.equal(result.records.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /987654|123456|private|certificates/);
    assert.equal('previewKey' in result, false);
});

test('preview rolls back failures, uses PostgreSQL read-only transaction and releases its client', async () => {
    const queries = [];
    let released = 0;
    const client = { async query(sql) {
        queries.push(sql);
        if (sql.includes('SELECT * FROM customers')) throw Object.assign(new Error('Synthetic query failure'), { code: 'XX000' });
        return { rows: [] };
    }, release() { released++; } };
    await assert.rejects(previewCustomerMerge({ connect: async () => client }, 1, 2, 'event_genix'), /Synthetic/);
    assert.match(queries[0], /REPEATABLE READ READ ONLY/);
    assert.ok(queries.some(sql => sql.includes('lock_timeout')));
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.equal(released, 1);
    assert.ok(queries.every(sql => !/^(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(sql)));
});
