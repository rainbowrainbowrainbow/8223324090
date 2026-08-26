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
const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { lockAttendanceWriteTarget } = require('./attendanceWriteLock');
const { recordAttendanceClockOut, recordAttendanceStatus } = require('./hrAttendance');

const log = createLogger('HR');

let autoCloseSentToday = null;
let noShowSentToday = null;
let autoCloseRunning = false;
let noShowRunning = false;

function buildHrSchedulerContext(options = {}) {
    return {
        db: options.db || options.pool || pool,
        getKyivDate: options.getKyivDate || getKyivDate,
        getKyivDateStr: options.getKyivDateStr || getKyivDateStr,
        getKyivTimeStr: options.getKyivTimeStr || getKyivTimeStr,
        getConfiguredChatId: options.getConfiguredChatId || getConfiguredChatId,
        sendTelegramMessage: options.sendTelegramMessage || sendTelegramMessage,
        lockAttendanceWriteTarget: options.lockAttendanceWriteTarget || lockAttendanceWriteTarget,
        recordAttendanceClockOut: options.recordAttendanceClockOut || recordAttendanceClockOut,
        recordAttendanceStatus: options.recordAttendanceStatus || recordAttendanceStatus
    };
}

async function getLastSent(key, db = pool) {
    try {
        const r = await db.query("SELECT value FROM settings WHERE key = $1", [`last_hr_${key}`]);
        return r.rows[0]?.value || null;
    } catch { return null; }
}

async function setLastSent(key, dateStr, db = pool) {
    try {
        await db.query(
            "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
            [`last_hr_${key}`, dateStr]
        );
        return true;
    } catch (err) {
        log.error(`setLastSent(${key}) error`, err);
        return false;
    }
}

/**
 * Cron 1: Auto-close open shifts at 23:55 Kyiv
 * Runs every 60s, triggers once per day
 */
