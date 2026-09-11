'use strict';

const PENDING_WAIT_WINDOW_MS = 120_000;
const PENDING_WAIT_MAX_DELAY_MS = 10_000;
const PENDING_WAIT_KEY = 'provider_pending_wait';

function readPendingWait(payload = {}) {
    if (!Object.hasOwn(payload || {}, PENDING_WAIT_KEY)) return null;
    const value = payload[PENDING_WAIT_KEY];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { invalid: true };
    const started = Date.parse(value.startedAt);
    const deadline = Date.parse(value.deadlineAt);
    const checked = Date.parse(value.lastCheckAt);
    if (value.version !== 1 || !Number.isFinite(started) || !Number.isFinite(deadline)
        || !Number.isFinite(checked) || deadline - started !== PENDING_WAIT_WINDOW_MS
        || checked < started || checked > deadline
        || !Number.isSafeInteger(value.checkCount) || value.checkCount < 1) {
        return { invalid: true };
    }
    return value;
}

function pendingWaitStopCode(payload, now = Date.now()) {
    const wait = readPendingWait(payload);
    if (!wait) return null;
    if (wait.invalid || Date.parse(wait.startedAt) > now || Date.parse(wait.lastCheckAt) > now) {
        return 'checkbox_pending_wait_invalid';
    }
    return now >= Date.parse(wait.deadlineAt) ? 'checkbox_pending_wait_expired' : null;
}

function nextPendingWait(payload, now = Date.now()) {
    const stopCode = pendingWaitStopCode(payload, now);
    if (stopCode) return { stopCode };
    const previous = readPendingWait(payload);
    const started = previous ? Date.parse(previous.startedAt) : now;
    const deadline = started + PENDING_WAIT_WINDOW_MS;
    const delayMs = Math.min(now - started < 30_000 ? 5_000 : PENDING_WAIT_MAX_DELAY_MS, deadline - now);
    return {
        delayMs,
        wait: {
            version: 1,
            startedAt: new Date(started).toISOString(),
            deadlineAt: new Date(deadline).toISOString(),
            lastCheckAt: new Date(now).toISOString(),
            checkCount: (previous?.checkCount || 0) + 1
        }
    };
}

module.exports = { PENDING_WAIT_WINDOW_MS, PENDING_WAIT_MAX_DELAY_MS, PENDING_WAIT_KEY, readPendingWait, pendingWaitStopCode, nextPendingWait };
