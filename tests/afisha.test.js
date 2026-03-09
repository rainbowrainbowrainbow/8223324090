/**
 * tests/afisha.test.js — Afisha (Events) API Tests
 * Run: node --test tests/afisha.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest, testDate } = require('./helpers');

describe('Afisha', () => {
    let createdItemId;
    let createdTemplateId;

    // ==========================================
    // CREATE EVENT
    // ==========================================

    it('POST /api/afisha — create event', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: testDate(),
            time: '14:00',
            title: 'Smoke Test Event',
            duration: 60,
            type: 'event',
            description: 'Test afisha event'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.item, 'Should return item');
        assert.ok(res.data.item.id, 'Item should have id');
        createdItemId = res.data.item.id;
    });

    it('POST /api/afisha — reject without required fields', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: testDate()
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/afisha — reject invalid date', async () => {
        const res = await authRequest('POST', '/api/afisha', {
            date: 'not-a-date',
            time: '14:00',
            title: 'Bad Date Event'
        });
        assert.equal(res.status, 400);
    });

    // ==========================================
    // READ
    // ==========================================

    it('GET /api/afisha — list all events', async () => {
        const res = await authRequest('GET', '/api/afisha');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return array');
    });

    it('GET /api/afisha?type=event — filter by type', async () => {
        const res = await authRequest('GET', '/api/afisha?type=event');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/afisha/:date — get events by date', async () => {
        const res = await authRequest('GET', `/api/afisha/${testDate()}`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/afisha/:date — reject invalid date', async () => {
        const res = await authRequest('GET', '/api/afisha/bad-date');
        assert.equal(res.status, 400);
    });

    // ==========================================
    // UPDATE
    // ==========================================

    it('PUT /api/afisha/:id — update event', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('PUT', `/api/afisha/${createdItemId}`, {
            date: testDate(),
            time: '15:00',
            title: 'Updated Event',
            duration: 90,
            type: 'event'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('PATCH /api/afisha/:id/time — quick time update', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('PATCH', `/api/afisha/${createdItemId}/time`, {
            time: '15:30'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('PATCH /api/afisha/:id/time — reject invalid time', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('PATCH', `/api/afisha/${createdItemId}/time`, {
            time: 'bad'
        });
        assert.equal(res.status, 400);
    });

    // ==========================================
    // DISTRIBUTION
    // ==========================================

    it('GET /api/afisha/distribute/:date — suggest distribution', async () => {
        const res = await authRequest('GET', `/api/afisha/distribute/${testDate()}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.distribution !== undefined || res.data.reason !== undefined);
    });

    it('POST /api/afisha/distribute/:date — auto-distribute', async () => {
        const res = await authRequest('POST', `/api/afisha/distribute/${testDate()}`);
        assert.equal(res.status, 200);
    });

    it('POST /api/afisha/undistribute/:date — reset distribution', async () => {
        const res = await authRequest('POST', `/api/afisha/undistribute/${testDate()}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // TEMPLATES
    // ==========================================

    it('GET /api/afisha/templates/list — list templates', async () => {
        const res = await authRequest('GET', '/api/afisha/templates/list');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('POST /api/afisha/templates — create template', async () => {
        const res = await authRequest('POST', '/api/afisha/templates', {
            title: 'Smoke Template',
            time: '16:00',
            duration: 45,
            type: 'regular',
            recurrence_pattern: 'daily'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.template);
        createdTemplateId = res.data.template.id;
    });

    it('POST /api/afisha/templates — reject without title', async () => {
        const res = await authRequest('POST', '/api/afisha/templates', {
            time: '16:00'
        });
        assert.equal(res.status, 400);
    });

    it('PUT /api/afisha/templates/:id — update template', async () => {
        assert.ok(createdTemplateId, 'Need created template id');
        const res = await authRequest('PUT', `/api/afisha/templates/${createdTemplateId}`, {
            title: 'Updated Template',
            time: '17:00',
            recurrence_pattern: 'weekdays'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/afisha/templates/:id — delete template', async () => {
        assert.ok(createdTemplateId, 'Need created template id');
        const res = await authRequest('DELETE', `/api/afisha/templates/${createdTemplateId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // DELETE EVENT
    // ==========================================

    it('DELETE /api/afisha/:id — delete event', async () => {
        assert.ok(createdItemId, 'Need created item id');
        const res = await authRequest('DELETE', `/api/afisha/${createdItemId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
