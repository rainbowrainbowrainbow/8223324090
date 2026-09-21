'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { BinotelCapabilityError } = require('../services/binotel-client');
const { BinotelJournalValidationError, createBinotelJournal, normalizeJournalQuery } = require('../services/binotel-journal');

test('journal query converts inclusive Kyiv dates into UTC half-open boundaries across DST', () => {
  const query = normalizeJournalQuery({ view: 'incoming', startDate: '2026-03-29', endDate: '2026-03-29', limit: '50' });
  assert.equal(query.startAt, '2026-03-28T22:00:00.000Z');
  assert.equal(query.endAt, '2026-03-29T21:00:00.000Z');
  assert.equal(query.limit, 50);
});

test('journal query keeps company and customer number filters separate', () => {
  const query = normalizeJournalQuery({
    view: 'number', startDate: '2026-09-20', endDate: '2026-09-20', companyNumber: '100', customerNumber: '+380000000000', status: 'completed',
  });
  assert.equal(query.companyNumber, '100');
  assert.equal(query.customerNumber, '+380000000000');
  assert.equal(query.status, 'completed');
});

test('journal query rejects unbounded, invalid and oversized requests', () => {
  assert.throws(() => normalizeJournalQuery({ startDate: 'not-a-date', endDate: '2026-09-20' }), BinotelJournalValidationError);
  assert.throws(() => normalizeJournalQuery({ startDate: '2026-01-01', endDate: '2026-03-01' }), BinotelJournalValidationError);
  assert.throws(() => normalizeJournalQuery({ startDate: '2026-09-20', endDate: '2026-09-20', limit: 101 }), BinotelJournalValidationError);
});

test('journal preserves explicit provider capability failure instead of returning empty history', async () => {
  const journal = createBinotelJournal({ clientFactory: () => ({
    listCalls: async () => { throw new BinotelCapabilityError('BINOTEL_PROVIDER_CONTRACT_UNAVAILABLE', 'unavailable'); },
  }) });
  await assert.rejects(
    journal.calls({ businessContext: 'crm' }, { startDate: '2026-09-20', endDate: '2026-09-20' }),
    error => error.code === 'BINOTEL_PROVIDER_CONTRACT_UNAVAILABLE'
  );
});

test('journal returns a complete scoped aggregate only when its provider result is complete', async () => {
  const journal = createBinotelJournal({ clientFactory: () => ({
    listCalls: async ({ businessContext }) => {
      assert.equal(businessContext, 'crm');
      return {
        calls: [
          { direction: 'incoming', status: 'completed', waitingSeconds: 0, talkSeconds: 0 },
          { direction: 'outgoing', status: 'missed', waitingSeconds: null, talkSeconds: 10 },
        ], complete: true, cursor: null,
      };
    },
  }) });
  const result = await journal.summary({ businessContext: 'crm' }, { startDate: '2026-09-20', endDate: '2026-09-20' });
  assert.deepEqual(result.data, { total: 2, incoming: 1, outgoing: 1, missed: 1, averageWaitingSeconds: 0, averageTalkSeconds: 5 });
  assert.equal(result.completeness, 'complete');
});

test('telephony journal routes retain the existing authenticated Omni boundary', () => {
  const routerSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'omnichannel.js'), 'utf8');
  for (const route of ['calls', 'summary', 'live', 'queues']) {
    assert.match(routerSource, new RegExp(`router\\.get\\('/telephony/${route}', auth, async`));
  }
});
