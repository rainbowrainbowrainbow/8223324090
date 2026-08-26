const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const audioStorage = require('../services/audioStorage');

function createFakeSoundBlobQuery() {
    const blobs = new Map();
    const queries = [];
    return {
        blobs,
        queries,
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (/INSERT INTO sound_upload_blobs/i.test(text)) {
                const [soundId, storageKey, originalName, contentType, fileSize, data, checksum, uploadedBy] = params;
                blobs.set(storageKey, {
                    id: blobs.size + 1,
                    sound_id: soundId,
                    storage_key: storageKey,
                    original_name: originalName,
                    content_type: contentType,
                    file_size: fileSize,
                    data,
                    checksum_sha256: checksum,
                    created_by_username: uploadedBy
                });
                return { rows: [], rowCount: 1 };
            }
            if (/SELECT id, sound_id, storage_key, original_name, content_type, file_size, data, checksum_sha256/i.test(text)) {
                const row = blobs.get(String(params[0]));
                return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
            }
            if (/DELETE FROM sound_upload_blobs/i.test(text)) {
                const existed = blobs.delete(String(params[0]));
                return { rows: [], rowCount: existed ? 1 : 0 };
            }
            throw new Error(`Unexpected SQL in fake sound blob query: ${text}`);
        }
    };
}

function startApp(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${server.address().port}`
            });
        });
        server.on('error', reject);
    });
}

async function request(baseUrl, pathname) {
    const res = await fetch(`${baseUrl}${pathname}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
        status: res.status,
        headers: res.headers,
        text: buffer.toString('utf8'),
        buffer
    };
}

