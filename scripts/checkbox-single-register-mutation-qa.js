#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

const BLOCKED_QA_RUN_ID = '7db91a9d-c3a9-4e47-9a90-b0c6daa25dbd';
const PLANNED_RECEIPT_COUNT = 4;
const RETAINED_DATABASES = Object.freeze({
    event_genix: 'eventgenix_park_single_register_test_20260904',
    dar: 'eventgenix_dar_single_register_test_20260904'
});
const RECEIPT_PLAN = Object.freeze([
    Object.freeze({
        sequence: 1,
        businessContext: 'event_genix',
        tender: 'cash',
        scenarios: Object.freeze(['server_side_price', 'idempotency_replay', 'lookup_only_unknown_recovery'])
    }),
    Object.freeze({
        sequence: 2,
        businessContext: 'event_genix',
        tender: 'card_terminal',
        scenarios: Object.freeze(['server_side_price'])
    }),
    Object.freeze({
        sequence: 3,
        businessContext: 'dar',
        tender: 'cash',
        scenarios: Object.freeze(['weekend_hourly_care_quantity_2', 'weekday_hourly_care_same_receipt', 'dar_ubd_20'])
    }),
    Object.freeze({
        sequence: 4,
        businessContext: 'dar',
        tender: 'card_terminal',
        scenarios: Object.freeze(['two_club_directions', 'dar_second_club_direction_10', 'idempotency_replay'])
    })
]);

class CheckboxSingleRegisterMutationQaError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'CheckboxSingleRegisterMutationQaError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new CheckboxSingleRegisterMutationQaError(code, message);
}

function normalizeUuid(value, code = 'qa_run_id_invalid') {
    const candidate = String(value || '').trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate)) {
        fail(code, 'A fresh UUID v4 is required');
    }
    return candidate;
}

function assertFreshQaRunId(value) {
    const qaRunId = normalizeUuid(value);
    if (qaRunId === BLOCKED_QA_RUN_ID) {
        fail('qa_run_id_reuse_forbidden', 'The blocked QA run ID cannot be reused');
    }
    return qaRunId;
}

function assertReceiptPlan(plan = RECEIPT_PLAN) {
    if (!Array.isArray(plan) || plan.length !== PLANNED_RECEIPT_COUNT) {
        fail('qa_receipt_plan_count_mismatch', `The plan must contain exactly ${PLANNED_RECEIPT_COUNT} receipts`);
    }
    const sequences = plan.map(item => Number(item.sequence));
    if (sequences.some((value, index) => value !== index + 1)) {
        fail('qa_receipt_plan_sequence_invalid', 'Receipt plan sequence must be stable and contiguous');
    }
    const contexts = plan.map(item => String(item.businessContext || ''));
    if (contexts.join(',') !== 'event_genix,event_genix,dar,dar') {
        fail('qa_receipt_plan_not_sequential', 'PARK must complete before DAR starts');
    }
    const tenders = plan.map(item => String(item.tender || ''));
    if (tenders.join(',') !== 'cash,card_terminal,cash,card_terminal') {
        fail('qa_receipt_plan_tender_mismatch', 'Each context must have exactly one cash and one card-terminal receipt');
    }
    return plan;
}

function assertMutationSafetyEvidence(evidence = {}) {
    const requiredTrue = [
        'exactOrganization',
        'exactRegister',
        'exactCashier',
        'licenseDeviceOwnedByRegister',
        'activeBinding',
        'untaxedMappings',
        'acceptanceIsolated',
        'noForeignShift',
        'queuesEmpty'
    ];
    const missing = requiredTrue.filter(key => evidence[key] !== true);
    if (evidence.isTest !== true || evidence.expectedIsTest !== true) missing.push('isTest');
    if (missing.length) {
        fail('qa_mutation_evidence_incomplete', `Mutation evidence is incomplete: ${[...new Set(missing)].join(', ')}`);
    }
    return true;
}

function bodyFromRequest(input, init = {}) {
    if (init.body != null) return init.body;
    if (typeof Request !== 'undefined' && input instanceof Request) return input.body;
    return null;
}

async function parseRequestJson(input, init = {}) {
    const direct = bodyFromRequest(input, init);
    if (typeof direct === 'string') {
        try { return JSON.parse(direct); } catch { return {}; }
    }
    if (direct instanceof Uint8Array || Buffer.isBuffer(direct)) {
        try { return JSON.parse(Buffer.from(direct).toString('utf8')); } catch { return {}; }
    }
    if (typeof Request !== 'undefined' && input instanceof Request) {
        try { return await input.clone().json(); } catch { return {}; }
    }
    return {};
}

