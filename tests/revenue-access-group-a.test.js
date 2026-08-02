'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { canUseAction } = require('../middleware/auth');
const { installRevenueResponseShaper } = require('../services/revenueAccessPolicy');

const ROOT = path.resolve(__dirname, '..');

function routeSource(name) {
    return fs.readFileSync(path.join(ROOT, 'routes', name), 'utf8');
}

async function withRouter(router, mountPath, user, run) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
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

function loadEventQueueRouter(pool, publish) {
    const routeId = require.resolve('../routes/event-queue');
    const dbId = require.resolve('../db');
    const eventBusId = require.resolve('../services/eventBus');
    const authId = require.resolve('../middleware/auth');
    const previous = new Map([
        [routeId, require.cache[routeId]],
        [dbId, require.cache[dbId]],
        [eventBusId, require.cache[eventBusId]],
        [authId, require.cache[authId]]
    ]);
    const actualAuth = require('../middleware/auth');

    delete require.cache[routeId];
    require.cache[dbId] = {
        id: dbId,
        filename: dbId,
        loaded: true,
        exports: { pool }
    };
    require.cache[eventBusId] = {
        id: eventBusId,
        filename: eventBusId,
        loaded: true,
        exports: {
            publish,
            processEventRules: async () => {}
        }
    };
    require.cache[authId] = {
        id: authId,
        filename: authId,
        loaded: true,
        exports: {
            ...actualAuth,
            authenticateToken: (req, _res, next) => next()
        }
    };

    const router = require('../routes/event-queue');
    return {
        router,
        restore() {
            delete require.cache[routeId];
            for (const [id, entry] of previous) {
                if (entry) require.cache[id] = entry;
                else delete require.cache[id];
            }
        }
    };
}

function loadCopilotRouter(pool) {
    const routeId = require.resolve('../routes/copilot');
    const dbId = require.resolve('../db');
    const authId = require.resolve('../middleware/auth');
    const serviceId = require.resolve('../services/copilot');
    const previous = new Map([
        [routeId, require.cache[routeId]],
        [dbId, require.cache[dbId]],
        [authId, require.cache[authId]],
        [serviceId, require.cache[serviceId]]
    ]);

    delete require.cache[routeId];
    require.cache[dbId] = {
        id: dbId,
        filename: dbId,
        loaded: true,
        exports: { pool }
    };
    require.cache[authId] = {
        id: authId,
        filename: authId,
        loaded: true,
        exports: {
            requireRole: () => (_req, _res, next) => next()
        }
    };
    require.cache[serviceId] = {
        id: serviceId,
        filename: serviceId,
        loaded: true,
        exports: {
            openRouterChat: async () => '',
            buildCoachPrompt: () => '',
            buildDebriefPrompt: () => '',
            buildMeetingPrepPrompt: () => '',
            buildMessageWriterPrompt: () => '',
            buildSalesQAPrompt: () => '',
            buildObjectionPrompt: () => ''
        }
    };

    const router = require('../routes/copilot');
    return {
        router,
        restore() {
            delete require.cache[routeId];
            for (const [id, entry] of previous) {
                if (entry) require.cache[id] = entry;
                else delete require.cache[id];
            }
        }
    };
}

test('explicit view_revenue deny redacts nested money while preserving operational fields', async () => {
    const router = express.Router();
    router.use((req, res, next) => installRevenueResponseShaper(
        req,
        res,
        next,
        canUseAction(req.user, 'view_revenue'),
        { redactText: true }
    ));
    router.get('/', (_req, res) => {
        res.json({
            total: 3,
            count: 2,
            revenue: 900,
            history: {
                data: {
                    status: 'confirmed',
                    amount: 700,
                    note: 'Paid 250 ₴, guests 4'
                }
            },
            event: { payload: { type: 'booking.created', price: 500 } },
            actionLog: {
                items: [{
                    action: 'booking.updated',
                    target: 'booking:17',
                    meta: { status: 'confirmed', amount: 725 }
                }]
            },
            copilot: 'Package 2,000 ₴'
        });
    });

    await withRouter(
        router,
        '/projection',
        { role: 'creator', action_denylist: ['view_revenue'] },
        async baseUrl => {
            const response = await fetch(baseUrl + '/projection');
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.total, 3);
            assert.equal(body.count, 2);
            assert.equal(body.revenue, undefined);
            assert.equal(body.history.data.status, 'confirmed');
            assert.equal(body.history.data.amount, undefined);
            assert.equal(body.history.data.note, 'Paid [сума прихована], guests 4');
            assert.equal(body.event.payload.type, 'booking.created');
            assert.equal(body.event.payload.price, undefined);
            assert.equal(body.actionLog.items[0].action, 'booking.updated');
            assert.equal(body.actionLog.items[0].target, 'booking:17');
            assert.equal(body.actionLog.items[0].meta.status, 'confirmed');
            assert.equal(body.actionLog.items[0].meta.amount, undefined);
            assert.equal(body.copilot, 'Package [сума прихована]');
        }
    );
});

