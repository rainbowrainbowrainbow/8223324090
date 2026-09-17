"use strict";

const https = require('https');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');

const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WHATSAPP_TEXT_LEN = 4096;
const MAX_WHATSAPP_CAPTION_LEN = 1024;
const DEFAULT_GRAPH_VERSION = 'v21.0';

function omniBusinessContext(options = {}) {
  return normalizeBusinessContext(options.businessContext || options.business_context || DEFAULT_BUSINESS_CONTEXT);
}

function graphApiVersion(runtime = {}) {
  const raw = String(runtime.apiVersion || process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION).trim();
  return /^v\d+\.\d+$/.test(raw) ? raw : DEFAULT_GRAPH_VERSION;
}

function whatsappReplyWindowState(lastInboundAt, now = new Date()) {
  const message = 'WhatsApp дозволяє довільну відповідь лише протягом 24 годин після останнього повідомлення клієнта. Використайте approved template у WhatsApp Business Platform або дочекайтесь нового повідомлення клієнта.';
  if (!lastInboundAt) return { open: false, message, ageMs: null };
  const last = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  const timestamp = last.getTime();
  if (!Number.isFinite(timestamp)) return { open: false, message, ageMs: null };
  const ageMs = now.getTime() - timestamp;
  return { open: ageMs >= 0 && ageMs <= WHATSAPP_REPLY_WINDOW_MS, message, ageMs };
}

function postJson(options, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      ...options,
      method: 'POST',
      headers: {
        ...(options.headers || {}),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
        if (res.statusCode >= 400) {
          const err = new Error(parsed.error?.message || `WhatsApp Cloud API HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.payload = parsed;
          reject(err);
          return;
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('WhatsApp Cloud API timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function parseResponseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function providerFailure(result, status, fallback) {
  const message = result?.error?.message || fallback;
  return {
    success: false,
    ok: false,
    code: status === 401 || status === 403 ? 'failed_auth' : 'provider_error',
    error: message,
    result,
  };
}

async function uploadWhatsAppMedia(runtime, file) {
  const body = new FormData();
  body.set('messaging_product', 'whatsapp');
  body.set('type', file.mime_type);
  body.set('file', new Blob([file.content], { type: file.mime_type }), file.filename);
  const response = await fetch(
    `https://graph.facebook.com/${graphApiVersion(runtime)}/${encodeURIComponent(runtime.phoneNumberId)}/media`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${runtime.accessToken}` },
      body,
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    }
  );
  const result = await parseResponseJson(response);
  if (!response.ok || !result.id) {
    const error = new Error(result?.error?.message || `WhatsApp media upload HTTP ${response.status}`);
    error.statusCode = response.status;
    error.payload = result;
    throw error;
  }
  return result.id;
}

async function sendWhatsApp(to, text, options = {}) {
  const businessContext = omniBusinessContext(options);
  const runtime = await resolveOmniRuntimeConfig('whatsapp', { businessContext });
  if (!runtime.accessToken || !runtime.phoneNumberId) {
    return { success: false, ok: false, code: 'missing_config', error: 'WhatsApp Cloud API is not configured.' };
  }
  const body = String(text || '').trim();
  if (!body) return { success: false, ok: false, code: 'empty_message', error: 'WhatsApp text message is empty.' };
  if (body.length > MAX_WHATSAPP_TEXT_LEN) {
    return { success: false, ok: false, code: 'message_too_long', error: `WhatsApp text message exceeds ${MAX_WHATSAPP_TEXT_LEN} characters.` };
  }

  try {
    const result = await postJson({
      hostname: 'graph.facebook.com',
      path: `/${graphApiVersion(runtime)}/${encodeURIComponent(runtime.phoneNumberId)}/messages`,
      headers: { Authorization: `Bearer ${runtime.accessToken}` },
    }, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to || '').replace(/^\+/, ''),
      type: 'text',
      text: { preview_url: false, body },
    });
    return {
      success: true,
      ok: true,
      messageId: result.messages?.[0]?.id || null,
      messages: result.messages || [],
      contacts: result.contacts || [],
      result,
    };
  } catch (err) {
    return {
      success: false,
      ok: false,
      code: err.statusCode === 401 || err.statusCode === 403 ? 'failed_auth' : 'provider_error',
      error: err.message || 'WhatsApp Cloud API send failed.',
      result: err.payload || null,
    };
  }
}

async function sendWhatsAppAttachment(to, text, file, options = {}) {
  const businessContext = omniBusinessContext(options);
  const runtime = await resolveOmniRuntimeConfig('whatsapp', { businessContext });
  if (!runtime.accessToken || !runtime.phoneNumberId) {
    return { success: false, ok: false, code: 'missing_config', error: 'WhatsApp Cloud API is not configured.' };
  }
  if (!Buffer.isBuffer(file?.content) || !file.content.length) {
    return { success: false, ok: false, code: 'empty_attachment', error: 'WhatsApp attachment is empty.' };
  }
  const mediaType = file.mime_type?.startsWith('image/') ? 'image'
    : file.mime_type === 'application/pdf' ? 'document' : null;
  if (!mediaType) {
    return { success: false, ok: false, code: 'unsupported_attachment', error: 'WhatsApp attachment type is not supported.' };
  }
  const caption = String(text || '').trim();
  if (caption.length > MAX_WHATSAPP_CAPTION_LEN) {
    return { success: false, ok: false, code: 'caption_too_long', error: `WhatsApp caption exceeds ${MAX_WHATSAPP_CAPTION_LEN} characters.` };
  }

  let mediaId;
  try {
    mediaId = await uploadWhatsAppMedia(runtime, file);
  } catch (err) {
    return providerFailure(err.payload || null, err.statusCode, err.message || 'WhatsApp media upload failed.');
  }

  const media = { id: mediaId };
  if (caption) media.caption = caption;
  if (mediaType === 'document') media.filename = file.filename;
  try {
    const result = await postJson({
      hostname: 'graph.facebook.com',
      path: `/${graphApiVersion(runtime)}/${encodeURIComponent(runtime.phoneNumberId)}/messages`,
      headers: { Authorization: `Bearer ${runtime.accessToken}` },
    }, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to || '').replace(/^\+/, ''),
      type: mediaType,
      [mediaType]: media,
    });
    return {
      success: true,
      ok: true,
      messageId: result.messages?.[0]?.id || null,
      messages: result.messages || [],
      contacts: result.contacts || [],
      result,
    };
  } catch (err) {
    const failure = providerFailure(err.payload || null, err.statusCode, err.message || 'WhatsApp media send failed.');
    if (!err.statusCode || err.statusCode >= 500) failure.uncertain = true;
    return failure;
  }
}

module.exports = {
  sendWhatsApp,
  sendWhatsAppAttachment,
  whatsappReplyWindowState,
  WHATSAPP_REPLY_WINDOW_MS,
  MAX_WHATSAPP_CAPTION_LEN,
};
