const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
    HERMES_INTEGRATION_ID,
    createHermesMutationGuard
} = require('../services/hermesMutationGuard');

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

async function request(baseUrl, method, path, body, headers = {}) {
    const reqHeaders = { ...headers };
    if (body !== undefined && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, text };
}

describe('Hermes mutation guard', () => {
    let server;
    let baseUrl;

    before(async () => {
        const app = express();
        app.use(express.json());
        app.post('/mutation', createHermesMutationGuard(), (req, res) => {
            res.json({
                success: true,
                mutation: req.hermesMutation,
                integration: req.integration
            });
        });
        app.post('/strict-mutation', createHermesMutationGuard({ requireIntegrationId: true }), (req, res) => {
            res.json({ success: true });
        });
        ({ server, baseUrl } = await listen(app));
    });

    after(async () => {
        await close(server);
    });

    it('rejects mutations without explicit Hermes confirmation header', async () => {
        const res = await request(baseUrl, 'POST', '/mutation', {
            userSaid: 'yes, do it'
        }, {
            'Idempotency-Key': 'mutation-1'
        });

        assert.equal(res.status, 400);
        assert.equal(res.data.code, 'HERMES_CONFIRMATION_REQUIRED');
    });

    it('rejects mutations without idempotency key', async () => {
        const res = await request(baseUrl, 'POST', '/mutation', {}, {
            'X-Hermes-User-Confirmed': 'true'
        });

        assert.equal(res.status, 400);
        assert.equal(res.data.code, 'IDEMPOTENCY_KEY_REQUIRED');
    });

    it('rejects mutations with wrong integration id', async () => {
        const res = await request(baseUrl, 'POST', '/mutation', {}, {
            'Idempotency-Key': 'mutation-2',
            'X-Hermes-User-Confirmed': 'true',
            'X-Integration-Id': 'wrong-integration'
        });

        assert.equal(res.status, 400);
        assert.equal(res.data.code, 'HERMES_INTEGRATION_ID_INVALID');
    });

    it('can require the integration id header for higher-risk mutations', async () => {
        const res = await request(baseUrl, 'POST', '/strict-mutation', {}, {
            'Idempotency-Key': 'mutation-strict-1',
            'X-Hermes-User-Confirmed': 'true'
        });

        assert.equal(res.status, 400);
        assert.equal(res.data.code, 'HERMES_INTEGRATION_ID_REQUIRED');
    });

    it('attaches Hermes mutation metadata when required safety headers are present', async () => {
        const res = await request(baseUrl, 'POST', '/mutation', {}, {
            'Idempotency-Key': 'mutation-3',
            'X-Hermes-User-Confirmed': 'true',
            'X-Integration-Id': HERMES_INTEGRATION_ID
        });

        assert.equal(res.status, 200, JSON.stringify(res.data));
        assert.deepEqual(res.data.mutation, {
            sourceSurface: 'hermes',
            source: HERMES_INTEGRATION_ID,
            idempotencyKey: 'mutation-3'
        });
        assert.equal(res.data.integration.id, HERMES_INTEGRATION_ID);
        assert.equal(res.data.integration.source, 'hermes');
        assert.deepEqual(res.data.integration.mutation, res.data.mutation);
    });
});
