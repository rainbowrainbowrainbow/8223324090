'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const auth = require('../middleware/auth');
const { buildMembershipAccess, applyMembershipAccess } = require('../services/businessMembership');

const contexts = ['event_genix', 'dar', 'crm', 'maysternya_doli', 'fixture_business'];
function actor(context, mode = 'membership', { revoked = false, inactive = false, role = 'creator' } = {}) {
    const user = { id: 901, username: 'synthetic_chat_actor', name: 'Synthetic actor', role,
        business_contexts: contexts, default_business_context: context };
    const registry = contexts.map((key, index) => ({ business_id: index + 1,
        organization_id: key === 'fixture_business' ? 2 : 1, context_key: key,
        access_mode: ['crm', 'maysternya_doli'].includes(key) ? 'compatibility' : mode,
        business_status: inactive && key === context ? 'inactive' : 'active', organization_status: 'active' }));
    const memberships = revoked || mode === 'compatibility' ? [] : registry
        .filter(row => row.access_mode === 'membership')
        .map(row => ({ ...row, role: row.context_key === 'dar' ? 'manager' : role,
            organization_role: 'owner', is_default: row.context_key === context,
            business_modules: ['tasks', 'timeline'] }));
    return applyMembershipAccess(user, buildMembershipAccess(user, memberships, context, registry));
}

function load(relative, mocks, state) {
    const filename = path.join(__dirname, '..', relative);
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports,
        require(id) { return Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id); },
        process: { env: { NODE_ENV: 'test', VAPID_PUBLIC_KEY: 'synthetic-public', VAPID_PRIVATE_KEY: 'synthetic-private', KIE_API_KEY: 'synthetic-provider-key' } },
        fetch: async () => { state.providerCalls++; throw new Error('External provider forbidden in containment test'); },
        console, Buffer, Date, URL, setTimeout, clearTimeout,
        setInterval: () => ({ unref() {} }), clearInterval() {},
        __filename: filename, __dirname: path.dirname(filename)
    }, { filename });
    return module.exports;
}

function fixture() {
    const state = { mode: 'membership', revoked: false, user: null, queries: [], serviceCalls: [], providerCalls: 0, authCalls: 0 };
    const serviceCall = name => async () => { state.serviceCalls.push(name); return []; };
    const pool = { async query(sql) { state.queries.push(sql); return { rows: [] }; } };
    const noop = () => {};
    const mocks = {
        '../db': { pool },
        '../middleware/auth': { ...auth, authenticateToken(req, res, next) {
            state.authCalls++;
            if (!req.headers.authorization) return res.status(401).json({ error: 'Authentication required' });
            const context = req.headers['x-business-context'] || 'event_genix';
            req.user = state.user || actor(context, state.mode, { revoked: state.revoked });
            next();
        } },
        '../utils/logger': { createLogger: () => ({ info: noop, warn: noop, error: noop }) },
        '../services/chatService': {
            ensureDefaultMemberships: serviceCall('ensureDefaultMemberships'), getChannels: serviceCall('getChannels'),
            isMember: async () => { state.serviceCalls.push('isMember'); return true; },
            getChannelMessages: serviceCall('getChannelMessages'), importAssistantTranscript: serviceCall('importAssistantTranscript')
        },
        '../services/websocket': { broadcastToChannel: serviceCall('broadcast'), sendToUser: serviceCall('sendToUser'), sendToUsername: serviceCall('sendToUsername') },
        '../services/chatUploadStorage': { prepareChatUploadBlob: serviceCall('upload'), validateChatUploadFile: noop },
        '../services/chat-bot': { processMessage: serviceCall('bot') },
        '../services/guardian': {}, '../services/linkPreview': {},
        '../services/dashboardAssistant': {},
        '../services/notificationOutbox': { emitTaskCreatedNotificationOutboxEvent: serviceCall('outbox') },
        'web-push': { setVapidDetails: noop, sendNotification: serviceCall('webpush') },
        '../services/kleshnya-greeting': { getGreeting: serviceCall('greeting'), getChatHistory: serviceCall('history'), addChatMessage: serviceCall('addChatMessage') },
        '../services/kleshnya-bridge': { KLESHNYA_WEBHOOK_SECRET: 'synthetic-bridge-key', BRIDGE_ENABLED: false,
            getPendingMessages: serviceCall('pending'), handleWebhookResponse: serviceCall('bridge'), getTelegramFileUrl: serviceCall('telegramFile') }
    };
    const ai = { hasAnySharedAIKey: () => true,
        callUnifiedChatCompletion: async () => { state.providerCalls++; throw new Error('AI forbidden in containment test'); } };
    const engine = load('services/kleshnya-chat.js', { '../db': { pool }, './ai-config': ai,
        '../utils/logger': mocks['../utils/logger'] }, state);
    mocks['../services/ai-config'] = ai;
    mocks['../services/kleshnya-chat'] = engine;
    return { state, engine, chat: load('routes/chat.js', mocks, state), kleshnya: load('routes/kleshnya.js', mocks, state) };
}

