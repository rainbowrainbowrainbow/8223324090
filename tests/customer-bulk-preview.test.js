'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const { JSDOM } = require('jsdom');
const business = require('../services/businessContext');
const sources = require('../services/customerSource');
const birthdays = require('../services/customerBirthdaySegments');
const metrics = require('../services/customerBookingMetrics');

const root = path.resolve(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'routes/customers.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'js/customers-page.js'), 'utf8');

function between(source, startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start, `source block exists: ${startText}`);
    return source.slice(start, end);
}

// Use the production child projection without loading a database connection.
const childModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'services/customerChildren.js'), 'utf8'), {
    module: childModule,
    require: id => id === '../db' ? { pool: {} } : require(path.resolve(root, 'services', id))
});

function routeHarness(rows = [], children = [], failure = null) {
    const queries = [];
    let handler;
    const context = vm.createContext({
        ...business, ...sources, ...birthdays, ...metrics, ...childModule.exports,
        scopedBookingAggregateSql: metrics.buildScopedBookingAggregateSql,
        router: { post(route, role, fn) { assert.equal(route, '/bulk-message'); handler = fn; } },
        requireMinRole: role => { assert.equal(role, 'manager'); return null; },
        pool: {
            async query(sql, params) {
                queries.push({ sql: String(sql), params: JSON.parse(JSON.stringify(params || [])) });
                assert.match(String(sql).trim(), /^SELECT\b/i, 'preview never writes');
                if (failure) throw failure;
                return { rows: /^\s*SELECT id, business_context, customer_id/.test(sql) ? children : rows };
            }
        },
        log: { error() {} },
        normalizeSocialIdentities: () => []
    });
    vm.runInContext(
        between(routeSource, 'function requestBusinessContext(', 'function parseCustomerVisitBound(')
        + between(routeSource, 'function parseCustomerVisitBound(', 'let customerSocialIdentitiesColumnReady')
        + between(routeSource, 'async function loadCustomerChildrenMap(', 'function customerChildReviewActiveSql(')
        + between(routeSource, 'function mapCustomerRow(', 'function escapeCsv(')
        + between(routeSource, "router.post('/bulk-message'", '// List customers'),
        context
    );
    return {
        queries,
        async request(body) {
            let status = 200;
            let data;
            const res = {
                status(value) { status = value; return this; },
                json(value) { data = JSON.parse(JSON.stringify(value)); return this; }
            };
            await handler({ method: 'POST', body, query: {}, user: { id: 1, role: 'creator' } }, res);
            return { status, data };
        }
    };
}

for (const dryRun of [undefined, false, 'true', 1, null]) {
    test(`delivery is blocked before any query for dryRun=${String(dryRun)}`, async () => {
        const harness = routeHarness();
        const result = await harness.request({ template: 'Привіт!', dryRun });
        assert.equal(result.status, 501);
        assert.equal(result.data.success, false);
        assert.equal(result.data.code, 'bulk_delivery_unavailable');
        assert.equal(Object.hasOwn(result.data, 'sent'), false);
        assert.equal(harness.queries.length, 0);
    });
}

for (const template of ['', '  ', 42, {}, null]) {
    test(`preview rejects invalid text ${JSON.stringify(template)} before queries`, async () => {
        const harness = routeHarness();
        assert.equal((await harness.request({ dryRun: true, template })).status, 400);
        assert.equal(harness.queries.length, 0);
    });
}

