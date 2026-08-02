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
const { authenticateToken: auth, requireMinRole } = require('../middleware/auth');
const { logAdminAction } = require('../services/adminAudit');
const {
    businessContextFromRequest,
    requireBusinessContext,
} = require('../services/businessContext');
const {
    getLeadAssistantSettings,
    saveLeadAssistantSettings,
    getLeadAssistantSalesContext,
    getLeadAssistantAnalytics,
    analyzeConversationLead,
    testLeadAssistantScript,
    createLeadFromConversation,
    createLeadAssistantFollowUpTask,
} = require('../services/omniLeadAssistant');
const {
    getOmniAccountStatusesAsync,
    getOmniAccountStatusAsync,
    upsertOmniConnection,
    recheckOmniConnection,
    testOmniConnection,
    disconnectOmniConnection,
    resolveOmniRuntimeConfig,
} = require('../services/omni-accounts');

const log = createLogger('OmniRoutes');

function requestBusinessContext(req, res) {
    const businessContext = businessContextFromRequest(req);
    if (!requireBusinessContext(req, res, businessContext)) return null;
    return businessContext;
}

function webhookBusinessContext(req) {
    return businessContextFromRequest(req);
}

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

async function verifyViberSignature(req) {
    const sig = req.headers['x-viber-content-signature'];
    if (!sig) return false;
    const runtime = await resolveOmniRuntimeConfig('viber', { businessContext: webhookBusinessContext(req) });
    const token = runtime.token || process.env.VIBER_TOKEN;
    if (!token) return false;
    const expected = crypto.createHmac('sha256', token)
        .update(JSON.stringify(req.body))
        .digest('hex');
    return timingSafeTextEqual(sig, expected);
}

async function verifyWebhookSecret(req, envKey, channel, fieldName = 'webhookSecret') {
    const provided = req.headers['x-webhook-secret'];
    if (!provided) return false;
    const runtime = channel ? await resolveOmniRuntimeConfig(channel, { businessContext: webhookBusinessContext(req) }) : {};
    const secret = runtime[fieldName] || process.env[envKey];
    if (!secret) return false;
    return timingSafeTextEqual(provided, secret);
}

async function verifyMetaSignature(req) {
    const sig = req.headers['x-hub-signature-256'];
    if (!sig) return false;
    const businessContext = webhookBusinessContext(req);
    const facebook = await resolveOmniRuntimeConfig('facebook', { businessContext });
    const instagram = await resolveOmniRuntimeConfig('instagram', { businessContext });
    const secret = facebook.appSecret || instagram.appSecret || process.env.META_APP_SECRET;
    if (!secret) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
    return timingSafeTextEqual(sig, expected);
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
        const businessContext = webhookBusinessContext(req);
        log.info('omni.telegram.webhook.received', {
            businessContext,
            updateId: req.body?.update_id || null,
            hasMessage: Boolean(req.body?.message || req.body?.edited_message),
            botMilestone: req.body?.event_type === 'bot_milestone' || req.body?.direction === 'bot_outbound',
        });
        if (!await verifyWebhookSecret(req, 'OMNI_TELEGRAM_WEBHOOK_SECRET', 'telegram')) {
            log.warn('omni.telegram.webhook.ignored', {
                businessContext,
                reason: 'invalid_secret',
                updateId: req.body?.update_id || null,
            });
            log.warn('Telegram webhook secret verification failed');
            return res.status(403).json({ ok: false, error: 'invalid secret' });
        }
        if (req.body?.event_type === 'bot_milestone' || req.body?.direction === 'bot_outbound') {
            const normalized = getNormalizer().normalizeTelegramBotMilestone(req.body);
            if (!normalized) {
                log.warn('omni.telegram.webhook.ignored', {
                    businessContext,
                    reason: 'invalid_payload',
                    eventType: req.body?.event_type || null,
                });
                log.warn('Telegram bot milestone ignored as invalid', { businessContext });
                return res.json({ ok: true, ignored: true, reason: 'invalid_payload' });
            }
            await getHub().processBotMilestone(normalized, { businessContext });
            return res.json({ ok: true, botEvent: true });
        }
        const normalized = getNormalizer().normalizeTelegram(req.body);
        if (!normalized) {
            log.warn('omni.telegram.webhook.ignored', {
                businessContext,
                reason: 'invalid_payload',
                updateId: req.body?.update_id || null,
            });
            log.warn('Telegram webhook payload ignored as invalid', { businessContext });
            return res.json({ ok: true, ignored: true, reason: 'invalid_payload' });
        }
        await getHub().processInboundMessage(normalized, { businessContext });
        res.json({ ok: true });
    } catch (err) {
        log.error('omni.telegram.webhook.ignored', {
            reason: 'exception',
            error: err.message,
        });
        log.error('Telegram webhook error:', err.message);
        res.json({ ok: true }); // always 200 for webhooks
    }
});

