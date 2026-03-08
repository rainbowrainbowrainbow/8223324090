/**
 * Link Preview Service
 * Fetches Open Graph metadata from URLs found in chat messages.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const pool = require('../db/pool');
const log = require('../utils/logger');

// Simple in-memory cache for OG data (TTL: 1 hour)
const _ogCache = new Map();
const OG_CACHE_TTL = 60 * 60 * 1000;

/**
 * Extract first URL from text.
 */
function extractUrl(text) {
    const match = text.match(/https?:\/\/[^\s<]+/);
    return match ? match[0] : null;
}

/**
 * Fetch OG tags from a URL. Returns { title, description, image, siteName, url }.
 */
async function fetchOgData(urlStr) {
    // Check cache
    const cached = _ogCache.get(urlStr);
    if (cached && Date.now() - cached.ts < OG_CACHE_TTL) {
        return cached.data;
    }

    try {
        const parsed = new URL(urlStr);
        const protocol = parsed.protocol === 'https:' ? https : http;

        const html = await new Promise((resolve, reject) => {
            const req = protocol.get(urlStr, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ParkBot/1.0)',
                    'Accept': 'text/html'
                }
            }, (res) => {
                // Follow one redirect
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    protocol.get(res.headers.location, {
                        timeout: 5000,
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ParkBot/1.0)' }
                    }, (res2) => {
                        let data = '';
                        res2.setEncoding('utf8');
                        res2.on('data', chunk => {
                            data += chunk;
                            if (data.length > 50000) res2.destroy();
                        });
                        res2.on('end', () => resolve(data));
                        res2.on('error', reject);
                    }).on('error', reject);
                    return;
                }

                let data = '';
                res.setEncoding('utf8');
                res.on('data', chunk => {
                    data += chunk;
                    if (data.length > 50000) res.destroy(); // limit
                });
                res.on('end', () => resolve(data));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        });

        // Parse OG tags
        const og = {};
        const metaRegex = /<meta\s+(?:[^>]*?)property=["'](og:[^"']+)["']\s+(?:[^>]*?)content=["']([^"']*?)["']/gi;
        const metaRegex2 = /<meta\s+(?:[^>]*?)content=["']([^"']*?)["']\s+(?:[^>]*?)property=["'](og:[^"']+)["']/gi;

        let m;
        while ((m = metaRegex.exec(html)) !== null) {
            og[m[1]] = m[2];
        }
        while ((m = metaRegex2.exec(html)) !== null) {
            og[m[2]] = m[1];
        }

        // Fallback to title tag
        if (!og['og:title']) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) og['og:title'] = titleMatch[1].trim();
        }

        // Fallback to meta description
        if (!og['og:description']) {
            const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*?)["']/i);
            if (descMatch) og['og:description'] = descMatch[1];
        }

        if (!og['og:title'] && !og['og:description']) {
            return null; // No useful data
        }

        const result = {
            title: _decodeHtml(og['og:title'] || ''),
            description: _decodeHtml(og['og:description'] || '').slice(0, 200),
            image: og['og:image'] || null,
            siteName: og['og:site_name'] || parsed.hostname,
            url: urlStr
        };

        // Cache
        _ogCache.set(urlStr, { data: result, ts: Date.now() });

        return result;
    } catch (err) {
        log.debug('OG fetch failed for ' + urlStr + ': ' + err.message);
        return null;
    }
}

/**
 * Process a message: find URLs, fetch OG, update metadata.
 * Runs fire-and-forget after message send.
 */
async function processMessageLinks(messageId, content) {
    const url = extractUrl(content);
    if (!url) return null;

    const ogData = await fetchOgData(url);
    if (!ogData) return null;

    // Update message metadata
    await pool.query(
        'UPDATE chat_messages SET metadata = $1 WHERE id = $2',
        [JSON.stringify({ linkPreview: ogData }), messageId]
    );

    return ogData;
}

function _decodeHtml(html) {
    return html
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/');
}

module.exports = {
    extractUrl,
    fetchOgData,
    processMessageLinks
};
