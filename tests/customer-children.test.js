const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    CustomerChildrenError,
    LEGACY_CHILD_FIELD_POLICY,
    CUSTOMER_CHILD_DISPLAY_POLICY,
    validateChildBirthday,
    normalizeChildInput,
    listCustomerChildren,
    replaceCustomerChildren,
    buildCustomerChildrenProjection,
    buildLegacyChildSnapshot,
    customerChildrenNameDisplay,
    customerChildrenBirthdayDisplay,
    customerChildrenFullDisplay,
    firstCustomerChild,
    mapCustomerChildRow
} = require('../services/customerChildren');

const ROOT = path.resolve(__dirname, '..');

test('customer child browser smoke command covers live create-detail-search-cleanup flow', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const smoke = fs.readFileSync(path.join(ROOT, 'tests', 'browser', 'customer-child-create-browser-smoke.js'), 'utf8');

    assert.match(pkg.scripts['test:browser:customer-child-create'], /customer-child-create-browser-smoke\.js/);
    assert.match(smoke, /CUSTOMER_CHILD_BROWSER_SMOKE_ALLOW_PRODUCTION/);
    assert.match(smoke, /#addCustomerBtn/);
    assert.match(smoke, /#editAddChildBtn/);
    assert.match(smoke, /#editChildName0/);
    assert.match(smoke, /#saveCustomerBtn/);
    assert.match(smoke, /#customerDetailModal:not\(\.hidden\) #customerDetailContent/);
    assert.match(smoke, /assertSearchContains/);
    assert.match(smoke, /assertSearchDeleted/);
    assert.ok(smoke.includes('no /api/customers 500 responses'));
});

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

test('customer child dietary tags migration is additive and does not backfill free text', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '282_customer_child_dietary_tags.sql'), 'utf8');

    assert.match(sql, /MIGRATION_KIND:\s*schema/i);
    assert.match(sql, /SAFETY:\s*Additive customer_children dietary fields/i);
    assert.match(sql, /OPERATOR_APPROVAL:\s*required/i);
    assert.match(sql, /ROLLBACK:\s*Export customer_children\.dietary_tags/i);
    assert.match(sql, /DATA_SCOPE:\s*No destructive data changes/i);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS dietary_tags TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\]/i);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS dietary_note TEXT/i);
    assert.match(sql, /customer_children_dietary_tags_count_check/i);
    assert.match(sql, /customer_children_dietary_note_length_check/i);
    assert.match(sql, /DROP CONSTRAINT IF EXISTS customer_children_has_data_check/i);
    assert.match(sql, /OR cardinality\(dietary_tags\) > 0/i);
    assert.match(sql, /OR NULLIF\(BTRIM\(COALESCE\(dietary_note, ''\)\), ''\) IS NOT NULL/i);
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_customer_children_dietary_tags_gin/i);
    assert.doesNotMatch(sql, /\bUPDATE\b/i);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(sql, /children?\.note/i);
});

test('legacy child fields policy keeps customer_children as canonical truth', () => {
    const policyDoc = fs.readFileSync(path.join(ROOT, 'docs', 'CUSTOMER_CHILDREN_LEGACY_FIELDS_POLICY_2026-06-23.md'), 'utf8');

    assert.equal(LEGACY_CHILD_FIELD_POLICY.canonicalTruth, 'customer_children');
    assert.equal(LEGACY_CHILD_FIELD_POLICY.mode, 'compatibility_snapshot_only');
    assert.deepEqual(LEGACY_CHILD_FIELD_POLICY.legacyFields, ['customers.child_name', 'customers.child_birthday']);
    assert.match(LEGACY_CHILD_FIELD_POLICY.allowedWriters.customerApi, /replaceCustomerChildren/);
    assert.match(LEGACY_CHILD_FIELD_POLICY.allowedWriters.leadSync, /all lead celebrants/);
    assert.match(LEGACY_CHILD_FIELD_POLICY.allowedWriters.bookingCreate, /creating a new customer/);
    assert.ok(LEGACY_CHILD_FIELD_POLICY.rules.some(rule => /must not overwrite multiple canonical children/i.test(rule)));
    assert.ok(LEGACY_CHILD_FIELD_POLICY.rules.some(rule => /never infer birthday from age/i.test(rule)));

    assert.match(policyDoc, /`customer_children` is the canonical source of truth/);
    assert.match(policyDoc, /compatibility snapshots only/);
    assert.match(policyDoc, /Forbidden Patterns/);
    assert.match(policyDoc, /Creating a fake birthday from age/);
});