test('Group A route wiring derives revenue visibility from capability decisions', () => {
    const authRoute = routeSource('auth.js');
    const boardRoute = routeSource('board.js');
    const historyRoute = routeSource('history.js');
    const eventQueueRoute = routeSource('event-queue.js');
    const copilotRoute = routeSource('copilot.js');

    assert.match(authRoute, /const canViewRevenue = canUseAction\(req\.user, 'view_revenue'\);/);
    assert.match(authRoute, /showRevenue: canViewRevenue/);
    assert.match(authRoute, /res\.json\(shapeRevenuePayload\(profilePayload, canViewRevenue\)\);/);
    assert.doesNotMatch(authRoute, /showRevenue:\s*isAdminRole/);

    assert.match(boardRoute, /const canViewRevenue = canUseAction\(req\.user, 'view_revenue'\);/);
    assert.match(boardRoute, /canViewRevenue \?\s*pool\.query\([\s\S]*SUM\(b\.price\)/);
    assert.match(boardRoute, /if \(canViewRevenue\) payload\.revenue = rev\.revenue;/);
    assert.doesNotMatch(boardRoute, /REVENUE_ROLES/);

    const historyAuth = historyRoute.indexOf('router.use(authenticateToken);');
    const historyShaper = historyRoute.indexOf('installRevenueResponseShaper(', historyAuth);
    assert.ok(historyAuth >= 0 && historyShaper > historyAuth);
    assert.match(historyRoute, /canUseAction\(req\.user, 'view_revenue'\)/);

    const eventAuth = eventQueueRoute.indexOf('router.use(authenticateToken);');
    const eventShaper = eventQueueRoute.indexOf('installRevenueResponseShaper(', eventAuth);
    assert.ok(eventAuth >= 0 && eventShaper > eventAuth);
    assert.match(eventQueueRoute, /rejectFinancialEventWithoutRevenueAccess\(\s*req, res, event_type, \{ payload, idempotency_key \}\s*\)/);
    assert.match(eventQueueRoute, /queuedEvent\.event_type, queuedEvent\)/);
    assert.match(eventQueueRoute, /containsFinancialPointer\(inspectablePayload\)/);
    assert.match(eventQueueRoute, /containsFinancialTemplateReference\(inspectablePayload\)/);
    assert.match(eventQueueRoute, /FULL_PAYLOAD_SINK_ACTIONS\.has/);
    assert.match(eventQueueRoute, /function requirePlainEventPayload/);
    assert.match(eventQueueRoute, /router\.delete\('\/rules\/:id', requireSettingsManagement, requireStoredRuleRevenueAccess/);

    assert.match(copilotRoute, /router\.use\(requireRole\(\.\.\.MANAGER_ROLES\)\);/);
    assert.doesNotMatch(copilotRoute, /installRevenueResponseShaper|canUseAction\(req\.user, 'view_revenue'\)/);
});

test('Copilot case round-trip preserves user-authored currency text without view_revenue', async () => {
    const originalMessage = 'Клієнт назвав бюджет 2 000 ₴ і просить порівняти пакети.';
    const storedCase = {
        id: 17,
        title: 'Customer package comparison',
        status: 'active',
        created_by: 'copilot-roundtrip',
        messages: [{ role: 'user', content: originalMessage, ts: 1 }],
        last_summary: null
    };
    const queries = [];
    const loaded = loadCopilotRouter({
        async query(sql, params = []) {
            const statement = String(sql);
            queries.push({ sql: statement, params });
            if (statement.includes('SELECT * FROM ai_cases')) {
                return { rows: [structuredClone(storedCase)] };
            }
            if (statement.includes('UPDATE ai_cases SET title')) {
                storedCase.messages = JSON.parse(params[3]);
                storedCase.last_summary = params[4];
                return { rows: [structuredClone(storedCase)] };
            }
            throw new Error('Unexpected Copilot case SQL: ' + statement);
        }
    });

    try {
        await withRouter(
            loaded.router,
            '/api/copilot',
            { role: 'creator', username: 'copilot-roundtrip', action_denylist: ['view_revenue'] },
            async baseUrl => {
                const getResponse = await fetch(baseUrl + '/api/copilot/cases/17');
                assert.equal(getResponse.status, 200);
                const loadedCase = await getResponse.json();
                assert.equal(loadedCase.data.messages[0].content, originalMessage);

                const messages = loadedCase.data.messages;
                messages.push({ role: 'assistant', content: 'Порівняння готове.', ts: 2 });
                const putResponse = await fetch(baseUrl + '/api/copilot/cases/17', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages, last_summary: 'Порівняння готове.' })
                });
                assert.equal(putResponse.status, 200);
                const updatedCase = await putResponse.json();
                assert.equal(updatedCase.data.messages[0].content, originalMessage);
            }
        );
    } finally {
        loaded.restore();
    }

    assert.equal(queries.length, 2);
    assert.equal(storedCase.messages[0].content, originalMessage);
    assert.doesNotMatch(JSON.stringify(storedCase.messages), /\[сума прихована\]/);
});

