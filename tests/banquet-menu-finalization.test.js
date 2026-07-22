'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const routePath = path.join(repoRoot, 'routes', 'bookings.js');

const {
    MENU_MINIMUM_ADJUSTMENT_CODE,
    buildFinalizedBanquetMenuPackage,
    calculateBanquetMenuFinancials
} = require('../services/banquetMenuFinalization');
const { buildBanquetPreorderRuleContract, BANQUET_MENU_PRICE_RULE_CODES } = require('../services/banquetPreorderRules');
const { applyBookingPackage } = require('../services/bookingPackage');

function actualBooking(overrides = {}) {
    return {
        id: 42,
        category: 'kitchen',
        room: 'table 4',
        price: 2500,
        extraData: {
            bookingPackage: {
                programBasePrice: 0,
                entrySubtotal: 0,
                positionsSubtotal: 1900,
                finalTotal: 2500,
                menuPositions: [
                    { id: 'tea', title: 'Tea', quantity: 1, unitPrice: 900, subtotal: 900 },
                    { id: 'cake', title: 'Cake', quantity: 1, unitPrice: 1000, subtotal: 1000 }
                ],
                menuWorkflow: {
                    schemaVersion: 1,
                    mode: 'actual',
                    status: 'awaiting_actual',
                    selectedAt: '2026-07-22T09:00:00.000Z',
                    selectedBy: { id: '7', username: 'manager' },
                    minimumSnapshot: {
                        schemaVersion: 1,
                        source: 'price_rules',
                        placeType: 'table',
                        ruleCode: BANQUET_MENU_PRICE_RULE_CODES.table,
                        minimumAmount: 2500,
                        recommendedDepositAmount: 2000,
                        currency: 'UAH'
                    }
                },
                banquetPreorderStatus: {
                    depositWarnings: [{ code: 'banquet_deposit_missing' }]
                }
            }
        },
        ...overrides
    };
}

test('actual awaiting menu financials charge the minimum commitment without mutating payments', () => {
    const calculation = calculateBanquetMenuFinancials({
        positionsSubtotal: 1900,
        minimumAmount: 2500,
        mode: 'actual',
        status: 'awaiting_actual'
    });

    assert.equal(calculation.applies, true);
    assert.equal(calculation.positionsSubtotal, 1900);
    assert.equal(calculation.minimumAmount, 2500);
    assert.equal(calculation.adjustmentAmount, 600);
    assert.equal(calculation.menuChargedSubtotal, 2500);
    assert.equal(calculation.billingBasis, 'minimum_commitment');
    assert.equal(calculation.finalTotal, 2500);
});

test('applyBookingPackage stores actual minimum billing separately from menu production positions', () => {
    const booking = {
        category: 'kitchen',
        room: 'table 4',
        price: 1900,
        menuPositions: [
            { id: 'tea', title: 'Tea', quantity: 1, unitPrice: 900, subtotal: 900 },
            { id: 'cake', title: 'Cake', quantity: 1, unitPrice: 1000, subtotal: 1000 }
        ],
        menuWorkflow: { mode: 'actual' }
    };

    applyBookingPackage(booking, {
        banquetPreorderRuleContract: buildBanquetPreorderRuleContract([
            { code: BANQUET_MENU_PRICE_RULE_CODES.table, value: 2500 },
            { code: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit, value: 2000 }
        ]),
        actor: { id: 10, username: 'manager' },
        now: '2026-07-22T12:00:00.000Z'
    });

    assert.equal(booking.price, 2500);
    assert.equal(booking.extraData.bookingPackage.positionsSubtotal, 1900);
    assert.equal(booking.extraData.bookingPackage.menuChargedSubtotal, 2500);
    assert.equal(booking.extraData.bookingPackage.billingBasis, 'minimum_commitment');
    assert.equal(Object.prototype.hasOwnProperty.call(booking.extraData.bookingPackage, 'menuMinimumAdjustment'), false);
    assert.deepEqual(booking.extraData.bookingPackage.menuPositions.map(item => item.title), ['Tea', 'Cake']);
});

