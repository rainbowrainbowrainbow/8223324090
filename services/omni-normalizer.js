/**
 * services/omni-normalizer.js — Omni-channel webhook payload normalizer
 *
 * Converts incoming payloads from different messaging channels
 * into a unified internal format for Event Genix CRM processing.
 *
 * Supported channels: telegram, viber, sms, facebook, instagram, binotel
 */
const { createLogger } = require('../utils/logger');

const log = createLogger('OmniNormalizer');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResult(fields) {
  return {
    channel: fields.channel || 'unknown',
    externalId: fields.externalId || null,
    senderName: fields.senderName || null,
    text: fields.text || null,
    contentType: fields.contentType || 'text',
    mediaUrl: fields.mediaUrl || null,
    rawEvent: fields.rawEvent || null,
    meta: fields.meta || {},
  };
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
  const message = payload.message || payload.edited_message || payload.channel_post || {};
  const from = message.from || {};

  const contentType = detectTelegramContentType(message);
  const mediaUrl = pickTelegramMediaUrl(message);

  let text = message.text || message.caption || null;
  if (contentType === 'location' && message.location) {
    text = `${message.location.latitude},${message.location.longitude}`;
  }
  if (contentType === 'contact' && message.contact) {
    text = message.contact.phone_number || null;
  }

  const result = buildResult({
    channel: 'telegram',
    externalId: String(from.id || message.chat?.id || ''),
    senderName: [from.first_name, from.last_name].filter(Boolean).join(' ') || null,
    text,
    contentType,
    mediaUrl,
    rawEvent: payload,
    meta: {
      chatId: message.chat?.id || null,
      messageId: message.message_id || null,
      isBot: from.is_bot || false,
      language: from.language_code || null,
    },
  });

  log.debug('Normalized Telegram payload', { externalId: result.externalId, contentType });
  return result;
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
    text = `${message.location.lat},${message.location.lon}`;
    mediaUrl = null;
  }
  if (contentType === 'contact' && message.contact) {
    text = message.contact.phone_number || null;
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
    rawEvent: payload,
    meta: {
      event,
      messageToken: payload.message_token || null,
      timestamp: payload.timestamp || null,
      avatar: sender.avatar || null,
    },
  });

  log.debug('Normalized Viber payload', { externalId: result.externalId, contentType, event });
  return result;
}

// ---------------------------------------------------------------------------
// SMS (generic provider format — TurboSMS / eSputnik / similar)
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
    rawEvent: payload,
    meta: {
      messageId: payload.message_id || payload.id || null,
      timestamp: payload.timestamp || payload.date || null,
      operator: payload.operator || null,
    },
  });

  log.debug('Normalized SMS payload', { externalId: result.externalId });
  return result;
}

// ---------------------------------------------------------------------------
// Facebook Messenger
// ---------------------------------------------------------------------------

function normalizeFacebook(payload) {
  // Facebook sends batches in entry[].messaging[]
  const entry = (payload.entry && payload.entry[0]) || {};
  const messaging = (entry.messaging && entry.messaging[0]) || {};
  const sender = messaging.sender || {};
  const message = messaging.message || {};

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
      text = `${coords.lat},${coords.long}`;
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
    rawEvent: payload,
    meta: {
      messageId: message.mid || null,
      timestamp: messaging.timestamp || null,
      pageId: entry.id || null,
      isEcho: message.is_echo || false,
    },
  });

  log.debug('Normalized Facebook payload', { externalId: result.externalId, contentType });
  return result;
}

// ---------------------------------------------------------------------------
// Instagram (Messenger API — same structure as FB with slight differences)
// ---------------------------------------------------------------------------

function normalizeInstagram(payload) {
  const entry = (payload.entry && payload.entry[0]) || {};
  const messaging = (entry.messaging && entry.messaging[0]) || {};
  const sender = messaging.sender || {};
  const message = messaging.message || {};

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
    rawEvent: payload,
    meta: {
      messageId: message.mid || null,
      timestamp: messaging.timestamp || null,
      igAccountId: entry.id || null,
      isStoryReply: !!(message.reply_to && message.reply_to.story),
    },
  });

  log.debug('Normalized Instagram payload', { externalId: result.externalId, contentType });
  return result;
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
  binotel: normalizeBinotel,
};

function normalize(channel, payload) {
  const fn = normalizers[channel];
  if (!fn) {
    log.warn('Unknown channel, returning raw payload', { channel });
    return buildResult({
      channel,
      text: JSON.stringify(payload),
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
      meta: { error: err.message },
    });
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  normalizeTelegram,
  normalizeViber,
  normalizeSms,
  normalizeFacebook,
  normalizeInstagram,
  normalizeBinotel,
  normalize,
};
