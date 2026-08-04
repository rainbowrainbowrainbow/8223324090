'use strict';

const {
    CHECKBOX_WEBHOOK_SIGNATURE_HEADER,
    signCheckboxWebhookBody,
    verifyCheckboxWebhookSignature
} = require('./webhookAuth');

class WebhookReplayGuard {
    constructor() {
        this.seen = new Map();
    }

    remember(eventId, payloadHash) {
        const id = String(eventId || '').trim();
        const hash = String(payloadHash || '').trim();
        if (!id || !hash) return { accepted: false, replay: false, conflict: false };
        const existing = this.seen.get(id);
        if (!existing) {
            this.seen.set(id, hash);
            return { accepted: true, replay: false, conflict: false };
        }
        if (existing === hash) return { accepted: true, replay: true, conflict: false };
        return { accepted: false, replay: true, conflict: true };
    }
}

module.exports = {
    CHECKBOX_WEBHOOK_SIGNATURE_HEADER,
    WebhookReplayGuard,
    signCheckboxWebhookBody,
    verifyCheckboxWebhookSignature
};
