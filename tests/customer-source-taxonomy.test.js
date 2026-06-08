const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
    normalizeCustomerSource,
    getCustomerSourceLabel,
    customerSourceSqlExpression
} = require('../services/customerSource');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

function selectBlock(html, id) {
    const match = html.match(new RegExp(`<select[^>]+id="${id}"[\\s\\S]*?<\\/select>`));
    assert.ok(match, `${id} select should exist`);
    return match[0];
}

test('customer source taxonomy uses polished Ukrainian labels in active dropdowns', () => {
    const html = read('customers.html');
    const sourceFilter = selectBlock(html, 'sourceFilter');
    const editSource = selectBlock(html, 'editSource');

    for (const block of [sourceFilter, editSource]) {
        assert.match(block, />За рекомендацією</);
        assert.match(block, />Повторне звернення</);
        assert.match(block, />Сайт Майстерні</);
        assert.match(block, />Бот Майстерні</);
        assert.match(block, />Не вказано</);
        assert.doesNotMatch(block, />Рекомендація</);
        assert.doesNotMatch(block, />Повторний</);
    }
});

test('customer source normalization preserves canonical keys and legacy aliases', () => {
    assert.equal(normalizeCustomerSource('recommendation'), 'recommendation');
    assert.equal(normalizeCustomerSource('Рекомендація'), 'recommendation');
    assert.equal(normalizeCustomerSource('За рекомендацією'), 'recommendation');
    assert.equal(normalizeCustomerSource('Повторний'), 'repeat');
    assert.equal(normalizeCustomerSource('Повторне звернення'), 'repeat');
    assert.equal(normalizeCustomerSource('maysternya_site'), 'maysternya_site');
    assert.equal(normalizeCustomerSource('Сайт Майстерні'), 'maysternya_site');
    assert.equal(normalizeCustomerSource(''), null);
    assert.equal(normalizeCustomerSource('', { unknownAsNull: false }), 'unknown');
    assert.equal(normalizeCustomerSource('some-new-raw-source'), 'other');
    assert.equal(getCustomerSourceLabel('Рекомендація'), 'За рекомендацією');
    assert.equal(getCustomerSourceLabel('Повторний'), 'Повторне звернення');
    assert.equal(getCustomerSourceLabel('maysternya_site'), 'Сайт Майстерні');
    assert.equal(getCustomerSourceLabel(null), 'Не вказано');
    assert.equal(getCustomerSourceLabel('some-new-raw-source'), 'Інше');

    const sql = customerSourceSqlExpression('c.source');
    assert.match(sql, /рекомендація/);
    assert.match(sql, /повторний/);
    assert.match(sql, /maysternya_site/);
    assert.match(sql, /THEN 'recommendation'/);
    assert.match(sql, /THEN 'repeat'/);
});

test('customer UI and routes consume the canonical source helpers', () => {
    const customersJs = read('js', 'customers-page.js');
    const customersRoute = read('routes', 'customers.js');
    const bookingsRoute = read('routes', 'bookings.js');
    const leadsRoute = read('routes', 'leads.js');

    assert.match(customersJs, /function getCustomerSourceLabel/);
    assert.match(customersJs, /function normalizeCustomerSource/);
    assert.doesNotMatch(customersJs, /SOURCE_LABELS\[c\.source\]\s*\|\|\s*c\.source/);
    assert.doesNotMatch(customersJs, /escapeHtml\(customer\.source\)/);
    assert.match(customersRoute, /customerSourceSqlExpression\('c\.source'\)/);
    assert.match(customersRoute, /normalizeCustomerSource\(body\.source\)/);
    assert.match(bookingsRoute, /normalizeCustomerSource\(c\.source\)/);
    assert.match(leadsRoute, /normalizeCustomerSource\(lead\.source/);
});
