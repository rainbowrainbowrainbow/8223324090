'use strict';

const { pool } = require('../db');
const { generateChatResponse } = require('./kleshnya-chat');
const { getWSS } = require('./websocket');
const { sendTelegramMessage } = require('./telegram');
const { createLogger } = require('../utils/logger');

const { sendViber } = require('./omni-viber');
const { sendSMS } = require('./omni-sms');
const { sendFacebook } = require('./omni-facebook');
const { sendInstagram } = require('./omni-instagram');
const {
  booleanValue,
  deriveReplySlaState,
  isActiveWaitingReply,
  isDeliveryFailed: failedDeliveryStatus,
} = require('./replySla');
const { closeReplyEscalationForMessage } = require('./replyEscalation');

const logger = createLogger('omni-hub');

const VALID_CHANNELS = ['telegram', 'viber', 'sms', 'facebook', 'instagram', 'binotel'];
const VALID_STATUSES = ['open', 'closed', 'pending', 'spam'];
const INBOUND_ONLY_CHANNELS = new Set(['binotel']);
const DELIVERY_STATUS = Object.freeze({
  SAVED: 'saved',
  ATTEMPTED: 'attempted',
  ACCEPTED: 'accepted',
  DELIVERED: 'delivered',
  READ: 'read',
  FAILED: 'failed',
  LATER_FAILED: 'later_failed',
  UNKNOWN: 'unknown',
});
const LIFECYCLE_SUPPORTED_CHANNELS = new Set(['viber', 'sms']);
const MAX_NAME_LEN = 255;
const MAX_SEARCH_LEN = 255;

class ChannelUnavailableError extends Error {
  constructor(channel) {
    super(`Channel ${channel || 'unknown'} is not send-capable`);
    this.code = 'CHANNEL_UNAVAILABLE';
    this.statusCode = 400;
    this.sendTruth = buildSendTruth('channel_unavailable', {
      channel,
      savedInCrm: false,
      providerAttempted: false,
      providerAccepted: false,
      error: 'Канал недоступний для відправки з CRM',
    });
  }
}