test('finalization creates a finance-only minimum adjustment when actual menu is below minimum', () => {
    const result = buildFinalizedBanquetMenuPackage({
        booking: actualBooking(),
        actualPositions: [
            { id: 'tea', title: 'Tea', quantity: 1, unitPrice: 900, subtotal: 900 },
            { id: 'cake', title: 'Cake', quantity: 1, unitPrice: 1000, subtotal: 1000 }
        ],
        actor: { id: 7, username: 'manager', role: 'manager' },
        now: '2026-07-22T13:00:00.000Z'
    });

    assert.equal(result.idempotent, false);
    assert.equal(result.nextTotal, 2500);
    assert.equal(result.calculation.positionsSubtotal, 1900);
    assert.equal(result.calculation.adjustmentAmount, 600);
    assert.equal(result.bookingPackage.menuWorkflow.status, 'finalized');
    assert.equal(result.bookingPackage.menuChargedSubtotal, 2500);
    assert.equal(result.bookingPackage.billingBasis, 'minimum_commitment');
    assert.equal(result.bookingPackage.menuMinimumAdjustment.code, MENU_MINIMUM_ADJUSTMENT_CODE);
    assert.equal(result.bookingPackage.menuMinimumAdjustment.amount, 600);
    assert.equal(result.bookingPackage.menuMinimumAdjustment.financeOnly, true);
    assert.equal(result.bookingPackage.menuMinimumAdjustment.productionList, false);
    assert.deepEqual(result.bookingPackage.menuPositions.map(item => item.title), ['Tea', 'Cake']);
    assert.deepEqual(result.bookingPackage.banquetPreorderStatus.depositWarnings, [{ code: 'banquet_deposit_missing' }]);
});

test('finalization above minimum does not create an adjustment', () => {
    const result = buildFinalizedBanquetMenuPackage({
        booking: actualBooking(),
        actualPositions: [
            { id: 'banquet', title: 'Banquet menu', quantity: 1, unitPrice: 2800, subtotal: 2800 }
        ],
        actor: { id: 7, username: 'manager', role: 'manager' },
        now: '2026-07-22T13:00:00.000Z'
    });

    assert.equal(result.nextTotal, 2800);
    assert.equal(result.calculation.adjustmentAmount, 0);
    assert.equal(result.bookingPackage.menuChargedSubtotal, 2800);
    assert.equal(result.bookingPackage.billingBasis, 'actual_positions');
    assert.equal(Object.prototype.hasOwnProperty.call(result.bookingPackage, 'menuMinimumAdjustment'), false);
});

test('only creator can finalize below minimum with an exception reason', () => {
    assert.throws(
        () => buildFinalizedBanquetMenuPackage({
            booking: actualBooking(),
            actualPositions: [{ id: 'tea', title: 'Tea', quantity: 1, unitPrice: 1900, subtotal: 1900 }],
            actor: { id: 9, username: 'manager', role: 'manager' },
            allowBelowMinimumException: true,
            exceptionReason: 'owner approved'
        }),
        error => error.code === 'MENU_WORKFLOW_EXCEPTION_REQUIRES_CREATOR' && error.statusCode === 403
    );

    assert.throws(
        () => buildFinalizedBanquetMenuPackage({
            booking: actualBooking(),
            actualPositions: [{ id: 'tea', title: 'Tea', quantity: 1, unitPrice: 1900, subtotal: 1900 }],
            actor: { id: 1, username: 'owner', role: 'creator' },
            allowBelowMinimumException: true,
            exceptionReason: ''
        }),
        error => error.code === 'MENU_WORKFLOW_EXCEPTION_REASON_REQUIRED' && error.statusCode === 422
    );

    const result = buildFinalizedBanquetMenuPackage({
        booking: actualBooking(),
        actualPositions: [{ id: 'tea', title: 'Tea', quantity: 1, unitPrice: 1900, subtotal: 1900 }],
        actor: { id: 1, username: 'owner', role: 'creator' },
        now: '2026-07-22T13:00:00.000Z',
        allowBelowMinimumException: true,
        exceptionReason: 'owner approved service recovery'
    });

    assert.equal(result.nextTotal, 1900);
    assert.equal(result.calculation.adjustmentAmount, 0);
    assert.equal(result.bookingPackage.billingBasis, 'creator_exception');
    assert.equal(result.bookingPackage.menuWorkflow.creatorException.reason, 'owner approved service recovery');
    assert.equal(Object.prototype.hasOwnProperty.call(result.bookingPackage, 'menuMinimumAdjustment'), false);
});

