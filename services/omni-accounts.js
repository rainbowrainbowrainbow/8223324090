'use strict';

/**
 * Canonical communication-provider connection truth.
 *
 * Browser code consumes only normalized, masked account state from this module.
 * Raw provider secrets are accepted by management endpoints, encrypted before
 * storage, and never returned to the client.
 */

const crypto = require('crypto');
const https = require('https');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const {
  listSmsProviderDefinitions,
  getSmsProviderDefinition,
  normalizeSmsProvider,
  defaultSmsProvider,
  inferSmsProviderFromValues,
  smsEnvConfig,
  validateSmsRuntime,
  verifySmsRuntime,
} = require('./omni-sms-providers');

const log = createLogger('OmniAccounts');

const CONNECTION_TABLE = 'omni_provider_connections';
const SECRET_PREFIX = 'egx:v1:';
const SECRET_KEY_SOURCE = process.env.OMNI_CONNECTION_SECRET_KEY || process.env.JWT_SECRET || 'eventgenix-local-omni-connection-key';
const SECRET_KEY = crypto.createHash('sha256').update(String(SECRET_KEY_SOURCE)).digest();
const SAFE_HTTP_TIMEOUT_MS = 12000;

const STATUS_COPY = {
  connected: 'Підключено',
  disconnected: 'Не підключено',
  limited: 'Працює частково',
  token_expired: 'Токен не приймається',
  misconfigured: 'Потрібне налаштування',
  webhook_missing: 'Webhook не налаштовано',
  history_only: 'Тільки історія',
  provider_unreachable: 'Провайдер не відповів',
  needs_rebind: 'Потрібна перепривʼязка',
};

