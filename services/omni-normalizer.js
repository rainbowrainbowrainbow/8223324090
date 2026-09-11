/**
 * services/omni-normalizer.js — Omni-channel webhook payload normalizer
 *
 * Converts incoming payloads from different messaging channels
 * into a unified internal format for Event Genix CRM processing.
 *
 * Supported channels: telegram, viber, sms, facebook, instagram, whatsapp, binotel
 */
const { createLogger } = require('../utils/logger');

const log = createLogger('OmniNormalizer');

const MAX_TEXT_LEN = 10000;
const MAX_NAME_LEN = 255;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeString(val, maxLen) {
  if (val == null) return null;
  const s = String(val);
  return maxLen && s.length > maxLen ? s.slice(0, maxLen) : s;
}

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('https://') || url.startsWith('http://');
}

function safeCoords(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return `${la},${lo}`;
}

function buildResult(fields) {
  const externalId = fields.externalId ? String(fields.externalId).trim() : null;
  if (!externalId) {
    log.warn(`Skipping message with empty externalId for channel=${fields.channel}`);
    return null;
  }
  const text = safeString(fields.text, MAX_TEXT_LEN);
  const mediaUrl = fields.mediaUrl && isValidUrl(fields.mediaUrl) ? fields.mediaUrl : (fields.mediaUrl || null);
  return {
    channel: fields.channel || 'unknown',
    externalId,
    senderName: safeString(fields.senderName, MAX_NAME_LEN),
    text,
    content: text, // alias — omni-hub uses content
    contentType: fields.contentType || 'text',
    mediaUrl,
    phone: safeString(fields.phone, 50),
    externalMessageId: fields.externalMessageId || null,
    rawEvent: fields.rawEvent || null,
    meta: fields.meta || {},
  };
}

function normalizeProviderTimestamp(value) {
  if (value == null || value === '') return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 100000000000) return new Date(numeric).toISOString();
    if (numeric > 1000000000) return new Date(numeric * 1000).toISOString();
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function classifyIgnored(reason, details = {}) {
  return { type: 'ignored', reason, ...details };
}

function detectTelegramContentType(message) {
  if (message.photo) return 'image';
  if (message.document) return 'file';
  if (message.audio || message.voice) return 'audio';
  if (message.video || message.video_note) return 'video';
  if (message.location) return 'location';
  if (message.contact) return 'contact';
  if (message.sticker) return 'sticker';
  return 'text';
}

