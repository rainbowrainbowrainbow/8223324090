'use strict';

const { createLogger } = require('../../utils/logger');

const log = createLogger('PaymentOutboxWakeup');
let scheduled = false;

function requestPaymentOutboxWakeup({ batchSize = 5, reason = 'post_commit' } = {}) {
    if (scheduled) return false;
    scheduled = true;
    setImmediate(async () => {
        scheduled = false;
        try {
            const { processPaymentOutboxJobs } = require('./paymentOutboxWorker');
            await processPaymentOutboxJobs({ batchSize, lockedBy: `payment-outbox-wakeup:${process.pid}`, throwOnDegraded: false });
        } catch (error) {
            log.error(`Payment outbox wake-up skipped after ${reason}: ${String(error?.message || error).slice(0, 300)}`);
        }
    });
    return true;
}

module.exports = {
    requestPaymentOutboxWakeup
};
