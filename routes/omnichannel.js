/**
 * routes/omnichannel.js — OmniClaw: Omnichannel communication routes
 *
 * Public webhooks (no auth): /webhook/viber, /webhook/sms, /webhook/meta, /webhook/binotel
 * CRM API (auth required): conversations, messages, send, stats, quick-replies
 */
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/logger');
const { authenticateToken: auth } = require('../middleware/auth');

const log = createLogger('OmniRoutes');

// Lazy-load hub to avoid circular deps
let hub = null;
function getHub() {
    if (!hub) hub = require('../services/omni-hub');
    return hub;
}

let normalizer = null;
function getNormalizer() {
    if (!normalizer) normalizer = require('../services/omni-normalizer');
    return normalizer;
}

// ═══════════════════════════════════════════════
// Webhook signature verification helpers
// ═══════════════════════════════════════════════

function verifyViberSignature(req) {
    const token = process.env.VIBER_TOKEN;
    if (!token) return true; // skip if not configured
    const sig = req.headers['x-viber-content-signature'];
    if (!sig) return false;
    const expected = crypto.createHmac('sha256', token)
        .update(JSON.stringify(req.body))
        .digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false; // length mismatch
    }
}

function verifyWebhookSecret(req, envKey) {
    const secret = process.env[envKey];
    if (!secret) return true; // skip if not configured
    const provided = req.headers['x-webhook-secret'];
    if (!provided) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
    } catch {
        return false;
    }
}

function verifyMetaSignature(req) {
    const secret = process.env.META_APP_SECRET;
    if (!secret) return true; // skip if not configured
    const sig = req.headers['x-hub-signature-256'];
    if (!sig) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function parseId(val) {
    const n = parseInt(val, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function collectSmsWebhookPayloads(body) {
    if (Array.isArray(body)) return body;
    for (const key of ['messages', 'reports', 'delivery_reports', 'deliveryReports']) {
        if (Array.isArray(body && body[key])) return body[key];
    }
    return [body];
}

// ═══════════════════════════════════════════════
// PUBLIC WEBHOOKS (no auth)
// ═══════════════════════════════════════════════

// Telegram webhook — incoming messages from Telegram
router.post('/webhook/telegram', async (req, res) => {
    try {
        const normalized = getNormalizer().normalizeTelegram(req.body);
        if (normalized) {
            await getHub().processInboundMessage(normalized);
        }
        res.json({ ok: true });
    } catch (err) {
        log.error('Telegram webhook error:', err.message);
        res.json({ ok: true }); // always 200 for webhooks
    }
});

// Viber webhook
router.post('/webhook/viber', async (req, res) => {
    try {
        if (!verifyViberSignature(req)) {
            log.warn('Viber webhook signature verification failed');
            return res.status(403).json({ status: 1, status_message: 'invalid signature' });
        }
        const body = req.body;
        // Viber sends webhook verification
        if (body.event === 'webhook') {
            return res.json({ status: 0, status_message: 'ok' });
        }
        const classified = getNormalizer().classifyViberWebhook(body);
        if (classified.type === 'inbound_message' && classified.normalized) {
            await getHub().processInboundMessage(classified.normalized);
        } else if (
            (classified.type === 'delivery_receipt' || classified.type === 'read_receipt')
            && classified.receipt
        ) {
            await getHub().applyProviderLifecycleReceipt(classified.receipt);
        }
        res.json({ status: 0, status_message: 'ok' });
    } catch (err) {
        log.error('Viber webhook error:', err.message);
        res.json({ status: 0, status_message: 'ok' });
    }
});

// SMS webhook (TurboSMS delivery reports or inbound)
router.post('/webhook/sms', async (req, res) => {
    try {
        if (!verifyWebhookSecret(req, 'SMS_WEBHOOK_SECRET')) {
            log.warn('SMS webhook secret verification failed');
            return res.status(403).json({ ok: false, error: 'invalid secret' });
        }
        for (const payload of collectSmsWebhookPayloads(req.body)) {
            const classified = getNormalizer().classifySmsWebhook(payload);
            if (classified.type === 'inbound_message' && classified.normalized) {
                await getHub().processInboundMessage(classified.normalized);
            } else if (classified.type === 'delivery_receipt' && classified.receipt) {
                await getHub().applyProviderLifecycleReceipt(classified.receipt);
            }
        }
        res.json({ ok: true });
    } catch (err) {
        log.error('SMS webhook error:', err.message);
        res.json({ ok: true });
    }
});

// Meta webhook (Facebook + Instagram)
router.get('/webhook/meta', (req, res) => {
    // Verification challenge for FB/IG webhook setup
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && process.env.META_VERIFY_TOKEN && token === process.env.META_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

router.post('/webhook/meta', async (req, res) => {
    try {
        if (!verifyMetaSignature(req)) {
            log.warn('Meta webhook signature verification failed');
            return res.status(403).json({ ok: false, error: 'invalid signature' });
        }
        const body = req.body;
        if (body.object === 'page' || body.object === 'instagram') {
            const entries = body.entry || [];
            for (const entry of entries) {
                const messaging = entry.messaging || [];
                for (const event of messaging) {
                    const channel = body.object === 'instagram' ? 'instagram' : 'facebook';
                    const normFn = channel === 'instagram'
                        ? getNormalizer().normalizeInstagram
                        : getNormalizer().normalizeFacebook;
                    const normalized = normFn(event);
                    if (normalized) {
                        await getHub().processInboundMessage(normalized);
                    }
                }
            }
        }
        res.json({ ok: true });
    } catch (err) {
        log.error('Meta webhook error:', err.message);
        res.json({ ok: true });
    }
});

// Binotel webhook (phone calls)
router.post('/webhook/binotel', async (req, res) => {
    try {
        if (!verifyWebhookSecret(req, 'BINOTEL_WEBHOOK_SECRET')) {
            log.warn('Binotel webhook secret verification failed');
            return res.status(403).json({ ok: false, error: 'invalid secret' });
        }
        const normalized = getNormalizer().normalizeBinotel(req.body);
        if (normalized) {
            await getHub().processInboundMessage(normalized);
        }
        res.json({ ok: true });
    } catch (err) {
        log.error('Binotel webhook error:', err.message);
        res.json({ ok: true });
    }
});

// ═══════════════════════════════════════════════
// CRM API (auth required)
// ═══════════════════════════════════════════════

// List conversations
router.get('/conversations', auth, async (req, res) => {
    try {
        const { status, channel, search, limit = 50, offset = 0 } = req.query;
        const conversations = await getHub().getConversations({
            status, channel, search,
            limit: Math.min(parseInt(limit) || 50, 100),
            offset: parseInt(offset) || 0
        });
        res.json({ success: true, data: conversations });
    } catch (err) {
        log.error('Get conversations error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка завантаження розмов' });
    }
});

// Resolve CRM context for a single conversation without pretending fallback is exact.
router.get('/conversations/:id/context', auth, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'РќРµРІР°Р»С–РґРЅРёР№ ID СЂРѕР·РјРѕРІРё' });
        const context = await getHub().resolveConversationContext(id);
        if (!context) {
            return res.status(404).json({ success: false, error: 'Р РѕР·РјРѕРІСѓ РЅРµ Р·РЅР°Р№РґРµРЅРѕ' });
        }
        res.json({ success: true, data: context });
    } catch (err) {
        log.error('Resolve conversation context error:', err.message);
        res.status(500).json({ success: false, error: 'РџРѕРјРёР»РєР° Р·РІ\'СЏР·СѓРІР°РЅРЅСЏ CRM-РєРѕРЅС‚РµРєСЃС‚Сѓ' });
    }
});

