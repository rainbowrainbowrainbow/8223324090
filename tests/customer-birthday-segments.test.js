'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const birthdays = require('../services/customerBirthdaySegments');
const { syncBirthdayTagsForAllCustomers } = require('../services/customerBirthdayTags');

const childModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/customerChildren.js'), 'utf8'), {
    module: childModule,
    require: id => id === '../db' ? { pool: {} } : require(path.resolve(__dirname, '../services', id))
});
const { buildCustomerChildrenProjection } = childModule.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const family = { id: 7, business_context: 'dar', child_name: 'Old', child_birthday: '2018-07-01' };
const children = [
    { id: 1, customer_id: 7, business_context: 'dar', name: 'Anna', birthday: '2020-03-12' },
    { id: 2, customer_id: 7, business_context: 'dar', name: 'Ivan', birthday: '2021-10-15' },
    { id: 3, customer_id: 7, business_context: 'dar', name: 'Eva', birthday: '2020-10-17' },
    { id: 4, customer_id: 7, business_context: 'dar', birthday: '2020-10-18', source_payload: { manual_review: { status: 'superseded' } } },
    { id: 5, customer_id: 7, business_context: 'dar', name: 'No date', birthday: null }
];

test('a family belongs to both months; two birthdays do not duplicate the family', () => {
    const projected = buildCustomerChildrenProjection(family, children);
    for (const [tag, count, names] of [
        ['Іменинники березня', 1, ['Anna']], ['birthday_month_10', 2, ['Ivan', 'Eva']]
    ]) {
        const selection = birthdays.birthdaySelection([tag]);
        const selected = birthdays.selectedBirthdayChildren(projected, selection, 'dar');
        assert.equal(selected.length, count);
        assert.deepEqual(plain(selected.map(child => child.name)), names);
    }
    assert.deepEqual(birthdays.birthdaySystemTagsForChildren(projected).map(tag => tag.systemKey),
        ['birthday', 'birthday_month_03', 'birthday_month_10']);
});

test('clearing dates and superseding all records cannot resurrect the legacy birthday', () => {
    for (const rows of [
        [{ ...children[0], birthday: null }],
        [{ ...children[0], source_payload: { manual_review: { superseded: true } } }],
        [{ ...children[0], source_payload: { manual_review: { status: 'superseded' } } }]
    ]) {
        const projection = buildCustomerChildrenProjection(family, rows);
        assert.equal(birthdays.selectedBirthdayChildren(projection, null).length, 0);
    }
    assert.equal(birthdays.selectedBirthdayChildren(buildCustomerChildrenProjection(family, []), null).length, 1);
});

test('month changes are immediate and foreign-business children are excluded', () => {
    const month = birthdays.birthdaySelection(['birthday_month_03']);
    const projected = buildCustomerChildrenProjection(family, [children[0]]);
    assert.equal(birthdays.selectedBirthdayChildren(projected, month, 'dar').length, 1);
    projected[0].birthday = '2020-10-12';
    assert.equal(birthdays.selectedBirthdayChildren(projected, month, 'dar').length, 0);
    projected[0].birthday = '2020-03-12';
    projected[0].businessContext = 'event_genix';
    assert.equal(birthdays.selectedBirthdayChildren(projected, month, 'dar').length, 0);
    const ownAndForeign = buildCustomerChildrenProjection(family, [children[0], { ...children[1], business_context: 'event_genix' }]);
    assert.deepEqual(plain(ownAndForeign.map(child => child.name)), ['Anna']);
});

test('February 29 is a February birthday; missing dates are never inferred', () => {
    const selected = birthdays.selectedBirthdayChildren([
        { birthday: '2020-02-29', name: null }, { name: 'Age only', ageSnapshot: 6 }, { birthday: null }
    ], birthdays.birthdaySelection(['Іменинники лютого']));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].name, null);
    assert.equal(selected[0].birthday, '2020-02-29');
});

