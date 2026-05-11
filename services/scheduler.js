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

// Lazy require to avoid circular dependency at load time
function getRecurringService() {
    return require('./recurring');
}

const log = createLogger('Scheduler');

// Lazy require to avoid circular dependency (routes/afisha → services/scheduler → routes/afisha)
function getDistributeAfisha() {
    return require('../routes/afisha').distributeAfishaForDate;
}

// In-memory cache (fallback — DB is source of truth via getLastSent/setLastSent)
let digestSentToday = null;
let reminderSentToday = null;
let backupSentToday = null;
let recurringCreatedToday = null;
let recurringBookingsCreatedToday = null;

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
    try { await ensureRecurringAfishaForDate(date); } catch (e) { log.warn(`Recurring afisha setup failed for ${date}`, e.message); }

    // Auto-distribute afisha events to animators before building digest
    try { await getDistributeAfisha()(date); } catch (e) { log.warn('Auto-distribute before digest skipped', e.message); }

    const bookingsResult = await pool.query(
        `SELECT id, date, time, duration, line_id, program_name, program_code, label, category, price,
                hosts, second_animator, pinata_filler, costume, room, notes, linked_to, status, kids_count, group_name
         FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time LIMIT 500`, [date]);
    const bookings = bookingsResult.rows;

    // Fetch afisha events for the same date
    const afishaResult = await pool.query(
        `SELECT id, date, time, duration, title, description, type, line_id, template_id, original_time
         FROM afisha WHERE date = $1 ORDER BY time LIMIT 200`, [date]);
    const afishaEvents = afishaResult.rows;

    if (bookings.length === 0 && afishaEvents.length === 0) {
        const text = `📅 <b>${date}</b>\n\nНемає бронювань на цей день.`;
        const result = await sendTelegramMessage(chatId, text);
        return { success: result?.ok || false, count: 0, reason: result?.ok ? undefined : (result?.description || 'send_failed') };
    }

    await ensureDefaultLines(date);
    const linesResult = await pool.query('SELECT id, date, line_id, name, color FROM lines_by_date WHERE date = $1 ORDER BY id LIMIT 100', [date]);
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

    return { success: result?.ok || false, count: bookings.length, reason: result?.ok ? undefined : (result?.description || 'send_failed') };
}

