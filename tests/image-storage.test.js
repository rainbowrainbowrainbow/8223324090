const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { uploadFromUrl, safeImageFilename } = require('../services/imageStorage');

function startImageServer(buffer) {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(buffer);
    });
    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({
                url: `http://127.0.0.1:${port}/image.png`,
                close: () => new Promise(done => server.close(done))
            });
        });
        server.on('error', reject);
    });
}

describe('imageStorage local CRM upload metadata', () => {
    const tempDirs = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map(dir => fsp.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it('stores generated catalog images under the catalog upload surface', async () => {
        const image = Buffer.from('png');
        const server = await startImageServer(image);
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-catalog-images-'));
        tempDirs.push(tempDir);
        try {
            const publicUrl = await uploadFromUrl(server.url, 'catalog-item.png', { localDir: tempDir });

            assert.equal(publicUrl, '/uploads/catalog-images/items/catalog-item.png');
            assert.equal(fs.existsSync(path.join(tempDir, 'catalog-item.png')), true);
            assert.deepEqual(await fsp.readFile(path.join(tempDir, 'catalog-item.png')), image);
        } finally {
            await server.close();
        }
    });

    it('normalizes unsafe image filenames before writing', () => {
        assert.equal(safeImageFilename('../bad name.svg'), 'bad-name.png');
        assert.equal(safeImageFilename('cover.webp'), 'cover.webp');
    });
});
