/**
 * services/hr.js — HR cron jobs (v15.0)
 *
 * Cron 1: Auto-close — daily at 23:55 Kyiv, closes open time records
 * Cron 2: No-show detector — daily at 13:00 Kyiv, marks no-shows
 */

const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId } = require('./telegram');
const { getKyivDate, getKyivDateStr, getKyivTimeStr } = require('./booking');
const { createLogger } = require('../utils/logger');

const log = createLogger('HR');

let autoCloseSentToday = null;
let noShowSentToday = null;

async function getLastSent(key) {
    try {
        const r = await pool.query("SELECT value FROM settings WHERE key = $1", [`last_hr_${key}`]);
        return r.rows[0]?.value || null;
    } catch { return null; }
}

async function setLastSent(key, dateStr) {
    try {
        await pool.query(
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
            [`last_hr_${key}`, dateStr]
        );
    } catch (err) { log.error(`setLastSent(${key}) error`, err); }
}

/**
 * Cron 1: Auto-close open shifts at 23:55 Kyiv
 * Runs every 60s, triggers once per day
 */
async function checkHrAutoClose() {
    try {
        const todayStr = getKyivDateStr();
        const nowTime = getKyivTimeStr();

        if (autoCloseSentToday === todayStr) return;
        if (nowTime !== '23:55') return;

        const dbLast = await getLastSent('auto_close');
        if (dbLast === todayStr) { autoCloseSentToday = todayStr; return; }

        autoCloseSentToday = todayStr;
        await setLastSent('auto_close', todayStr);

        log.info(`Running HR auto-close for ${todayStr}`);

        // Find open records (clock_in set but clock_out missing)
        const open = await pool.query(
            `SELECT tr.id, tr.staff_id, tr.clock_in, tr.planned_end,
                    s.name AS staff_name
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             WHERE tr.record_date = $1 AND tr.clock_in IS NOT NULL AND tr.clock_out IS NULL`,
            [todayStr]
        );

        if (open.rows.length === 0) return;

        const names = [];
        for (const rec of open.rows) {
            // Auto-close: planned_end + 30min, or clock_in + 10h
            let closeTime;
            if (rec.planned_end) {
                const [h, m] = rec.planned_end.split(':').map(Number);
                const d = new Date();
                d.setHours(h, m + 30, 0, 0);
                closeTime = d.toISOString();
            } else {
                const ci = new Date(rec.clock_in);
                ci.setHours(ci.getHours() + 10);
                closeTime = ci.toISOString();
            }

            const clockInDate = new Date(rec.clock_in);
            const clockOutDate = new Date(closeTime);
            const totalWorked = Math.max(0, Math.round((clockOutDate - clockInDate) / 60000));

            await pool.query(
                `UPDATE hr_time_records SET
                    clock_out = $1, total_worked_minutes = $2,
                    auto_closed = TRUE, status = 'auto_closed', updated_at = NOW()
                 WHERE id = $3`,
                [closeTime, totalWorked, rec.id]
            );

            await pool.query(
                `INSERT INTO hr_audit_log (action, staff_id, performed_by, details)
                 VALUES ('auto_close', $1, 'system', $2)`,
                [rec.staff_id, JSON.stringify({ clock_out: closeTime, total_worked_minutes: totalWorked })]
            );

            names.push(rec.staff_name);
        }

        // Telegram alert
        const chatId = await getConfiguredChatId();
        if (chatId && names.length > 0) {
            const text = `⚠️ <b>HR: Авто-закриття змін</b>\n\n${names.map(n => `• ${n} — не натиснув ВИХІД`).join('\n')}`;
            sendTelegramMessage(chatId, text).catch(err => log.error('Auto-close telegram error', err));
        }

        log.info(`HR auto-close: ${names.length} records closed`);
    } catch (err) {
        log.error('checkHrAutoClose error', err);
    }
}

/**
 * Cron 2: No-show detector at 13:00 Kyiv
 * Marks staff who have shifts but haven't clocked in
 */
async function checkHrNoShow() {
    try {
        const todayStr = getKyivDateStr();
        const nowTime = getKyivTimeStr();

        if (noShowSentToday === todayStr) return;
        if (nowTime !== '13:00') return;

        const dbLast = await getLastSent('no_show');
        if (dbLast === todayStr) { noShowSentToday = todayStr; return; }

        noShowSentToday = todayStr;
        await setLastSent('no_show', todayStr);

        log.info(`Running HR no-show check for ${todayStr}`);

        const kyiv = getKyivDate();
        const nowMin = kyiv.getHours() * 60 + kyiv.getMinutes();

        // Find staff with shifts but no time record (or no clock_in)
        const noShows = await pool.query(
            `SELECT hs.staff_id, hs.planned_start, s.name AS staff_name
             FROM hr_shifts hs
             JOIN staff s ON s.id = hs.staff_id AND s.is_active = true
             LEFT JOIN hr_time_records tr ON tr.staff_id = hs.staff_id AND tr.record_date = $1
             WHERE hs.shift_date = $1
               AND (tr.id IS NULL OR (tr.clock_in IS NULL AND tr.status = 'absent'))`,
            [todayStr]
        );

        const alerts = [];
        for (const row of noShows.rows) {
            const [h, m] = row.planned_start.split(':').map(Number);
            const shiftMin = h * 60 + m;

            // Only if planned_start was > 2 hours ago
            if (nowMin - shiftMin < 120) continue;

            // Upsert no_show status
            await pool.query(
                `INSERT INTO hr_time_records (staff_id, record_date, status)
                 VALUES ($1, $2, 'no_show')
                 ON CONFLICT (staff_id, record_date) DO UPDATE SET status = 'no_show', updated_at = NOW()
                 WHERE hr_time_records.clock_in IS NULL`,
                [row.staff_id, todayStr]
            );

            await pool.query(
                `INSERT INTO hr_audit_log (action, staff_id, performed_by, details)
                 VALUES ('no_show', $1, 'system', $2)`,
                [row.staff_id, JSON.stringify({ planned_start: row.planned_start })]
            );

            alerts.push(`• ${row.staff_name} — зміна з ${row.planned_start}`);
        }

        if (alerts.length > 0) {
            const chatId = await getConfiguredChatId();
            if (chatId) {
                const text = `⚠️ <b>HR: Не відмітились на роботі</b>\n\n${alerts.join('\n')}`;
                sendTelegramMessage(chatId, text).catch(err => log.error('No-show telegram error', err));
            }
            log.info(`HR no-show: ${alerts.length} alerts`);
        }
    } catch (err) {
        log.error('checkHrNoShow error', err);
    }
}

module.exports = { checkHrAutoClose, checkHrNoShow };
