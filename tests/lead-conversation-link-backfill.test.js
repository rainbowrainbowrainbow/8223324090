'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  planLeadConversationLinkBackfill,
  applyLeadConversationLinkBackfill,
} = require('../services/leadConversationLinkBackfill');

function lead(overrides = {}) {
  return {
    id: 137,
    business_context: 'event_genix',
    source_channel: 'instagram',
    external_id: 'omni_conv_10',
    raw_payload: { conversationId: 10 },
    ...overrides,
  };
}

function conversation(overrides = {}) {
  return {
    id: 10,
    business_context: 'event_genix',
    channel: 'instagram',
    meta: { lead_id: 137, leadIds: [137] },
    ...overrides,
  };
}

test('backfill plans the confirmed НВ-style relationship only from saved IDs', () => {
  const plan = planLeadConversationLinkBackfill({
    businessContext: 'event_genix',
    leads: [lead()],
    conversations: [conversation()],
  });

  assert.deepEqual(plan.ready, [{
    businessContext: 'event_genix',
    leadId: 137,
    conversationId: 10,
    isOrigin: true,
    isPrimary: true,
    source: 'omni_legacy_backfill',
    evidence: ['conversation.meta', 'lead.external_id', 'lead.raw_payload'],
  }]);
  assert.equal(plan.skipped.length, 0);
  assert.equal(plan.conflicts.length, 0);
});

test('backfill skips conflicting, missing, and ambiguous stored IDs without using contact fields', () => {
  const plan = planLeadConversationLinkBackfill({
    businessContext: 'event_genix',
    leads: [
      lead({ id: 1, external_id: 'omni_conv_10', raw_payload: { conversationId: 11 }, phone: '+380000000000', client_name: 'Same name' }),
      lead({ id: 2, external_id: null, raw_payload: { phone: '+380000000000', customerName: 'Same name' } }),
      lead({ id: 3, external_id: 'omni_conv_10', raw_payload: { conversationId: 10 } }),
    ],
    conversations: [
      conversation({ id: 10, meta: { leadIds: [1] } }),
      conversation({ id: 11, meta: { leadIds: [1] } }),
    ],
  });

  assert.deepEqual(plan.conflicts.map(item => item.reason), [
    'lead_external_id_conflicts_with_raw_payload',
    'conversation_metadata_points_to_another_lead',
  ]);
  assert.deepEqual(plan.skipped, [{ leadId: 2, reason: 'no_saved_conversation_id' }]);
  assert.equal(plan.ready.length, 0);
});

test('backfill requires two matching stored references before it changes history', () => {
  const plan = planLeadConversationLinkBackfill({
    businessContext: 'event_genix',
    leads: [lead({ external_id: 'omni_conv_10', raw_payload: {}, phone: '+380000000000' })],
    conversations: [conversation({ meta: {} })],
  });

  assert.deepEqual(plan.skipped, [{
    leadId: 137,
    conversationId: 10,
    reason: 'insufficient_confirmed_evidence',
    evidence: ['lead.external_id'],
  }]);
  assert.equal(plan.ready.length, 0);
});

test('backfill preserves existing canonical choices and its apply phase is idempotent', async () => {
  const plan = planLeadConversationLinkBackfill({
    businessContext: 'event_genix',
    leads: [lead()],
    conversations: [conversation()],
    existingLinks: [{ lead_id: 137, conversation_id: 10, is_origin: true, is_primary: false }],
  });
  assert.deepEqual(plan.alreadyLinked, [{ leadId: 137, conversationId: 10, reason: 'canonical_link_exists' }]);

  const calls = [];
  const applied = await applyLeadConversationLinkBackfill({
    ready: [{ businessContext: 'event_genix', leadId: 137, conversationId: 10, isOrigin: true, isPrimary: true, source: 'omni_legacy_backfill' }],
  }, {
    client: {},
    linkWriter: async candidate => {
      calls.push(candidate);
      return { id: 99 };
    },
  });
  assert.deepEqual(applied, [{ leadId: 137, conversationId: 10, linkId: 99 }]);
  assert.equal(calls.length, 1);
});
