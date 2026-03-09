/**
 * tests/page-statuses.test.js — Page Statuses API Tests
 * Run: node --test tests/page-statuses.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Page Statuses', () => {

    it('GET /api/page-statuses — list all', async () => {
        const res = await authRequest('GET', '/api/page-statuses');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(res.data.statuses);
    });

    it('PATCH /api/page-statuses/bookings — set status', async () => {
        const res = await authRequest('PATCH', '/api/page-statuses/bookings', {
            status: 'ready'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('PATCH /api/page-statuses/settings — set status building', async () => {
        const res = await authRequest('PATCH', '/api/page-statuses/settings', {
            status: 'building'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('PATCH /api/page-statuses/test — reject invalid status', async () => {
        const res = await authRequest('PATCH', '/api/page-statuses/test', {
            status: 'invalid_value'
        });
        assert.equal(res.status, 400);
    });
});
