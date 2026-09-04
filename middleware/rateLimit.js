/**
 * middleware/rateLimit.js — In-memory rate limiter per IP
 */
const crypto = require('crypto');
const { normalizeLoginIdentifier } = require('../services/authIdentity');
const { normalizeLoginCredentialPayload } = require('../services/credentialInput');

const rateLimitMap = new Map();
const loginRateLimitMap = new Map();
const loginCanonicalRateLimitMap = new Map();
const loginIpRateLimitMap = new Map();
const refreshSessionRateLimitMap = new Map();
const refreshIpRateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 300;
const LOGIN_RATE_LIMIT_WINDOW = 60000;
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 5;
const LOGIN_IP_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_IP_RATE_LIMIT_MAX)
    || Math.max(LOGIN_RATE_LIMIT_MAX * 10, 50);
const REFRESH_SESSION_RATE_LIMIT_WINDOW = 60000;
const REFRESH_SESSION_RATE_LIMIT_MAX = 10;
const REFRESH_IP_RATE_LIMIT_MAX = parseInt(process.env.REFRESH_IP_RATE_LIMIT_MAX)
    || Math.max(REFRESH_SESSION_RATE_LIMIT_MAX * 10, 100);

function activeRateLimitEntry(map, key, now, windowMs) {
    const entry = map.get(key);
    if (!entry) return null;
    if (now - entry.start <= windowMs) return entry;
    map.delete(key);
    return null;
}

function incrementRateLimitEntry(map, key, now, windowMs) {
    const entry = activeRateLimitEntry(map, key, now, windowMs);
    if (entry) {
        entry.count += 1;
        return entry;
    }
    const created = { start: now, count: 1 };
    map.set(key, created);
    return created;
}

function decrementRateLimitEntry(map, key, expectedEntry) {
    const entry = map.get(key);
    if (!entry || entry !== expectedEntry) return;
    entry.count = Math.max(0, entry.count - 1);
    if (entry.count === 0) map.delete(key);
}

function loginIdentityKey(req) {
    let identifier = '';
    try {
        const credentials = normalizeLoginCredentialPayload(req.body || {});
        identifier = normalizeLoginIdentifier(credentials.username);
    } catch {}
    const digest = crypto.createHash('sha256').update(identifier || '<missing>').digest('hex').slice(0, 24);
    return digest;
}

function canonicalLoginIdentityKey(identity) {
    const rawIdentity = identity && typeof identity === 'object'
        ? (identity.id !== undefined && identity.id !== null
            ? `id:${String(identity.id)}`
            : `username:${normalizeLoginIdentifier(identity.username)}`)
        : `identity:${normalizeLoginIdentifier(identity)}`;
    return crypto.createHash('sha256').update(rawIdentity || '<missing>').digest('hex').slice(0, 24);
}

function rejectRateLimitedLogin(res, entry, now) {
    const retryAfterSeconds = Math.max(1, Math.ceil(
        (LOGIN_RATE_LIMIT_WINDOW - (now - entry.start)) / 1000
    ));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
        error: 'Забагато спроб входу, зачекайте хвилину',
        code: 'login_rate_limited',
        retryAfterSeconds
    });
}

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
    if (req.method !== 'POST') return next();
    const ip = String(req.ip || req.connection?.remoteAddress || 'unknown');
    const now = Date.now();
    const accountKey = `${ip}:${loginIdentityKey(req)}`;
    const accountEntry = incrementRateLimitEntry(loginRateLimitMap, accountKey, now, LOGIN_RATE_LIMIT_WINDOW);
    const ipEntry = incrementRateLimitEntry(loginIpRateLimitMap, ip, now, LOGIN_RATE_LIMIT_WINDOW);
    let canonicalReservation = null;

    if (accountEntry.count > LOGIN_RATE_LIMIT_MAX) {
        return rejectRateLimitedLogin(res, accountEntry, now);
    }
    if (ipEntry.count > LOGIN_IP_RATE_LIMIT_MAX) {
        return rejectRateLimitedLogin(res, ipEntry, now);
    }

    req.reserveCanonicalLoginAttempt = identity => {
        if (canonicalReservation) return canonicalReservation.limited !== true;
        const key = `${ip}:${canonicalLoginIdentityKey(identity)}`;
        const entry = incrementRateLimitEntry(
            loginCanonicalRateLimitMap,
            key,
            Date.now(),
            LOGIN_RATE_LIMIT_WINDOW
        );
        canonicalReservation = {
            key,
            entry,
            limited: entry.count > LOGIN_RATE_LIMIT_MAX
        };
        if (!canonicalReservation.limited) return true;
        rejectRateLimitedLogin(res, entry, Date.now());
        return false;
    };

    let finalized = false;
    const finalizeReservation = completed => {
        if (finalized) return;
        finalized = true;
        // A client-aborted request is not a successful login. Keep its
        // reservation as a failed attempt until the fixed window expires.
        if (!completed) return;
        if (res.statusCode >= 200 && res.statusCode < 300) {
            loginRateLimitMap.delete(accountKey);
            if (canonicalReservation) loginCanonicalRateLimitMap.delete(canonicalReservation.key);
            decrementRateLimitEntry(loginIpRateLimitMap, ip, ipEntry);
            return;
        }
        if (res.statusCode === 400 || res.statusCode === 401) return;
        decrementRateLimitEntry(loginRateLimitMap, accountKey, accountEntry);
        if (canonicalReservation) {
            decrementRateLimitEntry(
                loginCanonicalRateLimitMap,
                canonicalReservation.key,
                canonicalReservation.entry
            );
        }
        decrementRateLimitEntry(loginIpRateLimitMap, ip, ipEntry);
    };
    res.once('finish', () => finalizeReservation(true));
    res.once('close', () => finalizeReservation(res.writableFinished === true));

    next();
}