function safeTruncate(str, maxLen) {
  if (!str || typeof str !== 'string') return str;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function normalizeOptionalTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeReplyExpectationOptions(options = {}) {
  const replyExpected = booleanValue(options.replyExpected ?? options.reply_expected);
  if (!replyExpected) {
    return { replyExpected: false, replyOwner: null, replySlaAt: null };
  }

  return {
    replyExpected: true,
    replyOwner: safeTruncate(String(options.replyOwner || options.reply_owner || '').trim(), 100) || null,
    replySlaAt: normalizeOptionalTimestamp(options.replySlaAt || options.reply_sla_at),
  };
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeChannel(channel) {
  return String(channel || '').toLowerCase();
}

function isSendCapableChannel(channel) {
  const normalized = normalizeChannel(channel);
  return VALID_CHANNELS.includes(normalized) && !INBOUND_ONLY_CHANNELS.has(normalized);
}

function sendTruthMessage(status, details = {}) {
  const channelLabel = details.channel ? String(details.channel) : 'канал';
  const error = details.error ? ` Причина: ${details.error}` : '';
  switch (status) {
    case 'saved':
      return 'Повідомлення збережено в CRM. Зовнішня доставка ще не підтверджена.';
    case 'provider_attempted':
      return 'Повідомлення збережено в CRM. Провайдер прийняв запит, але фінальна доставка у v1 не підтверджується.';
    case 'provider_delivered':
      return 'Повідомлення доставлено за підтвердженням провайдера.';
    case 'provider_read':
      return 'Провайдер підтвердив перегляд повідомлення.';
    case 'provider_failed_immediate':
      return `Повідомлення збережено в CRM, але ${channelLabel} одразу відхилив або не прийняв відправку.${error}`;
    case 'provider_failed_later':
      return `Провайдер спершу прийняв запит, але пізніше повідомив про недоставку.${error}`;
    case 'provider_unknown':
      return `Повідомлення збережено в CRM. Статус ${channelLabel} невідомий, тому доставку не можна вважати підтвердженою.${error}`;
    case 'channel_unavailable':
      return `${channelLabel} доступний лише для перегляду або не налаштований для відправки з CRM.`;
    default:
      return 'Стан відправки невідомий. Не вважайте повідомлення доставленим без підтвердження.';
  }
}

function buildSendTruth(status, details = {}) {
  return {
    version: 1,
    status,
    channel: details.channel || null,
    savedInCrm: details.savedInCrm !== false,
    providerAttempted: details.providerAttempted === true,
    providerAccepted: details.providerAccepted ?? null,
    deliveryConfirmed: details.deliveryConfirmed === true,
    providerReference: details.providerReference || null,
    lifecycleStatus: details.lifecycleStatus || null,
    providerLifecycleAt: details.providerLifecycleAt || null,
    providerLifecycleEvent: details.providerLifecycleEvent || null,
    providerLifecycleSource: details.providerLifecycleSource || null,
    error: details.error || null,
    message: details.message || sendTruthMessage(status, details),
  };
}

function providerError(delivery) {
  return delivery?.error || delivery?.description || delivery?.status_message || delivery?.response_status || null;
}

function providerReference(delivery) {
  return delivery?.messageId
    || delivery?.messageToken
    || delivery?.commentId
    || delivery?.result?.message_id
    || delivery?.result?.messageId
    || null;
}

function normalizeProviderResult(channel, delivery) {
  const normalized = normalizeChannel(channel);

  if (!isSendCapableChannel(normalized)) {
    return buildSendTruth('channel_unavailable', {
      channel: normalized,
      savedInCrm: false,
      providerAttempted: false,
      providerAccepted: false,
    });
  }

  if (delivery && (delivery.success === true || delivery.ok === true)) {
    return buildSendTruth('provider_attempted', {
      channel: normalized,
      providerAttempted: true,
      providerAccepted: true,
      providerReference: providerReference(delivery),
    });
  }

  if (delivery && (delivery.success === false || delivery.ok === false)) {
    return buildSendTruth('provider_failed_immediate', {
      channel: normalized,
      providerAttempted: true,
      providerAccepted: false,
      error: providerError(delivery),
    });
  }

  return buildSendTruth('provider_unknown', {
    channel: normalized,
    providerAttempted: true,
    providerAccepted: null,
    error: providerError(delivery) || 'Провайдер не повернув однозначний immediate-result',
  });
}

// ---------------------------------------------------------------------------
// Helpers: snake_case DB rows → camelCase API objects
// ---------------------------------------------------------------------------

function deliveryStatusFromSendTruth(sendTruth) {
  switch (sendTruth?.status) {
    case 'saved':
      return DELIVERY_STATUS.SAVED;
    case 'provider_attempted':
      return DELIVERY_STATUS.ACCEPTED;
    case 'provider_delivered':
      return DELIVERY_STATUS.DELIVERED;
    case 'provider_read':
      return DELIVERY_STATUS.READ;
    case 'provider_failed_immediate':
    case 'channel_unavailable':
      return DELIVERY_STATUS.FAILED;
    case 'provider_failed_later':
      return DELIVERY_STATUS.LATER_FAILED;
    case 'provider_unknown':
      return DELIVERY_STATUS.UNKNOWN;
    default:
      return DELIVERY_STATUS.UNKNOWN;
  }
}

function attemptedDeliveryStatus(deliveryStatus) {
  return [
    DELIVERY_STATUS.ATTEMPTED,
    DELIVERY_STATUS.ACCEPTED,
    DELIVERY_STATUS.DELIVERED,
    DELIVERY_STATUS.READ,
    DELIVERY_STATUS.FAILED,
    DELIVERY_STATUS.LATER_FAILED,
    DELIVERY_STATUS.UNKNOWN,
  ].includes(deliveryStatus);
}

function lifecycleDeliveryStatus(deliveryStatus) {
  return [
    DELIVERY_STATUS.DELIVERED,
    DELIVERY_STATUS.READ,
    DELIVERY_STATUS.LATER_FAILED,
  ].includes(deliveryStatus);
}

function sendTruthStatusFromDeliveryStatus(deliveryStatus) {
  switch (deliveryStatus) {
    case DELIVERY_STATUS.DELIVERED:
      return 'provider_delivered';
    case DELIVERY_STATUS.READ:
      return 'provider_read';
    case DELIVERY_STATUS.LATER_FAILED:
      return 'provider_failed_later';
    case DELIVERY_STATUS.FAILED:
      return 'provider_failed_immediate';
    case DELIVERY_STATUS.ACCEPTED:
      return 'provider_attempted';
    case DELIVERY_STATUS.SAVED:
      return 'saved';
    default:
      return 'provider_unknown';
  }
}

function sendTruthFromDurableRow(row) {
  if (!row || !row.delivery_status) return null;

  switch (row.delivery_status) {
    case DELIVERY_STATUS.SAVED:
      return buildSendTruth('saved', {
        providerAttempted: false,
        providerAccepted: null,
        providerReference: row.provider_message_id || null,
        error: row.delivery_error || null,
      });
    case DELIVERY_STATUS.ACCEPTED:
      return buildSendTruth('provider_attempted', {
        providerAttempted: true,
        providerAccepted: true,
        providerReference: row.provider_message_id || null,
        error: row.delivery_error || null,
      });
    case DELIVERY_STATUS.DELIVERED:
      return buildSendTruth('provider_delivered', {
        providerAttempted: true,
        providerAccepted: true,
        deliveryConfirmed: true,
        providerReference: row.provider_message_id || null,
        lifecycleStatus: row.delivery_status,
        providerLifecycleAt: row.provider_lifecycle_at || null,
        providerLifecycleEvent: row.provider_lifecycle_event || null,
        providerLifecycleSource: row.provider_lifecycle_source || null,
        error: row.delivery_error || null,
      });
    case DELIVERY_STATUS.READ:
      return buildSendTruth('provider_read', {
        providerAttempted: true,
        providerAccepted: true,
        deliveryConfirmed: true,
        providerReference: row.provider_message_id || null,
        lifecycleStatus: row.delivery_status,
        providerLifecycleAt: row.provider_lifecycle_at || null,
        providerLifecycleEvent: row.provider_lifecycle_event || null,
        providerLifecycleSource: row.provider_lifecycle_source || null,
        error: row.delivery_error || null,
      });
    case DELIVERY_STATUS.FAILED:
      return buildSendTruth('provider_failed_immediate', {
        providerAttempted: true,
        providerAccepted: false,
        providerReference: row.provider_message_id || null,
        error: row.delivery_error || null,
      });
    case DELIVERY_STATUS.LATER_FAILED:
      return buildSendTruth('provider_failed_later', {
        providerAttempted: true,
        providerAccepted: true,
        providerReference: row.provider_message_id || null,
        lifecycleStatus: row.delivery_status,
        providerLifecycleAt: row.provider_lifecycle_at || null,
        providerLifecycleEvent: row.provider_lifecycle_event || null,
        providerLifecycleSource: row.provider_lifecycle_source || null,
        error: row.delivery_error || null,
      });
    case DELIVERY_STATUS.ATTEMPTED:
    case DELIVERY_STATUS.UNKNOWN:
      return buildSendTruth('provider_unknown', {
        providerAttempted: true,
        providerAccepted: null,
        providerReference: row.provider_message_id || null,
        error: row.delivery_error || null,
      });
    default:
      return null;
  }
}

function mergeSendTruthMeta(row) {
  const meta = row?.meta || {};
  if (meta.sendTruth && !lifecycleDeliveryStatus(row?.delivery_status)) return meta;

  const sendTruth = sendTruthFromDurableRow(row);
  return sendTruth ? { ...meta, sendTruth } : meta;
}

function mapConversationRow(row) {
  if (!row) return null;
  const replyExpected = booleanValue(row.reply_expected);
  const waitingReply = isActiveWaitingReply(row);
  const replySlaState = deriveReplySlaState(row);
  return {
    id: row.id,
    channel: row.channel,
    externalId: row.external_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerId: row.customer_id,
    status: row.status,
    assignedTo: row.assigned_to,
    lastMessageAt: row.last_message_at,
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    replyExpected,
    awaitingReplySince: row.awaiting_reply_since || null,
    replyExpectedMessageId: row.reply_expected_message_id || null,
    replyOwner: row.reply_owner || null,
    replySlaAt: row.reply_sla_at || null,
    replySlaState,
    waitingReply,
    replyExpectation: {
      expected: replyExpected,
      active: waitingReply,
      awaitingReplySince: row.awaiting_reply_since || null,
      expectedMessageId: row.reply_expected_message_id || null,
      owner: row.reply_owner || null,
      slaAt: row.reply_sla_at || null,
      slaState: replySlaState,
      blockedByDeliveryFailure: failedDeliveryStatus(row.reply_expected_delivery_status ?? row.delivery_status),
    },
    lastMessage: row.last_message || null,
    unreadCount: row.unread_count,
    meta: row.meta,
    sendCapable: isSendCapableChannel(row.channel),
    sendReadiness: isSendCapableChannel(row.channel) ? 'send_capable' : 'inbound_only',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessageRow(row) {
  if (!row) return null;
  const meta = mergeSendTruthMeta(row);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    senderName: row.sender_name,
    content: row.content,
    contentType: row.content_type,
    mediaUrl: row.media_url,
    externalMessageId: row.external_message_id,
    providerMessageId: row.provider_message_id,
    deliveryStatus: row.delivery_status,
    deliveryError: row.delivery_error,
    sendAttemptedAt: row.send_attempted_at,
    providerAcceptedAt: row.provider_accepted_at,
    failedAt: row.failed_at,
    providerLifecycleAt: row.provider_lifecycle_at,
    providerLifecycleEvent: row.provider_lifecycle_event,
    providerLifecycleSource: row.provider_lifecycle_source,
    sendTruth: meta.sendTruth || null,
    aiGenerated: row.ai_generated,
    readAt: row.read_at,
    meta,
    createdAt: row.created_at,
  };
}

function mapContextCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    instagram: row.instagram,
    childName: row.child_name,
    source: row.source,
    leadId: row.lead_id,
    totalBookings: row.total_bookings,
    totalSpent: row.total_spent,
    lastVisit: row.last_visit,
  };
}

function mapContextLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientName: row.client_name,
    phone: row.phone,
    instagram: row.instagram,
    source: row.source,
    sourceChannel: row.source_channel,
    status: row.status,
    pipelineStage: row.pipeline_stage,
    bookingId: row.booking_id,
    eventDate: row.event_date,
    assignedName: row.assigned_name,
  };
}

