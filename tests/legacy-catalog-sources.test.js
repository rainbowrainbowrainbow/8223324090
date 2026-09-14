'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const express = require('express');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');

function principal(context, membership = false, registry = null, modules = []) {
    const user = { id: 21, username: 'catalog_fixture', role: 'creator',
        business_contexts: [context], default_business_context: context };
    const rows = membership ? [{ organization_id: 1, business_id: 2, context_key: context,
        business_modules: modules, access_mode: 'membership', role: 'creator', is_default: true }] : [];
    return applyMembershipAccess(user, buildMembershipAccess(user, rows, context, registry || rows));
}

function requestFor(context, membership = false) {
    return { user: principal(context, membership), headers: { 'x-business-context': context }, body: {}, query: {} };
}

function loadModule(relative, mocks = {}) {
    const filename = path.join(__dirname, '..', relative);
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, require(id) { return Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id); },
        console, process, Buffer, Date, URL, setTimeout, clearTimeout, setInterval, clearInterval,
        __filename: filename, __dirname: path.dirname(filename)
    }, { filename });
    return module.exports;
}

function authFixture() {
    return { ...require('../middleware/auth'), authenticateToken: (_req, _res, next) => next() };
}

async function withHttp(router, user, run) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use(router);
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const request = async (route, body) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
            method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Connection: 'close',
                'X-Business-Context': user.default_business_context }, body: body ? JSON.stringify(body) : undefined
        });
        return { status: response.status, body: await response.json() };
    };
    try { await run(request); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

function assertUnavailable(marker) {
    assert.equal(marker.available, false);
    assert.equal(marker.code, 'catalogs_not_migrated');
    assert.ok(marker.message);
}

function routePool() {
    const queries = [];
    return { queries, async query(sql, params = []) {
        queries.push({ sql, params });
        if (/FROM graduation_packages/.test(sql)) return { rows: [{ count: 7 }] };
        if (/FROM catalog_definitions/.test(sql)) return { rows: [{ id: 'cake', name: 'Legacy fixture', item_count: 2, count: 2 }] };
        if (/FROM catalog_items/.test(sql)) return { rows: [{ id: 31, name: 'Legacy item' }] };
        if (/FROM art_director_content/.test(sql)) return { rows: /COUNT/.test(sql) ? [{ c: 3 }] : [{ id: 41, title: 'Existing Art fixture' }] };
        if (/FROM tasks/.test(sql)) return { rows: [{ id: 51, title: 'Scoped design fixture' }] };
        throw new Error('Unexpected catalog route query: ' + sql);
    } };
}

test('membership Park products retain the scoped graduation entry without reading global catalogs', async () => {
    const pool = routePool();
    const router = loadModule('routes/products.js', { '../db': { pool }, '../middleware/auth': authFixture() });
    await withHttp(router, principal('event_genix', true, null, ['graduation']), async request => {
        const result = await request('/catalogs');
        assert.equal(result.status, 200);
        assertUnavailable(result.body.legacyCatalogs);
        assert.deepEqual(result.body.catalogs.map(item => item.id), ['graduation']);
        assert.equal(result.body.catalogs[0].pageCount, 7);
        assert.equal(pool.queries.length, 1);
        assert.match(pool.queries[0].sql, /business_context[^]*= \$1/);
        assert.deepEqual(Array.from(pool.queries[0].params), ['event_genix']);
    });
});

for (const context of ['dar', 'crm', 'maysternya_doli']) {
    test(`${context} products explicitly withhold global catalogs before SQL`, async () => {
        const pool = routePool();
        const router = loadModule('routes/products.js', { '../db': { pool }, '../middleware/auth': authFixture() });
        await withHttp(router, principal(context, context === 'dar'), async request => {
            const result = await request('/catalogs');
            assert.equal(result.status, 200);
            assertUnavailable(result.body.legacyCatalogs);
            assert.deepEqual(result.body.catalogs, []);
            assert.equal(pool.queries.length, 0);
        });
    });
}

test('pre-cutover Park keeps its legacy product catalog contract plus an available marker', async () => {
    const pool = routePool();
    const router = loadModule('routes/products.js', { '../db': { pool }, '../middleware/auth': authFixture() });
    await withHttp(router, principal('event_genix'), async request => {
        const result = await request('/catalogs');
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.legacyCatalogs, { available: true, code: null, message: null });
        assert.deepEqual(result.body.catalogs.map(item => item.id), ['graduation', 'cake']);
        assert.equal(result.body.catalogs[1].href, '/designs#catalog-cake');
        assert.equal(pool.queries.length, 2);
    });
});