test('finalization retry is idempotent only for the same request fingerprint', () => {
    const first = buildFinalizedBanquetMenuPackage({
        booking: actualBooking(),
        actualPositions: [{ id: 'tea', title: 'Tea', quantity: 1, unitPrice: 2500, subtotal: 2500 }],
        actor: { id: 7, username: 'manager', role: 'manager' },
        now: '2026-07-22T13:00:00.000Z'
    });
    const finalizedBooking = actualBooking({
        price: first.nextTotal,
        extraData: { bookingPackage: first.bookingPackage }
    });

    const retry = buildFinalizedBanquetMenuPackage({
        booking: finalizedBooking,
        actualPositions: [{ id: 'tea', title: 'Tea', quantity: 1, unitPrice: 2500, subtotal: 2500 }],
        actor: { id: 7, username: 'manager', role: 'manager' },
        now: '2026-07-22T13:01:00.000Z'
    });
    assert.equal(retry.idempotent, true);

    assert.throws(
        () => buildFinalizedBanquetMenuPackage({
            booking: finalizedBooking,
            actualPositions: [{ id: 'tea', title: 'Tea', quantity: 1, unitPrice: 2600, subtotal: 2600 }],
            actor: { id: 7, username: 'manager', role: 'manager' }
        }),
        error => error.code === 'MENU_WORKFLOW_FINALIZE_CONFLICT' && error.statusCode === 409
    );
});

test('package rebuild preserves server-owned finalization audit fields', () => {
    const first = buildFinalizedBanquetMenuPackage({
        booking: actualBooking(),
        actualPositions: [{ id: 'tea', title: 'Tea', quantity: 1, unitPrice: 1900, subtotal: 1900 }],
        actor: { id: 7, username: 'manager', role: 'manager' },
        now: '2026-07-22T13:00:00.000Z'
    });
    const booking = {
        category: 'kitchen',
        room: 'table 4',
        price: first.nextTotal,
        extraData: { bookingPackage: first.bookingPackage },
        menuPositions: first.bookingPackage.menuPositions,
        menuWorkflow: { mode: 'actual', status: 'finalized' }
    };

    applyBookingPackage(booking, {
        banquetPreorderRuleContract: buildBanquetPreorderRuleContract([
            { code: BANQUET_MENU_PRICE_RULE_CODES.table, value: 3000 },
            { code: BANQUET_MENU_PRICE_RULE_CODES.recommendedDeposit, value: 2200 }
        ]),
        actor: { id: 9, username: 'editor', role: 'manager' },
        now: '2026-07-22T14:00:00.000Z'
    });

    const workflow = booking.extraData.bookingPackage.menuWorkflow;
    assert.equal(workflow.status, 'finalized');
    assert.equal(workflow.finalizedAt, '2026-07-22T13:00:00.000Z');
    assert.deepEqual(workflow.finalizedBy, { id: '7', username: 'manager' });
    assert.equal(workflow.finalization.requestFingerprint, first.workflow.finalization.requestFingerprint);
    assert.equal(workflow.minimumSnapshot.minimumAmount, 2500);
});
test('booking route exposes canonical actual menu finalization before generic booking mutation routes', () => {
    const source = fs.readFileSync(routePath, 'utf8');
    const endpointIndex = source.indexOf("router.post('/:id/menu-workflow/finalize'");
    assert.notEqual(endpointIndex, -1);
    assert.ok(endpointIndex < source.indexOf("router.delete('/:id'"));
    assert.ok(endpointIndex < source.indexOf("router.put('/:id'"));
    const route = source.slice(endpointIndex, source.indexOf("// Soft delete or permanent delete", endpointIndex));
    assert.match(route, /requireAction\('edit_booking'\)/);
    assert.match(route, /requireTimelineAction\(req, res, businessContext, 'edit'\)/);
    assert.match(route, /getBanquetMembershipForDelete\(client, id, businessContext\)/);
    assert.match(route, /getScopedBookingById\(client, id, businessContext, \{ forUpdate: true \}\)/);
    assert.match(route, /buildFinalizedBanquetMenuPackage/);
    assert.match(route, /syncBookingFinanceInTransaction\(client, updatedBooking/);
    assert.match(route, /optional: false/);
    assert.match(route, /insertScopedHistory\(client, 'booking_menu_actual_finalized'/);
    assert.doesNotMatch(route, /paid_amount|payment_status|invoice|deposit/i);
});