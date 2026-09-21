'use strict';

const { pool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const { listLeadConversationLinks } = require('./leadConversationLinks');
const { deriveReplySlaState, isActiveWaitingReply } = require('./replySla');
const { getOmniAccountStatus } = require('./omni-accounts');

function positiveId(value, label) {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error(`Некоректний ${label}`);
    error.status = 400;
    error.code = 'LEAD_CONVERSATION_INVALID_ID';
    throw error;
  }
  return id;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function mapConfirmedLink(link, { available = true, businessContext } = {}) {
  const replyRow = {
    reply_expected: link.replyExpected,
    awaiting_reply_since: link.awaitingReplySince,
    reply_sla_at: link.replySlaAt,
    last_inbound_at: link.lastInboundAt,
    reply_expected_delivery_status: link.replyDeliveryStatus,
  };
  const account = available && link.channel
    ? getOmniAccountStatus(link.channel, { businessContext })
    : null;
  return {
    id: available ? link.conversationId : null,
    channel: available ? link.channel : null,
    customerName: available ? link.customerName : null,
    customerPhone: available ? link.customerPhone : null,
    customerId: available ? link.customerId : null,
    status: available ? link.conversationStatus : null,
    lastMessageAt: available ? link.lastMessageAt : null,
    assignedTo: available ? link.assignedTo : null,
    unreadCount: available ? link.unreadCount : 0,
    lastInboundAt: available ? link.lastInboundAt : null,
    lastOutboundAt: available ? link.lastOutboundAt : null,
    replyExpected: available ? link.replyExpected : false,
    awaitingReplySince: available ? link.awaitingReplySince : null,
    replyExpectedMessageId: available ? link.replyExpectedMessageId : null,
    replyOwner: available ? link.replyOwner : null,
    replyOwnerUserId: available ? link.replyOwnerUserId : null,
    replySlaAt: available ? link.replySlaAt : null,
    replyDeliveryStatus: available ? link.replyDeliveryStatus : null,
    lastMessage: available ? link.lastMessage : null,
    replySlaState: available ? deriveReplySlaState(replyRow) : 'none',
    waitingReply: available ? isActiveWaitingReply(replyRow) : false,
    isOrigin: link.isOrigin,
    isPrimary: link.isPrimary,
    source: link.source,
    businessAccountName: available ? (account?.accountName || null) : null,
    available,
    confidence: 'confirmed',
  };
}

function resolveLeadConversationTarget({ confirmedLinks = [], suggestions = [] } = {}) {
  const primary = confirmedLinks.find(link => link.isPrimary);
  if (primary) {
    if (!primary.available) return { action: 'unavailable', reason: 'primary_unavailable', conversationId: null };
    return { action: 'open', reason: 'primary', conversationId: primary.id };
  }

  const origin = confirmedLinks.find(link => link.isOrigin);
  if (origin) {
    if (!origin.available) return { action: 'unavailable', reason: 'origin_unavailable', conversationId: null };
    return { action: 'open', reason: 'origin', conversationId: origin.id };
  }

  const available = confirmedLinks.filter(link => link.available);
  if (available.length === 1) return { action: 'open', reason: 'single_confirmed', conversationId: available[0].id };
  if (available.length > 1) return { action: 'choose', reason: 'multiple_confirmed', conversationId: null };
  if (confirmedLinks.length) return { action: 'unavailable', reason: 'confirmed_unavailable', conversationId: null };
  if (suggestions.length) return { action: 'link', reason: 'suggestions_available', conversationId: null };
  return { action: 'empty', reason: 'no_conversations', conversationId: null };
}

function mapSuggestion(row, lead) {
  const phoneDigits = normalizeDigits(lead.phone);
  const customerLinked = row.customer_linked === true;
  const phoneMatched = Boolean(phoneDigits && normalizeDigits(row.customer_phone) === phoneDigits);
  const nameMatched = Boolean(lead.client_name && row.customer_name && String(row.customer_name).toLowerCase().includes(String(lead.client_name).toLowerCase()));
  return {
    id: row.id,
    channel: row.channel,
    customerName: row.customer_name || null,
    status: row.status || null,
    lastMessageAt: row.last_message_at || null,
    matches: [
      customerLinked ? 'customer_link' : null,
      phoneMatched ? 'phone' : null,
      nameMatched ? 'name' : null,
    ].filter(Boolean),
    confidence: 'suggested',
  };
}

async function findLeadForConversationContext(db, leadId, businessContext) {
  const result = await db.query(
    `SELECT id, business_context, client_name, phone
       FROM leads
      WHERE id = $1
        AND COALESCE(business_context, $2) = $2
      LIMIT 1`,
    [leadId, businessContext]
  );
  return result.rows[0] || null;
}

async function listConversationSuggestions(db, lead, businessContext, limit) {
  const phoneDigits = normalizeDigits(lead.phone);
  const namePattern = lead.client_name ? `%${String(lead.client_name).trim()}%` : '';
  const result = await db.query(
    `SELECT c.id, c.channel, c.customer_name, c.customer_phone, c.status, c.last_message_at,
            EXISTS (
              SELECT 1
                FROM lead_customer_links lcl
               WHERE lcl.lead_id = $1
                 AND lcl.customer_id = c.customer_id
                 AND COALESCE(lcl.business_context, $4) = $4
            ) AS customer_linked
      FROM conversations c
      WHERE COALESCE(c.business_context, $4) = $4
        AND NOT EXISTS (
          SELECT 1
            FROM lead_conversation_links confirmed
           WHERE confirmed.business_context = $4
             AND confirmed.lead_id = $1
             AND confirmed.conversation_id = c.id
        )
        AND (
          EXISTS (
            SELECT 1
              FROM lead_customer_links lcl
             WHERE lcl.lead_id = $1
               AND lcl.customer_id = c.customer_id
               AND COALESCE(lcl.business_context, $4) = $4
          )
          OR ($2 <> '' AND regexp_replace(COALESCE(c.customer_phone, ''), '\\D', '', 'g') = $2)
          OR ($3 <> '' AND c.customer_name ILIKE $3)
        )
      ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC, c.id DESC
      LIMIT $5`,
    [lead.id, phoneDigits, namePattern, businessContext, limit]
  );
  return result.rows.map(row => mapSuggestion(row, lead));
}

async function resolveLeadConversationContext(input = {}, options = {}) {
  const db = options.db || pool;
  const leadId = positiveId(input.leadId ?? input.lead_id, 'ID ліда');
  const businessContext = normalizeBusinessContext(input.businessContext || input.business_context || DEFAULT_BUSINESS_CONTEXT)
    || DEFAULT_BUSINESS_CONTEXT;
  const omniAvailable = input.omniAvailable !== false;
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 50));
  const providedLead = input.lead && typeof input.lead === 'object' ? input.lead : null;
  const lead = providedLead && Number(providedLead.id) === leadId
    && normalizeBusinessContext(providedLead.business_context || providedLead.businessContext || businessContext) === businessContext
    ? providedLead
    : await findLeadForConversationContext(db, leadId, businessContext);
  if (!lead) {
    const error = new Error('Лід не знайдено');
    error.status = 404;
    error.code = 'LEAD_NOT_FOUND';
    throw error;
  }

  const listConfirmedLinks = options.listConfirmedLinks || listLeadConversationLinks;
  const links = await listConfirmedLinks({ businessContext, leadId }, { db });
  const confirmedLinks = links.map(link => mapConfirmedLink(link, {
    available: omniAvailable,
    businessContext,
  }));
  const suggestions = omniAvailable ? await listConversationSuggestions(db, lead, businessContext, limit) : [];
  return {
    leadId,
    businessContext,
    confirmedLinks,
    suggestions,
    resolution: resolveLeadConversationTarget({ confirmedLinks, suggestions }),
  };
}

module.exports = {
  mapConfirmedLink,
  resolveLeadConversationTarget,
  resolveLeadConversationContext,
};
