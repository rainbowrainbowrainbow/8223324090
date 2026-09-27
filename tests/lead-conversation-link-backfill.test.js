'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  planLeadConversationLinkBackfill,
  readLeadConversationLinkBackfillPlan,
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

function applyClient({ currentLead = lead(), currentLinks = [], currentConversations = [conversation()] } = {}) {
  return {
    async query(sql) {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/FROM leads/.test(sql) && /FOR UPDATE/.test(sql)) return { rows: currentLead ? [currentLead] : [] };
      if (/FROM lead_conversation_links/.test(sql) && /FOR UPDATE/.test(sql)) return { rows: currentLinks };
      if (/FROM conversations/.test(sql)) return { rows: currentConversations };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('backfill preserves existing canonical choices and repeated apply is idempotent', async () => {
  const plan = planLeadConversationLinkBackfill({
    businessContext: 'event_genix',
    leads: [lead()],
    conversations: [conversation()],
    existingLinks: [{ lead_id: 137, conversation_id: 10, is_origin: true, is_primary: false }],
  });
  assert.deepEqual(plan.alreadyLinked, [{ leadId: 137, conversationId: 10, reason: 'canonical_link_exists' }]);

  const applyPlan = planLeadConversationLinkBackfill({
    businessContext: 'event_genix',
    leads: [lead()],
    conversations: [conversation()],
  });
  const calls = [];
  const applied = await applyLeadConversationLinkBackfill(applyPlan, {
    client: applyClient(),
    approval: applyPlan.approval,
    maxCandidates: 1,
    linkWriter: async candidate => {
      calls.push(candidate);
      return { id: 99 };
    },
  });
  assert.deepEqual(applied.added, [{ leadId: 137, conversationId: 10, linkId: 99 }]);
  assert.deepEqual(applied.totals, { added: 1, alreadyExisted: 0, skipped: 0, conflicts: 0 });
  assert.equal(calls.length, 1);

  const repeated = await applyLeadConversationLinkBackfill(applyPlan, {
    client: applyClient({
      currentLinks: [{ id: 99, conversation_id: 10, is_origin: true, is_primary: true, source: 'omni_legacy_backfill' }],
    }),
    approval: applyPlan.approval,
    maxCandidates: 1,
    linkWriter: async () => { throw new Error('writer must not run for existing links'); },
  });
  assert.deepEqual(repeated.alreadyExisted, [{
    leadId: 137, conversationId: 10, reason: 'canonical_link_exists', linkId: 99,
  }]);
  assert.equal(repeated.added.length, 0);
});

test('stale approved plan skips a new manager link without changing flags or source', async () => {
  const plan = planLeadConversationLinkBackfill({
    businessContext: 'event_genix', leads: [lead()], conversations: [conversation()],
  });
  const result = await applyLeadConversationLinkBackfill(plan, {
    client: applyClient({
      currentLinks: [{ id: 77, conversation_id: 20, is_origin: false, is_primary: true, source: 'lead_workspace_manual' }],
    }),
    approval: plan.approval,
    maxCandidates: 1,
    linkWriter: async () => { throw new Error('stale plan must not write'); },
  });
  assert.deepEqual(result.skipped, [{
    leadId: 137,
    conversationId: 10,
    reason: 'canonical_state_changed_since_dry_run',
    existingConversationIds: [20],
  }]);
  assert.equal(result.complete, true);
});

test('apply rejects incomplete, altered, over-limit, or implicit approval', async () => {
  const plan = planLeadConversationLinkBackfill({
    businessContext: 'event_genix', leads: [lead()], conversations: [conversation()],
  });
  await assert.rejects(applyLeadConversationLinkBackfill(plan, {
    client: applyClient(), maxCandidates: 1,
  }), /verified dry-run approval/);
  await assert.rejects(applyLeadConversationLinkBackfill(plan, {
    client: applyClient(), approval: { ...plan.approval, fingerprint: '0'.repeat(64) }, maxCandidates: 1,
  }), /fingerprint/);
  await assert.rejects(applyLeadConversationLinkBackfill(plan, {
    client: applyClient(), approval: plan.approval, maxCandidates: 0,
  }), /maxCandidates/);
  const incomplete = planLeadConversationLinkBackfill({
    businessContext: 'event_genix',
    leads: [lead()],
    conversations: [conversation()],
    coverage: { complete: false, batches: 1, batchSize: 1, maxLeads: 1, nextLeadId: 138, reason: 'max_leads_reached' },
  });
  await assert.rejects(applyLeadConversationLinkBackfill(incomplete, {
    client: applyClient(), approval: incomplete.approval, maxCandidates: 1,
  }), /complete dry-run scope/);
});

test('dry-run scans in controlled batches and reports an explicit incomplete cap', async () => {
  const rows = Array.from({ length: 7 }, (_, index) => lead({
    id: index + 1,
    external_id: null,
    raw_payload: {},
  }));
  const db = {
    async query(sql, params) {
      if (/FROM leads/.test(sql)) {
        const after = Number(params[1]);
        const limit = Number(params[2] || 1);
        return { rows: rows.filter(row => row.id > after).slice(0, limit) };
      }
      if (/FROM conversations/.test(sql)) return { rows: [] };
      if (/FROM lead_conversation_links/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const complete = await readLeadConversationLinkBackfillPlan({
    businessContext: 'event_genix', batchSize: 3,
  }, db);
  assert.equal(complete.scanned, 7);
  assert.deepEqual(complete.coverage, {
    complete: true, batches: 3, batchSize: 3, maxLeads: null, nextLeadId: null, reason: null,
  });

  const capped = await readLeadConversationLinkBackfillPlan({
    businessContext: 'event_genix', batchSize: 3, maxLeads: 5,
  }, db);
  assert.equal(capped.scanned, 5);
  assert.deepEqual(capped.coverage, {
    complete: false, batches: 2, batchSize: 3, maxLeads: 5, nextLeadId: 6, reason: 'max_leads_reached',
  });
  assert.equal(capped.approval.complete, false);
});

test('operator CLI keeps dry-run default and requires the complete apply envelope', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backfill-lead-conversation-links.js'), 'utf8');
  assert.match(source, /process\.argv\.includes\('--apply'\)/);
  assert.match(source, /--approved-plan/);
  assert.match(source, /--business-context/);
  assert.match(source, /--max-apply/);
  assert.match(source, /APPLY_OMNI_LEAD_CONVERSATION_LINKS/);
  assert.match(source, /OMNI_LINK_BACKFILL_READONLY_DATABASE_URL/);
  assert.match(source, /OMNI_LINK_BACKFILL_DATABASE_URL/);
  assert.doesNotMatch(source, /process\.env\.DATABASE_URL/);
});