const CHANNELS = [
  {
    channel: 'telegram',
    label: 'Telegram inbox',
    provider: 'telegram',
    purpose: 'inbox',
    purposeLabel: 'Inbox Telegram',
    providerKind: 'bot',
    envKeys: ['TELEGRAM_BOT_TOKEN'],
    accountEnvKeys: ['TELEGRAM_BOT_USERNAME', 'TELEGRAM_DEFAULT_CHAT_ID'],
    sendSupported: true,
    receiveSupported: true,
    credentialMap: {
      botToken: 'TELEGRAM_BOT_TOKEN',
      botUsername: 'TELEGRAM_BOT_USERNAME',
      defaultChatId: 'TELEGRAM_DEFAULT_CHAT_ID',
    },
    fields: [
      { name: 'botToken', label: 'Inbox bot token', type: 'secret', required: true, placeholder: '123456:ABC-DEF...', hint: 'Токен саме Telegram inbox-бота з BotFather. Не вставляйте сюди report/alerts bot token.' },
      { name: 'botUsername', label: 'Username inbox-бота', type: 'text', required: false, placeholder: '@eventgenix_inbox_bot', hint: 'Не обовʼязково: CRM спробує отримати username через безпечну перевірку getMe.' },
      { name: 'defaultChatId', label: 'Тестовий chat ID', type: 'text', required: false, placeholder: '-1001234567890', hint: 'Опційно для тестової відправки inbox-ботом. Це не report bot і не замінює webhook.' },
    ],
    webhookPath: '/api/omni/webhook/telegram',
    webhookNote: 'Для OmniClaw inbox webhook має вести саме на /api/omni/webhook/telegram. /api/report-bot/webhook — це окремий бот звітів і не робить inbox готовим.',
    businessImpact: 'Telegram inbox приймає і відправляє робочі діалоги OmniClaw. Бот звітів підключається окремо і не замінює цей канал.',
    localValidation: validateTelegram,
    verifier: verifyTelegram,
    envWarning: 'Telegram inbox bot token is not configured',
  },
  {
    channel: 'viber',
    label: 'Viber',
    provider: 'viber',
    purpose: 'inbox',
    purposeLabel: 'Viber inbox',
    providerKind: 'messenger',
    envKeys: ['VIBER_TOKEN'],
    accountEnvKeys: ['VIBER_SENDER_NAME'],
    sendSupported: true,
    receiveSupported: true,
    credentialMap: {
      token: 'VIBER_TOKEN',
      senderName: 'VIBER_SENDER_NAME',
    },
    fields: [
      { name: 'token', label: 'Viber bot token', type: 'secret', required: true, placeholder: 'Viber auth token', hint: 'Токен паблік-акаунта Viber.' },
      { name: 'senderName', label: 'Назва відправника', type: 'text', required: false, placeholder: 'EventGenix', hint: 'Показується як імʼя відправника у Viber.' },
      { name: 'senderAvatar', label: 'Avatar URL', type: 'url', required: false, placeholder: 'https://...', hint: 'Опційно: HTTPS-посилання на аватар відправника.' },
    ],
    webhookPath: '/api/omni/webhook/viber',
    businessImpact: 'Без Viber CRM не зможе надсилати відповіді клієнтам у Viber; вхідні події залежать від webhook.',
    localValidation: validateViber,
    verifier: verifyViber,
    envWarning: 'Viber provider token is not configured',
  },
  {
    channel: 'sms',
    label: 'SMS',
    provider: 'sms',
    purpose: 'inbox',
    purposeLabel: 'SMS inbox',
    providerKind: 'sms',
    envKeys: ['FLYSMS_API_KEY', 'SMS_FLY_API_KEY', 'SMSFLY_API_KEY', 'TURBOSMS_TOKEN'],
    accountEnvKeys: ['FLYSMS_SENDER', 'SMS_FLY_SENDER', 'SMSFLY_SENDER', 'TURBOSMS_SENDER'],
    sendSupported: true,
    receiveSupported: true,
    credentialMap: {},
    fields: [],
    providerOptions: listSmsProviderDefinitions(),
    webhookPath: '/api/omni/webhook/sms',
    businessImpact: 'Без SMS CRM не зможе надсилати SMS-нагадування або відповіді через SMS-шлюз.',
    localValidation: validateSms,
    verifier: verifySms,
    envWarning: 'SMS gateway is not configured',
  },
  {
    channel: 'facebook',
    label: 'Facebook',
    provider: 'facebook',
    purpose: 'inbox',
    purposeLabel: 'Facebook inbox',
    providerKind: 'meta',
    envKeys: ['FB_PAGE_TOKEN'],
    accountEnvKeys: ['FB_PAGE_NAME', 'FB_PAGE_ID'],
    sendSupported: true,
    receiveSupported: true,
    credentialMap: {
      pageToken: 'FB_PAGE_TOKEN',
      pageId: 'FB_PAGE_ID',
      pageName: 'FB_PAGE_NAME',
      appSecret: 'META_APP_SECRET',
      verifyToken: 'META_VERIFY_TOKEN',
    },
    fields: [
      { name: 'pageToken', label: 'Page access token', type: 'secret', required: true, placeholder: 'EAAB...', hint: 'Токен сторінки Facebook з дозволами для Messenger.' },
      { name: 'pageId', label: 'Page ID', type: 'text', required: false, placeholder: '1234567890', hint: 'ID сторінки допомагає швидше діагностувати webhook.' },
      { name: 'pageName', label: 'Назва сторінки', type: 'text', required: false, placeholder: 'Event Genix', hint: 'Людська назва для адмінів.' },
      { name: 'appSecret', label: 'Meta app secret', type: 'secret', required: false, placeholder: 'app secret', hint: 'Потрібно для перевірки підпису Meta webhook.' },
      { name: 'verifyToken', label: 'Webhook verify token', type: 'secret', required: false, placeholder: 'verify token', hint: 'Токен, який Meta перевіряє під час підписки webhook.' },
    ],
    webhookPath: '/api/omni/webhook/meta',
    businessImpact: 'Без Facebook CRM не зможе відповідати у Messenger; без webhook можуть не приходити нові повідомлення.',
    localValidation: validateMeta,
    verifier: verifyMeta('facebook'),
    envWarning: 'Facebook page token is not configured',
  },
  {
    channel: 'instagram',
    label: 'Instagram',
    provider: 'instagram',
    purpose: 'inbox',
    purposeLabel: 'Instagram inbox',
    providerKind: 'meta',
    envKeys: ['IG_PAGE_TOKEN'],
    accountEnvKeys: ['IG_ACCOUNT_NAME', 'IG_PAGE_ID'],
    sendSupported: true,
    receiveSupported: true,
    credentialMap: {
      pageToken: 'IG_PAGE_TOKEN',
      pageId: 'IG_PAGE_ID',
      accountName: 'IG_ACCOUNT_NAME',
      appSecret: 'META_APP_SECRET',
      verifyToken: 'META_VERIFY_TOKEN',
    },
    fields: [
      { name: 'pageToken', label: 'Instagram page token', type: 'secret', required: true, placeholder: 'EAAB...', hint: 'Meta token для Instagram Messaging API.' },
      { name: 'pageId', label: 'Instagram/Page ID', type: 'text', required: false, placeholder: '1784...', hint: 'ID Instagram business account або повʼязаної сторінки.' },
      { name: 'accountName', label: 'Назва акаунта', type: 'text', required: false, placeholder: '@eventgenix', hint: 'Показується у CRM після підключення.' },
      { name: 'appSecret', label: 'Meta app secret', type: 'secret', required: false, placeholder: 'app secret', hint: 'Потрібно для перевірки підпису Meta webhook.' },
      { name: 'verifyToken', label: 'Webhook verify token', type: 'secret', required: false, placeholder: 'verify token', hint: 'Потрібно для прийому нових Instagram подій.' },
    ],
    webhookPath: '/api/omni/webhook/meta',
    businessImpact: 'Без Instagram CRM не зможе відповідати у Direct; без webhook нові діалоги можуть не потрапити в Omni.',
    localValidation: validateMeta,
    verifier: verifyMeta('instagram'),
    envWarning: 'Instagram account token is not configured',
  },
  {
    channel: 'binotel',
    label: 'Binotel',
    provider: 'binotel',
    purpose: 'history',
    purposeLabel: 'Binotel history',
    providerKind: 'telephony',
    envKeys: ['BINOTEL_WEBHOOK_SECRET', 'BINOTEL_API_KEY', 'BINOTEL_KEY'],
    accountEnvKeys: ['BINOTEL_ACCOUNT_NAME'],
    sendSupported: false,
    receiveSupported: true,
    inboundOnly: true,
    credentialMap: {
      webhookSecret: 'BINOTEL_WEBHOOK_SECRET',
      apiKey: 'BINOTEL_API_KEY',
      apiSecret: 'BINOTEL_KEY',
      accountName: 'BINOTEL_ACCOUNT_NAME',
    },
    fields: [
      { name: 'webhookSecret', label: 'Webhook secret', type: 'secret', required: true, placeholder: 'секрет webhook', hint: 'CRM перевіряє цей секрет у вхідних подіях Binotel.' },
      { name: 'apiKey', label: 'API key', type: 'secret', required: false, placeholder: 'api key', hint: 'Опційно для майбутніх перевірок API.' },
      { name: 'apiSecret', label: 'API secret/key', type: 'secret', required: false, placeholder: 'api secret', hint: 'Опційно для API-інтеграції.' },
      { name: 'accountName', label: 'Назва телефонії', type: 'text', required: false, placeholder: 'Binotel EventGenix', hint: 'Людська назва для адмінів.' },
    ],
    webhookPath: '/api/omni/webhook/binotel',
    businessImpact: 'Binotel у CRM є history-only каналом: дзвінки та історія доступні, але відправка повідомлень з CRM не підтримується.',
    localValidation: validateBinotel,
    verifier: verifyBinotel,
    envWarning: 'Binotel is not configured for call history webhooks',
    limitedWarning: 'Binotel працює як history-only канал без відправки з CRM',
  },
  {
    channel: 'report_bot',
    label: 'Бот звітів',
    provider: 'telegram',
    purpose: 'reports',
    purposeLabel: 'Telegram reports',
    providerKind: 'bot',
    envKeys: ['REPORT_BOT_TOKEN'],
    accountEnvKeys: ['REPORT_BOT_USERNAME', 'REPORT_BOT_API_KEY'],
    sendSupported: true,
    receiveSupported: true,
    credentialMap: {
      botToken: 'REPORT_BOT_TOKEN',
      botUsername: 'REPORT_BOT_USERNAME',
      webhookSecret: 'REPORT_WEBHOOK_SECRET',
      apiKey: 'REPORT_BOT_API_KEY',
    },
    fields: [
      { name: 'botToken', label: 'Report bot token', type: 'secret', required: true, placeholder: '123456:ABC-DEF...', hint: 'Окремий Telegram bot token для фінансових звітів.' },
      { name: 'botUsername', label: 'Username бота', type: 'text', required: false, placeholder: '@eventgenix_report_bot', hint: 'Не обовʼязково: CRM спробує отримати username через getMe.' },
      { name: 'webhookSecret', label: 'Webhook secret', type: 'secret', required: true, placeholder: 'секрет Telegram webhook', hint: 'Секретний заголовок для webhook Report Bot.' },
      { name: 'apiKey', label: 'Bot API key', type: 'secret', required: true, placeholder: 'довгий API key', hint: 'Ключ для bot-to-CRM endpoints: submit, summary, accounts.' },
    ],
    webhookPath: '/api/report-bot/webhook',
    webhookNote: 'Це окремий Telegram report/alerts bot. Його webhook не приймає клієнтські inbox-діалоги OmniClaw.',
    businessImpact: 'Бот звітів приймає фінансові й службові звіти. Він не означає, що Telegram inbox підключений.',
    localValidation: validateReportBot,
    verifier: verifyReportBot,
    envWarning: 'Report Bot token is not configured',
  },
];

