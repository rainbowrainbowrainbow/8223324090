/**
 * middleware/apiKey.js — External API key authentication
 *
 * Protects /api/external/* endpoints from unauthorized access.
 * Used by Claw (Club Bot) to access Park Booking data.
 */
const { createLogger } = require('../utils/logger');

const log = createLogger('ApiKey');

const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || '51cb10428a6655c519d3346fbf99784824dd8eb596fcb1d33356e966fd2fb083';

if (!process.env.EXTERNAL_API_KEY) {
    log.warn('EXTERNAL_API_KEY not set! Using default key (insecure). Set EXTERNAL_API_KEY env variable.');
}

/**
 * Validates X-API-Key header against EXTERNAL_API_KEY
 */
function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        log.warn(`Missing API key from ${req.ip}`);
        return res.status(401).json({ error: 'API key required' });
    }

    if (apiKey !== EXTERNAL_API_KEY) {
        log.warn(`Invalid API key attempt from ${req.ip}`);
        return res.status(403).json({ error: 'Invalid API key' });
    }

    log.debug(`Valid API key from ${req.ip}`);
    next();
}

module.exports = { authenticateApiKey, EXTERNAL_API_KEY };
