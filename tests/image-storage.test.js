const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const {
    buildCatalogImageBlobFallbackHandler,
    publicCatalogImageUrl,
    uploadFromUrl,
    safeImageFilename
} = require('../services/imageStorage');

function startImageServer(buffer, options = {}) {
    const server = http.createServer((req, res) => {
        res.writeHead(options.statusCode || 200, {
            'Content-Type': options.contentType || 'image/png',
            ...(options.headers || {})
        });
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

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
        server.on('error', reject);
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
    });
}

async function request(baseUrl, routePath, options = {}) {
    const response = await fetch(`${baseUrl}${routePath}`, options);
    const body = Buffer.from(await response.arrayBuffer());
    return {
        status: response.status,
        body,
        text: body.toString('utf8'),
        headers: response.headers
    };
}

describe('imageStorage CRM upload metadata', () => {
    const tempDirs = [];
    const appServers = [];

    afterEach(async () => {
        await Promise.all(appServers.splice(0).map(({ server }) => close(server)));
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

    it('stores generated catalog images in Postgres-backed blob storage when a query client is provided', async () => {
        const image = Buffer.from('jpeg-bytes');
        const queries = [];
        const query = {
            query: async (text, params) => {
                queries.push({ text: String(text), params });
                return { rows: [], rowCount: 1 };
            }
        };
        const server = await startImageServer(image, { contentType: 'image/jpeg' });
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-catalog-images-postgres-'));
        tempDirs.push(tempDir);
        try {
            const publicUrl = await uploadFromUrl(server.url, '../catalog item.JPG', {
                query,
                localDir: tempDir,
                metadata: { source: 'unit-test' }
            });

            assert.equal(publicUrl, '/uploads/catalog-images/items/catalog-item.jpg');
            assert.equal(fs.existsSync(path.join(tempDir, 'catalog-item.jpg')), true);
            assert.equal(queries.length, 1);
            assert.match(queries[0].text, /INSERT INTO catalog_image_blobs/);
            assert.deepEqual(queries[0].params.slice(0, 4), ['catalog-item.jpg', 'image/jpeg', image, image.length]);
            assert.equal(queries[0].params[4], server.url);
            assert.equal(queries[0].params[5], JSON.stringify({ source: 'unit-test' }));
        } finally {
            await server.close();
        }
    });

    it('normalizes unsafe image filenames before writing', () => {
        assert.equal(safeImageFilename('../bad name.svg'), 'bad-name.png');
        assert.equal(safeImageFilename('cover.webp'), 'cover.webp');
    });

    it('rejects unsupported remote MIME types and oversized image downloads without writing files', async () => {
        const textServer = await startImageServer(Buffer.from('not-image'), { contentType: 'text/plain' });
        const largeServer = await startImageServer(Buffer.from('too-large-png'));
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-catalog-images-invalid-'));
        tempDirs.push(tempDir);
        try {
            const wrongMime = await uploadFromUrl(textServer.url, 'wrong-mime.png', { localDir: tempDir });
            const tooLarge = await uploadFromUrl(largeServer.url, 'too-large.png', { localDir: tempDir, maxBytes: 4 });

            assert.equal(wrongMime, null);
            assert.equal(tooLarge, null);
            assert.deepEqual(await fsp.readdir(tempDir), []);
        } finally {
            await textServer.close();
            await largeServer.close();
        }
    });

    it('serves Postgres-backed catalog image blobs under the existing upload URL', async () => {
        const blob = Buffer.from('catalog-db-image');
        const app = express();
        app.get('/uploads/catalog-images/items/:filename', buildCatalogImageBlobFallbackHandler({
            query: async (text, params) => {
                assert.match(String(text), /FROM catalog_image_blobs/);
                assert.equal(params[0], 'menu-photo.jpg');
                return {
                    rows: [{
                        filename: 'menu-photo.jpg',
                        content_type: 'image/jpeg',
                        size_bytes: blob.length,
                        data: blob
                    }],
                    rowCount: 1
                };
            }
        }));
        app.use('/uploads/catalog-images/items', (req, res) => res.status(404).json({ error: 'image_not_found' }));
        app.get('*', (req, res) => res.type('html').send('<html>fallback</html>'));

        const started = await listen(app);
        appServers.push(started);

        const res = await request(started.baseUrl, publicCatalogImageUrl('menu-photo.jpg'));
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, blob);
        assert.equal(res.headers.get('content-type'), 'image/jpeg');
        assert.equal(res.headers.get('content-length'), String(blob.length));
        assert.match(String(res.headers.get('cache-control') || ''), /immutable/);
    });

    it('returns 404 instead of SPA HTML for missing or unsafe catalog image upload URLs', async () => {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'event-genix-catalog-images-route-'));
        tempDirs.push(tempDir);
        await fsp.writeFile(path.join(tempDir, 'legacy-local.png'), Buffer.from('legacy-local-image'));

        const app = express();
        app.get('/uploads/catalog-images/items/:filename', buildCatalogImageBlobFallbackHandler({
            query: async () => ({ rows: [], rowCount: 0 })
        }));
        app.use('/uploads/catalog-images/items', express.static(tempDir));
        app.use('/uploads/catalog-images/items', (req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') return next();
            return res.status(404).json({ error: 'image_not_found' });
        });
        app.get('*', (req, res) => res.type('html').send('<html>fallback</html>'));

        const started = await listen(app);
        appServers.push(started);

        const legacy = await request(started.baseUrl, '/uploads/catalog-images/items/legacy-local.png');
        assert.equal(legacy.status, 200);
        assert.equal(legacy.text, 'legacy-local-image');

        const missing = await request(started.baseUrl, '/uploads/catalog-images/items/missing.jpg');
        assert.equal(missing.status, 404);
        assert.equal(missing.headers.get('content-type')?.startsWith('application/json'), true);
        assert.equal(missing.text.includes('<html>fallback</html>'), false);

        const traversal = await request(started.baseUrl, '/uploads/catalog-images/items/%2e%2e%2fserver.js');
        assert.equal(traversal.status, 404);
        assert.equal(traversal.text.includes('<html>fallback</html>'), false);

        const missingHead = await request(started.baseUrl, '/uploads/catalog-images/items/missing.jpg', { method: 'HEAD' });
        assert.equal(missingHead.status, 404);
        assert.equal(missingHead.body.length, 0);
    });
});