// Get messages for conversation
router.get('/conversations/:id/messages', auth, async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const messages = await getHub().getMessages(
            id,
            Math.min(parseInt(limit) || 50, 200),
            parseInt(offset) || 0
        );
        res.json({ success: true, data: messages });
    } catch (err) {
        log.error('Get messages error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка завантаження повідомлень' });
    }
});

// Send message from CRM
router.post('/conversations/:id/send', auth, async (req, res) => {
    try {
        const { text } = req.body;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, error: 'Текст повідомлення обов\'язковий' });
        }
        const message = await getHub().sendManualMessage(
            id,
            text.trim(),
            req.user.username
        );
        res.json({
            success: true,
            data: message.message || message,
            sendTruth: message.sendTruth || message.message?.meta?.sendTruth || null
        });
    } catch (err) {
        log.error('Send message error:', err.message);
        if (err.code === 'CHANNEL_UNAVAILABLE') {
            return res.status(err.statusCode || 400).json({
                success: false,
                error: 'Канал недоступний для відправки з CRM',
                sendTruth: err.sendTruth || null
            });
        }
        res.status(500).json({ success: false, error: 'Помилка відправки повідомлення' });
    }
});

// Update conversation status
router.patch('/conversations/:id', auth, async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const { status, assigned_to, meta } = req.body;
        const updated = await getHub().updateConversationStatus(
            id,
            status,
            assigned_to,
            meta
        );
        res.json({ success: true, data: updated });
    } catch (err) {
        log.error('Update conversation error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка оновлення розмови' });
    }
});

// Get omni stats
router.get('/stats', auth, async (req, res) => {
    try {
        const stats = await getHub().getStats();
        res.json({ success: true, data: stats });
    } catch (err) {
        log.error('Get stats error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка статистики' });
    }
});

// Quick replies CRUD
router.get('/quick-replies', auth, async (req, res) => {
    try {
        const replies = await getHub().getQuickReplies();
        res.json({ success: true, data: replies });
    } catch (err) {
        log.error('Get quick replies error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка завантаження швидких відповідей' });
    }
});

// Setup Viber webhook
router.post('/setup/viber', auth, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
            return res.status(400).json({ success: false, error: 'Потрібен валідний HTTPS URL' });
        }
        const { setViberWebhook } = require('../services/omni-viber');
        const result = await setViberWebhook(url);
        res.json(result);
    } catch (err) {
        log.error('Setup Viber error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка налаштування Viber' });
    }
});

module.exports = router;
