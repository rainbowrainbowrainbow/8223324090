'use strict';

const { validateTime } = require('./booking');

const PLATFORMS = new Set(['telegram', 'google_chat', 'crm_chat']);
const AFISHA_MODES = new Set(['off', 'monthly', 'publication']);
const fail = message => Object.assign(new Error(message), { statusCode: 400 });

function validateAnnouncementRecipient(input) {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 100) throw fail('Назва групи має містити від 1 до 100 символів');
    if (!PLATFORMS.has(input.platform)) throw fail('Оберіть платформу');
    if (!AFISHA_MODES.has(input.afishaMode)) throw fail('Оберіть режим афіші');
    if (['active', 'eventsToday', 'promotionsToday'].some(field => typeof input[field] !== 'boolean')) {
        throw fail('Некоректні перемикачі розсилки');
    }
    if (!validateTime(input.monthlyTime) || !validateTime(input.dailyTime)) {
        throw fail('Вкажіть час розсилки у форматі ГГ:ХХ');
    }

    const fields = {
        name,
        platform: input.platform,
        active: input.active,
        afishaMode: input.afishaMode,
        monthlyTime: input.monthlyTime,
        dailyTime: input.dailyTime,
        eventsToday: input.eventsToday,
        promotionsToday: input.promotionsToday
    };
    if (input.platform === 'telegram') {
        if (typeof input.chatId !== 'string' || !/^-[1-9]\d{0,15}$/.test(input.chatId)
            || !Number.isSafeInteger(Number(input.chatId))) {
            throw fail('Оберіть Telegram-групу');
        }
        const thread = input.threadId == null ? null : String(input.threadId);
        if (thread !== null && (!/^[1-9]\d{0,15}$/.test(thread) || !Number.isSafeInteger(Number(thread)))) {
            throw fail('Некоректна тема Telegram');
        }
        fields.chatId = input.chatId;
        fields.threadId = thread;
    }
    if (input.platform === 'crm_chat') {
        const channelId = Number(input.channelId);
        if (!/^[1-9]\d*$/.test(String(input.channelId)) || channelId > 2147483647) throw fail('Оберіть групу CRM');
        fields.channelId = channelId;
    }
    return fields;
}

// These timestamps mark rule activation or rescheduling. Routine edits like
// renaming a group cannot turn a missed slot into a new delivery.
function announcementRuleActivation(recipient, previous, now) {
    const monthlyEnabled = recipient.active && recipient.afishaMode === 'monthly';
    const dailyEnabled = recipient.active && (recipient.eventsToday || recipient.promotionsToday);
    const sameTarget = previous?.active && recipient.destinationKey === previous.destinationKey;
    return {
        monthlyEnabledAt: monthlyEnabled
            ? (sameTarget && previous.afishaMode === 'monthly' && recipient.monthlyTime === previous.monthlyTime
                ? previous.monthlyEnabledAt ?? now : now)
            : null,
        dailyEnabledAt: dailyEnabled
            ? (sameTarget && (previous.eventsToday || previous.promotionsToday) && recipient.dailyTime === previous.dailyTime
                ? previous.dailyEnabledAt ?? now : now)
            : null
    };
}

module.exports = { validateAnnouncementRecipient, announcementRuleActivation };
