/**
 * tests/sales.test.js — Sales API Tests
 * Run: node --test tests/sales.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

describe('Sales', () => {

    it('GET /api/sales/call-script — active call script', async () => {
        const res = await authRequest('GET', '/api/sales/call-script');
        assert.equal(res.status, 200);
        assert.ok('script' in res.data, 'Should return script field');
    });

    it('GET /api/sales/upsells — upsell catalog', async () => {
        const res = await authRequest('GET', '/api/sales/upsells');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.upsells), 'Should return upsells array');
    });

    it('GET /api/sales/free-slots — free weekend slots', async () => {
        const res = await authRequest('GET', '/api/sales/free-slots?month=1&year=2099');
        assert.equal(res.status, 200);
        assert.ok(typeof res.data.totalWeekends === 'number');
        assert.ok(typeof res.data.freeWeekends === 'number');
        assert.ok(Array.isArray(res.data.freeDates));
    });

    it('GET /api/sales/price-per-child — calculate price', async () => {
        const res = await authRequest('GET', '/api/sales/price-per-child?price=6000&kids=10');
        assert.equal(res.status, 200);
        assert.equal(res.data.perChild, 600);
        assert.equal(res.data.price, 6000);
        assert.equal(res.data.kids, 10);
    });

    it('POST /api/sales/booking-upsells — reject without booking_id', async () => {
        const res = await authRequest('POST', '/api/sales/booking-upsells', {
            upsells: [{ name: 'test' }]
        });
        assert.equal(res.status, 400);
    });
});
