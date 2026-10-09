'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');

function loadAnalytics(pool = { query: async () => { throw new Error('Unexpected database query'); } }) {
    const filename = path.join(__dirname, '../routes/analytics.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    const context = { module, exports: module.exports, Date, console, process, Buffer,
        require(id) { return id === '../db' ? { pool } : realRequire(id); } };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.testHelpers = { getPrevRange, getRequestDateRange };', context, { filename });
    return module.exports;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('previous complete months and years use calendar boundaries in UTC and Kyiv', () => {
    const previousTz = process.env.TZ;
    try {
        for (const timezone of ['UTC', 'Europe/Kyiv', 'America/Los_Angeles']) {
            process.env.TZ = timezone;
            const { getPrevRange } = loadAnalytics().testHelpers;
            for (const [from, to, expectedFrom, expectedTo] of [
                ['2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30'],
                ['2024-03-01', '2024-03-31', '2024-02-01', '2024-02-29'],
                ['2025-01-01', '2025-12-31', '2024-01-01', '2024-12-31'],
                ['2026-01-01', '2026-03-31', '2025-10-01', '2025-12-31']
            ]) {
                const previous = getPrevRange(from, to);
                assert.equal(previous.from, expectedFrom, timezone + ' ' + from);
                assert.equal(previous.to, expectedTo, timezone + ' ' + to);
                assert.equal(previous.basis, 'calendar-months');
            }
        }
    } finally {
        if (previousTz === undefined) delete process.env.TZ;
        else process.env.TZ = previousTz;
    }
});

test('custom and partial periods use exactly the same number of dates across DST', () => {
    const { getPrevRange } = loadAnalytics().testHelpers;
    for (const [from, to, expectedFrom, expectedTo] of [
        ['2026-10-01', '2026-10-08', '2026-09-23', '2026-09-30'],
        ['2026-03-27', '2026-04-02', '2026-03-20', '2026-03-26'],
        ['2026-10-26', '2026-10-26', '2026-10-25', '2026-10-25']
    ]) {
        const previous = getPrevRange(from, to);
        assert.equal(previous.from, expectedFrom);
        assert.equal(previous.to, expectedTo);
        assert.equal(previous.basis, 'equal-days');
    }
});

test('explicit invalid or reversed analytics dates are rejected rather than silently replaced', () => {
    const { getRequestDateRange } = loadAnalytics().testHelpers;
    assert.deepEqual(plain(getRequestDateRange({ from: '2024-02-29', to: '2024-03-01' })), { from: '2024-02-29', to: '2024-03-01' });
    for (const query of [
        { from: '2026-02-29', to: '2026-03-01' },
        { from: '2026-10-08', to: '2026-10-01' },
        { from: '2026-13-01', to: '2026-13-31' },
        { from: '0000-01-01', to: '0000-01-02' },
        { from: '2026-10-01' }, { to: '2026-10-01' },
        { from: ['2026-10-01'], to: '2026-10-02' }
    ]) assert.throws(() => getRequestDateRange(query), error => error.statusCode === 400);
});

test('analytics bounds the inclusive daily range without rejecting the exact 3660-day limit', () => {
    const { getRequestDateRange } = loadAnalytics().testHelpers;
    const from = '2020-01-01';
    const lastAllowed = new Date(Date.parse(from + 'T00:00:00Z') + 3659 * 86400000).toISOString().slice(0, 10);
    const firstRejected = new Date(Date.parse(from + 'T00:00:00Z') + 3660 * 86400000).toISOString().slice(0, 10);
    assert.equal(getRequestDateRange({ from, to: lastAllowed }).to, lastAllowed);
    assert.throws(() => getRequestDateRange({ from, to: firstRejected }), error => error.statusCode === 400 && /3660/.test(error.message));
    assert.throws(() => getRequestDateRange({ from: '1900-01-01', to: '9999-12-31' }), error => error.statusCode === 400);
    assert.match(getRequestDateRange({ period: 'month' }).from, /^\d{4}-\d{2}-01$/);
});

test('calendar and equal-day comparisons reject a previous period before year one', () => {
    const { getPrevRange } = loadAnalytics().testHelpers;
    for (const [from, to] of [['0001-01-01', '0001-01-31'], ['0001-01-02', '0001-01-03']]) {
        assert.throws(() => getPrevRange(from, to), error => error.statusCode === 400 && /Попередній період/.test(error.message));
    }
    assert.equal(getPrevRange('0001-02-01', '0001-02-28').from, '0001-01-01');
});

test('analytics read routes return 400 before querying on invalid date ranges', async () => {
    let queries = 0;
    const router = loadAnalytics({ query: async () => { queries += 1; throw new Error('Should not query'); } });
    const user = { id: 47, role: 'creator', username: 'analytics_fixture', business_contexts: ['event_genix'], default_business_context: 'event_genix' };
    for (const route of ['/overview', '/charts', '/comparison', '/bookings', '/revenue', '/deals-lifecycle']) {
        const layer = router.stack.find(item => item.route?.path === route);
        let status = 200;
        let body;
        const res = { locals: {}, status(value) { status = value; return this; }, json(value) { body = value; return this; } };
        for (const query of [
            { from: '2026-10-08', to: '2026-10-01' },
            { from: '1900-01-01', to: '9999-12-31' },
            { from: '0000-01-01', to: '0000-01-02' },
            ...(['/overview', '/comparison'].includes(route) ? [{ from: '0001-01-01', to: '0001-01-31' }] : [])
        ]) {
            await layer.route.stack.at(-1).handle({ user, query, headers: { 'x-business-context': 'event_genix' }, method: 'GET' }, res);
            assert.equal(status, 400, route + ' ' + query.from);
            assert.match(body.error, /коректні дати|3660|Попередній період/);
        }
    }
    assert.equal(queries, 0);
});
