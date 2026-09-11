'use strict';

// Preserve the signed bytes only for Omni provider callbacks.
function captureOmniWebhookBody(req, res, buffer) {
  const pathname = String(req.originalUrl || req.url || '').split('?')[0];
  if (/^\/api(?:\/v1)?\/omni\/webhook\/(viber|meta|sms|whatsapp)\/?$/.test(pathname)) {
    req.omniRawBody = Buffer.from(buffer);
  }
}

// Provider identifiers can exceed Number.MAX_SAFE_INTEGER. Tokenize strings as
// whole tokens so numbers inside message text are never changed.
function parseProviderJson(raw) {
  const text = String(raw).replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, token => {
    if (/^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token))) return JSON.stringify(token);
    return token;
  });
  return JSON.parse(text);
}

module.exports = { captureOmniWebhookBody, parseProviderJson };