function pickTelegramMediaUrl(message) {
  // Telegram stores file_id; the actual URL must be resolved via getFile API.
  // We return the file_id so downstream code can fetch it.
  if (message.photo && message.photo.length) {
    return message.photo[message.photo.length - 1].file_id;
  }
  if (message.document) return message.document.file_id;
  if (message.audio) return message.audio.file_id;
  if (message.voice) return message.voice.file_id;
  if (message.video) return message.video.file_id;
  if (message.video_note) return message.video_note.file_id;
  if (message.sticker) return message.sticker.file_id;
  return null;
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

function normalizeTelegram(payload) {
  const rawPayload = payload && typeof payload === 'object' ? payload : {};
  const message = rawPayload.message || rawPayload.edited_message || rawPayload.channel_post || {};
  const from = message.from || {};

  const contentType = detectTelegramContentType(message);
  const mediaUrl = pickTelegramMediaUrl(message);

  let text = message.text || message.caption || null;
  if (contentType === 'location' && message.location) {
    text = safeCoords(message.location.latitude, message.location.longitude) || text;
  }
  if (contentType === 'contact' && message.contact) {
    text = message.contact.phone_number || null;
  }

  const result = buildResult({
    channel: 'telegram',
    externalId: String(message.chat?.id || from.id || ''),
    senderName: [from.first_name, from.last_name].filter(Boolean).join(' ') || null,
    text,
    contentType,
    mediaUrl,
    phone: message.contact?.phone_number || null,
    externalMessageId: message.message_id ? String(message.message_id) : null,
    rawEvent: rawPayload,
    meta: {
      chatId: message.chat?.id || null,
      messageId: message.message_id || null,
      isBot: from.is_bot || false,
      language: from.language_code || null,
      editedAt: message.edit_date || null,
    },
  });

  if (!result) {
    log.warn('Skipping Telegram payload without sender or chat id');
    return null;
  }

  log.debug('Normalized Telegram payload', { externalId: result.externalId, contentType });
  return result;
}

function normalizeTelegramBotMilestone(payload) {
  const rawPayload = payload && typeof payload === 'object' ? payload : {};
  const eventKey = safeString(
    rawPayload.event_key || rawPayload.eventKey || rawPayload.type,
    100
  );
  const telegramUserId = safeString(
    rawPayload.telegram_user_id
      || rawPayload.telegramUserId
      || rawPayload.external_id
      || rawPayload.externalId,
    100
  );
  if (!telegramUserId || !eventKey) {
    log.warn('Skipping Telegram bot milestone without telegram user id or event key');
    return null;
  }

  const occurredAt = normalizeProviderTimestamp(
    rawPayload.occurred_at || rawPayload.occurredAt || rawPayload.timestamp
  );
  const title = safeString(rawPayload.title, MAX_NAME_LEN);
  const text = safeString(
    rawPayload.content || rawPayload.text || title || eventKey,
    MAX_TEXT_LEN
  );
  const telegramUsername = safeString(
    rawPayload.telegram_username || rawPayload.telegramUsername,
    MAX_NAME_LEN
  );
  const externalMessageId = safeString(
    rawPayload.external_message_id
      || rawPayload.externalMessageId
      || `bot:${eventKey}:${telegramUserId}:${occurredAt || Date.now()}`,
    255
  );
  const rawMeta = rawPayload.meta && typeof rawPayload.meta === 'object'
    ? rawPayload.meta
    : {};

  return buildResult({
    channel: 'telegram',
    externalId: telegramUserId,
    senderName: telegramUsername ? `@${telegramUsername.replace(/^@/, '')}` : null,
    text,
    contentType: 'text',
    externalMessageId,
    rawEvent: rawPayload,
    meta: {
      ...rawMeta,
      botEvent: true,
      direction: 'bot_outbound',
      eventKey,
      title: title || null,
      occurredAt,
      telegramUserId,
      telegramUsername: telegramUsername || null,
    },
  });
}

// ---------------------------------------------------------------------------
// Viber
// ---------------------------------------------------------------------------

function normalizeViber(payload) {
  const event = payload.event || '';
  const sender = payload.sender || {};
  const message = payload.message || {};

  const typeMap = {
    text: 'text',
    picture: 'image',
    video: 'video',
    file: 'file',
    contact: 'contact',
    location: 'location',
    sticker: 'sticker',
  };
  const contentType = typeMap[message.type] || 'text';

  let text = message.text || null;
  let mediaUrl = message.media || null;

  if (contentType === 'location' && message.location) {
    text = safeCoords(message.location.lat, message.location.lon) || text;
    mediaUrl = null;
  }
  if (contentType === 'contact' && message.contact) {
    text = (message.contact && message.contact.phone_number) || null;
    mediaUrl = null;
  }
  if (contentType === 'sticker') {
    mediaUrl = message.media || null;
  }

  const result = buildResult({
    channel: 'viber',
    externalId: sender.id || payload.user_id || null,
    senderName: sender.name || null,
    text,
    contentType,
    mediaUrl,
    phone: (message.contact && message.contact.phone_number) || sender.phone || null,
    externalMessageId: payload.message_token ? String(payload.message_token) : null,
    rawEvent: payload,
    meta: {
      event,
      messageToken: payload.message_token || null,
      timestamp: payload.timestamp || null,
      avatar: sender.avatar || null,
    },
  });

  if (result) log.debug('Normalized Viber payload', { externalId: result.externalId, contentType, event });
  return result;
}

function classifyViberWebhook(payload = {}) {
  payload = payload || {};
  const event = String(payload.event || '').toLowerCase();
  if (event === 'webhook') return classifyIgnored('webhook_verification');

  if (event === 'message') {
    const normalized = normalizeViber(payload);
    return normalized
      ? { type: 'inbound_message', normalized }
      : classifyIgnored('invalid_viber_message');
  }

  const providerMessageId = payload.message_token || payload.messageToken || null;
  if (!providerMessageId) return classifyIgnored('missing_viber_message_token', { event });

  if (event === 'delivered') {
    return {
      type: 'delivery_receipt',
      receipt: {
        channel: 'viber',
        providerMessageId: String(providerMessageId),
        deliveryStatus: 'delivered',
        providerLifecycleAt: normalizeProviderTimestamp(payload.timestamp),
        providerLifecycleEvent: 'delivered',
        providerLifecycleSource: 'viber_webhook',
      },
    };
  }

  if (event === 'seen') {
    return {
      type: 'read_receipt',
      receipt: {
        channel: 'viber',
        providerMessageId: String(providerMessageId),
        deliveryStatus: 'read',
        providerLifecycleAt: normalizeProviderTimestamp(payload.timestamp),
        providerLifecycleEvent: 'seen',
        providerLifecycleSource: 'viber_webhook',
      },
    };
  }

  if (event === 'failed') {
    const error = payload.desc || payload.description || payload.status_message || payload.error || 'Viber failed callback';
    return {
      type: 'delivery_receipt',
      receipt: {
        channel: 'viber',
        providerMessageId: String(providerMessageId),
        deliveryStatus: 'later_failed',
        deliveryError: safeString(error, 1000),
        providerLifecycleAt: normalizeProviderTimestamp(payload.timestamp),
        providerLifecycleEvent: 'failed',
        providerLifecycleSource: 'viber_webhook',
      },
    };
  }

  return classifyIgnored('unsupported_viber_event', { event });
}

// ---------------------------------------------------------------------------
// SMS (generic provider format — FlySMS, TurboSMS, eSputnik, or similar)
// ---------------------------------------------------------------------------

function normalizeSms(payload) {
  const phone = payload.from || payload.phone || payload.sender || null;
  const text = payload.text || payload.message || payload.body || null;

  const result = buildResult({
    channel: 'sms',
    externalId: phone,
    senderName: phone,
    text,
    contentType: 'text',
    mediaUrl: null,
    phone,
    externalMessageId: payload.message_id || payload.id || null,
    rawEvent: payload,
    meta: {
      messageId: payload.message_id || payload.id || null,
      timestamp: payload.timestamp || payload.date || null,
      operator: payload.operator || null,
    },
  });

  if (result) log.debug('Normalized SMS payload', { externalId: result.externalId });
  return result;
}

function pickSmsProviderMessageId(payload = {}) {
  return payload.message_id
    || payload.messageId
    || payload.id
    || payload.sms_id
    || payload.smsId
    || payload.msg_id
    || payload.msgId
    || null;
}

function pickSmsProviderStatus(payload = {}) {
  return payload.status
    || payload.status_code
    || payload.statusCode
    || payload.state
    || payload.dlr_status
    || payload.dlrStatus
    || payload.message_status
    || payload.messageStatus
    || null;
}

function mapSmsDeliveryStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (!normalized) return null;
  if (['DELIVRD', 'DELIVERED', 'SUCCESS'].includes(normalized)) return 'delivered';
  if (['SENT', 'ACCEPTD', 'ACCEPTED'].includes(normalized)) return 'accepted';
  if (['UNDELIV', 'UNDELIVERED', 'REJECTD', 'REJECTED', 'EXPIRED', 'FAILED', 'ERROR', 'CANCELLED', 'STOPED', 'INSUFFICIENTFUNDS', 'REFUND'].includes(normalized)) {
    return 'later_failed';
  }
  return null;
}

