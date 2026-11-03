'use strict';

// Run crash regressions in a child: an uncaught dependency error must fail the
// scenario, without installing an exception handler that masks the defect.
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require(process.argv[3]);
const multer = require(process.argv[4]);

async function run() {
    const app = express();
    let request;
    let releaseFilter;
    let finishFilter;
    const filterFinished = new Promise(resolve => { finishFilter = resolve; });
    const scenario = process.argv[2];
    if (scenario === 'compressed-json') {
        const parse = express.json({ limit: '1mb' });
        app.post('/probe', (req, res, next) => parse(req, res, error => {
            if (error) return next(error);
            res.json(req.body);
        }));
    } else if (scenario === 'late-upload-filter') {
        let parser;
        app.post('/probe', multer({ fileHwm: 1, streamHandler(req, stream) {
            parser = stream;
            req.pipe(stream);
        }, fileFilter(req, file, callback) {
            if (file.originalname === 'pending.txt') {
                releaseFilter = () => {
                    parser.once('close', finishFilter);
                    callback(null, true);
                };
            } else {
                req.once('end', () => setImmediate(() => callback(new Error('Synthetic rejection'))));
            }
        } }).any(), (req, res) => res.json({ success: true }));
        app.use((error, req, res, next) => {
            res.status(400).json({ error: 'Synthetic rejection' });
            // Teardown has happened; the other file's asynchronous decision
            // must not revive an unhandled parsing stream.
            setImmediate(releaseFilter);
        });
    } else {
        throw new Error('Unknown dependency regression scenario');
    }
    app.get('/health', (req, res) => res.json({ alive: true }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await new Promise((resolve, reject) => {
            let first;
            let headers;
            if (scenario === 'compressed-json') {
                first = Buffer.concat([zlib.gzipSync('{"synthetic":true}'), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
                headers = { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': first.length };
            } else {
                const boundary = 'eventgenix-dependency-regression';
                first = Buffer.from(['pending.txt', 'rejected.txt'].map(name =>
                    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\nx\r\n`
                ).join(''));
                headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': first.length };
            }
            request = http.request(`${origin}/probe`, { method: 'POST', headers, agent: false }, res => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
                res.on('error', reject);
            });
            request.on('error', reject);
            request.setTimeout(3000, () => request.destroy(new Error('Dependency fixture request timed out')));
            request.end(first);
        });
        if (scenario === 'compressed-json') {
            assert.deepEqual(response, { status: 200, body: { synthetic: true } });
        } else {
            assert.equal(response.status, 400);
            await filterFinished;
        }
        // Exercise a subsequent request after late stream events have run.
        await new Promise(resolve => setTimeout(resolve, 50));
        const healthy = await fetch(`${origin}/health`);
        assert.equal(healthy.status, 200);
        assert.deepEqual(await healthy.json(), { alive: true });
    } finally {
        request?.destroy();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