const CHANNEL_MAP = new Map(CHANNELS.map(def => [def.channel, def]));
const SECRET_FIELD_TYPES = new Set(['secret', 'password', 'token']);

function normalizeChannel(channel) {
  return String(channel || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function providerDefinition(channel) {
  return CHANNEL_MAP.get(normalizeChannel(channel)) || null;
}

function hasEnv(keys = []) {
  return keys.some(key => String(process.env[key] || '').trim());
}

function firstEnv(keys = []) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return null;
}

function envConfig(def) {
  if (isSmsDefinition(def)) return smsEnvConfig(def.provider || defaultSmsProvider());
  const values = {};
  Object.entries(def.credentialMap || {}).forEach(([field, envKey]) => {
    const value = String(process.env[envKey] || '').trim();
    if (value) values[field] = value;
  });
  return values;
}

function fieldByName(def, name) {
  return (def.fields || []).find(field => field.name === name) || null;
}

function isSecretField(def, fieldName) {
  const field = fieldByName(def, fieldName);
  return Boolean(field && SECRET_FIELD_TYPES.has(field.type));
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SECRET_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value || typeof value !== 'string') return '';
  if (!value.startsWith(SECRET_PREFIX)) return value;
  const raw = value.slice(SECRET_PREFIX.length);
  const [ivB64, tagB64, dataB64] = raw.split('.');
  if (!ivB64 || !tagB64 || !dataB64) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', SECRET_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    log.warn('Failed to decrypt Omni provider secret', { reason: err.message });
    return '';
  }
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length <= 8) return `${text.slice(0, 2)}••••${text.slice(-2)}`;
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

function maskIdentifier(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.startsWith('@')) return text;
  if (text.length <= 6) return text;
  return `${text.slice(0, 3)}…${text.slice(-3)}`;
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeCredentialsFromRow(row) {
  const config = safeJson(row?.credentials, {});
  return {
    values: safeJson(config.values, {}),
    secrets: safeJson(config.secrets, {}),
    masks: safeJson(config.masks, {}),
  };
}

function isSmsDefinition(def) {
  return def && def.channel === 'sms';
}

function smsProviderFromRow(row) {
  const config = normalizeCredentialsFromRow(row);
  return inferSmsProviderFromValues(config.values, config.secrets);
}

function smsProviderFromPayload(payload = {}, existingRow = null) {
  const incoming = payload.fields && typeof payload.fields === 'object' ? payload.fields : payload;
  const selected = normalizeSmsProvider(incoming.provider || payload.provider || incoming.smsProvider);
  return selected || smsProviderFromRow(existingRow);
}

function withSmsProviderDefinition(def, provider) {
  if (!isSmsDefinition(def)) return def;
  const providerDef = getSmsProviderDefinition(provider) || getSmsProviderDefinition(defaultSmsProvider());
  return {
    ...def,
    provider: providerDef.provider,
    providerLabel: providerDef.label,
    providerKind: 'sms',
    envKeys: providerDef.envKeys,
    accountEnvKeys: providerDef.accountEnvKeys,
    credentialMap: providerDef.credentialMap,
    fields: providerDef.fields,
    webhookNote: providerDef.webhookNote,
  };
}

function activeDefinitionForRow(def, row) {
  return isSmsDefinition(def) ? withSmsProviderDefinition(def, smsProviderFromRow(row)) : def;
}

function activeDefinitionForPayload(def, payload = {}, existingRow = null) {
  return isSmsDefinition(def) ? withSmsProviderDefinition(def, smsProviderFromPayload(payload, existingRow)) : def;
}

function runtimeValuesFromConnection(def, row) {
  const config = normalizeCredentialsFromRow(row);
  const values = { ...config.values };
  Object.entries(config.secrets).forEach(([field, encrypted]) => {
    const secret = decryptSecret(encrypted);
    if (secret) values[field] = secret;
  });
  return values;
}

function mergeRuntimeConfig(def, row) {
  if (row && (row.status === 'disconnected' || row.status === 'needs_rebind')) return {};
  return {
    ...envConfig(def),
    ...(row ? runtimeValuesFromConnection(def, row) : {}),
  };
}

function setupFieldsForClient(def, row) {
  const config = normalizeCredentialsFromRow(row);
  const envValues = envConfig(def);
  return (def.fields || []).map(field => {
    const hasSavedSecret = isSecretField(def, field.name) && Boolean(config.secrets[field.name]);
    const hasEnvValue = Boolean(envValues[field.name]);
    const savedValue = !isSecretField(def, field.name) ? config.values[field.name] || '' : '';
    return {
      ...field,
      value: savedValue,
      hasSavedValue: hasSavedSecret || hasEnvValue || Boolean(savedValue),
      maskedValue: isSecretField(def, field.name)
        ? (config.masks[field.name] || (hasEnvValue ? maskSecret(envValues[field.name]) : null))
        : (savedValue || (hasEnvValue ? maskIdentifier(envValues[field.name]) : null)),
    };
  });
}

function publicConnectionSummary(def, row, runtime = {}) {
  const connected = hasEnv(def.envKeys) || Boolean(row && row.status !== 'disconnected' && row.status !== 'needs_rebind');
  const accountName =
    row?.account_display_name
    || runtime.botUsername
    || runtime.accountName
    || runtime.pageName
    || runtime.senderName
    || runtime.sender
    || firstEnv(def.accountEnvKeys)
    || (connected ? `${def.label} configured` : null);
  return {
    connected,
    accountName,
    maskedIdentifier: row?.masked_identifier || maskIdentifier(
      runtime.defaultChatId || runtime.pageId || runtime.sender || runtime.apiKey || runtime.botUsername || firstEnv(def.accountEnvKeys)
    ),
  };
}

function providerOptionsForClient(def, row) {
  if (!isSmsDefinition(def)) return [];
  const base = CHANNEL_MAP.get('sms') || def;
  return listSmsProviderDefinitions().map(option => {
    const optionDef = withSmsProviderDefinition(base, option.provider);
    return {
      value: option.provider,
      label: option.label,
      fields: setupFieldsForClient(optionDef, row),
      setupSteps: setupSteps(optionDef),
      webhookUrl: publicWebhookUrl(optionDef),
      webhookNote: option.webhookNote || null,
      businessImpact: optionDef.businessImpact,
    };
  });
}

