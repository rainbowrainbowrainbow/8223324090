/**
 * services/schedulerGuard.js — Scheduler duplicate prevention & error tracking
 * v19.10: Wraps scheduler functions with dedup, error accumulation, and auto-pause.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('SchedulerGuard');

const MAX_CONSECUTIVE_FAILURES = 10;
const SCHEDULER_SKIP_TRACKING = Symbol('scheduler-skip-tracking');

function skipSchedulerTracking() {
    return SCHEDULER_SKIP_TRACKING;
}
const SUPPORTED_DEDUP = new Set(['daily', 'hourly', '5min', null]);
const SCHEDULER_TIME_ZONE = 'Europe/Kyiv';
const SCHEDULER_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
});

function normalizeDedup(opts = {}) {
    const dedup = Object.prototype.hasOwnProperty.call(opts, 'dedup') ? opts.dedup : 'daily';
    if (!SUPPORTED_DEDUP.has(dedup)) {
        throw new Error(`Unsupported scheduler dedup: ${String(dedup)}`);
    }
    return dedup;
}

function getSchedulerDateParts(now = new Date()) {
    const parts = Object.fromEntries(
        SCHEDULER_DATE_FORMATTER
            .formatToParts(now)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
    );

    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: parts.hour,
        minute: parts.minute
    };
}

function schedulerDedupKey(dedup, now = new Date()) {
    if (dedup === null) return null;

    const schedulerDate = getSchedulerDateParts(now);
    if (dedup === 'daily') {
        return schedulerDate.date;
    }
    if (dedup === 'hourly') {
        return `${schedulerDate.date}T${schedulerDate.hour}`;
    }
    if (dedup === '5min') {
        const minute = String(Math.floor(Number(schedulerDate.minute) / 5) * 5).padStart(2, '0');
        return `${schedulerDate.date}T${schedulerDate.hour}:${minute}`;
    }

    throw new Error(`Unsupported scheduler dedup: ${String(dedup)}`);
}

function schedulerTrackingKey(dedup, now = new Date()) {
    const schedulerDate = getSchedulerDateParts(now);
    return schedulerDedupKey(dedup, now) || `${schedulerDate.date}T${schedulerDate.hour}:${schedulerDate.minute}`;
}

/**
 * Wrap a scheduler function with:
 * 1. Duplicate execution prevention (skip if already ran for this period)
 * 2. Error accumulation tracking (pause after N consecutive failures)
 * 3. Duration tracking
 *
 * @param {string} name - Scheduler name (matches scheduler_executions.scheduler_name)
 * @param {Function} fn - Original async scheduler function
 * @param {Object} opts - Options
 * @param {string|null} opts.dedup - 'daily', 'hourly', '5min', or null for no skip
 * @returns {Function} Wrapped scheduler function
 */
function guardScheduler(name, fn, opts = {}) {
    const dedup = normalizeDedup(opts);
    const autoPause = opts.autoPause !== false;

    return async function guardedScheduler() {
        const startMs = Date.now();
        try {
            // Check if paused or already executed
            const check = await pool.query(
                'SELECT last_run_date, is_paused, consecutive_failures FROM scheduler_executions WHERE scheduler_name = $1',
                [name]
            );

            if (check.rows.length > 0) {
                const row = check.rows[0];

                if (row.is_paused) {
                    return; // Silently skip paused schedulers
                }

                const currentKey = schedulerDedupKey(dedup);

                if (currentKey && row.last_run_date === currentKey) {
                    return; // Already ran for this period
                }
            }

            // Execute the scheduler function
            const outcome = await fn();
            if (outcome === SCHEDULER_SKIP_TRACKING) return;

            const durationMs = Date.now() - startMs;
            const dateKey = schedulerTrackingKey(dedup);

            // Record success
            await pool.query(
                `INSERT INTO scheduler_executions (scheduler_name, last_run_at, last_run_date, result, consecutive_failures, duration_ms)
                 VALUES ($1, NOW(), $2, 'success', 0, $3)
                 ON CONFLICT (scheduler_name) DO UPDATE SET
                     last_run_at = NOW(), last_run_date = $2, result = 'success',
                     consecutive_failures = 0, is_paused = false, duration_ms = $3, error_message = NULL`,
                [name, dateKey, durationMs]
            );
        } catch (err) {
            const durationMs = Date.now() - startMs;
            log.error(`Scheduler "${name}" failed: ${err.message}`);

            try {
                const result = await pool.query(
                    `INSERT INTO scheduler_executions (scheduler_name, last_run_at, result, consecutive_failures, error_message, duration_ms)
                     VALUES ($1, NOW(), 'error', 1, $2, $3)
                     ON CONFLICT (scheduler_name) DO UPDATE SET
                         last_run_at = NOW(), result = 'error',
                         consecutive_failures = scheduler_executions.consecutive_failures + 1,
                         error_message = $2, duration_ms = $3,
                         is_paused = CASE WHEN $4::boolean = true AND scheduler_executions.consecutive_failures + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN true ELSE scheduler_executions.is_paused END
                     RETURNING consecutive_failures, is_paused`,
                    [name, err.message.slice(0, 500), durationMs, autoPause]
                );

                if (result.rows[0]?.is_paused) {
                    log.error(`Scheduler "${name}" auto-paused after ${result.rows[0].consecutive_failures} consecutive failures`);
                }
            } catch (dbErr) {
                log.error(`Failed to update scheduler tracking: ${dbErr.message}`);
            }
        }
    };
}

module.exports = { guardScheduler, schedulerDedupKey, skipSchedulerTracking };
