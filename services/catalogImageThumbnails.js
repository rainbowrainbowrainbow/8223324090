'use strict';
const { fork } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeCatalogImageRequestFilename, readCatalogImageBlobByFilename, DEFAULT_MAX_IMAGE_BYTES } = require('./imageStorage');

const WIDTHS = new Set([384, 768]);
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_FILES = 256;
const CACHE_FILE = /^v1-(384|768)-[a-f0-9]{64}\.webp$/;
const TEMP_FILE = /^v1-(384|768)-[a-f0-9]{64}\.webp\.[a-f0-9-]{36}\.tmp$/;
function thumbnailError(code) { return Object.assign(new Error(code), { code }); }
function webp(data) { return data?.subarray(0, 4).toString() === 'RIFF' && data?.subarray(8, 12).toString() === 'WEBP'; }
function rasterMime(data) {
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
    return webp(data) ? 'image/webp' : null;
}

function encodeInChild(data, width, options = {}) {
    return new Promise((resolve, reject) => {
        const child = fork(path.join(__dirname, '../scripts/catalog-thumbnail-worker.js'), [String(width)], {
            silent: true, windowsHide: true, execArgv: ['--max-old-space-size=64'],
            env: Object.fromEntries(['PATH', 'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'WINDIR', 'NODE_PATH']
                .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
        });
        const parts = [];
        let bytes = 0, failed = false;
        const timeout = setTimeout(() => { failed = true; child.kill(); }, options.timeoutMs || 12000);
        child.on('message', stats => {
            if (typeof options.onStats === 'function' && Number.isFinite(stats?.maxRssBytes) && Number.isFinite(stats?.encodeMs)) {
                options.onStats({ maxRssBytes: stats.maxRssBytes, encodeMs: stats.encodeMs });
            }
        });
        child.on('error', () => { failed = true; });
        child.stdin.on('error', () => { failed = true; });
        child.stderr.resume(); // Never echo codec paths, source bytes or native errors.
        child.stdout.on('data', part => {
            bytes += part.length;
            if (bytes > MAX_OUTPUT_BYTES) { failed = true; child.kill(); }
            else parts.push(part);
        });
        child.on('close', code => {
            clearTimeout(timeout);
            const result = Buffer.concat(parts);
            if (code !== 0 || failed || !webp(result)) reject(thumbnailError('THUMBNAIL_ENCODING_FAILED'));
            else resolve(result);
        });
        child.stdin.end(data);
    });
}

function createCatalogThumbnailer(options = {}) {
    const cacheDir = path.resolve(options.cacheDir || path.join(os.tmpdir(), 'eventgenix-catalog-thumbnails-v1'));
    const readOriginal = options.readOriginal || (filename => readCatalogImageBlobByFilename(options.query, filename));
    const encode = options.encode || ((data, width) => encodeInChild(data, width, options));
    const flights = new Map();
    const failedHashes = new Map();
    let tail = Promise.resolve();
    async function cached(filename) {
        try {
            const file = path.join(cacheDir, filename);
            const stat = await fs.lstat(file);
            if (!stat.isFile() || stat.size > MAX_OUTPUT_BYTES) return null;
            const data = await fs.readFile(file);
            return webp(data) ? data : null;
        } catch { return null; }
    }
    async function store(filename, data) {
        await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
        const temporary = path.join(cacheDir, `${filename}.${randomUUID()}.tmp`);
        try {
            await fs.writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
            await fs.rename(temporary, path.join(cacheDir, filename));
        } finally { await fs.unlink(temporary).catch(() => {}); }
        const files = [];
        for (const name of await fs.readdir(cacheDir)) {
            // Delete only this codec's fixed-format regular cache files. Never
            // recurse, follow symlinks or enumerate arbitrary uploads.
            if (!CACHE_FILE.test(name) && !TEMP_FILE.test(name)) continue;
            const full = path.join(cacheDir, name);
            const stat = await fs.lstat(full).catch(() => null);
            if (stat?.isFile()) files.push({ full, bytes: stat.size, mtime: stat.mtimeMs });
        }
        files.sort((a, b) => a.mtime - b.mtime);
        let bytes = files.reduce((sum, file) => sum + file.bytes, 0);
        while (files.length > (options.maxCacheFiles || MAX_CACHE_FILES) || bytes > (options.maxCacheBytes || MAX_CACHE_BYTES)) {
            const oldest = files.shift();
            await fs.unlink(oldest.full);
            bytes -= oldest.bytes;
        }
    }
    function get(filename, width) {
        if (normalizeCatalogImageRequestFilename(filename) !== filename || !filename || !WIDTHS.has(width)) {
            return Promise.reject(thumbnailError('THUMBNAIL_NOT_FOUND'));
        }
        // Coalesce by public source identity before loading any large DB blob.
        const key = `${width}:${filename}`;
        if (flights.has(key)) return flights.get(key);
        if (flights.size >= (options.maxQueued || 32)) return Promise.reject(thumbnailError('THUMBNAIL_BUSY'));
        const work = tail.then(async () => {
            const row = await readOriginal(filename);
            if (!row?.data) throw thumbnailError('THUMBNAIL_NOT_FOUND');
            const original = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
            const mime = rasterMime(original);
            if (!original.length || original.length > DEFAULT_MAX_IMAGE_BYTES
                || !mime || mime !== (row.content_type === 'image/jpg' ? 'image/jpeg' : row.content_type)) throw thumbnailError('THUMBNAIL_UNSUPPORTED');
            const hash = createHash('sha256').update(original).digest('hex');
            const name = `v1-${width}-${hash}.webp`;
            const etag = `"${name}"`;
            let data = await cached(name);
            if (!data) {
                if ((failedHashes.get(name) || 0) > Date.now()) throw thumbnailError('THUMBNAIL_ENCODING_FAILED');
                try { data = await encode(original, width); }
                catch (error) {
                    failedHashes.delete(name);
                    failedHashes.set(name, Date.now() + 30000);
                    if (failedHashes.size > 64) failedHashes.delete(failedHashes.keys().next().value);
                    throw error;
                }
                if (!webp(data) || data.length > MAX_OUTPUT_BYTES) throw thumbnailError('THUMBNAIL_ENCODING_FAILED');
                await store(name, data);
            }
            return { data, etag };
        });
        const operation = work.finally(() => { flights.delete(key); });
        flights.set(key, operation);
        tail = operation.then(() => {}, () => {});
        return operation;
    }
    return { get };
}

function buildCatalogImageThumbnailHandler(query, options = {}) {
    const thumbnails = options.thumbnails || createCatalogThumbnailer({ ...options, query });
    return async (req, res) => {
        try {
            const result = await thumbnails.get(req.params.filename, Number(req.params.width));
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('ETag', result.etag);
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            if (req.headers['if-none-match'] === result.etag) return res.status(304).end();
            if (req.method === 'HEAD') return res.setHeader('Content-Length', String(result.data.length)).status(200).end();
            return res.send(result.data);
        } catch (error) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(error.code === 'THUMBNAIL_NOT_FOUND' ? 404 : 503).end();
        }
    };
}
module.exports = { createCatalogThumbnailer, buildCatalogImageThumbnailHandler, encodeInChild };