function smsLifecycleSource(payload = {}) {
  const provider = String(payload.provider || payload.provider_name || payload.gateway || payload.source || '').trim().toLowerCase();
  if (provider.includes('fly') || provider.includes('sms-fly')) return 'flysms_webhook';
  if (provider.includes('turbo')) return 'turbosms_webhook';
  return 'sms_provider_webhook';
}

function classifySmsWebhook(payload = {}) {
  payload = payload || {};
  const providerMessageId = pickSmsProviderMessageId(payload);
  const providerStatus = pickSmsProviderStatus(payload);
  const deliveryStatus = mapSmsDeliveryStatus(providerStatus);

  if (providerMessageId && deliveryStatus) {
    const providerLifecycleEvent = String(providerStatus).trim().toUpperCase();
    return {
      type: 'delivery_receipt',
      receipt: {
        channel: 'sms',
        providerMessageId: String(providerMessageId),
        deliveryStatus,
        deliveryError: deliveryStatus === 'later_failed' ? providerLifecycleEvent : null,
        providerLifecycleAt: normalizeProviderTimestamp(
          payload.timestamp || payload.date || payload.done_at || payload.doneAt || payload.done_date || payload.doneDate
        ),
        providerLifecycleEvent,
        providerLifecycleSource: smsLifecycleSource(payload),
      },
    };
  }

  if (providerMessageId && providerStatus) {
    return classifyIgnored('unsupported_sms_delivery_status', {
      providerMessageId: String(providerMessageId),
      providerStatus: String(providerStatus),
    });
  }

  const normalized = normalizeSms(payload);
  return normalized
    ? { type: 'inbound_message', normalized }
    : classifyIgnored('invalid_sms_message');
}

