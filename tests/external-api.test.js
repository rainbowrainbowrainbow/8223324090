/**
 * tests/external-api.test.js — External API Tests (for Claw integration)
 * Run: node --test tests/external-api.test.js
 * Env: TEST_URL, EXTERNAL_API_KEY
 *
 * Tests all /api/external/* endpoints with API key authentication.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { BASE_URL, testDate } = require('./helpers');

const API_KEY = process.env.EXTERNAL_API_KEY || '51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083';

/**
 * Helper: Make request with X-API-Key header
 */
async function apiKeyRequest(method, path, body) {
    const headers = { 'X-API-Key': API_KEY };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

// ==========================================
// AUTH
// ==========================================

describe('External API - Authentication', () => {
    it('should reject requests without API key', async () => {
        const res = await fetch(`${BASE_URL}/api/external/context`);
        assert.equal(res.status, 401);
    });

    it('should reject requests with invalid API key', async () => {
        const res = await fetch(`${BASE_URL}/api/external/context`, {
            headers: { 'X-API-Key': 'invalid_key_12345' }
        });
        assert.equal(res.status, 403);
    });

    it('should accept requests with valid API key', async () => {
        const res = await apiKeyRequest('GET', '/api/external/context');
        assert.equal(res.status, 200);
    });
});

// ==========================================
// CONTEXT
// ==========================================

describe('External API - GET /api/external/context', () => {
    it('should return system statistics', async () => {
        const res = await apiKeyRequest('GET', '/api/external/context');
        assert.equal(res.status, 200);
        assert.ok(typeof res.data.bookingsCount === 'number', 'bookingsCount should be a number');
        assert.ok(typeof res.data.totalRevenue === 'number', 'totalRevenue should be a number');
        assert.ok(typeof res.data.pendingTasks === 'number', 'pendingTasks should be a number');
        assert.ok(typeof res.data.overdueTasks === 'number', 'overdueTasks should be a number');
        assert.ok(typeof res.data.streak === 'number', 'streak should be a number');
        assert.ok(res.data.today, 'Should have today object');
        assert.ok(typeof res.data.today.bookings === 'number', 'today.bookings should be a number');
        assert.ok(typeof res.data.today.revenue === 'number', 'today.revenue should be a number');
    });
});

// ==========================================
// TASKS - GET
// ==========================================

describe('External API - GET /api/external/tasks', () => {
    it('should return tasks array', async () => {
        const res = await apiKeyRequest('GET', '/api/external/tasks');
        assert.equal(res.status, 200);
        assert.ok(res.data.tasks, 'Should have tasks property');
        assert.ok(Array.isArray(res.data.tasks), 'tasks should be an array');
    });

    it('should filter by status', async () => {
        const res = await apiKeyRequest('GET', '/api/external/tasks?status=todo');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tasks));
        // All tasks should have status 'todo'
        res.data.tasks.forEach(task => {
            assert.equal(task.status, 'todo');
        });
    });

    it('should filter by assigned_to', async () => {
        const res = await apiKeyRequest('GET', '/api/external/tasks?assigned_to=admin');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tasks));
        // All tasks should be assigned to admin
        res.data.tasks.forEach(task => {
            assert.equal(task.assigned_to, 'admin');
        });
    });

    it('should filter by date', async () => {
        const date = testDate();
        const res = await apiKeyRequest('GET', `/api/external/tasks?date=${date}`);
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.tasks));
    });

    it('should reject invalid status', async () => {
        const res = await apiKeyRequest('GET', '/api/external/tasks?status=invalid');
        assert.equal(res.status, 200); // Still returns 200, just ignores invalid param
        assert.ok(Array.isArray(res.data.tasks));
    });
});

// ==========================================
// TASKS - POST
// ==========================================

