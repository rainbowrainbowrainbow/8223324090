const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    BOOKING_VISIBILITY_MATRIX,
    BOOKING_VISIBILITY_REASON_CODES,
    bookingVisibilityReasonCode,
    buildBookingVisibilityScope,
    canEditBooking,
    canViewBooking,
    classifyBookingVisibility,
    getVisibleBookingScope,
    resolveBookingDerivedLinkedRoute,
    userStaffIds
} = require('../services/bookingVisibility');

test('booking visibility matrix documents real durable and missing scope dimensions', () => {
    assert.ok(BOOKING_VISIBILITY_MATRIX.some(row => row.scopeSource === 'full-role' && row.view === true));
    assert.ok(BOOKING_VISIBILITY_MATRIX.some(row => row.scopeSource === 'booking-operational-role'));
    assert.ok(BOOKING_VISIBILITY_MATRIX.some(row => row.scopeSource === 'staff-host-assignment' && row.view === true && row.edit === false));
    assert.ok(BOOKING_VISIBILITY_MATRIX.some(row => row.scopeSource === 'missing-durable-booking-line-scope' && row.view === false));
    assert.ok(BOOKING_VISIBILITY_MATRIX.every(row => row.reasonCode), 'matrix rows should carry stable internal reason codes');
});

test('booking visibility exposes stable internal reason codes without fake team line location promotion', () => {
    assert.equal(BOOKING_VISIBILITY_REASON_CODES.FULL_ROLE, 'full_role');
    assert.equal(BOOKING_VISIBILITY_REASON_CODES.STAFF_HOST_SCOPE, 'staff_host_scope');
    assert.equal(BOOKING_VISIBILITY_REASON_CODES.CREATOR_SCOPE, 'creator_scope');
    assert.equal(BOOKING_VISIBILITY_REASON_CODES.DENY_NO_SCOPE, 'deny_no_scope');
    assert.equal(bookingVisibilityReasonCode('full-role'), 'full_role');
    assert.equal(bookingVisibilityReasonCode('staff-host-assignment'), 'staff_host_scope');
    assert.equal(bookingVisibilityReasonCode('legacy-created-by'), 'creator_scope');
    assert.equal(bookingVisibilityReasonCode('deny'), 'deny_no_scope');

    const root = path.resolve(__dirname, '..');
    const source = fs.readFileSync(path.join(root, 'services/bookingVisibility.js'), 'utf8');
    assert.doesNotMatch(source, /team_scope|line_scope|location_scope/, 'team/line/location must not be promoted without durable truth');
});

test('creator/director have fully classified booking scope', () => {
    const actor = { id: 1, username: 'owner', role: 'creator' };
    const booking = { id: 'BK-1', created_by: 'other' };

    const decision = classifyBookingVisibility(actor, booking);
    assert.equal(decision.canView, true);
    assert.equal(decision.canEdit, true);
    assert.equal(decision.classification, 'fully-classified');
    assert.equal(decision.scopeSource, 'full-role');
    assert.equal(decision.reasonCode, 'full_role');

    const params = [];
    const scope = getVisibleBookingScope(actor, params, 'b');
    assert.equal(scope.sql, '');
    assert.equal(scope.condition, 'TRUE');
    assert.equal(scope.reasonCode, 'full_role');
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
    assert.equal(decision.reasonCode, 'ambiguous_legacy');
    assert.equal(canViewBooking(actor, booking), true);
    assert.equal(canEditBooking(actor, booking), true);

    const params = [];
    assert.equal(buildBookingVisibilityScope(actor, params, 'b'), '');
    assert.deepEqual(params, []);
});

