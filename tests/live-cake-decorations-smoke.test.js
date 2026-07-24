'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleCandidateTimes, safeBookingPayload, QA_CLEANUP_SOURCE } = require('../scripts/live-cake-decorations-smoke');
const { inspectDisposableQaMarker } = require('../services/disposableQa');

test('cake live smoke candidates start at EventGenix opening and respect duration', () => {
    const weekday = scheduleCandidateTimes('2026-07-27', 60, null);
    const weekend = scheduleCandidateTimes('2026-07-25', 60, null);
    assert.equal(weekday[0], '12:00');
    assert.equal(weekday.at(-1), '19:00');
    assert.equal(weekend[0], '10:00');
    assert.equal(weekend.at(-1), '19:00');
});

test('cake live smoke rejects invalid time override before booking creation', () => {
    assert.throws(() => scheduleCandidateTimes('2026-07-27', 60, ['09:00']), /out-of-hours/);
    assert.throws(() => scheduleCandidateTimes('2026-07-25', 90, ['19:00']), /out-of-hours/);
    assert.throws(() => scheduleCandidateTimes('2026-07-25', 700, null), /exceeds/);
});

test('cake live smoke payload carries exact disposable QA marker', () => {
    const payload = safeBookingPayload({ date: '2026-07-27', time: '12:00', room: 'Room A' }, [{
        productId: 'cake_decor_sweets', title: 'Cake', quantity: 1, unitPrice: 950, subtotal: 950
    }], { user: { username: 'qa' } });
    const marker = payload.extraData.disposableQa;
    const inspection = inspectDisposableQaMarker(payload, {
        runId: marker.runId, source: QA_CLEANUP_SOURCE, testCustomerMarker: marker.testCustomerMarker
    });
    assert.equal(inspection.ok, true);
    assert.equal(marker.cleanupExpected, true);
});