async function sendTomorrowReminder(todayStr) {
    try {
        const [y, m, d] = todayStr.split('-').map(Number);
        const tomorrow = new Date(y, m - 1, d + 1);
        const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

        // v7.9.3: Fetch ALL bookings including linked (for second animator display)
        const bookingsResult = await pool.query(
            `SELECT id, date, time, duration, line_id, program_name, program_code, label, category, price,
                    hosts, second_animator, pinata_filler, costume, room, notes, linked_to, status, kids_count, group_name
             FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time LIMIT 500`,
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
        try { await ensureRecurringAfishaForDate(tomorrowStr); } catch (e) { log.warn(`Recurring afisha setup failed for ${tomorrowStr}`, e.message); }
        // Auto-distribute afisha events to animators before reminder
        try { await getDistributeAfisha()(tomorrowStr); } catch (e) { log.warn('Auto-distribute before reminder skipped', e.message); }
        // Re-fetch after ensuring recurring + distribution
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
        const backupResult = await sendBackupToTelegram();

        // v17.10.0: Alert on backup failure
        if (!backupResult || !backupResult.success) {
            const reason = backupResult?.reason || backupResult?.error || 'unknown';
            log.error(`Backup FAILED: ${reason}`);
            const chatId = await getConfiguredChatId();
            if (chatId) {
                await sendTelegramMessage(chatId,
                    `🚨 <b>БЕКАП НЕ ВДАВСЯ</b>\n\n` +
                    `📅 Дата: ${todayStr}\n` +
                    `⏰ Час: ${backupTime}\n` +
                    `❌ Причина: ${reason}\n\n` +
                    `Перевірте: GET /api/backup/verify`
                );
            }
        }
    } catch (err) {
        log.error('AutoBackup error', err);
        // v17.10.0: Alert on unhandled backup error
        try {
            const chatId = await getConfiguredChatId();
            if (chatId) {
                await sendTelegramMessage(chatId,
                    `🚨 <b>БЕКАП — КРИТИЧНА ПОМИЛКА</b>\n\n❌ ${err.message}`
                );
            }
        } catch { /* prevent infinite loop */ }
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

            // Atomic dedup: INSERT ON CONFLICT prevents race conditions
            const insertResult = await pool.query(
                `INSERT INTO tasks (title, description, date, priority, assigned_to, created_by, type, template_id, category)
                 VALUES ($1, $2, $3, $4, $5, 'system', 'recurring', $6, $7)
                 ON CONFLICT (template_id, date) WHERE template_id IS NOT NULL DO NOTHING
                 RETURNING id`,
                [tpl.title, tpl.description, todayStr, tpl.priority, tpl.assigned_to, tpl.id, tpl.category || 'admin']
            );
            if (insertResult.rows.length === 0) continue;
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

        // Atomic dedup: INSERT ON CONFLICT prevents race conditions
        const insertResult = await pool.query(
            `INSERT INTO afisha (date, time, title, duration, type, description, template_id, original_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (template_id, date) WHERE template_id IS NOT NULL DO NOTHING
             RETURNING id`,
            [dateStr, tpl.time, tpl.title, tpl.duration, tpl.type, tpl.description, tpl.id, tpl.time]
        );
        if (insertResult.rows.length > 0) created++;
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

// v11: Auto-generate recurring bookings from templates
// Runs at 00:07 Kyiv time (after recurring tasks at 00:05, recurring afisha at 00:06)
async function checkRecurringBookings() {
    try {
        const todayStr = getKyivDateStr();
        if (recurringBookingsCreatedToday === todayStr) return;

        const nowTime = getKyivTimeStr();
        if (nowTime !== '00:07') return;

        const dbLast = await getLastSent('recurring_bookings');
        if (dbLast === todayStr) { recurringBookingsCreatedToday = todayStr; return; }

        recurringBookingsCreatedToday = todayStr;
        await setLastSent('recurring_bookings', todayStr);

        const { generateAllRecurringBookings } = getRecurringService();
        const result = await generateAllRecurringBookings();

        if (result.totalCreated > 0 || result.totalSkipped > 0) {
            log.info(`Recurring bookings: created=${result.totalCreated}, skipped=${result.totalSkipped}`);
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('RecurringBookings error', err);
        }
    }
}

// v8.4: Auto-expire certificates past valid_until
let certExpireCheckedToday = '';
async function checkCertificateExpiry() {
    try {
        const todayStr = getKyivDateStr();
        if (certExpireCheckedToday === todayStr) return;

        const nowTime = getKyivTimeStr();
        // Run at 00:10 Kyiv time
        if (nowTime !== '00:10') return;

        certExpireCheckedToday = todayStr;

        const result = await pool.query(
            `UPDATE certificates SET status = 'expired', updated_at = NOW()
             WHERE status = 'active' AND valid_until < $1
             RETURNING cert_code, display_value`,
            [todayStr]
        );

        if (result.rowCount > 0) {
            log.info(`Certificates auto-expired: ${result.rowCount} (${result.rows.map(r => r.cert_code).join(', ')})`);
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('CertExpiry error', err);
        }
    }
}

// v10.0: Kleshnya task reminders — runs every minute
async function checkTaskReminders() {
    try {
        const { processReminders } = require('./kleshnya');
        await processReminders();
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('TaskReminders error', err);
        }
    }
}

// v10.0: Work day triggers — checks at configured start time (10:00 weekdays, 12:00 weekends)
let workDayTriggeredToday = null;

async function checkWorkDayTriggers() {
    try {
        const todayStr = getKyivDateStr();
        if (workDayTriggeredToday === todayStr) return;

        const kyiv = getKyivDate();
        const isWeekend = kyiv.getDay() === 0 || kyiv.getDay() === 6;
        const triggerTime = isWeekend ? '10:00' : '12:00';

        const nowTime = getKyivTimeStr();
        if (nowTime !== triggerTime) return;

        const dbLast = await getLastSent('workday_trigger');
        if (dbLast === todayStr) { workDayTriggeredToday = todayStr; return; }

        workDayTriggeredToday = todayStr;
        await setLastSent('workday_trigger', todayStr);
        log.info(`Work day triggers fired for ${todayStr} at ${triggerTime} (${isWeekend ? 'weekend' : 'weekday'})`);

        // Check pinata bookings for today that need print confirmation
        const pinataBookings = await pool.query(
            `SELECT b.*, p.has_filler FROM bookings b
             JOIN products p ON b.program_id = p.id
             WHERE b.date = $1 AND p.has_filler = true AND b.status != 'cancelled'`,
            [todayStr]
        );

        const { createTask } = require('./kleshnya');

        for (const booking of pinataBookings.rows) {
            // Check if task already exists for this booking
            const existingTask = await pool.query(
                "SELECT id FROM tasks WHERE source_type = 'booking' AND source_id = $1 AND date = $2 AND title LIKE '%піньят%'",
                [booking.id, todayStr]
            );
            if (existingTask.rows.length > 0) continue;

            // Create pinata confirmation task
            const deadline = new Date(`${todayStr}T${isWeekend ? '12:00' : '14:00'}:00`);
            await createTask({
                title: `🪅 Підтвердити друк піньяти №${booking.pinata_filler || '?'} на ${booking.time}`,
                description: `Бронювання: ${booking.label || booking.program_code}, кімната: ${booking.room}`,
                date: todayStr,
                priority: 'high',
                task_type: 'human',
                deadline: deadline.toISOString(),
                source_type: 'booking',
                source_id: booking.id,
                category: 'purchase',
                created_by: 'kleshnya'
            });
        }

        // Check for bookings with unclarified data (t-shirt sizes etc)
        const tshirtBookings = await pool.query(
            `SELECT b.* FROM bookings b
             WHERE b.date = $1 AND b.program_id = 'mk_tshirt' AND b.status != 'cancelled'
             AND (b.extra_data IS NULL OR b.extra_data->>'tshirtSizes' IS NULL)`,
            [todayStr]
        );

        for (const booking of tshirtBookings.rows) {
            const existingTask = await pool.query(
                "SELECT id FROM tasks WHERE source_type = 'booking' AND source_id = $1 AND date = $2 AND title LIKE '%футболок%'",
                [booking.id, todayStr]
            );
            if (existingTask.rows.length > 0) continue;

            await createTask({
                title: `👕 Уточнити розміри футболок для ${booking.group_name || booking.label || 'бронювання'} на ${booking.time}`,
                date: todayStr,
                priority: 'high',
                task_type: 'human',
                source_type: 'booking',
                source_id: booking.id,
                category: 'admin',
                created_by: 'kleshnya'
            });
        }

        // Send task digest for today
        const todayTasks = await pool.query(
            "SELECT * FROM tasks WHERE date = $1 AND status != 'done' ORDER BY priority DESC, created_at",
            [todayStr]
        );

        if (todayTasks.rows.length > 0) {
            const chatId = await getConfiguredChatId();
            if (chatId) {
                let text = `🦀 <b>Клешня — Задачі на сьогодні</b>\n`;
                text += `📅 ${todayStr} | Задач: <b>${todayTasks.rows.length}</b>\n\n`;

                const priorityIcon = { high: '🔴', normal: '⚪', low: '🔵' };
                const statusIcon = { todo: '⬜', in_progress: '🔄', done: '✅' };

                for (let i = 0; i < todayTasks.rows.length; i++) {
                    const t = todayTasks.rows[i];
                    const isLast = i === todayTasks.rows.length - 1;
                    const prefix = isLast ? '└' : '├';
                    const pIcon = priorityIcon[t.priority] || '';
                    const sIcon = statusIcon[t.status] || '?';
                    text += `${prefix} ${sIcon}${pIcon} #${t.id} ${t.title}`;
                    if (t.assigned_to) text += ` → ${t.assigned_to}`;
                    text += '\n';
                }

                text += `\n🦀 Клешня тримає все під контролем`;
                await sendTelegramMessage(chatId, text, { silent: false });
            }
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('WorkDayTriggers error', err);
        }
    }
}

// v10.0: Monthly points reset — runs on 1st of each month at 00:15
let monthlyResetDone = null;

async function checkMonthlyPointsReset() {
    try {
        const kyiv = getKyivDate();
        if (kyiv.getDate() !== 1) return;

        const todayStr = getKyivDateStr();
        if (monthlyResetDone === todayStr) return;

        const nowTime = getKyivTimeStr();
        if (nowTime !== '00:15') return;

        const dbLast = await getLastSent('monthly_reset');
        if (dbLast === todayStr) { monthlyResetDone = todayStr; return; }

        monthlyResetDone = todayStr;
        await setLastSent('monthly_reset', todayStr);

        const { resetMonthlyPoints } = require('./kleshnya');
        await resetMonthlyPoints();
        log.info('Monthly points reset completed');
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('MonthlyPointsReset error', err);
        }
    }
}

// v11.1: Auto-update user streaks — runs at 23:55 Kyiv time
// Checks which users were active today (logged in / performed actions) and updates their streak
let streaksUpdatedToday = null;

async function checkStreakUpdates() {
    try {
        const todayStr = getKyivDateStr();
        if (streaksUpdatedToday === todayStr) return;

        const nowTime = getKyivTimeStr();
        if (nowTime !== '23:55') return;

        const dbLast = await getLastSent('streak_update');
        if (dbLast === todayStr) { streaksUpdatedToday = todayStr; return; }

        streaksUpdatedToday = todayStr;
        await setLastSent('streak_update', todayStr);

        // Find users active today: completed tasks, created bookings, or logged in (settings activity)
        const activeUsers = await pool.query(`
            SELECT DISTINCT username FROM (
                SELECT actor AS username FROM task_logs WHERE DATE(created_at) = $1 AND actor NOT IN ('system', 'kleshnya', 'telegram')
                UNION
                SELECT created_by AS username FROM bookings WHERE DATE(created_at) = $1 AND created_by IS NOT NULL
                UNION
                SELECT username FROM kleshnya_chat WHERE DATE(created_at) = $1
            ) AS active WHERE username IS NOT NULL
        `, [todayStr]);

        let updated = 0;
        for (const row of activeUsers.rows) {
            const username = row.username;

            // Get current streak
            const streakRes = await pool.query(
                'SELECT current_streak, longest_streak, last_active_date FROM user_streaks WHERE username = $1',
                [username]
            );

            if (streakRes.rows.length === 0) {
                // First activity ever
                await pool.query(
                    `INSERT INTO user_streaks (username, current_streak, longest_streak, last_active_date, updated_at)
                     VALUES ($1, 1, 1, $2, NOW())
                     ON CONFLICT (username) DO UPDATE SET current_streak = 1, longest_streak = GREATEST(user_streaks.longest_streak, 1), last_active_date = $2, updated_at = NOW()`,
                    [username, todayStr]
                );
                updated++;
            } else {
                const s = streakRes.rows[0];
                if (s.last_active_date === todayStr) continue; // Already updated today

                // Check if yesterday was the last active date (streak continues)
                const yesterday = new Date(todayStr + 'T12:00:00');
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

                let newStreak;
                if (s.last_active_date === yesterdayStr) {
                    newStreak = (s.current_streak || 0) + 1;
                } else {
                    newStreak = 1; // Streak broken
                }

                const newLongest = Math.max(newStreak, s.longest_streak || 0);
                await pool.query(
                    'UPDATE user_streaks SET current_streak = $1, longest_streak = $2, last_active_date = $3, updated_at = NOW() WHERE username = $4',
                    [newStreak, newLongest, todayStr, username]
                );
                updated++;
            }
        }

        if (updated > 0) {
            log.info(`Streaks updated: ${updated} users for ${todayStr}`);
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('StreakUpdates error', err);
        }
    }
}

// v15.1: Birthday greeting — runs daily at 09:00 Kyiv time
// Checks customers with child_birthday matching today (month-day) and sends Telegram notification
let birthdaySentToday = null;

async function checkBirthdayGreetings() {
    try {
        const todayStr = getKyivDateStr();
        if (birthdaySentToday === todayStr) return;

        const nowTime = getKyivTimeStr();
        if (nowTime !== '09:00') return;

        const dbLast = await getLastSent('birthday_greeting');
        if (dbLast === todayStr) { birthdaySentToday = todayStr; return; }

        birthdaySentToday = todayStr;
        await setLastSent('birthday_greeting', todayStr);

        // Find customers whose child has a birthday today (match month and day)
        const kyiv = getKyivDate();
        const month = kyiv.getMonth() + 1;
        const day = kyiv.getDate();

        const result = await pool.query(
            `SELECT id, name, phone, child_name, child_birthday, total_bookings, total_spent
             FROM customers
             WHERE child_birthday IS NOT NULL
               AND EXTRACT(MONTH FROM child_birthday) = $1
               AND EXTRACT(DAY FROM child_birthday) = $2`,
            [month, day]
        );

        if (result.rows.length === 0) return;

        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        const [y, m, d] = todayStr.split('-');
        let text = `🎂 <b>ДНІ НАРОДЖЕННЯ СЬОГОДНІ (${d}.${m}.${y})</b>\n\n`;

        for (const customer of result.rows) {
            const childAge = customer.child_birthday
                ? kyiv.getFullYear() - new Date(customer.child_birthday).getFullYear()
                : '?';

            text += `🎁 <b>${customer.child_name || 'Дитина'}</b>`;
            if (childAge !== '?') text += ` — ${childAge} р.`;
            text += `\n`;
            text += `   👤 Клієнт: ${customer.name}`;
            if (customer.phone) text += ` · 📞 ${customer.phone}`;
            text += `\n`;
            if (customer.total_bookings > 0) {
                text += `   📊 Візитів: ${customer.total_bookings} · Витрачено: ${customer.total_spent || 0} ₴\n`;
            }
            text += `\n`;
        }

        text += `💡 <i>Зателефонуйте та запропонуйте святкування!</i>`;

        await sendTelegramMessage(chatId, text, { silent: false });
        log.info(`Birthday greetings sent: ${result.rows.length} birthdays for ${todayStr}`);
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('BirthdayGreetings error', err);
        }
    }
}

