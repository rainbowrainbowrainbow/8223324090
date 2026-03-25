/**
 * services/templates.js — Telegram notification templates
 */
const { timeToMinutes, minutesToTime } = require('./booking');

// v38.4.0: Escape HTML for Telegram parse_mode: HTML
function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// v38.4.0: Truncate for Telegram 4096 char limit
function truncate(text, max = 4000) {
    if (!text || text.length <= max) return text;
    return text.slice(0, max) + '\n\n... (обрізано)';
}

const notificationTemplates = {
    create(booking, extra) {
        const endTime = minutesToTime(timeToMinutes(booking.time) + (booking.duration || 0));
        const statusIcon = booking.status === 'preliminary' ? '⏳ Попереднє' : '✅ Підтверджене';
        let text = `📌 <b>Нове бронювання</b>\n\n`;
        text += `${statusIcon}\n`;
        text += `🎭 ${esc(booking.label || booking.program_code)}: ${esc(booking.program_name)}\n`;
        text += `🕐 ${booking.date} | ${booking.time} - ${endTime}\n`;
        text += `🏠 ${esc(booking.room)}\n`;
        if (extra.lineName) text += `🎪 Аніматор: ${esc(extra.lineName)}\n`;
        if (booking.second_animator || booking.secondAnimator) text += `👥 Другий аніматор: ${esc(booking.second_animator || booking.secondAnimator)}\n`;
        if (booking.pinata_filler || booking.pinataFiller) text += `🪅 Наповнювач: №${booking.pinata_filler || booking.pinataFiller}\n`;
        if (booking.kids_count) text += `👶 ${booking.kids_count} дітей\n`;
        if (booking.group_name || booking.groupName) text += `👥 Група: ${esc(booking.group_name || booking.groupName)}\n`;
        if (booking.notes) text += `📝 ${esc(booking.notes)}\n`;
        text += `\n👤 Створив: ${esc(extra.username || booking.created_by)}`;
        return text;
    },

    edit(booking, extra) {
        const endTime = minutesToTime(timeToMinutes(booking.time) + (booking.duration || 0));
        let text = `✏️ <b>Бронювання змінено</b>\n\n`;
        text += `🎭 ${esc(booking.label || booking.program_code)}: ${esc(booking.program_name)}\n`;
        text += `🕐 ${booking.date} | ${booking.time} - ${endTime}\n`;
        text += `🏠 ${esc(booking.room)}\n`;
        if (extra.lineName) text += `🎪 Аніматор: ${esc(extra.lineName)}\n`;
        if (booking.second_animator || booking.secondAnimator) text += `👥 Другий аніматор: ${esc(booking.second_animator || booking.secondAnimator)}\n`;
        if (booking.pinata_filler || booking.pinataFiller) text += `🪅 Наповнювач: №${booking.pinata_filler || booking.pinataFiller}\n`;
        if (booking.kids_count) text += `👶 ${booking.kids_count} дітей\n`;
        if (booking.group_name || booking.groupName) text += `👥 Група: ${esc(booking.group_name || booking.groupName)}\n`;
        if (booking.notes) text += `📝 ${esc(booking.notes)}\n`;
        text += `\n👤 Змінив: ${esc(extra.username || '?')}`;
        return text;
    },

    delete(booking, extra) {
        let text = `🗑 <b>Видалено бронювання</b>\n\n`;
        text += `🎭 ${esc(booking.label || booking.program_code)}: ${esc(booking.program_name)}\n`;
        text += `🕐 ${booking.date} | ${booking.time}\n`;
        text += `🏠 ${esc(booking.room)}\n`;
        if (extra.lineName) text += `🎪 Аніматор: ${esc(extra.lineName)}\n`;
        if (booking.second_animator || booking.secondAnimator) text += `👥 Другий аніматор: ${esc(booking.second_animator || booking.secondAnimator)}\n`;
        text += `\n👤 Видалив: ${esc(extra.username || '?')}`;
        return text;
    },

    status_change(booking, extra) {
        const statusText = booking.status === 'confirmed' ? '✅ Підтверджене' : '⏳ Попереднє';
        let text = `⚡ <b>Статус змінено</b>\n\n`;
        text += `🎭 ${esc(booking.label || booking.program_code)}: ${esc(booking.program_name)}\n`;
        text += `🕐 ${booking.date} | ${booking.time}\n`;
        text += `📊 ${statusText}\n`;
        if (extra.lineName) text += `🎪 Аніматор: ${esc(extra.lineName)}\n`;
        if (booking.second_animator || booking.secondAnimator) text += `👥 Другий аніматор: ${esc(booking.second_animator || booking.secondAnimator)}\n`;
        text += `\n👤 Змінив: ${esc(extra.username || '?')}`;
        return text;
    }
};

function formatBookingNotification(type, booking, extra = {}) {
    const template = notificationTemplates[type];
    if (!template) return '';
    return truncate(template(booking, extra));
}

