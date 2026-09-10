/**
 * routes/omnichannel.js — OmniClaw: Omnichannel communication routes
 *
 * Public webhooks (no auth): /webhook/viber, /webhook/sms, /webhook/meta, /webhook/binotel
 * CRM API (auth required): conversations, messages, send, stats, quick-replies
 */
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { resolveCapability } = require('../services/accountAccessPolicy');
const { parseProviderJson } = require('../services/omni-webhook-payload');
const { createLogger } = require('../utils/logger');
const { authenticateToken: auth, requireMinRole, requireAction } = require('../middleware/auth');
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
    publicWebhookUrl,
    providerDefinition,
} = require('../services/omni-accounts');

const log = createLogger('OmniRoutes');

router.use((req, res, next) => {
    const name = req.path.match(/^\/webhook\/(telegram|viber|sms|meta)$/)?.[1];
    if (req.method === 'POST' && name) {
        res.on('finish', () => {
            const channel = name === 'meta' ? (req.body?.object === 'instagram' ? 'instagram' : 'facebook') : name;
            const errorCode = res.statusCode >= 500 ? 'processing_failed'
                : res.statusCode === 403 ? 'invalid_signature' : req.omniUnsupported ? 'unsupported_event' : null;
            require('../services/omni-health').recordWebhook(channel, webhookBusinessContext(req), {
                inbound: res.statusCode < 300 && req.omniInboundAccepted === true, errorCode,
            }).catch(() => log.warn('Webhook diagnostics unavailable', { channel }));
        });
    }
    next();
});

function requestBusinessContext(req, res) {
    if (!resolveCapability(req.user, '/omni', { type: 'page' }).allowed) {
        res.status(403).json({ success: false, error: 'Немає доступу до Omni' });
        return null;
    }
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
    const token = runtime.token;
    if (!token || !Buffer.isBuffer(req.omniRawBody)) return false;
    const expected = crypto.createHmac('sha256', token)
        .update(req.omniRawBody)
        .digest('hex');
    return timingSafeTextEqual(sig, expected);
}

async function verifyWebhookSecret(req, envKey, channel, fieldName = 'webhookSecret') {
    const provided = channel === 'telegram'
        ? (req.headers['x-telegram-bot-api-secret-token'] ?? req.headers['x-webhook-secret'])
        : req.headers['x-webhook-secret'];
    if (!provided) return false;
    const runtime = channel ? await resolveOmniRuntimeConfig(channel, { businessContext: webhookBusinessContext(req) }) : {};
    const secret = runtime[fieldName] || (webhookBusinessContext(req) === 'event_genix' ? process.env[envKey] : null);
    if (!secret) return false;
    return timingSafeTextEqual(provided, secret);
}

async function verifyMetaSignature(req) {
    const sig = req.headers['x-hub-signature-256'];
    if (!sig) return false;
    const businessContext = webhookBusinessContext(req);
    const channel = req.body?.object === 'instagram' ? 'instagram' : 'facebook';
    const runtime = await resolveOmniRuntimeConfig(channel, { businessContext });
    const secret = runtime.appSecret;
    if (!secret || !Buffer.isBuffer(req.omniRawBody)) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret)
        .update(req.omniRawBody)
        .digest('hex');
    return timingSafeTextEqual(sig, expected);
}

function parseId(val) {
    const n = parseInt(val, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function collectSmsWebhookPayloads(body) {
    if (body?.type && body?.data && body?.signature) {
        // TurboSMS also posts Viber events here. Only SMS receipts belong to this channel.
        if (body.type !== 'DLR_SMS_API') return [];
        const records = Array.isArray(body.data) ? body.data : [body.data];
        return records.map(record => ({ ...record, provider: 'turbosms' }));
    }
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
        req.omniInboundAccepted = true;
        res.json({ ok: true });
    } catch (err) {
        log.error('omni.telegram.webhook.ignored', {
            reason: 'exception',
            error: err.message,
        });
        log.error('Telegram webhook error:', err.message);
        res.status(503).json({ ok: false, error: 'processing_failed' });
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
        const body = parseProviderJson(req.omniRawBody);
        // Viber sends webhook verification
        if (body.event === 'webhook') {
            return res.json({ status: 0, status_message: 'ok' });
        }
        const classified = getNormalizer().classifyViberWebhook(body);
        if (classified.type === 'inbound_message' && classified.normalized) {
            await getHub().processInboundMessage(classified.normalized, { businessContext });
            req.omniInboundAccepted = true;
        } else if (
            (classified.type === 'delivery_receipt' || classified.type === 'read_receipt')
            && classified.receipt
        ) {
            await getHub().applyProviderLifecycleReceipt(classified.receipt, { businessContext });
        }
        res.json({ status: 0, status_message: 'ok' });
    } catch (err) {
        log.error('Viber webhook error:', err.message);
        res.status(503).json({ status: 1, status_message: 'processing_failed' });
    }
});

