'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { requireAction } = require('../middleware/auth');
const express = require('express');
const financeRouter = require('../routes/finance');

const ROOT = path.resolve(__dirname, '..');
const financeRoute = fs.readFileSync(path.join(ROOT, 'routes', 'finance.js'), 'utf8');
const financePage = fs.readFileSync(path.join(ROOT, 'js', 'finance-page.js'), 'utf8');

function runGuard(user) {
    let statusCode = null;
    let payload = null;
    let nextCalled = false;
    requireAction('finance.manage')(
        { user },
        { status(code) { statusCode = code; return this; }, json(value) { payload = value; return this; } },
        () => { nextCalled = true; }
    );
    return { statusCode, payload, nextCalled };
}

test('Finance mutation router guard is capability-based and keeps account/payroll guards in place', () => {
    assert.match(financeRoute, /const requireFinanceManagement = requireAction\('finance\.manage'\);/);
    assert.match(financeRoute, /FINANCE_MUTATION_METHODS\.has\(req\.method\)/);
    assert.match(financeRoute, /assertFinanceTransactionNotPayrollManaged/);
    assert.match(financeRoute, /router\.post\('\/accounts', requireRole\('admin', 'senior_manager'\)/);
    assert.match(financeRoute, /router\.delete\('\/accounts\/:id', requireRole\('admin'\)/);
    assert.match(financePage, /function financeCanManageTransactions\(\)[\s\S]*finance\.manage/);
    assert.match(financePage, /addBtn\.style\.display = canManageTransactions \? '' : 'none'/);
    assert.doesNotMatch(financePage, /MANAGE_ROLES/);
});

test('Finance hydrates capabilities before exposing the verified user to shared auth', () => {
    const hydration = financePage.indexOf('await hydrateActionPermissions(user)');
    const currentUser = financePage.indexOf('AppState.currentUser = user;');
    assert.ok(hydration >= 0, 'Finance must hydrate the capability catalog during initialization');
    assert.ok(currentUser > hydration, 'Finance must not expose a verified user before capability hydration completes');
});
test('explicit Finance deny blocks the mutation guard before an endpoint can run', () => {
    const result = runGuard({ role: 'accountant', action_denylist: ['finance.manage'] });
    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 403);
    assert.deepEqual(result.payload, { error: 'Insufficient permissions' });
});
async function withFinanceRouter(user, run) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        next();
    });
    app.use('/api/finance', financeRouter);
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        await run(baseUrl);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('explicit Finance deny receives 403 from a real mutation endpoint before route logic', async () => {
    await withFinanceRouter({ role: 'accountant', action_denylist: ['finance.manage'] }, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/finance/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
    });
});
