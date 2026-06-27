'use strict';

const crypto = require('crypto');
const { pool } = require('../db');
const { buildAuthUserPayload } = require('./auth');
const {
    BUSINESS_CONTEXTS,
    resolveBusinessContextPolicy
} = require('../services/businessContext');

const HERMES_INTEGRATION_ID = 'hermes-event-genix-crm';
const HERMES_SOURCE = 'hermes';

function sendHermesAuthError(res, status, code, error) {
    return res.status(status).json({
        success: false,
        error,
        code
    });
}

function parsePositiveInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function firstHeaderValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
}

function bearerTokenFromHeader(value) {
    const header = String(firstHeaderValue(value) || '').trim();
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function extractHermesCredential(req = {}) {
    const apiKey = String(firstHeaderValue(req.headers?.['x-api-key']) || '').trim();
    if (apiKey) {
        return { secret: apiKey, mode: 'x-api-key' };
    }

    const bearer = bearerTokenFromHeader(req.headers?.authorization);
    if (bearer) {
        return { secret: bearer, mode: 'authorization-bearer' };
    }

    return { secret: '', mode: null };
}

function timingSafeSecretEqual(provided, expected) {
    const providedText = String(provided || '');
    const expectedText = String(expected || '');
    if (!providedText || !expectedText) return false;

    const providedHash = crypto.createHash('sha256').update(providedText).digest();
    const expectedHash = crypto.createHash('sha256').update(expectedText).digest();
    return crypto.timingSafeEqual(providedHash, expectedHash);
}

function parseHermesAllowedBusinessContexts(value) {
    if (value === undefined || value === null || value === '') return null;
    if (!Array.isArray(value) && !String(value).trim()) return null;
    const source = Array.isArray(value) ? value : String(value).split(/[,;\s]+/);
    const seen = new Set();
    const allowed = [];

    for (const item of source) {
        const key = String(item || '').trim().toLowerCase();
        if (!key || !BUSINESS_CONTEXTS[key] || seen.has(key)) continue;
        seen.add(key);
        allowed.push(key);
    }

    return allowed;
}

function applyHermesBusinessContextAllowlist(actor, allowedBusinessContexts) {
    if (!Array.isArray(allowedBusinessContexts)) return actor;

    const actorContexts = Array.from(new Set([
        ...(Array.isArray(actor?.businessContexts) ? actor.businessContexts : []),
        ...(Array.isArray(actor?.business_contexts) ? actor.business_contexts : [])
    ].filter(context => BUSINESS_CONTEXTS[context])));
    const narrowedContexts = allowedBusinessContexts.filter(context => actorContexts.includes(context));

    if (!narrowedContexts.length) {
        const err = new Error('Hermes actor has no allowed business contexts');
        err.code = 'HERMES_BUSINESS_CONTEXT_FORBIDDEN';
        err.statusCode = 403;
        throw err;
    }

    const currentDefault = actor.defaultBusinessContext || actor.default_business_context;
    const defaultBusinessContext = narrowedContexts.includes(currentDefault)
        ? currentDefault
        : narrowedContexts[0];
    const narrowedActor = {
        ...actor,
        businessContexts: narrowedContexts,
        business_contexts: narrowedContexts,
        defaultBusinessContext,
        default_business_context: defaultBusinessContext
    };

    return {
        ...narrowedActor,
        businessContextPolicy: resolveBusinessContextPolicy(narrowedActor)
    };
}

async function loadHermesActor(queryable, actorUserId) {
    const result = await queryable.query(
        `SELECT id, username, role, extra_roles, page_allowlist, action_allowlist, action_denylist,
                business_contexts, default_business_context, name, telegram_chat_id, is_active
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [actorUserId]
    );
    const actor = result.rows[0] || null;
    if (!actor) {
        const err = new Error('Hermes actor user not found');
        err.code = 'HERMES_ACTOR_NOT_FOUND';
        err.statusCode = 503;
        throw err;
    }
    if (actor.is_active === false) {
        const err = new Error('Hermes actor user is inactive');
        err.code = 'HERMES_ACTOR_INACTIVE';
        err.statusCode = 403;
        throw err;
    }
    return buildAuthUserPayload(actor);
}

function createHermesAuthMiddleware(options = {}) {
    const env = options.env || process.env;
    const queryable = options.pool || pool;

    return async function hermesAuth(req, res, next) {
        const expectedKey = String(env.HERMES_API_KEY || '').trim();
        if (!expectedKey) {
            return sendHermesAuthError(
                res,
                503,
                'HERMES_AUTH_NOT_CONFIGURED',
                'Hermes API key is not configured'
            );
        }

        const actorUserId = parsePositiveInt(env.HERMES_ACTOR_USER_ID);
        if (!actorUserId) {
            return sendHermesAuthError(
                res,
                503,
                'HERMES_ACTOR_NOT_CONFIGURED',
                'Hermes actor user is not configured'
            );
        }

        const credential = extractHermesCredential(req);
        if (!credential.secret) {
            return sendHermesAuthError(
                res,
                401,
                'HERMES_AUTH_REQUIRED',
                'Hermes API key is required'
            );
        }

        if (!timingSafeSecretEqual(credential.secret, expectedKey)) {
            return sendHermesAuthError(
                res,
                401,
                'HERMES_AUTH_INVALID',
                'Hermes API key is invalid'
            );
        }

        let actor;
        try {
            actor = await loadHermesActor(queryable, actorUserId);
        } catch (err) {
            return sendHermesAuthError(
                res,
                err.statusCode || 503,
                err.code || 'HERMES_ACTOR_LOOKUP_FAILED',
                err.message || 'Hermes actor lookup failed'
            );
        }

        try {
            actor = applyHermesBusinessContextAllowlist(
                actor,
                parseHermesAllowedBusinessContexts(env.HERMES_ALLOWED_BUSINESS_CONTEXTS)
            );
        } catch (err) {
            return sendHermesAuthError(
                res,
                err.statusCode || 403,
                err.code || 'HERMES_BUSINESS_CONTEXT_FORBIDDEN',
                err.message || 'Hermes actor business context is not allowed'
            );
        }

        req.user = actor;
        req.integration = {
            id: HERMES_INTEGRATION_ID,
            source: HERMES_SOURCE,
            authMode: credential.mode,
            actorUserId: actor.id
        };

        return next();
    };
}

const hermesAuth = createHermesAuthMiddleware();

module.exports = {
    HERMES_INTEGRATION_ID,
    HERMES_SOURCE,
    applyHermesBusinessContextAllowlist,
    createHermesAuthMiddleware,
    extractHermesCredential,
    hermesAuth,
    loadHermesActor,
    parseHermesAllowedBusinessContexts,
    timingSafeSecretEqual
};
