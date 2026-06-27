/**
 * middleware/apiAudit.js — Automatic API audit trail
 * v17.9.0: Logs all mutating API requests (POST/PUT/PATCH/DELETE) to user_action_log.
 * Fire-and-forget after response; does NOT block request flow.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const crypto = require('node:crypto');

const log = createLogger('ApiAudit');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HERMES_INTEGRATION_ID = 'hermes-event-genix-crm';
const HERMES_SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-api-key|x-telegram-bot-api-secret-token|x-webhook-secret|x-kie-callback-secret|x-svitlana-secret)$/i;

// Skip self-logging to avoid recursion
const SKIP_PATHS = ['/auth/log-action'];

function requestEndpoint(req = {}) {
    const baseUrl = req.baseUrl || '';
    const path = req.path || req.url || '';
    return String(req.originalUrl || `${baseUrl}${path}` || path || '')
        .split('?')[0]
        .substring(0, 200);
}

function isHermesAuditRequest(req = {}) {
    return req.integration?.source === 'hermes'
        || req.integration?.id === HERMES_INTEGRATION_ID
        || String(req.baseUrl || req.originalUrl || '').startsWith('/api/hermes')
        || String(req.path || '').startsWith('/hermes');
}

function hermesActionType(req = {}) {
    const path = String(req.originalUrl || req.path || '').split('?')[0].replace(/^\/api(?=\/)/, '');
    if (req.method === 'POST' && /^\/hermes\/tasks\/?$/.test(path)) return 'tasks.create';
    if (req.method === 'POST' && /^\/hermes\/tasks\/[^/]+\/complete\/?$/.test(path)) return 'tasks.complete';
    if (req.method === 'POST' && /^\/hermes\/tasks\/[^/]+\/reassign\/?$/.test(path)) return 'tasks.reassign';
    if (req.method === 'POST' && /^\/hermes\/tasks\/[^/]+\/reschedule\/?$/.test(path)) return 'tasks.reschedule';
    return `api.${String(req.method || 'REQUEST').toLowerCase()}`;
}

function fingerprint(value) {
    const text = String(value || '').trim();
    if (!text) return undefined;
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function redactAuditHeaders(headers = {}) {
    const redacted = {};
    for (const [key, value] of Object.entries(headers || {})) {
        redacted[key] = HERMES_SENSITIVE_HEADER_PATTERN.test(key) ? '[redacted]' : value;
    }
    return redacted;
}

function auditUsername(req = {}) {
    if (isHermesAuditRequest(req)) {
        return req.user?.username || req.user?.name || 'hermes_bot';
    }
    return req.user?.username;
}

function buildAuditMeta(req, res, options = {}) {
    const meta = {
        status: res.statusCode,
        latencyMs: options.latencyMs,
        ip: (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
        params: req.params && Object.keys(req.params).length ? req.params : undefined,
    };

    if (isHermesAuditRequest(req)) {
        meta.integrationId = req.integration?.id || HERMES_INTEGRATION_ID;
        meta.integrationSource = 'hermes';
        meta.endpoint = requestEndpoint(req);
        meta.actionType = hermesActionType(req);
        meta.authMode = req.integration?.authMode || undefined;
        meta.actorUserId = req.integration?.actorUserId || req.user?.id || req.user?.userId || undefined;
        meta.idempotencyKeyFingerprint = fingerprint(req.hermesMutation?.idempotencyKey);
    }

    return meta;
}

function apiAudit(req, res, next) {
    if (!MUTATING_METHODS.has(req.method)) return next();
    if (SKIP_PATHS.some(p => req.path.startsWith(p))) return next();

    const startedAt = Date.now();

    res.on('finish', () => {
        // Only log authenticated requests
        if (!req.user) return;
        // Skip auth failures (not meaningful for audit). Authenticated Hermes
        // authorization denials are still useful because they trace a mutation
        // attempt by the configured integration actor.
        if (res.statusCode === 401 || (res.statusCode === 403 && !isHermesAuditRequest(req))) return;

        const action = `api:${req.method}`.substring(0, 50);
        const target = (isHermesAuditRequest(req) ? requestEndpoint(req) : req.path).substring(0, 100);
        const meta = buildAuditMeta(req, res, {
            latencyMs: Math.max(0, Date.now() - startedAt)
        });

        pool.query(
            'INSERT INTO user_action_log (username, action, target, meta) VALUES ($1, $2, $3, $4)',
            [auditUsername(req), action, target, JSON.stringify(meta)]
        ).catch(err => log.error(`Audit insert failed: ${err.message}`));
    });

    next();
}

module.exports = {
    apiAudit,
    buildAuditMeta,
    hermesActionType,
    redactAuditHeaders
};