// v30.4: Birthday reminder — 7 days before
let birthdayReminderSentToday = null;

async function checkBirthdayReminders() {
    try {
        const todayStr = getKyivDateStr();
        if (birthdayReminderSentToday === todayStr) return;

        const nowTime = getKyivTimeStr();
        if (nowTime !== '09:30') return;

        const dbLast = await getLastSent('birthday_reminder_7d');
        if (dbLast === todayStr) { birthdayReminderSentToday = todayStr; return; }

        birthdayReminderSentToday = todayStr;
        await setLastSent('birthday_reminder_7d', todayStr);

        const kyiv = getKyivDate();
        const futureDate = new Date(kyiv);
        futureDate.setDate(futureDate.getDate() + 7);
        const month = futureDate.getMonth() + 1;
        const day = futureDate.getDate();

        const result = await pool.query(
            `SELECT id, name, phone, child_name, child_birthday, total_bookings
             FROM customers
             WHERE child_birthday IS NOT NULL
               AND EXTRACT(MONTH FROM child_birthday) = $1
               AND EXTRACT(DAY FROM child_birthday) = $2`,
            [month, day]
        );

        if (result.rows.length === 0) return;

        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        let text = `📅 <b>ДНІ НАРОДЖЕННЯ ЧЕРЕЗ ТИЖДЕНЬ</b>\n\n`;
        for (const c of result.rows) {
            const age = c.child_birthday ? kyiv.getFullYear() - new Date(c.child_birthday).getFullYear() + 1 : '?';
            text += `🎂 <b>${c.child_name || 'Дитина'}</b> — ${age} р.\n`;
            text += `   👤 ${c.name}`;
            if (c.phone) text += ` · 📞 ${c.phone}`;
            text += `\n\n`;
        }
        text += `💡 <i>Час запропонувати святкування!</i>`;

        await sendTelegramMessage(chatId, text, { silent: true });
        log.info(`Birthday reminders (7d) sent: ${result.rows.length}`);
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('BirthdayReminders error', err);
        }
    }
}

// v30.4: Dormant customers — no visit for 60+ days
let dormantSentToday = null;

async function checkDormantCustomers() {
    try {
        const todayStr = getKyivDateStr();
        if (dormantSentToday === todayStr) return;

        const nowTime = getKyivTimeStr();
        if (nowTime !== '10:00') return;

        const dbLast = await getLastSent('dormant_customers');
        if (dbLast === todayStr) { dormantSentToday = todayStr; return; }

        dormantSentToday = todayStr;
        await setLastSent('dormant_customers', todayStr);

        const result = await pool.query(`
            SELECT id, name, phone, total_bookings, total_spent, last_visit
            FROM customers
            WHERE last_visit < NOW() - INTERVAL '60 days'
              AND total_bookings >= 2
            ORDER BY last_visit ASC LIMIT 15
        `);

        if (result.rows.length === 0) return;

        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        let text = `😴 <b>КЛІЄНТИ БЕЗ ВІЗИТІВ 60+ ДНІВ</b>\n\n`;
        for (const c of result.rows) {
            const days = Math.floor((Date.now() - new Date(c.last_visit).getTime()) / (1000*60*60*24));
            text += `👤 <b>${c.name}</b> — ${days} днів\n`;
            if (c.phone) text += `   📞 ${c.phone}`;
            text += ` · ${c.total_bookings} візит. · ${c.total_spent} ₴\n\n`;
        }
        text += `💡 <i>Зателефонуйте або надішліть пропозицію!</i>`;

        await sendTelegramMessage(chatId, text, { silent: true });
        log.info(`Dormant customers alert sent: ${result.rows.length}`);
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('DormantCustomers error', err);
        }
    }
}

// v30.4: Upcoming booking reminder — 3 days before
let upcomingSentToday = null;

async function checkUpcomingBookings() {
    try {
        const todayStr = getKyivDateStr();
        if (upcomingSentToday === todayStr) return;

        const nowTime = getKyivTimeStr();
        if (nowTime !== '11:00') return;

        const dbLast = await getLastSent('upcoming_bookings');
        if (dbLast === todayStr) { upcomingSentToday = todayStr; return; }

        upcomingSentToday = todayStr;
        await setLastSent('upcoming_bookings', todayStr);

        const result = await pool.query(`
            SELECT b.id, b.date, b.time, b.label, b.program_name, b.room,
                   c.name AS customer_name, c.phone AS customer_phone
            FROM bookings b
            LEFT JOIN customers c ON b.customer_id = c.id
            WHERE b.date = to_char(CURRENT_DATE + INTERVAL '3 days', 'YYYY-MM-DD')
              AND b.status IN ('confirmed', 'pending')
              AND b.linked_to IS NULL
        `);

        if (result.rows.length === 0) return;

        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        let text = `📅 <b>БРОНЮВАННЯ ЧЕРЕЗ 3 ДНІ</b>\n\n`;
        for (const b of result.rows) {
            text += `🎉 <b>${b.label || b.program_name || b.id}</b>\n`;
            text += `   ⏰ ${b.time} · 🏠 ${b.room || '?'}\n`;
            if (b.customer_name) {
                text += `   👤 ${b.customer_name}`;
                if (b.customer_phone) text += ` · 📞 ${b.customer_phone}`;
                text += `\n`;
            }
            text += `\n`;
        }
        text += `💡 <i>Перевірте готовність!</i>`;

        await sendTelegramMessage(chatId, text, { silent: true });
        log.info(`Upcoming bookings reminder sent: ${result.rows.length}`);
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('UpcomingBookings error', err);
        }
    }
}

// v30.6: Debt notification — weekly reminder about unpaid bookings
let debtSentThisWeek = null;
let pushRemindersSentToday = null;
let certExpirySentToday = null;

async function checkDebtNotifications() {
    try {
        const todayStr = getKyivDateStr();
        const weekId = todayStr.substring(0, 7) + '-W' + Math.ceil(new Date().getDate() / 7);
        if (debtSentThisWeek === weekId) return;

        // Only send on Mondays at 09:00
        const now = new Date();
        if (now.getDay() !== 1) return;
        const nowTime = getKyivTimeStr();
        if (nowTime !== '09:00') return;

        const dbLast = await getLastSent('debt_notifications');
        if (dbLast === weekId) { debtSentThisWeek = weekId; return; }

        debtSentThisWeek = weekId;
        await setLastSent('debt_notifications', weekId);

        const result = await pool.query(`
            SELECT b.id, b.date, b.label, b.program_name, b.price, b.paid_amount,
                   c.name AS customer_name, c.phone AS customer_phone,
                   (COALESCE(b.price, 0) - COALESCE(b.paid_amount, 0)) AS debt
            FROM bookings b
            LEFT JOIN customers c ON b.customer_id = c.id
            WHERE b.status = 'confirmed' AND b.linked_to IS NULL AND b.price > 0
              AND (b.payment_status IS NULL OR b.payment_status != 'paid')
              AND COALESCE(b.paid_amount, 0) < COALESCE(b.price, 0)
              AND b.date::date <= CURRENT_DATE
            ORDER BY debt DESC LIMIT 20
        `);

        if (result.rows.length === 0) return;

        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        const totalDebt = result.rows.reduce((s, r) => s + r.debt, 0);
        let text = `💸 <b>БОРГИ: ${result.rows.length} неоплачених</b>\n`;
        text += `💰 Загалом: ${totalDebt.toLocaleString('uk-UA')} ₴\n\n`;
        for (const b of result.rows.slice(0, 10)) {
            text += `• ${b.label || b.program_name || b.id} — ${b.debt.toLocaleString('uk-UA')} ₴`;
            if (b.customer_name) text += ` (${b.customer_name})`;
            text += `\n`;
        }
        if (result.rows.length > 10) text += `\n...та ще ${result.rows.length - 10}`;

        await sendTelegramMessage(chatId, text, { silent: true });
        log.info(`Debt notification sent: ${result.rows.length} debts, ${totalDebt} UAH`);
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('DebtNotifications error', err);
        }
    }
}

