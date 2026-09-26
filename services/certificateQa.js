'use strict';

const { DEFAULT_BUSINESS_CONTEXT, BUSINESS_SCOPE_SINGLE, resolveBusinessScope } = require('./businessContext');
const { isQaLeaseCandidate } = require('./qaCreatorLease');
const {
    TrustedQaRunError,
    loadTrustedQaRun,
    requestQaToken,
    requestEndpointKey,
    normalizeAllowedEndpoints,
    requestReplayKey,
    consumeTrustedQaToken,
    registerQaEntity
} = require('./trustedQaRuns');

// The manifest remains after a run is closed, so historical QA certificates
// never re-enter business counts when their short-lived token expires.
const BUSINESS_CERTIFICATE_FILTER = `NOT EXISTS (
    SELECT 1 FROM trusted_qa_run_entities certificate_qa
     WHERE certificate_qa.entity_type = 'certificate'
       AND certificate_qa.entity_id = certificates.id::text
)`;

function qaCertificateError(message, code, statusCode = 403) {
    return new TrustedQaRunError(message, code, {}, statusCode);
}

async function prepareTrustedQaCertificate(client, req, displayValue) {
    const token = requestQaToken(req);
    if (!token) {
        if (req.body?.disposableQa || req.body?.disposable_qa || req.body?.qaRunId || req.body?.qa_run_id) {
            throw qaCertificateError('QA marker requires a trusted run token', 'QA_MARKER_UNTRUSTED');
        }
        return null;
    }
    const scope = resolveBusinessScope(req);
    if (scope.invalid || scope.mode !== BUSINESS_SCOPE_SINGLE || scope.activeContext !== DEFAULT_BUSINESS_CONTEXT || scope.canWrite === false) {
        throw qaCertificateError('QA certificate business context denied', 'QA_RUN_CONTEXT_MISMATCH');
    }
    const run = await loadTrustedQaRun(client, token, DEFAULT_BUSINESS_CONTEXT);
    if (!run || run.source !== 'trusted_qa' || Number(run.max_entity_count) !== 1) {
        throw qaCertificateError('Invalid or expired certificate QA run', 'QA_RUN_TOKEN_INVALID');
    }
    const endpoint = requestEndpointKey(req);
    const endpoints = normalizeAllowedEndpoints(run.allowed_endpoints);
    if (endpoint !== 'POST /api/certificates' || endpoints.length !== 1 || endpoints[0] !== endpoint
        || !requestReplayKey(req)) {
        throw qaCertificateError('Certificate QA request is not authorized', 'QA_RUN_ENDPOINT_NOT_ALLOWED');
    }
    const userId = Number(req.user?.id);
    if (!Number.isSafeInteger(userId) || userId !== Number(run.operator_user_id)
        || userId !== Number(run.required_user_id)
        || userId !== Number(run.required_operator_user_id)) {
        throw qaCertificateError('Certificate QA account mismatch', 'QA_RUN_USER_MISMATCH');
    }
    const account = await client.query(
        `SELECT u.id, u.username, u.name, u.is_active,
                EXISTS (SELECT 1 FROM employee_profiles ep WHERE ep.user_id = u.id AND COALESCE(ep.is_active, true)) AS has_staff_profile
           FROM users u WHERE u.id = $1 FOR SHARE`,
        [userId]
    );
    const user = account.rows?.[0];
    if (!user || user.is_active !== true || user.has_staff_profile || !isQaLeaseCandidate(user)) {
        throw qaCertificateError('Isolated QA account required', 'QA_RUN_USER_NOT_ISOLATED');
    }
    if (String(displayValue || '').trim() !== String(run.test_customer_marker || '').trim()
        || !String(run.test_customer_marker || '').startsWith(`${run.run_id}:certificate:`)) {
        throw qaCertificateError('Certificate QA recipient marker mismatch', 'QA_RUN_CERTIFICATE_MISMATCH');
    }
    await consumeTrustedQaToken(client, run, req, endpoint);
    return { trusted: true, run, suppressSideEffects: true };
}

async function registerTrustedQaCertificate(client, context, certificateId) {
    if (!context?.trusted) return;
    await registerQaEntity(client, context, 'certificate', certificateId, {
        businessContext: DEFAULT_BUSINESS_CONTEXT,
        cleanupAction: 'preserve_redemption_or_revoke'
    });
}

module.exports = { BUSINESS_CERTIFICATE_FILTER, prepareTrustedQaCertificate, registerTrustedQaCertificate };
