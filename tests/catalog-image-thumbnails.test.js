'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const express = require('express');
const sharp = require('sharp');
const { createCatalogThumbnailer, buildCatalogImageThumbnailHandler } = require('../services/catalogImageThumbnails');
const digest = data => createHash('sha256').update(data).digest('hex');
async function cache(t) {
    const root = path.resolve(os.tmpdir());
    const directory = await fs.mkdtemp(path.join(root, 'eg-thumb-test-'));
    assert.ok(path.resolve(directory).startsWith(root + path.sep));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}
async function png(color = '#096daa') {
    return sharp({ create: { width: 1254, height: 1000, channels: 3, background: color } }).png().toBuffer();
}
test('actual short-lived codec preserves original, resizes without cropping, caches across instances', async t => {
    const cacheDir = await cache(t), original = await png(), before = digest(original), stats = [];
    const readOriginal = async () => ({ data: original, content_type: 'image/png' });
    const first = createCatalogThumbnailer({ cacheDir, readOriginal, onStats: value => stats.push(value) });
    const small = await first.get('dish.png', 384);
    const metadata = await sharp(small.data).metadata();
    assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 384); assert.equal(metadata.height, 306);
    assert.equal(digest(original), before); assert.equal(stats.length, 1);
    const second = createCatalogThumbnailer({ cacheDir, readOriginal, encode: () => { throw new Error('Cache must survive instance recreation'); } });
    assert.deepEqual((await second.get('dish.png', 384)).data, small.data);
    assert.equal((await first.get('dish.png', 768)).etag === small.etag, false);
    assert.equal(stats.length, 2);
});
test('queue shares duplicate reads, serializes different work and refuses overload before fetching blobs', async t => {
    const cacheDir = await cache(t), original = await png();
    const encoded = await sharp(original).resize(384).webp().toBuffer();
    let reads = 0, calls = 0, active = 0, peak = 0, release;
    const waiting = new Promise(resolve => { release = resolve; });
    const thumbnails = createCatalogThumbnailer({ cacheDir, maxQueued: 2,
        readOriginal: async () => { reads++; return { data: original, content_type: 'image/png' }; },
        encode: async () => { calls++; active++; peak = Math.max(peak, active); await waiting; active--; return encoded; } });
    const duplicates = Array.from({ length: 20 }, () => thumbnails.get('one.png', 384));
    const other = thumbnails.get('two.png', 768);
    await assert.rejects(thumbnails.get('three.png', 384), { code: 'THUMBNAIL_BUSY' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 1); release();
    const results = await Promise.all([...duplicates, other]);
    assert.equal(reads, 2); assert.equal(calls, 2); assert.equal(peak, 1);
    assert.equal(new Set(results.slice(0, 20).map(result => result.etag)).size, 1);
});
test('source changes invalidate a derivative while failed or oversized sources remain recoverable', async t => {
    const cacheDir = await cache(t);
    let source = await png(), readCalls = 0;
    const thumbnails = createCatalogThumbnailer({ cacheDir, readOriginal: async () => { readCalls++; return { data: source, content_type: 'image/png' }; } });
    const a = await thumbnails.get('dish.png', 384);
    source = await png('#ffcc22');
    assert.notEqual((await thumbnails.get('dish.png', 384)).etag, a.etag);
    source = Buffer.from('Not an image');
    await assert.rejects(thumbnails.get('dish.png', 384), { code: 'THUMBNAIL_UNSUPPORTED' });
    source = Buffer.alloc(12 * 1024 * 1024 + 1);
    await assert.rejects(thumbnails.get('dish.png', 384), { code: 'THUMBNAIL_UNSUPPORTED' });
    const before = readCalls;
    await assert.rejects(thumbnails.get('../secret.png', 384), { code: 'THUMBNAIL_NOT_FOUND' });
    await assert.rejects(thumbnails.get('dish.png', 9000), { code: 'THUMBNAIL_NOT_FOUND' });
    assert.equal(readCalls, before);
    source = await png();
    assert.deepEqual((await thumbnails.get('dish.png', 384)).data, a.data);
});
test('disk bound evicts only owned cache files and never originals or unrelated files', async t => {
    const cacheDir = await cache(t);
    await fs.writeFile(path.join(cacheDir, 'keep.txt'), 'Unrelated file');
    const encoded = await sharp(await png()).resize(16).webp().toBuffer();
    const thumbnails = createCatalogThumbnailer({ cacheDir, maxCacheFiles: 2,
        readOriginal: async name => ({ data: await png(name === 'a.png' ? '#112233' : name === 'b.png' ? '#445566' : '#778899'), content_type: 'image/png' }), encode: async () => encoded });
    for (const name of ['a.png', 'b.png', 'c.png']) await thumbnails.get(name, 384);
    const names = await fs.readdir(cacheDir);
    assert.equal(names.filter(name => name.endsWith('.webp')).length, 2);
    assert.equal(await fs.readFile(path.join(cacheDir, 'keep.txt'), 'utf8'), 'Unrelated file');
});

test('oversized pixel headers fail before decoding and temporary failures are bounded by source hash', async t => {
    const cacheDir = await cache(t), original = await png();
    const huge = Buffer.from(original);
    huge.writeUInt32BE(8000, 16); huge.writeUInt32BE(8000, 20);
    huge.writeUInt32BE(require('node:zlib').crc32(huge.subarray(12, 29)), 29);
    const real = createCatalogThumbnailer({ cacheDir, readOriginal: async () => ({ data: huge, content_type: 'image/png' }) });
    await assert.rejects(real.get('huge.png', 384), { code: 'THUMBNAIL_ENCODING_FAILED' });
    let calls = 0, data = original;
    const encoded = await sharp(original).resize(16).webp().toBuffer();
    const failing = createCatalogThumbnailer({ cacheDir, readOriginal: async () => ({ data, content_type: 'image/png' }),
        encode: async () => { if (++calls === 1) throw Error('Temporary codec failure'); return encoded; } });
    await assert.rejects(failing.get('retry.png', 384));
    await assert.rejects(failing.get('retry.png', 384));
    assert.equal(calls, 1);
    data = await png('#dd1122');
    assert.deepEqual((await failing.get('retry.png', 384)).data, encoded);
    assert.equal(calls, 2);
});
test('HTTP variants support conditional reads, HEAD and finite errors without exposing source details', async t => {
    const cacheDir = await cache(t), original = await png();
    let reads = 0;
    const app = express();
    const handler = buildCatalogImageThumbnailHandler(null, { cacheDir, readOriginal: async filename => {
        reads++; if (filename === 'missing.png') return null;
        if (filename === 'error.png') throw new Error('private://must-not-escape');
        return { data: original, content_type: 'image/png' };
    } });
    app.get('/cards/:width/:filename', handler); app.head('/cards/:width/:filename', handler);
    const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/cards/384/dish.png`;
    const first = await fetch(url); assert.equal(first.status, 200); assert.equal(first.headers.get('content-type'), 'image/webp');
    const data = Buffer.from(await first.arrayBuffer()); assert.ok(data.length > 0);
    const matched = await fetch(url, { headers: { 'If-None-Match': first.headers.get('etag') } });
    assert.equal(matched.status, 304); assert.equal((await matched.arrayBuffer()).byteLength, 0);
    const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), data.length);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await fetch(url.replace('dish.png', 'missing.png'))).status, 404);
    const failed = await fetch(url.replace('dish.png', 'error.png'));
    assert.equal(failed.status, 503); assert.equal(failed.headers.get('cache-control'), 'no-store'); assert.equal(await failed.text(), '');
    const before = reads;
    assert.equal((await fetch(url.replace('/384/', '/9999/'))).status, 404); assert.equal(reads, before);
});
