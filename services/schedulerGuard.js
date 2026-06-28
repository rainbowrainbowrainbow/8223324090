/**
 * services/schedulerGuard.js — Scheduler duplicate prevention & error tracking
 * v19.10: Wraps scheduler functions with dedup, error accumulation, and auto-pause.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('SchedulerGuard');

const MAX_CONSECUTIVE_FAILURES = 10;
const SUPPORTED_DEDUP = new Set(['daily', 'hourly', '5min', null]);

function normalizeDedup(opts = {}) {
    const dedup = Object.prototype.hasOwnProperty.call(opts, 'dedup') ? opts.dedup : 'daily';
    if (!SUPPORTED_DEDUP.has(dedup)) {
        throw new Error(`Unsupported scheduler dedup: ${String(dedup)}`);
    }
    return dedup;
}

function getSchedulerDate(now = new Date()) {
    return new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
}

function schedulerDedupKey(dedup, now = new Date()) {
    if (dedup === null) return null;

    const schedulerDate = getSchedulerDate(now);
    if (dedup === 'daily') {
        return schedulerDate.toISOString().slice(0, 10);
    }
    if (dedup === 'hourly') {
        return schedulerDate.toISOString().slice(0, 13);
    }
    if (dedup === '5min') {
        const minute = String(Math.floor(schedulerDate.getMinutes() / 5) * 5).padStart(2, '0');
        return `${schedulerDate.toISOString().slice(0, 14)}${minute}`;
    }

    throw new Error(`Unsupported scheduler dedup: ${String(dedup)}`);
}

function schedulerTrackingKey(dedup, now = new Date()) {
    return schedulerDedupKey(dedup, now) || getSchedulerDate(now).toISOString().slice(0, 16);
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
            await fn();

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
                         is_paused = CASE WHEN scheduler_executions.consecutive_failures + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN true ELSE scheduler_executions.is_paused END
                     RETURNING consecutive_failures, is_paused`,
                    [name, err.message.slice(0, 500), durationMs]
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

module.exports = { guardScheduler, schedulerDedupKey };
