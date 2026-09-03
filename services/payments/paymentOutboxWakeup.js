'use strict';

const { createLogger } = require('../../utils/logger');
const { redactCheckboxDiagnostics } = require('../checkbox/errors');

const log = createLogger('PaymentOutboxWakeup');
const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 5;
const MAX_PENDING_WAKEUPS = 32;
let scheduled = false;
let running = false;
let overflowWarningEmitted = false;
const pendingWakeups = [];

function isWakeupDisabled() {
    return String(process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED || '').trim().toLowerCase() === 'true';
}

function normalizeReason(reason) {
    return redactCheckboxDiagnostics(String(reason || 'post_commit')).slice(0, 120);
}

function normalizeBatchSize(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
    return Math.max(1, Math.min(Math.trunc(parsed), MAX_BATCH_SIZE));
}

function scheduleNextWakeup() {
    if (scheduled || running || pendingWakeups.length === 0) return;
    scheduled = true;
    setImmediate(async () => {
        scheduled = false;
        if (isWakeupDisabled()) {
            pendingWakeups.length = 0;
            overflowWarningEmitted = false;
            return;
        }

        const wakeup = pendingWakeups.shift();
        if (!wakeup) return;

        running = true;
        try {
            const processPaymentOutboxJobs = wakeup.workerRunner || require('./paymentOutboxWorker').processPaymentOutboxJobs;
            await processPaymentOutboxJobs({
                batchSize: wakeup.batchSize,
                lockedBy: `payment-outbox-wakeup:${process.pid}`,
                throwOnDegraded: false
            });
        } catch (error) {
            const safeMessage = redactCheckboxDiagnostics(String(error?.message || error)).slice(0, 300);
            log.error(`Payment outbox wake-up skipped after ${wakeup.reason}: ${safeMessage}`);
        } finally {
            running = false;
            if (isWakeupDisabled()) {
                pendingWakeups.length = 0;
                overflowWarningEmitted = false;
            } else {
                if (pendingWakeups.length === 0) overflowWarningEmitted = false;
                scheduleNextWakeup();
            }
        }
    });
}

function requestPaymentOutboxWakeup({ batchSize = DEFAULT_BATCH_SIZE, reason = 'post_commit', workerRunner = null } = {}) {
    if (isWakeupDisabled()) return false;

    if (pendingWakeups.length >= MAX_PENDING_WAKEUPS) {
        if (!overflowWarningEmitted) {
            overflowWarningEmitted = true;
            log.warn(`Payment outbox wake-up queue is full after ${normalizeReason(reason)}; scheduler fallback will drain remaining jobs`);
        }
        return false;
    }

    const startsNewRun = !scheduled && !running && pendingWakeups.length === 0;
    pendingWakeups.push({
        batchSize: normalizeBatchSize(batchSize),
        reason: normalizeReason(reason),
        workerRunner
    });
    scheduleNextWakeup();
    return startsNewRun;
}

module.exports = {
    requestPaymentOutboxWakeup
};
