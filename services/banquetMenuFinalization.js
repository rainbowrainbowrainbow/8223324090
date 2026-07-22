'use strict';

const MENU_FINALIZATION_SCHEMA_VERSION = 1;
const MENU_MINIMUM_ADJUSTMENT_CODE = 'banquet_menu_minimum_adjustment';
const MENU_BILLING_BASIS = Object.freeze({
    actualPositions: 'actual_positions',
    minimumCommitment: 'minimum_commitment',
    creatorException: 'creator_exception'
});

function cleanText(value, max = 240) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text.slice(0, max) : null;
}

function money(value, fallback = 0) {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = typeof value === 'string'
        ? value.replace(/\s+/g, '').replace(',', '.').replace(/[^\d.-]/g, '')
        : value;
    const number = Number(normalized);
    if (!Number.isFinite(number) || number < 0) return fallback;
    return Math.round(number * 100) / 100;
}

function nullableMoney(value) {
    if (value === undefined || value === null || value === '') return null;
    return money(value, null);
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

function publicActor(actor = null) {
    if (!actor || typeof actor !== 'object') return null;
    const id = actor.id === undefined || actor.id === null ? null : String(actor.id);
    const username = cleanText(actor.username || actor.name || actor.email, 120);
    if (!id && !username) return null;
    return { id, username };
}

function actorRoles(actor = null) {
    return [
        actor?.role,
        ...(Array.isArray(actor?.roles) ? actor.roles : []),
        ...(Array.isArray(actor?.extraRoles) ? actor.extraRoles : []),
        ...(Array.isArray(actor?.extra_roles) ? actor.extra_roles : [])
    ].map(role => String(role || '').trim().toLowerCase()).filter(Boolean);
}

function actorIsCreator(actor = null) {
    return actorRoles(actor).includes('creator');
}

function toIsoString(value = null) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (value) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return new Date().toISOString();
}

function normalizeMenuPosition(raw, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const title = cleanText(raw.title || raw.label || raw.name || raw.productName, 160);
    if (!title) return null;
    const quantity = money(raw.quantity ?? raw.qty, 1) || 1;
    const unitPrice = money(raw.unitPrice ?? raw.unit_price ?? raw.price, 0);
    const subtotal = money(raw.subtotal, money(quantity * unitPrice, 0));
    return {
        id: cleanText(raw.id || raw.lineId || raw.uid, 80) || `item-${index + 1}`,
        productId: cleanText(raw.productId || raw.product_id || raw.sourceItemId, 120),
        code: cleanText(raw.code || raw.productCode || raw.product_code, 80),
        title,
        quantity,
        unitPrice,
        subtotal,
        note: cleanText(raw.note || raw.notes, 500),
        menuSection: cleanText(raw.menuSection || raw.menu_section, 120),
        servingUnit: cleanText(raw.servingUnit || raw.serving_unit || raw.priceUnit, 80),
        kitchenType: cleanText(raw.kitchenType || raw.kitchen_type || raw.itemType, 40) || 'menu',
        servingTime: cleanText(raw.servingTime || raw.serving_time, 20),
        servingNote: cleanText(raw.servingNote || raw.serving_note, 500),
        servingGroupId: cleanText(raw.servingGroupId || raw.serving_group_id || raw.servingBatchId || raw.serving_batch_id, 80),
        servingBatchId: cleanText(raw.servingBatchId || raw.serving_batch_id || raw.servingGroupId || raw.serving_group_id, 80),
        weightValue: cleanText(raw.weightValue || raw.weight_value, 80),
        cakeDecoration: cleanText(raw.cakeDecoration || raw.cake_decoration, 240),
        source: cleanText(raw.source, 40) || (raw.productId || raw.product_id ? 'product' : 'custom')
    };
}

function normalizeMenuPositions(value) {
    return (Array.isArray(value) ? value : [])
        .map((item, index) => normalizeMenuPosition(item, index))
        .filter(Boolean);
}

function positionsSubtotal(positions = []) {
    return money(positions.reduce((sum, item) => sum + money(item.subtotal, 0), 0), 0);
}

function packageFromBooking(booking = {}) {
    const extra = parseObject(booking.extraData ?? booking.extra_data);
    return booking.bookingPackage
        || booking.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
}

function workflowFromPackage(bookingPackage = {}) {
    return parseObject(bookingPackage.menuWorkflow || bookingPackage.menu_workflow);
}

function minimumFromWorkflow(workflow = {}) {
    const snapshot = parseObject(workflow.minimumSnapshot || workflow.minimum_snapshot);
    return nullableMoney(snapshot.minimumAmount ?? snapshot.minimum_amount);
}

function calculationError(message, code, statusCode = 422, details = null) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    error.publicMessage = message;
    if (details) error.details = details;
    return error;
}

