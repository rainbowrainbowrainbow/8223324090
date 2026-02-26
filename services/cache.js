/**
 * services/cache.js — In-memory query cache for frequently-read data
 * v19.10: Cache settings, lines, products to reduce DB load.
 */

class QueryCache {
    constructor(ttlMs = 60000) {
        this.ttlMs = ttlMs;
        this.store = new Map();
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() - entry.ts > this.ttlMs) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }

    set(key, value) {
        this.store.set(key, { value, ts: Date.now() });
    }

    invalidate(key) {
        if (key) {
            this.store.delete(key);
        } else {
            this.store.clear();
        }
    }

    get size() {
        return this.store.size;
    }
}

// Shared caches for different domains
const settingsCache = new QueryCache(120000); // 2 min TTL
const linesCache = new QueryCache(30000);     // 30s TTL
const productsCache = new QueryCache(300000); // 5 min TTL

module.exports = { QueryCache, settingsCache, linesCache, productsCache };