test('admin-up booking operators can edit and soft-delete through the shared visibility contract', () => {
    const booking = { id: 'BK-OPS', created_by: 'someone-else', linked_to: null };
    const roles = ['manager', 'senior_manager', 'vice_director', 'director', 'accountant', 'hr', 'admin'];

    for (const role of roles) {
        const actor = { id: 100, username: `${role}-user`, name: role, role };
        const decision = classifyBookingVisibility(actor, booking);
        assert.equal(decision.canView, true, `${role} can view bookings`);
        assert.equal(decision.canEdit, true, `${role} can edit/delete bookings`);
        assert.equal(canEditBooking(actor, booking), true, `${role} passes canEditBooking guard`);
        assert.equal(buildBookingVisibilityScope(actor, [], 'b'), '', `${role} gets operational query scope`);
    }
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
    assert.match(scope.sql, /employee_profiles ep/);
    assert.match(scope.sql, /b\.line_id = ep\.staff_id::text/);
    assert.doesNotMatch(scope.sql, /b\.hosts = ep\.staff_id/);
    assert.match(scope.sql, /b\.created_by IN \(\$2,\$3\)/);
    assert.match(scope.sql, /b\.second_animator IN \(\$2,\$3\)/);
    assert.deepEqual(params, [44, 'animator-one', 'Animator One']);
});

test('durable staff line assignment promotes booking visibility without edit rights', () => {
    const actor = { id: 77, username: 'host-user', role: 'animator', staffIds: [501] };
    const booking = { id: 'BK-STAFF', line_id: '501', hosts: 1, created_by: 'someone-else' };

    assert.deepEqual(userStaffIds(actor), [501]);
    const decision = classifyBookingVisibility(actor, booking);
    assert.equal(decision.canView, true);
    assert.equal(decision.canEdit, false);
    assert.equal(decision.classification, 'fully-classified');
    assert.equal(decision.scopeSource, 'staff-host-assignment');
    assert.equal(decision.reasonCode, 'staff_host_scope');

    const secondAnimator = classifyBookingVisibility(actor, { second_animator: '501' });
    assert.equal(secondAnimator.canView, true);
    assert.equal(secondAnimator.scopeSource, 'staff-host-assignment');
});

test('booking hosts count alone does not grant staff visibility', () => {
    const actor = { id: 77, username: 'host-user', role: 'animator', staffIds: [501] };
    const booking = { id: 'BK-HOST-COUNT', line_id: '777', hosts: 501, created_by: 'someone-else' };

    const decision = classifyBookingVisibility(actor, booking);
    assert.equal(decision.canView, false);
    assert.equal(decision.canEdit, false);
    assert.equal(decision.scopeSource, 'deny');
});

test('durable staff primary line assignment makes animator timeline bookings visible', () => {
    const actor = { id: 88, username: 'Zhenya', name: 'Женя', role: 'animator', staffIds: [501] };
    const booking = {
        id: 'BK-ZHENYA',
        line_id: '501',
        hosts: 2,
        created_by: 'manager',
        second_animator: null
    };

    const decision = classifyBookingVisibility(actor, booking);
    assert.equal(decision.canView, true);
    assert.equal(decision.canEdit, false);
    assert.equal(decision.scopeSource, 'staff-host-assignment');
    assert.equal(decision.reasonCode, 'staff_host_scope');
});

test('linked animator rows stay scoped to the assigned animator without broad animator access', () => {
    const linkedBooking = {
        id: 'BK-LINKED-ANIMATOR',
        linked_to: 'BK-PARENT',
        line_id: '502',
        second_animator: '502',
        created_by: 'manager-user'
    };
    const assignedAnimator = { id: 5020, username: 'assigned-host', role: 'animator', staffIds: [502] };
    const otherAnimator = { id: 5030, username: 'other-host', name: 'Other Host', role: 'animator', staffIds: [503] };

    const assignedDecision = classifyBookingVisibility(assignedAnimator, linkedBooking);
    assert.equal(assignedDecision.canView, true);
    assert.equal(assignedDecision.canEdit, false);
    assert.equal(assignedDecision.scopeSource, 'staff-host-assignment');
    assert.equal(assignedDecision.reasonCode, 'staff_host_scope');
    assert.equal(canViewBooking(assignedAnimator, linkedBooking), true);

    const otherDecision = classifyBookingVisibility(otherAnimator, linkedBooking);
    assert.equal(otherDecision.canView, false);
    assert.equal(otherDecision.canEdit, false);
    assert.equal(otherDecision.scopeSource, 'deny');
    assert.equal(canViewBooking(otherAnimator, linkedBooking), false);

    for (const role of ['manager', 'director']) {
        const operator = { id: 900, username: `${role}-user`, role };
        const decision = classifyBookingVisibility(operator, linkedBooking);
        assert.equal(decision.canView, true, `${role} can view linked animator rows`);
        assert.equal(decision.canEdit, true, `${role} keeps operational/full edit access`);
    }
});

