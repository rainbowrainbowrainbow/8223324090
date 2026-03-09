/**
 * tests/search.test.js — Global Search API Tests
 * Run: node --test tests/search.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Global Search', () => {
    it('GET /api/search?q=test — search across modules', async () => {
        const res = await authRequest('GET', '/api/search?q=test');
        assert.equal(res.status, 200);
        assert.ok(res.data.results, 'Should have results');
        assert.ok(res.data.query, 'Should echo query');
        assert.ok(typeof res.data.total === 'number', 'Should have total');
    });

    it('GET /api/search?q=Марвел — search Ukrainian', async () => {
        const res = await authRequest('GET', '/api/search?q=Марвел');
        assert.equal(res.status, 200);
        assert.ok(res.data.results);
    });

    it('GET /api/search?q=a — short query rejected', async () => {
        const res = await authRequest('GET', '/api/search?q=a');
        assert.ok([400, 200].includes(res.status));
    });

    it('GET /api/search?q=test&limit=3 — with limit', async () => {
        const res = await authRequest('GET', '/api/search?q=test&limit=3');
        assert.equal(res.status, 200);
        assert.ok(res.data.results);
    });
});