async function withHttp(f, run) {
    const app = express();
    app.use(express.json());
    app.use('/api/chat', f.chat);
    app.use('/api/kleshnya', f.kleshnya);
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const request = async (route, { method = 'GET', body, context = 'event_genix', authenticated = true, headers = {} } = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
            method, headers: { 'Content-Type': 'application/json', Connection: 'close', 'X-Business-Context': context,
                ...(authenticated ? { Authorization: 'Fixture same session' } : {}), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    };
    try { await run(request); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

function assertNoWork(state) {
    assert.equal(state.queries.length, 0, 'No domain SQL');
    assert.equal(state.serviceCalls.length, 0, 'No chat/history/upload/bridge operation');
    assert.equal(state.providerCalls, 0, 'No AI/provider invocation');
}

test('actual chat router denies membership and non-Park compatibility before defaults, reads, transcripts or upload', async () => {
    const f = fixture();
    await withHttp(f, async request => {
        for (const context of contexts) {
            for (const [route, method, body] of [
                ['/channels', 'GET'], ['/channels/73/messages', 'GET'],
                ['/assistant/transcript', 'POST', { messages: [{ content: 'synthetic' }] }],
                ['/assistant/reply', 'POST', { channelId: 73, message: 'synthetic' }],
                ['/channels/73/upload', 'POST', {}], ['/messages/74', 'DELETE']
            ]) {
                const result = await request('/api/chat' + route, { context, method, body });
                assert.equal(result.status, 403, context + ':' + route);
                assert.equal(result.body.code, 'chat_not_migrated');
                assertNoWork(f.state);
            }
        }
    });
});

test('every existing Kleshnya JWT route is denied before SQL, history, proxy or generation', async () => {
    const f = fixture();
    const cases = [
        ['/sessions', 'GET'], ['/sessions', 'POST', {}], ['/sessions/73', 'PUT', {}], ['/sessions/73', 'DELETE'],
        ['/sessions/73/messages', 'GET'], ['/sessions/73/messages', 'DELETE'], ['/greeting', 'GET'],
        ['/chat', 'GET'], ['/chat', 'POST', { message: 'synthetic' }], ['/messages/73/reaction', 'PATCH', {}],
        ['/media', 'GET'], ['/media/73', 'GET'], ['/media/file/foreign', 'GET'], ['/skills', 'GET'],
        ['/generate-image', 'POST', { prompt: 'synthetic' }], ['/generate-image/foreign', 'GET']
    ];
    await withHttp(f, async request => {
        for (const context of contexts) {
            for (const [route, method, body] of cases) {
                const result = await request('/api/kleshnya' + route, { context, method, body });
                assert.equal(result.status, 403, context + ':' + route);
                assert.equal(result.body.code, 'kleshnya_not_migrated');
                assertNoWork(f.state);
            }
        }
    });
});

test('pre-cutover Park retains existing route responses and role/auth guards', async () => {
    const f = fixture();
    f.state.mode = 'compatibility';
    await withHttp(f, async request => {
        assert.equal((await request('/api/chat/channels', { authenticated: false })).status, 401);
        assert.equal((await request('/api/kleshnya/sessions', { authenticated: false })).status, 401);
        assertNoWork(f.state);
        const channels = await request('/api/chat/channels');
        assert.equal(channels.status, 200);
        assert.deepEqual(channels.body, []);
        assert.deepEqual(f.state.serviceCalls, ['ensureDefaultMemberships', 'getChannels']);
        assert.equal((await request('/api/kleshnya/sessions')).status, 200);
        assert.equal(f.state.queries.length, 1);
        f.state.user = actor('event_genix', 'compatibility', { role: 'waiter' });
        assert.equal((await request('/api/chat/channels')).status, 403);
        assert.equal(f.state.serviceCalls.length, 2);
    });
});

test('same session cannot retain legacy chat availability across Park cutover or membership revocation', async () => {
    const f = fixture();
    f.state.mode = 'compatibility';
    await withHttp(f, async request => {
        assert.equal((await request('/api/kleshnya/sessions')).status, 200);
        f.state.mode = 'membership';
        assert.equal((await request('/api/kleshnya/sessions')).status, 403);
        f.state.revoked = true;
        assert.equal((await request('/api/kleshnya/sessions')).status, 403);
        assert.equal(f.state.queries.length, 1, 'Fresh principal projection blocks the same fixture session before SQL');
    });
});

test('aggregate compatibility and invalid server state cannot restore global chat', async () => {
    const f = fixture();
    f.state.mode = 'compatibility';
    await withHttp(f, async request => {
        const aggregate = await request('/api/chat/channels?businessScope=all');
        assert.equal(aggregate.status, 403);
        f.state.user = actor('event_genix', 'compatibility', { inactive: true });
        assert.equal((await request('/api/kleshnya/sessions')).status, 403);
        assertNoWork(f.state);
    });
});

test('secret bridge handlers retain their own authentication and are not silently converted to JWT', async () => {
    const f = fixture();
    await withHttp(f, async request => {
        for (const route of ['/pending-messages', '/sync-chat', '/webhook']) {
            const result = await request('/api/kleshnya' + route, { authenticated: false,
                method: route === '/pending-messages' ? 'GET' : 'POST', body: route === '/pending-messages' ? undefined : {} });
            assert.equal(result.status, 403);
            assert.equal(result.body.error, 'Invalid secret');
        }
        const valid = await request('/api/kleshnya/pending-messages', { authenticated: false,
            headers: { 'X-Webhook-Secret': 'synthetic-bridge-key' } });
        assert.equal(valid.status, 200, 'Existing secret-only bridge remains separately scoped');
        assert.equal(f.state.authCalls, 0);
        assert.deepEqual(f.state.serviceCalls, ['pending']);
    });
});

test('direct AI engine denies absent/unresolved/foreign/revoked actors before data and AI', async () => {
    const f = fixture();
    const actors = [null, { username: 'synthetic_chat_actor' }, ...contexts.map(context => actor(context)),
        actor('event_genix', 'membership', { revoked: true }), actor('event_genix', 'compatibility', { inactive: true })];
    for (const user of actors) {
        for (const message of ['привіт', 'Бронювання сьогодні', 'аналіз поточного дня']) {
            const result = await f.engine.generateChatResponse(message, 'synthetic_chat_actor', [], user);
            assert.equal(result.available, false);
            assert.ok(result.code);
            assert.equal(typeof result.message, 'string');
            assert.equal(result.suggestions.length, 0);
            assertNoWork(f.state);
        }
    }
});

test('server-resolved pre-cutover Park still receives the established greeting shape', async () => {
    const f = fixture();
    const result = await f.engine.generateChatResponse('привіт', 'synthetic_chat_actor', [], actor('event_genix', 'compatibility'));
    assert.match(result.message, /Привіт/);
    assert.ok(result.suggestions.length > 0);
    assertNoWork(f.state);
});