// Viber webhook
router.post('/webhook/viber', async (req, res) => {
    try {
        const businessContext = webhookBusinessContext(req);
        if (!await verifyViberSignature(req)) {
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
            await getHub().processInboundMessage(classified.normalized, { businessContext });
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

// SMS webhook (provider delivery reports or inbound)
router.post('/webhook/sms', async (req, res) => {
    try {
        const businessContext = webhookBusinessContext(req);
        if (!await verifyWebhookSecret(req, 'SMS_WEBHOOK_SECRET', 'sms')) {
            log.warn('SMS webhook secret verification failed');
            return res.status(403).json({ ok: false, error: 'invalid secret' });
        }
        for (const payload of collectSmsWebhookPayloads(req.body)) {
            const classified = getNormalizer().classifySmsWebhook(payload);
            if (classified.type === 'inbound_message' && classified.normalized) {
                await getHub().processInboundMessage(classified.normalized, { businessContext });
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
    if (mode === 'subscribe' && timingSafeTextEqual(token, process.env.META_VERIFY_TOKEN)) {
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

router.post('/webhook/meta', async (req, res) => {
    try {
        const businessContext = webhookBusinessContext(req);
        if (!await verifyMetaSignature(req)) {
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
                        await getHub().processInboundMessage(normalized, { businessContext });
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
        const businessContext = webhookBusinessContext(req);
        if (!await verifyWebhookSecret(req, 'BINOTEL_WEBHOOK_SECRET', 'binotel')) {
            log.warn('Binotel webhook secret verification failed');
            return res.status(403).json({ ok: false, error: 'invalid secret' });
        }
        const normalized = getNormalizer().normalizeBinotel(req.body);
        if (normalized) {
            await getHub().processInboundMessage(normalized, { businessContext });
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

const manageConnections = requireMinRole('manager');
const manageLeadAssistantSettings = requireMinRole('senior_manager');

async function auditConnectionAction(req, action, channel, result) {
    logAdminAction(`omni_connection_${action}`, 'omni_connections', {
        username: req.user?.username || req.user?.name || null,
        target: channel,
        details: {
            channel,
            status: result?.account?.status || null,
            sendCapable: result?.account?.sendCapable ?? null,
            receiveCapable: result?.account?.receiveCapable ?? null
        },
        ip: req.ip,
        requestId: req.headers['x-request-id'] || null
    }).catch(() => {});
}

// Account/channel connectivity control-plane
router.get('/accounts', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        res.json({ success: true, businessContext, accounts: await getOmniAccountStatusesAsync({ businessContext }) });
    } catch (err) {
        log.error('Get omni accounts error:', err.message);
        res.status(500).json({ success: false, error: 'Не вдалося отримати статус каналів Omni' });
    }
});

router.get('/accounts/:channel', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const account = await getOmniAccountStatusAsync(req.params.channel, { businessContext });
        if (!account) return res.status(404).json({ success: false, error: 'Канал Omni не знайдено' });
        res.json({ success: true, account });
    } catch (err) {
        log.error('Get omni account error:', err.message);
        res.status(500).json({ success: false, error: 'Не вдалося отримати канал Omni' });
    }
});

router.post('/accounts/:channel/recheck', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const result = await recheckOmniConnection(req.params.channel, req.user, { businessContext });
        await auditConnectionAction(req, 'recheck', req.params.channel, result);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Recheck omni account error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Не вдалося перевірити канал Omni', details: err.details || null });
    }
});

router.post('/accounts/:channel/test', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const result = await testOmniConnection(req.params.channel, req.user, { businessContext });
        await auditConnectionAction(req, 'test', req.params.channel, result);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Test omni account error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Не вдалося протестувати канал Omni', details: err.details || null });
    }
});

router.post('/accounts/:channel/connect', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const result = await upsertOmniConnection(req.params.channel, req.body || {}, req.user, { businessContext });
        await auditConnectionAction(req, 'connect', req.params.channel, result);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Connect omni account error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Не вдалося підключити Omni-канал', details: err.details || null });
    }
});

router.post('/accounts/:channel/disconnect', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const result = await disconnectOmniConnection(req.params.channel, req.user, { businessContext });
        await auditConnectionAction(req, 'disconnect', req.params.channel, result);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Disconnect omni account error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Не вдалося відключити Omni-канал', details: err.details || null });
    }
});

// Explicit Telegram inbox aliases keep report/alerts bot operations separate in API semantics.
router.post('/accounts/telegram/inbox/connect', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const result = await upsertOmniConnection('telegram', req.body || {}, req.user, { businessContext });
        await auditConnectionAction(req, 'connect_inbox', 'telegram_inbox', result);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Connect Telegram inbox error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Не вдалося підключити Telegram inbox', details: err.details || null });
    }
});

router.post('/accounts/telegram/inbox/test', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const result = await testOmniConnection('telegram', req.user, { businessContext });
        await auditConnectionAction(req, 'test_inbox', 'telegram_inbox', result);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Test Telegram inbox error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Не вдалося протестувати Telegram inbox', details: err.details || null });
    }
});

