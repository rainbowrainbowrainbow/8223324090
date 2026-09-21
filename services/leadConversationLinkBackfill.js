'use strict';

const { pool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const { linkLeadConversation } = require('./leadConversationLinks');

const EXTERNAL_ID_PATTERN = /^omni_conv_(\d+)(?:_op_[a-f0-9]{16})?$/i;

function positiveId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === String(value).trim()
    ? parsed
    : null;
}

function idsFromValue(value) {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(values.map(positiveId).filter(Boolean)));
}

function conversationIdsFromRawPayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload) ? rawPayload : {};
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
  const safeMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const assistant = safeMeta.leadAssistant && typeof safeMeta.leadAssistant === 'object' && !Array.isArray(safeMeta.leadAssistant)
    ? safeMeta.leadAssistant
    : {};
  const crm = safeMeta.crm && typeof safeMeta.crm === 'object' && !Array.isArray(safeMeta.crm)
    ? safeMeta.crm
    : {};
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

function planLeadConversationLinkBackfill({ leads = [], conversations = [], existingLinks = [], businessContext } = {}) {
  const context = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
  const conversationsById = new Map(conversations.map(conversation => [conversation.id, conversation]));
  const existingByLead = new Map();
  for (const link of existingLinks) {
    if (!existingByLead.has(link.lead_id)) existingByLead.set(link.lead_id, []);
    existingByLead.get(link.lead_id).push(link);
  }

  const plan = {
    businessContext: context,
    scanned: leads.length,
    ready: [],
    alreadyLinked: [],
    skipped: [],
    conflicts: [],
  };

  for (const lead of leads) {
    const leadContext = normalizeBusinessContext(lead.business_context || DEFAULT_BUSINESS_CONTEXT);
    if (leadContext !== context) continue;
    const evidence = evidenceForLead(lead, conversations);
    const rawConversationIds = conversationIdsFromRawPayload(lead.raw_payload);
    const externalConversationId = evidence.externalConversationId;
    const candidateIds = [...evidence.byConversationId.keys()];

    if (externalConversationId && rawConversationIds.length && rawConversationIds.some(id => id !== externalConversationId)) {
      plan.conflicts.push({ leadId: lead.id, reason: 'lead_external_id_conflicts_with_raw_payload', candidateConversationIds: candidateIds });
      continue;
    }
    if (!candidateIds.length) {
      plan.skipped.push({ leadId: lead.id, reason: 'no_saved_conversation_id' });
      continue;
    }
    if (candidateIds.length !== 1) {
      plan.conflicts.push({ leadId: lead.id, reason: 'multiple_saved_conversation_ids', candidateConversationIds: candidateIds.sort((a, b) => a - b) });
      continue;
    }

    const conversationId = candidateIds[0];
    const conversation = conversationsById.get(conversationId);
    if (!conversation) {
      plan.skipped.push({ leadId: lead.id, conversationId, reason: 'conversation_not_found' });
      continue;
    }
    const conversationContext = normalizeBusinessContext(conversation.business_context || DEFAULT_BUSINESS_CONTEXT);
    if (conversationContext !== context) {
      plan.conflicts.push({ leadId: lead.id, conversationId, reason: 'business_context_mismatch' });
      continue;
    }
    const metaLeadIds = leadIdsFromConversationMeta(conversation.meta);
    if (metaLeadIds.length && !metaLeadIds.includes(lead.id)) {
      plan.conflicts.push({ leadId: lead.id, conversationId, reason: 'conversation_metadata_points_to_another_lead', metaLeadIds });
      continue;
    }
    if (lead.source_channel && conversation.channel && lead.source_channel !== conversation.channel) {
      plan.conflicts.push({ leadId: lead.id, conversationId, reason: 'channel_mismatch' });
      continue;
    }
    const evidenceSources = Array.from(evidence.byConversationId.get(conversationId)).sort();
    if (evidenceSources.length < 2) {
      plan.skipped.push({ leadId: lead.id, conversationId, reason: 'insufficient_confirmed_evidence', evidence: evidenceSources });
      continue;
    }

    const knownLinks = existingByLead.get(lead.id) || [];
    if (knownLinks.some(link => link.conversation_id === conversationId)) {
      plan.alreadyLinked.push({ leadId: lead.id, conversationId, reason: 'canonical_link_exists' });
      continue;
    }
    if (knownLinks.length) {
      plan.conflicts.push({
        leadId: lead.id,
        conversationId,
        reason: 'lead_already_has_canonical_link',
        existingConversationIds: knownLinks.map(link => link.conversation_id).sort((a, b) => a - b),
      });
      continue;
    }

    plan.ready.push({
      businessContext: context,
      leadId: lead.id,
      conversationId,
      isOrigin: true,
      isPrimary: true,
      source: 'omni_legacy_backfill',
      evidence: evidenceSources,
    });
  }

  return plan;
}

async function readLeadConversationLinkBackfillPlan(options = {}, db = pool) {
  const businessContext = normalizeBusinessContext(options.businessContext || options.business_context || DEFAULT_BUSINESS_CONTEXT);
  const limit = Math.max(1, Math.min(Number(options.limit) || 500, 5000));
  const leadsResult = await db.query(
    `SELECT id, business_context, source_channel, external_id, raw_payload
       FROM leads
      WHERE COALESCE(business_context, $1) = $1
      ORDER BY id ASC
      LIMIT $2`,
    [businessContext, limit]
  );
  const leads = leadsResult.rows;
  const leadIds = leads.map(lead => lead.id);
  if (!leadIds.length) return planLeadConversationLinkBackfill({ businessContext, leads });

  const conversationResult = await db.query(
    `SELECT id, business_context, channel, meta
       FROM conversations
      WHERE ((COALESCE(business_context, $2) = $2
          AND (meta ? 'lead_id'
            OR meta ? 'leadId'
            OR meta ? 'leadIds'
            OR meta ? 'lead_ids'
            OR meta ? 'leadAssistant'
            OR meta ? 'crm'))
          OR id = ANY($1::bigint[]))`,
    [
      leadIds.flatMap(lead => [
        conversationIdFromExternalId(lead.external_id),
        ...conversationIdsFromRawPayload(lead.raw_payload),
      ]).filter(Boolean),
      businessContext,
    ]
  );
  const existingLinksResult = await db.query(
    `SELECT lead_id, conversation_id, is_origin, is_primary
       FROM lead_conversation_links
      WHERE business_context = $1
        AND lead_id = ANY($2::bigint[])`,
    [businessContext, leadIds]
  );
  return planLeadConversationLinkBackfill({
    businessContext,
    leads,
    conversations: conversationResult.rows,
    existingLinks: existingLinksResult.rows,
  });
}

async function applyLeadConversationLinkBackfill(plan, { client, linkWriter = linkLeadConversation } = {}) {
  if (!client) throw new Error('A transaction client is required to apply Omni lead-conversation backfill');
  const applied = [];
  for (const candidate of plan.ready || []) {
    const link = await linkWriter(candidate, { client });
    applied.push({ leadId: candidate.leadId, conversationId: candidate.conversationId, linkId: link.id });
  }
  return applied;
}

module.exports = {
  EXTERNAL_ID_PATTERN,
  conversationIdFromExternalId,
  conversationIdsFromRawPayload,
  leadIdsFromConversationMeta,
  planLeadConversationLinkBackfill,
  readLeadConversationLinkBackfillPlan,
  applyLeadConversationLinkBackfill,
};
