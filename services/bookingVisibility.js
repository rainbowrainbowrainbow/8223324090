const { resolveCapability } = require('./accountAccessPolicy');

function canUseAction(user, action) {
    return resolveCapability(user, action, { type: 'action' }).allowed;
}

const BOOKING_VISIBILITY_REASON_CODES = Object.freeze({
    FULL_ROLE: 'full_role',
    OPERATIONAL_COMPATIBLE_FALLBACK: 'ambiguous_legacy',
    STAFF_HOST_SCOPE: 'staff_host_scope',
    CREATOR_SCOPE: 'creator_scope',
    LEGACY_SECOND_ANIMATOR: 'ambiguous_legacy',
    MISSING_DURABLE_OPERATIONAL_SCOPE: 'ambiguous_legacy',
    AMBIGUOUS_LEGACY: 'ambiguous_legacy',
    DENY_NO_SCOPE: 'deny_no_scope'
});

function bookingVisibilityReasonCode(scopeSource) {
    if (scopeSource === 'full-role') return BOOKING_VISIBILITY_REASON_CODES.FULL_ROLE;
    if (scopeSource === 'staff-host-assignment') return BOOKING_VISIBILITY_REASON_CODES.STAFF_HOST_SCOPE;
    if (scopeSource === 'staff-host-or-legacy-token-match') return BOOKING_VISIBILITY_REASON_CODES.STAFF_HOST_SCOPE;
    if (scopeSource === 'legacy-created-by') return BOOKING_VISIBILITY_REASON_CODES.CREATOR_SCOPE;
    if (scopeSource === 'deny') return BOOKING_VISIBILITY_REASON_CODES.DENY_NO_SCOPE;
    return BOOKING_VISIBILITY_REASON_CODES.AMBIGUOUS_LEGACY;
}

function withBookingVisibilityReason(decision) {
    return {
        ...decision,
        reasonCode: decision.reasonCode || bookingVisibilityReasonCode(decision.scopeSource)
    };
}

const BOOKING_VISIBILITY_MATRIX = [
    {
        actor: 'view_all + edit_booking capability access',
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
        actor: 'view_all capability without edit_booking',
        view: true,
        edit: false,
        queue: true,
        dashboardCounts: true,
        timeline: true,
        linkedRoutes: 'allowed when linked entity policy also passes',
        scopeSource: 'booking-operational-role',
        classification: 'compatible-fallback'
    },
    {
        actor: 'staff profile assigned as booking primary line or second animator',
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
].map(row => ({
    ...row,
    reasonCode: bookingVisibilityReasonCode(row.scopeSource)
}));

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
    return canUseAction(user, 'view_all') && canUseAction(user, 'edit_booking');
}

function hasOperationalBookingView(user) {
    return canUseAction(user, 'view_all');
}

function hasOperationalBookingEdit(user) {
    return canUseAction(user, 'edit_booking');
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

function bookingLineStaffId(booking = {}) {
    return normalizePositiveInteger(booking.line_id ?? booking.lineId);
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
        bookingLineStaffId(booking),
        bookingSecondAnimatorStaffId(booking)
    ].filter(Boolean);
    return bookingStaffIds.some(staffId => staffIds.includes(staffId));
}

function classifyBookingVisibility(user, booking = {}) {
    if (!user) {
        return withBookingVisibilityReason({
            canView: false,
            canEdit: false,
            classification: 'ambiguous-legacy',
            scopeSource: 'deny',
            reason: 'no-authenticated-actor'
        });
    }

    if (isFullBookingRole(user)) {
        return withBookingVisibilityReason({
            canView: true,
            canEdit: true,
            classification: 'fully-classified',
            scopeSource: 'full-role',
            reason: 'view_all and edit_booking capabilities grant full booking access'
        });
    }

    if (hasOperationalBookingView(user)) {
        return withBookingVisibilityReason({
            canView: true,
            canEdit: hasOperationalBookingEdit(user),
            classification: 'compatible-fallback',
            scopeSource: hasOperationalBookingEdit(user) ? 'booking-operational-edit-role' : 'booking-operational-view-role',
            reason: 'current booking operational role without durable team/location scope'
        });
    }

    if (staffScopedHostMatch(user, booking)) {
        return withBookingVisibilityReason({
            canView: true,
            canEdit: hasOperationalBookingEdit(user),
            classification: 'fully-classified',
            scopeSource: 'staff-host-assignment',
            reason: 'durable employee_profiles.staff_id assignment matches booking primary line or second animator'
        });
    }

    if (exactLegacyTokenMatch(user, bookingCreatedBy(booking))) {
        return withBookingVisibilityReason({
            canView: true,
            canEdit: hasOperationalBookingEdit(user),
            classification: 'compatible-fallback',
            scopeSource: 'legacy-created-by',
            reason: 'exact legacy created_by match'
        });
    }

    if (exactLegacyTokenMatch(user, bookingSecondAnimator(booking))) {
        return withBookingVisibilityReason({
            canView: true,
            canEdit: hasOperationalBookingEdit(user),
            classification: 'compatible-fallback',
            scopeSource: 'legacy-second-animator',
            reason: 'exact legacy second_animator match'
        });
    }

    return withBookingVisibilityReason({
        canView: false,
        canEdit: false,
        classification: 'ambiguous-legacy',
        scopeSource: 'deny',
        reason: 'no durable booking visibility rule matched'
    });
}

