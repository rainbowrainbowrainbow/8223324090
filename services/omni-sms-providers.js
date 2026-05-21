'use strict';

const https = require('https');
const { URL } = require('url');
const { createLogger } = require('../utils/logger');

const log = createLogger('OmniSMSProviders');

const SOCKET_TIMEOUT = 15000;
const RESPONSE_TIMEOUT = 15000;
const FLYSMS_DEFAULT_API_URL = 'https://sms-fly.ua/api/v2/api.php';

const SMS_PROVIDER_DEFINITIONS = Object.freeze({
  turbosms: {
    provider: 'turbosms',
    label: 'TurboSMS',
    envKeys: ['TURBOSMS_TOKEN'],
    accountEnvKeys: ['TURBOSMS_SENDER'],
    credentialMap: {
      token: 'TURBOSMS_TOKEN',
      sender: 'TURBOSMS_SENDER',
      webhookSecret: 'SMS_WEBHOOK_SECRET',
    },
    fields: [
      { name: 'token', label: 'TurboSMS token', type: 'secret', required: true, placeholder: 'API token', hint: 'Token from TurboSMS API settings. CRM does not send a paid test SMS automatically.' },
      { name: 'sender', label: 'TurboSMS sender / alpha name', type: 'text', required: true, placeholder: 'EventGenix', hint: 'Approved sender name configured in TurboSMS.' },
      { name: 'webhookSecret', label: 'Webhook secret', type: 'secret', required: false, placeholder: 'optional shared secret', hint: 'Optional protection for delivery/inbound SMS callbacks.' },
    ],
    webhookNote: 'TurboSMS delivery reports can use the shared SMS webhook URL with X-Webhook-Secret when configured.',
  },
  flysms: {
    provider: 'flysms',
    label: 'FlySMS',
    envKeys: ['FLYSMS_API_KEY', 'SMS_FLY_API_KEY', 'SMSFLY_API_KEY'],
    accountEnvKeys: ['FLYSMS_SENDER', 'SMS_FLY_SENDER', 'SMSFLY_SENDER'],
    credentialMap: {
      apiKey: ['FLYSMS_API_KEY', 'SMS_FLY_API_KEY', 'SMSFLY_API_KEY'],
      sender: ['FLYSMS_SENDER', 'SMS_FLY_SENDER', 'SMSFLY_SENDER'],
      webhookSecret: 'SMS_WEBHOOK_SECRET',
      apiUrl: ['FLYSMS_API_URL', 'SMS_FLY_API_URL'],
    },
    fields: [
      { name: 'apiKey', label: 'FlySMS API key', type: 'secret', required: true, placeholder: 'API key from SMS-fly cabinet', hint: 'API key generated in the SMS-fly / FlySMS cabinet.' },
      { name: 'sender', label: 'FlySMS sender / source', type: 'text', required: true, placeholder: 'EventGenix', hint: 'Approved SMS source name for FlySMS.' },
      { name: 'webhookSecret', label: 'Webhook secret', type: 'secret', required: false, placeholder: 'optional shared secret', hint: 'Optional protection for SMS delivery/inbound callbacks.' },
      { name: 'apiUrl', label: 'FlySMS API URL', type: 'url', required: false, placeholder: FLYSMS_DEFAULT_API_URL, hint: 'Leave empty to use the standard FlySMS REST endpoint.' },
    ],
    webhookNote: 'FlySMS uses the same CRM SMS webhook URL for delivery callbacks when configured in provider cabinet.',
  },
});

function normalizeSmsProvider(provider) {
  const value = String(provider || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['flysms', 'smsfly', 'fly'].includes(value)) return 'flysms';
  if (['turbosms', 'turbo'].includes(value)) return 'turbosms';
  return null;
}

function listSmsProviderDefinitions() {
  return Object.values(SMS_PROVIDER_DEFINITIONS);
}

function getSmsProviderDefinition(provider) {
  return SMS_PROVIDER_DEFINITIONS[normalizeSmsProvider(provider)] || null;
}

function hasAnyEnv(keys = []) {
  return keys.some(key => String(process.env[key] || '').trim());
}

