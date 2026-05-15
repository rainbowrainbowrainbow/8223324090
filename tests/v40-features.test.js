/**
 * tests/v40-features.test.js — Tests for v40.0 features
 * Dashboard widgets, partial updates, alerts, staff
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest, request, testDate } = require('./helpers');

// ==========================================
// ALL DASHBOARD WIDGETS
// ==========================================
describe('Dashboard Widgets — all registered types (v40)', () => {
    const widgets = [
        'quick_stats', 'tasks', 'my_focus', 'funnel', 'bookings_today', 'my_schedule',
        'team_online', 'alerts', 'exceptions', 'leads_new',
        'finance_today', 'weather', 'currency', 'announcements',
        'reports_today', 'catalogs', 'account_stats',
        'staff_today', 'week_bookings', 'team_tasks',
        'hr_overview', 'director_pnl', 'content_pipeline', 'operations'
    ];

    for (const w of widgets) {
        it(`GET /dashboard/widgets/${w} — returns 200`, async () => {
            const res = await authRequest('GET', `/api/dashboard/widgets/${w}`);
            assert.equal(res.status, 200, `Widget ${w} should return 200`);
            assert.ok(res.data.success !== false, `Widget ${w} should not fail`);
        });
    }

    it('GET /dashboard/widgets/nonexistent — returns 400', async () => {
        const res = await authRequest('GET', '/api/dashboard/widgets/nonexistent_widget');
        assert.equal(res.status, 400);
    });

    it('GET /dashboard/config — returns config', async () => {
        const res = await authRequest('GET', '/api/dashboard/config');
        assert.equal(res.status, 200);
        assert.ok(res.data, 'should return config data');
    });
});

// ==========================================
// PARTIAL UPDATES (v40)
// ==========================================
describe('Booking Partial Update (v40)', () => {
    let bookingId;

    it('POST /bookings — create test booking', async () => {
        const res = await authRequest('POST', '/api/bookings', {
            date: '2099-06-15', time: '14:00', duration: 60,
            lineId: 'test_partial', label: 'Partial test', room: 'marvel',
            status: 'preliminary', price: 1500
        });
        assert.equal(res.status, 200);
        bookingId = res.data.id || res.data.booking?.id;
        assert.ok(bookingId, 'should return booking ID');
    });

    it('PUT /bookings/:id — partial update (only status)', async () => {
        if (!bookingId) return;
        const res = await authRequest('PUT', `/api/bookings/${bookingId}`, {
            status: 'confirmed'
        });
        assert.equal(res.status, 200, 'partial update should work');
    });

    it('PUT /bookings/:id — partial update (only price)', async () => {
        if (!bookingId) return;
        const res = await authRequest('PUT', `/api/bookings/${bookingId}`, {
            price: 2000
        });
        assert.equal(res.status, 200);
    });

    it('DELETE /bookings/:id — cleanup', async () => {
        if (!bookingId) return;
        const res = await authRequest('DELETE', `/api/bookings/${bookingId}`);
        assert.ok([200, 204].includes(res.status));
    });
});

describe('Task Partial Update (v40)', () => {
    let taskId;

    it('POST /tasks — create test task', async () => {
        const res = await authRequest('POST', '/api/tasks', {
            title: 'Partial update test', category: 'admin', priority: 'normal'
        });
        assert.equal(res.status, 200);
        taskId = res.data.task?.id || res.data.id;
        assert.ok(taskId);
    });

    it('PUT /tasks/:id — partial update (only status)', async () => {
        if (!taskId) return;
        const res = await authRequest('PUT', `/api/tasks/${taskId}`, {
            status: 'in_progress'
        });
        assert.equal(res.status, 200, 'status-only update should work');
    });

    it('PUT /tasks/:id — partial update (only assigned_to)', async () => {
        if (!taskId) return;
        const res = await authRequest('PUT', `/api/tasks/${taskId}`, {
            assigned_to: 'admin'
        });
        assert.equal(res.status, 200);
    });

    it('DELETE /tasks/:id — cleanup', async () => {
        if (!taskId) return;
        await authRequest('DELETE', `/api/tasks/${taskId}`);
    });
});

// ==========================================
// ALERTS (v40)
// ==========================================
describe('Dashboard Alerts (v40)', () => {
    it('GET /dashboard/alerts — returns alerts array', async () => {
        const res = await authRequest('GET', '/api/dashboard/alerts');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.alerts));
    });

    it('alerts have required fields', async () => {
        const res = await authRequest('GET', '/api/dashboard/alerts');
        if (res.data.alerts.length > 0) {
            const a = res.data.alerts[0];
            assert.ok(a.id, 'alert should have id');
            assert.ok(a.title, 'alert should have title');
            assert.ok(a.level || a.type, 'alert should have level');
        }
    });
});

// ==========================================
// STAFF SEARCH (v40.3)
// ==========================================
describe('Search with Staff (v40.3)', () => {
    it('GET /search?q=test — returns results with staff', async () => {
        const res = await authRequest('GET', '/api/search?q=Анна');
        assert.equal(res.status, 200);
        assert.ok(res.data.results || res.data.staff, 'should have results');
    });

    it('GET /search?q=short — short query returns empty', async () => {
        const res = await authRequest('GET', '/api/search?q=a');
        assert.equal(res.status, 200);
        assert.equal(res.data.total || 0, 0);
    });
});

// ==========================================
// INVALID ID VALIDATION (v40)
// ==========================================
describe('Invalid ID Validation (v40)', () => {
    it('GET /tasks/abc — returns 400 not 500', async () => {
        const res = await authRequest('GET', '/api/tasks/abc');
        assert.equal(res.status, 400);
    });

    it('GET /customers/abc — returns 400 not 500', async () => {
        const res = await authRequest('GET', '/api/customers/abc');
        assert.equal(res.status, 400);
    });

    it('GET /warehouse/abc — returns 400 not 500', async () => {
        const res = await authRequest('GET', '/api/warehouse/abc');
        assert.equal(res.status, 400);
    });
});

// ==========================================
// STAFF FEATURES (v39.11+)
// ==========================================
describe('Staff Features (v39.11)', () => {
    it('GET /staff/link-status — returns staff with account info', async () => {
        const res = await authRequest('GET', '/api/staff/link-status');
        assert.equal(res.status, 200);
        const data = Array.isArray(res.data) ? res.data : res.data.data;
        assert.ok(Array.isArray(data), 'should return array');
        if (data.length > 0) {
            assert.ok(data[0].name, 'staff should have name');
        }
    });

    it('GET /warehouse/pinata-status — returns pinata data', async () => {
        const res = await authRequest('GET', '/api/warehouse/pinata-status');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(Array.isArray(res.data.stock));
    });
});
