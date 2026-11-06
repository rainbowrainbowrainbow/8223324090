'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');

test('catalog generation is explicit and status polling does not regenerate or apply the image', { timeout: 10000 }, async t => {
    const express = require('express');
    const saved = new Map();
    function mock(modulePath, exports) {
        const id = require.resolve(modulePath);
        saved.set(id, require.cache[id]);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    const provider = [], updates = [], uploads = [];
    mock('../db', { pool: { async query(sql, params) {
        if (/SELECT name, catalog_id FROM catalog_items/.test(sql)) {
            return { rows: [{ name: 'Synthetic item', catalog_id: 'fixture' }] };
        }
        if (/UPDATE catalog_items SET image_url/.test(sql)) {
            updates.push(params);
            return { rows: [], rowCount: 1 };
        }
        throw new Error('Unexpected synthetic catalog query');
    } } });
    mock('../services/imageStorage', {
        makeFilename: () => 'fixture.png',
        uploadFromUrl: async (url, filename) => {
            uploads.push({ url, filename });
            return '/uploads/fixture.png';
        }
    });
    mock('../services/ai-config', { callUnifiedChatCompletion: () => { throw new Error('No text AI expected'); } });
    // Exercise the actual catalog handlers with a synthetic authenticated owner.
    // Real authorization contracts are unchanged and covered by existing gates.
    mock('../middleware/auth', {
        authenticateToken(req, res, next) {
            if (req.headers.authorization !== 'Bearer fixture') return res.sendStatus(401);
            req.user = { id: 1, role: 'admin' };
            next();
        },
        requireRole: (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : res.sendStatus(403),
        requireAction: () => (req, res, next) => next()
    });
    mock('../services/legacyBusinessSurface', { requireLegacyBusinessSurface: () => (req, res, next) => next() });
    mock('../utils/logger', { createLogger: () => ({ info() {}, warn() {}, error() {} }) });
    const originalRequest = https.request;
    const previousKey = process.env.KIE_API_KEY;
    process.env.KIE_API_KEY = 'fixture-not-a-real-key';
    const routeId = require.resolve('../routes/catalogs');
    saved.set(routeId, require.cache[routeId]);
    delete require.cache[routeId];
    let polls = 0;
    https.request = (options, receive) => {
        assert.equal(options.hostname, 'api.kie.ai');
        const request = new EventEmitter();
        let body = '';
        request.setTimeout = () => request;
        request.write = chunk => { body += chunk; };
        request.destroy = () => {};
        request.end = () => queueMicrotask(() => {
            provider.push({ method: options.method, path: options.path, body: body ? JSON.parse(body) : null });
            const payload = options.method === 'POST'
                ? { code: 200, data: { taskId: 'fixture-task-1' } }
                : (++polls === 1
                    ? { code: 200, data: { state: 'generating' } }
                    : { code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://example.com/fixture.png'] }) } });
            const response = new EventEmitter();
            receive(response);
            response.emit('data', JSON.stringify(payload));
            response.emit('end');
        });
        return request;
    };
    let server;
    t.after(async () => {
        if (server) {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
        https.request = originalRequest;
        if (previousKey === undefined) delete process.env.KIE_API_KEY;
        else process.env.KIE_API_KEY = previousKey;
        for (const [id, original] of saved) {
            if (original) require.cache[id] = original;
            else delete require.cache[id];
        }
    });
    const app = express();
    app.use(express.json());
    app.use('/api/catalogs', require('../routes/catalogs'));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const origin = `http://127.0.0.1:${server.address().port}/api/catalogs`;
    async function call(path, body) {
        const response = await fetch(origin + path, {
            method: body ? 'POST' : 'GET',
            headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        assert.equal(response.status, 200);
        return response.json();
    }
    assert.equal(provider.length, 0, 'loading the catalog does not generate images');
    const unauthenticated = await fetch(origin + '/generate-image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fixture' }) });
    assert.equal(unauthenticated.status, 401);
    await unauthenticated.text();
    assert.equal(provider.length, 0);
    const created = await call('/generate-image', { name: 'Synthetic item' });
    assert.equal(created.taskId, 'fixture-task-1');
    assert.equal(provider.length, 1);
    assert.equal(provider[0].method, 'POST');
    assert.equal(provider[0].body.model, 'nano-banana-2');
    assert.equal((await call('/generate-image/fixture-task-1')).done, false);
    const ready = await call('/generate-image/fixture-task-1');
    assert.equal(ready.done, true);
    assert.equal(provider.filter(r => r.method === 'POST').length, 1, 'polling never regenerates');
    assert.deepEqual(updates, [], 'a completed provider result does not apply itself');
    assert.deepEqual(uploads, []);
    const applied = await call('/apply-image', { itemId: 7, taskId: created.taskId });
    assert.equal(applied.imageUrl, '/uploads/fixture.png');
    assert.deepEqual(updates, [['/uploads/fixture.png', 7]]);
    assert.equal(uploads.length, 1);
    assert.equal(provider.filter(r => r.method === 'POST').length, 1);
});