router.post('/accounts/telegram/inbox/disconnect', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const result = await disconnectOmniConnection('telegram', req.user, { businessContext });
        await auditConnectionAction(req, 'disconnect_inbox', 'telegram_inbox', result);
        res.json({ success: true, ...result });
    } catch (err) {
        log.error('Disconnect Telegram inbox error:', err.message);
        res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Не вдалося відвʼязати Telegram inbox', details: err.details || null });
    }
});

// List conversations
router.get('/conversations', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const { status, channel, search, limit = 50, offset = 0 } = req.query;
        const conversations = await getHub().getConversations({
            status, channel, search,
            limit: Math.min(parseInt(limit) || 50, 100),
            offset: parseInt(offset) || 0,
            businessContext
        });
        res.json({ success: true, businessContext, data: conversations });
    } catch (err) {
        log.error('Get conversations error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка завантаження розмов' });
    }
});

// Resolve CRM context for a single conversation without pretending fallback is exact.
router.get('/conversations/:id/context', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const context = await getHub().resolveConversationContext(id, { businessContext });
        if (!context) {
            return res.status(404).json({ success: false, error: 'Розмову не знайдено' });
        }
        res.json({ success: true, data: context });
    } catch (err) {
        log.error('Resolve conversation context error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка звʼязування CRM-контексту' });
    }
});

// Omni lead assistant settings: pinned discovery fields and reply rules.
router.get('/lead-assistant/settings', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        res.json({ success: true, businessContext, settings: await getLeadAssistantSettings({ businessContext }) });
    } catch (err) {
        log.error('Get Omni lead assistant settings error:', err.message);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити налаштування AI ліда' });
    }
});

router.put('/lead-assistant/settings', auth, manageLeadAssistantSettings, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const settings = await saveLeadAssistantSettings(req.body || {}, {
            businessContext,
            username: req.user?.username || req.user?.name || null
        });
        await logAdminAction('omni_lead_assistant_settings_update', 'settings', {
            username: req.user?.username || req.user?.name || null,
            target: 'omni_lead_assistant_config',
            details: {
                model: settings.model,
                fields: settings.requiredFields.map(field => field.key),
                enabled: settings.enabled,
                revision: settings.revision,
            },
            ip: req.ip,
            requestId: req.headers['x-request-id'] || null,
        }).catch(() => {});
        res.json({ success: true, settings });
    } catch (err) {
        log.error('Save Omni lead assistant settings error:', err.message);
        res.status(500).json({ success: false, error: 'Не вдалося зберегти налаштування AI ліда' });
    }
});

router.get('/lead-assistant/analytics', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        res.json({ success: true, businessContext, analytics: await getLeadAssistantAnalytics({ businessContext }) });
    } catch (err) {
        log.error('Get Omni lead assistant analytics error:', err.message);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити аналітику AI ліда' });
    }
});

router.get('/lead-assistant/sales-context', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const settings = await getLeadAssistantSettings({ businessContext });
        const salesContext = await getLeadAssistantSalesContext(settings, {}, {
            businessContext
        });
        res.json({ success: true, salesContext });
    } catch (err) {
        log.error('Get Omni lead assistant sales context error:', err.message);
        res.status(500).json({ success: false, error: 'Не вдалося завантажити каталоги для AI ліда' });
    }
});

router.post('/lead-assistant/test', auth, async (req, res) => {
    try {
        const analysis = await testLeadAssistantScript(req.body || {});
        res.json({ success: true, analysis });
    } catch (err) {
        log.error('Test Omni lead assistant script error:', err.message);
        res.status(err.status || 500).json({ success: false, error: err.message || 'Не вдалося протестувати AI скрипт' });
    }
});