function mapContextBooking(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    status: row.status,
    programName: row.program_name,
    category: row.category,
    label: row.label,
    room: row.room,
    customerId: row.customer_id,
  };
}

function buildTimelineLink(booking) {
  if (!booking || !booking.id || !booking.date) return null;
  return `/?date=${encodeURIComponent(String(booking.date).slice(0, 10))}&highlight=${encodeURIComponent(booking.id)}`;
}

async function findLeadById(leadId) {
  if (!leadId) return null;
  const result = await pool.query(
    `SELECT l.*, u.name AS assigned_name
     FROM leads l
     LEFT JOIN users u ON l.assigned_to = u.id
     WHERE l.id = $1
     LIMIT 1`,
    [leadId]
  );
  return mapContextLead(result.rows[0]);
}

async function findBookingById(bookingId) {
  if (!bookingId) return null;
  const result = await pool.query('SELECT * FROM bookings WHERE id = $1 LIMIT 1', [bookingId]);
  return mapContextBooking(result.rows[0]);
}

async function findRelatedBookings(customerId) {
  if (!customerId) return [];
  const result = await pool.query(
    `SELECT *
     FROM bookings
     WHERE customer_id = $1
       AND status != 'cancelled'
       AND NULLIF(linked_to, '') IS NULL
     ORDER BY date DESC NULLS LAST, time DESC NULLS LAST
     LIMIT 3`,
    [customerId]
  );
  return result.rows.map(mapContextBooking);
}

async function findSuggestedCustomer(conversation) {
  const phoneDigits = normalizeDigits(conversation.customer_phone);
  const namePattern = conversation.customer_name ? `%${conversation.customer_name}%` : '';
  if (!phoneDigits && !namePattern) return null;
  const result = await pool.query(
    `SELECT *
     FROM customers
     WHERE ($1 <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1)
        OR ($2 <> '' AND name ILIKE $2)
     ORDER BY
       CASE
         WHEN $1 <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1 THEN 0
         ELSE 1
       END,
       updated_at DESC NULLS LAST
     LIMIT 1`,
    [phoneDigits, namePattern]
  );
  return mapContextCustomer(result.rows[0]);
}

async function findSuggestedLead(conversation) {
  const phoneDigits = normalizeDigits(conversation.customer_phone);
  const namePattern = conversation.customer_name ? `%${conversation.customer_name}%` : '';
  if (!phoneDigits && !namePattern) return null;
  const result = await pool.query(
    `SELECT l.*, u.name AS assigned_name
     FROM leads l
     LEFT JOIN users u ON l.assigned_to = u.id
     WHERE ($1 <> '' AND regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') = $1)
        OR ($2 <> '' AND l.client_name ILIKE $2)
     ORDER BY
       CASE
         WHEN $1 <> '' AND regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') = $1 THEN 0
         ELSE 1
       END,
       l.updated_at DESC NULLS LAST
     LIMIT 1`,
    [phoneDigits, namePattern]
  );
  return mapContextLead(result.rows[0]);
}

function buildCaseLinks(exact, suggestions) {
  const links = {
    leadWorkspace: exact.lead ? `/sales-funnel?lead=${encodeURIComponent(exact.lead.id)}` : null,
    customer: exact.customer ? `/customers?open=${encodeURIComponent(exact.customer.id)}` : null,
    booking: exact.booking ? buildTimelineLink(exact.booking) : null,
  };
  const suggestedLinks = {
    leadWorkspace: suggestions.lead ? `/sales-funnel?lead=${encodeURIComponent(suggestions.lead.id)}` : null,
    customer: suggestions.customer ? `/customers?open=${encodeURIComponent(suggestions.customer.id)}` : null,
    booking: suggestions.booking ? buildTimelineLink(suggestions.booking) : null,
  };
  return { links, suggestedLinks };
}

