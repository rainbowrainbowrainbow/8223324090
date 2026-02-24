/**
 * middleware/apiAudit.js — Automatic API audit trail
 * v17.9.0: Logs all mutating API requests (POST/PUT/PATCH/DELETE) to user_action_log.
 * Fire-and-forget after response; does NOT block request flow.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('ApiAudit');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Skip self-logging to avoid recursion
const SKIP_PATHS = ['/auth/log-action'];

function apiAudit(req, res, next) {
    if (!MUTATING_METHODS.has(req.method)) return next();
    if (SKIP_PATHS.some(p => req.path.startsWith(p))) return next();

    res.on('finish', () => {
        // Only log authenticated requests
        if (!req.user) return;
        // Skip auth failures (not meaningful for audit)
        if (res.statusCode === 401 || res.statusCode === 403) return;

        const action = `api:${req.method}`.substring(0, 50);
        const target = req.path.substring(0, 100);
        const meta = {
            status: res.statusCode,
            ip: (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
            params: req.params && Object.keys(req.params).length ? req.params : undefined,
        };

        pool.query(
            'INSERT INTO user_action_log (username, action, target, meta) VALUES ($1, $2, $3, $4)',
            [req.user.username, action, target, JSON.stringify(meta)]
        ).catch(err => log.error(`Audit insert failed: ${err.message}`));
    });

    next();
}

module.exports = { apiAudit };