for (const [context, membership] of [['event_genix', true], ['dar', true], ['crm', false], ['maysternya_doli', false]]) {
    test(`${context} dashboard scopes tasks and withholds unavailable global catalog and Art components`, async () => {
        const pool = routePool();
        const router = loadModule('routes/dashboard.js', { '../db': { pool }, '../middleware/auth': authFixture() });
        await withHttp(router, principal(context, membership), async request => {
            const catalogs = await request('/widgets/catalogs');
            assert.equal(catalogs.status, 200, JSON.stringify(catalogs.body));
            assertUnavailable(catalogs.body.data.legacyCatalogs);
            assert.deepEqual(catalogs.body.data.definitions, []);
            assert.equal(pool.queries.length, 0);
            const pipeline = await request('/widgets/content_pipeline');
            assert.equal(pipeline.status, 200, JSON.stringify(pipeline.body));
            assertUnavailable(pipeline.body.data.legacyCatalogs);
            assert.deepEqual(pipeline.body.data.catalogs, []);
            if (context === 'event_genix') {
                assert.equal(pipeline.body.data.approvedThisWeek, 3);
                assert.equal(pipeline.body.data.inReview[0].id, 41);
                assert.equal(pipeline.body.data.meta.sourceStates.approvedThisWeek, 'ready');
                assert.equal(pool.queries.filter(item => /FROM art_director_content/.test(item.sql)).length, 2);
            } else {
                assert.equal(pipeline.body.data.approvedThisWeek, null);
                assert.deepEqual(pipeline.body.data.inReview, []);
                assert.equal(pipeline.body.data.meta.sourceStates.approvedThisWeek, 'unavailable');
                assert.equal(pipeline.body.data.meta.sourceStates.inReview, 'unavailable');
                assert.equal(pool.queries.filter(item => /FROM art_director_content/.test(item.sql)).length, 0);
            }
            assert.equal(pipeline.body.data.designTasks[0].id, 51);
            assert.equal(pool.queries.length, context === 'event_genix' ? 3 : 1);
            assert.ok(pool.queries.every(item => !/catalog_definitions|catalog_items/.test(item.sql)));
            const taskQuery = pool.queries.find(item => /FROM tasks/.test(item.sql));
            assert.deepEqual(Array.from(taskQuery.params), ['catalog_fixture', 21, 21, context]);
            assert.match(taskQuery.sql, /visibility/);
            assert.match(taskQuery.sql, /owner_user_id/);
            assert.match(taskQuery.sql, /business_context[^]*= \$4/);
            assert.equal(pipeline.body.data.meta.sourceStates.designTasks, 'ready');
        });
    });
}

test('pre-cutover Park dashboard keeps the original legacy rows', async () => {
    const pool = routePool();
    const router = loadModule('routes/dashboard.js', { '../db': { pool }, '../middleware/auth': authFixture() });
    await withHttp(router, principal('event_genix'), async request => {
        const result = await request('/widgets/catalogs');
        assert.equal(result.status, 200);
        assert.equal(result.body.data.legacyCatalogs.available, true);
        assert.equal(result.body.data.definitions[0].id, 'cake');
        assert.equal(result.body.data.recentItems[0].id, 31);
        assert.equal(pool.queries.length, 2);
    });
});

test('registered Park compatibility access keeps catalogs before membership cutover', async () => {
    const pool = routePool();
    const router = loadModule('routes/products.js', { '../db': { pool }, '../middleware/auth': authFixture() });
    const user = principal('event_genix', false, [{ organization_id: 1, business_id: 2, context_key: 'event_genix',
        access_mode: 'compatibility', business_status: 'active', organization_status: 'active' }]);
    await withHttp(router, user, async request => {
        const result = await request('/catalogs');
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.legacyCatalogs.available, true);
        assert.ok(result.body.catalogs.some(item => item.id === 'cake'));
    });
});

function omniFixture() {
    const state = { registry: [], queries: [], providerInputs: [] };
    const pool = { async query(sql, params = []) {
        state.queries.push({ sql, params });
        if (/FROM businesses b/.test(sql)) return { rows: state.registry };
        if (/FROM catalog_items ci/.test(sql)) return { rows: [{ id: 31, catalog_id: 'cake', name: 'LEGACY_GLOBAL_SENTINEL', price: 19 }] };
        if (/FROM products/.test(sql)) return { rows: [{ id: 'scoped_' + params[0], name: 'Scoped ' + params[0], domain: 'program', price: 17 }] };
        if (/FROM conversations/.test(sql)) return { rows: [{ id: 77, business_context: 'dar', channel: 'test', customer_name: 'Fixture' }] };
        if (/FROM conversation_messages/.test(sql)) return { rows: [{ id: 1, direction: 'inbound', content: 'Birthday party', created_at: new Date() }] };
        if (/UPDATE conversations/.test(sql)) return { rows: [], rowCount: 1 };
        throw new Error('Unexpected Omni catalog query: ' + sql);
    } };
    const service = loadModule('services/omniLeadAssistant.js', {
        '../db': { pool }, './cache': { settingsCache: { get: () => ({}), set() {}, invalidate() {} } },
        './ai-config': { DEFAULT_MODELS: { openrouter: 'fixture' }, async callUnifiedChatCompletion(input) {
            state.providerInputs.push(JSON.parse(input.userMessage));
            return { ok: true, text: '{}', model: 'fixture' };
        } }
    });
    const config = service.normalizeLeadAssistantConfig({ manualMaterials: [], catalogSources: [
        { id: 'products', source: 'products', enabled: true, tags: [] },
        { id: 'catalogs', source: 'catalog_items', enabled: true, tags: [] }
    ] });
    return { service, state, config };
}

