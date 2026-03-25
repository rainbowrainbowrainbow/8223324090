/**
 * services/contextCache.js — In-memory cache for frequent DB queries
 * Contour 2: Speed improvement — avoid repeated DB hits for same data.
 */

const _cache = new Map();

/**
 * Get cached value or fetch it.
 * @param {string} key - Cache key
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @param {Function} fetchFn - Async function to fetch data if cache miss
 * @returns {Promise<*>} Cached or freshly fetched data
 */
async function getCached(key, ttlMs, fetchFn) {
    const entry = _cache.get(key);
    if (entry && Date.now() - entry.ts < ttlMs) {
        return entry.data;
    }

    const data = await fetchFn();
    _cache.set(key, { data, ts: Date.now() });
    return data;
}

/**
 * Invalidate a specific cache key.
 */
function invalidate(key) {
    _cache.delete(key);
}

/**
 * Invalidate all keys matching a prefix.
 */
function invalidatePrefix(prefix) {
    for (const key of _cache.keys()) {
        if (key.startsWith(prefix)) {
            _cache.delete(key);
        }
    }
}

/**
 * Clear entire cache.
 */
function clearAll() {
    _cache.clear();
}

/**
 * Get cache stats.
 */
function stats() {
    let expired = 0;
    const now = Date.now();
    for (const [, v] of _cache) {
        if (now - v.ts > 300000) expired++; // >5min = stale
    }
    return { size: _cache.size, expired };
}

// v38.4.0: Periodic cleanup of expired entries to prevent memory leak
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 min
const MAX_CACHE_SIZE = 500;
setInterval(() => {
    const now = Date.now();
    for (const [key, v] of _cache) {
        if (now - v.ts > 300000) _cache.delete(key); // expired (>5min)
    }
    // Hard cap: evict oldest if too large
    if (_cache.size > MAX_CACHE_SIZE) {
        const entries = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
        const toDelete = entries.slice(0, _cache.size - MAX_CACHE_SIZE);
        for (const [key] of toDelete) _cache.delete(key);
    }
}, CLEANUP_INTERVAL).unref();

module.exports = { getCached, invalidate, invalidatePrefix, clearAll, stats };