// v19.1: Event Queue processor — retry failed events + move to DLQ
async function checkEventQueue() {
    try {
        const { processFailedEvents } = require('./eventBus');
        await processFailedEvents();
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('checkEventQueue error', err);
        }
    }
}

// v19.1: SLA breach detection — check support tickets that exceeded SLA limits
async function checkSLABreach() {
    try {
        // Find open tickets that have breached their SLA resolve time
        const breached = await pool.query(
            `SELECT st.id, st.ticket_number, st.subject, st.priority, st.category,
                    st.assigned_to, st.sla_resolve_minutes, st.created_at
             FROM support_tickets st
             WHERE st.status NOT IN ('resolved', 'closed')
               AND st.sla_breached = false
               AND st.sla_resolve_minutes IS NOT NULL
               AND st.created_at + (st.sla_resolve_minutes || ' minutes')::interval < NOW()`
        );

        if (breached.rows.length === 0) return;

        for (const ticket of breached.rows) {
            // Mark as breached
            await pool.query(
                'UPDATE support_tickets SET sla_breached = true WHERE id = $1',
                [ticket.id]
            );

            // Find escalation target from SLA rules
            const slaRule = await pool.query(
                `SELECT escalation_to FROM sla_rules
                 WHERE is_active = true AND (category = $1 OR category IS NULL) AND (priority = $2 OR priority IS NULL)
                 ORDER BY CASE WHEN category IS NOT NULL AND priority IS NOT NULL THEN 1
                               WHEN category IS NOT NULL THEN 2
                               WHEN priority IS NOT NULL THEN 3
                               ELSE 4 END
                 LIMIT 1`,
                [ticket.category, ticket.priority]
            );

            const escalateTo = slaRule.rows[0]?.escalation_to || 'admin';

            // Send Telegram alert
            const chatId = await getConfiguredChatId();
            if (chatId) {
                const elapsed = Math.round((Date.now() - new Date(ticket.created_at).getTime()) / 60000);
                await sendTelegramMessage(chatId,
                    `🚨 <b>SLA ПОРУШЕНО</b>\n\n` +
                    `🎫 ${ticket.ticket_number}: ${ticket.subject}\n` +
                    `⏱ Час: ${elapsed} хв (ліміт: ${ticket.sla_resolve_minutes} хв)\n` +
                    `📌 Пріоритет: ${ticket.priority}\n` +
                    `👤 Ескалація → ${escalateTo}`
                );
            }

            // Publish event for rule engine
            const { publish } = require('./eventBus');
            publish('ticket.sla_breached', {
                ticket_id: ticket.id, ticket_number: ticket.ticket_number,
                priority: ticket.priority, category: ticket.category,
                escalate_to: escalateTo
            });
        }

        log.info(`SLA breach: ${breached.rows.length} tickets breached`);
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('checkSLABreach error', err);
        }
    }
}

// v19.1: Scheduled announcements — activate announcements that are due
async function checkScheduledAnnouncements() {
    try {
        const now = new Date().toISOString();
        const result = await pool.query(
            `UPDATE announcements SET status = 'active'
             WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= $1
             RETURNING id, title`,
            [now]
        );

        if (result.rows.length > 0) {
            log.info(`Announcements activated: ${result.rows.length} (${result.rows.map(r => r.title).join(', ')})`);

            // Log to music_log
            for (const ann of result.rows) {
                await pool.query(
                    `INSERT INTO music_log (action, announcement_id, details) VALUES ('auto_activate', $1, $2)`,
                    [ann.id, JSON.stringify({ activated_at: now })]
                );
            }
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('checkScheduledAnnouncements error', err);
        }
    }
}

// v19.2: Task overdue event — fires event for tasks past their due date
async function checkTaskOverdue() {
    try {
        const todayStr = getKyivDateStr();

        // 1. Mark overdue tasks
        const result = await pool.query(
            `UPDATE tasks SET status = 'overdue'
             WHERE date < $1 AND status NOT IN ('done', 'overdue', 'cancelled')
             RETURNING id, title, date, priority, assigned_to`,
            [todayStr]
        );

        if (result.rows.length > 0) {
            // Publish events
            try {
                const { publish } = require('./eventBus');
                for (const task of result.rows) {
                    await publish('task.overdue', {
                        task_id: task.id, title: task.title,
                        date: task.date, priority: task.priority,
                        assigned_to: task.assigned_to
                    }, `task_overdue_${task.id}_${todayStr}`);
                }
            } catch (e) { /* eventBus may not exist */ }

            // v33.10.0: Gamification penalty for overdue tasks
            try {
                const { spendCoins } = require('./gamification');
                for (const task of result.rows) {
                    if (task.assigned_to) {
                        const penalty = task.priority === 'high' ? 10 : task.priority === 'normal' ? 5 : 2;
                        await spendCoins(task.assigned_to, penalty,
                            `Протерміноване завдання: ${(task.title || '').slice(0, 50)}`,
                            'penalty', task.id
                        ).catch(() => {});
                    }
                }
            } catch (e) { /* gamification not ready */ }

            log.info(`Task overdue: ${result.rows.length} task(s) marked overdue`);
        }

        // 2. v33.10.0: Auto-close tasks linked to past events (deadline passed 3+ days ago)
        try {
            const closed = await pool.query(
                `UPDATE tasks SET status = 'cancelled', updated_at = NOW()
                 WHERE status = 'overdue'
                   AND deadline IS NOT NULL
                   AND deadline::date < ($1::date - INTERVAL '3 days')
                 RETURNING id, title, assigned_to`,
                [todayStr]
            );
            if (closed.rowCount > 0) {
                log.info(`Task auto-closed: ${closed.rowCount} overdue task(s) cancelled after 3 days`);
            }
        } catch (e) { /* deadline column may not exist in older schemas */ }

    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('checkTaskOverdue error', err);
        }
    }
}

// v19.2: Customer retention — identify customers who haven't booked in 60+ days
let retentionLastRun = null;

async function checkCustomerRetention() {
    try {
        const todayStr = getKyivDateStr();
        // Only run once per day
        if (retentionLastRun === todayStr) return;

        const kyiv = getKyivDate();
        const nowTime = getKyivTimeStr();
        // Run at 09:00 daily
        if (nowTime !== '09:00') return;

        retentionLastRun = todayStr;

        const result = await pool.query(
            `SELECT c.id, c.name, c.phone, c.last_visit_at,
                    EXTRACT(DAY FROM NOW() - c.last_visit_at) as days_since
             FROM customers c
             WHERE c.last_visit_at IS NOT NULL
               AND c.last_visit_at < NOW() - INTERVAL '60 days'
               AND c.id NOT IN (
                   SELECT DISTINCT customer_id FROM customer_retention_log
                   WHERE created_at > NOW() - INTERVAL '30 days'
               )
             ORDER BY c.last_visit_at ASC
             LIMIT 20`
        );

        if (result.rows.length > 0) {
            // Log retention candidates
            for (const customer of result.rows) {
                try {
                    await pool.query(
                        `INSERT INTO customer_retention_log (customer_id, days_since_visit, created_at)
                         VALUES ($1, $2, NOW())`,
                        [customer.id, Math.floor(customer.days_since)]
                    );
                } catch (e) { /* table may not exist */ }

                try {
                    const { publish } = require('./eventBus');
                    await publish('customer.retention', {
                        customer_id: customer.id,
                        name: customer.name,
                        phone: customer.phone,
                        days_since: Math.floor(customer.days_since)
                    }, `retention_${customer.id}_${todayStr}`);
                } catch (e) { /* eventBus may not exist */ }
            }
            log.info(`Retention check: ${result.rows.length} customer(s) flagged for follow-up`);
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('checkCustomerRetention error', err);
        }
    }
}

// v19.8: Auto-report — sends daily summary to a configured group (e.g., ClawClosed)
let autoReportSentToday = null;