// ---------------------------------------------------------------------------
// Facebook Messenger
// ---------------------------------------------------------------------------

function normalizeFacebook(payload) {
  if (!payload || (!payload.entry && (!payload.message || payload.message.is_echo))) return null;
  // Accept both full webhook payload AND individual messaging event (from route pre-parse)
  let messaging;
  if (payload.sender && (payload.message || payload.postback)) {
    messaging = payload; // already extracted by route
  } else {
    const entry = (payload.entry && payload.entry[0]) || {};
    messaging = (entry.messaging && entry.messaging[0]) || {};
  }
  const sender = messaging.sender || {};
  const message = messaging.message || {};
  if (!messaging.message || message.is_echo) return null;

  let contentType = 'text';
  let mediaUrl = null;
  let text = message.text || null;

  if (message.attachments && message.attachments.length) {
    const attachment = message.attachments[0];
    const attType = attachment.type || '';

    const fbTypeMap = {
      image: 'image',
      video: 'video',
      audio: 'audio',
      file: 'file',
      location: 'location',
    };
    contentType = fbTypeMap[attType] || 'file';
    mediaUrl = attachment.payload?.url || null;

    if (attType === 'location' && attachment.payload?.coordinates) {
      const coords = attachment.payload.coordinates;
      text = safeCoords(coords.lat, coords.long) || text;
      mediaUrl = null;
    }
  }

  const result = buildResult({
    channel: 'facebook',
    externalId: sender.id || null,
    senderName: null, // FB requires a profile API call for name
    text,
    contentType,
    mediaUrl,
    externalMessageId: message.mid || null,
    rawEvent: payload,
    meta: {
      messageId: message.mid || null,
      timestamp: messaging.timestamp || null,
      attachments: (message.attachments || []).map(attachment => ({ type: attachment.type || 'file', url: attachment.payload?.url || null })).filter(attachment => attachment.url),
      isEcho: message.is_echo || false,
    },
  });

  if (!result) return null;
  log.debug('Normalized Facebook payload', { externalId: result.externalId, contentType });
  return result;
}

// ---------------------------------------------------------------------------
// Instagram (Messenger API — same structure as FB with slight differences)
// ---------------------------------------------------------------------------

function normalizeInstagram(payload) {
  if (!payload || (!payload.entry && (!payload.message || payload.message.is_echo))) return null;
  // Accept both full webhook payload AND individual messaging event (from route pre-parse)
  let messaging;
  if (payload.sender && (payload.message || payload.postback)) {
    messaging = payload;
  } else {
    const entry = (payload.entry && payload.entry[0]) || {};
    messaging = (entry.messaging && entry.messaging[0]) || {};
  }
  const sender = messaging.sender || {};
  const message = messaging.message || {};
  if (!messaging.message || message.is_echo) return null;

  let contentType = 'text';
  let mediaUrl = null;
  let text = message.text || null;

  if (message.attachments && message.attachments.length) {
    const attachment = message.attachments[0];
    const attType = attachment.type || '';

    const igTypeMap = {
      image: 'image',
      video: 'video',
      audio: 'audio',
      file: 'file',
      ig_reel: 'video',
      story_mention: 'image',
    };
    contentType = igTypeMap[attType] || 'file';
    mediaUrl = attachment.payload?.url || null;
  }

  // Instagram story replies
  if (message.reply_to && message.reply_to.story) {
    contentType = text ? 'text' : 'image';
    mediaUrl = mediaUrl || message.reply_to.story.url || null;
  }

  const result = buildResult({
    channel: 'instagram',
    externalId: sender.id || null,
    senderName: null, // requires profile API call
    text,
    contentType,
    mediaUrl,
    externalMessageId: message.mid || null,
    rawEvent: payload,
    meta: {
      messageId: message.mid || null,
      timestamp: messaging.timestamp || null,
      attachments: (message.attachments || []).map(attachment => ({ type: attachment.type || 'file', url: attachment.payload?.url || null })).filter(attachment => attachment.url),
      isStoryReply: !!(message.reply_to && message.reply_to.story),
    },
  });

  if (!result) return null;
  log.debug('Normalized Instagram payload', { externalId: result.externalId, contentType });
  return result;
}