// SMS webhook (provider delivery reports or inbound)
router.post('/webhook/sms', async (req, res) => {
    try {
        const businessContext = webhookBusinessContext(req);
        const runtime = await resolveOmniRuntimeConfig('sms', { businessContext });
        const isTurbo = runtime.provider === 'turbosms' && req.body?.signature && req.body?.id;
        const verified = isTurbo
            ? Boolean(runtime.webhookSecret && timingSafeTextEqual(req.body.signature,
                crypto.createHash('sha1').update(String(runtime.webhookSecret) + String(req.body.id)).digest('hex')))
            : await verifyWebhookSecret(req, 'SMS_WEBHOOK_SECRET', 'sms');
        if (!verified) {
            log.warn('SMS webhook secret verification failed');
            return res.status(403).json({ ok: false, error: 'invalid secret' });
        }
        for (const payload of collectSmsWebhookPayloads(req.body)) {
            const classified = getNormalizer().classifySmsWebhook(payload);
            if (classified.type === 'inbound_message' && classified.normalized) {
                await getHub().processInboundMessage(classified.normalized, { businessContext });
                req.omniInboundAccepted = true;
            } else if (classified.type === 'delivery_receipt' && classified.receipt) {
                await getHub().applyProviderLifecycleReceipt(classified.receipt, { businessContext });
            }
        }
        res.json({ ok: true });
    } catch (err) {
        log.error('SMS webhook error:', err.message);
        res.status(503).json({ ok: false, error: 'processing_failed' });
    }
});

// Meta webhook (Facebook + Instagram)
router.get('/webhook/meta', async (req, res) => {
    // Verification challenge for FB/IG webhook setup
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    try {
        const businessContext = webhookBusinessContext(req);
        const configs = await Promise.all(['facebook', 'instagram'].map(channel => resolveOmniRuntimeConfig(channel, { businessContext })));
        if (mode === 'subscribe' && configs.some(config => timingSafeTextEqual(token, config.verifyToken))) {
            return res.status(200).send(challenge);
        }
        res.sendStatus(403);
    } catch { res.status(503).json({ ok: false, error: 'processing_failed' }); }
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
            const channel = body.object === 'instagram' ? 'instagram' : 'facebook';
            const runtime = await resolveOmniRuntimeConfig(channel, { businessContext });
            const entries = body.entry || [];
            for (const entry of entries) {
                if (runtime.pageId && String(entry.id) !== String(runtime.pageId)) continue;
                const messaging = entry.messaging || [];
                for (const event of messaging) {
                    if (event.delivery || event.read) {
                        const ids = await require('../services/omni-inbox').applyMetaReceipt(channel, event, businessContext);
                        for (const id of ids) getHub().notifyCRM('omni:conversation', { conversation: { id, businessContext } });
                        continue;
                    }
                    const normFn = channel === 'instagram'
                        ? getNormalizer().normalizeInstagram
                        : getNormalizer().normalizeFacebook;
                    const normalized = normFn(event);
                    if (normalized) {
                        await getHub().processInboundMessage(normalized, { businessContext });
                        req.omniInboundAccepted = true;
                    }
                }
            }
        }
        res.json({ ok: true });
    } catch (err) {
        log.error('Meta webhook error:', err.message);
        res.status(503).json({ ok: false, error: 'processing_failed' });
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
        res.status(503).json({ ok: false, error: 'processing_failed' });
    }
});

// ═══════════════════════════════════════════════
// CRM API (auth required)
// ═══════════════════════════════════════════════

