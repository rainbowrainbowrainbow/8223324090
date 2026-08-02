'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { requireAction } = require('../middleware/auth');
const { shapeBanquetGroupForRevenueAccess } = require('../services/revenueAccessPolicy');

const ROOT = path.resolve(__dirname, '..');

function runActionGuard(user) {
    let statusCode = null;
    let payload = null;
    let nextCalled = false;
    requireAction('view_revenue')(
        { user },
        { status(code) { statusCode = code; return this; }, json(value) { payload = value; return this; } },
        () => { nextCalled = true; }
    );
    return { statusCode, payload, nextCalled };
}

test('banquet group shaping keeps operational fields but removes nested financial data', () => {
    const source = {
        group: { id: 'BQ-1', date: '2099-06-23', status: 'confirmed', total: 3200 },
        members: [{
            bookingId: 'BK-1',
            booking: {
                id: 'BK-1', date: '2099-06-23', room: 'Main hall', status: 'confirmed',
                amount: 3200, paidAmount: 1500, balance: 1700, paymentStatus: 'paid',
                accountingStatus: 'verified', accountingNote: 'private note', accountingMeta: { note: 'nested accounting note' },
                depositReceivedDate: '2099-06-01',
                deposit: { id: 10, amount: 1500, paymentMethod: 'cash', transactionReference: 'TR-1' },
                payment: { method: 'cash', transactionReference: 'TR-1' },
                nested: { expectedAmount: 1500, accountingNote: 'nested private note' }
            }
        }],
        bookings: { primary: { id: 'BK-1', date: '2099-06-23', room: 'Main hall', amount: 3200 } }
    };

    const redacted = shapeBanquetGroupForRevenueAccess(source, false);
    assert.notEqual(redacted, source);
    assert.equal(redacted.group.id, 'BQ-1');
    assert.equal(redacted.group.date, '2099-06-23');
    assert.equal(redacted.group.status, 'confirmed');
    assert.equal(redacted.members[0].booking.id, 'BK-1');
    assert.equal(redacted.members[0].booking.room, 'Main hall');
    assert.equal(redacted.members[0].booking.status, 'confirmed');
    for (const key of ['amount', 'paidAmount', 'balance', 'paymentStatus', 'accountingStatus', 'accountingNote', 'accountingMeta', 'depositReceivedDate', 'deposit', 'payment']) {
        assert.equal(key in redacted.members[0].booking, false, key);
    }
    assert.equal('expectedAmount' in redacted.members[0].booking.nested, false);
    assert.equal('accountingNote' in redacted.members[0].booking.nested, false);
    assert.equal(source.members[0].booking.deposit.amount, 1500, 'source must remain unchanged');
    assert.equal(shapeBanquetGroupForRevenueAccess(source, true), source, 'allowed users keep the canonical payload');
});

test('banquet financial routes use capability guards and shape mixed reads centrally', () => {
    const banquets = fs.readFileSync(path.join(ROOT, 'routes', 'banquets.js'), 'utf8');
    const deposits = fs.readFileSync(path.join(ROOT, 'routes', 'banquet-deposits.js'), 'utf8');

    assert.match(banquets, /const canViewRevenue = canUseAction\(req\.user, 'view_revenue'\);/);
    assert.match(banquets, /return res\.json\(shapeBanquetGroupForRevenueAccess\(payload, canViewRevenue\)\);/);
    assert.match(banquets, /router\.get\('\/by-booking\/:bookingId\/deposit', requireAction\('view_revenue'\), async/);
    assert.match(banquets, /router\.get\('\/:groupId\/deposit', requireAction\('view_revenue'\), async/);
    for (const declaration of [
        "router.get('/', requireRole(...ACCOUNTING_REVIEW_ROLES), requireRevenueView",
        "router.get('/:id', requireRole(...VIEW_ROLES), requireRevenueView",
        "router.post('/:id/review-start', requireRole(...ACCOUNTING_REVIEW_ROLES), requireRevenueView",
        "router.post('/:id/confirm', requireRole(...CONFIRM_ROLES), requireRevenueView",
        "router.patch('/:id/accounting', requireRole(...ACCOUNTING_REVIEW_ROLES), requireRevenueView",
        "router.patch('/:id', requireRole(...CONFIRM_ROLES), requireRevenueView"
    ]) assert.ok(deposits.includes(declaration), declaration);
});

function installMock(modulePath, exportsValue) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports: exportsValue };
}

