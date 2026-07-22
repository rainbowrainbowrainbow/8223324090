'use strict';

const {
    BANQUET_MENU_PRICE_RULE_CODES,
    buildBanquetPreorderRuleContract,
    resolveBanquetPreorderPlaceType
} = require('./banquetPreorderRules');

const MENU_WORKFLOW_SCHEMA_VERSION = 1;
const MENU_WORKFLOW_MODES = Object.freeze(['preorder', 'actual']);
const ACTUAL_MENU_WORKFLOW_STATUSES = Object.freeze(['awaiting_actual', 'finalized']);
const MENU_WORKFLOW_MODE_SET = new Set(MENU_WORKFLOW_MODES);
const ACTUAL_MENU_WORKFLOW_STATUS_SET = new Set(ACTUAL_MENU_WORKFLOW_STATUSES);

function cleanText(value, max = 240) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text.slice(0, max) : null;
}

function parseObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function toIsoString(value = null) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (value) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return new Date().toISOString();
}

function money(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return fallback;
    return Math.round(number * 100) / 100;
}

function readNestedWorkflow(source = {}) {
    const extra = parseObject(source.extraData ?? source.extra_data);
    const bookingPackage = source.bookingPackage
        || source.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
    return source.menuWorkflow
        || source.menu_workflow
        || bookingPackage.menuWorkflow
        || bookingPackage.menu_workflow
        || null;
}

function hasBanquetMenuWorkflowInput(booking = {}) {
    if (Object.prototype.hasOwnProperty.call(booking, 'menuWorkflow')) return true;
    if (Object.prototype.hasOwnProperty.call(booking, 'menu_workflow')) return true;
    const topLevelPackage = booking.bookingPackage || booking.booking_package || {};
    if (Object.prototype.hasOwnProperty.call(topLevelPackage, 'menuWorkflow')) return true;
    if (Object.prototype.hasOwnProperty.call(topLevelPackage, 'menu_workflow')) return true;
    const extra = parseObject(booking.extraData ?? booking.extra_data);
    const extraPackage = extra.bookingPackage || extra.booking_package || {};
    return Object.prototype.hasOwnProperty.call(extraPackage, 'menuWorkflow')
        || Object.prototype.hasOwnProperty.call(extraPackage, 'menu_workflow');
}

function publicActor(actor = null) {
    if (!actor || typeof actor !== 'object') return null;
    const id = actor.id === undefined || actor.id === null ? null : String(actor.id);
    const username = cleanText(actor.username || actor.name || actor.email, 120);
    if (!id && !username) return null;
    return { id, username };
}

function workflowError(message, code) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 422;
    error.publicMessage = message;
    return error;
}

function buildMinimumSnapshot({ booking = {}, ruleContract = null, now = null } = {}) {
    const contract = ruleContract || buildBanquetPreorderRuleContract([]);
    const placeType = resolveBanquetPreorderPlaceType({ booking });
    const placeRule = placeType ? contract.menuMinimums?.[placeType] : null;
    return {
        schemaVersion: 1,
        source: 'price_rules',
        capturedAt: toIsoString(now),
        placeType: placeType || null,
        placeLabel: placeRule?.placeLabel || null,
        ruleCode: placeRule?.ruleCode || null,
        minimumAmount: placeRule ? money(placeRule.requiredMenuMinimum) : null,
        recommendedDepositRuleCode: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit,
        recommendedDepositAmount: money(contract.recommendedDeposit?.amount, 2000),
        currency: contract.currency || 'UAH'
    };
}

function normalizeBanquetMenuWorkflow({
    booking = {},
    previousWorkflow = null,
    ruleContract = null,
    actor = null,
    now = null
} = {}) {
    const incomingRaw = readNestedWorkflow(booking);
    const hasIncoming = incomingRaw !== undefined && incomingRaw !== null;
    const incoming = parseObject(incomingRaw);
    const previous = parseObject(previousWorkflow);
    const previousMode = cleanText(previous.mode, 40);
    const rawMode = cleanText(incoming?.mode, 40) || previousMode;

    if (!hasIncoming && !previousMode) return null;
    if (!MENU_WORKFLOW_MODE_SET.has(rawMode)) {
        throw workflowError('Invalid banquet menu workflow mode', 'MENU_WORKFLOW_INVALID_MODE');
    }

    const previousStatus = cleanText(previous.status, 40);
    let status = cleanText(incoming?.status, 40) || previousStatus || (rawMode === 'actual' ? 'awaiting_actual' : null);
    if (rawMode === 'preorder') status = null;
    if (rawMode === 'actual' && !ACTUAL_MENU_WORKFLOW_STATUS_SET.has(status)) {
        throw workflowError('Invalid actual menu workflow status', 'MENU_WORKFLOW_INVALID_STATUS');
    }
    if (hasIncoming && rawMode === 'actual' && status === 'finalized' && previousStatus !== 'finalized') {
        throw workflowError('Actual menu finalization requires the canonical finalization endpoint', 'MENU_WORKFLOW_FINALIZATION_REQUIRES_ENDPOINT');
    }

    const modeChanged = previousMode && previousMode !== rawMode;
    const selectedAt = modeChanged || !previous.selectedAt ? toIsoString(now) : previous.selectedAt;
    const selectedBy = modeChanged || !previous.selectedBy ? publicActor(actor) : previous.selectedBy;
    const minimumSnapshot = previous.minimumSnapshot && !modeChanged
        ? previous.minimumSnapshot
        : buildMinimumSnapshot({ booking, ruleContract, now });

    const normalized = {
        schemaVersion: MENU_WORKFLOW_SCHEMA_VERSION,
        mode: rawMode,
        selectedAt,
        selectedBy,
        minimumSnapshot
    };
    if (status) normalized.status = status;
    if (previous.creatorException && typeof previous.creatorException === 'object') {
        normalized.creatorException = previous.creatorException;
    }
    return normalized;
}

module.exports = {
    MENU_WORKFLOW_SCHEMA_VERSION,
    MENU_WORKFLOW_MODES,
    ACTUAL_MENU_WORKFLOW_STATUSES,
    hasBanquetMenuWorkflowInput,
    normalizeBanquetMenuWorkflow,
    buildMinimumSnapshot
};