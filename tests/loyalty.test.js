/**
 * tests/loyalty.test.js — Loyalty System API Tests
 * Run: node --test tests/loyalty.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

// ==========================================
// TIERS
// ==========================================

describe('Loyalty Tiers', () => {
    let createdTierId;

    it('GET /api/loyalty/tiers — list tiers', async () => {
        const res = await authRequest('GET', '/api/loyalty/tiers');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return array');
    });

    it('POST /api/loyalty/tiers — create tier', async () => {
        const res = await authRequest('POST', '/api/loyalty/tiers', {
            name: 'Smoke Test Tier',
            min_bookings: 100,
            min_spent: 50000,
            discount_percent: 25,
            color: '#FF00FF',
            sort_order: 99
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
        assert.ok(res.data.id, 'Should return tier with id');
        createdTierId = res.data.id;
    });

    it('PUT /api/loyalty/tiers/:id — update tier', async () => {
        if (!createdTierId) return;
        const res = await authRequest('PUT', `/api/loyalty/tiers/${createdTierId}`, {
            name: 'Smoke Tier Updated',
            discount_percent: 30
        });
        assert.equal(res.status, 200);
    });

    it('DELETE /api/loyalty/tiers/:id — delete tier', async () => {
        if (!createdTierId) return;
        const res = await authRequest('DELETE', `/api/loyalty/tiers/${createdTierId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

// ==========================================
// CUSTOMERS
// ==========================================

describe('Loyalty Customers', () => {
    it('GET /api/loyalty/customers — list with pagination', async () => {
        const res = await authRequest('GET', '/api/loyalty/customers?page=1&limit=5');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.items), 'Should return items');
        assert.ok(typeof res.data.total === 'number');
    });

    it('POST /api/loyalty/recalculate — recalculate tiers', async () => {
        const res = await authRequest('POST', '/api/loyalty/recalculate');
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        assert.ok(typeof res.data.updated === 'number');
    });
});

// ==========================================
// DISCOUNTS
// ==========================================

describe('Loyalty Discounts', () => {
    let createdDiscountId;

    it('GET /api/loyalty/discounts — list discounts', async () => {
        const res = await authRequest('GET', '/api/loyalty/discounts');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return array');
    });

    it('POST /api/loyalty/discounts — create discount', async () => {
        const uniqueCode = 'SMOKE_' + Date.now();
        const res = await authRequest('POST', '/api/loyalty/discounts', {
            code: uniqueCode,
            name: 'Smoke Test Discount',
            type: 'percent',
            value: 10,
            min_order: 1000,
            max_uses: 5,
            valid_from: '2099-01-01',
            valid_until: '2099-12-31'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
        assert.ok(res.data.id);
        createdDiscountId = res.data.id;
    });

    it('POST /api/loyalty/discounts/validate — validate code', async () => {
        const res = await authRequest('POST', '/api/loyalty/discounts/validate', {
            code: 'NONEXISTENT_CODE',
            price: 5000
        });
        assert.equal(res.status, 200);
        assert.ok(typeof res.data.valid === 'boolean');
    });

    it('PUT /api/loyalty/discounts/:id — update discount', async () => {
        if (!createdDiscountId) return;
        const res = await authRequest('PUT', `/api/loyalty/discounts/${createdDiscountId}`, {
            name: 'Smoke Discount Updated',
            value: 15
        });
        assert.equal(res.status, 200);
    });

    it('DELETE /api/loyalty/discounts/:id — delete discount', async () => {
        if (!createdDiscountId) return;
        const res = await authRequest('DELETE', `/api/loyalty/discounts/${createdDiscountId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

// ==========================================
// PROPOSALS
// ==========================================

describe('Loyalty Proposals', () => {
    let createdProposalId;

    it('GET /api/loyalty/proposals — list proposals', async () => {
        const res = await authRequest('GET', '/api/loyalty/proposals');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return array');
    });

    it('POST /api/loyalty/proposals — create proposal', async () => {
        const res = await authRequest('POST', '/api/loyalty/proposals', {
            title: 'Smoke Proposal',
            description: 'Test proposal for smoke tests',
            target_segment: 'loyal',
            start_date: '2099-01-01',
            end_date: '2099-06-30',
            banner_color: '#00AAFF'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
        assert.ok(res.data.id);
        createdProposalId = res.data.id;
    });

    it('PUT /api/loyalty/proposals/:id — update proposal', async () => {
        if (!createdProposalId) return;
        const res = await authRequest('PUT', `/api/loyalty/proposals/${createdProposalId}`, {
            title: 'Smoke Proposal Updated'
        });
        assert.equal(res.status, 200);
    });

    it('DELETE /api/loyalty/proposals/:id — delete proposal', async () => {
        if (!createdProposalId) return;
        const res = await authRequest('DELETE', `/api/loyalty/proposals/${createdProposalId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
