"use strict";

const https = require('https');
const { resolveOmniRuntimeConfig } = require('./omni-accounts');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');

const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WHATSAPP_TEXT_LEN = 4096;
const MAX_WHATSAPP_CAPTION_LEN = 1024;
const DEFAULT_GRAPH_VERSION = 'v21.0';
const TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE_RE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const UNSAFE_PARAMETER_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const templateCache = new Map();

function omniBusinessContext(options = {}) {
  return normalizeBusinessContext(options.businessContext || options.business_context || DEFAULT_BUSINESS_CONTEXT);
}

function graphApiVersion(runtime = {}) {
  const raw = String(runtime.apiVersion || process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION).trim();
  return /^v\d+\.\d+$/.test(raw) ? raw : DEFAULT_GRAPH_VERSION;
}

function whatsappReplyWindowState(lastInboundAt, now = new Date()) {
  const message = 'WhatsApp дозволяє довільну відповідь лише протягом 24 годин після останнього повідомлення клієнта. Використайте approved template у WhatsApp Business Platform або дочекайтесь нового повідомлення клієнта.';
  if (!lastInboundAt) return { open: false, message, ageMs: null, closesAt: null, remainingMs: 0 };
  const last = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  const timestamp = last.getTime();
  if (!Number.isFinite(timestamp)) return { open: false, message, ageMs: null, closesAt: null, remainingMs: 0 };
  const ageMs = now.getTime() - timestamp;
  const closesAt = new Date(timestamp + WHATSAPP_REPLY_WINDOW_MS).toISOString();
  return {
    open: ageMs >= 0 && ageMs <= WHATSAPP_REPLY_WINDOW_MS,
    message,
    ageMs,
    closesAt,
    remainingMs: Math.max(0, WHATSAPP_REPLY_WINDOW_MS - Math.max(0, ageMs)),
  };
}

function providerError(result, status, fallback) {
  const error = new Error(result?.error?.message || fallback);
  error.statusCode = status;
  error.code = status === 401 || status === 403 ? 'WHATSAPP_TEMPLATE_AUTH_FAILED' : 'WHATSAPP_TEMPLATE_PROVIDER_ERROR';
  return error;
}

async function graphJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(15000),
    redirect: 'error',
  });
  const result = await parseResponseJson(response);
  if (!response.ok) throw providerError(result, response.status, `WhatsApp Cloud API HTTP ${response.status}`);
  return result;
}

function templateParameterNames(text) {
  const result = [];
  const seen = new Set();
  for (const match of String(text || '').matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)) {
    const name = match[1];
    if (!UNSAFE_PARAMETER_NAMES.has(name) && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

function normalizeTemplate(raw) {
  const components = Array.isArray(raw?.components) ? raw.components : [];
  const header = components.find(component => component?.type === 'HEADER') || null;
  const body = components.find(component => component?.type === 'BODY') || null;
  const footer = components.find(component => component?.type === 'FOOTER') || null;
  const buttons = components.find(component => component?.type === 'BUTTONS')?.buttons || [];
  const headerFormat = String(header?.format || 'TEXT').toUpperCase();
  const headerText = headerFormat === 'TEXT' ? String(header?.text || '') : '';
  const bodyText = String(body?.text || '');
  const dynamicUrlButton = buttons.some(button => String(button?.type || '').toUpperCase() === 'URL' && /{{\s*[^}]+\s*}}/.test(button?.url || ''));
  const hasUnsafeParameter = [headerText, bodyText].some(text =>
    Array.from(String(text || '').matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g))
      .some(match => UNSAFE_PARAMETER_NAMES.has(match[1])));
  const unsupportedReason = header && headerFormat !== 'TEXT'
    ? 'Шаблони з медіа-заголовком поки не підтримуються в Omni.'
    : dynamicUrlButton
      ? 'Шаблони з динамічним URL поки не підтримуються в Omni.'
      : hasUnsafeParameter
        ? 'Шаблон містить непідтримувану назву змінної.'
      : !bodyText
        ? 'Шаблон не містить текстового body.'
        : null;
  return {
    id: String(raw?.id || ''),
    name: String(raw?.name || ''),
    language: String(raw?.language || ''),
    category: String(raw?.category || ''),
    status: String(raw?.status || ''),
    header: headerText,
    body: bodyText,
    footer: String(footer?.text || ''),
    parameters: {
      header: templateParameterNames(headerText),
      body: templateParameterNames(bodyText),
    },
    buttons: buttons.map((button, index) => ({
      index,
      type: String(button?.type || '').toLowerCase(),
      text: String(button?.text || ''),
    })),
    supported: !unsupportedReason,
    unsupportedReason,
  };
}

