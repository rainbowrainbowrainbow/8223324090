'use strict';

const SETTING_KEY = 'operational_telegram_features';

async function readOperationalTelegramFeatures(db) {
    const result = await db.query('SELECT value FROM settings WHERE key = $1', [SETTING_KEY]);
    let value;
    try { value = JSON.parse(result.rows[0]?.value ?? '{}'); } catch { value = {}; }
    return {
        animatorApprovals: value?.animatorApprovals !== false,
        afishaAnnouncements: value?.afishaAnnouncements === true,
        afishaEnabledAt: typeof value?.afishaEnabledAt === 'string' ? value.afishaEnabledAt : null
    };
}

async function saveOperationalTelegramFeatures(db, input, now) {
    if (typeof input?.animatorApprovals !== 'boolean' || typeof input?.afishaAnnouncements !== 'boolean') {
        throw Object.assign(new Error('Некоректні перемикачі службового бота'), { statusCode: 400 });
    }
    const previous = await readOperationalTelegramFeatures(db);
    const value = {
        animatorApprovals: input.animatorApprovals,
        afishaAnnouncements: input.afishaAnnouncements,
        afishaEnabledAt: input.afishaAnnouncements ? (previous.afishaAnnouncements && previous.afishaEnabledAt) || now.toISOString() : null
    };
    await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [SETTING_KEY, JSON.stringify(value)]);
    return value;
}

function telegramAnnouncementRecipient(recipient, features) {
    if (recipient.platform !== 'telegram') return recipient;
    if (!features.afishaAnnouncements) return { ...recipient, active: false };
    const later = existing => existing && (features.afishaEnabledAt && new Date(existing) < new Date(features.afishaEnabledAt)
        ? features.afishaEnabledAt : existing);
    return { ...recipient, monthlyEnabledAt: later(recipient.monthlyEnabledAt), dailyEnabledAt: later(recipient.dailyEnabledAt) };
}

function previewOperationalTelegramRoutes({ approvalTarget, notificationTarget, schedules, recipients, overrides = {} }) {
    const configuredAddress = target => ({
        chatId: target?.chatId == null ? null : String(target.chatId),
        threadId: target?.threadId == null ? null : String(target.threadId)
    });
    const approvals = configuredAddress(approvalTarget);
    const digest = configuredAddress(overrides.digest || notificationTarget);
    const reminder = configuredAddress(overrides.reminder || notificationTarget);
    const sameAddress = recipient => approvals.chatId !== null && recipient.platform === 'telegram'
        && String(recipient.chatId) === approvals.chatId && String(recipient.threadId ?? '') === String(approvals.threadId ?? '');
    const matchingRecipient = recipients.find(sameAddress);
    return [
        { feature: 'approval', botProfile: 'operational', ...approvals, matchingRecipient: matchingRecipient?.name ?? null },
        { feature: 'digest', botProfile: 'legacy_notifications', ...digest, weekday: schedules.weekday, weekend: schedules.weekend },
        { feature: 'reminder', botProfile: 'legacy_notifications', ...reminder, time: schedules.reminder }
    ];
}

module.exports = { readOperationalTelegramFeatures, saveOperationalTelegramFeatures, telegramAnnouncementRecipient, previewOperationalTelegramRoutes };
