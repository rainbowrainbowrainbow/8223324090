'use strict';

const { readPendingWait, pendingWaitStopCode } = require('./paymentPendingWait');

function timestamp(value) {
    if (!value) return null;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function paymentProgress({ order = {}, operation = {}, job = {}, now = Date.now() } = {}) {
    const payload = job.payload || {};
    const wait = readPendingWait(payload);
    const stopCode = pendingWaitStopCode(payload, now);
    const externalStage = job.external_stage || operation.external_stage || null;
    const done = order.fiscal_status === 'fiscalized' || operation.status === 'fiscalized';
    const stopped = ['dead', 'cancelled', 'succeeded'].includes(job.status);
    const inconsistentPayment = done && order.payment_status !== 'confirmed';
    const attentionReason = inconsistentPayment ? 'payment_fiscal_status_conflict' : done ? null : stopCode || job.last_error_code || operation.last_error_code
        || (job.status === 'dead' ? 'payment_outbox_dead' : null);
    const waiting = !done && !stopped && !attentionReason && wait && !wait.invalid;
    let stage = 'unknown';
    if (inconsistentPayment) {
        stage = 'attention_required';
    } else if (order.payment_status !== 'confirmed') {
        stage = order.payment_status === 'unpaid' ? 'awaiting_payment' : 'unknown';
    } else if (done) {
        stage = 'complete';
    } else if (stopCode || job.status === 'dead' || ['blocked', 'validation_failed'].includes(operation.status)) {
        stage = 'attention_required';
    } else if (waiting && ['receipt_sell', 'receipt_status_lookup'].includes(job.job_type)) {
        stage = 'awaiting_receipt';
    } else if (['CREATED', 'OPENING'].includes(operation.related_shift_lifecycle_stage)
        && !['sale_submit', 'receipt_lookup', 'complete'].includes(externalStage)) {
        stage = 'awaiting_shift';
    } else {
        stage = ({
            auth: 'preparing', readiness: 'checking_readiness', receipt_validation: 'validating',
            sale_submit: 'submitting', receipt_lookup: 'checking_receipt'
        })[externalStage] || 'unknown';
    }
    const stageTimestamp = stage === 'complete' ? operation.completed_at
        : stage === 'awaiting_receipt' ? wait.startedAt
        : ['preparing', 'checking_readiness', 'validating', 'submitting', 'checking_receipt'].includes(stage)
            ? payload.external_stage_recorded_at : null;
    return {
        stage,
        stageUpdatedAt: timestamp(stageTimestamp),
        lastCheckAt: timestamp(wait && !wait.invalid ? wait.lastCheckAt : null),
        nextCheckAt: !done && !stopCode && ['queued', 'failed'].includes(job.status)
            && ['sale_submit', 'receipt_lookup'].includes(externalStage) ? timestamp(job.next_run_at || operation.next_status_check_at) : null,
        waitDeadlineAt: wait && !wait.invalid && !done ? timestamp(wait.deadlineAt) : null,
        attentionReason: !attentionReason ? null : typeof attentionReason === 'string' && /^[a-z0-9_]{1,80}$/.test(attentionReason)
            ? attentionReason : 'payment_processing_error'
    };
}

module.exports = { paymentProgress };
