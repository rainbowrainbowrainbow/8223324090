/**
 * services/hr.js — HR cron jobs (v15.0)
 *
 * Cron 1: Auto-close — sends overdue shifts to HR review
 * Cron 2: No-show detector — daily at 13:00 Kyiv, marks no-shows
 */

const { pool } = require('../db');
const { sendTelegramMessage, getConfiguredChatId } = require('./telegram');
const { getKyivDate, getKyivDateStr, getKyivTimeStr } = require('./booking');
const { createLogger } = require('../utils/logger');
const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { lockAttendanceWriteTarget } = require('./attendanceWriteLock');
const { recordAttendanceStatus } = require('./hrAttendance');
const { lockPayrollPeriodMutation, acquirePayrollPeriodMutationLock, assertPayrollPeriodOpen } = require('./hrPayrollPeriod');

const log = createLogger('HR');

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

const REVIEW_ESTIMATE_SQL = `
    (tr.record_date + tr.planned_end
        + CASE WHEN tr.planned_end < tr.planned_start THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END)
`;
const DUE_FOR_REVIEW_SQL = `
    tr.record_date BETWEEN ($1::timestamptz AT TIME ZONE 'Europe/Kyiv')::date - 1
                       AND ($1::timestamptz AT TIME ZONE 'Europe/Kyiv')::date
    AND COALESCE(tr.business_context, 'event_genix') = $2
    AND tr.clock_in IS NOT NULL AND tr.clock_out IS NULL
    AND NOT COALESCE(tr.auto_closed, FALSE)
    AND (
        CASE WHEN tr.planned_start IS NOT NULL AND tr.planned_end IS NOT NULL
               AND tr.planned_end <> tr.planned_start
             THEN ((${REVIEW_ESTIMATE_SQL}) AT TIME ZONE 'Europe/Kyiv') + INTERVAL '30 minutes'
             ELSE ((tr.record_date + 1)::timestamp AT TIME ZONE 'Europe/Kyiv')
        END <= $1::timestamptz
    )
`;

async function checkHrAutoClose(options = {}) {
    if (autoCloseRunning) return { skipped: true, reason: 'already_running' };
    autoCloseRunning = true;
    try {
        const context = buildHrSchedulerContext(options);
        const now = new Date(options.now ?? Date.now()).toISOString();
        const scope = [now, DEFAULT_BUSINESS_CONTEXT];
        const due = await context.db.query(
            `SELECT tr.id, tr.staff_id, tr.record_date::text AS record_date
             FROM hr_time_records tr WHERE ${DUE_FOR_REVIEW_SQL}
             ORDER BY tr.record_date, tr.staff_id`,
            scope
        );
        let closed = 0;
        let errors = 0;
        for (const candidate of due.rows) {
            let client;
            try {
                client = await context.db.connect();
                await client.query('BEGIN');
                const month = candidate.record_date.slice(0, 7);
                await lockPayrollPeriodMutation(month, client);
                await acquirePayrollPeriodMutationLock(client, month);
                await assertPayrollPeriodOpen(month, client);
                await context.lockAttendanceWriteTarget(client, { staffId: candidate.staff_id, date: candidate.record_date });
                const result = await client.query(
                    `UPDATE hr_time_records tr
                     SET auto_closed = TRUE, status = 'manual_review', updated_at = NOW()
                     WHERE tr.id = $3 AND ${DUE_FOR_REVIEW_SQL}
                     RETURNING CASE WHEN tr.planned_end <> tr.planned_start
                        THEN (${REVIEW_ESTIMATE_SQL})::text ELSE NULL END AS estimated_end_local`,
                    [...scope, candidate.id]
                );
                if (result.rows.length) {
                    await client.query(
                        `INSERT INTO hr_audit_log (action, staff_id, performed_by, details)
                         VALUES ('auto_close', $1, 'system', $2)`,
                        [candidate.staff_id, JSON.stringify({
                            record_id: candidate.id,
                            record_date: candidate.record_date,
                            estimated_end_local: result.rows[0].estimated_end_local,
                            time_zone: 'Europe/Kyiv',
                            review_required: true
                        })]
                    );
                }
                await client.query('COMMIT');
                if (result.rows.length) closed++;
            } catch (err) {
                if (client) await client.query('ROLLBACK').catch(() => {});
                if (err.statusCode !== 423) {
                    errors++;
                    log.error('Unable to queue overdue attendance for review', err);
                }
            } finally {
                client?.release();
            }
        }
        const result = { processed: due.rows.length, closed, errors };
        if (errors) {
            const failure = new Error(`checkHrAutoClose failed for ${errors} record(s)`);
            failure.result = result;
            throw failure;
        }
        return result;
    } catch (err) {
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
               AND (tr.id IS NULL OR (tr.clock_in IS NULL AND tr.status IN ('absent', 'arrival_cancelled')))`,
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
                        || !['absent', 'arrival_cancelled'].includes(current.status)
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
    noShowSentToday = null;
    autoCloseRunning = false;
    noShowRunning = false;
}

module.exports = { checkHrAutoClose, checkHrNoShow, __resetHrSchedulerStateForTests };
