'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mapCanonicalBinotelCall, BinotelCallMappingError } = require('../services/binotel-call-mapper');
const { mergeBinotelCallLifecycle } = require('../services/binotel-call-lifecycle');

function call(values = {}, scope = {}) {
  return mapCanonicalBinotelCall({
    callId: '9223372036854775807',
    direction: 'incoming',
    status: 'ringing',
    startedAt: '2026-09-20T08:00:00Z',
    waitingSeconds: 0,
    talkSeconds: null,
    recording: { available: false, callRecordId: null },
    source: 'webhook',
    capability: 'unverified',
    ...values,
  }, { businessContext: 'crm', accountId: 'account-a', ...scope });
}

test('Binotel lifecycle merges start, answer, completion and late recording into one call', () => {
  const started = call();
  const answered = call({ status: 'answered', answeredAt: '2026-09-20T08:00:04Z' });
  const completed = call({ status: 'completed', endedAt: '2026-09-20T08:02:00Z', talkSeconds: 0 });
  const recordingReady = call({ status: 'completed', endedAt: '2026-09-20T08:02:00Z', recording: { available: true, callRecordId: 'record-1' } });
  const result = [answered, completed, recordingReady].reduce(mergeBinotelCallLifecycle, started);
  assert.equal(result.callId, '9223372036854775807');
  assert.equal(result.status, 'completed');
  assert.equal(result.waitingSeconds, 0);
  assert.equal(result.talkSeconds, 0);
  assert.deepEqual(result.recording, { available: true, callRecordId: 'record-1' });
});

test('Binotel lifecycle is idempotent and does not regress a completed call on a delayed active event', () => {
  const completed = call({ status: 'completed', endedAt: '2026-09-20T08:02:00Z', talkSeconds: 12 });
  const duplicate = mergeBinotelCallLifecycle(completed, completed);
  const delayedRinging = call({ status: 'ringing', startedAt: '2026-09-20T08:00:00Z' });
  const result = mergeBinotelCallLifecycle(duplicate, delayedRinging);
  assert.equal(result.status, 'completed');
  assert.equal(result.talkSeconds, 12);
});

test('Binotel lifecycle never merges matching call IDs across businesses or accounts', () => {
  const original = call();
  assert.throws(
    () => mergeBinotelCallLifecycle(original, call({}, { businessContext: 'dar' })),
    error => error instanceof BinotelCallMappingError && error.code === 'BINOTEL_CALL_IDENTITY_MISMATCH'
  );
  assert.throws(
    () => mergeBinotelCallLifecycle(original, call({}, { accountId: 'account-b' })),
    error => error instanceof BinotelCallMappingError && error.code === 'BINOTEL_CALL_IDENTITY_MISMATCH'
  );
  assert.throws(
    () => mergeBinotelCallLifecycle(call({}, { accountId: null }), call({}, { accountId: null })),
    error => error instanceof BinotelCallMappingError && error.code === 'BINOTEL_CALL_IDENTITY_MISMATCH'
  );
});

test('late lifecycle events cannot replace final timestamps or reduce known durations', () => {
  const completed = call({ status: 'completed', endedAt: '2026-09-20T08:02:00Z', waitingSeconds: 8, talkSeconds: 60 });
  const stale = call({ status: 'ringing', startedAt: '2026-09-20T08:00:30Z', endedAt: '2026-09-20T08:01:00Z', waitingSeconds: 0, talkSeconds: 0 });
  const result = mergeBinotelCallLifecycle(completed, stale);
  assert.equal(result.status, 'completed');
  assert.equal(result.startedAt, '2026-09-20T08:00:00.000Z');
  assert.equal(result.endedAt, '2026-09-20T08:02:00.000Z');
  assert.equal(result.waitingSeconds, 8);
  assert.equal(result.talkSeconds, 60);
});

test('missing identity is rejected before lifecycle persistence can choose a synthetic ID', () => {
  assert.throws(
    () => call({ callId: '' }),
    error => error instanceof BinotelCallMappingError && error.code === 'BINOTEL_CALL_ID_INVALID'
  );
});
