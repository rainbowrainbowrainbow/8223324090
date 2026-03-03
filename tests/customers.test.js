/**
 * tests/customers.test.js — Customers CRM API Tests
 * Run: node --test tests/customers.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Customers', () => {
    let createdCustomerId;

    // ==========================================
    // CREATE
    // ==========================================

    it('POST /api/customers — create customer', async () => {
        const res = await authRequest('POST', '/api/customers', {
            name: 'Тест Клієнт Smoke',
            phone: '+380997778899',
            instagram: '@test_smoke',
            childName: 'Данило',
            childBirthday: '2019-05-20',
            source: 'instagram',
            notes: 'smoke test customer'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.id, 'Should return customer with id');
        createdCustomerId = res.data.id;
    });

    it('POST /api/customers — reject without name', async () => {
        const res = await authRequest('POST', '/api/customers', {
            phone: '+380997778899'
        });
        assert.ok([400, 500].includes(res.status), `Expected 400 or 500, got ${res.status}`);
    });

    // ==========================================
    // LIST & SEARCH
    // ==========================================

    it('GET /api/customers — list with pagination', async () => {
        const res = await authRequest('GET', '/api/customers?page=1&limit=5');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers), 'Should return customers array');
        assert.ok(typeof res.data.total === 'number', 'Should return total');
        assert.ok(typeof res.data.page === 'number', 'Should return page');
        assert.ok(typeof res.data.pages === 'number', 'Should return pages');
    });

    it('GET /api/customers?search=Smoke — search by name', async () => {
        const res = await authRequest('GET', '/api/customers?search=Smoke');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers));
    });

    it('GET /api/customers?source=instagram — filter by source', async () => {
        const res = await authRequest('GET', '/api/customers?source=instagram');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers));
    });

    it('GET /api/customers?sortBy=total_spent — sort by spending', async () => {
        const res = await authRequest('GET', '/api/customers?sortBy=total_spent');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers));
    });

    it('GET /api/customers/search?q=Тест — quick search', async () => {
        const res = await authRequest('GET', '/api/customers/search?q=Тест');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return array');
    });

    it('GET /api/customers/search?q=X — short query still works', async () => {
        const res = await authRequest('GET', '/api/customers/search?q=X');
        // min 2 chars required, may return 400 or empty array
        assert.ok([200, 400].includes(res.status));
    });

    // ==========================================
    // GET BY ID
    // ==========================================

    it('GET /api/customers/:id — get customer details', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('GET', `/api/customers/${createdCustomerId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.id, 'Should return customer');
        assert.ok(Array.isArray(res.data.bookings), 'Should include bookings');
        assert.ok(Array.isArray(res.data.certificates), 'Should include certificates');
    });

    it('GET /api/customers/99999 — non-existent', async () => {
        const res = await authRequest('GET', '/api/customers/99999');
        assert.ok([404, 500].includes(res.status));
    });

    // ==========================================
    // UPDATE
    // ==========================================

    it('PUT /api/customers/:id — update customer', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('PUT', `/api/customers/${createdCustomerId}`, {
            name: 'Тест Клієнт Оновлено',
            phone: '+380997778800',
            instagram: '@test_updated',
            childName: 'Данило',
            source: 'website'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.id, 'Should return updated customer');
    });

    // ==========================================
    // RFM ANALYSIS
    // ==========================================

    it('GET /api/customers/rfm — RFM segmentation', async () => {
        const res = await authRequest('GET', '/api/customers/rfm');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.customers), 'Should return customers');
        assert.ok(res.data.segments, 'Should return segments');
        assert.ok(typeof res.data.total === 'number', 'Should return total');
    });

    // ==========================================
    // STATS
    // ==========================================

    it('GET /api/customers/stats — customer statistics', async () => {
        const res = await authRequest('GET', '/api/customers/stats');
        assert.equal(res.status, 200);
        assert.ok(typeof res.data.total === 'number', 'Should return total');
        assert.ok(Array.isArray(res.data.bySource), 'Should return bySource');
        assert.ok(Array.isArray(res.data.topBySpent), 'Should return topBySpent');
    });

    // ==========================================
    // DELETE
    // ==========================================

    it('DELETE /api/customers/:id — delete customer', async () => {
        assert.ok(createdCustomerId, 'Need created customer id');
        const res = await authRequest('DELETE', `/api/customers/${createdCustomerId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');
    });
});
