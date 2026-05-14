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
        actor: 'staff profile assigned as booking host or second animator',
        view: true,
        edit: false,
        queue: true,
        dashboardCounts: true,
        timeline: true,
        linkedRoutes: 'allowed when linked entity policy also passes',
        scopeSource: 'staff-host-assignment',
        classification: 'fully-classified'
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

function normalizePositiveInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function userStaffIds(user) {
    const values = [
        user?.staff_id,
        user?.staffId,
        user?.staff?.id,
        ...(Array.isArray(user?.staffIds) ? user.staffIds : []),
        ...(Array.isArray(user?.staff_ids) ? user.staff_ids : [])
    ];
    return [...new Set(values.map(normalizePositiveInteger).filter(Boolean))];
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

function bookingHostStaffId(booking = {}) {
    return normalizePositiveInteger(booking.hosts ?? booking.host_id ?? booking.hostId);
}

function bookingSecondAnimatorStaffId(booking = {}) {
    return normalizePositiveInteger(booking.second_animator ?? booking.secondAnimator);
}

function exactLegacyTokenMatch(user, value) {
    const normalized = normalizeBookingValue(value);
    if (!normalized) return false;
    return userNameTokens(user).includes(normalized);
}

function staffScopedHostMatch(user, booking = {}) {
    const staffIds = userStaffIds(user);
    if (!staffIds.length) return false;
    const bookingStaffIds = [
        bookingHostStaffId(booking),
        bookingSecondAnimatorStaffId(booking)
    ].filter(Boolean);
    return bookingStaffIds.some(staffId => staffIds.includes(staffId));
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

    if (staffScopedHostMatch(user, booking)) {
        return {
            canView: true,
            canEdit: false,
            classification: 'fully-classified',
            scopeSource: 'staff-host-assignment',
            reason: 'durable employee_profiles.staff_id assignment matches booking host/second animator'
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

function buildStaffHostCondition(user, params, alias) {
    const userId = normalizeUserId(user);
    if (!userId) return 'FALSE';
    const userRef = pushParam(params, userId);
    return `EXISTS (
        SELECT 1
        FROM employee_profiles ep
        WHERE ep.user_id = ${userRef}
          AND COALESCE(ep.is_active, true) IS TRUE
          AND ep.staff_id IS NOT NULL
          AND (${alias}.hosts = ep.staff_id OR ${alias}.second_animator = ep.staff_id::text)
    )`;
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

    const conditions = [];
    const staffHostCondition = buildStaffHostCondition(user, params, alias);
    if (staffHostCondition !== 'FALSE') {
        conditions.push({ condition: staffHostCondition, source: 'staff-host-assignment', classification: 'fully-classified' });
    }

    const legacyTokenCondition = buildLegacyTokenCondition(user, params, alias);
    if (legacyTokenCondition !== 'FALSE') {
        conditions.push({ condition: legacyTokenCondition, source: 'legacy-token-match', classification: 'compatible-fallback' });
    }

    if (!conditions.length) {
        return {
            sql: 'AND 1 = 0',
            condition: 'FALSE',
            classification: 'ambiguous-legacy',
            scopeSource: 'deny',
            reason: 'actor has no durable or legacy booking tokens'
        };
    }

    const condition = conditions.length === 1
        ? conditions[0].condition
        : `(${conditions.map(item => item.condition).join(' OR ')})`;
    const hasStaffHost = conditions.some(item => item.source === 'staff-host-assignment');
    const hasLegacy = conditions.some(item => item.source === 'legacy-token-match');

    return {
        sql: `AND ${condition}`,
        condition,
        classification: hasLegacy ? 'compatible-fallback' : 'fully-classified',
        scopeSource: hasStaffHost && hasLegacy ? 'staff-host-or-legacy-token-match' : conditions[0].source,
        reason: hasStaffHost && hasLegacy
            ? 'durable staff host assignment plus exact legacy created_by/second_animator compatibility'
            : (hasStaffHost
                ? 'durable employee_profiles.staff_id assignment matches booking host/second animator'
                : 'exact legacy created_by/second_animator match only')
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

function bookingIdValue(booking = {}) {
    return booking.id ?? booking.booking_id ?? booking.bookingId ?? booking.source_id ?? booking.sourceId ?? null;
}

function bookingDateValue(booking = {}) {
    return booking.date ?? booking.booking_date ?? booking.bookingDate ?? null;
}

function bookingContextHref(booking = {}) {
    const id = bookingIdValue(booking);
    if (!id) return null;
    const date = bookingDateValue(booking);
    if (date) {
        return `/?date=${encodeURIComponent(String(date).slice(0, 10))}&highlight=${encodeURIComponent(id)}`;
    }
    return `/?highlight=${encodeURIComponent(id)}`;
}

function linkedEntityHref(linkedEntity = {}) {
    const type = String(linkedEntity.type || linkedEntity.entityType || '').toLowerCase();
    const id = linkedEntity.id ?? linkedEntity.entity_id ?? linkedEntity.entityId ?? linkedEntity.source_id ?? linkedEntity.sourceId;
    if (!id) return null;
    if (type === 'task') return `/tasks?open=${encodeURIComponent(id)}`;
    if (type === 'lead') return `/sales-funnel?lead=${encodeURIComponent(id)}`;
    if (type === 'customer') return `/customers?open=${encodeURIComponent(id)}`;
    return null;
}

function truthyFlag(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function resolveBookingDerivedLinkedRoute(user, booking = {}, linkedEntity = {}) {
    const bookingVisible = truthyFlag(booking.visible)
        || truthyFlag(booking.visibleToActor)
        || canViewBooking(user, booking);
    if (!bookingVisible) {
        return {
            allowed: false,
            href: null,
            routeKind: 'none',
            reason: 'booking-not-visible'
        };
    }

    const parentHref = bookingContextHref(booking);
    const exactHref = linkedEntityHref(linkedEntity);
    if (exactHref && truthyFlag(linkedEntity.visible)) {
        return {
            allowed: true,
            href: exactHref,
            fallbackHref: parentHref,
            routeKind: `linked-${String(linkedEntity.type || linkedEntity.entityType).toLowerCase()}`,
            reason: 'booking-and-linked-entity-visible'
        };
    }

    if (parentHref) {
        return {
            allowed: true,
            href: parentHref,
            fallbackHref: parentHref,
            routeKind: 'parent-booking-fallback',
            reason: exactHref ? 'linked-entity-visibility-not-proven' : 'no-exact-linked-entity-route'
        };
    }

    return {
        allowed: false,
        href: null,
        routeKind: 'none',
        reason: 'booking-visible-but-no-safe-route'
    };
}

module.exports = {
    BOOKING_VISIBILITY_MATRIX,
    bookingContextHref,
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
    resolveBookingDerivedLinkedRoute,
    normalizeUserId,
    userStaffIds,
    userNameTokens
};
