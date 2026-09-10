/**
 * services/schedulerGuard.js — Scheduler duplicate prevention & error tracking
 * v19.10: Wraps scheduler functions with dedup, error accumulation, and auto-pause.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { randomUUID } = require('node:crypto');
const { schedulerExecutionPolicy } = require('../config/schedulerSurface');

const log = createLogger('SchedulerGuard');

const MAX_CONSECUTIVE_FAILURES = 10;
const SCHEDULER_SKIP_TRACKING = Symbol('scheduler-skip-tracking');
const MIN_LEASE_MS = 50;
const MAX_LEASE_MS = 24 * 60 * 60 * 1000;

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

function normalizeLeaseMs(value, fallback) {
    const numeric = Number(value ?? fallback);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(MIN_LEASE_MS, Math.min(Math.trunc(numeric), MAX_LEASE_MS));
}

async function loadSchedulerState(db, name) {
    const result = await db.query(
        `SELECT last_run_date, last_run_at, result, is_paused, consecutive_failures
         FROM scheduler_executions
         WHERE scheduler_name = $1`,
        [name]
    );
    return result.rows[0] || null;
}

function stateSkipsExecution(state, dedup, currentKey) {
    if (!state) return false;
    if (state.is_paused) return true;
    return Boolean(currentKey && state.result === 'success' && state.last_run_date === currentKey);
}

async function tryClaimSchedulerLease(db, { name, dedup, currentKey, leaseMs, token }) {
    const result = await db.query(
        `WITH claimed AS (
             INSERT INTO scheduler_executions
                 (scheduler_name, last_run_at, last_run_date, result, consecutive_failures, error_message)
             VALUES ($1, NOW(), $2, 'running', 0, $5)
             ON CONFLICT (scheduler_name) DO UPDATE SET
                 last_run_at = NOW(),
                 last_run_date = $2,
                 result = 'running',
                 duration_ms = NULL,
                 error_message = $5
             WHERE scheduler_executions.is_paused = false
               AND (
                   scheduler_executions.result = 'error'
                   OR scheduler_executions.result = 'skipped'
                   OR (
                       scheduler_executions.result = 'running'
                       AND scheduler_executions.last_run_at <= NOW() - ($4::double precision * INTERVAL '1 millisecond')
                   )
                   OR (
                       $3::boolean = true
                       AND scheduler_executions.result IS DISTINCT FROM 'running'
                       AND scheduler_executions.last_run_date IS DISTINCT FROM $2
                   )
                   OR (
                       $3::boolean = false
                       AND scheduler_executions.result IS DISTINCT FROM 'running'
                   )
               )
             RETURNING scheduler_name, last_run_at, last_run_date, result,
                       is_paused, consecutive_failures, true AS claim_acquired
         )
         SELECT * FROM claimed
         UNION ALL
         SELECT scheduler_name, last_run_at, last_run_date, result,
                is_paused, consecutive_failures, false AS claim_acquired
           FROM scheduler_executions
          WHERE scheduler_name = $1
            AND NOT EXISTS (SELECT 1 FROM claimed)
         LIMIT 1`,
        [name, currentKey, dedup !== null, leaseMs, token]
    );
    return result.rows[0] || null;
}

function nextStateCheckAt(state, leaseMs, nowMs = Date.now()) {
    if (!state) return 0;
    if (state.is_paused) return nowMs + 60_000;
    if (state.result !== 'running') return 0;
    const lastRunMs = new Date(state.last_run_at).getTime();
    if (!Number.isFinite(lastRunMs)) return nowMs + Math.min(leaseMs, 60_000);
    return Math.max(nowMs, Math.min(lastRunMs + leaseMs, nowMs + 60_000));
}

function startLeaseHeartbeat(db, { name, token, leaseMs, heartbeatMs }, logger = log) {
    const intervalMs = normalizeLeaseMs(
        heartbeatMs,
        Math.max(1000, Math.min(60_000, Math.floor(leaseMs / 3)))
    );
    let stopped = false;
    let inFlight = Promise.resolve();
    let heartbeatPending = false;
    const timer = setInterval(() => {
        if (stopped || heartbeatPending) return;
        heartbeatPending = true;
        inFlight = db.query(
            `UPDATE scheduler_executions
             SET last_run_at = NOW()
             WHERE scheduler_name = $1 AND result = 'running' AND error_message = $2`,
            [name, token]
        ).catch(error => {
            logger.warn(`Scheduler "${name}" claim heartbeat failed`, { code: error.code || 'SCHEDULER_HEARTBEAT_FAILED' });
        }).finally(() => {
            heartbeatPending = false;
        });
    }, intervalMs);
    timer.unref?.();

    return async function stopHeartbeat() {
        stopped = true;
        clearInterval(timer);
        await inFlight;
    };
}

async function recordLeaseSuccess(db, { name, token, dateKey, durationMs }) {
    return db.query(
        `UPDATE scheduler_executions
         SET last_run_at = NOW(), last_run_date = $3, result = 'success',
             consecutive_failures = 0, is_paused = false, duration_ms = $4, error_message = NULL
         WHERE scheduler_name = $1 AND result = 'running' AND error_message = $2
         RETURNING scheduler_name`,
        [name, token, dateKey, durationMs]
    );
}

async function releaseSkippedLease(db, { name, token, durationMs }) {
    return db.query(
        `UPDATE scheduler_executions
         SET last_run_at = NOW(), last_run_date = NULL, result = 'skipped',
             duration_ms = $3, error_message = NULL
         WHERE scheduler_name = $1 AND result = 'running' AND error_message = $2`,
        [name, token, durationMs]
    );
}

async function recordOwnerSuccess(db, { name, dateKey, durationMs }) {
    return db.query(
        `INSERT INTO scheduler_executions (scheduler_name, last_run_at, last_run_date, result, consecutive_failures, duration_ms)
         VALUES ($1, NOW(), $2, 'success', 0, $3)
         ON CONFLICT (scheduler_name) DO UPDATE SET
             last_run_at = NOW(), last_run_date = $2, result = 'success',
             consecutive_failures = 0, is_paused = false, duration_ms = $3, error_message = NULL`,
        [name, dateKey, durationMs]
    );
}

async function recordFailure(db, { name, token, durationMs, message, autoPause, claimMode }) {
    if (claimMode === 'lease') {
        return db.query(
            `UPDATE scheduler_executions SET
                 last_run_at = NOW(), result = 'error',
                 consecutive_failures = consecutive_failures + 1,
                 error_message = $3, duration_ms = $4,
                 is_paused = CASE
                     WHEN $5::boolean = true AND consecutive_failures + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN true
                     ELSE is_paused
                 END
             WHERE scheduler_name = $1 AND result = 'running' AND error_message = $2
             RETURNING consecutive_failures, is_paused`,
            [name, token, message, durationMs, autoPause]
        );
    }

    return db.query(
        `INSERT INTO scheduler_executions (scheduler_name, last_run_at, result, consecutive_failures, error_message, duration_ms)
         VALUES ($1, NOW(), 'error', 1, $2, $3)
         ON CONFLICT (scheduler_name) DO UPDATE SET
             last_run_at = NOW(), result = 'error',
             consecutive_failures = scheduler_executions.consecutive_failures + 1,
             error_message = $2, duration_ms = $3,
             is_paused = CASE WHEN $4::boolean = true AND scheduler_executions.consecutive_failures + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN true ELSE scheduler_executions.is_paused END
         RETURNING consecutive_failures, is_paused`,
        [name, message, durationMs, autoPause]
    );
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
    const policy = schedulerExecutionPolicy(name);
    const claimMode = opts.claimMode || policy.claimMode;
    const leaseMs = normalizeLeaseMs(opts.leaseMs, policy.leaseMs);
    const db = opts.dbPool || pool;

    if (!['lease', 'owner'].includes(claimMode)) {
        throw new Error(`Unsupported scheduler claim mode: ${String(claimMode)}`);
    }

    // This cache belongs to one registration in one process. PostgreSQL is
    // still consulted on process start and every new dedup bucket, preserving
    // restart and multi-instance correctness while avoiding not-due polling.
    let completedKey = null;
    let nextDatabaseCheckAt = 0;

    return async function guardedScheduler() {
        const startMs = Date.now();
        const currentKey = schedulerDedupKey(dedup);
        if (currentKey && completedKey === currentKey) return;
        if (startMs < nextDatabaseCheckAt) return;
        const token = `claim:${randomUUID()}`;
        let claimAcquired = false;
        let stopHeartbeat = null;
        try {
            if (claimMode === 'owner') {
                const state = await loadSchedulerState(db, name);
                if (stateSkipsExecution(state, dedup, currentKey)) {
                    if (currentKey && state?.result === 'success') completedKey = currentKey;
                    nextDatabaseCheckAt = nextStateCheckAt(state, leaseMs, startMs);
                    return;
                }
            } else {
                const claim = await tryClaimSchedulerLease(db, { name, dedup, currentKey, leaseMs, token });
                if (!claim?.claim_acquired) {
                    if (currentKey && claim?.result === 'success' && claim.last_run_date === currentKey) {
                        completedKey = currentKey;
                    }
                    nextDatabaseCheckAt = nextStateCheckAt(claim, leaseMs, startMs);
                    return;
                }
                claimAcquired = true;
                stopHeartbeat = startLeaseHeartbeat(db, {
                    name,
                    token,
                    leaseMs,
                    heartbeatMs: opts.heartbeatMs
                });
            }

            // Execute the scheduler function
            const outcome = await fn();
            const durationMs = Date.now() - startMs;
            if (stopHeartbeat) await stopHeartbeat();
            stopHeartbeat = null;

            if (outcome === SCHEDULER_SKIP_TRACKING) {
                if (claimMode === 'lease') {
                    await releaseSkippedLease(db, { name, token, durationMs });
                }
                return;
            }

            const dateKey = schedulerTrackingKey(dedup);

            const result = claimMode === 'lease'
                ? await recordLeaseSuccess(db, { name, token, dateKey, durationMs })
                : await recordOwnerSuccess(db, { name, dateKey, durationMs });
            if (claimMode === 'lease' && result.rowCount !== 1) {
                log.error(`Scheduler "${name}" completed after losing claim ownership`);
            } else if (currentKey) {
                completedKey = currentKey;
            }
        } catch (err) {
            const durationMs = Date.now() - startMs;
            log.error(`Scheduler "${name}" failed: ${err.message}`);

            if (stopHeartbeat) await stopHeartbeat();
            stopHeartbeat = null;

            try {
                if (claimMode === 'lease' && !claimAcquired) return;
                const result = await recordFailure(db, {
                    name,
                    token,
                    durationMs,
                    message: err.message.slice(0, 500),
                    autoPause,
                    claimMode
                });

                if (result.rows[0]?.is_paused) {
                    log.error(`Scheduler "${name}" auto-paused after ${result.rows[0].consecutive_failures} consecutive failures`);
                }
            } catch (dbErr) {
                log.error(`Failed to update scheduler tracking: ${dbErr.message}`);
            }
        } finally {
            if (stopHeartbeat) await stopHeartbeat();
        }
    };
}

module.exports = {
    guardScheduler,
    schedulerDedupKey,
    skipSchedulerTracking,
    __schedulerGuardTest: Object.freeze({
        loadSchedulerState,
        normalizeLeaseMs,
        nextStateCheckAt,
        recordLeaseSuccess,
        releaseSkippedLease,
        startLeaseHeartbeat,
        stateSkipsExecution,
        tryClaimSchedulerLease
    })
};