test('live tag projection removes stale system months and preserves every manual tag', () => {
    const manual = { id: 91, tag: 'Іменинник', source: 'manual', color: '#123456' };
    const tags = birthdays.currentCustomerBirthdayTags([
        manual, { id: 92, tag: 'VIP', source: 'manual' },
        { tag: 'Іменинники липня', source: 'system', systemKey: 'birthday_month_07' }
    ], buildCustomerChildrenProjection(family, children));
    assert.equal(tags[0], manual);
    assert.equal(tags.filter(tag => tag.tag === 'Іменинник').length, 1);
    assert.ok(!tags.some(tag => tag.systemKey === 'birthday_month_07'));
    assert.ok(tags.some(tag => tag.systemKey === 'birthday_month_10'));
    assert.ok(tags.some(tag => tag.tag === 'VIP'));
});

test('labels and keys produce one identical predicate; SQL has no first-child limit', () => {
    const byLabel = birthdays.customerBirthdayTagFilterSql(['Іменинники жовтня'], []);
    const byKey = birthdays.customerBirthdayTagFilterSql(['birthday_month_10'], []);
    assert.deepEqual(byLabel, byKey);
    assert.match(byLabel.join, /ARRAY\[10\]/);
    assert.match(byLabel.join, /NOT EXISTS/);
    assert.match(byLabel.join, /history.business_context/);
    assert.match(byLabel.join, /manual_review,status/);
    assert.doesNotMatch(byLabel.join, /LIMIT\s+1/i);
    const params = ['dar'];
    const mixed = birthdays.customerBirthdayTagFilterSql(['VIP', 'birthday_month_10', "x'); DELETE"], params);
    assert.deepEqual(params, ['dar', ['VIP', "x'); DELETE"]]);
    assert.doesNotMatch(mixed.join, /DELETE/);
    assert.match(mixed.condition, / OR /);
});

test('live catalog zero counts override old counts and automatic tags stay out of manual tools', () => {
    const source = fs.readFileSync(path.join(__dirname, '../js/customers-page.js'), 'utf8');
    const start = source.indexOf('function normalizeCustomerTagCatalogItem(');
    const end = source.indexOf('function renderCustomerTagOptions(', start);
    const context = vm.createContext({
        BIRTHDAY_SYSTEM_TAGS: birthdays.BIRTHDAY_SYSTEM_TAG_KEYS.map(birthdays.birthdaySystemTag),
        CrmState: { predefinedTags: [{ tag: 'Іменинники жовтня', count: 9 }], tags: [
            { ...birthdays.birthdaySystemTag('birthday_month_10'), liveBirthday: true, count: 0 },
            { tag: 'VIP', source: 'manual', count: 3 }
        ] }
    });
    vm.runInContext(source.slice(start, end), context);
    assert.deepEqual(plain(context.getCustomerTagCatalog().map(tag => tag.tag)), ['VIP']);
    const filters = context.getCustomerTagCatalog({ includeBirthdaySystemTags: true });
    assert.equal(filters.find(tag => tag.tag === 'Іменинники жовтня').count, 0);
    assert.equal(filters.find(tag => tag.tag === 'VIP').count, 3);
});

test('mass synchronization refuses before obtaining a pool or running SQL', async () => {
    const pool = { query() { assert.fail('no queries'); }, connect() { assert.fail('no connections'); } };
    for (const options of [{}, { pool }, { pool, allowReconciliation: 'true' }]) {
        const result = await syncBirthdayTagsForAllCustomers(options);
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'explicit_reconciliation_required');
        assert.equal(result.processed, 0);
    }
});

test('the actual scheduled handler cannot reconcile tags or write the completion marker', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../services/scheduler.js'), 'utf8');
    const start = source.indexOf('async function checkBirthdayTagSync()');
    const end = source.indexOf('module.exports =', start);
    const warnings = [];
    const context = vm.createContext({
        require: id => { assert.equal(id, './customerBirthdayTags'); return { syncBirthdayTagsForAllCustomers }; },
        pool: { query() { assert.fail('no tag or child queries'); } },
        CUSTOMER_BIRTHDAY_TAGS_BACKFILL_SETTING_KEY: 'test_marker',
        getSettingValue: async () => null,
        setSettingValue: async () => assert.fail('no marker writes'),
        log: { info() {}, error(error) { assert.fail(String(error)); }, warn(message, data) { warnings.push(data); } }
    });
    vm.runInContext(source.slice(start, end), context);
    await context.checkBirthdayTagSync();
    assert.equal(warnings[0].reason, 'explicit_reconciliation_required');
});
