const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const audioStorage = require('../services/audioStorage');

describe('audioStorage local CRM upload metadata', () => {
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

    it('returns null for empty audio buffers', async () => {
        const uploaded = await audioStorage.uploadAudioBufferWithMetadata(Buffer.alloc(0), 'manual-test.mp3');
        assert.equal(uploaded, null);
    });

    it('deletes local audio objects by storage key', async () => {
        const localPath = path.join(__dirname, '..', 'uploads', 'sounds', 'sounds', 'manual', 'delete-test.mp3');
        await fsp.mkdir(path.dirname(localPath), { recursive: true });
        await fsp.writeFile(localPath, 'delete-me');

        assert.equal(await audioStorage.removeAudioObject('sounds/manual/delete-test.mp3'), true);
        assert.equal(fs.existsSync(localPath), false);
    });
});
