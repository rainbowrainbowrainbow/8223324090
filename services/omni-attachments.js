'use strict';
const crypto = require('node:crypto');
const https = require('node:https');
const dns = require('node:dns');
const { pool } = require('../db');
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
const fail = (text, statusCode = 400) => Object.assign(new Error(text), { statusCode });

function capabilities(channel) {
  const imageLimit = channel === 'viber' ? 1024 * 1024 : channel === 'instagram' ? 8 * 1024 * 1024 : MAX_BYTES;
  if (!['telegram', 'viber', 'facebook', 'instagram'].includes(channel)) return [];
  return Object.keys(TYPES).filter(mime => channel !== 'instagram' || mime !== 'application/pdf')
    .map(mime => ({ mime, maxBytes: mime === 'application/pdf' ? MAX_BYTES : imageLimit }));
}

function validateFile(file, channel, inbound = false) {
  const bytes = file?.buffer;
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw fail('Оберіть непорожній файл.');
  if (bytes.length > MAX_BYTES) throw fail('Ліміт CRM — 10 МБ.', 413);
  const mime = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? 'image/jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : bytes.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : null;
  if (!mime || (file.mimetype && file.mimetype !== 'application/octet-stream' && file.mimetype.split(';')[0] !== mime)) {
    throw fail('Підтримуються справжні JPEG, PNG та PDF.', 415);
  }
  if (!inbound) {
    const policy = capabilities(channel).find(item => item.mime === mime);
    if (!policy) throw fail('Цей канал не підтримує такий формат вкладення.', 415);
    if (bytes.length > policy.maxBytes) throw fail('Ліміт цього формату для каналу — ' + policy.maxBytes / 1024 / 1024 + ' МБ.', 413);
  }
  const rawName = String(file.originalname || 'attachment').replace(/[/\\\x00-\x1f\x7f"<>]/g, '_').slice(0, 160);
  const filename = rawName.replace(/\.[^.]*$/, '') + '.' + TYPES[mime];
  return { filename, mime, size: bytes.length, checksum: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function conversation(id, businessContext) {
  const result = await pool.query("SELECT id, channel FROM conversations WHERE id = $1 AND COALESCE(business_context, 'event_genix') = $2", [id, businessContext]);
  if (!result.rows[0]) throw fail('Розмову не знайдено.', 404);
  return result.rows[0];
}

function metadata(row) { return { id: row.id, filename: row.filename, mime: row.mime_type, size: row.size_bytes, checksum: row.checksum }; }

async function storeFile(conversationId, businessContext, file, messageId = null, sourceIndex = 0) {
  const conv = await conversation(conversationId, businessContext);
  const validated = validateFile(file, conv.channel, !!messageId);
  const result = await pool.query(`INSERT INTO omni_attachments
    (id, business_context, conversation_id, message_id, filename, mime_type, size_bytes, checksum, content, source_index)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (message_id, source_index) WHERE message_id IS NOT NULL DO UPDATE SET message_id = EXCLUDED.message_id RETURNING *`,
  [crypto.randomUUID(), businessContext, conversationId, messageId, validated.filename, validated.mime, validated.size, validated.checksum, file.buffer, sourceIndex]);
  return metadata(result.rows[0]);
}

async function getFile(id, conversationId, businessContext) {
  const result = await pool.query(`SELECT a.* FROM omni_attachments a JOIN conversations c ON c.id = a.conversation_id
    WHERE a.id = $1 AND a.conversation_id = $2 AND a.business_context = $3
    AND COALESCE(c.business_context, 'event_genix') = $3`, [id, conversationId, businessContext]);
  if (!result.rows[0]) throw fail('Вкладення не знайдено.', 404);
  return result.rows[0];
}

async function fileForMessage(messageId, businessContext, attachmentId = null) {
  const result = await pool.query(`SELECT a.* FROM omni_attachments a JOIN conversations c ON c.id = a.conversation_id
    JOIN conversation_messages m ON m.conversation_id = c.id AND (m.id = a.message_id OR m.meta->'attachment'->>'id' = a.id::text)
    WHERE m.id = $1 AND a.business_context = $2 AND COALESCE(c.business_context, 'event_genix') = $2
      AND ($3::uuid IS NULL OR a.id = $3) ORDER BY a.source_index LIMIT 1`, [messageId, businessContext, attachmentId]);
  return result.rows[0] || null;
}

async function providerUrl(file, businessContext) {
  const { publicWebhookUrl, providerDefinition } = require('./omni-accounts');
  const webhook = publicWebhookUrl(providerDefinition('telegram'), { businessContext });
  if (!webhook || !webhook.startsWith('https://')) throw fail('Потрібна публічна HTTPS-адреса CRM.', 409);
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO omni_attachment_grants (token_hash, attachment_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')',
    [crypto.createHash('sha256').update(token).digest('hex'), file.id]);
  // Token grants one file only. It is never stored in message metadata or logs.
  return new URL('/api/omni/media/' + token + '/' + encodeURIComponent(file.filename), webhook).href;
}

async function grantedFile(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw fail('Посилання недоступне або прострочене.', 404);
  const result = await pool.query(`SELECT a.* FROM omni_attachments a JOIN omni_attachment_grants g ON g.attachment_id = a.id
    WHERE g.token_hash = $1 AND g.expires_at > NOW()`, [crypto.createHash('sha256').update(token).digest('hex')]);
  if (!result.rows[0]) throw fail('Посилання недоступне або прострочене.', 404);
  return result.rows[0];
}

async function sendAttachment(channel, externalId, text, file, businessContext) {
  validateFile({ buffer: file.content, mimetype: file.mime_type, originalname: file.filename }, channel);
  if (channel === 'telegram') {
    const { botToken } = await require('./omni-accounts').resolveOmniRuntimeConfig(channel, { businessContext });
    if (!botToken) throw fail('Telegram не підключено.', 409);
    const photo = file.mime_type.startsWith('image/');
    const body = new FormData(); body.set('chat_id', externalId);
    if (text) body.set('caption', text);
    body.set(photo ? 'photo' : 'document', new Blob([file.content], { type: file.mime_type }), file.filename);
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/${photo ? 'sendPhoto' : 'sendDocument'}`,
        { method: 'POST', body, signal: AbortSignal.timeout(30000), redirect: 'error' });
      const result = await response.json();
      return result.ok ? { success: true, messageId: result.result.message_id } :
        { success: false, uncertain: response.status >= 500, error: 'Telegram відхилив вкладення: ' + String(result.error_code || response.status) };
    } catch { return { success: false, uncertain: true, error: 'Результат надсилання вкладення невідомий. Звірте діалог; не надсилайте повторно.' }; }
  }
  const url = await providerUrl(file, businessContext);
  if (channel === 'viber') return require('./omni-viber').sendViber(externalId, text, {
    businessContext, type: file.mime_type.startsWith('image/') ? 'picture' : 'file', mediaUrl: url,
    fileName: file.filename, size: file.size_bytes });
  const attachment = { type: file.mime_type.startsWith('image/') ? 'image' : 'file', payload: { url } };
  return channel === 'facebook' ? require('./omni-facebook').sendFacebook(externalId, '', { businessContext, attachment })
    : require('./omni-instagram').sendInstagram(externalId, '', { businessContext, attachment });
}

// Resolve once, force public IPv4, and pass that exact address to HTTPS. Never follow redirects.
function publicAddress(address) {
  const p = String(address).split('.').map(Number);
  return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && ![0, 10, 127].includes(p[0]) && p[0] < 224
    && !(p[0] === 169 && p[1] === 254) && !(p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    && !(p[0] === 192 && (p[1] === 168 || p[1] === 0)) && !(p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    && !(p[0] === 198 && [18, 19].includes(p[1]));
}
async function downloadRemote(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw fail('Недозволена адреса вкладення.');
  const { address } = await dns.promises.lookup(url.hostname, { family: 4 });
  if (!publicAddress(address)) throw fail('Недозволена адреса вкладення.');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { lookup: (host, options, cb) => cb(null, options.all ? [{ address, family: 4 }] : address, 4) }, res => {
      if (res.statusCode !== 200 || Number(res.headers['content-length']) > MAX_BYTES) { res.resume(); return reject(fail('Вкладення недоступне або перевищує 10 МБ.')); }
      const parts = []; let size = 0;
      res.on('data', part => { size += part.length; if (size > MAX_BYTES) req.destroy(fail('Ліміт CRM — 10 МБ.', 413)); else parts.push(part); });
      res.on('error', reject);
      res.on('end', () => resolve({ buffer: Buffer.concat(parts), mimetype: String(res.headers['content-type'] || '').split(';')[0], originalname: url.pathname.split('/').pop() || 'attachment' }));
    });
    const timer = setTimeout(() => req.destroy(fail('Час завантаження вкладення вичерпано.', 504)), 20000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject);
  });
}

async function preserveInbound(message, normalized, businessContext) {
  if (!normalized.mediaUrl || (!['image', 'file'].includes(normalized.contentType) && !normalized.meta?.isStoryReply)) return message;
  if (message.meta?.storedAttachments?.length && !message.meta.attachmentError) return message;
  const urls = [...new Set([normalized.mediaUrl, ...(normalized.meta?.attachments || []).map(item => item.url).filter(Boolean)])];
  const stored = []; const errors = [];
  const existing = await pool.query('SELECT id, filename, mime_type, size_bytes, checksum, source_index FROM omni_attachments WHERE message_id = $1 AND business_context = $2', [message.id, businessContext]);
  for (let index = 0; index < Math.min(urls.length, 20); index++) {
    try {
      const prior = existing.rows.find(row => row.source_index === index);
      if (prior) { stored.push(metadata(prior)); continue; }
      const file = normalized.channel === 'telegram'
        ? await require('./omni-inbox').getTelegramAttachment(message.id, businessContext)
        : await downloadRemote(urls[index]);
      stored.push(await storeFile(message.conversationId, businessContext,
        { ...file, originalname: file.originalname || file.filename }, message.id, index));
    } catch { errors.push(index + 1); }
  }
  const attachmentError = errors.length || urls.length > 20 ? 'Не всі файли збережено. Підтримуються JPEG, PNG, PDF до 10 МБ, до 20 вкладень у повідомленні. Недоступні файли відкрийте в каналі.' : null;
  const meta = { storedAttachments: stored, attachmentError };
  const result = await pool.query("UPDATE conversation_messages SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb WHERE id = $1 RETURNING *", [message.id, JSON.stringify(meta)]);
  return { ...message, ...require('./omni-hub').mapMessageRow(result.rows[0]) };
}

module.exports = { MAX_BYTES, capabilities, validateFile, conversation, metadata, storeFile, getFile,
  fileForMessage, providerUrl, grantedFile, sendAttachment, publicAddress, downloadRemote, preserveInbound };