function statusFromRowOrEnv(def, row, now = new Date()) {
  def = activeDefinitionForRow(def, row);
  const runtime = mergeRuntimeConfig(def, row);
  const summary = publicConnectionSummary(def, row, runtime);
  let status = row?.status || (summary.connected ? (def.inboundOnly ? 'history_only' : 'connected') : 'disconnected');

  if (status === 'connected' && def.inboundOnly) status = 'history_only';
  const connected = status !== 'disconnected'
    && status !== 'token_expired'
    && status !== 'misconfigured'
    && status !== 'needs_rebind'
    && Boolean(summary.connected);
  const sendCapable = Boolean(connected && def.sendSupported && status !== 'history_only' && status !== 'webhook_missing');
  const receiveCapable = Boolean(connected && def.receiveSupported && status !== 'token_expired');
  const limited = status === 'limited' || status === 'webhook_missing' || status === 'history_only' || status === 'provider_unreachable';

  const warning = row?.warning
    || warningForStatus(def, status, connected, sendCapable, receiveCapable);
  const nextActionHint = nextActionForStatus(def, status, connected, sendCapable, receiveCapable);

  return {
    channel: def.channel,
    key: def.channel,
    label: def.label,
    providerKind: def.providerKind,
    provider: row?.provider || def.provider || def.channel,
    providerLabel: def.providerLabel || def.label,
    purpose: row?.purpose || def.purpose || 'primary',
    purposeLabel: def.purposeLabel || row?.purpose || 'Primary',
    status,
    statusLabel: STATUS_COPY[status] || status,
    connected,
    sendCapable,
    receiveCapable,
    limited,
    accountName: summary.accountName,
    maskedIdentifier: summary.maskedIdentifier,
    warning,
    nextActionHint,
    businessImpact: def.businessImpact,
    webhookNote: def.webhookNote || null,
    lastCheckedAt: row?.last_checked_at ? new Date(row.last_checked_at).toISOString() : now.toISOString(),
    lastChangedAt: row?.last_changed_at ? new Date(row.last_changed_at).toISOString() : null,
    changedBy: row?.changed_by || null,
    lastTestAt: row?.last_test_at ? new Date(row.last_test_at).toISOString() : null,
    lastTestStatus: row?.last_test_status || null,
    lastTestMessage: row?.last_test_message || null,
    supportedActions: supportedActionsForStatus(status, def),
    setupFields: setupFieldsForClient(def, row),
    providerOptions: providerOptionsForClient(def, row),
    setupSteps: setupSteps(def),
    webhookUrl: publicWebhookUrl(def),
    connectAvailable: true,
    source: row ? 'database' : (summary.connected ? 'environment' : 'none'),
  };
}

function warningForStatus(def, status, connected, sendCapable, receiveCapable) {
  if (status === 'needs_rebind') return `${def.label}: legacy/помилкова привʼязка не може вважатися робочим inbox. Відвʼяжіть її або підключіть правильний канал заново.`;
  if (!connected) return def.envWarning || `${def.label} не налаштований`;
  if (status === 'token_expired') return `${def.label}: токен не приймається провайдером. Оновіть токен і перевірте знову.`;
  if (status === 'misconfigured') return `${def.label}: бракує обовʼязкових полів або налаштування неповне.`;
  if (status === 'webhook_missing') return `${def.label}: відправка можлива, але webhook/прийом подій потребує налаштування.`;
  if (status === 'provider_unreachable') return `${def.label}: CRM зберегла конфігурацію, але провайдер не відповів під час перевірки.`;
  if (!sendCapable && def.inboundOnly) return def.limitedWarning || `${def.label} працює тільки на прийом/історію.`;
  if (!sendCapable && def.sendSupported) return `${def.label}: відправка з CRM зараз недоступна.`;
  if (!receiveCapable && def.receiveSupported) return `${def.label}: прийом повідомлень потребує перевірки webhook.`;
  return null;
}

function nextActionForStatus(def, status, connected, sendCapable, receiveCapable) {
  if (status === 'needs_rebind') return `Натисніть «Підключити» для чистої перепривʼязки ${def.label}. Якщо це був бот звітів, він показується окремою карткою і не блокує inbox.`;
  if (!connected || status === 'misconfigured') return `Натисніть «Підключити» і заповніть обовʼязкові поля для ${def.label}.`;
  if (status === 'token_expired') return 'Відкрийте налаштування, вставте новий токен і запустіть перевірку.';
  if (status === 'webhook_missing') return 'Скопіюйте webhook URL у кабінет провайдера і натисніть «Перевірити».';
  if (status === 'provider_unreachable') return 'Перевірте інтернет/кабінет провайдера і повторіть «Тест».';
  if (!sendCapable && def.inboundOnly) return 'Цей канал не відправляє з CRM. Використовуйте його для історії та вхідних подій.';
  if (!receiveCapable && def.receiveSupported) return 'Перевірте webhook, щоб нові події автоматично приходили в CRM.';
  return 'Можна працювати. Для контролю натисніть «Тест» або «Перевірити».';
}

function supportedActionsForStatus(status, def) {
  const actions = ['connect', 'recheck', 'test'];
  if (status !== 'disconnected' || hasEnv(def.envKeys)) actions.push('disconnect');
  return actions;
}

function publicWebhookUrl(def) {
  if (!def.webhookPath) return null;
  const explicit = process.env.PUBLIC_APP_URL || process.env.APP_URL || null;
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null;
  const base = explicit || railway || '';
  return base ? `${base.replace(/\/$/, '')}${def.webhookPath}` : def.webhookPath;
}

function setupSteps(def) {
  const steps = [
    `Вставте обовʼязкові дані для ${def.label}.`,
    'Збережіть підключення. CRM не покаже секрети назад у браузері.',
    'Після збереження натисніть «Тест» або «Перевірити», щоб побачити реальний стан.',
  ];
  if (def.webhookPath) {
    steps.push(`Якщо провайдер приймає webhook, вкажіть URL: ${publicWebhookUrl(def)}.`);
  }
  if (def.webhookNote) {
    steps.push(def.webhookNote);
  }
  if (def.inboundOnly) {
    steps.push('Цей канал не підтримує відправку з CRM, тому статус відправки буде history-only.');
  }
  return steps;
}

function buildAccountStatus(def, now = new Date()) {
  return statusFromRowOrEnv(def, null, now);
}

function getOmniAccountStatuses(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  return CHANNELS.map(def => buildAccountStatus(def, now));
}

function getOmniAccountStatus(channel, options = {}) {
  const normalized = normalizeChannel(channel);
  return getOmniAccountStatuses(options).find(acc => acc.channel === normalized) || null;
}

function isOmniChannelSendCapable(channel, options = {}) {
  const account = getOmniAccountStatus(channel, options);
  return Boolean(account && account.connected && account.sendCapable);
}

function getOmniUnavailableMessage(channel, options = {}) {
  const account = getOmniAccountStatus(channel, options);
  return unavailableMessageFromAccount(account, channel);
}

function unavailableMessageFromAccount(account, channel) {
  const label = account?.label || channel || 'Канал';
  if (!account) return `${label} не підтримується Omni.`;
  if (!account.connected) {
    return `${label} не підключений. Відкрийте Omni → Підключення каналів і підключіть акаунт, щоб увімкнути відправку.`;
  }
  if (account.sendCapable === false) {
    return `${label} зараз не може відправляти з CRM. Перевірте стан у Omni → Підключення каналів.`;
  }
  return `${label} тимчасово недоступний для відправки з CRM.`;
}

