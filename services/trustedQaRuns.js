'use strict';

const crypto = require('crypto');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const {
    createDisposableQaMarker,
    disposableQaMarkerFrom
} = require('./disposableQa');

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

function requestQaToken(req) {
    return String(
        req?.get?.('X-Disposable-QA-Token')
        || req?.get?.('X-QA-Run-Token')
        || req?.body?.qaRunToken
        || req?.body?.qa_run_token
        || ''
    ).trim();
}

function hasClientDisposableQaMarker(payload = {}) {
    const marker = disposableQaMarkerFrom(payload);
    return Boolean(marker && Object.keys(marker).length);
}

async function loadTrustedQaRun(queryable, token, businessContext) {
    if (!token) return null;
    const result = await queryable.query(
        `SELECT *
           FROM trusted_qa_runs
          WHERE token_hash = $1
            AND business_context = $2
            AND state IN ('active', 'cleanup_pending')
            AND expires_at > NOW()
          ORDER BY id DESC
          LIMIT 1`,
        [sha256(token), normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT)]
    );
    return result.rows?.[0] || null;
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
    const run = await loadTrustedQaRun(queryable, token, businessContext);
    if (!run) {
        throw new TrustedQaRunError(
            'Invalid or expired QA run token',
            'QA_RUN_TOKEN_INVALID',
            { businessContext: normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT) }
        );
    }
    const marker = createDisposableQaMarker({
        runId: run.run_id,
        source: run.source,
        testCustomerMarker: run.test_customer_marker,
        kind: 'booking',
        createdAt: new Date().toISOString()
    });
    const extra = booking.extraData && typeof booking.extraData === 'object' && !Array.isArray(booking.extraData)
        ? { ...booking.extraData }
        : {};
    extra.disposableQa = marker;
    booking.extraData = extra;
    delete booking.extra_data;
    booking.skipNotification = true;
    return {
        trusted: true,
        suppressSideEffects: true,
        run,
        marker
    };
}

async function registerQaEntity(queryable, qaContext, entityType, entityId, payload = {}) {
    if (!qaContext?.trusted || !qaContext.run?.id || !entityId) return { registered: false };
    await queryable.query(
        `INSERT INTO trusted_qa_run_entities
            (run_id, entity_type, entity_id, payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (run_id, entity_type, entity_id)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [qaContext.run.id, entityType, String(entityId), JSON.stringify(payload || {})]
    );
    return { registered: true };
}

module.exports = {
    TrustedQaRunError,
    hasClientDisposableQaMarker,
    prepareTrustedQaBookingInput,
    registerQaEntity,
    requestQaToken,
    sha256
};
