'use strict';

const { resolveOmniRuntimeConfig } = require('./omni-accounts');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const { createLogger } = require('../utils/logger');

const log = createLogger('OmniTelegramBridge');
const BRIDGE_TIMEOUT_MS = parseInt(process.env.OMNI_TELEGRAM_BRIDGE_TIMEOUT_MS || '8000', 10);

function bridgeConfigured(runtime = {}) {
  return Boolean(runtime.bridgeSendUrl && runtime.bridgeSendToken);
}

async function sendTelegramBridgeMessage(externalId, text, options = {}) {
  const businessContext = normalizeBusinessContext(
    options.businessContext || options.business_context || DEFAULT_BUSINESS_CONTEXT
  );
  const runtime = await resolveOmniRuntimeConfig('telegram', { businessContext });
  if (!bridgeConfigured(runtime)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(runtime.bridgeSendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${runtime.bridgeSendToken}`,
        'Content-Type': 'application/json',
        'X-Business-Context': businessContext,
      },
      body: JSON.stringify({
        chat_id: externalId,
        text,
        disable_notification: options.silent !== false,
        business_context: businessContext,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
    if (!response.ok) {
      return {
        ok: false,
        description: payload.detail || payload.error || `Telegram bridge HTTP ${response.status}`,
        error_code: response.status,
      };
    }
    return payload && typeof payload === 'object' ? payload : { ok: true };
  } catch (err) {
    log.warn('Telegram bridge send failed', { error: err.message });
    return { ok: false, description: err.message || 'Telegram bridge send failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  bridgeConfigured,
  sendTelegramBridgeMessage,
};