async function checkAutoReport() {
    try {
        const result = await pool.query(
            "SELECT key, value FROM settings WHERE key IN ('auto_report_time', 'auto_report_chat_id')"
        );
        const settings = {};
        result.rows.forEach(r => { settings[r.key] = r.value; });

        const reportTime = settings.auto_report_time || '20:00';
        const reportChatId = settings.auto_report_chat_id;
        if (!reportChatId) return;
        if (!/^\d{2}:\d{2}$/.test(reportTime)) return;

        const nowTime = getKyivTimeStr();
        const todayStr = getKyivDateStr();

        if (autoReportSentToday === todayStr) return;
        if (nowTime !== reportTime) return;
        const dbLast = await getLastSent('auto_report');
        if (dbLast === todayStr) { autoReportSentToday = todayStr; return; }

        autoReportSentToday = todayStr;
        await setLastSent('auto_report', todayStr);
        log.info(`Sending auto-report for ${todayStr} to chat ${reportChatId}`);

        // Build report
        const [y, m, d] = todayStr.split('-');
        const dateFormatted = `${d}.${m}.${y}`;

        const bookingsResult = await pool.query(
            "SELECT COUNT(*)::int AS total, SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END)::int AS confirmed, " +
            "COALESCE(SUM(price),0)::numeric AS revenue, COALESCE(AVG(price),0)::numeric AS avg_check " +
            "FROM bookings WHERE date = $1 AND status != 'cancelled'",
            [todayStr]
        );
        const stats = bookingsResult.rows[0];

        const tasksResult = await pool.query(
            "SELECT COUNT(*)::int AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END)::int AS done " +
            "FROM tasks WHERE date = $1",
            [todayStr]
        );
        const taskStats = tasksResult.rows[0];

        const topProgramResult = await pool.query(
            "SELECT program, COUNT(*)::int AS cnt FROM bookings WHERE date = $1 AND status != 'cancelled' GROUP BY program ORDER BY cnt DESC LIMIT 3",
            [todayStr]
        );

        let text = `📊 <b>ЩОДЕННИЙ ЗВІТ — ${dateFormatted}</b>\n`;
        text += `━━━━━━━━━━━━━━━━━\n\n`;
        text += `📅 Бронювань: <b>${stats.total}</b> (підтверджено: ${stats.confirmed})\n`;
        text += `💰 Виручка: <b>${Number(stats.revenue).toLocaleString()} ₴</b>\n`;
        text += `📈 Сер. чек: <b>${Math.round(stats.avg_check).toLocaleString()} ₴</b>\n\n`;

        if (topProgramResult.rows.length > 0) {
            text += `🏆 <b>Топ програми:</b>\n`;
            for (const p of topProgramResult.rows) {
                text += `  • ${p.program || 'Інше'} — ${p.cnt}\n`;
            }
            text += '\n';
        }

        text += `📋 Задачі: <b>${taskStats.done}/${taskStats.total}</b> виконано\n\n`;
        text += `🤖 <i>Event Genix — автозвіт</i>`;

        await sendTelegramMessage(reportChatId, text, { silent: false });
        log.info('Auto-report sent successfully');
    } catch (err) {
        log.error('checkAutoReport error', err);
    }
}

// v20.7.0: Hot leads checker — create follow-up tasks for leads without response 24h+
async function checkHotLeads() {
    try {
        const timeStr = getKyivTimeStr();
        const hour = parseInt(timeStr.split(':')[0]);
        // Run at 09:00 and 15:00 Kyiv time
        if (hour !== 9 && hour !== 15) return;
        if (timeStr.split(':')[1] !== '00') return;

        const hotLeads = await pool.query(`
            SELECT l.id, l.client_name, l.phone, p.label AS program_name,
                   l.children_count, l.event_date
            FROM leads l
            LEFT JOIN products p ON l.program_id = p.id
            WHERE l.status = 'new'
              AND l.created_at < NOW() - INTERVAL '24 hours'
        `);

        if (hotLeads.rows.length === 0) return;

        for (const lead of hotLeads.rows) {
            // Check if task already exists for this lead
            const existing = await pool.query(
                `SELECT id FROM tasks WHERE source_type = 'lead' AND source_id = $1`,
                [String(lead.id)]
            );
            if (existing.rows.length > 0) continue;

            const title = `🔥 Зателефонувати: ${lead.client_name}`;
            const desc = [
                lead.program_name ? `Програма: ${lead.program_name}` : null,
                lead.children_count ? `Дітей: ${lead.children_count}` : null,
                lead.phone ? `Тел: ${lead.phone}` : null,
                lead.event_date ? `Дата: ${lead.event_date}` : null,
                'Лід без відповіді 24+ годин'
            ].filter(Boolean).join('\n');

            await pool.query(`
                INSERT INTO tasks (title, description, priority, category, source_type, source_id, date)
                VALUES ($1, $2, 'high', 'sales', 'lead', $3, $4)
            `, [title, desc, String(lead.id), getKyivDateStr()]);

            log.info(`Hot lead task created for: ${lead.client_name} (lead #${lead.id})`);
        }

        // Send Telegram alert if any hot leads
        if (hotLeads.rows.length > 0) {
            const chatId = await getConfiguredChatId();
            const text = `🔥 <b>Гарячі ліди: ${hotLeads.rows.length}</b>\n` +
                hotLeads.rows.slice(0, 5).map(l =>
                    `• ${l.client_name}${l.program_name ? ' — ' + l.program_name : ''}`
                ).join('\n') +
                (hotLeads.rows.length > 5 ? `\n... та ще ${hotLeads.rows.length - 5}` : '');
            await sendTelegramMessage(chatId, text, { silent: true }).catch(() => {});
        }
    } catch (err) {
        log.error('checkHotLeads error', err);
    }
}

/**
 * Send scheduled chat messages that are due.
 */
async function claimDueScheduledChatMessages(now, limit = 20) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            WITH due AS (
                SELECT id
                FROM chat_messages
                WHERE is_scheduled = true
                  AND scheduled_at <= $1
                  AND deleted_at IS NULL
                ORDER BY scheduled_at ASC, id ASC
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            )
            UPDATE chat_messages cm
            SET is_scheduled = false
            FROM due
            WHERE cm.id = due.id
            RETURNING cm.*
        `, [now, limit]);
        await client.query('COMMIT');
        return result.rows;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function checkScheduledChatMessages() {
    try {
        const now = new Date().toISOString();
        const rows = await claimDueScheduledChatMessages(now, 20);
        if (rows.length === 0) return;

        const { broadcastToChannel } = require('./websocket');
        const chatService = require('./chatService');

        for (const row of rows) {
            try {
                const fullMsg = await pool.query(`
                    SELECT cm.*, u.username, u.name AS display_name
                    FROM chat_messages cm JOIN users u ON u.id = cm.user_id WHERE cm.id = $1
                `, [row.id]);
                if (fullMsg.rows[0]) {
                    const message = chatService.mapMessageRow(fullMsg.rows[0]);
                    broadcastToChannel(row.channel_id, 'chat:message', {
                        channelId: row.channel_id,
                        message
                    });
                }
                log.info(`Scheduled chat message ${row.id} sent`);
            } catch (err) {
                log.error(`Scheduled message ${row.id} broadcast error after atomic claim: ${err.message}; message remains visible in DB and will not be retried to avoid duplicate sends`);
            }
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('checkScheduledChatMessages error', err);
        }
    }
}

/**
 * Clean up expired chat messages (self-destruct).
 */
async function checkExpiredChatMessages() {
    try {
        const now = new Date().toISOString();
        const result = await pool.query(
            `SELECT id, channel_id FROM chat_messages WHERE expires_at IS NOT NULL AND expires_at <= $1 AND deleted_at IS NULL LIMIT 50`,
            [now]
        );
        if (result.rows.length === 0) return;

        const { broadcastToChannel } = require('./websocket');

        for (const row of result.rows) {
            await pool.query('UPDATE chat_messages SET deleted_at = NOW() WHERE id = $1', [row.id]);
            broadcastToChannel(row.channel_id, 'chat:delete', {
                channelId: row.channel_id,
                messageId: row.id
            });
        }
        if (result.rows.length > 0) {
            log.info(`Cleaned ${result.rows.length} expired chat messages`);
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('checkExpiredChatMessages error', err);
        }
    }
}

// v22.18: Auto-review requests after completed events
async function checkAutoReviewRequests() {
    try {
        // Find bookings that ended 2+ hours ago, haven't had review requests sent
        const hoursDelay = 2;
        const result = await pool.query(`
            SELECT b.id, b.label, b.phone, b.date, b.time, b.duration,
                   b.program_name, b.customer_telegram_id
            FROM bookings b
            LEFT JOIN review_requests_sent rrs ON rrs.booking_id = b.id
            WHERE b.status = 'confirmed'
              AND b.date::date <= CURRENT_DATE
              AND rrs.booking_id IS NULL
              AND b.phone IS NOT NULL
              AND (b.date::date + (SUBSTRING(b.time FROM 1 FOR 2) || ':' || SUBSTRING(b.time FROM 4 FOR 2))::time + (b.duration || ' minutes')::interval) < NOW() - ($1 || ' hours')::interval
            ORDER BY b.date DESC, b.time DESC
            LIMIT 10
        `, [hoursDelay]);

        for (const booking of result.rows) {
            const tgChatId = booking.customer_telegram_id;
            if (!tgChatId) continue;

            const text = `🌟 <b>Як пройшло свято?</b>\n\n`
                + `Програма: ${booking.program_name || booking.label}\n`
                + `Дата: ${booking.date}\n\n`
                + `Оцініть від 1 до 5:\n`
                + `⭐ — Погано\n⭐⭐ — Так собі\n⭐⭐⭐ — Нормально\n⭐⭐⭐⭐ — Добре\n⭐⭐⭐⭐⭐ — Чудово!\n\n`
                + `Натисніть кнопку нижче:`;

            const keyboard = {
                inline_keyboard: [[
                    { text: '1⭐', callback_data: `review:${booking.id}:1` },
                    { text: '2⭐', callback_data: `review:${booking.id}:2` },
                    { text: '3⭐', callback_data: `review:${booking.id}:3` },
                    { text: '4⭐', callback_data: `review:${booking.id}:4` },
                    { text: '5⭐', callback_data: `review:${booking.id}:5` }
                ]]
            };

            try {
                await sendTelegramMessage(tgChatId, text, {
                    reply_markup: JSON.stringify(keyboard)
                });
                await pool.query(
                    'INSERT INTO review_requests_sent (booking_id) VALUES ($1) ON CONFLICT DO NOTHING',
                    [booking.id]
                );
                log.info(`Review request sent for booking #${booking.id}`);
            } catch (err) {
                log.warn(`Failed to send review request for booking #${booking.id}: ${err.message}`);
            }
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('checkAutoReviewRequests error', err);
        }
    }
}