function getOmniAccountAlerts(options = {}) {
  return getOmniAccountStatuses(options)
    .filter(acc => !acc.connected || acc.sendCapable === false || acc.status === 'webhook_missing' || acc.status === 'provider_unreachable')
    .map(accountToAlert);
}

function accountToAlert(acc) {
  const critical = !acc.connected || acc.status === 'token_expired' || acc.status === 'misconfigured';
  return {
    id: `omni_${acc.channel}_${acc.status}`,
    level: critical ? 'critical' : 'warning',
    icon: critical ? '🔌' : '⚠️',
    title: critical
      ? `Omni: ${acc.label} потребує підключення`
      : `Omni: ${acc.label} працює частково`,
    link: `/omni?panel=accounts&channel=${encodeURIComponent(acc.channel)}`,
    source: 'omni_accounts',
    action: {
      label: critical ? 'Підключити канал' : 'Перевірити канал',
      prompt: acc.warning || unavailableMessageFromAccount(acc, acc.channel),
    },
  };
}

function isReportBotShapedConnection(row) {
  if (!row || normalizeChannel(row.channel) !== 'telegram') return false;
  const config = normalizeCredentialsFromRow(row);
  const values = config.values || {};
  const secrets = config.secrets || {};
  const text = [
    row.account_display_name,
    row.masked_identifier,
    row.warning,
    values.botUsername,
  ].filter(Boolean).join(' ').toLowerCase();
  return Boolean(
    values.apiKey
    || secrets.apiKey
    || values.webhookSecret
    || secrets.webhookSecret
    || /report|звіт|zvit|alerts?/.test(text)
  );
}

async function repairTelegramLegacyBindings(rows) {
  const telegramRow = rows.get('telegram');
  if (!isReportBotShapedConnection(telegramRow)) return false;
  try {
    await pool.query(
      `INSERT INTO ${CONNECTION_TABLE}
         (channel, provider, purpose, provider_kind, status, credentials, account_display_name, masked_identifier,
          send_enabled, receive_enabled, warning, last_checked_at, last_changed_at, changed_by_user_id,
          changed_by, last_test_at, last_test_status, last_test_message, disconnected_at, created_at, updated_at)
       SELECT
          'report_bot',
          'telegram',
          'reports',
          provider_kind,
          status,
          credentials,
          COALESCE(account_display_name, 'Бот звітів'),
          masked_identifier,
          send_enabled,
          receive_enabled,
          COALESCE(warning, 'Legacy Telegram binding reclassified as report bot.'),
          last_checked_at,
          NOW(),
          changed_by_user_id,
          COALESCE(changed_by, 'legacy repair'),
          last_test_at,
          last_test_status,
          last_test_message,
          disconnected_at,
          NOW(),
          NOW()
         FROM ${CONNECTION_TABLE}
        WHERE channel = 'telegram'
          AND NOT EXISTS (SELECT 1 FROM ${CONNECTION_TABLE} WHERE channel = 'report_bot')
       ON CONFLICT (channel) DO NOTHING`
    );
    await pool.query(
      `UPDATE ${CONNECTION_TABLE}
          SET provider = 'telegram',
              purpose = 'inbox',
              status = 'needs_rebind',
              credentials = '{}'::jsonb,
              account_display_name = NULL,
              masked_identifier = NULL,
              send_enabled = false,
              receive_enabled = false,
              warning = 'Legacy Telegram row looked like a report/alerts bot. It was separated from Telegram inbox; reconnect the real inbox bot.',
              last_changed_at = NOW(),
              disconnected_at = NOW(),
              updated_at = NOW()
        WHERE channel = 'telegram'`
    );
    log.warn('Reclassified legacy Telegram report-bot binding away from inbox');
    return true;
  } catch (err) {
    log.warn('Unable to repair legacy Telegram binding', { error: err.message });
    return false;
  }
}

async function loadConnectionRows() {
  try {
    const result = await pool.query(`SELECT * FROM ${CONNECTION_TABLE}`);
    const rows = new Map();
    result.rows.forEach(row => rows.set(normalizeChannel(row.channel), row));
    if (await repairTelegramLegacyBindings(rows)) {
      const refreshed = await pool.query(`SELECT * FROM ${CONNECTION_TABLE}`);
      const refreshedRows = new Map();
      refreshed.rows.forEach(row => refreshedRows.set(normalizeChannel(row.channel), row));
      return refreshedRows;
    }
    return rows;
  } catch (err) {
    if (!/omni_provider_connections|does not exist|relation/i.test(err.message || '')) {
      log.warn('Unable to load Omni provider connections', { error: err.message });
    }
    return new Map();
  }
}

async function loadConnectionRow(channel) {
  try {
    const result = await pool.query(`SELECT * FROM ${CONNECTION_TABLE} WHERE channel = $1 LIMIT 1`, [normalizeChannel(channel)]);
    return result.rows[0] || null;
  } catch (err) {
    if (!/omni_provider_connections|does not exist|relation/i.test(err.message || '')) {
      log.warn('Unable to load Omni provider connection', { channel, error: err.message });
    }
    return null;
  }
}

async function getOmniAccountStatusesAsync(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const rows = await loadConnectionRows();
  return CHANNELS.map(def => statusFromRowOrEnv(def, rows.get(def.channel), now));
}

async function getOmniAccountStatusAsync(channel, options = {}) {
  const def = providerDefinition(channel);
  if (!def) return null;
  const row = await loadConnectionRow(def.channel);
  const now = options.now instanceof Date ? options.now : new Date();
  return statusFromRowOrEnv(def, row, now);
}

async function getOmniAccountAlertsAsync(options = {}) {
  const accounts = await getOmniAccountStatusesAsync(options);
  return accounts
    .filter(acc => !acc.connected || acc.sendCapable === false || acc.status === 'webhook_missing' || acc.status === 'provider_unreachable')
    .map(accountToAlert);
}

async function isOmniChannelSendCapableAsync(channel) {
  const account = await getOmniAccountStatusAsync(channel);
  return Boolean(account && account.connected && account.sendCapable);
}

async function getOmniUnavailableMessageAsync(channel) {
  const account = await getOmniAccountStatusAsync(channel);
  return unavailableMessageFromAccount(account, channel);
}

async function resolveOmniRuntimeConfig(channel) {
  const def = providerDefinition(channel);
  if (!def) return {};
  const row = await loadConnectionRow(def.channel);
  return mergeRuntimeConfig(activeDefinitionForRow(def, row), row);
}

async function isTelegramInboxConnectionUsingToken(botToken) {
  const token = String(botToken || '').trim();
  if (!token) return false;
  const def = providerDefinition('telegram');
  const row = await loadConnectionRow('telegram');
  if (!def || !row || row.status === 'disconnected' || row.status === 'needs_rebind') return false;
  const rowRuntime = runtimeValuesFromConnection(activeDefinitionForRow(def, row), row);
  return Boolean(rowRuntime.botToken && rowRuntime.botToken === token);
}

