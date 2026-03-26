/**
 * services/imageStorage.js — Upload images to Supabase Storage
 * v38.11: Prevents Kie.ai 14-day file deletion by storing permanently
 */
const https = require('https');
const http = require('http');
const { getSupabase } = require('../db/supabase');
const { createLogger } = require('../utils/logger');

const log = createLogger('ImageStorage');
const BUCKET = 'catalog-images';

/**
 * Download image from URL and upload to Supabase Storage.
 * Returns permanent Supabase public URL.
 * @param {string} sourceUrl - Kie.ai temp URL
 * @param {string} filename - e.g. "pinyata-unicorn-1234.png"
 * @returns {Promise<string|null>} Supabase public URL or null
 */
async function uploadFromUrl(sourceUrl, filename) {
    const supabase = getSupabase();
    if (!supabase) {
        log.warn('Supabase not configured (SUPABASE_KEY missing) — keeping original URL');
        return null;
    }

    try {
        // 1. Download image from source URL
        log.info(`Downloading image from ${sourceUrl.substring(0, 60)}...`);
        const imageBuffer = await downloadImage(sourceUrl);
        if (!imageBuffer || imageBuffer.length === 0) {
            log.error('Downloaded empty image from', sourceUrl);
            return null;
        }
        log.info(`Downloaded ${Math.round(imageBuffer.length / 1024)}KB`);

        // 2. Ensure bucket exists
        const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
        if (listErr) {
            log.error('Failed to list buckets:', listErr.message);
            return null;
        }
        if (!buckets?.find(b => b.name === BUCKET)) {
            const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: true });
            if (createErr) {
                log.error('Failed to create bucket:', createErr.message);
                return null;
            }
            log.info(`Created storage bucket: ${BUCKET}`);
        }

        // 3. Upload to Supabase Storage
        const path = `items/${filename}`;
        const contentType = filename.endsWith('.jpg') ? 'image/jpeg' : 'image/png';

        const { data, error } = await supabase.storage
            .from(BUCKET)
            .upload(path, imageBuffer, {
                contentType,
                upsert: true
            });

        if (error) {
            log.error('Supabase upload error:', error.message, error.statusCode || '');
            return null;
        }
        log.info(`Uploaded to Supabase: ${path}`);

        // 4. Get public URL
        const { data: urlData } = supabase.storage
            .from(BUCKET)
            .getPublicUrl(path);

        const publicUrl = urlData?.publicUrl;
        log.info(`Uploaded ${filename} (${Math.round(imageBuffer.length / 1024)}KB) → ${publicUrl}`);
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

/**
 * Generate filename from item data
 */
function makeFilename(catalogId, itemName, ext = 'png') {
    const slug = (itemName || 'item')
        .toLowerCase()
        .replace(/[^a-z0-9а-яіїєґ]+/gi, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 40);
    return `${catalogId}-${slug}-${Date.now()}.${ext}`;
}

module.exports = { uploadFromUrl, makeFilename };
