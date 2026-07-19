'use strict';

const DISPOSABLE_QA_SCHEMA_VERSION = 1;
const DISPOSABLE_QA_SOURCE = 'timeline_browser_smoke';
const DISPOSABLE_QA_MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DISPOSABLE_QA_FUTURE_SKEW_MS = 5 * 60 * 1000;
const DISPOSABLE_QA_SUPPORTED_SOURCES = Object.freeze([DISPOSABLE_QA_SOURCE]);

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

function disposableQaMarkerFrom(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const extra = Object.prototype.hasOwnProperty.call(source, 'extra_data')
        || Object.prototype.hasOwnProperty.call(source, 'extraData')
        ? safeJsonObject(source.extra_data ?? source.extraData)
        : safeJsonObject(source);
    const marker = extra.disposableQa || extra.disposable_qa || {};
    return marker && typeof marker === 'object' && !Array.isArray(marker) ? marker : {};
}

function cleanMarkerText(value) {
    return String(value || '').trim();
}

function normalizeMarker(marker = {}) {
    return {
        schemaVersion: Number(marker.schemaVersion ?? marker.schema_version) || null,
        runId: cleanMarkerText(marker.runId ?? marker.run_id) || null,
        source: cleanMarkerText(marker.source) || null,
        cleanupExpected: marker.cleanupExpected ?? marker.cleanup_expected ?? null,
        testCustomerMarker: cleanMarkerText(marker.testCustomerMarker ?? marker.test_customer_marker) || null,
        kind: cleanMarkerText(marker.kind) || null,
        createdAt: cleanMarkerText(marker.createdAt ?? marker.created_at) || null
    };
}

function validDateMs(value) {
    const ms = Date.parse(String(value || ''));
    return Number.isFinite(ms) ? ms : null;
}

function inspectDisposableQaMarker(value = {}, expectations = {}, clock = {}) {
    const marker = normalizeMarker(disposableQaMarkerFrom(value));
    const reasons = [];
    const nowMs = Number.isFinite(Number(clock.nowMs)) ? Number(clock.nowMs) : Date.now();
    const maxAgeMs = Number.isFinite(Number(clock.maxAgeMs))
        ? Number(clock.maxAgeMs)
        : DISPOSABLE_QA_MARKER_MAX_AGE_MS;
    const futureSkewMs = Number.isFinite(Number(clock.futureSkewMs))
        ? Number(clock.futureSkewMs)
        : DISPOSABLE_QA_FUTURE_SKEW_MS;

    if (!marker.runId) reasons.push('missing_marker');
    if (marker.schemaVersion !== DISPOSABLE_QA_SCHEMA_VERSION) reasons.push('unsupported_schema_version');
    if (marker.runId !== cleanMarkerText(expectations.runId)) reasons.push('run_id_mismatch');
    if (!DISPOSABLE_QA_SUPPORTED_SOURCES.includes(marker.source)) reasons.push('unsupported_source');
    if (marker.source !== cleanMarkerText(expectations.source || DISPOSABLE_QA_SOURCE)) reasons.push('source_mismatch');
    if (marker.cleanupExpected !== true) reasons.push('cleanup_expected_missing');
    if (!marker.testCustomerMarker) reasons.push('test_customer_marker_missing');
    if (marker.testCustomerMarker !== cleanMarkerText(expectations.testCustomerMarker)) {
        reasons.push('test_customer_marker_mismatch');
    }
    if (!marker.kind) reasons.push('kind_missing');

    const createdAtMs = validDateMs(marker.createdAt);
    if (createdAtMs === null) {
        reasons.push('created_at_invalid');
    } else {
        if (createdAtMs > nowMs + futureSkewMs) reasons.push('created_at_in_future');
        if (nowMs - createdAtMs > maxAgeMs) reasons.push('marker_expired');
    }

    return {
        ok: reasons.length === 0,
        reasons: [...new Set(reasons)],
        marker,
        createdAtMs,
        ageMs: createdAtMs === null ? null : nowMs - createdAtMs
    };
}

function createDisposableQaMarker(options = {}) {
    const runId = cleanMarkerText(options.runId);
    const source = cleanMarkerText(options.source || DISPOSABLE_QA_SOURCE);
    const testCustomerMarker = cleanMarkerText(options.testCustomerMarker);
    const kind = cleanMarkerText(options.kind);
    const createdAt = cleanMarkerText(options.createdAt || new Date().toISOString());
    const marker = {
        schemaVersion: DISPOSABLE_QA_SCHEMA_VERSION,
        runId,
        source,
        cleanupExpected: true,
        testCustomerMarker,
        kind,
        createdAt
    };
    const inspection = inspectDisposableQaMarker(
        { disposableQa: marker },
        { runId, source, testCustomerMarker },
        {
            nowMs: validDateMs(createdAt),
            maxAgeMs: DISPOSABLE_QA_MARKER_MAX_AGE_MS,
            futureSkewMs: DISPOSABLE_QA_FUTURE_SKEW_MS
        }
    );
    if (!inspection.ok) {
        throw new Error(`Invalid disposable QA marker: ${inspection.reasons.join(',')}`);
    }
    return marker;
}

function attachDisposableQaMarker(target, options = {}) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return target;
    const extra = target.extraData && typeof target.extraData === 'object' && !Array.isArray(target.extraData)
        ? { ...target.extraData }
        : (
            target.extra_data && typeof target.extra_data === 'object' && !Array.isArray(target.extra_data)
                ? { ...target.extra_data }
                : {}
        );
    extra.disposableQa = createDisposableQaMarker(options);
    target.extraData = extra;
    delete target.extra_data;
    return target;
}

module.exports = {
    DISPOSABLE_QA_FUTURE_SKEW_MS,
    DISPOSABLE_QA_MARKER_MAX_AGE_MS,
    DISPOSABLE_QA_SCHEMA_VERSION,
    DISPOSABLE_QA_SOURCE,
    DISPOSABLE_QA_SUPPORTED_SOURCES,
    attachDisposableQaMarker,
    createDisposableQaMarker,
    disposableQaMarkerFrom,
    inspectDisposableQaMarker,
    normalizeMarker,
    safeJsonObject
};