function refreshSessionLimiter(req, res, next) {
    if (req.method !== 'POST') return next();
    const refreshToken = String(req.body?.refreshToken || '');
    const ip = String(req.ip || req.connection?.remoteAddress || 'unknown');
    const tokenKey = refreshToken
        ? crypto.createHash('sha256').update(refreshToken).digest('hex')
        : `missing:${ip}`;
    const now = Date.now();
    const tokenEntry = incrementRateLimitEntry(
        refreshSessionRateLimitMap,
        tokenKey,
        now,
        REFRESH_SESSION_RATE_LIMIT_WINDOW
    );
    const ipEntry = incrementRateLimitEntry(
        refreshIpRateLimitMap,
        ip,
        now,
        REFRESH_SESSION_RATE_LIMIT_WINDOW
    );
    const limitedEntry = tokenEntry.count > REFRESH_SESSION_RATE_LIMIT_MAX
        ? tokenEntry
        : (ipEntry.count > REFRESH_IP_RATE_LIMIT_MAX ? ipEntry : null);
    if (!limitedEntry) return next();

    const retryAfterSeconds = Math.max(1, Math.ceil(
        (REFRESH_SESSION_RATE_LIMIT_WINDOW - (now - limitedEntry.start)) / 1000
    ));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
        error: 'Забагато спроб оновлення сесії, зачекайте хвилину',
        code: 'refresh_rate_limited',
        retryable: true,
        retryAfterSeconds
    });
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
const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.start > RATE_LIMIT_WINDOW * 2) rateLimitMap.delete(ip);
    }
    for (const [ip, entry] of loginRateLimitMap) {
        if (now - entry.start > LOGIN_RATE_LIMIT_WINDOW * 2) loginRateLimitMap.delete(ip);
    }
    for (const [key, entry] of loginCanonicalRateLimitMap) {
        if (now - entry.start > LOGIN_RATE_LIMIT_WINDOW * 2) loginCanonicalRateLimitMap.delete(key);
    }
    for (const [ip, entry] of loginIpRateLimitMap) {
        if (now - entry.start > LOGIN_RATE_LIMIT_WINDOW * 2) loginIpRateLimitMap.delete(ip);
    }
    for (const [key, entry] of refreshSessionRateLimitMap) {
        if (now - entry.start > REFRESH_SESSION_RATE_LIMIT_WINDOW * 2) refreshSessionRateLimitMap.delete(key);
    }
    for (const [ip, entry] of refreshIpRateLimitMap) {
        if (now - entry.start > REFRESH_SESSION_RATE_LIMIT_WINDOW * 2) refreshIpRateLimitMap.delete(ip);
    }
    // Cleanup write rate limiter maps
    for (const [name, { map, windowMs }] of writeRateLimitMaps) {
        for (const [ip, entry] of map) {
            if (now - entry.start > windowMs * 2) map.delete(ip);
        }
    }
}, 300000);
if (cleanupTimer.unref) cleanupTimer.unref();

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

// Public landing/demo lead forms: keep enough room for real traffic, block bursts.
const landingLeadLimiter = createWriteRateLimiter('landing-lead', {
    windowMs: 600000,
    max: 8,
    methods: ['POST']
});

module.exports = {
    rateLimiter,
    loginRateLimiter,
    refreshSessionLimiter,
    bookingCreateLimiter,
    bookingUpdateLimiter,
    certCreateLimiter,
    certBatchLimiter,
    createWriteRateLimiter,
    exportLimiter,
    sensitiveActionLimiter,
    shopBuyLimiter,
    landingLeadLimiter
};
