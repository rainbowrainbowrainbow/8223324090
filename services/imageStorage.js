/**
 * services/imageStorage.js — Persist generated catalog images on the CRM upload surface.
 * New writes can use Postgres-backed blobs while keeping the public URL under
 * /uploads/catalog-images for booking/menu compatibility.
 */
const https = require('https');
const http = require('http');
const fsp = require('fs/promises');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('ImageStorage');
const DEFAULT_LOCAL_DIR = path.join(__dirname, '..', 'uploads', 'catalog-images');
const PUBLIC_PREFIX = '/uploads/catalog-images';
const CATALOG_IMAGE_STORAGE_PROVIDER = 'postgres';
const CATALOG_IMAGE_STORAGE_BUCKET = 'catalog_image_blobs';
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

function canonicalImageMimeType(value) {
    const mime = normalizeMimeType(value);
    return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

function normalizeMimeSet(value) {
    if (!value) return ALLOWED_IMAGE_MIME_TYPES;
    return new Set(Array.from(value).map(canonicalImageMimeType).filter(Boolean));
}

function parsePositiveInt(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function resolveQuery(options = {}) {
    const queryLike = options.query || options.pool || options.client || options.db || null;
    return queryLike && typeof queryLike.query === 'function' ? queryLike : null;
}

function publicCatalogImageUrl(filename) {
    return `${PUBLIC_PREFIX}/items/${encodeURIComponent(safeImageFilename(filename))}`;
}

function normalizeCatalogImageRequestFilename(filename) {
    let decoded = String(filename || '').split('?')[0].split('#')[0].trim();
    if (!decoded) return '';
    try {
        decoded = decodeURIComponent(decoded);
    } catch {
        return '';
    }
    decoded = decoded.replace(/\\/g, '/');
    if (!decoded || decoded.includes('/') || decoded.includes('..')) return '';
    const safe = safeImageFilename(decoded);
    return safe === decoded ? safe : '';
}

function catalogImageStorageDescriptor(options = {}, publicUrl = null) {
    if (resolveQuery(options)) {
        return {
            provider: CATALOG_IMAGE_STORAGE_PROVIDER,
            bucket: CATALOG_IMAGE_STORAGE_BUCKET,
            publicUrl
        };
    }
    return {
        provider: 'local',
        publicUrl
    };
}

/**
 * Download image from URL and store it in the CRM upload surface.
 * Returns public CRM upload URL.
 * @param {string} sourceUrl - Kie.ai temp URL
 * @param {string} filename - e.g. "pinyata-unicorn-1234.png"
 * @returns {Promise<string|null>} public upload URL or null
 */
async function uploadFromUrl(sourceUrl, filename, options = {}) {
    try {
        const sourcePreview = imageSourcePreview(sourceUrl);
        log.info(`Downloading image from ${sourcePreview}...`);
        const downloaded = await downloadImageWithMetadata(sourceUrl, options);
        const imageBuffer = downloaded.buffer;
        if (!imageBuffer || imageBuffer.length === 0) {
            log.error('Downloaded empty image from', sourcePreview);
            return null;
        }
        log.info(`Downloaded ${Math.round(imageBuffer.length / 1024)}KB`);

        const safeFilename = safeImageFilename(filename);
        const query = resolveQuery(options);
        if (query) {
            await storeCatalogImageBlob(query, {
                filename: safeFilename,
                contentType: downloaded.contentType,
                data: imageBuffer,
                sourceUrl,
                metadata: options.metadata
            });
        }

        if (!query || options.localDir) {
            const localDir = options.localDir || path.join(DEFAULT_LOCAL_DIR, 'items');
            await fsp.mkdir(localDir, { recursive: true });
            const fullPath = path.join(localDir, safeFilename);
            await fsp.writeFile(fullPath, imageBuffer);
        }

        const publicUrl = publicCatalogImageUrl(safeFilename);
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
    return downloadImageWithMetadata(url, options).then(result => result.buffer);
}

function downloadImageWithMetadata(url, options = {}) {
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
                const mime = canonicalImageMimeType(match[1]);
                if (!options.allowedMimeTypes.has(mime)) {
                    return reject(new Error('Unsupported image MIME type'));
                }
                const base64 = match[2].replace(/\s+/g, '');
                const estimatedBytes = Math.floor((base64.length * 3) / 4);
                if (estimatedBytes > options.maxBytes) {
                    return reject(new Error('Image exceeds maximum size'));
                }
                return resolve({
                    buffer: Buffer.from(base64, 'base64'),
                    contentType: mime
                });
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

            const mime = canonicalImageMimeType(res.headers['content-type']);
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
                resolve({
                    buffer: Buffer.concat(chunks),
                    contentType: mime
                });
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

async function storeCatalogImageBlob(query, { filename, contentType, data, sourceUrl = null, metadata = {} } = {}) {
    if (!query || typeof query.query !== 'function') {
        throw new Error('Postgres query client is required for catalog image blob storage');
    }
    const safeFilename = safeImageFilename(filename);
    if (!Buffer.isBuffer(data) || data.length === 0) {
        throw new Error('Non-empty catalog image buffer is required');
    }
    const mime = canonicalImageMimeType(contentType);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
        throw new Error('Unsupported image MIME type');
    }
    const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    await query.query(
        `INSERT INTO catalog_image_blobs
            (filename, content_type, data, size_bytes, source_url, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (filename)
         DO UPDATE SET content_type = EXCLUDED.content_type,
                       data = EXCLUDED.data,
                       size_bytes = EXCLUDED.size_bytes,
                       source_url = EXCLUDED.source_url,
                       metadata = EXCLUDED.metadata,
                       updated_at = NOW()`,
        [safeFilename, mime, data, data.length, sourceUrl || null, JSON.stringify(safeMetadata)]
    );
    return {
        provider: CATALOG_IMAGE_STORAGE_PROVIDER,
        bucket: CATALOG_IMAGE_STORAGE_BUCKET,
        filename: safeFilename,
        publicUrl: publicCatalogImageUrl(safeFilename),
        contentType: mime,
        sizeBytes: data.length
    };
}

async function readCatalogImageBlobByFilename(query, filename) {
    if (!query || typeof query.query !== 'function') {
        throw new Error('Postgres query client is required for catalog image blob reads');
    }
    const safeFilename = normalizeCatalogImageRequestFilename(filename);
    if (!safeFilename) return null;
    const result = await query.query(
        `SELECT filename, content_type, data, size_bytes, source_url, metadata, created_at, updated_at
         FROM catalog_image_blobs
         WHERE filename = $1
         LIMIT 1`,
        [safeFilename]
    );
    return result.rows[0] || null;
}

function buildCatalogImageBlobFallbackHandler(query, logger = null) {
    return async (req, res, next) => {
        try {
            const safeFilename = normalizeCatalogImageRequestFilename(req.params?.filename);
            if (!safeFilename) {
                return res.status(404).json({ error: 'image_not_found' });
            }
            const row = await readCatalogImageBlobByFilename(query, safeFilename);
            if (!row?.data) return next();
            const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
            res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
            res.setHeader('Content-Length', String(Number(row.size_bytes || data.length || 0)));
            res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return res.send(data);
        } catch (err) {
            if (logger && typeof logger.warn === 'function') {
                logger.warn(`Catalog image Postgres upload fallback skipped: ${err.message}`);
            }
            return next();
        }
    };
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
    CATALOG_IMAGE_STORAGE_BUCKET,
    CATALOG_IMAGE_STORAGE_PROVIDER,
    uploadFromUrl,
    makeFilename,
    safeImageFilename,
    publicCatalogImageUrl,
    normalizeCatalogImageRequestFilename,
    catalogImageStorageDescriptor,
    buildCatalogImageBlobFallbackHandler,
    readCatalogImageBlobByFilename,
    storeCatalogImageBlob,
    ALLOWED_IMAGE_MIME_TYPES,
    DEFAULT_MAX_IMAGE_BYTES
};