// v22.18: Check team pulse reminder (daily at configured time)
async function checkTeamPulseReminder() {
    try {
        const now = getKyivTimeStr();
        const pulseTime = '18:00'; // Could be configurable via settings

        if (now !== pulseTime) return;

        const todayKey = `pulse_sent_${getKyivDateStr()}`;
        const sent = await getLastSent(todayKey);
        if (sent) return;

        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        const text = `🫀 <b>Пульс команди</b>\n\n`
            + `Як ти сьогодні? Оціни свій настрій:\n\n`
            + `Натисни кнопку нижче (анонімно):`;

        const keyboard = {
            inline_keyboard: [[
                { text: '1 😫', callback_data: 'pulse:1' },
                { text: '2 😕', callback_data: 'pulse:2' },
                { text: '3 😐', callback_data: 'pulse:3' },
                { text: '4 🙂', callback_data: 'pulse:4' },
                { text: '5 🤩', callback_data: 'pulse:5' }
            ]]
        };

        await sendTelegramMessage(chatId, text, {
            reply_markup: JSON.stringify(keyboard)
        });

        await setLastSent(todayKey, now);
        log.info('Team pulse reminder sent');
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('checkTeamPulseReminder error', err);
        }
    }
}

// v33.5: Refresh stale catalog images (daily at 03:00 Kyiv)
async function checkStaleCatalogImages() {
    try {
        const nowTime = getKyivTimeStr();
        if (nowTime !== '03:00') return;
        const last = await getLastSent('stale_catalog_images');
        const today = getKyivDateStr();
        if (last === today) return;
        await setLastSent('stale_catalog_images', today);
        const stale = await pool.query(
            `SELECT ci.id, ci.name, ci.subcategory, ci.catalog_id, cd.ai_style
             FROM catalog_items ci
             JOIN catalog_definitions cd ON cd.id = ci.catalog_id
             WHERE ci.status = 'active'
               AND ci.image_url IS NOT NULL
               AND ci.updated_at < NOW() - INTERVAL '6 days'
             LIMIT 10`
        );
        if (!stale.rowCount) return;
        const https = require('https');
        const KIE_KEY = process.env.KIE_API_KEY || '';
        const DEFAULT_STYLE = 'colorful illustration, white background, no text';

        function kieHttpRequest(method, path, postBody) {
            return new Promise((resolve, reject) => {
                const opts = {
                    hostname: 'api.kie.ai', path, method,
                    headers: { 'Authorization': `Bearer ${KIE_KEY}`, 'Content-Type': 'application/json' }
                };
                if (postBody) opts.headers['Content-Length'] = Buffer.byteLength(postBody);
                const req = https.request(opts, res => {
                    let d = '';
                    res.on('data', c => d += c);
                    res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
                });
                req.on('error', reject);
                req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
                if (postBody) req.write(postBody);
                req.end();
            });
        }

        let refreshed = 0;
        for (const item of stale.rows) {
            try {
                const style = item.ai_style || DEFAULT_STYLE;
                const themeCtx = [item.name, item.subcategory].filter(Boolean).join(', ');
                const prompt = `${style}. Product: "${themeCtx}". Ukrainian children's park.`;
                const body = JSON.stringify({ model: 'google/nano-banana', input: { prompt, image_size: '1:1' } });
                const taskData = await kieHttpRequest('POST', '/api/v1/jobs/createTask', body);
                if (!taskData?.data?.taskId) continue;
                await new Promise(r => setTimeout(r, 20000));
                const pollData = await kieHttpRequest('GET', `/api/v1/jobs/recordInfo?taskId=${taskData.data.taskId}`);
                const rj = pollData?.data?.resultJson;
                let url = null;
                try { url = rj ? JSON.parse(typeof rj === 'string' ? rj : '{}')?.resultUrls?.[0] : null; } catch { /* ignore */ }
                if (url) {
                    await pool.query('UPDATE catalog_items SET image_url = $1, updated_at = NOW() WHERE id = $2', [url, item.id]);
                    refreshed++;
                }
            } catch (e) { log.warn(`Stale refresh failed item ${item.id}: ${e.message}`); }
        }
        if (refreshed > 0) log.info(`Stale catalog images refreshed: ${refreshed}/${stale.rowCount}`);
    } catch (err) {
        if (!err.message?.includes('does not exist')) log.error('checkStaleCatalogImages error', err);
    }
}

// v33.7.0: Daily chat digest (20:00 Kyiv)
async function checkChatDailyDigest() {
    try {
        const nowTime = getKyivTimeStr();
        if (nowTime !== '20:00') return;
        const today = getKyivDateStr();
        const last = await getLastSent('chat_daily_digest');
        if (last === today) return;
        await setLastSent('chat_daily_digest', today);

        const stats = await pool.query(`
            SELECT
                cc.name AS channel_name,
                COUNT(cm.id)::int AS msg_count,
                COUNT(DISTINCT cm.user_id)::int AS active_users
            FROM chat_channels cc
            LEFT JOIN chat_messages cm
                ON cm.channel_id = cc.id
                AND cm.created_at >= $1::date
                AND cm.deleted_at IS NULL
                AND (cm.is_bot IS NULL OR cm.is_bot = false)
            WHERE (cc.is_archived IS NULL OR cc.is_archived = false)
            GROUP BY cc.id, cc.name
            HAVING COUNT(cm.id) > 0
            ORDER BY msg_count DESC`, [today]);

        if (!stats.rowCount) return;
        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        const totalMsgs = stats.rows.reduce((s, r) => s + r.msg_count, 0);
        let text = `💬 <b>Чат — зведення ${today}</b>\n${totalMsgs} повід.\n\n`;
        stats.rows.forEach(r => {
            text += `<b>${r.channel_name}</b>: ${r.msg_count}`;
            if (r.active_users > 1) text += ` (${r.active_users} уч.)`;
            text += '\n';
        });

        await sendTelegramMessage(chatId, text);
        log.info(`[ChatDigest] Sent for ${today}`);
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('[ChatDigest] Error', err);
        }
    }
}

