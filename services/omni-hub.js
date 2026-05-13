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

const logger = createLogger('omni-hub');

const VALID_CHANNELS = ['telegram', 'viber', 'sms', 'facebook', 'instagram', 'binotel'];
const VALID_STATUSES = ['open', 'closed', 'pending', 'spam'];
const MAX_NAME_LEN = 255;
const MAX_SEARCH_LEN = 255;

function safeTruncate(str, maxLen) {
  if (!str || typeof str !== 'string') return str;
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

// ---------------------------------------------------------------------------
// Helpers: snake_case DB rows → camelCase API objects
// ---------------------------------------------------------------------------

function mapConversationRow(row) {
  if (!row) return null;
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
    lastMessage: row.last_message || null,
    unreadCount: row.unread_count,
    meta: row.meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    senderName: row.sender_name,
    content: row.content,
    contentType: row.content_type,
    mediaUrl: row.media_url,
    externalMessageId: row.external_message_id,
    aiGenerated: row.ai_generated,
    readAt: row.read_at,
    meta: row.meta,
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
  try {
    client = await pool.connect();
    await client.query('BEGIN');

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
             unread_count    = unread_count + 1,
             status          = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
             updated_at      = NOW()
       WHERE id = $1`,
      [conversationId]
    );

    await client.query('COMMIT');
    return mapMessageRow(msg.rows[0]);
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    logger.error('saveInboundMessage error', e);
    throw e;
  } finally {
    if (client) client.release();
  }
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
      `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
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

  notifyCRM('omni:message', { conversation, message });
  notifyCRM('omni:conversation', { conversation });

  // AI auto-response when enabled
  const meta = conversation.meta || {};
  if (meta.ai_enabled || meta.aiEnabled) {
    try {
      await generateAndSendAIResponse(conversation, message);
    } catch (err) {
      logger.error('AI auto-response failed', err);
    }
  }

  return { conversation, message };
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

  const saved = await saveOutboundMessage(conversation.id, aiText, 'text', {
    aiGenerated: true,
  });

  // Deliver to the external channel
  try {
    const delivery = await sendToChannel(conversation.channel, conversation.externalId, aiText, {});
    if (delivery && delivery.success === false) {
      logger.warn(`Delivery failed via ${conversation.channel}: ${delivery.error || 'unknown'}`);
    }
  } catch (err) {
    logger.error(`Failed to deliver AI response via ${conversation.channel}`, err);
  }

  notifyCRM('omni:message', {
    conversation,
    message: saved,
  });

  return saved;
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
      return null;
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

async function sendManualMessage(conversationId, text, senderName) {
  const convResult = await pool.query(
    'SELECT * FROM conversations WHERE id = $1',
    [conversationId]
  );

  if (convResult.rows.length === 0) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  const conversation = mapConversationRow(convResult.rows[0]);

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
         SET last_message_at = NOW(), unread_count = 0, updated_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );

    await client.query('COMMIT');

    const saved = mapMessageRow(msg.rows[0]);

    // Deliver to external channel (fire-and-forget after commit)
    sendToChannel(conversation.channel, conversation.externalId, text, {}).then((delivery) => {
      if (delivery && delivery.success === false) {
        logger.warn(`Manual message delivery failed via ${conversation.channel}: ${delivery.error || 'unknown'}`);
      }
    }).catch((err) => {
      logger.error(`Failed to deliver manual message via ${conversation.channel}`, err);
    });

    notifyCRM('omni:message', { conversation, message: saved });

    return saved;
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
  updateConversationStatus,
  getStats,
  getQuickReplies,
  resolveConversationContext,
  notifyCRM,
  mapConversationRow,
  mapMessageRow,
};