router.post('/conversations/:id/lead-assistant/follow-up-task', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const result = await createLeadAssistantFollowUpTask(id, req.body?.analysis, {
            user: req.user,
            date: req.body?.date || req.body?.followUpDate || req.body?.follow_up_date,
            priority: req.body?.priority,
            assignedTo: req.body?.assignedTo || req.body?.assigned_to,
            leadId: req.body?.leadId || req.body?.lead_id,
            businessContext,
        });
        res.status(result.created ? 201 : 200).json({
            success: true,
            created: result.created,
            task: result.task,
            analysis: result.analysis,
            link: result.link,
        });
    } catch (err) {
        log.error('Omni lead assistant follow-up task error:', err.message);
        res.status(err.status || 500).json({ success: false, error: err.message || 'Помилка створення follow-up задачі з Omni-діалогу' });
    }
});

// Analyze an Omni dialogue and return a structured lead draft + needs checklist.
router.post('/conversations/:id/lead-assistant/analyze', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const analysis = await analyzeConversationLead(id, { businessContext });
        res.json({ success: true, analysis });
    } catch (err) {
        log.error('Omni lead assistant analysis error:', err.message);
        res.status(err.status || 500).json({ success: false, error: err.message || 'Помилка AI аналізу діалогу' });
    }
});

// Create and link a CRM lead from the latest assistant draft.
router.post('/conversations/:id/lead-assistant/create-lead', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const analysis = req.body?.analysis || await analyzeConversationLead(id, { businessContext });
        const result = await createLeadFromConversation(id, analysis, {
            businessContext,
            user: req.user,
        });
        res.status(result.created ? 201 : 200).json({
            success: true,
            created: result.created,
            lead: result.lead,
            analysis: result.analysis,
            link: result.lead?.id ? `/sales-funnel?lead=${encodeURIComponent(result.lead.id)}` : null,
        });
    } catch (err) {
        log.error('Omni create lead from assistant error:', err.message);
        res.status(err.status || 500).json({ success: false, error: err.message || 'Помилка створення ліда з діалогу' });
    }
});

// Get messages for conversation
router.get('/conversations/:id/messages', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const { limit = 50, offset = 0 } = req.query;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const messages = await getHub().getMessages(
            id,
            Math.min(parseInt(limit) || 50, 200),
            parseInt(offset) || 0,
            { businessContext }
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
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const { text, reply_expected, reply_sla_at } = req.body;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        if (!text || !text.trim()) {
            return res.status(400).json({ success: false, error: 'Текст повідомлення обов\'язковий' });
        }
        const replyOwner = req.user?.name || req.user?.username || null;
        const replyOwnerUserId = req.user?.id || null;
        const message = await getHub().sendManualMessage(
            id,
            text.trim(),
            req.user.username,
            {
                replyExpected: reply_expected,
                replyOwner,
                replyOwnerUserId,
                replySlaAt: reply_sla_at || null,
                businessContext,
            }
        );
        res.json({
            success: true,
            data: message.message || message,
            sendTruth: message.sendTruth || message.message?.meta?.sendTruth || null,
            conversation: message.conversation || null,
            replyExpectation: message.replyExpectation || null
        });
    } catch (err) {
        log.error('Send message error:', err.message);
        if (err.code === 'CHANNEL_UNAVAILABLE') {
            return res.status(err.statusCode || 400).json({
                success: false,
                error: err.sendTruth?.message || 'Канал недоступний для відправки з CRM',
                sendTruth: err.sendTruth || null
            });
        }
        res.status(500).json({ success: false, error: 'Помилка відправки повідомлення' });
    }
});

// Update conversation status
router.patch('/conversations/:id', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const { status, assigned_to, meta } = req.body;
        const updated = await getHub().updateConversationStatus(
            id,
            status,
            assigned_to,
            meta,
            { businessContext }
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
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const stats = await getHub().getStats({ businessContext });
        res.json({ success: true, businessContext, data: stats });
    } catch (err) {
        log.error('Get stats error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка статистики' });
    }
});

// Quick replies CRUD
router.get('/quick-replies', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const replies = await getHub().getQuickReplies({ businessContext });
        res.json({ success: true, businessContext, data: replies });
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

function timingSafeTextEqual(provided, expected) {
    const providedBuffer = Buffer.from(String(provided || ''), 'utf8');
    const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
    return providedBuffer.length > 0
        && expectedBuffer.length > 0
        && providedBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}