function buildMenuMinimumAdjustment({ amount, minimumAmount, positionsSubtotal: actualSubtotal, actor = null, reason = null, now = null, status = 'final' } = {}) {
    const normalizedAmount = money(amount, 0);
    if (normalizedAmount <= 0) return null;
    return {
        schemaVersion: 1,
        code: MENU_MINIMUM_ADJUSTMENT_CODE,
        title: 'Menu minimum adjustment',
        amount: normalizedAmount,
        minimumAmount: money(minimumAmount, 0),
        positionsSubtotal: money(actualSubtotal, 0),
        financeOnly: true,
        productionList: false,
        status,
        reason: cleanText(reason, 500),
        createdAt: toIsoString(now),
        createdBy: publicActor(actor)
    };
}

function calculateBanquetMenuFinancials({
    positionsSubtotal: rawPositionsSubtotal = 0,
    minimumAmount: rawMinimumAmount = null,
    programBasePrice = 0,
    entrySubtotal = 0,
    mode = 'preorder',
    status = null,
    allowBelowMinimumException = false
} = {}) {
    const actualSubtotal = money(rawPositionsSubtotal, 0);
    const minimumAmount = nullableMoney(rawMinimumAmount);
    const base = money(programBasePrice, 0);
    const entry = money(entrySubtotal, 0);
    const isActual = mode === 'actual';
    const isAwaiting = isActual && status === 'awaiting_actual';
    const isFinalized = isActual && status === 'finalized';
    const applies = isAwaiting || isFinalized;
    const belowMinimum = applies && minimumAmount !== null && actualSubtotal < minimumAmount;
    const adjustmentAmount = belowMinimum && !allowBelowMinimumException
        ? money(minimumAmount - actualSubtotal, 0)
        : 0;
    const menuChargedSubtotal = applies
        ? money(actualSubtotal + adjustmentAmount, 0)
        : actualSubtotal;
    const billingBasis = !applies
        ? MENU_BILLING_BASIS.actualPositions
        : (allowBelowMinimumException && belowMinimum
            ? MENU_BILLING_BASIS.creatorException
            : (belowMinimum || isAwaiting ? MENU_BILLING_BASIS.minimumCommitment : MENU_BILLING_BASIS.actualPositions));

    return {
        schemaVersion: MENU_FINALIZATION_SCHEMA_VERSION,
        applies,
        mode,
        status: status || null,
        positionsSubtotal: actualSubtotal,
        minimumAmount,
        belowMinimum,
        adjustmentAmount,
        menuChargedSubtotal,
        billingBasis,
        finalTotal: money(base + menuChargedSubtotal + entry, 0)
    };
}

function finalizedRequestFingerprint({ positions = [], allowBelowMinimumException = false, exceptionReason = null } = {}) {
    return JSON.stringify({
        positions: normalizeMenuPositions(positions).map(item => ({
            id: item.id,
            title: item.title,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal
        })),
        allowBelowMinimumException: Boolean(allowBelowMinimumException),
        exceptionReason: cleanText(exceptionReason, 500) || null
    });
}

