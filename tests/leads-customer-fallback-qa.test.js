'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../js/leads-page.js'), 'utf8');
const start = source.indexOf('function leadCustomerFallbackQueries(');
const end = source.indexOf('function leadCustomerFallbackChildrenText(', start);
assert.ok(start >= 0 && end > start);

function fixture(transport) {
    const calls = [], warnings = [];
    const context = vm.createContext({
        URLSearchParams,
        LEAD_CUSTOMER_FALLBACK_LIMIT: 3,
        getAuthHeaders: json => { assert.equal(json, false); return { 'X-Fixture-Auth': 'synthetic' }; },
        leadApiUrl: url => `${url}&businessContext=dar`,
        normalizeLeadCustomerOption: customer => customer?.id ? customer : null,
        console: { warn: (...args) => warnings.push(args) },
        fetch: async (url, options) => {
            assert.equal(options.method || 'GET', 'GET');
            assert.equal(options.body, undefined);
            assert.equal(options.headers['X-Fixture-Auth'], 'synthetic');
            assert.equal(new URL(url, 'http://fixture').searchParams.get('businessContext'), 'dar');
            calls.push(url);
            return transport(calls.length);
        }
    });
    vm.runInContext(source.slice(start, end), context);
    return { context, calls, warnings };
}

test('lead customer fallback reaches a scoped GET with the shared header helper', async () => {
    const f = fixture(async () => ({ ok: true, status: 200, json: async () => [{ id: 7, name: 'Synthetic customer' }] }));
    const matches = await f.context.loadLeadCustomerSearchFallback('Synthetic');
    assert.equal(f.calls.length, 1);
    assert.deepEqual(Array.from(matches, c => c.id), [7]);
    assert.equal(f.warnings.length, 0);
});

test('lead customer fallback deduplicates queries/results and respects the result limit', async () => {
    const f = fixture(async n => ({ ok: true, status: 200, json: async () => n === 1 ? [{ id: 7 }] : { customers: [{ id: 7 }, { id: 8 }, { id: 9 }, { id: 10 }] } }));
    const matches = await f.context.loadLeadCustomerSearchFallback('Synthetic Customer');
    assert.equal(f.calls.length, 2);
    assert.deepEqual(Array.from(matches, c => c.id), [7, 8, 9]);
});

test('a failed customer fallback never fabricates a customer match', async () => {
    const f = fixture(async () => ({ ok: false, status: 500, json: async () => [{ id: 7 }] }));
    const matches = await f.context.loadLeadCustomerSearchFallback('Synthetic');
    assert.equal(f.calls.length, 1);
    assert.equal(matches.length, 0);
});