// v38.3.0: Event Pipeline — auto-publish lifecycle events for bookings
async function checkEventPipeline() {
    try {
        const { publish } = require('./eventBus');
        const today = getKyivDateStr();
        const tomorrow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().slice(0, 10);

        // T-24: bookings happening tomorrow that haven't had t24 event
        const t24 = await pool.query(`
            SELECT b.id, b.label, b.time, b.program_name, b.room, b.phone, b.customer_telegram_id
            FROM bookings b
            LEFT JOIN booking_pipeline bp ON bp.booking_id = b.id AND bp.stage = 't24_sent'
            WHERE b.date = $1 AND b.status IN ('confirmed', 'preliminary')
              AND bp.id IS NULL
            LIMIT 20
        `, [tomorrowStr]).catch(() => ({ rows: [] }));

        for (const b of t24.rows) {
            await publish('booking.t24', {
                booking_id: b.id, label: b.label, time: b.time,
                programName: b.program_name, room: b.room, phone: b.phone,
                customer_telegram_id: b.customer_telegram_id
            }, `t24_${b.id}_${tomorrowStr}`);
            await pool.query(
                'INSERT INTO booking_pipeline (booking_id, stage) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [b.id, 't24_sent']
            ).catch(() => {});
        }

        // Day-of: bookings today that haven't had day_of event
        const dayOf = await pool.query(`
            SELECT b.id, b.label, b.time, b.program_name, b.room
            FROM bookings b
            LEFT JOIN booking_pipeline bp ON bp.booking_id = b.id AND bp.stage = 'day_of_prep'
            WHERE b.date = $1 AND b.status IN ('confirmed', 'preliminary')
              AND bp.id IS NULL
            LIMIT 20
        `, [today]).catch(() => ({ rows: [] }));

        for (const b of dayOf.rows) {
            await publish('booking.day_of', {
                booking_id: b.id, label: b.label, time: b.time,
                programName: b.program_name, room: b.room
            }, `dayof_${b.id}_${today}`);
            await pool.query(
                'INSERT INTO booking_pipeline (booking_id, stage) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [b.id, 'day_of_prep']
            ).catch(() => {});
        }

        // Completed: bookings that ended (time + duration < now) but no completion event
        const completed = await pool.query(`
            SELECT b.id, b.label, b.time, b.program_name, b.room, b.duration
            FROM bookings b
            LEFT JOIN booking_pipeline bp ON bp.booking_id = b.id AND bp.stage = 'completed'
            WHERE b.date = $1 AND b.status = 'confirmed'
              AND bp.id IS NULL
              AND (b.date::date + (SUBSTRING(b.time FROM 1 FOR 2) || ':' || SUBSTRING(b.time FROM 4 FOR 2))::time
                   + (COALESCE(b.duration, 120) || ' minutes')::interval) < NOW()
            LIMIT 20
        `, [today]).catch(() => ({ rows: [] }));

        for (const b of completed.rows) {
            await publish('booking.completed', {
                booking_id: b.id, label: b.label, time: b.time,
                programName: b.program_name, room: b.room
            }, `completed_${b.id}_${today}`);
            await pool.query(
                'INSERT INTO booking_pipeline (booking_id, stage) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [b.id, 'completed']
            ).catch(() => {});
        }

        const total = t24.rows.length + dayOf.rows.length + completed.rows.length;
        if (total > 0) {
            log.info(`Event pipeline: ${t24.rows.length} T-24, ${dayOf.rows.length} day-of, ${completed.rows.length} completed`);
        }
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('checkEventPipeline error', err);
        }
    }
}

// v38.3.0: NPS follow-up — create tasks for detractors, referral for promoters
async function checkNpsFollowUp() {
    try {
        const { publish } = require('./eventBus');

        // Detractors: rating 1-2, no follow-up yet
        const detractors = await pool.query(`
            SELECT er.id, er.booking_id, er.rating, er.comment, er.customer_name, er.customer_phone,
                   b.program_name, b.date
            FROM event_reviews er
            LEFT JOIN bookings b ON b.id = er.booking_id
            WHERE er.rating <= 2
              AND (er.follow_up_status IS NULL OR er.follow_up_status = 'none')
              AND er.created_at > NOW() - INTERVAL '48 hours'
            LIMIT 10
        `).catch(() => ({ rows: [] }));

        for (const d of detractors.rows) {
            await publish('review.detractor', {
                review_id: d.id, booking_id: d.booking_id, rating: d.rating,
                comment: d.comment || '', customerName: d.customer_name || 'Клієнт',
                programName: d.program_name || '', phone: d.customer_phone
            }, `detractor_${d.id}`);
            await pool.query(
                "UPDATE event_reviews SET follow_up_status = 'pending', follow_up_at = NOW() WHERE id = $1",
                [d.id]
            ).catch(() => {});
        }

        // Promoters: rating 5, no follow-up yet
        const promoters = await pool.query(`
            SELECT er.id, er.booking_id, er.rating, er.customer_name, er.customer_telegram_id,
                   b.program_name
            FROM event_reviews er
            LEFT JOIN bookings b ON b.id = er.booking_id
            WHERE er.rating = 5
              AND (er.follow_up_status IS NULL OR er.follow_up_status = 'none')
              AND er.created_at > NOW() - INTERVAL '48 hours'
              AND er.customer_telegram_id IS NOT NULL
            LIMIT 10
        `).catch(() => ({ rows: [] }));

        for (const p of promoters.rows) {
            await publish('review.promoter', {
                review_id: p.id, booking_id: p.booking_id, rating: p.rating,
                customerName: p.customer_name || 'Клієнт',
                programName: p.program_name || '',
                customer_telegram_id: p.customer_telegram_id
            }, `promoter_${p.id}`);
            await pool.query(
                "UPDATE event_reviews SET follow_up_status = 'completed', follow_up_at = NOW() WHERE id = $1",
                [p.id]
            ).catch(() => {});
        }

        const total = detractors.rows.length + promoters.rows.length;
        if (total > 0) {
            log.info(`NPS follow-up: ${detractors.rows.length} detractors, ${promoters.rows.length} promoters`);
        }
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('checkNpsFollowUp error', err);
        }
    }
}

// v38.3.0: Auto-create cleaning tasks for completed bookings
async function checkCleaningTasks() {
    try {
        const today = getKyivDateStr();

        // Find completed bookings that don't have cleaning tasks yet
        const result = await pool.query(`
            SELECT b.id, b.room, b.time, b.duration, b.program_name, b.label
            FROM bookings b
            LEFT JOIN cleaning_tasks ct ON ct.booking_id = b.id
            WHERE b.date = $1 AND b.status = 'confirmed'
              AND b.room IS NOT NULL AND b.room != ''
              AND ct.id IS NULL
              AND (b.date::date + (SUBSTRING(b.time FROM 1 FOR 2) || ':' || SUBSTRING(b.time FROM 4 FOR 2))::time
                   + (COALESCE(b.duration, 120) || ' minutes')::interval) < NOW()
            LIMIT 20
        `, [today]).catch(() => ({ rows: [] }));

        for (const b of result.rows) {
            const endMinutes = (parseInt(b.time.slice(0,2)) * 60 + parseInt(b.time.slice(3,5))) + (b.duration || 120);
            const endHour = Math.floor(endMinutes / 60);
            const endMin = endMinutes % 60;
            const scheduledAt = `${today} ${String(endHour).padStart(2,'0')}:${String(endMin).padStart(2,'0')}:00`;

            await pool.query(`
                INSERT INTO cleaning_tasks (booking_id, room, scheduled_at, sla_minutes)
                VALUES ($1, $2, $3, 15)
                ON CONFLICT DO NOTHING
            `, [b.id, b.room, scheduledAt]).catch(() => {});
        }

        if (result.rows.length > 0) {
            log.info(`Cleaning tasks: created ${result.rows.length} for completed bookings`);
        }
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('checkCleaningTasks error', err);
        }
    }
}

module.exports = {
    buildAndSendDigest, sendTomorrowReminder,
    checkAutoDigest, checkAutoReminder, checkAutoBackup, checkRecurringTasks,
    checkScheduledDeletions, checkRecurringAfisha, ensureRecurringAfishaForDate,
    checkRecurringBookings, checkCertificateExpiry,
    checkTaskReminders, checkWorkDayTriggers, checkMonthlyPointsReset,
    checkStreakUpdates, checkBirthdayGreetings,
    checkBirthdayReminders, checkDormantCustomers, checkUpcomingBookings, checkDebtNotifications,
    checkEventQueue, checkSLABreach, checkScheduledAnnouncements,
    checkTaskOverdue, checkCustomerRetention, checkAutoReport,
    checkHotLeads,
    checkScheduledChatMessages,
    checkExpiredChatMessages,
    checkAutoReviewRequests,
    checkTeamPulseReminder,
    checkAutoOrdering,
    checkBookingPushReminders,
    checkCertExpiryReminders,
    checkStaleCatalogImages,
    checkChatDailyDigest,
    checkRecurringAnnouncements,
    checkEventPipeline,
    checkNpsFollowUp,
    checkCleaningTasks
};

