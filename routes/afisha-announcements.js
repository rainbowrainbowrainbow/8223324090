'use strict';

const { Router } = require('express');
const multer = require('multer');
const { createLogger } = require('../utils/logger');
const { BUSINESS_SCOPE_SINGLE, businessScopeModeFromRequest } = require('../services/businessContext');
const { businessScopeWriteGuard } = require('../middleware/businessScopeGuard');
const { resolveCapability } = require('../services/accountAccessPolicy');
const { DEFAULT_TIMELINE_CONTEXT, timelineContextFromRequest, canAccessTimelineContext } = require('../services/timelineContext');
const { readOperationalTelegramFeatures, saveOperationalTelegramFeatures, telegramAnnouncementRecipient, previewOperationalTelegramRoutes } = require('../services/operationalTelegramFeatures');
const { resolveAnimatorAskTelegramTarget } = require('../services/animator-telegram-approval');
const { listTelegramDirectory, getTelegramRoute, setTelegramRoute, telegramAddressKey } = require('../services/telegramDirectory');
const { getConfiguredChatId, getConfiguredThreadId } = require('../services/telegram');
const { automaticAnnouncementSlots } = require('../services/afishaAnnouncementSchedule');
const { prepareAfishaPublication } = require('../services/afishaAnnouncementPublication');
const { renderAutomaticAnnouncement } = require('../services/afishaAnnouncementDelivery');
const { listRecipients, getRecipient, publicRecipient, saveRecipient, history, publishAnnouncement,
    manualRecipients, publicationState, publicationJournal, DELIVERY_STATUS_SQL } = require('../services/afishaAnnouncementStore');
const { listCrmAnnouncementChannels } = require('../services/afishaAnnouncementCrmChat');
const { MAX_LAYOUT_BYTES, currentLayout, readLayout, saveLayout } = require('../services/afishaPublicationLayout');

const log = createLogger('AfishaAnnouncements');
const uploadLayout = multer({ storage: multer.memoryStorage(), limits: {
    fileSize: MAX_LAYOUT_BYTES, files: 1, fields: 2, parts: 4, fieldSize: 64
} }).single('layout');

function selectedRecipients(body) {
    const ids = body?.recipientIds;
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[1-9]\d{0,17}$/.test(id))) {
        throw Object.assign(new Error('Оберіть отримувачів афіші.'), { statusCode: 400 });
    }
    return [...new Set(ids)];
}

const layoutInfo = layout => layout ? { id: layout.id, contentType: layout.content_type } : null;