function userLabel(user = {}) {
  return user.name || user.username || user.role || 'system';
}

function normalizePayloadFields(def, payload = {}, existingRow = null) {
  const incoming = payload.fields && typeof payload.fields === 'object' ? payload.fields : payload;
  const current = normalizeCredentialsFromRow(existingRow);
  const previousProvider = isSmsDefinition(def) ? smsProviderFromRow(existingRow) : null;
  const providerChanged = isSmsDefinition(def) && previousProvider !== def.provider;
  const values = providerChanged ? {} : { ...current.values };
  const secrets = providerChanged ? {} : { ...current.secrets };
  const masks = providerChanged ? {} : { ...current.masks };
  const runtime = mergeRuntimeConfig(def, existingRow);
  const errors = [];
  if (isSmsDefinition(def)) values.provider = def.provider;

  for (const field of def.fields || []) {
    const raw = incoming[field.name];
    const provided = raw !== undefined && raw !== null && String(raw).trim() !== '';
    const hasExisting = Boolean(runtime[field.name] || current.secrets[field.name] || current.values[field.name]);

    if (field.required && !provided && !hasExisting) {
      errors.push(`${field.label}: обовʼязкове поле`);
      continue;
    }

    if (!provided) continue;
    const value = normalizeFieldValue(field, raw);
    const validationError = validateField(field, value);
    if (validationError) {
      errors.push(`${field.label}: ${validationError}`);
      continue;
    }

    if (isSecretField(def, field.name)) {
      secrets[field.name] = encryptSecret(value);
      masks[field.name] = maskSecret(value);
      delete values[field.name];
    } else {
      values[field.name] = value;
    }
  }

  return {
    credentials: { values, secrets, masks },
    runtime: mergePlainRuntime(def, values, secrets),
    errors,
  };
}

function mergePlainRuntime(def, values, secrets) {
  const runtime = { ...envConfig(def), ...values };
  Object.entries(secrets || {}).forEach(([field, encrypted]) => {
    const value = decryptSecret(encrypted);
    if (value) runtime[field] = value;
  });
  return runtime;
}

function normalizeFieldValue(field, raw) {
  let value = String(raw || '').trim();
  if (field.name.toLowerCase().includes('username') && value && !value.startsWith('@')) value = `@${value}`;
  return value;
}