describe('audioStorage CRM upload metadata', () => {
    const tempDirs = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map(dir => fsp.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it('stores manual audio buffers with explicit local metadata', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-audio-'));
        tempDirs.push(tempDir);

        const uploaded = await audioStorage.uploadAudioBufferWithMetadata(
            Buffer.from('audio-bytes'),
            'manual-test.mp3',
            { contentType: 'audio/mpeg', folder: 'sounds/manual', localDir: tempDir }
        );

        assert.equal(uploaded.provider, 'local');
        assert.equal(uploaded.bucket, null);
        assert.equal(uploaded.path, 'sounds/manual/manual-test.mp3');
        assert.equal(uploaded.publicUrl, '/uploads/sounds/sounds/manual/manual-test.mp3');
        assert.equal(uploaded.contentType, 'audio/mpeg');
        assert.equal(fs.existsSync(path.join(tempDir, 'sounds', 'manual', 'manual-test.mp3')), true);
        assert.equal(await fsp.readFile(path.join(tempDir, 'sounds', 'manual', 'manual-test.mp3'), 'utf8'), 'audio-bytes');
    });

    it('stores manual audio buffers in Postgres when a query client is provided', async () => {
        const fake = createFakeSoundBlobQuery();
        const uploaded = await audioStorage.uploadAudioBufferWithMetadata(
            Buffer.from('postgres-audio-bytes'),
            'manual-test.mp3',
            { contentType: 'audio/mpeg', folder: 'sounds/manual', query: fake, soundId: 42, uploadedBy: 'route-smoke' }
        );

        assert.equal(uploaded.provider, 'postgres');
        assert.equal(uploaded.bucket, 'sound_upload_blobs');
        assert.equal(uploaded.path, 'sounds/manual/manual-test.mp3');
        assert.equal(uploaded.publicUrl, '/uploads/sounds/sounds/manual/manual-test.mp3');
        assert.equal(uploaded.contentType, 'audio/mpeg');
        assert.equal(fake.blobs.size, 1);
        assert.equal(fake.blobs.get(uploaded.key).sound_id, 42);
        assert.deepEqual(fake.blobs.get(uploaded.key).data, Buffer.from('postgres-audio-bytes'));
    });

    it('returns null for empty audio buffers', async () => {
        const uploaded = await audioStorage.uploadAudioBufferWithMetadata(Buffer.alloc(0), 'manual-test.mp3');
        assert.equal(uploaded, null);
    });

    it('returns null for oversize audio buffers before storage', async () => {
        const fake = createFakeSoundBlobQuery();
        const uploaded = await audioStorage.uploadAudioBufferWithMetadata(Buffer.from('12345'), 'too-large.mp3', {
            query: fake,
            maxBytes: 4
        });
        assert.equal(uploaded, null);
        assert.equal(fake.queries.length, 0);
    });

    it('stores downloaded generated audio with explicit metadata', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-audio-url-'));
        tempDirs.push(tempDir);
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
            res.end('generated-audio');
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

        try {
            const uploaded = await audioStorage.uploadAudioFromUrlWithMetadata(
                `http://127.0.0.1:${server.address().port}/track.mp3`,
                'generated-test.mp3',
                { folder: 'sounds/generated', localDir: tempDir }
            );

            assert.equal(uploaded.provider, 'local');
            assert.equal(uploaded.path, 'sounds/generated/generated-test.mp3');
            assert.equal(uploaded.publicUrl, '/uploads/sounds/sounds/generated/generated-test.mp3');
            assert.equal(await fsp.readFile(path.join(tempDir, 'sounds', 'generated', 'generated-test.mp3'), 'utf8'), 'generated-audio');
        } finally {
            await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
        }
    });

    it('serves Postgres-backed sound blobs before falling back to legacy local files', async () => {
        const fake = createFakeSoundBlobQuery();
        const stored = await audioStorage.uploadAudioBufferWithMetadata(
            Buffer.from('served-audio'),
            'served.mp3',
            { contentType: 'audio/mpeg', folder: 'sounds/generated', query: fake, soundId: 7 }
        );
        const app = express();
        app.get('/uploads/sounds/*', audioStorage.buildSoundUploadBlobFallbackHandler(fake));
        app.get('/uploads/sounds/*', (req, res) => res.status(204).set('x-sound-fallback', 'legacy').end());
        const started = await startApp(app);
        try {
            const served = await request(started.baseUrl, stored.publicUrl);
            assert.equal(served.status, 200);
            assert.equal(served.text, 'served-audio');
            assert.equal(served.headers.get('content-type'), 'audio/mpeg');

            const missing = await request(started.baseUrl, '/uploads/sounds/sounds/generated/missing.mp3');
            assert.equal(missing.status, 204);
            assert.equal(missing.headers.get('x-sound-fallback'), 'legacy');
        } finally {
            await new Promise((resolve, reject) => started.server.close(err => err ? reject(err) : resolve()));
        }
    });

    it('supports stable missing-asset 404 after Postgres and local fallback miss', async () => {
        const fake = createFakeSoundBlobQuery();
        const app = express();
        app.get('/uploads/sounds/*', audioStorage.buildSoundUploadBlobFallbackHandler(fake));
        app.get('/uploads/sounds/*', (req, res) => res.status(404).json({ error: 'sound_upload_not_found' }));
        const started = await startApp(app);
        try {
            const missing = await request(started.baseUrl, '/uploads/sounds/sounds/manual/missing.mp3');
            assert.equal(missing.status, 404);
            assert.equal(missing.text, '{"error":"sound_upload_not_found"}');
        } finally {
            await new Promise((resolve, reject) => started.server.close(err => err ? reject(err) : resolve()));
        }
    });

    it('deletes local audio objects by storage key', async () => {
        const localPath = path.join(__dirname, '..', 'uploads', 'sounds', 'sounds', 'manual', 'delete-test.mp3');
        await fsp.mkdir(path.dirname(localPath), { recursive: true });
        await fsp.writeFile(localPath, 'delete-me');

        assert.equal(await audioStorage.removeAudioObject('sounds/manual/delete-test.mp3'), true);
        assert.equal(fs.existsSync(localPath), false);
    });

    it('deletes Postgres audio objects before using local fallback', async () => {
        const fake = createFakeSoundBlobQuery();
        const stored = await audioStorage.uploadAudioBufferWithMetadata(Buffer.from('delete-pg'), 'delete-pg.mp3', {
            query: fake,
            folder: 'sounds/manual',
            soundId: 99
        });

        assert.equal(await audioStorage.removeAudioObject(stored.key, { query: fake }), true);
        assert.equal(fake.blobs.has(stored.key), false);
    });
});
