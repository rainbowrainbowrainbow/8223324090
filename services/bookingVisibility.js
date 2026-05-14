let authExports = {};
try {
    authExports = require('../middleware/auth');
} catch {
    authExports = {};
}

const ACTION_PERMISSIONS = authExports.ACTION_PERMISSIONS || {};

const FULL_BOOKING_ROLES = new Set(['creator', 'director']);

const FALLBACK_VIEW_ROLES = [
    'creator', 'director', 'vice_director', 'senior_manager', 'manager',
    'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin',
    'reception'
];

const FALLBACK_EDIT_ROLES = FALLBACK_VIEW_ROLES;

const BOOKING_VIEW_ROLES = new Set([
    ...(ACTION_PERMISSIONS.view_all || []),
    ...(ACTION_PERMISSIONS.create_booking || []),
    ...(ACTION_PERMISSIONS.edit_booking || []),
    ...FALLBACK_VIEW_ROLES
]);

const BOOKING_EDIT_ROLES = new Set([
    ...(ACTION_PERMISSIONS.edit_booking || []),
    ...FALLBACK_EDIT_ROLES
]);

const BOOKING_VISIBILITY_MATRIX = [
    {
        actor: 'creator/director full access',
        view: true,
        edit: true,
        queue: true,
        dashboardCounts: true,
        timeline: true,
        linkedRoutes: 'allowed when linked entity policy also passes',
        scopeSource: 'full-role',
        classification: 'fully-classified'
    },
    {
        actor: 'manager/admin/reception/current booking operational roles',
        view: true,
        edit: 'only roles with current edit_booking permission',
        queue: true,
        dashboardCounts: true,
        timeline: true,
        linkedRoutes: 'allowed when linked entity policy also passes',
        scopeSource: 'booking-operational-role',
        classification: 'compatible-fallback'
    },
    {
        actor: 'creator of booking through exact legacy created_by match',
        view: true,
        edit: false,
        queue: false,
        dashboardCounts: false,
        timeline: true,
        linkedRoutes: 'booking route only unless linked entity policy passes',
        scopeSource: 'legacy-created-by',
        classification: 'compatible-fallback'
    },
    {
        actor: 'line/location scoped actor',
        view: false,
        edit: false,
        queue: false,
        dashboardCounts: false,
        timeline: false,
        linkedRoutes: false,
        scopeSource: 'missing-durable-booking-line-scope',
        classification: 'ambiguous-legacy'
    },
    {
        actor: 'operational actor without booking scope / unknown',
        view: false,
        edit: false,
        queue: false,
        dashboardCounts: false,
        timeline: false,
        linkedRoutes: false,
        scopeSource: 'deny',
        classification: 'ambiguous-legacy'
    }
];

function normalizeRole(user) {
    return String(user?.role || '').trim();
}

