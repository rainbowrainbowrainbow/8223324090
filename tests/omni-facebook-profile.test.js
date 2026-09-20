'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');

const saved = new Map();
function mock(name, value) {
    const id = require.resolve(name);
    if (!saved.has(id)) saved.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports: value };
}
function fresh(name) {
    const id = require.resolve(name);
    if (!saved.has(id)) saved.set(id, require.cache[id]);
    delete require.cache[id];
    return require(name);
}
afterEach(() => {
    for (const [id, value] of saved) {
        if (value) require.cache[id] = value;
        else delete require.cache[id];
    }
    saved.clear();
});
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function logs() {
    const entries = [];
    mock('../utils/logger', { createLogger: () => Object.fromEntries(
        ['debug', 'info', 'warn', 'error'].map(level => [level, (...args) => entries.push({ level, args })])
    ) });
    return entries;
}
function fakeHttps(t, responseBody, { status = 200, pending = false, aborted = false } = {}) {
    const requests = [];
    t.mock.method(https, 'request', (options, callback) => {
        const request = new EventEmitter();
        const entry = { options, request };
        requests.push(entry);
        request.write = () => {};
        request.setTimeout = (ms, onTimeout) => { entry.timeout = ms; entry.onTimeout = onTimeout; return request; };
        request.destroy = error => { request.emit('error', error); request.emit('close'); };
        request.end = () => {
            if (pending) return;
            queueMicrotask(() => {
                const response = new EventEmitter();
                response.statusCode = status;
                callback(response);
                if (aborted) {
                    response.emit('error', new Error('aborted response with private detail'));
                    request.emit('close');
                    return;
                }
                response.emit('data', typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody));
                response.emit('end');
                request.emit('close');
            });
        };
        return request;
    });
    return requests;
}
function adapter(resolveRuntime = async () => ({ pageToken: 'fixture-page-token', pageId: '123' })) {
    mock('../services/omni-accounts', { resolveOmniRuntimeConfig: resolveRuntime });
    return fresh('../services/omni-facebook');
}
function conversation(overrides = {}) {
    return { id: 7, channel: 'facebook', externalId: '456', customerName: 'Unknown', businessContext: 'dar', ...overrides };
}
function enrichment(getUserProfile, query = async () => ({ rows: [{ id: 7 }] })) {
    mock('../services/omni-facebook', { getUserProfile });
    mock('../db', { pool: { query } });
    return fresh('../services/omni-facebook-profile').enrichFacebookConversation;
}

test('profile lookup requires an explicit valid business and PSID before resolving credentials', async t => {
    logs();
    const requests = fakeHttps(t, {});
    let resolved = 0;
    const fb = adapter(async () => { resolved++; return {}; });
    for (const options of [{}, { businessContext: '' }, { businessContext: '../dar' }]) {
        assert.equal((await fb.getUserProfile('456', [], options)).code, 'PROFILE_CONTEXT_REQUIRED');
    }
    assert.equal((await fb.getUserProfile('comment:456', [], { businessContext: 'dar' })).code, 'PROFILE_ID_INVALID');
    assert.equal(resolved, 0);
    assert.equal(requests.length, 0);
});

test('profile lookup uses the selected business Page token and logs no returned profile data', async t => {
    const entries = logs();
    const requests = fakeHttps(t, { id: '456', first_name: 'FixtureFirst', last_name: 'FixtureLast' });
    const contexts = [];
    const fb = adapter(async (channel, options) => {
        assert.equal(channel, 'facebook');
        assert.equal(options.strict, true);
        contexts.push(options.businessContext);
        return { pageToken: 'fixture-token-' + options.businessContext, pageId: '123' };
    });
    for (const businessContext of ['dar', 'event_genix']) {
        const result = await fb.getUserProfile('456', ['first_name', 'last_name'], { businessContext });
        assert.equal(result.profile.firstName, 'FixtureFirst');
        assert.equal(result.profile.lastName, 'FixtureLast');
    }
    assert.deepEqual(contexts, ['dar', 'event_genix']);
    assert.deepEqual(requests.map(r => r.options.headers.Authorization), ['Bearer fixture-token-dar', 'Bearer fixture-token-event_genix']);
    assert.ok(requests.every(r => r.options.hostname === 'graph.facebook.com' && r.timeout === 3000));
    assert.match(requests[0].options.path, /\/456\?fields=first_name%2Clast_name$/);
    assert.doesNotMatch(JSON.stringify(entries), /FixtureFirst|FixtureLast|456|fixture-token-/);
});