function firstEnv(keys = []) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function defaultSmsProvider() {
  if (hasAnyEnv(SMS_PROVIDER_DEFINITIONS.flysms.envKeys)) return 'flysms';
  if (hasAnyEnv(SMS_PROVIDER_DEFINITIONS.turbosms.envKeys)) return 'turbosms';
  return 'flysms';
}

function inferSmsProviderFromValues(values = {}, secrets = {}) {
  const explicit = normalizeSmsProvider(values.provider || values.smsProvider || values.providerKey);
  if (explicit) return explicit;
  if (values.apiKey || secrets.apiKey || hasAnyEnv(SMS_PROVIDER_DEFINITIONS.flysms.envKeys)) return 'flysms';
  if (values.token || secrets.token || hasAnyEnv(SMS_PROVIDER_DEFINITIONS.turbosms.envKeys)) return 'turbosms';
  return defaultSmsProvider();
}

function smsEnvConfig(provider) {
  const def = getSmsProviderDefinition(provider) || SMS_PROVIDER_DEFINITIONS[defaultSmsProvider()];
  const values = { provider: def.provider };
  Object.entries(def.credentialMap || {}).forEach(([field, envKey]) => {
    const candidates = Array.isArray(envKey) ? envKey : [envKey];
    const value = firstEnv(candidates);
    if (value) values[field] = value;
  });
  if (def.provider === 'flysms' && !values.apiUrl) values.apiUrl = FLYSMS_DEFAULT_API_URL;
  return values;
}

function validateSmsRuntime(runtime = {}) {
  const provider = normalizeSmsProvider(runtime.provider) || defaultSmsProvider();
  if (provider === 'flysms') return validateFlySms(runtime);
  return validateTurboSms(runtime);
}

function validateTurboSms(runtime = {}) {
  const errors = [];
  if (!runtime.token || String(runtime.token).length < 12) errors.push('TurboSMS token is required.');
  if (!runtime.sender || String(runtime.sender).length < 2) errors.push('TurboSMS sender is required.');
  return errors;
}

