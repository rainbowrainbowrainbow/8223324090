const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const routePath = require.resolve('../routes/music');
const dbPath = require.resolve('../db');
const authPath = require.resolve('../middleware/auth');

let previousRoute = null;
let previousDb = null;
let previousAuth = null;

function rememberCache() {
    previousRoute = require.cache[routePath];
    previousDb = require.cache[dbPath];
    previousAuth = require.cache[authPath];
}

function restoreCache() {
    if (previousRoute) require.cache[routePath] = previousRoute;
    else delete require.cache[routePath];
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousAuth) require.cache[authPath] = previousAuth;
    else delete require.cache[authPath];
}

function installAuthMock({ authenticated = true } = {}) {
    require.cache[authPath] = {
        id: authPath,
        filename: authPath,
        loaded: true,
        exports: {
            authenticateToken: (req, res, next) => {
                if (!authenticated) return res.status(401).json({ error: 'Unauthorized' });
                req.user = { id: 501, username: 'sound-route-test', role: 'manager' };
                return next();
            },
            requireRole: () => (req, res, next) => next()
        }
    };
}

function installDbMock({ failBlob = false } = {}) {
    const queries = [];
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (/INSERT INTO sounds/i.test(text)) {
                return { rows: [{ id: 8101 }], rowCount: 1 };
            }
            if (/INSERT INTO sound_upload_blobs/i.test(text)) {
                if (failBlob) throw new Error('simulated sound blob failure');
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected SQL: ${text}`);
        },
        release() {}
    };
    require.cache[dbPath] = {
        id: dbPath,
        filename: dbPath,
        loaded: true,
        exports: {
            pool: {
                async connect() {
                    return client;
                },
                async query(sql, params = []) {
                    return client.query(sql, params);
                }
            }
        }
    };
    return queries;
}

async function startMusicApp() {
    delete require.cache[routePath];
    const route = require('../routes/music');
    const app = express();
    app.use('/api/music', route);
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
        server.on('error', reject);
    });
}

describe('music upload route Postgres durability', () => {
    afterEach(() => {
        restoreCache();
    });

    it('rolls back sound metadata when Postgres blob storage fails', async () => {
        rememberCache();
        installAuthMock();
        const queries = installDbMock({ failBlob: true });
        const started = await startMusicApp();
        try {
            const form = new FormData();
            form.append('name', 'Rollback proof');
            form.append('category', 'effects');
            form.append('file', new Blob([Buffer.from('route-audio')], { type: 'audio/mpeg' }), 'rollback-proof.mp3');

            const res = await fetch(`${started.baseUrl}/api/music/library/upload`, {
                method: 'POST',
                body: form
            });

            assert.equal(res.status, 500);
            assert.ok(queries.some(q => /^BEGIN$/i.test(q.text)), 'upload starts a DB transaction');
            assert.ok(queries.some(q => /^ROLLBACK$/i.test(q.text)), 'blob failure rolls back the sound row');
            assert.equal(queries.some(q => /^COMMIT$/i.test(q.text)), false, 'blob failure does not commit sound metadata');
        } finally {
            await new Promise((resolve, reject) => started.server.close(err => err ? reject(err) : resolve()));
        }
    });

    it('rejects unauthenticated upload before DB or blob storage access', async () => {
        rememberCache();
        installAuthMock({ authenticated: false });
        const queries = installDbMock();
        const started = await startMusicApp();
        try {
            const form = new FormData();
            form.append('file', new Blob([Buffer.from('route-audio')], { type: 'audio/mpeg' }), 'auth-proof.mp3');

            const res = await fetch(`${started.baseUrl}/api/music/library/upload`, {
                method: 'POST',
                body: form
            });

            assert.equal(res.status, 401);
            assert.equal(queries.length, 0);
        } finally {
            await new Promise((resolve, reject) => started.server.close(err => err ? reject(err) : resolve()));
        }
    });
});