async function checkHrAutoClose(options = {}) {
    if (autoCloseRunning) {
        return { skipped: true, reason: 'already_running' };
    }
    autoCloseRunning = true;
    try {
        const context = buildHrSchedulerContext(options);
        const todayStr = context.getKyivDateStr();
        const nowTime = context.getKyivTimeStr();

        if (autoCloseSentToday === todayStr) return { skipped: true, reason: 'memory_dedup', date: todayStr };
        if (nowTime !== '23:55') return { skipped: true, reason: 'outside_window', date: todayStr, time: nowTime };

        const dbLast = await getLastSent('auto_close', context.db);
        if (dbLast === todayStr) {
            autoCloseSentToday = todayStr;
            return { skipped: true, reason: 'db_dedup', date: todayStr };
        }

        log.info(`Running HR auto-close for ${todayStr}`);

        // Find open records (clock_in set but clock_out missing)
        const open = await context.db.query(
            `SELECT tr.id, tr.staff_id, tr.clock_in, tr.planned_end,
                    s.name AS staff_name
             FROM hr_time_records tr
             JOIN staff s ON s.id = tr.staff_id
             WHERE tr.record_date = $1
               AND COALESCE(tr.business_context, 'event_genix') = $2
               AND tr.clock_in IS NOT NULL
               AND tr.clock_out IS NULL`,
            [todayStr, DEFAULT_BUSINESS_CONTEXT]
        );

        let errors = 0;
        const names = [];
        for (const rec of open.rows) {
            let client;
            try {
                client = await context.db.connect();
                await client.query('BEGIN');
                await context.lockAttendanceWriteTarget(client, { staffId: rec.staff_id, date: todayStr });

                const currentResult = await client.query(
                    `SELECT id, staff_id, clock_in, clock_out, planned_end,
                            COALESCE(business_context, 'event_genix') AS business_context
                     FROM hr_time_records
                     WHERE staff_id = $1
                       AND record_date = $2::date
                     FOR UPDATE`,
                    [rec.staff_id, todayStr]
                );
                const current = currentResult.rows[0];
                if (
                    !current
                    || current.business_context !== DEFAULT_BUSINESS_CONTEXT
                    || !current.clock_in
                    || current.clock_out
                ) {
                    await client.query('COMMIT');
                    continue;
                }

                // Auto-close: planned_end + 30min, or clock_in + 10h.
                let closeTime;
                if (current.planned_end) {
                    const [h, m] = current.planned_end.split(':').map(Number);
                    const d = new Date();
                    d.setHours(h, m + 30, 0, 0);
                    closeTime = d.toISOString();
                } else {
                    const ci = new Date(current.clock_in);
                    ci.setHours(ci.getHours() + 10);
                    closeTime = ci.toISOString();
                }

                const clockOutResult = await context.recordAttendanceClockOut(client, {
                    staffId: rec.staff_id,
                    recordDate: todayStr,
                    now: closeTime,
                    settlementMode: 'actual_time',
                    performedBy: 'system',
                    method: 'auto_close',
                    source: 'hr_auto_close'
                });
                const totalWorked = Number(clockOutResult.record?.total_worked_minutes || 0);
                const updated = await client.query(
                    `UPDATE hr_time_records SET
                        auto_closed = TRUE,
                        status = CASE WHEN status = 'manual_review' THEN status ELSE 'auto_closed' END,
                        updated_at = NOW()
                     WHERE id = $1
                       AND staff_id = $2
                       AND record_date = $3::date
                       AND COALESCE(business_context, 'event_genix') = $4
                       AND clock_in IS NOT NULL
                       AND clock_out IS NOT NULL
                     RETURNING id`,
                    [
                        current.id,
                        rec.staff_id,
                        todayStr,
                        DEFAULT_BUSINESS_CONTEXT
                    ]
                );
                if (!updated.rows[0]) {
                    await client.query('COMMIT');
                    continue;
                }

                await client.query(
                    `INSERT INTO hr_audit_log (action, staff_id, performed_by, details)
                     VALUES ('auto_close', $1, 'system', $2)`,
                    [rec.staff_id, JSON.stringify({
                        clock_out: closeTime,
                        total_worked_minutes: totalWorked,
                        compensation_snapshot_state: clockOutResult.record?.compensation_snapshot?.state || null
                    })]
                );
                await client.query('COMMIT');
                names.push(rec.staff_name);
            } catch (err) {
                errors++;
                if (client) {
                    await client.query('ROLLBACK').catch(rollbackErr => {
                        log.error(`checkHrAutoClose rollback error for record ${rec.id}`, rollbackErr);
                    });
                }
                log.error(`checkHrAutoClose record ${rec.id} error`, err);
            } finally {
                client?.release();
            }
        }

        // Telegram alert
        const chatId = await context.getConfiguredChatId();
        if (chatId && names.length > 0) {
            const text = `⚠️ <b>HR: Авто-закриття змін</b>\n\n${names.map(n => `• ${n} — не натиснув ВИХІД`).join('\n')}`;
            context.sendTelegramMessage(chatId, text).catch(err => log.error('Auto-close telegram error', err));
        }

        log.info(`HR auto-close: ${names.length} records closed`);
        if (errors > 0) {
            const failure = new Error(`checkHrAutoClose failed for ${errors} record(s)`);
            failure.result = {
                date: todayStr,
                processed: open.rows.length,
                closed: names.length,
                errors,
                markerSaved: false
            };
            throw failure;
        }
        const markerSaved = await setLastSent('auto_close', todayStr, context.db);
        if (!markerSaved) {
            throw new Error('checkHrAutoClose failed to save daily success marker');
        }
        if (markerSaved) autoCloseSentToday = todayStr;
        return {
            date: todayStr,
            processed: open.rows.length,
            closed: names.length,
            errors,
            markerSaved
        };
    } catch (err) {
        log.error('checkHrAutoClose error', err);
        if (options.throwOnError === false) return { failed: true, error: err.message, result: err.result };
        throw err;
    } finally {
        autoCloseRunning = false;
    }
}

/**
 * Cron 2: No-show detector at 13:00 Kyiv
 * Marks staff who have shifts but haven't clocked in
 */
