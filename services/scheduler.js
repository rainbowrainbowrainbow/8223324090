/**
 * services/scheduler.js — Auto-digest, reminder & backup schedulers
 */
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId, scheduleAutoDelete } = require('./telegram');
const { ensureDefaultLines, getKyivDate, getKyivDateStr, getKyivTimeStr } = require('./booking');
const { sendBackupToTelegram } = require('./backup');
const { createLogger } = require('../utils/logger');

const log = createLogger('Scheduler');

let digestSentToday = null;
let reminderSentToday = null;
let backupSentToday = null;

async function buildAndSendDigest(date) {
    const chatId = await getConfiguredChatId();
    if (!chatId) {
        log.warn('No chat ID configured for digest');
        return { success: false, reason: 'no_chat_id' };
    }

    const bookingsResult = await pool.query("SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time", [date]);
    const bookings = bookingsResult.rows;

    if (bookings.length === 0) {
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
        if (lineBookings.length === 0) continue;

        text += `👤 <b>${line.name}</b>\n`;
        for (const b of lineBookings) {
            const endMin = parseInt(b.time.split(':')[0]) * 60 + parseInt(b.time.split(':')[1]) + (b.duration || 0);
            const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
            const endM = String(endMin % 60).padStart(2, '0');
            const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
            text += `  ${statusIcon} ${b.time}-${endH}:${endM} ${b.label || b.program_code} (${b.room})`;
            if (b.kids_count) text += ` [${b.kids_count} діт]`;
            text += '\n';
        }
        text += '\n';
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
        if (bookingsResult.rows.length === 0) {
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
            if (lineBookings.length === 0) continue;

            text += `👤 <b>${line.name}</b>\n`;
            for (const b of lineBookings) {
                const endMin = parseInt(b.time.split(':')[0]) * 60 + parseInt(b.time.split(':')[1]) + (b.duration || 0);
                const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
                const endM = String(endMin % 60).padStart(2, '0');
                const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';
                text += `  ${statusIcon} ${b.time}-${endH}:${endM} ${b.label || b.program_code} (${b.room})`;
                if (b.kids_count) text += ` [${b.kids_count} діт]`;
                text += '\n';
            }
            text += '\n';
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

module.exports = {
    buildAndSendDigest, sendTomorrowReminder,
    checkAutoDigest, checkAutoReminder, checkAutoBackup
};
