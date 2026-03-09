/**
 * tests/products.test.js — Products API Tests
 * Run: node --test tests/products.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Products', () => {
    let createdProductId;

    // ==========================================
    // CREATE
    // ==========================================

    it('POST /api/products — create product', async () => {
        const res = await authRequest('POST', '/api/products', {
            code: 'SMOKE',
            label: 'Smoke Test',
            name: 'Smoke Test Program',
            category: 'test',
            duration: 60,
            price: 1000,
            hosts: 1
        });
        assert.equal(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.id, 'Should return product with id');
        createdProductId = res.data.id;
    });

    it('POST /api/products — reject without required fields', async () => {
        const res = await authRequest('POST', '/api/products', {
            code: 'BAD'
        });
        assert.equal(res.status, 400);
    });

    // ==========================================
    // READ
    // ==========================================

    it('GET /api/products — list all products', async () => {
        const res = await authRequest('GET', '/api/products');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return array');
    });

    it('GET /api/products?active=true — filter active only', async () => {
        const res = await authRequest('GET', '/api/products?active=true');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/products/:id — get single product', async () => {
        assert.ok(createdProductId, 'Need created product id');
        const res = await authRequest('GET', `/api/products/${createdProductId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.id);
    });

    it('GET /api/products/nonexistent — 404', async () => {
        const res = await authRequest('GET', '/api/products/nonexistent_999');
        assert.equal(res.status, 404);
    });

    // ==========================================
    // UPDATE
    // ==========================================

    it('PUT /api/products/:id — update product', async () => {
        assert.ok(createdProductId, 'Need created product id');
        const res = await authRequest('PUT', `/api/products/${createdProductId}`, {
            code: 'SMOKE',
            label: 'Updated Smoke',
            name: 'Updated Smoke Program',
            category: 'test',
            duration: 90,
            price: 1500,
            hosts: 2
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.id);
    });

    // ==========================================
    // DELETE (soft)
    // ==========================================

    it('DELETE /api/products/:id — deactivate product', async () => {
        assert.ok(createdProductId, 'Need created product id');
        const res = await authRequest('DELETE', `/api/products/${createdProductId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
