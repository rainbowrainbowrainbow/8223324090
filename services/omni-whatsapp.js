"use strict";

const https = require('https');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');

const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WHATSAPP_TEXT_LEN = 4096;
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

module.exports = {
  sendWhatsApp,
  whatsappReplyWindowState,
  WHATSAPP_REPLY_WINDOW_MS,
};