test('action-log GET shapes financial meta without blocking operational logging', () => {
    const source = routeSource('auth.js');
    const actionLogStart = source.indexOf("router.get('/action-log'");
    const actionLogEnd = source.indexOf("router.put('/password'", actionLogStart);
    assert.ok(actionLogStart >= 0 && actionLogEnd > actionLogStart);

    const actionLogBlock = source.slice(actionLogStart, actionLogEnd);
    assert.ok(actionLogBlock.includes('res.json(shapeRevenuePayload('));
    assert.ok(actionLogBlock.includes("canUseAction(req.user, 'view_revenue')"));
    assert.equal(source.includes("router.post('/log-action', authenticateToken, async"), true);
});

test('event rule configuration requires manage_settings while publish stays operational', async () => {
    let queryCount = 0;
    const published = [];
    const loaded = loadEventQueueRouter({
        async query() {
            queryCount += 1;
            throw new Error('settings-denied requests must not reach the database');
        }
    }, async (eventType, payload) => {
        published.push({ eventType, payload });
        return { id: 91, event_type: eventType, payload };
    });

    try {
        await withRouter(
            loaded.router,
            '/events',
            { role: 'creator', action_denylist: ['manage_settings'] },
            async baseUrl => {
                const settingsRequests = [
                    ['GET', '/events/rules'],
                    ['GET', '/events/rules/log'],
                    ['POST', '/events/rules'],
                    ['PUT', '/events/rules/7'],
                    ['DELETE', '/events/rules/7']
                ];

                for (const [method, path] of settingsRequests) {
                    const response = await fetch(baseUrl + path, {
                        method,
                        headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
                        body: method === 'GET' ? undefined : JSON.stringify({ code: 'rule', name: 'Rule', trigger_event: 'booking.created' })
                    });
                    assert.equal(response.status, 403, `${method} ${path}`);
                    assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
                }

                const publishResponse = await fetch(baseUrl + '/events/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ event_type: 'booking.created', payload: { status: 'confirmed' } })
                });
                assert.equal(publishResponse.status, 200);
                assert.equal((await publishResponse.json()).success, true);
            }
        );
    } finally {
        loaded.restore();
    }

    assert.equal(queryCount, 0);
    assert.deepEqual(published, [{ eventType: 'booking.created', payload: { status: 'confirmed' } }]);
});

