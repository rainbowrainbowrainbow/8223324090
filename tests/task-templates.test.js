/**
 * tests/task-templates.test.js — Task Templates API Tests
 * Run: node --test tests/task-templates.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Task Templates', () => {
    let createdId;

    it('POST /api/task-templates — create template', async () => {
        const res = await authRequest('POST', '/api/task-templates', {
            title: 'Smoke Template',
            description: 'Daily smoke test task',
            priority: 'normal',
            category: 'admin',
            recurrencePattern: 'daily'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success);
        assert.ok(res.data.template);
        createdId = res.data.template.id;
    });

    it('POST /api/task-templates — reject without title', async () => {
        const res = await authRequest('POST', '/api/task-templates', {
            recurrencePattern: 'daily'
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/task-templates — reject invalid pattern', async () => {
        const res = await authRequest('POST', '/api/task-templates', {
            title: 'Bad Pattern',
            recurrencePattern: 'invalid'
        });
        assert.equal(res.status, 400);
    });

    it('GET /api/task-templates — list all', async () => {
        const res = await authRequest('GET', '/api/task-templates');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/task-templates?active=true — filter active', async () => {
        const res = await authRequest('GET', '/api/task-templates?active=true');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('PUT /api/task-templates/:id — update template', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('PUT', `/api/task-templates/${createdId}`, {
            title: 'Updated Template',
            recurrencePattern: 'weekdays',
            priority: 'high',
            category: 'event'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/task-templates/:id — delete template', async () => {
        assert.ok(createdId, 'Need created id');
        const res = await authRequest('DELETE', `/api/task-templates/${createdId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/task-templates/99999 — non-existent', async () => {
        const res = await authRequest('DELETE', '/api/task-templates/99999');
        assert.equal(res.status, 404);
    });
});
