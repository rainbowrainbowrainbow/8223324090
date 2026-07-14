'use strict';

const LIVE_MULTI_SEGMENT_QA_CONFIRMATION = 'I_CONFIRM_LIVE_MULTI_SEGMENT_QA';
const LIVE_MULTI_SEGMENT_QA_VERSION = 1;
const LIVE_MULTI_SEGMENT_QA_NAME_PATTERN = /\b(QA|Test|Smoke|Disposable)\b/i;
const LIVE_MULTI_SEGMENT_QA_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

function liveQaError(code, message, status = 400) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function normalizeLiveQaRunId(value) {
    const runId = String(value || '').trim();
    return LIVE_MULTI_SEGMENT_QA_RUN_ID_PATTERN.test(runId) ? runId : '';
}

function liveQaMarker(runId) {
    const normalized = normalizeLiveQaRunId(runId);
    if (!normalized) throw liveQaError('LIVE_QA_RUN_ID_INVALID', 'valid live QA runId is required');
    return `live_multi_segment_qa:${normalized}`;
}

function assertLiveQaConfirmation(value) {
    if (String(value || '').trim() !== LIVE_MULTI_SEGMENT_QA_CONFIRMATION) {
        throw liveQaError(
            'LIVE_QA_CONFIRMATION_REQUIRED',
            `confirmation must equal ${LIVE_MULTI_SEGMENT_QA_CONFIRMATION}`,
            403
        );
    }
}

function assertLiveQaStaff(staff, runId) {
    const normalizedRunId = normalizeLiveQaRunId(runId);
    if (!normalizedRunId) throw liveQaError('LIVE_QA_RUN_ID_INVALID', 'valid live QA runId is required');
    if (!staff) throw liveQaError('LIVE_QA_STAFF_NOT_FOUND', 'disposable QA staff was not found', 404);
    const name = String(staff.name || '').trim();
    if (!LIVE_MULTI_SEGMENT_QA_NAME_PATTERN.test(name) || !name.includes(normalizedRunId)) {
        throw liveQaError(
            'LIVE_QA_STAFF_REFUSED',
            'staff name must contain QA/Test/Smoke/Disposable and the exact runId',
            409
        );
    }
    return { ...staff, name };
}

function normalizeLiveQaTime(value) {
    const match = String(value || '').trim().match(/^(\d{2}):([0-5]\d)$/);
    if (!match) return '';
    const hour = Number(match[1]);
    return hour >= 0 && hour <= 23 ? `${match[1]}:${match[2]}` : '';
}

module.exports = {
    LIVE_MULTI_SEGMENT_QA_CONFIRMATION,
    LIVE_MULTI_SEGMENT_QA_VERSION,
    assertLiveQaConfirmation,
    assertLiveQaStaff,
    liveQaError,
    liveQaMarker,
    normalizeLiveQaRunId,
    normalizeLiveQaTime
};