async function withDepositRouter(run) {
    const routePath = require.resolve('../routes/banquet-deposits');
    const authPath = require.resolve('../middleware/auth');
    const contextPath = require.resolve('../services/businessContext');
    const servicePath = require.resolve('../services/banquetDeposits');
    const previous = new Map([routePath, authPath, contextPath, servicePath].map(id => [id, require.cache[id]]));
    const calls = { getById: 0, confirm: 0 };
    const deny = (req, action) => String(req.headers['x-deny-actions'] || '').split(',').includes(action);

    delete require.cache[routePath];
    installMock('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            req.user = { id: 17, role: req.headers['x-role'] || 'accountant', action_denylist: String(req.headers['x-deny-actions'] || '').split(',').filter(Boolean) };
            next();
        },
        requireRole: () => (_req, _res, next) => next(),
        requireAction: action => (req, res, next) => deny(req, action) ? res.status(403).json({ error: 'Insufficient permissions' }) : next()
    });
    installMock('../services/businessContext', {
        businessContextFromRequest: req => req.query.businessContext || null,
        requireBusinessContext: (_req, res, context) => context ? true : (res.status(400).json({ error: 'Business context is required' }), false)
    });
    installMock('../services/banquetDeposits', {
        BanquetDepositError: class BanquetDepositError extends Error {},
        getDepositProjectionById: async () => { calls.getById += 1; return { deposit: { id: 10, amount: 1500 } }; },
        listDepositsForAccounting: async () => ({ deposits: [] }),
        markDepositReviewStarted: async () => ({ changed: false, projection: {} }),
        confirmDeposit: async () => { calls.confirm += 1; return { projection: {} }; },
        patchDeposit: async () => ({ projection: {} }),
        verifyDepositAccounting: async () => ({ projection: {} })
    });

    const app = express();
    app.use(express.json());
    app.use('/api/banquet-deposits', require(routePath));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    try {
        await run({ baseUrl: `http://127.0.0.1:${server.address().port}`, calls });
    } finally {
        await new Promise(resolve => server.close(resolve));
        for (const [id, cached] of previous) {
            if (cached) require.cache[id] = cached;
            else delete require.cache[id];
        }
    }
}

test('explicit view_revenue deny returns 403 before deposit services for read and mutation', async () => {
    await withDepositRouter(async ({ baseUrl, calls }) => {
        const headers = { 'x-deny-actions': 'view_revenue', 'content-type': 'application/json' };
        const read = await fetch(`${baseUrl}/api/banquet-deposits/10?businessContext=event_genix`, { headers });
        assert.equal(read.status, 403);
        assert.deepEqual(await read.json(), { error: 'Insufficient permissions' });
        assert.equal(calls.getById, 0);

        const mutation = await fetch(`${baseUrl}/api/banquet-deposits/10/confirm?businessContext=event_genix`, {
            method: 'POST', headers, body: JSON.stringify({})
        });
        assert.equal(mutation.status, 403);
        assert.deepEqual(await mutation.json(), { error: 'Insufficient permissions' });
        assert.equal(calls.confirm, 0);
    });
});

test('view_revenue role defaults allow manager accountant and creator, while explicit deny wins', () => {
    for (const role of ['manager', 'accountant', 'creator']) {
        assert.equal(runActionGuard({ role }).nextCalled, true, role);
    }
    for (const role of ['director', 'accountant', 'creator']) {
        const denied = runActionGuard({ role, action_denylist: ['view_revenue'] });
        assert.equal(denied.nextCalled, false, role);
        assert.equal(denied.statusCode, 403, role);
        assert.deepEqual(denied.payload, { error: 'Insufficient permissions' }, role);
    }
});

test('booking and task UI fail closed until revenue permission hydration is ready', () => {
    const booking = fs.readFileSync(path.join(ROOT, 'js', 'booking.js'), 'utf8');
    const banquetDetail = fs.readFileSync(path.join(ROOT, 'js', 'booking-banquet-detail.js'), 'utf8');
    const tasks = fs.readFileSync(path.join(ROOT, 'js', 'tasks-page.js'), 'utf8');

    assert.match(booking, /function bookingCanViewDepositRevenue\(\)[\s\S]*getPermissionLifecycle[\s\S]*lifecycle\?\.status === 'ready'[\s\S]*canAccess\('view_revenue'\) === true/);
    assert.match(booking, /async function hydrateBookingDepositFromServer[\s\S]*if \(!syncBookingDepositRevenueAccess\(\)\)[\s\S]*'restricted'/);
    assert.match(booking, /async function loadBanquetDepositStatusForDetails[\s\S]*if \(!bookingCanViewDepositRevenue\(\)\) return;/);
    assert.match(booking, /async function openBookingPanel[\s\S]*syncBookingDepositRevenueAccess\(\)[\s\S]*await getLinesForDate/);
    assert.match(banquetDetail, /function renderBanquetDepositStatusSection[\s\S]*if \(!bookingDetailCanViewDepositMoney\(\)\) return '';/);

    assert.match(tasks, /function taskCanViewBanquetDepositRevenue\(\)[\s\S]*lifecycle\?\.status === 'ready'[\s\S]*canAccess\('view_revenue'\) === true/);
    assert.match(tasks, /function renderBanquetDepositTaskPanel[\s\S]*if \(!taskCanViewBanquetDepositRevenue\(\)\)[\s\S]*depositProjectionForTask/);
    assert.match(tasks, /async function confirmBanquetDepositFromTask[\s\S]*if \(!taskCanViewBanquetDepositRevenue\(\)\)[\s\S]*return false/);
    assert.match(tasks, /if \(depositTask && !taskCanViewBanquetDepositRevenue\(\)\)[\s\S]*VIEW_REVENUE_REQUIRED[\s\S]*else if \(depositTask && depositId\)[\s\S]*apiGetBanquetDeposit/);
});