function requestUrl(input) {
    return new URL(typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input));
}

function requestMethod(input, init = {}) {
    return String(init.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function createOneShotPostSubmitUnknownFetch({
    fetchImpl,
    qaRunId,
    operationUuid,
    evidence,
    allowedOrigins = []
} = {}) {
    if (typeof fetchImpl !== 'function') fail('qa_fetch_required', 'A fetch implementation is required');
    const normalizedRunId = assertFreshQaRunId(qaRunId);
    const normalizedOperationUuid = normalizeUuid(operationUuid, 'qa_operation_uuid_invalid');
    assertMutationSafetyEvidence(evidence);
    const origins = new Set((allowedOrigins || []).map(value => new URL(String(value)).origin));
    if (!origins.size) fail('qa_allowed_origin_required', 'At least one exact allowed origin is required');

    let acceptedPostCount = 0;
    let blockedDuplicatePostCount = 0;
    let lookupCount = 0;
    let injected = false;

    const wrapped = async (input, init = {}) => {
        const url = requestUrl(input);
        if (!origins.has(url.origin)) fail('qa_provider_origin_forbidden', 'Provider request origin is outside the exact QA allowlist');
        const method = requestMethod(input, init);
        const receiptMatch = url.pathname.match(/^\/api\/v1\/receipts\/([^/]+)$/);
        if (method === 'GET' && receiptMatch && decodeURIComponent(receiptMatch[1]).toLowerCase() === normalizedOperationUuid) {
            lookupCount += 1;
            return fetchImpl(input, init);
        }
        if (method !== 'POST' || url.pathname !== '/api/v1/receipts/sell') return fetchImpl(input, init);

        const body = await parseRequestJson(input, init);
        const requestUuid = String(body?.id || '').trim().toLowerCase();
        if (requestUuid !== normalizedOperationUuid) return fetchImpl(input, init);
        if (injected || acceptedPostCount > 0) {
            blockedDuplicatePostCount += 1;
            fail('qa_duplicate_sale_post_blocked', 'A second sale POST for the recovery UUID is forbidden');
        }

        const response = await fetchImpl(input, init);
        if (!response || response.ok !== true) return response;
        acceptedPostCount += 1;
        injected = true;
        const error = new TypeError('QA one-shot network response interruption after accepted POST');
        error.code = 'qa_post_submit_unknown';
        error.qaRunId = normalizedRunId;
        throw error;
    };

    wrapped.evidence = () => ({
        qaRunId: normalizedRunId,
        operationUuid: normalizedOperationUuid,
        acceptedPostCount,
        blockedDuplicatePostCount,
        lookupCount,
        injected
    });
    return wrapped;
}

function sanitizedPlan() {
    assertReceiptPlan();
    return {
        status: 'READY_FOR_LOCAL_LOOPBACK_PROOF',
        externalNetworkAllowed: false,
        plannedReceiptCount: PLANNED_RECEIPT_COUNT,
        databases: {
            park: RETAINED_DATABASES.event_genix,
            dar: RETAINED_DATABASES.dar
        },
        sequence: RECEIPT_PLAN.map(item => ({
            sequence: item.sequence,
            businessContext: item.businessContext,
            tender: item.tender,
            scenarios: [...item.scenarios]
        })),
        activationRequirements: [
            'fresh_qa_run_id',
            'exact_operation_uuid',
            'exact_test_identity',
            'is_test_true',
            'empty_queues',
            'no_foreign_shift'
        ]
    };
}

function main() {
    if (process.argv.slice(2).some(arg => arg !== 'plan')) {
        fail('qa_runner_mode_forbidden', 'This local block supports the sanitized plan mode only');
    }
    process.stdout.write(`${JSON.stringify(sanitizedPlan(), null, 2)}\n`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'qa_runner_failed', message: error.message })}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    BLOCKED_QA_RUN_ID,
    CheckboxSingleRegisterMutationQaError,
    PLANNED_RECEIPT_COUNT,
    RECEIPT_PLAN,
    RETAINED_DATABASES,
    assertFreshQaRunId,
    assertMutationSafetyEvidence,
    assertReceiptPlan,
    createOneShotPostSubmitUnknownFetch,
    sanitizedPlan
};
