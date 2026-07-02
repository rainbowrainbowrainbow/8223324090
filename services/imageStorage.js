/**
 * services/imageStorage.js — Persist generated catalog images on the CRM upload surface.
 * v0.63.18: Remote storage removed; files are stored under /uploads/catalog-images.
 */
const https = require('https');
const http = require('http');
const fsp = require('fs/promises');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('ImageStorage');
const DEFAULT_LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'catalog-images');
const PUBLIC_PREFIX = '/uploads/catalog-images';
const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 4;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30000;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

function imageSourcePreview(sourceUrl) {
    const text = String(sourceUrl || '').trim();
    if (!text) return 'empty-source';
    if (/^data:image\//i.test(text)) return 'data:image/...';
    try {
        const parsed = new URL(text);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.slice(0, 120);
    } catch {
        return text.slice(0, 60);
    }
}

function normalizeMimeType(value) {
    return String(value || '').split(';')[0].trim().toLowerCase();
}

function normalizeMimeSet(value) {
    if (!value) return ALLOWED_IMAGE_MIME_TYPES;
    return new Set(Array.from(value).map(normalizeMimeType).filter(Boolean));
}

function parsePositiveInt(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

/**
 * Download image from URL and store it in the CRM local upload surface.
 * Returns public CRM upload URL.
 * @param {string} sourceUrl - Kie.ai temp URL
 * @param {string} filename - e.g. "pinyata-unicorn-1234.png"
 * @returns {Promise<string|null>} public upload URL or null
 */
async function uploadFromUrl(sourceUrl, filename, options = {}) {
    try {
        const sourcePreview = imageSourcePreview(sourceUrl);
        log.info(`Downloading image from ${sourcePreview}...`);
        const imageBuffer = await downloadImage(sourceUrl, options);
        if (!imageBuffer || imageBuffer.length === 0) {
            log.error('Downloaded empty image from', sourcePreview);
            return null;
        }
        log.info(`Downloaded ${Math.round(imageBuffer.length / 1024)}KB`);

        const safeFilename = safeImageFilename(filename);
        const localDir = options.localDir || path.join(DEFAULT_LOCAL_DIR, 'items');
        await fsp.mkdir(localDir, { recursive: true });
        const fullPath = path.join(localDir, safeFilename);
        await fsp.writeFile(fullPath, imageBuffer);

        const publicUrl = `${PUBLIC_PREFIX}/items/${encodeURIComponent(safeFilename)}`;
        log.info(`Stored ${safeFilename} (${Math.round(imageBuffer.length / 1024)}KB) → ${publicUrl}`);
        return publicUrl;
    } catch (err) {
        log.error('uploadFromUrl error:', err.message);
        return null;
    }
}

/**
 * Download image buffer from URL
 */
function downloadImage(url, options = {}) {
    const maxBytes = parsePositiveInt(options.maxBytes || options.maxImageBytes) || DEFAULT_MAX_IMAGE_BYTES;
    const allowedMimeTypes = normalizeMimeSet(options.allowedMimeTypes);
    const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : DEFAULT_MAX_REDIRECTS;
    const timeoutMs = parsePositiveInt(options.timeoutMs) || DEFAULT_DOWNLOAD_TIMEOUT_MS;
    return downloadImageInternal(String(url || '').trim(), {
        maxBytes,
        allowedMimeTypes,
        maxRedirects,
        timeoutMs,
        validateUrl: typeof options.validateUrl === 'function' ? options.validateUrl : null
    });
}

function downloadImageInternal(url, options) {
    return new Promise((resolve, reject) => {
        if (/^data:image\//i.test(url)) {
            try {
                const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
                if (!match) return reject(new Error('Invalid data URL image'));
                const mime = normalizeMimeType(match[1]);
                if (!options.allowedMimeTypes.has(mime)) {
                    return reject(new Error('Unsupported image MIME type'));
                }
                const base64 = match[2].replace(/\s+/g, '');
                const estimatedBytes = Math.floor((base64.length * 3) / 4);
                if (estimatedBytes > options.maxBytes) {
                    return reject(new Error('Image exceeds maximum size'));
                }
                return resolve(Buffer.from(base64, 'base64'));
            } catch (err) {
                return reject(err);
            }
        }

        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            return reject(new Error('Invalid image URL'));
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return reject(new Error('Unsupported image URL protocol'));
        }
        if (options.validateUrl) {
            try {
                options.validateUrl(parsed.toString());
            } catch (err) {
                return reject(err);
            }
        }

        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.get(parsed, { timeout: options.timeoutMs }, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (options.maxRedirects <= 0) {
                    res.resume();
                    return reject(new Error('Too many image redirects'));
                }
                let nextUrl;
                try {
                    nextUrl = new URL(res.headers.location, parsed).toString();
                } catch {
                    res.resume();
                    return reject(new Error('Invalid image redirect URL'));
                }
                res.resume();
                return downloadImageInternal(nextUrl, {
                    ...options,
                    maxRedirects: options.maxRedirects - 1
                }).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            const mime = normalizeMimeType(res.headers['content-type']);
            if (!mime || !options.allowedMimeTypes.has(mime)) {
                res.resume();
                return reject(new Error('Unsupported image MIME type'));
            }

            const contentLength = parsePositiveInt(res.headers['content-length']);
            if (contentLength && contentLength > options.maxBytes) {
                res.resume();
                return reject(new Error('Image exceeds maximum size'));
            }

            const chunks = [];
            let totalBytes = 0;
            let settled = false;
            const fail = (err) => {
                if (settled) return;
                settled = true;
                res.destroy();
                reject(err);
            };
            res.on('data', chunk => {
                totalBytes += chunk.length;
                if (totalBytes > options.maxBytes) {
                    fail(new Error('Image exceeds maximum size'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                if (settled) return;
                settled = true;
                resolve(Buffer.concat(chunks));
            });
            res.on('error', fail);
        });
        req.setTimeout(options.timeoutMs, () => {
            req.destroy(new Error('Image download timed out'));
        });
        req.on('error', reject);
    });
}

function safeImageFilename(filename) {
    const parsed = path.parse(filename || makeFilename('catalog', 'item'));
    const ext = ['.jpg', '.jpeg', '.png', '.webp'].includes(parsed.ext.toLowerCase()) ? parsed.ext.toLowerCase() : '.png';
    const base = (parsed.name || 'catalog-item')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'catalog-item';
    return `${base}${ext}`;
}

/**
 * Generate filename from item data
 */
function makeFilename(catalogId, itemName, ext = 'png') {
    // Transliterate Ukrainian → ASCII so generated upload keys stay URL-safe.
    const tr = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya'};
    const ascii = (itemName || 'item').toLowerCase().split('').map(c => tr[c] || c).join('');
    const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
    const safeId = (catalogId || 'misc').replace(/[^a-z0-9-]+/gi, '');
    return `${safeId}-${slug}-${Date.now()}.${ext}`;
}

module.exports = {
    uploadFromUrl,
    makeFilename,
    safeImageFilename,
    ALLOWED_IMAGE_MIME_TYPES,
    DEFAULT_MAX_IMAGE_BYTES
};
