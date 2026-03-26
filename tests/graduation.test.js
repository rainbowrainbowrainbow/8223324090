/**
 * tests/graduation.test.js — Graduation module tests (v38.1.0)
 * Tests services, packages, quotes, booking creation
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest, publicRequest } = require('./helpers');

describe('Graduation Services', () => {
    it('GET /graduation/services — list active services', async () => {
        const res = await authRequest('GET', '/api/graduation/services');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'should return array');
    });

    it('GET /graduation/services?active=false — list all services', async () => {
        const res = await authRequest('GET', '/api/graduation/services?active=false');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /graduation/settings — get settings', async () => {
        const res = await authRequest('GET', '/api/graduation/settings');
        assert.equal(res.status, 200);
        assert.ok(typeof res.data === 'object');
    });
});

describe('Graduation Packages', () => {
    it('GET /graduation/packages — list packages', async () => {
        const res = await authRequest('GET', '/api/graduation/packages');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'should return array');
    });
});

describe('Graduation Quotes', () => {
    let quoteId;

    it('POST /graduation/quotes — create quote', async () => {
        const res = await authRequest('POST', '/api/graduation/quotes', {
            kidsCount: 20,
            discountPercent: 0,
            totalPerChild: 500,
            totalAll: 10000,
            totalCost: 7000,
            totalProfit: 3000,
            profitMargin: 30,
            notes: 'Test quote from automated tests'
        });
        assert.ok([200, 201].includes(res.status), `Create quote failed: ${JSON.stringify(res.data)}`);
        quoteId = res.data.id;
        assert.ok(quoteId, 'should return quote id');
        assert.ok(res.data.quoteNumber || res.data.quote_number, 'should return quote number');
    });

    it('GET /graduation/quotes — list quotes', async () => {
        const res = await authRequest('GET', '/api/graduation/quotes');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'should return array');
        assert.ok(res.data.length >= 1, 'should have at least 1 quote');
    });

    it('GET /graduation/quotes/:id — get single quote', async () => {
        if (!quoteId) return;
        const res = await authRequest('GET', `/api/graduation/quotes/${quoteId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.id || res.data.kidsCount || res.data.kids_count, 'should return quote data');
    });

    it('PATCH /graduation/quotes/:id/status — change status', async () => {
        if (!quoteId) return;
        const res = await authRequest('PATCH', `/api/graduation/quotes/${quoteId}/status`, {
            status: 'sent'
        });
        assert.equal(res.status, 200);
    });

    it('GET /graduation/analytics — analytics data', async () => {
        const res = await authRequest('GET', '/api/graduation/analytics');
        assert.equal(res.status, 200);
        assert.ok(res.data.popularity || res.data.funnel || res.data.averageCheck,
            'should return analytics data');
    });

    it('GET /graduation/customers/search — search customers', async () => {
        const res = await authRequest('GET', '/api/graduation/customers/search?q=test');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });
});