async function resolveConversationContext(conversationId) {
  const id = Number.parseInt(conversationId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid conversation id');
  }

  const conversationResult = await pool.query('SELECT * FROM conversations WHERE id = $1 LIMIT 1', [id]);
  const rawConversation = conversationResult.rows[0];
  if (!rawConversation) return null;

  const exact = { customer: null, lead: null, booking: null };
  const suggestions = { customer: null, lead: null, booking: null };
  const reasons = [];

  if (rawConversation.customer_id) {
    const customerResult = await pool.query('SELECT * FROM customers WHERE id = $1 LIMIT 1', [rawConversation.customer_id]);
    exact.customer = mapContextCustomer(customerResult.rows[0]);
    if (exact.customer) reasons.push('conversation.customer_id');
  }

  if (exact.customer?.leadId) {
    exact.lead = await findLeadById(exact.customer.leadId);
    if (exact.lead) reasons.push('customers.lead_id');
  }

  if (exact.lead?.bookingId) {
    exact.booking = await findBookingById(exact.lead.bookingId);
    if (exact.booking) reasons.push('leads.booking_id');
  }

  if (!exact.customer) {
    suggestions.customer = await findSuggestedCustomer(rawConversation);
    if (suggestions.customer) reasons.push('suggested customer by phone/name');
  }

  if (!exact.lead) {
    if (suggestions.customer?.leadId) {
      suggestions.lead = await findLeadById(suggestions.customer.leadId);
      if (suggestions.lead) reasons.push('suggested customers.lead_id');
    }
    if (!suggestions.lead) {
      suggestions.lead = await findSuggestedLead(rawConversation);
      if (suggestions.lead) reasons.push('suggested lead by phone/name');
    }
  }

  if (!exact.booking && suggestions.lead?.bookingId) {
    suggestions.booking = await findBookingById(suggestions.lead.bookingId);
  }

  const relatedBookings = await findRelatedBookings(exact.customer?.id || null);
  const { links, suggestedLinks } = buildCaseLinks(exact, suggestions);
  const confidence = exact.lead || exact.customer || exact.booking
    ? 'exact'
    : (suggestions.lead || suggestions.customer || suggestions.booking ? 'suggested' : 'unresolved');

  return {
    conversation: mapConversationRow(rawConversation),
    confidence,
    exact,
    suggestions,
    relatedBookings,
    links,
    suggestedLinks,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// 1. findOrCreateConversation
// ---------------------------------------------------------------------------

async function findOrCreateConversation(channel, externalId, senderName, phone) {
  const safeName = safeTruncate(senderName, MAX_NAME_LEN);
  const safePhone = safeTruncate(phone, 50);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT * FROM conversations WHERE channel = $1 AND external_id = $2',
      [channel, externalId]
    );

    if (existing.rows.length > 0) {
      const conv = existing.rows[0];
      if (
        (safeName && safeName !== conv.customer_name) ||
        (safePhone && safePhone !== conv.customer_phone)
      ) {
        const updated = await client.query(
          `UPDATE conversations
             SET customer_name  = COALESCE($1, customer_name),
                 customer_phone = COALESCE($2, customer_phone),
                 updated_at     = NOW()
           WHERE id = $3
           RETURNING *`,
          [safeName || conv.customer_name, safePhone || conv.customer_phone, conv.id]
        );
        await client.query('COMMIT');
        return mapConversationRow(updated.rows[0]);
      }

      await client.query('COMMIT');
      return mapConversationRow(conv);
    }

    const inserted = await client.query(
      `INSERT INTO conversations
         (channel, external_id, customer_name, customer_phone, status, unread_count, meta, last_message_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'open', 0, '{}'::jsonb, NOW(), NOW(), NOW())
       RETURNING *`,
      [channel, externalId, safeName || 'Unknown', safePhone || null]
    );

    await client.query('COMMIT');
    logger.info(`New conversation created: channel=${channel} externalId=${externalId}`);
    return mapConversationRow(inserted.rows[0]);
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    logger.error('findOrCreateConversation error', e);
    throw e;
  } finally {
    if (client) client.release();
  }
}

// ---------------------------------------------------------------------------
// 2. saveInboundMessage
// ---------------------------------------------------------------------------

async function saveInboundMessage(conversationId, normalized) {
  let client;
  let clearedReplyMessageId = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const activeReply = await client.query(
      `SELECT reply_expected_message_id
         FROM conversations
        WHERE id = $1
          AND reply_expected IS TRUE
          AND awaiting_reply_since IS NOT NULL
          AND awaiting_reply_since <= NOW()
        LIMIT 1`,
      [conversationId]
    );
    clearedReplyMessageId = activeReply.rows[0]?.reply_expected_message_id || null;

    const msg = await client.query(
      `INSERT INTO conversation_messages
         (conversation_id, direction, sender_name, content, content_type, media_url, external_message_id, ai_generated, meta, created_at)
       VALUES ($1, 'inbound', $2, $3, $4, $5, $6, false, $7, NOW())
       RETURNING *`,
      [
        conversationId,
        normalized.senderName || null,
        normalized.content || '',
        normalized.contentType || 'text',
        normalized.mediaUrl || null,
        normalized.externalMessageId || null,
        normalized.meta ? JSON.stringify(normalized.meta) : '{}',
      ]
    );

    await client.query(
      `UPDATE conversations
         SET last_message_at = NOW(),
             last_inbound_at = NOW(),
             unread_count    = unread_count + 1,
             reply_expected  = CASE
               WHEN reply_expected IS TRUE
                AND awaiting_reply_since IS NOT NULL
                AND awaiting_reply_since <= NOW()
               THEN false
               ELSE reply_expected
             END,
             awaiting_reply_since = CASE
               WHEN reply_expected IS TRUE
                AND awaiting_reply_since IS NOT NULL
                AND awaiting_reply_since <= NOW()
               THEN NULL
               ELSE awaiting_reply_since
             END,
             reply_expected_message_id = CASE
               WHEN reply_expected IS TRUE
                AND awaiting_reply_since IS NOT NULL
                AND awaiting_reply_since <= NOW()
               THEN NULL
               ELSE reply_expected_message_id
             END,
             reply_owner = CASE
               WHEN reply_expected IS TRUE
                AND awaiting_reply_since IS NOT NULL
                AND awaiting_reply_since <= NOW()
               THEN NULL
               ELSE reply_owner
             END,
             reply_sla_at = CASE
               WHEN reply_expected IS TRUE
                AND awaiting_reply_since IS NOT NULL
                AND awaiting_reply_since <= NOW()
               THEN NULL
               ELSE reply_sla_at
             END,
             status          = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
             updated_at      = NOW()
       WHERE id = $1`,
      [conversationId]
    );

    await client.query('COMMIT');
    if (clearedReplyMessageId) {
      await closeReplyEscalationForMessage(clearedReplyMessageId, { pool, reason: 'inbound_reply' })
        .catch(err => logger.warn(`Reply escalation close after inbound skipped: ${err.message}`));
    }
    return mapMessageRow(msg.rows[0]);
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    logger.error('saveInboundMessage error', e);
    throw e;
  } finally {
    if (client) client.release();
  }
}

