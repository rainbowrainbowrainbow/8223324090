'use strict';

const HERMES_INTEGRATION_ID = 'hermes-event-genix-crm';
const HERMES_SOURCE_SURFACE = 'hermes';
const HERMES_CONFIRMATION_HEADER = 'x-hermes-user-confirmed';
const HERMES_CONFIRMATION_HEADER_CANONICAL = 'X-Hermes-User-Confirmed';
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const IDEMPOTENCY_KEY_HEADER_CANONICAL = 'Idempotency-Key';

function firstHeaderValue(value) {
    if (Array.isArray(value)) return value[0];
    return value;
}

function requestHeader(req = {}, name) {
    if (typeof req.get === 'function') return req.get(name);
    return firstHeaderValue(req.headers?.[String(name).toLowerCase()]);
}

function sendHermesMutationError(res, status, code, error) {
    return res.status(status).json({
        success: false,
        error,
        code
    });
}

function isConfirmedHeader(value) {
    return String(firstHeaderValue(value) || '').trim().toLowerCase() === 'true';
}

function createHermesMutationGuard(options = {}) {
    const integrationId = options.integrationId || HERMES_INTEGRATION_ID;
    const requireIntegrationId = options.requireIntegrationId === true;

    return function hermesMutationGuard(req, res, next) {
        const providedIntegrationId = String(requestHeader(req, 'x-integration-id') || '').trim();
        if (requireIntegrationId && !providedIntegrationId) {
            return sendHermesMutationError(
                res,
                400,
                'HERMES_INTEGRATION_ID_REQUIRED',
                'X-Integration-Id header is required'
            );
        }
        if (providedIntegrationId && providedIntegrationId !== integrationId) {
            return sendHermesMutationError(
                res,
                400,
                'HERMES_INTEGRATION_ID_INVALID',
                'Hermes integration id is invalid'
            );
        }

        const idempotencyKey = String(requestHeader(req, IDEMPOTENCY_KEY_HEADER) || '').trim();
        if (!idempotencyKey) {
            return sendHermesMutationError(
                res,
                400,
                'IDEMPOTENCY_KEY_REQUIRED',
                `${IDEMPOTENCY_KEY_HEADER_CANONICAL} header is required`
            );
        }

        if (!isConfirmedHeader(requestHeader(req, HERMES_CONFIRMATION_HEADER))) {
            return sendHermesMutationError(
                res,
                400,
                'HERMES_CONFIRMATION_REQUIRED',
                `${HERMES_CONFIRMATION_HEADER_CANONICAL}: true header is required`
            );
        }

        req.hermesMutation = {
            sourceSurface: HERMES_SOURCE_SURFACE,
            source: integrationId,
            idempotencyKey
        };
        req.integration = {
            ...(req.integration || {}),
            id: req.integration?.id || integrationId,
            source: req.integration?.source || HERMES_SOURCE_SURFACE,
            mutation: req.hermesMutation
        };

        return next();
    };
}

const requireHermesMutationGuard = createHermesMutationGuard();

module.exports = {
    HERMES_CONFIRMATION_HEADER,
    HERMES_CONFIRMATION_HEADER_CANONICAL,
    HERMES_INTEGRATION_ID,
    HERMES_SOURCE_SURFACE,
    IDEMPOTENCY_KEY_HEADER,
    IDEMPOTENCY_KEY_HEADER_CANONICAL,
    createHermesMutationGuard,
    requireHermesMutationGuard
};
