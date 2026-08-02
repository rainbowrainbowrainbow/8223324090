'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { canUseAction, requireAction } = require('../middleware/auth');
const { isPublicApiRequest } = require('../middleware/apiAuthBoundary');

const ROOT = path.resolve(__dirname, '..');

function installMock(modulePath, exportsValue) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports: exportsValue };
}

function accessHeaders(role = 'viewer', denyActions = []) {
    return {
        'x-test-auth': 'yes',
        'x-role': role,
        'x-deny-actions': denyActions.join(','),
        'content-type': 'application/json'
    };
}

async function requestJson(baseUrl, pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, options);
    return { status: response.status, body: await response.json() };
}

async function withMockedRouter(routeModule, query, run) {
    const routePath = require.resolve(routeModule);
    const dbPath = require.resolve('../db');
    const authPath = require.resolve('../middleware/auth');
    const previous = new Map([routePath, dbPath, authPath].map(id => [id, require.cache[id]]));
    const calls = [];
    const actualAuth = require('../middleware/auth');

    delete require.cache[routePath];
    installMock('../db', {
        pool: {
            query: async (...args) => {
                calls.push(args);
                return query(...args);
            }
        }
    });
    installMock('../middleware/auth', {
        authenticateToken: (req, res, next) => {
            if (req.headers['x-test-auth'] !== 'yes') {
                return res.status(401).json({ error: 'Authentication required' });
            }
            req.user = {
                id: 401,
                role: req.headers['x-role'] || 'viewer',
                action_denylist: String(req.headers['x-deny-actions'] || '').split(',').filter(Boolean)
            };
            return next();
        },
        canUseAction: actualAuth.canUseAction,
        requireAction: actualAuth.requireAction
    });

    const app = express();
    app.use(express.json());
    app.use('/api', require(routePath));
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

function packagesQuery(text) {
    if (text.includes('SELECT * FROM packages WHERE is_active')) {
        return { rows: [{ code: 'starter', name: 'Starter', price_monthly: 490, is_active: true }] };
    }
    if (text.includes('SELECT * FROM packages WHERE code')) {
        return { rows: [{ code: 'starter', name: 'Starter', price_monthly: 490 }] };
    }
    if (text.includes('SELECT code, name, description, package_min FROM feature_flags')) {
        return { rows: [{ code: 'calendar', name: 'Calendar', package_min: 'starter' }] };
    }
    if (text.includes('SELECT * FROM feature_flags')) {
        return { rows: [{ code: 'internal_preview', name: 'Internal preview', is_enabled: true }] };
    }
    if (text.includes('INSERT INTO packages') || text.includes('UPDATE packages')) {
        return { rows: [{ code: 'starter', name: 'Starter', price_monthly: 490 }] };
    }
    if (text.includes('INSERT INTO feature_flags') || text.includes('UPDATE feature_flags')) {
        return { rows: [{ code: 'internal_preview', is_enabled: true }] };
    }
    throw new Error(`Unexpected package query: ${text}`);
}

function subscriptionQuery(text) {
    if (text.includes('CREATE TABLE IF NOT EXISTS subscription')) return { rows: [] };
    if (text.includes('SELECT COUNT(*) FROM subscription')) return { rows: [{ count: '1' }] };
    if (text.includes('SELECT * FROM subscription')) {
        return {
            rows: [{
                plan_name: 'CRM Pro', amount: 2500, next_payment_date: '2099-01-15',
                billing_period: 'monthly', notes: 'Internal accounting note'
            }]
        };
    }
    if (text.includes('UPDATE subscription SET')) return { rows: [] };
    throw new Error(`Unexpected subscription query: ${text}`);
}

test('packages catalog requires authentication but keeps catalog price readable', async () => {
    await withMockedRouter('../routes/packages', packagesQuery, async ({ baseUrl, calls }) => {
        const unauthenticated = await requestJson(baseUrl, '/api/');
        assert.equal(unauthenticated.status, 401);
        assert.equal(calls.length, 0);

        const catalog = await requestJson(baseUrl, '/api/', { headers: accessHeaders('viewer') });
        assert.equal(catalog.status, 200);
        assert.equal(catalog.body.packages[0].price_monthly, 490);
        assert.equal(isPublicApiRequest({ method: 'GET', path: '/packages' }), false);
    });
});

test('package and feature-flag mutations require manage_settings before pool access', async () => {
    await withMockedRouter('../routes/packages', packagesQuery, async ({ baseUrl, calls }) => {
        for (const role of ['manager', 'senior_manager']) {
            const before = calls.length;
            const create = await requestJson(baseUrl, '/api/', {
                method: 'POST', headers: accessHeaders(role), body: JSON.stringify({ code: 'next', name: 'Next' })
            });
            assert.equal(create.status, 403, role);
            assert.deepEqual(create.body, { error: 'Insufficient permissions' });
            assert.equal(calls.length, before, role);
        }

        const beforeFlags = calls.length;
        const flags = await requestJson(baseUrl, '/api/flags/all', { headers: accessHeaders('manager') });
        assert.equal(flags.status, 403);
        assert.equal(calls.length, beforeFlags);

        const beforeToggle = calls.length;
        const toggle = await requestJson(baseUrl, '/api/flags/internal_preview', {
            method: 'PUT', headers: accessHeaders('senior_manager'), body: JSON.stringify({ is_enabled: false })
        });
        assert.equal(toggle.status, 403);
        assert.equal(calls.length, beforeToggle);
    });
});

test('manage_settings defaults allow creator and director, while explicit deny wins', async () => {
    await withMockedRouter('../routes/packages', packagesQuery, async ({ baseUrl, calls }) => {
        for (const role of ['creator', 'director']) {
            const created = await requestJson(baseUrl, '/api/', {
                method: 'POST', headers: accessHeaders(role), body: JSON.stringify({ code: `pkg_${role}`, name: role })
            });
            assert.equal(created.status, 200, role);
            assert.equal(created.body.success, true, role);
        }

        const before = calls.length;
        const denied = await requestJson(baseUrl, '/api/flags/internal_preview', {
            method: 'PUT', headers: accessHeaders('creator', ['manage_settings']), body: JSON.stringify({ is_enabled: false })
        });
        assert.equal(denied.status, 403);
        assert.deepEqual(denied.body, { error: 'Insufficient permissions' });
        assert.equal(calls.length, before);

        const flags = await requestJson(baseUrl, '/api/flags/all', { headers: accessHeaders('director') });
        assert.equal(flags.status, 200);
        assert.equal(flags.body.flags[0].is_enabled, true);
    });
});

test('subscription status redacts amount and notes by capability', async () => {
    await withMockedRouter('../routes/subscription', subscriptionQuery, async ({ baseUrl }) => {
        const viewer = await requestJson(baseUrl, '/api/status', { headers: accessHeaders('viewer') });
        assert.equal(viewer.status, 200);
        assert.equal(viewer.body.planName, 'CRM Pro');
        assert.equal(viewer.body.nextPaymentDate, '2099-01-15');
        assert.equal('amount' in viewer.body, false);
        assert.equal('notes' in viewer.body, false);

        for (const role of ['manager', 'accountant', 'creator']) {
            const allowed = await requestJson(baseUrl, '/api/status', { headers: accessHeaders(role) });
            assert.equal(allowed.status, 200, role);
            assert.equal(allowed.body.amount, 2500, role);
        }

        const deniedRevenue = await requestJson(baseUrl, '/api/status', {
            headers: accessHeaders('director', ['view_revenue'])
        });
        assert.equal('amount' in deniedRevenue.body, false);
        assert.equal(deniedRevenue.body.notes, 'Internal accounting note');
    });
});

test('subscription PATCH checks manage_settings and amount revenue access before pool access', async () => {
    await withMockedRouter('../routes/subscription', subscriptionQuery, async ({ baseUrl, calls }) => {
        const manager = await requestJson(baseUrl, '/api/', {
            method: 'PATCH', headers: accessHeaders('manager'), body: JSON.stringify({ planName: 'CRM Plus' })
        });
        assert.equal(manager.status, 403);
        assert.equal(calls.length, 0);

        const deniedAmount = await requestJson(baseUrl, '/api/', {
            method: 'PATCH', headers: accessHeaders('creator', ['view_revenue']), body: JSON.stringify({ amount: 3000 })
        });
        assert.equal(deniedAmount.status, 403);
        assert.deepEqual(deniedAmount.body, { error: 'Insufficient permissions' });
        assert.equal(calls.length, 0);

        const beforeExplicitDeny = calls.length;
        const deniedSettings = await requestJson(baseUrl, '/api/', {
            method: 'PATCH', headers: accessHeaders('director', ['manage_settings']), body: JSON.stringify({ planName: 'CRM Plus' })
        });
        assert.equal(deniedSettings.status, 403);
        assert.equal(calls.length, beforeExplicitDeny);

        const allowed = await requestJson(baseUrl, '/api/', {
            method: 'PATCH', headers: accessHeaders('creator'), body: JSON.stringify({ amount: 3000 })
        });
        assert.equal(allowed.status, 200);
        assert.equal(allowed.body.success, true);
        assert.ok(calls.length >= 3);
    });
});

test('package routing and UI use capability guards and fail closed until hydration', () => {
    const packages = fs.readFileSync(path.join(ROOT, 'routes', 'packages.js'), 'utf8');
    const subscription = fs.readFileSync(path.join(ROOT, 'routes', 'subscription.js'), 'utf8');
    const demo = fs.readFileSync(path.join(ROOT, 'js', 'demo-page.js'), 'utf8');
    const center = fs.readFileSync(path.join(ROOT, 'center.html'), 'utf8');

    assert.match(packages, /router\.use\(authenticateToken\);/);
    assert.match(packages, /router\.get\('\/flags\/all', requireSettingsManagement, async/);
    assert.match(packages, /router\.get\('\/compare\/all', requireSettingsManagement, async/);
    assert.ok(packages.indexOf("router.get('/compare/all'") < packages.indexOf('registerPackageCatalogDetailRoute();'));
    assert.match(subscription, /router\.patch\('\/', requireAction\('manage_settings'\), requireSubscriptionAmountAccess, async/);
    assert.match(subscription, /if \(canUseAction\(req\.user, 'view_revenue'\)\) payload\.amount = sub\.amount;/);
    assert.match(subscription, /if \(canUseAction\(req\.user, 'manage_settings'\)\) payload\.notes = sub\.notes;/);
    assert.match(demo, /function resolveManageSettingsAccess\(\)[\s\S]*lifecycle\?\.status === 'ready'[\s\S]*canAccess\('manage_settings'\) === true/);
    assert.match(demo, /async function loadFlags\(\)[\s\S]*if \(!canManageSettings\)/);
    assert.match(demo, /\$\{canManageSettings \? `<label class="toggle-switch"/);
    assert.match(center, /const subscriptionCanViewRevenue = \(\) => \{[\s\S]*lifecycle\?\.status === 'ready'[\s\S]*canAccess\('view_revenue'\) === true/);
});

test('capability defaults keep explicit deny authoritative', () => {
    assert.equal(canUseAction({ role: 'creator' }, 'manage_settings'), true);
    assert.equal(canUseAction({ role: 'director' }, 'manage_settings'), true);
    assert.equal(canUseAction({ role: 'creator', action_denylist: ['manage_settings'] }, 'manage_settings'), false);

    let nextCalled = false;
    requireAction('manage_settings')(
        { user: { role: 'director', action_denylist: ['manage_settings'] } },
        { status: () => ({ json: () => undefined }) },
        () => { nextCalled = true; }
    );
    assert.equal(nextCalled, false);
});