test('customer child display policy defines placeholder and printable summary behavior', () => {
    const policyDoc = fs.readFileSync(path.join(ROOT, 'docs', 'CUSTOMER_CHILDREN_DISPLAY_POLICY_2026-06-23.md'), 'utf8');

    assert.equal(CUSTOMER_CHILD_DISPLAY_POLICY.storageTruth, 'customer_children');
    assert.equal(CUSTOMER_CHILD_DISPLAY_POLICY.surfaces.bulkMessageChildName, 'joined_compact_names');
    assert.equal(CUSTOMER_CHILD_DISPLAY_POLICY.surfaces.bulkMessageChildBirthday, 'joined_compact_birthdays');
    assert.equal(CUSTOMER_CHILD_DISPLAY_POLICY.surfaces.birthdayReminders, 'one_row_per_child_birthday');
    assert.equal(CUSTOMER_CHILD_DISPLAY_POLICY.surfaces.banquetSummary, 'full_children_list_with_single_child_compat_celebrant');
    assert.equal(CUSTOMER_CHILD_DISPLAY_POLICY.surfaces.vcardBday, 'first_explicit_birthday_only');
    assert.match(policyDoc, /Bulk message `\{childName\}` \| Compact joined child names/);
    assert.match(policyDoc, /Birthday reminders\/greetings \| One row per child birthday/);
    assert.match(policyDoc, /Do not use first child as storage truth/);
});

test('customer closeout guards duplicate merge and booking legacy create ownership', () => {
    const customersRoute = fs.readFileSync(path.join(ROOT, 'routes', 'customers.js'), 'utf8');
    const bookingsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');
    const policyDoc = fs.readFileSync(path.join(ROOT, 'docs', 'CUSTOMER_CHILDREN_LEGACY_FIELDS_POLICY_2026-06-23.md'), 'utf8');

    assert.match(customersRoute, /UPDATE customer_children[\s\S]*SET customer_id = \$1[\s\S]*WHERE customer_id = \$2[\s\S]*AND business_context = \$3/);
    assert.match(customersRoute, /if \(!primary\.child_name && dup\.child_name\)/);
    assert.match(customersRoute, /if \(!primary\.child_birthday && dup\.child_birthday\)/);
    assert.match(policyDoc, /duplicate merge \| Fill empty legacy snapshot fields/);
    assert.match(policyDoc, /Move `customer_children` rows from duplicate to primary customer/);

    assert.match(bookingsRoute, /INSERT INTO customers \(business_context, name, phone, instagram, child_name, child_birthday, source\)/);
    assert.doesNotMatch(bookingsRoute, /replaceCustomerChildren/);
    assert.doesNotMatch(bookingsRoute, /UPDATE customer_children/i);
    assert.match(policyDoc, /booking customer create \| Write `child_name` \/ `child_birthday` only when creating a brand-new customer/);
    assert.match(policyDoc, /Must not update an existing customer's canonical children from one booking legacy payload/);
});

test('customer children docs and QA artifacts keep UTF-8 child examples readable', () => {
    const relativeFiles = [
        'docs/CUSTOMER_CHILDREN_DATA_SAFETY_INVENTORY_2026-06-23.md',
        'docs/CUSTOMER_CHILDREN_MANUAL_QA_2026-06-23.md',
        'docs/CUSTOMER_CHILDREN_LEGACY_FIELDS_POLICY_2026-06-23.md',
        'docs/CUSTOMER_CHILDREN_DISPLAY_POLICY_2026-06-23.md',
        'docs/CUSTOMER_CHILDREN_INVENTORY_READONLY_2026-06-23.sql',
        'output/playwright/customer-children-manual-qa/harness.html',
        'tests/customer-children.test.js'
    ];
    const mojibakeMarkers = [
        '\u0420\u040e\u0420\u00b0\u0421\u20ac\u0420\u00b0',
        '\u0421\u0452\u0420\u0455\u0420\u0454\u0420\u0451'
    ];
    const readableExampleFiles = [];

    for (const relative of relativeFiles) {
        const fullPath = path.join(ROOT, relative);
        if (!fs.existsSync(fullPath)) {
            continue;
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        const found = mojibakeMarkers.filter(marker => content.includes(marker));
        assert.deepEqual(found, [], `${relative} contains customer-children mojibake markers: ${found.join(', ')}`);

        if (content.includes('Саша 4 роки')) {
            readableExampleFiles.push(relative);
        }
    }

    assert.ok(readableExampleFiles.length >= 3, 'customer-children docs/QA should keep readable "Саша 4 роки" examples');
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
        notes: '  note  ',
        dietaryTags: ['nuts', ' no_nuts ', 'lactose'],
        dietaryNote: '  no peanuts  '
    }), {
        name: 'Sasha',
        birthday: '2019-05-20',
        ageSnapshot: 4,
        note: 'note',
        dietaryTags: ['nuts', 'lactose'],
        dietaryNote: 'no peanuts'
    });

    assert.deepEqual(normalizeChildInput({ name: 'Mia', age: 5 }), {
        name: 'Mia',
        birthday: null,
        ageSnapshot: 5,
        note: null,
        dietaryTags: [],
        dietaryNote: null
    });
    assert.deepEqual(normalizeChildInput({ name: 'Age Only', ageSnapshot: 4 }), {
        name: 'Age Only',
        birthday: null,
        ageSnapshot: 4,
        note: null,
        dietaryTags: [],
        dietaryNote: null
    });
    assert.equal(normalizeChildInput({}), null);
    assert.throws(() => normalizeChildInput({ name: 'Mia', birthday: '2026-13-01' }), CustomerChildrenError);
    assert.throws(() => normalizeChildInput({ birthday: '2019-05-20' }, 0, { requireName: true }), CustomerChildrenError);
});