test('event rule writes reject financial trigger, conditions, and actions before persistence', async () => {
    const queries = [];
    const loaded = loadEventQueueRouter({
        async query(sql, params = []) {
            queries.push({ sql, params });
            return { rows: [{ id: 9, code: params[0] || 'rule' }] };
        }
    }, async () => null);

    try {
        await withRouter(
            loaded.router,
            '/api/events',
            { role: 'creator', action_denylist: ['view_revenue'] },
            async baseUrl => {
                const financialRequests = [
                    ['POST', '/api/events/rules', {
                        code: 'payment_rule',
                        name: 'Payment rule',
                        trigger_event: 'payment.received',
                        conditions: {},
                        actions: []
                    }],
                    ['POST', '/api/events/rules', {
                        code: 'amount_rule',
                        name: 'Amount rule',
                        trigger_event: 'booking.created',
                        conditions: { amount: { gt: 1000 } },
                        actions: []
                    }],
                    ['POST', '/api/events/rules', {
                        code: 'price_pointer_rule',
                        name: 'Price pointer rule',
                        trigger_event: 'booking.created',
                        conditions: { field: 'booking.price', operator: 'gt', value: 1000 },
                        actions: []
                    }],
                    ['POST', '/api/events/rules', {
                        code: 'camel_price_pointer_rule',
                        name: 'Camel price pointer rule',
                        trigger_event: 'booking.created',
                        conditions: { field: 'unitPrice', operator: 'gt', value: 1000 },
                        actions: []
                    }],
                    ['POST', '/api/events/rules', {
                        code: 'template_price_rule',
                        name: 'Template price rule',
                        trigger_event: 'booking.created',
                        conditions: {},
                        actions: [{ type: 'send_telegram', template: 'Сума {price}' }]
                    }],
                    ['POST', '/api/events/rules', {
                        code: 'path_template_rule',
                        name: 'Path template rule',
                        trigger_event: 'booking.created',
                        conditions: {},
                        actions: [{ type: 'notify', template: 'Value booking.price' }]
                    }],
                    ['POST', '/api/events/rules', {
                        code: 'balance_due_template_rule',
                        name: 'Balance due template rule',
                        trigger_event: 'booking.created',
                        conditions: {},
                        actions: [{ type: 'notify', template: 'Value {balanceDue}' }]
                    }],
                    ['POST', '/api/events/rules', {
                        code: 'braced_net_rule',
                        name: 'Net template rule',
                        trigger_event: 'booking.created',
                        conditions: {},
                        actions: [{ type: 'notify', template: 'Value {booking.net}' }]
                    }],
                    ['POST', '/api/events/rules', {
                        code: 'description_amount_rule',
                        name: 'Threshold rule',
                        description: 'amount=900',
                        trigger_event: 'booking.created',
                        conditions: {},
                        actions: [{ type: 'notify', payload: { channel: 'ops' } }]
                    }],
                    ['POST', '/api/events/rules', {
                        code: 'opaque_print_rule',
                        name: 'Opaque print rule',
                        trigger_event: 'booking.created',
                        conditions: {},
                        actions: [{ type: 'create_print_job', template_code: 'booking' }]
                    }],
                    ['PUT', '/api/events/rules/9', {
                        name: 'Revenue action',
                        trigger_event: 'booking.created',
                        conditions: {},
                        actions: [{ type: 'notify', payload: { revenue: 5000 } }]
                    }]
                ];

                for (const [method, path, body] of financialRequests) {
                    const response = await fetch(baseUrl + path, {
                        method,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    assert.equal(response.status, 403, `${method} ${path}`);
                    assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
                }
                assert.equal(queries.length, 0, 'financial rules must be rejected before database work');

                const malformedContainers = [
                    {
                        code: 'string_conditions',
                        name: 'String conditions',
                        trigger_event: 'booking.created',
                        conditions: '{"field":"booking.price","value":1000}',
                        actions: []
                    },
                    {
                        code: 'string_actions',
                        name: 'String actions',
                        trigger_event: 'booking.created',
                        conditions: {},
                        actions: '[{"type":"send_telegram","template":"{price}"}]'
                    }
                ];
                for (const body of malformedContainers) {
                    const response = await fetch(baseUrl + '/api/events/rules', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    assert.equal(response.status, 400);
                }
                assert.equal(queries.length, 0, 'invalid rule containers must fail before persistence');

                const operationalResponse = await fetch(baseUrl + '/api/events/rules', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        code: 'status_rule',
                        name: 'Status rule',
                        trigger_event: 'booking.status_changed',
                        conditions: { status: 'confirmed' },
                        actions: [{ type: 'notify', payload: { channel: 'operations', callback: 'https://hooks.example.net/ok' } }]
                    })
                });
                assert.equal(operationalResponse.status, 200);
                assert.equal((await operationalResponse.json()).success, true);
                assert.equal(queries.length, 1);
            }
        );
    } finally {
        loaded.restore();
    }
});

