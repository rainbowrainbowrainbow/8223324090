const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('node:path');

const TEST_JWT_SECRET = 'chat-upload-route-secret';

let server;
let baseUrl;
let state;

const originalJwtSecret = process.env.JWT_SECRET;

function listen(app) {
    return new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => {
            resolve({ server: s, baseUrl: `http://127.0.0.1:${s.address().port}` });
        });
    });
}

function close(s) {
    return new Promise((resolve, reject) => {
        s.close(err => err ? reject(err) : resolve());
    });
}

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../routes/chat',
        '../services/chatService',
        '../services/chatUploadStorage',
        '../services/websocket',
        '../services/chat-bot',
        '../services/guardian',
        '../services/linkPreview',
        '../services/gamification'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function tokenFor(userId = 1, role = 'creator') {
    return jwt.sign(
        { id: userId, userId, username: `user-${userId}`, name: `User ${userId}`, role },
        TEST_JWT_SECRET,
        { expiresIn: '1h' }
    );
}

async function upload(pathname, filename, mimeType, content = 'file-bytes') {
    const body = new FormData();
    body.append('file', new Blob([Buffer.from(content)], { type: mimeType }), filename);
    const res = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenFor(1)}` },
        body
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
}

async function uploadWithoutAuth(pathname, filename, mimeType, content = 'file-bytes') {
    const body = new FormData();
    body.append('file', new Blob([Buffer.from(content)], { type: mimeType }), filename);
    const res = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        body
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
}

function resetState() {
    state = {
        memberships: new Set(['1:1']),
        uploads: [],
        sentFiles: [],
        broadcasts: []
    };
}

function fakeChatService() {
    return {
        isMember: async (channelId, userId) => state.memberships.has(`${channelId}:${userId}`),
        ensureDefaultMemberships: async () => {},
        updateActivityStats: async () => {},
        sendFileMessage: async (channelId, userId, content, contentType, metadata) => {
            state.sentFiles.push({ channelId, userId, content, contentType, metadata });
            return {
                message: {
                    id: 501,
                    channelId,
                    userId,
                    content,
                    contentType,
                    metadata
                },
                mentionedUserIds: []
            };
        },
        sendFileMessageWithUpload: async (channelId, userId, content, contentType, metadata, upload) => {
            state.sentFiles.push({ channelId, userId, content, contentType, metadata, upload });
            return {
                message: {
                    id: 501,
                    channelId,
                    userId,
                    content,
                    contentType,
                    metadata
                },
                mentionedUserIds: [],
                storage: upload.storage
            };
        }
    };
}

function fakeChatUploadStorage() {
    return {
        validateChatUploadFile(file) {
            const ext = path.extname(file.originalname || '').toLowerCase();
            if (ext === '.svg') {
                const err = new Error('Unsupported file type');
                err.statusCode = 400;
                throw err;
            }
            if (ext !== '.png' || file.mimetype !== 'image/png') {
                const err = new Error('File extension and MIME type do not match');
                err.statusCode = 400;
                throw err;
            }
            return { kind: 'image', contentType: 'image/png' };
        },
        prepareChatUploadBlob(file, options) {
            state.uploads.push({ originalname: file.originalname, mimetype: file.mimetype, channelId: options.channelId });
            return {
                provider: 'postgres',
                bucket: 'chat_upload_blobs',
                key: `channels/${options.channelId}/photo.png`,
                path: `channels/${options.channelId}/photo.png`,
                publicUrl: `/uploads/chat/channels/${options.channelId}/photo.png`,
                contentType: 'image/png',
                kind: 'image'
            };
        }
    };
}

describe('chat upload route storage and safety', () => {
    before(async () => {
        process.env.JWT_SECRET = TEST_JWT_SECRET;
        resetState();
        clearModules();

        const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
        installMock('../db', { pool, query: pool.query.bind(pool) });
        installMock('../services/chatService', fakeChatService());
        installMock('../services/chatUploadStorage', fakeChatUploadStorage());
        installMock('../services/websocket', {
            broadcastToChannel: (...args) => state.broadcasts.push(args),
            sendToUser: () => {},
            getOnlineUserIds: () => [],
            getLastSeen: () => null
        });
        installMock('../services/chat-bot', { processMessage: async () => null });
        installMock('../services/guardian', { preCheckMessage: async () => ({ blocked: false }) });
        installMock('../services/linkPreview', { fetchPreview: async () => null });
        installMock('../services/gamification', { spendCoins: async () => true });

        const app = express();
        app.use(express.json());
        app.use('/api/chat', require('../routes/chat'));

        ({ server, baseUrl } = await listen(app));
    });

    beforeEach(() => {
        resetState();
    });

    after(async () => {
        if (server) await close(server);
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
        clearModules();
    });

    it('stores member uploads with durable storage metadata on the chat message', async () => {
        const res = await upload('/api/chat/channels/1/upload', 'photo.png', 'image/png');

        assert.equal(res.status, 201);
        assert.equal(state.uploads.length, 1);
        assert.equal(state.uploads[0].channelId, 1);
        assert.equal(state.sentFiles.length, 1);
        assert.equal(state.sentFiles[0].metadata.file.storageProvider, 'postgres');
        assert.equal(state.sentFiles[0].metadata.file.storageBucket, 'chat_upload_blobs');
        assert.equal(state.sentFiles[0].metadata.file.storageKey, 'channels/1/photo.png');
        assert.equal(state.sentFiles[0].metadata.file.url, '/uploads/chat/channels/1/photo.png');
        assert.equal(state.sentFiles[0].upload.file.originalname, 'photo.png');
        assert.equal(state.sentFiles[0].upload.storage.provider, 'postgres');
        assert.equal(state.broadcasts[0][1], 'chat:message');
    });

    it('denies unauthenticated upload before storage is attempted', async () => {
        const res = await uploadWithoutAuth('/api/chat/channels/1/upload', 'photo.png', 'image/png');

        assert.equal(res.status, 401);
        assert.deepEqual(state.uploads, []);
        assert.deepEqual(state.sentFiles, []);
    });

    it('rejects SVG uploads before storage or message creation', async () => {
        const res = await upload('/api/chat/channels/1/upload', 'bad.svg', 'image/svg+xml', '<svg></svg>');

        assert.equal(res.status, 400);
        assert.match(res.data.error, /Unsupported file type/);
        assert.deepEqual(state.uploads, []);
        assert.deepEqual(state.sentFiles, []);
    });

    it('denies non-members before upload storage is attempted', async () => {
        const res = await upload('/api/chat/channels/99/upload', 'photo.png', 'image/png');

        assert.equal(res.status, 403);
        assert.deepEqual(state.uploads, []);
        assert.deepEqual(state.sentFiles, []);
    });
});
