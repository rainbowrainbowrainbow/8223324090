const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function loadChatUploadStorageWithSupabase(supabase) {
    const storagePath = require.resolve('../services/chatUploadStorage');
    const supabasePath = require.resolve('../db/supabase');
    const previousStorage = require.cache[storagePath];
    const previousSupabase = require.cache[supabasePath];

    delete require.cache[storagePath];
    require.cache[supabasePath] = {
        id: supabasePath,
        filename: supabasePath,
        loaded: true,
        exports: { getSupabase: () => supabase }
    };

    return {
        chatUploadStorage: require('../services/chatUploadStorage'),
        restore() {
            delete require.cache[storagePath];
            if (previousStorage) require.cache[storagePath] = previousStorage;
            if (previousSupabase) require.cache[supabasePath] = previousSupabase;
            else delete require.cache[supabasePath];
        }
    };
}

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

    it('uploads chat files to Supabase Storage with durable metadata', async () => {
        const uploads = [];
        const supabase = {
            storage: {
                from(bucket) {
                    return {
                        async upload(storagePath, buffer, options) {
                            uploads.push({ bucket, storagePath, buffer, options });
                            return { data: { path: storagePath }, error: null };
                        },
                        getPublicUrl(storagePath) {
                            return { data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${storagePath}` } };
                        }
                    };
                },
                async createBucket() {
                    throw new Error('bucket should already exist');
                }
            }
        };

        const { chatUploadStorage, restore } = loadChatUploadStorageWithSupabase(supabase);
        try {
            const stored = await chatUploadStorage.uploadChatFileWithFallback(file(), { channelId: 7 });

            assert.equal(stored.provider, 'supabase');
            assert.equal(stored.bucket, 'chat-uploads');
            assert.equal(stored.kind, 'image');
            assert.equal(stored.contentType, 'image/png');
            assert.match(stored.key, /^channels\/7\/.+-photo\.png$/);
            assert.equal(stored.publicUrl, `https://example.supabase.co/storage/v1/object/public/chat-uploads/${stored.key}`);
            assert.equal(uploads.length, 1);
            assert.equal(uploads[0].options.upsert, false);
            assert.equal(uploads[0].options.contentType, 'image/png');
        } finally {
            restore();
        }
    });

    it('falls back to legacy local chat uploads when Supabase is unavailable', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-chat-upload-'));
        tempDirs.push(tempDir);

        const { chatUploadStorage, restore } = loadChatUploadStorageWithSupabase(null);
        try {
            const stored = await chatUploadStorage.uploadChatFileWithFallback(file({
                originalname: 'voice.webm',
                mimetype: 'audio/webm',
                buffer: Buffer.from('voice-bytes')
            }), { channelId: 7, localDir: tempDir });

            assert.equal(stored.provider, 'local');
            assert.equal(stored.kind, 'voice');
            assert.match(stored.publicUrl, /^\/uploads\/chat\/.+-voice\.webm$/);
            assert.equal(fs.existsSync(stored.path), true);
            assert.equal(await fsp.readFile(stored.path, 'utf8'), 'voice-bytes');
        } finally {
            restore();
        }
    });

    it('rejects SVG and extension/MIME mismatches before storage', () => {
        const { chatUploadStorage, restore } = loadChatUploadStorageWithSupabase(null);
        try {
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
        } finally {
            restore();
        }
    });

    it('deletes Supabase chat objects and legacy local chat files', async () => {
        const removed = [];
        const supabase = {
            storage: {
                from(bucket) {
                    return {
                        async remove(paths) {
                            removed.push({ bucket, paths });
                            return { error: null };
                        }
                    };
                }
            }
        };
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-chat-upload-delete-'));
        tempDirs.push(tempDir);
        const localFile = path.join(tempDir, 'legacy.txt');
        await fsp.writeFile(localFile, 'legacy');

        const { chatUploadStorage, restore } = loadChatUploadStorageWithSupabase(supabase);
        try {
            assert.equal(await chatUploadStorage.removeChatUploadObject('channels/1/file.png', 'chat-uploads'), true);
            assert.deepEqual(removed, [{ bucket: 'chat-uploads', paths: ['channels/1/file.png'] }]);

            assert.equal(chatUploadStorage.removeLegacyLocalChatFile('/uploads/chat/legacy.txt', tempDir), true);
            assert.equal(fs.existsSync(localFile), false);
        } finally {
            restore();
        }
    });
});
