'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBinotelClient, BinotelCapabilityError } = require('../services/binotel-client');
const { mapCanonicalBinotelCall, BinotelCallMappingError } = require('../services/binotel-call-mapper');

test('Binotel client never falls back to a default business context', async () => {
  let calls = 0;
  const client = createBinotelClient({ runtimeResolver: async () => { calls += 1; return {}; } });
  await assert.rejects(client.listCalls({}), error => {
    assert.equal(error.code, 'BINOTEL_BUSINESS_CONTEXT_REQUIRED');
    return true;
  });
  assert.equal(calls, 0);
});

test('Binotel client returns typed not-configured state without exposing credentials', async () => {
  const client = createBinotelClient({ runtimeResolver: async () => ({ apiKey: 'only-key' }) });
  await assert.rejects(client.listCalls({ businessContext: 'dar' }), error => {
    assert.ok(error instanceof BinotelCapabilityError);
    assert.equal(error.code, 'BINOTEL_NOT_CONFIGURED');
    assert.deepEqual(error.details, { businessContext: 'dar', capability: 'not_configured' });
    assert.doesNotMatch(JSON.stringify(error), /only-key/);
    return true;
  });
});

test('Binotel client preserves account scope but refuses undocumented provider operations', async () => {
  const queried = [];
  const client = createBinotelClient({
    runtimeResolver: async (channel, scope) => {
      queried.push({ channel, scope });
      return { apiKey: 'secret-key', apiSecret: 'legacy-secret', accountId: 'account-a' };
    },
  });
  await assert.rejects(client.listLiveCalls({ businessContext: 'event_genix' }), error => {
    assert.equal(error.code, 'BINOTEL_PROVIDER_CONTRACT_UNAVAILABLE');
    assert.deepEqual(error.details, {
      businessContext: 'event_genix', accountId: 'account-a', operation: 'list_live_calls', capability: 'unsupported_capability',
    });
    assert.doesNotMatch(JSON.stringify(error), /secret-key|legacy-secret/);
    return true;
  });
  assert.deepEqual(queried, [{ channel: 'binotel', scope: { businessContext: 'event_genix' } }]);
});

test('canonical call mapping preserves numeric zero and large string identities', () => {
  const call = mapCanonicalBinotelCall({
    callId: '9223372036854775807',
    direction: 'incoming',
    status: 'completed',
    waitingSeconds: 0,
    talkSeconds: 0,
    recording: { available: false, callRecordId: '0' },
    source: 'provider_history',
    capability: 'unverified',
  }, { businessContext: 'crm', accountId: 'account-a' });
  assert.equal(call.callId, '9223372036854775807');
  assert.equal(call.waitingSeconds, 0);
  assert.equal(call.talkSeconds, 0);
  assert.equal(call.recording.callRecordId, '0');
});

test('canonical call mapping rejects malformed provider-shaped data instead of returning an empty success', () => {
  assert.throws(
    () => mapCanonicalBinotelCall({ callId: Number.MAX_SAFE_INTEGER + 1 }, { businessContext: 'crm' }),
    error => error instanceof BinotelCallMappingError && error.code === 'BINOTEL_CALL_ID_INVALID'
  );
  assert.throws(
    () => mapCanonicalBinotelCall({ callId: 'call-1', talkSeconds: -1 }, { businessContext: 'crm' }),
    error => error instanceof BinotelCallMappingError && error.code === 'BINOTEL_CALL_MALFORMED'
  );
});