test('preview returns exact segment size and canonical multi-child text without writes', async () => {
    const harness = routeHarness([
        { id: 101, business_context: 'dar', name: 'Олена $&', phone: '+380000000001', child_name: 'Legacy', segment_count: '27' }
    ], [
        { id: 1, customer_id: 101, business_context: 'dar', name: 'Аня', birthday: '2020-03-12', sort_order: 0 },
        { id: 2, customer_id: 101, business_context: 'dar', name: 'Іван', birthday: '2021-10-15', sort_order: 1 }
    ]);
    const result = await harness.request({
        dryRun: true, businessContext: 'dar',
        filters: { tags: ['Корпорат'], minVisits: 2, source: 'ig' },
        template: '{name}\n{childName}\n{childBirthday}\n{phone}'
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.segmentCount, 27);
    assert.equal(result.data.recipientCount, 27, 'legacy count stays compatible');
    assert.equal(result.data.deliveryAvailable, false);
    assert.equal(result.data.previewLimit, 20);
    assert.equal(Object.hasOwn(result.data, 'sent'), false);
    assert.equal(result.data.previews[0].customerId, 101);
    assert.match(result.data.previews[0].message, /^Олена \$&\n/);
    assert.match(result.data.previews[0].message, /Аня.*Іван/);
    assert.match(result.data.previews[0].message, /2020-03-12.*2021-10-15/);
    assert.match(result.data.previews[0].message, /\+380000000001$/);
    assert.equal(harness.queries.length, 2);
    assert.match(harness.queries[0].sql, /COUNT\(\*\) OVER\(\)/);
    assert.match(harness.queries[0].sql, /LIMIT 20/);
    assert.match(harness.queries[0].sql, /COALESCE\(b_agg\.booking_count, 0\) >=/);
    assert.doesNotMatch(harness.queries[0].sql, /c\.total_bookings/);
    assert.deepEqual(harness.queries[0].params, ['dar', ['Корпорат'], 'dar', metrics.customerMetricsDate(), 2, 'instagram']);
    assert.deepEqual(harness.queries[1].params, [[101], 'dar']);
});

test('empty segment is a successful zero preview without child queries', async () => {
    const harness = routeHarness();
    const result = await harness.request({ dryRun: true, template: '{name}' });
    assert.equal(result.status, 200);
    assert.equal(result.data.segmentCount, 0);
    assert.deepEqual(result.data.previews, []);
    assert.equal(harness.queries.length, 1);
});

test('birthday preview uses selected-month children and whole-segment child count', async () => {
    const harness = routeHarness([
        { id: 101, name: 'Test family', business_context: 'dar', child_name: 'Old', child_birthday: '2019-07-01',
            segment_count: '27', birthday_children_count: '54' }
    ], [
        { id: 1, customer_id: 101, business_context: 'dar', name: 'March', birthday: '2020-03-12' },
        { id: 2, customer_id: 101, business_context: 'dar', name: 'October A', birthday: '2021-10-15' },
        { id: 3, customer_id: 101, business_context: 'dar', name: 'October B', birthday: '2020-10-17' },
        { id: 4, customer_id: 101, business_context: 'dar', name: 'Replaced', birthday: '2020-10-18',
            source_payload: { manual_review: { status: 'superseded' } } }
    ]);
    const result = await harness.request({ dryRun: true, businessContext: 'dar',
        filters: { tags: ['Іменинники жовтня'] }, template: '{childName} / {childBirthday}' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.birthdaySegment, { months: [10], familyCount: 27, childCount: 54 });
    assert.equal(result.data.previews[0].message, 'October A, October B / 2021-10-15, 2020-10-17');
    assert.equal(result.data.previews[0].birthdayChildren.length, 2);
    assert.doesNotMatch(result.data.previews[0].message, /March|Old|Replaced/);
    assert.match(harness.queries[0].sql, /SUM\(birthday_segment.child_count\) OVER\(\)/);
    assert.match(harness.queries[0].sql, /ARRAY\[10\]/);
});

test('unnamed February 29 child receives a neutral preview without a invented name', async () => {
    const harness = routeHarness([{ id: 101, business_context: 'dar', segment_count: '1', birthday_children_count: '1' }],
        [{ id: 1, customer_id: 101, business_context: 'dar', birthday: '2020-02-29' }]);
    const result = await harness.request({ dryRun: true, businessContext: 'dar',
        filters: { tags: ['birthday_month_02'] }, template: 'Запрошуємо {childName}: {childBirthday}' });
    assert.equal(result.data.previews[0].message, 'Запрошуємо вашу дитину: 2020-02-29');
    assert.equal(result.data.previews[0].neutralGreeting, true);
});

test('all replaced canonical children suppress a stale legacy date in preview', async () => {
    const harness = routeHarness([{ id: 101, child_name: 'Old', child_birthday: '2019-07-01', segment_count: '1' }],
        [{ id: 1, customer_id: 101, name: 'Replaced', birthday: '2020-03-01',
            source_payload: { manual_review: { superseded: true } } }]);
    const result = await harness.request({ dryRun: true, template: '{childName}/{childBirthday}' });
    assert.equal(result.data.previews[0].message, '/');
});

test('legacy child fields render if canonical rows are absent', async () => {
    const harness = routeHarness([{ id: 101, name: 'Олена', child_name: 'Аня', child_birthday: '2020-03-12', segment_count: '1' }]);
    const result = await harness.request({ dryRun: true, template: '{name}: {childName} {childBirthday}' });
    assert.equal(result.status, 200);
    assert.match(result.data.previews[0].message, /Олена: Аня 2020-03-12/);
});

test('database failure is an error, never a successful empty segment', async () => {
    const harness = routeHarness([], [], new Error('fixture unavailable'));
    const result = await harness.request({ dryRun: true, template: 'Привіт!' });
    assert.equal(result.status, 500);
    assert.equal(Object.hasOwn(result.data, 'segmentCount'), false);
});

function uiHarness() {
    const dom = new JSDOM('<div id="tabBulk"></div>', { runScripts: 'outside-only', url: 'https://crm.test/customers' });
    const context = dom.getInternalVMContext();
    context.CrmState = { filters: { tag: '' } };
    const notices = [];
    const navigations = [];
    context.customerBusinessContext = () => context.businessContext;
    context.businessContext = 'dar';
    context.customerApiUrl = url => `${url}?businessContext=${context.businessContext}`;
    context.customerPayload = body => ({ ...body, businessContext: context.businessContext });
    context.renderCustomerTagOptions = () => '<option value="">Всі клієнти</option><option value="Корпорат">Корпорат</option>';
    context.escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    context.showNotification = (...args) => notices.push(args);
    context.customerHeaderOmniTarget = (_customer, communication) => ({ href: communication?.links?.omniExact ? `${communication.links.omniExact}&businessContext=dar` : null });
    vm.runInContext(between(pageSource, 'let bulkPreviewRequestSeq =', '// v30.4: VCARD EXPORT/IMPORT'), context);
    // JSDOM does not implement navigation; execute the same production function with only the location adapter replaced.
    const dialogCode = between(pageSource, 'window.openBulkCustomerDialog =', '// v30.4: VCARD EXPORT/IMPORT');
    vm.runInContext(dialogCode.replace('window.location.assign(target.href)', '__navigate(target.href)'), Object.assign(context, { __navigate: href => navigations.push(href) }));
    context.loadBulkTab();
    context.document.getElementById('bulkTemplate').value = 'Привіт, {name}!';
    return { dom, context, notices, navigations };
}

const previewData = () => ({ success: true, segmentCount: 27, previews: [{ customerId: 101, name: '<img src=x onerror=alert(1)>', message: 'Привіт!\nАня <script>alert(1)</script>' }] });

test('UI renders personalized safe text and uses only dryRun requests', async () => {
    const harness = uiHarness();
    let request;
    harness.context.fetch = async (url, options) => {
        request = { url, body: JSON.parse(options.body) };
        return { ok: true, json: async () => previewData() };
    };
    await harness.context.previewBulk();
    const preview = harness.context.document.getElementById('bulkPreview');
    assert.match(preview.textContent, /Клієнтів у сегменті: 27/);
    assert.match(preview.textContent, /Попередній перегляд: 1 із 27 клієнтів/);
    assert.match(preview.textContent, /Аня <script>alert\(1\)<\/script>/);
    assert.equal(preview.querySelector('script, img'), null);
    assert.equal(request.body.dryRun, true);
    assert.equal(request.body.businessContext, 'dar');
    assert.equal(harness.context.document.querySelector('[onclick="sendBulk()"]'), null);
    assert.equal(typeof harness.context.sendBulk, 'undefined');
    harness.dom.window.close();
});

test('birthday preview shows full child count and explains neutral personalization', async () => {
    const harness = uiHarness();
    harness.context.fetch = async () => ({ ok: true, json: async () => ({
        ...previewData(), birthdaySegment: { months: [2], familyCount: 27, childCount: 54 },
        previews: [{ customerId: 101, name: 'Test family', message: 'Вітаємо вашу дитину', neutralGreeting: true }]
    }) });
    await harness.context.previewBulk();
    const text = harness.context.document.getElementById('bulkPreview').textContent;
    assert.match(text, /Клієнтів у сегменті: 27/);
    assert.match(text, /Дітей-іменинників у сегменті: 54/);
    assert.match(text, /Використано нейтральне звернення/);
    harness.dom.window.close();
});

test('invalid birthday counts are errors, never a zero count', async () => {
    const harness = uiHarness();
    harness.context.fetch = async () => ({ ok: true, json: async () => ({
        ...previewData(), birthdaySegment: { months: [2], familyCount: 27, childCount: null }
    }) });
    await harness.context.previewBulk();
    assert.equal(harness.context.document.getElementById('bulkPreview').style.display, 'none');
    assert.match(harness.context.document.getElementById('bulkPreviewStatus').textContent, /підрахунок іменинників/);
    harness.dom.window.close();
});

for (const response of [
    { ok: false, json: async () => ({ error: 'Сегмент недоступний' }) },
    { ok: true, json: async () => ({ success: false, error: 'Сегмент недоступний' }) },
    { ok: true, json: async () => ({ success: true }) },
    { ok: false, json: async () => { throw new Error('not JSON'); } }
]) {
    test('UI surfaces API errors without claiming a zero segment', async () => {
        const harness = uiHarness();
        harness.context.fetch = async () => response;
        await harness.context.previewBulk();
        assert.equal(harness.context.document.getElementById('bulkPreview').style.display, 'none');
        assert.ok(harness.context.document.getElementById('bulkPreviewStatus').textContent);
        assert.equal(harness.context.document.getElementById('bulkPreviewButton').disabled, false);
        assert.equal(harness.notices[0][1], 'error');
        harness.dom.window.close();
    });
}

test('editing text invalidates an in-flight preview and clears old personalized data', async () => {
    const harness = uiHarness();
    let resolve;
    harness.context.fetch = () => new Promise(done => { resolve = done; });
    const pending = harness.context.previewBulk();
    harness.context.document.getElementById('bulkTemplate').dispatchEvent(new harness.dom.window.Event('input'));
    resolve({ ok: true, json: async () => previewData() });
    await pending;
    assert.equal(harness.context.document.getElementById('bulkPreview').textContent, '');
    assert.equal(harness.context.document.getElementById('bulkPreview').style.display, 'none');
    harness.dom.window.close();
});

test('switching business drops an in-flight preview', async () => {
    const harness = uiHarness();
    let resolve;
    harness.context.fetch = () => new Promise(done => { resolve = done; });
    const pending = harness.context.previewBulk();
    harness.context.businessContext = 'event_genix';
    harness.context.loadBulkTab();
    resolve({ ok: true, json: async () => previewData() });
    await pending;
    assert.equal(harness.context.document.getElementById('bulkPreview').textContent, '');
    harness.dom.window.close();
});

test('Omni handoff resolves the existing customer communication context', async () => {
    const harness = uiHarness();
    const button = harness.context.document.createElement('button');
    harness.context.document.getElementById('tabBulk').append(button);
    const ids = [];
    harness.context.fetchCustomerCommunicationContext = async id => { ids.push(id); return { links: { omniExact: '/omni?conversation=903' } }; };
    await harness.context.openBulkCustomerDialog(button, 101);
    assert.deepEqual(ids, [101]);
    assert.deepEqual(harness.navigations, ['/omni?conversation=903&businessContext=dar']);
    assert.equal(button.disabled, false);
    harness.dom.window.close();
});

test('failed Omni lookup cannot navigate or send', async () => {
    const harness = uiHarness();
    const button = harness.context.document.createElement('button');
    harness.context.document.getElementById('tabBulk').append(button);
    harness.context.fetchCustomerCommunicationContext = async () => { throw new Error('lookup unavailable'); };
    await harness.context.openBulkCustomerDialog(button, 101);
    assert.deepEqual(harness.navigations, []);
    assert.equal(harness.notices[0][1], 'error');
    assert.equal(button.disabled, false);
    harness.dom.window.close();
});

test('whole HTTP router blocks legacy delivery and previews without acquiring a DB client or writing', async t => {
    const nativeRequire = createRequire(path.join(root, 'routes/customers.js'));
    const auth = nativeRequire('../middleware/auth');
    const queries = [];
    let connections = 0;
    let lookupError = false;
    const module = { exports: {} };
    vm.runInNewContext(routeSource, {
        module, exports: module.exports,
        require(id) {
            if (id === '../db') return { pool: {
                async connect() { connections++; throw new Error('Preview cannot acquire a transaction client'); },
                async query(sql, params) {
                    assert.match(String(sql).trim(), /^SELECT\b/i, 'preview and delivery attempts cannot change the journal or customer data');
                    queries.push({ sql, params });
                    if (lookupError) throw new Error('Synthetic lookup failure');
                    return { rows: String(sql).includes('FROM customer_children') ? [] : [
                        { id: 101, name: 'Test family', phone: '+380000000001', child_name: 'Test child', segment_count: '27' }
                    ] };
                }
            } };
            if (id === '../middleware/auth') return { ...auth,
                authenticateToken(req, res, next) {
                    const role = req.headers['x-test-role'];
                    if (!role) return res.status(401).json({ error: 'Authentication required' });
                    req.user = { id: 1, role };
                    next();
                }
            };
            if (id === '../utils/logger') return { createLogger: () => ({ info() {}, warn() {}, error() {} }) };
            return nativeRequire(id);
        },
        Buffer, console, process, setTimeout, clearTimeout
    }, { filename: path.join(root, 'routes/customers.js') });
    const app = express();
    app.use(express.json());
    app.use('/api/customers', module.exports);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const request = (body, role = 'creator') => fetch(`http://127.0.0.1:${server.address().port}/api/customers/bulk-message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
        body: JSON.stringify(body)
    });
    for (const businessContext of ['event_genix', 'dar']) {
        for (const dryRun of [undefined, false, 'true', 1, null]) {
            const res = await request({ businessContext, template: 'Hello!', dryRun });
            assert.equal(res.status, 501);
            assert.equal((await res.json()).code, 'bulk_delivery_unavailable');
            assert.equal(queries.length, 0);
            assert.equal(connections, 0);
        }
    }
    assert.equal((await request({ dryRun: true, template: 'Hello!' }, null)).status, 401);
    assert.equal((await request({ dryRun: true, template: 'Hello!' }, 'reception')).status, 403);
    assert.equal(queries.length, 0);
    const res = await request({ businessContext: 'dar', dryRun: true, template: '{name}: {childName}' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.segmentCount, 27);
    assert.equal(data.deliveryAvailable, false);
    assert.equal(Object.hasOwn(data, 'sent'), false);
    assert.equal(data.previews[0].message, 'Test family: Test child');
    assert.equal(queries.length, 2);
    assert.equal(connections, 0);
    lookupError = true;
    const failed = await request({ dryRun: true, template: 'Hello!' });
    assert.equal(failed.status, 500);
    assert.equal(Object.hasOwn(await failed.json(), 'segmentCount'), false);
});

test('preview limit does not truncate the full segment count', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: 101 + index, name: 'Test ' + index, segment_count: '27' }));
    const harness = routeHarness(rows);
    const result = await harness.request({ dryRun: true, template: '{name}' });
    assert.equal(result.data.segmentCount, 27);
    assert.equal(result.data.previews.length, 20);
    assert.equal(harness.queries.length, 2, 'children are loaded together rather than per customer');
});

for (const [fieldId, value] of [
    ['bulkTagFilter', 'Корпорат'], ['bulkMinVisits', '2'],
    ['bulkSourceFilter', 'instagram'], ['bulkTemplate', 'Новий текст']
]) {
    test('changing ' + fieldId + ' clears rendered preview and ignores an older request', async t => {
        const harness = uiHarness();
        t.after(() => harness.dom.window.close());
        harness.context.fetch = async () => ({ ok: true, json: async () => previewData() });
        await harness.context.previewBulk();
        const preview = harness.context.document.getElementById('bulkPreview');
        assert.notEqual(preview.textContent, '');
        const field = harness.context.document.getElementById(fieldId);
        field.value = value;
        field.dispatchEvent(new harness.dom.window.Event('change'));
        assert.equal(preview.textContent, '');
        assert.equal(preview.style.display, 'none');
        let resolve;
        harness.context.fetch = () => new Promise(done => { resolve = done; });
        const pending = harness.context.previewBulk();
        field.dispatchEvent(new harness.dom.window.Event('input'));
        resolve({ ok: true, json: async () => previewData() });
        await pending;
        assert.equal(preview.textContent, '');
        assert.equal(harness.context.document.getElementById('bulkPreviewButton').disabled, false);
    });
}

test('an older failed preview cannot replace a newer successful preview', async t => {
    const harness = uiHarness();
    t.after(() => harness.dom.window.close());
    let reject;
    harness.context.fetch = () => new Promise((resolve, fail) => { reject = fail; });
    const pending = harness.context.previewBulk();
    harness.context.fetch = async () => ({ ok: true, json: async () => previewData() });
    await harness.context.previewBulk();
    reject(new Error('Old network failure'));
    await pending;
    assert.match(harness.context.document.getElementById('bulkPreview').textContent, /Клієнтів у сегменті: 27/);
    assert.equal(harness.context.document.getElementById('bulkPreviewStatus').textContent, '');
    assert.equal(harness.notices.length, 0);
});

test('network failure remains an error with no zero-segment preview', async t => {
    const harness = uiHarness();
    t.after(() => harness.dom.window.close());
    harness.context.fetch = async () => { throw new Error('Network unavailable'); };
    await harness.context.previewBulk();
    assert.equal(harness.context.document.getElementById('bulkPreview').style.display, 'none');
    assert.match(harness.context.document.getElementById('bulkPreviewStatus').textContent, /Network unavailable/);
    assert.equal(harness.context.document.getElementById('bulkPreviewButton').disabled, false);
});
