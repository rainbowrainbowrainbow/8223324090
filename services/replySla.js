'use strict';

const REPLY_SLA_STATES = Object.freeze({
    NONE: 'none',
    ON_TRACK: 'on_track',
    DUE_SOON: 'due_soon',
    OVERDUE: 'overdue'
});

const DEFAULT_DUE_SOON_MS = 4 * 60 * 60 * 1000;

function booleanValue(value) {
    return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}

function timestampMs(value) {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

function isDeliveryFailed(status) {
    return ['failed', 'later_failed'].includes(String(status || '').toLowerCase());
}

function replyDeliveryStatus(row) {
    return row?.reply_expected_delivery_status ?? row?.delivery_status ?? null;
}

function isActiveWaitingReply(row) {
    if (!row || !booleanValue(row.reply_expected) || !row.awaiting_reply_since) return false;
    if (isDeliveryFailed(replyDeliveryStatus(row))) return false;

    const awaitingMs = timestampMs(row.awaiting_reply_since);
    if (awaitingMs === null) return false;

    const inboundMs = timestampMs(row.last_inbound_at);
    return inboundMs === null || inboundMs <= awaitingMs;
}

function deriveReplySlaState(row, options = {}) {
    if (!isActiveWaitingReply(row)) return REPLY_SLA_STATES.NONE;

    const slaMs = timestampMs(row.reply_sla_at);
    if (slaMs === null) return REPLY_SLA_STATES.NONE;

    const optionNowMs = timestampMs(options.now);
    const nowMs = optionNowMs === null ? Date.now() : optionNowMs;
    if (slaMs <= nowMs) return REPLY_SLA_STATES.OVERDUE;

    const dueSoonMs = Number.isFinite(options.dueSoonMs)
        ? Math.max(0, options.dueSoonMs)
        : DEFAULT_DUE_SOON_MS;
    return (slaMs - nowMs) <= dueSoonMs
        ? REPLY_SLA_STATES.DUE_SOON
        : REPLY_SLA_STATES.ON_TRACK;
}

module.exports = {
    REPLY_SLA_STATES,
    DEFAULT_DUE_SOON_MS,
    booleanValue,
    isDeliveryFailed,
    isActiveWaitingReply,
    deriveReplySlaState
};