// ---------------------------------------------------------------------------
// WhatsApp Business Platform / Cloud API
// ---------------------------------------------------------------------------

function whatsappMessageContent(message = {}) {
  const type = String(message.type || 'text').toLowerCase();
  if (type === 'text') return { contentType: 'text', text: message.text?.body || null, mediaUrl: null };
  if (type === 'button') return { contentType: 'text', text: message.button?.text || message.button?.payload || null, mediaUrl: null };
  if (type === 'interactive') {
    const interactive = message.interactive || {};
    return {
      contentType: 'text',
      text: interactive.button_reply?.title || interactive.button_reply?.id || interactive.list_reply?.title || interactive.list_reply?.id || null,
      mediaUrl: null,
    };
  }
  if (type === 'location') {
    return { contentType: 'location', text: safeCoords(message.location?.latitude, message.location?.longitude), mediaUrl: null };
  }
  if (type === 'contacts') {
    const contact = Array.isArray(message.contacts) ? message.contacts[0] : null;
    const phone = contact?.phones?.[0]?.phone || contact?.phones?.[0]?.wa_id || null;
    return { contentType: 'contact', text: phone, mediaUrl: null };
  }
  if (['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
    const node = message[type] || {};
    return {
      contentType: type === 'document' ? 'file' : type,
      text: node.caption || null,
      mediaUrl: node.link || node.id || null,
    };
  }
  return { contentType: 'unsupported', text: null, mediaUrl: null };
}

function normalizeWhatsAppMessage(message, value = {}) {
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const contact = contacts.find(item => String(item.wa_id || '') === String(message?.from || '')) || contacts[0] || {};
  const waId = contact.wa_id || message?.from || null;
  const content = whatsappMessageContent(message || {});
  const unsupportedContent = content.contentType === 'unsupported' || (!content.text && !content.mediaUrl);

  const result = buildResult({
    channel: 'whatsapp',
    externalId: message?.from || waId,
    senderName: contact.profile?.name || waId || null,
    text: content.text,
    contentType: content.contentType === 'unsupported' ? 'text' : content.contentType,
    mediaUrl: content.mediaUrl,
    phone: waId ? `+${String(waId).replace(/^\+/, '')}` : null,
    externalMessageId: message?.id || null,
    rawEvent: { message, value },
    meta: {
      provider: 'whatsapp_cloud_api',
      wamid: message?.id || null,
      messageId: message?.id || null,
      timestamp: normalizeProviderTimestamp(message?.timestamp),
      phoneNumberId: value.metadata?.phone_number_id || null,
      displayPhoneNumber: value.metadata?.display_phone_number || null,
      waId: waId || null,
      type: message?.type || null,
      unsupportedContent,
    },
  });

  if (!result) return null;
  log.debug('Normalized WhatsApp payload', { externalId: result.externalId, contentType: result.contentType });
  return result;
}

function mapWhatsAppDeliveryStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'sent') return 'accepted';
  if (normalized === 'delivered') return 'delivered';
  if (normalized === 'read') return 'read';
  if (['failed', 'deleted'].includes(normalized)) return 'later_failed';
  return null;
}

