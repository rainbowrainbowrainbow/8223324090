'use strict';

const crypto = require('node:crypto');
const { pool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const { linkLeadConversation, lockLeadConversationLinks } = require('./leadConversationLinks');
const {
  EXTERNAL_ID_PATTERN,
  conversationIdFromExternalId,
  conversationIdsFromRawPayload,
  leadIdsFromConversationMeta,
  legacyConversationIdsFromLead,
  evaluateLegacyLeadConversation,
} = require('./legacyLeadConversationLink');

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;
const MAX_APPLY_CANDIDATES = 5000;

function positiveInteger(value, label, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${label} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

function explicitBusinessContext(value, label = 'businessContext') {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} is required`);
  const normalized = normalizeBusinessContext(raw);
  if (!normalized || normalized !== raw) throw new Error(`${label} is invalid`);
  return normalized;
}

function candidateIdentity(candidate = {}) {
  return {
    leadId: positiveInteger(candidate.leadId ?? candidate.lead_id, 'leadId'),
    conversationId: positiveInteger(candidate.conversationId ?? candidate.conversation_id, 'conversationId'),
  };
}

function candidateKey(candidate) {
  const identity = candidateIdentity(candidate);
  return `${identity.leadId}:${identity.conversationId}`;
}

function approvalPayload(businessContext, candidates) {
  return {
    version: 1,
    businessContext,
    candidates: candidates
      .map(candidateIdentity)
      .sort((left, right) => left.leadId - right.leadId || left.conversationId - right.conversationId),
  };
}

function createBackfillApproval(plan) {
  const businessContext = explicitBusinessContext(plan.businessContext, 'plan.businessContext');
  const payload = approvalPayload(businessContext, plan.ready || []);
  return {
    ...payload,
    candidateCount: payload.candidates.length,
    complete: plan.coverage?.complete === true,
    fingerprint: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

function validateBackfillApproval(plan, approval, maxCandidates) {
  const businessContext = explicitBusinessContext(plan.businessContext, 'plan.businessContext');
  const maximum = positiveInteger(maxCandidates, 'maxCandidates', { max: MAX_APPLY_CANDIDATES });
  if (!approval || approval.version !== 1) throw new Error('A verified dry-run approval is required');
  if (approval.complete !== true || plan.coverage?.complete !== true) {
    throw new Error('Backfill apply requires a complete dry-run scope');
  }
  if (explicitBusinessContext(approval.businessContext, 'approval.businessContext') !== businessContext) {
    throw new Error('Approved business context does not match the plan');
  }
  const approved = approvalPayload(businessContext, approval.candidates || []);
  if (approval.candidateCount !== approved.candidates.length) {
    throw new Error('Approved candidate count does not match the candidate list');
  }
  if (approved.candidates.length > maximum) {
    throw new Error(`Approved candidate count exceeds maxCandidates (${maximum})`);
  }
  const keys = approved.candidates.map(candidateKey);
  if (new Set(keys).size !== keys.length) throw new Error('Approved candidate list contains duplicates');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(approved)).digest('hex');
  if (approval.fingerprint !== fingerprint) throw new Error('Approved candidate fingerprint is invalid');
  const planKeys = (plan.ready || []).map(candidateKey).sort();
  const approvedKeys = [...keys].sort();
  if (JSON.stringify(planKeys) !== JSON.stringify(approvedKeys)) {
    throw new Error('Approved candidates do not exactly match the reviewed dry-run plan');
  }
  return approved.candidates;
}

async function readEvidenceConversations(db, { businessContext, leadIds, conversationIds, lock = false }) {
  if (!leadIds.length && !conversationIds.length) return [];
  const leadIdTexts = leadIds.map(id => String(id));
  const result = await db.query(
    `SELECT id, business_context, channel, meta
       FROM conversations
      WHERE ((COALESCE(business_context, $2) = $2 AND (
             ARRAY_REMOVE(ARRAY[
               meta->>'lead_id',
               meta->>'leadId',
               meta#>>'{leadAssistant,leadId}',
               meta#>>'{crm,leadId}',
               meta#>>'{crm,lead_id}'
             ], NULL) && $3::text[]
             OR EXISTS (
               SELECT 1
                 FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(meta->'leadIds') = 'array' THEN meta->'leadIds'
                        WHEN meta ? 'leadIds' THEN jsonb_build_array(meta->'leadIds')
                        ELSE '[]'::jsonb END
                 ) AS lead_ref(value)
                WHERE lead_ref.value = ANY($3::text[])
             )
             OR EXISTS (
               SELECT 1
                 FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(meta->'lead_ids') = 'array' THEN meta->'lead_ids'
                        WHEN meta ? 'lead_ids' THEN jsonb_build_array(meta->'lead_ids')
                        ELSE '[]'::jsonb END
                 ) AS lead_ref(value)
                WHERE lead_ref.value = ANY($3::text[])
             )
             OR EXISTS (
               SELECT 1
                 FROM jsonb_array_elements_text(
                   CASE WHEN jsonb_typeof(meta#>'{leadAssistant,leadIds}') = 'array' THEN meta#>'{leadAssistant,leadIds}'
                        WHEN meta#>'{leadAssistant,leadIds}' IS NOT NULL THEN jsonb_build_array(meta#>'{leadAssistant,leadIds}')
                        ELSE '[]'::jsonb END
                 ) AS lead_ref(value)
                WHERE lead_ref.value = ANY($3::text[])
             )
          ))
          OR id = ANY($1::bigint[]))
      `,
    [conversationIds, businessContext, leadIdTexts]
  );
  const leadIdSet = new Set(leadIds.map(Number));
  const relevant = result.rows.filter(conversation => (
    conversationIds.includes(Number(conversation.id))
    || leadIdsFromConversationMeta(conversation.meta).some(id => leadIdSet.has(Number(id)))
  ));
  if (!lock || !relevant.length) return relevant;
  const locked = await db.query(
    `SELECT id, business_context, channel, meta
       FROM conversations
      WHERE id = ANY($1::bigint[])
      FOR UPDATE`,
    [relevant.map(conversation => conversation.id)]
  );
  return locked.rows;
}

function planLeadConversationLinkBackfill({
  leads = [], conversations = [], existingLinks = [], businessContext, coverage,
} = {}) {
  const context = normalizeBusinessContext(businessContext || DEFAULT_BUSINESS_CONTEXT);
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
    coverage: coverage || {
      complete: true,
      batches: leads.length ? 1 : 0,
      batchSize: leads.length,
      maxLeads: null,
      nextLeadId: null,
      reason: null,
    },
  };

  for (const lead of leads) {
    const leadContext = normalizeBusinessContext(lead.business_context || DEFAULT_BUSINESS_CONTEXT);
    if (leadContext !== context) continue;
    const evaluation = evaluateLegacyLeadConversation({ lead, conversations, businessContext: context });
    if (evaluation.status !== 'confirmed') {
      const { status, ...detail } = evaluation;
      plan[status === 'conflict' ? 'conflicts' : 'skipped'].push({ leadId: lead.id, ...detail });
      continue;
    }

    const { conversationId, evidence: evidenceSources } = evaluation;

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

  plan.approval = createBackfillApproval(plan);
  return plan;
}

async function readLeadConversationLinkBackfillPlan(options = {}, db = pool) {
  const businessContext = normalizeBusinessContext(options.businessContext || options.business_context || DEFAULT_BUSINESS_CONTEXT);
  const batchSize = options.batchSize === undefined && options.batch_size === undefined
    ? DEFAULT_BATCH_SIZE
    : positiveInteger(options.batchSize ?? options.batch_size, 'batchSize', { max: MAX_BATCH_SIZE });
  const maxLeadsValue = options.maxLeads ?? options.max_leads ?? options.limit;
  const maxLeads = maxLeadsValue === undefined || maxLeadsValue === null || maxLeadsValue === ''
    ? null
    : positiveInteger(maxLeadsValue, 'maxLeads');
  const leads = [];
  let lastLeadId = 0;
  let batches = 0;
  let complete = true;
  let nextLeadId = null;
  while (true) {
    const remaining = maxLeads === null ? batchSize : Math.min(batchSize, maxLeads - leads.length);
    if (remaining <= 0) {
      const more = await db.query(
        `SELECT id
           FROM leads
          WHERE COALESCE(business_context, $1) = $1
            AND id > $2
          ORDER BY id ASC
          LIMIT 1`,
        [businessContext, lastLeadId]
      );
      complete = more.rows.length === 0;
      nextLeadId = more.rows[0]?.id || null;
      break;
    }
    const leadsResult = await db.query(
      `SELECT id, business_context, source_channel, external_id, raw_payload
         FROM leads
        WHERE COALESCE(business_context, $1) = $1
          AND id > $2
        ORDER BY id ASC
        LIMIT $3`,
      [businessContext, lastLeadId, remaining]
    );
    if (!leadsResult.rows.length) break;
    batches += 1;
    leads.push(...leadsResult.rows);
    lastLeadId = Number(leadsResult.rows.at(-1).id);
    if (leadsResult.rows.length < remaining) break;
  }
  const coverage = {
    complete,
    batches,
    batchSize,
    maxLeads,
    nextLeadId,
    reason: complete ? null : 'max_leads_reached',
  };
  const leadIds = leads.map(lead => lead.id);
  if (!leadIds.length) return planLeadConversationLinkBackfill({ businessContext, leads, coverage });

  const conversationIds = leads.flatMap(lead => [
    conversationIdFromExternalId(lead.external_id),
    ...conversationIdsFromRawPayload(lead.raw_payload),
  ]).filter(Boolean);
  const conversations = await readEvidenceConversations(db, {
    businessContext, leadIds, conversationIds,
  });
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
    conversations,
    existingLinks: existingLinksResult.rows,
    coverage,
  });
}

async function revalidateCandidate(client, candidate, businessContext) {
  await lockLeadConversationLinks(client, businessContext, candidate.leadId);
  const leadResult = await client.query(
    `SELECT id, business_context, source_channel, external_id, raw_payload
       FROM leads
      WHERE id = $1
        AND business_context = $2
      FOR UPDATE`,
    [candidate.leadId, businessContext]
  );
  const lead = leadResult.rows[0];
  if (!lead) return { status: 'skipped', reason: 'lead_unavailable_or_business_changed' };

  const currentLinks = (await client.query(
    `SELECT id, conversation_id, is_origin, is_primary, source
       FROM lead_conversation_links
      WHERE business_context = $1
        AND lead_id = $2
      FOR UPDATE`,
    [businessContext, candidate.leadId]
  )).rows;
  const exactLink = currentLinks.find(link => Number(link.conversation_id) === candidate.conversationId);
  if (exactLink) {
    return { status: 'alreadyExisted', reason: 'canonical_link_exists', linkId: exactLink.id };
  }
  if (currentLinks.length) {
    return {
      status: 'skipped',
      reason: 'canonical_state_changed_since_dry_run',
      existingConversationIds: currentLinks.map(link => Number(link.conversation_id)).sort((a, b) => a - b),
    };
  }

  const savedConversationIds = legacyConversationIdsFromLead(lead);
  const conversations = await readEvidenceConversations(client, {
    businessContext,
    leadIds: [candidate.leadId],
    conversationIds: Array.from(new Set([...savedConversationIds, candidate.conversationId])),
    lock: true,
  });
  const evaluation = evaluateLegacyLeadConversation({ lead, conversations, businessContext });
  if (evaluation.status !== 'confirmed') return evaluation;
  if (evaluation.conversationId !== candidate.conversationId) {
    return {
      status: 'conflict',
      reason: 'confirmed_conversation_changed_since_dry_run',
      conversationId: evaluation.conversationId,
    };
  }
  return { status: 'ready', evidence: evaluation.evidence };
}

async function applyLeadConversationLinkBackfill(plan, {
  client, linkWriter = linkLeadConversation, approval, maxCandidates,
} = {}) {
  if (!client) throw new Error('A transaction client is required to apply Omni lead-conversation backfill');
  const businessContext = explicitBusinessContext(plan.businessContext, 'plan.businessContext');
  const approvedCandidates = validateBackfillApproval(plan, approval, maxCandidates);
  const report = {
    businessContext,
    approved: approvedCandidates.length,
    added: [],
    alreadyExisted: [],
    skipped: [],
    conflicts: [],
  };
  for (const approvedCandidate of approvedCandidates) {
    const candidate = { ...approvedCandidate, businessContext };
    const current = await revalidateCandidate(client, candidate, businessContext);
    const detail = { leadId: candidate.leadId, conversationId: candidate.conversationId, reason: current.reason };
    if (current.status === 'alreadyExisted') {
      report.alreadyExisted.push({ ...detail, linkId: current.linkId });
      continue;
    }
    if (current.status === 'conflict') {
      report.conflicts.push({ ...detail });
      continue;
    }
    if (current.status !== 'ready') {
      report.skipped.push({
        ...detail,
        ...(current.existingConversationIds ? { existingConversationIds: current.existingConversationIds } : {}),
      });
      continue;
    }
    const link = await linkWriter({
      businessContext,
      leadId: candidate.leadId,
      conversationId: candidate.conversationId,
      isOrigin: true,
      isPrimary: true,
      source: 'omni_legacy_backfill',
      metadata: { evidence: current.evidence },
    }, { client });
    report.added.push({ leadId: candidate.leadId, conversationId: candidate.conversationId, linkId: link.id });
  }
  report.complete = report.added.length + report.alreadyExisted.length
    + report.skipped.length + report.conflicts.length === approvedCandidates.length;
  report.totals = {
    added: report.added.length,
    alreadyExisted: report.alreadyExisted.length,
    skipped: report.skipped.length,
    conflicts: report.conflicts.length,
  };
  return report;
}

module.exports = {
  EXTERNAL_ID_PATTERN,
  conversationIdFromExternalId,
  conversationIdsFromRawPayload,
  leadIdsFromConversationMeta,
  evaluateLegacyLeadConversation,
  createBackfillApproval,
  validateBackfillApproval,
  planLeadConversationLinkBackfill,
  readLeadConversationLinkBackfillPlan,
  applyLeadConversationLinkBackfill,
};
