const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    CustomerChildrenError,
    validateChildBirthday,
    normalizeChildInput,
    listCustomerChildren,
    replaceCustomerChildren,
    buildCustomerChildrenProjection,
    customerChildrenNameDisplay,
    customerChildrenBirthdayDisplay,
    firstCustomerChild,
    mapCustomerChildRow
} = require('../services/customerChildren');

const ROOT = path.resolve(__dirname, '..');

test('customer_children migration is additive idempotent and preserves source data', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '270_customer_children.sql'), 'utf8');

    assert.match(sql, /MIGRATION_KIND:\s*mixed/);
    assert.match(sql, /SAFETY:\s*Additive customer_children table/i);
    assert.match(sql, /ROLLBACK:\s*Export customer_children/i);
    assert.match(sql, /DATA_SCOPE:\s*customers\.child_name\/customers\.child_birthday and explicit leads\.celebrants/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS customer_children/i);
    assert.match(sql, /source_payload\s+JSONB NOT NULL DEFAULT '\{\}'::jsonb/i);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_customer_children_business_customer/i);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_children_legacy_customer_unique/i);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_children_lead_celebrant_unique/i);
    assert.match(sql, /source_kind,\s*source_payload,\s*sort_order[\s\S]*'legacy_customer_child'/i);
    assert.match(sql, /source_kind,\s*source_payload,\s*sort_order[\s\S]*'lead_celebrant'/i);
    assert.match(sql, /'source_columns', jsonb_build_object\([\s\S]*'child_name'[\s\S]*'child_birthday'/i);
    assert.match(sql, /'original_child_name_preserved', true/i);
    assert.match(sql, /'birthday_rejected', lcn\.birthday_text IS NOT NULL AND lcn\.normalized_birthday IS NULL/i);
    assert.match(sql, /WHERE NOT EXISTS \(/i);
    assert.doesNotMatch(sql, /\bUPDATE\s+customers\b/i);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+customers\b/i);
    assert.doesNotMatch(sql, /make_date\([^)]*age/i);
});

test('validateChildBirthday accepts only timezone-safe YYYY-MM-DD calendar dates', () => {
    assert.equal(validateChildBirthday('2019-05-20'), '2019-05-20');
    assert.equal(validateChildBirthday(''), null);
    assert.equal(validateChildBirthday(null), null);
    assert.throws(() => validateChildBirthday('20.05.2019'), CustomerChildrenError);
    assert.throws(() => validateChildBirthday('2019-02-29'), CustomerChildrenError);
});

test('mapCustomerChildRow keeps YYYY-MM-DD birthdays stable after reload mapping', () => {
    assert.equal(mapCustomerChildRow({ birthday: '2018-01-01T23:00:00.000Z' }).birthday, '2018-01-01');
    assert.equal(mapCustomerChildRow({ birthday: new Date(Date.UTC(2020, 2, 4, 0, 0, 0)) }).birthday, '2020-03-04');
});

test('normalizeChildInput preserves explicit fields without inventing birthday from age', () => {
    assert.deepEqual(normalizeChildInput({
        name: '  Sasha  ',
        birthday: '2019-05-20',
        ageSnapshot: '4',
        notes: '  note  '
    }), {
        name: 'Sasha',
        birthday: '2019-05-20',
        ageSnapshot: 4,
        note: 'note'
    });

    assert.deepEqual(normalizeChildInput({ name: 'Mia', age: 5 }), {
        name: 'Mia',
        birthday: null,
        ageSnapshot: 5,
        note: null
    });
    assert.deepEqual(normalizeChildInput({ name: 'Age Only', ageSnapshot: 4 }), {
        name: 'Age Only',
        birthday: null,
        ageSnapshot: 4,
        note: null
    });
    assert.equal(normalizeChildInput({}), null);
    assert.throws(() => normalizeChildInput({ name: 'Mia', birthday: '2026-13-01' }), CustomerChildrenError);
    assert.throws(() => normalizeChildInput({ birthday: '2019-05-20' }, 0, { requireName: true }), CustomerChildrenError);
});