test('event rule name-only update and delete cannot mutate a hidden financial rule', async () => {
    const queries = [];
    let updateCount = 0;
    let deleteCount = 0;
    const loaded = loadEventQueueRouter({
        async query(sql, params = []) {
            const statement = String(sql);
            queries.push({ sql: statement, params });
            if (statement.includes('FROM rule_definitions WHERE id = $1')) {
                return {
                    rows: [{
                        name: 'Threshold rule',
                        description: 'amount=900',
                        trigger_event: 'booking.status_changed',
                        conditions: { status: 'confirmed' },
                        actions: [{ type: 'notify', payload: { channel: 'ops' } }]
                    }]
                };
            }
            if (statement.includes('UPDATE rule_definitions')) updateCount += 1;
            if (statement.includes('DELETE FROM rule_definitions')) deleteCount += 1;
            throw new Error('denied rule mutation reached persistence');
        }
    }, async () => null);

    try {
        await withRouter(
            loaded.router,
            '/api/events',
            { role: 'creator', action_denylist: ['view_revenue'] },
            async baseUrl => {
                let response = await fetch(baseUrl + '/api/events/rules/9', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'Renamed rule' })
                });
                assert.equal(response.status, 403);
                assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });

                response = await fetch(baseUrl + '/api/events/rules/9', {
                    method: 'DELETE'
                });
                assert.equal(response.status, 403);
                assert.deepEqual(await response.json(), { error: 'Insufficient permissions' });
            }
        );
    } finally {
        loaded.restore();
    }

    assert.equal(queries.length, 2);
    for (const query of queries) {
        assert.match(query.sql, /SELECT name, description, trigger_event, conditions, actions FROM rule_definitions/);
        assert.deepEqual(query.params, ['9']);
    }
    assert.equal(updateCount, 0);
    assert.equal(deleteCount, 0);
});

