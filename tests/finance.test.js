/**
 * tests/finance.test.js — Finance API Tests
 * Run: node --test tests/finance.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

// ==========================================
// CATEGORIES
// ==========================================

describe('Finance Categories', () => {
    let createdCategoryId;

    it('GET /api/finance/categories — list all', async () => {
        const res = await authRequest('GET', '/api/finance/categories');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return array');
    });

    it('GET /api/finance/categories?type=income — filter income', async () => {
        const res = await authRequest('GET', '/api/finance/categories?type=income');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
        for (const cat of res.data) {
            assert.equal(cat.type, 'income');
        }
    });

    it('GET /api/finance/categories?type=expense — filter expense', async () => {
        const res = await authRequest('GET', '/api/finance/categories?type=expense');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data));
        for (const cat of res.data) {
            assert.equal(cat.type, 'expense');
        }
    });

    it('POST /api/finance/categories — create category', async () => {
        const res = await authRequest('POST', '/api/finance/categories', {
            name: 'Smoke Test Category',
            type: 'expense',
            icon: '🧪',
            color: '#FF00FF'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.id, 'Should return category with id');
        createdCategoryId = res.data.id;
    });

    it('PUT /api/finance/categories/:id — update category', async () => {
        assert.ok(createdCategoryId, 'Need created category id');
        const res = await authRequest('PUT', `/api/finance/categories/${createdCategoryId}`, {
            name: 'Smoke Test Updated',
            icon: '✅',
            color: '#00FF00'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/finance/categories/:id — delete category', async () => {
        assert.ok(createdCategoryId, 'Need created category id');
        const res = await authRequest('DELETE', `/api/finance/categories/${createdCategoryId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

// ==========================================
// TRANSACTIONS
// ==========================================

describe('Finance Transactions', () => {
    let createdTransactionId;

    it('POST /api/finance/transactions — create income', async () => {
        const res = await authRequest('POST', '/api/finance/transactions', {
            type: 'income',
            amount: 5000,
            description: 'Smoke test income',
            date: '2099-01-15',
            paymentMethod: 'cash'
        });
        assert.ok([200, 201].includes(res.status), `Expected 200/201, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.id, 'Should return transaction with id');
        createdTransactionId = res.data.id;
    });

    it('POST /api/finance/transactions — create expense', async () => {
        const res = await authRequest('POST', '/api/finance/transactions', {
            type: 'expense',
            amount: 1500,
            description: 'Smoke test expense',
            date: '2099-01-15',
            paymentMethod: 'card'
        });
        assert.ok([200, 201].includes(res.status));
        assert.ok(res.data.id);
    });

    it('POST /api/finance/transactions — reject without required fields', async () => {
        const res = await authRequest('POST', '/api/finance/transactions', {
            description: 'Missing type and amount'
        });
        assert.ok([400, 500].includes(res.status));
    });

    it('GET /api/finance/transactions — list with pagination', async () => {
        const res = await authRequest('GET', '/api/finance/transactions?page=1&limit=5');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.transactions), 'Should return transactions array');
        assert.ok(typeof res.data.total === 'number', 'Should return total');
    });

    it('GET /api/finance/transactions?type=income — filter by type', async () => {
        const res = await authRequest('GET', '/api/finance/transactions?type=income');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.transactions));
    });

    it('GET /api/finance/transactions?from=2099-01-01&to=2099-01-31 — date range', async () => {
        const res = await authRequest('GET', '/api/finance/transactions?from=2099-01-01&to=2099-01-31');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.transactions));
    });

    it('PUT /api/finance/transactions/:id — update transaction', async () => {
        assert.ok(createdTransactionId, 'Need created transaction id');
        const res = await authRequest('PUT', `/api/finance/transactions/${createdTransactionId}`, {
            amount: 5500,
            description: 'Updated smoke test'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });

    it('DELETE /api/finance/transactions/:id — delete transaction', async () => {
        assert.ok(createdTransactionId, 'Need created transaction id');
        const res = await authRequest('DELETE', `/api/finance/transactions/${createdTransactionId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});

// ==========================================
// DASHBOARD & REPORTS
// ==========================================

describe('Finance Dashboard & Reports', () => {
    it('GET /api/finance/dashboard — default period', async () => {
        const res = await authRequest('GET', '/api/finance/dashboard?from=2099-01-01&to=2099-01-31');
        assert.equal(res.status, 200);
        assert.ok(res.data.totals, 'Should return totals');
        assert.ok(typeof res.data.totals.income === 'number');
        assert.ok(typeof res.data.totals.expense === 'number');
        assert.ok(typeof res.data.totals.profit === 'number');
    });

    it('GET /api/finance/report/monthly — yearly report', async () => {
        const res = await authRequest('GET', '/api/finance/report/monthly?year=2099');
        assert.equal(res.status, 200);
        assert.ok(res.data.year, 'Should return year');
        assert.ok(Array.isArray(res.data.months), 'Should return months array');
        assert.equal(res.data.months.length, 12, 'Should have 12 months');
    });

    it('GET /api/finance/report/salary — salary report', async () => {
        const res = await authRequest('GET', '/api/finance/report/salary?month=2099-01');
        assert.equal(res.status, 200);
        assert.ok(res.data.month, 'Should return month');
        assert.ok(Array.isArray(res.data.staff), 'Should return staff array');
    });
});

// ==========================================
// BUDGET
// ==========================================

describe('Finance Budget', () => {
    let createdBudgetId;

    it('GET /api/finance/budget — get budget plans', async () => {
        const res = await authRequest('GET', '/api/finance/budget?year=2099');
        assert.equal(res.status, 200);
        assert.ok(res.data.year, 'Should return year');
        assert.ok(Array.isArray(res.data.plans), 'Should return plans array');
    });

    it('PUT /api/finance/budget — create/update budget plan', async () => {
        // First get a category to use
        const cats = await authRequest('GET', '/api/finance/categories?type=expense');
        const categoryId = cats.data && cats.data[0] ? cats.data[0].id : null;
        if (!categoryId) return; // skip if no categories

        const res = await authRequest('PUT', '/api/finance/budget', {
            year: 2099,
            month: 1,
            categoryId,
            plannedAmount: 50000,
            notes: 'Smoke test budget'
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
        if (res.data.plan) createdBudgetId = res.data.plan.id;
    });

    it('GET /api/finance/budget/comparison — plan vs fact', async () => {
        const res = await authRequest('GET', '/api/finance/budget/comparison?year=2099&month=1');
        assert.equal(res.status, 200);
        assert.ok(res.data.year);
        assert.ok(res.data.month);
        assert.ok(Array.isArray(res.data.comparison));
    });

    it('DELETE /api/finance/budget/:id — delete plan', async () => {
        if (!createdBudgetId) return; // skip
        const res = await authRequest('DELETE', `/api/finance/budget/${createdBudgetId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success);
    });
});
