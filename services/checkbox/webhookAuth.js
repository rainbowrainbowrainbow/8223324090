'use strict';

const crypto = require('node:crypto');

const CHECKBOX_WEBHOOK_SIGNATURE_HEADER = 'x-eventgenix-signature';
const CHECKBOX_WEBHOOK_SIGNATURE_ALGORITHM = 'sha256';

class CheckboxWebhookAuthError extends Error {
    constructor(code, message, { status = 401 } = {}) {
        super(message || code);
        this.name = 'CheckboxWebhookAuthError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
    }
}

function normalizeSignatureHeader(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.startsWith(`${CHECKBOX_WEBHOOK_SIGNATURE_ALGORITHM}=`)
        ? text.slice(`${CHECKBOX_WEBHOOK_SIGNATURE_ALGORITHM}=`.length)
        : text;
}

function timingSafeHexEqual(left, right) {
    const a = Buffer.from(String(left || ''), 'hex');
    const b = Buffer.from(String(right || ''), 'hex');
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function signCheckboxWebhookBody(rawBody, signingSecret) {
    if (!Buffer.isBuffer(rawBody)) {
        throw new TypeError('rawBody must be a Buffer');
    }
    const secret = String(signingSecret || '');
    if (!secret) {
        throw new CheckboxWebhookAuthError('checkbox_webhook_secret_missing', 'Checkbox webhook signing secret is not configured', { status: 503 });
    }
    return crypto
        .createHmac(CHECKBOX_WEBHOOK_SIGNATURE_ALGORITHM, secret)
        .update(rawBody)
        .digest('hex');
}

function verifyCheckboxWebhookSignature({ rawBody, signatureHeader, signingSecret }) {
    if (!Buffer.isBuffer(rawBody)) {
        throw new CheckboxWebhookAuthError('checkbox_webhook_raw_body_missing', 'Raw webhook body is required', { status: 400 });
    }
    const provided = normalizeSignatureHeader(signatureHeader);
    if (!provided) {
        throw new CheckboxWebhookAuthError('checkbox_webhook_signature_missing', 'Checkbox webhook signature is required', { status: 401 });
    }
    const expected = signCheckboxWebhookBody(rawBody, signingSecret);
    if (!timingSafeHexEqual(provided, expected)) {
        throw new CheckboxWebhookAuthError('checkbox_webhook_signature_invalid', 'Checkbox webhook signature is invalid', { status: 401 });
    }
    return true;
}

module.exports = {
    CHECKBOX_WEBHOOK_SIGNATURE_ALGORITHM,
    CHECKBOX_WEBHOOK_SIGNATURE_HEADER,
    CheckboxWebhookAuthError,
    normalizeSignatureHeader,
    signCheckboxWebhookBody,
    verifyCheckboxWebhookSignature
};