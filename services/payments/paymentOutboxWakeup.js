'use strict';

const { createLogger } = require('../../utils/logger');

const log = createLogger('PaymentOutboxWakeup');
let scheduled = false;

function requestPaymentOutboxWakeup({ batchSize = 5, reason = 'post_commit', workerRunner = null } = {}) {
    if (String(process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED || '').trim().toLowerCase() === 'true') {
        return false;
    }
    if (scheduled) return false;
    scheduled = true;
    setImmediate(async () => {
        try {
            const processPaymentOutboxJobs = workerRunner || require('./paymentOutboxWorker').processPaymentOutboxJobs;
            await processPaymentOutboxJobs({ batchSize, lockedBy: `payment-outbox-wakeup:${process.pid}`, throwOnDegraded: false });
        } catch (error) {
            log.error(`Payment outbox wake-up skipped after ${reason}: ${String(error?.message || error).slice(0, 300)}`);
        } finally {
            scheduled = false;
        }
    });
    return true;
}

module.exports = {
    requestPaymentOutboxWakeup
};