test('missing business credentials and failed configuration reads never send a profile request', async t => {
    logs();
    const requests = fakeHttps(t, {});
    let fail = false;
    const fb = adapter(async () => {
        if (fail) throw new Error('sensitive configuration detail');
        return { pageId: '123' };
    });
    assert.equal((await fb.getUserProfile('456', [], { businessContext: 'dar' })).code, 'PROFILE_CONFIG_MISSING');
    fail = true;
    const result = await fb.getUserProfile('456', [], { businessContext: 'dar' });
    assert.equal(result.code, 'PROFILE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(result), /sensitive/);
    assert.equal(requests.length, 0);
});

for (const [providerCode, expected] of [[200, 'PROFILE_ACCESS_DENIED'], [190, 'PROFILE_TOKEN_INVALID']]) {
    test('profile error ' + providerCode + ' returns a safe diagnostic without provider details', async t => {
        const entries = logs();
        fakeHttps(t, { error: { code: providerCode, message: 'private-name private-token PSID456' } }, { status: 403 });
        const result = await adapter().getUserProfile('456', [], { businessContext: 'dar' });
        assert.equal(result.code, expected);
        assert.doesNotMatch(JSON.stringify([result, entries]), /private-name|private-token|PSID456/);
    });
}

test('a stalled Facebook profile request is destroyed at the three-second deadline', async t => {
    logs();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const requests = fakeHttps(t, null, { pending: true });
    const result = adapter().getUserProfile('456', [], { businessContext: 'dar' });
    await Promise.resolve();
    assert.equal(requests.length, 1);
    t.mock.timers.tick(3000);
    assert.equal((await result).code, 'PROFILE_TIMEOUT');
});

test('a response stream error is contained without exposing the raw error', async t => {
    const entries = logs();
    fakeHttps(t, {}, { aborted: true });
    const result = await adapter().getUserProfile('456', [], { businessContext: 'dar' });
    assert.equal(result.code, 'PROFILE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify([result, entries]), /private detail/);
});

test('oversized profile responses fail safely', async t => {
    logs();
    fakeHttps(t, 'x'.repeat(65537));
    assert.equal((await adapter().getUserProfile('456', [], { businessContext: 'dar' })).success, false);
});

for (const name of [null, '', '  ', 'Unknown', ' unknown ']) {
    test('fills an available profile name for fallback ' + JSON.stringify(name), async () => {
        logs();
        let query;
        const enrich = enrichment(async (id, fields, options) => {
            assert.equal(id, '456');
            assert.deepEqual(fields, ['first_name', 'last_name']);
            assert.deepEqual(options, { businessContext: 'dar' });
            return { success: true, profile: { firstName: ' Fixture ', lastName: ' Person ' } };
        }, async q => { query = q; return { rows: [{ id: 7 }] }; });
        assert.deepEqual(await enrich(conversation({ customerName: name }), 'dar'), { id: 7, businessContext: 'dar' });
        assert.deepEqual(query.values, ['Fixture Person', 7, '456', 'dar']);
        assert.equal(query.query_timeout, 3000);
        assert.match(query.text, /channel = 'facebook'/);
        assert.match(query.text, /external_id = \$3/);
        assert.match(query.text, /business_context, 'event_genix'\) = \$4/);
        assert.match(query.text, /customer_name IS NULL OR BTRIM\(customer_name\) = ''/);
        assert.match(query.text, /LOWER\(BTRIM\(customer_name\)\) = 'unknown'/);
    });
}

test('meaningful names, other channels, comments and mismatched businesses cause no lookup', async () => {
    logs();
    let calls = 0;
    const enrich = enrichment(async () => { calls++; throw new Error('Must not run'); });
    for (const record of [
        conversation({ customerName: 'Manual name' }),
        conversation({ channel: 'instagram' }),
        conversation({ externalId: 'comment:456' }),
        conversation({ businessContext: 'event_genix' }),
    ]) assert.equal(await enrich(record, 'dar'), null);
    assert.equal(await enrich(conversation(), undefined), null);
    assert.equal(calls, 0);
});

test('a manual rename while the request is running wins the conditional update', async () => {
    logs();
    const pending = deferred();
    let currentName = 'Unknown';
    const enrich = enrichment(() => pending.promise, async query => {
        assert.match(query.text, /AND \(customer_name IS NULL OR BTRIM\(customer_name\) = '' OR LOWER\(BTRIM\(customer_name\)\) = 'unknown'\)/);
        return { rows: currentName === 'Unknown' ? [{ id: 7 }] : [] };
    });
    const result = enrich(conversation(), 'dar');
    currentName = 'Manager-assigned name';
    pending.resolve({ success: true, profile: { firstName: 'API name' } });
    assert.equal(await result, null);
    assert.equal(currentName, 'Manager-assigned name');
});

test('concurrent requests coalesce and failures retry only on a later message after cooldown', async t => {
    const entries = logs();
    let now = 10000; t.mock.method(Date, 'now', () => now);
    const pending = deferred(); let calls = 0; let writes = 0;
    const enrich = enrichment(() => { calls++; return pending.promise; }, async () => { writes++; return { rows: [] }; });
    const first = enrich(conversation(), 'dar');
    assert.equal(enrich(conversation(), 'dar'), first);
    pending.resolve({ success: false, code: 'PROFILE_ACCESS_DENIED', error: 'private Meta error' });
    assert.equal(await first, null);
    assert.equal(await enrich(conversation(), 'dar'), null);
    assert.equal(calls, 1);
    now += 5 * 60 * 1000 + 1;
    assert.equal(await enrich(conversation(), 'dar'), null);
    assert.equal(calls, 2);
    assert.equal(writes, 0);
    assert.match(JSON.stringify(entries), /Business Asset User Profile Access/);
    assert.doesNotMatch(JSON.stringify(entries), /private Meta error|456/);
});

test('identical PSIDs in separate businesses do not share a lookup or name update', async () => {
    logs(); const calls = []; const writes = [];
    const enrich = enrichment(async (_id, _fields, options) => {
        calls.push(options.businessContext);
        return { success: true, profile: { firstName: 'Fixture ' + options.businessContext } };
    }, async query => { writes.push(query.values); return { rows: [{ id: 7 }] }; });
    await Promise.all(['dar', 'event_genix'].map(businessContext => enrich(conversation({ businessContext }), businessContext)));
    assert.deepEqual(calls.sort(), ['dar', 'event_genix']);
    assert.deepEqual(writes.map(w => [w[0], w[3]]).sort(), [['Fixture dar', 'dar'], ['Fixture event_genix', 'event_genix']]);
});

test('empty profiles and rejected database updates leave the fallback without leaking details', async () => {
    const entries = logs();
    let profile = {};
    const enrich = enrichment(async () => ({ success: true, profile }), async () => { throw new Error('private-name private-token'); });
    assert.equal(await enrich(conversation(), 'dar'), null);
    profile = { firstName: 'private-name' };
    assert.equal(await enrich(conversation({ id: 8 }), 'dar'), null);
    assert.match(JSON.stringify(entries), /PROFILE_NAME_EMPTY/);
    assert.match(JSON.stringify(entries), /PROFILE_ENRICHMENT_FAILED/);
    assert.doesNotMatch(JSON.stringify(entries), /private-name|private-token/);
});

test('bursts cannot start more than sixteen concurrent enrichments', async () => {
    logs(); const pending = deferred(); let calls = 0;
    const enrich = enrichment(() => { calls++; return pending.promise; });
    const attempts = Array.from({ length: 17 }, (_, i) => enrich(conversation({ id: i + 1 }), 'dar'));
    await Promise.resolve();
    assert.equal(calls, 16);
    assert.equal(await attempts[16], null);
    pending.resolve({ success: false, code: 'PROFILE_TIMEOUT' });
    await Promise.all(attempts);
});

// Exercise real hub and enrichment together; the fake store models message identity and commits.
function inboundHarness(profileResponse, { existing = false, customerName = 'Unknown' } = {}) {
    const entries = logs();
    const state = { row: existing ? {
        id: 7, channel: 'facebook', external_id: '456', customer_name: customerName,
        business_context: 'dar', unread_count: 0, meta: {},
    } : null, messages: [], committed: 0, profileCalls: 0, events: [] };
    const query = async (sql, params = []) => {
        if (typeof sql === 'object') {
            assert.equal(sql.values[3], 'dar');
            if (!state.row.customer_name || state.row.customer_name.trim().toLowerCase() === 'unknown') {
                state.row.customer_name = sql.values[0];
                return { rows: [{ id: 7 }] };
            }
            return { rows: [] };
        }
        const text = sql.replace(/\s+/g, ' ').trim();
        if (text === 'COMMIT') { state.committed++; return { rows: [] }; }
        if (['BEGIN', 'ROLLBACK'].includes(text) || text.startsWith('SELECT pg_advisory')) return { rows: [] };
        if (text.startsWith('SELECT * FROM conversations')) return { rows: state.row ? [{ ...state.row }] : [] };
        if (text.startsWith('INSERT INTO conversations ')) {
            state.row = { id: 7, business_context: params[0], channel: params[1], external_id: params[2], customer_name: params[3], unread_count: 0, meta: {} };
            return { rows: [{ ...state.row }] };
        }
        if (text.startsWith('SELECT * FROM conversation_messages')) return { rows: state.messages.filter(m => m.conversation_id === params[0] && m.external_message_id === params[1]) };
        if (text.startsWith('SELECT reply_expected_message_id')) return { rows: [] };
        if (text.startsWith('INSERT INTO conversation_messages')) {
            const row = { id: state.messages.length + 1, conversation_id: params[0], direction: 'inbound',
                sender_name: params[1], content: params[2], content_type: params[3], external_message_id: params[5], meta: JSON.parse(params[6]) };
            state.messages.push(row); return { rows: [row] };
        }
        if (text.startsWith('UPDATE conversations') && text.includes('unread_count')) {
            state.row.unread_count++; return { rows: [] };
        }
        throw new Error('Unexpected fixture query: ' + text);
    };
    mock('../db', { pool: { query, connect: async () => ({ query, release() {} }) } });
    mock('../services/omni-accounts', { getOmniAccountStatus: () => ({ connected: true, sendCapable: true }) });
    mock('../services/websocket', { broadcastBusinessEvent: (...args) => { state.events.push(args); return 1; } });
    for (const path of ['telegram', 'omni-viber', 'omni-sms', 'omni-instagram', 'omni-whatsapp', 'omni-telegram-bridge', 'replyEscalation']) {
        mock('../services/' + path, {});
    }
    mock('../services/omni-facebook', { getUserProfile: async (_id, _fields, options) => {
        assert.equal(options.businessContext, 'dar');
        assert.ok(state.committed >= 2, 'both conversation and message are committed before fetching the name');
        state.profileCalls++;
        return profileResponse;
    } });
    fresh('../services/omni-facebook-profile');
    const hub = fresh('../services/omni-hub');
    const inbound = externalMessageId => hub.processInboundMessage({
        channel: 'facebook', externalId: '456', senderName: null, content: 'Fixture message', contentType: 'text', externalMessageId,
    }, { businessContext: 'dar' });
    return { state, entries, inbound };
}

for (const existing of [false, true]) {
    test((existing ? 'existing Unknown' : 'new conversation') + ' gains its name without delaying inbound or duplicating retried messages', async () => {
        const profile = deferred();
        const h = inboundHarness(profile.promise, { existing });
        const result = await h.inbound('mid.fixture-1');
        assert.equal(result.conversation.customerName, 'Unknown');
        assert.equal(h.state.messages.length, 1);
        assert.equal(h.state.row.unread_count, 1);
        assert.equal(h.state.profileCalls, 1);
        const repeated = await h.inbound('mid.fixture-1');
        assert.equal(repeated.duplicate, true);
        assert.equal(h.state.messages.length, 1);
        assert.equal(h.state.row.unread_count, 1);
        assert.equal(h.state.profileCalls, 1);
        profile.resolve({ success: true, profile: { firstName: 'Fixture', lastName: 'Person' } });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(h.state.row.customer_name, 'Fixture Person');
        assert.equal(h.state.events.length, 3, 'two initial events plus the name refresh');
        assert.doesNotMatch(JSON.stringify(h.state.events), /Fixture Person/);
        await h.inbound('mid.fixture-2');
        assert.equal(h.state.messages.length, 2);
        assert.equal(h.state.profileCalls, 1, 'a resolved name does not cause more lookups');
    });
}

test('profile timeout leaves message acceptance and subsequent messages intact', async () => {
    const h = inboundHarness({ success: false, code: 'PROFILE_TIMEOUT' }, { existing: true });
    assert.ok((await h.inbound('mid.timeout-1')).message);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok((await h.inbound('mid.timeout-2')).message);
    assert.equal(h.state.messages.length, 2);
    assert.equal(h.state.row.customer_name, 'Unknown');
    assert.equal(h.state.profileCalls, 1);
    assert.equal(h.state.events.length, 4, 'only normal message/conversation events');
});
