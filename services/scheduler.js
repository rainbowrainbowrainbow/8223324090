/**
 * services/scheduler.js — Auto-digest, reminder & backup schedulers
 *
 * LLM HINT: Scheduler runs on 60-second intervals (setInterval in server.js).
 * "Sent today" flags are persisted in the `settings` table to survive restarts.
 * Auto-delete of Telegram messages uses `scheduled_deletions` table (not setTimeout).
 * All times are in Europe/Kyiv timezone (getKyivTimeStr returns "HH:MM").
 */
const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId, telegramRequest, scheduleAutoDelete } = require('./telegram');
const { ensureDefaultLines, getKyivDate, getKyivDateStr, getKyivTimeStr, timeToMinutes, minutesToTime } = require('./booking');
const { sendBackupToTelegram } = require('./backup');
const { formatAfishaBlock } = require('./templates');
const { createLogger } = require('../utils/logger');

const log = createLogger('Scheduler');

// In-memory cache (fallback — DB is source of truth via getLastSent/setLastSent)
let digestSentToday = null;
let reminderSentToday = null;
let backupSentToday = null;
let recurringCreatedToday = null;

// DB-persistent sent-today helpers (survive restarts)
async function getLastSent(key) {
    try {
        const r = await pool.query("SELECT value FROM settings WHERE key = $1", [`last_${key}`]);
        return r.rows[0]?.value || null;
    } catch { return null; }
}
async function setLastSent(key, dateStr) {
    try {
        await pool.query(
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
            [`last_${key}`, dateStr]
        );
    } catch (err) { log.error(`setLastSent(${key}) error`, err); }
}

