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

function safeJson(value) {
    if (!value || typeof value !== 'object') return {};
    const clone = { ...value };
    delete clone.password;
    delete clone.newPassword;
    delete clone.currentPassword;
    delete clone.token;
    delete clone.refreshToken;
    return clone;
}

async function recordAccountSecurityEvent({
    actor,
    target,
    eventType,
    reason = null,
    details = {},
    req = null,
    client = null
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