function validateField(field, value) {
  if (!value && field.required) return 'заповніть значення';
  if (!value) return null;
  if (field.type === 'url' && !/^https:\/\//i.test(value)) return 'має бути HTTPS URL';
  if (field.name.toLowerCase().includes('token') && value.length < 12) return 'схоже на занадто короткий токен';
  if (field.name.toLowerCase().includes('secret') && value.length < 8) return 'секрет має бути довшим';
  return null;
}

async function upsertOmniConnection(channel, payload = {}, user = {}) {
  const baseDef = providerDefinition(channel);
  if (!baseDef) {
    const err = new Error('Канал Omni не знайдено');
    err.statusCode = 404;
    throw err;
  }

  const existingRow = await loadConnectionRow(baseDef.channel);
  const def = activeDefinitionForPayload(baseDef, payload, existingRow);
  const normalized = normalizePayloadFields(def, payload, existingRow);
  const providerErrors = [
    ...normalized.errors,
    ...(def.localValidation ? def.localValidation(normalized.runtime) : []),
  ];
  if (providerErrors.length) {
    const err = new Error(providerErrors.join('; '));
    err.statusCode = 400;
    err.details = providerErrors;
    throw err;
  }

  const check = await verifyProvider(def, normalized.runtime, { mode: 'connect' });
  const status = statusFromVerification(def, check);
  const display = displayNameFromRuntime(def, normalized.runtime, check);
  const masked = maskedIdentifierFromRuntime(def, normalized.runtime);
  const changedBy = userLabel(user);

  const result = await pool.query(
    `INSERT INTO ${CONNECTION_TABLE}
       (channel, provider, purpose, provider_kind, status, credentials, account_display_name, masked_identifier,
        send_enabled, receive_enabled, warning, last_checked_at, last_changed_at, changed_by_user_id,
        changed_by, last_test_at, last_test_status, last_test_message, disconnected_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,NOW(),NOW(),$12,$13,NOW(),$14,$15,NULL,NOW())
     ON CONFLICT (channel) DO UPDATE SET
        provider = EXCLUDED.provider,
        purpose = EXCLUDED.purpose,
        provider_kind = EXCLUDED.provider_kind,
        status = EXCLUDED.status,
        credentials = EXCLUDED.credentials,
        account_display_name = EXCLUDED.account_display_name,
        masked_identifier = EXCLUDED.masked_identifier,
        send_enabled = EXCLUDED.send_enabled,
        receive_enabled = EXCLUDED.receive_enabled,
        warning = EXCLUDED.warning,
        last_checked_at = NOW(),
        last_changed_at = NOW(),
        changed_by_user_id = EXCLUDED.changed_by_user_id,
        changed_by = EXCLUDED.changed_by,
        last_test_at = NOW(),
        last_test_status = EXCLUDED.last_test_status,
        last_test_message = EXCLUDED.last_test_message,
        disconnected_at = NULL,
        updated_at = NOW()
     RETURNING *`,
    [
      def.channel,
      def.provider || def.channel,
      def.purpose || 'primary',
      def.providerKind,
      status,
      JSON.stringify(normalized.credentials),
      display,
      masked,
      sendEnabledForStatus(def, status),
      receiveEnabledForStatus(def, status),
      check.warning || null,
      user.id || null,
      changedBy,
      check.status,
      check.message,
    ]
  );

  const account = statusFromRowOrEnv(def, result.rows[0], new Date());
  return {
    account,
    result: safeVerificationResult(check),
    message: messageForVerification(def, check, 'Підключення збережено.'),
  };
}

async function recheckOmniConnection(channel, user = {}, options = {}) {
  const baseDef = providerDefinition(channel);
  if (!baseDef) {
    const err = new Error('Канал Omni не знайдено');
    err.statusCode = 404;
    throw err;
  }
  const row = await loadConnectionRow(baseDef.channel);
  const def = activeDefinitionForRow(baseDef, row);
  const runtime = mergeRuntimeConfig(def, row);
  const check = await verifyProvider(def, runtime, { mode: options.mode || 'recheck' });
  const status = statusFromVerification(def, check);
  const display = displayNameFromRuntime(def, runtime, check);
  const masked = maskedIdentifierFromRuntime(def, runtime);

  let updatedRow = row;
  if (row) {
    const result = await pool.query(
      `UPDATE ${CONNECTION_TABLE}
          SET status = $2,
              account_display_name = COALESCE($3, account_display_name),
              masked_identifier = COALESCE($4, masked_identifier),
              send_enabled = $5,
              receive_enabled = $6,
              warning = $7,
              last_checked_at = NOW(),
              last_test_at = CASE WHEN $8 = 'test' THEN NOW() ELSE last_test_at END,
              last_test_status = CASE WHEN $8 = 'test' THEN $9 ELSE last_test_status END,
              last_test_message = CASE WHEN $8 = 'test' THEN $10 ELSE last_test_message END,
              updated_at = NOW()
        WHERE channel = $1
        RETURNING *`,
      [
        def.channel,
        status,
        display,
        masked,
        sendEnabledForStatus(def, status),
        receiveEnabledForStatus(def, status),
        check.warning || null,
        options.mode || 'recheck',
        check.status,
        check.message,
      ]
    );
    updatedRow = result.rows[0] || row;
  }

  const account = statusFromRowOrEnv(def, updatedRow, new Date());
  return {
    account,
    result: safeVerificationResult(check),
    message: messageForVerification(def, check, options.mode === 'test' ? 'Тест виконано.' : 'Статус перевірено.'),
  };
}

async function testOmniConnection(channel, user = {}) {
  return recheckOmniConnection(channel, user, { mode: 'test' });
}

async function disconnectOmniConnection(channel, user = {}) {
  const def = providerDefinition(channel);
  if (!def) {
    const err = new Error('Канал Omni не знайдено');
    err.statusCode = 404;
    throw err;
  }
  const changedBy = userLabel(user);
  const result = await pool.query(
    `INSERT INTO ${CONNECTION_TABLE}
       (channel, provider, purpose, provider_kind, status, credentials, account_display_name, masked_identifier,
        send_enabled, receive_enabled, warning, last_checked_at, last_changed_at, changed_by_user_id,
        changed_by, disconnected_at, updated_at)
     VALUES ($1,$2,$3,$4,'disconnected','{}'::jsonb,NULL,NULL,false,false,$5,NOW(),NOW(),$6,$7,NOW(),NOW())
     ON CONFLICT (channel) DO UPDATE SET
        provider = EXCLUDED.provider,
        purpose = EXCLUDED.purpose,
        provider_kind = EXCLUDED.provider_kind,
        status = 'disconnected',
        credentials = '{}'::jsonb,
        account_display_name = NULL,
        masked_identifier = NULL,
        send_enabled = false,
        receive_enabled = false,
        warning = $5,
        last_checked_at = NOW(),
        last_changed_at = NOW(),
        changed_by_user_id = $6,
        changed_by = $7,
        disconnected_at = NOW(),
        updated_at = NOW()
     RETURNING *`,
    [
      def.channel,
      def.provider || def.channel,
      def.purpose || 'primary',
      def.providerKind,
      def.envWarning || `${def.label} відключено`,
      user.id || null,
      changedBy,
    ]
  );
  return {
    account: statusFromRowOrEnv(def, result.rows[0], new Date()),
    message: `${def.label} відключено. Відправка з цього каналу зупинена, доки його не підключать знову.`,
  };
}

function sendEnabledForStatus(def, status) {
  return Boolean(def.sendSupported && status === 'connected');
}

function receiveEnabledForStatus(def, status) {
  if (!def.receiveSupported) return false;
  return ['connected', 'limited', 'history_only', 'webhook_missing', 'provider_unreachable'].includes(status);
}

function statusFromVerification(def, check) {
  if (!check || check.status === 'failed_auth') return 'token_expired';
  if (check.status === 'missing_config') return 'misconfigured';
  if (def.inboundOnly && (check.status === 'success' || check.status === 'partial')) return 'history_only';
  if (check.status === 'webhook_missing') return 'webhook_missing';
  if (check.status === 'provider_unreachable') return 'provider_unreachable';
  if (check.status === 'partial') return 'limited';
  if (check.status === 'success') return 'connected';
  return 'misconfigured';
}

function safeVerificationResult(check) {
  return {
    status: check.status,
    message: check.message,
    checkedAt: new Date().toISOString(),
    details: check.details || null,
  };
}

function messageForVerification(def, check, prefix) {
  const label = def.providerLabel ? `${def.label} / ${def.providerLabel}` : def.label;
  return `${prefix} ${label}: ${check.message}`;
}

async function verifyProvider(def, runtime, context = {}) {
  const missing = [];
  for (const field of def.fields || []) {
    if (field.required && !runtime[field.name]) missing.push(field.label);
  }
  if (missing.length) {
    return {
      status: 'missing_config',
      message: `Бракує обовʼязкових полів: ${missing.join(', ')}.`,
      warning: `Бракує обовʼязкових полів: ${missing.join(', ')}.`,
    };
  }
  if (def.verifier) return def.verifier(runtime, context);
  return { status: 'partial', message: 'CRM перевірила локальну конфігурацію. Автоматична зовнішня перевірка для цього провайдера не підтримується.' };
}

function displayNameFromRuntime(def, runtime, check) {
  return check?.displayName
    || runtime.botUsername
    || runtime.accountName
    || runtime.pageName
    || runtime.senderName
    || runtime.sender
    || runtime.accountLabel
    || def.label;
}

function maskedIdentifierFromRuntime(def, runtime) {
  return maskIdentifier(
    runtime.defaultChatId
    || runtime.pageId
    || runtime.sender
    || runtime.apiKey
    || runtime.botUsername
    || runtime.accountName
    || runtime.pageName
    || def.channel
  );
}

function validateTelegram(runtime) {
  const errors = [];
  if (runtime.botToken && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(runtime.botToken)) {
    errors.push('Telegram token має формат bot token з BotFather.');
  }
  return errors;
}

function validateReportBot(runtime) {
  const errors = validateTelegram(runtime);
  if (!runtime.webhookSecret || String(runtime.webhookSecret).length < 8) errors.push('Webhook secret обовʼязковий для Report Bot.');
  if (!runtime.apiKey || String(runtime.apiKey).length < 12) errors.push('Bot API key обовʼязковий і має бути довгим.');
  return errors;
}

function validateViber(runtime) {
  return runtime.token && String(runtime.token).length >= 20 ? [] : ['Viber token має бути довшим і схожим на auth token.'];
}

function validateSms(runtime) {
  return validateSmsRuntime(runtime);
}

function validateMeta(runtime) {
  const token = runtime.pageToken || runtime.token;
  return token && String(token).length >= 20 ? [] : ['Meta page token має бути довшим і схожим на access token.'];
}

function validateBinotel(runtime) {
  return runtime.webhookSecret && String(runtime.webhookSecret).length >= 8 ? [] : ['Webhook secret Binotel обовʼязковий.'];
}

async function httpsJson(options, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      ...options,
      timeout: SAFE_HTTP_TIMEOUT_MS,
      headers: {
        ...(options.headers || {}),
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
        if (res.statusCode >= 400) {
          const err = new Error(parsed.description || parsed.error?.message || parsed.response_status || `HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.payload = parsed;
          reject(err);
          return;
        }
        resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('provider verification timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function verifyTelegram(runtime, context = {}) {
  try {
    const result = await httpsJson({
      hostname: 'api.telegram.org',
      path: `/bot${runtime.botToken}/getMe`,
      method: 'GET',
    });
    if (result.ok && result.result) {
      const username = result.result.username ? `@${result.result.username}` : runtime.botUsername || 'Telegram bot';
      const needsReadinessCheck = context.mode === 'test' || context.mode === 'recheck';
      if (!needsReadinessCheck) {
        return { status: 'success', message: `Токен дійсний. Бот: ${username}.`, displayName: username };
      }

      const webhook = await httpsJson({
        hostname: 'api.telegram.org',
        path: `/bot${runtime.botToken}/getWebhookInfo`,
        method: 'GET',
      });
      const webhookUrl = String(webhook?.result?.url || '').trim();
      const expectedPath = '/api/omni/webhook/telegram';
      if (!webhookUrl) {
        return {
          status: 'webhook_missing',
          message: `Токен дійсний. Бот: ${username}. Але Telegram webhook для inbox ще не встановлений.`,
          warning: 'Telegram inbox webhook missing',
          displayName: username,
          details: { webhookUrl: null, expectedPath },
        };
      }
      if (!webhookUrl.includes(expectedPath)) {
        return {
          status: 'webhook_missing',
          message: `Токен дійсний. Бот: ${username}. Але webhook веде не в Omni inbox (${webhookUrl}). Report Bot webhook не замінює /api/omni/webhook/telegram.`,
          warning: 'Telegram webhook points outside Omni inbox',
          displayName: username,
          details: { webhookUrl, expectedPath },
        };
      }

      let outboundNote = 'Тестову відправку пропущено: тестовий chat ID не вказаний.';
      let outboundOk = null;
      if (context.mode === 'test' && runtime.defaultChatId) {
        try {
          const sendResult = await httpsJson({
            hostname: 'api.telegram.org',
            path: `/bot${runtime.botToken}/sendMessage`,
            method: 'POST',
          }, {
            chat_id: runtime.defaultChatId,
            text: 'OmniClaw inbox test: Telegram binding готовий.',
            disable_notification: true,
          });
          outboundOk = sendResult?.ok === true;
          outboundNote = outboundOk
            ? `Тестове повідомлення надіслано в ${maskIdentifier(runtime.defaultChatId)}.`
            : `Telegram не підтвердив тестову відправку: ${sendResult?.description || 'unknown error'}.`;
        } catch (sendErr) {
          outboundOk = false;
          outboundNote = `Тестова відправка не пройшла: ${sendErr.message}.`;
        }
      }

      if (outboundOk === false) {
        return {
          status: 'partial',
          message: `Webhook inbox готовий. ${outboundNote}`,
          warning: 'Telegram inbox outbound test failed',
          displayName: username,
          details: { webhookUrl, expectedPath, outboundOk },
        };
      }
      return {
        status: 'success',
        message: `Токен дійсний. Бот: ${username}. Webhook inbox готовий. ${outboundNote}`,
        displayName: username,
        details: { webhookUrl, expectedPath, outboundOk },
      };
    }
    return { status: 'failed_auth', message: result.description || 'Telegram не підтвердив токен.', warning: result.description || 'Telegram token invalid' };
  } catch (err) {
    return verificationErrorToStatus('Telegram', err);
  }
}

async function verifyReportBot(runtime) {
  const base = await verifyTelegram({ botToken: runtime.botToken, botUsername: runtime.botUsername }, { mode: 'connect' });
  if (base.status !== 'success') return base;
  return {
    ...base,
    message: `${base.message} Webhook secret і API key збережені для Report Bot.`,
  };
}

async function verifyViber(runtime) {
  try {
    const result = await httpsJson({
      hostname: 'chatapi.viber.com',
      path: '/pa/get_account_info',
      method: 'POST',
      headers: { 'X-Viber-Auth-Token': runtime.token },
    }, {});
    if (result.status === 0) {
      return { status: 'success', message: `Viber токен дійсний. Акаунт: ${result.name || runtime.senderName || 'Viber bot'}.`, displayName: result.name || runtime.senderName || 'Viber bot' };
    }
    return { status: 'failed_auth', message: result.status_message || `Viber status ${result.status}`, warning: result.status_message || 'Viber token invalid' };
  } catch (err) {
    return verificationErrorToStatus('Viber', err);
  }
}

async function verifySms(runtime) {
  return verifySmsRuntime(runtime);
}

function verifyMeta(kind) {
  return async runtime => {
    const token = runtime.pageToken || runtime.token;
    try {
      const result = await httpsJson({
        hostname: 'graph.facebook.com',
        path: `/v21.0/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
        method: 'GET',
      });
      const hasWebhookSetup = Boolean(runtime.verifyToken || process.env.META_VERIFY_TOKEN);
      const status = hasWebhookSetup ? 'success' : 'webhook_missing';
      const message = hasWebhookSetup
        ? `Meta token дійсний. Акаунт: ${result.name || runtime.pageName || runtime.accountName || kind}.`
        : `Meta token дійсний, але webhook verify token не вказаний. Відправка можлива, прийом подій потребує webhook.`;
      return {
        status,
        message,
        warning: status === 'webhook_missing' ? 'Webhook verify token не вказаний.' : null,
        displayName: result.name || runtime.pageName || runtime.accountName || kind,
        details: { id: result.id || runtime.pageId || null },
      };
    } catch (err) {
      return verificationErrorToStatus('Meta', err);
    }
  };
}

