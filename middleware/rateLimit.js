/**
 * middleware/rateLimit.js — Rate limiting (general API + login)
 *
 * SRP: захист від зловживання API. In-memory лічильники per IP.
 */

// General API rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 120;

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

// Strict login rate limiter (5 attempts per 15 min)
const loginRateLimitMap = new Map();
const LOGIN_RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX = 5;

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
        const remainingSec = Math.ceil((LOGIN_RATE_LIMIT_WINDOW - (now - entry.start)) / 1000);
        return res.status(429).json({ error: `Забагато спроб входу. Спробуйте через ${Math.ceil(remainingSec / 60)} хв` });
    }
    next();
}

// Cleanup old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.start > RATE_LIMIT_WINDOW * 2) rateLimitMap.delete(ip);
    }
    for (const [ip, entry] of loginRateLimitMap) {
        if (now - entry.start > LOGIN_RATE_LIMIT_WINDOW * 2) loginRateLimitMap.delete(ip);
    }
}, 300000);

module.exports = { rateLimiter, loginRateLimiter };
