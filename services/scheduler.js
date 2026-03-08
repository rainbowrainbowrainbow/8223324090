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

    const bookingsResult = await pool.query("SELECT * FROM bookings WHERE date = $1 AND status != 'cancelled' ORDER BY time", [date]);
    const bookings = bookingsResult.rows;

    // Fetch afisha events for the same date
    const afishaResult = await pool.query('SELECT * FROM afisha WHERE date = $1 ORDER BY time', [date]);
    const afishaEvents = afishaResult.rows;

    if (bookings.length === 0 && afishaEvents.length === 0) {
        const text = `📅 <b>${date}</b>\n\nНемає бронювань на цей день.`;
        const result = await sendTelegramMessage(chatId, text);
        return { success: result?.ok || false, count: 0, reason: result?.ok ? undefined : (result?.description || 'send_failed') };
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

    return { success: result?.ok || false, count: bookings.length, reason: result?.ok ? undefined : (result?.description || 'send_failed') };
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
        const result = await pool.query(
            `UPDATE tasks SET status = 'overdue'
             WHERE date < $1 AND status NOT IN ('done', 'overdue', 'cancelled')
             RETURNING id, title, date, priority, assigned_to`,
            [todayStr]
        );
        if (result.rows.length > 0) {
            try {
                const { publish } = require('./eventBus');
                for (const task of result.rows) {
                    await publish('task.overdue', {
                        task_id: task.id,
                        title: task.title,
                        date: task.date,
                        priority: task.priority,
                        assigned_to: task.assigned_to
                    }, `task_overdue_${task.id}_${todayStr}`);
                }
                log.info(`Task overdue: ${result.rows.length} task(s) marked overdue`);
            } catch (e) {
                // eventBus may not exist yet, that's ok
            }
        }
    } catch (err) {
        if (!err.message.includes('does not exist')) {
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
async function checkScheduledChatMessages() {
    try {
        const now = new Date().toISOString();
        const result = await pool.query(
            `SELECT * FROM chat_messages WHERE is_scheduled = true AND scheduled_at <= $1 LIMIT 20`,
            [now]
        );
        if (result.rows.length === 0) return;

        const { broadcastToChannel } = require('./websocket');
        const chatService = require('./chatService');

        for (const row of result.rows) {
            try {
                // Mark as sent (not scheduled anymore)
                await pool.query(
                    'UPDATE chat_messages SET is_scheduled = false WHERE id = $1', [row.id]
                );
                // Broadcast to channel
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
                log.error(`Scheduled message ${row.id} error: ${err.message}`);
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

module.exports = {
    buildAndSendDigest, sendTomorrowReminder,
    checkAutoDigest, checkAutoReminder, checkAutoBackup, checkRecurringTasks,
    checkScheduledDeletions, checkRecurringAfisha, ensureRecurringAfishaForDate,
    checkRecurringBookings, checkCertificateExpiry,
    checkTaskReminders, checkWorkDayTriggers, checkMonthlyPointsReset,
    checkStreakUpdates, checkBirthdayGreetings,
    checkEventQueue, checkSLABreach, checkScheduledAnnouncements,
    checkTaskOverdue, checkCustomerRetention, checkAutoReport,
    checkHotLeads,
    checkScheduledChatMessages,
    checkExpiredChatMessages
};
