'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function bounded(promise) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Upload fixture timed out')), 3000); })]); }
    finally { clearTimeout(timer); }
}
async function fixture(t, storage) {
    const app = express();
    app.post('/upload', multer({ storage, limits: { fileSize: 32, files: 1 } }).single('file'), (req, res) => {
        res.json({ name: req.file.originalname, size: req.file.size, body: req.file.buffer?.toString('utf8') });
    });
    app.use((err, req, res, next) => { if (!res.destroyed) res.status(400).json({ code: err.code || 'ABORTED' }); });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    return `http://127.0.0.1:${server.address().port}/upload`;
}
async function ownedDirectory(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eventgenix-upload-regression-'));
    t.after(async () => {
        const resolved = path.resolve(directory);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('eventgenix-upload-regression-'));
        await fs.rm(resolved, { recursive: true });
    });
    return directory;
}
function form(content) {
    const data = new FormData();
    data.append('file', new Blob([content]), 'synthetic.txt');
    return data;
}

test('updated upload dependency preserves memory uploads and file-size rejection', async t => {
    const url = await fixture(t, multer.memoryStorage());
    const success = await fetch(url, { method: 'POST', body: form('Synthetic upload') });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { name: 'synthetic.txt', size: 16, body: 'Synthetic upload' });
    const oversized = await fetch(url, { method: 'POST', body: form('x'.repeat(33)) });
    assert.equal(oversized.status, 400);
    assert.equal((await oversized.json()).code, 'LIMIT_FILE_SIZE');
});

test('updated upload dependency preserves disk uploads in an owned temporary directory', async t => {
    const directory = await ownedDirectory(t);
    const url = await fixture(t, multer.diskStorage({ destination: directory }));
    const result = await fetch(url, { method: 'POST', body: form('Synthetic disk') });
    assert.equal(result.status, 200);
    const files = await fs.readdir(directory);
    assert.equal(files.length, 1);
    assert.equal(await fs.readFile(path.join(directory, files[0]), 'utf8'), 'Synthetic disk');
});

test('aborting before asynchronous disk destination resolution leaves no orphan file', async t => {
    const directory = await ownedDirectory(t);
    const destinationEntered = deferred();
    const destinationRelease = deferred();
    const aborted = deferred();
    const removed = deferred();
    const storage = multer.diskStorage({ destination(req, file, callback) {
        req.once('aborted', () => aborted.resolve());
        destinationEntered.resolve();
        destinationRelease.promise.then(() => callback(null, directory));
    } });
    const removeFile = storage._removeFile.bind(storage);
    storage._removeFile = (req, file, callback) => removeFile(req, file, error => { callback(error); removed.resolve(error); });
    const url = await fixture(t, storage);
    const boundary = 'synthetic-upload-regression';
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.txt"\r\nContent-Type: text/plain\r\n\r\nSynthetic abort\r\n--${boundary}--\r\n`;
    const request = http.request(url, { method: 'POST', headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(payload) + 100
    } });
    request.on('error', () => {});
    t.after(() => { request.destroy(); destinationRelease.resolve(); });
    request.write(payload);
    await bounded(destinationEntered.promise);
    request.destroy();
    await bounded(aborted.promise);
    destinationRelease.resolve();
    assert.equal(await bounded(removed.promise), null);
    assert.deepEqual(await fs.readdir(directory), []);
});