function normalizeWhatsAppStatus(status, value = {}) {
  const providerMessageId = status?.id || null;
  const deliveryStatus = mapWhatsAppDeliveryStatus(status?.status);
  if (!providerMessageId || !deliveryStatus) return null;
  const error = Array.isArray(status.errors) && status.errors.length
    ? (status.errors[0].message || status.errors[0].title || status.errors[0].code || 'WhatsApp delivery failed')
    : null;
  return {
    channel: 'whatsapp',
    providerMessageId: String(providerMessageId),
    deliveryStatus,
    deliveryError: deliveryStatus === 'later_failed' ? safeString(error || 'WhatsApp delivery failed', 1000) : null,
    providerLifecycleAt: normalizeProviderTimestamp(status.timestamp),
    providerLifecycleEvent: status.status || null,
    providerLifecycleSource: 'whatsapp_webhook',
    meta: {
      provider: 'whatsapp_cloud_api',
      recipientId: status.recipient_id || null,
      conversationId: status.conversation?.id || null,
      pricingCategory: status.pricing?.category || null,
      phoneNumberId: value.metadata?.phone_number_id || null,
    },
  };
}

function classifyWhatsAppWebhook(payload = {}) {
  const events = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change.value || {};
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const normalized = normalizeWhatsAppMessage(message, value);
        events.push(normalized ? { type: 'inbound_message', normalized, entry, change } : classifyIgnored('invalid_whatsapp_message', { entry, change }));
      }
      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        const receipt = normalizeWhatsAppStatus(status, value);
        events.push(receipt ? { type: receipt.deliveryStatus === 'read' ? 'read_receipt' : 'delivery_receipt', receipt, entry, change } : classifyIgnored('unsupported_whatsapp_status', { entry, change }));
      }
      if (!Array.isArray(value.messages) && !Array.isArray(value.statuses)) {
        events.push(classifyIgnored('unsupported_whatsapp_change', { entry, change }));
      }
    }
  }
  return events.length ? events : [classifyIgnored('empty_whatsapp_webhook')];
}


// ---------------------------------------------------------------------------
// Binotel (Ukrainian cloud PBX — webhook on call events)
// ---------------------------------------------------------------------------

function normalizeBinotel(payload) {
  const callerNumber = payload.externalNumber || payload.caller_number || payload.src || null;
  const agentNumber = payload.internalNumber || payload.agent_number || payload.dst || null;
  const callType = payload.callType || payload.call_type || payload.disposition || 'unknown';

  const result = buildResult({
    channel: 'binotel',
    externalId: callerNumber,
    senderName: payload.callerName || payload.caller_name || callerNumber,
    text: null,
    contentType: 'audio',
    mediaUrl: payload.recordUrl || payload.record_url || null,
    phone: callerNumber,
    externalMessageId: payload.generalCallID || payload.call_id || null,
    rawEvent: payload,
    meta: {
      callId: payload.generalCallID || payload.call_id || null,
      callType,
      agentNumber,
      duration: payload.duration || payload.billsec || null,
      startTime: payload.startTime || payload.start_time || null,
      endTime: payload.endTime || payload.end_time || null,
      isIncoming: callType === 'incoming' || callType === '1',
    },
  });

  log.debug('Normalized Binotel payload', { externalId: result.externalId, callType });
  return result;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const normalizers = {
  telegram: normalizeTelegram,
  viber: normalizeViber,
  sms: normalizeSms,
  facebook: normalizeFacebook,
  instagram: normalizeInstagram,
  whatsapp: normalizeWhatsAppMessage,
  binotel: normalizeBinotel,
};

function normalize(channel, payload) {
  const fn = normalizers[channel];
  if (!fn) {
    log.warn('Unknown channel, returning raw payload', { channel });
    const raw = JSON.stringify(payload);
    return buildResult({
      channel,
      text: raw.length > MAX_TEXT_LEN ? raw.slice(0, MAX_TEXT_LEN) : raw,
      rawEvent: payload,
      meta: { warning: 'unknown_channel' },
    });
  }

  try {
    return fn(payload);
  } catch (err) {
    log.error(`Failed to normalize ${channel} payload`, err);
    return buildResult({
      channel,
      rawEvent: payload,
      meta: { error: err?.message || String(err) },
    });
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  normalizeTelegram,
  normalizeTelegramBotMilestone,
  normalizeViber,
  normalizeSms,
  classifyViberWebhook,
  classifySmsWebhook,
  mapSmsDeliveryStatus,
  mapTurboSmsDeliveryStatus: mapSmsDeliveryStatus,
  normalizeFacebook,
  normalizeInstagram,
  normalizeWhatsAppMessage,
  classifyWhatsAppWebhook,
  normalizeWhatsAppStatus,
  mapWhatsAppDeliveryStatus,
  normalizeBinotel,
  normalize,
};
