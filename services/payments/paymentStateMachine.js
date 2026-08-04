'use strict';

const { assertTransition } = require('./stateTransitions');

const CONFIRMABLE_PAYMENT_METHODS = Object.freeze({
    cash: 'cash',
    card_terminal_manual: 'card_terminal'
});

class PaymentWorkflowError extends Error {
    constructor(code, message, { status = 400, details = null } = {}) {
        super(message || code);
        this.name = 'PaymentWorkflowError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
        this.details = details;
    }
}

function normalizeTender(value) {
    const tender = String(value || '').trim().toLowerCase();
    const paymentMethod = CONFIRMABLE_PAYMENT_METHODS[tender];
    if (!paymentMethod) {
        throw new PaymentWorkflowError('payment_tender_unsupported', 'Unsupported payment tender', {
            status: 422,
            details: { tender: tender || null }
        });
    }
    return { tender, paymentMethod };
}

function assertPaymentOrderCanBeConfirmed(order = {}) {
    if (order.status !== 'draft' || order.payment_status !== 'unpaid') {
        throw new PaymentWorkflowError('payment_order_not_confirmable', 'Payment order is not confirmable', {
            status: 409,
            details: {
                status: order.status || null,
                paymentStatus: order.payment_status || order.paymentStatus || null
            }
        });
    }
    assertTransition('paymentOrder', 'draft', 'confirmed');
    assertTransition('paymentOrder', 'confirmed', 'payment_recorded');
}

function assertManualConfirmationBody({ order, body = {} }) {
    assertPaymentOrderCanBeConfirmed(order);
    const { tender, paymentMethod } = normalizeTender(body.tender || body.paymentMethod || body.payment_method);
    if (paymentMethod !== order.payment_method) {
        throw new PaymentWorkflowError('payment_tender_mismatch', 'Payment tender does not match the immutable order snapshot', {
            status: 409,
            details: { expected: order.payment_method, received: paymentMethod }
        });
    }

    const expected = BigInt(order.total_amount_minor);
    let confirmed;
    try {
        confirmed = BigInt(String(body.confirmedAmountMinor ?? body.confirmed_amount_minor ?? ''));
    } catch {
        throw new PaymentWorkflowError('payment_amount_invalid', 'Confirmed amount must be an integer minor-unit value', {
            status: 422
        });
    }
    if (confirmed !== expected) {
        throw new PaymentWorkflowError('payment_amount_mismatch', 'Confirmed amount does not match the immutable order amount', {
            status: 409,
            details: { expected: expected.toString(), received: confirmed.toString() }
        });
    }

    if (tender === 'card_terminal_manual' && body.terminalShowedSuccess !== true && body.terminal_showed_success !== true) {
        throw new PaymentWorkflowError('card_terminal_success_confirmation_required', 'Card terminal success confirmation is required', {
            status: 422
        });
    }

    for (const forbidden of ['cardNumber', 'card_number', 'cardMask', 'card_mask', 'pan', 'authCode', 'auth_code', 'rrn']) {
        if (Object.prototype.hasOwnProperty.call(body, forbidden)) {
            throw new PaymentWorkflowError('card_data_forbidden', 'Card data must not be submitted or stored', {
                status: 422,
                details: { field: forbidden }
            });
        }
    }

    return { tender, paymentMethod, amountMinor: expected };
}

module.exports = {
    CONFIRMABLE_PAYMENT_METHODS,
    PaymentWorkflowError,
    assertManualConfirmationBody,
    assertPaymentOrderCanBeConfirmed,
    normalizeTender
};
