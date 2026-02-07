/**
 * services/templates.js — Telegram notification templates
 *
 * Template Pattern: дані окремо, формат окремо.
 * Якщо потрібно змінити текст повідомлення — міняємо ТІЛЬКИ тут.
 */

function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(minutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    return `${h}:${m}`;
}

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

module.exports = { formatBookingNotification, timeToMinutes, minutesToTime };
