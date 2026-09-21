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

function harness(t, channel, initialResponse, resolveRuntime) {
    const state = { body: initialResponse, status: 200, pending: false, responseError: false, requests: [], logs: [] };
    mock('../utils/logger', { createLogger: () => Object.fromEntries(
        ['debug', 'info', 'warn', 'error'].map(level => [level, (...args) => state.logs.push({ level, args })])
    ) });
    mock('../services/omni-accounts', { resolveOmniRuntimeConfig: resolveRuntime || (async (selectedChannel, options) => {
        assert.equal(selectedChannel, channel);
        assert.equal(options.strict, true);
        return { pageToken: 'fixture-token-' + options.businessContext, pageId: '123' };
    }) });
    t.mock.method(https, 'request', (options, callback) => {
        const request = new EventEmitter();
        const entry = { options, request, destroyCount: 0 };
        state.requests.push(entry);
        request.write = () => {};
        request.setTimeout = (ms, onTimeout) => { entry.timeout = ms; entry.onTimeout = onTimeout; return request; };
        request.destroy = error => {
            entry.destroyCount++;
            request.emit('error', error);
            request.emit('close');
        };
        request.end = () => {
            if (state.pending) return;
            queueMicrotask(() => {
                const response = new EventEmitter();
                response.statusCode = state.status;
                callback(response);
                if (state.responseError) response.emit('error', new Error('sensitive stream details'));
                else {
                    const chunks = state.chunks || [Buffer.from(typeof state.body === 'string' ? state.body : JSON.stringify(state.body))];
                    for (const chunk of chunks) response.emit('data', chunk);
                    response.emit('end');
                }
                request.emit('close');
            });
        };
        return request;
    });
    state.adapter = fresh('../services/omni-' + channel);
    state.lookup = (options = { businessContext: 'dar' }, fields) => state.adapter.getUserProfile('456', fields, options);
    return state;
}