test('query scope adds batch-safe employee profile staff assignment condition', () => {
    const actor = { id: 77, username: 'host-user', role: 'animator' };
    const params = [];
    const scope = getVisibleBookingScope(actor, params, 'b');

    assert.match(scope.condition, /EXISTS \(/);
    assert.match(scope.condition, /FROM employee_profiles ep/);
    assert.match(scope.condition, /ep\.user_id = \$1/);
    assert.match(scope.condition, /b\.line_id = ep\.staff_id::text/);
    assert.doesNotMatch(scope.condition, /b\.hosts = ep\.staff_id/);
    assert.match(scope.condition, /b\.second_animator = ep\.staff_id::text/);
    assert.match(scope.condition, /FROM users u/);
    assert.match(scope.condition, /JOIN staff s/);
    assert.match(scope.condition, /b\.line_id = s\.id::text/);
    assert.doesNotMatch(scope.condition, /b\.hosts = s\.id/);
    assert.match(scope.scopeSource, /staff-host/);
    assert.deepEqual(params, [77, 'host-user']);
});

test('query scope accepts proven staffIds when actor is resolved outside users table', () => {
    const actor = { username: 'telegram-host', role: 'animator', staffIds: [501] };
    const params = [];
    const scope = getVisibleBookingScope(actor, params, 'b');

    assert.match(scope.condition, /b\.line_id IN \(\$1\)/);
    assert.doesNotMatch(scope.condition, /b\.hosts IN/);
    assert.match(scope.condition, /b\.second_animator IN \(\$2\)/);
    assert.equal(scope.scopeSource, 'staff-host-or-legacy-token-match');
    assert.equal(scope.reasonCode, 'staff_host_scope');
    assert.deepEqual(params, ['501', '501', 'telegram-host']);
});

test('booking-derived linked routes prefer exact visible child route then parent booking fallback', () => {
    const actor = { id: 1, username: 'manager', role: 'manager' };
    const booking = { id: 'BK-10', date: '2026-05-14', visible: true };

    const taskRoute = resolveBookingDerivedLinkedRoute(actor, booking, { type: 'task', id: 991, visible: true });
    assert.equal(taskRoute.allowed, true);
    assert.equal(taskRoute.href, '/tasks?open=991');
    assert.equal(taskRoute.fallbackHref, '/?date=2026-05-14&highlight=BK-10');
    assert.equal(taskRoute.routeKind, 'linked-task');

    const leadFallback = resolveBookingDerivedLinkedRoute(actor, booking, { type: 'lead', id: 55, visible: false });
    assert.equal(leadFallback.allowed, true);
    assert.equal(leadFallback.href, '/?date=2026-05-14&highlight=BK-10');
    assert.equal(leadFallback.routeKind, 'parent-booking-fallback');
    assert.equal(leadFallback.reason, 'linked-entity-visibility-not-proven');

    const denied = resolveBookingDerivedLinkedRoute({ role: 'cook' }, { id: 'BK-HIDDEN', date: '2026-05-14' }, { type: 'task', id: 10, visible: true });
    assert.equal(denied.allowed, false);
    assert.equal(denied.href, null);
    assert.equal(denied.reason, 'booking-not-visible');
});

test('no parallel booking visibility system is introduced in services or routes', () => {
    const root = path.resolve(__dirname, '..');
    const forbidden = /\b(bookingVisibilityV2|bookingScopeHelper|queueBookingScope)\b/;
    const stack = ['services', 'routes'].map(dir => path.join(root, dir));
    const matches = [];
    while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                const body = fs.readFileSync(fullPath, 'utf8');
                if (forbidden.test(body)) matches.push(path.relative(root, fullPath));
            }
        }
    }
    assert.deepEqual(matches, []);
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
