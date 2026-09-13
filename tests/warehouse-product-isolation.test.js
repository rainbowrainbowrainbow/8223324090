'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');

function userFor(context, membership = true, modules = []) {
    const user = { id: 42, username: 'fixture_member', role: 'creator', business_contexts: [context], default_business_context: context };
    if (!membership) return user;
    const access = buildMembershipAccess(user, [{ organization_id: 7, organization_role: 'member', business_id: 11,
        context_key: context, business_modules: modules, access_mode: 'membership', role: 'manager', is_default: true }], context);
    return applyMembershipAccess(user, access);
}

function loadRouter(name, pool, intake) {
    const ids = ['../db', '../middleware/auth', '../services/warehousePhotoIntake', `../routes/${name}`].map(require.resolve);
    const previous = new Map(ids.map(id => [id, require.cache[id]]));
    const install = (id, exports) => { require.cache[id] = { id, filename: id, loaded: true, exports }; };
    install(ids[0], { pool });
    install(ids[1], { authenticateToken: (req, res, next) => next(), canUseAction: () => true,
        requireRole: () => (req, res, next) => next(), requireAction: () => (req, res, next) => next() });
    install(ids[2], intake);
    delete require.cache[ids[3]];
    const router = require(ids[3]);
    return { router, restore() {
        for (const [id, entry] of previous) {
            if (entry) require.cache[id] = entry;
            else delete require.cache[id];
        }
    } };
}

async function withRouter(loaded, user, run) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = user; next(); });
    app.use(loaded.router);
    const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    try { await run(`http://127.0.0.1:${server.address().port}`); }
    finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        loaded.restore();
    }
}

test('membership and non-Park compatibility photo intake fails closed before provider or SQL access', async () => {
    const blocked = () => { throw new Error('Unsupported intake reached a provider or database'); };
    for (const [context, membership] of [['event_genix', true], ['dar', true], ['fixture_other', true], ['dar', false]]) {
        const intake = new Proxy({}, { get: () => blocked });
        const loaded = loadRouter('warehouse', { query: blocked, connect: blocked }, intake);
        await withRouter(loaded, userFor(context, membership), async base => {
            for (const [method, route] of [['GET', '/photo-intake/status'], ['GET', '/photo-intake'],
                ['GET', '/photo-intake/91'], ['POST', '/photo-intake/91/confirm'], ['POST', '/photo-intake/91/cancel']]) {
                const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', 'X-Business-Context': context },
                    ...(method === 'POST' ? { body: JSON.stringify({ warehouseStockId: 12 }) } : {}) });
                assert.equal(response.status, 403);
                assert.equal((await response.json()).code, 'warehouse_photo_intake_not_migrated');
            }
        });
    }
});

test('standard warehouse membership locations stay available and use the active business', async () => {
    const calls = [];
    const loaded = loadRouter('warehouse', { async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ id: 12, business_context: 'dar', name: 'Fixture location' }] };
    } }, {});
    await withRouter(loaded, userFor('dar'), async base => {
        const response = await fetch(base + '/locations?businessContext=dar');
        assert.equal(response.status, 200);
        assert.equal((await response.json()).locations[0].businessContext, 'dar');
        assert.deepEqual(calls[0].params, ['dar']);
    });
});

test('legacy Park confirmation passes an explicit service context without opening membership intake access', async () => {
    let received;
    const loaded = loadRouter('warehouse', { query() { throw new Error('Unexpected route SQL'); } }, {
        async confirmIntake(id, options) { received = options; return { success: true, stockId: 11 }; }
    });
    await withRouter(loaded, userFor('event_genix', false), async base => {
        const response = await fetch(base + '/photo-intake/91/confirm', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ warehouseStockId: 11 }) });
        assert.equal(response.status, 200);
        await response.json();
        assert.equal(received.businessContext, 'event_genix');
    });
});