async function getConversationById(conversationId) {
  const result = await pool.query(
    'SELECT * FROM conversations WHERE id = $1 LIMIT 1',
    [conversationId]
  );
  return mapConversationRow(result.rows[0]);
}

async function setReplyExpectation(conversationId, messageId, options = {}) {
  const expectation = normalizeReplyExpectationOptions(options);
  if (!expectation.replyExpected || !conversationId || !messageId) return null;

  const result = await pool.query(
    `UPDATE conversations
        SET reply_expected = true,
            awaiting_reply_since = NOW(),
            reply_expected_message_id = $2,
            reply_owner = $3,
            reply_sla_at = $4::timestamp,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [conversationId, messageId, expectation.replyOwner, expectation.replySlaAt]
  );
  return mapConversationRow(result.rows[0]);
}

async function clearReplyExpectationForMessage(conversationId, messageId) {
  if (!conversationId || !messageId) return null;

  const result = await pool.query(
    `UPDATE conversations
        SET reply_expected = false,
            awaiting_reply_since = NULL,
            reply_expected_message_id = NULL,
            reply_owner = NULL,
            reply_sla_at = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND reply_expected IS TRUE
        AND reply_expected_message_id = $2
      RETURNING *`,
    [conversationId, messageId]
  );
  const conversation = mapConversationRow(result.rows[0]);
  if (conversation) {
    await closeReplyEscalationForMessage(messageId, { pool, reason: 'reply_expectation_cleared' })
      .catch(err => logger.warn(`Reply escalation close after expectation clear skipped: ${err.message}`));
  }
  return conversation;
}

// ---------------------------------------------------------------------------
// 3. saveOutboundMessage
// ---------------------------------------------------------------------------

async function saveOutboundMessage(conversationId, content, contentType, meta) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const msg = await client.query(
      `INSERT INTO conversation_messages
         (conversation_id, direction, sender_name, content, content_type, ai_generated, meta, created_at)
       VALUES ($1, 'outbound', 'system', $2, $3, $4, $5, NOW())
       RETURNING *`,
      [
        conversationId,
        content,
        contentType || 'text',
        meta && meta.aiGenerated ? true : false,
        meta ? JSON.stringify(meta) : '{}',
      ]
    );

    await client.query(
      `UPDATE conversations
         SET last_message_at = NOW(),
             last_outbound_at = NOW(),
             updated_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );

    await client.query('COMMIT');
    return mapMessageRow(msg.rows[0]);
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    logger.error('saveOutboundMessage error', e);
    throw e;
  } finally {
    if (client) client.release();
  }
}

function durableSendTruthValues(sendTruth, options = {}) {
  const deliveryStatus = options.deliveryStatus || deliveryStatusFromSendTruth(sendTruth);
  const providerMessageId = sendTruth?.providerReference
    ? safeTruncate(String(sendTruth.providerReference), 255)
    : null;
  const deliveryError = sendTruth?.error || null;
  const providerAttempted = options.providerAttempted ?? (sendTruth?.providerAttempted === true || attemptedDeliveryStatus(deliveryStatus));
  const providerAccepted = options.providerAccepted ?? [
    DELIVERY_STATUS.ACCEPTED,
    DELIVERY_STATUS.DELIVERED,
    DELIVERY_STATUS.READ,
    DELIVERY_STATUS.LATER_FAILED,
  ].includes(deliveryStatus);
  const failed = options.failed ?? [
    DELIVERY_STATUS.FAILED,
    DELIVERY_STATUS.LATER_FAILED,
  ].includes(deliveryStatus);

  return {
    providerMessageId,
    deliveryStatus,
    deliveryError,
    providerAttempted,
    providerAccepted,
    failed,
  };
}

async function saveMessageSendTruth(messageId, sendTruth, options = {}) {
  if (!messageId || !sendTruth) return null;
  const durable = durableSendTruthValues(sendTruth, options);
  const result = await pool.query(
    `UPDATE conversation_messages
       SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
           provider_message_id = COALESCE($3, provider_message_id),
           delivery_status = $4,
           delivery_error = $5,
           send_attempted_at = CASE WHEN $6::boolean THEN COALESCE(send_attempted_at, NOW()) ELSE send_attempted_at END,
           provider_accepted_at = CASE WHEN $7::boolean THEN COALESCE(provider_accepted_at, NOW()) ELSE provider_accepted_at END,
           failed_at = CASE WHEN $8::boolean THEN COALESCE(failed_at, NOW()) ELSE failed_at END
     WHERE id = $1
     RETURNING *`,
    [
      messageId,
      JSON.stringify({ sendTruth }),
      durable.providerMessageId,
      durable.deliveryStatus,
      durable.deliveryError,
      durable.providerAttempted,
      durable.providerAccepted,
      durable.failed,
    ]
  );
  return mapMessageRow(result.rows[0]);
}

async function markMessageSendAttempted(messageId, sendTruth) {
  return saveMessageSendTruth(messageId, sendTruth, {
    deliveryStatus: DELIVERY_STATUS.ATTEMPTED,
    providerAttempted: true,
    providerAccepted: null,
    failed: false,
  });
}

