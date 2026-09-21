'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLeadConversationTarget, resolveLeadConversationContext } = require('../services/leadConversationResolver');

const link = (id, overrides = {}) => ({ id, available: true, isOrigin: false, isPrimary: false, ...overrides });

test('lead conversation resolver opens primary and never silently falls through when it is unavailable', () => {
  assert.deepEqual(resolveLeadConversationTarget({
    confirmedLinks: [link(10, { isPrimary: true }), link(11, { isOrigin: true })],
  }), { action: 'open', reason: 'primary', conversationId: 10 });

  assert.deepEqual(resolveLeadConversationTarget({
    confirmedLinks: [link(10, { isPrimary: true, available: false }), link(11, { isOrigin: true })],
  }), { action: 'unavailable', reason: 'primary_unavailable', conversationId: null });
});

test('lead conversation resolver falls back from absent primary to origin and a single confirmed link only', () => {
  assert.deepEqual(resolveLeadConversationTarget({
    confirmedLinks: [link(10, { isOrigin: true })],
  }), { action: 'open', reason: 'origin', conversationId: 10 });

  assert.deepEqual(resolveLeadConversationTarget({
    confirmedLinks: [link(12)],
  }), { action: 'open', reason: 'single_confirmed', conversationId: 12 });
});

test('lead conversation resolver keeps multiple and approximate matches as explicit manager decisions', () => {
  assert.deepEqual(resolveLeadConversationTarget({
    confirmedLinks: [link(10), link(11)],
  }), { action: 'choose', reason: 'multiple_confirmed', conversationId: null });

  assert.deepEqual(resolveLeadConversationTarget({
    suggestions: [{ id: 17, confidence: 'suggested', matches: ['phone'] }],
  }), { action: 'link', reason: 'suggestions_available', conversationId: null });

  assert.deepEqual(resolveLeadConversationTarget({}), {
    action: 'empty', reason: 'no_conversations', conversationId: null,
  });
});

test('lead conversation context exposes confirmed links separately from suggestions', async () => {
  const db = {
    async query(sql) {
      if (/FROM leads/i.test(sql)) {
        return { rows: [{ id: 137, business_context: 'event_genix', client_name: 'НВ', phone: '+380661111111' }] };
      }
      if (/FROM conversations/i.test(sql)) {
        return { rows: [{ id: 27, channel: 'instagram', customer_name: 'НВ', customer_phone: '+380661111111', status: 'open', customer_linked: false }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const context = await resolveLeadConversationContext({ leadId: 137, businessContext: 'event_genix' }, {
    db,
    listConfirmedLinks: async () => [{
      id: 1,
      conversationId: 10,
      channel: 'instagram',
      customerName: 'НВ',
      conversationStatus: 'open',
      lastMessageAt: null,
      isOrigin: true,
      isPrimary: true,
      source: 'omni_lead_manual',
    }],
  });

  assert.equal(context.resolution.action, 'open');
  assert.equal(context.resolution.conversationId, 10);
  assert.deepEqual(context.confirmedLinks.map(link => link.id), [10]);
  assert.deepEqual(context.suggestions.map(link => link.id), [27]);
  assert.equal(context.suggestions[0].confidence, 'suggested');
});