test('every legacy CRM intake operation passes the server-resolved context to its service', async () => {
    const received = [];
    const loaded = loadRouter('warehouse', { query() { throw new Error('Unexpected route SQL'); } }, {
        async getIntakeStatus(options) { received.push(options); return {}; },
        async listIntakes(options) { received.push(options); return []; },
        async getIntake(id, options) { received.push(options); return { id }; },
        async confirmIntake(id, options) { received.push(options); return { success: true }; },
        async cancelIntake(id, options) { received.push(options); return { success: true }; }
    });
    await withRouter(loaded, userFor('event_genix', false), async base => {
        for (const [method, route] of [['GET', '/photo-intake/status'], ['GET', '/photo-intake'],
            ['GET', '/photo-intake/91'], ['POST', '/photo-intake/91/confirm'], ['POST', '/photo-intake/91/cancel']]) {
            const result = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' },
                ...(method === 'POST' ? { body: JSON.stringify({ draft: { businessContext: 'dar' } }) } : {}) });
            assert.equal(result.status, 200);
            await result.json();
        }
    });
    assert.equal(received.length, 5);
    assert.ok(received.every(options => options.businessContext === 'event_genix'));
});

test('CRM propagates service cutover403 and registry503 for all intake operations without generic500', async () => {
    for (const [status, code] of [[403, 'warehouse_photo_intake_not_migrated'], [503, 'warehouse_photo_intake_scope_unavailable']]) {
        const reject = async () => { throw Object.assign(new Error('Safe fixture denial'), { status, code }); };
        const result = async () => ({ success: false, status, error: code });
        const loaded = loadRouter('warehouse', { query() { throw new Error('Unexpected route SQL'); } }, {
            getIntakeStatus: reject, listIntakes: reject, getIntake: reject, confirmIntake: result, cancelIntake: result
        });
        await withRouter(loaded, userFor('event_genix', false), async base => {
            for (const [method, route] of [['GET', '/photo-intake/status'], ['GET', '/photo-intake'],
                ['GET', '/photo-intake/91'], ['POST', '/photo-intake/91/confirm'], ['POST', '/photo-intake/91/cancel']]) {
                const response = await fetch(base + route, { method });
                assert.equal(response.status, status);
                const payload = await response.json();
                assert.equal(payload.success, false);
                assert.equal(payload.code, code);
            }
        });
    }
});

test('membership Park catalog fallback skips global catalogs and counts scoped packages including zero', async () => {
    for (const count of [0, 2]) {
        const calls = [];
        const loaded = loadRouter('products', { async query(sql, params) {
            calls.push({ sql, params });
            assert.match(sql, /FROM graduation_packages/);
            assert.doesNotMatch(sql, /catalog_definitions|catalog_items|catalog_pages/);
            assert.match(sql, /COALESCE\(business_context, 'event_genix'\) = \$1/);
            assert.deepEqual(params, ['event_genix']);
            return { rows: [{ count }] };
        } }, {});
        await withRouter(loaded, userFor('event_genix', true, ['graduation']), async base => {
            const response = await fetch(base + '/catalogs');
            assert.equal(response.status, 200);
            const payload = await response.json();
            assert.equal(payload.catalogs[0].pageCount, count);
            assert.equal(payload.catalogs[0].itemCount, count);
            assert.equal(payload.legacyCatalogs.available, false);
            assert.equal(payload.legacyCatalogs.code, 'catalogs_not_migrated');
            assert.equal(calls.length, 1);
        });
    }
});

test('disabled Park graduation and unsupported custom graduation expose no catalog card or count SQL', async () => {
    for (const [context, modules] of [['event_genix', []], ['fixture_custom', ['graduation']]]) {
        let calls = 0;
        const loaded = loadRouter('products', { query() { calls += 1; throw new Error('Unavailable module reached SQL'); } }, {});
        await withRouter(loaded, userFor(context, true, modules), async base => {
            const response = await fetch(base + '/catalogs');
            assert.equal(response.status, 200);
            const payload = await response.json();
            assert.deepEqual(payload.catalogs, []);
            assert.equal(payload.legacyCatalogs.code, 'catalogs_not_migrated');
            assert.equal(calls, 0);
        });
    }
});
