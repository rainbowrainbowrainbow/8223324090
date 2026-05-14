const test = require('node:test');
const assert = require('node:assert/strict');

const {
    BOOKING_VISIBILITY_MATRIX,
    buildBookingVisibilityScope,
    canEditBooking,
    canViewBooking,
    classifyBookingVisibility,
    getVisibleBookingScope
} = require('../services/bookingVisibility');

test('booking visibility matrix documents real durable and missing scope dimensions', () => {
    assert.ok(BOOKING_VISIBILITY_MATRIX.some(row => row.scopeSource === 'full-role' && row.view === true));
    assert.ok(BOOKING_VISIBILITY_MATRIX.some(row => row.scopeSource === 'booking-operational-role'));
    assert.ok(BOOKING_VISIBILITY_MATRIX.some(row => row.scopeSource === 'missing-durable-booking-line-scope' && row.view === false));
});

test('creator/director have fully classified booking scope', () => {
    const actor = { id: 1, username: 'owner', role: 'creator' };
    const booking = { id: 'BK-1', created_by: 'other' };

    const decision = classifyBookingVisibility(actor, booking);
    assert.equal(decision.canView, true);
    assert.equal(decision.canEdit, true);
    assert.equal(decision.classification, 'fully-classified');
    assert.equal(decision.scopeSource, 'full-role');

    const params = [];
    const scope = getVisibleBookingScope(actor, params, 'b');
    assert.equal(scope.sql, '');
    assert.equal(scope.condition, 'TRUE');
    assert.deepEqual(params, []);
});

test('current booking operational roles use compatible fallback and can be query-scoped without N+1 checks', () => {
    const actor = { id: 20, username: 'manager-user', name: 'Manager User', role: 'manager' };
    const booking = { id: 'BK-2', created_by: 'someone-else' };

    const decision = classifyBookingVisibility(actor, booking);
    assert.equal(decision.canView, true);
    assert.equal(decision.canEdit, true);
    assert.equal(decision.classification, 'compatible-fallback');
    assert.match(decision.scopeSource, /booking-operational/);
    assert.equal(canViewBooking(actor, booking), true);
    assert.equal(canEditBooking(actor, booking), true);

    const params = [];
    assert.equal(buildBookingVisibilityScope(actor, params, 'b'), '');
    assert.deepEqual(params, []);
});

test('legacy created_by and second_animator matches are exact compatible fallbacks only', () => {
    const actor = { id: 44, username: 'animator-one', name: 'Animator One', role: 'animator' };

    const created = classifyBookingVisibility(actor, { created_by: 'animator-one' });
    assert.equal(created.canView, true);
    assert.equal(created.canEdit, false);
    assert.equal(created.scopeSource, 'legacy-created-by');

    const secondAnimator = classifyBookingVisibility(actor, { second_animator: 'Animator One' });
    assert.equal(secondAnimator.canView, true);
    assert.equal(secondAnimator.canEdit, false);
    assert.equal(secondAnimator.scopeSource, 'legacy-second-animator');

    const params = [];
    const scope = getVisibleBookingScope(actor, params, 'b');
    assert.match(scope.sql, /b\.created_by IN \(\$1,\$2\)/);
    assert.match(scope.sql, /b\.second_animator IN \(\$1,\$2\)/);
    assert.deepEqual(params, ['animator-one', 'Animator One']);
});

test('unknown or ambiguous booking scope fails closed', () => {
    const actor = { id: 55, username: 'cook-one', name: 'Cook One', role: 'cook' };
    const booking = { id: 'BK-3', created_by: 'other', second_animator: 'Other' };

    const decision = classifyBookingVisibility(actor, booking);
    assert.equal(decision.canView, false);
    assert.equal(decision.canEdit, false);
    assert.equal(decision.classification, 'ambiguous-legacy');
    assert.equal(decision.scopeSource, 'deny');

    const params = [];
    const scope = getVisibleBookingScope({ role: 'waiter' }, params, 'b');
    assert.equal(scope.sql, 'AND 1 = 0');
    assert.equal(scope.condition, 'FALSE');
});
