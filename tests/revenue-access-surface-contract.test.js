'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const auth = require('../middleware/auth');
const { requireAction } = require('../middleware/auth');
const {
    installRevenueResponseShaper,
    isFinancialFieldKey,
    parseOptionalRevenueAmount,
    redactRevenueFieldKeys,
    redactRevenueFields
} = require('../services/revenueAccessPolicy');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function runActionGuard(action, user) {
    let statusCode = null;
    let payload = null;
    let nextCalled = false;
    requireAction(action)(
        { user },
        {
            status(code) { statusCode = code; return this; },
            json(value) { payload = value; return this; }
        },
        () => { nextCalled = true; }
    );
    return { statusCode, payload, nextCalled };
}

test('shared revenue policy covers amount aliases, scalar deposits, fees, taxes, and suffix currencies', () => {
    const source = {
        id: 7,
        total: 3,
        deposit: 500,
        depositMeta: { status: 'confirmed', amount: 500 },
        payment: { status: 'paid', grandTotal: 620 },
        corkFee: 100,
        taxAmount: 20,
        actualTotal: 620,
        previous_total: 410,
        next_total: 620,
        note: 'Paid 250 ₴ and ₴300; guests 4'
    };

    assert.deepEqual(redactRevenueFields(source), {
        id: 7,
        total: 3,
        depositMeta: { status: 'confirmed' },
        payment: { status: 'paid' },
        note: 'Paid [сума прихована] and [сума прихована]; guests 4'
    });
    assert.equal(source.deposit, 500, 'redaction must not mutate the source payload');
    for (const key of ['corkFee', 'taxAmount', 'grandTotal', 'balanceDue', 'commissionRate', 'previous_total', 'next_total']) {
        assert.equal(isFinancialFieldKey(key), true, key);
    }
    assert.equal(isFinancialFieldKey('total'), false, 'generic operational totals remain visible');

    const encoded = JSON.stringify({ status: 'queued', price: 900, nested: { amount: 125 } });
    assert.equal(
        redactRevenueFieldKeys(encoded),
        JSON.stringify({ status: 'queued', nested: {} })
    );

    const safeEncoded = ' { "status": "confirmed", "guests": 4 } ';
    assert.equal(redactRevenueFieldKeys(safeEncoded), safeEncoded);
    assert.equal(redactRevenueFields(safeEncoded), safeEncoded);
    assert.equal(redactRevenueFieldKeys('{"status":"queued","amount":125}'), '{"status":"queued"}');
    assert.equal(redactRevenueFields('{"status":"queued","note":"Paid 250 UAH"}').includes('250 UAH'), false);
});

test('mixed CRUD shaping preserves user-authored money text while removing structured revenue fields', () => {
    const source = {
        id: 7,
        notes: 'Paid 500 UAH; keep this note verbatim',
        description: 'Budget discussed as 2 000 ₴',
        purchaseUnitPrice: 125,
        nested: { status: 'active', amount: 500 }
    };
    assert.deepEqual(redactRevenueFieldKeys(source), {
        id: 7,
        notes: source.notes,
        description: source.description,
        nested: { status: 'active' }
    });

    let shaped = null;
    const res = {
        json(payload) {
            shaped = payload;
            return payload;
        }
    };
    let nextCalled = false;
    installRevenueResponseShaper({}, res, () => { nextCalled = true; }, false);
    res.json(source);
    assert.equal(nextCalled, true);
    assert.equal(shaped.notes, source.notes);
    assert.equal(shaped.description, source.description);
    assert.equal(shaped.purchaseUnitPrice, undefined);
    assert.equal(shaped.nested.amount, undefined);

    let publicCatalogPayload = null;
    const publicCatalogResponse = {
        locals: { revenueResponseMode: 'public-catalog' },
        json(payload) {
            publicCatalogPayload = payload;
            return payload;
        }
    };
    installRevenueResponseShaper({}, publicCatalogResponse, () => {}, false, { redactText: true });
    publicCatalogResponse.json({
        id: 17,
        name: 'Public catalog item',
        price: 1250
    });
    assert.deepEqual(publicCatalogPayload, { id: 17, name: 'Public catalog item', price: 1250 });
});

test('optional report amounts preserve absence as null and explicit zero as zero', () => {
    assert.equal(parseOptionalRevenueAmount({}), null);
    assert.equal(parseOptionalRevenueAmount({ amount: null }), null);
    assert.equal(parseOptionalRevenueAmount({ amount: '' }), null);
    assert.equal(parseOptionalRevenueAmount({ amount: '   ' }), null);
    assert.equal(parseOptionalRevenueAmount({ amount: 0 }), 0);
    assert.equal(parseOptionalRevenueAmount({ amount: '0' }), 0);
});