function buildLegacyTokenCondition(user, params, alias) {
    const tokenRefs = userNameTokens(user).map(token => pushParam(params, token));
    if (!tokenRefs.length) return 'FALSE';
    const values = tokenRefs.join(',');
    return `(${alias}.created_by IN (${values}) OR ${alias}.second_animator IN (${values}))`;
}

function buildStaffHostCondition(user, params, alias) {
    const userId = normalizeUserId(user);
    const conditions = [];

    if (userId) {
        const userRef = pushParam(params, userId);
        conditions.push(`EXISTS (
            SELECT 1
            FROM employee_profiles ep
            WHERE ep.user_id = ${userRef}
              AND COALESCE(ep.is_active, true) IS TRUE
              AND ep.staff_id IS NOT NULL
              AND (${alias}.line_id = ep.staff_id::text OR ${alias}.second_animator = ep.staff_id::text)
        )`);
        conditions.push(`EXISTS (
            SELECT 1
            FROM users u
            JOIN staff s ON COALESCE(s.is_active, true) IS TRUE
              AND (
                (NULLIF(BTRIM(u.name), '') IS NOT NULL AND LOWER(BTRIM(s.name)) = LOWER(BTRIM(u.name)))
                OR (NULLIF(BTRIM(u.username), '') IS NOT NULL AND LOWER(BTRIM(s.name)) = LOWER(BTRIM(u.username)))
                OR (NULLIF(BTRIM(u.telegram_username), '') IS NOT NULL AND LOWER(BTRIM(COALESCE(s.telegram_username, ''))) = LOWER(BTRIM(u.telegram_username)))
                OR (NULLIF(BTRIM(u.telegram_chat_id::text), '') IS NOT NULL AND NULLIF(BTRIM(COALESCE(s.telegram_id::text, '')), '') = BTRIM(u.telegram_chat_id::text))
              )
            WHERE u.id = ${userRef}
              AND (
                ${alias}.line_id = s.id::text
                OR ${alias}.second_animator = s.id::text
                OR LOWER(BTRIM(COALESCE(${alias}.second_animator, ''))) = LOWER(BTRIM(s.name))
              )
        )`);
    }

    const staffIds = userStaffIds(user);
    if (staffIds.length) {
        const lineRefs = staffIds.map(staffId => pushParam(params, String(staffId))).join(',');
        const secondAnimatorRefs = staffIds.map(staffId => pushParam(params, String(staffId))).join(',');
        conditions.push(`(${alias}.line_id IN (${lineRefs}) OR ${alias}.second_animator IN (${secondAnimatorRefs}))`);
    }

    if (!conditions.length) return 'FALSE';
    return conditions.length === 1 ? conditions[0] : `(${conditions.join(' OR ')})`;
}

function getVisibleBookingScope(user, params = [], alias = 'b') {
    if (!user) {
        return withBookingVisibilityReason({
            sql: 'AND 1 = 0',
            condition: 'FALSE',
            classification: 'ambiguous-legacy',
            scopeSource: 'deny',
            reason: 'no-authenticated-actor'
        });
    }

    if (isFullBookingRole(user)) {
        return withBookingVisibilityReason({
            sql: '',
            condition: 'TRUE',
            classification: 'fully-classified',
            scopeSource: 'full-role',
            reason: 'view_all and edit_booking capabilities grant full booking access'
        });
    }

    if (hasOperationalBookingView(user)) {
        return withBookingVisibilityReason({
            sql: '',
            condition: 'TRUE',
            classification: 'compatible-fallback',
            scopeSource: hasOperationalBookingEdit(user) ? 'booking-operational-edit-role' : 'booking-operational-view-role',
            reason: 'current booking operational role without durable team/location scope'
        });
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
        return withBookingVisibilityReason({
            sql: 'AND 1 = 0',
            condition: 'FALSE',
            classification: 'ambiguous-legacy',
            scopeSource: 'deny',
            reason: 'actor has no durable or legacy booking tokens'
        });
    }

    const condition = conditions.length === 1
        ? conditions[0].condition
        : `(${conditions.map(item => item.condition).join(' OR ')})`;
    const hasStaffHost = conditions.some(item => item.source === 'staff-host-assignment');
    const hasLegacy = conditions.some(item => item.source === 'legacy-token-match');

    return withBookingVisibilityReason({
        sql: `AND ${condition}`,
        condition,
        classification: hasLegacy ? 'compatible-fallback' : 'fully-classified',
        scopeSource: hasStaffHost && hasLegacy ? 'staff-host-or-legacy-token-match' : conditions[0].source,
        reason: hasStaffHost && hasLegacy
            ? 'durable staff host assignment plus exact legacy created_by/second_animator compatibility'
            : (hasStaffHost
                ? 'durable employee_profiles.staff_id assignment matches booking primary line/host/second animator'
                : 'exact legacy created_by/second_animator match only')
    });
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

function canDeleteBooking(user, booking) {
    return canUseAction(user, 'delete_booking') && canViewBooking(user, booking);
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
    BOOKING_VISIBILITY_REASON_CODES,
    bookingContextHref,
    bookingVisibilityReasonCode,
    buildBookingVisibilityCondition,
    buildBookingVisibilityScope,
    bookingAccessDeniedPayload,
    canDeleteBooking,
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