function cacheKey(runtime, businessContext) {
  return `${businessContext}:${runtime.wabaId}`;
}

async function fetchApprovedWhatsAppTemplates(options = {}) {
  const businessContext = omniBusinessContext(options);
  const runtime = await resolveOmniRuntimeConfig('whatsapp', { businessContext });
  if (!runtime.accessToken || !runtime.wabaId) {
    throw Object.assign(new Error('WhatsApp templates are unavailable because WABA is not configured.'), {
      statusCode: 400,
      code: 'WHATSAPP_TEMPLATE_MISSING_CONFIG',
    });
  }
  const key = cacheKey(runtime, businessContext);
  const cached = templateCache.get(key);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.templates;

  const templates = [];
  let after = '';
  const seenCursors = new Set();
  let pages = 0;
  do {
    const params = new URLSearchParams({
      fields: 'id,name,status,category,language,components',
      limit: '100',
    });
    if (after) params.set('after', after);
    const result = await graphJson(
      `https://graph.facebook.com/${graphApiVersion(runtime)}/${encodeURIComponent(runtime.wabaId)}/message_templates?${params}`,
      { headers: { Authorization: `Bearer ${runtime.accessToken}` } }
    );
    templates.push(...(Array.isArray(result.data) ? result.data : []));
    const nextCursor = String(result?.paging?.cursors?.after || '');
    after = result?.paging?.next && nextCursor && !seenCursors.has(nextCursor) && pages < 19 ? nextCursor : '';
    if (after) seenCursors.add(after);
    pages++;
  } while (after);

  const approved = templates
    .filter(template => String(template?.status || '').toUpperCase() === 'APPROVED')
    .map(normalizeTemplate)
    .filter(template => TEMPLATE_NAME_RE.test(template.name) && TEMPLATE_LANGUAGE_RE.test(template.language))
    .sort((left, right) => left.name.localeCompare(right.name) || left.language.localeCompare(right.language));
  templateCache.set(key, { expiresAt: Date.now() + TEMPLATE_CACHE_TTL_MS, templates: approved });
  return approved;
}

function normalizeTemplateValues(value, allowedNames, section) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allowed = new Set(allowedNames);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw Object.assign(new Error(`Невідома змінна ${section}: ${key}`), { statusCode: 400, code: 'WHATSAPP_TEMPLATE_INVALID_PARAMETERS' });
  }
  const normalized = Object.create(null);
  for (const name of allowedNames) {
    const text = String(source[name] ?? '').trim();
    if (!text) throw Object.assign(new Error(`Заповніть змінну ${section}: ${name}`), { statusCode: 400, code: 'WHATSAPP_TEMPLATE_MISSING_PARAMETER' });
    if (text.length > MAX_WHATSAPP_TEXT_LEN) throw Object.assign(new Error(`Значення змінної ${section}: ${name} завелике.`), { statusCode: 400, code: 'WHATSAPP_TEMPLATE_INVALID_PARAMETERS' });
    normalized[name] = text;
  }
  return normalized;
}

function templateText(text, values) {
  return String(text || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, name) => values[name] ?? `{{${name}}}`);
}

function textParameters(names, values) {
  return names.map(name => (/^\d+$/.test(name)
    ? { type: 'text', text: values[name] }
    : { type: 'text', parameter_name: name, text: values[name] }));
}

