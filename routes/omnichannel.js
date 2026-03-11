/**
 * routes/omnichannel.js — OmniClaw: Omnichannel communication routes
 *
 * Public webhooks (no auth): /webhook/viber, /webhook/sms, /webhook/meta, /webhook/binotel
 * CRM API (auth required): conversations, messages, send, stats, quick-replies
 */
const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/logger');
const auth = require('../middleware/auth');

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
        const body = req.body;
        // Viber sends webhook verification
        if (body.event === 'webhook') {
            return res.json({ status: 0, status_message: 'ok' });
        }
        if (body.event === 'message') {
            const normalized = getNormalizer().normalizeViber(body);
            if (normalized) {
                await getHub().processInboundMessage(normalized);
            }
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
        const normalized = getNormalizer().normalizeSms(req.body);
        if (normalized) {
            await getHub().processInboundMessage(normalized);
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
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

router.post('/webhook/meta', async (req, res) => {
    try {
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

// Get messages for conversation
router.get('/conversations/:id/messages', auth, async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const messages = await getHub().getMessages(
            parseInt(req.params.id),
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
        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, error: 'Текст повідомлення обов\'язковий' });
        }
        const message = await getHub().sendManualMessage(
            parseInt(req.params.id),
            text.trim(),
            req.user.username
        );
        res.json({ success: true, data: message });
    } catch (err) {
        log.error('Send message error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка відправки повідомлення' });
    }
});

// Update conversation status
router.patch('/conversations/:id', auth, async (req, res) => {
    try {
        const { status, assigned_to } = req.body;
        const updated = await getHub().updateConversationStatus(
            parseInt(req.params.id),
            status,
            assigned_to
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
        if (!url) return res.status(400).json({ success: false, error: 'URL обов\'язковий' });
        const { setViberWebhook } = require('../services/omni-viber');
        const result = await setViberWebhook(url);
        res.json(result);
    } catch (err) {
        log.error('Setup Viber error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка налаштування Viber' });
    }
});

module.exports = router;
