'use strict';

const STATE_MACHINES = Object.freeze({
    paymentOrder: Object.freeze({
        draft: ['confirmed', 'cancelled'],
        confirmed: ['payment_recorded', 'cancelled_before_fiscalization'],
        payment_recorded: ['refund_pending'],
        cancelled: [],
        cancelled_before_fiscalization: [],
        refund_pending: ['refunded', 'refund_failed', 'refund_cancelled'],
        refunded: [],
        refund_failed: ['refund_pending'],
        refund_cancelled: []
    }),
    fiscalOperation: Object.freeze({
        not_required: [],
        pending: ['validating', 'blocked', 'failed', 'cancelled'],
        validating: ['ready_to_send', 'validation_failed', 'unknown'],
        ready_to_send: ['sending'],
        sending: ['fiscalized', 'failed', 'unknown'],
        fiscalized: [],
        validation_failed: ['pending'],
        failed: ['pending', 'blocked'],
        unknown: ['pending', 'failed', 'fiscalized'],
        blocked: ['pending'],
        cancelled: []
    }),
    fiscalShift: Object.freeze({
        unknown: ['opening', 'open', 'blocked'],
        opening: ['open', 'failed', 'unknown'],
        open: ['closing', 'closed', 'unknown'],
        closing: ['closed', 'failed', 'unknown'],
        closed: ['opening'],
        failed: ['opening', 'closing', 'blocked'],
        blocked: ['unknown']
    }),
    paymentRefund: Object.freeze({
        requested: ['approved', 'cancelled'],
        approved: ['money_refund_pending'],
        money_refund_pending: ['money_refunded', 'money_refund_failed', 'money_refund_unknown'],
        money_refunded: ['fiscal_return_pending'],
        fiscal_return_pending: ['fiscal_returned', 'fiscal_return_failed', 'fiscal_return_unknown'],
        fiscal_returned: [],
        money_refund_failed: ['money_refund_pending', 'cancelled'],
        money_refund_unknown: ['money_refunded', 'money_refund_failed'],
        fiscal_return_failed: ['fiscal_return_pending'],
        fiscal_return_unknown: ['fiscal_returned', 'fiscal_return_failed'],
        cancelled: []
    })
});

function getStateMachine(name) {
    const machine = STATE_MACHINES[name];
    if (!machine) {
        throw new Error(`Unknown state machine: ${name}`);
    }
    return machine;
}

function allowedNextStates(machineName, currentState) {
    const machine = getStateMachine(machineName);
    if (!Object.prototype.hasOwnProperty.call(machine, currentState)) {
        throw new Error(`Unknown ${machineName} state: ${currentState}`);
    }
    return machine[currentState].slice();
}

function canTransition(machineName, currentState, nextState) {
    return allowedNextStates(machineName, currentState).includes(nextState);
}

function assertTransition(machineName, currentState, nextState) {
    if (!canTransition(machineName, currentState, nextState)) {
        const allowed = allowedNextStates(machineName, currentState);
        const suffix = allowed.length ? `Allowed: ${allowed.join(', ')}` : 'State is terminal.';
        throw new Error(`Invalid ${machineName} transition: ${currentState} -> ${nextState}. ${suffix}`);
    }
    return nextState;
}

module.exports = {
    STATE_MACHINES,
    allowedNextStates,
    assertTransition,
    canTransition
};