for (const [context, membership] of [['event_genix', true], ['dar', true], ['crm', false], ['maysternya_doli', false]]) {
    test(`${context} Omni keeps scoped products and excludes legacy material before SQL`, async () => {
        const { service, state, config } = omniFixture();
        const salesContext = await service.getLeadAssistantSalesContext(config, {}, { businessContext: context, request: requestFor(context, membership) });
        assertUnavailable(salesContext.legacyCatalogs);
        assert.equal(salesContext.materials.length, 1);
        assert.equal(salesContext.materials[0].sourceId, 'scoped_' + context);
        assert.equal(state.queries.length, 1);
        assert.match(state.queries[0].sql, /FROM products/);
        assert.equal(state.queries[0].params[0], context);
    });
}

test('internal Omni registry is fresh on each read and cannot default missing context to Park', async () => {
    const { service, state, config } = omniFixture();
    const missing = await service.getLeadAssistantSalesContext(config);
    assertUnavailable(missing.legacyCatalogs);
    assert.equal(missing.materials.length, 0);
    assert.equal(state.queries.length, 0);
    const beforeCutover = await service.getLeadAssistantSalesContext(config, {}, { businessContext: 'event_genix' });
    assert.equal(beforeCutover.legacyCatalogs.available, true);
    assert.ok(beforeCutover.materials.some(item => item.title === 'LEGACY_GLOBAL_SENTINEL'));
    state.registry = [{ access_mode: 'compatibility', business_status: 'active', organization_status: 'active' }];
    const beforeMembership = await service.getLeadAssistantSalesContext(config, {}, { businessContext: 'event_genix' });
    assert.equal(beforeMembership.legacyCatalogs.available, true);
    assert.ok(beforeMembership.materials.some(item => item.title === 'LEGACY_GLOBAL_SENTINEL'));
    state.registry = [{ access_mode: 'membership', business_status: 'active', organization_status: 'active' }];
    state.queries.length = 0;
    const afterCutover = await service.getLeadAssistantSalesContext(config, {}, { businessContext: 'event_genix' });
    assertUnavailable(afterCutover.legacyCatalogs);
    assert.ok(afterCutover.materials.every(item => item.source === 'product'));
    assert.equal(state.queries.length, 2);
    assert.ok(state.queries.every(item => !/FROM catalog_items/.test(item.sql)));
});

test('Omni script test uses trusted options instead of body context and excludes legacy provider input', async () => {
    const { service, state, config } = omniFixture();
    const analysis = await service.testLeadAssistantScript({ businessContext: 'event_genix', settings: config,
        transcript: 'Client: Birthday party' }, { businessContext: 'dar', request: requestFor('dar', true) });
    assertUnavailable(analysis.salesContext.legacyCatalogs);
    assert.equal(state.providerInputs.length, 1);
    assert.ok(state.providerInputs[0].availableSalesMaterials.every(item => item.source === 'product'));
    assert.ok(state.providerInputs[0].availableSalesMaterials.some(item => item.sourceId === 'scoped_dar'));
    assert.equal(JSON.stringify(state.providerInputs).includes('LEGACY_GLOBAL_SENTINEL'), false);
    assert.ok(state.queries.every(item => !/FROM catalog_items/.test(item.sql)));
});

test('background conversation analysis derives material context from its stored conversation', async () => {
    const { service, state } = omniFixture();
    const analysis = await service.analyzeConversationLead(77);
    assertUnavailable(analysis.salesContext.legacyCatalogs);
    assert.ok(state.providerInputs[0].availableSalesMaterials.every(item => item.sourceId === 'scoped_dar'));
    assert.ok(state.queries.filter(item => /FROM products/.test(item.sql)).every(item => item.params[0] === 'dar'));
    assert.ok(state.queries.every(item => !/FROM catalog_items/.test(item.sql)));
});

test('Omni HTTP sales-context, script-test and analysis propagate the same authenticated business request', async () => {
    const seen = [];
    const service = {
        getLeadAssistantSettings: async () => ({}),
        getLeadAssistantSalesContext: async (_config, _bundle, options) => { seen.push(options); return {}; },
        testLeadAssistantScript: async (_input, options) => { seen.push(options); return {}; },
        analyzeConversationLead: async (_id, options) => { seen.push(options); return {}; }
    };
    const router = loadModule('routes/omnichannel.js', { '../services/omniLeadAssistant': service, '../middleware/auth': authFixture() });
    const user = principal('dar', true);
    await withHttp(router, user, async request => {
        for (const [url, body] of [['/lead-assistant/sales-context'], ['/lead-assistant/test', { transcript: 'Fixture' }], ['/conversations/77/lead-assistant/analyze', {}]]) {
            const response = await request(url, body);
            assert.equal(response.status, 200, JSON.stringify(response.body));
        }
        assert.equal(seen.length, 3);
        assert.ok(seen.every(options => options.businessContext === 'dar' && options.request.user === user));
    });
});