test('ambiguous legacy child text is projected as data, not as a fake birthday', () => {
    const children = buildCustomerChildrenProjection({
        id: 17,
        businessContext: 'event_genix',
        childName: 'Саша 4 роки',
        childBirthday: null
    }, []);

    assert.equal(children.length, 1);
    assert.equal(children[0].name, 'Саша 4 роки');
    assert.equal(children[0].birthday, null);
    assert.equal(children[0].ageSnapshot, null);
    assert.equal(children[0].sourceKind, 'legacy_customer_fields');
    assert.deepEqual(children[0].sourcePayload.source_table, 'customers');
});

test('buildCustomerChildrenProjection falls back to legacy customer fields only when canonical rows are missing', () => {
    const customer = {
        id: 12,
        businessContext: 'event_genix',
        leadId: 34,
        childName: 'Legacy Child',
        childBirthday: '2020-06-01'
    };

    assert.deepEqual(buildCustomerChildrenProjection(customer, []), [{
        id: null,
        businessContext: 'event_genix',
        customerId: 12,
        leadId: 34,
        bookingId: null,
        name: 'Legacy Child',
        birthday: '2020-06-01',
        ageSnapshot: null,
        note: null,
        sourceKind: 'legacy_customer_fields',
        sourcePayload: {
            source_table: 'customers',
            child_name: 'Legacy Child',
            child_birthday: '2020-06-01',
            fallback_projection: true
        },
        sortOrder: 0,
        createdAt: null,
        updatedAt: null,
        legacy: true
    }]);

    const canonical = buildCustomerChildrenProjection(customer, [{
        id: 7,
        business_context: 'event_genix',
        customer_id: 12,
        lead_id: 34,
        name: 'Canonical Child',
        birthday: '2019-01-02',
        age_snapshot: null,
        note: null,
        source_kind: 'lead_celebrant',
        source_payload: { source_table: 'leads' },
        sort_order: 10
    }]);
    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].name, 'Canonical Child');
    assert.equal(canonical[0].sourceKind, 'lead_celebrant');
});

test('customer children display helpers preserve multi-child projection for legacy consumers', () => {
    const children = buildCustomerChildrenProjection({
        id: 12,
        childName: 'Legacy',
        childBirthday: '2020-01-01'
    }, [
        { name: 'Anna', birthday: '2018-01-01', sort_order: 0 },
        { name: 'Bohdan', birthday: null, sort_order: 1 },
        { name: 'Sofia', birthday: '2020-03-04', sort_order: 2 }
    ]);

    assert.equal(firstCustomerChild(children).name, 'Anna');
    assert.equal(customerChildrenNameDisplay(children), 'Anna, Bohdan, Sofia');
    assert.equal(customerChildrenBirthdayDisplay(children), '2018-01-01, 2020-03-04');
    assert.equal(customerChildrenNameDisplay(children, { limit: 2 }), 'Anna, Bohdan +1');
});

test('listCustomerChildren maps canonical rows and falls back cleanly when storage is absent', async () => {
    const db = {
        async query(text, params) {
            assert.match(text, /FROM customer_children/);
            assert.deepEqual(params, [12, 'event_genix']);
            return {
                rows: [{
                    id: 1,
                    business_context: 'event_genix',
                    customer_id: 12,
                    lead_id: 34,
                    booking_id: null,
                    name: 'Anna',
                    birthday: '2018-03-04',
                    age_snapshot: 6,
                    note: 'prefers cake',
                    source_kind: 'lead_celebrant',
                    source_payload: { source_table: 'leads' },
                    sort_order: 10,
                    created_at: '2026-06-23T10:00:00.000Z',
                    updated_at: '2026-06-23T10:00:00.000Z'
                }]
            };
        }
    };

    const rows = await listCustomerChildren(12, 'event_genix', { db });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Anna');
    assert.equal(rows[0].birthday, '2018-03-04');
    assert.equal(rows[0].ageSnapshot, 6);

    const missingDb = {
        async query() {
            const err = new Error('relation "customer_children" does not exist');
            err.code = '42P01';
            throw err;
        }
    };
    assert.deepEqual(await listCustomerChildren(12, 'event_genix', { db: missingDb }), []);
});