async function verifyBinotel(runtime) {
  return {
    status: 'success',
    message: 'Webhook secret збережено. Binotel у CRM працює як history-only канал без відправки.',
    warning: 'Binotel не підтримує відправку з CRM.',
    displayName: runtime.accountName || 'Binotel',
  };
}

function verificationErrorToStatus(label, err) {
  const message = err.message || `${label} verification failed`;
  if (err.statusCode === 401 || err.statusCode === 403 || /unauthorized|invalid|forbidden|token/i.test(message)) {
    return { status: 'failed_auth', message: `${label} не прийняв токен: ${message}`, warning: `${label}: token invalid` };
  }
  return {
    status: 'provider_unreachable',
    message: `${label} не відповів на безпечну перевірку: ${message}. CRM не робила тестову відправку.`,
    warning: `${label}: provider unreachable during verification`,
  };
}

module.exports = {
  CHANNELS,
  STATUS_COPY,
  getOmniAccountStatuses,
  getOmniAccountStatus,
  isOmniChannelSendCapable,
  getOmniUnavailableMessage,
  getOmniAccountAlerts,
  getOmniAccountStatusesAsync,
  getOmniAccountStatusAsync,
  getOmniAccountAlertsAsync,
  isOmniChannelSendCapableAsync,
  getOmniUnavailableMessageAsync,
  resolveOmniRuntimeConfig,
  isTelegramInboxConnectionUsingToken,
  upsertOmniConnection,
  recheckOmniConnection,
  testOmniConnection,
  disconnectOmniConnection,
  providerDefinition,
  maskSecret,
};
