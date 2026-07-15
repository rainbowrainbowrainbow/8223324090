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
async function writeAdminAction(action, category, {
    username,
    target,
    details,
    ip,
    requestId
} = {}) {
    await pool.query(
        `INSERT INTO admin_audit_log (action, category, username, target, details, ip_address, request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [action, category, username || null, target || null,
         details ? JSON.stringify(details) : '{}', ip || null, requestId || null]
    );
}

/** Existing callers use best-effort audit behavior. */
async function logAdminAction(action, category, context) {
    try {
        await writeAdminAction(action, category, context);
    } catch (error) {
        const errorCode = /^[A-Za-z0-9_]{1,32}$/.test(String(error?.code || ''))
            ? String(error.code)
            : 'ADMIN_AUDIT_WRITE_FAILED';
        log.error('Failed to log admin action', { errorCode });
    }
}

/** Fail-closed writer for operations that require a durable audit receipt. */
async function logAdminActionStrict(action, category, context) {
    await writeAdminAction(action, category, context);
}

module.exports = { logAdminAction, logAdminActionStrict };
