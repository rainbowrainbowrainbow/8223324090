/**
 * tests/procurement.test.js — Procurement API Tests
 * Run: node --test tests/procurement.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Procurement', () => {
    let createdListId;
    let createdItemId;

    // ==========================================
    // LIST CRUD
    // ==========================================

    it('POST /api/procurement — create procurement list', async () => {
        const res = await authRequest('POST', '/api/procurement', {
            title: 'Smoke Test Procurement',
            department: 'animators',
            plannedDate: '2099-02-01',
            notes: 'Created by smoke test'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.list);
        assert.ok(res.data.list.id);
        createdListId = res.data.list.id;
    });

    it('GET /api/procurement — list all', async () => {
        const res = await authRequest('GET', '/api/procurement');
        assert.equal(res.status, 200);
        assert.ok(res.data.lists, 'Should return lists');
        assert.ok(Array.isArray(res.data.lists));
    });

    it('GET /api/procurement?department=animators — filter by department', async () => {
        const res = await authRequest('GET', '/api/procurement?department=animators');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.lists));
    });

    it('GET /api/procurement/:id — get by id', async () => {
        assert.ok(createdListId);
        const res = await authRequest('GET', `/api/procurement/${createdListId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.id);
        assert.ok(Array.isArray(res.data.items));
    });

    it('PUT /api/procurement/:id — update list', async () => {
        assert.ok(createdListId);
        const res = await authRequest('PUT', `/api/procurement/${createdListId}`, {
            title: 'Smoke Test Updated',
            notes: 'Updated by smoke test'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // ITEMS
    // ==========================================

    it('POST /api/procurement/:id/items — add item', async () => {
        assert.ok(createdListId);
        const res = await authRequest('POST', `/api/procurement/${createdListId}/items`, {
            name: 'Smoke Test Item',
            quantity: 10,
            unit: 'шт',
            estimatedPrice: 250,
            notes: 'Test item'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
        assert.ok(res.data.success);
        assert.ok(res.data.item);
        createdItemId = res.data.item.id;
    });

    it('PUT /api/procurement/:id/items/:itemId — update item', async () => {
        assert.ok(createdListId && createdItemId);
        const res = await authRequest('PUT', `/api/procurement/${createdListId}/items/${createdItemId}`, {
            quantity: 20,
            actualPrice: 200,
            isPurchased: true
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/procurement/:id/items/:itemId — delete item', async () => {
        assert.ok(createdListId && createdItemId);
        const res = await authRequest('DELETE', `/api/procurement/${createdListId}/items/${createdItemId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // SUGGESTIONS
    // ==========================================

    it('GET /api/procurement/suggestions/low-stock — low stock suggestions', async () => {
        const res = await authRequest('GET', '/api/procurement/suggestions/low-stock');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.suggestions), 'Should return suggestions array');
    });

    // ==========================================
    // CLEANUP
    // ==========================================

    it('DELETE /api/procurement/:id — delete list', async () => {
        assert.ok(createdListId);
        const res = await authRequest('DELETE', `/api/procurement/${createdListId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
