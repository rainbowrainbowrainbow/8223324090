/**
 * tests/warehouse.test.js — Warehouse Stock API Tests
 * Run: node --test tests/warehouse.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Warehouse', () => {
    let createdItemId;

    // ==========================================
    // CREATE
    // ==========================================

    it('POST /api/warehouse — create stock item', async () => {
        const res = await authRequest('POST', '/api/warehouse', {
            name: 'Smoke Test Фарба',
            category: 'craft',
            quantity: 100,
            minQuantity: 10,
            unit: 'шт',
            notes: 'Created by smoke test'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.item, 'Should return item');
        assert.ok(res.data.item.id, 'Item should have id');
        createdItemId = res.data.item.id;
    });

    it('POST /api/warehouse — reject without name', async () => {
        const res = await authRequest('POST', '/api/warehouse', {
            category: 'craft',
            quantity: 5
        });
        assert.ok([400, 500].includes(res.status));
    });

    // ==========================================
    // LIST & FILTER
    // ==========================================

    it('GET /api/warehouse — list items', async () => {
        const res = await authRequest('GET', '/api/warehouse');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items), 'Should return items array');
        assert.ok(typeof res.data.lowStockCount === 'number', 'Should return lowStockCount');
    });

    it('GET /api/warehouse?category=craft — filter by category', async () => {
        const res = await authRequest('GET', '/api/warehouse?category=craft');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items));
    });

    it('GET /api/warehouse?search=Smoke — search', async () => {
        const res = await authRequest('GET', '/api/warehouse?search=Smoke');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items));
    });

    it('GET /api/warehouse?low_stock=true — low stock filter', async () => {
        const res = await authRequest('GET', '/api/warehouse?low_stock=true');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items));
    });

    it('GET /api/warehouse?all=true — include inactive', async () => {
        const res = await authRequest('GET', '/api/warehouse?all=true');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items));
    });

    // ==========================================
    // GET BY ID
    // ==========================================

    it('GET /api/warehouse/:id — get item details', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('GET', `/api/warehouse/${createdItemId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.id, 'Should return item');
        assert.equal(res.data.name, 'Smoke Test Фарба');
        assert.ok(Array.isArray(res.data.history), 'Should include history');
    });

    // ==========================================
    // UPDATE
    // ==========================================

    it('PUT /api/warehouse/:id — update item', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('PUT', `/api/warehouse/${createdItemId}`, {
            name: 'Smoke Test Фарба Оновлено',
            category: 'craft',
            minQuantity: 20,
            unit: 'шт',
            notes: 'Updated by smoke test'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // USE (decrease stock)
    // ==========================================

    it('POST /api/warehouse/:id/use — use stock', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('POST', `/api/warehouse/${createdItemId}/use`, {
            amount: 5,
            reason: 'Smoke test usage'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.item);
        assert.equal(res.data.item.quantity, 95, 'Quantity should decrease by 5');
    });

    it('POST /api/warehouse/:id/use — reject negative amount', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('POST', `/api/warehouse/${createdItemId}/use`, {
            amount: -5
        });
        assert.ok([400, 500].includes(res.status));
    });

    it('POST /api/warehouse/:id/use — reject zero amount', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('POST', `/api/warehouse/${createdItemId}/use`, {
            amount: 0
        });
        assert.ok([400, 500].includes(res.status));
    });

    it('POST /api/warehouse/:id/use — reject exceeding stock', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('POST', `/api/warehouse/${createdItemId}/use`, {
            amount: 999
        });
        assert.ok([400, 500].includes(res.status));
    });

    // ==========================================
    // RESTOCK (increase stock)
    // ==========================================

    it('POST /api/warehouse/:id/restock — restock item', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('POST', `/api/warehouse/${createdItemId}/restock`, {
            amount: 50,
            reason: 'Smoke test restock'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.item);
        assert.equal(res.data.item.quantity, 145, 'Quantity should be 95 + 50 = 145');
    });

    it('POST /api/warehouse/:id/restock — reject negative amount', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('POST', `/api/warehouse/${createdItemId}/restock`, {
            amount: -10
        });
        assert.ok([400, 500].includes(res.status));
    });

    // ==========================================
    // HISTORY
    // ==========================================

    it('GET /api/warehouse/history — global history', async () => {
        const res = await authRequest('GET', '/api/warehouse/history?limit=10');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items), 'Should return history items');
        assert.ok(typeof res.data.total === 'number');
    });

    it('GET /api/warehouse/:id/history — item history', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('GET', `/api/warehouse/${createdItemId}/history`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items), 'Should return history');
        assert.ok(res.data.items.length >= 2, 'Should have at least 2 history entries (use + restock)');
    });

    // ==========================================
    // DELETE (soft)
    // ==========================================

    it('DELETE /api/warehouse/:id — soft delete', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('DELETE', `/api/warehouse/${createdItemId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/warehouse/99999 — non-existent item', async () => {
        const res = await authRequest('DELETE', '/api/warehouse/99999');
        assert.ok([404, 200, 500].includes(res.status));
    });
});