async function buildAndSendDigest(date) {
    const chatId = await getConfiguredChatId();
    if (!chatId) {
        log.warn('No chat ID configured for digest');
        return { success: false, reason: 'no_chat_id' };
    }

    // v8.1: Ensure recurring afisha templates applied before building digest
    try { await ensureRecurringAfishaForDate(date); } catch (e) { /* non-blocking */ }

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
    const linesResult = await pool.query('SELECT * FROM lines_by_date WHERE date = $1 ORDER BY id', [date]);
    const lines = linesResult.rows;

    // v8.1: Redesigned digest format with tree structure
    const mainCount = bookings.filter(b => !b.linked_to).length;
    const [y, m, d] = date.split('-');
    const dateFormatted = `${d}.${m}.${y}`;

    let text = `━━━━━━━━━━━━━━━━━\n`;
    text += `📊 <b>РОЗКЛАД НА ${dateFormatted}</b>\n`;
    text += `━━━━━━━━━━━━━━━━━\n`;
    text += `📋 Бронювань: <b>${mainCount}</b>`;
    if (afishaEvents.length > 0) text += ` │ 🎪 Афіша: <b>${afishaEvents.length}</b>`;
    text += '\n\n';

    // Count total kids across all bookings
    const totalKids = bookings.reduce((sum, b) => sum + (b.kids_count || 0), 0);

    for (const line of lines) {
        const lineBookings = bookings.filter(b => b.line_id === line.line_id && !b.linked_to);
        const secondBookings = bookings.filter(b =>
            b.second_animator && b.second_animator === line.name && !b.linked_to && b.line_id !== line.line_id
        );
        const linkedOnLine = bookings.filter(b => b.line_id === line.line_id && b.linked_to);
        const extraLinked = linkedOnLine.filter(lb =>
            !secondBookings.some(sb => sb.id === lb.linked_to)
        );
        if (lineBookings.length === 0 && secondBookings.length === 0 && extraLinked.length === 0) continue;

        const allItems = [...lineBookings, ...secondBookings, ...extraLinked];
        const lineKids = lineBookings.reduce((sum, b) => sum + (b.kids_count || 0), 0);

        text += `🎭 <b>${line.name}</b>`;
        if (lineKids > 0) text += ` · 👶 ${lineKids}`;
        text += '\n';

        for (let i = 0; i < allItems.length; i++) {
            const b = allItems[i];
            const isLast = i === allItems.length - 1;
            const prefix = isLast ? '└' : '├';
            const endTime = minutesToTime(timeToMinutes(b.time) + (b.duration || 0));
            const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';

            if (secondBookings.includes(b)) {
                const mainLine = lines.find(l => l.line_id === b.line_id);
                text += `${prefix} ${statusIcon} <code>${b.time}–${endTime}</code> ${b.label || b.program_code} (${b.room}) 👥2й з ${mainLine?.name || '?'}\n`;
            } else if (extraLinked.includes(b)) {
                const mainBooking = bookings.find(mb => mb.id === b.linked_to);
                const mainLine = mainBooking ? lines.find(l => l.line_id === mainBooking.line_id) : null;
                text += `${prefix} ${statusIcon} <code>${b.time}–${endTime}</code> ${b.label || b.program_code} (${b.room || mainBooking?.room || '?'}) 👥2й з ${mainLine?.name || '?'}\n`;
            } else {
                text += `${prefix} ${statusIcon} <code>${b.time}–${endTime}</code> ${b.label || b.program_code} (${b.room})`;
                if (b.second_animator) {
                    const linkedBk = bookings.find(lb => lb.linked_to === b.id && lb.line_id !== b.line_id);
                    const resolvedName = linkedBk ? (lines.find(l => l.line_id === linkedBk.line_id)?.name || b.second_animator) : b.second_animator;
                    text += ` 👥${resolvedName}`;
                }
                if (b.kids_count) text += ` [${b.kids_count} діт]`;
                text += '\n';
            }
        }
        text += '\n';
    }

    // Append afisha block if there are events
    const afishaBlock = formatAfishaBlock(afishaEvents);
    if (afishaBlock) {
        text += afishaBlock + '\n';
    }

    if (totalKids > 0) {
        text += `\n👶 <b>Всього дітей: ${totalKids}</b>\n`;
    }
    text += `━━━━━━━━━━━━━━━━━`;

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

        // v7.9.3: Fetch ALL bookings including linked (for second animator display)
        const bookingsResult = await pool.query(
            "SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time",
            [tomorrowStr]
        );
        const mainBookingsCount = bookingsResult.rows.filter(b => !b.linked_to).length;

        // Fetch afisha events for tomorrow
        const afishaResult = await pool.query('SELECT * FROM afisha WHERE date = $1 ORDER BY time', [tomorrowStr]);
        const afishaEvents = afishaResult.rows;

        if (mainBookingsCount === 0 && afishaEvents.length === 0) {
            return { success: true, count: 0, reason: 'no_bookings_tomorrow' };
        }

        const chatId = await getConfiguredChatId();
        if (!chatId) return { success: false, reason: 'no_chat_id' };

        // v8.1: Ensure recurring afisha for tomorrow
        try { await ensureRecurringAfishaForDate(tomorrowStr); } catch (e) { /* non-blocking */ }
        // Re-fetch after ensuring recurring
        const afishaResult2 = await pool.query('SELECT * FROM afisha WHERE date = $1 ORDER BY time', [tomorrowStr]);
        const afishaFinal = afishaResult2.rows;

        await ensureDefaultLines(tomorrowStr);
        const linesResult = await pool.query('SELECT * FROM lines_by_date WHERE date = $1 ORDER BY id', [tomorrowStr]);
        const lines = linesResult.rows;
        const bookings = bookingsResult.rows;

        const [yt, mt, dt] = tomorrowStr.split('-');
        const dateFormatted = `${dt}.${mt}.${yt}`;

        let text = `━━━━━━━━━━━━━━━━━\n`;
        text += `⏰ <b>ЗАВТРА ${dateFormatted}</b>\n`;
        text += `━━━━━━━━━━━━━━━━━\n`;
        text += `📋 Бронювань: <b>${mainBookingsCount}</b>`;
        if (afishaFinal.length > 0) text += ` │ 🎪 Афіша: <b>${afishaFinal.length}</b>`;
        text += '\n\n';

        const totalKids = bookings.reduce((sum, b) => sum + (b.kids_count || 0), 0);

        for (const line of lines) {
            const lineBookings = bookings.filter(b => b.line_id === line.line_id && !b.linked_to);
            const secondBookings = bookings.filter(b =>
                b.second_animator && b.second_animator === line.name && !b.linked_to && b.line_id !== line.line_id
            );
            const linkedOnLine = bookings.filter(b => b.line_id === line.line_id && b.linked_to);
            const extraLinked = linkedOnLine.filter(lb =>
                !secondBookings.some(sb => sb.id === lb.linked_to)
            );
            if (lineBookings.length === 0 && secondBookings.length === 0 && extraLinked.length === 0) continue;

            const allItems = [...lineBookings, ...secondBookings, ...extraLinked];
            const lineKids = lineBookings.reduce((sum, b) => sum + (b.kids_count || 0), 0);

            text += `🎭 <b>${line.name}</b>`;
            if (lineKids > 0) text += ` · 👶 ${lineKids}`;
            text += '\n';

            for (let i = 0; i < allItems.length; i++) {
                const b = allItems[i];
                const isLast = i === allItems.length - 1;
                const prefix = isLast ? '└' : '├';
                const endTime = minutesToTime(timeToMinutes(b.time) + (b.duration || 0));
                const statusIcon = b.status === 'preliminary' ? '⏳' : '✅';

                if (secondBookings.includes(b)) {
                    const mainLine = lines.find(l => l.line_id === b.line_id);
                    text += `${prefix} ${statusIcon} <code>${b.time}–${endTime}</code> ${b.label || b.program_code} (${b.room}) 👥2й з ${mainLine?.name || '?'}\n`;
                } else if (extraLinked.includes(b)) {
                    const mainBooking = bookings.find(mb => mb.id === b.linked_to);
                    const mainLine = mainBooking ? lines.find(l => l.line_id === mainBooking.line_id) : null;
                    text += `${prefix} ${statusIcon} <code>${b.time}–${endTime}</code> ${b.label || b.program_code} (${b.room || mainBooking?.room || '?'}) 👥2й з ${mainLine?.name || '?'}\n`;
                } else {
                    text += `${prefix} ${statusIcon} <code>${b.time}–${endTime}</code> ${b.label || b.program_code} (${b.room})`;
                    if (b.second_animator) {
                        const linkedBk = bookings.find(lb => lb.linked_to === b.id && lb.line_id !== b.line_id);
                        const resolvedName = linkedBk ? (lines.find(l => l.line_id === linkedBk.line_id)?.name || b.second_animator) : b.second_animator;
                        text += ` 👥${resolvedName}`;
                    }
                    if (b.kids_count) text += ` [${b.kids_count} діт]`;
                    text += '\n';
                }
            }
            text += '\n';
        }

        const afishaBlock = formatAfishaBlock(afishaFinal);
        if (afishaBlock) {
            text += afishaBlock + '\n';
        }

        if (totalKids > 0) {
            text += `\n👶 <b>Всього дітей: ${totalKids}</b>\n`;
        }
        text += `━━━━━━━━━━━━━━━━━`;

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

        // Check in-memory first, then DB (survives restarts)
        if (digestSentToday === todayStr) return;
        if (nowTime !== digestTime) return;
        const dbLast = await getLastSent('digest');
        if (dbLast === todayStr) { digestSentToday = todayStr; return; }

        digestSentToday = todayStr;
        await setLastSent('digest', todayStr);
        log.info(`Sending daily digest for ${todayStr} at ${digestTime} (${isWeekend ? 'weekend' : 'weekday'})`);
        await buildAndSendDigest(todayStr);
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

        if (reminderSentToday === todayStr) return;
        if (nowTime !== reminderTime) return;
        const dbLast = await getLastSent('reminder');
        if (dbLast === todayStr) { reminderSentToday = todayStr; return; }

        reminderSentToday = todayStr;
        await setLastSent('reminder', todayStr);
        log.info(`Sending tomorrow reminder at ${reminderTime}`);
        await sendTomorrowReminder(todayStr);
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

        if (backupSentToday === todayStr) return;
        if (nowTime !== backupTime) return;
        const dbLast = await getLastSent('backup');
        if (dbLast === todayStr) { backupSentToday = todayStr; return; }

        backupSentToday = todayStr;
        await setLastSent('backup', todayStr);
        log.info(`Running daily backup at ${backupTime}`);
        await sendBackupToTelegram();
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

        const dbLast = await getLastSent('recurring');
        if (dbLast === todayStr) { recurringCreatedToday = todayStr; return; }

        recurringCreatedToday = todayStr;
        await setLastSent('recurring', todayStr);
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

// v7.10: DB-based auto-delete (replaces setTimeout in telegram.js)
// LLM HINT: scheduled_deletions table stores Telegram messages to be deleted after N hours.
// checkScheduledDeletions() runs every 60s via setInterval in server.js.
async function checkScheduledDeletions() {
    try {
        const now = new Date().toISOString();
        const result = await pool.query(
            "SELECT id, chat_id, message_id FROM scheduled_deletions WHERE delete_at <= $1 LIMIT 10",
            [now]
        );
        for (const row of result.rows) {
            try {
                await telegramRequest('deleteMessage', {
                    chat_id: row.chat_id,
                    message_id: row.message_id
                });
                log.info(`AutoDelete: deleted message ${row.message_id}`);
            } catch (err) {
                log.error(`AutoDelete: failed message ${row.message_id}: ${err.message}`);
            }
            await pool.query("DELETE FROM scheduled_deletions WHERE id = $1", [row.id]);
        }
    } catch (err) {
        // Table may not exist yet on first run — ignore silently
        if (!err.message.includes('does not exist')) {
            log.error('checkScheduledDeletions error', err);
        }
    }
}

// v8.0: Auto-create recurring afisha from templates
let afishaRecurringCreatedToday = null;

/**
 * v8.1: Ensure all recurring afisha templates are applied for a given date.
 * Reusable by both scheduler (00:06) and digest (before sending).
 * v8.3: In-memory cache (5 min TTL) prevents N+1 queries on every GET /afisha/:date.
 * Returns number of created events.
 */
const _ensureCache = {};
const ENSURE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function ensureRecurringAfishaForDate(dateStr) {
    const now = Date.now();
    if (_ensureCache[dateStr] && (now - _ensureCache[dateStr]) < ENSURE_CACHE_TTL) return 0;
    _ensureCache[dateStr] = now;
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dayOfWeek = dateObj.getDay() || 7; // 1=Mon...7=Sun

    const templates = await pool.query('SELECT * FROM afisha_templates WHERE is_active = true');
    let created = 0;

    for (const tpl of templates.rows) {
        if (tpl.date_from && dateStr < tpl.date_from) continue;
        if (tpl.date_to && dateStr > tpl.date_to) continue;

        let shouldCreate = false;
        switch (tpl.recurrence_pattern) {
            case 'daily': shouldCreate = true; break;
            case 'weekdays': shouldCreate = dayOfWeek <= 5; break;
            case 'weekends': shouldCreate = dayOfWeek >= 6; break;
            case 'weekly': shouldCreate = dayOfWeek === 6; break;
            case 'custom':
                if (tpl.recurrence_days) {
                    shouldCreate = tpl.recurrence_days.split(',').map(d => parseInt(d.trim())).includes(dayOfWeek);
                }
                break;
        }
        if (!shouldCreate) continue;

        const existing = await pool.query(
            'SELECT id FROM afisha WHERE template_id = $1 AND date = $2',
            [tpl.id, dateStr]
        );
        if (existing.rows.length > 0) continue;

        await pool.query(
            `INSERT INTO afisha (date, time, title, duration, type, description, template_id, original_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [dateStr, tpl.time, tpl.title, tpl.duration, tpl.type, tpl.description, tpl.id, tpl.time]
        );
        created++;
    }
    return created;
}

async function checkRecurringAfisha() {
    try {
        const todayStr = getKyivDateStr();
        if (afishaRecurringCreatedToday === todayStr) return;

        const nowTime = getKyivTimeStr();
        // Run at 00:06 Kyiv time (1 min after recurring tasks)
        if (nowTime !== '00:06') return;

        const dbLast = await getLastSent('recurring_afisha');
        if (dbLast === todayStr) { afishaRecurringCreatedToday = todayStr; return; }

        afishaRecurringCreatedToday = todayStr;
        await setLastSent('recurring_afisha', todayStr);

        const created = await ensureRecurringAfishaForDate(todayStr);
        if (created > 0) {
            log.info(`Recurring afisha created: ${created} for ${todayStr}`);
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('RecurringAfisha error', err);
        }
    }
}

module.exports = {
    buildAndSendDigest, sendTomorrowReminder,
    checkAutoDigest, checkAutoReminder, checkAutoBackup, checkRecurringTasks,
    checkScheduledDeletions, checkRecurringAfisha, ensureRecurringAfishaForDate
};
