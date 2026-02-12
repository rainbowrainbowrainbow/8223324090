/**
 * services/scheduler.js — Auto-digest, reminder & backup schedulers
 */
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId, scheduleAutoDelete } = require('./telegram');
const { ensureDefaultLines, getKyivDate, getKyivDateStr, getKyivTimeStr, timeToMinutes, minutesToTime } = require('./booking');
const { sendBackupToTelegram } = require('./backup');
const { formatAfishaBlock } = require('./templates');
const { createLogger } = require('../utils/logger');

const log = createLogger('Scheduler');

let digestSentToday = null;
let reminderSentToday = null;
let backupSentToday = null;
let recurringCreatedToday = null;

async function buildAndSendDigest(date) {
    const chatId = await getConfiguredChatId();
    if (!chatId) {
        log.warn('No chat ID configured for digest');
        return { success: false, reason: 'no_chat_id' };
    }

    const bookingsResult = await pool.query("SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time", [date]);
    const bookings = bookingsResult.rows;

    // Fetch afisha events for the same date
    const afishaResult = await pool.query('SELECT * FROM afisha WHERE date = $1 ORDER BY time', [date]);
    const afishaEvents = afishaResult.rows;

    if (bookings.length === 0 && afishaEvents.length === 0) {
        const text = `📅 <b>${date}</b>\n\nНемає бронювань на цей день.`;
        const result = await sendTelegramMessage(chatId, text);
        return { success: result?.ok || false, count: 0 };
    }

    await ensureDefaultLines(date);
    const linesResult = await pool.query('SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id', [date]);
    const lines = linesResult.rows;

    let text = `📅 <b>Розклад на ${date}</b>\n`;
    text += `Всього бронювань: ${bookings.filter(b => !b.linked_to).length}\n\n`;

    for (const line of lines) {
        const lineBookings = bookings.filter(b => b.line_id === line.line_id && !b.linked_to);
        // v7.8.10: Include bookings where this animator is second_animator
        const secondBookings = bookings.filter(b =>
            b.second_animator && b.second_animator === line.name && !b.linked_to && b.line_id !== line.line_id
        );
        if (lineBookings.length === 0 && secondBookings.length === 0) continue;

        text += `👤 <b>${line.name}</b>\n`;
        for (const b of lineBookings) {
            const endTime = minutesToTime(timeToMinutes(b.time) + (b.duration || 0));
            const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
            text += `  ${statusIcon} ${b.time}-${endTime} ${b.label || b.program_code} (${b.room})`;
            if (b.second_animator) text += ` 👥${b.second_animator}`;
            if (b.kids_count) text += ` [${b.kids_count} діт]`;
            text += '\n';
        }
        for (const b of secondBookings) {
            const endTime = minutesToTime(timeToMinutes(b.time) + (b.duration || 0));
            const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
            const mainLine = lines.find(l => l.line_id === b.line_id);
            text += `  ${statusIcon} ${b.time}-${endTime} ${b.label || b.program_code} (${b.room}) 👥2й з ${mainLine?.name || '?'}\n`;
        }
        text += '\n';
    }

    // Append afisha block if there are events
    const afishaBlock = formatAfishaBlock(afishaEvents);
    if (afishaBlock) {
        text += afishaBlock + '\n';
    }

    const result = await sendTelegramMessage(chatId, text, { silent: false });
    log.info(`Digest sent for ${date}: ${result?.ok ? 'OK' : 'FAIL'}`);

    if (result?.ok && result.result?.message_id) {
        await scheduleAutoDelete(chatId, result.result.message_id);
    }

    return { success: result?.ok || false, count: bookings.length };
}

