/**
 * tests/designs.test.js — Designs API Tests
 * Run: node --test tests/designs.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Designs', () => {
    let collectionId;

    // ==========================================
    // LIST
    // ==========================================

    it('GET /api/designs — list all designs', async () => {
        const res = await authRequest('GET', '/api/designs');
        assert.equal(res.status, 200);
        assert.ok(res.data.items !== undefined, 'Should return items');
        assert.ok(typeof res.data.total === 'number', 'Should return total');
    });

    it('GET /api/designs?search=test — search designs', async () => {
        const res = await authRequest('GET', '/api/designs?search=test');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items));
    });

    // ==========================================
    // TAGS
    // ==========================================

    it('GET /api/designs/tags — list tags', async () => {
        const res = await authRequest('GET', '/api/designs/tags');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    // ==========================================
    // CALENDAR
    // ==========================================

    it('GET /api/designs/calendar — calendar view', async () => {
        const res = await authRequest('GET', '/api/designs/calendar');
        assert.equal(res.status, 200);
        assert.ok(typeof res.data === 'object');
    });

    // ==========================================
    // COLLECTIONS
    // ==========================================

    it('GET /api/designs/collections — list collections', async () => {
        const res = await authRequest('GET', '/api/designs/collections');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/designs/collections — create collection', async () => {
        const res = await authRequest('POST', '/api/designs/collections', {
            name: 'Smoke Collection',
            color: '#FF6600'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.id);
        collectionId = res.data.id;
    });

    it('POST /api/designs/collections — reject without name', async () => {
        const res = await authRequest('POST', '/api/designs/collections', {
            color: '#FF6600'
        });
        assert.equal(res.status, 400);
    });

    it('PUT /api/designs/collections/:id — update collection', async () => {
        assert.ok(collectionId, 'Need collection id');
        const res = await authRequest('PUT', `/api/designs/collections/${collectionId}`, {
            name: 'Updated Collection',
            color: '#00FF66'
        });
        assert.equal(res.status, 200);
    });

    it('DELETE /api/designs/collections/:id — delete collection', async () => {
        assert.ok(collectionId, 'Need collection id');
        const res = await authRequest('DELETE', `/api/designs/collections/${collectionId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // UPLOAD (no file — should fail gracefully)
    // ==========================================

    it('POST /api/designs/upload — reject without files', async () => {
        const res = await authRequest('POST', '/api/designs/upload', {});
        assert.equal(res.status, 400);
    });
});
