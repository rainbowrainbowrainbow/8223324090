/**
 * middleware/rateLimit.js — In-memory rate limiter per IP
 */
const rateLimitMap = new Map();
const loginRateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 300;
const LOGIN_RATE_LIMIT_WINDOW = 60000;
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || process.env.RATE_LIMIT_MAX) || 5;

function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
        entry = { start: now, count: 1 };
        rateLimitMap.set(ip, entry);
    } else {
        entry.count++;
    }
    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Забагато запитів, спробуйте пізніше' });
    }
    next();
}

function loginRateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    let entry = loginRateLimitMap.get(ip);
    if (!entry || now - entry.start > LOGIN_RATE_LIMIT_WINDOW) {
        entry = { start: now, count: 1 };
        loginRateLimitMap.set(ip, entry);
    } else {
        entry.count++;
    }
    if (entry.count > LOGIN_RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Забагато спроб входу, зачекайте хвилину' });
    }
    next();
}

// --- Stricter rate limiters for mutation (write) endpoints ---

const writeRateLimitMaps = new Map();

/**
 * Factory: create a rate limiter for specific mutation endpoints.
 * Only counts POST/PUT/PATCH/DELETE requests; GET passes through.
 * @param {string} name - Unique name for this limiter (used for cleanup)
 * @param {object} opts
 * @param {number} opts.windowMs - Time window in milliseconds (default 900000 = 15 min)
 * @param {number} opts.max - Max requests per window (default 30)
 * @param {string[]} opts.methods - HTTP methods to limit (default ['POST', 'PUT', 'PATCH', 'DELETE'])
 * @returns {function} Express middleware
 */
function createWriteRateLimiter(name, { windowMs = 900000, max = 30, methods = ['POST', 'PUT', 'PATCH', 'DELETE'] } = {}) {
    const map = new Map();
    writeRateLimitMaps.set(name, { map, windowMs });

    return function writeRateLimiter(req, res, next) {
        if (!methods.includes(req.method)) {
            return next();
        }

        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        let entry = map.get(ip);
        if (!entry || now - entry.start > windowMs) {
            entry = { start: now, count: 1 };
            map.set(ip, entry);
        } else {
            entry.count++;
        }
        if (entry.count > max) {
            return res.status(429).json({
                error: 'Забагато запитів на створення, спробуйте пізніше'
            });
        }
        next();
    };
}

// POST /api/bookings, POST /api/bookings/full: 30 requests per 15 minutes
const bookingCreateLimiter = createWriteRateLimiter('booking-create', {
    windowMs: 900000,
    max: 30,
    methods: ['POST']
});

// PUT/PATCH /api/bookings/:id: 60 requests per 15 minutes
const bookingUpdateLimiter = createWriteRateLimiter('booking-update', {
    windowMs: 900000,
    max: 60,
    methods: ['PUT', 'PATCH']
});

// POST /api/certificates: 20 requests per 15 minutes
const certCreateLimiter = createWriteRateLimiter('cert-create', {
    windowMs: 900000,
    max: 20,
    methods: ['POST']
});

// POST /api/certificates/batch: 5 requests per 15 minutes
const certBatchLimiter = createWriteRateLimiter('cert-batch', {
    windowMs: 900000,
    max: 5,
    methods: ['POST']
});

// Cleanup old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.start > RATE_LIMIT_WINDOW * 2) rateLimitMap.delete(ip);
    }
    for (const [ip, entry] of loginRateLimitMap) {
        if (now - entry.start > LOGIN_RATE_LIMIT_WINDOW * 2) loginRateLimitMap.delete(ip);
    }
    // Cleanup write rate limiter maps
    for (const [name, { map, windowMs }] of writeRateLimitMaps) {
        for (const [ip, entry] of map) {
            if (now - entry.start > windowMs * 2) map.delete(ip);
        }
    }
}, 300000);

// v19.14: Export endpoints: 5 requests per 15 minutes per IP (relaxed in test env)
const exportLimiter = createWriteRateLimiter('export', {
    windowMs: 900000,
    max: RATE_LIMIT_MAX > 120 ? RATE_LIMIT_MAX : 5,
    methods: ['GET']
});

// v25.3: Sensitive endpoint limiters (password change, impersonate)
const sensitiveActionLimiter = createWriteRateLimiter('sensitive-action', {
    windowMs: 60000,   // 1 minute
    max: 10,
    methods: ['POST', 'PUT', 'PATCH']
});

// v25.3: Shop buy limiter
const shopBuyLimiter = createWriteRateLimiter('shop-buy', {
    windowMs: 60000,
    max: 20,
    methods: ['POST']
});

module.exports = {
    rateLimiter,
    loginRateLimiter,
    bookingCreateLimiter,
    bookingUpdateLimiter,
    certCreateLimiter,
    certBatchLimiter,
    createWriteRateLimiter,
    exportLimiter,
    sensitiveActionLimiter,
    shopBuyLimiter
};
