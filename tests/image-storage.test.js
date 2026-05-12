const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

function loadImageStorageWithSupabase(supabase) {
    const imageStoragePath = require.resolve('../services/imageStorage');
    const supabasePath = require.resolve('../db/supabase');
    const previousImageStorage = require.cache[imageStoragePath];
    const previousSupabase = require.cache[supabasePath];

    delete require.cache[imageStoragePath];
    require.cache[supabasePath] = {
        id: supabasePath,
        filename: supabasePath,
        loaded: true,
        exports: { getSupabase: () => supabase }
    };

    const imageStorage = require('../services/imageStorage');
    return {
        imageStorage,
        restore() {
            if (previousImageStorage) require.cache[imageStoragePath] = previousImageStorage;
            else delete require.cache[imageStoragePath];
            if (previousSupabase) require.cache[supabasePath] = previousSupabase;
            else delete require.cache[supabasePath];
        }
    };
}

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

describe('imageStorage Supabase metadata', () => {
    it('uploads generated catalog images to the catalog-images bucket', async () => {
        const uploads = [];
        const image = Buffer.from('png');
        const server = await startImageServer(image);
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
                    return { data: {}, error: null };
                }
            }
        };
        const { imageStorage, restore } = loadImageStorageWithSupabase(supabase);
        try {
            const publicUrl = await imageStorage.uploadFromUrl(server.url, 'catalog-item.png');
            assert.equal(publicUrl, 'https://example.supabase.co/storage/v1/object/public/catalog-images/items/catalog-item.png');
            assert.equal(uploads.length, 1);
            assert.equal(uploads[0].bucket, 'catalog-images');
            assert.equal(uploads[0].storagePath, 'items/catalog-item.png');
            assert.deepEqual(uploads[0].buffer, image);
            assert.equal(uploads[0].options.contentType, 'image/png');
            assert.equal(uploads[0].options.upsert, true);
        } finally {
            restore();
            await server.close();
        }
    });

    it('returns null without Supabase so callers can keep the source URL', async () => {
        const { imageStorage, restore } = loadImageStorageWithSupabase(null);
        try {
            const publicUrl = await imageStorage.uploadFromUrl('http://127.0.0.1/not-called.png', 'catalog-item.png');
            assert.equal(publicUrl, null);
        } finally {
            restore();
        }
    });
});
