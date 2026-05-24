const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const profileAvatarStorage = require('../services/profileAvatarStorage');

function file(overrides = {}) {
    return {
        originalname: 'avatar.png',
        mimetype: 'image/png',
        size: 12,
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

    it('stores profile avatars locally with durable Postgres-ready metadata', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-profile-avatar-'));
        tempDirs.push(tempDir);

        const stored = await profileAvatarStorage.uploadProfileAvatarWithFallback(file(), { username: 'Sergey', localDir: tempDir });

        assert.equal(stored.provider, 'local');
        assert.equal(stored.bucket, null);
        assert.match(stored.key, /^.+-sergey-avatar\.png$/);
        assert.match(stored.publicUrl, /^\/uploads\/profile-avatars\/.+-sergey-avatar\.png$/);
        assert.equal(stored.contentType, 'image/png');
        assert.equal(fs.existsSync(stored.path), true);
        assert.equal(await fsp.readFile(stored.path, 'utf8'), 'avatar-bytes');
    });

    it('stores webp avatars through the same local profile upload surface', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-profile-avatar-'));
        tempDirs.push(tempDir);

        const stored = await profileAvatarStorage.uploadProfileAvatarWithFallback(file({
            originalname: 'me.webp',
            mimetype: 'image/webp',
            buffer: Buffer.from('webp-bytes')
        }), { username: 'Sergey', localDir: tempDir });

        assert.equal(stored.provider, 'local');
        assert.equal(stored.contentType, 'image/webp');
        assert.match(stored.publicUrl, /^\/uploads\/profile-avatars\/.+-sergey-me\.webp$/);
        assert.equal(fs.existsSync(stored.path), true);
    });

    it('rejects SVG, non-image extensions, MIME mismatches, and oversize avatars', () => {
        assert.throws(
            () => profileAvatarStorage.validateProfileAvatarFile(file({ originalname: 'bad.svg', mimetype: 'image/svg+xml' })),
            /JPG|PNG|WebP|GIF|Рџ/
        );
        assert.throws(
            () => profileAvatarStorage.validateProfileAvatarFile(file({ originalname: 'avatar.pdf', mimetype: 'application/pdf' })),
            /JPG|PNG|WebP|GIF|Рџ/
        );
        assert.throws(
            () => profileAvatarStorage.validateProfileAvatarFile(file({ originalname: 'avatar.png', mimetype: 'image/jpeg' })),
            /extension|Рў/
        );
        assert.throws(
            () => profileAvatarStorage.validateProfileAvatarFile(file({ size: profileAvatarStorage.MAX_AVATAR_BYTES + 1 })),
            /5/
        );
    });
});
