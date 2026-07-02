const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCustomerSearchQuery } = require('../services/customerSearchQuery');

test('customer search query mirrors /api/customers/search matching rules', () => {
    const query = buildCustomerSearchQuery({
        query: '@Beli',
        businessContext: 'event_genix',
        user: { role: 'reception' },
        includeSocialIdentities: true
    });

    assert.ok(query);
    assert.match(query.sql, /c\.name ILIKE \$1/);
    assert.match(query.sql, /c\.phone ILIKE \$1/);
    assert.match(query.sql, /c\.instagram ILIKE \$1/);
    assert.match(query.sql, /c\.child_name ILIKE \$1/);
    assert.match(query.sql, /FROM customer_children cc_search/);
    assert.match(query.sql, /c\.social_identities::text ILIKE \$1/);
    assert.match(query.sql, /c\.instagram ILIKE \$2/);
    assert.deepEqual(query.params.slice(0, 2), ['%@Beli%', '%Beli%']);
});

test('customer search query includes normalized phone digit search only when useful', () => {
    const query = buildCustomerSearchQuery({
        query: '+38 (097) 426',
        businessContext: 'event_genix',
        user: { role: 'reception' },
        includeSocialIdentities: false
    });

    assert.ok(query);
    assert.match(query.sql, /regexp_replace\(COALESCE\(c\.phone, ''\), '\\D', '', 'g'\) ILIKE \$2/);
    assert.doesNotMatch(query.sql, /social_identities/);
    assert.equal(query.params[1], '%38097426%');
});

test('customer search query returns null for route-level short searches', () => {
    assert.equal(buildCustomerSearchQuery({ query: 'X' }), null);
});

test('customers route uses the shared search query builder', () => {
    const routeCode = fs.readFileSync(path.join(__dirname, '..', 'routes', 'customers.js'), 'utf8');
    assert.match(routeCode, /buildCustomerSearchQuery/);
    assert.doesNotMatch(routeCode, /const normalizedPhoneSql = phoneDigits\.length >= 2/);
});
