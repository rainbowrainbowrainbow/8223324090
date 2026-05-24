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
});
