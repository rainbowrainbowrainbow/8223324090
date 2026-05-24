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

/**
 * Download image from URL and store it in the CRM local upload surface.
 * Returns public CRM upload URL.
 * @param {string} sourceUrl - Kie.ai temp URL
 * @param {string} filename - e.g. "pinyata-unicorn-1234.png"
 * @returns {Promise<string|null>} public upload URL or null
 */
async function uploadFromUrl(sourceUrl, filename, options = {}) {
    try {
        log.info(`Downloading image from ${sourceUrl.substring(0, 60)}...`);
        const imageBuffer = await downloadImage(sourceUrl);
        if (!imageBuffer || imageBuffer.length === 0) {
            log.error('Downloaded empty image from', sourceUrl);
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
function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { timeout: 30000 }, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadImage(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
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

module.exports = { uploadFromUrl, makeFilename, safeImageFilename };
