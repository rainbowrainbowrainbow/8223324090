const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function loadProfileAvatarStorageWithSupabase(supabase) {
    const storagePath = require.resolve('../services/profileAvatarStorage');
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
        profileAvatarStorage: require('../services/profileAvatarStorage'),
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
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 11,
        buffer: Buffer.from('avatar-bytes'),
        ...overrides
    };
}

describe('profile avatar storage and file policy', () => {
    const tempDirs = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map(dir => fsp.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it('uploads profile avatars to Supabase Storage with durable metadata', async () => {
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

        const { profileAvatarStorage, restore } = loadProfileAvatarStorageWithSupabase(supabase);
        try {
            const stored = await profileAvatarStorage.uploadProfileAvatarWithFallback(file(), { username: 'Sergey' });

            assert.equal(stored.provider, 'supabase');
            assert.equal(stored.bucket, 'profile-avatars');
            assert.equal(stored.contentType, 'image/png');
            assert.match(stored.key, /^users\/sergey\/.+-avatar\.png$/);
            assert.equal(stored.publicUrl, `https://example.supabase.co/storage/v1/object/public/profile-avatars/${stored.key}`);
            assert.equal(uploads.length, 1);
            assert.equal(uploads[0].options.upsert, false);
            assert.equal(uploads[0].options.contentType, 'image/png');
        } finally {
            restore();
        }
    });

    it('falls back to local profile avatar uploads when Supabase is unavailable', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-profile-avatar-'));
        tempDirs.push(tempDir);

        const { profileAvatarStorage, restore } = loadProfileAvatarStorageWithSupabase(null);
        try {
            const stored = await profileAvatarStorage.uploadProfileAvatarWithFallback(file({
                originalname: 'me.webp',
                mimetype: 'image/webp',
                buffer: Buffer.from('webp-bytes')
            }), { username: 'Sergey', localDir: tempDir });

            assert.equal(stored.provider, 'local');
            assert.equal(stored.contentType, 'image/webp');
            assert.match(stored.publicUrl, /^\/uploads\/profile-avatars\/.+-sergey-me\.webp$/);
            assert.equal(fs.existsSync(stored.path), true);
            assert.equal(await fsp.readFile(stored.path, 'utf8'), 'webp-bytes');
        } finally {
            restore();
        }
    });

    it('rejects SVG, non-image extensions, MIME mismatches, and oversize avatars', () => {
        const { profileAvatarStorage, restore } = loadProfileAvatarStorageWithSupabase(null);
        try {
            assert.throws(
                () => profileAvatarStorage.validateProfileAvatarFile(file({ originalname: 'bad.svg', mimetype: 'image/svg+xml' })),
                /JPG, PNG, WebP або GIF/
            );
            assert.throws(
                () => profileAvatarStorage.validateProfileAvatarFile(file({ originalname: 'fake.png', mimetype: 'application/pdf' })),
                /Тип файлу/
            );
            assert.throws(
                () => profileAvatarStorage.validateProfileAvatarFile(file({ size: 6 * 1024 * 1024 })),
                /до 5 МБ/
            );
            assert.equal(
                profileAvatarStorage.validateProfileAvatarFile(file({ originalname: 'self.jpg', mimetype: 'image/jpeg' })).contentType,
                'image/jpeg'
            );
        } finally {
            restore();
        }
    });
});
