/**
 * services/templates.js — Telegram notification templates
 */
const { timeToMinutes, minutesToTime } = require('./booking');

const notificationTemplates = {
    create(booking, extra) {
        const endTime = minutesToTime(timeToMinutes(booking.time) + (booking.duration || 0));
        const statusIcon = booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене';
        let text = `📌 <b>Нове бронювання</b>\n\n`;
        text += `${statusIcon}\n`;
        text += `🎭 ${booking.label || booking.program_code}: ${booking.program_name}\n`;
        text += `🕐 ${booking.date} | ${booking.time} - ${endTime}\n`;
        text += `🏠 ${booking.room}\n`;
        if (booking.second_animator || booking.secondAnimator) text += `👥 Другий аніматор: ${booking.second_animator || booking.secondAnimator}\n`;
        if (booking.kids_count) text += `👶 ${booking.kids_count} дітей\n`;
        if (booking.notes) text += `📝 ${booking.notes}\n`;
        text += `\n👤 Створив: ${extra.username || booking.created_by}`;
        return text;
    },

    edit(booking, extra) {
        const endTime = minutesToTime(timeToMinutes(booking.time) + (booking.duration || 0));
        let text = `✏️ <b>Бронювання змінено</b>\n\n`;
        text += `🎭 ${booking.label || booking.program_code}: ${booking.program_name}\n`;
        text += `🕐 ${booking.date} | ${booking.time} - ${endTime}\n`;
        text += `🏠 ${booking.room}\n`;
        if (booking.second_animator || booking.secondAnimator) text += `👥 Другий аніматор: ${booking.second_animator || booking.secondAnimator}\n`;
        if (booking.kids_count) text += `👶 ${booking.kids_count} дітей\n`;
        if (booking.notes) text += `📝 ${booking.notes}\n`;
        text += `\n👤 Змінив: ${extra.username || '?'}`;
        return text;
    },

    delete(booking, extra) {
        return `🗑 <b>Видалено бронювання</b>\n\n` +
            `🎭 ${booking.label || booking.program_code}: ${booking.program_name}\n` +
            `🕐 ${booking.date} | ${booking.time}\n` +
            `🏠 ${booking.room}\n` +
            `\n👤 Видалив: ${extra.username || '?'}`;
    },

    status_change(booking, extra) {
        const statusText = booking.status === 'confirmed' ? '✅ Підтверджене' : '⏳ Попереднє';
        return `⚡ <b>Статус змінено</b>\n\n` +
            `🎭 ${booking.label || booking.program_code}: ${booking.program_name}\n` +
            `🕐 ${booking.date} | ${booking.time}\n` +
            `📊 ${statusText}\n` +
            `\n👤 Змінив: ${extra.username || '?'}`;
    }
};

function formatBookingNotification(type, booking, extra = {}) {
    const template = notificationTemplates[type];
    if (!template) return '';
    return template(booking, extra);
}

/**
 * Format afisha events block for digest/reminder messages
 * Splits events by type: regular events + birthday block
 * @param {Array} events - afisha rows [{date, time, title, duration, type}, ...]
 * @returns {string} formatted HTML text block (empty string if no events)
 */
function formatAfishaBlock(events) {
    if (!events || events.length === 0) return '';

    const regular = events.filter(ev => ev.type !== 'birthday');
    const birthdays = events.filter(ev => ev.type === 'birthday');

    let text = '';

    if (regular.length > 0) {
        text += '🎪 <b>Афіша:</b>\n';
        for (const ev of regular) {
            const endMinutes = timeToMinutes(ev.time) + (ev.duration || 60);
            const endTime = minutesToTime(endMinutes);
            const icon = ev.type === 'regular' ? '🔄' : '🎭';
            text += `  ${icon} ${ev.time}-${endTime} ${ev.title}`;
            if (ev.duration && ev.duration !== 60) text += ` (${ev.duration}хв)`;
            if (ev.description) text += ` — ${ev.description}`;
            text += '\n';
        }
    }

    if (birthdays.length > 0) {
        text += '🎂 <b>Іменинники:</b>\n';
        for (const ev of birthdays) {
            text += `  🎂 ${ev.title} (14:00 + 18:00, 15хв)`;
            if (ev.description) text += ` — ${ev.description}`;
            text += '\n';
        }
    }

    return text;
}

module.exports = { notificationTemplates, formatBookingNotification, formatAfishaBlock };