test('event queue deny keeps operational publish and retry available but blocks financial events', async () => {
    const queries = [];
    const published = [];
    const pool = {
        async query(sql, params = []) {
            queries.push({ sql, params });
            if (sql.includes('SELECT * FROM event_queue')) {
                return {
                    rows: [
                        {
                            id: 10,
                            event_type: 'booking.created',
                            payload: { status: 'confirmed', price: 500 },
                            attempts: 1,
                            total: 4
                        },
                        {
                            id: 11,
                            event_type: 'finance.custom',
                            payload: { status: 'ready', total: 1700 },
                            attempts: 0,
                            total: 4
                        }
                        , {
                            id: 12,
                            event_type: 'booking.created',
                            payload: '{"status":"confirmed","price":900}',
                            idempotency_key: 'booking.price=900',
                            last_error: 'amount=900',
                            attempts: 1,
                            total: 4
                        }
                        , {
                            id: 13,
                            eventType: 'booking.created',
                            payload: { status: 'confirmed' },
                            idempotencyKey: 'booking.price=900',
                            lastError: 'amount=900',
                            terminalReason: 'balanceDue=900',
                            attempts: 1,
                            total: 4
                        }
                    ]
                };
            }
            if (sql.includes('SELECT * FROM rule_definitions')) {
                return {
                    rows: [{
                        id: 12,
                        code: 'price_pointer_rule',
                        name: 'Notify above 1000',
                        trigger_event: 'booking.created',
                        conditions: { field: 'booking.price', operator: 'gt', value: 1000 },
                        actions: [{ type: 'notify', payload: { channel: 'ops' } }],
                        is_active: true
                    }]
                };
            }
            if (sql.includes('FROM event_queue WHERE id = $1')) {
                if (String(params[0]) === '1') {
                    return { rows: [{ event_type: 'booking.created', payload: { price: 500 } }] };
                } else if (String(params[0]) === '3') {
                    return { rows: [{ event_type: 'booking.created', payload: '{"price":900}' }] };
                } else if (String(params[0]) === '4') {
                    return { rows: [{ event_type: 'booking.created', payload: { status: 'confirmed' }, idempotency_key: 'booking.price=900' }] };
                }
                return { rows: [{ event_type: 'booking.status_changed', payload: { status: 'confirmed' } }] };
            }
            if (sql.includes('UPDATE event_queue')) {
                return {
                    rows: [{
                        id: Number(params[0]),
                        event_type: 'booking.status_changed',
                        payload: { status: 'confirmed' },
                        status: 'pending'
                    }]
                };
            }
            throw new Error('Unexpected query: ' + sql);
        }
    };
    const publish = async (eventType, payload, idempotencyKey) => {
        const event = { event_type: eventType, payload, idempotency_key: idempotencyKey };
        published.push(event);
        return event;
    };
    const loaded = loadEventQueueRouter(pool, publish);

    try {
        await withRouter(
            loaded.router,
            '/api/events',
            { role: 'creator', action_denylist: ['view_revenue'] },
            async baseUrl => {
                let response = await fetch(baseUrl + '/api/events');
                assert.equal(response.status, 200);
                let body = await response.json();
                assert.equal(body[0].total, 4);
                assert.equal(body[0].payload, undefined);
                assert.equal(body[0].detailsRestricted, true);
                assert.equal(body[1].event_type, 'finance.custom');
                assert.equal(body[1].payload, undefined);
                assert.equal(body[1].detailsRestricted, true);
                assert.equal(body[1].total, 4);
                assert.equal(body[2].payload, undefined);
                assert.equal(body[2].idempotency_key, undefined);
                assert.equal(body[2].last_error, undefined);
                assert.equal(body[2].detailsRestricted, true);
                assert.equal(body[3].idempotencyKey, undefined);
                assert.equal(body[3].lastError, undefined);
                assert.equal(body[3].terminalReason, undefined);
                assert.equal(body[3].detailsRestricted, true);

                response = await fetch(baseUrl + '/api/events/rules');
                assert.equal(response.status, 200);
                body = await response.json();
                assert.equal(body[0].trigger_event, 'booking.created');
                assert.equal(body[0].conditions, undefined);
                assert.equal(body[0].actions, undefined);
                assert.equal(body[0].name, undefined);
                assert.equal(body[0].detailsRestricted, true);

                response = await fetch(baseUrl + '/api/events/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event_type: 'booking.status_changed',
                        payload: { status: 'confirmed' }
                    })
                });
                assert.equal(response.status, 200);
                assert.equal(published.length, 1);

                response = await fetch(baseUrl + '/api/events/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event_type: 'booking.status_changed',
                        payload: { callback: 'https://hooks.example.net/ok' }
                    })
                });
                assert.equal(response.status, 200);
                assert.equal(published.length, 2);

                response = await fetch(baseUrl + '/api/events/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ event_type: 'booking.created', payload: { status: 'confirmed' }, idempotency_key: 'booking.price=900' })
                });
                assert.equal(response.status, 403);
                assert.equal(published.length, 2);

                response = await fetch(baseUrl + '/api/events/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event_type: 'booking.created',
                        payload: { status: 'confirmed', price: 900 }
                    })
                });
                assert.equal(response.status, 403);
                assert.equal(published.length, 2);

                response = await fetch(baseUrl + '/api/events/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event_type: 'booking.created',
                        payload: '{"status":"confirmed","price":900}'
                    })
                });
                assert.equal(response.status, 400);
                assert.equal(published.length, 2);

                response = await fetch(baseUrl + '/api/events/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event_type: 'booking.created',
                        payload: ['status', 'confirmed']
                    })
                });
                assert.equal(response.status, 400);
                assert.equal(published.length, 2);

                response = await fetch(baseUrl + '/api/events/1/retry', { method: 'POST' });
                assert.equal(response.status, 403);
                assert.equal(queries.filter(entry => entry.sql.includes('UPDATE event_queue')).length, 0);

                response = await fetch(baseUrl + '/api/events/3/retry', { method: 'POST' });
                assert.equal(response.status, 403);
                assert.equal(queries.filter(entry => entry.sql.includes('UPDATE event_queue')).length, 0);

                response = await fetch(baseUrl + '/api/events/4/retry', { method: 'POST' });
                assert.equal(response.status, 403);
                assert.equal(queries.filter(entry => entry.sql.includes('UPDATE event_queue')).length, 0);

                response = await fetch(baseUrl + '/api/events/2/retry', { method: 'POST' });
                assert.equal(response.status, 200);
                body = await response.json();
                assert.equal(body.event.status, 'pending');
                assert.equal(queries.filter(entry => entry.sql.includes('UPDATE event_queue')).length, 1);
            }
        );
    } finally {
        loaded.restore();
    }
});