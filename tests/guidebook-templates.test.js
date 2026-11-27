'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { mountGuidebookTemplates } = require('../services/guidebookTemplates');

const imageRoot = path.join(__dirname, '..', 'images');
const prefix = '/images/brand/guidebook/templates/';

test('guidebook downloads and image previews contain canonical PNGs and retain static HTTP behavior', async t => {
    const app = express();
    mountGuidebookTemplates(app);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise(resolve => server.close(resolve)));

    function request(name, method = 'GET', headers = {}) {
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1', port: server.address().port,
                path: prefix + name, method, headers
            }, res => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('error', reject);
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            });
            req.on('error', reject);
            req.end();
        });
    }

    const logo = fs.readFileSync(path.join(imageRoot, 'brand', 'event-genix-logo.png'));
    for (const [kind, photo] of [['post', 'family-event'], ['stories', 'private-party'], ['cover', 'workshop']]) {
        const name = 'event-genix-' + kind + '-template.svg';
        const [get, head] = await Promise.all([request(name), request(name, 'HEAD')]);
        assert.equal(get.status, 200);
        assert.equal(head.status, 200);
        assert.equal(head.body.length, 0);
        assert.equal(Number(head.headers['content-length']), get.body.length);
        assert.match(get.headers['content-type'], /image\/svg\+xml/);
        assert.equal(get.headers['cache-control'], 'public, max-age=0');
        assert.ok(get.headers['last-modified']);
        assert.equal(get.headers.etag, `W/"${createHash('sha256').update(get.body).digest('hex')}"`);
        assert.equal(head.headers.etag, get.headers.etag);
        const svg = get.body.toString('utf8');
        const refs = Array.from(svg.matchAll(/<image href="([^"]+)"/g), match => match[1]);
        const expected = [fs.readFileSync(path.join(imageRoot, 'event-cards', 'event-card-' + photo + '.png')), logo];
        assert.equal(refs.length, expected.length);
        refs.forEach((ref, index) => {
            assert.ok(ref.startsWith('data:image/png;base64,'));
            assert.ok(Buffer.from(ref.slice(ref.indexOf(',') + 1), 'base64').equals(expected[index]));
        });
        assert.match(svg, /<text\b/);
        assert.equal((await request(name, 'GET', { 'If-None-Match': get.headers.etag })).status, 304);
        assert.equal((await request(name, 'HEAD', { 'If-None-Match': '"older-version"' })).status, 200);
        const partial = await request(name, 'GET', { Range: 'bytes=0-15' });
        assert.equal(partial.status, 206);
        assert.deepEqual(partial.body, get.body.subarray(0, 16));
    }
    assert.equal((await request('unknown.svg')).status, 404);
});
