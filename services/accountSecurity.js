/**
 * services/accountSecurity.js — Account security event helpers.
 *
 * Keeps password/session/account lifecycle events in one durable audit stream.
 * Never log raw passwords, tokens, or one-time credentials here.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('AccountSecurity');

function requestIp(req) {
    return String(req?.headers?.['x-forwarded-for'] || req?.ip || req?.connection?.remoteAddress || '')
        .split(',')[0]
        .trim()
        .slice(0, 64) || null;
}

function requestUserAgent(req) {
    return String(req?.headers?.['user-agent'] || '').slice(0, 500) || null;
}

const SENSITIVE_AUDIT_KEYS = new Set([
    'password', 'newpassword', 'manualpassword', 'currentpassword',
    'token', 'refreshtoken', 'accesstoken', 'credential', 'credentials',
    'authorization', 'cookie', 'secret'
]);

function safeJson(value, depth = 0) {
    if (depth > 8 || value === null || value === undefined) return null;
    if (Array.isArray(value)) return value.map(item => safeJson(item, depth + 1));
    if (typeof value !== 'object') return value;
    const sanitized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        const normalizedKey = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (SENSITIVE_AUDIT_KEYS.has(normalizedKey)) continue;
        const safeValue = safeJson(nestedValue, depth + 1);
        if (safeValue && typeof safeValue === 'object' && !Array.isArray(safeValue) && Object.keys(safeValue).length === 0) continue;
        sanitized[key] = safeValue;
    }
    return sanitized;
}

async function recordAccountSecurityEvent({
    actor,
    target,
    eventType,
    reason = null,
    details = {},
    req = null,
    client = null,
    strict = false
} = {}) {
    if (!eventType) return;
    const db = client || pool;
    const actorUser = actor || {};
    const targetUser = target || actorUser;
    try {
        await db.query(
            `INSERT INTO account_security_events
                (actor_user_id, actor_username, target_user_id, target_username, event_type, reason, details, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                actorUser.id || null,
                actorUser.username || null,
                targetUser.id || null,
                targetUser.username || null,
                String(eventType).slice(0, 80),
                reason ? String(reason).slice(0, 200) : null,
                JSON.stringify(safeJson(details)),
                requestIp(req),
                requestUserAgent(req)
            ]
        );
    } catch (err) {
        log.warn(`Account security audit failed: ${err.message}`);
        if (strict) throw err;
    }
}

async function listAccountSecurityEvents(userId, limit = 12) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 50);
    const result = await pool.query(
        `SELECT id, actor_username, target_username, event_type, reason, details, ip_address, created_at
         FROM account_security_events
         WHERE target_user_id = $1 OR actor_user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [userId, safeLimit]
    );
    return result.rows;
}

module.exports = {
    recordAccountSecurityEvent,
    listAccountSecurityEvents
};
