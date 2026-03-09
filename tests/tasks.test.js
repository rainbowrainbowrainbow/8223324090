/**
 * tests/tasks.test.js — Tasks API Tests
 * Run: node --test tests/tasks.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Tasks', () => {
    let createdTaskId;

    // ==========================================
    // CREATE
    // ==========================================

    it('POST /api/tasks — create task', async () => {
        const res = await authRequest('POST', '/api/tasks', {
            title: 'Smoke Test Task',
            description: 'Task created by smoke test',
            date: '2099-01-15',
            priority: 'normal',
            category: 'admin',
            task_type: 'human'
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.task, 'Should return task');
        assert.ok(res.data.task.id, 'Task should have id');
        createdTaskId = res.data.task.id;
    });

    it('POST /api/tasks — reject without title', async () => {
        const res = await authRequest('POST', '/api/tasks', {
            description: 'Missing title'
        });
        assert.ok([400, 500].includes(res.status));
    });

    it('POST /api/tasks — create high priority task', async () => {
        const res = await authRequest('POST', '/api/tasks', {
            title: 'Urgent Smoke Task',
            priority: 'high',
            category: 'event',
            date: '2099-01-15'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.task);
        // cleanup: save for later deletion if needed
    });

    // ==========================================
    // LIST & FILTER
    // ==========================================

    it('GET /api/tasks — list tasks', async () => {
        const res = await authRequest('GET', '/api/tasks');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return tasks array');
    });

    it('GET /api/tasks?status=todo — filter by status', async () => {
        const res = await authRequest('GET', '/api/tasks?status=todo');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/tasks?category=admin — filter by category', async () => {
        const res = await authRequest('GET', '/api/tasks?category=admin');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/tasks?date=2099-01-15 — filter by date', async () => {
        const res = await authRequest('GET', '/api/tasks?date=2099-01-15');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/tasks?date_from=2099-01-01&date_to=2099-01-31 — date range', async () => {
        const res = await authRequest('GET', '/api/tasks?date_from=2099-01-01&date_to=2099-01-31');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
    });

    it('GET /api/tasks?page=1&limit=5 — pagination', async () => {
        const res = await authRequest('GET', '/api/tasks?page=1&limit=5');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
        assert.ok(res.data.length <= 5, 'Should respect limit');
    });

    // ==========================================
    // GET BY ID
    // ==========================================

    it('GET /api/tasks/:id — get task details', async () => {
        assert.ok(createdTaskId, 'Need created task id');
        const res = await authRequest('GET', `/api/tasks/${createdTaskId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.id, 'Should return task');
        assert.equal(res.data.title, 'Smoke Test Task');
    });

    it('GET /api/tasks/99999 — non-existent task', async () => {
        const res = await authRequest('GET', '/api/tasks/99999');
        assert.ok([404, 500].includes(res.status));
    });

    // ==========================================
    // PERMISSIONS
    // ==========================================

    it('GET /api/tasks/permissions — get permissions', async () => {
        const res = await authRequest('GET', '/api/tasks/permissions');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.permissions, 'Should return permissions');
        assert.ok(res.data.role, 'Should return role');
    });

    // ==========================================
    // UPDATE
    // ==========================================

    it('PUT /api/tasks/:id — update task', async () => {
        assert.ok(createdTaskId, 'Need created task id');
        const res = await authRequest('PUT', `/api/tasks/${createdTaskId}`, {
            title: 'Smoke Test Task Updated',
            description: 'Updated by smoke test',
            date: '2099-01-15',
            priority: 'high'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    // ==========================================
    // STATUS CHANGE
    // ==========================================

    it('PATCH /api/tasks/:id/status — move to in_progress', async () => {
        assert.ok(createdTaskId, 'Need created task id');
        const res = await authRequest('PATCH', `/api/tasks/${createdTaskId}/status`, {
            status: 'in_progress'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('PATCH /api/tasks/:id/status — move to done', async () => {
        assert.ok(createdTaskId, 'Need created task id');
        const res = await authRequest('PATCH', `/api/tasks/${createdTaskId}/status`, {
            status: 'done'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('PATCH /api/tasks/:id/status — reject invalid status', async () => {
        assert.ok(createdTaskId, 'Need created task id');
        const res = await authRequest('PATCH', `/api/tasks/${createdTaskId}/status`, {
            status: 'invalid_status'
        });
        assert.ok([400, 500].includes(res.status));
    });

    // ==========================================
    // LOGS
    // ==========================================

    it('GET /api/tasks/:id/logs — get task logs', async () => {
        assert.ok(createdTaskId, 'Need created task id');
        const res = await authRequest('GET', `/api/tasks/${createdTaskId}/logs`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return logs array');
    });

    // ==========================================
    // DELETE
    // ==========================================

    it('DELETE /api/tasks/:id — delete task', async () => {
        assert.ok(createdTaskId, 'Need created task id');
        const res = await authRequest('DELETE', `/api/tasks/${createdTaskId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
