'use strict';

const { pool } = require('../db');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');
const { normalizeBusinessContext, canAccessBusinessContext } = require('./businessContext');
const { resolveCapability } = require('./accountAccessPolicy');

async function listOmniOperators(businessContext) {
  const result = await pool.query(`SELECT id, username, name, role,
    to_jsonb(u)->'roles' AS roles, to_jsonb(u)->'page_allowlist' AS page_allowlist,
    to_jsonb(u)->'page_denylist' AS page_denylist, to_jsonb(u)->'business_contexts' AS business_contexts,
    to_jsonb(u)->>'forced_business_context' AS forced_business_context
    FROM users u WHERE COALESCE(is_active, true) = true ORDER BY COALESCE(name, username), id`);
  return result.rows.filter(user => canAccessBusinessContext(user, businessContext) && resolveCapability(user, '/omni', { type: 'page' }).allowed)
    .map(user => ({ username: user.username, label: user.name || user.username }));
}

async function markConversationRead(conversationId, throughMessageId, businessContext) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id FROM conversations WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2 FOR UPDATE`,
      [conversationId, businessContext]
    );
    if (!found.rows.length) throw Object.assign(new Error('Розмову не знайдено'), { statusCode: 404 });
    const seen = await client.query('SELECT id FROM conversation_messages WHERE id = $1 AND conversation_id = $2', [throughMessageId, conversationId]);
    if (!seen.rows.length) throw Object.assign(new Error('Повідомлення не належить розмові'), { statusCode: 400 });
    const result = await client.query(
      `UPDATE conversations c SET
        unread_count = (SELECT count(*) FROM conversation_messages m WHERE m.conversation_id = c.id
          AND m.direction = 'inbound' AND m.id > GREATEST($2::bigint, COALESCE((c.meta->>'omniReadThroughId')::bigint, 0))),
        meta = COALESCE(c.meta, '{}'::jsonb) || jsonb_build_object('omniReadThroughId', GREATEST($2::bigint, COALESCE((c.meta->>'omniReadThroughId')::bigint, 0))),
        updated_at = NOW() WHERE c.id = $1 RETURNING unread_count`, [conversationId, throughMessageId]
    );
    await client.query('COMMIT');
    return { unreadCount: Number(result.rows[0].unread_count) };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

async function getTelegramAttachment(messageId, businessContext) {
  const result = await pool.query(
    `SELECT m.media_url FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = $1 AND c.channel = 'telegram' AND COALESCE(c.business_context, 'event_genix') = $2`,
    [messageId, normalizeBusinessContext(businessContext)]
  );
  const fileId = result.rows[0]?.media_url;
  if (!fileId) throw Object.assign(new Error('Вкладення не знайдено'), { statusCode: 404 });
  const { botToken } = await resolveOmniRuntimeConfig('telegram', { businessContext });
  if (!botToken) throw Object.assign(new Error('Потрібне активне підключення Telegram для завантаження'), { statusCode: 409 });
  const signal = AbortSignal.timeout(20000);
  const info = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fileId }), signal, redirect: 'error',
  });
  const payload = await info.json();
  const file = payload.result;
  if (!info.ok || !payload.ok || !file?.file_path) throw new Error('Telegram не повернув вкладення');
  const maxBytes = 20 * 1024 * 1024;
  if (file.file_size > maxBytes) throw Object.assign(new Error('Файл більший за 20 МБ. Відкрийте його в Telegram.'), { statusCode: 413 });
  if (!/^[a-zA-Z0-9_./-]+$/.test(file.file_path) || file.file_path.split('/').includes('..')) throw new Error('Невалідний шлях вкладення');
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`, { signal, redirect: 'error' });
  if (!response.ok) throw new Error('Telegram не зміг завантажити файл');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Файл більший за 20 МБ'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), filename: file.file_path.split('/').pop() };
}

async function applyMetaReceipt(channel, event, businessContext) {
  if (!['facebook', 'instagram'].includes(channel) || !event.sender?.id) return [];
  const receipt = event.read || event.delivery;
  if (!receipt) return [];
  const status = event.read ? 'read' : 'delivered';
  const ids = (Array.isArray(receipt.mids) ? receipt.mids : (receipt.mid ? [receipt.mid] : [])).map(String);
  const watermark = Number(receipt.watermark);
  const through = Number.isFinite(watermark) && watermark > 0 && watermark < 8640000000000000 ? new Date(watermark).toISOString() : null;
  if (!ids.length && !through) return [];
  const result = await pool.query(
    `UPDATE conversation_messages m SET delivery_status = $4::text,
       read_at = CASE WHEN $4::text = 'read' THEN COALESCE(m.read_at, NOW()) ELSE m.read_at END,
       provider_lifecycle_at = COALESCE($6::timestamp, NOW()), provider_lifecycle_event = $4::text,
       provider_lifecycle_source = 'meta_webhook', delivery_error = NULL
      FROM conversations c WHERE m.conversation_id = c.id AND c.channel = $1 AND c.external_id = $2
       AND COALESCE(c.business_context, 'event_genix') = $3 AND m.direction = 'outbound'
       AND m.provider_message_id IS NOT NULL AND COALESCE(m.delivery_status, '') <> 'read'
       AND (m.provider_message_id = ANY($5::text[]) OR ($6::timestamp IS NOT NULL AND m.created_at <= $6::timestamp))
      RETURNING m.conversation_id`, [channel, String(event.sender.id), businessContext, status, ids, through]
  );
  return [...new Set(result.rows.map(row => row.conversation_id))];
}

module.exports = { markConversationRead, getTelegramAttachment, applyMetaReceipt, listOmniOperators };
