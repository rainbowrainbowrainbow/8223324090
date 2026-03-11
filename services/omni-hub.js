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

// ---------------------------------------------------------------------------
// 1. findOrCreateConversation
// ---------------------------------------------------------------------------

async function findOrCreateConversation(channel, externalId, senderName, phone) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT * FROM conversations WHERE channel = $1 AND external_id = $2',
      [channel, externalId]
    );

    if (existing.rows.length > 0) {
      const conv = existing.rows[0];
      // Update name / phone if they changed
      if (
        (senderName && senderName !== conv.customer_name) ||
        (phone && phone !== conv.customer_phone)
      ) {
        const updated = await client.query(
          `UPDATE conversations
             SET customer_name  = COALESCE($1, customer_name),
                 customer_phone = COALESCE($2, customer_phone),
                 updated_at     = NOW()
           WHERE id = $3
           RETURNING *`,
          [senderName || conv.customer_name, phone || conv.customer_phone, conv.id]
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
      [channel, externalId, senderName || 'Unknown', phone || null]
    );

    await client.query('COMMIT');
    logger.info(`New conversation created: channel=${channel} externalId=${externalId}`);
    return mapConversationRow(inserted.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error('findOrCreateConversation error', e);
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 2. saveInboundMessage
// ---------------------------------------------------------------------------

async function saveInboundMessage(conversationId, normalized) {
  const client = await pool.connect();
  try {
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
    await client.query('ROLLBACK');
    logger.error('saveInboundMessage error', e);
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 3. saveOutboundMessage
// ---------------------------------------------------------------------------

async function saveOutboundMessage(conversationId, content, contentType, meta) {
  const client = await pool.connect();
  try {
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
    await client.query('ROLLBACK');
    logger.error('saveOutboundMessage error', e);
    throw e;
  } finally {
    client.release();
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
    await sendToChannel(conversation.channel, conversation.externalId, aiText, {});
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
  const { status, channel, search, limit = 50, offset = 0 } = filters;

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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const msg = await client.query(
      `INSERT INTO conversation_messages
         (conversation_id, direction, sender_name, content, content_type, ai_generated, meta, created_at)
       VALUES ($1, 'outbound', $2, $3, 'text', false, '{}'::jsonb, NOW())
       RETURNING *`,
      [conversationId, senderName || 'Operator', text]
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
    sendToChannel(conversation.channel, conversation.externalId, text, {}).catch((err) => {
      logger.error(`Failed to deliver manual message via ${conversation.channel}`, err);
    });

    notifyCRM('omni:message', { conversation, message: saved });

    return saved;
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error('sendManualMessage error', e);
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 10. updateConversationStatus
// ---------------------------------------------------------------------------

async function updateConversationStatus(conversationId, status, assignedTo, metaUpdate) {
  const valid = ['open', 'closed', 'pending', 'spam'];

  const sets = [];
  const params = [];
  let idx = 1;

  if (status) {
    if (!valid.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${valid.join(', ')}`);
    }
    sets.push(`status = $${idx++}`);
    params.push(status);
  }
  if (assignedTo !== undefined) {
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

  const client = await pool.connect();
  try {
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
    await client.query('ROLLBACK');
    logger.error('updateConversationStatus error', e);
    throw e;
  } finally {
    client.release();
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
    'SELECT * FROM quick_replies ORDER BY sort_order ASC, created_at ASC'
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
  notifyCRM,
  mapConversationRow,
  mapMessageRow,
};
