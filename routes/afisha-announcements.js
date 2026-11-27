'use strict';

const { Router } = require('express');
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
const { listRecipients, getRecipient, publicRecipient, saveRecipient, history, publishAnnouncement } = require('../services/afishaAnnouncementStore');

const log = createLogger('AfishaAnnouncements');

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
        const [recipients, notificationRoute, telegramFeatures, legacyApproval, telegramDirectory, routeEntries] = await Promise.all([
            listRecipients(pool, business),
            business === DEFAULT_TIMELINE_CONTEXT ? readNotificationRoute() : null,
            readOperationalTelegramFeatures(pool),
            isPark ? resolveAnimatorAskTelegramTarget() : null,
            isPark ? listTelegramDirectory(pool) : [],
            isPark ? Promise.all(['approval', 'digest', 'reminder'].map(async feature => [feature, await getTelegramRoute(pool, feature)])) : []
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
        SELECT latest.recipient_id, latest.slot_key,
            CASE WHEN bool_and(p.status = 'sent') THEN 'sent'
                WHEN bool_or(p.status = 'sent') THEN 'partial'
                WHEN bool_or(p.status = 'uncertain') THEN 'uncertain'
                WHEN bool_or(p.status = 'retry') THEN 'retry'
                WHEN bool_or(p.status IN ('pending', 'claimed')) THEN 'pending'
                WHEN bool_or(p.status = 'failed') THEN 'failed' ELSE 'skipped' END AS status
        FROM latest JOIN afisha_announcement_parts p
            ON p.business_context = $1 AND p.destination_key = latest.destination_key AND p.slot_key = latest.slot_key
        GROUP BY latest.recipient_id, latest.slot_key`, [business]);
        const byRecipient = new Map(deliveries.rows.map(row => [String(row.recipient_id), row]));
        res.json({ dailyDigest, telegramFeatures, approvalTarget, routingPreview, telegramDirectory, routeSelections, recipients: recipients.map(recipient => ({
            ...publicRecipient(telegramAnnouncementRecipient(recipient, telegramFeatures), now()),
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
        res.status(201).json({ recipient: await saveRecipient(pool, business, null, req.body, now()) });
    }));
    router.put('/recipients/:id', businessScopeWriteGuard, handle(async (req, res, business) => {
        res.json({ recipient: await saveRecipient(pool, business, req.params.id, req.body, now()) });
    }));
    router.get('/recipients/:id/history', handle(async (req, res, business) => {
        await getRecipient(pool, business, req.params.id);
        res.json({ deliveries: await history(pool, business, req.params.id) });
    }));
    router.get('/recipients/:id/preview', handle(async (req, res, business) => {
        const recipient = await getRecipient(pool, business, req.params.id);
        const features = await readOperationalTelegramFeatures(pool);
        const slot = automaticAnnouncementSlots(telegramAnnouncementRecipient(recipient, features), now()).upcoming[0];
        res.json(slot
            ? { parts: await renderAutomaticAnnouncement(pool, recipient, slot), scheduledAt: slot.scheduledAt }
            : { parts: [], scheduledAt: null });
    }));
    router.post('/preview', businessScopeWriteGuard, handle(async (req, res, business) => {
        const recipients = await listRecipients(pool, business);
        const { from, to } = req.body || {};
        const features = await readOperationalTelegramFeatures(pool);
        const { previewToken, recipients: groups, parts } = await prepareAfishaPublication(pool, {
            business, from, to, recipients: recipients.map(recipient => telegramAnnouncementRecipient(recipient, features))
        });
        res.json({ previewToken, recipients: groups, parts });
    }));
    router.post('/publish', businessScopeWriteGuard, handle(async (req, res, business) => {
        const result = await publishAnnouncement(pool, business, req.body?.previewToken, now());
        res.status(202).json(result);
    }));

    return router;
}

module.exports = { createAnnouncementRouter };