async function prepareWhatsAppTemplateRequest(request = {}, options = {}) {
  const name = String(request.name || '').trim();
  const language = String(request.language || '').trim();
  if (!TEMPLATE_NAME_RE.test(name) || !TEMPLATE_LANGUAGE_RE.test(language)) {
    throw Object.assign(new Error('Невалідні назва або мова WhatsApp template.'), { statusCode: 400, code: 'WHATSAPP_TEMPLATE_INVALID' });
  }
  const approved = await fetchApprovedWhatsAppTemplates({ ...options, refresh: true });
  const template = approved.find(item => item.name === name && item.language === language);
  if (!template) throw Object.assign(new Error('Approved WhatsApp template не знайдено або він більше недоступний.'), { statusCode: 409, code: 'WHATSAPP_TEMPLATE_NOT_APPROVED' });
  if (!template.supported) throw Object.assign(new Error(template.unsupportedReason), { statusCode: 422, code: 'WHATSAPP_TEMPLATE_UNSUPPORTED' });

  const parameters = request.parameters && typeof request.parameters === 'object' && !Array.isArray(request.parameters)
    ? request.parameters : {};
  const headerValues = normalizeTemplateValues(parameters.header, template.parameters.header, 'header');
  const bodyValues = normalizeTemplateValues(parameters.body, template.parameters.body, 'body');
  const components = [];
  if (template.parameters.header.length) components.push({ type: 'header', parameters: textParameters(template.parameters.header, headerValues) });
  if (template.parameters.body.length) components.push({ type: 'body', parameters: textParameters(template.parameters.body, bodyValues) });
  for (const button of template.buttons.filter(item => item.type === 'quick_reply')) {
    components.push({ type: 'button', sub_type: 'quick_reply', index: String(button.index), parameters: [{ type: 'payload', payload: `omni:${template.id || template.name}:${button.index}`.slice(0, 256) }] });
  }
  const preview = [
    templateText(template.header, headerValues),
    templateText(template.body, bodyValues),
    template.footer,
  ].filter(Boolean).join('\n');
  return {
    name: template.name,
    language: template.language,
    category: template.category,
    preview,
    components,
  };
}

async function sendWhatsAppTemplate(to, prepared, options = {}) {
  const businessContext = omniBusinessContext(options);
  const runtime = await resolveOmniRuntimeConfig('whatsapp', { businessContext });
  if (!runtime.accessToken || !runtime.phoneNumberId) {
    return { success: false, ok: false, code: 'missing_config', error: 'WhatsApp Cloud API is not configured.' };
  }
  try {
    const result = await graphJson(
      `https://graph.facebook.com/${graphApiVersion(runtime)}/${encodeURIComponent(runtime.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${runtime.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: String(to || '').replace(/^\+/, ''),
          type: 'template',
          template: {
            name: prepared.name,
            language: { code: prepared.language },
            ...(prepared.components.length ? { components: prepared.components } : {}),
          },
        }),
      }
    );
    return { success: true, ok: true, messageId: result.messages?.[0]?.id || null, messages: result.messages || [], contacts: result.contacts || [], result };
  } catch (err) {
    return {
      success: false,
      ok: false,
      code: err.statusCode === 401 || err.statusCode === 403 ? 'failed_auth' : 'provider_error',
      error: err.message || 'WhatsApp template send failed.',
      result: null,
      ...(!err.statusCode || err.statusCode >= 500 ? { uncertain: true } : {}),
    };
  }
}

function clearWhatsAppTemplateCache() {
  templateCache.clear();
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
  sendWhatsAppTemplate,
  fetchApprovedWhatsAppTemplates,
  prepareWhatsAppTemplateRequest,
  normalizeTemplate,
  clearWhatsAppTemplateCache,
  whatsappReplyWindowState,
  WHATSAPP_REPLY_WINDOW_MS,
  MAX_WHATSAPP_CAPTION_LEN,
};