test('replaceCustomerChildren validates children before writing', async () => {
    let called = false;
    const db = {
        async query() {
            called = true;
        }
    };
    await assert.rejects(
        () => replaceCustomerChildren(12, [{ name: 'Bad Date', birthday: '2026-99-99' }], 'event_genix', {}, { db }),
        CustomerChildrenError
    );
    assert.equal(called, false);
});

test('replaceCustomerChildren replaces customer truth and returns all saved children', async () => {
    const calls = [];
    const savedRows = [];
    const db = {
        async query(text, params = []) {
            calls.push({ text, params });
            if (/DELETE FROM customer_children[\s\S]*WHERE customer_id = \$1[\s\S]*AND business_context = \$2\s*$/i.test(text)) {
                assert.deepEqual(params, [12, 'event_genix']);
                savedRows.length = 0;
                return { rows: [], rowCount: 0 };
            }
            if (/INSERT INTO customer_children/i.test(text)) {
                savedRows.push({
                    id: savedRows.length + 1,
                    business_context: params[0],
                    customer_id: params[1],
                    lead_id: params[2],
                    booking_id: params[3],
                    name: params[4],
                    birthday: params[5],
                    age_snapshot: params[6],
                    note: params[7],
                    source_kind: params[8],
                    source_payload: JSON.parse(params[9]),
                    sort_order: params[10]
                });
                return { rows: [], rowCount: 1 };
            }
            if (/FROM customer_children/i.test(text)) {
                return {
                    rows: savedRows
                        .slice()
                        .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id))
                };
            }
            throw new Error(`unexpected query: ${text}`);
        }
    };

    const result = await replaceCustomerChildren(
        12,
        [
            { name: 'Anna', birthday: '2018-01-01', ageSnapshot: 8 },
            { name: 'Bohdan', birthday: null, ageSnapshot: '6', note: 'allergy note' },
            { name: 'Sofia', birthday: '2020-03-04' }
        ],
        'event_genix',
        {
            sourceKind: 'customer_api',
            source: 'customers.test',
            copyRule: 'explicit_children_payload',
            requireName: true,
            replaceAllForCustomer: true
        },
        { db }
    );

    assert.equal(result.length, 3);
    assert.deepEqual(result.map(child => child.name), ['Anna', 'Bohdan', 'Sofia']);
    assert.ok(calls.some(call => /DELETE FROM customer_children[\s\S]*AND business_context = \$2\s*$/i.test(call.text)));
    assert.equal(calls.filter(call => /INSERT INTO customer_children/i.test(call.text)).length, 3);
});

test('replaceCustomerChildren can replace only one source without truncating explicit rows', async () => {
    const calls = [];
    const savedRows = [
        {
            id: 1,
            business_context: 'event_genix',
            customer_id: 12,
            name: 'Anna',
            birthday: '2018-01-01',
            age_snapshot: 8,
            note: null,
            source_kind: 'customer_api',
            source_payload: {},
            sort_order: 0
        },
        {
            id: 2,
            business_context: 'event_genix',
            customer_id: 12,
            name: 'Old Legacy',
            birthday: null,
            age_snapshot: null,
            note: null,
            source_kind: 'legacy_customer_child',
            source_payload: {},
            sort_order: 0
        }
    ];
    const db = {
        async query(text, params = []) {
            calls.push({ text, params });
            if (/DELETE FROM customer_children[\s\S]*AND source_kind = \$3/i.test(text)) {
                assert.deepEqual(params, [12, 'event_genix', 'legacy_customer_child']);
                for (let index = savedRows.length - 1; index >= 0; index--) {
                    if (savedRows[index].source_kind === params[2]) savedRows.splice(index, 1);
                }
                return { rows: [], rowCount: 1 };
            }
            if (/INSERT INTO customer_children/i.test(text)) {
                savedRows.push({
                    id: savedRows.length + 1,
                    business_context: params[0],
                    customer_id: params[1],
                    lead_id: params[2],
                    booking_id: params[3],
                    name: params[4],
                    birthday: params[5],
                    age_snapshot: params[6],
                    note: params[7],
                    source_kind: params[8],
                    source_payload: JSON.parse(params[9]),
                    sort_order: params[10]
                });
                return { rows: [], rowCount: 1 };
            }
            if (/FROM customer_children/i.test(text)) {
                return {
                    rows: savedRows
                        .slice()
                        .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id))
                };
            }
            throw new Error(`unexpected query: ${text}`);
        }
    };

    const result = await replaceCustomerChildren(
        12,
        [{ name: 'New Legacy', birthday: null }],
        'event_genix',
        {
            sourceKind: 'legacy_customer_child',
            source: 'customers.test',
            copyRule: 'legacy_customer_fields_payload'
        },
        { db }
    );

    assert.ok(calls.some(call => /AND source_kind = \$3/i.test(call.text)));
    assert.deepEqual(result.map(child => child.name), ['Anna', 'New Legacy']);
});