async function checkHrNoShow(options = {}) {
    if (noShowRunning) {
        return { skipped: true, reason: 'already_running' };
    }
    noShowRunning = true;
    try {
        const context = buildHrSchedulerContext(options);
        const todayStr = context.getKyivDateStr();
        const nowTime = context.getKyivTimeStr();

        if (noShowSentToday === todayStr) return { skipped: true, reason: 'memory_dedup', date: todayStr };
        if (nowTime !== '13:00') return { skipped: true, reason: 'outside_window', date: todayStr, time: nowTime };

        const dbLast = await getLastSent('no_show', context.db);
        if (dbLast === todayStr) {
            noShowSentToday = todayStr;
            return { skipped: true, reason: 'db_dedup', date: todayStr };
        }

        log.info(`Running HR no-show check for ${todayStr}`);

        const kyiv = context.getKyivDate();
        const nowMin = kyiv.getHours() * 60 + kyiv.getMinutes();

        // Find staff with shifts but no time record (or no clock_in)
        const noShows = await context.db.query(
            `SELECT hs.staff_id, hs.planned_start, s.name AS staff_name
             FROM hr_shifts hs
             JOIN staff s ON s.id = hs.staff_id AND s.is_active = true
             LEFT JOIN hr_time_records tr ON tr.staff_id = hs.staff_id AND tr.record_date = $1
              AND COALESCE(tr.business_context, 'event_genix') = $2
             WHERE hs.shift_date = $1
               AND (tr.id IS NULL OR (tr.clock_in IS NULL AND tr.status = 'absent'))`,
            [todayStr, DEFAULT_BUSINESS_CONTEXT]
        );

        const alerts = [];
        let errors = 0;
        for (const row of noShows.rows) {
            const [h, m] = row.planned_start.split(':').map(Number);
            const shiftMin = h * 60 + m;

            // Only if planned_start was > 2 hours ago
            if (nowMin - shiftMin < 120) continue;

            let client;
            try {
                client = await context.db.connect();
                await client.query('BEGIN');
                await context.lockAttendanceWriteTarget(client, { staffId: row.staff_id, date: todayStr });

                const currentResult = await client.query(
                    `SELECT id, clock_in, status,
                            COALESCE(business_context, 'event_genix') AS business_context
                     FROM hr_time_records
                     WHERE staff_id = $1
                       AND record_date = $2::date
                     FOR UPDATE`,
                    [row.staff_id, todayStr]
                );
                const current = currentResult.rows[0];
                if (
                    current
                    && (
                        current.business_context !== DEFAULT_BUSINESS_CONTEXT
                        || current.clock_in
                        || current.status !== 'absent'
                    )
                ) {
                    await client.query('COMMIT');
                    continue;
                }

                await context.recordAttendanceStatus(client, {
                    staffId: row.staff_id,
                    recordDate: todayStr,
                    status: 'no_show',
                    businessContext: DEFAULT_BUSINESS_CONTEXT,
                    performedBy: 'system',
                    source: 'hr_no_show_scheduler'
                });

                await client.query(
                    `INSERT INTO hr_audit_log (action, staff_id, performed_by, details)
                     VALUES ('no_show', $1, 'system', $2)`,
                    [row.staff_id, JSON.stringify({ planned_start: row.planned_start })]
                );
                await client.query('COMMIT');
                alerts.push(`• ${row.staff_name} — зміна з ${row.planned_start}`);
            } catch (err) {
                errors++;
                if (client) {
                    await client.query('ROLLBACK').catch(rollbackErr => {
                        log.error(`checkHrNoShow rollback error for staff ${row.staff_id}`, rollbackErr);
                    });
                }
                log.error(`checkHrNoShow staff ${row.staff_id} error`, err);
            } finally {
                client?.release();
            }
        }

        if (alerts.length > 0) {
            const chatId = await context.getConfiguredChatId();
            if (chatId) {
                const text = `⚠️ <b>HR: Не відмітились на роботі</b>\n\n${alerts.join('\n')}`;
                context.sendTelegramMessage(chatId, text).catch(err => log.error('No-show telegram error', err));
            }
            log.info(`HR no-show: ${alerts.length} alerts`);
        }
        if (errors > 0) {
            const failure = new Error(`checkHrNoShow failed for ${errors} record(s)`);
            failure.result = {
                date: todayStr,
                processed: noShows.rows.length,
                marked: alerts.length,
                errors,
                markerSaved: false
            };
            throw failure;
        }
        const markerSaved = await setLastSent('no_show', todayStr, context.db);
        if (!markerSaved) {
            throw new Error('checkHrNoShow failed to save daily success marker');
        }
        if (markerSaved) noShowSentToday = todayStr;
        return {
            date: todayStr,
            processed: noShows.rows.length,
            marked: alerts.length,
            errors,
            markerSaved
        };
    } catch (err) {
        log.error('checkHrNoShow error', err);
        if (options.throwOnError === false) return { failed: true, error: err.message, result: err.result };
        throw err;
    } finally {
        noShowRunning = false;
    }
}

function __resetHrSchedulerStateForTests() {
    autoCloseSentToday = null;
    noShowSentToday = null;
    autoCloseRunning = false;
    noShowRunning = false;
}

module.exports = { checkHrAutoClose, checkHrNoShow, __resetHrSchedulerStateForTests };