test('explicit denies are authoritative for the three canonical Task 4 actions', () => {
    for (const action of ['view_revenue', 'manage_settings', 'export_data']) {
        const denied = runActionGuard(action, { role: 'creator', action_denylist: [action] });
        assert.equal(denied.nextCalled, false, action);
        assert.equal(denied.statusCode, 403, action);
        assert.deepEqual(denied.payload, { error: 'Insufficient permissions' }, action);

        const allowed = runActionGuard(action, { role: 'creator' });
        assert.equal(allowed.nextCalled, true, action);
    }
});

test('mixed operational APIs shape revenue and reject explicit financial writes', () => {
    const search = read('routes/search.js');
    const tasks = read('routes/tasks.js');
    const hermes = read('routes/hermes.js');

    assert.match(search, /installRevenueResponseShaper\([\s\S]*canUseAction\(req\.user, 'view_revenue'\),[\s\S]*\{ redactText: true \}[\s\S]*\)\);/);
    assert.match(tasks, /router\.post\('\/:id\/completion-report', requireTaskReportAmountAccess, shapeTaskReportRevenueResponse/);
    assert.match(hermes, /router\.post\('\/tasks\/:id\/completion-report', requireHermesMutationGuard, requireHermesRevenueAmountAccess, shapeHermesRevenueResponse/);
    assert.match(hermes, /function shapeHermesRevenueResponse\(req, res, next\)[\s\S]*canUseAction\(req\.user, 'view_revenue'\)/);
    assert.match(tasks, /const amount = parseOptionalRevenueAmount\(req\.body \|\| \{\}\);/);
    assert.match(tasks, /amount: parseOptionalRevenueAmount\(\{ amount: report\.amount \}\)/);
    assert.match(hermes, /const amount = parseOptionalRevenueAmount\(body\);/);
    assert.doesNotMatch(`${tasks}\n${hermes}`, /Number\.isFinite\(amount\) \? amount : 0/);
    assert.doesNotMatch(hermes, /router\.use\(\(req, res, next\) => installRevenueResponseShaper/);
});

test('task report UI omits amount without revenue access instead of sending a fake zero', () => {
    const taskCreate = read('js/task-create.js');
    assert.match(taskCreate, /const canViewRevenue = typeof canAccess === 'function' && canAccess\('view_revenue'\);/);
    assert.match(taskCreate, /\.\.\.\(canViewRevenue \? \[\{/);
    assert.match(taskCreate, /if \(canViewRevenue\) reportPayload\.amount = values\.amount;/);
    assert.doesNotMatch(taskCreate, /reportPayload\s*=\s*\{[\s\S]{0,240}amount:\s*values\.amount/);
});

test('report workflow and demo-mode settings fail closed in backend and UI', () => {
    const reportsRoute = read('routes/reports.js');
    const reportsPage = read('js/reports-page.js');
    const reportsHtml = read('reports.html');
    const demoRoute = read('routes/demo.js');
    const demoPage = read('js/demo-page.js');
    const demoHtml = read('demo.html');

    assert.match(reportsRoute, /router\.get\('\/workflow-settings', requireAction\('manage_settings'\)/);
    assert.match(reportsRoute, /router\.put\('\/workflow-settings', requireAction\('manage_settings'\)/);
    assert.match(reportsRoute, /if \(req\.path === '\/workflow-settings' \|\| req\.path === '\/workflow-settings\/'\)[\s\S]*return next\(\);[\s\S]*return requireReportsRevenue/);
    assert.doesNotMatch(reportsRoute, /router\.use\(requireAction\('view_revenue'\)\)/);
    assert.match(reportsPage, /function canManageReportWorkflowSettings\(\)[\s\S]*canAccess\('manage_settings'\) === true/);
    assert.match(reportsPage, /async function loadWorkflowSettings\(\) \{\s*if \(!syncReportWorkflowSettingsAccess\(\)\) return;/);
    assert.match(reportsPage, /async function saveWorkflowSettings\(\) \{\s*if \(!canManageReportWorkflowSettings\(\)\)/);
    assert.match(reportsHtml, /id="reportApprovalWorkflow"[^>]*hidden[^>]*aria-hidden="true"/);

    assert.match(demoRoute, /if \(canUseAction\(req\.user, 'manage_settings'\)\) payload\.demoEnabled = demoEnabled;/);
    assert.match(demoRoute, /router\.post\('\/toggle', requireRole\('admin'\), requireAction\('manage_settings'\)/);
    assert.match(demoPage, /function resolveManageSettingsAccess\(\)[\s\S]*lifecycle\?\.status === 'ready'[\s\S]*canAccess\('manage_settings'\) === true/);
    assert.match(demoPage, /if \(!canManageSettings\) \{[\s\S]{0,180}Недостатньо прав для зміни системних налаштувань/);
    assert.match(demoHtml, /class="demo-toggle-bar hidden"[^>]*id="demoToggleBar"[^>]*aria-hidden="true"/);
});

test('Task 4 permission contracts are mandatory baseline coverage', () => {
    const script = require('../package.json').scripts['test:permission-contracts'];
    for (const filename of [
        'finance-permission-contract.test.js',
        'banquet-deposit-revenue-access.test.js',
        'subscription-packages-access.test.js',
        'hr-capability-contract.test.js',
        'revenue-access-group-a.test.js',
        'revenue-access-group-b.test.js',
        'center-revenue-permission.test.js',
        'manage-settings-system-surfaces.test.js',
        'revenue-access-surface-contract.test.js'
    ]) {
        assert.match(script, new RegExp(filename.replace(/\./g, '\\.') + '(?:\\s|$)'), filename);
    }
});

function installAccessTestModule(id, exportsValue) {
    require.cache[id] = {
        id,
        filename: id,
        loaded: true,
        exports: exportsValue
    };
}

function loadAccessTestRouter(routePath, mocks) {
    const routeId = require.resolve(routePath);
    const mockEntries = Object.entries(mocks).map(([modulePath, exportsValue]) => [
        require.resolve(modulePath),
        exportsValue
    ]);
    const previous = new Map([[routeId, require.cache[routeId]]]);
    for (const [id] of mockEntries) previous.set(id, require.cache[id]);

    const restore = () => {
        delete require.cache[routeId];
        for (const [id, entry] of previous) {
            if (entry) require.cache[id] = entry;
            else delete require.cache[id];
        }
    };

    delete require.cache[routeId];
    for (const [id, exportsValue] of mockEntries) installAccessTestModule(id, exportsValue);

    try {
        return { router: require(routePath), restore };
    } catch (error) {
        restore();
        throw error;
    }
}

async function withMountedAccessRouter(router, mountPath, userForRequest, run) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = typeof userForRequest === 'function'
            ? userForRequest(req)
            : userForRequest;
        next();
    });
    app.use(mountPath, router);

    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });

    try {
        await run('http://127.0.0.1:' + server.address().port);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

const passAccessMiddleware = (_req, _res, next) => next();

test('procurement auto-price mutations fail before database access without view_revenue', async () => {
    let databaseTouches = 0;
    const pool = {
        async query() {
            databaseTouches += 1;
            throw new Error('database must not be reached');
        },
        async connect() {
            databaseTouches += 1;
            throw new Error('database must not be reached');
        }
    };
    const loaded = loadAccessTestRouter('../routes/procurement', {
        '../db': { pool },
        '../middleware/auth': {
            ...auth,
            requireRole: () => passAccessMiddleware
        }
    });

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/api/procurement',
            { role: 'creator', action_denylist: ['view_revenue'] },
            async baseUrl => {
                const requests = [
                    ['POST', '/from-stock-item/1', {}],
                    ['POST', '/1/items/2/receive', { receivedQty: 1 }],
                    ['POST', '/1/complete', {}],
                    ['PUT', '/1/items/2', { isPurchased: true }],
                    ['DELETE', '/1/items/2', {}]
                ];
                for (const [method, path, body] of requests) {
                    const response = await fetch(baseUrl + '/api/procurement' + path, {
                        method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    assert.equal(response.status, 403, method + ' ' + path);
                }
            }
        );
    } finally {
        loaded.restore();
    }
    assert.equal(databaseTouches, 0);

    const route = read('routes/procurement.js');
    const page = read('js/warehouse-page.js');
    assert.match(route, /router\.post\('\/from-stock-item\/:stockItemId', requireProcurementRevenue/);
    assert.match(route, /router\.post\('\/:id\/items\/:itemId\/receive', requireProcurementRevenue/);
    assert.match(route, /router\.post\('\/:id\/complete', requireProcurementRevenue/);
    assert.match(route, /router\.put\('\/:id\/items\/:itemId', requireProcurementRevenue/);
    assert.match(route, /router\.delete\('\/:id\/items\/:itemId', requireProcurementRevenue/);
    assert.match(page, /function guardProcurementRevenueMutation\(\)[\s\S]*canViewProcurementRevenue\(\)/);
    assert.match(page, /async function createProcurementFromStockItem\(itemId\) \{\s*if \(!guardProcurementRevenueMutation\(\)\) return;/);
    assert.match(page, /async function createKitchenDemandProcurement\(stockId\) \{\s*if \(!guardProcurementRevenueMutation\(\)\) return;/);
    assert.match(page, /\[onclick\^="createKitchenDemandProcurement\("\]/);
    assert.match(page, /async function toggleProcItem\(listId, itemId, checked\) \{\s*if \(!guardProcurementRevenueMutation\(\)\) return;/);
    assert.match(page, /async function removeProcItem\(listId, itemId\) \{\s*if \(!guardProcurementRevenueMutation\(\)\) return;/);
    assert.match(page, /async function receiveProcItem\(itemId\) \{\s*if \(!guardProcurementRevenueMutation\(\)\) return;/);
    assert.match(page, /async function completeProcList\(\) \{\s*if \(!guardProcurementRevenueMutation\(\)\) return;/);
});

test('print job responses redact contextual values, money text, and printer errors', async () => {
    const loaded = loadAccessTestRouter('../routes/print', {
        '../db': {
            pool: {
                query: async () => ({
                    rows: [
                        {
                            id: 31,
                            status: 'failed',
                            template_code: 'cert_gift',
                            data: {
                                booking_id: 'BK-31',
                                value: 5000,
                                label: 'Gift 5 000 UAH',
                                note: 'Operational note',
                                nested: { amount: 125 }
                            },
                            error: 'Printer rejected 250 UAH'
                        },
                        {
                            id: 32,
                            status: 'queued',
                            template_code: 'cert_birthday',
                            data: { value: 'VIP', note: 'Operational birthday' }
                        }
                    ]
                })
            }
        },
        '../middleware/auth': {
            ...auth,
            authenticateToken: passAccessMiddleware
        }
    });

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/api/print',
            { role: 'creator', action_denylist: ['view_revenue'] },
            async baseUrl => {
                const response = await fetch(baseUrl + '/api/print/jobs');
                assert.equal(response.status, 200);
                const body = await response.json();
                assert.equal(body[0].id, 31);
                assert.equal(body[0].status, 'failed');
                assert.equal(body[0].template_code, 'cert_gift');
                assert.equal(body[0].data.value, undefined);
                assert.equal(body[0].data.note, 'Operational note');
                assert.deepEqual(body[0].data.nested, {});
                assert.doesNotMatch(JSON.stringify(body[0]), /5000|5 000|250 UAH/);
                assert.equal(body[1].data.value, 'VIP');
                assert.equal(body[1].data.note, 'Operational birthday');

                const statusResponse = await fetch(baseUrl + '/api/print/jobs/31/status', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'failed', error: 'Printer rejected 250 UAH' })
                });
                assert.equal(statusResponse.status, 200);
                const statusBody = await statusResponse.json();
                assert.equal(statusBody.job.data.value, undefined);
                assert.equal(statusBody.job.data.note, 'Operational note');
                assert.doesNotMatch(JSON.stringify(statusBody), /5000|5 000|250 UAH/);
            }
        );
    } finally {
        loaded.restore();
    }
});

test('print job creation rejects revenue payloads before insert while preserving operational print access', async () => {
    let insertCount = 0;
    const loaded = loadAccessTestRouter('../routes/print', {
        '../db': {
            pool: {
                async query(sql, params = []) {
                    const statement = String(sql);
                    if (statement.includes('SELECT * FROM print_templates WHERE id = $1')) {
                        const id = Number(params[0]);
                        return {
                            rows: [{
                                id,
                                code: id === 1 ? 'cert_gift' : 'cert_birthday',
                                category: 'certificate',
                                format: 'A4',
                                required_fields: []
                            }]
                        };
                    }
                    if (statement.includes('INSERT INTO print_jobs')) {
                        insertCount += 1;
                        return {
                            rows: [{
                                id: 40 + insertCount,
                                template_id: params[0],
                                status: 'queued',
                                data: JSON.parse(params[4])
                            }]
                        };
                    }
                    throw new Error('Unexpected print query: ' + statement);
                }
            }
        },
        '../middleware/auth': {
            ...auth,
            authenticateToken: passAccessMiddleware
        }
    });

    const deniedUser = { role: 'creator', action_denylist: ['view_revenue'] };
    const allowedUser = { role: 'creator' };
    const requestUser = req => req.headers['x-test-revenue'] === 'allowed' ? allowedUser : deniedUser;

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/api/print',
            requestUser,
            async baseUrl => {
                const postJob = async (body, allowed = false) => fetch(baseUrl + '/api/print/jobs', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(allowed ? { 'x-test-revenue': 'allowed' } : {})
                    },
                    body: JSON.stringify(body)
                });

                let response = await postJob({ template_id: 1, data: '{"value":5000}', target: 'local_printer' });
                assert.equal(response.status, 400);

                const deniedPayloads = [
                    { template_id: 1, data: { value: 5000 }, target: 'local_printer' },
                    { template_id: 2, data: { price: 900 }, target: 'local_printer' },
                    { template_id: 2, data: { note: 'Budget 900 UAH' }, target: 'local_printer' },
                    { template_id: 2, data: { meta: '{"amount":500}' }, target: 'local_printer' }
                ];
                for (const payload of deniedPayloads) {
                    response = await postJob(payload);
                    assert.equal(response.status, 403);
                    assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
                }
                assert.equal(insertCount, 0);

                const safeMeta = ' { "status": "ready" } ';
                response = await postJob({
                    template_id: 2,
                    data: { value: 'VIP', label: 'Birthday', meta: safeMeta },
                    target: 'local_printer'
                });
                assert.equal(response.status, 200);
                let body = await response.json();
                assert.equal(body.job.data.value, 'VIP');
                assert.equal(body.job.data.meta, safeMeta);
                assert.equal(insertCount, 1);

                response = await postJob({
                    template_id: 1,
                    data: { value: 5000, label: 'Gift 5 000 UAH' },
                    target: 'local_printer'
                }, true);
                assert.equal(response.status, 200);
                body = await response.json();
                assert.equal(body.job.data.value, 5000);
                assert.equal(insertCount, 2);
            }
        );
    } finally {
        loaded.restore();
    }
});

test('booking upsell reads and writes deny before data access and retain booking visibility scope', async () => {
    let databaseTouches = 0;
    const pool = {
        async query() {
            databaseTouches += 1;
            throw new Error('database must not be reached');
        },
        async connect() {
            databaseTouches += 1;
            throw new Error('database must not be reached');
        }
    };
    const loaded = loadAccessTestRouter('../routes/sales', {
        '../db': { pool },
        '../middleware/auth': {
            ...auth,
            authenticateToken: passAccessMiddleware,
            requireMinRole: () => passAccessMiddleware
        }
    });

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/api/sales',
            { role: 'creator', action_denylist: ['view_revenue'] },
            async baseUrl => {
                let response = await fetch(baseUrl + '/api/sales/booking-upsells/BK-17');
                assert.equal(response.status, 403);
                assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });

                response = await fetch(baseUrl + '/api/sales/booking-upsells', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: 'BK-17',
                        upsells: [{ name: 'Extra', price: 900 }]
                    })
                });
                assert.equal(response.status, 403);
                assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
            }
        );
    } finally {
        loaded.restore();
    }

    assert.equal(databaseTouches, 0);
    const route = read('routes/sales.js');
    assert.match(route, /router\.post\('\/booking-upsells', requireBookingEdit, requireSalesRevenue/);
    assert.match(route, /router\.get\('\/booking-upsells\/:bookingId', requireSalesRevenue/);
    assert.match(route, /getVisibleBookingScope\(req\.user, bookingParams, 'b'\)/);
    assert.match(route, /getVisibleBookingScope\(req\.user, params, 'b'\)/);
});

test('report workflow settings remain manageable when revenue viewing is denied', async () => {
    let queryCount = 0;
    const loaded = loadAccessTestRouter('../routes/reports', {
        '../db': {
            pool: {
                query: async () => {
                    queryCount += 1;
                    return { rows: [] };
                }
            }
        },
        '../middleware/auth': {
            ...auth,
            requireRole: () => passAccessMiddleware
        },
        '../services/taskExecution': { listTaskOwnerCandidates: async () => [] }
    });

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/api/reports',
            { role: 'creator', action_denylist: ['view_revenue'] },
            async baseUrl => {
                const settings = await fetch(baseUrl + '/api/reports/workflow-settings');
                assert.equal(settings.status, 200);
                assert.equal(queryCount, 1);

                const summary = await fetch(baseUrl + '/api/reports/summary');
                assert.equal(summary.status, 403);
                assert.equal(queryCount, 1);
            }
        );
    } finally {
        loaded.restore();
    }
});

test('dashboard financial widgets fail before business scope and SQL for explicit and default revenue denies', async () => {
    const actualRoles = require('../config/roles');
    const actualBusinessContext = require('../services/businessContext');
    let queryCount = 0;
    let businessScopeCount = 0;
    let widgetAccessCount = 0;
    const loaded = loadAccessTestRouter('../routes/dashboard', {
        '../db': {
            pool: {
                query: async () => {
                    queryCount += 1;
                    throw new Error('denied dashboard widget reached SQL');
                }
            }
        },
        '../middleware/auth': { ...auth, authenticateToken: passAccessMiddleware },
        '../config/roles': {
            ...actualRoles,
            canAccessDashboardWidget: () => {
                widgetAccessCount += 1;
                return true;
            }
        },
        '../services/businessContext': {
            ...actualBusinessContext,
            resolveBusinessScope: () => {
                businessScopeCount += 1;
                return { mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] };
            },
            requireBusinessScope: () => true,
            pushBusinessScopeCondition: () => 'TRUE'
        },
        '../services/websocket': { getOnlineUserIds: () => [] },
        '../services/omni-accounts': { getOmniAccountAlertsAsync: async () => [] }
    });

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/dashboard',
            req => req.get('x-test-deny') === 'default'
                ? { role: 'animator', username: 'default-denied' }
                : { role: 'creator', username: 'explicit-denied', action_denylist: ['view_revenue'] },
            async baseUrl => {
                for (const denyMode of ['explicit', 'default']) {
                    for (const widget of ['finance_today', 'reports_today', 'director_pnl']) {
                        const response = await fetch(baseUrl + '/dashboard/widgets/' + widget, {
                            headers: { 'x-test-deny': denyMode }
                        });
                        assert.equal(response.status, 403, denyMode + ':' + widget);
                        assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
                    }
                }
            }
        );
    } finally {
        loaded.restore();
    }

    assert.equal(queryCount, 0);
    assert.equal(businessScopeCount, 0);
    assert.equal(widgetAccessCount, 0);
    const dashboardRoute = read('routes/dashboard.js');
    assert.match(dashboardRoute, /router\.get\('\/widgets\/:type', requireDashboardWidgetRevenue, allowDashboardPublicCatalogResponse, shapeDashboardRevenue,/);
    assert.match(dashboardRoute, /req\.params\.type === 'catalogs'[\s\S]*revenueResponseMode = 'public-catalog'/);
});

test('dashboard catalog widget preserves public item prices without view_revenue', async () => {
    const actualRoles = require('../config/roles');
    const actualBusinessContext = require('../services/businessContext');
    const loaded = loadAccessTestRouter('../routes/dashboard', {
        '../db': {
            pool: {
                query: async sql => {
                    const statement = String(sql);
                    if (statement.includes('SELECT cd.id, cd.name')) {
                        return { rows: [{ id: 3, name: 'Programs', count: 1 }] };
                    }
                    if (statement.includes('SELECT ci.id, ci.name, ci.price')) {
                        return {
                            rows: [{
                                id: 17,
                                name: 'Public kids program',
                                price: 1250,
                                catalog_id: 3,
                                catalog_name: 'Programs'
                            }]
                        };
                    }
                    throw new Error('Unexpected dashboard catalog SQL: ' + statement);
                }
            }
        },
        '../middleware/auth': { ...auth, authenticateToken: passAccessMiddleware },
        '../config/roles': {
            ...actualRoles,
            canAccessDashboardWidget: () => true
        },
        '../services/businessContext': {
            ...actualBusinessContext,
            resolveBusinessScope: () => ({
                mode: 'single',
                activeContext: 'event_genix',
                selectedContexts: ['event_genix']
            }),
            requireBusinessScope: () => true,
            pushBusinessScopeCondition: () => 'TRUE'
        },
        '../services/websocket': { getOnlineUserIds: () => [] },
        '../services/omni-accounts': { getOmniAccountAlertsAsync: async () => [] }
    });

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/dashboard',
            { role: 'creator', username: 'catalog-user', action_denylist: ['view_revenue'] },
            async baseUrl => {
                const response = await fetch(baseUrl + '/dashboard/widgets/catalogs');
                assert.equal(response.status, 200);
                const body = await response.json();
                assert.equal(body.data.recentItems[0].price, 1250);
            }
        );
    } finally {
        loaded.restore();
    }
});

