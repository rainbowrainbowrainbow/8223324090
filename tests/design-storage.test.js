const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DESIGN_STORAGE_PROVIDER,
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
