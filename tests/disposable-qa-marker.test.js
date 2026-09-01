'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DISPOSABLE_QA_MARKER_MAX_AGE_MS,
    DISPOSABLE_QA_SCHEMA_VERSION,
    DISPOSABLE_QA_SOURCE,
    DISPOSABLE_QA_TIMELINE_SHOWCASE_SOURCE,
    attachDisposableQaMarker,
    createDisposableQaMarker,
    inspectDisposableQaMarker,
    isTrustedDisposableQaSource
} = require('../services/disposableQa');

const RUN_ID = 'task37-marker-contract';
const CUSTOMER_MARKER = `${DISPOSABLE_QA_SOURCE}:${RUN_ID}:test_customer`;
const CREATED_AT = '2026-07-19T08:00:00.000Z';
const NOW_MS = Date.parse('2026-07-19T09:00:00.000Z');

function expectations() {
    return {
        runId: RUN_ID,
        source: DISPOSABLE_QA_SOURCE,
        testCustomerMarker: CUSTOMER_MARKER
    };
}

test('shared disposable QA marker builder produces the canonical contract', () => {
    const marker = createDisposableQaMarker({
        ...expectations(),
        kind: 'banquet_member',
        createdAt: CREATED_AT
    });

    assert.deepEqual(marker, {
        schemaVersion: DISPOSABLE_QA_SCHEMA_VERSION,
        runId: RUN_ID,
        source: DISPOSABLE_QA_SOURCE,
        cleanupExpected: true,
        testCustomerMarker: CUSTOMER_MARKER,
        kind: 'banquet_member',
        createdAt: CREATED_AT
    });
    const inspection = inspectDisposableQaMarker(
        { extra_data: { disposableQa: marker } },
        expectations(),
        { nowMs: NOW_MS }
    );
    assert.equal(inspection.ok, true);
    assert.deepEqual(inspection.reasons, []);
});

test('trusted timeline showcase uses the shared marker and trusted attribution contract', () => {
    const runId = 'timeline-showcase-contract';
    const testCustomerMarker = `${DISPOSABLE_QA_TIMELINE_SHOWCASE_SOURCE}:${runId}:test_customer`;
    const marker = createDisposableQaMarker({
        runId,
        source: DISPOSABLE_QA_TIMELINE_SHOWCASE_SOURCE,
        testCustomerMarker,
        kind: 'booking',
        createdAt: CREATED_AT
    });

    assert.equal(marker.source, DISPOSABLE_QA_TIMELINE_SHOWCASE_SOURCE);
    assert.equal(isTrustedDisposableQaSource(marker.source), true);
    assert.equal(isTrustedDisposableQaSource('trusted_qa'), true);
    assert.equal(isTrustedDisposableQaSource('timeline_browser_smoke'), false);
    assert.equal(inspectDisposableQaMarker(
        { disposableQa: marker },
        { runId, source: DISPOSABLE_QA_TIMELINE_SHOWCASE_SOURCE, testCustomerMarker },
        { nowMs: NOW_MS }
    ).ok, true);
});

test('shared disposable QA marker validator fails closed for mismatch, missing fields, and expiry', () => {
    const valid = createDisposableQaMarker({
        ...expectations(),
        kind: 'booking',
        createdAt: CREATED_AT
    });
    const mismatched = inspectDisposableQaMarker({
        disposableQa: {
            ...valid,
            schemaVersion: 99,
            runId: 'wrong-run',
            source: 'wrong_source',
            cleanupExpected: false,
            testCustomerMarker: 'wrong-customer',
            kind: '',
            createdAt: 'invalid'
        }
    }, expectations(), { nowMs: NOW_MS });

    assert.equal(mismatched.ok, false);
    assert.deepEqual(mismatched.reasons, [
        'unsupported_schema_version',
        'run_id_mismatch',
        'unsupported_source',
        'source_mismatch',
        'cleanup_expected_missing',
        'test_customer_marker_mismatch',
        'kind_missing',
        'created_at_invalid'
    ]);

    const expired = inspectDisposableQaMarker(
        { disposableQa: valid },
        expectations(),
        { nowMs: Date.parse(CREATED_AT) + DISPOSABLE_QA_MARKER_MAX_AGE_MS + 1 }
    );
    assert.equal(expired.ok, false);
    assert.deepEqual(expired.reasons, ['marker_expired']);
});

test('shared marker attachment preserves existing extra data without keeping snake-case duplicates', () => {
    const booking = {
        extra_data: {
            bookingPackage: { schemaVersion: 2 }
        }
    };
    attachDisposableQaMarker(booking, {
        ...expectations(),
        kind: 'linked_booking',
        createdAt: CREATED_AT
    });

    assert.equal(Object.prototype.hasOwnProperty.call(booking, 'extra_data'), false);
    assert.equal(booking.extraData.bookingPackage.schemaVersion, 2);
    assert.equal(booking.extraData.disposableQa.kind, 'linked_booking');
});
