'use strict';

const crypto = require('crypto');
const { pool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const {
    createDisposableQaMarker,
    disposableQaMarkerFrom
} = require('./disposableQa');
const { insertHistory } = require('./historyLog');

const TRUSTED_QA_STATES = Object.freeze({
    ACTIVE: 'active',
    CLEANUP_PENDING: 'cleanup_pending',
    CLEANED: 'cleaned',
    BLOCKED: 'blocked'
});
const TRUSTED_QA_ENTITY_STATES = Object.freeze({
    ACTIVE: 'active',
    CLEANUP_PENDING: 'cleanup_pending',
    CLEANED: 'cleaned',
    BLOCKED: 'blocked'
});
const DEFAULT_MAX_ENTITY_COUNT = 25;
const DEFAULT_TTL_MINUTES = 30;
const WATCHDOG_BATCH_LIMIT = 10;
const WATCHDOG_MAX_ATTEMPTS = 5;

class TrustedQaRunError extends Error {
    constructor(message, code, details = {}, statusCode = 403) {
        super(message);
        this.name = 'TrustedQaRunError';
        this.code = code || 'TRUSTED_QA_RUN_ERROR';
        this.details = details || {};
        this.statusCode = statusCode;
        this.publicMessage = message;
    }
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function cleanText(value, max = 200) {
    return String(value || '').trim().slice(0, max);
}

function cleanId(value) {
    return cleanText(value, 120);
}

function safeJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function boundedNumber(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function requestQaToken(req) {
    return String(
        req?.get?.('X-Disposable-QA-Token')
        || req?.get?.('X-QA-Run-Token')
        || req?.body?.qaRunToken
        || req?.body?.qa_run_token
        || ''
    ).trim();
}

function requestReplayKey(req) {
    return cleanText(
        req?.get?.('X-QA-Run-Request-Id')
        || req?.get?.('Idempotency-Key')
        || req?.body?.qaRunRequestId
        || req?.body?.qa_run_request_id
        || '',
        160
    );
}

function requestEndpointKey(req) {
    const method = cleanText(req?.method || 'POST', 12).toUpperCase();
    const path = cleanText(
        req?.route?.path
        || req?.path
        || req?.originalUrl
        || req?.url
        || '',
        240
    ).split('?')[0];
    const base = cleanText(req?.baseUrl || '', 160);
    const joined = path.startsWith('/api/') || !base ? path : `${base}${path}`;
    return `${method} ${joined.replace(/\/+/g, '/')}`;
}

function normalizeAllowedEndpoints(value) {
    const raw = Array.isArray(value) ? value : safeJsonObject(value);
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw.endpoints) ? raw.endpoints : []);
    return list.map(item => {
        if (typeof item === 'string') return cleanText(item, 260);
        if (item && typeof item === 'object') {
            const method = cleanText(item.method || '*', 12).toUpperCase();
            const path = cleanText(item.path || item.endpoint || '', 240);
            return path ? `${method} ${path}` : '';
        }
        return '';
    }).filter(Boolean);
}

function endpointAllowed(endpointKey, allowedEndpoints) {
    const endpoint = cleanText(endpointKey, 260);
    const allowed = normalizeAllowedEndpoints(allowedEndpoints);
    if (!allowed.length) return false;
    return allowed.some(item => {
        if (item === endpoint) return true;
        if (item.startsWith('* ')) return endpoint.endsWith(item.slice(2));
        if (item.endsWith('*')) return endpoint.startsWith(item.slice(0, -1));
        return false;
    });
}

function hasClientDisposableQaMarker(payload = {}) {
    const marker = disposableQaMarkerFrom(payload);
    return Boolean(marker && Object.keys(marker).length);
}

function qaPublicDetails(details = {}) {
    return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function requestUserId(req) {
    const parsed = Number.parseInt(req?.user?.id, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function bookingConstraintValue(booking, camel, snake = null) {
    return cleanText(booking?.[camel] ?? (snake ? booking?.[snake] : undefined), 120);
}

function assertRunMatchesRequest(run, req, booking, businessContext) {
    const normalizedContext = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
    if (normalizeBusinessContext(run.business_context || DEFAULT_BUSINESS_CONTEXT) !== normalizedContext) {
        throw new TrustedQaRunError('QA run business context mismatch', 'QA_RUN_CONTEXT_MISMATCH', { businessContext: normalizedContext });
    }
    if (run.state !== TRUSTED_QA_STATES.ACTIVE) {
        throw new TrustedQaRunError('QA run is not active', 'QA_RUN_NOT_ACTIVE', { state: run.state });
    }
    const expiresAt = Date.parse(String(run.expires_at || ''));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new TrustedQaRunError('Invalid or expired QA run token', 'QA_RUN_TOKEN_EXPIRED', { businessContext: normalizedContext });
    }
    const userId = requestUserId(req);
    const requiredOperatorId = Number.parseInt(run.operator_user_id ?? run.required_operator_user_id, 10);
    if (Number.isFinite(requiredOperatorId) && userId !== requiredOperatorId) {
        throw new TrustedQaRunError('QA run operator mismatch', 'QA_RUN_OPERATOR_MISMATCH', { userId });
    }
    const requiredUserId = Number.parseInt(run.required_user_id, 10);
    if (Number.isFinite(requiredUserId) && userId !== requiredUserId) {
        throw new TrustedQaRunError('QA run user mismatch', 'QA_RUN_USER_MISMATCH', { userId });
    }
    const endpointKey = requestEndpointKey(req);
    if (!endpointAllowed(endpointKey, run.allowed_endpoints)) {
        throw new TrustedQaRunError('QA run endpoint is not allowed', 'QA_RUN_ENDPOINT_NOT_ALLOWED', { endpoint: endpointKey });
    }
    const expectedCustomer = cleanId(run.required_customer_id);
    if (expectedCustomer && cleanId(bookingConstraintValue(booking, 'customerId', 'customer_id')) !== expectedCustomer) {
        throw new TrustedQaRunError('QA run customer mismatch', 'QA_RUN_CUSTOMER_MISMATCH', { entityType: 'booking' });
    }
    const expectedProgram = cleanId(run.required_program_id);
    if (expectedProgram && cleanId(bookingConstraintValue(booking, 'programId', 'program_id')) !== expectedProgram) {
        throw new TrustedQaRunError('QA run program mismatch', 'QA_RUN_PROGRAM_MISMATCH', { entityType: 'booking' });
    }
    const expectedProduct = cleanId(run.required_product_id);
    const bookingProduct = cleanId(bookingConstraintValue(booking, 'productId', 'product_id') || bookingConstraintValue(booking, 'programId', 'program_id'));
    if (expectedProduct && bookingProduct !== expectedProduct) {
        throw new TrustedQaRunError('QA run product mismatch', 'QA_RUN_PRODUCT_MISMATCH', { entityType: 'booking' });
    }
    const expectedRoom = cleanId(run.required_room_resource_id);
    if (expectedRoom && cleanId(bookingConstraintValue(booking, 'roomResourceId', 'room_resource_id')) !== expectedRoom) {
        throw new TrustedQaRunError('QA run room mismatch', 'QA_RUN_ROOM_MISMATCH', { entityType: 'booking' });
    }
    return { endpointKey };
}

async function createTrustedQaRun(queryable, options = {}) {
    const token = options.token || crypto.randomBytes(32).toString('base64url');
    const ttlMinutes = boundedNumber(options.ttlMinutes, DEFAULT_TTL_MINUTES, 1, 240);
    const maxEntityCount = boundedNumber(options.maxEntityCount, DEFAULT_MAX_ENTITY_COUNT, 1, 500);
    const businessContext = normalizeBusinessContext(options.businessContext || DEFAULT_BUSINESS_CONTEXT);
    const allowedEndpoints = normalizeAllowedEndpoints(options.allowedEndpoints);
    if (!allowedEndpoints.length) {
        throw new TrustedQaRunError('QA run requires allowed endpoints', 'QA_RUN_ENDPOINTS_REQUIRED', {}, 400);
    }
    const runId = cleanText(options.runId || `qa-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, 100);
    const result = await queryable.query(
        `INSERT INTO trusted_qa_runs
            (run_id, token_hash, source, business_context, operator_user_id, test_customer_marker,
             allowed_endpoints, max_entity_count, state, expires_at,
             required_operator_user_id, required_user_id, required_customer_id,
             required_program_id, required_product_id, required_room_resource_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'active', NOW() + ($9::int * INTERVAL '1 minute'),
                 $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
            runId,
            sha256(token),
            cleanText(options.source || 'trusted_qa', 100),
            businessContext,
            options.operatorUserId || options.requiredOperatorUserId || null,
            cleanText(options.testCustomerMarker || `${runId}:test_customer`, 200),
            JSON.stringify(allowedEndpoints),
            maxEntityCount,
            ttlMinutes,
            options.requiredOperatorUserId || options.operatorUserId || null,
            options.requiredUserId || null,
            options.requiredCustomerId || null,
            options.requiredProgramId || null,
            options.requiredProductId || null,
            options.requiredRoomResourceId || null
        ]
    );
    return { run: result.rows?.[0] || null, token };
}

async function loadTrustedQaRun(queryable, token, businessContext) {
    if (!token) return null;
    const result = await queryable.query(
        `SELECT *
           FROM trusted_qa_runs
          WHERE token_hash = $1
            AND business_context = $2
            AND state = 'active'
          ORDER BY id DESC
          LIMIT 1`,
        [sha256(token), normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT)]
    );
    return result.rows?.[0] || null;
}

async function consumeTrustedQaToken(queryable, run, req, endpointKey) {
    const requestKey = requestReplayKey(req);
    if (!requestKey) {
        throw new TrustedQaRunError('QA run request id is required', 'QA_RUN_REQUEST_ID_REQUIRED', { endpoint: endpointKey });
    }
    try {
        const result = await queryable.query(
            `INSERT INTO trusted_qa_run_token_uses (run_id, request_key, endpoint)
             VALUES ($1, $2, $3)
             ON CONFLICT (run_id, request_key) DO NOTHING
             RETURNING id`,
            [run.id, requestKey, endpointKey]
        );
        if (!result.rowCount) {
            throw new TrustedQaRunError('QA run token request was already used', 'QA_RUN_TOKEN_REPLAYED', { requestKey });
        }
        await queryable.query(
            `UPDATE trusted_qa_runs
                SET token_use_count = COALESCE(token_use_count, 0) + 1,
                    updated_at = NOW()
              WHERE id = $1`,
            [run.id]
        );
    } catch (err) {
        if (err instanceof TrustedQaRunError) throw err;
        if (/does not exist|undefined_table|undefined_column/i.test(String(err.message || err.code || ''))) {
            throw new TrustedQaRunError('Trusted QA replay table is not installed', 'QA_RUN_SCHEMA_MISSING', {}, 500);
        }
        throw err;
    }
}

function attachServerQaMarker(booking, run) {
    const marker = createDisposableQaMarker({
        runId: run.run_id,
        source: run.source,
        testCustomerMarker: run.test_customer_marker,
        kind: 'booking',
        createdAt: new Date().toISOString()
    });
    const extra = booking.extraData && typeof booking.extraData === 'object' && !Array.isArray(booking.extraData)
        ? { ...booking.extraData }
        : safeJsonObject(booking.extra_data);
    extra.disposableQa = marker;
    booking.extraData = extra;
    delete booking.extra_data;
    booking.skipNotification = true;
    booking.skip_notification = true;
    return marker;
}

async function prepareTrustedQaBookingInput(queryable, req, booking = {}, businessContext = DEFAULT_BUSINESS_CONTEXT) {
    const token = requestQaToken(req);
    const clientMarkerPresent = hasClientDisposableQaMarker(booking);
    if (!token && clientMarkerPresent) {
        throw new TrustedQaRunError(
            'Disposable QA marker requires a server-issued QA run token',
            'QA_MARKER_UNTRUSTED',
            { entityType: 'booking' }
        );
    }
    if (!token) {
        return {
            trusted: false,
            suppressSideEffects: false,
            run: null,
            marker: null
        };
    }
    if (req.__trustedQaContext?.trusted) {
        assertRunMatchesRequest(req.__trustedQaContext.run, req, booking, businessContext);
        const marker = attachServerQaMarker(booking, req.__trustedQaContext.run);
        return { ...req.__trustedQaContext, marker };
    }
    const run = await loadTrustedQaRun(queryable, token, businessContext);
    if (!run) {
        throw new TrustedQaRunError(
            'Invalid or expired QA run token',
            'QA_RUN_TOKEN_INVALID',
            { businessContext: normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT) }
        );
    }
    const { endpointKey } = assertRunMatchesRequest(run, req, booking, businessContext);
    await consumeTrustedQaToken(queryable, run, req, endpointKey);
    const marker = attachServerQaMarker(booking, run);
    const context = {
        trusted: true,
        suppressSideEffects: true,
        run,
        marker,
        endpointKey
    };
    req.__trustedQaContext = context;
    return context;
}

async function registeredEntityCount(queryable, runId) {
    const result = await queryable.query(
        'SELECT COUNT(*)::int AS count FROM trusted_qa_run_entities WHERE run_id = $1',
        [runId]
    );
    return Number(result.rows?.[0]?.count || 0);
}

async function registerQaEntity(queryable, qaContext, entityType, entityId, payload = {}) {
    if (!qaContext?.trusted || !qaContext.run?.id || !entityId) return { registered: false };
    const entity = cleanId(entityId);
    const maxEntityCount = boundedNumber(qaContext.run.max_entity_count, DEFAULT_MAX_ENTITY_COUNT, 1, 500);
    const count = await registeredEntityCount(queryable, qaContext.run.id);
    if (count >= maxEntityCount) {
        throw new TrustedQaRunError(
            'QA run entity limit exceeded',
            'QA_RUN_ENTITY_LIMIT_EXCEEDED',
            { maxEntityCount },
            409
        );
    }
    await queryable.query(
        `INSERT INTO trusted_qa_run_entities
            (run_id, entity_type, entity_id, payload, cleanup_state)
         VALUES ($1, $2, $3, $4::jsonb, 'active')
         ON CONFLICT (run_id, entity_type, entity_id)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING id`,
        [
            qaContext.run.id,
            cleanText(entityType, 80),
            entity,
            JSON.stringify({
                ...safeJsonObject(payload),
                registeredAt: new Date().toISOString()
            })
        ]
    );
    return { registered: true, entityId: entity };
}

async function markTrustedQaRunCleanupPending(queryable, runId, reason = 'transport_failure') {
    const result = await queryable.query(
        `UPDATE trusted_qa_runs
            SET state = CASE WHEN state = 'cleaned' THEN state ELSE 'cleanup_pending' END,
                cleanup_last_error = $2,
                next_cleanup_at = COALESCE(next_cleanup_at, NOW()),
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [runId, cleanText(reason, 500)]
    );
    return result.rows?.[0] || null;
}

async function loadTrustedQaCleanupInventory(queryable, runId, { forUpdate = false } = {}) {
    const runResult = await queryable.query(
        `SELECT *
           FROM trusted_qa_runs
          WHERE id = $1
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [runId]
    );
    const run = runResult.rows?.[0] || null;
    if (!run) return null;
    const entityResult = await queryable.query(
        `SELECT *
           FROM trusted_qa_run_entities
          WHERE run_id = $1
          ORDER BY id
          ${forUpdate ? 'FOR UPDATE' : ''}`,
        [runId]
    );
    return { run, entities: entityResult.rows || [] };
}

function classifyCleanupInventory(inventory) {
    if (!inventory) return { status: 'missing_run', blockers: ['missing_run'] };
    const entities = inventory.entities || [];
    const active = entities.filter(row => row.cleanup_state !== TRUSTED_QA_ENTITY_STATES.CLEANED);
    return {
        status: active.length ? 'cleanup_pending' : 'cleaned',
        blockers: [],
        entityCount: entities.length,
        pendingEntityCount: active.length,
        bookingIds: entities
            .filter(row => row.entity_type === 'booking')
            .map(row => String(row.entity_id))
            .filter(Boolean)
            .sort()
    };
}

async function cleanupTrustedQaRun(queryable, runId, options = {}) {
    const inventory = await loadTrustedQaCleanupInventory(queryable, runId, { forUpdate: options.forUpdate === true });
    const classified = classifyCleanupInventory(inventory);
    if (!inventory) return classified;
    if (classified.status === 'cleaned') {
        await queryable.query(
            `UPDATE trusted_qa_runs
                SET state = 'cleaned', cleaned_at = COALESCE(cleaned_at, NOW()), updated_at = NOW()
              WHERE id = $1`,
            [runId]
        );
        return { ...classified, state: TRUSTED_QA_STATES.CLEANED, idempotent: true };
    }
    const bookingIds = classified.bookingIds;
    if (bookingIds.length) {
        await queryable.query(
            `UPDATE bookings
                SET status = 'cancelled',
                    skip_notification = true,
                    updated_at = NOW()
              WHERE id = ANY($1::text[])
                AND COALESCE(NULLIF(BTRIM(business_context), ''), $2) = $2
                AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) <> 'cancelled'`,
            [bookingIds, normalizeBusinessContext(inventory.run.business_context || DEFAULT_BUSINESS_CONTEXT)]
        );
        await queryable.query(
            `UPDATE tasks
                SET status = 'archived',
                    control_meta = COALESCE(control_meta, '{}'::jsonb) || $3::jsonb,
                    updated_at = NOW()
              WHERE source_type = 'booking'
                AND source_id = ANY($1::text[])
                AND COALESCE(NULLIF(BTRIM(business_context), ''), $2) = $2
                AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'todo')) NOT IN ('done', 'archived', 'cancelled')
                AND (
                    created_by ~* '(system|service|automation|smoke|qa|codex|rule)'
                    OR control_meta::text ~* '(system|service|automation|smoke|qa|codex|rule)'
                )`,
            [
                bookingIds,
                normalizeBusinessContext(inventory.run.business_context || DEFAULT_BUSINESS_CONTEXT),
                JSON.stringify({ trustedQaCleanup: { runId: inventory.run.run_id, cleanedAt: new Date().toISOString() } })
            ]
        );
    }
    await queryable.query(
        `UPDATE trusted_qa_run_entities
            SET cleanup_state = 'cleaned',
                updated_at = NOW()
          WHERE run_id = $1`,
        [runId]
    );
    await queryable.query(
        `UPDATE trusted_qa_runs
            SET state = 'cleaned',
                cleaned_at = COALESCE(cleaned_at, NOW()),
                cleanup_last_error = NULL,
                next_cleanup_at = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [runId]
    );
    await insertHistory(queryable, {
        businessContext: inventory.run.business_context,
        action: 'trusted_qa_cleanup',
        username: 'trusted_qa_watchdog',
        data: {
            run_id: inventory.run.run_id,
            booking_count: bookingIds.length,
            entity_count: classified.entityCount
        }
    });
    return {
        ...classified,
        status: 'cleaned',
        state: TRUSTED_QA_STATES.CLEANED,
        cleanedBookingIds: bookingIds
    };
}

async function runTrustedQaCleanupWatchdog(options = {}) {
    const batchLimit = boundedNumber(options.limit, WATCHDOG_BATCH_LIMIT, 1, 50);
    const maxAttempts = boundedNumber(options.maxAttempts, WATCHDOG_MAX_ATTEMPTS, 1, 20);
    const client = options.client || await pool.connect();
    const ownsClient = !options.client;
    const processed = [];
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `SELECT *
               FROM trusted_qa_runs
              WHERE state = 'cleanup_pending'
                AND COALESCE(cleanup_attempts, 0) < $1
                AND (next_cleanup_at IS NULL OR next_cleanup_at <= NOW())
              ORDER BY updated_at ASC
              LIMIT $2
              FOR UPDATE SKIP LOCKED`,
            [maxAttempts, batchLimit]
        );
        for (const run of result.rows || []) {
            try {
                await client.query(
                    `UPDATE trusted_qa_runs
                        SET cleanup_attempts = COALESCE(cleanup_attempts, 0) + 1,
                            cleanup_last_attempt_at = NOW(),
                            updated_at = NOW()
                      WHERE id = $1`,
                    [run.id]
                );
                const cleanup = await cleanupTrustedQaRun(client, run.id, { forUpdate: true });
                processed.push({ runId: run.run_id, status: cleanup.status, state: cleanup.state });
            } catch (err) {
                const nextDelay = Math.min(60, Math.pow(2, Number(run.cleanup_attempts || 0)));
                await client.query(
                    `UPDATE trusted_qa_runs
                        SET state = CASE WHEN COALESCE(cleanup_attempts, 0) >= $3 THEN 'blocked' ELSE 'cleanup_pending' END,
                            cleanup_last_error = $2,
                            blocked_reason = CASE WHEN COALESCE(cleanup_attempts, 0) >= $3 THEN $2 ELSE blocked_reason END,
                            next_cleanup_at = NOW() + ($4::int * INTERVAL '1 minute'),
                            updated_at = NOW()
                      WHERE id = $1`,
                    [run.id, cleanText(err.message, 500), maxAttempts, nextDelay]
                );
                processed.push({ runId: run.run_id, status: 'retry_scheduled', errorCode: err.code || 'cleanup_failed' });
            }
        }
        await client.query('COMMIT');
        return { processed: processed.length, runs: processed };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        if (ownsClient) client.release();
    }
}

module.exports = {
    DEFAULT_MAX_ENTITY_COUNT,
    TRUSTED_QA_ENTITY_STATES,
    TRUSTED_QA_STATES,
    TrustedQaRunError,
    assertRunMatchesRequest,
    classifyCleanupInventory,
    cleanupTrustedQaRun,
    createTrustedQaRun,
    endpointAllowed,
    hasClientDisposableQaMarker,
    loadTrustedQaCleanupInventory,
    loadTrustedQaRun,
    markTrustedQaRunCleanupPending,
    normalizeAllowedEndpoints,
    prepareTrustedQaBookingInput,
    qaPublicDetails,
    registerQaEntity,
    requestEndpointKey,
    requestQaToken,
    requestReplayKey,
    runTrustedQaCleanupWatchdog,
    sha256
};