test('normalizeChildInput validates structured dietary fields separately from general child note', () => {
    assert.deepEqual(normalizeChildInput({
        name: 'Diet Child',
        note: 'seat near parent',
        dietary_tags: 'peanut; dairy_free; sugar_free; peanut',
        allergy_note: 'severe peanut allergy'
    }), {
        name: 'Diet Child',
        birthday: null,
        ageSnapshot: null,
        note: 'seat near parent',
        dietaryTags: ['peanuts', 'dairy', 'sugar'],
        dietaryNote: 'severe peanut allergy'
    });

    assert.deepEqual(normalizeChildInput({
        dietaryNote: 'only dietary detail'
    }), {
        name: null,
        birthday: null,
        ageSnapshot: null,
        note: null,
        dietaryTags: [],
        dietaryNote: 'only dietary detail'
    });

    assert.throws(
        () => normalizeChildInput({ name: 'Bad Tag', dietaryTags: ['***'] }),
        CustomerChildrenError
    );
    assert.throws(
        () => normalizeChildInput({ name: 'Too Many', dietaryTags: Array.from({ length: 21 }, (_, index) => `tag_${index}`) }),
        CustomerChildrenError
    );
});

test('buildLegacyChildSnapshot uses only explicit first-child compatibility data', () => {
    assert.deepEqual(buildLegacyChildSnapshot([
        { name: 'Anna', birthday: '2018-01-01', ageSnapshot: 8 },
        { name: 'Bohdan', birthday: '2019-02-03' },
        { name: 'Sofia', birthday: '2020-03-04' }
    ]), {
        childName: 'Anna',
        childBirthday: '2018-01-01'
    });

    assert.deepEqual(buildLegacyChildSnapshot([
        { name: 'Age Only', ageSnapshot: 4 }
    ]), {
        childName: 'Age Only',
        childBirthday: null
    });

    assert.deepEqual(buildLegacyChildSnapshot([
        { ageSnapshot: 4, note: 'legacy text said 4 years' },
        { name: 'Mia', birthday: '2019-05-20' }
    ]), {
        childName: 'Mia',
        childBirthday: '2019-05-20'
    });

    assert.deepEqual(buildLegacyChildSnapshot([], {
        childName: 'Legacy',
        childBirthday: '2017-07-08'
    }), {
        childName: 'Legacy',
        childBirthday: '2017-07-08'
    });
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
        dietaryTags: [],
        dietaryNote: null,
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

test('manual review rows supersede ambiguous legacy rows while preserving source payload audit', () => {
    const children = buildCustomerChildrenProjection({
        id: 12,
        businessContext: 'event_genix',
        childName: 'Sasha 4 years',
        childBirthday: null
    }, [
        {
            id: 7,
            business_context: 'event_genix',
            customer_id: 12,
            name: 'Sasha',
            birthday: null,
            age_snapshot: 4,
            source_kind: 'legacy_customer_child',
            source_payload: {
                source_columns: { child_name: 'Sasha 4 years', child_birthday: null },
                age_snapshot_from_name: true,
                original_child_name_preserved: true,
                manual_review: {
                    status: 'resolved',
                    superseded: true,
                    resolved_by: 5
                }
            },
            sort_order: 0
        },
        {
            id: 8,
            business_context: 'event_genix',
            customer_id: 12,
            name: 'Sasha',
            birthday: '2019-05-20',
            age_snapshot: 4,
            note: 'manual correction',
            source_kind: 'manual_review',
            source_payload: {
                copy_rule: 'manual_review_resolution',
                source_child_ids: [7],
                original_preserved_in_source_rows: true
            },
            sort_order: 100
        }
    ]);

    assert.equal(children.length, 1);
    assert.equal(children[0].name, 'Sasha');
    assert.equal(children[0].birthday, '2019-05-20');
    assert.equal(children[0].sourceKind, 'manual_review');

    const legacy = mapCustomerChildRow({
        id: 7,
        source_payload: {
            age_snapshot_from_name: true,
            manual_review: { superseded: true, status: 'resolved' }
        }
    });
    assert.equal(legacy.needsReview, true);
    assert.equal(legacy.superseded, true);
    assert.equal(legacy.manualReview.status, 'resolved');
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
    assert.equal(customerChildrenFullDisplay(children), 'Anna (2018-01-01), Bohdan, Sofia (2020-03-04)');
    assert.equal(customerChildrenNameDisplay(children, { limit: 2 }), 'Anna, Bohdan +1');
    assert.equal(customerChildrenFullDisplay(children, { limit: 2 }), 'Anna (2018-01-01), Bohdan +1');
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
                    dietary_tags: ['dairy'],
                    dietary_note: 'no cold milk',
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
    assert.deepEqual(rows[0].dietaryTags, ['dairy']);
    assert.equal(rows[0].dietaryNote, 'no cold milk');

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

test('replaceCustomerChildren uses a provided pg transaction client directly', async () => {
    const calls = [];
    const savedRows = [];
    const client = {
        connect() {
            throw new Error('transaction client must not be used as a pool');
        },
        async query(text, params = []) {
            calls.push({ text, params });
            if (/DELETE FROM customer_children[\s\S]*AND source_kind = \$3/i.test(text)) {
                assert.deepEqual(params, [321, 'event_genix', 'legacy_customer_child']);
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
                    sort_order: params[10],
                    dietary_tags: params[11],
                    dietary_note: params[12]
                });
                return { rows: [], rowCount: 1 };
            }
            if (/FROM customer_children/i.test(text)) {
                return { rows: savedRows.slice() };
            }
            throw new Error(`unexpected query: ${text}`);
        }
    };

    const result = await replaceCustomerChildren(
        321,
        [{ name: 'QA Child', dietaryTags: ['nuts'], dietaryNote: 'no peanuts' }],
        'event_genix',
        {
            sourceKind: 'legacy_customer_child',
            source: 'customers.create',
            copyRule: 'legacy_customer_fields_payload'
        },
        { client }
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'QA Child');
    assert.deepEqual(result[0].dietaryTags, ['nuts']);
    assert.equal(result[0].dietaryNote, 'no peanuts');
    assert.ok(!calls.some(call => /^\s*BEGIN\b|\bCOMMIT\b|\bROLLBACK\b/i.test(call.text)));
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
