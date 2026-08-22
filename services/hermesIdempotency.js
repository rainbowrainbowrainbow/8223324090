'use strict';

const crypto = require('crypto');
const { pool: defaultPool } = require('../db');
const {
    HERMES_INTEGRATION_ID
} = require('./hermesMutationGuard');

const DEFAULT_TTL_HOURS = 48;
const IDEMPOTENCY_KEY_CONFLICT = 'IDEMPOTENCY_KEY_CONFLICT';
const IDEMPOTENCY_KEY_IN_PROGRESS = 'IDEMPOTENCY_KEY_IN_PROGRESS';
const HERMES_IDEMPOTENCY_CONTEXT_MISSING = 'HERMES_IDEMPOTENCY_CONTEXT_MISSING';

function normalizeForStableJson(value) {
    if (value === undefined) return null;
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return value.toString('base64');
    if (Array.isArray(value)) return value.map(normalizeForStableJson);
    if (typeof value !== 'object') return value;

    const normalized = {};
    for (const key of Object.keys(value).sort()) {
        normalized[key] = normalizeForStableJson(value[key]);
    }
    return normalized;
}

function stableJsonStringify(value) {
    return JSON.stringify(normalizeForStableJson(value));
}

function normalizedRequestPath(req = {}, options = {}) {
    if (options.requestPath) return String(options.requestPath);
    const rawPath = req.originalUrl || req.url || req.path || req.route?.path || '';
    return String(rawPath).split('?')[0] || '/';
}

function buildHermesRequestHash(req = {}, options = {}) {
    const payload = {
        method: String(req.method || 'POST').toUpperCase(),
        path: normalizedRequestPath(req, options),
        body: req.body ?? null
    };

    return crypto
        .createHash('sha256')
        .update(stableJsonStringify(payload))
        .digest('hex');
}

function createIdempotencyError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

function normalizeStoredResponseBody(value) {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}

async function claimHermesIdempotencyKey(options = {}) {
    const query = options.pool || defaultPool;
    const integrationId = options.integrationId || HERMES_INTEGRATION_ID;
    const idempotencyKey = options.idempotencyKey;
    const requestHash = options.requestHash;
    const ttlHours = options.ttlHours || DEFAULT_TTL_HOURS;

    if (!idempotencyKey || !requestHash) {
        throw createIdempotencyError(
            500,
            HERMES_IDEMPOTENCY_CONTEXT_MISSING,
            'Hermes idempotency context is missing'
        );
    }

    await query.query(
        `DELETE FROM integration_idempotency_keys
         WHERE integration_id = $1
           AND idempotency_key = $2
           AND expires_at < NOW()`,
        [integrationId, idempotencyKey]
    );

    const inserted = await query.query(
        `INSERT INTO integration_idempotency_keys (
             integration_id,
             idempotency_key,
             request_hash,
             expires_at
         )
         VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 hour'))
         ON CONFLICT (integration_id, idempotency_key) DO NOTHING
         RETURNING id, integration_id, idempotency_key, request_hash, response_status, response_body, created_at, expires_at`,
        [integrationId, idempotencyKey, requestHash, ttlHours]
    );

    if (inserted.rows.length) {
        return {
            state: 'new',
            record: inserted.rows[0]
        };
    }

    const existing = await query.query(
        `SELECT id, integration_id, idempotency_key, request_hash, response_status, response_body, created_at, expires_at
         FROM integration_idempotency_keys
         WHERE integration_id = $1
           AND idempotency_key = $2
         LIMIT 1`,
        [integrationId, idempotencyKey]
    );

    const record = existing.rows[0];
    if (!record) {
        throw createIdempotencyError(
            409,
            IDEMPOTENCY_KEY_IN_PROGRESS,
            'Hermes idempotency key is being processed'
        );
    }

    if (record.request_hash !== requestHash) {
        throw createIdempotencyError(
            409,
            IDEMPOTENCY_KEY_CONFLICT,
            'Idempotency key was already used with a different request'
        );
    }

    if (record.response_status) {
        return {
            state: 'replay',
            record: {
                ...record,
                response_body: normalizeStoredResponseBody(record.response_body)
            }
        };
    }

    throw createIdempotencyError(
        409,
        IDEMPOTENCY_KEY_IN_PROGRESS,
        'Hermes idempotency key is being processed'
    );
}

