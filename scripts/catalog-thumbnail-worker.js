#!/usr/bin/env node
'use strict';
// Short-lived local codec process. The web process never loads libvips and
// retains no native image cache after this process exits. No network or DB.
const MAX_INPUT = 12 * 1024 * 1024;
const MAX_OUTPUT = 512 * 1024;
const width = Number(process.argv[2]);
let size = 0;
const parts = [];
function fail() {
    process.exitCode = 1;
    process.stdout.end();
    if (process.connected) process.disconnect();
}
if (![384, 768].includes(width)) fail();
else {
    process.stdin.on('data', part => {
        size += part.length;
        if (size > MAX_INPUT) { process.stdin.destroy(); fail(); }
        else parts.push(part);
    });
    process.stdin.on('error', fail);
    process.stdin.on('end', async () => {
        try {
            const sharp = require('sharp');
            sharp.cache(false);
            sharp.concurrency(1);
            const started = performance.now();
            const image = sharp(Buffer.concat(parts), { limitInputPixels: 16 * 1024 * 1024, sequentialRead: true });
            const metadata = await image.metadata();
            if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) throw new Error('Unsupported image');
            const data = await image.rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
                .timeout({ seconds: 8 }).webp({ quality: 75, effort: 3 }).toBuffer();
            if (!data.length || data.length > MAX_OUTPUT) throw new Error('Output too large');
            if (process.connected) process.send({ encodeMs: performance.now() - started, maxRssBytes: process.resourceUsage().maxRSS * 1024 });
            process.stdout.end(data, () => { if (process.connected) process.disconnect(); });
        } catch { fail(); }
    });
}