test('center program performance uses operational ordering when revenue is denied', async () => {
    const queries = [];
    class AdmissionTicketError extends Error {}
    const loaded = loadAccessTestRouter('../routes/center', {
        '../db': {
            pool: {
                query: async sql => {
                    queries.push(String(sql));
                    return {
                        rows: [{
                            program_id: 17,
                            program_name: 'Alpha',
                            category: 'kids',
                            total: 7,
                            confirmed: 5,
                            preliminary: 2,
                            revenue: 900,
                            avg_price: 180,
                            avg_kids: 8
                        }]
                    };
                }
            }
        },
        '../middleware/auth': {
            ...auth,
            authenticateToken: passAccessMiddleware,
            requireMinRole: () => passAccessMiddleware,
            requireAction: () => passAccessMiddleware
        },
        '../services/bookingVisibility': {
            getVisibleBookingScope: () => ({ sql: '', condition: 'TRUE' })
        },
        '../services/admissionTickets': {
            AdmissionTicketError,
            appendAdmissionTicketTariffVersion: async () => null,
            listAdmissionTicketCatalog: async () => []
        },
        '../services/adminAudit': { logAdminAction: async () => {} },
        '../services/booking': { parseAvailabilityWindows: () => [] }
    });

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/center',
            req => ({
                role: 'creator',
                username: 'center-order-test',
                action_denylist: req.get('x-test-revenue') === 'allowed' ? [] : ['view_revenue']
            }),
            async baseUrl => {
                const deniedResponse = await fetch(baseUrl + '/center/program-performance?from=2026-08-01&to=2026-08-02');
                assert.equal(deniedResponse.status, 200);
                const deniedBody = await deniedResponse.json();
                assert.equal(deniedBody.programs[0].total, 7);
                assert.equal(deniedBody.programs[0].program_name, 'Alpha');
                assert.equal(deniedBody.programs[0].revenue, undefined);
                assert.match(queries[0], /ORDER BY total DESC, program_name/);
                assert.doesNotMatch(queries[0], /ORDER BY revenue DESC/);

                const allowedResponse = await fetch(baseUrl + '/center/program-performance?from=2026-08-01&to=2026-08-02', {
                    headers: { 'x-test-revenue': 'allowed' }
                });
                assert.equal(allowedResponse.status, 200);
                const allowedBody = await allowedResponse.json();
                assert.equal(allowedBody.programs[0].revenue, 900);
                assert.match(queries[1], /ORDER BY revenue DESC/);
            }
        );
    } finally {
        loaded.restore();
    }
});

