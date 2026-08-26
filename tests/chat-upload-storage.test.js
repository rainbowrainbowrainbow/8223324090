const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const chatUploadStorage = require('../services/chatUploadStorage');

function file(overrides = {}) {
    return {
        originalname: 'photo.png',
        mimetype: 'image/png',
        size: 12,
        buffer: Buffer.from('file-bytes'),
        ...overrides
    };
}

describe('chat upload storage and file policy', () => {
    const tempDirs = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map(dir => fsp.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it('stores chat files locally with durable Postgres-ready metadata', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-chat-upload-'));
        tempDirs.push(tempDir);

        const stored = await chatUploadStorage.uploadChatFileWithFallback(file(), { channelId: 7, localDir: tempDir });

        assert.equal(stored.provider, 'local');
        assert.equal(stored.bucket, null);
        assert.equal(stored.kind, 'image');
        assert.equal(stored.contentType, 'image/png');
        assert.match(stored.key, /^channels\/7\/.+-photo\.png$/);
        assert.equal(stored.publicUrl, `/uploads/chat/${stored.key}`);
        assert.equal(fs.existsSync(stored.path), true);
        assert.equal(await fsp.readFile(stored.path, 'utf8'), 'file-bytes');
    });

    it('stores and reads chat files from Postgres when a query client is provided', async () => {
        const rows = new Map();
        const query = {
            async query(sql, params) {
                if (/INSERT INTO chat_upload_blobs/.test(sql)) {
                    rows.set(params[2], {
                        id: 1,
                        channel_id: params[0],
                        message_id: params[1],
                        storage_key: params[2],
                        original_name: params[3],
                        content_type: params[4],
                        file_size: params[5],
                        data: params[6],
                        checksum_sha256: params[7]
                    });
                    return { rowCount: 1, rows: [] };
                }
                if (/SELECT id, channel_id, message_id, storage_key/.test(sql)) {
                    const row = rows.get(params[0]);
                    return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            }
        };

        const stored = await chatUploadStorage.uploadChatFileWithFallback(file(), {
            channelId: 7,
            userId: 3,
            messageId: 11,
            query
        });
        const row = await chatUploadStorage.readChatUploadBlobByPath(query, stored.publicUrl);

        assert.equal(stored.provider, 'postgres');
        assert.equal(stored.bucket, 'chat_upload_blobs');
        assert.equal(stored.kind, 'image');
        assert.match(stored.key, /^channels\/7\/.+-photo\.png$/);
        assert.equal(stored.publicUrl, `/uploads/chat/${stored.key}`);
        assert.equal(row.channel_id, 7);
        assert.equal(row.message_id, 11);
        assert.equal(row.content_type, 'image/png');
        assert.equal(Buffer.compare(row.data, Buffer.from('file-bytes')), 0);
    });

    it('stores voice uploads under the same local upload surface', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-chat-upload-'));
        tempDirs.push(tempDir);

        const stored = await chatUploadStorage.uploadChatFileWithFallback(file({
            originalname: 'voice.webm',
            mimetype: 'audio/webm',
            buffer: Buffer.from('voice-bytes')
        }), { channelId: 7, localDir: tempDir });

        assert.equal(stored.provider, 'local');
        assert.equal(stored.kind, 'voice');
        assert.match(stored.publicUrl, /^\/uploads\/chat\/channels\/7\/.+-voice\.webm$/);
        assert.equal(fs.existsSync(stored.path), true);
        assert.equal(await fsp.readFile(stored.path, 'utf8'), 'voice-bytes');
    });

    it('rejects SVG and extension/MIME mismatches before storage', () => {
        assert.throws(
            () => chatUploadStorage.validateChatUploadFile(file({ originalname: 'bad.svg', mimetype: 'image/svg+xml' })),
            /Unsupported file type/
        );
        assert.throws(
            () => chatUploadStorage.validateChatUploadFile(file({ originalname: 'fake.png', mimetype: 'application/pdf' })),
            /MIME type do not match/
        );
        assert.equal(
            chatUploadStorage.validateChatUploadFile(file({ originalname: 'report.pdf', mimetype: 'application/pdf' })).kind,
            'file'
        );
    });

    it('deletes local chat uploads by public URL helper', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-chat-upload-delete-'));
        tempDirs.push(tempDir);
        const localFile = path.join(tempDir, 'channels', '1', 'legacy.txt');
        await fsp.mkdir(path.dirname(localFile), { recursive: true });
        await fsp.writeFile(localFile, 'legacy');

        assert.equal(chatUploadStorage.removeLegacyLocalChatFile('/uploads/chat/channels/1/legacy.txt', tempDir), true);
        assert.equal(fs.existsSync(localFile), false);
    });

    it('serves Postgres blobs before legacy local fallback and lets missing blobs fall through', async () => {
        const query = {
            async query(sql, params) {
                if (params[0] === 'channels/7/blob.png') {
                    return {
                        rows: [{
                            storage_key: params[0],
                            original_name: 'blob.png',
                            content_type: 'image/png',
                            file_size: 10,
                            data: Buffer.from('blob-bytes')
                        }]
                    };
                }
                return { rows: [] };
            }
        };
        const sent = {};
        const res = {
            setHeader(name, value) { sent[name] = value; },
            send(data) { sent.body = data; return sent; }
        };
        let nextCount = 0;
        const handler = chatUploadStorage.buildChatUploadBlobFallbackHandler(query);

        await handler({ params: { 0: 'channels/7/blob.png' } }, res, () => { nextCount++; });
        await handler({ params: { 0: 'channels/7/missing.png' } }, res, () => { nextCount++; });

        assert.equal(sent['Content-Type'], 'image/png');
        assert.equal(sent['Content-Length'], '10');
        assert.equal(Buffer.compare(sent.body, Buffer.from('blob-bytes')), 0);
        assert.equal(nextCount, 1);
    });

    it('rolls back chat message creation when transactional blob persistence fails', async () => {
        const dbId = require.resolve('../db');
        const chatServiceId = require.resolve('../services/chatService');
        const originalDb = require.cache[dbId];
        const originalStore = chatUploadStorage.storeChatUploadBlob;
        const calls = [];
        const client = {
            async query(sql, params) {
                calls.push({ sql: String(sql), params });
                if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
                if (/SELECT next_chat_seq/.test(sql)) return { rows: [{ seq: 9 }], rowCount: 1 };
                if (/INSERT INTO chat_messages/.test(sql)) {
                    return {
                        rows: [{
                            id: 77,
                            channel_id: params[0],
                            user_id: params[1],
                            seq: params[2],
                            content: params[3],
                            content_type: params[4],
                            metadata: JSON.parse(params[5])
                        }],
                        rowCount: 1
                    };
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            },
            release() {
                calls.push({ sql: 'RELEASE' });
            }
        };

        try {
            delete require.cache[chatServiceId];
            require.cache[dbId] = {
                id: dbId,
                filename: dbId,
                loaded: true,
                exports: {
                    pool: {
                        connect: async () => client,
                        query: async () => {
                            throw new Error('pool.query should not run after rollback');
                        }
                    }
                }
            };
            chatUploadStorage.storeChatUploadBlob = async () => {
                throw new Error('blob write failed');
            };
            const chat = require('../services/chatService');

            await assert.rejects(
                () => chat.sendFileMessageWithUpload(
                    3,
                    5,
                    '📎 file.txt',
                    'file',
                    { file: { url: '/uploads/chat/channels/3/file.txt' } },
                    { file: { originalname: 'file.txt', buffer: Buffer.from('x') }, storage: { provider: 'postgres' } }
                ),
                /blob write failed/
            );

            const sqlCalls = calls.map(call => call.sql);
            assert.equal(sqlCalls.includes('BEGIN'), true);
            assert.equal(sqlCalls.includes('ROLLBACK'), true);
            assert.equal(sqlCalls.includes('COMMIT'), false);
            assert.equal(sqlCalls.includes('RELEASE'), true);
            assert.equal(sqlCalls.some(sql => /UPDATE chat_channel_members/.test(sql)), false);
        } finally {
            chatUploadStorage.storeChatUploadBlob = originalStore;
            delete require.cache[chatServiceId];
            if (originalDb) require.cache[dbId] = originalDb;
            else delete require.cache[dbId];
        }
    });
});
