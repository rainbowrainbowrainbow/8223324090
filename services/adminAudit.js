/**
 * services/adminAudit.js — Sensitive action audit trail
 * v19.10: Logs admin actions, settings changes, backup/restore ops.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('AdminAudit');

/**
 * Log a sensitive admin action to admin_audit_log table.
 * Fire-and-forget — never blocks the caller.
 */
async function logAdminAction(action, category, { username, target, details, ip, requestId } = {}) {
    try {
        await pool.query(
            `INSERT INTO admin_audit_log (action, category, username, target, details, ip_address, request_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [action, category, username || null, target || null,
             details ? JSON.stringify(details) : '{}', ip || null, requestId || null]
        );
    } catch (err) {
        log.error(`Failed to log admin action: ${err.message}`);
    }
}

module.exports = { logAdminAction };
