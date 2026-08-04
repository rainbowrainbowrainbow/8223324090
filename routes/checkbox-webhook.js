'use strict';

const express = require('express');
const {
    CHECKBOX_WEBHOOK_SIGNATURE_HEADER,
    CheckboxWebhookAuthError,
    verifyCheckboxWebhookSignature
} = require('../services/checkbox/webhookAuth');
const {
    checkboxWebhookErrorResponse,
    handleCheckboxWebhook
} = require('../services/checkbox/webhookService');

function createCheckboxWebhookRouter({ signingSecret = process.env.CHECKBOX_WEBHOOK_SIGNING_SECRET, webhookHandler = handleCheckboxWebhook } = {}) {
    const router = express.Router();

    router.use(express.raw({ type: '*/*', limit: '256kb' }));

    router.post('/', async (req, res) => {
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
        try {
            verifyCheckboxWebhookSignature({
                rawBody,
                signatureHeader: req.get(CHECKBOX_WEBHOOK_SIGNATURE_HEADER),
                signingSecret
            });
            const result = await webhookHandler({ rawBody, headers: req.headers });
            return res.status(result.replayed ? 200 : 202).json({ success: true, ...result });
        } catch (error) {
            if (error instanceof CheckboxWebhookAuthError) {
                return res.status(error.status).json({ success: false, code: error.code, error: error.message });
            }
            const response = checkboxWebhookErrorResponse(error);
            return res.status(response.status).json(response.body);
        }
    });

    return router;
}

module.exports = createCheckboxWebhookRouter();
module.exports.createCheckboxWebhookRouter = createCheckboxWebhookRouter;