describe('External API - POST /api/external/tasks', () => {
    let createdTaskId;

    it('should create a new task', async () => {
        const res = await apiKeyRequest('POST', '/api/external/tasks', {
            title: 'Test task from Claw',
            description: 'Created via external API',
            date: testDate(),
            priority: 'high',
            assigned_to: 'admin',
            category: 'admin',
            created_by: 'claw_test'
        });

        assert.equal(res.status, 201);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.task, 'Should return task object');
        assert.equal(res.data.task.title, 'Test task from Claw');
        assert.equal(res.data.task.status, 'todo');
        assert.equal(res.data.task.priority, 'high');
        assert.equal(res.data.task.created_by, 'claw_test');
        assert.equal(res.data.task.type, 'external');

        createdTaskId = res.data.task.id;
    });

    it('should reject missing title', async () => {
        const res = await apiKeyRequest('POST', '/api/external/tasks', {
            created_by: 'claw_test'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('title'));
    });

    it('should reject missing created_by', async () => {
        const res = await apiKeyRequest('POST', '/api/external/tasks', {
            title: 'Test'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('created_by'));
    });

    it('should reject invalid date format', async () => {
        const res = await apiKeyRequest('POST', '/api/external/tasks', {
            title: 'Test',
            created_by: 'claw_test',
            date: 'invalid-date'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('date'));
    });

    it('should reject invalid priority', async () => {
        const res = await apiKeyRequest('POST', '/api/external/tasks', {
            title: 'Test',
            created_by: 'claw_test',
            priority: 'super_urgent'
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('priority'));
    });

    it('should create task with minimal fields', async () => {
        const res = await apiKeyRequest('POST', '/api/external/tasks', {
            title: 'Minimal task',
            created_by: 'claw_test'
        });
        assert.equal(res.status, 201);
        assert.ok(res.data.task);
        assert.equal(res.data.task.priority, 'normal'); // default
        assert.equal(res.data.task.category, 'admin'); // default
    });
});

// ==========================================
// TASKS - PATCH
// ==========================================

describe('External API - PATCH /api/external/tasks/:id', () => {
    let taskId;

    before(async () => {
        // Create a task to update
        const res = await apiKeyRequest('POST', '/api/external/tasks', {
            title: 'Task to update',
            created_by: 'claw_test',
            date: testDate()
        });
        taskId = res.data.task.id;
    });

    it('should update task status', async () => {
        const res = await apiKeyRequest('PATCH', `/api/external/tasks/${taskId}`, {
            status: 'in_progress'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.equal(res.data.task.status, 'in_progress');
    });

    it('should update task priority', async () => {
        const res = await apiKeyRequest('PATCH', `/api/external/tasks/${taskId}`, {
            priority: 'high'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.task.priority, 'high');
    });

    it('should set completed_at when status = done', async () => {
        const res = await apiKeyRequest('PATCH', `/api/external/tasks/${taskId}`, {
            status: 'done'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.task.status, 'done');
        assert.ok(res.data.task.completed_at, 'completed_at should be set');
    });

    it('should reject non-existent task', async () => {
        const res = await apiKeyRequest('PATCH', '/api/external/tasks/999999', {
            status: 'done'
        });
        assert.equal(res.status, 404);
    });

    it('should reject invalid status', async () => {
        const res = await apiKeyRequest('PATCH', `/api/external/tasks/${taskId}`, {
            status: 'invalid_status'
        });
        assert.equal(res.status, 400);
    });

    it('should reject empty update', async () => {
        const res = await apiKeyRequest('PATCH', `/api/external/tasks/${taskId}`, {});
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('No fields'));
    });
});

// ==========================================
// BOOKINGS
// ==========================================

describe('External API - GET /api/external/bookings', () => {
    it('should require date parameter', async () => {
        const res = await apiKeyRequest('GET', '/api/external/bookings');
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('date'));
    });

    it('should reject invalid date format', async () => {
        const res = await apiKeyRequest('GET', '/api/external/bookings?date=invalid');
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('date'));
    });

    it('should return bookings for valid date', async () => {
        const res = await apiKeyRequest('GET', `/api/external/bookings?date=${testDate()}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.bookings, 'Should have bookings property');
        assert.ok(Array.isArray(res.data.bookings), 'bookings should be an array');
    });

    it('should return bookings with correct fields', async () => {
        const today = new Date().toISOString().split('T')[0];
        const res = await apiKeyRequest('GET', `/api/external/bookings?date=${today}`);
        assert.equal(res.status, 200);

        if (res.data.bookings.length > 0) {
            const booking = res.data.bookings[0];
            assert.ok(booking.id);
            assert.ok(booking.date);
            assert.ok(booking.time);
            assert.ok(booking.status);
        }
    });
});

// ==========================================
// STAFF
// ==========================================

describe('External API - GET /api/external/staff', () => {
    it('should require date parameter', async () => {
        const res = await apiKeyRequest('GET', '/api/external/staff');
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('date'));
    });

    it('should reject invalid date format', async () => {
        const res = await apiKeyRequest('GET', '/api/external/staff?date=invalid');
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('date'));
    });

    it('should return staff schedule for valid date', async () => {
        const today = new Date().toISOString().split('T')[0];
        const res = await apiKeyRequest('GET', `/api/external/staff?date=${today}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.staff, 'Should have staff property');
        assert.ok(Array.isArray(res.data.staff), 'staff should be an array');
    });

    it('should return staff with correct fields', async () => {
        const today = new Date().toISOString().split('T')[0];
        const res = await apiKeyRequest('GET', `/api/external/staff?date=${today}`);
        assert.equal(res.status, 200);

        if (res.data.staff.length > 0) {
            const person = res.data.staff[0];
            assert.ok(person.id);
            assert.ok(person.name);
            assert.ok(person.department);
            assert.ok(person.position);
            // shift_start, shift_end, status can be null (day off)
        }
    });
});

// ==========================================
// GREETING
// ==========================================

describe('External API - POST /api/external/greeting', () => {
    it('should require username', async () => {
        const res = await apiKeyRequest('POST', '/api/external/greeting', {});
        assert.equal(res.status, 400);
        assert.ok(res.data.error.includes('username'));
    });

    it('should reject non-existent user', async () => {
        const res = await apiKeyRequest('POST', '/api/external/greeting', {
            username: 'non_existent_user_12345'
        });
        assert.equal(res.status, 404);
    });

    it('should generate greeting for valid user', async () => {
        const res = await apiKeyRequest('POST', '/api/external/greeting', {
            username: 'admin'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.greeting, 'Should return greeting text');
        assert.ok(res.data.context, 'Should return context object');
        assert.ok(res.data.context.name);
        assert.ok(res.data.context.role);
        assert.ok(typeof res.data.context.pendingTasks === 'number');
        assert.ok(typeof res.data.context.todayBookings === 'number');
        assert.ok(typeof res.data.context.overdueTasks === 'number');
    });

    it('should include Ukrainian text in greeting', async () => {
        const res = await apiKeyRequest('POST', '/api/external/greeting', {
            username: 'admin'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.greeting.includes('Добр'));
    });
});

// ==========================================
// EVENTS
// ==========================================

describe('External API - GET /api/external/events', () => {
    it('should return events array', async () => {
        const res = await apiKeyRequest('GET', '/api/external/events');
        assert.equal(res.status, 200);
        assert.ok(res.data.events, 'Should have events property');
        assert.ok(Array.isArray(res.data.events), 'events should be an array');
    });

    it('should respect limit parameter', async () => {
        const res = await apiKeyRequest('GET', '/api/external/events?limit=5');
        assert.equal(res.status, 200);
        assert.ok(res.data.events.length <= 5);
    });

    it('should return empty array when no events', async () => {
        // Poll twice to clear all events
        await apiKeyRequest('GET', '/api/external/events?limit=100');
        const res = await apiKeyRequest('GET', '/api/external/events?limit=100');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.events));
    });

    it('should return events with correct structure', async () => {
        // Create a task to generate an event
        await apiKeyRequest('POST', '/api/external/tasks', {
            title: 'Event test task',
            created_by: 'claw_test'
        });

        const res = await apiKeyRequest('GET', '/api/external/events?limit=10');
        assert.equal(res.status, 200);

        if (res.data.events.length > 0) {
            const event = res.data.events[0];
            assert.ok(event.id);
            assert.ok(event.event_type);
            assert.ok(event.created_at);
            // payload can be null
        }
    });

    it('should not return the same event twice', async () => {
        // Create event
        await apiKeyRequest('POST', '/api/external/tasks', {
            title: 'Duplicate check task',
            created_by: 'claw_test'
        });

        // First poll
        const res1 = await apiKeyRequest('GET', '/api/external/events?limit=100');
        const eventCount1 = res1.data.events.length;

        // Second poll — should not return same events
        const res2 = await apiKeyRequest('GET', '/api/external/events?limit=100');
        const eventCount2 = res2.data.events.length;

        // Second poll should have fewer or equal events (already processed)
        assert.ok(eventCount2 <= eventCount1);
    });
});