test('customer stats skip spend SQL while retaining operational metrics when revenue is denied', async () => {
    const actualBusinessContext = require('../services/businessContext');
    const queries = [];
    class CustomerChildrenError extends Error {}
    const pool = {
        query: async sql => {
            const text = String(sql);
            queries.push(text);
            if (/SELECT COUNT\(\*\) FROM customers/.test(text)) return { rows: [{ count: '7' }] };
            if (/AS source, COUNT\(\*\) AS count/.test(text)) return { rows: [{ source: 'instagram', count: '4' }] };
            if (/ORDER BY COALESCE\(b\.spent, 0\) DESC/.test(text)) {
                return { rows: [{ id: 1, name: 'VIP', total_bookings: '4', total_spent: '900', last_visit: '2026-08-01' }] };
            }
            if (/ORDER BY c\.created_at DESC/.test(text)) {
                const row = { id: 2, name: 'Recent', total_bookings: '3', created_at: '2026-08-02' };
                if (/AS total_spent/.test(text)) row.total_spent = '700';
                return { rows: [row] };
            }
            if (/AVG\(b\.cnt\)/.test(text)) {
                return { rows: [{ avg_bookings: '2.5', ...(/AS avg_spent/.test(text) ? { avg_spent: '450' } : {}) }] };
            }
            throw new Error('Unexpected customer stats SQL: ' + text);
        }
    };
    const loaded = loadAccessTestRouter('../routes/customers', {
        '../db': { pool },
        '../middleware/rateLimit': { exportLimiter: passAccessMiddleware },
        '../middleware/auth': {
            ...auth,
            authenticateToken: passAccessMiddleware,
            requireRole: () => passAccessMiddleware,
            requireMinRole: () => passAccessMiddleware,
            requireAction: () => passAccessMiddleware
        },
        '../services/customerCommunicationHub': { getCustomerCommunicationContext: async () => ({}) },
        '../services/customerSearchQuery': { buildCustomerSearchQuery: () => ({ text: '', values: [] }) },
        '../services/bookingVisibility': { getVisibleBookingScope: () => ({ sql: '', condition: 'TRUE' }) },
        '../services/customerBirthdayTags': { syncBirthdayTagsForCustomer: async () => {} },
        '../services/customerChildren': { CustomerChildrenError },
        '../services/businessContext': {
            ...actualBusinessContext,
            resolveBusinessScope: () => ({ mode: 'single', activeContext: 'event_genix', selectedContexts: ['event_genix'] }),
            requireBusinessScope: () => true,
            businessContextFromRequest: () => 'event_genix',
            requireBusinessContext: () => true,
            pushBusinessContextCondition: (params, context, alias = '') => {
                params.push(context);
                const prefix = alias ? alias + '.' : '';
                return `COALESCE(${prefix}business_context, 'event_genix') = $${params.length}`;
            }
        },
        '../services/customerSource': {
            normalizeCustomerSource: value => value || 'unknown',
            getCustomerSourceLabel: value => value || 'unknown',
            customerSourceSqlExpression: column => `COALESCE(${column}, 'unknown')`
        }
    });

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/customers',
            req => ({
                role: 'creator',
                username: 'customer-stats-test',
                action_denylist: req.get('x-test-revenue') === 'allowed' ? [] : ['view_revenue']
            }),
            async baseUrl => {
                queries.length = 0;
                const deniedResponse = await fetch(baseUrl + '/customers/stats');
                assert.equal(deniedResponse.status, 200);
                const deniedBody = await deniedResponse.json();
                assert.equal(deniedBody.total, 7);
                assert.deepEqual(deniedBody.bySource, [{ source: 'instagram', count: 4 }]);
                assert.equal(deniedBody.recentCustomers[0].name, 'Recent');
                assert.equal(Number(deniedBody.recentCustomers[0].totalBookings), 3);
                assert.equal(deniedBody.recentCustomers[0].totalSpent, undefined);
                assert.equal(deniedBody.averages.avg_bookings, '2.5');
                assert.equal(deniedBody.averages.avg_spent, undefined);
                assert.equal(deniedBody.topBySpent, undefined);
                assert.equal(queries.length, 4);
                assert.doesNotMatch(queries.join('\n'), /SUM\(price\)|AVG\(b\.spent\)|ORDER BY COALESCE\(b\.spent/);

                queries.length = 0;
                const allowedResponse = await fetch(baseUrl + '/customers/stats', {
                    headers: { 'x-test-revenue': 'allowed' }
                });
                assert.equal(allowedResponse.status, 200);
                const allowedBody = await allowedResponse.json();
                assert.equal(Number(allowedBody.topBySpent[0].totalSpent), 900);
                assert.equal(Number(allowedBody.recentCustomers[0].totalSpent), 700);
                assert.equal(allowedBody.averages.avg_spent, '450');
                assert.equal(queries.length, 5);
                assert.match(queries.join('\n'), /SUM\(price\)/);
                assert.match(queries.join('\n'), /AVG\(b\.spent\)/);
            }
        );
    } finally {
        loaded.restore();
    }
});
test('loyalty revenue mutations deny before acquiring a database client', async () => {
    let connectCount = 0;
    let queryCount = 0;
    const loaded = loadAccessTestRouter('../routes/loyalty', {
        '../db': {
            pool: {
                connect: async () => {
                    connectCount += 1;
                    throw new Error('denied loyalty recalculation acquired a client');
                },
                query: async () => {
                    queryCount += 1;
                    throw new Error('denied loyalty recalculation reached SQL');
                }
            }
        },
        '../middleware/auth': { ...auth, authenticateToken: passAccessMiddleware }
    });

    try {
        await withMountedAccessRouter(
            loaded.router,
            '/loyalty',
            { role: 'creator', username: 'loyalty-denied', action_denylist: ['view_revenue'] },
            async baseUrl => {
                const requests = [
                    ['POST', '/recalculate', {}],
                    ['POST', '/discounts', { code: 'TASK4', name: 'Task 4', type: 'fixed', value: 100 }],
                    ['PUT', '/discounts/7', { is_active: false }],
                    ['DELETE', '/discounts/7', {}]
                ];

                for (const [method, path, body] of requests) {
                    const response = await fetch(baseUrl + '/loyalty' + path, {
                        method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    assert.equal(response.status, 403, method + ' ' + path);
                    assert.deepEqual(
                        await response.json(),
                        { error: 'Insufficient permissions' },
                        method + ' ' + path
                    );
                }
            }
        );
    } finally {
        loaded.restore();
    }

    assert.equal(connectCount, 0);
    assert.equal(queryCount, 0);
});
