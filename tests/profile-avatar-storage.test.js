const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
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
        server.close(err => (err ? reject(err) : resolve()));
    });
}

async function request(baseUrl, routePath) {
    const response = await fetch(`${baseUrl}${routePath}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
        status: response.status,
        body: bytes,
        headers: response.headers
    };
}

describe('profile avatar storage and file policy', () => {
    const tempDirs = [];
    const servers = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map(({ server }) => close(server)));
        await Promise.all(tempDirs.map(dir => fsp.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it('stores profile avatars in Postgres when a query client is provided', async () => {
        const queries = [];
        const upload = file();
        const query = {
            query: async (text, params) => {
                queries.push({ text: String(text), params });
                return { rows: [], rowCount: 1 };
            }
        };

        const stored = await profileAvatarStorage.uploadProfileAvatarWithFallback(upload, {
            username: 'Sergey',
            query
        });

        assert.equal(stored.provider, 'postgres');
        assert.equal(stored.bucket, 'profile_avatar_blobs');
        assert.match(stored.key, /^users\/sergey\/.+-avatar\.png$/);
        assert.match(stored.publicUrl, /^\/uploads\/profile-avatars\/users\/sergey\/.+-avatar\.png$/);
        assert.equal(stored.contentType, 'image/png');
        assert.equal(stored.checksum, profileAvatarStorage.checksumSha256(upload.buffer));
        assert.match(queries[0].text, /INSERT INTO profile_avatar_blobs/);
        assert.equal(queries[0].params[0], 'Sergey');
        assert.equal(queries[0].params[1], stored.key);
        assert.equal(queries[0].params[2], 'avatar.png');
        assert.equal(queries[0].params[3], 'image/png');
        assert.equal(queries[0].params[4], upload.size);
        assert.deepEqual(queries[0].params[5], upload.buffer);
        assert.equal(queries[0].params[6], stored.checksum);
    });

    it('keeps local fallback for legacy or dev-only avatar writes', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-profile-avatar-'));
        tempDirs.push(tempDir);

        const stored = await profileAvatarStorage.uploadProfileAvatarWithFallback(file({
            originalname: 'me.webp',
            mimetype: 'image/webp',
            buffer: Buffer.from('webp-bytes')
        }), {
            username: 'Sergey',
            localDir: tempDir
        });

        assert.equal(stored.provider, 'local');
        assert.equal(stored.contentType, 'image/webp');
        assert.match(stored.publicUrl, /^\/uploads\/profile-avatars\/.+-sergey-me\.webp$/);
        assert.equal(fs.existsSync(stored.path), true);
    });

    it('serves Postgres-backed avatar blobs under the legacy public upload path', async () => {
        const storageKey = 'users/sergey/1700000000000-avatar.png';
        const blob = Buffer.from('avatar-db-bytes');
        const app = express();
        app.get('/uploads/profile-avatars/*', profileAvatarStorage.buildProfileAvatarBlobFallbackHandler({
            query: async (text, params) => {
                assert.match(String(text), /FROM profile_avatar_blobs/);
                assert.equal(params[0], storageKey);
                return {
                    rows: [{
                        id: 1,
                        username: 'Sergey',
                        storage_key: storageKey,
                        original_name: 'avatar.png',
                        content_type: 'image/png',
                        file_size: blob.length,
                        data: blob,
                        checksum_sha256: 'sum'
                    }],
                    rowCount: 1
                };
            }
        }));
        app.get('/uploads/profile-avatars/*', (req, res) => res.status(404).send('fallback'));

        const started = await listen(app);
        servers.push(started);

        const res = await request(started.baseUrl, profileAvatarStorage.publicProfileAvatarUrl(storageKey));
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, blob);
        assert.equal(res.headers.get('content-type'), 'image/png');
        assert.equal(res.headers.get('content-length'), String(blob.length));
        assert.match(String(res.headers.get('content-disposition') || ''), /^inline;/);
        assert.match(String(res.headers.get('cache-control') || ''), /max-age=300/);
    });

    it('falls through to legacy static handling when no Postgres avatar blob exists', async () => {
        const app = express();
        app.get('/uploads/profile-avatars/*', profileAvatarStorage.buildProfileAvatarBlobFallbackHandler({
            query: async () => ({ rows: [], rowCount: 0 })
        }));
        app.get('/uploads/profile-avatars/*', (req, res) => res.status(204).set('x-avatar-fallback', 'legacy').end());

        const started = await listen(app);
        servers.push(started);

        const res = await request(started.baseUrl, '/uploads/profile-avatars/legacy-avatar.png');
        assert.equal(res.status, 204);
        assert.equal(res.headers.get('x-avatar-fallback'), 'legacy');
    });

    it('rejects SVG, non-image extensions, MIME mismatches, and oversize avatars', () => {
        assert.throws(
            () => profileAvatarStorage.validateProfileAvatarFile(file({ originalname: 'bad.svg', mimetype: 'image/svg+xml' })),
            /JPG|PNG|WebP|GIF|Підтрим/
        );
        assert.throws(
            () => profileAvatarStorage.validateProfileAvatarFile(file({ originalname: 'avatar.pdf', mimetype: 'application/pdf' })),
            /JPG|PNG|WebP|GIF|Підтрим/
        );
        assert.throws(
            () => profileAvatarStorage.validateProfileAvatarFile(file({ originalname: 'avatar.png', mimetype: 'image/jpeg' })),
            /Тип|extension/
        );
        assert.throws(
            () => profileAvatarStorage.validateProfileAvatarFile(file({ size: profileAvatarStorage.MAX_AVATAR_BYTES + 1 })),
            /5/
        );
    });
});
