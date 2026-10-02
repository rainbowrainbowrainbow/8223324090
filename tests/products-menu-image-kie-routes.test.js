const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../db');
const imageStorage = require('../services/imageStorage');
const uploadedUrls = [];
imageStorage.uploadFromUrl = async (sourceUrl, _filename, options) => {
    options.validateUrl(sourceUrl);
    uploadedUrls.push(sourceUrl);
    return '/uploads/kie-draft.png';
};
const router = require('../routes/products');

const originalQuery = pool.query;
const originalFetch = global.fetch;
const originalKey = process.env.KIE_API_KEY;
const originalPublicBase = process.env.PUBLIC_BASE_URL;

afterEach(() => {
    pool.query = originalQuery;
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KIE_API_KEY;
    else process.env.KIE_API_KEY = originalKey;
    if (originalPublicBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = originalPublicBase;
});

test('saving a business burger blueprint feeds one reference to Kie without changing icon_url', async () => {
    process.env.KIE_API_KEY = 'synthetic-test-key';
    process.env.PUBLIC_BASE_URL = 'https://crm.example.com';
    const product = {
        id: 'menu-qa-1', business_context: 'event_genix', domain: 'kitchen', kitchen_type: 'menu',
        name: 'QA burger', icon_url: '/uploads/catalog-images/items/qa-burger.png', is_active: true,
        ai_card_draft: {}
    };
    const settings = new Map();
    pool.query = async (sql, params) => {
        if (sql.includes('WHERE p.id = $1')) return { rows: [{ ...product }], rowCount: 1 };
        if (sql.startsWith('SELECT value FROM settings')) {
            return { rows: settings.has(params[0]) ? [{ value: settings.get(params[0]) }] : [] };
        }
        if (sql.startsWith('INSERT INTO settings')) {
            settings.set(params[0], params[1]);
            return { rowCount: 1 };
        }
        if (sql.includes('jsonb_set(')) {
            product.ai_card_draft.imageStudio = JSON.parse(params[0]);
            return { rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql.slice(0, 50)}`);
    };
    const saved = await invoke(routeHandler('/menu-image/burger-blueprint', 'post'), 'POST', {
        businessContext: 'event_genix', productId: product.id,
        source: 'current', instructions: 'Same white plate, fries and ketchup cup.'
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.blueprint.imageUrl, product.icon_url);
    const requests = [];
    global.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ code: 200, data: { taskId: 'task_blueprint_1' } }), { status: 200 });
    };
    const generated = await invoke(routeHandler('/:id/menu-image/draft', 'post'), 'POST', {
        businessContext: 'event_genix', generator: 'kie/nano-banana-2'
    });
    assert.equal(generated.status, 202);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].input.image_input,
        ['https://crm.example.com/uploads/catalog-images/items/qa-burger.png']);
    assert.match(requests[0].input.prompt, /Same white plate, fries and ketchup cup/);
    assert.equal(product.icon_url, '/uploads/catalog-images/items/qa-burger.png');
});

function routeHandler(path, method) {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method])?.route;
    assert.ok(route, `${method.toUpperCase()} ${path} must exist`);
    return route.stack.at(-1).handle;
}

async function invoke(handler, method, body = {}) {
    const output = { status: 200, body: null };
    const req = {
        method, params: { id: 'menu-qa-1' }, body,
        query: { businessContext: 'event_genix' }, headers: {},
        user: { username: 'qa', role: 'admin' }
    };
    const res = {
        status(value) { output.status = value; return this; },
        json(value) { output.body = value; return this; },
        setHeader() { return this; }
    };
    await handler(req, res);
    return output;
}

test('Kie product route creates one task, persists its ID, and status polling never launches another task', async () => {
    process.env.KIE_API_KEY = 'synthetic-test-key';
    const product = {
        id: 'menu-qa-1', business_context: 'event_genix', domain: 'kitchen', kitchen_type: 'menu',
        name: 'QA burger', code: 'QA-BURGER', icon_url: '/uploads/current.jpg', is_active: true,
        ai_card_draft: {}
    };
    pool.query = async (sql, params) => {
        if (sql.includes('SELECT value FROM settings WHERE key = $1')) return { rows: [] };
        if (sql.includes('WHERE p.id = $1')) return { rows: [{ ...product }], rowCount: 1 };
        if (sql.includes('jsonb_set(')) {
            const studio = JSON.parse(params[0]);
            product.ai_card_draft = { ...product.ai_card_draft, imageStudio: studio };
            return { rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql.slice(0, 50)}`);
    };
    const providerCalls = [];
    let recordInfoCalls = 0;
    global.fetch = async (url, options) => {
        providerCalls.push({ url, method: options.method });
        const data = options.method === 'POST'
            ? { taskId: 'task_menu_123' }
            : (++recordInfoCalls === 1 ? { state: 'generating' } : {
                state: 'success',
                resultJson: JSON.stringify({ resultUrls: ['https://tempfileb.aiquickdraw.com/menu.png'] })
            });
        return new Response(JSON.stringify({ code: 200, data }), { status: 200 });
    };

    const start = await invoke(routeHandler('/:id/menu-image/draft', 'post'), 'POST', {
        businessContext: 'event_genix', generator: 'kie/nano-banana-2', size: '1536x1024'
    });
    assert.equal(start.status, 202);
    assert.equal(start.body.status, 'generating');
    assert.equal(product.ai_card_draft.imageStudio.taskId, 'task_menu_123');
    assert.equal(product.icon_url, '/uploads/current.jpg');

    const duplicate = await invoke(routeHandler('/:id/menu-image/generate', 'post'), 'POST', {
        businessContext: 'event_genix', generator: 'kie/nano-banana-2'
    });
    assert.equal(duplicate.status, 202);
    const status = await invoke(routeHandler('/:id/menu-image/status', 'get'), 'GET');
    assert.equal(status.body.status, 'generating');
    assert.equal(providerCalls.filter(call => call.method === 'POST').length, 1);
    assert.equal(providerCalls.filter(call => call.method === 'GET').length, 1);
    assert.equal(product.icon_url, '/uploads/current.jpg');

    const ready = await invoke(routeHandler('/:id/menu-image/status', 'get'), 'GET');
    assert.equal(ready.body.status, 'ready');
    assert.equal(product.ai_card_draft.imageStudio.imageUrl, '/uploads/kie-draft.png');
    assert.equal(product.ai_card_draft.imageStudio.taskId, null);
    assert.equal(product.icon_url, '/uploads/current.jpg');
    assert.deepEqual(uploadedUrls, ['https://tempfileb.aiquickdraw.com/menu.png']);
    assert.equal(providerCalls.filter(call => call.method === 'POST').length, 1);
});
