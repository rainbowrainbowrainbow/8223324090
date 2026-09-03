'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { requestPaymentOutboxWakeup } = require('../services/payments/paymentOutboxWakeup');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function nextImmediate() {
    return new Promise(resolve => setImmediate(resolve));
}

async function waitFor(promise, timeoutMs = 1000) {
    let timeout;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Timed out waiting for payment outbox wake-up')), timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

function restoreDisabledFlag(previous) {
    if (previous === undefined) delete process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    else process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED = previous;
}

test('disabled wake-up returns false and never invokes the worker', async () => {
    const previous = process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED = 'true';
    let calls = 0;
    try {
        const requested = requestPaymentOutboxWakeup({
            reason: 'disabled-test',
            workerRunner: async () => { calls += 1; }
        });
        assert.equal(requested, false);
        await nextImmediate();
        assert.equal(calls, 0);
    } finally {
        restoreDisabledFlag(previous);
    }
});

test('signals queued before the first callback preserve default and explicit batch sizes', async () => {
    const previous = process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    delete process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    const allFinished = deferred();
    const calls = [];
    let activeRuns = 0;
    let maxActiveRuns = 0;
    const workerRunner = async options => {
        calls.push(options);
        activeRuns += 1;
        maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
        await nextImmediate();
        activeRuns -= 1;
        if (calls.length === 4) allFinished.resolve();
        return { claimed: 0, succeeded: 0, failed: 0 };
    };

    try {
        assert.equal(requestPaymentOutboxWakeup({ reason: 'first', workerRunner }), true);
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 1, reason: 'phase1-close', workerRunner }), false);
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 3, reason: 'before-start-three', workerRunner }), false);
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 99, reason: 'before-start-clamped', workerRunner }), false);

        await waitFor(allFinished.promise);
        await nextImmediate();
        assert.equal(calls.length, 4);
        assert.equal(maxActiveRuns, 1);
        assert.deepEqual(calls.map(call => call.batchSize), [5, 1, 3, 5]);
        assert.ok(calls.every(call => call.throwOnDegraded === false));

        await nextImmediate();
        await nextImmediate();
        assert.equal(calls.length, 4, 'Wake-up queue must stop after the finite number of signals');
    } finally {
        restoreDisabledFlag(previous);
    }
});

test('every signal received while the worker is running gets one trailing sequential run', async () => {
    const previous = process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    delete process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const allFinished = deferred();
    const calls = [];
    let activeRuns = 0;
    let maxActiveRuns = 0;
    const workerRunner = async options => {
        calls.push(options);
        activeRuns += 1;
        maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
        if (calls.length === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
        }
        activeRuns -= 1;
        if (calls.length === 4) allFinished.resolve();
        return { claimed: 0, succeeded: 0, failed: 0 };
    };

    try {
        assert.equal(requestPaymentOutboxWakeup({ reason: 'running-first', workerRunner }), true);
        await waitFor(firstStarted.promise);
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 1, reason: 'running-two', workerRunner }), false);
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 2, reason: 'running-three', workerRunner }), false);
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 4, reason: 'running-four', workerRunner }), false);
        releaseFirst.resolve();

        await waitFor(allFinished.promise);
        await nextImmediate();
        assert.equal(calls.length, 4);
        assert.equal(maxActiveRuns, 1);
        assert.deepEqual(calls.map(call => call.batchSize), [5, 1, 2, 4]);

        await nextImmediate();
        await nextImmediate();
        assert.equal(calls.length, 4, 'Trailing signals must not create an internal busy loop');
    } finally {
        releaseFirst.resolve();
        restoreDisabledFlag(previous);
    }
});

test('pending signals are capped and overflow remains for the scheduler fallback', async () => {
    const previous = process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    delete process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    const boundedQueueFinished = deferred();
    let calls = 0;
    const workerRunner = async options => {
        calls += 1;
        assert.equal(options.batchSize, 1);
        if (calls === 32) boundedQueueFinished.resolve();
        return { claimed: 0, succeeded: 0, failed: 0 };
    };

    try {
        for (let index = 0; index < 40; index += 1) {
            requestPaymentOutboxWakeup({ batchSize: 1, reason: `bounded-${index}`, workerRunner });
        }
        await waitFor(boundedQueueFinished.promise);
        await nextImmediate();
        await nextImmediate();
        assert.equal(calls, 32, 'Overflow signals must not grow the in-memory wake-up queue without a bound');

        const postDrainFinished = deferred();
        assert.equal(requestPaymentOutboxWakeup({
            reason: 'post-drain',
            workerRunner: async options => {
                assert.equal(options.batchSize, 5);
                postDrainFinished.resolve();
            }
        }), true);
        await waitFor(postDrainFinished.promise);
        await nextImmediate();
    } finally {
        restoreDisabledFlag(previous);
    }
});

test('a runner error does not discard a trailing request or leave wake-up stuck', async () => {
    const previous = process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    delete process.env.PAYMENT_OUTBOX_WAKEUP_DISABLED;
    const failingStarted = deferred();
    const releaseFailure = deferred();
    const trailingFinished = deferred();
    let failingCalls = 0;
    let recoveryCalls = 0;

    const failingRunner = async () => {
        failingCalls += 1;
        failingStarted.resolve();
        await releaseFailure.promise;
        throw new Error('planned wake-up failure');
    };
    const recoveryRunner = async options => {
        recoveryCalls += 1;
        assert.equal(options.batchSize, 1);
        trailingFinished.resolve();
        return { claimed: 0, succeeded: 0, failed: 0 };
    };

    try {
        assert.equal(requestPaymentOutboxWakeup({ reason: 'failing', workerRunner: failingRunner }), true);
        await waitFor(failingStarted.promise);
        assert.equal(requestPaymentOutboxWakeup({ batchSize: 1, reason: 'recover-after-error', workerRunner: recoveryRunner }), false);
        releaseFailure.resolve();

        await waitFor(trailingFinished.promise);
        await nextImmediate();
        assert.equal(failingCalls, 1);
        assert.equal(recoveryCalls, 1);

        const idleRunFinished = deferred();
        assert.equal(requestPaymentOutboxWakeup({
            reason: 'after-recovery',
            workerRunner: async options => {
                assert.equal(options.batchSize, 5);
                idleRunFinished.resolve();
            }
        }), true);
        await waitFor(idleRunFinished.promise);
        await nextImmediate();
    } finally {
        releaseFailure.resolve();
        restoreDisabledFlag(previous);
    }
});