test('replaceCustomerChildren can scope lead celebrant replacement to one lead', async () => {
    const calls = [];
    const savedRows = [
        {
            id: 1,
            business_context: 'event_genix',
            customer_id: 12,
            lead_id: 34,
            name: 'Old Lead Child',
            birthday: null,
            age_snapshot: null,
            note: null,
            source_kind: 'lead_celebrant',
            source_payload: { source_lead_id: 34 },
            sort_order: 10
        },
        {
            id: 2,
            business_context: 'event_genix',
            customer_id: 12,
            lead_id: 35,
            name: 'Other Lead Child',
            birthday: null,
            age_snapshot: null,
            note: null,
            source_kind: 'lead_celebrant',
            source_payload: { source_lead_id: 35 },
            sort_order: 10
        },
        {
            id: 3,
            business_context: 'event_genix',
            customer_id: 12,
            lead_id: null,
            name: 'Manual Child',
            birthday: null,
            age_snapshot: null,
            note: null,
            source_kind: 'customer_api',
            source_payload: {},
            sort_order: 0
        }
    ];
    const db = {
        async query(text, params = []) {
            calls.push({ text, params });
            if (/DELETE FROM customer_children[\s\S]*AND source_kind = \$3[\s\S]*AND lead_id = \$4/i.test(text)) {
                assert.deepEqual(params, [12, 'event_genix', 'lead_celebrant', 34]);
                for (let index = savedRows.length - 1; index >= 0; index--) {
                    if (savedRows[index].source_kind === params[2] && savedRows[index].lead_id === params[3]) {
                        savedRows.splice(index, 1);
                    }
                }
                return { rows: [], rowCount: 1 };
            }
            if (/INSERT INTO customer_children/i.test(text)) {
                savedRows.push({
                    id: savedRows.length + 1,
                    business_context: params[0],
                    customer_id: params[1],
                    lead_id: params[2],
                    booking_id: params[3],
                    name: params[4],
                    birthday: params[5],
                    age_snapshot: params[6],
                    note: params[7],
                    source_kind: params[8],
                    source_payload: JSON.parse(params[9]),
                    sort_order: params[10]
                });
                return { rows: [], rowCount: 1 };
            }
            if (/FROM customer_children/i.test(text)) {
                return {
                    rows: savedRows
                        .slice()
                        .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id))
                };
            }
            throw new Error(`unexpected query: ${text}`);
        }
    };

    const result = await replaceCustomerChildren(
        12,
        [{ name: 'New Lead Child', birthday: '2019-01-02' }],
        'event_genix',
        {
            sourceKind: 'lead_celebrant',
            sourceLeadId: 34,
            source: 'leads.celebrants',
            sortOrderBase: 10,
            sourcePayload: { lead_celebrants: [{ name: 'New Lead Child' }] }
        },
        { db }
    );

    assert.ok(calls.some(call => /AND lead_id = \$4/i.test(call.text)));
    assert.deepEqual(result.map(child => child.name), ['Manual Child', 'Other Lead Child', 'New Lead Child']);
    const newChild = result.find(child => child.name === 'New Lead Child');
    assert.equal(newChild.leadId, 34);
    assert.deepEqual(newChild.sourcePayload.lead_celebrants, [{ name: 'New Lead Child' }]);
});