function createAnnouncementRouter(pool, {
    now = () => new Date(),
    readNotificationRoute = async () => {
        const result = await pool.query(`SELECT key, value FROM settings
            WHERE key IN ('digest_time', 'digest_time_weekday', 'digest_time_weekend', 'reminder_time')`);
        const settings = Object.fromEntries(result.rows.map(row => [row.key, row.value]));
        const clock = value => /^\d{2}:\d{2}$/.test(value) ? value : null;
        const chatId = await getConfiguredChatId();
        return {
            target: chatId ? { chatId, threadId: await getConfiguredThreadId() } : null,
            schedules: {
                weekday: clock(settings.digest_time_weekday || settings.digest_time),
                weekend: clock(settings.digest_time_weekend || settings.digest_time),
                reminder: clock(settings.reminder_time)
            }
        };
    }
} = {}) {
    const router = Router();

    router.use((req, res, next) => {
        const business = timelineContextFromRequest(req);
        if (businessScopeModeFromRequest(req) !== BUSINESS_SCOPE_SINGLE || !canAccessTimelineContext(req.user, business) ||
            !resolveCapability(req.user, 'manage_settings', { type: 'action' }).allowed) {
            return res.status(403).json({ error: 'Розсилка недоступна в цьому бізнесі' });
        }
        req.announcementBusiness = business;
        next();
    });

    function handle(operation) {
        return async (req, res) => {
            try {
                await operation(req, res, req.announcementBusiness);
            } catch (error) {
                if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
                log.error('Announcement operation failed', { code: error.code || 'internal' });
                res.status(500).json({ error: 'Не вдалося виконати дію розсилки' });
            }
        };
    }

    router.put('/telegram-features', businessScopeWriteGuard, handle(async (req, res, business) => {
        if (business !== DEFAULT_TIMELINE_CONTEXT) return res.status(403).json({ error: 'Оберіть бізнес парку' });
        res.json({ telegramFeatures: await saveOperationalTelegramFeatures(pool, req.body, now()) });
    }));

    router.put('/telegram-routes/:feature', businessScopeWriteGuard, handle(async (req, res, business) => {
        if (business !== DEFAULT_TIMELINE_CONTEXT) return res.status(403).json({ error: 'Оберіть бізнес парку' });
        const target = await setTelegramRoute(pool, req.params.feature, req.body?.target);
        res.json({ target });
    }));

    router.get('/recipients', handle(async (req, res, business) => {
        const isPark = business === DEFAULT_TIMELINE_CONTEXT;
        const [recipients, notificationRoute, telegramFeatures, legacyApproval, telegramDirectory, routeEntries, crmChannels] = await Promise.all([
            listRecipients(pool, business),
            business === DEFAULT_TIMELINE_CONTEXT ? readNotificationRoute() : null,
            readOperationalTelegramFeatures(pool),
            isPark ? resolveAnimatorAskTelegramTarget() : null,
            isPark ? listTelegramDirectory(pool) : [],
            isPark ? Promise.all(['approval', 'digest', 'reminder'].map(async feature => [feature, await getTelegramRoute(pool, feature)])) : [],
            listCrmAnnouncementChannels(pool, business, req.user)
        ]);
        const overrides = Object.fromEntries(routeEntries);
        const approvalTarget = overrides.approval || legacyApproval;
        const routeSelections = Object.fromEntries(routeEntries.map(([feature, target]) =>
            [feature, target ? telegramAddressKey(target.chatId, target.threadId) : null]));
        const schedules = notificationRoute?.schedules;
        const dailyDigest = schedules?.weekday || schedules?.weekend ? overrides.digest || notificationRoute.target : null;
        const routingPreview = notificationRoute === null ? [] : previewOperationalTelegramRoutes({
            approvalTarget, notificationTarget: notificationRoute.target, schedules, recipients, overrides
        });
        const deliveries = await pool.query(`WITH latest AS (
            SELECT DISTINCT ON (recipient_id) recipient_id, destination_key, slot_key
            FROM afisha_announcement_parts WHERE business_context = $1 ORDER BY recipient_id, id DESC
        )
        SELECT latest.recipient_id, latest.slot_key, ${DELIVERY_STATUS_SQL} AS status
        FROM latest JOIN afisha_announcement_parts p
            ON p.business_context = $1 AND p.destination_key = latest.destination_key AND p.slot_key = latest.slot_key
        GROUP BY latest.recipient_id, latest.slot_key`, [business]);
        const byRecipient = new Map(deliveries.rows.map(row => [String(row.recipient_id), row]));
        const accessible = new Set(crmChannels.map(channel => channel.id));
        res.json({ dailyDigest, telegramFeatures, approvalTarget, routingPreview, telegramDirectory, routeSelections, crmChannels,
            recipients: recipients.filter(recipient => recipient.platform !== 'crm_chat'
                || accessible.has(recipient.channelId) || recipient.connectedBy === req.user.id).map(recipient => ({
            ...publicRecipient(telegramAnnouncementRecipient(recipient, telegramFeatures), now()),
            unavailable: recipient.platform === 'crm_chat' && !accessible.has(recipient.channelId),
            active: recipient.active,
            lastDelivery: byRecipient.get(String(recipient.id)) || null,
            digestOverlap: recipient.platform === 'telegram' && dailyDigest != null
                && String(dailyDigest.chatId) === recipient.chatId
                && String(dailyDigest.threadId ?? '') === String(recipient.threadId ?? '')
        })) });
    }));

    router.get('/telegram-chats', handle(async (req, res, business) => {
        // Use the directory populated by inbound updates. The old discovery
        // method may briefly replace a bot's webhook and is not suitable here.
        const chats = business === DEFAULT_TIMELINE_CONTEXT
            ? (await pool.query(`SELECT chat_id::text AS id, title FROM telegram_known_chats
                WHERE type IN ('group', 'supergroup') ORDER BY title, chat_id`)).rows : [];
        res.json({ chats });
    }));

    router.post('/recipients', businessScopeWriteGuard, handle(async (req, res, business) => {
        res.status(201).json({ recipient: await saveRecipient(pool, business, null, req.body, now(), req.user) });
    }));
    router.put('/recipients/:id', businessScopeWriteGuard, handle(async (req, res, business) => {
        res.json({ recipient: await saveRecipient(pool, business, req.params.id, req.body, now(), req.user) });
    }));
    router.get('/recipients/:id/history', handle(async (req, res, business) => {
        const recipient = await getRecipient(pool, business, req.params.id);
        if (recipient.platform === 'crm_chat' && recipient.connectedBy !== req.user.id
            && !(await listCrmAnnouncementChannels(pool, business, req.user, recipient.channelId)).length)
            return res.status(404).json({ error: 'Групу не знайдено' });
        const [deliveries, journal] = await Promise.all([
            history(pool, business, req.params.id), publicationJournal(pool, business, req.params.id)
        ]);
        res.json({ deliveries, journal });
    }));
    router.get('/recipients/:id/preview', handle(async (req, res, business) => {
        const recipient = await getRecipient(pool, business, req.params.id);
        if (recipient.platform === 'crm_chat' && !(await listCrmAnnouncementChannels(pool, business, req.user, recipient.channelId)).length)
            return res.status(404).json({ error: 'Групу не знайдено' });
        const features = await readOperationalTelegramFeatures(pool);
        const slot = automaticAnnouncementSlots(telegramAnnouncementRecipient(recipient, features), now()).upcoming[0];
        res.json(slot
            ? { parts: await renderAutomaticAnnouncement(pool, recipient, slot), scheduledAt: slot.scheduledAt,
                layout: slot.kind === 'monthly' && recipient.platform !== 'google_chat'
                    ? layoutInfo(await currentLayout(pool, business, slot.from, slot.to)) : null }
            : { parts: [], scheduledAt: null });
    }));
    router.get('/publication-options', handle(async (req, res, business) => {
        const [recipients, features, layout] = await Promise.all([
            listRecipients(pool, business), readOperationalTelegramFeatures(pool),
            currentLayout(pool, business, req.query.from, req.query.to)
        ]);
        const eligible = await manualRecipients(pool, business, req.user, recipients, features);
        res.json({ layout: layoutInfo(layout), recipients: eligible.map(({ id, name, platform, active, afishaMode }) =>
            ({ id: String(id), name, platform, selected: active && afishaMode === 'publication' })) });
    }));
    router.put('/layout', businessScopeWriteGuard, (req, res, next) => {
        uploadLayout(req, res, error => error ? res.status(400).json({ error: 'Виберіть один файл PNG або JPG до 5 МБ.' }) : next());
    }, handle(async (req, res, business) => {
        const layout = await saveLayout(pool, business, req.body.from, req.body.to, req.file);
        res.json({ layout: layoutInfo(layout) });
    }));
    router.get('/layout/:id', handle(async (req, res, business) => {
        const layout = /^[1-9]\d{0,17}$/.test(req.params.id) && await readLayout(pool, business, req.params.id);
        if (!layout) return res.status(404).json({ error: 'Макет не знайдено' });
        res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'same-origin' }).type(layout.content_type).send(layout.content);
    }));
    router.post('/preview', businessScopeWriteGuard, handle(async (req, res, business) => {
        const recipients = await listRecipients(pool, business);
        const { from, to } = req.body || {};
        const features = await readOperationalTelegramFeatures(pool);
        const legacy = req.body?.recipientIds === undefined;
        const recipientIds = legacy ? undefined : selectedRecipients(req.body);
        const eligible = legacy ? recipients.map(recipient => telegramAnnouncementRecipient(recipient, features))
            : await manualRecipients(pool, business, req.user, recipients, features);
        const preview = await prepareAfishaPublication(pool, {
            business, from, to, recipients: eligible, recipientIds, publisherId: legacy ? undefined : req.user.id, resend: req.body?.resend === true
        });
        const deliveryState = legacy ? [] : await publicationState(pool, business,
            eligible.filter(item => recipientIds.includes(String(item.id))), preview);
        res.json({ previewToken: preview.previewToken, recipients: preview.recipients, parts: preview.parts, deliveryState,
            layout: layoutInfo(preview.layout) });
    }));
    router.post('/publish', businessScopeWriteGuard, handle(async (req, res, business) => {
        const result = await publishAnnouncement(pool, business, req.body?.previewToken, now(), req.body?.recipientIds === undefined ? {} : {
            recipientIds: selectedRecipients(req.body), actor: req.user, resend: req.body?.resend === true
        });
        res.status(202).json(result);
    }));

    return router;
}

module.exports = { createAnnouncementRouter };