function normalizeUserId(user) {
    const parsed = Number(user?.id || user?.userId || 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function userNameTokens(user) {
    return [user?.username, user?.name]
        .map(value => String(value || '').trim())
        .filter(Boolean);
}

function pushParam(params, value) {
    params.push(value);
    return `$${params.length}`;
}

function isFullBookingRole(user) {
    return FULL_BOOKING_ROLES.has(normalizeRole(user));
}

function hasOperationalBookingView(user) {
    return BOOKING_VIEW_ROLES.has(normalizeRole(user));
}

function hasOperationalBookingEdit(user) {
    return BOOKING_EDIT_ROLES.has(normalizeRole(user));
}

function normalizeBookingValue(value) {
    return String(value || '').trim();
}

function bookingCreatedBy(booking = {}) {
    return normalizeBookingValue(booking.created_by ?? booking.createdBy);
}

function bookingSecondAnimator(booking = {}) {
    return normalizeBookingValue(booking.second_animator ?? booking.secondAnimator);
}

function exactLegacyTokenMatch(user, value) {
    const normalized = normalizeBookingValue(value);
    if (!normalized) return false;
    return userNameTokens(user).includes(normalized);
}

function classifyBookingVisibility(user, booking = {}) {
    if (!user) {
        return {
            canView: false,
            canEdit: false,
            classification: 'ambiguous-legacy',
            scopeSource: 'deny',
            reason: 'no-authenticated-actor'
        };
    }

    if (isFullBookingRole(user)) {
        return {
            canView: true,
            canEdit: true,
            classification: 'fully-classified',
            scopeSource: 'full-role',
            reason: 'creator/director full booking access'
        };
    }

    if (hasOperationalBookingView(user)) {
        return {
            canView: true,
            canEdit: hasOperationalBookingEdit(user),
            classification: 'compatible-fallback',
            scopeSource: hasOperationalBookingEdit(user) ? 'booking-operational-edit-role' : 'booking-operational-view-role',
            reason: 'current booking operational role without durable team/location scope'
        };
    }

    if (exactLegacyTokenMatch(user, bookingCreatedBy(booking))) {
        return {
            canView: true,
            canEdit: false,
            classification: 'compatible-fallback',
            scopeSource: 'legacy-created-by',
            reason: 'exact legacy created_by match'
        };
    }

    if (exactLegacyTokenMatch(user, bookingSecondAnimator(booking))) {
        return {
            canView: true,
            canEdit: false,
            classification: 'compatible-fallback',
            scopeSource: 'legacy-second-animator',
            reason: 'exact legacy second_animator match'
        };
    }

    return {
        canView: false,
        canEdit: false,
        classification: 'ambiguous-legacy',
        scopeSource: 'deny',
        reason: 'no durable booking visibility rule matched'
    };
}

function buildLegacyTokenCondition(user, params, alias) {
    const tokenRefs = userNameTokens(user).map(token => pushParam(params, token));
    if (!tokenRefs.length) return 'FALSE';
    const values = tokenRefs.join(',');
    return `(${alias}.created_by IN (${values}) OR ${alias}.second_animator IN (${values}))`;
}

function getVisibleBookingScope(user, params = [], alias = 'b') {
    if (!user) {
        return {
            sql: 'AND 1 = 0',
            condition: 'FALSE',
            classification: 'ambiguous-legacy',
            scopeSource: 'deny',
            reason: 'no-authenticated-actor'
        };
    }

    if (isFullBookingRole(user)) {
        return {
            sql: '',
            condition: 'TRUE',
            classification: 'fully-classified',
            scopeSource: 'full-role',
            reason: 'creator/director full booking access'
        };
    }

    if (hasOperationalBookingView(user)) {
        return {
            sql: '',
            condition: 'TRUE',
            classification: 'compatible-fallback',
            scopeSource: hasOperationalBookingEdit(user) ? 'booking-operational-edit-role' : 'booking-operational-view-role',
            reason: 'current booking operational role without durable team/location scope'
        };
    }

    const condition = buildLegacyTokenCondition(user, params, alias);
    if (condition === 'FALSE') {
        return {
            sql: 'AND 1 = 0',
            condition,
            classification: 'ambiguous-legacy',
            scopeSource: 'deny',
            reason: 'actor has no durable or legacy booking tokens'
        };
    }

    return {
        sql: `AND ${condition}`,
        condition,
        classification: 'compatible-fallback',
        scopeSource: 'legacy-token-match',
        reason: 'exact legacy created_by/second_animator match only'
    };
}

function buildBookingVisibilityScope(user, params = [], alias = 'b') {
    return getVisibleBookingScope(user, params, alias).sql;
}

function buildBookingVisibilityCondition(user, params = [], alias = 'b') {
    return getVisibleBookingScope(user, params, alias).condition;
}

function canViewBooking(user, booking) {
    return classifyBookingVisibility(user, booking).canView === true;
}

function canEditBooking(user, booking) {
    const decision = classifyBookingVisibility(user, booking);
    return decision.canView === true && decision.canEdit === true;
}

function bookingAccessDeniedPayload() {
    return { success: false, error: 'Booking not found' };
}

module.exports = {
    BOOKING_VISIBILITY_MATRIX,
    buildBookingVisibilityCondition,
    buildBookingVisibilityScope,
    bookingAccessDeniedPayload,
    canEditBooking,
    canViewBooking,
    classifyBookingVisibility,
    getVisibleBookingScope,
    hasOperationalBookingEdit,
    hasOperationalBookingView,
    isFullBookingRole,
    normalizeUserId,
    userNameTokens
};
