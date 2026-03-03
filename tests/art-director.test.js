/**
 * tests/art-director.test.js — Art Director API Tests
 * Run: node --test tests/art-director.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Art Director', () => {
    let brandId;
    let contentId;

    it('GET /api/art-director/brand — list brand guidelines', async () => {
        const res = await authRequest('GET', '/api/art-director/brand');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.guidelines));
    });

    it('POST /api/art-director/brand — create guideline', async () => {
        const res = await authRequest('POST', '/api/art-director/brand', {
            category: 'colors',
            title: 'Smoke Color',
            value: '#FF0000',
            description: 'Test brand color'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        brandId = res.data.guideline.id;
    });

    it('POST /api/art-director/brand — reject without required fields', async () => {
        const res = await authRequest('POST', '/api/art-director/brand', {
            category: 'colors'
        });
        assert.equal(res.status, 400);
    });

    it('DELETE /api/art-director/brand/:id — delete guideline', async () => {
        assert.ok(brandId, 'Need brand id');
        const res = await authRequest('DELETE', `/api/art-director/brand/${brandId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/art-director/templates — list content templates', async () => {
        const res = await authRequest('GET', '/api/art-director/templates');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.templates));
    });

    it('GET /api/art-director/content — list content items', async () => {
        const res = await authRequest('GET', '/api/art-director/content');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.items));
    });

    it('POST /api/art-director/content — create content item', async () => {
        const res = await authRequest('POST', '/api/art-director/content', {
            title: 'Smoke Content',
            category: 'social'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.item);
        contentId = res.data.item.id;
    });

    it('GET /api/art-director/content/stats — pipeline stats', async () => {
        const res = await authRequest('GET', '/api/art-director/content/stats');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.stats);
    });

    it('DELETE /api/art-director/content/:id — delete content', async () => {
        assert.ok(contentId, 'Need content id');
        const res = await authRequest('DELETE', `/api/art-director/content/${contentId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('GET /api/art-director/overview — dashboard', async () => {
        const res = await authRequest('GET', '/api/art-director/overview');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