// v8.4: Certificate notification templates
const certificateTemplates = {
    certificate_issued(cert, extra) {
        const issuedDate = cert.issued_at ? new Date(cert.issued_at).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' }) : '—';
        const validUntil = cert.valid_until ? new Date(cert.valid_until).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' }) : '—';
        const mode = cert.display_mode === 'fio' ? 'ПІБ' : 'Номер';
        return `📄 <b>Видано сертифікат</b>\n\n` +
            `🏷 Тип: ${esc(cert.type_text || 'на одноразовий вхід')}\n` +
            `📋 Режим: ${mode}\n` +
            `👤 Дані: ${esc(cert.display_value)}\n` +
            `📅 Видано: ${issuedDate}\n` +
            `⏰ Дійсний до: ${validUntil}\n` +
            `👤 Видав: ${esc(extra.username || '?')}\n` +
            `🔑 Код: <code>${cert.cert_code}</code>`;
    },

    certificate_used(cert, extra) {
        return `✅ <b>Сертифікат використано</b>\n\n` +
            `🔑 ${cert.cert_code}\n` +
            `👤 ${esc(cert.display_value)}\n` +
            `🏷 ${esc(cert.type_text)}\n` +
            `\n👤 Змінив: ${esc(extra.username || '?')}`;
    },

    certificate_revoked(cert, extra) {
        return `❌ <b>Сертифікат анульовано</b>\n\n` +
            `🔑 ${cert.cert_code}\n` +
            `👤 ${esc(cert.display_value)}\n` +
            (cert.invalid_reason ? `📝 Причина: ${esc(cert.invalid_reason)}\n` : '') +
            `\n👤 Змінив: ${esc(extra.username || '?')}`;
    },

    certificate_blocked(cert, extra) {
        return `🚫 <b>Сертифікат заблоковано</b>\n\n` +
            `🔑 ${cert.cert_code}\n` +
            `👤 ${esc(cert.display_value)}\n` +
            (cert.invalid_reason ? `📝 Причина: ${esc(cert.invalid_reason)}\n` : '') +
            `\n👤 Змінив: ${esc(extra.username || '?')}`;
    }
};

/**
 * Format batch certificate notification for Telegram.
 * @param {Array<string>} codes - Array of cert_code strings
 * @param {object} extra - { username, quantity, typeText, validUntil, season }
 * @returns {string} formatted HTML text
 */
function formatBatchCertificateNotification(codes, extra = {}) {
    const validDate = extra.validUntil ? new Date(extra.validUntil).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' }) : '—';
    let text = `📦 <b>Пакетна видача сертифікатів</b>\n\n`;
    text += `📊 Кількість: ${extra.quantity || codes.length} шт.\n`;
    text += `🏷 Тип: ${extra.typeText || 'на одноразовий вхід'}\n`;
    text += `⏰ Дійсні до: ${validDate}\n`;
    text += `👤 Видав: ${esc(extra.username || '?')}\n\n`;
    text += `🔑 <b>Номери сертифікатів:</b>\n`;
    codes.forEach((code, i) => {
        const prefix = i === codes.length - 1 ? '└' : '├';
        text += `${prefix} <code>${code}</code>\n`;
    });
    return text;
}

function formatCertificateNotification(type, cert, extra = {}) {
    const template = certificateTemplates[type];
    if (!template) return '';
    return template(cert, extra);
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
        text += '\n🎪 <b>АФІША</b>\n';
        for (let i = 0; i < regular.length; i++) {
            const ev = regular[i];
            const endMinutes = timeToMinutes(ev.time) + (ev.duration || 60);
            const endTime = minutesToTime(endMinutes);
            const icon = ev.type === 'regular' ? '🔄' : '🎭';
            const prefix = i === regular.length - 1 && birthdays.length === 0 ? '└' : '├';
            text += `${prefix} ${icon} <code>${ev.time}–${endTime}</code> ${ev.title}`;
            if (ev.duration && ev.duration !== 60) text += ` (${ev.duration}хв)`;
            if (ev.description) text += `\n│   <i>${ev.description}</i>`;
            text += '\n';
        }
    }

    if (birthdays.length > 0) {
        text += '\n🎂 <b>ІМЕНИННИКИ</b>\n';
        for (let i = 0; i < birthdays.length; i++) {
            const ev = birthdays[i];
            const prefix = i === birthdays.length - 1 ? '└' : '├';
            text += `${prefix} 🎉 <b>${ev.title}</b> — 14:00 + 18:00`;
            if (ev.description) text += `\n│   <i>${ev.description}</i>`;
            text += '\n';
        }
    }

    return text;
}

// v19.10: Task notification templates
const taskTemplates = {
    task_assigned(task, extra) {
        const priorityIcon = { high: '🔴', normal: '🟡', low: '🟢' };
        let text = `📋 <b>Призначено задачу</b>\n\n`;
        text += `${priorityIcon[task.priority] || '🟡'} ${esc(task.title)}\n`;
        if (task.date) text += `📅 ${task.date}\n`;
        if (task.description) text += `📝 ${esc(task.description.slice(0, 100))}\n`;
        if (task.deadline) text += `⏰ Дедлайн: ${task.deadline}\n`;
        text += `\n👤 Призначив: ${esc(extra.username || '?')}`;
        return text;
    },

    task_completed(task, extra) {
        let text = `✅ <b>Задачу виконано</b>\n\n`;
        text += `📋 ${esc(task.title)}\n`;
        if (task.date) text += `📅 ${task.date}\n`;
        text += `\n👤 Виконав: ${esc(extra.username || '?')}`;
        return text;
    },

    finance_alert(transaction, extra) {
        const typeIcon = transaction.type === 'income' ? '💰' : '💸';
        const typeText = transaction.type === 'income' ? 'Дохід' : 'Витрата';
        let text = `${typeIcon} <b>Фінансова операція</b>\n\n`;
        text += `📊 ${typeText}: ${transaction.amount} ₴\n`;
        if (transaction.description) text += `📝 ${esc(transaction.description)}\n`;
        text += `📅 ${transaction.date}\n`;
        text += `\n👤 ${esc(extra.username || '?')}`;
        return text;
    }
};

function formatTaskNotification(type, task, extra = {}) {
    const template = taskTemplates[type];
    if (!template) return '';
    return template(task, extra);
}

module.exports = { notificationTemplates, formatBookingNotification, formatAfishaBlock, certificateTemplates, formatCertificateNotification, formatBatchCertificateNotification, taskTemplates, formatTaskNotification, truncate };
