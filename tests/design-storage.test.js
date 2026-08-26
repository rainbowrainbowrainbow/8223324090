const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
    DESIGN_STORAGE_PROVIDER,
    buildDesignBlobFallbackHandler,
    checksumSha256,
    designStorageKey,
    publicDesignUrl,
    safeFilename,
    storeDesignBlob
} = require('../services/designStorage');

test('design storage builds stable Postgres storage metadata', async () => {
    const queries = [];
    const query = {
        query: async (text, params) => {
            queries.push({ text: String(text), params });
            return { rows: [], rowCount: 1 };
        }
    };
    const buffer = Buffer.from('design bytes');
    const key = designStorageKey(42, 'Promo poster.png');
    const stored = await storeDesignBlob(query, 42, key, buffer);

    assert.equal(DESIGN_STORAGE_PROVIDER, 'postgres');
    assert.equal(key, 'designs/42/Promo-poster.png');
    assert.equal(stored.storageKey, key);
    assert.equal(stored.checksum, checksumSha256(buffer));
    assert.match(queries[0].text, /INSERT INTO design_file_blobs/);
    assert.deepEqual(queries[0].params, [42, key, buffer, checksumSha256(buffer)]);
});

test('design storage keeps public upload URLs compatible for previews', () => {
    assert.equal(safeFilename('../../bad name.svg'), 'bad-name.svg');
    assert.equal(publicDesignUrl('bad name.svg'), '/uploads/designs/bad-name.svg');
});

function startApp(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
        server.on('error', reject);
    });
}

test('design storage serves Postgres blobs before falling back and keeps missing assets as 404', async () => {
    const designBytes = Buffer.from('served-design');
    const query = {
        query: async (_text, params = []) => {
            if (params[0] === 'served.pdf') {
                return {
                    rows: [{
                        id: 42,
                        filename: 'served.pdf',
                        original_name: 'served.pdf',
                        mime_type: 'application/pdf',
                        storage_key: 'designs/42/served.pdf',
                        data: designBytes,
                        checksum_sha256: checksumSha256(designBytes),
                        blob_storage_key: 'designs/42/served.pdf'
                    }],
                    rowCount: 1
                };
            }
            return { rows: [], rowCount: 0 };
        }
    };
    const app = express();
    app.get('/uploads/designs/:filename', buildDesignBlobFallbackHandler(query));
    app.head('/uploads/designs/:filename', buildDesignBlobFallbackHandler(query));
    app.use('/uploads/designs', (_req, res) => res.status(404).json({ error: 'design_upload_not_found' }));
    const started = await startApp(app);
    try {
        const served = await fetch(`${started.baseUrl}/uploads/designs/served.pdf`);
        assert.equal(served.status, 200);
        assert.equal(served.headers.get('content-type'), 'application/pdf');
        assert.equal(await served.text(), 'served-design');

        const missing = await fetch(`${started.baseUrl}/uploads/designs/missing.pdf`);
        assert.equal(missing.status, 404);
        assert.equal(await missing.text(), '{"error":"design_upload_not_found"}');

        const missingHead = await fetch(`${started.baseUrl}/uploads/designs/missing.pdf`, { method: 'HEAD' });
        assert.equal(missingHead.status, 404);
    } finally {
        await new Promise((resolve, reject) => started.server.close(err => err ? reject(err) : resolve()));
    }
});