function validateFlySms(runtime = {}) {
  const errors = [];
  if (!runtime.apiKey || String(runtime.apiKey).length < 12) errors.push('FlySMS API key is required.');
  if (!runtime.sender || String(runtime.sender).length < 2) errors.push('FlySMS sender/source is required.');
  if (runtime.apiUrl && !/^https:\/\//i.test(String(runtime.apiUrl))) errors.push('FlySMS API URL must be HTTPS.');
  return errors;
}

async function verifySmsRuntime(runtime = {}) {
  const provider = normalizeSmsProvider(runtime.provider) || defaultSmsProvider();
  const providerDef = getSmsProviderDefinition(provider);
  const errors = validateSmsRuntime({ ...runtime, provider });
  if (errors.length) {
    return {
      status: 'missing_config',
      message: errors.join(' '),
      warning: errors.join(' '),
      displayName: providerDef?.label || 'SMS',
    };
  }
  return {
    status: 'success',
    message: `${providerDef.label} config saved. CRM validated required fields without sending a paid SMS.`,
    warning: null,
    displayName: runtime.sender || providerDef.label,
    details: { provider },
  };
}

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '').slice(0, 15);
  if (!digits || digits.length < 7) {
    throw new Error(`Invalid phone number: too short (${digits.length} digits)`);
  }
  if (digits.startsWith('380') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+38${digits}`;
  if (digits.startsWith('80') && digits.length === 11) return `+3${digits}`;
  return `+${digits}`;
}

function httpsJsonRequest(urlLike, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlLike);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (httpRes) => {
      let data = '';
      httpRes.on('data', chunk => { data += chunk; });
      httpRes.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
        if (httpRes.statusCode >= 400) {
          const message = parsed.description || parsed.error?.description || parsed.error?.message || parsed.response_status || data.slice(0, 200) || `HTTP ${httpRes.statusCode}`;
          reject(new Error(message));
          return;
        }
        resolve(parsed);
      });
    });

    req.setTimeout(SOCKET_TIMEOUT, () => req.destroy(new Error('SMS provider socket timeout')));
    const responseTimer = setTimeout(() => req.destroy(new Error('SMS provider response timeout')), RESPONSE_TIMEOUT);
    req.on('close', () => clearTimeout(responseTimer));
    req.on('error', err => {
      clearTimeout(responseTimer);
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

async function sendSmsViaProvider(runtime = {}, phone, text) {
  const provider = normalizeSmsProvider(runtime.provider) || defaultSmsProvider();
  if (provider === 'flysms') return sendFlySms(runtime, phone, text);
  return sendTurboSms(runtime, phone, text);
}

async function sendTurboSms(runtime = {}, phone, text) {
  const token = runtime.token || firstEnv(SMS_PROVIDER_DEFINITIONS.turbosms.envKeys);
  const sender = runtime.sender || firstEnv(SMS_PROVIDER_DEFINITIONS.turbosms.accountEnvKeys) || 'EventGenix';
  if (!token) return { success: false, error: 'TurboSMS token is not configured' };
  if (!phone || !text) return { success: false, error: 'phone and text are required' };

  const normalizedPhone = normalizePhone(phone);
  const body = {
    recipients: [normalizedPhone],
    sms: { sender, text },
  };
  const response = await httpsJsonRequest('https://api.turbosms.ua/message/send.json', body, {
    Authorization: `Bearer ${token}`,
  });

  if (response.response_code === 0 && response.response_result) {
    const result = response.response_result[0];
    if (result && result.response_code === 0) {
      log.info('TurboSMS sent', { phone: normalizedPhone, messageId: result.message_id });
      return { success: true, provider: 'turbosms', messageId: result.message_id };
    }
    return { success: false, provider: 'turbosms', error: result ? result.response_status : 'Unknown TurboSMS send error' };
  }

  return {
    success: false,
    provider: 'turbosms',
    error: response.response_status || `TurboSMS code ${response.response_code}`,
  };
}

async function sendFlySms(runtime = {}, phone, text) {
  const apiKey = runtime.apiKey || firstEnv(SMS_PROVIDER_DEFINITIONS.flysms.envKeys);
  const sender = runtime.sender || firstEnv(SMS_PROVIDER_DEFINITIONS.flysms.accountEnvKeys) || 'EventGenix';
  if (!apiKey) return { success: false, provider: 'flysms', error: 'FlySMS API key is not configured' };
  if (!phone || !text) return { success: false, provider: 'flysms', error: 'phone and text are required' };

  const recipient = normalizePhone(phone).replace(/^\+/, '');
  const apiUrl = runtime.apiUrl || firstEnv(['FLYSMS_API_URL', 'SMS_FLY_API_URL']) || FLYSMS_DEFAULT_API_URL;
  const body = {
    auth: { key: apiKey },
    action: 'SENDMESSAGE',
    data: {
      recipient,
      channels: ['sms'],
      sms: {
        source: sender,
        ttl: Number(runtime.ttl || 300),
        text,
      },
    },
  };
  const response = await httpsJsonRequest(apiUrl, body);
  if (Number(response.success) === 1) {
    const messageId = response.data?.messageID || response.data?.messageId || response.data?.id || null;
    log.info('FlySMS sent', { phone: recipient, messageId });
    return { success: true, provider: 'flysms', messageId };
  }
  return {
    success: false,
    provider: 'flysms',
    error: response.error?.description || response.error?.code || 'FlySMS rejected the request',
  };
}

async function sendBulkSmsViaProvider(runtime = {}, phones = [], text) {
  if (!Array.isArray(phones) || phones.length === 0) {
    return { success: false, error: 'phones array is required and must not be empty' };
  }
  if (!text) return { success: false, error: 'text is required' };
  const results = [];
  for (const phone of phones) {
    try {
      const result = await sendSmsViaProvider(runtime, phone, text);
      results.push({ phone: normalizePhone(phone), messageId: result.messageId || null, error: result.success ? null : result.error || 'send failed' });
    } catch (err) {
      results.push({ phone: String(phone || ''), error: err.message });
    }
  }
  return { success: true, results };
}

module.exports = {
  FLYSMS_DEFAULT_API_URL,
  listSmsProviderDefinitions,
  getSmsProviderDefinition,
  normalizeSmsProvider,
  defaultSmsProvider,
  inferSmsProviderFromValues,
  smsEnvConfig,
  validateSmsRuntime,
  verifySmsRuntime,
  normalizePhone,
  sendSmsViaProvider,
  sendBulkSmsViaProvider,
};