for (const channel of ['facebook', 'instagram']) {
    test(channel + ' preserves Ukrainian names split inside UTF-8 response chunks', async t => {
        const body = channel === 'facebook'
            ? { id: '456', first_name: 'Олена', last_name: 'Коваль' }
            : { id: '456', name: 'Олена Коваль', username: 'olena.koval' };
        const h = harness(t, channel, body);
        const response = Buffer.from(JSON.stringify(body));
        const firstSplit = response.indexOf(Buffer.from('О')) + 1;
        const secondSplit = response.indexOf(Buffer.from('К')) + 1;
        h.chunks = [response.subarray(0, firstSplit), response.subarray(firstSplit, secondSplit), response.subarray(secondSplit)];
        const result = await h.lookup();
        assert.equal(result.success, true);
        const fullName = channel === 'facebook'
            ? result.profile.firstName + ' ' + result.profile.lastName
            : result.profile.name;
        assert.equal(fullName, 'Олена Коваль');
    });

    test(channel + ' profile lookup validates explicit context and scoped ID before credentials', async t => {
        let runtimeCalls = 0;
        const h = harness(t, channel, {}, async () => { runtimeCalls++; return {}; });
        for (const options of [{}, { businessContext: '' }, { businessContext: '../dar' }, { businessContext: 1 }]) {
            assert.equal((await h.lookup(options)).code, 'PROFILE_CONTEXT_REQUIRED');
        }
        for (const id of ['', 'comment:456', '456?fields=id', '5'.repeat(65)]) {
            assert.equal((await h.adapter.getUserProfile(id, undefined, { businessContext: 'dar' })).code, 'PROFILE_ID_INVALID');
        }
        assert.equal(runtimeCalls, 0);
        assert.equal(h.requests.length, 0);
    });

    test(channel + ' uses only the requested business and channel Page token', async t => {
        const contexts = [];
        const h = harness(t, channel, { id: '456', first_name: 'Fixture', last_name: 'Person', name: 'Fixture Person', username: 'fixture.person' },
            async (selectedChannel, options) => {
                assert.equal(selectedChannel, channel);
                assert.equal(options.strict, true);
                contexts.push(options.businessContext);
                return { pageToken: 'fixture-token-' + options.businessContext, pageId: '123' };
            });
        for (const businessContext of ['dar', 'event_genix']) {
            const result = await h.lookup({ businessContext });
            assert.equal(result.success, true);
            assert.equal(result.profile.id, '456');
            if (channel === 'facebook') {
                assert.equal(result.profile.firstName, 'Fixture');
                assert.equal(result.profile.lastName, 'Person');
            } else {
                assert.equal(result.profile.name, 'Fixture Person');
                assert.equal(result.profile.username, 'fixture.person');
            }
        }
        assert.deepEqual(contexts, ['dar', 'event_genix']);
        assert.deepEqual(h.requests.map(r => r.options.headers.Authorization), ['Bearer fixture-token-dar', 'Bearer fixture-token-event_genix']);
        assert.ok(h.requests.every(r => r.options.hostname === 'graph.facebook.com' && r.options.method === 'GET' && r.timeout === 3000));
        const fields = channel === 'facebook' ? 'first_name,last_name,profile_pic' : 'name,username';
        assert.ok(h.requests[0].options.path.endsWith('/456?fields=' + encodeURIComponent(fields)));
        assert.doesNotMatch(JSON.stringify(h.logs), /Fixture|fixture\.person|456|fixture-token/);
    });

    test(channel + ' fails closed for missing Page configuration or a failed strict read', async t => {
        let result = {};
        let shouldThrow = false;
        const tokenName = channel === 'facebook' ? 'FB_PAGE_TOKEN' : 'IG_PAGE_TOKEN';
        const oldToken = process.env[tokenName];
        process.env[tokenName] = 'fixture-global-token';
        try {
            const h = harness(t, channel, {}, async (_channel, options) => {
                assert.deepEqual(options, { businessContext: 'dar', strict: true });
                if (shouldThrow) throw new Error('sensitive configuration details');
                return result;
            });
            for (result of [{}, { pageToken: 'fixture-token' }, { pageId: '123' }]) {
                assert.equal((await h.lookup()).code, 'PROFILE_CONFIG_MISSING');
            }
            shouldThrow = true;
            const failure = await h.lookup();
            assert.equal(failure.code, 'PROFILE_UNAVAILABLE');
            assert.doesNotMatch(JSON.stringify([failure, h.logs]), /sensitive|fixture-global-token/);
            assert.equal(h.requests.length, 0);
        } finally {
            if (oldToken === undefined) delete process.env[tokenName];
            else process.env[tokenName] = oldToken;
        }
    });

    test(channel + ' rejects a missing or mismatched returned profile ID', async t => {
        const h = harness(t, channel, {});
        for (const body of [{}, { id: '987', name: 'Private Name' }, { id: null }, { id: 456 }]) {
            h.body = body;
            const result = await h.lookup();
            assert.equal(result.code, 'PROFILE_ID_MISMATCH');
            assert.doesNotMatch(JSON.stringify([result, h.logs]), /Private Name|987/);
        }
        h.body = { id: '456' };
        assert.deepEqual((await h.lookup()).profile.id, '456', 'identity-valid empty name remains available for the enrichment name guard');
    });

    test(channel + ' distinguishes Graph token, object, request and access failures safely', async t => {
        const h = harness(t, channel, {});
        h.status = 403;
        for (const [code, subcode, expected] of [
            [190, 0, 'PROFILE_TOKEN_INVALID'],
            [100, 33, 'PROFILE_OBJECT_UNAVAILABLE'],
            [100, 0, 'PROFILE_REQUEST_INVALID'],
            [10, 0, 'PROFILE_ACCESS_DENIED'],
            [200, 0, 'PROFILE_ACCESS_DENIED'],
        ]) {
            h.body = { error: { code, error_subcode: subcode, message: 'private-name private-token private-ID' } };
            const result = await h.lookup();
            assert.equal(result.code, expected);
            assert.doesNotMatch(JSON.stringify([result, h.logs]), /private-name|private-token|private-ID/);
        }
        h.body = 'private response body';
        assert.equal((await h.lookup()).code, 'PROFILE_ACCESS_DENIED', 'HTTP 403 without Graph JSON is still denied');
        h.status = 500;
        assert.equal((await h.lookup()).code, 'PROFILE_UNAVAILABLE');
    });

    test(channel + ' hard deadline destroys a stalled request after three seconds', async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const h = harness(t, channel, {});
        h.pending = true;
        const pending = h.lookup();
        await Promise.resolve();
        assert.equal(h.requests.length, 1);
        t.mock.timers.tick(3000);
        assert.equal((await pending).code, 'PROFILE_TIMEOUT');
        assert.equal(h.requests[0].destroyCount, 1);
    });

    test(channel + ' socket timeout and stream error are contained without provider detail', async t => {
        const h = harness(t, channel, {});
        h.pending = true;
        const pending = h.lookup();
        await Promise.resolve();
        h.requests[0].onTimeout();
        assert.equal((await pending).code, 'PROFILE_TIMEOUT');
        h.pending = false;
        h.responseError = true;
        const failure = await h.lookup();
        assert.equal(failure.code, 'PROFILE_UNAVAILABLE');
        assert.doesNotMatch(JSON.stringify([failure, h.logs]), /sensitive/);
    });

    test(channel + ' applies the profile response limit in bytes', async t => {
        const h = harness(t, channel, { id: '456', name: 'я'.repeat(32769) });
        assert.equal((await h.lookup()).code, 'PROFILE_RESPONSE_TOO_LARGE');
        assert.equal(h.requests[0].destroyCount, 1);
    });

    test(channel + ' keeps custom field sanitization and default fields when all fields are invalid', async t => {
        const h = harness(t, channel, { id: '456' });
        await h.lookup({ business_context: 'dar' }, ['name', 'invalid?token=value', null]);
        assert.ok(h.requests[0].options.path.endsWith('/456?fields=name'));
        await h.lookup({ businessContext: 'dar' }, ['bad,field']);
        const fields = channel === 'facebook' ? 'first_name,last_name,profile_pic' : 'name,username';
        assert.ok(h.requests[1].options.path.endsWith('/456?fields=' + encodeURIComponent(fields)));
    });

    test(channel + ' send requests retain the existing fifteen-second timeout', async t => {
        const h = harness(t, channel, { message_id: 'mid.fixture' }, async () => ({ pageToken: 'fixture-page-token', pageId: '123' }));
        const send = channel === 'facebook' ? h.adapter.sendFacebook : h.adapter.sendInstagram;
        assert.equal((await send('456', 'Fixture message', { businessContext: 'dar' })).success, true);
        assert.equal(h.requests[0].timeout, 15000);
        assert.equal(h.requests[0].options.method, 'POST');
    });
}

test('Instagram profile preserves username when Meta does not return a name', async t => {
    const h = harness(t, 'instagram', { id: '456', username: 'fixture.username' });
    const result = await h.lookup();
    assert.equal(result.success, true);
    assert.equal(result.profile.name, undefined);
    assert.equal(result.profile.username, 'fixture.username');
});