function normalizeProviderLifecycleReceipt(receipt = {}) {
  const channel = normalizeChannel(receipt.channel || receipt.provider);
  if (!LIFECYCLE_SUPPORTED_CHANNELS.has(channel)) return null;

  const deliveryStatus = receipt.deliveryStatus || receipt.delivery_status;
  if (!lifecycleDeliveryStatus(deliveryStatus)) return null;

  const providerMessageId = receipt.providerMessageId || receipt.provider_message_id || receipt.messageToken || receipt.message_id;
  if (!providerMessageId) return null;

  let providerLifecycleAt = receipt.providerLifecycleAt || receipt.provider_lifecycle_at || receipt.timestamp || null;
  if (providerLifecycleAt) {
    const parsed = new Date(providerLifecycleAt);
    providerLifecycleAt = Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  return {
    channel,
    providerMessageId: safeTruncate(String(providerMessageId), 255),
    deliveryStatus,
    deliveryError: receipt.deliveryError || receipt.delivery_error || receipt.error || null,
    providerLifecycleAt,
    providerLifecycleEvent: safeTruncate(String(receipt.providerLifecycleEvent || receipt.provider_lifecycle_event || receipt.event || deliveryStatus), 60),
    providerLifecycleSource: safeTruncate(String(receipt.providerLifecycleSource || receipt.provider_lifecycle_source || `${channel}_webhook`), 40),
  };
}

function buildLifecycleSendTruth(receipt) {
  const deliveryConfirmed = [
    DELIVERY_STATUS.DELIVERED,
    DELIVERY_STATUS.READ,
  ].includes(receipt.deliveryStatus);

  return buildSendTruth(sendTruthStatusFromDeliveryStatus(receipt.deliveryStatus), {
    channel: receipt.channel,
    providerAttempted: true,
    providerAccepted: true,
    deliveryConfirmed,
    providerReference: receipt.providerMessageId,
    lifecycleStatus: receipt.deliveryStatus,
    providerLifecycleAt: receipt.providerLifecycleAt,
    providerLifecycleEvent: receipt.providerLifecycleEvent,
    providerLifecycleSource: receipt.providerLifecycleSource,
    error: receipt.deliveryError,
  });
}

async function applyProviderLifecycleReceipt(receiptPayload) {
  const receipt = normalizeProviderLifecycleReceipt(receiptPayload);
  if (!receipt) {
    logger.warn('Ignoring unsupported provider lifecycle receipt', {
      channel: receiptPayload?.channel || receiptPayload?.provider || null,
      deliveryStatus: receiptPayload?.deliveryStatus || receiptPayload?.delivery_status || null,
    });
    return null;
  }

  const sendTruth = buildLifecycleSendTruth(receipt);
  const providerLifecycle = {
    version: 1,
    channel: receipt.channel,
    providerMessageId: receipt.providerMessageId,
    deliveryStatus: receipt.deliveryStatus,
    deliveryError: receipt.deliveryError,
    event: receipt.providerLifecycleEvent,
    source: receipt.providerLifecycleSource,
    at: receipt.providerLifecycleAt,
  };

  const result = await pool.query(
    `UPDATE conversation_messages cm
        SET meta = COALESCE(cm.meta, '{}'::jsonb) || $4::jsonb,
            delivery_status = CASE
              WHEN cm.delivery_status = 'read' AND $3 = 'delivered' THEN cm.delivery_status
              ELSE $3
            END,
            delivery_error = CASE WHEN $3 = 'later_failed' THEN $8 ELSE NULL END,
            provider_lifecycle_at = COALESCE($5::timestamp, NOW()),
            provider_lifecycle_event = $6,
            provider_lifecycle_source = $7,
            send_attempted_at = COALESCE(cm.send_attempted_at, NOW()),
            provider_accepted_at = COALESCE(cm.provider_accepted_at, NOW()),
            failed_at = CASE
              WHEN $3 = 'later_failed' THEN COALESCE(cm.failed_at, COALESCE($5::timestamp, NOW()))
              ELSE cm.failed_at
            END
       FROM conversations c
      WHERE cm.conversation_id = c.id
        AND c.channel = $1
        AND cm.direction = 'outbound'
        AND cm.provider_message_id = $2
      RETURNING cm.*`,
    [
      receipt.channel,
      receipt.providerMessageId,
      receipt.deliveryStatus,
      JSON.stringify({ sendTruth, providerLifecycle }),
      receipt.providerLifecycleAt,
      receipt.providerLifecycleEvent,
      receipt.providerLifecycleSource,
      receipt.deliveryError,
    ]
  );

  if (!result.rows.length) {
    logger.warn('Provider lifecycle receipt did not match an outbound message', {
      channel: receipt.channel,
      providerMessageId: receipt.providerMessageId,
      deliveryStatus: receipt.deliveryStatus,
    });
    return null;
  }

  const message = mapMessageRow(result.rows[0]);
  if (message.deliveryStatus === DELIVERY_STATUS.LATER_FAILED) {
    const clearedConversation = await clearReplyExpectationForMessage(message.conversationId, message.id);
    if (clearedConversation) {
      notifyCRM('omni:conversation', { conversation: clearedConversation });
    }
  }
  notifyCRM('omni:message', { message, providerLifecycle: message.meta?.providerLifecycle || null });
  return message;
}

// ---------------------------------------------------------------------------
// 4. processInboundMessage
// ---------------------------------------------------------------------------

async function processInboundMessage(normalized) {
  const conversation = await findOrCreateConversation(
    normalized.channel,
    normalized.externalId,
    normalized.senderName,
    normalized.phone
  );

  const message = await saveInboundMessage(conversation.id, normalized);
  const updatedConversation = await getConversationById(conversation.id) || conversation;

  notifyCRM('omni:message', { conversation: updatedConversation, message });
  notifyCRM('omni:conversation', { conversation: updatedConversation });

  // AI auto-response when enabled
  const meta = updatedConversation.meta || {};
  if (meta.ai_enabled || meta.aiEnabled) {
    try {
      await generateAndSendAIResponse(updatedConversation, message);
    } catch (err) {
      logger.error('AI auto-response failed', err);
    }
  }

  return { conversation: updatedConversation, message };
}

// ---------------------------------------------------------------------------
// 5. generateAndSendAIResponse
// ---------------------------------------------------------------------------

async function generateAndSendAIResponse(conversation, message) {
  // Fetch recent history for context
  const historyResult = await pool.query(
    `SELECT * FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [conversation.id]
  );

  const chatHistory = historyResult.rows
    .reverse()
    .map((r) => ({
      role: r.direction === 'inbound' ? 'user' : 'assistant',
      content: r.content,
    }));

  const aiText = await generateChatResponse(
    message.content,
    conversation.customerName || 'Guest',
    chatHistory
  );

  if (!aiText) {
    logger.warn('AI returned empty response, skipping');
    return null;
  }

  if (!isSendCapableChannel(conversation.channel)) {
    logger.warn(`AI response skipped because ${conversation.channel} is not send-capable`);
    return null;
  }

  let sendTruth = buildSendTruth('saved', {
    channel: conversation.channel,
    providerAttempted: false,
    providerAccepted: null,
  });
  const saved = await saveOutboundMessage(conversation.id, aiText, 'text', {
    aiGenerated: true,
    sendTruth,
  });
  let messageWithTruth = await saveMessageSendTruth(saved.id, sendTruth) || saved;

  // Deliver to the external channel
  try {
    messageWithTruth = await markMessageSendAttempted(saved.id, sendTruth) || messageWithTruth;
    const delivery = await sendToChannel(conversation.channel, conversation.externalId, aiText, {});
    sendTruth = normalizeProviderResult(conversation.channel, delivery);
    messageWithTruth = await saveMessageSendTruth(saved.id, sendTruth) || saved;
    if (sendTruth.status === 'provider_failed_immediate' || sendTruth.status === 'provider_unknown') {
      logger.warn(`AI response delivery not confirmed via ${conversation.channel}: ${sendTruth.error || sendTruth.status}`);
    }
  } catch (err) {
    logger.error(`Failed to deliver AI response via ${conversation.channel}`, err);
    sendTruth = buildSendTruth('provider_failed_immediate', {
      channel: conversation.channel,
      providerAttempted: true,
      providerAccepted: false,
      error: err.message,
    });
    messageWithTruth = await saveMessageSendTruth(saved.id, sendTruth) || saved;
  }

  notifyCRM('omni:message', {
    conversation,
    message: messageWithTruth,
  });

  return messageWithTruth;
}

// ---------------------------------------------------------------------------
// 6. sendToChannel
// ---------------------------------------------------------------------------

async function sendToChannel(channel, externalId, text, meta) {
  switch (channel) {
    case 'telegram':
      return sendTelegramMessage(externalId, text);
    case 'viber':
      return sendViber(externalId, text, meta);
    case 'sms':
      return sendSMS(externalId, text);
    case 'facebook':
      return sendFacebook(externalId, text, meta);
    case 'instagram':
      return sendInstagram(externalId, text);
    case 'binotel':
      logger.info(`Binotel is inbound-only, skipping outbound to ${externalId}`);
      return { success: false, error: 'Binotel is inbound-only', code: 'channel_unavailable' };
    default:
      logger.warn(`Unknown channel: ${channel}`);
      throw new Error(`Unsupported channel: ${channel}`);
  }
}

// ---------------------------------------------------------------------------
// 7. getConversations
// ---------------------------------------------------------------------------

async function getConversations(filters = {}) {
  let { status, channel, search, limit = 50, offset = 0 } = filters;

  // Validate and sanitize inputs
  if (status && !VALID_STATUSES.includes(status)) status = null;
  if (channel && !VALID_CHANNELS.includes(channel)) channel = null;
  if (search) search = safeTruncate(String(search), MAX_SEARCH_LEN);
  limit = Math.max(1, Math.min(Number(limit) || 50, 200));
  offset = Math.max(0, Number(offset) || 0);

  const conditions = [];
  const params = [];
  let idx = 1;

  if (status) {
    conditions.push(`c.status = $${idx++}`);
    params.push(status);
  }
  if (channel) {
    conditions.push(`c.channel = $${idx++}`);
    params.push(channel);
  }
  if (search) {
    conditions.push(`(c.customer_name ILIKE $${idx} OR c.customer_phone ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  params.push(limit);
  const limitIdx = idx++;
  params.push(offset);
  const offsetIdx = idx++;

  const result = await pool.query(
    `SELECT c.*,
            (SELECT cm.content FROM conversation_messages cm
             WHERE cm.conversation_id = c.id
             ORDER BY cm.created_at DESC LIMIT 1) AS last_message
     FROM conversations c
     ${where}
     ORDER BY c.last_message_at DESC NULLS LAST
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM conversations c ${where}`,
    params.slice(0, params.length - 2)
  );

  return {
    conversations: result.rows.map(mapConversationRow),
    total: countResult.rows[0].total,
  };
}

// ---------------------------------------------------------------------------
// 8. getMessages
// ---------------------------------------------------------------------------

async function getMessages(conversationId, limit = 50, offset = 0) {
  const result = await pool.query(
    `SELECT * FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
    [conversationId, limit, offset]
  );

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM conversation_messages WHERE conversation_id = $1`,
    [conversationId]
  );

  return {
    messages: result.rows.map(mapMessageRow),
    total: countResult.rows[0].total,
  };
}

// ---------------------------------------------------------------------------
// 9. sendManualMessage
// ---------------------------------------------------------------------------

async function sendManualMessage(conversationId, text, senderName, options = {}) {
  const convResult = await pool.query(
    'SELECT * FROM conversations WHERE id = $1',
    [conversationId]
  );

  if (convResult.rows.length === 0) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  const conversation = mapConversationRow(convResult.rows[0]);
  if (!isSendCapableChannel(conversation.channel)) {
    throw new ChannelUnavailableError(conversation.channel);
  }
  const replyExpectation = normalizeReplyExpectationOptions(options);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const msg = await client.query(
      `INSERT INTO conversation_messages
         (conversation_id, direction, sender_name, content, content_type, ai_generated, meta, created_at)
       VALUES ($1, 'outbound', $2, $3, 'text', false, '{}'::jsonb, NOW())
       RETURNING *`,
      [conversationId, safeTruncate(senderName, MAX_NAME_LEN) || 'Operator', text]
    );

    await client.query(
      `UPDATE conversations
         SET last_message_at = NOW(),
             last_outbound_at = NOW(),
             unread_count = 0,
             updated_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );

    await client.query('COMMIT');
    client.release();
    client = null;

    const saved = mapMessageRow(msg.rows[0]);
    let sendTruth = buildSendTruth('saved', {
      channel: conversation.channel,
      providerAttempted: false,
      providerAccepted: null,
    });
    let messageWithTruth = await saveMessageSendTruth(saved.id, sendTruth) || saved;

    try {
      messageWithTruth = await markMessageSendAttempted(saved.id, sendTruth) || messageWithTruth;
      const delivery = await sendToChannel(conversation.channel, conversation.externalId, text, {});
      sendTruth = normalizeProviderResult(conversation.channel, delivery);
      messageWithTruth = await saveMessageSendTruth(saved.id, sendTruth) || messageWithTruth;
      if (sendTruth.status === 'provider_failed_immediate' || sendTruth.status === 'provider_unknown') {
        logger.warn(`Manual message delivery not confirmed via ${conversation.channel}: ${sendTruth.error || sendTruth.status}`);
      }
    } catch (err) {
      logger.error(`Failed to deliver manual message via ${conversation.channel}`, err);
      sendTruth = buildSendTruth('provider_failed_immediate', {
        channel: conversation.channel,
        providerAttempted: true,
        providerAccepted: false,
        error: err.message,
      });
      messageWithTruth = await saveMessageSendTruth(saved.id, sendTruth) || messageWithTruth;
    }

    let conversationWithReplyExpectation = conversation;
    if (replyExpectation.replyExpected) {
      if (failedDeliveryStatus(messageWithTruth.deliveryStatus)) {
        logger.warn('Reply expectation was requested but immediate delivery failed; waiting_reply was not set', {
          conversationId,
          messageId: saved.id,
          channel: conversation.channel,
          deliveryStatus: messageWithTruth.deliveryStatus,
        });
      } else {
        conversationWithReplyExpectation = await setReplyExpectation(
          conversation.id,
          saved.id,
          replyExpectation
        ) || conversation;
        notifyCRM('omni:conversation', { conversation: conversationWithReplyExpectation });
      }
    }

    notifyCRM('omni:message', {
      conversation: conversationWithReplyExpectation,
      message: messageWithTruth,
      sendTruth
    });

    return {
      message: messageWithTruth,
      sendTruth,
      conversation: conversationWithReplyExpectation,
      replyExpectation: conversationWithReplyExpectation.replyExpectation || null,
    };
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    logger.error('sendManualMessage error', e);
    throw e;
  } finally {
    if (client) client.release();
  }
}

// ---------------------------------------------------------------------------
// 10. updateConversationStatus
// ---------------------------------------------------------------------------

async function updateConversationStatus(conversationId, status, assignedTo, metaUpdate) {
  const sets = [];
  const params = [];
  let idx = 1;

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    sets.push(`status = $${idx++}`);
    params.push(status);
  }
  if (assignedTo !== undefined) {
    if (assignedTo !== null && (typeof assignedTo !== 'string' || assignedTo.length > 100)) {
      throw new Error('Invalid assignedTo: must be a string up to 100 characters or null');
    }
    sets.push(`assigned_to = $${idx++}`);
    params.push(assignedTo);
  }
  if (metaUpdate && typeof metaUpdate === 'object') {
    sets.push(`meta = meta || $${idx++}::jsonb`);
    params.push(JSON.stringify(metaUpdate));
  }

  if (sets.length === 0) {
    throw new Error('Nothing to update');
  }

  sets.push('updated_at = NOW()');
  params.push(conversationId);

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    await client.query('COMMIT');

    const conversation = mapConversationRow(result.rows[0]);
    notifyCRM('omni:conversation', { conversation });

    return conversation;
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    logger.error('updateConversationStatus error', e);
    throw e;
  } finally {
    if (client) client.release();
  }
}

// ---------------------------------------------------------------------------
// 11. getStats
// ---------------------------------------------------------------------------

async function getStats() {
  const channelCounts = await pool.query(
    `SELECT channel, COUNT(*)::int AS count FROM conversations GROUP BY channel ORDER BY count DESC`
  );

  const statusCounts = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM conversations GROUP BY status`
  );

  const channelMap = {};
  for (const row of channelCounts.rows) {
    channelMap[row.channel] = row.count;
  }

  const statusMap = {};
  for (const row of statusCounts.rows) {
    statusMap[row.status] = row.count;
  }

  return {
    byChannel: channelMap,
    byStatus: statusMap,
    total: Object.values(statusMap).reduce((a, b) => a + b, 0),
  };
}

// ---------------------------------------------------------------------------
// 12. getQuickReplies
// ---------------------------------------------------------------------------

async function getQuickReplies() {
  const result = await pool.query(
    'SELECT * FROM quick_replies ORDER BY sort_order ASC, created_at ASC LIMIT 500'
  );

  return result.rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    category: r.category,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// 13. notifyCRM
// ---------------------------------------------------------------------------

function notifyCRM(type, data) {
  try {
    const wss = getWSS();
    if (!wss || !wss.clients) return;

    const payload = JSON.stringify({ type, data });

    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  } catch (err) {
    logger.error('notifyCRM broadcast error', err);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  findOrCreateConversation,
  saveInboundMessage,
  saveOutboundMessage,
  processInboundMessage,
  generateAndSendAIResponse,
  sendToChannel,
  getConversations,
  getMessages,
  sendManualMessage,
  saveMessageSendTruth,
  applyProviderLifecycleReceipt,
  setReplyExpectation,
  clearReplyExpectationForMessage,
  updateConversationStatus,
  getStats,
  getQuickReplies,
  resolveConversationContext,
  notifyCRM,
  mapConversationRow,
  mapMessageRow,
  buildSendTruth,
  normalizeProviderResult,
  isSendCapableChannel,
  isActiveWaitingReply,
  INBOUND_ONLY_CHANNELS,
  DELIVERY_STATUS,
  ChannelUnavailableError,
};