async function sendTomorrowReminder(todayStr) {
    try {
        const [y, m, d] = todayStr.split('-').map(Number);
        const tomorrow = new Date(y, m - 1, d + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        const bookingsResult = await pool.query(
            "SELECT * FROM bookings WHERE date = $1 AND linked_to IS NULL AND status != 'cancelled' ORDER BY time",
            [tomorrowStr]
        );

        // Fetch afisha events for tomorrow
        const afishaResult = await pool.query('SELECT * FROM afisha WHERE date = $1 ORDER BY time', [tomorrowStr]);
        const afishaEvents = afishaResult.rows;

        if (bookingsResult.rows.length === 0 && afishaEvents.length === 0) {
            return { success: true, count: 0, reason: 'no_bookings_tomorrow' };
        }

        const chatId = await getConfiguredChatId();
        if (!chatId) return { success: false, reason: 'no_chat_id' };

        await ensureDefaultLines(tomorrowStr);
        const linesResult = await pool.query('SELECT * FROM lines_by_date WHERE date = $1 ORDER BY line_id', [tomorrowStr]);

        let text = `⏰ <b>Нагадування: завтра ${tomorrowStr}</b>\n`;
        text += `📋 ${bookingsResult.rows.length} бронювань\n\n`;

        for (const line of linesResult.rows) {
            const lineBookings = bookingsResult.rows.filter(b => b.line_id === line.line_id);
            // v7.8.10: Include bookings where this animator is second_animator
            const secondBookings = bookingsResult.rows.filter(b =>
                b.second_animator && b.second_animator === line.name && b.line_id !== line.line_id
            );
            if (lineBookings.length === 0 && secondBookings.length === 0) continue;

            text += `👤 <b>${line.name}</b>\n`;
            for (const b of lineBookings) {
                const endTime = minutesToTime(timeToMinutes(b.time) + (b.duration || 0));
                const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
                text += `  ${statusIcon} ${b.time}-${endTime} ${b.label || b.program_code} (${b.room})`;
                if (b.second_animator) text += ` 👥${b.second_animator}`;
                if (b.kids_count) text += ` [${b.kids_count} діт]`;
                text += '\n';
            }
            for (const b of secondBookings) {
                const endTime = minutesToTime(timeToMinutes(b.time) + (b.duration || 0));
                const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
                const mainLine = linesResult.rows.find(l => l.line_id === b.line_id);
                text += `  ${statusIcon} ${b.time}-${endTime} ${b.label || b.program_code} (${b.room}) 👥2й з ${mainLine?.name || '?'}\n`;
            }
            text += '\n';
        }

        // Append afisha block if there are events
        const afishaBlock = formatAfishaBlock(afishaEvents);
        if (afishaBlock) {
            text += afishaBlock + '\n';
        }

        const sendResult = await sendTelegramMessage(chatId, text, { silent: false });
        log.info(`Tomorrow reminder sent for ${tomorrowStr}`);

        if (sendResult?.ok && sendResult.result?.message_id) {
            await scheduleAutoDelete(chatId, sendResult.result.message_id);
        }

        return { success: sendResult?.ok || false, count: bookingsResult.rows.length };
    } catch (err) {
        log.error(`Reminder error: ${err.message}`);
        return { success: false, error: err.message };
    }
}

async function checkAutoDigest() {
    try {
        const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('digest_time', 'digest_time_weekday', 'digest_time_weekend')");
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = r.value; });

        const kyiv = getKyivDate();
        const isWeekend = kyiv.getDay() === 0 || kyiv.getDay() === 6;

        const digestTime = isWeekend
            ? (settings.digest_time_weekend || settings.digest_time)
            : (settings.digest_time_weekday || settings.digest_time);

        if (!digestTime || !/^\d{2}:\d{2}$/.test(digestTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (nowTime === digestTime && digestSentToday !== todayStr) {
            digestSentToday = todayStr;
            log.info(`Sending daily digest for ${todayStr} at ${digestTime} (${isWeekend ? 'weekend' : 'weekday'})`);
            await buildAndSendDigest(todayStr);
        }
    } catch (err) {
        log.error('AutoDigest error', err);
    }
}

async function checkAutoReminder() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'reminder_time'");
        const reminderTime = result.rows[0]?.value;
        if (!reminderTime || !/^\d{2}:\d{2}$/.test(reminderTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (nowTime === reminderTime && reminderSentToday !== todayStr) {
            reminderSentToday = todayStr;
            log.info(`Sending tomorrow reminder at ${reminderTime}`);
            await sendTomorrowReminder(todayStr);
        }
    } catch (err) {
        log.error('AutoReminder error', err);
    }
}

async function checkAutoBackup() {
    try {
        const result = await pool.query("SELECT value FROM settings WHERE key = 'backup_time'");
        const backupTime = result.rows[0]?.value || '03:00';
        if (!/^\d{2}:\d{2}$/.test(backupTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (nowTime === backupTime && backupSentToday !== todayStr) {
            backupSentToday = todayStr;
            log.info(`Running daily backup at ${backupTime}`);
            await sendBackupToTelegram();
        }
    } catch (err) {
        log.error('AutoBackup error', err);
    }
}

// v7.8: Auto-create recurring tasks from templates
async function checkRecurringTasks() {
    try {
        const todayStr = getKyivDateStr();
        if (recurringCreatedToday === todayStr) return;

        const kyiv = getKyivDate();
        const nowTime = getKyivTimeStr();
        // Run at 00:05 Kyiv time
        if (nowTime !== '00:05') return;

        recurringCreatedToday = todayStr;
        const dayOfWeek = kyiv.getDay() || 7; // 1=Mon...7=Sun

        const templates = await pool.query('SELECT * FROM task_templates WHERE is_active = true');
        let created = 0;

        for (const tpl of templates.rows) {
            let shouldCreate = false;

            switch (tpl.recurrence_pattern) {
                case 'daily':
                    shouldCreate = true;
                    break;
                case 'weekdays':
                    shouldCreate = dayOfWeek <= 5;
                    break;
                case 'weekly':
                    shouldCreate = dayOfWeek === 1; // Monday
                    break;
                case 'custom':
                    if (tpl.recurrence_days) {
                        const days = tpl.recurrence_days.split(',').map(d => parseInt(d.trim()));
                        shouldCreate = days.includes(dayOfWeek);
                    }
                    break;
            }

            if (!shouldCreate) continue;

            // Dedup: skip if task with this template_id already exists for today
            const existing = await pool.query(
                'SELECT id FROM tasks WHERE template_id = $1 AND date = $2',
                [tpl.id, todayStr]
            );
            if (existing.rows.length > 0) continue;

            await pool.query(
                `INSERT INTO tasks (title, description, date, priority, assigned_to, created_by, type, template_id, category)
                 VALUES ($1, $2, $3, $4, $5, 'system', 'recurring', $6, $7)`,
                [tpl.title, tpl.description, todayStr, tpl.priority, tpl.assigned_to, tpl.id, tpl.category || 'admin']
            );
            created++;
        }

        if (created > 0) {
            log.info(`Recurring tasks created: ${created} for ${todayStr}`);
        }
    } catch (err) {
        log.error('RecurringTasks error', err);
    }
}

module.exports = {
    buildAndSendDigest, sendTomorrowReminder,
    checkAutoDigest, checkAutoReminder, checkAutoBackup, checkRecurringTasks
};