const manageConnections = requireMinRole('manager');
const manageLeadAssistantSettings = requireAction('manage_settings');

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
router.get('/accounts', auth, async (req, res) => {
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
            assignedTo: req.query.mine === 'true' ? req.user.username : undefined,
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
        const { limit = 50, offset = 0, latest } = req.query;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const messages = await getHub().getMessages(
            id,
            Math.max(1, Math.min(parseInt(limit, 10) || 50, 200)),
            Math.max(0, parseInt(offset, 10) || 0),
            { businessContext, latest: latest === 'true' }
        );
        res.json({ success: true, data: messages });
    } catch (err) {
        log.error('Get messages error:', err.message);
        res.status(500).json({ success: false, error: 'Помилка завантаження повідомлень' });
    }
});

router.post('/conversations/:id/read', auth, async (req, res) => {
    const businessContext = requestBusinessContext(req, res);
    if (!businessContext) return;
    const id = parseId(req.params.id);
    const through = Number(req.body.through_message_id);
    if (!id || !Number.isSafeInteger(through) || through <= 0) return res.status(400).json({ success: false, error: 'Невалідне повідомлення' });
    try {
        const data = await require('../services/omni-inbox').markConversationRead(id, through, businessContext);
        getHub().notifyCRM('omni:conversation', { businessContext, conversation: { id, businessContext } });
        res.json({ success: true, data });
    } catch (error) { res.status(error.statusCode || 500).json({ success: false, error: 'Не вдалося позначити прочитаним' }); }
});

router.get('/messages/:id/attachment', auth, async (req, res) => {
    const businessContext = requestBusinessContext(req, res);
    if (!businessContext) return;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID' });
    try {
        const file = await require('../services/omni-inbox').getTelegramAttachment(id, businessContext);
        res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="${file.filename}"` });
        res.send(file.buffer);
    } catch (error) {
        // Never expose upstream URLs: Telegram file URLs contain the bot token.
        res.status(error.statusCode || 502).json({ success: false, error: error.statusCode ? error.message : 'Вкладення недоступне. Спробуйте пізніше або відкрийте Telegram.' });
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
        if (typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ success: false, error: 'Текст повідомлення обов\'язковий' });
        }
        if (text.trim().length > 4000) return res.status(400).json({ success: false, error: 'Повідомлення завелике: максимум 4000 символів.' });
        const clientRequestId = req.body.client_request_id;
        if (clientRequestId !== undefined && (typeof clientRequestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(clientRequestId))) {
            return res.status(400).json({ success: false, error: 'Невалідний ідентифікатор відправки' });
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
                clientRequestId,
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
        if (err.statusCode === 409) return res.status(409).json({ success: false, error: err.message });
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

router.get('/operators', auth, async (req, res) => {
    const businessContext = requestBusinessContext(req, res);
    if (!businessContext) return;
    try { res.json({ success: true, data: await require('../services/omni-inbox').listOmniOperators(businessContext) }); }
    catch { res.status(500).json({ success: false, error: 'Не вдалося завантажити менеджерів' }); }
});

// Update conversation status
router.patch('/conversations/:id', auth, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        const id = parseId(req.params.id);
        if (!id) return res.status(400).json({ success: false, error: 'Невалідний ID розмови' });
        const { status, assigned_to, meta } = req.body;
        if (status !== undefined && !['open', 'pending', 'closed', 'spam'].includes(status)) return res.status(400).json({ success: false, error: 'Невалідний статус' });
        if (assigned_to !== undefined && assigned_to !== null) {
            const operators = await require('../services/omni-inbox').listOmniOperators(businessContext);
            if (!operators.some(operator => operator.username === assigned_to)) return res.status(400).json({ success: false, error: 'Менеджер не має доступу до цього inbox' });
        }
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
router.post('/setup/viber', auth, manageConnections, async (req, res) => {
    try {
        const businessContext = requestBusinessContext(req, res);
        if (!businessContext) return;
        let webhookUrl;
        try { webhookUrl = new URL(publicWebhookUrl(providerDefinition('viber'), { businessContext })); } catch { /* Fail closed below. */ }
        if (!webhookUrl || webhookUrl.protocol !== 'https:' || webhookUrl.username || webhookUrl.password) {
            return res.status(409).json({ success: false, error: 'Канонічну HTTPS адресу CRM не налаштовано.' });
        }
        if (req.body.url !== undefined && req.body.url !== webhookUrl.toString()) {
            return res.status(400).json({ success: false, error: 'Дозволено лише канонічний webhook цього бізнесу.' });
        }
        const { setViberWebhook } = require('../services/omni-viber');
        const result = await setViberWebhook(webhookUrl.toString(), undefined, { businessContext });
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