async function storeHermesIdempotencyResponse(options = {}) {
    const query = options.pool || defaultPool;
    const integrationId = options.integrationId || HERMES_INTEGRATION_ID;
    const idempotencyKey = options.idempotencyKey;
    const requestHash = options.requestHash;
    const responseStatus = Number(options.responseStatus);
    const responseBody = options.responseBody ?? null;
    const serializedResponseBody = JSON.stringify(responseBody);

    if (!idempotencyKey || !requestHash || !Number.isInteger(responseStatus)) {
        throw createIdempotencyError(
            500,
            HERMES_IDEMPOTENCY_CONTEXT_MISSING,
            'Hermes idempotency response context is missing'
        );
    }

    const result = await query.query(
        `UPDATE integration_idempotency_keys
         SET response_status = $4,
             response_body = $5::jsonb
         WHERE integration_id = $1
           AND idempotency_key = $2
           AND request_hash = $3
           AND response_status IS NULL
         RETURNING id, integration_id, idempotency_key, request_hash, response_status, response_body, created_at, expires_at`,
        [integrationId, idempotencyKey, requestHash, responseStatus, serializedResponseBody]
    );

    return result.rows[0] || null;
}

function normalizeMutationResult(result) {
    if (result && typeof result === 'object' && ('status' in result || 'body' in result)) {
        return {
            status: result.status || 200,
            body: result.body ?? {}
        };
    }

    return {
        status: 200,
        body: result ?? {}
    };
}

function notifyHermesIdempotencyResult(options, result) {
    if (typeof options.onResult !== 'function') return;
    try {
        options.onResult(result);
    } catch {}
}

function sendHermesIdempotencyError(res, err) {
    return res.status(err.statusCode || 500).json(hermesIdempotencyErrorBody(err));
}

function hermesIdempotencyErrorBody(err) {
    const body = {
        success: false,
        error: err.message || 'Hermes idempotency failed',
        code: err.code || 'HERMES_IDEMPOTENCY_ERROR'
    };
    const meta = {};
    if (err.existingId !== undefined) meta.existingId = err.existingId;
    if (err.existingStatus !== undefined) meta.existingStatus = err.existingStatus;
    if (meta.existingId === undefined && err.task?.id !== undefined) meta.existingId = err.task.id;
    if (meta.existingStatus === undefined && err.task?.status !== undefined) meta.existingStatus = err.task.status;
    if (Object.keys(meta).length) body.meta = meta;
    return body;
}

async function withHermesIdempotency(req, res, work, options = {}) {
    const baseQuery = options.pool || defaultPool;

    if (options.transactional === true && typeof baseQuery.connect === 'function') {
        const client = await baseQuery.connect();
        const afterCommit = [];
        try {
            await client.query('BEGIN');
            const result = await runHermesIdempotency(req, res, work, {
                ...options,
                pool: client,
                afterCommit
            });
            await client.query('COMMIT');
            afterCommit.forEach(callback => {
                try {
                    callback();
                } catch {}
            });
            return result;
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch {}
            throw err;
        } finally {
            client.release();
        }
    }

    return runHermesIdempotency(req, res, work, {
        ...options,
        pool: baseQuery
    });
}

async function runHermesIdempotency(req, res, work, options = {}) {
    const mutation = req.hermesMutation || req.integration?.mutation || {};
    const integrationId = mutation.source || options.integrationId || HERMES_INTEGRATION_ID;
    const idempotencyKey = mutation.idempotencyKey || options.idempotencyKey;
    const requestHash = options.requestHash || buildHermesRequestHash(req, options);
    const query = options.pool || defaultPool;
    const ttlHours = options.ttlHours || DEFAULT_TTL_HOURS;

    try {
        const claim = await claimHermesIdempotencyKey({
            pool: query,
            integrationId,
            idempotencyKey,
            requestHash,
            ttlHours
        });

        if (claim.state === 'replay') {
            notifyHermesIdempotencyResult(options, {
                state: 'replay',
                status: claim.record.response_status,
                body: claim.record.response_body
            });
            return res.status(claim.record.response_status).json(claim.record.response_body);
        }

        let mutationResult;
        try {
            mutationResult = normalizeMutationResult(await work({
                integrationId,
                idempotencyKey,
                requestHash,
                pool: query,
                afterCommit: options.afterCommit
            }));
        } catch (err) {
            if (!err.statusCode || err.statusCode >= 500) throw err;
            mutationResult = {
                status: err.statusCode,
                body: hermesIdempotencyErrorBody(err)
            };
        }

        await storeHermesIdempotencyResponse({
            pool: query,
            integrationId,
            idempotencyKey,
            requestHash,
            responseStatus: mutationResult.status,
            responseBody: mutationResult.body
        });

        notifyHermesIdempotencyResult(options, {
            state: 'new',
            status: mutationResult.status,
            body: mutationResult.body
        });

        return res.status(mutationResult.status).json(mutationResult.body);
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) {
            return sendHermesIdempotencyError(res, err);
        }
        throw err;
    }
}

module.exports = {
    DEFAULT_TTL_HOURS,
    HERMES_IDEMPOTENCY_CONTEXT_MISSING,
    IDEMPOTENCY_KEY_CONFLICT,
    IDEMPOTENCY_KEY_IN_PROGRESS,
    buildHermesRequestHash,
    claimHermesIdempotencyKey,
    stableJsonStringify,
    storeHermesIdempotencyResponse,
    withHermesIdempotency
};