// v33.15.0: Recurring announcements — play based on repeat_cron
async function checkRecurringAnnouncements() {
    try {
        const result = await pool.query(
            `SELECT * FROM announcements
             WHERE status = 'active' AND schedule_type = 'recurring'
               AND repeat_cron IS NOT NULL AND deleted_at IS NULL`
        );
        if (!result.rows.length) return;
        const { deliverAnnouncement, isCronDue } = require('./music-delivery');
        const now = new Date();
        for (const ann of result.rows) {
            if (!isCronDue(ann.repeat_cron, now)) continue;
            if (ann.last_played_at && (now - new Date(ann.last_played_at)) / 1000 < 55) continue;

            const delivery = await deliverAnnouncement(ann, { triggeredBy: 'scheduler' });
            await pool.query(
                `UPDATE announcements SET played_count=played_count+1, last_played_at=NOW(),
                 last_delivery_status=$1, last_delivery_mode=$2, last_delivery_detail=$3, last_delivery_at=NOW()
                 WHERE id=$4`,
                [delivery.success ? 'success' : 'failed', delivery.mode, delivery.detail, ann.id]
            );
            await pool.query(
                `INSERT INTO music_log (action, announcement_id, delivery_status, delivery_mode, delivery_detail, triggered_by)
                 VALUES ('play', $1, $2, $3, $4, 'scheduler')`,
                [ann.id, delivery.success ? 'success' : 'failed', delivery.mode, delivery.detail]
            );
            log.info(`[RecurringAnn] #${ann.id} "${ann.title}" — ${delivery.success ? '✓' : '✗'} ${delivery.mode}`);
        }
    } catch (err) {
        if (!err.message?.includes('does not exist'))
            log.error('checkRecurringAnnouncements error', err);
    }
}

// v22.18: Auto-ordering — check stock levels and create order requests
async function checkAutoOrdering() {
    try {
        const result = await pool.query(`
            SELECT aor.id AS rule_id, aor.stock_id, aor.contractor_id, aor.reorder_quantity,
                   ws.name AS stock_name, ws.quantity, ws.min_quantity, ws.unit,
                   c.name AS contractor_name, c.telegram_chat_id AS contractor_tg
            FROM auto_order_rules aor
            JOIN warehouse_stock ws ON ws.id = aor.stock_id
            LEFT JOIN contractors c ON c.id = aor.contractor_id
            WHERE aor.is_active = true
              AND ws.is_active = true
              AND ws.quantity <= ws.min_quantity
              AND NOT EXISTS (
                  SELECT 1 FROM auto_order_requests req
                  WHERE req.stock_id = aor.stock_id
                    AND req.status IN ('pending', 'approved')
                    AND req.created_at > NOW() - INTERVAL '24 hours'
              )
        `);

        if (result.rows.length === 0) return;

        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        for (const item of result.rows) {
            const reqResult = await pool.query(
                `INSERT INTO auto_order_requests (stock_id, contractor_id, quantity, current_stock, min_stock)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                [item.stock_id, item.contractor_id, item.reorder_quantity, item.quantity, item.min_quantity]
            );
            const requestId = reqResult.rows[0].id;

            const text = `🛒 <b>Автозамовлення #${requestId}</b>\n\n`
                + `📦 <b>${item.stock_name}</b>\n`
                + `📊 Залишок: ${item.quantity} ${item.unit} (мін: ${item.min_quantity})\n`
                + `📝 Замовити: ${item.reorder_quantity} ${item.unit}\n`
                + (item.contractor_name ? `🏢 Підрядник: ${item.contractor_name}\n` : '')
                + `\nПідтвердити замовлення?`;

            const keyboard = {
                inline_keyboard: [[
                    { text: '✅ Підтвердити', callback_data: `order_approve:${requestId}` },
                    { text: '❌ Відхилити', callback_data: `order_reject:${requestId}` }
                ]]
            };

            const msgResult = await sendTelegramMessage(chatId, text, {
                reply_markup: JSON.stringify(keyboard)
            });

            if (msgResult && msgResult.ok) {
                await pool.query(
                    'UPDATE auto_order_requests SET telegram_message_id = $1 WHERE id = $2',
                    [msgResult.result.message_id, requestId]
                );
            }

            log.info(`Auto-order request #${requestId} created for ${item.stock_name} (${item.quantity}/${item.min_quantity})`);
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
            log.error('checkAutoOrdering error', err);
        }
    }
}

// v30.7: Push reminders — notify animators 30 min before their booking (#9)
async function checkBookingPushReminders() {
    try {
        const kyiv = getKyivDate();
        const todayStr = getKyivDateStr();
        const nowTime = getKyivTimeStr();

        if (pushRemindersSentToday === todayStr + '_' + nowTime) return;

        // Check every minute, find bookings starting in ~30 minutes
        const nowMinutes = kyiv.getHours() * 60 + kyiv.getMinutes();
        const targetMinutes = nowMinutes + 30;
        const targetTime = `${String(Math.floor(targetMinutes / 60)).padStart(2, '0')}:${String(targetMinutes % 60).padStart(2, '0')}`;

        const result = await pool.query(`
            SELECT b.id, b.id AS booking_number, b.time AS time_start, b.program_name,
                   b.hosts, b.second_animator
            FROM bookings b
            WHERE b.date = $1
              AND b.status IN ('confirmed', 'pending')
              AND b.time = $2
              AND b.hosts IS NOT NULL AND b.hosts != ''
        `, [todayStr, targetTime]);

        if (result.rows.length === 0) return;

        pushRemindersSentToday = todayStr + '_' + nowTime;

        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        for (const booking of result.rows) {
            const hostIds = [booking.hosts];
            if (booking.second_animator && /^\d+$/.test(booking.second_animator)) {
                hostIds.push(parseInt(booking.second_animator));
            }
            const validIds = hostIds.filter(Boolean);
            if (validIds.length === 0) continue;

            const staff = await pool.query(
                'SELECT id, name, telegram_id FROM staff WHERE id = ANY($1)', [validIds]
            );

            for (const s of staff.rows) {
                const text = `⏰ <b>Через 30 хв у тебе бронювання!</b>\n\n`
                    + `📋 ${booking.booking_number}\n`
                    + `🎭 ${booking.program_name || 'Програма не вказана'}\n`
                    + `🕐 ${booking.time_start}\n`;

                const targetChat = s.telegram_id || chatId;
                await sendTelegramMessage(targetChat, text);
            }
        }
        log.info(`Push reminders sent for ${result.rows.length} upcoming bookings`);
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('checkBookingPushReminders error', err);
        }
    }
}

// v30.7: Certificate expiry reminders — notify about expiring certifications
async function checkCertExpiryReminders() {
    try {
        const todayStr = getKyivDateStr();
        const nowTime = getKyivTimeStr();

        if (nowTime !== '09:15') return;
        if (certExpirySentToday === todayStr) return;
        const dbLast = await getLastSent('cert_expiry_reminder');
        if (dbLast === todayStr) { certExpirySentToday = todayStr; return; }

        certExpirySentToday = todayStr;
        await setLastSent('cert_expiry_reminder', todayStr);

        // Find certs expiring in next 14 days
        const result = await pool.query(`
            SELECT sc.id, sc.name AS cert_name, sc.expires_at, sc.status,
                   s.name AS staff_name, s.id AS staff_id
            FROM staff_certifications sc
            JOIN staff s ON s.id = sc.staff_id
            WHERE sc.expires_at IS NOT NULL
              AND sc.status = 'active'
              AND sc.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'
            ORDER BY sc.expires_at ASC
        `);

        if (result.rows.length === 0) return;

        // Mark expired ones
        await pool.query(`
            UPDATE staff_certifications SET status = 'expired'
            WHERE expires_at < CURRENT_DATE AND status = 'active'
        `);

        const chatId = await getConfiguredChatId();
        if (!chatId) return;

        let text = `📜 <b>Сертифікати: термін спливає</b>\n\n`;
        for (const cert of result.rows) {
            const daysLeft = Math.ceil((new Date(cert.expires_at) - new Date(todayStr)) / 86400000);
            const urgency = daysLeft <= 3 ? '🔴' : daysLeft <= 7 ? '🟡' : '🟢';
            text += `${urgency} <b>${cert.staff_name}</b> — ${cert.cert_name} (${daysLeft} дн.)\n`;
        }

        await sendTelegramMessage(chatId, text);
        log.info(`Cert expiry reminders: ${result.rows.length} certs expiring soon`);
    } catch (err) {
        if (!err.message?.includes('does not exist')) {
            log.error('checkCertExpiryReminders error', err);
        }
    }
}