function buildFinalizedBanquetMenuPackage({ booking = {}, actualPositions = null, actor = null, now = null, allowBelowMinimumException = false, exceptionReason = null } = {}) {
    const bookingPackage = { ...packageFromBooking(booking) };
    const workflow = workflowFromPackage(bookingPackage);
    if (workflow.mode !== 'actual' || workflow.status !== 'awaiting_actual') {
        if (workflow.mode === 'actual' && workflow.status === 'finalized') {
            const previousFingerprint = workflow.finalization?.requestFingerprint || null;
            const incomingPositions = Array.isArray(actualPositions) ? actualPositions : (bookingPackage.menuPositions || []);
            const incomingFingerprint = finalizedRequestFingerprint({ positions: incomingPositions, allowBelowMinimumException, exceptionReason });
            if (previousFingerprint && previousFingerprint === incomingFingerprint) {
                return {
                    idempotent: true,
                    bookingPackage,
                    calculation: calculateBanquetMenuFinancials({
                        positionsSubtotal: bookingPackage.positionsSubtotal,
                        minimumAmount: minimumFromWorkflow(workflow),
                        programBasePrice: bookingPackage.programBasePrice,
                        entrySubtotal: bookingPackage.entrySubtotal,
                        mode: 'actual',
                        status: 'finalized',
                        allowBelowMinimumException: Boolean(workflow.creatorException)
                    })
                };
            }
            throw calculationError('Actual menu is already finalized with different data', 'MENU_WORKFLOW_FINALIZE_CONFLICT', 409);
        }
        throw calculationError('Booking is not awaiting actual menu finalization', 'MENU_WORKFLOW_NOT_AWAITING_ACTUAL', 409);
    }

    const minimumAmount = minimumFromWorkflow(workflow);
    if (minimumAmount === null) {
        throw calculationError('Actual menu minimum snapshot is missing', 'MENU_WORKFLOW_MINIMUM_SNAPSHOT_MISSING', 422);
    }

    const positions = normalizeMenuPositions(Array.isArray(actualPositions) ? actualPositions : (bookingPackage.menuPositions || []));
    const actualSubtotal = positionsSubtotal(positions);
    const belowMinimum = actualSubtotal < minimumAmount;
    const wantsException = Boolean(allowBelowMinimumException) && belowMinimum;
    const reason = cleanText(exceptionReason, 500);
    if (wantsException && !actorIsCreator(actor)) {
        throw calculationError('Only creator can approve below-minimum actual menu exception', 'MENU_WORKFLOW_EXCEPTION_REQUIRES_CREATOR', 403);
    }
    if (wantsException && !reason) {
        throw calculationError('Creator exception reason is required', 'MENU_WORKFLOW_EXCEPTION_REASON_REQUIRED', 422);
    }

    const calculation = calculateBanquetMenuFinancials({
        positionsSubtotal: actualSubtotal,
        minimumAmount,
        programBasePrice: bookingPackage.programBasePrice,
        entrySubtotal: bookingPackage.entrySubtotal,
        mode: 'actual',
        status: 'finalized',
        allowBelowMinimumException: wantsException
    });
    const finalizedAt = toIsoString(now);
    const finalizedBy = publicActor(actor);
    const requestFingerprint = finalizedRequestFingerprint({ positions, allowBelowMinimumException: wantsException, exceptionReason: reason });
    const adjustment = buildMenuMinimumAdjustment({
        amount: calculation.adjustmentAmount,
        minimumAmount,
        positionsSubtotal: actualSubtotal,
        actor,
        reason: null,
        now,
        status: 'final'
    });
    const finalWorkflow = {
        ...workflow,
        status: 'finalized',
        finalizedAt,
        finalizedBy,
        finalization: {
            schemaVersion: 1,
            finalizedAt,
            finalizedBy,
            positionsSubtotal: actualSubtotal,
            minimumAmount,
            adjustmentAmount: calculation.adjustmentAmount,
            menuChargedSubtotal: calculation.menuChargedSubtotal,
            billingBasis: calculation.billingBasis,
            requestFingerprint
        }
    };
    if (wantsException) {
        finalWorkflow.creatorException = {
            schemaVersion: 1,
            reason,
            approvedAt: finalizedAt,
            approvedBy: finalizedBy,
            positionsSubtotal: actualSubtotal,
            minimumAmount,
            waivedAdjustmentAmount: money(minimumAmount - actualSubtotal, 0)
        };
    } else {
        delete finalWorkflow.creatorException;
    }

    const nextPackage = {
        ...bookingPackage,
        positionsSubtotal: actualSubtotal,
        menuPositions: positions,
        menuWorkflow: finalWorkflow,
        menuChargedSubtotal: calculation.menuChargedSubtotal,
        billingBasis: calculation.billingBasis,
        finalTotal: calculation.finalTotal,
        source: bookingPackage.source || 'booking_workspace'
    };
    if (adjustment) nextPackage.menuMinimumAdjustment = adjustment;
    else delete nextPackage.menuMinimumAdjustment;
    nextPackage.banquetPreorderStatus = {
        ...(bookingPackage.banquetPreorderStatus || {}),
        applies: true,
        menuStatus: belowMinimum && wantsException ? 'below_minimum_exception' : 'finalized',
        requiredMenuMinimum: minimumAmount,
        currentMenuSubtotal: actualSubtotal,
        missingMenuAmount: Math.max(0, money(minimumAmount - actualSubtotal, 0)),
        menuWorkflow: finalWorkflow,
        actualAwaiting: false,
        warnings: [],
        menuWarnings: [],
        depositWarnings: Array.isArray(bookingPackage.banquetPreorderStatus?.depositWarnings)
            ? bookingPackage.banquetPreorderStatus.depositWarnings
            : []
    };

    return {
        idempotent: false,
        bookingPackage: nextPackage,
        previousPackage: bookingPackage,
        calculation,
        adjustment,
        workflow: finalWorkflow,
        actualPositions: positions,
        previousTotal: money(booking.price ?? bookingPackage.finalTotal, 0),
        nextTotal: calculation.finalTotal
    };
}

module.exports = {
    MENU_BILLING_BASIS,
    MENU_FINALIZATION_SCHEMA_VERSION,
    MENU_MINIMUM_ADJUSTMENT_CODE,
    actorIsCreator,
    buildFinalizedBanquetMenuPackage,
    buildMenuMinimumAdjustment,
    calculateBanquetMenuFinancials,
    finalizedRequestFingerprint,
    normalizeMenuPositions,
    positionsSubtotal
};
