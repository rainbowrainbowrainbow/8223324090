'use strict';
const crypto = require('node:crypto');
const { pool } = require('../db');

function normalizeInteraction(channel, event) {
  if (!event?.sender?.id || event.message?.is_echo) return null;
  if (event.postback) {
    const id = event.postback.mid || (event.timestamp ? crypto.createHash('sha256')
      .update(JSON.stringify([event.sender.id, event.timestamp, event.postback])).digest('hex') : null);
    if (!id) return null;
    const content = String(event.postback.title || event.postback.payload || 'Натиснуто кнопку').slice(0, 10000);
    return { channel, externalId: String(event.sender.id), content, contentType: 'text',
      externalMessageId: 'postback:' + id, meta: { eventType: 'postback', payload: String(event.postback.payload || '').slice(0, 1000) } };
  }
  const normalizer = require('./omni-normalizer');
  const normalized = channel === 'instagram' ? normalizer.normalizeInstagram(event) : normalizer.normalizeFacebook(event);
  if (normalized && event.message?.quick_reply) normalized.meta = { ...normalized.meta,
    eventType: 'quick_reply', payload: String(event.message.quick_reply.payload || '').slice(0, 1000) };
  return normalized;
}

function normalizeComment(channel, change, entry) {
  const value = change?.value;
  if (!value || (channel === 'facebook' ? change.field !== 'feed' || value.item !== 'comment' || value.verb !== 'add' : change.field !== 'comments')) return null;
  const id = String(channel === 'facebook' ? value.comment_id || '' : value.id || '');
  if (!/^[0-9_]+$/.test(id)) return null;
  if (String(value.from?.id || '') === String(entry.id)) return null;
  const postId = String(channel === 'facebook' ? value.post_id || '' : value.media?.id || '');
  const content = String(value.message || value.text || 'Коментар без тексту').slice(0, 10000);
  return { channel, externalId: 'comment:' + id, senderName: String(value.from?.name || value.from?.username || 'Автор коментаря').slice(0, 255),
    content, contentType: 'text', externalMessageId: 'comment:' + id,
    meta: { eventType: 'comment', commentId: id, postId, commenterId: value.from?.id || null,
      postUrl: channel === 'facebook' && /^[0-9_]+$/.test(postId) ? 'https://www.facebook.com/' + postId : null,
      commentedAt: Number(value.created_time || entry.time) || null } };
}

async function enrichComment(normalized, businessContext) {
  if (normalized.channel === 'instagram' && /^[0-9]+$/.test(normalized.meta.postId)) {
    try { normalized.meta.postUrl = await require('./omni-instagram').getMediaPermalink(normalized.meta.postId, { businessContext }); }
    catch { normalized.meta.postLinkUnavailable = true; }
  }
  return normalized;
}

async function replyTarget(conversationId, businessContext, messageId, mode) {
  if (!['public_comment', 'private_reply'].includes(mode)) throw Object.assign(new Error('Оберіть публічну або приватну відповідь.'), { statusCode: 400 });
  const result = await pool.query(`SELECT m.meta, c.channel FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = $1 AND c.id = $2 AND COALESCE(c.business_context, 'event_genix') = $3 AND m.direction = 'inbound'`, [messageId, conversationId, businessContext]);
  const row = result.rows[0];
  if (!['facebook', 'instagram'].includes(row?.channel) || row.meta?.eventType !== 'comment' || !/^[0-9_]+$/.test(row.meta.commentId)) {
    throw Object.assign(new Error('Коментар не належить цій розмові.'), { statusCode: 404 });
  }
  return { messageId, commentId: row.meta.commentId, mode, channel: row.channel };
}

async function sendReply(target, text, businessContext) {
  const adapter = target.channel === 'instagram' ? require('./omni-instagram') : require('./omni-facebook');
  return target.mode === 'public_comment' ? adapter.replyToComment(target.commentId, text, { businessContext })
    : adapter.sendPrivateReply(target.commentId, text, { businessContext });
}
module.exports = { normalizeInteraction, normalizeComment, enrichComment, replyTarget, sendReply };
