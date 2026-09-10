const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const originalModules = new Map();

function mockModule(modulePath, exports) {
    const id = require.resolve(modulePath);
    if (!originalModules.has(id)) originalModules.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function reloadModule(modulePath) {
    const id = require.resolve(modulePath);
    if (!originalModules.has(id)) originalModules.set(id, require.cache[id]);
    delete require.cache[id];
    return require(modulePath);
}

function restoreModules() {
    for (const [id, original] of originalModules) {
        if (original) require.cache[id] = original;
        else delete require.cache[id];
    }
    originalModules.clear();
}

function loadHub(pool) {
    mockModule('../db', { pool });
    for (const modulePath of [
        '../services/kleshnya-chat', '../services/websocket', '../services/telegram',
        '../services/omni-viber', '../services/omni-sms', '../services/omni-facebook',
        '../services/omni-instagram', '../services/omni-telegram-bridge',
        '../services/omni-accounts', '../services/replyEscalation',
    ]) mockModule(modulePath, {});
    return reloadModule('../services/omni-hub');
}

function createHistoryPool() {
    const rows = Array.from({ length: 105 }, (_, index) => ({
        id: index + 1,
        conversation_id: 17,
        direction: 'inbound',
        content: `Fixture message ${index + 1}`,
        content_type: 'text',
        created_at: '2099-01-01T12:00:00.000Z',
        meta: {},
    }));
    const queries = [];
    return {
        queries,
        async query(sql, params) {
            const query = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ query, params });
            const isCount = query.startsWith('SELECT COUNT(*)');
            const contextIndex = isCount ? 1 : 3;
            const scoped = params[0] === 17 && (!params[contextIndex] || params[contextIndex] === 'event_genix');
            if (isCount) return { rows: [{ total: scoped ? rows.length : 0 }] };
            assert.match(query, /JOIN conversations c ON c.id = cm.conversation_id/);
            assert.match(query, /ORDER BY cm.created_at (ASC|DESC), cm.id \1/);
            const ordered = query.includes('cm.created_at DESC') ? rows.slice().reverse() : rows;
            return { rows: scoped ? ordered.slice(params[2], params[2] + params[1]) : [] };
        },
    };
}

describe('Omni message history pagination', () => {
    afterEach(restoreModules);

    it('opens the latest 100 messages and retrieves older tied-timestamp messages without gaps', async () => {
        const pool = createHistoryPool();
        const hub = loadHub(pool);
        const latest = await hub.getMessages(17, 100, 0, { businessContext: 'event_genix', latest: true });
        const older = await hub.getMessages(17, 100, 100, { businessContext: 'event_genix', latest: true });
        assert.equal(latest.total, 105);
        assert.equal(latest.messages.length, 100);
        assert.equal(latest.messages[0].id, 6);
        assert.equal(latest.messages.at(-1).id, 105);
        assert.deepEqual(older.messages.map(message => message.id), [1, 2, 3, 4, 5]);
        assert.deepEqual([...older.messages, ...latest.messages].map(message => message.id),
            Array.from({ length: 105 }, (_, index) => index + 1));
    });

    it('preserves the oldest-first default for existing callers', async () => {
        const pool = createHistoryPool();
        const hub = loadHub(pool);
        const first = await hub.getMessages(17);
        const second = await hub.getMessages(17, 50, 50);
        assert.equal(first.messages[0].id, 1);
        assert.equal(first.messages.at(-1).id, 50);
        assert.equal(second.messages[0].id, 51);
        assert.equal(second.messages.at(-1).id, 100);
        assert.equal(second.total, 105);
    });

    it('keeps the same business scope in history and count queries for latest pages', async () => {
        const pool = createHistoryPool();
        const hub = loadHub(pool);
        const result = await hub.getMessages(17, 100, 0, { businessContext: 'maysternya_doli', latest: true });
        assert.deepEqual(result, { messages: [], total: 0 });
        assert.deepEqual(pool.queries[0].params, [17, 100, 0, 'maysternya_doli']);
        assert.deepEqual(pool.queries[1].params, [17, 'maysternya_doli']);
        assert.match(pool.queries[0].query, /COALESCE\(c.business_context, 'event_genix'\) = \$4/);
        assert.match(pool.queries[1].query, /COALESCE\(c.business_context, 'event_genix'\) = \$2/);
    });

    it('bounds malformed and fractional pagination values before calling PostgreSQL', async () => {
        const pool = createHistoryPool();
        const hub = loadHub(pool);
        for (const [limit, offset, expectedLimit, expectedOffset] of [
            [-10, -2, 1, 0], [999, 4.8, 200, 4], [2.9, 1.5, 2, 1],
            ['bad', 'bad', 50, 0], [Infinity, Infinity, 50, 0],
        ]) {
            await hub.getMessages(17, limit, offset, { latest: true });
            assert.deepEqual(pool.queries.at(-2).params.slice(1), [expectedLimit, expectedOffset]);
        }
    });

    it('passes an explicit latest query flag and nonnegative pagination through the route', async () => {
        const calls = [];
        mockModule('../services/omni-hub', {
            getMessages: async (...args) => { calls.push(args); return { messages: [], total: 0 }; },
        });
        mockModule('../middleware/auth', {
            authenticateToken: (req, res, next) => next(),
            requireMinRole: () => (req, res, next) => next(),
            requireAction: () => (req, res, next) => next(),
        });
        mockModule('../services/businessContext', {
            businessContextFromRequest: req => req.businessContext,
            requireBusinessContext: () => true,
        });
        mockModule('../services/adminAudit', {});
        mockModule('../services/omniLeadAssistant', {});
        mockModule('../services/omni-accounts', {});
        const router = reloadModule('../routes/omnichannel');
        const route = router.stack.find(layer => layer.route?.path === '/conversations/:id/messages').route;
        const handler = route.stack.at(-1).handle;
        const response = { json() {}, status() { throw new Error('Unexpected error response'); } };
        await handler({ user: { role: 'creator' }, params: { id: '17' }, query: { latest: 'true', limit: '-5', offset: '-10' }, businessContext: 'event_genix' }, response);
        await handler({ user: { role: 'creator' }, params: { id: '17' }, query: {}, businessContext: 'event_genix' }, response);
        assert.deepEqual(calls, [
            [17, 1, 0, { businessContext: 'event_genix', latest: true }],
            [17, 50, 0, { businessContext: 'event_genix', latest: false }],
        ]);
    });
});
