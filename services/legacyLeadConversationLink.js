'use strict';

const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');

const EXTERNAL_ID_PATTERN = /^omni_conv_(\d+)(?:_op_[a-f0-9]{16})?$/i;

function positiveId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === String(value).trim()
    ? parsed
    : null;
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function idsFromValue(value) {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(values.map(positiveId).filter(Boolean)));
}

function conversationIdsFromRawPayload(rawPayload) {
  const payload = parseJsonObject(rawPayload);
  return Array.from(new Set([
    ...idsFromValue(payload.conversationId),
    ...idsFromValue(payload.conversation_id),
  ]));
}

function conversationIdFromExternalId(externalId) {
  const match = typeof externalId === 'string' ? externalId.match(EXTERNAL_ID_PATTERN) : null;
  return match ? positiveId(match[1]) : null;
}

function leadIdsFromConversationMeta(meta) {
  const safeMeta = parseJsonObject(meta);
  const assistant = parseJsonObject(safeMeta.leadAssistant);
  const crm = parseJsonObject(safeMeta.crm);
  return Array.from(new Set([
    ...idsFromValue(safeMeta.lead_id),
    ...idsFromValue(safeMeta.leadId),
    ...idsFromValue(safeMeta.leadIds),
    ...idsFromValue(safeMeta.lead_ids),
    ...idsFromValue(assistant.leadId),
    ...idsFromValue(assistant.leadIds),
    ...idsFromValue(crm.leadId),
    ...idsFromValue(crm.lead_id),
  ]));
}

function legacyConversationIdsFromLead(lead = {}) {
  return Array.from(new Set([
    conversationIdFromExternalId(lead.external_id),
    ...conversationIdsFromRawPayload(lead.raw_payload),
  ].filter(Boolean)));
}

function evidenceForLead(lead, conversations) {
  const byConversationId = new Map();
  const add = (conversationId, source) => {
    if (!positiveId(conversationId)) return;
    if (!byConversationId.has(conversationId)) byConversationId.set(conversationId, new Set());
    byConversationId.get(conversationId).add(source);
  };
  const externalConversationId = conversationIdFromExternalId(lead.external_id);
  if (externalConversationId) add(externalConversationId, 'lead.external_id');
  for (const conversationId of conversationIdsFromRawPayload(lead.raw_payload)) add(conversationId, 'lead.raw_payload');
  for (const conversation of conversations) {
    if (leadIdsFromConversationMeta(conversation.meta).includes(lead.id)) add(conversation.id, 'conversation.meta');
  }
  return { byConversationId, externalConversationId };
}

function evaluateLegacyLeadConversation({ lead = {}, conversations = [], businessContext } = {}) {
  const context = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
  const evidence = evidenceForLead(lead, conversations);
  const rawConversationIds = conversationIdsFromRawPayload(lead.raw_payload);
  const candidateIds = [...evidence.byConversationId.keys()];

  if (evidence.externalConversationId
      && rawConversationIds.length
      && rawConversationIds.some(id => id !== evidence.externalConversationId)) {
    return {
      status: 'conflict',
      reason: 'lead_external_id_conflicts_with_raw_payload',
      candidateConversationIds: candidateIds,
    };
  }
  if (!candidateIds.length) return { status: 'skipped', reason: 'no_saved_conversation_id' };
  if (candidateIds.length !== 1) {
    return {
      status: 'conflict',
      reason: 'multiple_saved_conversation_ids',
      candidateConversationIds: candidateIds.sort((a, b) => a - b),
    };
  }

  const conversationId = candidateIds[0];
  const conversation = conversations.find(item => Number(item.id) === conversationId);
  if (!conversation) return { status: 'skipped', conversationId, reason: 'conversation_not_found' };
  const conversationContext = normalizeBusinessContext(conversation.business_context || DEFAULT_BUSINESS_CONTEXT);
  if (conversationContext !== context) {
    return { status: 'conflict', conversationId, reason: 'business_context_mismatch' };
  }
  const metaLeadIds = leadIdsFromConversationMeta(conversation.meta);
  if (metaLeadIds.length && !metaLeadIds.includes(lead.id)) {
    return {
      status: 'conflict',
      conversationId,
      reason: 'conversation_metadata_points_to_another_lead',
      metaLeadIds,
    };
  }
  if (lead.source_channel && conversation.channel && lead.source_channel !== conversation.channel) {
    return { status: 'conflict', conversationId, reason: 'channel_mismatch' };
  }
  const evidenceSources = Array.from(evidence.byConversationId.get(conversationId)).sort();
  if (evidenceSources.length < 2) {
    return {
      status: 'skipped',
      conversationId,
      reason: 'insufficient_confirmed_evidence',
      evidence: evidenceSources,
    };
  }
  return {
    status: 'confirmed',
    businessContext: context,
    leadId: lead.id,
    conversationId,
    conversation,
    evidence: evidenceSources,
  };
}

module.exports = {
  EXTERNAL_ID_PATTERN,
  parseJsonObject,
  conversationIdFromExternalId,
  conversationIdsFromRawPayload,
  leadIdsFromConversationMeta,
  legacyConversationIdsFromLead,
  evaluateLegacyLeadConversation,
};
